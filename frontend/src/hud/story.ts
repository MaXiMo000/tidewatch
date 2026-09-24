/**
 * The film's DOM side: reads scroll progress, marks the current chapter (html[data-chapter],
 * aria-current on the chapter rail, html[data-film] while the story is playing) and writes the
 * route's island names into the chapter text. textContent only; touches the DOM only on change.
 */
import { CHAPTERS, chapterIndex } from "../scene/story";

export class StoryUi {
  private readonly root = document.documentElement;
  private readonly links: HTMLAnchorElement[];
  private readonly first: HTMLElement[];
  private readonly list: HTMLElement[];
  private readonly last: HTMLElement[];
  private scrollRange = 1;
  private chapter = -1;
  private routeKey = "";

  constructor() {
    this.links = [...document.querySelectorAll<HTMLAnchorElement>("#chapter-nav a")];
    this.first = [...document.querySelectorAll<HTMLElement>(".route-first")];
    this.list = [...document.querySelectorAll<HTMLElement>(".route-list")];
    this.last = [...document.querySelectorAll<HTMLElement>(".route-last")];
    this.measure();
  }

  /**
   * Re-apply a chapter anchor from the URL (/#live, /#chapter-hops). The browser's own jump can
   * happen before the stylesheet gives the sections their height (always so in dev, where Vite
   * injects CSS from JS), leaving the page at the top; call once layout is final.
   */
  followHash(): void {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!/^(chapter-[a-z]+|live)$/.test(id)) return;
    document.getElementById(id)?.scrollIntoView({ behavior: "instant", block: "start" });
  }

  /** Call on resize (and once fonts settle): the scroll range is cached, not read per frame. */
  measure(): void {
    this.scrollRange = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  }

  /** Scroll progress 0..1 through the whole film. */
  progress(): number {
    return Math.min(1, Math.max(0, window.scrollY / this.scrollRange));
  }

  /** Update chapter markers for progress p (the unsmoothed scroll position). */
  setProgress(p: number): void {
    // Once the camera has fully handed over, the live card has said its piece: fade it out.
    const settled = p >= 0.96 ? "1" : "0";
    if (this.root.dataset["settled"] !== settled) this.root.dataset["settled"] = settled;
    const index = chapterIndex(p);
    if (index === this.chapter) return;
    this.chapter = index;
    const id = CHAPTERS[index]?.id ?? "live";
    this.root.dataset["chapter"] = id;
    this.root.dataset["film"] = id === "live" ? "0" : "1";
    for (const a of this.links) {
      if (a.hash === `#${id}`) a.setAttribute("aria-current", "step");
      else a.removeAttribute("aria-current");
    }
  }

  /** Name the route's islands in the text ("the gateway" -> "Gateway"). */
  setRoute(names: readonly string[]): void {
    const key = names.join(">");
    if (key === this.routeKey || names.length === 0) return;
    this.routeKey = key;
    const first = names[0] ?? "";
    const last = names[names.length - 1] ?? "";
    for (const el of this.first) el.textContent = first;
    for (const el of this.last) el.textContent = last;
    for (const el of this.list) el.textContent = names.join(" → ");
  }
}
