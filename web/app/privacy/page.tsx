import type { Metadata } from "next";

export const metadata: Metadata = { title: "Home Base privacy" };

export default function PrivacyPage() {
  return (
    <main className="home-policy mx-auto max-w-2xl px-6 py-12">
      <h1 className="mb-1 text-3xl font-bold tracking-tight">Home Base privacy</h1>
      <p className="text-muted-foreground">Last updated 5 November 2026.</p>

      <h2>What is stored on our server</h2>
      <ul>
        <li>Your GitHub user ID and username, which identify your account.</li>
        <li>The groups and sites you save, your design choices and any background image you upload, so they appear on your devices.</li>
        <li>A protected record of each signed-in session, kept for up to a year or until you sign out.</li>
      </ul>

      <h2>What GitHub shares</h2>
      <p>
        Sign-in only requests your public GitHub profile. Home Base doesn&apos;t get access to your repositories, and it doesn&apos;t keep the access token GitHub provides. If your profile shows a public email address, it&apos;s checked at sign-in to identify the site&apos;s administrator and isn&apos;t stored.
      </p>

      <h2>Who can see your data</h2>
      <p>
        Other users can&apos;t see your data. The site&apos;s administrator can see each account&apos;s username, when it joined and was last seen, and how many groups, links and sessions it has. The admin dashboard doesn&apos;t show the sites or images you save, though the administrator operates the server and database they&apos;re stored on.
      </p>

      <h2>What the Chrome extension reads</h2>
      <p>
        The extension reads your bookmarks and most visited sites so it can show them on your new tab page and include them in its search. They stay in your browser and are never sent to our server.
      </p>

      <h2>How your data is used</h2>
      <p>
        Your data is only used to run Home Base. It isn&apos;t sold, shared for advertising or used to track you across websites. Your data is stored on a private server, and Cloudflare carries traffic to and from it.
      </p>

      <h2>Removing your data</h2>
      <p>
        You can edit or remove your saved sites at any time. To delete your account completely, <a href="https://github.com/ruhul0/home-base/issues">open an issue on GitHub</a> or contact <a href="https://github.com/ruhul0">@ruhul0</a>.
      </p>
    </main>
  );
}
