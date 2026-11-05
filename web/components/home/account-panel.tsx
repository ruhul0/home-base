"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { timeAgo } from "@/components/dev/dev-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import type { SessionInfo } from "@/lib/types";

export function AccountPanel({ login, isAdmin, onDeleted }: { login: string; isAdmin: boolean; onDeleted: () => void }) {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      setSessions((await api.sessions.list()).sessions);
    } catch {
      toast.error("Your devices couldn't be loaded.");
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function run(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      toast.success(done);
      await load();
    } catch {
      toast.error("That didn't work. Try again.");
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    try {
      await api.deleteAccount(confirmation);
      onDeleted();
    } catch (error) {
      setDeleting(false);
      toast.error(error instanceof Error ? error.message : "Your account couldn't be deleted.");
    }
  }

  const others = sessions?.filter((session) => !session.current) ?? [];

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <Label>Signed-in devices</Label>
        <ul className="grid gap-1.5">
          {sessions?.map((session) => (
            <li key={session.id} className="flex items-center gap-2 rounded-lg bg-base-200 px-2.5 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{session.label || "Unknown device"}</span>
                <span className="block text-xs opacity-70">
                  {session.current ? "This device" : `Last used ${timeAgo(session.lastUsedAt ?? session.createdAt)}`}
                </span>
              </span>
              {!session.current && (
                <Button variant="ghost" size="sm" onClick={() => void run(() => api.sessions.remove(session.id), "That device is signed out.")}>
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
        {others.length > 0 && (
          <Button variant="outline" size="sm" className="justify-self-start" onClick={() => void run(() => api.sessions.signOutOthers(), "All other devices are signed out.")}>
            Sign out all other devices
          </Button>
        )}
        <p className="text-xs text-muted-foreground">Devices stay signed in for 90 days after they&apos;re last used.</p>
      </div>

      <Separator />

      <div className="grid gap-2">
        <Label htmlFor="delete-confirmation">Delete my account</Label>
        {isAdmin ? (
          <p className="text-sm text-muted-foreground">The administrator&apos;s account can&apos;t be deleted here.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              This permanently deletes your sites, design, todos, notes and monitors, and withdraws private GitHub access. It can&apos;t be undone. Type <span className="font-mono font-semibold">{login}</span> to confirm.
            </p>
            <Input id="delete-confirmation" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
            <Button variant="destructive" size="sm" className="justify-self-start" disabled={deleting || confirmation.toLowerCase() !== login.toLowerCase()} onClick={() => void deleteAccount()}>
              Delete my account
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
