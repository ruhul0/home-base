"use client";

import { useCallback, useEffect, useState } from "react";
import { BookMarkedIcon, CircleDotIcon, GitPullRequestIcon, HistoryIcon, StarIcon, UsersIcon } from "lucide-react";
import { api, SignedOutError } from "@/lib/api";
import type { GitHubDashboard, GitHubItem } from "@/lib/types";
import { DevCard, DevMessage, timeAgo } from "./dev-card";

const EVENT_LABELS: Record<string, string> = {
  PushEvent: "Pushed to",
  PullRequestEvent: "Pull request in",
  PullRequestReviewEvent: "Reviewed in",
  PullRequestReviewCommentEvent: "Commented on a PR in",
  IssuesEvent: "Issue in",
  IssueCommentEvent: "Commented in",
  CreateEvent: "Created in",
  DeleteEvent: "Deleted in",
  ForkEvent: "Forked",
  WatchEvent: "Starred",
  ReleaseEvent: "Released",
  PublicEvent: "Made public",
};

function SectionTitle({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-semibold tracking-wide uppercase opacity-70">
      <Icon className="size-3.5" />
      {children}
    </h3>
  );
}

function ItemList({ items, empty }: { items: GitHubItem[]; empty: string }) {
  if (items.length === 0) return <DevMessage>{empty}</DevMessage>;
  return (
    <ul className="grid gap-0.5">
      {items.map((item) => (
        <li key={item.url}>
          <a href={item.url} className="block rounded-lg px-1.5 py-1 hover:bg-base-content/10">
            <span className="line-clamp-1 text-sm">{item.title}</span>
            <span className="font-mono text-xs opacity-65">
              {item.repo}#{item.number} · {timeAgo(item.updatedAt)}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function GitHubCard({ onSignedOut }: { onSignedOut: () => void }) {
  const [data, setData] = useState<GitHubDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.dev.github();
      setData(result.data);
      setFailed(false);
    } catch (error) {
      if (error instanceof SignedOutError) onSignedOut();
      else setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [onSignedOut]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <DevCard title={data ? `GitHub · @${data.login}` : "GitHub"} icon={GitPullRequestIcon} className="home-widget-wide" loading={loading} onRefresh={load}>
      {!data && failed && <DevMessage>GitHub data isn&apos;t available right now. Try refreshing in a few minutes.</DevMessage>}
      {!data && !failed && <span className="loading mx-auto my-6 loading-spinner" aria-label="Loading GitHub data" />}
      {data && (
        <div className="grid gap-4">
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Public repos", value: data.publicRepos },
              { label: "Followers", value: data.followers },
              { label: "Following", value: data.following },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg bg-base-content/5 py-2">
                <dd className="font-mono text-lg font-bold tabular-nums">{stat.value}</dd>
                <dt className="text-xs opacity-70">{stat.label}</dt>
              </div>
            ))}
          </dl>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <SectionTitle icon={GitPullRequestIcon}>Open pull requests</SectionTitle>
              <ItemList items={data.pullRequests} empty="No open public pull requests." />
            </div>
            <div>
              <SectionTitle icon={CircleDotIcon}>Open issues</SectionTitle>
              <ItemList items={data.issues} empty="No open public issues." />
            </div>
            <div>
              <SectionTitle icon={BookMarkedIcon}>Recent repositories</SectionTitle>
              {data.repos.length === 0 && <DevMessage>No public repositories yet.</DevMessage>}
              <ul className="grid gap-0.5">
                {data.repos.map((repo) => (
                  <li key={repo.url}>
                    <a href={repo.url} className="block rounded-lg px-1.5 py-1 hover:bg-base-content/10">
                      <span className="line-clamp-1 font-mono text-sm">{repo.name}</span>
                      <span className="flex flex-wrap items-center gap-x-2 text-xs opacity-65">
                        {repo.language && <span>{repo.language}</span>}
                        <span className="inline-flex items-center gap-0.5">
                          <StarIcon className="size-3" aria-label="Stars" /> {repo.stars}
                        </span>
                        <span>{timeAgo(repo.pushedAt)}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <SectionTitle icon={HistoryIcon}>Recent activity</SectionTitle>
              {data.events.length === 0 && <DevMessage>No recent public activity.</DevMessage>}
              <ul className="grid gap-1 px-1.5">
                {data.events.map((event, index) => (
                  <li key={`${event.createdAt}-${index}`} className="text-sm">
                    <span className="opacity-70">{EVENT_LABELS[event.type] ?? "Activity in"} </span>
                    <a className="font-mono hover:underline" href={`https://github.com/${event.repo}`}>
                      {event.repo}
                    </a>
                    <span className="text-xs opacity-60"> · {timeAgo(event.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p className="flex items-center gap-1 px-1 text-xs opacity-60">
            <UsersIcon className="size-3" />
            Public data only, updated every 10 minutes{data.partial ? ". Some sections couldn't be loaded." : "."}
          </p>
        </div>
      )}
    </DevCard>
  );
}
