/**
 * Live mode's event feed and screen-reader status line, from snapshots only.
 *
 * `diffStatuses` (pure, unit-tested) turns two consecutive snapshots into events ("DB is failing",
 * "API recovered"); `EventFeed` keeps the last few and renders them into #event-feed with
 * textContent only; `statusSentence` is the one-line summary for screen readers (#sr-status).
 * The first snapshot is a baseline, not a burst of events; topology changes are one event.
 */
import { formatMs, formatPct, prettyName, STATUS_WORD } from "../hud/copy";
import type { ServiceMetrics, Snapshot } from "../net/protocol";

export type Severity = "good" | "warn" | "bad" | "info";

export interface FeedEvent {
  readonly at: number;
  readonly id: string;
  readonly text: string;
  readonly severity: Severity;
}

const RANK: Record<ServiceMetrics["status"], number> = { ok: 0, degraded: 1, failing: 2, offline: 3 };

function describe(s: ServiceMetrics): string {
  if (s.status === "failing") return `${formatPct(s.error_rate)} errors, p95 ${formatMs(s.p95_ms)}`;
  if (s.status === "degraded") return `p95 ${formatMs(s.p95_ms)}, ${formatPct(s.error_rate)} errors`;
  return "";
}

/** Events between two snapshots (prev null: baseline, no events). Deterministic order: by id. */
export function diffStatuses(prev: Snapshot | null, next: Snapshot, at: number): FeedEvent[] {
  if (!prev) return [];
  const before = new Map(prev.services.map((s) => [s.id, s.status]));
  const now = new Set(next.services.map((s) => s.id));
  const events: FeedEvent[] = [];
  const added = next.services.filter((s) => !before.has(s.id)).length;
  const removed = prev.services.filter((s) => !now.has(s.id)).length;
  if (added > 0 || removed > 0) {
    const parts = [added > 0 ? `${added} new` : "", removed > 0 ? `${removed} gone` : ""].filter(Boolean);
    events.push({ at, id: "*", text: `The map changed: ${parts.join(", ")}`, severity: "info" });
  }
  for (const s of [...next.services].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const was = before.get(s.id);
    if (was === undefined || was === s.status) continue;
    const name = prettyName(s.id);
    const detail = describe(s);
    let text: string;
    let severity: Severity;
    if (s.status === "ok") {
      text = was === "offline" ? `${name} is back online` : `${name} recovered`;
      severity = "good";
    } else if (s.status === "offline") {
      text = `${name} went offline`;
      severity = "info";
    } else {
      text = `${name} is ${STATUS_WORD[s.status]}${detail ? ` (${detail})` : ""}`;
      severity = RANK[s.status] > RANK[was] ? (s.status === "failing" ? "bad" : "warn") : "warn";
      if (RANK[s.status] < RANK[was]) text = `${name} improving: ${STATUS_WORD[s.status]}${detail ? ` (${detail})` : ""}`;
    }
    events.push({ at, id: s.id, text, severity });
  }
  return events;
}

/** One sentence for screen readers: counts plus the names of anything not healthy. */
export function statusSentence(snap: Snapshot | null): string {
  if (!snap || snap.services.length === 0) return "Waiting for data.";
  const by = (st: ServiceMetrics["status"]): string[] =>
    snap.services.filter((s) => s.status === st && s.kind !== "gateway").map((s) => prettyName(s.id));
  const total = snap.services.filter((s) => s.kind !== "gateway").length;
  const failing = by("failing");
  const degraded = by("degraded");
  const offline = by("offline");
  if (failing.length + degraded.length + offline.length === 0) return `All ${total} services healthy.`;
  const parts: string[] = [];
  if (failing.length) parts.push(`failing: ${failing.join(", ")}`);
  if (degraded.length) parts.push(`degraded: ${degraded.join(", ")}`);
  if (offline.length) parts.push(`offline: ${offline.join(", ")}`);
  return `${total} services; ${parts.join("; ")}.`;
}

const MAX_EVENTS = 6;

export class EventFeed {
  private events: FeedEvent[] = [];
  private prev: Snapshot | null = null;
  private lastSentence = "";

  constructor(
    private readonly list: HTMLElement,
    private readonly sr: HTMLElement,
  ) {}

  /** Call with each new snapshot (not per frame). */
  push(snap: Snapshot, at = Date.now()): void {
    if (this.prev && snap.seq === this.prev.seq) return;
    const fresh = diffStatuses(this.prev, snap, at);
    this.prev = snap;
    if (fresh.length > 0) {
      this.events = [...fresh.reverse(), ...this.events].slice(0, MAX_EVENTS);
      this.render();
    }
    // The spoken summary changes only when the situation does, so it never chatters at 1 Hz.
    const sentence = statusSentence(snap);
    if (sentence !== this.lastSentence) {
      this.lastSentence = sentence;
      this.sr.textContent = sentence;
    }
  }

  private render(): void {
    const items = this.events.map((e) => {
      const li = document.createElement("li");
      li.dataset["severity"] = e.severity;
      const time = document.createElement("time");
      const d = new Date(e.at);
      time.dateTime = d.toISOString();
      time.textContent = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const text = document.createElement("span");
      text.textContent = e.text;
      li.append(time, text);
      return li;
    });
    this.list.replaceChildren(...items);
  }
}
