"use client";

import { useState } from "react";
import { BriefcaseIcon, FileTextIcon, GitBranchIcon, FlaskConicalIcon, PencilIcon, PlayIcon, PlusIcon, RotateCwIcon, SquareIcon, TerminalIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { daysUntil, expirySeverity } from "@/lib/attention";
import { copyText } from "@/lib/commands";
import { normalizeUrl } from "@/lib/links";
import type { Project, ProjectStatus, Workspace } from "@/lib/types";
import type { SaveWorkspace, Timer } from "@/lib/use-workspace";
import { DevCard, DevMessage, timeAgo } from "./dev-card";

const EMPTY: Project = { id: "", name: "", url: "", staging: "", repo: "", ssh: "", notes: "" };
const BADGE_TONES = { critical: "badge-error", warning: "badge-warning", info: "badge-info" };

function ExpiryBadge({ label, date }: { label: string; date: string | null }) {
  if (!date) {
    return <span className="badge badge-ghost badge-sm font-mono" title={`${label} date not known yet. Some registries don't publish it.`}>{label} ?</span>;
  }
  const days = daysUntil(date);
  const severity = expirySeverity(days);
  return (
    <span className={`badge badge-sm font-mono ${severity ? BADGE_TONES[severity] : "badge-ghost"}`} title={`${label} expires ${new Date(date).toLocaleDateString()}`}>
      {label} {days < 0 ? "expired" : `${days}d`}
    </span>
  );
}

function cleanRepo(value: string) {
  return value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
}

function ProjectDialog({ project, onSave, onDelete, onClose }: { project: Project; onSave: (project: Project) => void; onDelete?: () => void; onClose: () => void }) {
  const [form, setForm] = useState(project);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const field = (key: keyof Project) => ({
    value: form[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: event.target.value }),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const url = normalizeUrl(form.url);
    const staging = form.staging.trim() ? normalizeUrl(form.staging) : "";
    const repo = cleanRepo(form.repo);
    if (!form.name.trim()) return setError("Give this project a name.");
    if (!url) return setError("Enter the production address, like example.com.");
    if (staging === null) return setError("That staging address isn't valid.");
    if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) return setError("Enter the repository as owner/name.");
    onSave({ ...form, id: form.id || crypto.randomUUID(), name: form.name.trim(), url, staging, repo, ssh: form.ssh.trim() });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{project.id ? `Edit ${project.name}` : "Add a project"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="project-name">Name</Label>
            <Input id="project-name" autoFocus maxLength={100} {...field("name")} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="project-url">Production address</Label>
            <Input id="project-url" placeholder="example.com" {...field("url")} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="project-staging">Staging address (optional)</Label>
            <Input id="project-staging" placeholder="staging.example.com" {...field("staging")} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="project-repo">GitHub repository (optional)</Label>
            <Input id="project-repo" className="font-mono" placeholder="owner/name" {...field("repo")} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="project-ssh">SSH command (optional)</Label>
            <Input id="project-ssh" className="font-mono" maxLength={200} placeholder="ssh deploy@example.com" {...field("ssh")} />
            <p className="text-xs opacity-70">Saved to your account unencrypted, so never put a password here.</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="project-notes">Notes (optional)</Label>
            <Textarea id="project-notes" maxLength={2000} {...field("notes")} />
          </div>
          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
          <DialogFooter>
            {onDelete && (
              <Button type="button" variant={confirmDelete ? "destructive" : "ghost"} className="mr-auto" onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}>
                {confirmDelete ? "Really delete?" : "Delete"}
              </Button>
            )}
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectsCard({
  workspace,
  save,
  projects,
  loading,
  onRefresh,
  timer,
  onReport,
  onRerun,
}: {
  workspace: Workspace | null;
  save: SaveWorkspace;
  projects: ProjectStatus[] | null;
  loading: boolean;
  onRefresh: () => void;
  timer: Timer;
  onReport: (project: Project) => void;
  onRerun: (repo: string, runId: number) => void;
}) {
  const [editing, setEditing] = useState<Project | null>(null);
  const list = workspace?.projects ?? [];

  function saveProject(project: Project) {
    if (!workspace) return;
    const exists = list.some(({ id }) => id === project.id);
    void save({ ...workspace, projects: exists ? list.map((item) => (item.id === project.id ? project : item)) : [...list, project] }, true);
    setEditing(null);
  }

  function deleteProject(id: string) {
    if (!workspace) return;
    void save({ ...workspace, projects: list.filter((item) => item.id !== id) }, true);
    setEditing(null);
  }

  const downCount = (projects ?? []).filter(({ monitor }) => !monitor.up).length;
  const title = list.length ? `Projects · ${list.length}${projects ? (downCount ? ` · ${downCount} down` : " · all up") : ""}` : "Projects";

  return (
    <DevCard title={title} icon={BriefcaseIcon} className="home-widget-wide" loading={loading} onRefresh={list.length ? onRefresh : undefined}>
      <div className="grid gap-3">
        {workspace && list.length === 0 && <DevMessage>Add a client site to see its status, SSL and domain expiry, CI and SSH in one place. Your server checks it every 2 minutes, even with this page closed.</DevMessage>}
        {list.length > 0 && (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((project) => {
              const status = projects?.find(({ id }) => id === project.id);
              const monitor = status?.monitor;
              const dot = !monitor ? "status-neutral" : monitor.up ? "status-success" : "status-error";
              const isRunning = timer.running?.projectId === project.id;
              const uptime = monitor?.history?.uptime24h;
              return (
                <li key={project.id} className="grid content-start gap-2 rounded-lg bg-base-content/5 p-3">
                  <div className="flex items-center gap-2">
                    <span className={`status flex-none ${dot}`} aria-label={!monitor ? "Not checked yet" : monitor.up ? "Up" : "Down"} />
                    <a href={project.url} className="min-w-0 flex-1 truncate text-sm font-semibold hover:underline" title={project.notes || project.url}>
                      {project.name}
                    </a>
                    {monitor?.up && (
                      <span className="flex-none font-mono text-xs tabular-nums opacity-70">
                        {monitor.ms}ms{uptime !== null && uptime !== undefined ? ` · ${uptime.toFixed(1)}%` : ""}
                      </span>
                    )}
                    <button type="button" aria-label={`Edit ${project.name}`} className="flex-none cursor-pointer opacity-50 hover:opacity-100" onClick={() => setEditing(project)}>
                      <PencilIcon className="size-3.5" />
                    </button>
                  </div>
                  {monitor && !monitor.up && <p className="truncate text-xs text-error" title={monitor.problem}>{monitor.problem}</p>}
                  <p className="truncate font-mono text-xs opacity-70">{new URL(project.url).hostname}</p>
                  <div className="flex flex-wrap items-center gap-1">
                    {project.url.startsWith("https:") && <ExpiryBadge label="SSL" date={status?.certificateExpires ?? null} />}
                    <ExpiryBadge label="Domain" date={status?.domainExpires ?? null} />
                    {status?.ci && (
                      <a href={status.ci.url} className={`badge badge-sm font-mono ${status.ci.conclusion === "failure" ? "badge-error" : status.ci.conclusion === "success" ? "badge-success" : "badge-ghost"}`} title={`${status.ci.workflow} on ${status.ci.branch}, ${timeAgo(status.ci.updatedAt)}`}>
                        CI {status.ci.conclusion || status.ci.status} · {timeAgo(status.ci.updatedAt)}
                      </a>
                    )}
                    {project.repo && !status?.ci && status && <span className="badge badge-ghost badge-sm font-mono" title="No workflow runs found, or the GitHub App can't read this repository's Actions.">CI ?</span>}
                  </div>
                  <div className="-ml-1.5 flex flex-wrap items-center gap-0.5">
                    <Button variant="ghost" size="sm" aria-pressed={isRunning} onClick={() => void (isRunning ? timer.stop() : timer.start(project.id))}>
                      {isRunning ? <SquareIcon /> : <PlayIcon />} {isRunning ? "Stop" : "Timer"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onReport(project)}>
                      <FileTextIcon /> Report
                    </Button>
                    {project.staging && (
                      <Button variant="ghost" size="sm" render={<a href={project.staging} />}>
                        <FlaskConicalIcon /> Staging
                      </Button>
                    )}
                    {project.repo && (
                      <Button variant="ghost" size="sm" render={<a href={`https://github.com/${project.repo}`} />}>
                        <GitBranchIcon /> Repo
                      </Button>
                    )}
                    {project.ssh && (
                      <Button variant="ghost" size="sm" title={project.ssh} onClick={() => void copyText(project.ssh, `Copied: ${project.ssh}`, toast)}>
                        <TerminalIcon /> SSH
                      </Button>
                    )}
                    {status?.ci?.conclusion === "failure" && (
                      <Button variant="ghost" size="sm" onClick={() => onRerun(status.ci!.repo, status.ci!.id)}>
                        <RotateCwIcon /> Re-run
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {workspace && (
          <Button variant="secondary" size="sm" className="justify-self-start" onClick={() => setEditing(EMPTY)}>
            <PlusIcon /> Add project
          </Button>
        )}
      </div>
      {editing && <ProjectDialog project={editing} onSave={saveProject} onDelete={editing.id ? () => deleteProject(editing.id) : undefined} onClose={() => setEditing(null)} />}
    </DevCard>
  );
}
