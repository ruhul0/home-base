package main

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestIsBlockedAddress(t *testing.T) {
	blocked := []string{
		"127.0.0.1", "10.0.0.8", "172.17.0.2", "192.168.1.1", "169.254.169.254", "100.64.0.1",
		"0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fc00::1", "::",
	}
	for _, address := range blocked {
		if !isBlockedAddress(net.ParseIP(address)) {
			t.Errorf("%s should be blocked", address)
		}
	}
	for _, address := range []string{"1.1.1.1", "8.8.8.8", "76.13.240.163", "2606:4700:4700::1111"} {
		if isBlockedAddress(net.ParseIP(address)) {
			t.Errorf("%s should be allowed", address)
		}
	}
}

// The local test server stands in for a private service that a user tries to reach.
func TestMonitorRefusesPrivateServices(t *testing.T) {
	reached := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reached = true
	}))
	defer server.Close()

	result := newDevServices().check(context.Background(), server.URL)
	if reached {
		t.Fatal("the monitor connected to a private service")
	}
	if result.Up || result.Problem != "Private addresses and non-web ports can't be monitored." {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestMonitorRefusesRedirectToPrivateService(t *testing.T) {
	t.Setenv("MONITOR_ALLOW_PRIVATE", "true")
	reached := false
	inner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reached = true
	}))
	defer inner.Close()
	outer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The guard switches on for the second connection, as it would for a public first address.
		t.Setenv("MONITOR_ALLOW_PRIVATE", "false")
		http.Redirect(w, r, inner.URL, http.StatusFound)
	}))
	defer outer.Close()

	result := newDevServices().check(context.Background(), outer.URL)
	if reached {
		t.Fatal("a redirect reached a private service")
	}
	if result.Up {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestCleanWorkspace(t *testing.T) {
	_, ok := cleanWorkspace(Workspace{Monitors: []Monitor{{Name: "Bad", URL: "javascript:alert(1)"}}})
	if ok {
		t.Error("a script address should be refused")
	}
	_, ok = cleanWorkspace(Workspace{Monitors: []Monitor{{Name: "File", URL: "file:///etc/passwd"}}})
	if ok {
		t.Error("a file address should be refused")
	}
	_, ok = cleanWorkspace(Workspace{Todos: []Todo{{Text: "   "}}})
	if ok {
		t.Error("an empty todo should be refused")
	}
	cleaned, ok := cleanWorkspace(Workspace{
		Monitors: []Monitor{{Name: " Site ", URL: "https://example.com/"}},
		Todos:    []Todo{{Text: " Ship it ", Done: true}},
		Notes:    "hello",
	})
	if !ok || cleaned.Monitors[0].Name != "Site" || cleaned.Todos[0].Text != "Ship it" || !cleaned.Todos[0].Done {
		t.Errorf("unexpected workspace: %+v", cleaned)
	}
}

func TestCachedServesLastGoodValueAfterFailure(t *testing.T) {
	cache := newCached[int]()
	value, _, err := cache.get("key", 0, func() (int, error) { return 7, nil })
	if err != nil || value != 7 {
		t.Fatalf("first fetch: %d, %v", value, err)
	}
	value, _, err = cache.get("key", 0, func() (int, error) { return 0, context.DeadlineExceeded })
	if err != nil || value != 7 {
		t.Fatalf("after failure: %d, %v", value, err)
	}
}

func TestParseRDAPExpiry(t *testing.T) {
	date, ok := parseRDAPExpiry([]byte(`{"events":[{"eventAction":"registration","eventDate":"2020-01-01T00:00:00Z"},{"eventAction":"expiration","eventDate":"2027-03-04T05:06:07Z"}]}`))
	if !ok || date.Format("2006-01-02") != "2027-03-04" {
		t.Fatalf("got %v, %v", date, ok)
	}
	for _, body := range []string{`{}`, `not json`, `{"events":[{"eventAction":"expiration","eventDate":"soon"}]}`} {
		if _, ok := parseRDAPExpiry([]byte(body)); ok {
			t.Errorf("%q should have no date", body)
		}
	}
}

func TestCertificateExpiryReadsTheServersCertificate(t *testing.T) {
	t.Setenv("MONITOR_ALLOW_PRIVATE", "true")
	server := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()
	host, port, err := net.SplitHostPort(server.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	expiry := newDevServices().certificateExpiry(context.Background(), host, port)
	if !expiry.Valid || !expiry.Time.Equal(server.Certificate().NotAfter) {
		t.Fatalf("got %v, want %v", expiry, server.Certificate().NotAfter)
	}
}

func TestCertificateCheckRefusesPrivateAddresses(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()
	host, port, _ := net.SplitHostPort(server.Listener.Addr().String())
	if expiry := newDevServices().certificateExpiry(context.Background(), host, port); expiry.Valid {
		t.Fatal("a certificate check reached a private address")
	}
}

func TestCleanProjectsAndCommands(t *testing.T) {
	good := Project{ID: "a-1", Name: "Site", URL: "https://example.com/", Repo: "owner/repo"}
	if _, ok := cleanProjects([]Project{good}); !ok {
		t.Error("a valid project should pass")
	}
	for _, bad := range []Project{
		{ID: "<x>", Name: "Site", URL: "https://example.com/"},
		{ID: "a", Name: "", URL: "https://example.com/"},
		{ID: "a", Name: "Site", URL: "javascript:alert(1)"},
		{ID: "a", Name: "Site", URL: "https://example.com/", Staging: "file:///etc/passwd"},
		{ID: "a", Name: "Site", URL: "https://example.com/", Repo: "not a repo"},
		{ID: "a", Name: "Site", URL: "https://example.com/", Repo: "../../etc/passwd"},
	} {
		if _, ok := cleanProjects([]Project{bad}); ok {
			t.Errorf("%+v should be refused", bad)
		}
	}
	if _, ok := cleanCommands([]SavedCommand{{ID: "a", Name: "Logs", Command: "docker logs"}}); !ok {
		t.Error("a valid command should pass")
	}
	if _, ok := cleanCommands([]SavedCommand{{ID: "a", Name: "Logs", Command: "  "}}); ok {
		t.Error("an empty command should be refused")
	}
}
