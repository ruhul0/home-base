import { apiBase, KEYS, storage } from "./browser";
import type {
  AdminTotals,
  AdminUser,
  BackupStatus,
  GitHubResponse,
  Group,
  GroupsResponse,
  MonitoredServer,
  MonitorResult,
  NewsStory,
  Preferences,
  ProjectReport,
  ProjectStatus,
  SessionInfo,
  TimeEntry,
  WorkLog,
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

/** The server takes whole seconds. */
function timeRange(from: Date, to: Date) {
  const stamp = (date: Date) => encodeURIComponent(date.toISOString().replace(/\.\d+Z$/, "Z"));
  return `from=${stamp(from)}&to=${stamp(to)}`;
}

export const api = {
  exchange: (code: string, verifier: string) =>
    request<{ token: string }>("/api/auth/exchange", "POST", { code, verifier }),
  logout: () => request("/api/logout", "POST"),
  config: () => request<{ extensionUrl: string | null }>("/api/config"),
  getGroups: () => request<GroupsResponse>("/api/groups"),
  putGroups: (groups: Group[]) => request("/api/groups", "PUT", { groups, schema: 2 }),
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
    putWorkspace: (workspace: Workspace) => request<{ version: number }>("/api/dev/workspace", "PUT", workspace),
    monitors: () => request<{ results: MonitorResult[] }>("/api/dev/monitors"),
    projects: () => request<{ projects: ProjectStatus[] }>("/api/dev/projects"),
    report: (id: string, month: string) => request<ProjectReport>(`/api/dev/projects/${encodeURIComponent(id)}/report?month=${encodeURIComponent(month)}`),
    timeEntries: (from: Date, to: Date) => request<{ entries: TimeEntry[] }>(`/api/dev/time?${timeRange(from, to)}`),
    startTimer: (projectId: string, note: string) => request("/api/dev/time/start", "POST", { projectId, note }),
    stopTimer: () => request("/api/dev/time/stop", "POST"),
    deleteTimeEntry: (id: number) => request(`/api/dev/time/${id}`, "DELETE"),
    workLog: (from: Date, to: Date) => request<{ log: WorkLog; entries: TimeEntry[] }>(`/api/dev/worklog?${timeRange(from, to)}`),
    rerun: (repo: string, runId: number) => request("/api/dev/github/rerun", "POST", { repo, runId }),
  },
  sessions: {
    list: () => request<{ sessions: SessionInfo[] }>("/api/sessions"),
    remove: (id: string) => request(`/api/sessions/${id}`, "DELETE"),
    signOutOthers: () => request("/api/sessions/sign-out-others", "POST"),
  },
  deleteAccount: (confirm: string) => request("/api/account", "DELETE", { confirm }),
  admin: {
    servers: () => request<{ servers: MonitoredServer[]; serverTime: string; backup: BackupStatus | null }>("/api/admin/servers"),
    addServer: (name: string) => request<{ id: number; token: string }>("/api/admin/servers", "POST", { name }),
    deleteServer: (id: number) => request(`/api/admin/servers/${id}`, "DELETE"),
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
