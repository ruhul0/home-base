import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const INLINE_SCRIPT = /<script((?:(?!\bsrc=)[^>])*)>([\s\S]*?)<\/script>/g;

export function htmlFiles(directory) {
  return readdirSync(directory, { recursive: true })
    .filter((file) => String(file).endsWith(".html"))
    .map((file) => join(directory, String(file)));
}

/**
 * Next.js puts many small scripts directly in its HTML. The site's security policy and Chrome
 * extensions both block inline scripts, so each page's scripts are joined, in order, into one file
 * named from its contents. It loads where the last inline script was, after the page content
 * those scripts can refer to, and one file means fewer requests that could slow or break a page.
 */
export function moveInlineScripts(root, publicFolder) {
  const outputFolder = join(root, publicFolder, "inline");
  mkdirSync(outputFolder, { recursive: true });

  let moved = 0;
  for (const file of htmlFiles(root)) {
    const html = readFileSync(file, "utf8");
    const bodies = [...html.matchAll(INLINE_SCRIPT)].map((match) => match[2]).filter((body) => body.trim());
    if (bodies.length === 0) continue;

    const joined = bodies.map((body) => (body.trimEnd().endsWith(";") ? body : `${body};`)).join("\n");
    const name = `${createHash("sha256").update(joined).digest("hex").slice(0, 24)}.js`;
    writeFileSync(join(outputFolder, name), joined);

    let remaining = bodies.length;
    const rewritten = html.replace(INLINE_SCRIPT, (_match, attributes, body) => {
      if (!body.trim()) return `<script${attributes}></script>`;
      remaining -= 1;
      return remaining === 0 ? `<script src="/${publicFolder}/inline/${name}"></script>` : "";
    });
    writeFileSync(file, rewritten);
    moved += bodies.length;
  }
  return moved;
}
