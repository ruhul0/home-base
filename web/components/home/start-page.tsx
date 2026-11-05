"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BriefcaseIcon, CheckIcon, CommandIcon, FileTextIcon, FlaskConicalIcon, GitBranchIcon, KeyboardIcon, LogOutIcon, PaletteIcon, PencilIcon, PlayIcon, PlusIcon, RocketIcon, RotateCcwIcon, RotateCwIcon, ShieldIcon, SquareIcon, TerminalIcon, TerminalSquareIcon, WrenchIcon } from "lucide-react";
import { AttentionBar } from "@/components/dev/attention-bar";
import { ClocksCard } from "@/components/dev/clocks-card";
import { CommandPalette, type PaletteAction } from "@/components/dev/command-palette";
import { CommandFillDialog, CommandsCard } from "@/components/dev/commands-card";
import { DeployDialog } from "@/components/dev/deploy-dialog";
import { GitHubCard } from "@/components/dev/github-card";
import { NewsCard } from "@/components/dev/news-card";
import { ProjectReportDialog } from "@/components/dev/project-report";
import { ProjectsCard } from "@/components/dev/projects-card";
import { ServersCard } from "@/components/dev/servers-card";
import { ShortcutsDialog } from "@/components/dev/shortcuts-dialog";
import { TimeCard } from "@/components/dev/time-card";
import { ToolboxDialog } from "@/components/dev/toolbox-dialog";
import { WorkLogCard } from "@/components/dev/worklog-card";
import { WorkspaceCards } from "@/components/dev/workspace-cards";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, ApiError, clearLocalSession, setToken, SignedOutError } from "@/lib/api";
import { apiBase, isExtension, KEYS, storage } from "@/lib/browser";
import { copyText, placeholdersIn } from "@/lib/commands";
import { LOGIN_ERRORS, resumeWebLogin, startLogin, trySilentExtensionLogin } from "@/lib/login";
import {
  applyPreferences,
  compressImage,
  DEFAULT_PREFERENCES,
  LOOKS,
  readAsDataUrl,
  setBackgroundImage,
} from "@/lib/preferences";
import type { Group, GroupsResponse, Link, Preferences, Project, SavedCommand } from "@/lib/types";
import { useProjectStatus, useTimer, useWorkspace } from "@/lib/use-workspace";
import { Clock } from "./clock";
import { CustomizePanel } from "./customize-panel";
import { Groups, SiteLink } from "./groups";
import { SearchBox } from "./search-box";

const SAVE_DELAY_MS = 500;
const MAX_BOOKMARKS = 16;
const MAX_TOP_SITES = 8;
const TOOL_COMMANDS = [
  { tool: "json", label: "Format JSON", keywords: "minify pretty" },
  { tool: "jwt", label: "Decode a JWT", keywords: "token" },
  { tool: "base64", label: "Base64 encode or decode", keywords: "" },
  { tool: "url", label: "URL encode or decode", keywords: "percent" },
  { tool: "time", label: "Convert a timestamp", keywords: "unix epoch date" },
  { tool: "uuid", label: "Generate UUIDs", keywords: "guid" },
  { tool: "hash", label: "Hash text", keywords: "sha256 sha1 sha512" },
  { tool: "regex", label: "Test a regular expression", keywords: "regexp pattern" },
];

type Phase = "loading" | "signed-out" | "ready";
type BrowserLink = Link & { kind: string };

/** Themes report colours in formats a colour picker can't use, so this converts through a canvas. */
function readThemeAccent() {
  const color = getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim();
  const canvas = document.createElement("canvas").getContext("2d");
  if (!canvas || !color) return "#4f46e5";
  canvas.fillStyle = color;
  canvas.fillRect(0, 0, 1, 1);
  const [red, green, blue] = canvas.getImageData(0, 0, 1, 1).data;
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function isDesktopChrome() {
  const data = (navigator as Navigator & { userAgentData?: { mobile: boolean; brands: { brand: string }[] } }).userAgentData;
  return Boolean(data && !data.mobile && data.brands.some(({ brand }) => brand === "Google Chrome"));
}

async function readBrowserLinks(): Promise<{ top: BrowserLink[]; bookmarks: BrowserLink[] }> {
  const topSites = await chrome.topSites.get();
  const top = topSites.slice(0, MAX_TOP_SITES).map((site) => ({ name: site.title || site.url, url: site.url, kind: "Most visited" }));

  const bookmarks: BrowserLink[] = [];
  const collect = (nodes: chrome.bookmarks.BookmarkTreeNode[]) => {
    for (const node of nodes) {
      if (node.url && /^https?:/.test(node.url)) bookmarks.push({ name: node.title || node.url, url: node.url, kind: "Bookmark" });
      if (node.children) collect(node.children);
    }
  };
  collect(await chrome.bookmarks.getTree());
  return { top, bookmarks };
}

export function StartPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [loginError, setLoginError] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [user, setUser] = useState<GroupsResponse["user"] | null>(null);
  const [extensionUrl, setExtensionUrl] = useState<string | null>(null);
  const [promptVisible, setPromptVisible] = useState(false);
  const [editing, setEditing] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [topSites, setTopSites] = useState<BrowserLink[]>([]);
  const [bookmarks, setBookmarks] = useState<BrowserLink[]>([]);
  const [accentPreview, setAccentPreview] = useState("#4f46e5");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toolboxOpen, setToolboxOpen] = useState(false);
  const [toolboxTool, setToolboxTool] = useState<string | undefined>(undefined);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteText, setPaletteText] = useState("");
  const [reportProject, setReportProject] = useState<Project | null>(null);
  const [deployProject, setDeployProject] = useState<Project | null>(null);
  const [fillingCommand, setFillingCommand] = useState<SavedCommand | null>(null);

  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showSignedOut = useCallback(async (error = "") => {
    clearTimeout(saveTimer.current);
    await clearLocalSession();
    setBackgroundImage(null);
    setGroups([]);
    setUser(null);
    setPreferences(DEFAULT_PREFERENCES);
    setEditing(false);
    setCustomizing(false);
    setLoginError(error);
    setPhase("signed-out");
  }, []);

  const handleApiError = useCallback(
    (error: unknown, message: string) => {
      if (error instanceof SignedOutError) void showSignedOut();
      else toast.error(message);
    },
    [showSignedOut],
  );

  /** Each user's image is kept locally, so new tabs don't download it again unless it changed. */
  const syncBackground = useCallback(async (version: string | null) => {
    const cached = await storage.get<{ version: string; dataUrl: string }>(KEYS.background);
    if (!version) {
      if (cached) await storage.remove(KEYS.background);
      setBackgroundImage(null);
      return;
    }
    if (cached?.version === version) {
      setBackgroundImage(cached.dataUrl);
      return;
    }
    const image = await api.getBackground();
    if (!image) return;
    const dataUrl = await readAsDataUrl(image);
    setBackgroundImage(dataUrl);
    await storage.set(KEYS.background, { version, dataUrl });
  }, []);

  /** Saved sites and design appear straight away, then the server's copy replaces them. */
  const loadApp = useCallback(async () => {
    const [cachedGroups, cachedPreferences, cachedBackground] = await Promise.all([
      storage.get<Group[]>(KEYS.groups),
      storage.get<Preferences>(KEYS.preferences),
      storage.get<{ dataUrl: string }>(KEYS.background),
    ]);
    if (cachedPreferences) setPreferences({ ...DEFAULT_PREFERENCES, ...cachedPreferences });
    if (cachedBackground) setBackgroundImage(cachedBackground.dataUrl);
    if (cachedGroups) setGroups(cachedGroups);
    if (cachedGroups) setPhase("ready");

    try {
      const data = await api.getGroups();
      const merged = { ...DEFAULT_PREFERENCES, ...data.preferences };
      setGroups(data.groups);
      setPreferences(merged);
      setUser(data.user);
      setExtensionUrl(data.extensionUrl);
      setPhase("ready");
      await Promise.all([storage.set(KEYS.groups, data.groups), storage.set(KEYS.preferences, merged)]);
      syncBackground(data.backgroundVersion).catch(() => {});

      if (!isExtension() && data.extensionUrl && isDesktopChrome() && !localStorage.getItem(KEYS.promptDismissed)) {
        setPromptVisible(true);
      }
    } catch (error) {
      if (error instanceof SignedOutError) {
        await showSignedOut();
        return;
      }
      setPhase("ready");
      toast.error(cachedGroups ? "Can't reach your server, so these sites may be out of date." : "Can't reach your server. Check your connection and reload this page.");
    }

    if (isExtension()) {
      readBrowserLinks()
        .then(({ top, bookmarks: found }) => {
          setTopSites(top);
          setBookmarks(found);
        })
        .catch(() => {});
    }
  }, [showSignedOut, syncBackground]);

  useEffect(() => {
    async function start() {
      if (!isExtension()) {
        const resumed = await resumeWebLogin();
        if (resumed) {
          if (resumed.signedIn) await loadApp();
          else await showSignedOut(resumed.error);
          return;
        }
      }

      const saved = await storage.get<string>(KEYS.token);
      if (saved) {
        setToken(saved);
        await loadApp();
        return;
      }

      if (isExtension()) {
        setPhase("signed-out");
        if (await trySilentExtensionLogin()) await loadApp();
        return;
      }

      if (new URLSearchParams(location.search).has("signin")) {
        history.replaceState(null, "", location.pathname);
        setPhase("signed-out");
        const result = await startLogin();
        if (!result.signedIn && result.error) setLoginError(result.error);
        return;
      }
      location.replace("/");
    }
    void start();
  }, [loadApp, showSignedOut]);

  useEffect(() => {
    applyPreferences(preferences);
    const frame = requestAnimationFrame(() => setAccentPreview(readThemeAccent()));

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => applyPreferences(preferences);
    media.addEventListener("change", follow);
    return () => {
      cancelAnimationFrame(frame);
      media.removeEventListener("change", follow);
    };
  }, [preferences]);

  const signedOutElsewhere = useCallback(() => void showSignedOut(), [showSignedOut]);

  const { workspace, save: saveWorkspace } = useWorkspace(phase === "ready", signedOutElsewhere);
  const projectList = workspace?.projects ?? [];
  const projectStatus = useProjectStatus(phase === "ready" && workspace !== null, JSON.stringify(projectList), signedOutElsewhere);
  const timer = useTimer(phase === "ready", signedOutElsewhere);
  const toggleTimer = useRef<() => void>(() => {});
  useEffect(() => {
    toggleTimer.current = () => {
      if (timer.running) void timer.stop();
      else {
        setPaletteText("start timer ");
        setPaletteOpen(true);
      }
    };
  }, [timer]);

  useEffect(() => {
    if (phase !== "ready") return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteText("");
        setPaletteOpen((open) => !open);
        return;
      }
      // The search box usually has focus, so the timer also has a shortcut that works while typing.
      if (event.altKey && !event.metaKey && !event.ctrlKey && event.code === "KeyS") {
        event.preventDefault();
        toggleTimer.current();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // Single letters only act as shortcuts when nothing is being typed and no dialog is open.
      const target = document.activeElement;
      const typing = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (typing || document.querySelector('[role="dialog"]')) return;

      if (event.key === "?") setShortcutsOpen(true);
      else if (event.key === "t") {
        setToolboxTool(undefined);
        setToolboxOpen(true);
      } else if (event.key === "e") setEditing((value) => !value);
      else if (event.key === "c") setCustomizing((value) => !value);
      else if (event.key === "s") toggleTimer.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [phase]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.editing = String(editing);
    root.classList.toggle("customize-open", customizing);
  }, [editing, customizing]);

  /** Saves run one at a time, so quick edits reach the server in the order they were made. */
  function changeGroups(next: Group[]) {
    setGroups(next);
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        await api.putGroups(next);
        await storage.set(KEYS.groups, next);
      } catch (error) {
        const tooLarge = error instanceof ApiError && error.status === 413;
        handleApiError(error, tooLarge ? "That's too many image icons to save. Remove a few or use emoji or symbols instead." : "Your last change wasn't saved. Reload the page and try again.");
      }
    });
  }

  /** Quick changes, like dragging across the colour picker, are saved together once they stop. */
  function changePreferences(next: Preferences) {
    setPreferences(next);
    void storage.set(KEYS.preferences, next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveQueue.current = saveQueue.current.then(async () => {
        try {
          await api.putPreferences(next);
        } catch (error) {
          handleApiError(error, "Your design change wasn't saved. Check your connection and try again.");
        }
      });
    }, SAVE_DELAY_MS);
  }

  function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    changePreferences({ ...preferences, [key]: value });
  }

  async function restoreSites() {
    try {
      await saveQueue.current;
      const { groups: restored } = await api.resetGroups();
      setGroups(restored);
      await storage.set(KEYS.groups, restored);
    } catch (error) {
      handleApiError(error, "Your sites couldn't be restored.");
    }
  }

  async function uploadImage(file: File) {
    const pending = toast.loading("Uploading your image…");
    try {
      const image = await compressImage(file);
      const version = await api.putBackground(image);
      const dataUrl = await readAsDataUrl(image);
      setBackgroundImage(dataUrl);
      await storage.set(KEYS.background, { version, dataUrl });
      setPreference("backgroundType", "image");
      toast.success("Your background is saved.", { id: pending });
    } catch {
      toast.error("That image couldn't be used. Try a different JPEG or PNG.", { id: pending });
    }
  }

  async function removeImage() {
    try {
      await api.deleteBackground();
      await storage.remove(KEYS.background);
      setBackgroundImage(null);
      setPreference("backgroundType", "theme");
    } catch (error) {
      handleApiError(error, "Your image couldn't be removed.");
    }
  }

  async function signIn() {
    setLoginError("");
    setSigningIn(true);
    try {
      const result = await startLogin();
      if (result.signedIn) await loadApp();
      else if (result.error) setLoginError(result.error);
    } catch {
      setLoginError(LOGIN_ERRORS.failed);
    } finally {
      setSigningIn(false);
    }
  }

  async function signOut() {
    try {
      await api.logout();
    } catch {
      // The local session still ends if the server can't be reached.
    }
    // Signing out is a deliberate choice, so automatic sign-in stays off until the next manual sign-in.
    await storage.set(KEYS.autoLogin, false);
    await showSignedOut();
    if (!isExtension()) location.replace("/");
  }

  async function accountDeleted() {
    await storage.set(KEYS.autoLogin, false);
    await showSignedOut();
    if (!isExtension()) location.replace("/");
  }

  function dismissPrompt() {
    localStorage.setItem(KEYS.promptDismissed, "1");
    setPromptVisible(false);
  }

  function openToolbox(tool?: string) {
    setToolboxTool(tool);
    setToolboxOpen(true);
  }

  function applyCommand(command: SavedCommand) {
    if (placeholdersIn(command.command).length) setFillingCommand(command);
    else void copyText(command.command, `Copied: ${command.name}`, toast);
  }

  async function rerunCI(repo: string, runId: number) {
    try {
      await api.dev.rerun(repo, runId);
      toast.success(`Re-running the failed jobs in ${repo}.`);
      void projectStatus.reload();
    } catch (error) {
      if (error instanceof SignedOutError) signedOutElsewhere();
      else toast.error(error instanceof ApiError ? error.message : "That workflow couldn't be re-run.");
    }
  }

  const open = (url: string) => () => {
    location.href = url;
  };
  const projectActions: PaletteAction[] = projectList.flatMap((project) => {
    const keywords = `${project.url} ${project.repo}`;
    const failedRun = projectStatus.projects?.find(({ id }) => id === project.id)?.ci;
    return [
      { label: project.name, section: "Project", keywords, icon: BriefcaseIcon, run: open(project.url) },
      { label: `Start timer: ${project.name}`, section: "Time", keywords, searchOnly: true, icon: PlayIcon, run: () => void timer.start(project.id) },
      { label: `Report: ${project.name}`, section: "Project", keywords, searchOnly: true, icon: FileTextIcon, run: () => setReportProject(project) },
      ...(project.repo && project.deployWorkflow ? [{ label: `Deploy: ${project.name}`, section: "Action", keywords, searchOnly: true, icon: RocketIcon, run: () => setDeployProject(project) }] : []),
      ...(project.staging ? [{ label: `Staging: ${project.name}`, section: "Project", keywords, searchOnly: true, icon: FlaskConicalIcon, run: open(project.staging) }] : []),
      ...(project.repo ? [{ label: `Repo: ${project.name}`, section: "Project", keywords, searchOnly: true, icon: GitBranchIcon, run: open(`https://github.com/${project.repo}`) }] : []),
      ...(project.ssh ? [{ label: `Copy SSH: ${project.name}`, section: "Project", keywords: `${keywords} ${project.ssh}`, searchOnly: true, icon: TerminalIcon, run: () => void copyText(project.ssh, `Copied: ${project.ssh}`, toast) }] : []),
      ...(failedRun?.conclusion === "failure" ? [{ label: `Re-run failed CI: ${project.name}`, section: "Action", keywords, searchOnly: true, icon: RotateCwIcon, run: () => void rerunCI(failedRun.repo, failedRun.id) }] : []),
    ];
  });
  const commandActions: PaletteAction[] = (workspace?.commands ?? []).map((command) => ({ label: command.name, section: "Command", keywords: command.command, searchOnly: true, icon: TerminalSquareIcon, run: () => applyCommand(command) }));

  const paletteActions: PaletteAction[] = [
    ...(timer.running ? [{ label: "Stop the timer", section: "Time", shortcut: "s", icon: SquareIcon, run: () => void timer.stop() }] : []),
    ...projectActions,
    ...commandActions,
    ...TOOL_COMMANDS.map(({ tool, label, keywords }) => ({ label, section: "Toolbox", keywords, icon: WrenchIcon, run: () => openToolbox(tool) })),
    { label: "Customize this page", section: "Page", shortcut: "c", icon: PaletteIcon, run: () => setCustomizing(true) },
    { label: editing ? "Finish editing sites" : "Edit sites", section: "Page", shortcut: "e", icon: PencilIcon, run: () => setEditing(!editing) },
    { label: "Keyboard shortcuts", section: "Page", shortcut: "?", icon: KeyboardIcon, run: () => setShortcutsOpen(true) },
    { label: "Use the Developer look", section: "Page", keywords: "theme dracula monospace", icon: PaletteIcon, run: () => changePreferences({ ...DEFAULT_PREFERENCES, greetingText: preferences.greetingText, backgroundColor: preferences.backgroundColor, ...LOOKS.Developer }) },
    ...(user?.isAdmin ? [{ label: "Admin dashboard", section: "Page", icon: ShieldIcon, run: () => { location.href = `${apiBase()}/admin`; } }] : []),
    { label: "Sign out", section: "Page", icon: LogOutIcon, run: () => void signOut() },
  ];

  if (phase === "loading") {
    return (
      <main className="home-background grid min-h-screen place-items-center">
        <span className="loading loading-lg loading-spinner text-primary" aria-label="Loading" />
      </main>
    );
  }

  if (phase === "signed-out") {
    return (
      <main className="home-background grid min-h-screen place-items-center p-6">
        <section className="card w-full max-w-sm border bg-base-100/80 shadow-xl backdrop-blur-lg">
          <div className="card-body items-center gap-3 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- Static export serves images as they are. */}
            <img src="/icons/icon128.png" alt="" width={72} height={72} />
            <h1 className="text-3xl font-bold tracking-tight">Home Base</h1>
            <p className="mb-2 text-muted-foreground">Your own start page, with your sites on every device.</p>
            <Button size="lg" className="w-full" disabled={signingIn} onClick={signIn}>
              Continue with GitHub
            </Button>
            {loginError && (
              <p role="alert" className="text-sm text-error">
                {loginError}
              </p>
            )}
            <a className="link text-sm text-muted-foreground" href={`${apiBase() || ""}/privacy`} target="_blank" rel="noopener">
              Privacy
            </a>
          </div>
        </section>
      </main>
    );
  }

  const browserSections = [
    { title: "Most visited", links: topSites, visible: preferences.showMostVisited },
    { title: "Bookmarks", links: bookmarks.slice(0, MAX_BOOKMARKS), visible: preferences.showBookmarks },
  ];

  return (
    <div className="home-background min-h-screen">
      <div className="home-pattern" aria-hidden />
      <div className="home-shell relative">
        <div className="home-page px-6 pb-14">
          <header className="home-toolbar flex min-h-16 flex-wrap items-center justify-end gap-1 pt-3 text-sm">
            {user && <span className="mr-2 font-medium">@{user.login}</span>}
            {user?.isAdmin && (
              <Button variant="ghost" size="sm" render={<a href={`${apiBase()}/admin`} />}>
                <ShieldIcon /> Admin
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => { setPaletteText(""); setPaletteOpen(true); }} aria-label="Open the command palette">
              <CommandIcon /> Commands <kbd className="kbd kbd-xs ml-0.5 text-base-content">⌘K</kbd>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => openToolbox()}>
              <WrenchIcon /> Toolbox
            </Button>
            <Button variant="ghost" size="sm" aria-expanded={customizing} onClick={() => setCustomizing(!customizing)}>
              <PaletteIcon /> Customize
            </Button>
            <Button variant="ghost" size="sm" aria-pressed={editing} onClick={() => setEditing(!editing)}>
              {editing ? <CheckIcon /> : <PencilIcon />} {editing ? "Done" : "Edit"}
            </Button>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOutIcon /> Sign out
            </Button>
          </header>

          <main className="pt-[3vh]">
            {promptVisible && extensionUrl && (
              <div role="status" className="alert mx-auto mb-6 max-w-2xl shadow-lg">
                <div>
                  <h2 className="font-semibold">Open this in every new tab?</h2>
                  <p className="text-sm opacity-80">Add Home Base to Chrome to see your sites, bookmarks and most visited each time you open a tab.</p>
                </div>
                <div className="flex flex-none gap-1.5">
                  <Button size="sm" render={<a href={extensionUrl} target="_blank" rel="noopener" onClick={dismissPrompt} />}>
                    Add to Chrome
                  </Button>
                  <Button variant="ghost" size="sm" onClick={dismissPrompt}>
                    Not now
                  </Button>
                </div>
              </div>
            )}

            <Clock preferences={preferences} login={user?.login ?? null} />
            {preferences.showSearch && (
              <SearchBox groups={groups} browserLinks={[...topSites, ...bookmarks]} engine={preferences.searchEngine} />
            )}

            {preferences.showAttention && <AttentionBar projects={workspace ? projectStatus.projects : null} projectsFailed={projectStatus.failed} isAdmin={Boolean(user?.isAdmin)} onRerun={(repo, runId) => void rerunCI(repo, runId)} onSignedOut={signedOutElsewhere} />}

            <Groups groups={groups} editing={editing} onChange={changeGroups} />

            {(preferences.showProjects || preferences.showWorkLog || preferences.showTime || preferences.showCommands || preferences.showGitHub || preferences.showNews || preferences.showMonitors || preferences.showTodos || preferences.showNotes || preferences.showClocks) && (
              <section className="home-widgets mt-5" aria-label="Developer panels">
                {preferences.showProjects && <ProjectsCard workspace={workspace} save={saveWorkspace} projects={projectStatus.projects} loading={projectStatus.loading} onRefresh={() => void projectStatus.reload()} timer={timer} onReport={setReportProject} onDeploy={setDeployProject} onRerun={(repo, runId) => void rerunCI(repo, runId)} />}
                {preferences.showWorkLog && <WorkLogCard projects={projectList} onSignedOut={signedOutElsewhere} />}
                {preferences.showTime && <TimeCard projects={projectList} timer={timer} />}
                {preferences.showCommands && <CommandsCard workspace={workspace} save={saveWorkspace} onUse={applyCommand} />}
                {preferences.showClocks && <ClocksCard />}
                {user?.isAdmin && preferences.showServers && <ServersCard onSignedOut={signedOutElsewhere} />}
                {preferences.showGitHub && <GitHubCard onSignedOut={signedOutElsewhere} />}
                <WorkspaceCards preferences={preferences} workspace={workspace} save={saveWorkspace} projectsDown={(projectStatus.projects ?? []).filter(({ monitor }) => !monitor.up).map(({ url }) => url)} onSignedOut={signedOutElsewhere} />
                {preferences.showNews && <NewsCard onSignedOut={signedOutElsewhere} />}
              </section>
            )}

            {editing && (
              <div className="mt-5 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => changeGroups([...groups, { name: "New group", links: [] }])}>
                  <PlusIcon /> Add group
                </Button>
                <Button variant="ghost" className="home-toolbar" onClick={restoreSites}>
                  <RotateCcwIcon /> Restore original sites
                </Button>
              </div>
            )}

            {browserSections.map(
              (section) =>
                section.visible &&
                section.links.length > 0 && (
                  <section key={section.title} className="home-group mt-5">
                    <h2 className="home-group-title mb-3 px-1 text-sm font-semibold">{section.title}</h2>
                    <div className="home-links">
                      {section.links.map((link) => (
                        <div key={link.url} className="min-w-0">
                          <SiteLink link={link} />
                        </div>
                      ))}
                    </div>
                  </section>
                ),
            )}
          </main>
        </div>
      </div>

      <CommandPalette open={paletteOpen} groups={groups} actions={paletteActions} initialText={paletteText} onOpenChange={setPaletteOpen} />
      {reportProject && <ProjectReportDialog project={reportProject} onClose={() => setReportProject(null)} />}
      {deployProject && <DeployDialog project={deployProject} latestRun={projectStatus.projects?.find(({ id }) => id === deployProject.id)?.ci ?? null} onDeployed={() => setTimeout(() => void projectStatus.reload(), 5000)} onSignedOut={signedOutElsewhere} onClose={() => setDeployProject(null)} />}
      {fillingCommand && <CommandFillDialog command={fillingCommand} projects={projectList} onClose={() => setFillingCommand(null)} />}
      {toolboxOpen && <ToolboxDialog open tool={toolboxTool} onOpenChange={setToolboxOpen} />}
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      {customizing && (
        <CustomizePanel
          preferences={preferences}
          accentPreview={accentPreview}
          onSet={setPreference}
          onLook={(name) => changePreferences({ ...DEFAULT_PREFERENCES, greetingText: preferences.greetingText, backgroundColor: preferences.backgroundColor, ...LOOKS[name] })}
          onUploadImage={uploadImage}
          onRemoveImage={removeImage}
          onClose={() => setCustomizing(false)}
          login={user?.login ?? ""}
          isAdmin={Boolean(user?.isAdmin)}
          onAccountDeleted={() => void accountDeleted()}
        />
      )}
    </div>
  );
}
