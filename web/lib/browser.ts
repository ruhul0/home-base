// What the page needs from the place it runs in, which is either the website or the Chrome extension.

export const KEYS = {
  token: "token",
  groups: "groups-cache",
  preferences: "preferences-cache",
  background: "background-cache",
  autoLogin: "auto-login",
  autoLoginAttempt: "auto-login-attempted",
  silentAttempt: "silent-login-at",
  verifier: "login-verifier",
  promptDismissed: "extension-prompt-dismissed",
  bootTheme: "boot-theme",
} as const;

export const SERVER_URL = "https://chrome.ruhul0.com";

export function isExtension(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
}

/** The extension runs from its own origin, so it needs the full server address. The website uses relative paths. */
export function apiBase(): string {
  return isExtension() ? SERVER_URL : "";
}

export const storage = {
  async get<T>(key: string): Promise<T | null> {
    if (isExtension()) {
      const result = await chrome.storage.local.get(key);
      return (result[key] as T | undefined) ?? null;
    }
    const value = localStorage.getItem(key);
    if (value === null) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  },
  async set(key: string, value: unknown): Promise<void> {
    if (isExtension()) {
      await chrome.storage.local.set({ [key]: value });
      return;
    }
    localStorage.setItem(key, JSON.stringify(value));
  },
  async remove(key: string): Promise<void> {
    if (isExtension()) {
      await chrome.storage.local.remove(key);
      return;
    }
    localStorage.removeItem(key);
  },
};
