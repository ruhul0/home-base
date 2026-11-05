"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { KEYS } from "@/lib/browser";

/**
 * People already signed in skip the landing page. People who signed in on this browser before, and
 * didn't sign out, go straight back through GitHub. That only happens once per browser session,
 * so a failed sign-in can't cause a redirect loop.
 */
export function ReturningVisitor() {
  useEffect(() => {
    if (localStorage.getItem(KEYS.token)) {
      location.replace("/newtab");
    } else if (localStorage.getItem(KEYS.autoLogin) === "true" && !sessionStorage.getItem(KEYS.autoLoginAttempt)) {
      sessionStorage.setItem(KEYS.autoLoginAttempt, "1");
      location.replace("/newtab?signin=1");
    }
  }, []);
  return null;
}

/** Only appears once the extension is on the Chrome Web Store. */
export function ExtensionButton() {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    api.config().then((config) => setUrl(config.extensionUrl)).catch(() => {});
  }, []);

  if (!url) return <p className="w-full text-center text-sm opacity-70">Free to use. The Chrome extension is coming soon.</p>;
  return (
    <Button size="lg" variant="outline" className="bg-base-100 text-base-content" render={<a href={url} target="_blank" rel="noopener" />}>
      Add to Chrome
    </Button>
  );
}
