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
	"sort"
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

const maxOpenItems = 6

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

// forget removes a key, so the next request fetches again.
func (c *cached[T]) forget(key string) {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	delete(c.entries, key)
}

// forgetOlderThan lets a manual refresh fetch again, without letting rapid clicks overload GitHub.
func (c *cached[T]) forgetOlderThan(key string, age time.Duration) {
	c.mutex.Lock()
	entry, found := c.entries[key]
	c.mutex.Unlock()
	if !found {
		return
	}
	entry.mutex.Lock()
	defer entry.mutex.Unlock()
	if time.Since(entry.fetchedAt) >= age {
		entry.fetchedAt = time.Time{}
	}
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
	github        *cached[GitHubDashboard]
	private       *cached[GitHubDashboard]
	connectStates *expiring[connectState]
	tokenLocks    *userLocks
	news          *cached[[]NewsStory]
	monitors      *cached[MonitorResult]
	client        *http.Client
	dialer        *net.Dialer
	projectCI     *cached[*GitHubRun]
	workLogs      *cached[WorkLog]
}

func newDevServices() *DevServices {
	dialer := newMonitorDialer()
	return &DevServices{
		dialer:        dialer,
		projectCI:     newCached[*GitHubRun](),
		workLogs:      newCached[WorkLog](),
		github:        newCached[GitHubDashboard](),
		private:       newCached[GitHubDashboard](),
		connectStates: newExpiring[connectState](),
		tokenLocks:    &userLocks{locks: map[int64]*sync.Mutex{}},
		news:          newCached[[]NewsStory](),
		monitors:      newCached[MonitorResult](),
		client:        newMonitorClient(dialer),
	}
}

func (a *App) registerDevRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/dev/github", a.signedIn(a.handleDevGitHub))
	mux.HandleFunc("POST /api/dev/github/connect", a.signedIn(a.handleGitHubConnectStart))
	mux.HandleFunc("DELETE /api/dev/github/connection", a.signedIn(a.handleGitHubDisconnect))
	mux.HandleFunc("GET /auth/github-app/callback", noStore(a.handleGitHubConnectCallback))
	mux.HandleFunc("GET /api/dev/news", a.signedIn(a.handleDevNews))
	mux.HandleFunc("GET /api/dev/workspace", a.signedIn(a.handleGetWorkspace))
	mux.HandleFunc("PUT /api/dev/workspace", a.signedIn(a.handlePutWorkspace))
	mux.HandleFunc("GET /api/dev/monitors", a.signedIn(a.handleDevMonitors))
	a.registerProjectRoutes(mux)

	mux.HandleFunc("GET /api/admin/servers", a.adminOnly(a.handleAdminServers))
	mux.HandleFunc("POST /api/admin/servers", a.adminOnly(a.handleAdminAddServer))
	mux.HandleFunc("DELETE /api/admin/servers/{id}", a.adminOnly(a.handleAdminDeleteServer))
	mux.HandleFunc("POST /api/server-report", noStore(a.handleServerReport))

	mux.HandleFunc("GET /api/sessions", a.signedIn(a.handleListSessions))
	mux.HandleFunc("DELETE /api/sessions/{id}", a.signedIn(a.handleDeleteSession))
	mux.HandleFunc("POST /api/sessions/sign-out-others", a.signedIn(a.handleSignOutOthers))
	mux.HandleFunc("DELETE /api/account", a.signedIn(a.handleDeleteAccount))
}

// GitHubRepo is one of the user's recently updated public repositories.
type GitHubRepo struct {
	Private     bool   `json:"private"`
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

// GitHubRun is the latest CI run of a repository.
type GitHubRun struct {
	ID         int64  `json:"id"`
	Repo       string `json:"repo"`
	Workflow   string `json:"workflow"`
	Branch     string `json:"branch"`
	Status     string `json:"status"`
	Conclusion string `json:"conclusion"`
	URL        string `json:"url"`
	UpdatedAt  string `json:"updatedAt"`
}

// latestRuns reads each repository's newest workflow run. It returns true if any repository
// refused, which for a connected user usually means the app is missing the Actions permission.
func latestRuns(ctx context.Context, token string, repos []GitHubRepo) ([]GitHubRun, bool) {
	var (
		mutex  sync.Mutex
		group  sync.WaitGroup
		runs   = []GitHubRun{}
		failed bool
	)
	for _, repo := range repos {
		group.Add(1)
		go func() {
			defer group.Done()
			owner, name, ok := strings.Cut(repo.Name, "/")
			if !ok {
				return
			}
			var found struct {
				WorkflowRuns []struct {
					ID         int64  `json:"id"`
					Name       string `json:"name"`
					HeadBranch string `json:"head_branch"`
					Status     string `json:"status"`
					Conclusion string `json:"conclusion"`
					HTMLURL    string `json:"html_url"`
					UpdatedAt  string `json:"updated_at"`
				} `json:"workflow_runs"`
			}
			err := githubGetAs(ctx, token, "/repos/"+url.PathEscape(owner)+"/"+url.PathEscape(name)+"/actions/runs?per_page=1", &found)
			mutex.Lock()
			defer mutex.Unlock()
			if err != nil {
				failed = true
				return
			}
			if len(found.WorkflowRuns) == 0 {
				return
			}
			run := found.WorkflowRuns[0]
			if link := safeLink(run.HTMLURL); link != "" {
				runs = append(runs, GitHubRun{ID: run.ID, Repo: repo.Name, Workflow: run.Name, Branch: run.HeadBranch, Status: run.Status, Conclusion: run.Conclusion, URL: link, UpdatedAt: run.UpdatedAt})
			}
		}()
	}
	group.Wait()
	sort.Slice(runs, func(left, right int) bool { return runs[left].UpdatedAt > runs[right].UpdatedAt })
	return runs, failed
}

// GitHubEvent is one entry in the user's public activity.
type GitHubEvent struct {
	Type      string `json:"type"`
	Repo      string `json:"repo"`
	CreatedAt string `json:"createdAt"`
}

// GitHubDashboard is what the GitHub panel shows. Partial is true if some sections couldn't be loaded.
type GitHubDashboard struct {
	Login             string        `json:"login"`
	Name              string        `json:"name"`
	PublicRepos       int           `json:"publicRepos"`
	Followers         int           `json:"followers"`
	Following         int           `json:"following"`
	Repos             []GitHubRepo  `json:"repos"`
	PullRequests      []GitHubItem  `json:"pullRequests"`
	Issues            []GitHubItem  `json:"issues"`
	Events            []GitHubEvent `json:"events"`
	Partial           bool          `json:"partial"`
	ReviewRequests    []GitHubItem  `json:"reviewRequests"`
	CI                []GitHubRun   `json:"ci"`
	CINeedsPermission bool          `json:"ciNeedsPermission"`
	FromRecentRepos   bool          `json:"fromRecentRepos"`
}

// githubGetAs reads as the given user if a token is provided. Otherwise it reads public data, using
// the sign-in app's credentials only for GitHub's higher rate limit.
func githubGetAs(ctx context.Context, token, path string, target any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, envOr("GITHUB_API_URL", "https://api.github.com")+path, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "home-base")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	} else if githubConfigured() {
		request.SetBasicAuth(os.Getenv("GITHUB_CLIENT_ID"), os.Getenv("GITHUB_CLIENT_SECRET"))
	}
	response, err := githubClient.Do(request)
	if err != nil {
		return fmt.Errorf("request GitHub %s: %w", strings.SplitN(path, "?", 2)[0], err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusUnauthorized && token != "" {
		return errGitHubUnauthorized
	}
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

func searchGitHubItems(ctx context.Context, token, search string) ([]GitHubItem, error) {
	query := url.Values{
		"q":        {search},
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
	if err := githubGetAs(ctx, token, "/search/issues?"+query.Encode(), &found); err != nil {
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

// openItemsFromRepos lists the user's own open pull requests and issues in the given repositories.
// It returns false if any repository couldn't be read.
func openItemsFromRepos(ctx context.Context, token, login string, repos []GitHubRepo) ([]GitHubItem, []GitHubItem, bool) {
	type repoItem struct {
		GitHubItem
		isPullRequest bool
	}
	var (
		mutex    sync.Mutex
		group    sync.WaitGroup
		found    []repoItem
		complete = true
	)
	query := url.Values{"state": {"open"}, "creator": {login}, "sort": {"updated"}, "per_page": {"6"}}.Encode()
	for _, repo := range repos {
		group.Add(1)
		go func() {
			defer group.Done()
			owner, name, ok := strings.Cut(repo.Name, "/")
			if !ok {
				return
			}
			var items []struct {
				Title       string          `json:"title"`
				HTMLURL     string          `json:"html_url"`
				Number      int             `json:"number"`
				UpdatedAt   string          `json:"updated_at"`
				PullRequest json.RawMessage `json:"pull_request"`
			}
			err := githubGetAs(ctx, token, "/repos/"+url.PathEscape(owner)+"/"+url.PathEscape(name)+"/issues?"+query, &items)
			mutex.Lock()
			defer mutex.Unlock()
			if err != nil {
				log.Printf("GitHub dashboard: %v", err)
				complete = false
				return
			}
			for _, item := range items {
				if link := safeLink(item.HTMLURL); link != "" {
					found = append(found, repoItem{
						GitHubItem:    GitHubItem{Title: item.Title, URL: link, Repo: repo.Name, Number: item.Number, UpdatedAt: item.UpdatedAt},
						isPullRequest: item.PullRequest != nil,
					})
				}
			}
		}()
	}
	group.Wait()

	sort.Slice(found, func(left, right int) bool { return found[left].UpdatedAt > found[right].UpdatedAt })
	pullRequests, issues := []GitHubItem{}, []GitHubItem{}
	for _, item := range found {
		if item.isPullRequest && len(pullRequests) < maxOpenItems {
			pullRequests = append(pullRequests, item.GitHubItem)
		} else if !item.isPullRequest && len(issues) < maxOpenItems {
			issues = append(issues, item.GitHubItem)
		}
	}
	return pullRequests, issues, complete
}

// fetchGitHubDashboard reads as the user when a token is provided, which includes the private
// repositories they've installed the app on. Without one, it reads public data only.
func fetchGitHubDashboard(ctx context.Context, login, token string) (GitHubDashboard, error) {
	escaped := url.PathEscape(login)
	dashboard := GitHubDashboard{Login: login, Repos: []GitHubRepo{}, PullRequests: []GitHubItem{}, Issues: []GitHubItem{}, ReviewRequests: []GitHubItem{}, CI: []GitHubRun{}, Events: []GitHubEvent{}}

	var profile struct {
		Name        string `json:"name"`
		PublicRepos int    `json:"public_repos"`
		Followers   int    `json:"followers"`
		Following   int    `json:"following"`
	}
	if err := githubGetAs(ctx, token, "/users/"+escaped, &profile); err != nil {
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
		Private     bool   `json:"private"`
	}
	reposPath := "/users/" + escaped + "/repos?sort=pushed&per_page=6"
	if token != "" {
		reposPath = "/user/repos?sort=pushed&per_page=8"
	}
	if err := githubGetAs(ctx, token, reposPath, &repos); err != nil {
		if errors.Is(err, errGitHubUnauthorized) {
			return dashboard, err
		}
		log.Printf("GitHub dashboard: %v", err)
		dashboard.Partial = true
	}
	for _, repo := range repos {
		if link := safeLink(repo.HTMLURL); link != "" {
			dashboard.Repos = append(dashboard.Repos, GitHubRepo{Private: repo.Private, Name: repo.FullName, URL: link, Description: repo.Description, Language: repo.Language, Stars: repo.Stars, PushedAt: repo.PushedAt})
		}
	}

	pullRequests, pullRequestsErr := searchGitHubItems(ctx, token, fmt.Sprintf("author:%s is:open is:pr", login))
	issues, issuesErr := searchGitHubItems(ctx, token, fmt.Sprintf("author:%s is:open is:issue", login))
	if token != "" {
		if requests, err := searchGitHubItems(ctx, token, fmt.Sprintf("review-requested:%s is:open is:pr", login)); err != nil {
			log.Printf("GitHub dashboard: %v", err)
			dashboard.Partial = true
		} else {
			dashboard.ReviewRequests = requests
		}
	}
	if pullRequestsErr == nil && issuesErr == nil {
		dashboard.PullRequests = pullRequests
		dashboard.Issues = issues
	} else {
		// GitHub refuses to search some accounts without a user token, so read recent repositories instead.
		log.Printf("GitHub dashboard: search unavailable, reading recent repositories: %v", errors.Join(pullRequestsErr, issuesErr))
		dashboard.FromRecentRepos = true
		var complete bool
		dashboard.PullRequests, dashboard.Issues, complete = openItemsFromRepos(ctx, token, login, dashboard.Repos)
		if !complete {
			dashboard.Partial = true
		}
	}

	var events []struct {
		Type string `json:"type"`
		Repo struct {
			Name string `json:"name"`
		} `json:"repo"`
		CreatedAt string `json:"created_at"`
	}
	var ciFailed bool
	dashboard.CI, ciFailed = latestRuns(ctx, token, dashboard.Repos)
	dashboard.CINeedsPermission = ciFailed && token != "" && len(dashboard.CI) == 0

	eventsPath := "/users/" + escaped + "/events/public?per_page=8"
	if token != "" {
		eventsPath = "/users/" + escaped + "/events?per_page=8"
	}
	if err := githubGetAs(ctx, token, eventsPath, &events); err != nil {
		log.Printf("GitHub dashboard: %v", err)
		dashboard.Partial = true
	}
	for _, event := range events {
		dashboard.Events = append(dashboard.Events, GitHubEvent{Type: event.Type, Repo: event.Repo.Name, CreatedAt: event.CreatedAt})
	}
	return dashboard, nil
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
	Projects []Project      `json:"projects"`
	Commands []SavedCommand `json:"commands"`
	Version  int            `json:"version"`
	Monitors []Monitor      `json:"monitors"`
	Todos    []Todo         `json:"todos"`
	Notes    string         `json:"notes"`
}

func cleanWorkspace(input Workspace) (Workspace, bool) {
	cleaned := Workspace{Version: input.Version, Monitors: []Monitor{}, Todos: []Todo{}, Projects: []Project{}, Commands: []SavedCommand{}, Notes: input.Notes}
	projects, projectsOK := cleanProjects(input.Projects)
	commands, commandsOK := cleanCommands(input.Commands)
	if !projectsOK || !commandsOK {
		return cleaned, false
	}
	cleaned.Projects = projects
	cleaned.Commands = commands
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
	workspace := Workspace{Monitors: []Monitor{}, Todos: []Todo{}, Projects: []Project{}, Commands: []SavedCommand{}}
	var data string
	var version int
	err := s.db.QueryRowContext(ctx, "SELECT data, version FROM user_workspaces WHERE user_id = ?", userID).Scan(&data, &version)
	if errors.Is(err, sql.ErrNoRows) {
		return workspace, nil
	}
	if err != nil {
		return workspace, err
	}
	err = json.Unmarshal([]byte(data), &workspace)
	workspace.Version = version
	if workspace.Projects == nil {
		workspace.Projects = []Project{}
	}
	if workspace.Commands == nil {
		workspace.Commands = []SavedCommand{}
	}
	return workspace, err
}

// setWorkspace only saves if the client edited the latest version. It returns false if another
// device saved first, so the client can merge instead of overwriting those changes.
func (s *Store) setWorkspace(ctx context.Context, userID int64, workspace Workspace) (int, bool, error) {
	data, err := json.Marshal(workspace)
	if err != nil {
		return 0, false, err
	}
	next := workspace.Version + 1
	saved := false
	err = s.inTransaction(ctx, func(tx *sql.Tx) error {
		var current int
		err := tx.QueryRowContext(ctx, "SELECT version FROM user_workspaces WHERE user_id = ? FOR UPDATE", userID).Scan(&current)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if current != workspace.Version {
			return nil
		}
		saved = true
		_, err = tx.ExecContext(ctx,
			`INSERT INTO user_workspaces (user_id, data, version) VALUES (?, ?, ?)
			 ON DUPLICATE KEY UPDATE data = VALUES(data), version = VALUES(version)`, userID, string(data), next)
		return err
	})
	return next, saved, err
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
	// An older copy of the page doesn't know about these lists, and mustn't wipe them when it saves.
	if input.Projects == nil || input.Commands == nil {
		existing, err := a.store.getWorkspace(r.Context(), current.userID)
		if err != nil {
			writeServerError(w, err)
			return
		}
		if input.Projects == nil {
			input.Projects = existing.Projects
		}
		if input.Commands == nil {
			input.Commands = existing.Commands
		}
	}
	workspace, ok := cleanWorkspace(input)
	if !ok {
		writeError(w, http.StatusBadRequest, invalid)
		return
	}
	version, saved, err := a.store.setWorkspace(r.Context(), current.userID, workspace)
	if err != nil {
		writeServerError(w, err)
		return
	}
	if !saved {
		writeError(w, http.StatusConflict, "Your workspace changed on another device.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"version": version})
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
func newMonitorDialer() *net.Dialer {
	return &net.Dialer{
		Timeout: monitorTimeout,
		Control: func(_, address string, _ syscall.RawConn) error {
			if dialerAllowsPrivate() {
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
}

func newMonitorClient(dialer *net.Dialer) *http.Client {
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
	Name      string          `json:"name"`
	URL       string          `json:"url"`
	Up        bool            `json:"up"`
	Status    int             `json:"status"`
	Ms        int64           `json:"ms"`
	Problem   string          `json:"problem,omitempty"`
	CheckedAt string          `json:"checkedAt"`
	History   *MonitorHistory `json:"history,omitempty"`
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
			if history, err := a.store.monitorHistory(context.WithoutCancel(r.Context()), monitor.URL); err == nil {
				result.History = &history
			} else {
				log.Printf("reading monitor history failed: %v", err)
			}
			results[index] = result
		}()
	}
	group.Wait()
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}
