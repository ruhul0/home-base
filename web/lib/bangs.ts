/** Search shortcuts: typing "npm zod" in the search box searches npm for zod. */
export interface Bang {
  key: string;
  name: string;
  url: string;
}

export const BANGS: Bang[] = [
  { key: "gh", name: "GitHub", url: "https://github.com/search?q=" },
  { key: "npm", name: "npm", url: "https://www.npmjs.com/search?q=" },
  { key: "mdn", name: "MDN", url: "https://developer.mozilla.org/en-US/search?q=" },
  { key: "so", name: "Stack Overflow", url: "https://stackoverflow.com/search?q=" },
  { key: "pypi", name: "PyPI", url: "https://pypi.org/search/?q=" },
  { key: "go", name: "Go packages", url: "https://pkg.go.dev/search?q=" },
  { key: "crates", name: "crates.io", url: "https://crates.io/search?q=" },
  { key: "docker", name: "Docker Hub", url: "https://hub.docker.com/search?q=" },
  { key: "hn", name: "Hacker News", url: "https://hn.algolia.com/?q=" },
  { key: "yt", name: "YouTube", url: "https://www.youtube.com/results?search_query=" },
  { key: "w", name: "Wikipedia", url: "https://en.wikipedia.org/w/index.php?search=" },
  { key: "g", name: "Google", url: "https://www.google.com/search?q=" },
  { key: "ddg", name: "DuckDuckGo", url: "https://duckduckgo.com/?q=" },
];

const GITHUB_REPO = /^[\w.-]+\/[\w.-]+$/;

export function matchBang(text: string): { name: string; kind: string; url: string } | null {
  const match = /^(\S+)\s+(.+)$/.exec(text.trim());
  if (!match) return null;
  const bang = BANGS.find(({ key }) => key === match[1].toLowerCase());
  if (!bang) return null;
  const query = match[2].trim();
  // "gh vercel/next.js" opens the repository itself.
  if (bang.key === "gh" && GITHUB_REPO.test(query)) {
    return { name: `Open ${query} on GitHub`, kind: "GitHub", url: `https://github.com/${query}` };
  }
  return { name: `Search ${bang.name} for "${query}"`, kind: bang.name, url: `${bang.url}${encodeURIComponent(query)}` };
}
