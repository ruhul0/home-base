"use client";

import { useMemo, useRef, useState } from "react";
import { CopyIcon, PlusIcon, TerminalSquareIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copyText, fillPlaceholders, placeholdersIn } from "@/lib/commands";
import type { Project, SavedCommand, Workspace } from "@/lib/types";
import type { SaveWorkspace } from "@/lib/use-workspace";
import { DevCard, DevMessage } from "./dev-card";

// Values are remembered until the page closes, and are never saved, in case one is sensitive.
const rememberedValues: Record<string, string> = {};

export function CommandFillDialog({ command, projects, onClose }: { command: SavedCommand; projects: Project[]; onClose: () => void }) {
  const names = useMemo(() => placeholdersIn(command.command), [command.command]);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(names.map((name) => [name, rememberedValues[name] ?? ""])));
  const firstInput = useRef<HTMLInputElement>(null);
  const hosts = [...new Set(projects.map(({ ssh }) => ssh.trim().split(/\s+/).pop() ?? "").filter(Boolean))];
  const result = fillPlaceholders(command.command, values);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    Object.assign(rememberedValues, values);
    void copyText(result, "Command copied.", toast);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{command.name}</DialogTitle>
          <DialogDescription>Fill these in, then press Enter to copy. Nothing runs from this page.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          {names.map((name, index) => (
            <div key={name} className="grid gap-1.5">
              <Label htmlFor={`placeholder-${name}`} className="font-mono">
                {name}
              </Label>
              <Input
                id={`placeholder-${name}`}
                ref={index === 0 ? firstInput : undefined}
                autoFocus={index === 0}
                list={/server|host/i.test(name) ? "known-hosts" : undefined}
                className="font-mono"
                value={values[name] ?? ""}
                onChange={(event) => setValues({ ...values, [name]: event.target.value })}
              />
            </div>
          ))}
          <datalist id="known-hosts">
            {hosts.map((host) => (
              <option key={host} value={host} />
            ))}
          </datalist>
          <pre className="overflow-x-auto rounded-lg bg-base-200 p-3 font-mono text-xs text-base-content">{result}</pre>
          <Button type="submit" className="justify-self-start">
            <CopyIcon /> Copy
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CommandsCard({ workspace, save, onUse }: { workspace: Workspace | null; save: SaveWorkspace; onUse: (command: SavedCommand) => void }) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const list = workspace?.commands ?? [];

  function add(event: React.FormEvent) {
    event.preventDefault();
    if (!workspace || !name.trim() || !text.trim()) return;
    void save({ ...workspace, commands: [...list, { id: crypto.randomUUID(), name: name.trim(), command: text.trim() }] }, true);
    setName("");
    setText("");
  }

  return (
    <DevCard title="Command library" icon={TerminalSquareIcon}>
      {workspace && (
        <div className="grid gap-2">
          {list.length === 0 && (
            <DevMessage>
              Save commands you keep retyping. Use placeholders like <span className="font-mono">{"{server}"}</span>, and find them with ⌘K.
            </DevMessage>
          )}
          <ul className="grid max-h-64 gap-0.5 overflow-y-auto">
            {list.map((command) => (
              <li key={command.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-base-content/10">
                <button type="button" className="min-w-0 flex-1 cursor-pointer text-left" title="Copy" onClick={() => onUse(command)}>
                  <span className="block truncate text-sm">{command.name}</span>
                  <span className="block truncate font-mono text-xs opacity-70">{command.command}</span>
                </button>
                <button type="button" aria-label={`Delete ${command.name}`} className="flex-none cursor-pointer opacity-50 hover:opacity-100" onClick={() => void save({ ...workspace, commands: list.filter((item) => item.id !== command.id) }, true)}>
                  <XIcon className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <form onSubmit={add} className="grid gap-1.5">
            <Input aria-label="Command name" placeholder="Name" maxLength={100} value={name} onChange={(event) => setName(event.target.value)} className="bg-base-100 text-base-content" />
            <div className="flex gap-1.5">
              <Input aria-label="Command" placeholder="ssh {server} docker ps" maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} className="min-w-0 flex-1 bg-base-100 font-mono text-base-content" />
              <Button type="submit" size="icon" aria-label="Save command">
                <PlusIcon />
              </Button>
            </div>
          </form>
          <p className="text-xs opacity-70">Saved unencrypted, so never include a password or token.</p>
        </div>
      )}
    </DevCard>
  );
}
