"use client";

import { useCallback, useEffect, useState } from "react";
import { CopyIcon, ScrollTextIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, SignedOutError } from "@/lib/api";
import { copyText, entrySeconds, formatDuration } from "@/lib/commands";
import type { Project, TimeEntry, WorkLog } from "@/lib/types";
import { DevCard, DevMessage } from "./dev-card";

type Day = "yesterday" | "today";

function dayRange(day: Day) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const from = new Date(today);
  if (day === "yesterday") from.setDate(from.getDate() - 1);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

function asStandup(day: Day, log: WorkLog, time: [string, number][]) {
  const lines = [day === "yesterday" ? "Yesterday:" : "Today:"];
  for (const commit of log.commits) lines.push(`- ${commit.repo}: ${commit.message}`);
  for (const pull of log.pullRequests) lines.push(`- PR ${pull.repo} #${pull.number}: ${pull.title}`);
  for (const run of log.runs) lines.push(`- ${run.repo}: ${run.workflow} ${run.conclusion || run.status}`);
  for (const [name, seconds] of time) lines.push(`- ${name}: ${formatDuration(seconds)} tracked`);
  return lines.join("\n");
}

export function WorkLogCard({ projects, onSignedOut }: { projects: Project[]; onSignedOut: () => void }) {
  const [day, setDay] = useState<Day>("yesterday");
  const [result, setResult] = useState<{ day: Day; log: WorkLog; entries: TimeEntry[] } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (chosen: Day) => {
      setLoading(true);
      const { from, to } = dayRange(chosen);
      try {
        const { log, entries } = await api.dev.workLog(from, to);
        setResult({ day: chosen, log, entries });
      } catch (error) {
        if (error instanceof SignedOutError) onSignedOut();
        else toast.error("Your work log couldn't be loaded.");
      } finally {
        setLoading(false);
      }
    },
    [onSignedOut],
  );

  useEffect(() => {
    const first = setTimeout(() => void load(day), 0);
    return () => clearTimeout(first);
  }, [day, load]);

  const log = result?.log;
  const time = new Map<string, number>();
  const { from, to } = dayRange(day);
  for (const entry of result?.entries ?? []) {
    const name = projects.find(({ id }) => id === entry.projectId)?.name ?? "Deleted project";
    time.set(name, (time.get(name) ?? 0) + entrySeconds(entry, from, to));
  }
  const times = [...time.entries()];
  const empty = log && log.commits.length === 0 && log.pullRequests.length === 0 && log.runs.length === 0 && times.length === 0;

  return (
    <DevCard title="Work log" icon={ScrollTextIcon} loading={loading} onRefresh={() => void load(day)}>
      <div className="grid gap-2">
        <div className="flex items-center gap-1">
          <div role="tablist" className="tabs tabs-box tabs-xs">
            {(["yesterday", "today"] as const).map((option) => (
              <button key={option} type="button" role="tab" aria-selected={day === option} className={`tab capitalize ${day === option ? "tab-active" : ""}`} onClick={() => setDay(option)}>
                {option}
              </button>
            ))}
          </div>
          {log && !empty && (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void copyText(asStandup(day, log, times), "Copied for your standup.", toast)}>
              <CopyIcon /> Copy
            </Button>
          )}
        </div>
        {empty && <DevMessage>Nothing recorded {day}.</DevMessage>}
        {log?.partial && <p className="px-1 text-xs text-warning">GitHub didn&apos;t answer in full, so this may be missing some work.</p>}
        {log && (
          <ul className="grid max-h-72 gap-0.5 overflow-y-auto">
            {log.commits.map((commit) => (
              <li key={commit.url}>
                <a href={commit.url} className="block rounded-lg px-1.5 py-1 hover:bg-base-content/10">
                  <span className="block truncate text-sm">{commit.message}</span>
                  <span className="block truncate font-mono text-xs opacity-70">{commit.repo}</span>
                </a>
              </li>
            ))}
            {log.pullRequests.map((pull) => (
              <li key={pull.url}>
                <a href={pull.url} className="block rounded-lg px-1.5 py-1 hover:bg-base-content/10">
                  <span className="block truncate text-sm">PR: {pull.title}</span>
                  <span className="block truncate font-mono text-xs opacity-70">
                    {pull.repo} #{pull.number}
                  </span>
                </a>
              </li>
            ))}
            {log.runs.map((run) => (
              <li key={run.url}>
                <a href={run.url} className="block rounded-lg px-1.5 py-1 hover:bg-base-content/10">
                  <span className="block truncate text-sm">
                    {run.workflow}: {run.conclusion || run.status}
                  </span>
                  <span className="block truncate font-mono text-xs opacity-70">
                    {run.repo} · {run.branch}
                  </span>
                </a>
              </li>
            ))}
            {times.map(([name, seconds]) => (
              <li key={name} className="flex justify-between gap-2 px-1.5 py-1 text-sm">
                <span className="min-w-0 truncate">{name}</span>
                <span className="flex-none font-mono tabular-nums opacity-80">{formatDuration(seconds)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DevCard>
  );
}
