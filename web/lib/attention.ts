import type { GitHubDashboard, GitHubResponse, MonitoredServer, MonitorResult, ProjectStatus } from "./types";

export type Severity = "critical" | "warning" | "info";

export interface AttentionItem {
  key: string;
  severity: Severity;
  title: string;
  detail?: string;
  url?: string;
  rerun?: { repo: string; runId: number };
}

const OFFLINE_AFTER_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export function daysUntil(date: string) {
  return Math.ceil((new Date(date).getTime() - Date.now()) / DAY_MS);
}

/** Warnings get louder at 30, 14 and 7 days. */
export function expirySeverity(days: number): Severity | null {
  if (days <= 7) return "critical";
  if (days <= 14) return "warning";
  if (days <= 30) return "info";
  return null;
}

function expiryText(days: number) {
  if (days < 0) return `expired ${-days} ${-days === 1 ? "day" : "days"} ago`;
  if (days === 0) return "expires today";
  return `expires in ${days} ${days === 1 ? "day" : "days"}`;
}

/** A single failed check may be a blip, so a site only counts as down once it's been confirmed. */
export function isDown(monitor: Pick<MonitorResult, "up" | "unconfirmed">) {
  return !monitor.up && !monitor.unconfirmed;
}

/** Cancelled runs aren't included, because a newer run often cancels an older one on purpose. */
export function isFailedRun(run: { conclusion: string } | null | undefined) {
  return run?.conclusion === "failure" || run?.conclusion === "timed_out" || run?.conclusion === "startup_failure";
}

function runOutcome(conclusion: string) {
  if (conclusion === "timed_out") return "timed out";
  if (conclusion === "startup_failure") return "couldn't start";
  return "failed";
}

function joinWords(words: string[]) {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** Names what couldn't be checked, so "all clear" is never said while something is unknown. */
export function describeUnchecked(state: {
  projects: ProjectStatus[] | null;
  projectsFailed: boolean;
  github: Pick<GitHubResponse, "connected" | "data"> | null;
  githubFailed: boolean;
  isAdmin: boolean;
  watchServers: boolean;
  servers: Pick<MonitoredServer, "reportedAt">[] | null;
  serversFailed: boolean;
}) {
  const unknown: string[] = [];
  if (state.projectsFailed) unknown.push("your projects");

  if (state.githubFailed) unknown.push("GitHub");
  else if (state.github) {
    // Review requests need a private connection, so without one nothing is known about them.
    if (!state.github.connected) unknown.push("review requests");
    if (state.github.data.partial) unknown.push("part of GitHub");
    if (state.github.data.ciNeedsPermission) unknown.push("CI on your repositories");
  }

  const unreadCI = (state.projects ?? []).filter((project) => project.ciUnreadable).length;
  if (unreadCI > 0) unknown.push(`CI on ${unreadCI} ${unreadCI === 1 ? "project" : "projects"}`);

  if (state.isAdmin && state.watchServers) {
    if (state.serversFailed) unknown.push("your servers");
    else if (state.servers) {
      const silent = state.servers.filter((server) => !server.reportedAt).length;
      if (state.servers.length === 0) unknown.push("server health");
      else if (silent > 0) unknown.push(`${silent} ${silent === 1 ? "server that hasn't" : "servers that haven't"} reported yet`);
    }
  }
  return joinWords(unknown);
}

export function buildAttention(projects: ProjectStatus[], github: GitHubDashboard | null, servers: MonitoredServer[] | null, serverTime: number): AttentionItem[] {
  const items: AttentionItem[] = [];
  const failedRepos = new Set<string>();

  for (const project of projects) {
    if (isDown(project.monitor)) {
      items.push({ key: `down-${project.id}`, severity: "critical", title: `${project.name} is down`, detail: project.monitor.problem, url: project.url });
    }
    for (const [label, date] of [["SSL certificate", project.certificateExpires], ["Domain", project.domainExpires]] as const) {
      if (!date) continue;
      const days = daysUntil(date);
      const severity = expirySeverity(days);
      if (severity) items.push({ key: `${label}-${project.id}`, severity, title: `${project.name}: ${label} ${expiryText(days)}`, url: project.url });
    }
    if (project.ci && isFailedRun(project.ci)) {
      failedRepos.add(project.ci.repo);
      items.push({ key: `ci-${project.id}`, severity: "warning", title: `${project.name}: ${project.ci.workflow} ${runOutcome(project.ci.conclusion)} on ${project.ci.branch}`, detail: project.ci.repo, url: project.ci.url, rerun: { repo: project.ci.repo, runId: project.ci.id } });
    }
  }

  for (const run of github?.ci ?? []) {
    if (isFailedRun(run) && !failedRepos.has(run.repo)) {
      items.push({ key: `ci-${run.repo}`, severity: "warning", title: `${run.workflow} ${runOutcome(run.conclusion)} on ${run.branch}`, detail: run.repo, url: run.url, rerun: { repo: run.repo, runId: run.id } });
    }
  }
  for (const review of github?.reviewRequests ?? []) {
    items.push({ key: `review-${review.url}`, severity: "warning", title: `Review requested: ${review.title}`, detail: `${review.repo} #${review.number}`, url: review.url });
  }

  for (const server of servers ?? []) {
    const reported = server.reportedAt ? new Date(server.reportedAt).getTime() : 0;
    if (reported > 0 && serverTime - reported >= OFFLINE_AFTER_MS) {
      items.push({ key: `server-${server.id}`, severity: "critical", title: `Server ${server.name} stopped reporting` });
    }
    const report = server.report;
    if (!report) continue;
    if (report.diskPercent >= 80) {
      items.push({ key: `disk-${server.id}`, severity: report.diskPercent >= 90 ? "critical" : "warning", title: `Server ${server.name}: disk ${Math.round(report.diskPercent)}% full` });
    }
    if (report.unhealthy.length) {
      items.push({ key: `unhealthy-${server.id}`, severity: "critical", title: `Server ${server.name}: unhealthy containers`, detail: report.unhealthy.join(", ") });
    }
  }

  return items.sort((left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]);
}
