"use client";

import { useCallback, useEffect, useState } from "react";
import { NewspaperIcon } from "lucide-react";
import { api, SignedOutError } from "@/lib/api";
import type { NewsStory } from "@/lib/types";
import { DevCard, DevMessage } from "./dev-card";

export function NewsCard({ onSignedOut }: { onSignedOut: () => void }) {
  const [stories, setStories] = useState<NewsStory[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStories((await api.dev.news()).stories);
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
    <DevCard title="Hacker News" icon={NewspaperIcon} loading={loading} onRefresh={load}>
      {!stories && failed && <DevMessage>Hacker News isn&apos;t available right now.</DevMessage>}
      {!stories && !failed && <span className="loading mx-auto my-6 loading-spinner" aria-label="Loading stories" />}
      {stories && (
        <ol className="grid gap-0.5">
          {stories.map((story) => (
            <li key={story.discussion} className="rounded-lg px-1.5 py-1 hover:bg-base-content/10">
              <a href={story.url} className="line-clamp-2 text-sm hover:underline">
                {story.title}
              </a>
              <a href={story.discussion} className="font-mono text-xs opacity-65 hover:underline">
                {story.score} points · {story.comments} comments
              </a>
            </li>
          ))}
        </ol>
      )}
    </DevCard>
  );
}
