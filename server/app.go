package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	limitWindow      = 15 * time.Minute
	maxStartsPerIP   = 30
	loginStateLife   = 10 * time.Minute
	loginCodeLife    = time.Minute
	defaultMaxUsers  = 200
	maxJSONBody      = 256 * 1024
	maxBackgroundLen = 480 * 1024
	stateCookie      = "oauth_state"
	stateCookiePath  = "/auth/github"
	immutablePrefix  = "/_next/static/"
	// Scripts stay limited to this site's own files. Inline styles are allowed because the
	// interface libraries add them at runtime, and they can't run code.
	contentSecurity = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
)

const maxGroupsBody = 480 * 1024

var (
	challengePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
	bearerPattern    = regexp.MustCompile(`^Bearer ([0-9a-f]{64})$`)
)

func randomHex(size int) (string, error) {
	buffer := make([]byte, size)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return hex.EncodeToString(buffer), nil
}

// expiring is a small map of short-lived values. Pending logins live in memory:
// a restart only means someone mid-sign-in has to try again.
type expiring[T any] struct {
	mutex   sync.Mutex
	entries map[string]expiringEntry[T]
}

type expiringEntry[T any] struct {
	value     T
	expiresAt time.Time
}

func newExpiring[T any]() *expiring[T] {
	return &expiring[T]{entries: map[string]expiringEntry[T]{}}
}

func (e *expiring[T]) put(key string, value T, life time.Duration) {
	e.mutex.Lock()
	defer e.mutex.Unlock()
	now := time.Now()
	for existing, entry := range e.entries {
		if !entry.expiresAt.After(now) {
			delete(e.entries, existing)
		}
	}
	e.entries[key] = expiringEntry[T]{value: value, expiresAt: now.Add(life)}
}

// take returns a value at most once.
func (e *expiring[T]) take(key string) (T, bool) {
	e.mutex.Lock()
	defer e.mutex.Unlock()
	var empty T
	entry, found := e.entries[key]
	delete(e.entries, key)
	if !found || !entry.expiresAt.After(time.Now()) {
		return empty, false
	}
	return entry.value, true
}

type startCounter struct {
	count     int
	expiresAt time.Time
}

type startLimiter struct {
	mutex  sync.Mutex
	counts map[string]startCounter
}

func (l *startLimiter) exceeded(ip string) bool {
	l.mutex.Lock()
	defer l.mutex.Unlock()
	now := time.Now()
	for key, counter := range l.counts {
		if !counter.expiresAt.After(now) {
			delete(l.counts, key)
		}
	}
	counter, found := l.counts[ip]
	if !found {
		counter = startCounter{expiresAt: now.Add(limitWindow)}
	}
	counter.count++
	l.counts[ip] = counter
	return counter.count > maxStartsPerIP
}

type loginState struct {
	challenge string
	target    string
}

type loginCode struct {
	userID    int64
	challenge string
}

// App holds what the request handlers share.
type App struct {
	store     *Store
	publicDir string
	states    *expiring[loginState]
	codes     *expiring[loginCode]
	starts    *startLimiter
}

func newApp(store *Store, publicDir string) *App {
	return &App{
		store:     store,
		publicDir: publicDir,
		states:    newExpiring[loginState](),
		codes:     newExpiring[loginCode](),
		starts:    &startLimiter{counts: map[string]startCounter{}},
	}
}

func (a *App) routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /auth/github/start", noStore(a.handleLoginStart))
	mux.HandleFunc("GET /auth/github/callback", noStore(a.handleLoginCallback))

	mux.HandleFunc("GET /api/health", noStore(a.handleHealth))
	mux.HandleFunc("GET /api/config", noStore(a.handleConfig))
	mux.HandleFunc("POST /api/auth/exchange", noStore(a.handleExchange))
	mux.HandleFunc("POST /api/logout", a.signedIn(a.handleLogout))
	mux.HandleFunc("GET /api/groups", a.signedIn(a.handleGetGroups))
	mux.HandleFunc("PUT /api/groups", a.signedIn(a.handlePutGroups))
	mux.HandleFunc("POST /api/groups/reset", a.signedIn(a.handleResetGroups))
	mux.HandleFunc("PUT /api/preferences", a.signedIn(a.handlePutPreferences))
	mux.HandleFunc("GET /api/background", a.signedIn(a.handleGetBackground))
	mux.HandleFunc("PUT /api/background", a.signedIn(a.handlePutBackground))
	mux.HandleFunc("DELETE /api/background", a.signedIn(a.handleDeleteBackground))

	mux.HandleFunc("GET /api/admin/overview", a.adminOnly(a.handleAdminOverview))
	mux.HandleFunc("POST /api/admin/users/{id}/sign-out", a.adminOnly(a.handleAdminSignOut))
	mux.HandleFunc("POST /api/admin/users/{id}/disable", a.adminOnly(a.handleAdminDisable))
	mux.HandleFunc("POST /api/admin/users/{id}/enable", a.adminOnly(a.handleAdminEnable))
	mux.HandleFunc("DELETE /api/admin/users/{id}", a.adminOnly(a.handleAdminDelete))

	mux.HandleFunc("/api/", noStore(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "Not found.")
	}))
	mux.Handle("/", a.staticFiles())

	return securityHeaders(mux)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		headers := w.Header()
		headers.Set("Content-Security-Policy", contentSecurity)
		headers.Set("X-Content-Type-Options", "nosniff")
		headers.Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

func (a *App) isFile(requestPath string) bool {
	info, err := os.Stat(filepath.Join(a.publicDir, filepath.FromSlash(path.Clean(requestPath))))
	return err == nil && !info.IsDir()
}

// staticFiles serves the exported Next.js site. Clean addresses like /newtab map to newtab.html,
// folders are never listed, and anything else gets the site's 404 page.
func (a *App) staticFiles() http.Handler {
	files := http.FileServer(http.Dir(a.publicDir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestPath := r.URL.Path
		switch {
		case requestPath == "/" || a.isFile(requestPath):
		case a.isFile(requestPath + ".html"):
			r.URL.Path = requestPath + ".html"
		default:
			w.Header().Set("Cache-Control", "no-cache")
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusNotFound)
			if page, err := os.ReadFile(filepath.Join(a.publicDir, "404.html")); err == nil {
				if _, err := w.Write(page); err != nil {
					log.Printf("write 404 page: %v", err)
				}
			}
			return
		}

		// Files under this folder have their contents in their names, so they can be kept forever.
		if strings.HasPrefix(requestPath, immutablePrefix) {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		files.ServeHTTP(w, r)
	})
}

func noStore(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		next(w, r)
	}
}

type authedHandler func(w http.ResponseWriter, r *http.Request, session session)

type session struct {
	token  string
	userID int64
}

func (a *App) signedIn(next authedHandler) http.HandlerFunc {
	return noStore(func(w http.ResponseWriter, r *http.Request) {
		match := bearerPattern.FindStringSubmatch(r.Header.Get("Authorization"))
		if match == nil {
			writeError(w, http.StatusUnauthorized, "Please sign in.")
			return
		}
		userID, err := a.store.findSessionUser(r.Context(), match[1])
		if err != nil {
			writeServerError(w, err)
			return
		}
		if userID == 0 {
			writeError(w, http.StatusUnauthorized, "Please sign in.")
			return
		}
		next(w, r, session{token: match[1], userID: userID})
	})
}

func (a *App) adminOnly(next authedHandler) http.HandlerFunc {
	return a.signedIn(func(w http.ResponseWriter, r *http.Request, current session) {
		isAdmin, err := a.store.isAdmin(r.Context(), current.userID)
		if err != nil {
			writeServerError(w, err)
			return
		}
		if !isAdmin {
			writeError(w, http.StatusForbidden, "This account doesn't have admin access.")
			return
		}
		next(w, r, current)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("write response: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeServerError(w http.ResponseWriter, err error) {
	log.Printf("request failed: %v", err)
	writeError(w, http.StatusInternalServerError, "The server had a problem.")
}

func writeOK(w http.ResponseWriter) {
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// readJSON reports a problem to the client and returns false if the body can't be used.
func readJSON(w http.ResponseWriter, r *http.Request, target any, invalidMessage string) bool {
	return readJSONWithin(w, r, target, invalidMessage, maxJSONBody)
}

func readJSONWithin(w http.ResponseWriter, r *http.Request, target any, invalidMessage string, limit int64) bool {
	body := http.MaxBytesReader(w, r.Body, limit)
	if err := json.NewDecoder(body).Decode(target); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, "That request was too large.")
		} else {
			writeError(w, http.StatusBadRequest, invalidMessage)
		}
		return false
	}
	return true
}

func publicURL() string {
	return envOr("PUBLIC_URL", "https://chrome.ruhul0.com")
}

func callbackURL() string {
	return publicURL() + "/auth/github/callback"
}

func homePage() string {
	return publicURL() + "/newtab.html"
}

func withParams(target string, key, value string) string {
	return target + "?" + url.Values{key: {value}}.Encode()
}

// loginTarget only ever returns this website or an approved extension, never an address from the request.
func loginTarget(r *http.Request) string {
	query := r.URL.Query()
	if query.Get("client") != "extension" {
		return homePage()
	}
	id := query.Get("extension_id")
	for _, approved := range strings.Split(os.Getenv("EXTENSION_IDS"), ",") {
		if approved = strings.TrimSpace(approved); approved != "" && approved == id {
			return "https://" + id + ".chromiumapp.org/"
		}
	}
	return ""
}

func isOwner(login string) bool {
	return strings.EqualFold(login, os.Getenv("OWNER_GITHUB_LOGIN"))
}

// isAdminProfile prefers the numeric GitHub ID, which never changes, unlike a username,
// which someone else could claim if it's released.
func isAdminProfile(profile *GitHubProfile) bool {
	if adminID := os.Getenv("ADMIN_GITHUB_ID"); adminID != "" && adminID == strconv.FormatInt(profile.ID, 10) {
		return true
	}
	adminEmail := os.Getenv("ADMIN_EMAIL")
	return adminEmail != "" && profile.PublicEmail != "" && strings.EqualFold(profile.PublicEmail, adminEmail)
}

// isAllowed treats an empty list as anyone with a GitHub account, up to the user limit.
func isAllowed(login string) bool {
	allowed := []string{}
	for _, name := range strings.Split(os.Getenv("ALLOWED_GITHUB_LOGINS"), ",") {
		if name = strings.TrimSpace(name); name != "" {
			allowed = append(allowed, strings.ToLower(name))
		}
	}
	return len(allowed) == 0 || slices.Contains(allowed, strings.ToLower(login))
}

func maxUsers() int {
	if limit, err := strconv.Atoi(os.Getenv("MAX_USERS")); err == nil && limit > 0 {
		return limit
	}
	return defaultMaxUsers
}

func clientIP(r *http.Request) string {
	// The app listens only on localhost, so this header can only come from nginx.
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	return r.RemoteAddr
}

func stateCookieWith(value string, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name:     stateCookie,
		Value:    value,
		Path:     stateCookiePath,
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	}
}

func (a *App) handleLoginStart(w http.ResponseWriter, r *http.Request) {
	challenge := r.URL.Query().Get("challenge")
	target := loginTarget(r)
	if target == "" || !challengePattern.MatchString(challenge) {
		writeError(w, http.StatusBadRequest, "That sign-in request was not valid.")
		return
	}
	if a.starts.exceeded(clientIP(r)) {
		http.Redirect(w, r, withParams(target, "error", "busy"), http.StatusFound)
		return
	}
	if !githubConfigured() {
		http.Redirect(w, r, withParams(target, "error", "not_configured"), http.StatusFound)
		return
	}

	state, err := randomHex(32)
	if err != nil {
		writeServerError(w, err)
		return
	}
	a.states.put(state, loginState{challenge: challenge, target: target}, loginStateLife)

	// The cookie ties the GitHub response to this browser, which stops someone
	// tricking a visitor into signing in to the wrong account.
	http.SetCookie(w, stateCookieWith(state, int(loginStateLife.Seconds())))
	http.Redirect(w, r, githubAuthorizeURL(state, callbackURL()), http.StatusFound)
}

func sameText(left, right string) bool {
	return subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1
}

func (a *App) handleLoginCallback(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	state := query.Get("state")
	pending, found := a.states.take(state)

	cookieValue := ""
	if cookie, err := r.Cookie(stateCookie); err == nil {
		cookieValue = cookie.Value
	}
	http.SetCookie(w, stateCookieWith("", -1))

	if !found || cookieValue == "" || !sameText(state, cookieValue) {
		http.Redirect(w, r, withParams(homePage(), "error", "failed"), http.StatusFound)
		return
	}
	finish := func(key, value string) {
		http.Redirect(w, r, withParams(pending.target, key, value), http.StatusFound)
	}
	if query.Get("error") != "" {
		finish("error", "denied")
		return
	}

	profile, err := fetchGitHubProfile(r.Context(), query.Get("code"), callbackURL())
	if err != nil {
		log.Printf("GitHub sign-in failed: %v", err)
		finish("error", "failed")
		return
	}
	if !isAllowed(profile.Login) {
		finish("error", "not_allowed")
		return
	}

	user, err := a.store.findOrCreateUser(r.Context(), SignIn{
		GitHubID: profile.ID,
		Login:    profile.Login,
		IsOwner:  isOwner(profile.Login),
		IsAdmin:  isAdminProfile(profile),
		MaxUsers: maxUsers(),
	})
	if err != nil {
		log.Printf("saving user failed: %v", err)
		finish("error", "failed")
		return
	}
	if user == nil {
		finish("error", "full")
		return
	}
	if user.Disabled {
		finish("error", "not_allowed")
		return
	}

	code, err := randomHex(32)
	if err != nil {
		log.Printf("creating sign-in code failed: %v", err)
		finish("error", "failed")
		return
	}
	a.codes.put(code, loginCode{userID: user.ID, challenge: pending.challenge}, loginCodeLife)
	finish("code", code)
}

func (a *App) handleExchange(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code     string `json:"code"`
		Verifier string `json:"verifier"`
	}
	if !readJSON(w, r, &body, "That sign-in has expired. Try again.") {
		return
	}
	entry, found := a.codes.take(body.Code)
	digest := sha256.Sum256([]byte(body.Verifier))
	challenge := base64.RawURLEncoding.EncodeToString(digest[:])
	if !found || body.Verifier == "" || !sameText(challenge, entry.challenge) {
		writeError(w, http.StatusBadRequest, "That sign-in has expired. Try again.")
		return
	}
	token, err := a.store.createSession(r.Context(), entry.userID)
	if err != nil {
		writeServerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"token": token})
}

func (a *App) handleHealth(w http.ResponseWriter, r *http.Request) {
	if err := a.store.ping(r.Context()); err != nil {
		writeServerError(w, err)
		return
	}
	writeOK(w)
}

func extensionURL() *string {
	if value := os.Getenv("EXTENSION_URL"); value != "" {
		return &value
	}
	return nil
}

func (a *App) handleConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]*string{"extensionUrl": extensionURL()})
}

func (a *App) handleLogout(w http.ResponseWriter, r *http.Request, current session) {
	if err := a.store.deleteSession(r.Context(), current.token); err != nil {
		writeServerError(w, err)
		return
	}
	writeOK(w)
}

func (a *App) handleGetGroups(w http.ResponseWriter, r *http.Request, current session) {
	ctx := r.Context()
	groups, err := a.store.getGroups(ctx, current.userID)
	if err != nil {
		writeServerError(w, err)
		return
	}
	user, err := a.store.getUser(ctx, current.userID)
	if err != nil {
		writeServerError(w, err)
		return
	}
	backgroundVersion, err := a.store.getBackgroundVersion(ctx, current.userID)
	if err != nil {
		writeServerError(w, err)
		return
	}
	if err := a.store.touchUser(ctx, current.userID); err != nil {
		writeServerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"groups":            groups,
		"user":              map[string]any{"login": user.Login, "isAdmin": user.IsAdmin},
		"preferences":       user.Preferences,
		"backgroundVersion": backgroundVersion,
		"extensionUrl":      extensionURL(),
	})
}

func (a *App) handlePutGroups(w http.ResponseWriter, r *http.Request, current session) {
	const invalid = "Those sites could not be saved."
	var body struct {
		Groups []Group `json:"groups"`
	}
	// Custom icons travel with the sites. This limit stays under nginx's 512 KB request limit.
	if !readJSONWithin(w, r, &body, invalid, maxGroupsBody) {
		return
	}
	groups, ok := cleanGroups(body.Groups)
	if !ok {
		writeError(w, http.StatusBadRequest, invalid)
		return
	}
	if err := a.store.replaceGroups(r.Context(), current.userID, groups); err != nil {
		writeServerError(w, err)
		return
	}
	writeOK(w)
}

func (a *App) handleResetGroups(w http.ResponseWriter, r *http.Request, current session) {
	ctx := r.Context()
	if err := a.store.replaceGroups(ctx, current.userID, starterGroups()); err != nil {
		writeServerError(w, err)
		return
	}
	groups, err := a.store.getGroups(ctx, current.userID)
	if err != nil {
		writeServerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"groups": groups})
}

func (a *App) handlePutPreferences(w http.ResponseWriter, r *http.Request, current session) {
	const invalid = "Those design choices could not be saved."
	var body struct {
		Preferences map[string]any `json:"preferences"`
	}
	if !readJSON(w, r, &body, invalid) {
		return
	}
	preferences, ok := cleanPreferences(body.Preferences)
	if !ok {
		writeError(w, http.StatusBadRequest, invalid)
		return
	}
	if err := a.store.setPreferences(r.Context(), current.userID, preferences); err != nil {
		writeServerError(w, err)
		return
	}
	writeOK(w)
}

func (a *App) handleGetBackground(w http.ResponseWriter, r *http.Request, current session) {
	background, err := a.store.getBackground(r.Context(), current.userID)
	if err != nil {
		writeServerError(w, err)
		return
	}
	if background == nil {
		writeError(w, http.StatusNotFound, "No background image.")
		return
	}
	w.Header().Set("Content-Type", background.ContentType)
	if _, err := w.Write(background.Image); err != nil {
		log.Printf("write background: %v", err)
	}
}

func (a *App) handlePutBackground(w http.ResponseWriter, r *http.Request, current session) {
	image, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBackgroundLen))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, "That image is too large.")
		} else {
			writeError(w, http.StatusBadRequest, "That image could not be read.")
		}
		return
	}
	contentType := detectImageType(image)
	if contentType == "" {
		writeError(w, http.StatusBadRequest, "That file is not a JPEG, PNG or WebP image.")
		return
	}
	version, err := a.store.setBackground(r.Context(), current.userID, contentType, image)
	if err != nil {
		writeServerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"version": version})
}

func (a *App) handleDeleteBackground(w http.ResponseWriter, r *http.Request, current session) {
	if err := a.store.deleteBackground(r.Context(), current.userID); err != nil {
		writeServerError(w, err)
		return
	}
	writeOK(w)
}

func (a *App) handleAdminOverview(w http.ResponseWriter, r *http.Request, current session) {
	totals, users, err := a.store.getAdminOverview(r.Context())
	if err != nil {
		writeServerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"totals":        totals,
		"users":         users,
		"currentUserId": current.userID,
	})
}

func targetUserID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "That user is not valid.")
		return 0, false
	}
	return id, true
}

// otherUserID stops admins disabling or deleting themselves, which would lock everyone out of the dashboard.
func otherUserID(w http.ResponseWriter, r *http.Request, current session) (int64, bool) {
	id, ok := targetUserID(w, r)
	if !ok {
		return 0, false
	}
	if id == current.userID {
		writeError(w, http.StatusBadRequest, "You can't do that to your own account.")
		return 0, false
	}
	return id, true
}

func (a *App) handleAdminSignOut(w http.ResponseWriter, r *http.Request, current session) {
	id, ok := targetUserID(w, r)
	if !ok {
		return
	}
	if err := a.store.deleteUserSessions(r.Context(), id); err != nil {
		writeServerError(w, err)
		return
	}
	writeOK(w)
}

func (a *App) setDisabled(ctx context.Context, w http.ResponseWriter, adminID, id int64, disabled bool) {
	if err := a.store.setUserDisabled(ctx, id, disabled); err != nil {
		writeServerError(w, err)
		return
	}
	log.Printf("Admin %d set user %d disabled=%t", adminID, id, disabled)
	writeOK(w)
}

func (a *App) handleAdminDisable(w http.ResponseWriter, r *http.Request, current session) {
	if id, ok := otherUserID(w, r, current); ok {
		a.setDisabled(r.Context(), w, current.userID, id, true)
	}
}

func (a *App) handleAdminEnable(w http.ResponseWriter, r *http.Request, current session) {
	if id, ok := targetUserID(w, r); ok {
		a.setDisabled(r.Context(), w, current.userID, id, false)
	}
}

func (a *App) handleAdminDelete(w http.ResponseWriter, r *http.Request, current session) {
	id, ok := otherUserID(w, r, current)
	if !ok {
		return
	}
	deleted, err := a.store.deleteUser(r.Context(), id)
	if err != nil {
		writeServerError(w, err)
		return
	}
	if !deleted {
		writeError(w, http.StatusNotFound, "That user no longer exists.")
		return
	}
	log.Printf("Admin %d deleted user %d", current.userID, id)
	writeOK(w)
}
