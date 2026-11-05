"use client";

import { useEffect, useState } from "react";
import { CopyIcon, DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { copyText, downloadFile, formatDuration } from "@/lib/commands";
import type { Project, ProjectReport } from "@/lib/types";

function previousMonth() {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthName(month: string) {
  const [year, number] = month.split("-").map(Number);
  return new Date(year, number - 1, 1).toLocaleDateString([], { month: "long", year: "numeric" });
}

function incidentLength(startedAt: string, endedAt: string | null) {
  if (!endedAt) return "ongoing";
  const seconds = (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000;
  return seconds < 60 ? "under a minute" : formatDuration(seconds);
}

function asMarkdown(report: ProjectReport, includeTime: boolean) {
  const lines = [`# ${report.project.name}: ${monthName(report.month)}`, "", report.project.url, "", "## Uptime", ""];
  if (report.uptime === null) lines.push("No checks were recorded this month.");
  else lines.push(`- Uptime: ${report.uptime.toFixed(2)}%`, `- Average response: ${report.averageMs}ms`, `- Checks: ${report.checks.toLocaleString()}`);
  lines.push("", "## Incidents", "");
  if (report.incidents.length === 0) lines.push("None recorded.");
  for (const incident of report.incidents) {
    lines.push(`- ${new Date(incident.startedAt).toLocaleString()}, ${incidentLength(incident.startedAt, incident.endedAt)}: ${incident.problem}`);
  }
  if (report.project.repo) {
    lines.push("", "## What shipped", "");
    if (!report.commitsAvailable) lines.push("The repository couldn't be read for this report.");
    else if (report.commits.length === 0) lines.push("No commits this month.");
    for (const commit of report.commits) lines.push(`- ${commit.message}`);
  }
  if (includeTime) lines.push("", "## Time", "", `${formatDuration(report.trackedSeconds)} tracked.`);
  return `${lines.join("\n")}\n`;
}

export function ProjectReportDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const [month, setMonth] = useState(previousMonth);
  const [report, setReport] = useState<ProjectReport | null>(null);
  const [error, setError] = useState("");
  const [includeTime, setIncludeTime] = useState(false);

  useEffect(() => {
    if (!month) return;
    let current = true;
    api.dev
      .report(project.id, month)
      .then((loaded) => {
        if (!current) return;
        setReport(loaded);
        setError("");
      })
      .catch((failure) => {
        if (!current) return;
        setReport(null);
        setError(failure instanceof ApiError ? failure.message : "That report couldn't be built.");
      });
    return () => {
      current = false;
    };
  }, [month, project.id]);

  const shown = report?.month === month ? report : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{project.name} report</DialogTitle>
          <DialogDescription>Nothing is sent to your client. Copy or download it, then share it yourself.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="report-month">Month</Label>
            <Input id="report-month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="w-44" />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Checkbox checked={includeTime} onCheckedChange={(checked) => setIncludeTime(Boolean(checked))} /> Include tracked time
          </label>
        </div>
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        {!error && !shown && <span className="loading loading-spinner justify-self-center" aria-label="Loading" />}
        {shown && (
          <>
            <pre className="max-h-96 overflow-auto rounded-lg bg-base-200 p-3 font-mono text-xs whitespace-pre-wrap text-base-content">{asMarkdown(shown, includeTime)}</pre>
            <div className="flex gap-2">
              <Button onClick={() => void copyText(asMarkdown(shown, includeTime), "Report copied as Markdown.", toast)}>
                <CopyIcon /> Copy Markdown
              </Button>
              <Button variant="secondary" onClick={() => downloadFile(`${project.name.replace(/[^\w-]+/g, "-")}-${shown.month}.md`, asMarkdown(shown, includeTime), "text/markdown")}>
                <DownloadIcon /> Download
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
