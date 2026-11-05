"use client";

import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { COLOUR_PALETTE } from "@/lib/links";

const CUSTOM_FALLBACK = "#6366f1";

/** Colour choices stay local until the surrounding dialog is saved. */
export function ColourPicker({
  label,
  value,
  emptyLabel,
  onChange,
}: {
  label: string;
  value: string;
  emptyLabel: string;
  onChange: (value: string) => void;
}) {
  const custom = value && !COLOUR_PALETTE.includes(value);
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-1.5">
        {COLOUR_PALETTE.map((colour) => (
          <button
            key={colour}
            type="button"
            aria-label={`Use colour ${colour}`}
            aria-pressed={value === colour}
            onClick={() => onChange(colour)}
            className="grid size-7 cursor-pointer place-items-center rounded-full border text-white transition hover:scale-110"
            style={{ background: colour }}
          >
            {value === colour && <CheckIcon className="size-4" aria-hidden />}
          </button>
        ))}
        <input
          type="color"
          aria-label="Choose any colour"
          value={value || CUSTOM_FALLBACK}
          onChange={(event) => onChange(event.target.value)}
          className={`h-7 w-10 cursor-pointer rounded-md border bg-base-100 p-0.5 ${custom ? "ring-2 ring-primary" : ""}`}
        />
      </div>
      <Button type="button" variant="outline" size="sm" className="justify-self-start" disabled={!value} onClick={() => onChange("")}>
        {emptyLabel}
      </Button>
    </div>
  );
}
