"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ICON_SET } from "@/lib/icon-set";
import { compressIcon, normalizeUrl } from "@/lib/links";
import type { Group, Link } from "@/lib/types";
import { ColourPicker } from "./colour-picker";
import { SiteIcon } from "./site-icon";

export interface LinkDialogTarget {
  groupIndex: number;
  /** Missing when adding a new link. */
  linkIndex?: number;
  link?: Link;
}

type IconKind = "auto" | "emoji" | "lucide" | "image";

function iconKindOf(icon: string): IconKind {
  if (icon.startsWith("emoji:")) return "emoji";
  if (icon.startsWith("lucide:")) return "lucide";
  if (icon.startsWith("image:")) return "image";
  return "auto";
}

export function LinkDialog({
  target,
  groups,
  onClose,
  onSave,
}: {
  target: LinkDialogTarget;
  groups: Group[];
  onClose: () => void;
  onSave: (link: Link, groupIndex: number) => void;
}) {
  const [name, setName] = useState(target.link?.name ?? "");
  const [address, setAddress] = useState(target.link?.url ?? "");
  const [groupIndex, setGroupIndex] = useState(String(target.groupIndex));
  const [icon, setIcon] = useState(target.link?.icon ?? "");
  const [iconKind, setIconKind] = useState<IconKind>(iconKindOf(target.link?.icon ?? ""));
  const [iconColor, setIconColor] = useState(target.link?.iconColor ?? "");
  const [error, setError] = useState("");
  const [imageError, setImageError] = useState("");

  const groupItems = groups.map((group, index) => ({ value: String(index), label: group.name }));
  const emoji = icon.startsWith("emoji:") ? icon.slice("emoji:".length) : "";
  const groupColor = groups[Number(groupIndex)]?.color;
  const usesTile = iconKind !== "image";

  function chooseKind(kind: IconKind) {
    setIconKind(kind);
    // Switching type clears an icon of the other type, so the preview always matches what will be saved.
    if (kind === "auto" || iconKindOf(icon) !== kind) setIcon("");
  }

  async function chooseImage(file: File) {
    setImageError("");
    try {
      setIcon(await compressIcon(file));
    } catch {
      setImageError("That image couldn't be used. Try a different JPEG or PNG.");
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const url = normalizeUrl(address);
    if (!url) {
      setError("Enter a web address, like example.com.");
      return;
    }
    const finalName = name.trim() || new URL(url).hostname.replace(/^www\./, "");
    const link: Link = { name: finalName, url };
    if (icon) link.icon = icon;
    if (iconColor && usesTile) link.iconColor = iconColor;
    onSave(link, Number(groupIndex));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{target.link ? "Edit site" : "Add a site"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="link-address">Address</Label>
            <Input id="link-address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="example.com" autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="link-name">Name</Label>
            <Input id="link-name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="Uses the address if left empty" />
          </div>
          <div className="grid gap-1.5">
            <Label>Group</Label>
            <Select items={groupItems} value={groupIndex} onValueChange={(value) => setGroupIndex(String(value))}>
              <SelectTrigger className="w-full" aria-label="Group">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {groupItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center gap-3">
              <div className="[--icon-size:2.75rem] [--icon-radius:0.875rem]" aria-label="Icon preview">
                <SiteIcon link={{ name: name || address || "?", url: normalizeUrl(address) ?? "https://example.com/", icon, iconColor }} groupColor={groupColor} />
              </div>
              <Label>Icon</Label>
            </div>
            <Tabs value={iconKind} onValueChange={(value) => chooseKind(value as IconKind)} className="gap-3">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="auto">Automatic</TabsTrigger>
                <TabsTrigger value="emoji">Emoji</TabsTrigger>
                <TabsTrigger value="lucide">Symbol</TabsTrigger>
                <TabsTrigger value="image">Image</TabsTrigger>
              </TabsList>
              <TabsContent value="auto" className="text-sm text-muted-foreground">
                Uses the site&apos;s real icon in the Chrome extension, and its first letter on the website.
              </TabsContent>
              <TabsContent value="emoji">
                <Input
                  aria-label="Emoji"
                  value={emoji}
                  maxLength={8}
                  placeholder="Type or paste an emoji, like 🎵"
                  onChange={(event) => setIcon(event.target.value ? `emoji:${event.target.value}` : "")}
                />
              </TabsContent>
              <TabsContent value="lucide">
                <div className="grid max-h-40 grid-cols-8 gap-1 overflow-y-auto rounded-lg border p-1.5">
                  {Object.entries(ICON_SET).map(([symbolName, Symbol]) => {
                    const value = `lucide:${symbolName}`;
                    return (
                      <button
                        key={symbolName}
                        type="button"
                        aria-label={symbolName.replaceAll("-", " ")}
                        aria-pressed={icon === value}
                        onClick={() => setIcon(value)}
                        className={`grid aspect-square cursor-pointer place-items-center rounded-md hover:bg-base-200 ${icon === value ? "bg-primary text-primary-content hover:bg-primary" : ""}`}
                      >
                        <Symbol className="size-4" aria-hidden />
                      </button>
                    );
                  })}
                </div>
              </TabsContent>
              <TabsContent value="image" className="grid gap-1.5">
                <input
                  type="file"
                  accept="image/*"
                  aria-label="Upload an icon image"
                  className="file-input file-input-sm w-full"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void chooseImage(file);
                    event.target.value = "";
                  }}
                />
                <p className="text-xs text-muted-foreground">Cropped to a square and shrunk automatically. About 30 image icons fit in one account.</p>
                {imageError && (
                  <p role="alert" className="text-sm text-error">
                    {imageError}
                  </p>
                )}
              </TabsContent>
            </Tabs>
          </div>

          {usesTile && <ColourPicker label="Tile colour" value={iconColor} emptyLabel="Use the group's colour" onChange={setIconColor} />}

          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
