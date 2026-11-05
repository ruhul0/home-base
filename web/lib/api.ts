import { apiBase, KEYS, storage } from "./browser";
import type {
  AdminTotals,
  AdminUser,
  GitHubResponse,
  Group,
  GroupsResponse,
  MonitorResult,
  NewsStory,
  Preferences,
  Workspace,
} from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class SignedOutError extends ApiError {
  constructor() {
    super(401, "Please sign in.");
  }
}

let currentToken: string | null = null;

export function setToken(token: string | null) {
  currentToken = token;
}

function authHeaders(): Record<string, string> {
  return currentToken ? { Authorization: `Bearer ${currentToken}` } : {};
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      ...authHeaders(),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) throw new SignedOutError();
  if (!response.ok) throw new ApiError(response.status, data.error || "The server had a problem.");
  return data as T;
}

export const api = {
  exchange: (code: string, verifier: string) =>
    request<{ token: string }>("/api/auth/exchange", "POST", { code, verifier }),
  logout: () => request("/api/logout", "POST"),
  config: () => request<{ extensionUrl: string | null }>("/api/config"),
  getGroups: () => request<GroupsResponse>("/api/groups"),
  putGroups: (groups: Group[]) => request("/api/groups", "PUT", { groups }),
  resetGroups: () => request<{ groups: Group[] }>("/api/groups/reset", "POST"),
  putPreferences: (preferences: Preferences) => request("/api/preferences", "PUT", { preferences }),
  deleteBackground: () => request("/api/background", "DELETE"),
  async getBackground(): Promise<Blob | null> {
    const response = await fetch(`${apiBase()}/api/background`, { headers: authHeaders() });
    return response.ok ? response.blob() : null;
  },
  async putBackground(image: Blob): Promise<string> {
    const response = await fetch(`${apiBase()}/api/background`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": image.type },
      body: image,
    });
    if (!response.ok) throw new ApiError(response.status, "That image couldn't be used.");
    const { version } = (await response.json()) as { version: string };
    return version;
  },
  dev: {
    github: (fresh = false) => request<GitHubResponse>(`/api/dev/github${fresh ? "?fresh=1" : ""}`),
    connectGitHub: () => request<{ url: string }>("/api/dev/github/connect", "POST"),
    disconnectGitHub: () => request("/api/dev/github/connection", "DELETE"),
    news: () => request<{ stories: NewsStory[]; fetchedAt: string }>("/api/dev/news"),
    workspace: () => request<Workspace>("/api/dev/workspace"),
    putWorkspace: (workspace: Workspace) => request("/api/dev/workspace", "PUT", workspace),
    monitors: () => request<{ results: MonitorResult[] }>("/api/dev/monitors"),
  },
  admin: {
    overview: () =>
      request<{ totals: AdminTotals; users: AdminUser[]; currentUserId: number }>("/api/admin/overview"),
    signOut: (id: number) => request(`/api/admin/users/${id}/sign-out`, "POST"),
    disable: (id: number) => request(`/api/admin/users/${id}/disable`, "POST"),
    enable: (id: number) => request(`/api/admin/users/${id}/enable`, "POST"),
    remove: (id: number) => request(`/api/admin/users/${id}`, "DELETE"),
  },
};

/** Removes everything saved for the signed-in user from this browser. */
export async function clearLocalSession() {
  setToken(null);
  await Promise.all([
    storage.remove(KEYS.token),
    storage.remove(KEYS.groups),
    storage.remove(KEYS.preferences),
    storage.remove(KEYS.background),
  ]);
}
