/**
 * The 2D view: the same live data as an accessible table, for devices without WebGL, for anyone
 * who prefers it (?view=2d, or the "2D view" button), and as the fallback when the 3D view cannot
 * start. Rows are built with createElement + textContent from validated snapshots only; the
 * table is updated at most once per snapshot. While it is shown, the 3D loop does not render.
 */
import { formatMs, formatPct, formatRps, prettyName, STATUS_WORD } from "../hud/copy";
import type { Snapshot } from "../net/protocol";

const KIND_WORD: Record<string, string> = {
  gateway: "gateway",
  service: "service",
  cache: "cache",
  database: "database",
  queue: "queue",
  worker: "worker",
};
const ORDER: Record<string, number> = { failing: 0, degraded: 1, offline: 2, ok: 3 };

export interface Row {
  readonly status: string;
  readonly cells: readonly string[];
}

/** Table rows for a snapshot: worst first, then by name. Pure (unit-tested). */
export function rowsFor(snap: Snapshot): Row[] {
  return [...snap.services]
    .sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || prettyName(a.id).localeCompare(prettyName(b.id)))
    .map((s) => ({
      status: s.status,
      cells: [
        prettyName(s.id),
        KIND_WORD[s.kind] ?? s.kind,
        STATUS_WORD[s.status],
        s.status === "offline" ? "–" : formatRps(s.rps),
        s.status === "offline" ? "–" : formatMs(s.p95_ms),
        s.status === "offline" ? "–" : formatPct(s.error_rate),
      ],
    }));
}

export class Fallback2d {
  private readonly root = document.documentElement;
  private lastSeq = -1;

  constructor(
    private readonly body: HTMLTableSectionElement,
    private readonly note: HTMLElement,
  ) {}

  get active(): boolean {
    return this.root.dataset["view"] === "2d";
  }

  show(on: boolean, reason = ""): void {
    this.root.dataset["view"] = on ? "2d" : "3d";
    this.note.textContent = reason;
    this.lastSeq = -1;
  }

  update(snap: Snapshot | null): void {
    if (!this.active || !snap || snap.seq === this.lastSeq) return;
    this.lastSeq = snap.seq;
    const rows = rowsFor(snap).map((row) => {
      const tr = document.createElement("tr");
      tr.dataset["status"] = row.status;
      row.cells.forEach((text, c) => {
        const cell = document.createElement(c === 0 ? "th" : "td");
        if (c === 0) (cell as HTMLTableCellElement).scope = "row";
        cell.textContent = text;
        tr.append(cell);
      });
      return tr;
    });
    this.body.replaceChildren(...rows);
  }
}

/**
 * "Below the minimum tier": the lightest 3D tier still under ~12 fps for 10 s. Then the app
 * SUGGESTS the 2D view once (never switches on its own - the visitor decides). Pure, tested.
 */
export class StruggleDetector {
  private since: number | null = null;
  private sum = 0;
  private frames = 0;
  private fired = false;

  constructor(
    private readonly windowMs = 10_000,
    private readonly minFps = 12,
  ) {}

  /** Feed each frame interval; returns true exactly once, when the suggestion should appear. */
  sample(intervalMs: number, now: number, lightestTier: boolean): boolean {
    if (this.fired) return false;
    if (!lightestTier || intervalMs > 1000) {
      // Not on the lightest tier yet (the governor may still step down), or a stall/hidden tab.
      this.since = null;
      return false;
    }
    if (this.since === null) {
      this.since = now;
      this.sum = 0;
      this.frames = 0;
    }
    this.sum += intervalMs;
    this.frames += 1;
    if (now - this.since < this.windowMs) return false;
    const fps = 1000 / (this.sum / this.frames);
    this.since = null;
    if (fps < this.minFps) {
      this.fired = true;
      return true;
    }
    return false;
  }
}
