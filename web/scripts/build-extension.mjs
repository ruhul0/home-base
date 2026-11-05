// Packages the exported start page as a Chrome extension. Run after `next build` and prepare-site.
//   dist/extension                  load this folder at chrome://extensions for testing
//   dist/home-base-extension.zip    upload this to the Chrome Web Store
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const repo = join(web, "..");
const out = join(web, "out");
const dist = join(repo, "dist");
const extension = join(dist, "extension");
const storeBuild = join(dist, "extension-store");
const zipFile = join(dist, "home-base-extension.zip");

// Chrome refuses extension folders whose names start with an underscore.
const ASSET_FOLDER = "assets";
const TEXT_FILE = /\.(html|js|css|map|txt|json)$/;

function allFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? allFiles(path) : [path];
  });
}

if (!existsSync(join(out, "newtab.html"))) {
  throw new Error("Run `npm run build` first.");
}

rmSync(dist, { recursive: true, force: true });

cpSync(join(out, "_next"), join(extension, ASSET_FOLDER), { recursive: true });
cpSync(join(out, "icons"), join(extension, "icons"), { recursive: true });
cpSync(join(out, "boot.js"), join(extension, "boot.js"));
cpSync(join(out, "newtab.html"), join(extension, "newtab.html"));

for (const file of allFiles(extension)) {
  if (!TEXT_FILE.test(file)) continue;
  const text = readFileSync(file, "utf8");
  const rewritten = text.replaceAll("_next/", `${ASSET_FOLDER}/`);
  if (rewritten !== text) writeFileSync(file, rewritten);
}

const manifest = JSON.parse(readFileSync(join(web, "extension", "manifest.json"), "utf8"));
writeFileSync(join(extension, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

// The Web Store assigns its own extension ID, so its copy leaves out the fixed development key.
cpSync(extension, storeBuild, { recursive: true });
delete manifest.key;
writeFileSync(join(storeBuild, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
execFileSync("zip", ["-qr", zipFile, "."], { cwd: storeBuild });
rmSync(storeBuild, { recursive: true });

console.log(`Built ${extension}`);
console.log(`Built ${zipFile}`);
