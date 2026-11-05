import { api, setToken } from "./api";
import { apiBase, isExtension, KEYS, storage } from "./browser";

const SILENT_ATTEMPT_INTERVAL_MS = 60 * 60 * 1000;
const SILENT_TIMEOUT_MS = 5000;

export const LOGIN_ERRORS: Record<string, string> = {
  denied: "GitHub sign-in was cancelled.",
  not_allowed: "This GitHub account doesn't have access.",
  full: "This site can't take any new users right now.",
  not_configured: "GitHub sign-in isn't set up yet.",
  busy: "Too many sign-in attempts. Try again in 15 minutes.",
  failed: "GitHub sign-in didn't work. Try again.",
};

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes as ArrayBuffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** The server only hands over a session to the browser holding the secret behind this challenge. */
async function createLoginProof() {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(digest) };
}

async function finishLogin(code: string, verifier: string): Promise<string> {
  const { token } = await api.exchange(code, verifier);
  setToken(token);
  await storage.set(KEYS.token, token);
  await storage.set(KEYS.autoLogin, true);
  return token;
}

function extensionLoginUrl(challenge: string) {
  return `${apiBase()}/auth/github/start?client=extension&extension_id=${chrome.runtime.id}&challenge=${challenge}`;
}

export type LoginResult = { signedIn: true } | { signedIn: false; error?: string };

/** The website leaves for GitHub and comes back. The extension uses Chrome's own sign-in window. */
export async function startLogin(): Promise<LoginResult> {
  const { verifier, challenge } = await createLoginProof();

  if (!isExtension()) {
    sessionStorage.setItem(KEYS.verifier, verifier);
    location.href = `/auth/github/start?challenge=${challenge}`;
    return { signedIn: false };
  }

  let redirected: string | undefined;
  try {
    redirected = await chrome.identity.launchWebAuthFlow({ url: extensionLoginUrl(challenge), interactive: true });
  } catch {
    return { signedIn: false, error: LOGIN_ERRORS.denied };
  }
  const params = new URL(redirected ?? "").searchParams;
  const code = params.get("code");
  if (!code) return { signedIn: false, error: LOGIN_ERRORS[params.get("error") ?? ""] ?? LOGIN_ERRORS.failed };
  await finishLogin(code, verifier);
  return { signedIn: true };
}

/**
 * Finishes a website sign-in when GitHub sends the browser back with a one-time code in the address.
 * The code is removed from the address straight away.
 */
export async function resumeWebLogin(): Promise<LoginResult | null> {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  const error = params.get("error");
  if (!code && !error) return null;

  history.replaceState(null, "", location.pathname);
  const verifier = sessionStorage.getItem(KEYS.verifier);
  sessionStorage.removeItem(KEYS.verifier);

  if (error || !code || !verifier) {
    return { signedIn: false, error: LOGIN_ERRORS[error ?? ""] ?? LOGIN_ERRORS.failed };
  }
  try {
    await finishLogin(code, verifier);
    return { signedIn: true };
  } catch {
    return { signedIn: false, error: LOGIN_ERRORS.failed };
  }
}

/**
 * If the browser is already signed in to GitHub and has approved Home Base, this finishes with no
 * window at all. Otherwise it fails quietly and the sign-in button stays on the page. New tabs open
 * often, so it runs at most once an hour and never after someone signs out.
 */
export async function trySilentExtensionLogin(): Promise<boolean> {
  if ((await storage.get<boolean>(KEYS.autoLogin)) === false) return false;
  const lastAttempt = await storage.get<number>(KEYS.silentAttempt);
  if (lastAttempt && Date.now() - lastAttempt < SILENT_ATTEMPT_INTERVAL_MS) return false;
  await storage.set(KEYS.silentAttempt, Date.now());

  try {
    const { verifier, challenge } = await createLoginProof();
    const redirected = await chrome.identity.launchWebAuthFlow({
      url: extensionLoginUrl(challenge),
      interactive: false,
      timeoutMsForNonInteractive: SILENT_TIMEOUT_MS,
    });
    const code = new URL(redirected ?? "").searchParams.get("code");
    if (!code) return false;
    await finishLogin(code, verifier);
    return true;
  } catch {
    return false;
  }
}
