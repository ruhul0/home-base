export interface Link {
  name: string;
  url: string;
}

export interface Group {
  name: string;
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
