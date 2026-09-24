// Per-tier performance probe (dev tool, not CI). Needs the dev server (the ?debug=1 overlay is
// dev-only). Prints fps, CPU ms/frame, draw calls, triangles and the GPU-memory estimate per tier.
//   node scripts/perf.mjs [--base http://localhost:5174] [--channel chrome] [--size 1440x900]
import { chromium } from "@playwright/test";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, []),
);
const base = args.base ?? "http://localhost:5174";
const [width, height] = (args.size ?? "1440x900").split("x").map(Number);
const browser = await chromium.launch({
  channel: args.channel ?? "chrome",
  headless: true,
  args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
try {
  const page = await browser.newPage({ viewport: { width, height } });
  for (const tier of ["high", "medium", "low"]) {
    await page.goto(`${base}/?quality=${tier}&debug=1`);
    await page.waitForSelector('html[data-ready="1"]', { timeout: 90_000 });
    // Keep the "user" active so the idle 30 fps cap does not kick in during the sample.
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(width / 2 + i * 7, height / 2);
      await page.waitForTimeout(700);
    }
    const overlay = await page.locator("#debug-overlay").textContent();
    console.log(`--- ${tier} @ ${width}x${height}\n${overlay}`);
  }
} finally {
  await browser.close();
}
