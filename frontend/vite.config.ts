import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = join(here, "node_modules", "detect-gpu", "dist", "benchmarks");
const BENCH_FILE = /^[dm]-[a-z-]+\.json$/;

/**
 * Serves detect-gpu's benchmark data from OUR origin at /benchmarks/*.json (dev middleware and
 * emitted build assets). detect-gpu would otherwise fetch it from unpkg.com at runtime - a
 * third-party origin, forbidden by CLAUDE.md rule 5 and blocked by the CSP connect-src anyway.
 */
function selfHostedGpuBenchmarks(): Plugin {
  const files = readdirSync(BENCH_DIR).filter((f) => BENCH_FILE.test(f));
  return {
    name: "tidewatch:gpu-benchmarks",
    configureServer(server) {
      server.middlewares.use("/benchmarks/", (req, res, next) => {
        const name = (req.url ?? "").replace(/^\//, "").split("?")[0] ?? "";
        if (!files.includes(name)) return next();
        res.setHeader("Content-Type", "application/json");
        res.end(readFileSync(join(BENCH_DIR, name)));
      });
    },
    generateBundle() {
      for (const f of files) {
        this.emitFile({ type: "asset", fileName: `benchmarks/${f}`, source: readFileSync(join(BENCH_DIR, f)) });
      }
    },
  };
}

// Dev server proxies API + WebSocket so the browser only ever talks to ONE origin
// (same as production behind Caddy). That means no CORS and no cross-origin cookies/tokens.
export default defineConfig({
  plugins: [selfHostedGpuBenchmarks()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: false },
      "/ws": { target: "http://127.0.0.1:8000", ws: true, changeOrigin: false },
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    // The Cinematic chunk is loaded lazily and budgeted separately (docs/PERFORMANCE.md).
    chunkSizeWarningLimit: 700,
  },
});
