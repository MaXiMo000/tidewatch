/**
 * HTML/CSS HUD over the canvas (all tiers): title, live status + compass strip, health summary,
 * quality menu, place panel (bottom-left), key hints, legend, caption, toasts.
 *
 * All text goes through textContent; the DOM skeleton lives in index.html (no HTML strings).
 * Writes happen only when a value changes, so the per-frame cost is a few comparisons plus one
 * CSSOM transform for the compass strip.
 */
import type { ConnState } from "../net/client";
import { TIER_LABEL, type Tier } from "../quality/tiers";
import type { IslandState } from "../scene/model";
import { formatMs, formatPct, formatRps, prettyName, STATUS_WORD, subtitleFor } from "./copy";

export type TierChoice = Tier | "auto";

const CHOICES: readonly TierChoice[] = ["auto", "high", "medium", "low"];
const PX_PER_DEG = 3;

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
  private readonly strip = el<HTMLElement>("#hud-compass-strip");
  private readonly heading = el<HTMLElement>("#hud-heading");
  private readonly tierButton = el<HTMLButtonElement>("#hud-tier");
  private readonly tierMenu = el<HTMLElement>("#hud-tier-menu");
  private readonly notice = el<HTMLElement>("#hud-notice");
  private readonly toast = el<HTMLElement>("#hud-toast");
  private readonly place = {
    eyebrow: el<HTMLElement>("#place-eyebrow"),
    title: el<HTMLElement>("#place-title"),
    subtitle: el<HTMLElement>("#place-subtitle"),
    stats: el<HTMLElement>("#place-stats"),
  };
  private readonly legendButton = el<HTMLButtonElement>("#hud-legend-toggle");
  private readonly legend = el<HTMLElement>("#hud-legend");
  private noticeTimer: number | null = null;
  private toastTimer: number | null = null;
  private placeKey = "";
  private last = { status: "", summary: "", heading: -1, tier: "", choice: "" as TierChoice | "" };

  constructor(
    private readonly onChoice: (choice: TierChoice) => void,
    private readonly getChoice: () => TierChoice,
  ) {
    this.buildCompass();
    this.buildMenu();
    this.legendButton.addEventListener("click", () => this.toggleLegend());
  }

  toggleLegend(open = this.legend.hidden): void {
    this.legend.hidden = !open;
    this.legendButton.setAttribute("aria-expanded", String(open));
  }

  /** Q key: step to the next quality choice (same order as the menu). */
  cycleQuality(): void {
    const i = CHOICES.indexOf(this.getChoice());
    this.onChoice(CHOICES[(i + 1) % CHOICES.length] ?? "auto");
  }

  private buildCompass(): void {
    // Two turns of ticks so the strip can scroll continuously; labels every 45 degrees.
    const names: Record<number, string> = {
      0: "N",
      45: "NE",
      90: "E",
      135: "SE",
      180: "S",
      225: "SW",
      270: "W",
      315: "NW",
    };
    for (let d = -180; d <= 540; d += 15) {
      const t = document.createElement("span");
      const name = names[((d % 360) + 360) % 360];
      t.className = name ? "tick tick-major" : "tick";
      if (name) t.textContent = name;
      this.strip.append(t);
    }
  }

  private buildMenu(): void {
    const describe: Record<TierChoice, string> = {
      auto: "Chosen for this device, adjusted while you watch",
      high: "Reflections, volumetric mist, storms. Uses more battery and GPU",
      medium: "Stylised and smooth on most laptops",
      low: "Lightest, for older phones and battery saving",
    };
    for (const choice of CHOICES) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "menu-item";
      item.setAttribute("role", "menuitemradio");
      item.dataset["choice"] = choice;
      const name = document.createElement("span");
      name.className = "menu-name";
      name.textContent = choice === "auto" ? "Auto" : TIER_LABEL[choice];
      const note = document.createElement("span");
      note.className = "menu-note";
      note.textContent = describe[choice];
      item.append(name, note);
      item.addEventListener("click", () => {
        this.onChoice(choice);
        this.closeMenu(true);
      });
      this.tierMenu.append(item);
    }
    this.tierButton.addEventListener("click", () => {
      if (this.tierMenu.hidden) this.openMenu();
      else this.closeMenu(true);
    });
    this.tierMenu.addEventListener("keydown", (e) => {
      const items = [...this.tierMenu.querySelectorAll<HTMLButtonElement>(".menu-item")];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.closeMenu(true);
      }
    });
    document.addEventListener("pointerdown", (e) => {
      const t = e.target as Node;
      if (!this.tierMenu.hidden && !this.tierMenu.contains(t) && !this.tierButton.contains(t)) {
        this.closeMenu(false);
      }
    });
  }

  private openMenu(): void {
    this.tierMenu.hidden = false;
    this.tierButton.setAttribute("aria-expanded", "true");
    this.tierMenu.querySelector<HTMLButtonElement>(`[data-choice="${this.getChoice()}"]`)?.focus();
  }

  private closeMenu(returnFocus: boolean): void {
    this.tierMenu.hidden = true;
    this.tierButton.setAttribute("aria-expanded", "false");
    if (returnFocus) this.tierButton.focus();
  }

  get menuOpen(): boolean {
    return !this.tierMenu.hidden;
  }

  update(s: HudState): void {
    const status = s.seq === null ? s.conn : `${s.conn} · seq ${s.seq}`;
    if (status !== this.last.status) {
      this.status.textContent = status;
      this.status.dataset["conn"] = s.conn;
      this.last.status = status;
    }

    const summary = s.counts
      ? `${s.counts.ok} ok · ${s.counts.degraded} degraded · ${s.counts.failing} failing`
      : "";
    if (summary !== this.last.summary) {
      this.summary.textContent = summary;
      const c = s.counts;
      this.summary.dataset["alert"] = c && c.failing > 0 ? "failing" : c && c.degraded > 0 ? "degraded" : "ok";
      this.last.summary = summary;
    }

    const heading = Math.round(s.heading);
    if (heading !== this.last.heading) {
      // The strip starts at -180 degrees; centre the current heading under the needle.
      this.strip.style.transform = `translateX(${(-(heading + 180) * PX_PER_DEG).toFixed(0)}px)`;
      this.heading.textContent = `${String(heading).padStart(3, "0")}°`;
      this.last.heading = heading;
    }

    const label = TIER_LABEL[s.tier];
    const tier = s.choice === "auto" ? `${label} (auto)` : label;
    if (tier !== this.last.tier) {
      this.tierButton.textContent = tier;
      this.tierButton.setAttribute(
        "aria-label",
        `Rendering quality ${label}${s.choice === "auto" ? ", chosen automatically" : ""}. Change quality.`,
      );
      this.last.tier = tier;
    }
    if (s.choice !== this.last.choice) {
      for (const item of this.tierMenu.querySelectorAll<HTMLButtonElement>(".menu-item")) {
        item.setAttribute("aria-checked", String(item.dataset["choice"] === s.choice));
      }
      this.last.choice = s.choice;
    }
  }

  /** Bottom-left panel: the inspected island, or the archipelago overview. */
  setPlace(state: IslandState | null): void {
    const key = state
      ? `${state.id}|${state.status}|${Math.round(state.rps)}|${Math.round(state.p95)}|${state.errorRate.toFixed(3)}`
      : "none";
    if (key === this.placeKey) return;
    this.placeKey = key;
    const p = this.place;
    if (!state) {
      p.eyebrow.textContent = "Exploring the archipelago";
      p.title.textContent = "Tidewatch";
      p.subtitle.textContent = "Every island a service. Hover or tap one to look closer.";
      p.stats.textContent = "";
      return;
    }
    p.eyebrow.textContent = `${state.kind} · ${STATUS_WORD[state.status]}`;
    p.title.textContent = prettyName(state.id);
    p.subtitle.textContent = subtitleFor(state.id, state.kind);
    p.stats.textContent = `${formatRps(state.rps)} · p95 ${formatMs(state.p95)} · ${formatPct(state.errorRate)} errors`;
  }

  /** "Discovered - <place>": once per island per visit. */
  showToast(title: string): void {
    this.toast.textContent = `Discovered · ${title}`;
    this.toast.dataset["show"] = "1";
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast.dataset["show"] = "0";
      this.toastTimer = null;
    }, 2600);
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
