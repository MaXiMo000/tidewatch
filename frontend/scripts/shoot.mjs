// Art-direction screenshots (dev tool, not part of CI).
//   node scripts/shoot.mjs --round 1 [--base http://localhost:5174] [--channel chrome] [--tag a]
// Captures every forced tier at 1440x900 and 390x844 into docs/screenshots/round-N/ once the page
// reports data-ready="1" (the intended render path has drawn frames with live data).
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, []),
);
const round = args.round ?? "0";
const base = args.base ?? "http://localhost:5174";
const channel = args.channel ?? "chrome";
const tag = args.tag ? `-${args.tag}` : "";
const extra = args.query ? `&${args.query}` : "";
const tiers = (args.tiers ?? "high,medium,low").split(",");
const sizes = (args.sizes ?? "1440x900,390x844").split(",").map((s) => s.split("x").map(Number));

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "screenshots", `round-${round}`);
mkdirSync(out, { recursive: true });

// Real GPU where available (D3D11 via ANGLE on Windows); headless Chrome otherwise falls back.
const browser = await chromium.launch({
  channel,
  headless: true,
  args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"],
});
try {
  for (const [width, height] of sizes) {
    const mobile = width < 600;
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: mobile ? 2 : 1,
      isMobile: mobile,
      hasTouch: mobile,
    });
    for (const tier of tiers) {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
      await page.goto(`${base}/?quality=${tier}${extra}`);
      await page.waitForSelector('html[data-ready="1"]', { timeout: 90_000 });
      // --until "3 failing": wait (up to 2 min) for a health state in the HUD summary, e.g. to
      // capture the demo incident; --after N then lets the drama build for N ms.
      if (args.until) {
        const re = new RegExp(args.until);
        await page.waitForFunction(
          (src) => new RegExp(src).test(document.querySelector("#hud-summary")?.textContent ?? ""),
          re.source,
          { timeout: 120_000, polling: 500 },
        );
        await page.waitForTimeout(Number(args.after ?? 6000));
      }
      await page.waitForTimeout(Number(args.settle ?? 2500));
      const gpu = await page.evaluate(() => {
        const gl = document.createElement("canvas").getContext("webgl2");
        const ext = gl?.getExtension("WEBGL_debug_renderer_info");
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
      });
      const file = join(out, `${tier}-${width}x${height}${tag}.jpg`);
      await page.screenshot({ path: file, type: "jpeg", quality: 86 });
      console.log(`${file}  gpu=${gpu}${errors.length ? `  ERRORS: ${errors.join(" | ")}` : ""}`);
      await page.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
}
