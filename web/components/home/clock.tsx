"use client";

import { useEffect, useState } from "react";
import type { Preferences } from "@/lib/types";

function greetingFor(hour: number) {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function Clock({ preferences, login }: { preferences: Preferences; login: string | null }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  if (!now) return <div className="min-h-32" aria-hidden />;

  const timeFormat: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  if (preferences.showSeconds) timeFormat.second = "2-digit";
  if (preferences.clockFormat !== "auto") timeFormat.hour12 = preferences.clockFormat === "12";

  const greeting = preferences.greetingText || `${greetingFor(now.getHours())}${login ? `, ${login}` : ""}`;

  return (
    <div className="home-hero mb-6">
      {preferences.showClock && <div className="home-clock">{now.toLocaleTimeString([], timeFormat)}</div>}
      {preferences.showGreeting && <p className="mt-2 text-lg font-medium">{greeting}</p>}
      {preferences.showDate && (
        <p className="home-hero-muted">
          {now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
        </p>
      )}
    </div>
  );
}
