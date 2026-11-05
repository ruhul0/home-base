"use client";

import { useState } from "react";
import { isExtension } from "@/lib/browser";
import { tileColour } from "@/lib/links";
import type { Link } from "@/lib/types";

/** Chrome provides real site icons to the extension. The website shows a coloured letter. */
export function SiteIcon({ link }: { link: Link }) {
  const [failed, setFailed] = useState(false);
  const [useFavicon] = useState(() => isExtension());

  if (useFavicon && !failed) {
    const source = `${chrome.runtime.getURL("/_favicon/")}?pageUrl=${encodeURIComponent(link.url)}&size=32`;
    return (
      <span className="home-icon home-icon-image">
        {/* eslint-disable-next-line @next/next/no-img-element -- Chrome's icon service needs a plain image. */}
        <img src={source} alt="" onError={() => setFailed(true)} />
      </span>
    );
  }

  return (
    <span className="home-icon" style={{ "--tile": tileColour(link.name) } as React.CSSProperties}>
      {(link.name || "?").charAt(0).toUpperCase()}
    </span>
  );
}
