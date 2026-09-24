/**
 * Which structure stands on each service's islet, shared by every tier and the HUD (labels sit
 * just above the structure's real top). Kind decides it; auth-like services are called out
 * because they share kind "service" with ordinary halls.
 */
import type { IslandState } from "./model";

export type Silhouette = "lighthouse" | "tower" | "hall" | "beacon" | "vault" | "jetty" | "workshop";

export function silhouetteFor(state: Pick<IslandState, "id" | "kind">): Silhouette {
  if (state.kind === "service" && /auth|login|identity|iam|sso/.test(state.id)) return "tower";
  switch (state.kind) {
    case "gateway":
      return "lighthouse";
    case "cache":
      return "beacon";
    case "database":
      return "vault";
    case "queue":
      return "jetty";
    case "worker":
      return "workshop";
    default:
      return "hall";
  }
}

/** Height of each structure's top in islet units (before the islet's traffic scale). */
export const SILHOUETTE_TOP: Readonly<Record<Silhouette, number>> = {
  lighthouse: 3.8,
  tower: 2.7,
  hall: 2.1,
  beacon: 2.4,
  vault: 1.9,
  jetty: 1.6,
  workshop: 2.1,
};

/** World scale the islets use for a given eased traffic scale (keep in sync with the islets). */
export function isletScale(trafficScale: number): number {
  return 0.95 + 0.4 * trafficScale;
}
