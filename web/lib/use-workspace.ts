"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiError, SignedOutError } from "./api";
import type { ProjectStatus, TimeEntry, Workspace } from "./types";

const SAVE_DELAY_MS = 600;
const PROJECT_REFRESH_MS = 60 * 1000;
const MAX_MONITORS = 10;
const MAX_PROJECTS = 50;
const MAX_COMMANDS = 200;

function combineById<T extends { id: string }>(local: T[], remote: T[], limit: number) {
  const combined = remote.map((item) => local.find(({ id }) => id === item.id) ?? item);
  for (const item of local) {
    if (!combined.some(({ id }) => id === item.id)) combined.push(item);
  }
  return combined.slice(0, limit);
}

/**
 * Combines two versions of a workspace, so edits made on two devices at once are both kept.
 * Lists are combined, and a note edited in both places keeps both copies.
 */
function mergeWorkspaces(local: Workspace, remote: Workspace): Workspace {
  const monitors = [...remote.monitors];
  for (const monitor of local.monitors) {
    if (!monitors.some((item) => item.url === monitor.url)) monitors.push(monitor);
  }
  const todos = remote.todos.map((todo) => local.todos.find((item) => item.text === todo.text) ?? todo);
  for (const todo of local.todos) {
    if (!todos.some((item) => item.text === todo.text)) todos.push(todo);
  }
  let notes = local.notes;
  if (remote.notes !== local.notes && !local.notes.includes(remote.notes)) {
    notes = local.notes ? `${remote.notes}\n\n--- from another device ---\n${local.notes}` : remote.notes;
  }
  return {
    version: remote.version,
    monitors: monitors.slice(0, MAX_MONITORS),
    todos: todos.slice(0, 100),
    notes: notes.slice(0, 20000),
    projects: combineById(local.projects, remote.projects, MAX_PROJECTS),
    commands: combineById(local.commands, remote.commands, MAX_COMMANDS),
  };
}

export type SaveWorkspace = (next: Workspace, immediately: boolean) => Promise<unknown>;

/** The one shared copy of the workspace, so panels can't overwrite each other's changes. */
export function useWorkspace(enabled: boolean, onSignedOut: () => void) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const version = useRef(0);
  const hasPendingSave = useRef(false);

  const reportError = useCallback(
    (error: unknown, message: string) => {
      if (error instanceof SignedOutError) onSignedOut();
      else toast.error(message);
    },
    [onSignedOut],
  );

  useEffect(() => {
    if (!enabled) return;
    const start = setTimeout(() => {
      api.dev
        .workspace()
        .then((loaded) => {
          version.current = loaded.version;
          setWorkspace(loaded);
        })
        .catch((error) => reportError(error, "Your workspace couldn't be loaded."));
    }, 0);

    // Coming back to the tab picks up anything changed on another device.
    const onFocus = () => {
      if (hasPendingSave.current) return;
      api.dev
        .workspace()
        .then((loaded) => {
          if (!hasPendingSave.current && loaded.version !== version.current) {
            version.current = loaded.version;
            setWorkspace(loaded);
          }
        })
        .catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(start);
      window.removeEventListener("focus", onFocus);
      setWorkspace(null);
    };
  }, [enabled, reportError]);

  /** Saves run in order. Typing waits for a pause, and list changes save straight away. */
  const save: SaveWorkspace = useCallback(
    (next, immediately) => {
      setWorkspace(next);
      clearTimeout(saveTimer.current);
      hasPendingSave.current = true;
      const send = () => {
        saveQueue.current = saveQueue.current.then(async () => {
          try {
            const saved = await api.dev.putWorkspace({ ...next, version: version.current });
            version.current = saved.version;
          } catch (error) {
            if (!(error instanceof ApiError) || error.status !== 409) {
              reportError(error, "Your workspace couldn't be saved. Check your connection and try again.");
              return;
            }
            // Another device saved first, so combine both sets of changes rather than losing either.
            try {
              const merged = mergeWorkspaces(next, await api.dev.workspace());
              const saved = await api.dev.putWorkspace(merged);
              version.current = saved.version;
              setWorkspace({ ...merged, version: saved.version });
              toast.info("Your workspace changed on another device, so both sets of changes were combined.");
            } catch (mergeError) {
              reportError(mergeError, "Your workspace couldn't be saved. Reload the page and try again.");
            }
          } finally {
            hasPendingSave.current = false;
          }
        });
        return saveQueue.current;
      };
      if (immediately) return send();
      saveTimer.current = setTimeout(send, SAVE_DELAY_MS);
      return Promise.resolve();
    },
    [reportError],
  );

  return { workspace, save };
}

/** Live status for every project. Reloads when the list changes, and raises a message on new outages. */
export function useProjectStatus(enabled: boolean, listSignature: string, onSignedOut: () => void) {
  const [projects, setProjects] = useState<ProjectStatus[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const knownDown = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { projects: latest } = await api.dev.projects();
      setProjects(latest);
      setFailed(false);
      const down = new Set(latest.filter(({ monitor }) => !monitor.up).map(({ url }) => url));
      if (knownDown.current) {
        for (const project of latest) {
          if (!project.monitor.up && !knownDown.current.has(project.url)) {
            toast.error(`${project.name} is down. ${project.monitor.problem ?? ""}`, { id: `down-${project.url}` });
          }
        }
      }
      knownDown.current = down;
    } catch (error) {
      if (error instanceof SignedOutError) onSignedOut();
      else setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [onSignedOut]);

  useEffect(() => {
    if (!enabled) return;
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), PROJECT_REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [enabled, listSignature, load]);

  return { projects, failed, loading, reload: load };
}

function monthRange(date = new Date()) {
  return { from: new Date(date.getFullYear(), date.getMonth(), 1), to: new Date(date.getFullYear(), date.getMonth() + 1, 1) };
}

/** This month's tracked time. One timer can run at a time, and it lives on the server, so it follows you across devices. */
export function useTimer(enabled: boolean, onSignedOut: () => void) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);

  const reportError = useCallback(
    (error: unknown, message: string) => {
      if (error instanceof SignedOutError) onSignedOut();
      else toast.error(message);
    },
    [onSignedOut],
  );

  const reload = useCallback(async () => {
    const { from, to } = monthRange();
    try {
      setEntries((await api.dev.timeEntries(from, to)).entries);
    } catch (error) {
      reportError(error, "Your tracked time couldn't be loaded.");
    }
  }, [reportError]);

  useEffect(() => {
    if (!enabled) return;
    const first = setTimeout(() => void reload(), 0);
    window.addEventListener("focus", reload);
    return () => {
      clearTimeout(first);
      window.removeEventListener("focus", reload);
    };
  }, [enabled, reload]);

  const start = useCallback(
    async (projectId: string, note = "") => {
      try {
        await api.dev.startTimer(projectId, note);
        await reload();
      } catch (error) {
        reportError(error, "That timer couldn't be started.");
      }
    },
    [reload, reportError],
  );

  const stop = useCallback(async () => {
    try {
      await api.dev.stopTimer();
      await reload();
    } catch (error) {
      reportError(error, "That timer couldn't be stopped.");
    }
  }, [reload, reportError]);

  const remove = useCallback(
    async (id: number) => {
      try {
        await api.dev.deleteTimeEntry(id);
        await reload();
      } catch (error) {
        reportError(error, "That entry couldn't be deleted.");
      }
    },
    [reload, reportError],
  );

  const running = entries.find((entry) => entry.endedAt === null) ?? null;
  return { entries, running, start, stop, remove };
}

export type Timer = ReturnType<typeof useTimer>;
