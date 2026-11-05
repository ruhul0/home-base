"use client";

import { useEffect, useMemo, useState } from "react";
import { CopyIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  convertTimestamp,
  decodeBase64,
  decodeJwt,
  decodeUrl,
  encodeBase64,
  formatJson,
  hashText,
  testRegex,
  type HashAlgorithm,
  type ToolResult,
} from "@/lib/tools";

const FIELD = "min-h-32 bg-base-100 font-mono text-sm text-base-content";

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied.");
  } catch {
    toast.error("Your browser blocked copying.");
  }
}

function Output({ result }: { result: ToolResult | null }) {
  if (!result) return null;
  if (!result.ok) {
    return (
      <p role="alert" className="rounded-lg border border-error/40 bg-error/10 p-3 font-mono text-sm text-error">
        {result.error}
      </p>
    );
  }
  if (!result.value) return null;
  return (
    <div className="relative">
      <pre className="max-h-72 overflow-auto rounded-lg border bg-base-200 p-3 pr-11 font-mono text-sm break-all whitespace-pre-wrap">{result.value}</pre>
      <Button type="button" variant="ghost" size="icon-sm" className="absolute top-1.5 right-1.5" aria-label="Copy result" onClick={() => void copy(result.value)}>
        <CopyIcon />
      </Button>
    </div>
  );
}

function ConvertTool({ label, placeholder, actions }: { label: string; placeholder: string; actions: { name: string; run: (input: string) => ToolResult }[] }) {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<ToolResult | null>(null);
  return (
    <div className="grid gap-2">
      <Textarea aria-label={label} placeholder={placeholder} spellCheck={false} value={input} onChange={(event) => setInput(event.target.value)} className={FIELD} />
      <div className="flex flex-wrap gap-1.5">
        {actions.map((action) => (
          <Button key={action.name} size="sm" onClick={() => setResult(action.run(input))}>
            {action.name}
          </Button>
        ))}
      </div>
      <Output result={result} />
    </div>
  );
}

function LiveTool({ label, placeholder, convert }: { label: string; placeholder: string; convert: (input: string) => ToolResult }) {
  const [input, setInput] = useState("");
  const result = useMemo(() => (input.trim() ? convert(input) : null), [convert, input]);
  return (
    <div className="grid gap-2">
      <Textarea aria-label={label} placeholder={placeholder} spellCheck={false} value={input} onChange={(event) => setInput(event.target.value)} className={FIELD} />
      <Output result={result} />
    </div>
  );
}

function TimestampTool() {
  const [input, setInput] = useState("");
  const result = useMemo(() => (input.trim() ? convertTimestamp(input) : null), [input]);
  return (
    <div className="grid gap-2">
      <div className="flex gap-1.5">
        <Input aria-label="Timestamp or date" placeholder="1762387200, or 2026-11-06T00:00:00Z" value={input} onChange={(event) => setInput(event.target.value)} className="bg-base-100 font-mono text-base-content" />
        <Button size="sm" className="h-auto" onClick={() => setInput(String(Math.floor(Date.now() / 1000)))}>
          Now
        </Button>
      </div>
      <Output result={result} />
    </div>
  );
}

function UuidTool() {
  const [values, setValues] = useState<string[]>([]);
  const generate = () => setValues(Array.from({ length: 5 }, () => crypto.randomUUID()));
  return (
    <div className="grid gap-2">
      <Button size="sm" className="justify-self-start" onClick={generate}>
        <RefreshCwIcon /> Generate 5 UUIDs
      </Button>
      <Output result={{ ok: true, value: values.join("\n") }} />
    </div>
  );
}

function HashTool() {
  const [input, setInput] = useState("");
  const [hashes, setHashes] = useState<{ source: string; value: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const algorithms: HashAlgorithm[] = ["SHA-1", "SHA-256", "SHA-512"];
    if (!input) return;
    Promise.all(algorithms.map(async (algorithm) => `${algorithm}\n${await hashText(input, algorithm)}`)).then((lines) => {
      if (!cancelled) setHashes({ source: input, value: lines.join("\n\n") });
    });
    return () => {
      cancelled = true;
    };
  }, [input]);

  const value = input && hashes?.source === input ? hashes.value : "";
  return (
    <div className="grid gap-2">
      <Textarea aria-label="Text to hash" placeholder="Text to hash" spellCheck={false} value={input} onChange={(event) => setInput(event.target.value)} className={FIELD} />
      <Output result={{ ok: true, value }} />
    </div>
  );
}

function RegexTool() {
  const [pattern, setPattern] = useState("");
  const [flags, setFlags] = useState("i");
  const [input, setInput] = useState("");
  const result = useMemo(() => (pattern ? testRegex(pattern, flags, input) : null), [pattern, flags, input]);
  return (
    <div className="grid gap-2">
      <div className="flex gap-1.5">
        <Input aria-label="Pattern" placeholder="Pattern, like (\w+)@(\w+)" spellCheck={false} value={pattern} onChange={(event) => setPattern(event.target.value)} className="flex-1 bg-base-100 font-mono text-base-content" />
        <Input aria-label="Flags" placeholder="flags" spellCheck={false} value={flags} maxLength={6} onChange={(event) => setFlags(event.target.value)} className="w-20 bg-base-100 font-mono text-base-content" />
      </div>
      <Textarea aria-label="Text to test" placeholder="Text to test" spellCheck={false} value={input} onChange={(event) => setInput(event.target.value)} className={FIELD} />
      <Output result={result} />
    </div>
  );
}

const TOOLS = [
  { value: "json", label: "JSON" },
  { value: "jwt", label: "JWT" },
  { value: "base64", label: "Base64" },
  { value: "url", label: "URL" },
  { value: "time", label: "Time" },
  { value: "uuid", label: "UUID" },
  { value: "hash", label: "Hash" },
  { value: "regex", label: "Regex" },
];

export function ToolboxDialog({ open, tool, onOpenChange }: { open: boolean; tool?: string; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Dev toolbox</DialogTitle>
          <DialogDescription>Everything runs in your browser, so what you paste here is never sent anywhere.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue={tool ?? "json"} className="gap-3">
          <TabsList className="grid w-full grid-cols-4 sm:grid-cols-8">
            {TOOLS.map(({ value, label }) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="json">
            <ConvertTool
              label="JSON"
              placeholder='{"paste":"some JSON"}'
              actions={[
                { name: "Format", run: (input) => formatJson(input, 2) },
                { name: "Minify", run: (input) => formatJson(input, 0) },
              ]}
            />
          </TabsContent>
          <TabsContent value="jwt">
            <LiveTool label="JWT" placeholder="Paste a JWT to read its header and payload" convert={decodeJwt} />
          </TabsContent>
          <TabsContent value="base64">
            <ConvertTool
              label="Base64 text"
              placeholder="Text or Base64"
              actions={[
                { name: "Encode", run: (input) => ({ ok: true, value: encodeBase64(input) }) },
                { name: "Decode", run: decodeBase64 },
              ]}
            />
          </TabsContent>
          <TabsContent value="url">
            <ConvertTool
              label="URL text"
              placeholder="Text or encoded URL"
              actions={[
                { name: "Encode", run: (input) => ({ ok: true, value: encodeURIComponent(input) }) },
                { name: "Decode", run: decodeUrl },
              ]}
            />
          </TabsContent>
          <TabsContent value="time">
            <TimestampTool />
          </TabsContent>
          <TabsContent value="uuid">
            <UuidTool />
          </TabsContent>
          <TabsContent value="hash">
            <HashTool />
          </TabsContent>
          <TabsContent value="regex">
            <RegexTool />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
