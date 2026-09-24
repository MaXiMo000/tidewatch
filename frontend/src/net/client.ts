/**
 * Metrics client: ticket -> WebSocket -> first-message auth -> validated snapshots.
 * - Credentials never appear in URLs (ticket is sent as the first WS message).
 * - Every inbound frame is size-capped and schema-validated; invalid frames are dropped.
 * - Reconnects with exponential backoff + jitter.
 * - Same-origin only: relative URLs, no cookies (credentials: "omit").
 */
import { SnapshotSchema, TicketSchema, type Snapshot } from "./protocol";

export type ConnState = "connecting" | "live" | "reconnecting";

export interface ClientHandlers {
  onSnapshot: (snapshot: Snapshot) => void;
  onState: (state: ConnState) => void;
}

const MAX_FRAME_CHARS = 256 * 1024;

export class MetricsClient {
  private ws: WebSocket | null = null;
  private timer: number | null = null;
  private attempt = 0;
  private stopped = true;

  constructor(private readonly handlers: ClientHandlers) {}

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.ws?.close(1000);
    this.ws = null;
  }

  private async connect(): Promise<void> {
    this.timer = null;
    this.handlers.onState(this.attempt === 0 ? "connecting" : "reconnecting");
    try {
      const res = await fetch("/api/v1/ws-ticket", {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`ticket request failed (${res.status})`);
      const { ticket } = TicketSchema.parse(await res.json());

      const scheme = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${scheme}//${location.host}/ws/v1/stream`);
      this.ws = ws;

      ws.onopen = () => ws.send(JSON.stringify({ type: "auth", ticket }));
      ws.onmessage = (ev: MessageEvent<unknown>) => this.onMessage(ev.data);
      ws.onerror = () => ws.close();
      ws.onclose = () => this.scheduleReconnect();
    } catch {
      this.scheduleReconnect();
    }
  }

  private onMessage(data: unknown): void {
    if (typeof data !== "string" || data.length > MAX_FRAME_CHARS) return;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const parsed = SnapshotSchema.safeParse(json);
    if (!parsed.success) return;
    this.attempt = 0;
    this.handlers.onState("live");
    this.handlers.onSnapshot(parsed.data);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.timer !== null) return;
    this.handlers.onState("reconnecting");
    const ceiling = Math.min(30_000, 500 * 2 ** this.attempt);
    this.attempt += 1;
    const delay = ceiling / 2 + Math.random() * (ceiling / 2);
    this.timer = window.setTimeout(() => void this.connect(), delay);
  }
}
