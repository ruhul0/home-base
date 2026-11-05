"use client";

import { useEffect, useState } from "react";
import { GlobeIcon } from "lucide-react";
import { toast } from "sonner";
import { DevCard } from "./dev-card";

const ZONES = [
  { label: "UTC", zone: "UTC" },
  { label: "San Francisco", zone: "America/Los_Angeles" },
  { label: "New York", zone: "America/New_York" },
  { label: "London", zone: "Europe/London" },
  { label: "Dhaka", zone: "Asia/Dhaka" },
  { label: "Tokyo", zone: "Asia/Tokyo" },
];

export function ClocksCard() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  async function copyEpoch() {
    if (!now) return;
    try {
      await navigator.clipboard.writeText(String(Math.floor(now.getTime() / 1000)));
      toast.success("Unix time copied.");
    } catch {
      toast.error("Your browser blocked copying.");
    }
  }

  return (
    <DevCard title="Time" icon={GlobeIcon} className="home-widget-wide">
      {now && (
        <div className="grid items-center gap-3 md:grid-cols-[auto_1fr]">
          <button type="button" onClick={copyEpoch} title="Copy Unix time" className="cursor-pointer rounded-lg bg-base-content/5 px-3 py-1.5 text-left hover:bg-base-content/10">
            <span className="block text-xs opacity-70">Unix time (click to copy)</span>
            <span className="font-mono text-lg font-bold tabular-nums">{Math.floor(now.getTime() / 1000)}</span>
          </button>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {ZONES.map(({ label, zone }) => (
              <li key={zone} className="px-1">
                <span className="block truncate text-xs opacity-70">{label}</span>
                <span className="font-mono text-sm font-semibold tabular-nums">
                  {now.toLocaleTimeString([], { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </DevCard>
  );
}
