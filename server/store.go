package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/go-sql-driver/mysql"
)

const (
	sessionDays              = 90
	sessionTouchInterval     = "1 HOUR"
	migrationLock            = "home-base-migration"
	migrationLockWaitSeconds = 60
)

var schema = []string{
	`CREATE TABLE IF NOT EXISTS users (
	   id INT AUTO_INCREMENT PRIMARY KEY,
	   github_id BIGINT NOT NULL UNIQUE,
	   login VARCHAR(100) NOT NULL,
	   preferences TEXT NULL,
	   is_admin TINYINT(1) NOT NULL DEFAULT 0,
	   disabled_at DATETIME NULL,
	   last_seen_at DATETIME NULL,
	   created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	 ) CHARACTER SET utf8mb4`,
	`CREATE TABLE IF NOT EXISTS user_backgrounds (
	   user_id INT PRIMARY KEY,
	   content_type VARCHAR(20) NOT NULL,
	   image MEDIUMBLOB NOT NULL,
	   version BIGINT NOT NULL,
	   CONSTRAINT user_backgrounds_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
	 )`,
	`CREATE TABLE IF NOT EXISTS user_workspaces (
	   user_id INT PRIMARY KEY,
	   data MEDIUMTEXT NOT NULL,
	   CONSTRAINT user_workspaces_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
	 ) CHARACTER SET utf8mb4`,
	`CREATE TABLE IF NOT EXISTS user_github_tokens (
	   user_id INT PRIMARY KEY,
	   access_token TEXT NOT NULL,
	   access_expires DATETIME NULL,
	   refresh_token TEXT NULL,
	   refresh_expires DATETIME NULL,
	   connected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	   CONSTRAINT user_github_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
	 )`,
	`CREATE TABLE IF NOT EXISTS monitor_checks (
	   id BIGINT AUTO_INCREMENT PRIMARY KEY,
	   url_hash CHAR(64) NOT NULL,
	   checked_at DATETIME NOT NULL,
	   up TINYINT(1) NOT NULL,
	   status INT NOT NULL,
	   ms INT NOT NULL,
	   INDEX monitor_checks_lookup (url_hash, checked_at),
	   INDEX monitor_checks_age (checked_at)
	 )`,
	`CREATE TABLE IF NOT EXISTS servers (
	   id INT AUTO_INCREMENT PRIMARY KEY,
	   name VARCHAR(100) NOT NULL,
	   token_hash CHAR(64) NOT NULL UNIQUE,
	   report TEXT NULL,
	   reported_at DATETIME NULL,
	   created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	 ) CHARACTER SET utf8mb4`,
	`CREATE TABLE IF NOT EXISTS sessions (
	   token_hash CHAR(64) PRIMARY KEY,
	   user_id INT NOT NULL,
	   created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	   expires_at DATETIME NOT NULL,
	   INDEX sessions_expires_at (expires_at),
	   CONSTRAINT sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
	 ) CHARACTER SET utf8mb4`,
	`CREATE TABLE IF NOT EXISTS link_groups (
	   id INT AUTO_INCREMENT PRIMARY KEY,
	   user_id INT NULL,
	   name VARCHAR(100) NOT NULL,
	   color VARCHAR(7) NOT NULL DEFAULT '',
	   position INT NOT NULL,
	   CONSTRAINT link_groups_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
	 ) CHARACTER SET utf8mb4`,
	`CREATE TABLE IF NOT EXISTS links (
	   id INT AUTO_INCREMENT PRIMARY KEY,
	   group_id INT NOT NULL,
	   name VARCHAR(100) NOT NULL,
	   url VARCHAR(2048) NOT NULL,
	   icon TEXT NULL,
	   icon_color VARCHAR(7) NOT NULL DEFAULT '',
	   position INT NOT NULL,
	   CONSTRAINT links_group FOREIGN KEY (group_id) REFERENCES link_groups (id) ON DELETE CASCADE
	 ) CHARACTER SET utf8mb4`,
}

// Link is one saved site. Icon and IconColor are empty unless the user customized them.
type Link struct {
	Name      string `json:"name"`
	URL       string `json:"url"`
	Icon      string `json:"icon,omitempty"`
	IconColor string `json:"iconColor,omitempty"`
}

// Group is a named list of saved sites. Color is empty unless the user chose one.
type Group struct {
	Name  string `json:"name"`
	Color string `json:"color,omitempty"`
	Links []Link `json:"links"`
}

// starterGroups are what every new user gets, and what "Restore original sites" brings back.
func starterGroups() []Group {
	return []Group{
		{Name: "Everyday", Links: []Link{
			{Name: "Gmail", URL: "https://mail.google.com/"},
			{Name: "YouTube", URL: "https://www.youtube.com/"},
			{Name: "Google Drive", URL: "https://drive.google.com/"},
			{Name: "Google Calendar", URL: "https://calendar.google.com/"},
			{Name: "Google Maps", URL: "https://maps.google.com/"},
		}},
		{Name: "Build", Links: []Link{
			{Name: "Claude", URL: "https://claude.ai/"},
			{Name: "GitHub", URL: "https://github.com/"},
			{Name: "Vercel", URL: "https://vercel.com/dashboard"},
		}},
	}
}

// Store holds every database query the app makes.
type Store struct {
	db *sql.DB
}

func openStore(ctx context.Context, wait time.Duration) (*Store, error) {
	config := mysql.NewConfig()
	config.User = os.Getenv("DB_USER")
	config.Passwd = os.Getenv("DB_PASSWORD")
	config.Net = "tcp"
	config.Addr = envOr("DB_HOST", "127.0.0.1") + ":3306"
	config.DBName = os.Getenv("DB_NAME")
	config.ParseTime = true

	db, err := sql.Open("mysql", config.FormatDSN())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	deadline := time.Now().Add(wait)
	for {
		err = db.PingContext(ctx)
		if err == nil {
			return &Store{db: db}, nil
		}
		if time.Now().After(deadline) || ctx.Err() != nil {
			db.Close()
			return nil, err
		}
		time.Sleep(time.Second)
	}
}

func (s *Store) close() {
	s.db.Close()
}

func (s *Store) ping(ctx context.Context) error {
	return s.db.PingContext(ctx)
}

func (s *Store) columnExists(ctx context.Context, table, column string) (bool, error) {
	var found int
	err := s.db.QueryRowContext(ctx,
		`SELECT 1 FROM information_schema.columns
		 WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
		table, column).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// migrate holds a database lock, so two servers starting together can't both apply the same upgrade.
func (s *Store) migrate(ctx context.Context) error {
	connection, err := s.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer connection.Close()

	var acquired sql.NullInt64
	err = connection.QueryRowContext(ctx, "SELECT GET_LOCK(?, ?)", migrationLock, migrationLockWaitSeconds).Scan(&acquired)
	if err != nil {
		return err
	}
	if acquired.Int64 != 1 {
		return errors.New("timed out waiting for another server to finish upgrading the database")
	}
	defer connection.ExecContext(context.WithoutCancel(ctx), "DO RELEASE_LOCK(?)", migrationLock)

	return s.applyMigrations(ctx)
}

func (s *Store) applyMigrations(ctx context.Context) error {
	for _, statement := range schema {
		if _, err := s.db.ExecContext(ctx, statement); err != nil {
			return err
		}
	}
	if err := s.upgradeFromPasswordVersion(ctx); err != nil {
		return err
	}

	newColumns := []struct{ table, name, definition string }{
		{"users", "preferences", "TEXT NULL"},
		{"users", "is_admin", "TINYINT(1) NOT NULL DEFAULT 0"},
		{"users", "disabled_at", "DATETIME NULL"},
		{"users", "last_seen_at", "DATETIME NULL"},
		{"link_groups", "color", "VARCHAR(7) NOT NULL DEFAULT ''"},
		{"links", "icon", "TEXT NULL"},
		{"links", "icon_color", "VARCHAR(7) NOT NULL DEFAULT ''"},
		{"sessions", "label", "VARCHAR(200) NOT NULL DEFAULT ''"},
		{"sessions", "last_used_at", "DATETIME NULL"},
		{"user_workspaces", "version", "INT NOT NULL DEFAULT 0"},
	}
	for _, column := range newColumns {
		exists, err := s.columnExists(ctx, column.table, column.name)
		if err != nil {
			return err
		}
		if !exists {
			statement := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", column.table, column.name, column.definition)
			if _, err := s.db.ExecContext(ctx, statement); err != nil {
				return err
			}
		}
	}
	return nil
}

// upgradeFromPasswordVersion upgrades a database from the single-password version.
// Existing sites keep a NULL owner until the owner's first GitHub sign-in claims them.
func (s *Store) upgradeFromPasswordVersion(ctx context.Context) error {
	exists, err := s.columnExists(ctx, "sessions", "user_id")
	if err != nil {
		return err
	}
	if !exists {
		if _, err := s.db.ExecContext(ctx, "DELETE FROM sessions"); err != nil {
			return err
		}
		if _, err := s.db.ExecContext(ctx,
			`ALTER TABLE sessions
			   ADD COLUMN user_id INT NOT NULL,
			   ADD CONSTRAINT sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE`); err != nil {
			return err
		}
	}

	exists, err = s.columnExists(ctx, "link_groups", "user_id")
	if err != nil {
		return err
	}
	if !exists {
		if _, err := s.db.ExecContext(ctx,
			`ALTER TABLE link_groups
			   ADD COLUMN user_id INT NULL,
			   ADD CONSTRAINT link_groups_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE`); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) inTransaction(ctx context.Context, work func(*sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := work(tx); err != nil {
		return err
	}
	return tx.Commit()
}

func writeGroups(ctx context.Context, tx *sql.Tx, userID int64, groups []Group) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM link_groups WHERE user_id = ?", userID); err != nil {
		return err
	}
	for groupIndex, group := range groups {
		result, err := tx.ExecContext(ctx,
			"INSERT INTO link_groups (user_id, name, color, position) VALUES (?, ?, ?, ?)",
			userID, group.Name, group.Color, groupIndex)
		if err != nil {
			return err
		}
		groupID, err := result.LastInsertId()
		if err != nil {
			return err
		}
		for linkIndex, link := range group.Links {
			if _, err := tx.ExecContext(ctx,
				"INSERT INTO links (group_id, name, url, icon, icon_color, position) VALUES (?, ?, ?, ?, ?, ?)",
				groupID, link.Name, link.URL, link.Icon, link.IconColor, linkIndex); err != nil {
				return err
			}
		}
	}
	return nil
}

// SignIn describes a GitHub user at the moment they sign in.
type SignIn struct {
	GitHubID int64
	Login    string
	IsOwner  bool
	IsAdmin  bool
	MaxUsers int
}

// SignedInUser is the account a sign-in resolved to.
type SignedInUser struct {
	ID       int64
	Disabled bool
}

// findOrCreateUser returns nil if the site has reached its user limit.
// Admin access is worked out again at every sign-in, so removing it takes effect next time.
func (s *Store) findOrCreateUser(ctx context.Context, signIn SignIn) (*SignedInUser, error) {
	var user *SignedInUser
	err := s.inTransaction(ctx, func(tx *sql.Tx) error {
		var id int64
		var disabledAt sql.NullTime
		err := tx.QueryRowContext(ctx,
			"SELECT id, disabled_at FROM users WHERE github_id = ?", signIn.GitHubID).Scan(&id, &disabledAt)
		if err == nil {
			// GitHub usernames can change, so accounts are matched on the permanent numeric ID.
			if _, err := tx.ExecContext(ctx,
				"UPDATE users SET login = ?, is_admin = ?, last_seen_at = NOW() WHERE id = ?",
				signIn.Login, signIn.IsAdmin, id); err != nil {
				return err
			}
			user = &SignedInUser{ID: id, Disabled: disabledAt.Valid}
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}

		var total int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM users").Scan(&total); err != nil {
			return err
		}
		if total >= signIn.MaxUsers {
			return nil
		}

		result, err := tx.ExecContext(ctx,
			"INSERT INTO users (github_id, login, is_admin, last_seen_at) VALUES (?, ?, ?, NOW())",
			signIn.GitHubID, signIn.Login, signIn.IsAdmin)
		if err != nil {
			return err
		}
		id, err = result.LastInsertId()
		if err != nil {
			return err
		}
		user = &SignedInUser{ID: id}

		if signIn.IsOwner {
			claimed, err := tx.ExecContext(ctx, "UPDATE link_groups SET user_id = ? WHERE user_id IS NULL", id)
			if err != nil {
				return err
			}
			if count, err := claimed.RowsAffected(); err != nil {
				return err
			} else if count > 0 {
				return nil
			}
		}
		return writeGroups(ctx, tx, id, starterGroups())
	})
	if err != nil {
		return nil, err
	}
	return user, nil
}

// UserDetails is what the start page needs to know about the signed-in user.
type UserDetails struct {
	Login       string
	IsAdmin     bool
	Preferences map[string]any
}

func (s *Store) getUser(ctx context.Context, userID int64) (*UserDetails, error) {
	var details UserDetails
	var preferences sql.NullString
	err := s.db.QueryRowContext(ctx,
		"SELECT login, preferences, is_admin FROM users WHERE id = ?", userID).
		Scan(&details.Login, &preferences, &details.IsAdmin)
	if err != nil {
		return nil, err
	}
	details.Preferences = map[string]any{}
	if preferences.Valid {
		if err := json.Unmarshal([]byte(preferences.String), &details.Preferences); err != nil {
			return nil, err
		}
	}
	return &details, nil
}

func (s *Store) touchUser(ctx context.Context, userID int64) error {
	_, err := s.db.ExecContext(ctx, "UPDATE users SET last_seen_at = NOW() WHERE id = ?", userID)
	return err
}

func (s *Store) isAdmin(ctx context.Context, userID int64) (bool, error) {
	var admin bool
	err := s.db.QueryRowContext(ctx, "SELECT is_admin FROM users WHERE id = ?", userID).Scan(&admin)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return admin, err
}

// setPreferences merges new values over saved ones, so an older extension that doesn't
// know about a setting can't erase it.
func (s *Store) setPreferences(ctx context.Context, userID int64, preferences map[string]any) error {
	user, err := s.getUser(ctx, userID)
	if err != nil {
		return err
	}
	for key, value := range preferences {
		user.Preferences[key] = value
	}
	encoded, err := json.Marshal(user.Preferences)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, "UPDATE users SET preferences = ? WHERE id = ?", string(encoded), userID)
	return err
}

func (s *Store) getGroups(ctx context.Context, userID int64) ([]Group, error) {
	rows, err := s.db.QueryContext(ctx,
		"SELECT id, name, color FROM link_groups WHERE user_id = ? ORDER BY position", userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	groups := []Group{}
	positions := map[int64]int{}
	for rows.Next() {
		var id int64
		group := Group{Links: []Link{}}
		if err := rows.Scan(&id, &group.Name, &group.Color); err != nil {
			return nil, err
		}
		positions[id] = len(groups)
		groups = append(groups, group)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	linkRows, err := s.db.QueryContext(ctx,
		`SELECT l.group_id, l.name, l.url, COALESCE(l.icon, ''), l.icon_color FROM links l
		 JOIN link_groups g ON g.id = l.group_id
		 WHERE g.user_id = ? ORDER BY l.position`, userID)
	if err != nil {
		return nil, err
	}
	defer linkRows.Close()
	for linkRows.Next() {
		var groupID int64
		var link Link
		if err := linkRows.Scan(&groupID, &link.Name, &link.URL, &link.Icon, &link.IconColor); err != nil {
			return nil, err
		}
		if position, ok := positions[groupID]; ok {
			groups[position].Links = append(groups[position].Links, link)
		}
	}
	return groups, linkRows.Err()
}

// replaceGroups replaces one user's groups in a transaction, so a failed save leaves their old sites in place.
func (s *Store) replaceGroups(ctx context.Context, userID int64, groups []Group) error {
	return s.inTransaction(ctx, func(tx *sql.Tx) error {
		return writeGroups(ctx, tx, userID, groups)
	})
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// createSession stores only a hash of the token, so reading the database doesn't reveal usable sessions.
func (s *Store) createSession(ctx context.Context, userID int64, label string) (string, error) {
	token, err := randomHex(32)
	if err != nil {
		return "", err
	}
	if _, err := s.db.ExecContext(ctx, "DELETE FROM sessions WHERE expires_at <= NOW()"); err != nil {
		return "", err
	}
	_, err = s.db.ExecContext(ctx,
		"INSERT INTO sessions (token_hash, user_id, label, last_used_at, expires_at) VALUES (?, ?, ?, NOW(), NOW() + INTERVAL ? DAY)",
		hashToken(token), userID, label, sessionDays)
	return token, err
}

// findSessionUser returns 0 if the session is unknown, expired or belongs to a disabled user.
func (s *Store) findSessionUser(ctx context.Context, token string) (int64, error) {
	var userID int64
	err := s.db.QueryRowContext(ctx,
		`SELECT s.user_id FROM sessions s
		 JOIN users u ON u.id = s.user_id
		 WHERE s.token_hash = ? AND s.expires_at > NOW() AND u.disabled_at IS NULL`,
		hashToken(token)).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	// Sessions in regular use keep going, and unused ones expire. This writes at most once an hour.
	_, err = s.db.ExecContext(ctx,
		"UPDATE sessions SET last_used_at = NOW(), expires_at = NOW() + INTERVAL ? DAY WHERE token_hash = ? AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL "+sessionTouchInterval+")",
		sessionDays, hashToken(token))
	return userID, err
}

func (s *Store) deleteSession(ctx context.Context, token string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM sessions WHERE token_hash = ?", hashToken(token))
	return err
}

func (s *Store) getBackgroundVersion(ctx context.Context, userID int64) (*string, error) {
	var version int64
	err := s.db.QueryRowContext(ctx, "SELECT version FROM user_backgrounds WHERE user_id = ?", userID).Scan(&version)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	text := strconv.FormatInt(version, 10)
	return &text, nil
}

// Background is a user's uploaded wallpaper.
type Background struct {
	ContentType string
	Image       []byte
}

func (s *Store) getBackground(ctx context.Context, userID int64) (*Background, error) {
	var background Background
	err := s.db.QueryRowContext(ctx,
		"SELECT content_type, image FROM user_backgrounds WHERE user_id = ?", userID).
		Scan(&background.ContentType, &background.Image)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &background, nil
}

func (s *Store) setBackground(ctx context.Context, userID int64, contentType string, image []byte) (string, error) {
	version := time.Now().UnixMilli()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO user_backgrounds (user_id, content_type, image, version) VALUES (?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE content_type = VALUES(content_type), image = VALUES(image), version = VALUES(version)`,
		userID, contentType, image, version)
	return strconv.FormatInt(version, 10), err
}

func (s *Store) deleteBackground(ctx context.Context, userID int64) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM user_backgrounds WHERE user_id = ?", userID)
	return err
}

// AdminTotals are the headline numbers on the admin dashboard.
type AdminTotals struct {
	Users          int `json:"users"`
	NewUsers7Days  int `json:"newUsers7Days"`
	NewUsers30Days int `json:"newUsers30Days"`
	Active7Days    int `json:"active7Days"`
	Sessions       int `json:"sessions"`
	Links          int `json:"links"`
}

// AdminUser holds account details and counts, never the sites people have saved.
type AdminUser struct {
	ID         int64      `json:"id"`
	Login      string     `json:"login"`
	IsAdmin    bool       `json:"isAdmin"`
	Disabled   bool       `json:"disabled"`
	LastSeenAt *time.Time `json:"lastSeenAt"`
	CreatedAt  time.Time  `json:"createdAt"`
	Groups     int        `json:"groups"`
	Links      int        `json:"links"`
	Sessions   int        `json:"sessions"`
}

func (s *Store) getAdminOverview(ctx context.Context) (*AdminTotals, []AdminUser, error) {
	var totals AdminTotals
	err := s.db.QueryRowContext(ctx,
		`SELECT
		   (SELECT COUNT(*) FROM users),
		   (SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL 7 DAY),
		   (SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL 30 DAY),
		   (SELECT COUNT(*) FROM users WHERE last_seen_at > NOW() - INTERVAL 7 DAY),
		   (SELECT COUNT(*) FROM sessions WHERE expires_at > NOW()),
		   (SELECT COUNT(*) FROM links)`).
		Scan(&totals.Users, &totals.NewUsers7Days, &totals.NewUsers30Days, &totals.Active7Days, &totals.Sessions, &totals.Links)
	if err != nil {
		return nil, nil, err
	}

	rows, err := s.db.QueryContext(ctx,
		`SELECT u.id, u.login, u.is_admin, u.disabled_at, u.last_seen_at, u.created_at,
		   (SELECT COUNT(*) FROM link_groups g WHERE g.user_id = u.id),
		   (SELECT COUNT(*) FROM links l JOIN link_groups g ON g.id = l.group_id WHERE g.user_id = u.id),
		   (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > NOW())
		 FROM users u
		 ORDER BY u.created_at DESC`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	users := []AdminUser{}
	for rows.Next() {
		var user AdminUser
		var disabledAt, lastSeenAt sql.NullTime
		if err := rows.Scan(&user.ID, &user.Login, &user.IsAdmin, &disabledAt, &lastSeenAt, &user.CreatedAt,
			&user.Groups, &user.Links, &user.Sessions); err != nil {
			return nil, nil, err
		}
		user.Disabled = disabledAt.Valid
		if lastSeenAt.Valid {
			user.LastSeenAt = &lastSeenAt.Time
		}
		users = append(users, user)
	}
	return &totals, users, rows.Err()
}

func (s *Store) deleteUserSessions(ctx context.Context, userID int64) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM sessions WHERE user_id = ?", userID)
	return err
}

func (s *Store) setUserDisabled(ctx context.Context, userID int64, disabled bool) error {
	statement := "UPDATE users SET disabled_at = NULL WHERE id = ?"
	if disabled {
		statement = "UPDATE users SET disabled_at = NOW() WHERE id = ?"
	}
	if _, err := s.db.ExecContext(ctx, statement, userID); err != nil {
		return err
	}
	if disabled {
		return s.deleteUserSessions(ctx, userID)
	}
	return nil
}

// deleteUser also removes their sessions, groups, links and image, through the database's cascading deletes.
func (s *Store) deleteUser(ctx context.Context, userID int64) (bool, error) {
	result, err := s.db.ExecContext(ctx, "DELETE FROM users WHERE id = ?", userID)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	return count > 0, err
}
