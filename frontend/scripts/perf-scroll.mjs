// Main-thread cost while scrolling the film (dev tool, not CI): docs/PERFORMANCE.md budget
// "main-thread work during scroll <= 8 ms per frame on Low". Scrolls the whole film with the wheel
// for a few seconds and reports main-thread task time per animation frame, from Chrome's own
// counters (script + style + layout + paint + everything else on the renderer main thread).
//   node scripts/perf-scroll.mjs [--base http://localhost:5173] [--tier low] [--throttle 4]
//                                [--executable /path/to/chrome] [--channel chrome] [--idle 1]
// --idle 1 measures the same seconds WITHOUT scrolling (moving the mouse instead, so the idle fps
// cap stays off): the difference is what the film itself costs.
import { chromium } from "@playwright/test";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, []),
);
const base = args.base ?? "http://localhost:5173";
const tier = args.tier ?? "low";
const throttle = Number(args.throttle ?? 4);
const browser = await chromium.launch({
  ...(args.executable ? { executablePath: args.executable } : { channel: args.channel ?? "chrome" }),
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${base}/?quality=${tier}`);
  await page.waitForSelector('html[data-ready="1"]', { timeout: 90_000 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  if (throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  const metric = async () => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
  };
  await page.evaluate(() => {
    window.__frames = 0;
    const count = () => {
      window.__frames += 1;
      requestAnimationFrame(count);
    };
    requestAnimationFrame(count);
  });
  const before = await metric();
  const f0 = await page.evaluate(() => window.__frames);
  const t0 = Date.now();
  await page.mouse.move(640, 360);
  let i = 0;
  while (Date.now() - t0 < 6000) {
    if (args.idle) await page.mouse.move(640 + (i++ % 2), 360);
    else await page.mouse.wheel(0, 120);
    await page.waitForTimeout(40);
  }
  const after = await metric();
  const frames = (await page.evaluate(() => window.__frames)) - f0;
  const ms = (k) => ((after[k] - before[k]) * 1000) / Math.max(1, frames);
  const chapter = await page.evaluate(() => document.documentElement.dataset.chapter);
  console.log(`${args.idle ? "IDLE" : "SCROLL"} tier ${tier}, CPU throttle ${throttle}x, ${frames} frames, reached ${chapter}`);
  console.log(`main-thread task ms/frame  ${ms("TaskDuration").toFixed(2)}  (budget 8)`);
  console.log(`  script ${ms("ScriptDuration").toFixed(2)}  style ${ms("RecalcStyleDuration").toFixed(2)}  layout ${ms("LayoutDuration").toFixed(2)}`);
} finally {
  await browser.close();
}
