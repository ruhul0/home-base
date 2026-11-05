"use client";

import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function timeAgo(value: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (Number.isNaN(seconds)) return "";
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function DevCard({
  title,
  icon: Icon,
  className = "",
  loading,
  onRefresh,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  className?: string;
  loading?: boolean;
  onRefresh?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className={`home-group flex min-w-0 flex-col ${className}`}>
      <header className="mb-3 flex items-center gap-2 px-1">
        <Icon className="size-4 flex-none text-primary" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
        {onRefresh && (
          <Button variant="ghost" size="icon-sm" aria-label={`Refresh ${title}`} disabled={loading} onClick={onRefresh}>
            <RefreshCwIcon className={loading ? "animate-spin" : ""} />
          </Button>
        )}
      </header>
      {children}
    </section>
  );
}

export function DevMessage({ children }: { children: React.ReactNode }) {
  return <p className="px-1 py-2 text-sm opacity-70">{children}</p>;
}
