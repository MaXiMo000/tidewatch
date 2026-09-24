import { defineConfig } from "vite";

// Dev server proxies API + WebSocket so the browser only ever talks to ONE origin
// (same as production behind Caddy). That means no CORS and no cross-origin cookies/tokens.
export default defineConfig({
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
    chunkSizeWarningLimit: 600,
  },
});
