"use client";

import { useCallback, useEffect, useState } from "react";
import { CopyIcon, PlusIcon, ServerIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, SignedOutError } from "@/lib/api";
import { SERVER_URL } from "@/lib/browser";
import type { MonitoredServer } from "@/lib/types";
import { DevCard, DevMessage, timeAgo } from "./dev-card";

const REFRESH_MS = 60 * 1000;
const OFFLINE_AFTER_MS = 5 * 60 * 1000;
const AGENT_URL = "https://raw.githubusercontent.com/ruhul0/home-base/main/deploy/server-agent.sh";

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  if (days > 0) return `${days}d`;
  return `${Math.floor(seconds / 3600)}h`;
}

function Meter({ label, value }: { label: string; value: number }) {
  const tone = value >= 90 ? "progress-error" : value >= 75 ? "progress-warning" : "progress-success";
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="opacity-70">{label}</span>
        <span className="font-mono tabular-nums">{Math.round(value)}%</span>
      </div>
      <progress className={`progress h-1.5 w-full ${tone}`} value={value} max={100} aria-label={`${label} ${Math.round(value)} percent used`} />
    </div>
  );
}

export function ServersCard({ onSignedOut }: { onSignedOut: () => void }) {
  const [servers, setServers] = useState<MonitoredServer[] | null>(null);
  const [serverTime, setServerTime] = useState(0);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [install, setInstall] = useState<{ name: string; command: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const reportError = useCallback(
    (error: unknown, message: string) => {
      if (error instanceof SignedOutError) onSignedOut();
      else toast.error(message);
    },
    [onSignedOut],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.admin.servers();
      setServers(result.servers);
      setServerTime(new Date(result.serverTime).getTime());
    } catch (error) {
      reportError(error, "Server health couldn't be loaded.");
    } finally {
      setLoading(false);
    }
  }, [reportError]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  async function addServer(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const { token } = await api.admin.addServer(trimmed);
      setName("");
      setInstall({
        name: trimmed,
        command: `curl -fsSL ${AGENT_URL} -o /tmp/home-base-agent.sh && bash /tmp/home-base-agent.sh install ${SERVER_URL} ${token} && rm /tmp/home-base-agent.sh`,
      });
      await load();
    } catch (error) {
      reportError(error, "That server couldn't be added.");
    }
  }

  async function copyCommand() {
    if (!install) return;
    try {
      await navigator.clipboard.writeText(install.command);
      toast.success("Install command copied.");
    } catch {
      toast.error("Your browser blocked copying.");
    }
  }

  async function removeServer(id: number) {
    try {
      await api.admin.deleteServer(id);
      setConfirmDelete(null);
      await load();
    } catch (error) {
      reportError(error, "That server couldn't be removed.");
    }
  }

  return (
    <DevCard title="Servers" icon={ServerIcon} className="home-widget-wide" loading={loading} onRefresh={() => void load()}>
      <div className="grid gap-3">
        {servers?.length === 0 && !install && <DevMessage>Add a server below, then run the install command on it. It reports disk, memory, load and container status once a minute. Only you can see this panel.</DevMessage>}

        {servers && servers.length > 0 && (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {servers.map((server) => {
              const reported = server.reportedAt ? new Date(server.reportedAt).getTime() : 0;
              const online = reported > 0 && serverTime - reported < OFFLINE_AFTER_MS;
              const report = server.report;
              return (
                <li key={server.id} className="grid content-start gap-2 rounded-lg bg-base-content/5 p-3">
                  <div className="flex items-center gap-2">
                    <span className={`status flex-none ${online ? "status-success" : "status-error"}`} aria-label={online ? "Online" : "Offline"} />
                    <span className="min-w-0 flex-1 truncate font-mono text-sm font-semibold">{server.name}</span>
                    {confirmDelete === server.id ? (
                      <Button size="sm" variant="destructive" onClick={() => void removeServer(server.id)}>
                        Remove?
                      </Button>
                    ) : (
                      <button type="button" aria-label={`Remove ${server.name}`} className="cursor-pointer opacity-50 hover:opacity-100" onClick={() => setConfirmDelete(server.id)}>
                        <Trash2Icon className="size-3.5" />
                      </button>
                    )}
                  </div>
                  {!report && <p className="text-xs opacity-70">Waiting for its first report.</p>}
                  {report && (
                    <>
                      <Meter label="Disk" value={report.diskPercent} />
                      <Meter label="Memory" value={report.memoryPercent} />
                      <p className="font-mono text-xs opacity-75">
                        load {report.load.toFixed(2)}/{report.cores} · up {formatUptime(report.uptimeSeconds)}
                        {report.containersTotal > 0 && ` · ${report.containersRunning}/${report.containersTotal} containers`}
                      </p>
                      {report.unhealthy.length > 0 && <p className="text-xs text-error">Unhealthy: {report.unhealthy.join(", ")}</p>}
                      {!online && server.reportedAt && <p className="text-xs text-error">Last report {timeAgo(server.reportedAt)}</p>}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {install && (
          <div className="grid gap-2 rounded-lg border p-3">
            <p className="text-sm font-medium">Run this on {install.name}. It&apos;s only shown once, and needs no root access:</p>
            <div className="relative">
              <pre className="overflow-x-auto rounded-lg bg-base-200 p-3 pr-11 font-mono text-xs text-base-content">{install.command}</pre>
              <Button variant="ghost" size="icon-sm" className="absolute top-1.5 right-1.5 text-base-content" aria-label="Copy install command" onClick={() => void copyCommand()}>
                <CopyIcon />
              </Button>
            </div>
            <Button size="sm" variant="outline" className="justify-self-start" onClick={() => setInstall(null)}>
              Done
            </Button>
          </div>
        )}

        <form onSubmit={addServer} className="flex max-w-md gap-1.5">
          <Input aria-label="Server name" placeholder="Server name, like prod-1" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} className="bg-base-100 text-base-content" />
          <Button type="submit" size="icon" aria-label="Add server">
            <PlusIcon />
          </Button>
        </form>
      </div>
    </DevCard>
  );
}
