// Fails when the built JS exceeds the initial-JS budget in docs/PERFORMANCE.md (<= 350 KB gzip).
// Run after `npm run build`. Node built-ins only.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const BUDGET_KB = 350;
const dir = fileURLToPath(new URL("../dist/assets/", import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
if (files.length === 0) {
  console.error("no dist/assets/*.js - run `npm run build` first");
  process.exit(1);
}
let total = 0;
for (const f of files) {
  const kb = gzipSync(readFileSync(join(dir, f)), { level: 9 }).length / 1024;
  total += kb;
  console.log(`${f.padEnd(40)} ${kb.toFixed(1)} KB gzip`);
}
console.log(`total ${total.toFixed(1)} KB gzip (budget ${BUDGET_KB} KB)`);
if (total > BUDGET_KB) {
  console.error(`over budget by ${(total - BUDGET_KB).toFixed(1)} KB`);
  process.exit(1);
}
