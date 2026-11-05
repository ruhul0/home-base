'use strict';

const TIMEOUT_MS = 10000;

function webUrl() {
  return process.env.GITHUB_WEB_URL || 'https://github.com';
}

function apiUrl() {
  return process.env.GITHUB_API_URL || 'https://api.github.com';
}

function isConfigured() {
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}

// No scopes are requested, so GitHub only shares the user's public profile.
function authorizeUrl({ state, redirectUri }) {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    state,
  });
  return `${webUrl()}/login/oauth/authorize?${params}`;
}

// The GitHub access token is used once to identify the user, then discarded.
async function fetchUser({ code, redirectUri }) {
  const tokenResponse = await fetch(`${webUrl()}/login/oauth/access_token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const { access_token: accessToken, error } = await tokenResponse.json();
  if (!accessToken) throw new Error(`GitHub refused the sign-in code: ${error || tokenResponse.status}`);

  const userResponse = await fetch(`${apiUrl()}/user`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'home-base',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!userResponse.ok) throw new Error(`GitHub profile request failed: ${userResponse.status}`);

  const user = await userResponse.json();
  return { githubId: user.id, login: user.login };
}

module.exports = { isConfigured, authorizeUrl, fetchUser };
