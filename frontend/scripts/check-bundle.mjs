// Fails when INITIAL JS (what index.html loads, incl. modulepreloads) exceeds the budget in
// docs/PERFORMANCE.md (<= 350 KB gzip). Lazily imported chunks (e.g. the Cinematic path) are
// reported separately against their own budget. Run after `npm run build`. Node built-ins only.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const INITIAL_BUDGET_KB = 350;
const LAZY_BUDGET_KB = 600; // Cinematic code; its generated assets are procedural (no downloads)
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const html = readFileSync(join(dist, "index.html"), "utf8");
const initial = new Set([...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)].map((m) => m[1]));
const files = readdirSync(join(dist, "assets")).filter((f) => f.endsWith(".js"));
if (initial.size === 0 || files.length === 0) {
  console.error("no built JS found - run `npm run build` first");
  process.exit(1);
}
let initialKb = 0;
let lazyKb = 0;
for (const f of files) {
  const kb = gzipSync(readFileSync(join(dist, "assets", f)), { level: 9 }).length / 1024;
  const isInitial = initial.has(f);
  if (isInitial) initialKb += kb;
  else lazyKb += kb;
  console.log(`${(isInitial ? "initial" : "lazy").padEnd(8)} ${f.padEnd(36)} ${kb.toFixed(1)} KB gzip`);
}
console.log(`initial ${initialKb.toFixed(1)} KB gzip (budget ${INITIAL_BUDGET_KB} KB)`);
console.log(`lazy    ${lazyKb.toFixed(1)} KB gzip (budget ${LAZY_BUDGET_KB} KB)`);
let failed = false;
if (initialKb > INITIAL_BUDGET_KB) {
  console.error(`initial JS over budget by ${(initialKb - INITIAL_BUDGET_KB).toFixed(1)} KB`);
  failed = true;
}
if (lazyKb > LAZY_BUDGET_KB) {
  console.error(`lazy JS over budget by ${(lazyKb - LAZY_BUDGET_KB).toFixed(1)} KB`);
  failed = true;
}
process.exit(failed ? 1 : 0);
