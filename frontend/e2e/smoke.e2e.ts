import { expect, test, type Page } from "@playwright/test";

/** Collects CSP violations and console errors from the moment the page starts loading. */
async function watch(page: Page): Promise<{ csp: string[]; errors: string[] }> {
  const found = { csp: [] as string[], errors: [] as string[] };
  await page.exposeFunction("__reportCsp", (v: string) => found.csp.push(v));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      const report = (window as unknown as { __reportCsp: (v: string) => void }).__reportCsp;
      report(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  page.on("console", (m) => {
    if (m.type() === "error") found.errors.push(m.text());
  });
  page.on("pageerror", (e) => found.errors.push(e.message));
  return found;
}

/**
 * Reads the WebGL canvas right after the app rendered and summarises its pixels. The app skips
 * frames under its fps cap (Low tier, idle), and a skipped frame leaves the cleared back buffer,
 * so sample several consecutive frames and keep the richest one.
 */
async function canvasStats(page: Page): Promise<{ distinct: number; meanLuma: number }> {
  return page.evaluate(
    () =>
      new Promise<{ distinct: number; meanLuma: number }>((resolve) => {
        const src = document.querySelector<HTMLCanvasElement>("#scene");
        const probe = document.createElement("canvas");
        probe.width = 160;
        probe.height = 90;
        const ctx = probe.getContext("2d", { willReadFrequently: true });
        if (!src || !ctx) return resolve({ distinct: 0, meanLuma: 0 });
        let best = { distinct: 0, meanLuma: 0 };
        let frames = 0;
        // The app's rAF callback is registered before this one, so this runs after its render.
        const sample = (): void => {
          ctx.clearRect(0, 0, probe.width, probe.height);
          ctx.drawImage(src, 0, 0, probe.width, probe.height);
          const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
          const colours = new Set<number>();
          let luma = 0;
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i] ?? 0;
            const g = data[i + 1] ?? 0;
            const b = data[i + 2] ?? 0;
            colours.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
            luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
          }
          if (colours.size > best.distinct) {
            best = { distinct: colours.size, meanLuma: luma / (data.length / 4) };
          }
          frames += 1;
          // Stop as soon as a real scene is seen (slow software GPUs), else try up to 10 frames.
          if (frames < 10 && best.distinct <= 40) requestAnimationFrame(sample);
          else resolve(best);
        };
        requestAnimationFrame(sample);
      }),
  );
}

async function seq(page: Page): Promise<number> {
  const text = (await page.locator("#hud-status").textContent()) ?? "";
  const m = /seq (\d+)/.exec(text);
  return m ? Number(m[1]) : -1;
}

test("loads with zero CSP violations and zero console errors, streams live data", async ({
  page,
}) => {
  const found = await watch(page);
  await page.goto("/");
  await expect(page.locator("#hud-status")).toHaveText(/^live · seq \d+$/, { timeout: 15_000 });
  const first = await seq(page);
  await expect.poll(() => seq(page), { timeout: 10_000 }).toBeGreaterThan(first);
  await expect(page.locator("#hud-summary")).toHaveText(/\d+ ok · \d+ degraded · \d+ failing/);
  expect(found.csp).toEqual([]);
  expect(found.errors).toEqual([]);
});

test("renders a real scene (not a blank or single-colour canvas)", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#hud-summary")).not.toBeEmpty({ timeout: 15_000 });
  const stats = await canvasStats(page);
  expect(stats.distinct).toBeGreaterThan(40);
  expect(stats.meanLuma).toBeGreaterThan(20);
});

const LABEL = { high: "Cinematic", medium: "Balanced", low: "Simple" } as const;
const CINEMATIC_CHUNK = /\/assets\/cinematic-[^/]+\.js$/;

for (const tier of ["high", "medium", "low"] as const) {
  test(`?quality=${tier} renders on that tier (${LABEL[tier]})`, async ({ page }) => {
    // Cinematic on CI's software GPU (SwiftShader) takes seconds per frame: same checks, more time.
    if (tier === "high") test.slow();
    const found = await watch(page);
    const chunkRequests: string[] = [];
    page.on("request", (r) => {
      if (CINEMATIC_CHUNK.test(new URL(r.url()).pathname)) chunkRequests.push(r.url());
    });
    await page.goto(`/?quality=${tier}`);
    await expect(page.locator("html")).toHaveAttribute("data-tier", tier);
    await expect(page.locator("#hud-tier")).toHaveText(LABEL[tier]);
    const path = tier === "high" ? "cinematic" : "stylised";
    // Software GPUs (CI's SwiftShader) need seconds per Cinematic frame: same check, longer wait.
    const wait = tier === "high" ? 100_000 : 30_000;
    await expect(page.locator("html")).toHaveAttribute("data-path", path, { timeout: wait });
    await expect(page.locator("html")).toHaveAttribute("data-ready", "1", { timeout: wait });
    expect((await canvasStats(page)).distinct).toBeGreaterThan(40);
    // Balanced and Simple must never download the Cinematic code.
    expect(chunkRequests.length > 0).toBe(tier === "high");
    expect(found.csp).toEqual([]);
    expect(found.errors).toEqual([]);
  });
}

test("quality menu is keyboard operable: open, arrow to each tier, select, close", async ({
  page,
}) => {
  await page.goto("/?quality=auto");
  const button = page.locator("#hud-tier");
  const menu = page.locator("#hud-tier-menu");
  await expect(button).toHaveText(/\(auto\)$/);
  await button.focus();
  let index = 0; // menu order: auto, high, medium, low
  for (const tier of ["high", "medium", "low"] as const) {
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    // The current choice has focus; step down to the next one.
    await page.keyboard.press("ArrowDown");
    index += 1;
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    await expect(page.locator("html")).toHaveAttribute("data-tier", tier);
    await expect(button).toBeFocused();
    await expect(button).toHaveAccessibleName(new RegExp(`Rendering quality ${LABEL[tier]}\\.`));
  }
  expect(index).toBe(3);
  // Cinematic warns about battery/GPU in the menu.
  await page.keyboard.press("Enter");
  await expect(menu.getByRole("menuitemradio", { name: /Cinematic/ })).toContainText(/battery/i);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
});

test("Q cycles quality from anywhere", async ({ page }) => {
  await page.goto("/?quality=auto");
  await expect(page.locator("#hud-tier")).toHaveText(/\(auto\)$/);
  await page.keyboard.press("q");
  await expect(page.locator("html")).toHaveAttribute("data-tier", "high");
  await page.keyboard.press("q");
  await expect(page.locator("html")).toHaveAttribute("data-tier", "medium");
});

test("every island is labelled and can be inspected by keyboard (card + discovered toast)", async ({
  page,
}) => {
  await page.goto("/?quality=medium");
  await expect(page.locator("html")).toHaveAttribute("data-ready", "1", { timeout: 30_000 });
  const labels = page.locator(".island-label");
  await expect(labels).toHaveCount(7);
  const gateway = labels.filter({ hasText: /gateway/i });
  await gateway.focus();
  const card = page.locator("#island-card");
  await expect(card).toBeVisible();
  await expect(card.locator(".card-title")).toHaveText(/gateway/i);
  // Status as a word (never colour alone) and the three numbers.
  await expect(card.locator(".card-status")).toHaveText(/healthy|degraded|failing/);
  await expect(card.locator(".card-rps")).toHaveText(/req\/s/);
  await expect(card.locator(".card-p95")).toHaveText(/ms|s$/);
  await expect(card.locator(".card-err")).toHaveText(/%$/);
  await expect(page.locator("#hud-toast")).toHaveText(/Discovered · Gateway/i);
  await expect(page.locator("#place-title")).toHaveText(/gateway/i);
  await page.keyboard.press("Escape");
  await gateway.blur();
  await expect(card).toBeHidden();
});

test("prefers-reduced-motion stops the camera orbit", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("#hud-summary")).not.toBeEmpty({ timeout: 15_000 });
  const heading = page.locator("#hud-heading");
  const before = await heading.textContent();
  await page.waitForTimeout(3_000);
  expect(await heading.textContent()).toBe(before);
});

test("without reduced motion the camera orbits", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(page.locator("#hud-summary")).not.toBeEmpty({ timeout: 15_000 });
  const heading = page.locator("#hud-heading");
  const before = await heading.textContent();
  await expect.poll(() => heading.textContent(), { timeout: 10_000 }).not.toBe(before);
});
