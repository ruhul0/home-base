"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRingIcon, CircleCheckIcon, RotateCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, SignedOutError } from "@/lib/api";
import { buildAttention, describeUnchecked, type Severity } from "@/lib/attention";
import type { GitHubResponse, MonitoredServer, ProjectStatus } from "@/lib/types";

const GITHUB_REFRESH_MS = 5 * 60 * 1000;
const SERVER_REFRESH_MS = 60 * 1000;
const COLLAPSED_ITEMS = 6;
const TONES: Record<Severity, string> = { critical: "status-error", warning: "status-warning", info: "status-info" };

export function AttentionBar({
  projects,
  projectsFailed,
  isAdmin,
  watchServers,
  onRerun,
  onSignedOut,
}: {
  projects: ProjectStatus[] | null;
  projectsFailed: boolean;
  isAdmin: boolean;
  watchServers: boolean;
  onRerun: (repo: string, runId: number) => void;
  onSignedOut: () => void;
}) {
  const [github, setGithub] = useState<GitHubResponse | null>(null);
  const [githubFailed, setGithubFailed] = useState(false);
  const [servers, setServers] = useState<MonitoredServer[] | null>(null);
  const [serversFailed, setServersFailed] = useState(false);
  const [serverTime, setServerTime] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const loadGitHub = useCallback(async () => {
    try {
      const response = await api.dev.github();
      setGithub(response);
      setGithubFailed(false);
    } catch (error) {
      if (error instanceof SignedOutError) onSignedOut();
      else setGithubFailed(true);
    }
  }, [onSignedOut]);

  const loadServers = useCallback(async () => {
    try {
      const result = await api.admin.servers();
      setServers(result.servers);
      setServersFailed(false);
      setServerTime(new Date(result.serverTime).getTime());
    } catch {
      setServersFailed(true);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void loadGitHub(), 0);
    const timer = setInterval(() => void loadGitHub(), GITHUB_REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [loadGitHub]);

  useEffect(() => {
    if (!isAdmin) return;
    const first = setTimeout(() => void loadServers(), 0);
    const timer = setInterval(() => void loadServers(), SERVER_REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [isAdmin, loadServers]);

  const items = useMemo(() => buildAttention(projects ?? [], github?.data ?? null, servers, serverTime), [github, projects, serverTime, servers]);

  const unknown = describeUnchecked({ projects, projectsFailed, github, githubFailed, isAdmin, watchServers, servers, serversFailed });
  const loaded = projects !== null || projectsFailed;
  if (!loaded) return null;
  // Nothing is claimed until every source has answered, so "all clear" can't appear while one is still loading.
  const answered = (github !== null || githubFailed) && (!isAdmin || servers !== null || serversFailed);
  if (items.length === 0 && !answered) return null;

  if (items.length === 0) {
    return (
      <p className="home-group mb-3 flex items-center gap-2 text-sm" role="status">
        {unknown ? <BellRingIcon className="size-4 flex-none text-warning" /> : <CircleCheckIcon className="size-4 flex-none text-success" />}
        {unknown ? `Nothing needs you so far, but ${unknown} couldn't be checked.` : "All clear. Nothing needs you right now."}
      </p>
    );
  }

  const visible = expanded ? items : items.slice(0, COLLAPSED_ITEMS);
  return (
    <section className="home-group mb-3" aria-label="Needs attention">
      <h2 className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold">
        <BellRingIcon className="size-4 flex-none text-error" />
        Needs attention · {items.length}
        {unknown && <span className="font-normal opacity-70">({unknown} couldn&apos;t be checked)</span>}
      </h2>
      <ul className="grid gap-0.5">
        {visible.map((item) => (
          <li key={item.key} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-base-content/10">
            <span className={`status flex-none ${TONES[item.severity]}`} aria-label={item.severity} />
            {item.url ? (
              <a href={item.url} className="min-w-0 flex-1 truncate text-sm" title={item.detail}>
                {item.title}
              </a>
            ) : (
              <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
            )}
            {item.detail && <span className="hidden max-w-[40%] flex-none truncate font-mono text-xs opacity-70 sm:block">{item.detail}</span>}
            {item.rerun && (
              <Button variant="ghost" size="sm" onClick={() => onRerun(item.rerun!.repo, item.rerun!.runId)}>
                <RotateCwIcon /> Re-run
              </Button>
            )}
          </li>
        ))}
      </ul>
      {items.length > COLLAPSED_ITEMS && (
        <Button variant="ghost" size="sm" className="mt-1" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show fewer" : `Show ${items.length - COLLAPSED_ITEMS} more`}
        </Button>
      )}
    </section>
  );
}
