export interface Link {
  name: string;
  url: string;
  /** Empty for automatic. Otherwise "emoji:…", "lucide:…" or "image:data:…". */
  icon?: string;
  iconColor?: string;
}

export interface Group {
  name: string;
  color?: string;
  links: Link[];
}

export interface GroupsResponse {
  groups: Group[];
  user: { login: string; isAdmin: boolean };
  preferences: Partial<Preferences>;
  backgroundVersion: string | null;
  extensionUrl: string | null;
}

export interface Preferences {
  theme: string;
  mode: "auto" | "light" | "dark";
  accentColor: string;
  backgroundType: "theme" | "solid" | "image";
  backgroundColor: string;
  backgroundDim: number;
  pattern: "none" | "dots" | "grid" | "lines";
  font: "system" | "serif" | "mono" | "rounded";
  layout: "tiles" | "list" | "compact";
  tileSize: "small" | "medium" | "large";
  iconShape: "rounded" | "circle" | "square";
  columns: "auto" | "1" | "2" | "3" | "4";
  pageWidth: "narrow" | "normal" | "wide";
  cardStyle: "glass" | "solid" | "outline" | "none";
  corners: "round" | "soft" | "sharp";
  heroAlign: "center" | "left";
  clockFormat: "auto" | "12" | "24";
  clockSize: "small" | "medium" | "large";
  greetingText: string;
  searchEngine: "default" | "google" | "duckduckgo" | "bing" | "brave";
  showClock: boolean;
  showSeconds: boolean;
  showGreeting: boolean;
  showDate: boolean;
  showSearch: boolean;
  showLabels: boolean;
  showGroupTitles: boolean;
  showMostVisited: boolean;
  showBookmarks: boolean;
  showGitHub: boolean;
  showNews: boolean;
  showMonitors: boolean;
  showTodos: boolean;
  showNotes: boolean;
  showClocks: boolean;
  showServers: boolean;
}

export interface GitHubItem {
  title: string;
  url: string;
  repo: string;
  number: number;
  updatedAt: string;
}

export interface GitHubDashboard {
  login: string;
  name: string;
  publicRepos: number;
  followers: number;
  following: number;
  reviewRequests: GitHubItem[];
  ci: { repo: string; workflow: string; branch: string; status: string; conclusion: string; url: string; updatedAt: string }[];
  ciNeedsPermission: boolean;
  repos: { private: boolean; name: string; url: string; description: string; language: string; stars: number; pushedAt: string }[];
  pullRequests: GitHubItem[];
  issues: GitHubItem[];
  events: { type: string; repo: string; createdAt: string }[];
  partial: boolean;
  fromRecentRepos: boolean;
}

export interface GitHubResponse {
  data: GitHubDashboard;
  fetchedAt: string;
  available: boolean;
  connected: boolean;
  needsReconnect: boolean;
  manageUrl?: string;
}

export interface NewsStory {
  title: string;
  url: string;
  discussion: string;
  score: number;
  comments: number;
}

export interface Monitor {
  name: string;
  url: string;
}

export interface MonitorResult extends Monitor {
  up: boolean;
  status: number;
  ms: number;
  problem?: string;
  checkedAt: string;
  history?: {
    points: { at: string; up: boolean; ms: number }[];
    uptime24h: number | null;
    downSince: string | null;
  };
}

export interface ServerReport {
  diskPercent: number;
  memoryPercent: number;
  load: number;
  cores: number;
  uptimeSeconds: number;
  containersRunning: number;
  containersTotal: number;
  unhealthy: string[];
}

export interface MonitoredServer {
  id: number;
  name: string;
  report: ServerReport | null;
  reportedAt: string | null;
}

export interface SessionInfo {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  current: boolean;
}

export interface Todo {
  text: string;
  done: boolean;
}

export interface Workspace {
  version: number;
  monitors: Monitor[];
  todos: Todo[];
  notes: string;
}

export interface AdminTotals {
  users: number;
  newUsers7Days: number;
  newUsers30Days: number;
  active7Days: number;
  sessions: number;
  links: number;
}

export interface AdminUser {
  id: number;
  login: string;
  isAdmin: boolean;
  disabled: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  groups: number;
  links: number;
  sessions: number;
}
