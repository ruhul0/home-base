import { KEYS } from "./browser";
import type { Preferences } from "./types";

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "auto",
  mode: "auto",
  accentColor: "",
  backgroundType: "theme",
  backgroundColor: "#1f2937",
  backgroundDim: 20,
  pattern: "none",
  font: "system",
  layout: "tiles",
  tileSize: "medium",
  iconShape: "rounded",
  columns: "auto",
  pageWidth: "normal",
  cardStyle: "glass",
  corners: "round",
  heroAlign: "center",
  clockFormat: "auto",
  clockSize: "medium",
  greetingText: "",
  searchEngine: "default",
  showClock: true,
  showSeconds: false,
  showGreeting: true,
  showDate: true,
  showSearch: true,
  showLabels: true,
  showGroupTitles: true,
  showMostVisited: true,
  showBookmarks: true,
  showGitHub: true,
  showNews: true,
  showMonitors: true,
  showTodos: true,
  showNotes: true,
  showClocks: true,
};

export const DAISY_THEMES = [
  "light", "dark", "cupcake", "bumblebee", "emerald", "corporate", "synthwave", "retro", "cyberpunk",
  "valentine", "halloween", "garden", "forest", "aqua", "lofi", "pastel", "fantasy", "wireframe", "black",
  "luxury", "dracula", "cmyk", "autumn", "business", "acid", "lemonade", "night", "coffee", "winter",
  "dim", "nord", "sunset", "caramellatte", "abyss", "silk",
];

/** Themes from before the move to DaisyUI, matched to the closest new one so saved designs carry over. */
const LEGACY_THEMES: Record<string, string> = {
  ocean: "winter",
  rose: "valentine",
  violet: "synthwave",
  amber: "autumn",
  midnight: "night",
  mono: "lofi",
};

export function resolveThemeChoice(preferences: Preferences): string {
  if (preferences.theme === "aurora") return preferences.mode === "auto" ? "auto" : preferences.mode;
  return LEGACY_THEMES[preferences.theme] ?? preferences.theme;
}

function systemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export const LOOKS: Record<string, Partial<Preferences>> = {
  Default: {},
  Developer: { theme: "dracula", font: "mono", cardStyle: "solid", corners: "soft", iconShape: "square", tileSize: "small", clockSize: "small", pageWidth: "wide", showGreeting: false },
  Minimal: { theme: "lofi", cardStyle: "none", layout: "compact", showGreeting: false, showDate: false, showGroupTitles: false, clockSize: "small" },
  Focus: { theme: "night", pageWidth: "narrow", layout: "list", clockSize: "large", pattern: "grid" },
  Cosy: { theme: "coffee", font: "serif", cardStyle: "solid", corners: "soft", iconShape: "circle" },
  Terminal: { theme: "forest", font: "mono", cardStyle: "outline", corners: "sharp", iconShape: "square", layout: "list", pattern: "lines" },
  Bold: { theme: "synthwave", tileSize: "large", clockSize: "large", font: "rounded", cardStyle: "solid" },
  Soft: { theme: "pastel", font: "rounded", corners: "round", iconShape: "circle", pattern: "dots" },
};

export function relativeLuminance(hex: string) {
  const channel = (start: number) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

const ROOT_ATTRIBUTES = [
  "backgroundType", "pattern", "font", "layout", "tileSize", "iconShape", "columns",
  "pageWidth", "cardStyle", "corners", "heroAlign", "clockSize",
] as const;

/** Applies a design to the whole page. CSS reads the attributes, and colours are set as variables. */
export function applyPreferences(preferences: Preferences) {
  const root = document.documentElement;
  const choice = resolveThemeChoice(preferences);
  const theme = choice === "auto" ? systemTheme() : choice;

  root.dataset.theme = theme;
  for (const key of ROOT_ATTRIBUTES) root.dataset[key] = String(preferences[key]);
  root.dataset.showLabels = String(preferences.showLabels);
  root.dataset.showGroupTitles = String(preferences.showGroupTitles);

  try {
    localStorage.setItem(KEYS.bootTheme, theme);
  } catch {
    // The saved theme only prevents a brief colour flash, so losing it is harmless.
  }

  const style = root.style;
  if (preferences.accentColor) {
    style.setProperty("--color-primary", preferences.accentColor);
    style.setProperty("--color-primary-content", relativeLuminance(preferences.accentColor) > 0.4 ? "#14152a" : "#ffffff");
  } else {
    style.removeProperty("--color-primary");
    style.removeProperty("--color-primary-content");
  }

  // The clock and greeting sit directly on a solid background, so their colour must suit it.
  if (preferences.backgroundType === "solid") {
    const isLight = relativeLuminance(preferences.backgroundColor) > 0.35;
    style.setProperty("--custom-background", preferences.backgroundColor);
    style.setProperty("--hero-text", isLight ? "#1c1c28" : "#ffffff");
    style.setProperty("--hero-muted", isLight ? "#4a4a5c" : "rgb(255 255 255 / 0.8)");
  } else {
    style.removeProperty("--custom-background");
    style.removeProperty("--hero-text");
    style.removeProperty("--hero-muted");
  }
  style.setProperty("--background-dim", String(preferences.backgroundDim / 100));
}

export function setBackgroundImage(dataUrl: string | null) {
  const style = document.documentElement.style;
  if (dataUrl) style.setProperty("--background-image", `url("${dataUrl}")`);
  else style.removeProperty("--background-image");
}

const MAX_BACKGROUND_BYTES = 450 * 1024;
const BACKGROUND_WIDTHS = [1920, 1600, 1280];
const BACKGROUND_QUALITIES = [0.82, 0.68, 0.55];

/** Shrinks an image in the browser, so even large photos fit within the upload limit. */
export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  for (const width of BACKGROUND_WIDTHS) {
    const scale = Math.min(1, width / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of BACKGROUND_QUALITIES) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= MAX_BACKGROUND_BYTES) return blob;
    }
  }
  throw new Error("That image is too large, even after shrinking it.");
}

export function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
