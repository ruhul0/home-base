/* eslint-disable @next/next/no-img-element -- Static export serves images as they are. */
import { LayoutGridIcon, LockIcon, PaletteIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExtensionButton, ReturningVisitor } from "@/components/landing/returning-visitor";

const FEATURES = [
  {
    icon: SearchIcon,
    title: "One search box",
    text: 'Search the web or jump straight to one of your saved sites. Type "you" and press Enter for YouTube.',
  },
  {
    icon: LayoutGridIcon,
    title: "Your sites, organised",
    text: "Group sites your way and drag them into order, then find them on your laptop, phone or any other browser.",
  },
  {
    icon: PaletteIcon,
    title: "Your design",
    text: "Choose from 35 themes, your own background, fonts, layouts and colours. It's saved to your account.",
  },
  {
    icon: LockIcon,
    title: "Private by default",
    text: "Only you can see your saved sites. Sign-in uses your public GitHub profile and never touches your repositories.",
  },
];

const THEME_PREVIEW = ["light", "synthwave", "forest", "valentine", "dracula", "nord", "retro", "night"];

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
        <section className="hero pt-[6vh]">
          <div className="hero-content max-w-4xl flex-col text-center">
            <h1 className="text-5xl font-extrabold tracking-tight text-balance sm:text-6xl lg:text-7xl">
              Start every day from your own page.
            </h1>
            <p className="max-w-2xl text-xl text-balance text-muted-foreground">
              Search, your favourite sites and a design you choose, all in one place and on every device.
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
            alt="Home Base showing a large clock, a search box and groups of site tiles"
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

        <section className="mt-20 text-center">
          <h2 className="text-3xl font-bold tracking-tight">Make it look like yours</h2>
          <p className="mt-2 text-muted-foreground">35 themes to start from, and every detail is yours to change.</p>
          <div className="mx-auto mt-6 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
            {THEME_PREVIEW.map((theme) => (
              <div key={theme} data-theme={theme} className="rounded-box border bg-base-100 p-3 text-left text-base-content">
                <span className="block text-sm font-semibold capitalize">{theme}</span>
                <span className="mt-2 flex gap-1.5" aria-hidden>
                  <span className="size-4 rounded-full bg-primary" />
                  <span className="size-4 rounded-full bg-secondary" />
                  <span className="size-4 rounded-full bg-accent" />
                  <span className="size-4 rounded-full bg-neutral" />
                </span>
              </div>
            ))}
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <img className="h-auto w-full rounded-box border shadow-xl" loading="lazy" src="/screens/screenshot-2-dark-1280x800.png" width={1280} height={800} alt="Home Base with a dark theme" />
            <img className="h-auto w-full rounded-box border shadow-xl" loading="lazy" src="/screens/screenshot-3-list-1280x800.png" width={1280} height={800} alt="Home Base with sites shown as a list" />
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
