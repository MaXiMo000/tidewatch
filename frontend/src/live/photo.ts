/**
 * Photo mode: P hides every overlay so the scene can be framed (free-fly still works), Enter or
 * the Save button downloads the canvas as a PNG, P or Esc leaves. The capture happens inside the
 * render loop right after a frame is drawn (the drawing buffer is not preserved between frames),
 * via toBlob -> an object URL -> a temporary <a download>. Nothing leaves the browser.
 */

/** "tidewatch-2026-09-24-181530.png", local time. */
export function photoName(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `tidewatch-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
}

export class PhotoMode {
  private pending = false;
  private readonly root = document.documentElement;

  constructor(
    private readonly saveButton: HTMLButtonElement,
    private readonly exitButton: HTMLButtonElement,
    private readonly onSaved: (name: string) => void,
  ) {
    saveButton.addEventListener("click", () => this.request());
    exitButton.addEventListener("click", () => this.toggle(false));
  }

  get active(): boolean {
    return this.root.dataset["photo"] === "1";
  }

  toggle(on = !this.active): void {
    this.root.dataset["photo"] = on ? "1" : "0";
    if (on) this.saveButton.focus();
  }

  /** Ask for a capture on the next rendered frame. */
  request(): void {
    this.pending = true;
  }

  /** Call right after the frame has been drawn to the canvas. */
  capture(canvas: HTMLCanvasElement): void {
    if (!this.pending) return;
    this.pending = false;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = photoName(new Date());
      a.hidden = true;
      document.body.append(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      this.onSaved(a.download);
    }, "image/png");
  }
}
