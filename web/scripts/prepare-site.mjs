// Runs after `next build`, preparing the exported site to be served by the Go server.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { moveInlineScripts } from "./lib/inline-scripts.mjs";

const out = join(fileURLToPath(new URL("..", import.meta.url)), "out");
const moved = moveInlineScripts(out, "_next/static");
console.log(`Moved ${moved} inline scripts to files.`);
