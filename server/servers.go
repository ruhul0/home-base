package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

const (
	maxServerReportBody = 16 * 1024
	maxReportedNames    = 20
	maxServerNameLength = 100
)

// ServerReport is what a server's agent sends every minute. Only these numbers and the names of
// unhealthy containers are kept, never logs, environment variables or file contents.
type ServerReport struct {
	DiskPercent       float64  `json:"diskPercent"`
	MemoryPercent     float64  `json:"memoryPercent"`
	Load              float64  `json:"load"`
	Cores             int      `json:"cores"`
	UptimeSeconds     int64    `json:"uptimeSeconds"`
	ContainersRunning int      `json:"containersRunning"`
	ContainersTotal   int      `json:"containersTotal"`
	Unhealthy         []string `json:"unhealthy"`
}

func cleanServerReport(report ServerReport) (ServerReport, bool) {
	validPercent := func(value float64) bool { return value >= 0 && value <= 100 }
	if !validPercent(report.DiskPercent) || !validPercent(report.MemoryPercent) || report.Load < 0 || report.Cores < 0 ||
		report.UptimeSeconds < 0 || report.ContainersRunning < 0 || report.ContainersTotal < 0 || len(report.Unhealthy) > maxReportedNames {
		return report, false
	}
	for index, name := range report.Unhealthy {
		cleaned, ok := cleanName(name)
		if !ok {
			return report, false
		}
		report.Unhealthy[index] = cleaned
	}
	if report.Unhealthy == nil {
		report.Unhealthy = []string{}
	}
	return report, true
}

// MonitoredServer is one row of the admin server panel.
type MonitoredServer struct {
	ID         int64         `json:"id"`
	Name       string        `json:"name"`
	Report     *ServerReport `json:"report"`
	ReportedAt *time.Time    `json:"reportedAt"`
}

func (s *Store) listServers(ctx context.Context) ([]MonitoredServer, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id, name, report, reported_at FROM servers ORDER BY name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	servers := []MonitoredServer{}
	for rows.Next() {
		var server MonitoredServer
		var report sql.NullString
		var reportedAt sql.NullTime
		if err := rows.Scan(&server.ID, &server.Name, &report, &reportedAt); err != nil {
			return nil, err
		}
		if report.Valid {
			var parsed ServerReport
			if err := json.Unmarshal([]byte(report.String), &parsed); err == nil {
				server.Report = &parsed
			}
		}
		if reportedAt.Valid {
			server.ReportedAt = &reportedAt.Time
		}
		servers = append(servers, server)
	}
	return servers, rows.Err()
}

func (a *App) handleAdminServers(w http.ResponseWriter, r *http.Request, _ session) {
	servers, err := a.store.listServers(r.Context())
	if err != nil {
		writeServerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"servers": servers, "serverTime": time.Now().UTC()})
}

// handleAdminAddServer shows the agent's token once. Only its hash is stored.
func (a *App) handleAdminAddServer(w http.ResponseWriter, r *http.Request, _ session) {
	var body struct {
		Name string `json:"name"`
	}
	if !readJSON(w, r, &body, "That server name isn't valid.") {
		return
	}
	name, ok := cleanName(body.Name)
	if !ok {
		writeError(w, http.StatusBadRequest, "That server name isn't valid.")
		return
	}
	token, err := randomHex(32)
	if err != nil {
		writeServerError(w, err)
		return
	}
	result, err := a.store.db.ExecContext(r.Context(), "INSERT INTO servers (name, token_hash) VALUES (?, ?)", name, hashToken(token))
	if err != nil {
		writeServerError(w, err)
		return
	}
	id, err := result.LastInsertId()
	if err != nil {
		writeServerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "token": token})
}

func (a *App) handleAdminDeleteServer(w http.ResponseWriter, r *http.Request, _ session) {
	id, ok := targetUserID(w, r)
	if !ok {
		return
	}
	if _, err := a.store.db.ExecContext(r.Context(), "DELETE FROM servers WHERE id = ?", id); err != nil {
		writeServerError(w, err)
		return
	}
	writeOK(w)
}

// handleServerReport accepts reports from agents, which authenticate with their own token.
// That token can only update its own server's numbers, and can't read anything.
func (a *App) handleServerReport(w http.ResponseWriter, r *http.Request) {
	match := bearerPattern.FindStringSubmatch(r.Header.Get("Authorization"))
	if match == nil {
		writeError(w, http.StatusUnauthorized, "Invalid server token.")
		return
	}
	var report ServerReport
	body := http.MaxBytesReader(w, r.Body, maxServerReportBody)
	if err := json.NewDecoder(body).Decode(&report); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, "That report is too large.")
		} else {
			writeError(w, http.StatusBadRequest, "That report isn't valid.")
		}
		return
	}
	cleaned, ok := cleanServerReport(report)
	if !ok {
		writeError(w, http.StatusBadRequest, "That report isn't valid.")
		return
	}
	data, err := json.Marshal(cleaned)
	if err != nil {
		writeServerError(w, err)
		return
	}
	result, err := a.store.db.ExecContext(r.Context(),
		"UPDATE servers SET report = ?, reported_at = UTC_TIMESTAMP() WHERE token_hash = ?", string(data), hashToken(match[1]))
	if err != nil {
		writeServerError(w, err)
		return
	}
	// MySQL reports zero changed rows only for an unknown token here, because the time always changes,
	// except for two reports in one second. Those are checked before refusing.
	if count, err := result.RowsAffected(); err == nil && count == 0 {
		var found int
		err := a.store.db.QueryRowContext(r.Context(), "SELECT 1 FROM servers WHERE token_hash = ?", hashToken(match[1])).Scan(&found)
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusUnauthorized, "Invalid server token.")
			return
		}
	}
	writeOK(w)
}

// SessionInfo describes one signed-in device, for the account panel.
type SessionInfo struct {
	ID         string     `json:"id"`
	Label      string     `json:"label"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastUsedAt *time.Time `json:"lastUsedAt"`
	Current    bool       `json:"current"`
}

const sessionIDLength = 16

func (a *App) handleListSessions(w http.ResponseWriter, r *http.Request, current session) {
	rows, err := a.store.db.QueryContext(r.Context(),
		`SELECT token_hash, label, created_at, last_used_at FROM sessions
		 WHERE user_id = ? AND expires_at > NOW() ORDER BY COALESCE(last_used_at, created_at) DESC`, current.userID)
	if err != nil {
		writeServerError(w, err)
		return
	}
	defer rows.Close()
	currentHash := hashToken(current.token)
	sessions := []SessionInfo{}
	for rows.Next() {
		var hash string
		var info SessionInfo
		var lastUsed sql.NullTime
		if err := rows.Scan(&hash, &info.Label, &info.CreatedAt, &lastUsed); err != nil {
			writeServerError(w, err)
			return
		}
		info.ID = hash[:sessionIDLength]
		info.Current = hash == currentHash
		if lastUsed.Valid {
			info.LastUsedAt = &lastUsed.Time
		}
		sessions = append(sessions, info)
	}
	if err := rows.Err(); err != nil {
		writeServerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": sessions})
}

func (a *App) handleDeleteSession(w http.ResponseWriter, r *http.Request, current session) {
	id := r.PathValue("id")
	if len(id) != sessionIDLength {
		writeError(w, http.StatusBadRequest, "That session isn't valid.")
		return
	}
	// A user can only ever remove their own sessions.
	result, err := a.store.db.ExecContext(r.Context(),
		"DELETE FROM sessions WHERE user_id = ? AND LEFT(token_hash, ?) = ?", current.userID, sessionIDLength, id)
	if err != nil {
		writeServerError(w, err)
		return
	}
	if count, err := result.RowsAffected(); err == nil && count == 0 {
		writeError(w, http.StatusNotFound, "That session no longer exists.")
		return
	}
	writeOK(w)
}

func (a *App) handleSignOutOthers(w http.ResponseWriter, r *http.Request, current session) {
	if _, err := a.store.db.ExecContext(r.Context(),
		"DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?", current.userID, hashToken(current.token)); err != nil {
		writeServerError(w, err)
		return
	}
	writeOK(w)
}

// revokeUserGrant withdraws a user's GitHub App access before their account disappears.
func (a *App) revokeUserGrant(ctx context.Context, userID int64) {
	if !githubAppConfigured() {
		return
	}
	tokens, err := a.store.loadGitHubTokens(ctx, userID)
	if err == nil && tokens != nil {
		revokeGrant(context.WithoutCancel(ctx), tokens.Access)
	}
	a.dev.private.forget(privateCacheKey(userID))
}

// handleDeleteAccount needs the user to type their username, because this can't be undone.
// Admins are refused, so a site can't lose its only administrator by accident.
func (a *App) handleDeleteAccount(w http.ResponseWriter, r *http.Request, current session) {
	var body struct {
		Confirm string `json:"confirm"`
	}
	if !readJSON(w, r, &body, "That request wasn't valid.") {
		return
	}
	user, err := a.store.getUser(r.Context(), current.userID)
	if err != nil {
		writeServerError(w, err)
		return
	}
	if !strings.EqualFold(body.Confirm, user.Login) {
		writeError(w, http.StatusBadRequest, "Type your username to confirm.")
		return
	}
	if user.IsAdmin {
		writeError(w, http.StatusBadRequest, "The administrator's account can't be deleted here.")
		return
	}
	a.revokeUserGrant(r.Context(), current.userID)
	if _, err := a.store.deleteUser(r.Context(), current.userID); err != nil {
		writeServerError(w, err)
		return
	}
	writeOK(w)
}

func sessionLabel(r *http.Request) string {
	agent := r.Header.Get("User-Agent")
	browser := "Browser"
	switch {
	case strings.Contains(agent, "Edg/"):
		browser = "Edge"
	case strings.Contains(agent, "Firefox/"):
		browser = "Firefox"
	case strings.Contains(agent, "Chrome/"):
		browser = "Chrome"
	case strings.Contains(agent, "Safari/"):
		browser = "Safari"
	}
	if strings.HasPrefix(r.Header.Get("Origin"), "chrome-extension://") {
		browser = "Chrome extension"
	}
	system := ""
	switch {
	case strings.Contains(agent, "Android"):
		system = "Android"
	case strings.Contains(agent, "iPhone"), strings.Contains(agent, "iPad"):
		system = "iOS"
	case strings.Contains(agent, "Mac OS X"):
		system = "macOS"
	case strings.Contains(agent, "Windows"):
		system = "Windows"
	case strings.Contains(agent, "Linux"):
		system = "Linux"
	}
	if system == "" {
		return browser
	}
	return browser + " on " + system
}
