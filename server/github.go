package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"time"
)

var githubClient = &http.Client{Timeout: 10 * time.Second}

// GitHubProfile is the public profile GitHub shares. No scopes are requested, and GitHub only
// allows verified addresses as a public email, so PublicEmail is safe to compare against.
type GitHubProfile struct {
	ID          int64
	Login       string
	PublicEmail string
}

func githubConfigured() bool {
	return os.Getenv("GITHUB_CLIENT_ID") != "" && os.Getenv("GITHUB_CLIENT_SECRET") != ""
}

func githubAuthorizeURL(state, redirectURI string) string {
	params := url.Values{
		"client_id":    {os.Getenv("GITHUB_CLIENT_ID")},
		"redirect_uri": {redirectURI},
		"state":        {state},
	}
	return envOr("GITHUB_WEB_URL", "https://github.com") + "/login/oauth/authorize?" + params.Encode()
}

// fetchGitHubProfile uses the GitHub access token once to identify the user, then discards it.
func fetchGitHubProfile(ctx context.Context, code, redirectURI string) (*GitHubProfile, error) {
	body, err := json.Marshal(map[string]string{
		"client_id":     os.Getenv("GITHUB_CLIENT_ID"),
		"client_secret": os.Getenv("GITHUB_CLIENT_SECRET"),
		"code":          code,
		"redirect_uri":  redirectURI,
	})
	if err != nil {
		return nil, err
	}

	tokenRequest, err := http.NewRequestWithContext(ctx, http.MethodPost,
		envOr("GITHUB_WEB_URL", "https://github.com")+"/login/oauth/access_token", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	tokenRequest.Header.Set("Accept", "application/json")
	tokenRequest.Header.Set("Content-Type", "application/json")

	tokenResponse, err := githubClient.Do(tokenRequest)
	if err != nil {
		return nil, fmt.Errorf("request GitHub access token: %w", err)
	}
	defer tokenResponse.Body.Close()

	var token struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	if err := json.NewDecoder(tokenResponse.Body).Decode(&token); err != nil {
		return nil, fmt.Errorf("read GitHub access token: %w", err)
	}
	if token.AccessToken == "" {
		return nil, fmt.Errorf("GitHub refused the sign-in code: %s", token.Error)
	}

	userRequest, err := http.NewRequestWithContext(ctx, http.MethodGet,
		envOr("GITHUB_API_URL", "https://api.github.com")+"/user", nil)
	if err != nil {
		return nil, err
	}
	userRequest.Header.Set("Accept", "application/vnd.github+json")
	userRequest.Header.Set("Authorization", "Bearer "+token.AccessToken)
	userRequest.Header.Set("User-Agent", "home-base")

	userResponse, err := githubClient.Do(userRequest)
	if err != nil {
		return nil, fmt.Errorf("request GitHub profile: %w", err)
	}
	defer userResponse.Body.Close()
	if userResponse.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub profile request failed: %d", userResponse.StatusCode)
	}

	var user struct {
		ID    int64   `json:"id"`
		Login string  `json:"login"`
		Email *string `json:"email"`
	}
	if err := json.NewDecoder(userResponse.Body).Decode(&user); err != nil {
		return nil, fmt.Errorf("read GitHub profile: %w", err)
	}
	if user.ID == 0 || user.Login == "" {
		return nil, fmt.Errorf("GitHub profile was incomplete")
	}

	profile := &GitHubProfile{ID: user.ID, Login: user.Login}
	if user.Email != nil {
		profile.PublicEmail = *user.Email
	}
	return profile, nil
}
