/**
 * Browser E2E smoke tests (docs/ARCHITECTURE.md s.8). They run against a RUNNING stack, normally
 * the production-shaped compose stack over HTTPS (CI `compose` job):
 *
 *   E2E_BASE_URL=https://localhost E2E_CHANNEL=chrome npx playwright test
 *
 * Uses a browser that is already installed (`channel`: chrome on GitHub runners, msedge/chrome
 * locally), so `playwright install` never downloads browser binaries.
 */
import { defineConfig } from "@playwright/test";

declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 45_000,
  retries: 0,
  // One page at a time: all pages share one client IP, and the backend caps WebSockets per IP.
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env["E2E_BASE_URL"] ?? "https://localhost",
    channel: process.env["E2E_CHANNEL"] ?? "chrome",
    headless: true,
    // The local stack uses Caddy's internal CA; certificate checks are covered by smoke_compose.py.
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      // Headless CI machines have no GPU: allow the software WebGL fallback explicitly.
      args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
    },
  },
});
