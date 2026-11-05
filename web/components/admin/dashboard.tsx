"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ApiError, api, setToken } from "@/lib/api";
import { KEYS, storage } from "@/lib/browser";
import { applyPreferences, DEFAULT_PREFERENCES } from "@/lib/preferences";
import type { AdminTotals, AdminUser, Preferences } from "@/lib/types";

const CONFIRM_RESET_MS = 5000;

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

/** Deleting asks for a second click on the same button, which resets after a few seconds. */
function DeleteButton({ login, onConfirm }: { login: string; onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <Button
      size="sm"
      variant={confirming ? "destructive" : "ghost"}
      className={confirming ? "" : "text-error"}
      aria-label={confirming ? `Confirm deleting ${login}` : `Delete ${login}`}
      onClick={() => {
        if (confirming) {
          onConfirm();
          return;
        }
        setConfirming(true);
        timer.current = setTimeout(() => setConfirming(false), CONFIRM_RESET_MS);
      }}
    >
      {confirming ? "Really delete?" : "Delete"}
    </Button>
  );
}

export function AdminDashboard() {
  const [totals, setTotals] = useState<AdminTotals | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [problem, setProblem] = useState("");

  const load = useCallback(async () => {
    const data = await api.admin.overview();
    setTotals(data.totals);
    setUsers(data.users);
    setCurrentUserId(data.currentUserId);
  }, []);

  useEffect(() => {
    async function start() {
      const [token, preferences] = await Promise.all([
        storage.get<string>(KEYS.token),
        storage.get<Preferences>(KEYS.preferences),
      ]);
      applyPreferences({ ...DEFAULT_PREFERENCES, ...preferences, backgroundType: "theme", pattern: "none" });
      setToken(token);
      try {
        await load();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) location.replace("/newtab?signin=1");
        else if (error instanceof ApiError && error.status === 403) setProblem("This account doesn't have admin access.");
        else setProblem("The admin data couldn't be loaded. Reload the page to try again.");
      }
    }
    void start();
  }, [load]);

  async function run(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      await load();
      toast.success(done);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That didn't work.");
    }
  }

  const stats = totals && [
    { label: "Users", value: totals.users },
    { label: "New in 7 days", value: totals.newUsers7Days },
    { label: "New in 30 days", value: totals.newUsers30Days },
    { label: "Active in 7 days", value: totals.active7Days },
    { label: "Active sessions", value: totals.sessions },
    { label: "Saved links", value: totals.links },
  ];

  return (
    <main className="home-background min-h-screen">
      <div className="mx-auto max-w-6xl px-6 pb-14">
        <header className="flex items-center justify-between py-5">
          <h1 className="text-xl font-bold">Home Base admin</h1>
          <Button variant="ghost" size="sm" render={<a href="/newtab" />}>
            Back to my page
          </Button>
        </header>

        {problem && (
          <p role="alert" className="alert">
            {problem}
          </p>
        )}

        {stats && (
          <>
            <section aria-label="Totals" className="stats mb-5 grid w-full grid-cols-2 border bg-base-100 shadow-lg md:grid-cols-3 lg:grid-cols-6">
              {stats.map((stat) => (
                <div key={stat.label} className="stat">
                  <div className="stat-title">{stat.label}</div>
                  <div className="stat-value text-3xl tabular-nums">{stat.value}</div>
                </div>
              ))}
            </section>

            <section className="card border bg-base-100 shadow-lg">
              <div className="card-body">
                <h2 className="card-title text-base">Users</h2>
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">User</th>
                        <th scope="col">Joined</th>
                        <th scope="col">Last seen</th>
                        <th scope="col" className="text-right">Groups</th>
                        <th scope="col" className="text-right">Links</th>
                        <th scope="col" className="text-right">Sessions</th>
                        <th scope="col">Status</th>
                        <th scope="col">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user) => (
                        <tr key={user.id}>
                          <td>
                            <a className="link font-medium" href={`https://github.com/${encodeURIComponent(user.login)}`} target="_blank" rel="noopener">
                              @{user.login}
                            </a>
                          </td>
                          <td className="whitespace-nowrap">{formatDate(user.createdAt)}</td>
                          <td className="whitespace-nowrap">{formatDate(user.lastSeenAt)}</td>
                          <td className="text-right tabular-nums">{user.groups}</td>
                          <td className="text-right tabular-nums">{user.links}</td>
                          <td className="text-right tabular-nums">{user.sessions}</td>
                          <td className="whitespace-nowrap">
                            {user.isAdmin && <span className="badge mr-1 badge-sm badge-primary">Admin</span>}
                            <span className={`badge badge-sm ${user.disabled ? "badge-error" : "badge-ghost"}`}>
                              {user.disabled ? "Disabled" : "Active"}
                            </span>
                          </td>
                          <td>
                            <div className="flex gap-1">
                              <Button size="sm" variant="outline" onClick={() => run(() => api.admin.signOut(user.id), `Signed out @${user.login} on all devices.`)}>
                                Sign out
                              </Button>
                              {user.id !== currentUserId && (
                                <>
                                  {user.disabled ? (
                                    <Button size="sm" variant="outline" onClick={() => run(() => api.admin.enable(user.id), `Enabled @${user.login}.`)}>
                                      Enable
                                    </Button>
                                  ) : (
                                    <Button size="sm" variant="outline" onClick={() => run(() => api.admin.disable(user.id), `Disabled @${user.login} and signed them out.`)}>
                                      Disable
                                    </Button>
                                  )}
                                  <DeleteButton login={user.login} onConfirm={() => run(() => api.admin.remove(user.id), `Deleted @${user.login} and their saved sites.`)} />
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
