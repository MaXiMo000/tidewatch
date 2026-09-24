/**
 * Island labels, hover/tap picking and the stats card - identical on every tier.
 *
 * Every island gets a label <button> positioned over it each frame (CSSOM transform only; no
 * style attributes, no HTML strings). Labels are keyboard-focusable, so islands can be inspected
 * without a pointer. Picking is done in SCREEN space (nearest projected island within a radius),
 * which needs no raycast against meshes and behaves the same on Cinematic, Balanced and Simple.
 * The card shows status (as a word, never colour alone), requests/s, p95 and error rate, and
 * refreshes only when the displayed text changes.
 */
import * as THREE from "three";
import type { IslandState, WorldModel } from "../scene/model";
import { isletScale, SILHOUETTE_TOP, silhouetteFor } from "../scene/silhouette";
import { formatMs, formatPct, formatRps, prettyName, STATUS_WORD, subtitleFor } from "./copy";

const PICK_RADIUS_PX = 56;

interface Label {
  id: string;
  el: HTMLButtonElement;
  name: HTMLSpanElement;
  dot: HTMLSpanElement;
  shown: string;
  /** Anchor (label bottom-centre) and island body, in CSS px. */
  x: number;
  y: number;
  bodyX: number;
  bodyY: number;
  depth: number;
  top: number;
  width: number;
  visible: boolean;
  compact: boolean;
  onScreen: boolean;
}

const LABEL_H = 26;

export interface Inspection {
  id: string | null;
  state: IslandState | null;
}

function span(cls: string, text = ""): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = text;
  return s;
}

export class Inspector {
  private readonly labels = new Map<string, Label>();
  private builtVersion = -1;
  private hovered: string | null = null;
  private pinned: string | null = null;
  private readonly discovered = new Set<string>();
  private readonly v = new THREE.Vector3();
  private readonly cardFields: Record<"title" | "kind" | "status" | "rps" | "p95" | "err", HTMLElement>;
  private cardKey = "";
  private pointer: { x: number; y: number } | null = null;
  private pendingClick = false;
  labelsVisible = true;

  constructor(
    private readonly layer: HTMLElement,
    private readonly card: HTMLElement,
    private readonly onDiscover: (state: IslandState) => void,
  ) {
    const field = (cls: string): HTMLElement => {
      const node = card.querySelector<HTMLElement>(cls);
      if (!node) throw new Error(`card field missing: ${cls}`);
      return node;
    };
    this.cardFields = {
      title: field(".card-title"),
      kind: field(".card-kind"),
      status: field(".card-status"),
      rps: field(".card-rps"),
      p95: field(".card-p95"),
      err: field(".card-err"),
    };
  }

  /** The island being inspected (pinned beats hovered). */
  get current(): string | null {
    return this.pinned ?? this.hovered;
  }

  setPointer(x: number | null, y = 0): void {
    this.pointer = x === null ? null : { x, y };
  }

  /**
   * Tap/click on the canvas: pin the island under the pointer, or clear if nothing is there.
   * Resolved in the next update(), after picking - on touch the click can arrive before a frame
   * has computed what is under the finger.
   */
  click(): void {
    this.pendingClick = true;
  }

  clear(): void {
    this.pinned = null;
    this.hovered = null;
  }

  update(model: WorldModel, camera: THREE.Camera, width: number, height: number): Inspection {
    if (model.topologyVersion !== this.builtVersion) this.rebuild(model);

    // Project every island: the label anchor just above the structure's real top, and the body.
    let best: string | null = null;
    let bestD = PICK_RADIUS_PX;
    const order: Label[] = [];
    for (const [id, label] of this.labels) {
      const s = model.islands.get(id);
      if (!s) continue;
      const k = isletScale(s.scale);
      this.v.set(s.place.x, label.top * k + 0.35, s.place.z).project(camera);
      label.onScreen = this.v.z < 1 && Math.abs(this.v.x) < 1.05 && Math.abs(this.v.y) < 1.05;
      label.depth = this.v.z;
      label.x = (this.v.x * 0.5 + 0.5) * width;
      label.y = (0.5 - this.v.y * 0.5) * height;
      this.v.set(s.place.x, 0.9 * k, s.place.z).project(camera);
      label.bodyX = (this.v.x * 0.5 + 0.5) * width;
      label.bodyY = (0.5 - this.v.y * 0.5) * height;
      if (label.onScreen) order.push(label);
      if (label.onScreen && this.pointer) {
        const d = Math.hypot(this.pointer.x - label.bodyX, this.pointer.y - label.bodyY);
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
      const statusText = `${s.status}`;
      if (label.shown !== statusText) {
        label.shown = statusText;
        label.dot.dataset["status"] = s.status;
        label.el.setAttribute(
          "aria-label",
          `${prettyName(id)}, ${STATUS_WORD[s.status]}. Show details.`,
        );
      }
      label.el.classList.toggle("is-active", id === this.current);
    }
    this.layout(order);
    if (this.pointer) this.hovered = best;
    if (this.pendingClick) {
      this.pendingClick = false;
      this.pinned = best && this.pinned !== best ? best : null;
    }
    if (this.pinned && !model.islands.has(this.pinned)) this.pinned = null;

    const id = this.current;
    const state = id ? model.islands.get(id) ?? null : null;
    if (state && !this.discovered.has(state.id)) {
      this.discovered.add(state.id);
      this.onDiscover(state);
    }
    this.renderCard(state, width, height);
    return { id, state };
  }

  /**
   * Nearest labels claim space first; an overlapping label is nudged up to two rows, and if it
   * still collides it collapses to its status dot (still focusable and hoverable).
   */
  private layout(order: Label[]): void {
    order.sort((a, b) => a.depth - b.depth);
    const placed: { l: number; r: number; t: number; b: number }[] = [];
    const hits = (l: number, r: number, t: number, b: number): boolean =>
      placed.some((p) => l < p.r && r > p.l && t < p.b && b > p.t);
    for (const label of this.labels.values()) {
      if (!label.onScreen || !this.labelsVisible) {
        if (label.visible) {
          label.visible = false;
          label.el.hidden = true;
        }
      }
    }
    if (!this.labelsVisible) return;
    for (const label of order) {
      if (!label.visible) {
        label.visible = true;
        label.el.hidden = false;
      }
      if (label.width === 0) label.width = label.el.offsetWidth || 90;
      let y = label.y;
      let compact = true;
      for (let step = 0; step < 3; step++) {
        const cy = label.y - step * LABEL_H;
        const half = label.width / 2 + 3;
        if (!hits(label.x - half, label.x + half, cy - LABEL_H, cy)) {
          y = cy;
          compact = false;
          break;
        }
      }
      const w = compact ? 16 : label.width;
      placed.push({ l: label.x - w / 2 - 3, r: label.x + w / 2 + 3, t: y - (compact ? 16 : LABEL_H), b: y });
      if (compact !== label.compact) {
        label.compact = compact;
        label.el.classList.toggle("is-compact", compact);
      }
      label.el.style.transform = `translate(${label.x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }

  private renderCard(state: IslandState | null, width: number, height: number): void {
    if (!state) {
      if (!this.card.hidden) this.card.hidden = true;
      this.cardKey = "";
      return;
    }
    const f = this.cardFields;
    const key = `${state.id}|${state.status}|${Math.round(state.rps)}|${Math.round(state.p95)}|${state.errorRate.toFixed(4)}`;
    if (key !== this.cardKey) {
      this.cardKey = key;
      f.title.textContent = prettyName(state.id);
      f.kind.textContent = state.kind;
      f.status.textContent = STATUS_WORD[state.status];
      f.status.dataset["status"] = state.status;
      f.rps.textContent = formatRps(state.rps);
      f.p95.textContent = formatMs(state.p95);
      f.err.textContent = formatPct(state.errorRate);
    }
    this.card.hidden = false;
    const label = this.labels.get(state.id);
    if (!label || width < 640) {
      this.card.style.transform = ""; // docked by CSS on narrow screens
      return;
    }
    // Anchor to the right of the label; flip left near the edge.
    const w = this.card.offsetWidth || 220;
    const h = this.card.offsetHeight || 150;
    let x = label.x + 22;
    if (x + w > width - 16) x = label.x - w - 22;
    const y = Math.min(Math.max(label.y - 12, 72), height - h - 120);
    this.card.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
  }

  private rebuild(model: WorldModel): void {
    this.builtVersion = model.topologyVersion;
    for (const l of this.labels.values()) l.el.remove();
    this.labels.clear();
    for (const s of model.islands.values()) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "island-label";
      const dot = span("status-dot");
      const name = span("island-name", prettyName(s.id));
      el.append(dot, name);
      el.title = subtitleFor(s.id, s.kind);
      el.addEventListener("click", () => {
        this.pinned = this.pinned === s.id ? null : s.id;
      });
      el.addEventListener("focus", () => {
        this.hovered = s.id;
      });
      el.addEventListener("blur", () => {
        if (this.hovered === s.id) this.hovered = null;
      });
      el.hidden = true;
      this.layer.append(el);
      this.labels.set(s.id, {
        id: s.id,
        el,
        name,
        dot,
        shown: "",
        x: 0,
        y: 0,
        bodyX: 0,
        bodyY: 0,
        depth: 0,
        top: SILHOUETTE_TOP[silhouetteFor(s)],
        width: 0,
        visible: false,
        compact: false,
        onScreen: false,
      });
    }
  }
}
