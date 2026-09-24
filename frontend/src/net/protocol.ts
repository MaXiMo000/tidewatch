/**
 * Wire protocol. MUST mirror backend/app/schemas.py.
 * Everything arriving from the network is untrusted until it passes these schemas.
 * `.strict()` rejects unknown keys so a compromised/buggy server cannot smuggle extra data.
 */
import { z } from "zod";

const ServiceId = z.string().regex(/^[a-z0-9-]{1,32}$/);
const Rate = z.number().min(0).max(1_000_000);

export const ServiceSchema = z
  .object({
    id: ServiceId,
    kind: z.enum(["gateway", "service", "cache", "database", "queue", "worker"]),
    rps: Rate,
    p95_ms: z.number().min(0).max(600_000),
    error_rate: z.number().min(0).max(1),
    status: z.enum(["ok", "degraded", "failing", "offline"]),
  })
  .strict();

export const EdgeSchema = z.object({ src: ServiceId, dst: ServiceId, rps: Rate }).strict();

export const SnapshotSchema = z
  .object({
    v: z.literal(1),
    type: z.literal("snapshot"),
    seq: z.number().int().min(0),
    ts_ms: z.number().int().min(0),
    services: z.array(ServiceSchema).max(200),
    edges: z.array(EdgeSchema).max(1000),
  })
  .strict();

export const TicketSchema = z
  .object({ ticket: z.string().min(20).max(128), expires_in: z.number().int().positive() })
  .strict();

/** GET /api/v1/info: demo vs live, and the watched apps' display names (plain text). */
export const InfoSchema = z
  .object({
    mode: z.enum(["demo", "live"]),
    sources: z
      .array(
        z
          .object({ id: ServiceId, name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,31}$/) })
          .strict(),
      )
      .max(16),
  })
  .strict();

export type Snapshot = z.infer<typeof SnapshotSchema>;
export type Info = z.infer<typeof InfoSchema>;
export type ServiceMetrics = z.infer<typeof ServiceSchema>;
