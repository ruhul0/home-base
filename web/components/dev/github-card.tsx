"use client";

import { useCallback, useEffect, useState } from "react";
import { BookMarkedIcon, CircleDotIcon, EyeIcon, GitPullRequestIcon, HistoryIcon, LockIcon, ShieldCheckIcon, StarIcon, UsersIcon, WorkflowIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, SignedOutError } from "@/lib/api";
import { isExtension, SERVER_URL } from "@/lib/browser";
import type { GitHubItem, GitHubResponse } from "@/lib/types";
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

const CONNECT_RESULTS: Record<string, { ok: boolean; message: string }> = {
  connected: { ok: true, message: "Private GitHub is connected." },
  installed: { ok: true, message: "Your repository access is updated." },
  cancelled: { ok: false, message: "Connecting GitHub was cancelled." },
  wrong_account: { ok: false, message: "That GitHub account doesn't match the one you signed in with, so nothing was saved." },
  failed: { ok: false, message: "Connecting GitHub didn't work. Try again." },
};

function ConnectDialog({ open, onOpenChange, onConnect, connecting }: { open: boolean; onOpenChange: (open: boolean) => void; onConnect: () => void; connecting: boolean }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect private GitHub</DialogTitle>
          <DialogDescription>Adds private repositories, private pull requests and issues, and review requests to this panel.</DialogDescription>
        </DialogHeader>
        <ul className="grid list-disc gap-1.5 pl-5 text-sm">
          <li>You choose which repositories the Home Base GitHub App can see.</li>
          <li>It reads those repositories, and can&apos;t change code, issues or settings.</li>
          <li>If the app also has the Actions read and write permission and you accept it on GitHub, you can re-run and start workflows here. They only run when you ask, and a workflow can do whatever it&apos;s written to do, including deploying.</li>
          <li>Tokens are encrypted on the server and are never sent to your browser.</li>
          <li>Whoever runs this server holds the encryption key, so only connect if you trust them.</li>
          <li>Disconnect at any time, which deletes the tokens and withdraws access.</li>
          <li>GitHub doesn&apos;t let apps read notifications, so those aren&apos;t included.</li>
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button disabled={connecting} onClick={onConnect}>
            Continue to GitHub
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GitHubCard({ onSignedOut }: { onSignedOut: () => void }) {
  const [response, setResponse] = useState<GitHubResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const data = response?.data ?? null;

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const result = await api.dev.github(fresh);
      setResponse(result);
      setFailed(false);
      if (result.needsReconnect) toast.error("Your private GitHub connection stopped working, so this panel shows public data. Connect again to restore it.");
    } catch (error) {
      if (error instanceof SignedOutError) onSignedOut();
      else setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [onSignedOut]);

  useEffect(() => {
    // Returning from GitHub leaves a result in the address, which is removed straight away.
    const params = new URLSearchParams(location.search);
    const result = CONNECT_RESULTS[params.get("github") ?? ""];
    if (params.has("github") || params.has("setup_action")) history.replaceState(null, "", location.pathname);
    if (result) {
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    }
    const timer = setTimeout(() => void load(Boolean(result?.ok)), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function connect() {
    setConnecting(true);
    try {
      location.href = (await api.dev.connectGitHub()).url;
    } catch (error) {
      setConnecting(false);
      if (error instanceof SignedOutError) onSignedOut();
      else toast.error(error instanceof Error ? error.message : "Connecting GitHub didn't work. Try again.");
    }
  }

  async function disconnect() {
    try {
      await api.dev.disconnectGitHub();
      setConfirmDisconnect(false);
      toast.success("Private GitHub is disconnected and its access is withdrawn.");
      await load();
    } catch (error) {
      if (error instanceof SignedOutError) onSignedOut();
      else toast.error("Disconnecting didn't work. Try again.");
    }
  }

  return (
    <DevCard title={data ? `GitHub · @${data.login}` : "GitHub"} icon={GitPullRequestIcon} className="home-widget-wide" loading={loading} onRefresh={() => void load(true)}>
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
              <ItemList items={data.pullRequests} empty={response?.connected ? "No open pull requests." : "No open public pull requests."} />
            </div>
            <div>
              <SectionTitle icon={CircleDotIcon}>Open issues</SectionTitle>
              <ItemList items={data.issues} empty={response?.connected ? "No open issues." : "No open public issues."} />
            </div>
            {(data.ci.length > 0 || data.ciNeedsPermission) && (
              <div className="md:col-span-2">
                <SectionTitle icon={WorkflowIcon}>CI status</SectionTitle>
                {data.ciNeedsPermission && (
                  <DevMessage>CI status needs the Actions read-only permission. Add it in your GitHub App&apos;s settings, then approve the change on GitHub.</DevMessage>
                )}
                <ul className="grid gap-0.5 md:grid-cols-2">
                  {data.ci.map((run) => {
                    const running = run.status !== "completed";
                    const state = running ? "status-warning" : run.conclusion === "success" ? "status-success" : ["skipped", "neutral", "cancelled"].includes(run.conclusion) ? "status-neutral" : "status-error";
                    const label = running ? run.status.replaceAll("_", " ") : run.conclusion.replaceAll("_", " ");
                    return (
                      <li key={run.repo}>
                        <a href={run.url} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-base-content/10">
                          <span className={`status flex-none ${state} ${running ? "animate-pulse" : ""}`} aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-sm">{run.repo}</span>
                            <span className="block truncate text-xs opacity-65">
                              {run.workflow} · {run.branch} · {label} · {timeAgo(run.updatedAt)}
                            </span>
                          </span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {response?.connected && (
              <div className="md:col-span-2">
                <SectionTitle icon={EyeIcon}>Review requests</SectionTitle>
                <ItemList items={data.reviewRequests} empty="Nothing is waiting for your review." />
              </div>
            )}
            <div>
              <SectionTitle icon={BookMarkedIcon}>Recent repositories</SectionTitle>
              {data.repos.length === 0 && <DevMessage>No public repositories yet.</DevMessage>}
              <ul className="grid gap-0.5">
                {data.repos.map((repo) => (
                  <li key={repo.url}>
                    <a href={repo.url} className="block rounded-lg px-1.5 py-1 hover:bg-base-content/10">
                      <span className="flex items-center gap-1.5">
                        {repo.private && <LockIcon className="size-3 flex-none" aria-label="Private" />}
                        <span className="line-clamp-1 font-mono text-sm">{repo.name}</span>
                      </span>
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
            {response?.connected ? "Includes the private repositories you selected, updated every 5 minutes." : "Public data only, updated every 10 minutes."}
            {data.fromRecentRepos ? " Pull requests and issues come from your recent repositories, so items elsewhere won't appear." : ""}
            {data.partial ? " Some sections couldn't be loaded." : ""}
          </p>

          {response?.available && !response.connected && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-base-content/5 px-3 py-2">
              <span className="flex items-center gap-2 text-sm">
                <ShieldCheckIcon className="size-4 flex-none text-primary" aria-hidden />
                Add private repositories and review requests. You choose which repositories.
              </span>
              {isExtension() ? (
                <Button size="sm" render={<a href={`${SERVER_URL}/newtab`} target="_blank" rel="noopener" />}>
                  Connect on the website
                </Button>
              ) : (
                <Button size="sm" onClick={() => setConnectOpen(true)}>
                  Connect private GitHub
                </Button>
              )}
            </div>
          )}

          {response?.connected && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-base-content/5 px-3 py-2">
              <span className="flex items-center gap-2 text-sm">
                <ShieldCheckIcon className="size-4 flex-none text-success" aria-hidden />
                Private GitHub connected.
              </span>
              <span className="flex flex-wrap gap-1.5">
                {response.manageUrl && (
                  <Button size="sm" variant="outline" render={<a href={response.manageUrl} />}>
                    Choose repositories
                  </Button>
                )}
                {confirmDisconnect ? (
                  <>
                    <Button size="sm" variant="destructive" onClick={() => void disconnect()}>
                      Really disconnect?
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(false)}>
                      Keep it
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(true)}>
                    Disconnect
                  </Button>
                )}
              </span>
            </div>
          )}
          <ConnectDialog open={connectOpen} onOpenChange={setConnectOpen} onConnect={() => void connect()} connecting={connecting} />
        </div>
      )}
    </DevCard>
  );
}
