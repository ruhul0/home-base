/* eslint-disable @next/next/no-img-element -- Static export serves images as they are. */
import { ActivityIcon, BracesIcon, CommandIcon, GitPullRequestIcon, LockIcon, PaletteIcon, SearchIcon, SquareTerminalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExtensionButton, ReturningVisitor } from "@/components/landing/returning-visitor";

const FEATURES = [
  { icon: CommandIcon, title: "Command palette", text: "Press ⌘K to jump to any site, tool or action. Everything works from the keyboard." },
  { icon: SearchIcon, title: "Search shortcuts", text: "Type gh, npm, mdn, so, pypi, go, crates or docker before a search. gh owner/repo opens the repository." },
  { icon: GitPullRequestIcon, title: "Your GitHub at a glance", text: "See your open pull requests, issues, recent repositories and activity, from public data only." },
  { icon: ActivityIcon, title: "Uptime monitors", text: "Add your sites and APIs, then see their status and response time on every new tab." },
  { icon: BracesIcon, title: "Dev toolbox", text: "JSON, JWT, Base64, URL encoding, timestamps, UUIDs, hashes and regex, all running in your browser." },
  { icon: SquareTerminalIcon, title: "Your daily workspace", text: "Todos, a scratchpad for commands and snippets, Unix time, world clocks and Hacker News." },
  { icon: PaletteIcon, title: "Fully yours", text: "35 themes, your own background, custom icons, group colours, fonts and layouts, synced to your account." },
  { icon: LockIcon, title: "Private and open source", text: "Sign-in never touches your repositories. Only you can see your saved sites, and the code is on GitHub." },
];

const SHORTCUTS = [
  { command: "gh vercel/next.js", result: "opens the repository" },
  { command: "npm zod", result: "searches npm" },
  { command: "mdn fetch", result: "searches MDN" },
  { command: "so go context", result: "searches Stack Overflow" },
];

export default function LandingPage() {
  return (
    <div className="home-background min-h-screen">
      <ReturningVisitor />

      <header className="navbar mx-auto max-w-6xl px-6">
        <div className="flex-1">
          <span className="flex items-center gap-2.5 text-lg font-bold">
            <img src="/icons/icon48.png" alt="" width={32} height={32} />
            Home Base
          </span>
        </div>
        <nav className="flex items-center gap-1">
          <Button variant="ghost" size="sm" render={<a href="https://github.com/ruhul0/home-base" />}>
            GitHub
          </Button>
          <Button size="sm" render={<a href="/newtab?signin=1" />}>
            Sign in
          </Button>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        <section className="hero pt-[5vh]">
          <div className="hero-content max-w-4xl flex-col text-center">
            <span className="badge badge-outline font-mono">Free and open source</span>
            <h1 className="text-5xl font-extrabold tracking-tight text-balance sm:text-6xl lg:text-7xl">
              The start page built for developers.
            </h1>
            <p className="max-w-2xl text-xl text-balance text-muted-foreground">
              Your pull requests, uptime monitors, dev tools and sites, one keystroke away on every new tab.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" render={<a href="/newtab?signin=1" />}>
                Continue with GitHub
              </Button>
              <ExtensionButton />
            </div>
          </div>
        </section>

        <div className="mockup-browser mx-auto mt-12 max-w-5xl border bg-base-200 shadow-2xl">
          <div className="mockup-browser-toolbar">
            <div className="input text-sm">chrome.ruhul0.com</div>
          </div>
          <img
            className="block h-auto w-full"
            src="/screens/screenshot-1-tiles-1280x800.png"
            width={1280}
            height={800}
            alt="Home Base showing a command bar, groups of sites, a GitHub panel, monitors, todos and a scratchpad"
          />
        </div>

        <section aria-label="Features" className="mt-20 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <Card key={feature.title}>
              <CardHeader>
                <feature.icon className="mb-1 size-6 text-primary" aria-hidden />
                <CardTitle>{feature.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground">{feature.text}</CardContent>
            </Card>
          ))}
        </section>

        <section className="mx-auto mt-20 max-w-3xl">
          <h2 className="text-center text-3xl font-bold tracking-tight">Type less, get there faster</h2>
          <div className="mockup-code mt-6 border bg-neutral text-neutral-content shadow-xl">
            {SHORTCUTS.map((shortcut) => (
              <pre key={shortcut.command} data-prefix="$">
                <code>
                  {shortcut.command} <span className="opacity-60"># {shortcut.result}</span>
                </code>
              </pre>
            ))}
          </div>
        </section>

        <section className="mt-20 text-center">
          <h2 className="text-3xl font-bold tracking-tight">Make it look like yours</h2>
          <p className="mt-2 text-muted-foreground">35 themes to start from, and every detail is yours to change.</p>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <img className="h-auto w-full rounded-box border shadow-xl" loading="lazy" src="/screens/screenshot-2-dark-1280x800.png" width={1280} height={800} alt="Home Base with a dark theme" />
            <img className="h-auto w-full rounded-box border shadow-xl" loading="lazy" src="/screens/screenshot-3-list-1280x800.png" width={1280} height={800} alt="Home Base with a monospace font and sites shown as a list" />
          </div>
        </section>

        <section className="mx-auto mt-20 max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">Make it your new tab</h2>
          <p className="mt-3 text-lg text-muted-foreground">
            With the Chrome extension, Home Base opens on every new tab with real site icons, your bookmarks and your most visited pages. Those stay in your browser and are never sent to the server.
          </p>
        </section>
      </main>

      <footer className="footer footer-center mt-16 p-8 text-muted-foreground">
        <nav className="flex gap-5 text-sm">
          <a className="link" href="/privacy">Privacy</a>
          <a className="link" href="https://github.com/ruhul0/home-base">Source code</a>
          <a className="link" href="https://github.com/ruhul0/home-base/issues">Support</a>
        </nav>
      </footer>
    </div>
  );
}
