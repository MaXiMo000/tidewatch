/**
 * Dev-only art-direction panel (`?tune=1` on the dev server). main.ts imports it behind
 * `import.meta.env.DEV`, so production bundles never contain it. Edits `params` live; "Copy values"
 * puts the current object on the clipboard so the chosen look can be committed as the defaults in
 * render/params.ts. Built with createElement/textContent only.
 */
import { params, type Params } from "../render/params";

type NumKey = { [K in keyof Params]: Params[K] extends number ? K : never }[keyof Params];

const RANGES: Partial<Record<NumKey, [number, number, number]>> = {
  exposure: [0.2, 3, 0.01],
  sunElevationDeg: [-4, 30, 0.1],
  sunAzimuthDeg: [0, 360, 1],
  cloudCover: [0, 1, 0.01],
  reflectionScale: [0.25, 1, 0.05],
  rippleStrength: [0, 0.6, 0.01],
  glint: [0, 3, 0.05],
  fogDensity: [0, 0.2, 0.001],
  fogHeight: [0.5, 12, 0.1],
  shafts: [0, 1, 0.01],
  foliageDensity: [0, 2, 0.05],
  bloom: [0, 2, 0.01],
};

const COLOURS: NumKey[] = [
  "skyZenith",
  "skyMid",
  "skyHorizon",
  "cloudLight",
  "cloudShadow",
  "waterDeep",
  "waterTint",
  "fogColor",
];

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}

export function mountTuningPanel(): void {
  const panel = document.createElement("form");
  panel.id = "tuning-panel";
  panel.addEventListener("submit", (e) => e.preventDefault());
  const title = document.createElement("strong");
  title.textContent = "art direction (dev)";
  panel.append(title);

  for (const key of Object.keys(RANGES) as NumKey[]) {
    const range = RANGES[key];
    if (!range) continue;
    const label = document.createElement("label");
    const name = document.createElement("span");
    name.textContent = key;
    const value = document.createElement("output");
    value.textContent = String(params[key]);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(range[0]);
    input.max = String(range[1]);
    input.step = String(range[2]);
    input.value = String(params[key]);
    input.addEventListener("input", () => {
      params[key] = Number(input.value);
      value.textContent = input.value;
    });
    label.append(name, value, input);
    panel.append(label);
  }

  for (const key of COLOURS) {
    const label = document.createElement("label");
    const name = document.createElement("span");
    name.textContent = key;
    const input = document.createElement("input");
    input.type = "color";
    input.value = hex(params[key]);
    input.addEventListener("input", () => {
      params[key] = Number.parseInt(input.value.slice(1), 16);
    });
    label.append(name, document.createElement("span"), input);
    panel.append(label);
  }

  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy values";
  copy.addEventListener("click", () => {
    const lines = Object.entries(params).map(([k, v]) =>
      COLOURS.includes(k as NumKey) ? `  ${k}: 0x${(v as number).toString(16).padStart(6, "0")},` : `  ${k}: ${v},`,
    );
    void navigator.clipboard.writeText(lines.join("\n"));
    copy.textContent = "Copied";
  });
  panel.append(copy);
  document.body.append(panel);
}
