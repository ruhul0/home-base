import type { GitHubDashboard, MonitoredServer, ProjectStatus } from "./types";

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

export function buildAttention(projects: ProjectStatus[], github: GitHubDashboard | null, servers: MonitoredServer[] | null, serverTime: number): AttentionItem[] {
  const items: AttentionItem[] = [];
  const failedRepos = new Set<string>();

  for (const project of projects) {
    if (!project.monitor.up) {
      items.push({ key: `down-${project.id}`, severity: "critical", title: `${project.name} is down`, detail: project.monitor.problem, url: project.url });
    }
    for (const [label, date] of [["SSL certificate", project.certificateExpires], ["Domain", project.domainExpires]] as const) {
      if (!date) continue;
      const days = daysUntil(date);
      const severity = expirySeverity(days);
      if (severity) items.push({ key: `${label}-${project.id}`, severity, title: `${project.name}: ${label} ${expiryText(days)}`, url: project.url });
    }
    if (project.ci?.conclusion === "failure") {
      failedRepos.add(project.ci.repo);
      items.push({ key: `ci-${project.id}`, severity: "warning", title: `${project.name}: ${project.ci.workflow} failed on ${project.ci.branch}`, detail: project.ci.repo, url: project.ci.url, rerun: { repo: project.ci.repo, runId: project.ci.id } });
    }
  }

  for (const run of github?.ci ?? []) {
    if (run.conclusion === "failure" && !failedRepos.has(run.repo)) {
      items.push({ key: `ci-${run.repo}`, severity: "warning", title: `${run.workflow} failed on ${run.branch}`, detail: run.repo, url: run.url, rerun: { repo: run.repo, runId: run.id } });
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
