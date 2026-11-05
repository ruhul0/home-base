package main

import (
	"encoding/base64"
	"strings"
	"testing"
)

func useTestKey(t *testing.T) {
	t.Helper()
	t.Setenv("TOKEN_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", tokenEncryptionKeyLen))))
}

func TestTokenEncryptionRoundTrip(t *testing.T) {
	useTestKey(t)
	sealed, err := sealToken("ghu_secret", 7)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(sealed, "ghu_secret") {
		t.Fatal("the sealed value contains the token")
	}
	plain, err := openToken(sealed, 7)
	if err != nil || plain != "ghu_secret" {
		t.Fatalf("got %q, %v", plain, err)
	}
}

func TestSameTokenEncryptsDifferentlyEachTime(t *testing.T) {
	useTestKey(t)
	first, _ := sealToken("ghu_secret", 7)
	second, _ := sealToken("ghu_secret", 7)
	if first == second {
		t.Fatal("encrypting twice should use different nonces")
	}
}

func TestTokenCannotBeMovedToAnotherUser(t *testing.T) {
	useTestKey(t)
	sealed, _ := sealToken("ghu_secret", 7)
	if _, err := openToken(sealed, 8); err == nil {
		t.Fatal("a token sealed for one user opened for another")
	}
}

func TestTamperedTokenIsRefused(t *testing.T) {
	useTestKey(t)
	sealed, _ := sealToken("ghu_secret", 7)
	data, _ := base64.StdEncoding.DecodeString(sealed)
	data[len(data)-1] ^= 1
	if _, err := openToken(base64.StdEncoding.EncodeToString(data), 7); err == nil {
		t.Fatal("a changed token was accepted")
	}
}

func TestWrongKeyIsRefused(t *testing.T) {
	useTestKey(t)
	sealed, _ := sealToken("ghu_secret", 7)
	t.Setenv("TOKEN_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString([]byte(strings.Repeat("z", tokenEncryptionKeyLen))))
	if _, err := openToken(sealed, 7); err == nil {
		t.Fatal("a different key opened the token")
	}
}

func TestPrivateAccessStaysOffWithoutFullSetup(t *testing.T) {
	t.Setenv("GITHUB_APP_CLIENT_ID", "id")
	t.Setenv("GITHUB_APP_CLIENT_SECRET", "secret")
	t.Setenv("GITHUB_APP_SLUG", "slug")
	for _, key := range []string{"", "too-short", base64.StdEncoding.EncodeToString([]byte("short"))} {
		t.Setenv("TOKEN_ENCRYPTION_KEY", key)
		if githubAppConfigured() {
			t.Errorf("should be off with key %q", key)
		}
	}
	useTestKey(t)
	if !githubAppConfigured() {
		t.Error("should be on with full settings")
	}
	t.Setenv("GITHUB_APP_SLUG", "")
	if githubAppConfigured() {
		t.Error("should be off without a slug")
	}
}

func TestCacheForgetOlderThanRespectsFloor(t *testing.T) {
	cache := newCached[int]()
	calls := 0
	fetch := func() (int, error) { calls++; return calls, nil }
	cache.get("key", 1000000000000, fetch)

	cache.forgetOlderThan("key", 1000000000000)
	if value, _, _ := cache.get("key", 1000000000000, fetch); value != 1 {
		t.Errorf("a recent value was dropped, got %d", value)
	}
	cache.forgetOlderThan("key", 0)
	if value, _, _ := cache.get("key", 1000000000000, fetch); value != 2 {
		t.Errorf("an old value was kept, got %d", value)
	}
}
