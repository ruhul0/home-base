"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ColourPicker } from "./colour-picker";

export function GroupColourDialog({
  groupName,
  colour,
  onClose,
  onSave,
}: {
  groupName: string;
  colour: string;
  onClose: () => void;
  onSave: (colour: string) => void;
}) {
  const [value, setValue] = useState(colour);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Colour for {groupName}</DialogTitle>
        </DialogHeader>
        <ColourPicker label="Group colour" value={value} emptyLabel="No colour" onChange={setValue} />
        <p className="text-sm text-muted-foreground">Tints this group, and its letter and symbol tiles unless they have their own colour.</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={() => onSave(value)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
