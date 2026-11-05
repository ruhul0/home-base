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
        <li>The groups and sites you save, your design choices and any background or icon images you upload, so they appear on your devices.</li>
        <li>Your todos, scratchpad and the addresses you choose to monitor.</li>
        <li>Your projects, saved commands and tracked time. Projects can hold SSH commands and notes, and these aren&apos;t encrypted, so don&apos;t put passwords in them.</li>
        <li>Up to 7 days of check results for the addresses you monitor, plus daily uptime totals and an outage log for up to 400 days.</li>
        <li>A protected record of each signed-in device, including its browser type, kept until you sign out or for 90 days after it was last used.</li>
      </ul>

      <h2>What our server requests for you</h2>
      <p>
        To show the developer panels, our server requests your public profile, repositories, issues, pull requests and activity from GitHub, top stories from Hacker News, and any addresses you add as monitors or projects. For projects, it also reads each site&apos;s SSL certificate date and looks up its domain&apos;s expiry date through the public RDAP service at rdap.org, which sees the domain name. Those sites see the request as coming from our server, not from you. Your GitHub password is never involved, and private repositories are only read if you choose to connect them. Text in the dev toolbox stays in your browser and is never sent to our server.
      </p>

      <h2>What GitHub shares</h2>
      <p>
        Sign-in only requests your public GitHub profile. Home Base doesn&apos;t get access to your repositories, and it doesn&apos;t keep the access token GitHub provides. If your profile shows a public email address, it&apos;s checked at sign-in to identify the site&apos;s administrator and isn&apos;t stored.
      </p>

      <h2>Who can see your data</h2>
      <p>
        Other users can&apos;t see your data. The site&apos;s administrator can see each account&apos;s username, when it joined and was last seen, and how many groups, links and sessions it has. The admin dashboard doesn&apos;t show the sites or images you save, though the administrator operates the server and database they&apos;re stored on.
      </p>

      <h2>Optional private GitHub access</h2>
      <p>
        You can choose to connect a separate Home Base GitHub App, which has read-only access to the repositories you select. It can&apos;t change your code or settings. Its access tokens are encrypted on our server, are never sent to your browser and are never shown to the administrator through the site. Pull requests, issues and repository details it reads are held in memory for a few minutes and not saved to the database. Disconnecting deletes the tokens and withdraws the access on GitHub, and you can also remove the app from your GitHub settings at any time.
      </p>

      <h2>What the Chrome extension reads</h2>
      <p>
        The extension reads your bookmarks and most visited sites so it can show them on your new tab page and include them in its search. They stay in your browser and are never sent to our server.
      </p>

      <h2>How your data is used</h2>
      <p>
        Your data is only used to run Home Base. It isn&apos;t sold, shared for advertising or used to track you across websites. Your data is stored on a private server, and Cloudflare carries traffic to and from it. Backups are encrypted before leaving the server and kept in Cloudflare R2, where neither Cloudflare nor the server can read them.
      </p>

      <h2>Removing your data</h2>
      <p>
        You can edit or remove your saved sites at any time. You can sign out other devices or permanently delete your account yourself, under Customize and then Account. This deletes everything listed above, except that encrypted backups taken earlier are kept for up to 30 days before being removed.
      </p>
    </main>
  );
}
