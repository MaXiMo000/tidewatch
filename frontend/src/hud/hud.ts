/**
 * HTML/CSS HUD over the canvas: connection status, a text summary of service health (status is
 * never shown by colour alone), compass and the quality-tier control.
 *
 * All text goes through textContent. The DOM skeleton lives in index.html (no HTML built from
 * strings). Writes happen only when a value changes, so the per-frame cost is a few comparisons.
 */
import type { ConnState } from "../net/client";
import { TIER_LABEL, type Tier } from "../quality/tiers";

export type TierChoice = Tier | "auto";

const CHOICES: readonly TierChoice[] = ["auto", "high", "medium", "low"];

function el<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`HUD element missing: ${selector}`);
  return node;
}

export interface HudState {
  conn: ConnState;
  seq: number | null;
  counts: { ok: number; degraded: number; failing: number } | null;
  heading: number;
  tier: Tier;
  choice: TierChoice;
}

export class Hud {
  private readonly status = el<HTMLElement>("#hud-status");
  private readonly summary = el<HTMLElement>("#hud-summary");
  private readonly needle = el<HTMLElement>("#hud-compass-rose");
  private readonly heading = el<HTMLElement>("#hud-heading");
  private readonly tierButton = el<HTMLButtonElement>("#hud-tier");
  private readonly notice = el<HTMLElement>("#hud-notice");
  private noticeTimer: number | null = null;
  private last = { status: "", summary: "", heading: -1, tier: "" };

  constructor(onChoice: (choice: TierChoice) => void, getChoice: () => TierChoice) {
    this.tierButton.addEventListener("click", () => {
      const i = CHOICES.indexOf(getChoice());
      onChoice(CHOICES[(i + 1) % CHOICES.length] ?? "auto");
    });
  }

  update(s: HudState): void {
    const status = s.seq === null ? s.conn : `${s.conn} · seq ${s.seq}`;
    if (status !== this.last.status) {
      this.status.textContent = status;
      this.last.status = status;
    }

    const summary = s.counts
      ? `${s.counts.ok} ok · ${s.counts.degraded} degraded · ${s.counts.failing} failing`
      : "";
    if (summary !== this.last.summary) {
      this.summary.textContent = summary;
      this.last.summary = summary;
    }

    const heading = Math.round(s.heading);
    if (heading !== this.last.heading) {
      // CSSOM property write, not a style attribute: allowed under style-src 'self'.
      this.needle.style.transform = `rotate(${-heading}deg)`;
      this.heading.textContent = `${String(heading).padStart(3, "0")}°`;
      this.last.heading = heading;
    }

    const label = TIER_LABEL[s.tier];
    const tier = s.choice === "auto" ? `${label} (auto)` : label;
    if (tier !== this.last.tier) {
      this.tierButton.textContent = tier;
      this.tierButton.setAttribute(
        "aria-label",
        `Rendering quality ${label}${s.choice === "auto" ? ", chosen automatically" : ""}. ` +
          "Press to change.",
      );
      this.last.tier = tier;
    }
  }

  /** A short, non-blocking message (polite live region), cleared after a few seconds. */
  showNotice(message: string): void {
    this.notice.textContent = message;
    if (this.noticeTimer !== null) window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => {
      this.notice.textContent = "";
      this.noticeTimer = null;
    }, 6_000);
  }

  showFatal(message: string): void {
    this.status.textContent = message;
    this.last.status = message;
  }
}
