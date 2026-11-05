import type { Group, Link, Preferences } from "./types";

const TILE_COLOURS = ["#4f46e5", "#0d9488", "#db2777", "#d97706", "#2563eb", "#7c3aed", "#059669", "#dc2626"];

/** The same site always gets the same colour. */
export function tileColour(text: string): string {
  let total = 0;
  for (const character of text) total = (total * 31 + (character.codePointAt(0) ?? 0)) % 9973;
  return TILE_COLOURS[total % TILE_COLOURS.length];
}

/** Accepts only http and https addresses, so a saved link can never run script. */
export function normalizeUrl(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function looksLikeAddress(text: string): boolean {
  return /^(https?:\/\/)?(localhost|[^\s/]+\.[^\s/]{2,})(:\d+)?(\/\S*)?$/i.test(text);
}

const SEARCH_URLS: Record<string, string> = {
  google: "https://www.google.com/search?q=",
  duckduckgo: "https://duckduckgo.com/?q=",
  bing: "https://www.bing.com/search?q=",
  brave: "https://search.brave.com/search?q=",
};

export function searchUrl(engine: Preferences["searchEngine"], query: string): string | null {
  const base = SEARCH_URLS[engine];
  return base ? `${base}${encodeURIComponent(query)}` : null;
}

export function fallbackSearchUrl(query: string): string {
  return `${SEARCH_URLS.google}${encodeURIComponent(query)}`;
}

function clone(groups: Group[]): Group[] {
  return groups.map((group) => ({ ...group, links: [...group.links] }));
}

export function moveGroup(groups: Group[], from: number, to: number): Group[] {
  if (to < 0 || to >= groups.length) return groups;
  const next = clone(groups);
  const [group] = next.splice(from, 1);
  next.splice(to, 0, group);
  return next;
}

/** Moves a link to just before a position in any group. Later positions shift once it leaves its old place. */
export function moveLink(groups: Group[], fromGroup: number, fromIndex: number, toGroup: number, toIndex: number): Group[] {
  const next = clone(groups);
  const [link] = next[fromGroup].links.splice(fromIndex, 1);
  const shift = fromGroup === toGroup && fromIndex < toIndex ? 1 : 0;
  const position = Math.max(0, Math.min(toIndex - shift, next[toGroup].links.length));
  next[toGroup].links.splice(position, 0, link);
  return next;
}

export function updateLink(groups: Group[], groupIndex: number, linkIndex: number, link: Link): Group[] {
  const next = clone(groups);
  next[groupIndex].links[linkIndex] = link;
  return next;
}

export function removeLink(groups: Group[], groupIndex: number, linkIndex: number): Group[] {
  const next = clone(groups);
  next[groupIndex].links.splice(linkIndex, 1);
  return next;
}

export function addLink(groups: Group[], groupIndex: number, link: Link): Group[] {
  const next = clone(groups);
  next[groupIndex].links.push(link);
  return next;
}
