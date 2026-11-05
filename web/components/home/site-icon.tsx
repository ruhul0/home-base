"use client";

import { useState } from "react";
import { isExtension } from "@/lib/browser";
import { ICON_SET } from "@/lib/icon-set";
import { tileColour } from "@/lib/links";
import { relativeLuminance } from "@/lib/preferences";
import type { Link } from "@/lib/types";

function tileStyle(background: string) {
  return {
    "--tile": background,
    color: relativeLuminance(background) > 0.45 ? "#14152a" : "#ffffff",
  } as React.CSSProperties;
}

/**
 * Shows a link's custom icon if it has one. Otherwise Chrome provides real site icons to the
 * extension, and the website shows a coloured letter. A tile's own colour comes first, then its group's.
 */
export function SiteIcon({ link, groupColor }: { link: Link; groupColor?: string }) {
  const [failed, setFailed] = useState(false);
  const [useFavicon] = useState(() => isExtension());
  const icon = link.icon ?? "";
  const colour = link.iconColor || groupColor || tileColour(link.name);

  if (icon.startsWith("image:")) {
    return (
      <span className="home-icon home-icon-picture">
        {/* eslint-disable-next-line @next/next/no-img-element -- This is a small image saved with the link. */}
        <img src={icon.slice("image:".length)} alt="" />
      </span>
    );
  }

  if (icon.startsWith("emoji:")) {
    return (
      <span className="home-icon" style={tileStyle(colour)}>
        {icon.slice("emoji:".length)}
      </span>
    );
  }

  const Symbol = icon.startsWith("lucide:") ? ICON_SET[icon.slice("lucide:".length)] : undefined;
  if (Symbol) {
    return (
      <span className="home-icon" style={tileStyle(colour)}>
        <Symbol className="size-[55%]" aria-hidden />
      </span>
    );
  }

  if (useFavicon && !failed) {
    const source = `${chrome.runtime.getURL("/_favicon/")}?pageUrl=${encodeURIComponent(link.url)}&size=32`;
    return (
      <span className="home-icon home-icon-image" style={link.iconColor ? { background: link.iconColor } : undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Chrome's icon service needs a plain image. */}
        <img src={source} alt="" onError={() => setFailed(true)} />
      </span>
    );
  }

  return (
    <span className="home-icon" style={tileStyle(colour)}>
      {(link.name || "?").charAt(0).toUpperCase()}
    </span>
  );
}
