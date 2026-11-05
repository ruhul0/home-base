"use client";

import { useRef, useState } from "react";
import { ArrowLeftIcon, ArrowRightIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addLink, moveGroup, moveLink, removeLink, updateLink } from "@/lib/links";
import type { Group, Link } from "@/lib/types";
import { LinkDialog, type LinkDialogTarget } from "./link-dialog";
import { SiteIcon } from "./site-icon";

type DragItem = { type: "link"; groupIndex: number; linkIndex: number } | { type: "group"; groupIndex: number };

export function SiteLink({ link }: { link: Link }) {
  return (
    <a className="home-link" href={link.url} title={`${link.name}\n${link.url}`} aria-label={link.name}>
      <SiteIcon link={link} />
      <span className="home-link-name">{link.name}</span>
    </a>
  );
}

export function Groups({
  groups,
  editing,
  onChange,
}: {
  groups: Group[];
  editing: boolean;
  onChange: (groups: Group[]) => void;
}) {
  const [dialog, setDialog] = useState<LinkDialogTarget | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dragItem = useRef<DragItem | null>(null);

  function dropHandlers(id: string, onDrop: (item: DragItem) => void) {
    return {
      onDragOver(event: React.DragEvent) {
        if (!dragItem.current) return;
        event.preventDefault();
        event.stopPropagation();
        setDropTarget(id);
      },
      onDrop(event: React.DragEvent) {
        if (!dragItem.current) return;
        event.preventDefault();
        event.stopPropagation();
        const item = dragItem.current;
        dragItem.current = null;
        setDropTarget(null);
        onDrop(item);
      },
    };
  }

  function dragHandlers(item: DragItem) {
    return {
      draggable: true,
      "data-draggable": true,
      onDragStart(event: React.DragEvent) {
        event.stopPropagation();
        dragItem.current = item;
        event.dataTransfer.effectAllowed = "move";
      },
      onDragEnd() {
        dragItem.current = null;
        setDropTarget(null);
      },
    };
  }

  function saveDialog(link: Link, groupIndex: number) {
    if (!dialog) return;
    let next = groups;
    if (dialog.linkIndex === undefined) {
      next = addLink(next, groupIndex, link);
    } else {
      next = updateLink(next, dialog.groupIndex, dialog.linkIndex, link);
      if (groupIndex !== dialog.groupIndex) {
        next = moveLink(next, dialog.groupIndex, dialog.linkIndex, groupIndex, next[groupIndex].links.length);
      }
    }
    setDialog(null);
    onChange(next);
  }

  function renameGroup(index: number, name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === groups[index].name) return;
    onChange(groups.map((group, position) => (position === index ? { ...group, name: trimmed } : group)));
  }

  return (
    <>
      <section className="home-groups" aria-label="Your sites">
        {groups.map((group, groupIndex) => {
          const groupDrop = dropHandlers(`group-${groupIndex}`, (item) => {
            if (item.type === "group") onChange(moveGroup(groups, item.groupIndex, groupIndex));
            else onChange(moveLink(groups, item.groupIndex, item.linkIndex, groupIndex, group.links.length));
          });
          return (
            <div
              key={`${groupIndex}-${group.name}`}
              className={`home-group ${dropTarget === `group-${groupIndex}` ? "home-drop-target" : ""}`}
              {...(editing ? groupDrop : {})}
            >
              {editing ? (
                <div className="mb-3 flex items-center gap-1.5" {...dragHandlers({ type: "group", groupIndex })}>
                  <Input
                    defaultValue={group.name}
                    maxLength={100}
                    aria-label="Group name"
                    onBlur={(event) => renameGroup(groupIndex, event.target.value)}
                    className="min-w-0 flex-1 bg-base-100 text-base-content"
                  />
                  <Button variant="outline" size="icon-sm" className="bg-base-100 text-base-content" aria-label={`Move ${group.name} earlier`} disabled={groupIndex === 0} onClick={() => onChange(moveGroup(groups, groupIndex, groupIndex - 1))}>
                    <ArrowLeftIcon />
                  </Button>
                  <Button variant="outline" size="icon-sm" className="bg-base-100 text-base-content" aria-label={`Move ${group.name} later`} disabled={groupIndex === groups.length - 1} onClick={() => onChange(moveGroup(groups, groupIndex, groupIndex + 1))}>
                    <ArrowRightIcon />
                  </Button>
                  {/* A group can only be removed once empty, which prevents losing several links with one click. */}
                  {group.links.length === 0 && (
                    <Button variant="outline" size="icon-sm" className="bg-base-100 text-error" aria-label={`Remove group ${group.name}`} onClick={() => onChange(groups.filter((_, position) => position !== groupIndex))}>
                      <Trash2Icon />
                    </Button>
                  )}
                </div>
              ) : (
                <h2 className="home-group-title mb-3 px-1 text-sm font-semibold">{group.name}</h2>
              )}

              <div className="home-links">
                {group.links.map((link, linkIndex) => {
                  const id = `link-${groupIndex}-${linkIndex}`;
                  const linkDrop = dropHandlers(id, (item) => {
                    if (item.type === "link") onChange(moveLink(groups, item.groupIndex, item.linkIndex, groupIndex, linkIndex));
                  });
                  return (
                    <div
                      key={`${link.url}-${linkIndex}`}
                      className={`relative min-w-0 rounded-2xl ${dropTarget === id ? "home-drop-target" : ""}`}
                      {...(editing ? { ...dragHandlers({ type: "link", groupIndex, linkIndex }), ...linkDrop } : {})}
                    >
                      <SiteLink link={link} />
                      {editing && (
                        <>
                          <button
                            type="button"
                            aria-label={`Edit ${link.name}`}
                            className="btn absolute top-0 left-0 btn-circle btn-xs"
                            onClick={() => setDialog({ groupIndex, linkIndex, link })}
                          >
                            <PencilIcon className="size-3" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${link.name}`}
                            className="btn absolute top-0 right-0 btn-circle btn-xs"
                            onClick={() => onChange(removeLink(groups, groupIndex, linkIndex))}
                          >
                            <XIcon className="size-3" />
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {editing && (
                <Button variant="outline" size="sm" className="mt-3 w-full bg-base-100 text-base-content" onClick={() => setDialog({ groupIndex })}>
                  <PlusIcon /> Add a site
                </Button>
              )}
            </div>
          );
        })}
      </section>

      {dialog && (
        <LinkDialog
          key={`${dialog.groupIndex}-${dialog.linkIndex ?? "new"}`}
          target={dialog}
          groups={groups}
          onClose={() => setDialog(null)}
          onSave={saveDialog}
        />
      )}
    </>
  );
}
