package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"
)

const (
	githubDataLife     = 10 * time.Minute
	newsLife           = 10 * time.Minute
	monitorResultLife  = time.Minute
	monitorTimeout     = 6 * time.Second
	monitorMaxRedirect = 3
	newsStoryCount     = 8
	maxMonitors        = 10
	maxTodos           = 100
	maxTodoLength      = 300
	maxNotesLength     = 20000
)

// cached keeps one recent value per key. If a refresh fails, the last good value is still served,
// so a GitHub or Hacker News outage doesn't blank the dashboard.
type cached[T any] struct {
	mutex   sync.Mutex
	entries map[string]*cacheEntry[T]
}

type cacheEntry[T any] struct {
	mutex     sync.Mutex
	value     T
	fetchedAt time.Time
}

func newCached[T any]() *cached[T] {
	return &cached[T]{entries: map[string]*cacheEntry[T]{}}
}

func (c *cached[T]) get(key string, life time.Duration, fetch func() (T, error)) (T, time.Time, error) {
	c.mutex.Lock()
	entry, found := c.entries[key]
	if !found {
		entry = &cacheEntry[T]{}
		c.entries[key] = entry
	}
	c.mutex.Unlock()

	// One refresh per key at a time, so a burst of new tabs makes a single outside request.
	entry.mutex.Lock()
	defer entry.mutex.Unlock()
	if !entry.fetchedAt.IsZero() && time.Since(entry.fetchedAt) < life {
		return entry.value, entry.fetchedAt, nil
	}
	value, err := fetch()
	if err != nil {
		if !entry.fetchedAt.IsZero() {
			log.Printf("serving saved data after refresh failed: %v", err)
			return entry.value, entry.fetchedAt, nil
		}
		return value, time.Time{}, err
	}
	entry.value = value
	entry.fetchedAt = time.Now()
	return value, entry.fetchedAt, nil
}

// DevServices holds the data the developer dashboard fetches from outside.
type DevServices struct {
	github   *cached[GitHubDashboard]
	news     *cached[[]NewsStory]
	monitors *cached[MonitorResult]
	client   *http.Client
}

func newDevServices() *DevServices {
	return &DevServices{
		github:   newCached[GitHubDashboard](),
		news:     newCached[[]NewsStory](),
		monitors: newCached[MonitorResult](),
		client:   newMonitorClient(),
	}
}

func (a *App) registerDevRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/dev/github", a.signedIn(a.handleDevGitHub))
	mux.HandleFunc("GET /api/dev/news", a.signedIn(a.handleDevNews))
	mux.HandleFunc("GET /api/dev/workspace", a.signedIn(a.handleGetWorkspace))
	mux.HandleFunc("PUT /api/dev/workspace", a.signedIn(a.handlePutWorkspace))
	mux.HandleFunc("GET /api/dev/monitors", a.signedIn(a.handleDevMonitors))
}

// GitHubRepo is one of the user's recently updated public repositories.
type GitHubRepo struct {
	Name        string `json:"name"`
	URL         string `json:"url"`
	Description string `json:"description"`
	Language    string `json:"language"`
	Stars       int    `json:"stars"`
	PushedAt    string `json:"pushedAt"`
}

// GitHubItem is an open pull request or issue.
type GitHubItem struct {
	Title     string `json:"title"`
	URL       string `json:"url"`
	Repo      string `json:"repo"`
	Number    int    `json:"number"`
	UpdatedAt string `json:"updatedAt"`
}

// GitHubEvent is one entry in the user's public activity.
type GitHubEvent struct {
	Type      string `json:"type"`
	Repo      string `json:"repo"`
	CreatedAt string `json:"createdAt"`
}

// GitHubDashboard is what the GitHub panel shows. Partial is true if some sections couldn't be loaded.
type GitHubDashboard struct {
	Login        string        `json:"login"`
	Name         string        `json:"name"`
	PublicRepos  int           `json:"publicRepos"`
	Followers    int           `json:"followers"`
	Following    int           `json:"following"`
	Repos        []GitHubRepo  `json:"repos"`
	PullRequests []GitHubItem  `json:"pullRequests"`
	Issues       []GitHubItem  `json:"issues"`
	Events       []GitHubEvent `json:"events"`
	Partial      bool          `json:"partial"`
}

// githubGet reads public data. The app's own credentials are only used for GitHub's higher rate limit.
func githubGet(ctx context.Context, path string, target any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, envOr("GITHUB_API_URL", "https://api.github.com")+path, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "home-base")
	if githubConfigured() {
		request.SetBasicAuth(os.Getenv("GITHUB_CLIENT_ID"), os.Getenv("GITHUB_CLIENT_SECRET"))
	}
	response, err := githubClient.Do(request)
	if err != nil {
		return fmt.Errorf("request GitHub %s: %w", strings.SplitN(path, "?", 2)[0], err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("GitHub %s returned %d", strings.SplitN(path, "?", 2)[0], response.StatusCode)
	}
	return json.NewDecoder(response.Body).Decode(target)
}

func safeLink(value string) string {
	address, ok := cleanURL(value)
	if !ok {
		return ""
	}
	return address
}

func searchGitHubItems(ctx context.Context, login, kind string) ([]GitHubItem, error) {
	query := url.Values{
		"q":        {fmt.Sprintf("author:%s is:open is:%s", login, kind)},
		"sort":     {"updated"},
		"per_page": {"6"},
	}
	var found struct {
		Items []struct {
			Title         string `json:"title"`
			HTMLURL       string `json:"html_url"`
			Number        int    `json:"number"`
			UpdatedAt     string `json:"updated_at"`
			RepositoryURL string `json:"repository_url"`
		} `json:"items"`
	}
	if err := githubGet(ctx, "/search/issues?"+query.Encode(), &found); err != nil {
		return nil, err
	}
	items := []GitHubItem{}
	for _, item := range found.Items {
		link := safeLink(item.HTMLURL)
		if link == "" {
			continue
		}
		repo := strings.TrimPrefix(item.RepositoryURL, "https://api.github.com/repos/")
		items = append(items, GitHubItem{Title: item.Title, URL: link, Repo: repo, Number: item.Number, UpdatedAt: item.UpdatedAt})
	}
	return items, nil
}

func fetchGitHubDashboard(ctx context.Context, login string) (GitHubDashboard, error) {
	escaped := url.PathEscape(login)
	dashboard := GitHubDashboard{Login: login, Repos: []GitHubRepo{}, PullRequests: []GitHubItem{}, Issues: []GitHubItem{}, Events: []GitHubEvent{}}

	var profile struct {
		Name        string `json:"name"`
		PublicRepos int    `json:"public_repos"`
		Followers   int    `json:"followers"`
		Following   int    `json:"following"`
	}
	if err := githubGet(ctx, "/users/"+escaped, &profile); err != nil {
		return dashboard, err
	}
	dashboard.Name = profile.Name
	dashboard.PublicRepos = profile.PublicRepos
	dashboard.Followers = profile.Followers
	dashboard.Following = profile.Following

	var repos []struct {
		FullName    string `json:"full_name"`
		HTMLURL     string `json:"html_url"`
		Description string `json:"description"`
		Language    string `json:"language"`
		Stars       int    `json:"stargazers_count"`
		PushedAt    string `json:"pushed_at"`
	}
	if err := githubGet(ctx, "/users/"+escaped+"/repos?sort=pushed&per_page=6", &repos); err != nil {
		log.Printf("GitHub dashboard: %v", err)
		dashboard.Partial = true
	}
	for _, repo := range repos {
		if link := safeLink(repo.HTMLURL); link != "" {
			dashboard.Repos = append(dashboard.Repos, GitHubRepo{Name: repo.FullName, URL: link, Description: repo.Description, Language: repo.Language, Stars: repo.Stars, PushedAt: repo.PushedAt})
		}
	}

	if items, err := searchGitHubItems(ctx, login, "pr"); err != nil {
		log.Printf("GitHub dashboard: %v", err)
		dashboard.Partial = true
	} else {
		dashboard.PullRequests = items
	}
	if items, err := searchGitHubItems(ctx, login, "issue"); err != nil {
		log.Printf("GitHub dashboard: %v", err)
		dashboard.Partial = true
	} else {
		dashboard.Issues = items
	}

	var events []struct {
		Type string `json:"type"`
		Repo struct {
			Name string `json:"name"`
		} `json:"repo"`
		CreatedAt string `json:"created_at"`
	}
	if err := githubGet(ctx, "/users/"+escaped+"/events/public?per_page=8", &events); err != nil {
		log.Printf("GitHub dashboard: %v", err)
		dashboard.Partial = true
	}
	for _, event := range events {
		dashboard.Events = append(dashboard.Events, GitHubEvent{Type: event.Type, Repo: event.Repo.Name, CreatedAt: event.CreatedAt})
	}
	return dashboard, nil
}

func (a *App) handleDevGitHub(w http.ResponseWriter, r *http.Request, current session) {
	user, err := a.store.getUser(r.Context(), current.userID)
	if err != nil {
		writeServerError(w, err)
		return
	}
	dashboard, fetchedAt, err := a.dev.github.get(strings.ToLower(user.Login), githubDataLife, func() (GitHubDashboard, error) {
		return fetchGitHubDashboard(r.Context(), user.Login)
	})
	if err != nil {
		log.Printf("GitHub dashboard failed: %v", err)
		writeError(w, http.StatusBadGateway, "GitHub data isn't available right now.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": dashboard, "fetchedAt": fetchedAt})
}

// NewsStory is one Hacker News story.
type NewsStory struct {
	Title      string `json:"title"`
	URL        string `json:"url"`
	Discussion string `json:"discussion"`
	Score      int    `json:"score"`
	Comments   int    `json:"comments"`
}

func hackerNewsGet(ctx context.Context, path string, target any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, envOr("HN_API_URL", "https://hacker-news.firebaseio.com")+path, nil)
	if err != nil {
		return err
	}
	response, err := githubClient.Do(request)
	if err != nil {
		return fmt.Errorf("request Hacker News: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("Hacker News returned %d", response.StatusCode)
	}
	return json.NewDecoder(response.Body).Decode(target)
}

func fetchNews(ctx context.Context) ([]NewsStory, error) {
	var ids []int64
	if err := hackerNewsGet(ctx, "/v0/topstories.json", &ids); err != nil {
		return nil, err
	}
	if len(ids) > newsStoryCount {
		ids = ids[:newsStoryCount]
	}

	stories := make([]*NewsStory, len(ids))
	var group sync.WaitGroup
	for index, id := range ids {
		group.Add(1)
		go func() {
			defer group.Done()
			var item struct {
				Title       string `json:"title"`
				URL         string `json:"url"`
				Score       int    `json:"score"`
				Descendants int    `json:"descendants"`
			}
			if err := hackerNewsGet(ctx, "/v0/item/"+strconv.FormatInt(id, 10)+".json", &item); err != nil || item.Title == "" {
				return
			}
			discussion := "https://news.ycombinator.com/item?id=" + strconv.FormatInt(id, 10)
			link := safeLink(item.URL)
			if link == "" {
				link = discussion
			}
			stories[index] = &NewsStory{Title: item.Title, URL: link, Discussion: discussion, Score: item.Score, Comments: item.Descendants}
		}()
	}
	group.Wait()

	result := []NewsStory{}
	for _, story := range stories {
		if story != nil {
			result = append(result, *story)
		}
	}
	if len(result) == 0 {
		return nil, errors.New("Hacker News returned no stories")
	}
	return result, nil
}

func (a *App) handleDevNews(w http.ResponseWriter, r *http.Request, _ session) {
	stories, fetchedAt, err := a.dev.news.get("top", newsLife, func() ([]NewsStory, error) {
		return fetchNews(r.Context())
	})
	if err != nil {
		log.Printf("news failed: %v", err)
		writeError(w, http.StatusBadGateway, "Hacker News isn't available right now.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"stories": stories, "fetchedAt": fetchedAt})
}

// Monitor is an address the user wants to watch.
type Monitor struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// Todo is one item on the user's list.
type Todo struct {
	Text string `json:"text"`
	Done bool   `json:"done"`
}

// Workspace is the user's own notes, todos and monitors.
type Workspace struct {
	Monitors []Monitor `json:"monitors"`
	Todos    []Todo    `json:"todos"`
	Notes    string    `json:"notes"`
}

func cleanWorkspace(input Workspace) (Workspace, bool) {
	cleaned := Workspace{Monitors: []Monitor{}, Todos: []Todo{}, Notes: input.Notes}
	if len(input.Monitors) > maxMonitors || len(input.Todos) > maxTodos || utf8.RuneCountInString(input.Notes) > maxNotesLength {
		return cleaned, false
	}
	for _, monitor := range input.Monitors {
		name, nameOK := cleanName(monitor.Name)
		address, addressOK := cleanURL(monitor.URL)
		if !nameOK || !addressOK {
			return cleaned, false
		}
		cleaned.Monitors = append(cleaned.Monitors, Monitor{Name: name, URL: address})
	}
	for _, todo := range input.Todos {
		text := strings.TrimSpace(todo.Text)
		if text == "" || utf8.RuneCountInString(text) > maxTodoLength {
			return cleaned, false
		}
		cleaned.Todos = append(cleaned.Todos, Todo{Text: text, Done: todo.Done})
	}
	return cleaned, true
}

func (s *Store) getWorkspace(ctx context.Context, userID int64) (Workspace, error) {
	workspace := Workspace{Monitors: []Monitor{}, Todos: []Todo{}}
	var data string
	err := s.db.QueryRowContext(ctx, "SELECT data FROM user_workspaces WHERE user_id = ?", userID).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return workspace, nil
	}
	if err != nil {
		return workspace, err
	}
	err = json.Unmarshal([]byte(data), &workspace)
	return workspace, err
}

func (s *Store) setWorkspace(ctx context.Context, userID int64, workspace Workspace) error {
	data, err := json.Marshal(workspace)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO user_workspaces (user_id, data) VALUES (?, ?)
		 ON DUPLICATE KEY UPDATE data = VALUES(data)`, userID, string(data))
	return err
}

func (a *App) handleGetWorkspace(w http.ResponseWriter, r *http.Request, current session) {
	workspace, err := a.store.getWorkspace(r.Context(), current.userID)
	if err != nil {
		writeServerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, workspace)
}

func (a *App) handlePutWorkspace(w http.ResponseWriter, r *http.Request, current session) {
	const invalid = "Your workspace could not be saved."
	var input Workspace
	if !readJSON(w, r, &input, invalid) {
		return
	}
	workspace, ok := cleanWorkspace(input)
	if !ok {
		writeError(w, http.StatusBadRequest, invalid)
		return
	}
	if err := a.store.setWorkspace(r.Context(), current.userID, workspace); err != nil {
		writeServerError(w, err)
		return
	}
	writeOK(w)
}

var carrierNAT = &net.IPNet{IP: net.IPv4(100, 64, 0, 0), Mask: net.CIDRMask(10, 32)}

// isBlockedAddress is true for anything that isn't on the public internet, such as this server's
// own services, its private networks and cloud metadata addresses.
func isBlockedAddress(ip net.IP) bool {
	return !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() || carrierNAT.Contains(ip)
}

// newMonitorClient makes the server's outside checks safe to run on user-supplied addresses. The
// check happens on the resolved IP at connection time, including after redirects, so a domain that
// points at a private address is refused too. Only the normal web ports can be reached.
func newMonitorClient() *http.Client {
	dialer := &net.Dialer{
		Timeout: monitorTimeout,
		Control: func(_, address string, _ syscall.RawConn) error {
			if os.Getenv("MONITOR_ALLOW_PRIVATE") == "true" {
				return nil
			}
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			ip := net.ParseIP(host)
			if ip == nil || isBlockedAddress(ip) {
				return errBlockedAddress
			}
			if port != "80" && port != "443" {
				return errBlockedAddress
			}
			return nil
		},
	}
	return &http.Client{
		Timeout: monitorTimeout,
		Transport: &http.Transport{
			Proxy:                 nil,
			DialContext:           dialer.DialContext,
			TLSHandshakeTimeout:   monitorTimeout,
			ResponseHeaderTimeout: monitorTimeout,
			DisableKeepAlives:     true,
		},
		CheckRedirect: func(_ *http.Request, previous []*http.Request) error {
			if len(previous) >= monitorMaxRedirect {
				return http.ErrUseLastResponse
			}
			return nil
		},
	}
}

var errBlockedAddress = errors.New("private or non-web address")

// MonitorResult is one check of a monitored address.
type MonitorResult struct {
	Name      string `json:"name"`
	URL       string `json:"url"`
	Up        bool   `json:"up"`
	Status    int    `json:"status"`
	Ms        int64  `json:"ms"`
	Problem   string `json:"problem,omitempty"`
	CheckedAt string `json:"checkedAt"`
}

func (d *DevServices) check(ctx context.Context, address string) MonitorResult {
	result := MonitorResult{URL: address, CheckedAt: time.Now().UTC().Format(time.RFC3339)}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		result.Problem = "That address isn't valid."
		return result
	}
	request.Header.Set("User-Agent", "home-base-monitor")

	started := time.Now()
	response, err := d.client.Do(request)
	result.Ms = time.Since(started).Milliseconds()
	if err != nil {
		switch {
		case errors.Is(err, errBlockedAddress):
			result.Problem = "Private addresses and non-web ports can't be monitored."
		case errors.Is(err, context.DeadlineExceeded) || os.IsTimeout(err):
			result.Problem = "Timed out."
		default:
			result.Problem = "Couldn't connect."
		}
		return result
	}
	defer response.Body.Close()
	result.Status = response.StatusCode
	result.Up = response.StatusCode < 400
	if !result.Up {
		result.Problem = "Returned HTTP " + strconv.Itoa(response.StatusCode) + "."
	}
	return result
}

func (a *App) handleDevMonitors(w http.ResponseWriter, r *http.Request, current session) {
	workspace, err := a.store.getWorkspace(r.Context(), current.userID)
	if err != nil {
		writeServerError(w, err)
		return
	}

	results := make([]MonitorResult, len(workspace.Monitors))
	var group sync.WaitGroup
	for index, monitor := range workspace.Monitors {
		group.Add(1)
		go func() {
			defer group.Done()
			// Results are shared by address for a minute, so frequent new tabs can't flood anyone's site.
			result, _, _ := a.dev.monitors.get(monitor.URL, monitorResultLife, func() (MonitorResult, error) {
				return a.dev.check(context.WithoutCancel(r.Context()), monitor.URL), nil
			})
			result.Name = monitor.Name
			results[index] = result
		}()
	}
	group.Wait()
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}
