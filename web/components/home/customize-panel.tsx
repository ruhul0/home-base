"use client";

import { CheckIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isExtension } from "@/lib/browser";
import { DAISY_THEMES, LOOKS, resolveThemeChoice } from "@/lib/preferences";
import type { Preferences } from "@/lib/types";

type Choices = Record<string, string>;
type SetPreference = <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;

function ChoiceField({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: Choices;
  onChange: (value: string) => void;
}) {
  const items = Object.entries(choices).map(([optionValue, optionLabel]) => ({ value: optionValue, label: optionLabel }));
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Select items={items} value={value} onValueChange={(next) => next !== null && onChange(String(next))}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SwitchField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={(value) => onChange(Boolean(value))} aria-label={label} />
    </div>
  );
}

function ColourField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <input
        type="color"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full cursor-pointer rounded-lg border bg-base-100 p-1"
      />
    </div>
  );
}

/** Each card sets its own DaisyUI theme, so it previews that theme's real colours. */
function ThemeCard({ theme, label, selected, onSelect }: { theme: string; label: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      data-theme={theme === "auto" ? undefined : theme}
      className={`relative overflow-hidden rounded-lg border bg-base-100 p-2 text-left text-base-content transition hover:-translate-y-0.5 ${selected ? "ring-2 ring-primary" : ""}`}
    >
      <span className="block truncate text-xs font-medium capitalize">{label}</span>
      <span className="mt-1.5 flex gap-1" aria-hidden>
        <span className="size-3 rounded-full bg-primary" />
        <span className="size-3 rounded-full bg-secondary" />
        <span className="size-3 rounded-full bg-accent" />
        <span className="size-3 rounded-full bg-neutral" />
      </span>
      {selected && <CheckIcon className="absolute top-1.5 right-1.5 size-3.5 text-primary" aria-hidden />}
    </button>
  );
}

export function CustomizePanel({
  preferences,
  accentPreview,
  onSet,
  onLook,
  onUploadImage,
  onRemoveImage,
  onClose,
}: {
  preferences: Preferences;
  accentPreview: string;
  onSet: SetPreference;
  onLook: (name: string) => void;
  onUploadImage: (file: File) => void;
  onRemoveImage: () => void;
  onClose: () => void;
}) {
  const themeChoice = resolveThemeChoice(preferences);

  return (
    <aside
      aria-label="Customize your page"
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l bg-base-100 text-base-content shadow-2xl sm:w-[23rem]"
    >
      <header className="flex items-center justify-between px-4 py-3">
        <h2 className="text-lg font-semibold">Customize</h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close customize panel">
          <XIcon />
        </Button>
      </header>
      <Separator />

      <Tabs defaultValue="style" className="min-h-0 flex-1 gap-0">
        <TabsList className="mx-4 mt-3 grid grid-cols-4">
          <TabsTrigger value="style">Style</TabsTrigger>
          <TabsTrigger value="background">Backdrop</TabsTrigger>
          <TabsTrigger value="layout">Layout</TabsTrigger>
          <TabsTrigger value="page">Page</TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-8">
          <TabsContent value="style" className="grid gap-5">
            <div className="grid gap-2">
              <Label>Start from a look</Label>
              <div className="flex flex-wrap gap-1.5">
                {Object.keys(LOOKS).map((name) => (
                  <Button key={name} variant="outline" size="sm" onClick={() => onLook(name)}>
                    {name}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Theme</Label>
              <div className="grid grid-cols-2 gap-2">
                <ThemeCard theme="auto" label="Match my device" selected={themeChoice === "auto"} onSelect={() => onSet("theme", "auto")} />
                {DAISY_THEMES.map((theme) => (
                  <ThemeCard key={theme} theme={theme} label={theme} selected={themeChoice === theme} onSelect={() => onSet("theme", theme)} />
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <ColourField label="Accent colour" value={preferences.accentColor || accentPreview} onChange={(value) => onSet("accentColor", value)} />
              <Button variant="outline" size="sm" className="justify-self-start" disabled={!preferences.accentColor} onClick={() => onSet("accentColor", "")}>
                Use the theme&apos;s colour
              </Button>
            </div>

            <ChoiceField label="Font" value={preferences.font} choices={{ system: "System", serif: "Serif", mono: "Monospace", rounded: "Rounded" }} onChange={(value) => onSet("font", value as Preferences["font"])} />
          </TabsContent>

          <TabsContent value="background" className="grid gap-5">
            <ChoiceField label="Background" value={preferences.backgroundType} choices={{ theme: "Theme colours", solid: "Solid colour", image: "My own image" }} onChange={(value) => onSet("backgroundType", value as Preferences["backgroundType"])} />

            {preferences.backgroundType === "solid" && (
              <ColourField label="Solid colour" value={preferences.backgroundColor} onChange={(value) => onSet("backgroundColor", value)} />
            )}

            {preferences.backgroundType === "image" && (
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="background-upload">Upload an image</Label>
                  <input
                    id="background-upload"
                    type="file"
                    accept="image/*"
                    className="file-input file-input-sm w-full"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) onUploadImage(file);
                      event.target.value = "";
                    }}
                  />
                  <p className="text-xs text-muted-foreground">Resized automatically, and only used on your own page.</p>
                </div>
                <ChoiceField label="Darken image" value={String(preferences.backgroundDim)} choices={{ "0": "None", "20": "A little", "40": "Medium", "60": "A lot" }} onChange={(value) => onSet("backgroundDim", Number(value))} />
                <Button variant="outline" size="sm" className="justify-self-start" onClick={onRemoveImage}>
                  Remove image
                </Button>
              </div>
            )}

            <ChoiceField label="Pattern" value={preferences.pattern} choices={{ none: "None", dots: "Dots", grid: "Grid", lines: "Lines" }} onChange={(value) => onSet("pattern", value as Preferences["pattern"])} />
          </TabsContent>

          <TabsContent value="layout" className="grid gap-5">
            <ChoiceField label="Site layout" value={preferences.layout} choices={{ tiles: "Tiles", list: "List", compact: "Icons only" }} onChange={(value) => onSet("layout", value as Preferences["layout"])} />
            <ChoiceField label="Icon size" value={preferences.tileSize} choices={{ small: "Small", medium: "Medium", large: "Large" }} onChange={(value) => onSet("tileSize", value as Preferences["tileSize"])} />
            <ChoiceField label="Icon shape" value={preferences.iconShape} choices={{ rounded: "Rounded", circle: "Circle", square: "Square" }} onChange={(value) => onSet("iconShape", value as Preferences["iconShape"])} />
            <ChoiceField label="Group columns" value={preferences.columns} choices={{ auto: "Automatic", "1": "1", "2": "2", "3": "3", "4": "4" }} onChange={(value) => onSet("columns", value as Preferences["columns"])} />
            <ChoiceField label="Page width" value={preferences.pageWidth} choices={{ narrow: "Narrow", normal: "Normal", wide: "Wide" }} onChange={(value) => onSet("pageWidth", value as Preferences["pageWidth"])} />
            <ChoiceField label="Group style" value={preferences.cardStyle} choices={{ glass: "Glass", solid: "Solid", outline: "Outline", none: "No boxes" }} onChange={(value) => onSet("cardStyle", value as Preferences["cardStyle"])} />
            <ChoiceField label="Corners" value={preferences.corners} choices={{ round: "Round", soft: "Soft", sharp: "Sharp" }} onChange={(value) => onSet("corners", value as Preferences["corners"])} />
            <ChoiceField label="Clock and search position" value={preferences.heroAlign} choices={{ center: "Centre", left: "Left" }} onChange={(value) => onSet("heroAlign", value as Preferences["heroAlign"])} />
          </TabsContent>

          <TabsContent value="page" className="grid gap-5">
            <div className="grid gap-3">
              <SwitchField label="Show clock" checked={preferences.showClock} onChange={(value) => onSet("showClock", value)} />
              <SwitchField label="Show seconds" checked={preferences.showSeconds} onChange={(value) => onSet("showSeconds", value)} />
              <SwitchField label="Show greeting" checked={preferences.showGreeting} onChange={(value) => onSet("showGreeting", value)} />
              <SwitchField label="Show date" checked={preferences.showDate} onChange={(value) => onSet("showDate", value)} />
              <SwitchField label="Show search box" checked={preferences.showSearch} onChange={(value) => onSet("showSearch", value)} />
              <SwitchField label="Show site names" checked={preferences.showLabels} onChange={(value) => onSet("showLabels", value)} />
              <SwitchField label="Show group names" checked={preferences.showGroupTitles} onChange={(value) => onSet("showGroupTitles", value)} />
              {isExtension() && (
                <>
                  <SwitchField label="Show most visited" checked={preferences.showMostVisited} onChange={(value) => onSet("showMostVisited", value)} />
                  <SwitchField label="Show bookmarks" checked={preferences.showBookmarks} onChange={(value) => onSet("showBookmarks", value)} />
                </>
              )}
            </div>

            <Separator />

            <div className="grid gap-3">
              <Label>Developer panels</Label>
              <SwitchField label="GitHub" checked={preferences.showGitHub} onChange={(value) => onSet("showGitHub", value)} />
              <SwitchField label="Monitors" checked={preferences.showMonitors} onChange={(value) => onSet("showMonitors", value)} />
              <SwitchField label="Todos" checked={preferences.showTodos} onChange={(value) => onSet("showTodos", value)} />
              <SwitchField label="Scratchpad" checked={preferences.showNotes} onChange={(value) => onSet("showNotes", value)} />
              <SwitchField label="Hacker News" checked={preferences.showNews} onChange={(value) => onSet("showNews", value)} />
              <SwitchField label="Time and Unix clock" checked={preferences.showClocks} onChange={(value) => onSet("showClocks", value)} />
            </div>

            <Separator />

            <div className="grid gap-1.5">
              <Label htmlFor="greeting-text">Custom greeting</Label>
              <Input id="greeting-text" value={preferences.greetingText} maxLength={60} placeholder='Leave empty for "Good morning"' onChange={(event) => onSet("greetingText", event.target.value)} />
            </div>
            <ChoiceField label="Clock format" value={preferences.clockFormat} choices={{ auto: "Match my device", "12": "12 hour", "24": "24 hour" }} onChange={(value) => onSet("clockFormat", value as Preferences["clockFormat"])} />
            <ChoiceField label="Clock size" value={preferences.clockSize} choices={{ small: "Small", medium: "Medium", large: "Large" }} onChange={(value) => onSet("clockSize", value as Preferences["clockSize"])} />
            <ChoiceField label="Search engine" value={preferences.searchEngine} choices={{ default: "Default", google: "Google", duckduckgo: "DuckDuckGo", bing: "Bing", brave: "Brave" }} onChange={(value) => onSet("searchEngine", value as Preferences["searchEngine"])} />
          </TabsContent>
        </div>
      </Tabs>
    </aside>
  );
}
