/**
 * Words for the HUD. Kept apart from logic so the voice is consistent and easy to edit.
 * Service subtitles follow the silhouette each kind has in the world (see cinematic/islands.ts).
 */
import type { Kind, Status } from "../scene/model";

export const STATUS_WORD: Record<Status, string> = {
  ok: "healthy",
  degraded: "degraded",
  failing: "failing",
};

const KIND_SUBTITLE: Record<Kind, string> = {
  gateway: "The lighthouse at the mouth of the swamp. Every request passes here.",
  service: "A stilt hall over the water, where the work gets done.",
  cache: "The beacon. Quick answers, close at hand.",
  database: "The vault. Deep, layered, slow to move.",
  queue: "The jetty, crates waiting their turn.",
  worker: "The workshop. Smoke means something is cooking.",
};

export function subtitleFor(id: string, kind: Kind): string {
  if (kind === "service" && /auth|login|identity|iam|sso/.test(id)) {
    return "The watchtower. Checks who you are before you pass.";
  }
  return KIND_SUBTITLE[kind];
}

export function prettyName(id: string): string {
  return id
    .split("-")
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0]?.toUpperCase() + w.slice(1)))
    .join(" ");
}

export function formatRps(rps: number): string {
  return rps >= 1000 ? `${(rps / 1000).toFixed(1)}k req/s` : `${Math.round(rps)} req/s`;
}

export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

export function formatPct(rate: number): string {
  return `${(rate * 100).toFixed(rate < 0.01 ? 2 : 1)}%`;
}
