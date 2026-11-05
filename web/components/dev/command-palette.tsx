"use client";

import { useMemo, useState } from "react";
import { CornerDownLeftIcon, GlobeIcon, SearchIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BANGS, matchBang } from "@/lib/bangs";
import { fallbackSearchUrl, looksLikeAddress, normalizeUrl } from "@/lib/links";
import type { Group } from "@/lib/types";

export interface PaletteAction {
  label: string;
  section: string;
  keywords?: string;
  shortcut?: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
}

const MAX_ITEMS = 40;

function PaletteBody({ groups, actions, onClose }: { groups: Group[]; actions: PaletteAction[]; onClose: () => void }) {
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);

  const items = useMemo(() => {
    const needle = text.trim().toLowerCase();
    const open = (url: string) => () => {
      location.href = url;
    };

    const siteActions: PaletteAction[] = groups.flatMap((group) =>
      group.links.map((link) => ({ label: link.name, section: group.name, keywords: link.url, icon: GlobeIcon, run: open(link.url) })),
    );
    const all = [...actions, ...siteActions];
    const matches = needle ? all.filter((item) => `${item.label} ${item.section} ${item.keywords ?? ""}`.toLowerCase().includes(needle)) : all;

    const extras: PaletteAction[] = [];
    const bang = matchBang(text);
    if (bang) extras.push({ label: bang.name, section: "Search", icon: SearchIcon, run: open(bang.url) });
    else if (needle) {
      const address = looksLikeAddress(text.trim()) ? normalizeUrl(text) : null;
      if (address) extras.push({ label: `Go to ${text.trim()}`, section: "Address", icon: GlobeIcon, run: open(address) });
      extras.push({ label: `Search the web for "${text.trim()}"`, section: "Search", icon: SearchIcon, run: open(fallbackSearchUrl(text.trim())) });
    }
    return bang ? [...extras, ...matches].slice(0, MAX_ITEMS) : [...matches, ...extras].slice(0, MAX_ITEMS);
  }, [actions, groups, text]);

  const selected = Math.min(active, Math.max(items.length - 1, 0));

  function choose(item: PaletteAction) {
    onClose();
    item.run();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (items.length) setActive((selected + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
    } else if (event.key === "Enter" && items[selected]) {
      event.preventDefault();
      choose(items[selected]);
    }
  }

  return (
    <>
      <Input
        autoFocus
        aria-label="Type a command, site or search"
        placeholder={`Type a command or site. Try "gh vercel/next.js" or "npm zod"`}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        className="h-11 bg-base-100 font-mono text-base-content"
      />
      <ul role="listbox" aria-label="Results" className="max-h-80 min-h-40 overflow-y-auto">
        {items.map((item, index) => (
          <li
            key={`${item.section}-${item.label}-${index}`}
            role="option"
            aria-selected={index === selected}
            className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm ${index === selected ? "bg-base-200" : ""}`}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(item)}
          >
            <item.icon className="size-4 flex-none opacity-70" />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <span className="text-xs opacity-60">{item.section}</span>
            {item.shortcut && <kbd className="kbd kbd-xs">{item.shortcut}</kbd>}
            {index === selected && <CornerDownLeftIcon className="size-3.5 flex-none opacity-60" aria-hidden />}
          </li>
        ))}
      </ul>
      <p className="text-xs opacity-65">
        Search shortcuts: <span className="font-mono">{BANGS.map(({ key }) => key).join(" · ")}</span>
      </p>
    </>
  );
}

export function CommandPalette({
  open,
  groups,
  actions,
  onOpenChange,
}: {
  open: boolean;
  groups: Group[];
  actions: PaletteAction[];
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[15%] translate-y-0 sm:max-w-xl">
        <DialogHeader className="sr-only">
          <DialogTitle>Command palette</DialogTitle>
          <DialogDescription>Search your sites, tools and actions.</DialogDescription>
        </DialogHeader>
        {open && <PaletteBody groups={groups} actions={actions} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
