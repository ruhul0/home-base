"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { normalizeUrl } from "@/lib/links";
import type { Group, Link } from "@/lib/types";

export interface LinkDialogTarget {
  groupIndex: number;
  /** Missing when adding a new link. */
  linkIndex?: number;
  link?: Link;
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
  const [error, setError] = useState("");
  const groupItems = groups.map((group, index) => ({ value: String(index), label: group.name }));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const url = normalizeUrl(address);
    if (!url) {
      setError("Enter a web address, like example.com.");
      return;
    }
    const finalName = name.trim() || new URL(url).hostname.replace(/^www\./, "");
    onSave({ name: finalName, url }, Number(groupIndex));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{target.link ? "Edit site" : "Add a site"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="link-address">Address</Label>
            <Input
              id="link-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="example.com"
              autoFocus
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="link-name">Name</Label>
            <Input
              id="link-name"
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              placeholder="Uses the address if left empty"
            />
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
