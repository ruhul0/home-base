"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIcon, ListTodoIcon, NotebookPenIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, SignedOutError } from "@/lib/api";
import { isDown } from "@/lib/attention";
import { normalizeUrl } from "@/lib/links";
import type { MonitorResult, Preferences, Workspace } from "@/lib/types";
import type { SaveWorkspace } from "@/lib/use-workspace";
import { DevCard, DevMessage, timeAgo } from "./dev-card";

const MONITOR_REFRESH_MS = 60 * 1000;
const MAX_MONITORS = 10;
const PAGE_TITLE = "New Tab";

function HistoryBars({ result }: { result: MonitorResult }) {
  const points = result.history?.points ?? [];
  if (points.length === 0) return null;
  return (
    <span className="flex h-3 items-end gap-px" aria-hidden>
      {points.map((point) => (
        <span key={point.at} title={`${new Date(point.at).toLocaleString()}: ${point.up ? `up, ${point.ms}ms` : "down"}`} className={`h-full w-0.5 rounded-sm ${point.up ? "bg-success" : "bg-error"}`} />
      ))}
    </span>
  );
}

export function WorkspaceCards({
  preferences,
  workspace,
  save,
  projectsDown,
  onSignedOut,
}: {
  preferences: Preferences;
  workspace: Workspace | null;
  save: SaveWorkspace;
  projectsDown: string[];
  onSignedOut: () => void;
}) {
  const [results, setResults] = useState<MonitorResult[]>([]);
  const [checking, setChecking] = useState(false);
  const [newTodo, setNewTodo] = useState("");
  const [monitorName, setMonitorName] = useState("");
  const [monitorUrl, setMonitorUrl] = useState("");
  const [monitorError, setMonitorError] = useState("");
  const knownDown = useRef<Set<string> | null>(null);

  const reportError = useCallback(
    (error: unknown, message: string) => {
      if (error instanceof SignedOutError) onSignedOut();
      else toast.error(message);
    },
    [onSignedOut],
  );

  const checkMonitors = useCallback(async () => {
    setChecking(true);
    try {
      const latest = (await api.dev.monitors()).results;
      setResults(latest);

      // Alerts live on the page: the tab title shows outages, and new ones raise a message.
      const down = new Set(latest.filter(isDown).map((result) => result.url));
      if (knownDown.current) {
        for (const result of latest) {
          if (isDown(result) && !knownDown.current.has(result.url)) toast.error(`${result.name} is down. ${result.problem ?? ""}`, { id: `down-${result.url}` });
        }
      }
      knownDown.current = down;
    } catch (error) {
      reportError(error, "Your monitors couldn't be checked.");
    } finally {
      setChecking(false);
    }
  }, [reportError]);

  const hasWorkspace = workspace !== null;
  useEffect(() => {
    if (!hasWorkspace) return;
    const start = setTimeout(() => void checkMonitors(), 0);
    const timer = setInterval(() => void checkMonitors(), MONITOR_REFRESH_MS);
    return () => {
      clearTimeout(start);
      clearInterval(timer);
    };
  }, [checkMonitors, hasWorkspace]);

  // Alerts live on the page: the tab title counts every monitor and project that's down.
  const downSignature = [...new Set([...results.filter(isDown).map((result) => result.url), ...projectsDown])].length;
  useEffect(() => {
    document.title = downSignature ? `(${downSignature} down) ${PAGE_TITLE}` : PAGE_TITLE;
    return () => {
      document.title = PAGE_TITLE;
    };
  }, [downSignature]);

  function addTodo(event: React.FormEvent) {
    event.preventDefault();
    const text = newTodo.trim();
    if (!text || !workspace) return;
    setNewTodo("");
    void save({ ...workspace, todos: [...workspace.todos, { text, done: false }] }, true);
  }

  async function addMonitor(event: React.FormEvent) {
    event.preventDefault();
    if (!workspace) return;
    const url = normalizeUrl(monitorUrl);
    if (!url) {
      setMonitorError("Enter a web address, like example.com.");
      return;
    }
    if (workspace.monitors.length >= MAX_MONITORS) {
      setMonitorError(`You can monitor up to ${MAX_MONITORS} addresses.`);
      return;
    }
    setMonitorError("");
    setMonitorName("");
    setMonitorUrl("");
    const name = monitorName.trim() || new URL(url).hostname;
    await save({ ...workspace, monitors: [...workspace.monitors, { name, url }] }, true);
    await checkMonitors();
  }

  const hasMonitors = (workspace?.monitors.length ?? 0) > 0;
  const upCount = results.filter((result) => !isDown(result)).length;

  return (
    <>
      {preferences.showMonitors && (
        <DevCard title={results.length ? `Monitors · ${upCount}/${results.length} up` : "Monitors"} icon={ActivityIcon} loading={checking} onRefresh={hasMonitors ? checkMonitors : undefined}>
          {workspace && (
            <div className="grid gap-3">
              {!hasMonitors && <DevMessage>Add your sites and APIs to see if they&apos;re up. Your server checks them every 2 minutes, even with this page closed, and keeps 7 days of history.</DevMessage>}
              <ul className="grid gap-0.5">
                {workspace.monitors.map((monitor, index) => {
                  const result = results.find((item) => item.url === monitor.url);
                  const state = !result ? "status-neutral" : result.up ? "status-success" : result.unconfirmed ? "status-warning" : "status-error";
                  return (
                    <li key={monitor.url} className="group flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-base-content/10">
                      <span className={`status ${state} flex-none`} aria-label={!result ? "Not checked yet" : result.up ? "Up" : result.unconfirmed ? "Failed one check" : "Down"} />
                      <a href={monitor.url} className="min-w-0 flex-1" title={result?.problem ?? monitor.url}>
                        <span className="block truncate text-sm">{monitor.name}</span>
                        {result && !result.up && (
                          <span className={`block truncate text-xs ${result.unconfirmed ? "text-warning" : "text-error"}`}>
                            {result.problem}
                            {result.unconfirmed ? " Checking again." : result.history?.downSince ? ` Down since ${timeAgo(result.history.downSince)}.` : ""}
                          </span>
                        )}
                        {result && <HistoryBars result={result} />}
                      </a>
                      {result && (
                        <span className="flex-none text-right font-mono text-xs tabular-nums opacity-70">
                          {result.up && (
                            <span className="block">
                              {result.status} · {result.ms}ms
                            </span>
                          )}
                          {result.history?.uptime24h !== null && result.history?.uptime24h !== undefined && <span className="block">{result.history.uptime24h.toFixed(1)}% 24h</span>}
                        </span>
                      )}
                      <button
                        type="button"
                        aria-label={`Stop monitoring ${monitor.name}`}
                        className="cursor-pointer opacity-50 hover:opacity-100"
                        onClick={() => {
                          void save({ ...workspace, monitors: workspace.monitors.filter((_, position) => position !== index) }, true);
                          setResults(results.filter((item) => item.url !== monitor.url));
                        }}
                      >
                        <XIcon className="size-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <form onSubmit={addMonitor} className="grid gap-1.5">
                <div className="flex gap-1.5">
                  <Input aria-label="Name to monitor" placeholder="Name" value={monitorName} maxLength={100} onChange={(event) => setMonitorName(event.target.value)} className="w-1/3 bg-base-100 text-base-content" />
                  <Input aria-label="Address to monitor" placeholder="api.example.com" value={monitorUrl} onChange={(event) => setMonitorUrl(event.target.value)} className="min-w-0 flex-1 bg-base-100 text-base-content" />
                  <Button type="submit" size="icon" aria-label="Add monitor">
                    <PlusIcon />
                  </Button>
                </div>
                {monitorError && (
                  <p role="alert" className="text-xs text-error">
                    {monitorError}
                  </p>
                )}
              </form>
            </div>
          )}
        </DevCard>
      )}

      {preferences.showTodos && (
        <DevCard title="Todos" icon={ListTodoIcon}>
          {workspace && (
            <div className="grid gap-2">
              <ul className="grid max-h-64 gap-0.5 overflow-y-auto">
                {workspace.todos.map((todo, index) => (
                  <li key={`${index}-${todo.text}`} className="flex items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-base-content/10">
                    <Checkbox
                      className="mt-0.5"
                      aria-label={`Mark ${todo.text} as ${todo.done ? "not done" : "done"}`}
                      checked={todo.done}
                      onCheckedChange={(done) => void save({ ...workspace, todos: workspace.todos.map((item, position) => (position === index ? { ...item, done: Boolean(done) } : item)) }, true)}
                    />
                    <span className={`min-w-0 flex-1 text-sm break-words ${todo.done ? "line-through opacity-55" : ""}`}>{todo.text}</span>
                    <button type="button" aria-label={`Delete ${todo.text}`} className="cursor-pointer opacity-50 hover:opacity-100" onClick={() => void save({ ...workspace, todos: workspace.todos.filter((_, position) => position !== index) }, true)}>
                      <XIcon className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
              <form onSubmit={addTodo} className="flex gap-1.5">
                <Input aria-label="New todo" placeholder="Add a todo" value={newTodo} maxLength={300} onChange={(event) => setNewTodo(event.target.value)} className="bg-base-100 text-base-content" />
                <Button type="submit" size="icon" aria-label="Add todo">
                  <PlusIcon />
                </Button>
              </form>
              {workspace.todos.some((todo) => todo.done) && (
                <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => void save({ ...workspace, todos: workspace.todos.filter((todo) => !todo.done) }, true)}>
                  <Trash2Icon /> Clear finished
                </Button>
              )}
            </div>
          )}
        </DevCard>
      )}

      {preferences.showNotes && (
        <DevCard title="Scratchpad" icon={NotebookPenIcon}>
          {workspace && (
            <Textarea
              aria-label="Scratchpad"
              spellCheck={false}
              maxLength={20000}
              placeholder="Commands, snippets, things to remember. Saved to your account."
              value={workspace.notes}
              onChange={(event) => void save({ ...workspace, notes: event.target.value }, false)}
              className="min-h-48 flex-1 resize-y bg-base-100 font-mono text-sm text-base-content"
            />
          )}
        </DevCard>
      )}
    </>
  );
}
