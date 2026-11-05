"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BANGS } from "@/lib/bangs";

const SHORTCUTS = [
  { keys: ["⌘", "K"], label: "Open the command palette (Ctrl+K on Windows and Linux)" },
  { keys: ["/"], label: "Jump to search" },
  { keys: ["t"], label: "Open the dev toolbox" },
  { keys: ["e"], label: "Turn edit mode on or off" },
  { keys: ["c"], label: "Open or close Customize" },
  { keys: ["?"], label: "Show this list" },
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <ul className="grid gap-2 text-sm">
          {SHORTCUTS.map((shortcut) => (
            <li key={shortcut.label} className="flex items-center justify-between gap-4">
              <span>{shortcut.label}</span>
              <span className="flex flex-none gap-1">
                {shortcut.keys.map((key) => (
                  <kbd key={key} className="kbd kbd-sm">
                    {key}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <h3 className="mt-2 text-sm font-semibold">Search shortcuts</h3>
        <p className="text-sm opacity-75">Type one before your search, like <span className="font-mono">npm zod</span>. <span className="font-mono">gh owner/repo</span> opens the repository.</p>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {BANGS.map((bang) => (
            <li key={bang.key} className="flex items-center justify-between gap-2">
              <span className="truncate">{bang.name}</span>
              <kbd className="kbd kbd-sm flex-none font-mono">{bang.key}</kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
