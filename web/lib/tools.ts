// The developer toolbox. Everything here runs in the browser, so nothing typed into it leaves the page.

export type ToolResult = { ok: true; value: string } | { ok: false; error: string };

const success = (value: string): ToolResult => ({ ok: true, value });
const failure = (error: string): ToolResult => ({ ok: false, error });

export function formatJson(input: string, indent: number): ToolResult {
  try {
    return success(JSON.stringify(JSON.parse(input), null, indent));
  } catch (error) {
    return failure(error instanceof Error ? error.message : "That isn't valid JSON.");
  }
}

function bytesToBinary(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
}

export function encodeBase64(input: string): string {
  return btoa(bytesToBinary(new TextEncoder().encode(input)));
}

export function decodeBase64(input: string): ToolResult {
  try {
    const normal = input.trim().replace(/-/g, "+").replace(/_/g, "/");
    const padded = normal.padEnd(normal.length + ((4 - (normal.length % 4)) % 4), "=");
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    return success(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return failure("That isn't valid Base64 text.");
  }
}

export function decodeUrl(input: string): ToolResult {
  try {
    return success(decodeURIComponent(input));
  } catch {
    return failure("That has an invalid percent sequence.");
  }
}

/** Reads a JWT without checking its signature, which needs the secret or public key. */
export function decodeJwt(input: string): ToolResult {
  const parts = input.trim().split(".");
  if (parts.length !== 3) return failure("A JWT has three parts separated by dots.");
  const [header, payload] = parts.map(decodeBase64);
  if (!header.ok || !payload.ok) return failure("That token's parts aren't valid Base64.");
  try {
    const claims = JSON.parse(payload.value) as { exp?: number; iat?: number };
    const notes: string[] = [];
    if (typeof claims.iat === "number") notes.push(`Issued: ${new Date(claims.iat * 1000).toISOString()}`);
    if (typeof claims.exp === "number") {
      const expired = claims.exp * 1000 < Date.now();
      notes.push(`${expired ? "Expired" : "Expires"}: ${new Date(claims.exp * 1000).toISOString()}`);
    }
    const sections = [
      `Header\n${JSON.stringify(JSON.parse(header.value), null, 2)}`,
      `Payload\n${JSON.stringify(claims, null, 2)}`,
    ];
    if (notes.length) sections.push(notes.join("\n"));
    sections.push("The signature hasn't been checked.");
    return success(sections.join("\n\n"));
  } catch {
    return failure("That token's parts aren't valid JSON.");
  }
}

/** Accepts Unix seconds, Unix milliseconds or any date the browser understands. */
export function convertTimestamp(input: string): ToolResult {
  const text = input.trim();
  if (!text) return failure("Enter a timestamp or date.");
  const date = /^-?\d+$/.test(text)
    ? new Date(text.replace("-", "").length > 11 ? Number(text) : Number(text) * 1000)
    : new Date(text);
  if (Number.isNaN(date.getTime())) return failure("That isn't a timestamp or date.");
  return success(
    [
      `Unix seconds: ${Math.floor(date.getTime() / 1000)}`,
      `Unix milliseconds: ${date.getTime()}`,
      `UTC: ${date.toISOString()}`,
      `Local: ${date.toLocaleString()}`,
    ].join("\n"),
  );
}

export type HashAlgorithm = "SHA-1" | "SHA-256" | "SHA-512";

export async function hashText(input: string, algorithm: HashAlgorithm): Promise<string> {
  const digest = await crypto.subtle.digest(algorithm, new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const MAX_REGEX_MATCHES = 200;

export function testRegex(pattern: string, flags: string, input: string): ToolResult {
  if (!pattern) return success("");
  let expression: RegExp;
  try {
    const unique = [...new Set(`${flags}g`)].join("");
    expression = new RegExp(pattern, unique);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "That pattern isn't valid.");
  }
  const lines: string[] = [];
  for (const match of input.matchAll(expression)) {
    if (lines.length >= MAX_REGEX_MATCHES) {
      lines.push(`Showing the first ${MAX_REGEX_MATCHES} matches.`);
      break;
    }
    const groups = match.slice(1);
    const detail = groups.length ? `  groups: ${JSON.stringify(groups)}` : "";
    lines.push(`${match.index}: ${JSON.stringify(match[0])}${detail}`);
    if (match[0] === "") expression.lastIndex += 1;
  }
  return success(lines.length ? lines.join("\n") : "No matches.");
}
