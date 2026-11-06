package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"golang.org/x/net/publicsuffix"
)

const (
	maxProjects      = 50
	maxCommands      = 200
	maxCommandLength = 2000
	maxSSHLength     = 200
	maxProjectNotes  = 2000
	maxTimeNote      = 200
	expiryCheckAge   = 12 * time.Hour
	maxExpiryChecks  = 10
	maxWorkLogRepos  = 10
	expiryTimeout    = 8 * time.Second
	projectCILife    = 5 * time.Minute
	workLogLife      = 15 * time.Minute
	reportCommits    = 50
	historyDays      = 400
)

var (
	itemID       = regexp.MustCompile(`^[A-Za-z0-9-]{1,40}$`)
	repoName     = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)
	workflowFile = regexp.MustCompile(`^[A-Za-z0-9_.-]+\.ya?ml$`)
	gitRef       = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$`)
	monthFormat  = regexp.MustCompile(`^\d{4}-(0[1-9]|1[0-2])$`)
)

// Project is one client site or product the user looks after.
type Project struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	URL     string `json:"url"`
	Staging string `json:"staging"`
	Repo    string `json:"repo"`
	SSH     string `json:"ssh"`
	Notes   string `json:"notes"`
	// DeployWorkflow is the file name of a workflow with a workflow_dispatch trigger.
	DeployWorkflow string `json:"deployWorkflow"`
	DeployRef      string `json:"deployRef"`
}

// SavedCommand is one entry in the command library.
type SavedCommand struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Command string `json:"command"`
}

func cleanProjects(input []Project) ([]Project, bool) {
	if len(input) > maxProjects {
		return nil, false
	}
	projects := []Project{}
	for _, project := range input {
		name, nameOK := cleanName(project.Name)
		address, addressOK := cleanURL(project.URL)
		if !itemID.MatchString(project.ID) || !nameOK || !addressOK {
			return nil, false
		}
		staging := ""
		if project.Staging != "" {
			var ok bool
			if staging, ok = cleanURL(project.Staging); !ok {
				return nil, false
			}
		}
		if project.Repo != "" && !repoName.MatchString(project.Repo) {
			return nil, false
		}
		if utf8.RuneCountInString(project.SSH) > maxSSHLength || utf8.RuneCountInString(project.Notes) > maxProjectNotes {
			return nil, false
		}
		if project.DeployWorkflow != "" && (project.Repo == "" || !workflowFile.MatchString(project.DeployWorkflow)) {
			return nil, false
		}
		if project.DeployRef != "" && (!gitRef.MatchString(project.DeployRef) || strings.Contains(project.DeployRef, "..")) {
			return nil, false
		}
		projects = append(projects, Project{ID: project.ID, Name: name, URL: address, Staging: staging, Repo: project.Repo, SSH: strings.TrimSpace(project.SSH), Notes: project.Notes, DeployWorkflow: project.DeployWorkflow, DeployRef: project.DeployRef})
	}
	return projects, true
}

func cleanCommands(input []SavedCommand) ([]SavedCommand, bool) {
	if len(input) > maxCommands {
		return nil, false
	}
	commands := []SavedCommand{}
	for _, command := range input {
		name, nameOK := cleanName(command.Name)
		text := strings.TrimSpace(command.Command)
		if !itemID.MatchString(command.ID) || !nameOK || text == "" || utf8.RuneCountInString(text) > maxCommandLength {
			return nil, false
		}
		commands = append(commands, SavedCommand{ID: command.ID, Name: name, Command: text})
	}
	return commands, true
}

// parseRDAPExpiry reads a domain's expiry date from a registry's RDAP response.
func parseRDAPExpiry(body []byte) (time.Time, bool) {
	var response struct {
		Events []struct {
			Action string `json:"eventAction"`
			Date   string `json:"eventDate"`
		} `json:"events"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return time.Time{}, false
	}
	for _, event := range response.Events {
		if event.Action == "expiration" {
			if date, err := time.Parse(time.RFC3339, event.Date); err == nil {
				return date.UTC(), true
			}
		}
	}
	return time.Time{}, false
}

func domainExpiry(ctx context.Context, host string) sql.NullTime {
	domain, err := publicsuffix.EffectiveTLDPlusOne(host)
	if err != nil {
		return sql.NullTime{}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, envOr("RDAP_URL", "https://rdap.org")+"/domain/"+url.PathEscape(domain), nil)
	if err != nil {
		return sql.NullTime{}
	}
	request.Header.Set("Accept", "application/rdap+json")
	request.Header.Set("User-Agent", "home-base")
	response, err := githubClient.Do(request)
	if err != nil {
		return sql.NullTime{}
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return sql.NullTime{}
	}
	var body bytes.Buffer
	if _, err := body.ReadFrom(http.MaxBytesReader(nil, response.Body, 1024*1024)); err != nil {
		return sql.NullTime{}
	}
	if date, ok := parseRDAPExpiry(body.Bytes()); ok {
		return sql.NullTime{Time: date, Valid: true}
	}
	return sql.NullTime{}
}

// certificateExpiry reads the expiry date of the certificate a host presents. Verification is off
// because an expired or wrong certificate is exactly what this needs to see. Nothing is sent over
// the connection, and it goes through the same dialer rules as monitors.
func (d *DevServices) certificateExpiry(ctx context.Context, host, port string) sql.NullTime {
	dialContext, cancel := context.WithTimeout(ctx, expiryTimeout)
	defer cancel()
	connection, err := d.dialer.DialContext(dialContext, "tcp", net.JoinHostPort(host, port))
	if err != nil {
		return sql.NullTime{}
	}
	defer connection.Close()
	client := tls.Client(connection, &tls.Config{ServerName: host, InsecureSkipVerify: true}) //nolint:gosec // Only reads the expiry date.
	if err := client.HandshakeContext(dialContext); err != nil {
		return sql.NullTime{}
	}
	certificates := client.ConnectionState().PeerCertificates
	if len(certificates) == 0 {
		return sql.NullTime{}
	}
	return sql.NullTime{Time: certificates[0].NotAfter.UTC(), Valid: true}
}

// refreshExpiry updates the SSL and domain dates for any host that hasn't been checked recently.
func (a *App) refreshExpiry(ctx context.Context, addresses []string) {
	seen := map[string]bool{}
	checks := 0
	for _, address := range addresses {
		// A few per round, so slow sites and registries never hold up the status checks.
		if checks >= maxExpiryChecks {
			return
		}
		parsed, err := url.Parse(address)
		if err != nil || parsed.Hostname() == "" || seen[parsed.Hostname()] {
			continue
		}
		host := parsed.Hostname()
		seen[host] = true

		var checked sql.NullTime
		err = a.store.db.QueryRowContext(ctx, "SELECT checked_at FROM site_expiry WHERE host = ?", host).Scan(&checked)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if checked.Valid && time.Since(checked.Time) < expiryCheckAge {
			continue
		}

		checks++
		certificate := sql.NullTime{}
		if parsed.Scheme == "https" {
			port := parsed.Port()
			if port == "" {
				port = "443"
			}
			certificate = a.dev.certificateExpiry(ctx, host, port)
		}
		domain := domainExpiry(ctx, host)
		if _, err := a.store.db.ExecContext(ctx,
			`INSERT INTO site_expiry (host, certificate_expires, domain_expires, checked_at) VALUES (?, ?, ?, UTC_TIMESTAMP())
			 ON DUPLICATE KEY UPDATE certificate_expires = COALESCE(VALUES(certificate_expires), certificate_expires), domain_expires = COALESCE(VALUES(domain_expires), domain_expires), checked_at = VALUES(checked_at)`,
			host, nullTime(certificate), nullTime(domain)); err != nil && ctx.Err() == nil {
			log.Printf("saving expiry dates failed: %v", err)
		}
	}
}

// saveDailyRollup keeps long-term uptime and an incident log for reports, after raw checks are removed.
func (s *Store) saveDailyRollup(ctx context.Context, address string, result MonitorResult) error {
	key := monitorKey(address)
	upCount := 0
	if result.Up {
		upCount = 1
	}
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO monitor_daily (url_hash, day, checks, up_checks, total_ms) VALUES (?, UTC_DATE(), 1, ?, ?)
		 ON DUPLICATE KEY UPDATE checks = checks + 1, up_checks = up_checks + VALUES(up_checks), total_ms = total_ms + VALUES(total_ms)`,
		key, upCount, result.Ms); err != nil {
		return err
	}

	if result.Up {
		_, err := s.db.ExecContext(ctx, "UPDATE monitor_incidents SET ended_at = UTC_TIMESTAMP() WHERE url_hash = ? AND ended_at IS NULL", key)
		return err
	}
	var open int
	err := s.db.QueryRowContext(ctx, "SELECT 1 FROM monitor_incidents WHERE url_hash = ? AND ended_at IS NULL LIMIT 1", key).Scan(&open)
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	// One failed check is often a blip, and incidents end up in client reports. An incident needs two
	// failures in a row, and starts from the first of them. This check is already saved, so the one
	// before it is the second row.
	var previousUp bool
	var previousAt time.Time
	err = s.db.QueryRowContext(ctx,
		"SELECT up, checked_at FROM monitor_checks WHERE url_hash = ? ORDER BY checked_at DESC, id DESC LIMIT 1 OFFSET 1", key).Scan(&previousUp, &previousAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if previousUp {
		return nil
	}
	_, err = s.db.ExecContext(ctx, "INSERT INTO monitor_incidents (url_hash, started_at, problem) VALUES (?, ?, ?)", key, previousAt, result.Problem)
	return err
}

func (s *Store) deleteOldHistory(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, "DELETE FROM monitor_daily WHERE day < UTC_DATE() - INTERVAL ? DAY", historyDays); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, "DELETE FROM monitor_incidents WHERE started_at < UTC_TIMESTAMP() - INTERVAL ? DAY", historyDays)
	return err
}

// ProjectStatus is a project plus everything known about its health.
type ProjectStatus struct {
	Project
	Monitor            MonitorResult `json:"monitor"`
	CertificateExpires *time.Time    `json:"certificateExpires"`
	DomainExpires      *time.Time    `json:"domainExpires"`
	CI                 *GitHubRun    `json:"ci"`
	// CIUnreadable means GitHub wouldn't say. A repository with no runs has no CI and isn't unreadable.
	CIUnreadable bool `json:"ciUnreadable"`
}

// projectCIResult keeps "couldn't read it" apart from "there's nothing to read".
type projectCIResult struct {
	Run        *GitHubRun
	Unreadable bool
}

func (a *App) projectRun(ctx context.Context, userID int64, token string, project Project) projectCIResult {
	key := strconv.FormatInt(userID, 10) + ":" + project.Repo
	result, _, err := a.dev.projectCI.get(key, projectCILife, func() (projectCIResult, error) {
		run, err := repoRun(ctx, token, GitHubRepo{Name: project.Repo, watchBranch: project.DeployRef})
		if err != nil {
			// A closed tab cancels the request, which says nothing about the repository.
			if ctx.Err() != nil {
				return projectCIResult{}, ctx.Err()
			}
			return projectCIResult{Unreadable: true}, nil
		}
		return projectCIResult{Run: run}, nil
	})
	if err != nil {
		return projectCIResult{Unreadable: true}
	}
	return result
}

func (a *App) handleProjects(w http.ResponseWriter, r *http.Request, current session) {
	ctx := r.Context()
	workspace, err := a.store.getWorkspace(ctx, current.userID)
	if err != nil {
		writeServerError(w, err)
		return
	}
	token, _ := a.validAccessToken(ctx, current.userID)

	results := make([]ProjectStatus, len(workspace.Projects))
	var group sync.WaitGroup
	for index, project := range workspace.Projects {
		group.Add(1)
		go func() {
			defer group.Done()
			status := ProjectStatus{Project: project}
			status.Monitor, _, _ = a.dev.monitors.get(project.URL, monitorResultLife, func() (MonitorResult, error) {
				return a.dev.check(context.WithoutCancel(ctx), project.URL), nil
			})
			status.Monitor.Name = project.Name
			if history, err := a.store.monitorHistory(ctx, project.URL); err == nil {
				status.Monitor.History = &history
				status.Monitor.markUnconfirmed()
			}
			if parsed, err := url.Parse(project.URL); err == nil {
				var certificate, domain sql.NullTime
				err := a.store.db.QueryRowContext(ctx, "SELECT certificate_expires, domain_expires FROM site_expiry WHERE host = ?", parsed.Hostname()).Scan(&certificate, &domain)
				if err == nil {
					if certificate.Valid {
						status.CertificateExpires = &certificate.Time
					}
					if domain.Valid {
						status.DomainExpires = &domain.Time
					}
				}
			}
			if project.Repo != "" {
				ci := a.projectRun(ctx, current.userID, token, project)
				status.CI = ci.Run
				status.CIUnreadable = ci.Unreadable
			}
			results[index] = status
		}()
	}
	group.Wait()
	writeJSON(w, http.StatusOK, map[string]any{"projects": results})
}

// TimeEntry is one tracked period of work.
type TimeEntry struct {
	ID        int64      `json:"id"`
	ProjectID string     `json:"projectId"`
	Note      string     `json:"note"`
	StartedAt time.Time  `json:"startedAt"`
	EndedAt   *time.Time `json:"endedAt"`
}

func (s *Store) timeEntries(ctx context.Context, userID int64, from, to time.Time) ([]TimeEntry, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, project_id, note, started_at, ended_at FROM time_entries
		 WHERE user_id = ? AND started_at < ? AND COALESCE(ended_at, UTC_TIMESTAMP()) >= ? ORDER BY started_at DESC LIMIT 2000`,
		userID, to.UTC(), from.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := []TimeEntry{}
	for rows.Next() {
		var entry TimeEntry
		var ended sql.NullTime
		if err := rows.Scan(&entry.ID, &entry.ProjectID, &entry.Note, &entry.StartedAt, &ended); err != nil {
			return nil, err
		}
		if ended.Valid {
			entry.EndedAt = &ended.Time
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func parseTimeRange(r *http.Request) (time.Time, time.Time, bool) {
	from, fromErr := time.Parse(time.RFC3339, r.URL.Query().Get("from"))
	to, toErr := time.Parse(time.RFC3339, r.URL.Query().Get("to"))
	if fromErr != nil || toErr != nil || !to.After(from) || to.Sub(from) > 400*24*time.Hour {
		return time.Time{}, time.Time{}, false
	}
	return from, to, true
}

func (a *App) handleListTime(w http.ResponseWriter, r *http.Request, current session) {
	from, to, ok := parseTimeRange(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "That date range isn't valid.")
		return
	}
	entries, err := a.store.timeEntries(r.Context(), current.userID, from, to)
	if err != nil {
		writeServerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
}

// handleStartTime stops any running timer first, so only one can ever run.
func (a *App) handleStartTime(w http.ResponseWriter, r *http.Request, current session) {
	var body struct {
		ProjectID string `json:"projectId"`
		Note      string `json:"note"`
	}
	const invalid = "That timer couldn't be started."
	if !readJSON(w, r, &body, invalid) {
		return
	}
	note := strings.TrimSpace(body.Note)
	if !itemID.MatchString(body.ProjectID) || utf8.RuneCountInString(note) > maxTimeNote {
		writeError(w, http.StatusBadRequest, invalid)
		return
	}
	ctx := r.Context()
	if _, err := a.store.db.ExecContext(ctx, "UPDATE time_entries SET ended_at = UTC_TIMESTAMP() WHERE user_id = ? AND ended_at IS NULL", current.userID); err != nil {
		writeServerError(w, err)
		return
	}
	if _, err := a.store.db.ExecContext(ctx, "INSERT INTO time_entries (user_id, project_id, note, started_at) VALUES (?, ?, ?, UTC_TIMESTAMP())", current.userID, body.ProjectID, note); err != nil {
		writeServerError(w, err)
		return
	}
	writeOK(w)
}

func (a *App) handleStopTime(w http.ResponseWriter, r *http.Request, current session) {
	if _, err := a.store.db.ExecContext(r.Context(), "UPDATE time_entries SET ended_at = UTC_TIMESTAMP() WHERE user_id = ? AND ended_at IS NULL", current.userID); err != nil {
		writeServerError(w, err)
		return
	}
	writeOK(w)
}

func (a *App) handleDeleteTime(w http.ResponseWriter, r *http.Request, current session) {
	id, ok := targetUserID(w, r)
	if !ok {
		return
	}
	result, err := a.store.db.ExecContext(r.Context(), "DELETE FROM time_entries WHERE id = ? AND user_id = ?", id, current.userID)
	if err != nil {
		writeServerError(w, err)
		return
	}
	if count, err := result.RowsAffected(); err == nil && count == 0 {
		writeError(w, http.StatusNotFound, "That entry no longer exists.")
		return
	}
	writeOK(w)
}

// WorkLog summarises what a user did in a period.
type WorkLog struct {
	Commits      []WorkLogCommit `json:"commits"`
	PullRequests []GitHubItem    `json:"pullRequests"`
	Runs         []GitHubRun     `json:"runs"`
	Partial      bool            `json:"partial"`
}

// WorkLogCommit is one commit in a work log or report.
type WorkLogCommit struct {
	Repo    string `json:"repo"`
	Message string `json:"message"`
	URL     string `json:"url"`
	Date    string `json:"date"`
}

// workflowRuns lists what ran in a project's repositories during a period, which is how deploys show up.
func workflowRuns(ctx context.Context, token string, projects []Project, span string) ([]GitHubRun, bool) {
	repos := []string{}
	seen := map[string]bool{}
	for _, project := range projects {
		if project.Repo != "" && !seen[project.Repo] && len(repos) < maxWorkLogRepos {
			seen[project.Repo] = true
			repos = append(repos, project.Repo)
		}
	}
	var (
		mutex   sync.Mutex
		group   sync.WaitGroup
		runs    = []GitHubRun{}
		partial bool
	)
	for _, repo := range repos {
		group.Add(1)
		go func() {
			defer group.Done()
			owner, name, _ := strings.Cut(repo, "/")
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
			query := url.Values{"created": {span}, "per_page": {"20"}}
			err := githubGetAs(ctx, token, "/repos/"+url.PathEscape(owner)+"/"+url.PathEscape(name)+"/actions/runs?"+query.Encode(), &found)
			mutex.Lock()
			defer mutex.Unlock()
			if err != nil {
				// Usually a private repository the app can't read, which shouldn't hide the rest.
				partial = true
				return
			}
			for _, run := range found.WorkflowRuns {
				if link := safeLink(run.HTMLURL); link != "" {
					runs = append(runs, GitHubRun{ID: run.ID, Repo: repo, Workflow: run.Name, Branch: run.HeadBranch, Status: run.Status, Conclusion: run.Conclusion, URL: link, UpdatedAt: run.UpdatedAt})
				}
			}
		}()
	}
	group.Wait()
	return runs, partial
}

func firstLine(message string) string {
	line, _, _ := strings.Cut(message, "\n")
	return strings.TrimSpace(line)
}

func (a *App) handleWorkLog(w http.ResponseWriter, r *http.Request, current session) {
	from, to, ok := parseTimeRange(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "That date range isn't valid.")
		return
	}
	ctx := r.Context()
	user, err := a.store.getUser(ctx, current.userID)
	if err != nil {
		writeServerError(w, err)
		return
	}
	workspace, err := a.store.getWorkspace(ctx, current.userID)
	if err != nil {
		writeServerError(w, err)
		return
	}
	token, _ := a.validAccessToken(ctx, current.userID)
	span := from.UTC().Format(time.RFC3339) + ".." + to.UTC().Format(time.RFC3339)
	key := fmt.Sprintf("%d:%s", current.userID, span)
	log1, _, err := a.dev.workLogs.get(key, workLogLife, func() (WorkLog, error) {
		result := WorkLog{Commits: []WorkLogCommit{}, PullRequests: []GitHubItem{}, Runs: []GitHubRun{}}
		var found struct {
			Items []struct {
				HTMLURL    string `json:"html_url"`
				Repository struct {
					FullName string `json:"full_name"`
				} `json:"repository"`
				Commit struct {
					Message string `json:"message"`
					Author  struct {
						Date string `json:"date"`
					} `json:"author"`
				} `json:"commit"`
			} `json:"items"`
		}
		query := url.Values{"q": {fmt.Sprintf("author:%s author-date:%s", user.Login, span)}, "sort": {"author-date"}, "per_page": {"30"}}
		if err := githubGetAs(ctx, token, "/search/commits?"+query.Encode(), &found); err != nil {
			log.Printf("work log: %v", err)
			result.Partial = true
		}
		for _, item := range found.Items {
			if link := safeLink(item.HTMLURL); link != "" {
				result.Commits = append(result.Commits, WorkLogCommit{Repo: item.Repository.FullName, Message: firstLine(item.Commit.Message), URL: link, Date: item.Commit.Author.Date})
			}
		}
		items, err := searchGitHubItems(ctx, token, fmt.Sprintf("author:%s is:pr updated:%s", user.Login, span))
		if err != nil {
			log.Printf("work log: %v", err)
			result.Partial = true
		} else {
			result.PullRequests = items
		}
		runs, partial := workflowRuns(ctx, token, workspace.Projects, span)
		result.Runs = runs
		result.Partial = result.Partial || partial
		return result, nil
	})
	if err != nil {
		writeServerError(w, err)
		return
	}
	entries, err := a.store.timeEntries(ctx, current.userID, from, to)
	if err != nil {
		writeServerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"log": log1, "entries": entries})
}

// handleProjectReport builds a monthly report from stored uptime, the incident log, the
// repository's commits and tracked time. Nothing is sent anywhere unless the user shares it.
func (a *App) handleProjectReport(w http.ResponseWriter, r *http.Request, current session) {
	ctx := r.Context()
	month := r.URL.Query().Get("month")
	if !monthFormat.MatchString(month) {
		writeError(w, http.StatusBadRequest, "That month isn't valid.")
		return
	}
	start, err := time.Parse("2006-01", month)
	if err != nil {
		writeError(w, http.StatusBadRequest, "That month isn't valid.")
		return
	}
	end := start.AddDate(0, 1, 0)

	workspace, err := a.store.getWorkspace(ctx, current.userID)
	if err != nil {
		writeServerError(w, err)
		return
	}
	var project *Project
	for index := range workspace.Projects {
		if workspace.Projects[index].ID == r.PathValue("id") {
			project = &workspace.Projects[index]
		}
	}
	if project == nil {
		writeError(w, http.StatusNotFound, "That project doesn't exist.")
		return
	}

	key := monitorKey(project.URL)
	var checks, upChecks, totalMs int64
	if err := a.store.db.QueryRowContext(ctx,
		"SELECT COALESCE(SUM(checks), 0), COALESCE(SUM(up_checks), 0), COALESCE(SUM(total_ms), 0) FROM monitor_daily WHERE url_hash = ? AND day >= ? AND day < ?",
		key, start.Format("2006-01-02"), end.Format("2006-01-02")).Scan(&checks, &upChecks, &totalMs); err != nil {
		writeServerError(w, err)
		return
	}
	report := map[string]any{"project": project, "month": month, "checks": checks, "uptime": nil, "averageMs": nil}
	if checks > 0 {
		report["uptime"] = float64(upChecks) / float64(checks) * 100
		report["averageMs"] = totalMs / checks
	}

	type incident struct {
		StartedAt time.Time  `json:"startedAt"`
		EndedAt   *time.Time `json:"endedAt"`
		Problem   string     `json:"problem"`
	}
	incidents := []incident{}
	rows, err := a.store.db.QueryContext(ctx,
		"SELECT started_at, ended_at, problem FROM monitor_incidents WHERE url_hash = ? AND started_at >= ? AND started_at < ? ORDER BY started_at",
		key, start, end)
	if err != nil {
		writeServerError(w, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var item incident
		var ended sql.NullTime
		if err := rows.Scan(&item.StartedAt, &ended, &item.Problem); err != nil {
			writeServerError(w, err)
			return
		}
		if ended.Valid {
			item.EndedAt = &ended.Time
		}
		incidents = append(incidents, item)
	}
	if err := rows.Err(); err != nil {
		writeServerError(w, err)
		return
	}
	report["incidents"] = incidents

	commits := []WorkLogCommit{}
	commitsAvailable := project.Repo == ""
	if owner, name, ok := strings.Cut(project.Repo, "/"); ok {
		token, _ := a.validAccessToken(ctx, current.userID)
		var found []struct {
			HTMLURL string `json:"html_url"`
			Commit  struct {
				Message string `json:"message"`
				Author  struct {
					Date string `json:"date"`
				} `json:"author"`
			} `json:"commit"`
		}
		query := url.Values{"since": {start.Format(time.RFC3339)}, "until": {end.Format(time.RFC3339)}, "per_page": {strconv.Itoa(reportCommits)}}
		if err := githubGetAs(ctx, token, "/repos/"+url.PathEscape(owner)+"/"+url.PathEscape(name)+"/commits?"+query.Encode(), &found); err != nil {
			log.Printf("project report: %v", err)
		} else {
			commitsAvailable = true
			for _, item := range found {
				message := firstLine(item.Commit.Message)
				if link := safeLink(item.HTMLURL); link != "" && !strings.HasPrefix(message, "Merge ") {
					commits = append(commits, WorkLogCommit{Repo: project.Repo, Message: message, URL: link, Date: item.Commit.Author.Date})
				}
			}
		}
	}
	report["commits"] = commits
	report["commitsAvailable"] = commitsAvailable

	var seconds sql.NullInt64
	if err := a.store.db.QueryRowContext(ctx,
		`SELECT SUM(TIMESTAMPDIFF(SECOND, started_at, COALESCE(ended_at, UTC_TIMESTAMP()))) FROM time_entries
		 WHERE user_id = ? AND project_id = ? AND started_at >= ? AND started_at < ?`,
		current.userID, project.ID, start, end).Scan(&seconds); err != nil {
		writeServerError(w, err)
		return
	}
	report["trackedSeconds"] = seconds.Int64
	writeJSON(w, http.StatusOK, report)
}

func githubPostAs(ctx context.Context, token, path string, body any) (int, error) {
	payload := []byte("{}")
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return 0, err
		}
		payload = encoded
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, envOr("GITHUB_API_URL", "https://api.github.com")+path, bytes.NewReader(payload))
	if err != nil {
		return 0, err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "home-base")
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	response, err := githubClient.Do(request)
	if err != nil {
		return 0, errors.New("couldn't reach GitHub")
	}
	defer response.Body.Close()
	return response.StatusCode, nil
}

// handleRerunCI re-runs a workflow's failed jobs as the user. It only works for connected users,
// and only if they've chosen to give the GitHub App the Actions write permission.
func (a *App) handleRerunCI(w http.ResponseWriter, r *http.Request, current session) {
	var body struct {
		Repo  string `json:"repo"`
		RunID int64  `json:"runId"`
	}
	const invalid = "That run isn't valid."
	if !readJSON(w, r, &body, invalid) {
		return
	}
	owner, name, ok := strings.Cut(body.Repo, "/")
	if !ok || !repoName.MatchString(body.Repo) || body.RunID <= 0 {
		writeError(w, http.StatusBadRequest, invalid)
		return
	}
	ctx := r.Context()
	token, err := a.validAccessToken(ctx, current.userID)
	if err != nil || token == "" {
		writeError(w, http.StatusConflict, "Connect private GitHub to re-run CI from here.")
		return
	}
	path := "/repos/" + url.PathEscape(owner) + "/" + url.PathEscape(name) + "/actions/runs/" + strconv.FormatInt(body.RunID, 10) + "/rerun-failed-jobs"
	status, err := githubPostAs(ctx, token, path, nil)
	switch {
	case err != nil:
		writeError(w, http.StatusBadGateway, "GitHub couldn't be reached.")
	case status == http.StatusCreated:
		a.dev.github.forget("public:" + body.Repo)
		a.dev.private.forget(privateCacheKey(current.userID))
		a.dev.projectCI.forget(strconv.FormatInt(current.userID, 10) + ":" + body.Repo)
		writeOK(w)
	case status == http.StatusForbidden || status == http.StatusNotFound:
		writeError(w, http.StatusForbidden, "Re-running needs the Actions read and write permission on your GitHub App.")
	default:
		writeError(w, http.StatusBadGateway, "GitHub couldn't re-run that workflow.")
	}
}

// handleDeploy starts a project's saved deploy workflow as the user. The request names only the
// project, so what runs is always what the user saved, and the page asks them to confirm first.
func (a *App) handleDeploy(w http.ResponseWriter, r *http.Request, current session) {
	ctx := r.Context()
	workspace, err := a.store.getWorkspace(ctx, current.userID)
	if err != nil {
		writeServerError(w, err)
		return
	}
	var project *Project
	for index := range workspace.Projects {
		if workspace.Projects[index].ID == r.PathValue("id") {
			project = &workspace.Projects[index]
		}
	}
	if project == nil {
		writeError(w, http.StatusNotFound, "That project doesn't exist.")
		return
	}
	owner, name, ok := strings.Cut(project.Repo, "/")
	if !ok || project.DeployWorkflow == "" {
		writeError(w, http.StatusBadRequest, "Choose a deploy workflow for this project first.")
		return
	}
	token, err := a.validAccessToken(ctx, current.userID)
	if err != nil || token == "" {
		writeError(w, http.StatusConflict, "Connect private GitHub to deploy from here.")
		return
	}
	ref := project.DeployRef
	if ref == "" {
		ref = "main"
	}
	path := "/repos/" + url.PathEscape(owner) + "/" + url.PathEscape(name) + "/actions/workflows/" + url.PathEscape(project.DeployWorkflow) + "/dispatches"
	status, err := githubPostAs(ctx, token, path, map[string]string{"ref": ref})
	switch {
	case err != nil:
		writeError(w, http.StatusBadGateway, "GitHub couldn't be reached.")
	case status >= 200 && status < 300:
		log.Printf("deploy started: user %d, %s, %s on %s", current.userID, project.Repo, project.DeployWorkflow, ref)
		a.dev.projectCI.forget(strconv.FormatInt(current.userID, 10) + ":" + project.Repo)
		writeOK(w)
	case status == http.StatusUnauthorized || status == http.StatusForbidden || status == http.StatusNotFound:
		writeError(w, http.StatusForbidden, "Deploying needs the Actions read and write permission on your GitHub App, and access to this repository.")
	case status == http.StatusUnprocessableEntity:
		writeError(w, http.StatusBadRequest, "GitHub refused it. The workflow needs a workflow_dispatch trigger, and the branch must exist.")
	default:
		writeError(w, http.StatusBadGateway, "GitHub couldn't start that workflow.")
	}
}

// handleWorkflows lists a repository's workflow files, to choose a deploy workflow from.
func (a *App) handleWorkflows(w http.ResponseWriter, r *http.Request, current session) {
	repo := r.URL.Query().Get("repo")
	owner, name, ok := strings.Cut(repo, "/")
	if !ok || !repoName.MatchString(repo) {
		writeError(w, http.StatusBadRequest, "That repository name isn't valid.")
		return
	}
	ctx := r.Context()
	token, _ := a.validAccessToken(ctx, current.userID)
	var found struct {
		Workflows []struct {
			Name  string `json:"name"`
			Path  string `json:"path"`
			State string `json:"state"`
		} `json:"workflows"`
	}
	if err := githubGetAs(ctx, token, "/repos/"+url.PathEscape(owner)+"/"+url.PathEscape(name)+"/actions/workflows?per_page=100", &found); err != nil {
		writeError(w, http.StatusBadGateway, "That repository's workflows couldn't be read.")
		return
	}
	type workflow struct {
		Name string `json:"name"`
		File string `json:"file"`
	}
	workflows := []workflow{}
	for _, item := range found.Workflows {
		file, inFolder := strings.CutPrefix(item.Path, ".github/workflows/")
		if inFolder && item.State == "active" && workflowFile.MatchString(file) {
			workflows = append(workflows, workflow{Name: item.Name, File: file})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"workflows": workflows})
}

func (a *App) registerProjectRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/dev/projects", a.signedIn(a.handleProjects))
	mux.HandleFunc("GET /api/dev/projects/{id}/report", a.signedIn(a.handleProjectReport))
	mux.HandleFunc("GET /api/dev/time", a.signedIn(a.handleListTime))
	mux.HandleFunc("POST /api/dev/time/start", a.signedIn(a.handleStartTime))
	mux.HandleFunc("POST /api/dev/time/stop", a.signedIn(a.handleStopTime))
	mux.HandleFunc("DELETE /api/dev/time/{id}", a.signedIn(a.handleDeleteTime))
	mux.HandleFunc("GET /api/dev/worklog", a.signedIn(a.handleWorkLog))
	mux.HandleFunc("POST /api/dev/github/rerun", a.signedIn(a.handleRerunCI))
	mux.HandleFunc("GET /api/dev/github/workflows", a.signedIn(a.handleWorkflows))
	mux.HandleFunc("POST /api/dev/projects/{id}/deploy", a.signedIn(a.handleDeploy))
}

// dialerAllowsPrivate is only ever true in tests, where stand-in sites live on private addresses.
func dialerAllowsPrivate() bool {
	return os.Getenv("MONITOR_ALLOW_PRIVATE") == "true"
}
