"use client";

import { useEffect, useMemo, useState } from "react";
import { DownloadIcon, PlayIcon, SquareIcon, TimerIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { csvCell, downloadFile, entrySeconds, formatDuration } from "@/lib/commands";
import type { Project, TimeEntry } from "@/lib/types";
import type { Timer } from "@/lib/use-workspace";
import { DevCard, DevMessage } from "./dev-card";

function Elapsed({ startedAt }: { startedAt: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const update = () => setSeconds(Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)));
    const first = setTimeout(update, 0);
    const timer = setInterval(update, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [startedAt]);
  const pad = (value: number) => String(value).padStart(2, "0");
  return <span className="font-mono tabular-nums">{`${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`}</span>;
}

function currentMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function buildCsv(entries: TimeEntry[], projects: Project[], from: Date, to: Date) {
  const rows = [["Date", "Project", "Note", "Start", "End", "Hours"].join(",")];
  for (const entry of [...entries].reverse()) {
    if (!entry.endedAt) continue;
    const start = new Date(entry.startedAt);
    const project = projects.find(({ id }) => id === entry.projectId)?.name ?? "Deleted project";
    rows.push([csvCell(start.toLocaleDateString("en-CA")), csvCell(project), csvCell(entry.note), csvCell(start.toLocaleTimeString()), csvCell(new Date(entry.endedAt).toLocaleTimeString()), (entrySeconds(entry, from, to) / 3600).toFixed(2)].join(","));
  }
  return `${rows.join("\r\n")}\r\n`;
}

export function TimeCard({ projects, timer }: { projects: Project[]; timer: Timer }) {
  const [projectId, setProjectId] = useState("");
  const [note, setNote] = useState("");
  const [exportMonth, setExportMonth] = useState(currentMonth);
  const chosen = projects.some(({ id }) => id === projectId) ? projectId : (projects[0]?.id ?? "");

  const totals = useMemo(() => {
    const seconds = new Map<string, number>();
    for (const entry of timer.entries) {
      if (entry.endedAt) seconds.set(entry.projectId, (seconds.get(entry.projectId) ?? 0) + entrySeconds(entry));
    }
    return [...seconds.entries()].sort((left, right) => right[1] - left[1]);
  }, [timer.entries]);

  const nameOf = (id: string) => projects.find((project) => project.id === id)?.name ?? "Deleted project";

  function start(event: React.FormEvent) {
    event.preventDefault();
    if (!chosen) return;
    void timer.start(chosen, note);
    setNote("");
  }

  async function exportCsv() {
    const [year, month] = exportMonth.split("-").map(Number);
    if (!year || !month) return;
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 1);
    try {
      const { entries } = await api.dev.timeEntries(from, to);
      if (entries.length === 0) {
        toast.info("No time was tracked in that month.");
        return;
      }
      downloadFile(`time-${exportMonth}.csv`, buildCsv(entries, projects, from, to), "text/csv");
    } catch {
      toast.error("Your time couldn't be exported.");
    }
  }

  return (
    <DevCard title="Time tracking" icon={TimerIcon}>
      <div className="grid gap-3">
        {timer.running ? (
          <div className="flex items-center gap-2 rounded-lg bg-base-content/5 p-2.5">
            <span className="status status-success flex-none animate-pulse" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm font-medium" title={timer.running.note}>
              {nameOf(timer.running.projectId)}
            </span>
            <Elapsed startedAt={timer.running.startedAt} />
            <Button size="sm" variant="secondary" onClick={() => void timer.stop()}>
              <SquareIcon /> Stop
            </Button>
          </div>
        ) : projects.length === 0 ? (
          <DevMessage>Add a project first, then track time against it.</DevMessage>
        ) : (
          <form onSubmit={start} className="grid gap-1.5">
            <select aria-label="Project" className="select select-sm w-full bg-base-100 text-base-content" value={chosen} onChange={(event) => setProjectId(event.target.value)}>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <div className="flex gap-1.5">
              <Input aria-label="What you're working on" placeholder="What are you working on?" maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} className="min-w-0 flex-1 bg-base-100 text-base-content" />
              <Button type="submit" size="icon" aria-label="Start timer">
                <PlayIcon />
              </Button>
            </div>
            <p className="text-xs opacity-70">
              Or press <kbd className="kbd kbd-xs text-base-content">s</kbd> anywhere to start or stop.
            </p>
          </form>
        )}

        {totals.length > 0 && (
          <div>
            <h3 className="mb-1 px-1 text-xs font-semibold opacity-70">This month</h3>
            <ul className="grid gap-0.5">
              {totals.map(([id, seconds]) => (
                <li key={id} className="flex justify-between gap-2 px-1 text-sm">
                  <span className="min-w-0 truncate">{nameOf(id)}</span>
                  <span className="flex-none font-mono tabular-nums opacity-80">{formatDuration(seconds)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {timer.entries.length > 0 && (
          <details>
            <summary className="cursor-pointer px-1 text-xs font-semibold opacity-70">Entries</summary>
            <ul className="mt-1 grid max-h-48 gap-0.5 overflow-y-auto">
              {timer.entries
                .filter((entry) => entry.endedAt)
                .map((entry) => (
                  <li key={entry.id} className="flex items-center gap-2 rounded-lg px-1 py-0.5 text-xs hover:bg-base-content/10">
                    <span className="flex-none opacity-70">{new Date(entry.startedAt).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                    <span className="min-w-0 flex-1 truncate">{entry.note || nameOf(entry.projectId)}</span>
                    <span className="flex-none font-mono tabular-nums">{formatDuration(entrySeconds(entry))}</span>
                    <button type="button" aria-label="Delete this entry" className="flex-none cursor-pointer opacity-50 hover:opacity-100" onClick={() => void timer.remove(entry.id)}>
                      <XIcon className="size-3" />
                    </button>
                  </li>
                ))}
            </ul>
          </details>
        )}

        <div className="flex items-center gap-1.5">
          <Input aria-label="Month to export" type="month" value={exportMonth} onChange={(event) => setExportMonth(event.target.value)} className="min-w-0 flex-1 bg-base-100 text-base-content" />
          <Button variant="secondary" size="sm" onClick={() => void exportCsv()}>
            <DownloadIcon /> CSV
          </Button>
        </div>
      </div>
    </DevCard>
  );
}
