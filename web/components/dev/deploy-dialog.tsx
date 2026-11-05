"use client";

import { useState } from "react";
import { RocketIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, ApiError, SignedOutError } from "@/lib/api";
import type { GitHubRun, Project } from "@/lib/types";

/** Deploying changes a live site, so this always asks first, and Enter lands on Cancel rather than Deploy. */
export function DeployDialog({
  project,
  latestRun,
  onDeployed,
  onSignedOut,
  onClose,
}: {
  project: Project;
  latestRun: GitHubRun | null;
  onDeployed: () => void;
  onSignedOut: () => void;
  onClose: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function deploy() {
    setSending(true);
    setError("");
    try {
      await api.dev.deploy(project.id);
      toast.success(`Deploy of ${project.name} started.`, {
        action: { label: "View runs", onClick: () => window.open(`https://github.com/${project.repo}/actions`, "_blank", "noopener") },
      });
      onDeployed();
      onClose();
    } catch (failure) {
      if (failure instanceof SignedOutError) onSignedOut();
      else setError(failure instanceof ApiError ? failure.message : "That deploy couldn't be started.");
      setSending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Deploy {project.name}?</DialogTitle>
          <DialogDescription>This runs the workflow on GitHub, as you, against the address below.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="opacity-70">Site</dt>
          <dd className="truncate font-mono">{new URL(project.url).hostname}</dd>
          <dt className="opacity-70">Repository</dt>
          <dd className="truncate font-mono">{project.repo}</dd>
          <dt className="opacity-70">Workflow</dt>
          <dd className="truncate font-mono">{project.deployWorkflow}</dd>
          <dt className="opacity-70">Branch</dt>
          <dd className="truncate font-mono">{project.deployRef || "main"}</dd>
        </dl>
        {latestRun?.conclusion === "failure" && (
          <p className="text-sm text-warning">
            The latest run here failed: {latestRun.workflow} on {latestRun.branch}.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button autoFocus variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={sending} onClick={() => void deploy()}>
            <RocketIcon /> {sending ? "Starting…" : "Deploy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
