import { expect } from "vitest";
import { commands, page } from "vitest/browser";
import { applyTokens } from "./tokens/index.js";

/** The wrapper element of the most recent mount. Live binding — reassigned by mount(). */
export let host: HTMLElement;

const mounted: HTMLElement[] = [];

/**
 * Mounts `html` inside a fresh themed host and waits for the element to render.
 * Returns the first child — the component under test.
 */
export async function mount(html: string): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  applyTokens(host);
  mounted.push(host);
  host.innerHTML = html;
  const el = host.firstElementChild as HTMLElement & { updateComplete: Promise<unknown> };
  await el.updateComplete;
  return el;
}

/** Removes every host mounted since the last cleanup. Use as `afterEach(cleanup)`. */
export function cleanup(): void {
  for (const el of mounted.splice(0)) el.remove();
  // Reset the themed canvas that mountThemed() (a11y-helpers.ts) paints on <body>/<html>.
  document.body.style.background = "";
  document.documentElement.style.background = "";
}

/**
 * Mounts `html` inside a *nested* shadow root — a plain wrapper `<div>`'s own `attachShadow`,
 * not `document`'s light DOM. This is what makes `composed: true` on a custom event observable
 * at all: dispatched directly in light DOM (what `mount()` above gives you), an event only ever
 * needs to *bubble* to reach an ancestor listener — `composed` never comes into play, so a
 * mutant flipping `composed: true` to `false` survives even a listener on `document`. Only once
 * the dispatch point sits inside a shadow root does reaching an ancestor *outside* that shadow
 * root require crossing the boundary, which is exactly what `composed` governs.
 *
 * Returns the mounted element (inside the shadow root) — event listeners for a composed-event
 * assertion should be attached to `document` or another node outside `wrapper`'s shadow root,
 * not to `wrapper` itself.
 */
export async function mountInShadowRoot(html: string): Promise<HTMLElement> {
  const wrapper = document.createElement("div");
  document.body.appendChild(wrapper);
  mounted.push(wrapper);
  const shadow = wrapper.attachShadow({ mode: "open" });
  shadow.innerHTML = html;
  const el = shadow.firstElementChild as HTMLElement & { updateComplete: Promise<unknown> };
  await el.updateComplete;
  return el;
}

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateForcedColors: (forcedColors: "active" | "none" | null) => Promise<void>;
  }
}

/** Sets the forced-colours emulation (a Windows contrast theme) through Playwright, or hands it back
 * to the browser with `null`. It checks the setting took: the media query answers it, and when
 * active a red, blue-shadowed box loses both colours. */
export async function emulateForcedColours(value: "active" | "none" | null): Promise<void> {
  await commands.emulateForcedColors(value);
  if (value === null) return;
  expect(matchMedia("(forced-colors: active)").matches).toBe(value === "active");
  if (value === "none") return;
  const control = document.createElement("div");
  control.style.cssText =
    "width: 40px; height: 40px; background: rgb(255, 0, 0); box-shadow: inset 0 0 0 10px rgb(0, 0, 255)";
  document.body.appendChild(control);
  try {
    const at = await elementPixels(control);
    const box = control.getBoundingClientRect();
    expect(at(box.left + 20, box.top + 20)).not.toEqual([255, 0, 0]);
    expect(at(box.left + 2, box.top + 2)).not.toEqual([0, 0, 255]);
  } finally {
    control.remove();
  }
}

/** Reads an element's pixels from a real screenshot, as [r, g, b] at a point in page px. */
export async function elementPixels(el: Element): Promise<(x: number, y: number) => number[]> {
  const shot: unknown = await page.screenshot({ element: el, base64: true, save: false });
  const image = new Image();
  image.src = `data:image/png;base64,${shot as string}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0);
  const box = el.getBoundingClientRect();
  const k = image.width / box.width;
  return (x, y) => [
    ...context
      .getImageData(Math.floor((x - box.left) * k), Math.floor((y - box.top) * k), 1, 1)
      .data.slice(0, 3),
  ];
}
