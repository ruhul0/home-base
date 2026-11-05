package main

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"sync"
	"time"
)

const (
	connectCookie         = "github_connect"
	connectCookiePath     = "/auth/github-app"
	connectStateLife      = 10 * time.Minute
	privateDataLife       = 5 * time.Minute
	tokenRefreshMargin    = time.Minute
	defaultRefreshFloor   = 30 * time.Second
	tokenEncryptionKeyLen = 32
)

var (
	errGitHubUnauthorized = errors.New("GitHub refused the user's token")
	errConnectionLost     = errors.New("the GitHub connection is no longer valid")
)

// githubAppConfigured is false until the private GitHub App's settings are on the server.
// Without all of them, the opt-in simply isn't offered.
func githubAppConfigured() bool {
	return os.Getenv("GITHUB_APP_CLIENT_ID") != "" && os.Getenv("GITHUB_APP_CLIENT_SECRET") != "" &&
		os.Getenv("GITHUB_APP_SLUG") != "" && encryptionKey() != nil
}

func encryptionKey() []byte {
	key, err := base64.StdEncoding.DecodeString(os.Getenv("TOKEN_ENCRYPTION_KEY"))
	if err != nil || len(key) != tokenEncryptionKeyLen {
		return nil
	}
	return key
}

func tokenCipher() (cipher.AEAD, error) {
	key := encryptionKey()
	if key == nil {
		return nil, errors.New("TOKEN_ENCRYPTION_KEY must be 32 bytes in Base64")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// Binding each token to its user means a value copied to another user's row can't be decrypted.
func tokenBinding(userID int64) []byte {
	return []byte("home-base-github-token:" + strconv.FormatInt(userID, 10))
}

func sealToken(token string, userID int64) (string, error) {
	aead, err := tokenCipher()
	if err != nil {
		return "", err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := aead.Seal(nonce, nonce, []byte(token), tokenBinding(userID))
	return base64.StdEncoding.EncodeToString(sealed), nil
}

func openToken(sealed string, userID int64) (string, error) {
	aead, err := tokenCipher()
	if err != nil {
		return "", err
	}
	data, err := base64.StdEncoding.DecodeString(sealed)
	if err != nil {
		return "", err
	}
	if len(data) < aead.NonceSize() {
		return "", errors.New("the stored token is too short")
	}
	nonce, body := data[:aead.NonceSize()], data[aead.NonceSize():]
	plain, err := aead.Open(nil, nonce, body, tokenBinding(userID))
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

// githubTokens holds a user's decrypted tokens in memory only for as long as a request needs them.
type githubTokens struct {
	Access         string
	AccessExpires  sql.NullTime
	Refresh        string
	RefreshExpires sql.NullTime
}

func nullTime(value sql.NullTime) any {
	if value.Valid {
		return value.Time.UTC()
	}
	return nil
}

func (s *Store) saveGitHubTokens(ctx context.Context, userID int64, tokens githubTokens) error {
	access, err := sealToken(tokens.Access, userID)
	if err != nil {
		return err
	}
	refresh := sql.NullString{}
	if tokens.Refresh != "" {
		sealed, err := sealToken(tokens.Refresh, userID)
		if err != nil {
			return err
		}
		refresh = sql.NullString{String: sealed, Valid: true}
	}
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO user_github_tokens (user_id, access_token, access_expires, refresh_token, refresh_expires)
		 VALUES (?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE access_token = VALUES(access_token), access_expires = VALUES(access_expires),
		   refresh_token = VALUES(refresh_token), refresh_expires = VALUES(refresh_expires)`,
		userID, access, nullTime(tokens.AccessExpires), refresh, nullTime(tokens.RefreshExpires))
	return err
}

// loadGitHubTokens returns nil if the user hasn't connected.
func (s *Store) loadGitHubTokens(ctx context.Context, userID int64) (*githubTokens, error) {
	var sealedAccess string
	var sealedRefresh sql.NullString
	tokens := githubTokens{}
	err := s.db.QueryRowContext(ctx,
		"SELECT access_token, access_expires, refresh_token, refresh_expires FROM user_github_tokens WHERE user_id = ?", userID).
		Scan(&sealedAccess, &tokens.AccessExpires, &sealedRefresh, &tokens.RefreshExpires)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if tokens.Access, err = openToken(sealedAccess, userID); err != nil {
		return nil, fmt.Errorf("%w: stored token can't be decrypted", errConnectionLost)
	}
	if sealedRefresh.Valid {
		if tokens.Refresh, err = openToken(sealedRefresh.String, userID); err != nil {
			return nil, fmt.Errorf("%w: stored token can't be decrypted", errConnectionLost)
		}
	}
	return &tokens, nil
}

func (s *Store) deleteGitHubTokens(ctx context.Context, userID int64) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM user_github_tokens WHERE user_id = ?", userID)
	return err
}

func (s *Store) getGitHubID(ctx context.Context, userID int64) (int64, error) {
	var githubID int64
	err := s.db.QueryRowContext(ctx, "SELECT github_id FROM users WHERE id = ?", userID).Scan(&githubID)
	return githubID, err
}

// requestAppTokens posts to GitHub's token endpoint. Only GitHub's short error code is ever kept,
// so a failure can't put a token or secret in the logs.
func requestAppTokens(ctx context.Context, params map[string]string) (githubTokens, string, error) {
	params["client_id"] = os.Getenv("GITHUB_APP_CLIENT_ID")
	params["client_secret"] = os.Getenv("GITHUB_APP_CLIENT_SECRET")
	body, err := json.Marshal(params)
	if err != nil {
		return githubTokens{}, "", err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		envOr("GITHUB_WEB_URL", "https://github.com")+"/login/oauth/access_token", bytes.NewReader(body))
	if err != nil {
		return githubTokens{}, "", err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")

	response, err := githubClient.Do(request)
	if err != nil {
		return githubTokens{}, "", errors.New("couldn't reach GitHub's token endpoint")
	}
	defer response.Body.Close()

	var result struct {
		AccessToken           string `json:"access_token"`
		ExpiresIn             int64  `json:"expires_in"`
		RefreshToken          string `json:"refresh_token"`
		RefreshTokenExpiresIn int64  `json:"refresh_token_expires_in"`
		Error                 string `json:"error"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return githubTokens{}, "", errors.New("GitHub's token response couldn't be read")
	}
	if result.AccessToken == "" {
		return githubTokens{}, result.Error, fmt.Errorf("GitHub refused the token request: %s", result.Error)
	}

	tokens := githubTokens{Access: result.AccessToken, Refresh: result.RefreshToken}
	if result.ExpiresIn > 0 {
		tokens.AccessExpires = sql.NullTime{Time: time.Now().UTC().Add(time.Duration(result.ExpiresIn) * time.Second), Valid: true}
	}
	if result.RefreshTokenExpiresIn > 0 {
		tokens.RefreshExpires = sql.NullTime{Time: time.Now().UTC().Add(time.Duration(result.RefreshTokenExpiresIn) * time.Second), Valid: true}
	}
	return tokens, "", nil
}

// revokeGrant asks GitHub to withdraw the app's access. It's best effort, because the stored
// token has already been deleted by the time this runs.
func revokeGrant(ctx context.Context, accessToken string) {
	body, err := json.Marshal(map[string]string{"access_token": accessToken})
	if err != nil {
		return
	}
	clientID := os.Getenv("GITHUB_APP_CLIENT_ID")
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete,
		envOr("GITHUB_API_URL", "https://api.github.com")+"/applications/"+url.PathEscape(clientID)+"/grant", bytes.NewReader(body))
	if err != nil {
		return
	}
	request.SetBasicAuth(clientID, os.Getenv("GITHUB_APP_CLIENT_SECRET"))
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "home-base")
	response, err := githubClient.Do(request)
	if err != nil {
		log.Printf("revoking a GitHub grant failed: couldn't reach GitHub")
		return
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		log.Printf("revoking a GitHub grant returned %d", response.StatusCode)
	}
}

// userLocks makes sure only one request refreshes a user's token at a time. GitHub's refresh
// tokens work once, so two refreshing together would lose the connection.
type userLocks struct {
	mutex sync.Mutex
	locks map[int64]*sync.Mutex
}

func (l *userLocks) lock(userID int64) func() {
	l.mutex.Lock()
	lock, found := l.locks[userID]
	if !found {
		lock = &sync.Mutex{}
		l.locks[userID] = lock
	}
	l.mutex.Unlock()
	lock.Lock()
	return lock.Unlock
}

// validAccessToken returns "" if the user hasn't connected, and errConnectionLost if they need to reconnect.
func (a *App) validAccessToken(ctx context.Context, userID int64) (string, error) {
	unlock := a.dev.tokenLocks.lock(userID)
	defer unlock()

	tokens, err := a.store.loadGitHubTokens(ctx, userID)
	if err != nil || tokens == nil {
		return "", err
	}
	if !tokens.AccessExpires.Valid || time.Now().Add(tokenRefreshMargin).Before(tokens.AccessExpires.Time) {
		return tokens.Access, nil
	}
	if tokens.Refresh == "" || (tokens.RefreshExpires.Valid && !time.Now().Before(tokens.RefreshExpires.Time)) {
		return "", errConnectionLost
	}

	refreshed, code, err := requestAppTokens(ctx, map[string]string{"grant_type": "refresh_token", "refresh_token": tokens.Refresh})
	if err != nil {
		if code != "" {
			return "", errConnectionLost
		}
		return "", err
	}
	if err := a.store.saveGitHubTokens(ctx, userID, refreshed); err != nil {
		return "", err
	}
	return refreshed.Access, nil
}

type connectState struct {
	userID int64
}

func (a *App) handleGitHubConnectStart(w http.ResponseWriter, r *http.Request, current session) {
	if !githubAppConfigured() {
		writeError(w, http.StatusServiceUnavailable, "Private GitHub access isn't set up on this server.")
		return
	}
	if a.starts.exceeded(clientIP(r)) {
		writeError(w, http.StatusTooManyRequests, "Too many attempts. Try again in 15 minutes.")
		return
	}
	state, err := randomHex(32)
	if err != nil {
		writeServerError(w, err)
		return
	}
	a.dev.connectStates.put(state, connectState{userID: current.userID}, connectStateLife)

	// The cookie ties GitHub's response to this browser. Without it, an attacker could start the
	// flow on their own account and trick someone else into completing it.
	http.SetCookie(w, connectCookieWith(state, int(connectStateLife.Seconds())))
	params := url.Values{
		"client_id":    {os.Getenv("GITHUB_APP_CLIENT_ID")},
		"redirect_uri": {connectCallbackURL()},
		"state":        {state},
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"url": envOr("GITHUB_WEB_URL", "https://github.com") + "/login/oauth/authorize?" + params.Encode(),
	})
}

func connectCookieWith(value string, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name:     connectCookie,
		Value:    value,
		Path:     connectCookiePath,
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	}
}

func connectCallbackURL() string {
	return publicURL() + connectCookiePath + "/callback"
}

func installURL() string {
	return envOr("GITHUB_WEB_URL", "https://github.com") + "/apps/" + url.PathEscape(os.Getenv("GITHUB_APP_SLUG")) + "/installations/new"
}

func (a *App) handleGitHubConnectCallback(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	finish := func(result string) {
		http.Redirect(w, r, withParams(homePage(), "github", result), http.StatusFound)
	}

	state := query.Get("state")
	pending, found := a.dev.connectStates.take(state)
	cookieValue := ""
	if cookie, err := r.Cookie(connectCookie); err == nil {
		cookieValue = cookie.Value
	}
	http.SetCookie(w, connectCookieWith("", -1))

	if !found || cookieValue == "" || !sameText(state, cookieValue) {
		finish("failed")
		return
	}
	if query.Get("error") != "" {
		finish("cancelled")
		return
	}

	ctx := r.Context()
	tokens, _, err := requestAppTokens(ctx, map[string]string{"code": query.Get("code"), "redirect_uri": connectCallbackURL()})
	if err != nil {
		log.Printf("connecting GitHub failed: %v", err)
		finish("failed")
		return
	}

	// A token is only kept if it belongs to the same GitHub account the user signed in with.
	var identity struct {
		ID int64 `json:"id"`
	}
	if err := githubGetAs(ctx, tokens.Access, "/user", &identity); err != nil {
		log.Printf("connecting GitHub failed: %v", err)
		finish("failed")
		return
	}
	expected, err := a.store.getGitHubID(ctx, pending.userID)
	if err != nil {
		log.Printf("connecting GitHub failed: %v", err)
		finish("failed")
		return
	}
	if identity.ID != expected {
		revokeGrant(ctx, tokens.Access)
		finish("wrong_account")
		return
	}

	if err := a.store.saveGitHubTokens(ctx, pending.userID, tokens); err != nil {
		log.Printf("saving a GitHub connection failed: %v", err)
		finish("failed")
		return
	}
	a.dev.private.forget(privateCacheKey(pending.userID))

	// Private repositories are only visible once the app is installed on them.
	var installations struct {
		TotalCount int `json:"total_count"`
	}
	if err := githubGetAs(ctx, tokens.Access, "/user/installations?per_page=1", &installations); err == nil && installations.TotalCount == 0 {
		http.Redirect(w, r, installURL(), http.StatusFound)
		return
	}
	finish("connected")
}

func privateCacheKey(userID int64) string {
	return "user:" + strconv.FormatInt(userID, 10)
}

func (a *App) handleGitHubDisconnect(w http.ResponseWriter, r *http.Request, current session) {
	ctx := r.Context()
	unlock := a.dev.tokenLocks.lock(current.userID)
	defer unlock()

	tokens, loadErr := a.store.loadGitHubTokens(ctx, current.userID)
	if err := a.store.deleteGitHubTokens(ctx, current.userID); err != nil {
		writeServerError(w, err)
		return
	}
	a.dev.private.forget(privateCacheKey(current.userID))
	if loadErr == nil && tokens != nil {
		revokeGrant(context.WithoutCancel(ctx), tokens.Access)
	}
	writeOK(w)
}

func refreshFloor() time.Duration {
	if seconds, err := strconv.Atoi(os.Getenv("GITHUB_REFRESH_FLOOR_SECONDS")); err == nil && seconds >= 0 {
		return time.Duration(seconds) * time.Second
	}
	return defaultRefreshFloor
}

// handleDevGitHub serves private data to connected users, and public data to everyone else or if
// the connection has stopped working. Private and public data are cached separately.
func (a *App) handleDevGitHub(w http.ResponseWriter, r *http.Request, current session) {
	ctx := r.Context()
	user, err := a.store.getUser(ctx, current.userID)
	if err != nil {
		writeServerError(w, err)
		return
	}
	fresh := r.URL.Query().Get("fresh") == "1"

	response := map[string]any{
		"available":      githubAppConfigured(),
		"connected":      false,
		"needsReconnect": false,
	}
	if githubAppConfigured() {
		response["manageUrl"] = installURL()
		token, tokenErr := a.validAccessToken(ctx, current.userID)
		switch {
		case errors.Is(tokenErr, errConnectionLost):
			a.dropConnection(ctx, current.userID)
			response["needsReconnect"] = true
		case tokenErr != nil:
			log.Printf("GitHub connection: %v", tokenErr)
		case token != "":
			key := privateCacheKey(current.userID)
			if fresh {
				a.dev.private.forgetOlderThan(key, refreshFloor())
			}
			unauthorized := false
			dashboard, fetchedAt, fetchErr := a.dev.private.get(key, privateDataLife, func() (GitHubDashboard, error) {
				data, err := fetchGitHubDashboard(ctx, user.Login, token)
				unauthorized = errors.Is(err, errGitHubUnauthorized)
				return data, err
			})
			if unauthorized {
				a.dropConnection(ctx, current.userID)
				response["needsReconnect"] = true
			} else if fetchErr == nil {
				response["data"] = dashboard
				response["fetchedAt"] = fetchedAt
				response["connected"] = true
				writeJSON(w, http.StatusOK, response)
				return
			} else {
				log.Printf("GitHub dashboard failed: %v", fetchErr)
			}
		}
	}

	key := "public:" + user.Login
	if fresh {
		a.dev.github.forgetOlderThan(key, refreshFloor())
	}
	dashboard, fetchedAt, err := a.dev.github.get(key, githubDataLife, func() (GitHubDashboard, error) {
		return fetchGitHubDashboard(ctx, user.Login, "")
	})
	if err != nil {
		log.Printf("GitHub dashboard failed: %v", err)
		writeError(w, http.StatusBadGateway, "GitHub data isn't available right now.")
		return
	}
	response["data"] = dashboard
	response["fetchedAt"] = fetchedAt
	writeJSON(w, http.StatusOK, response)
}

func (a *App) dropConnection(ctx context.Context, userID int64) {
	if err := a.store.deleteGitHubTokens(ctx, userID); err != nil {
		log.Printf("removing a lost GitHub connection failed: %v", err)
	}
	a.dev.private.forget(privateCacheKey(userID))
}
