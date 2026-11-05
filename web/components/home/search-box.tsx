"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { isExtension } from "@/lib/browser";
import { fallbackSearchUrl, looksLikeAddress, normalizeUrl, searchUrl } from "@/lib/links";
import type { Group, Link, Preferences } from "@/lib/types";
import { SiteIcon } from "./site-icon";

const MAX_RESULTS = 8;

type Result = Link & { kind: string; query?: string };

function findResults(text: string, groups: Group[], browserLinks: Result[]): Result[] {
  const needle = text.trim().toLowerCase();
  if (!needle) return [];

  const seen = new Set<string>();
  const own = groups.flatMap((group) => group.links.map((link) => ({ ...link, kind: group.name })));
  const matches = [...own, ...browserLinks].filter((link) => {
    const found = link.name.toLowerCase().includes(needle) || link.url.toLowerCase().includes(needle);
    if (!found || seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  }).slice(0, MAX_RESULTS - 1);

  const trimmed = text.trim();
  const address = looksLikeAddress(trimmed) ? normalizeUrl(trimmed) : null;
  if (address) return [{ name: `Go to ${trimmed}`, url: address, kind: "Address" }, ...matches];
  // Site matches come first, so typing "you" and pressing Enter opens YouTube.
  return [...matches, { name: `Search the web for "${trimmed}"`, url: "https://www.google.com/", kind: "Web", query: trimmed }];
}

export function SearchBox({
  groups,
  browserLinks,
  engine,
}: {
  groups: Group[];
  browserLinks: Result[];
  engine: Preferences["searchEngine"];
}) {
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => findResults(text, groups, browserLinks), [text, groups, browserLinks]);

  // Once the page has focus, pressing "/" jumps to the search box.
  useEffect(() => {
    input.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (event.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        event.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function open(result: Result, inNewTab: boolean) {
    if (result.query) {
      const url = searchUrl(engine, result.query);
      if (!url && isExtension()) {
        chrome.search.query({ text: result.query, disposition: inNewTab ? "NEW_TAB" : "CURRENT_TAB" });
        return;
      }
      const target = url ?? fallbackSearchUrl(result.query);
      if (inNewTab) window.open(target, "_blank", "noopener");
      else location.href = target;
      return;
    }
    if (inNewTab) window.open(result.url, "_blank", "noopener");
    else location.href = result.url;
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setText("");
      setActive(0);
    } else if (results.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((active + step + results.length) % results.length);
    } else if (event.key === "Enter" && results[active]) {
      event.preventDefault();
      open(results[active], event.metaKey || event.ctrlKey);
    }
  }

  return (
    <div className="home-search relative z-10 mx-auto mb-10 max-w-2xl">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-5 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        ref={input}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Search, or type a site name or address"
        aria-label="Search the web, your sites and bookmarks"
        autoComplete="off"
        spellCheck={false}
        className="h-14 rounded-full border-border bg-base-100 pr-6 pl-13 text-base text-base-content shadow-lg md:text-base"
      />
      {focused && results.length > 0 && (
        <ul className="absolute top-full right-0 left-0 mt-2 list-none rounded-2xl border bg-base-100 p-2 text-base-content shadow-xl">
          {results.map((result, index) => (
            <li
              key={`${result.kind}-${result.url}-${result.name}`}
              className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 [--icon-size:1.75rem] ${index === active ? "bg-base-200" : ""}`}
              onMouseDown={(event) => {
                // This runs before the input loses focus, so the list is still in place.
                event.preventDefault();
                open(result, event.metaKey || event.ctrlKey);
              }}
            >
              <SiteIcon link={result} />
              <span className="min-w-0 flex-1 truncate">{result.name}</span>
              <span className="text-sm text-muted-foreground">{result.kind}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
