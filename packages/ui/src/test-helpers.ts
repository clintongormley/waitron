import { afterEach, beforeEach, expect, vi } from "vitest";
import { commands, page } from "vitest/browser";
import { applyTokens } from "./tokens/index.js";
import type { WtDialog } from "./components/wt-dialog.js";
import type { WtFormActions } from "./components/wt-form-actions.js";

/** The wrapper element of the most recent mount. Live binding — reassigned by mount(). */
export let host: HTMLElement;

const mounted: HTMLElement[] = [];

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
 * Mounts inside a shadow root, the only place `composed: true` is observable: from light DOM an event
 * reaches `document` by bubbling alone. Listen outside the shadow root, e.g. on `document`.
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

/**
 * Holds that `table` (a `wt-data-table`) is unscrolled and shows each of its
 * `rows` row menus inside the box and the window with nothing painted over the menu's button.
 * `menu` is the CSS selector for the row menu element the table renders.
 * Unless `overflow` is false, also requires the table to be wider than its box.
 */
export function expectRowMenusOnScreen(
  table: Element,
  rows: number,
  menu = "wt-row-actions",
  overflow = true,
): void {
  const scroll = table.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
  if (overflow)
    expect(scroll.scrollWidth, "the table overflows its box").toBeGreaterThan(scroll.clientWidth);
  expect(scroll.scrollLeft).toBe(0);
  const box = scroll.getBoundingClientRect();
  const menus = [...table.shadowRoot!.querySelectorAll(menu)];
  expect(menus).toHaveLength(rows);
  for (const [index, found] of menus.entries()) {
    const button = found.shadowRoot!.querySelector("button")!;
    const at = button.getBoundingClientRect();
    expect(at.right, `row ${index}`).toBeLessThanOrEqual(box.right);
    expect(at.left, `row ${index}`).toBeGreaterThanOrEqual(box.left);
    expect(at.right, `row ${index} against the screen`).toBeLessThanOrEqual(window.innerWidth);
    const hit = found.shadowRoot!.elementFromPoint(at.x + at.width / 2, at.y + at.height / 2);
    expect(hit !== null && button.contains(hit), `row ${index} is covered`).toBe(true);
  }
}

/**
 * Mounts a filtered `wt-data-table` at 1280 and at 390 wide, checks its Filters button starts the
 * toolbar, before any search box, and opens Filters: beside the rows at 1280, over the whole screen
 * at 390. `teardown` removes what `mountTable` mounted.
 */
export async function expectFiltersFirst(
  mountTable: () => Promise<HTMLElement>,
  teardown: () => void,
): Promise<void> {
  const { page, userEvent } = await import("vitest/browser");
  const [width, height] = [window.innerWidth, window.innerHeight];
  try {
    for (const [w, h, side] of [
      [1280, 800, true],
      [390, 844, false],
    ] as const) {
      await page.viewport(w, h);
      expect(window.innerWidth, `${w}`).toBe(w);
      const table = await mountTable();
      const root = table.shadowRoot!;
      const trigger = root.querySelector<HTMLElement>(".filters-trigger")!;
      expect(root.querySelector(".table-toolbar")!.firstElementChild, `${w}`).toBe(trigger);
      const search = root.querySelector<HTMLElement>(".table-search");
      if (search && side)
        expect(trigger.getBoundingClientRect().right).toBeLessThanOrEqual(
          search.getBoundingClientRect().left,
        );
      await userEvent.click(trigger);
      const panel = root.querySelector<HTMLElement>(".filters-panel")!;
      await vi.waitFor(() =>
        expect([panel.hasAttribute("data-side"), panel.matches(":popover-open")], `${w}`).toEqual([
          side,
          !side,
        ]),
      );
      if (!side) expect(panel.hasAttribute("data-fullscreen")).toBe(true);
      teardown();
    }
  } finally {
    await page.viewport(width, height);
  }
}

/**
 * The one message shown for a form's action row: in the row itself, or — when the row sits in a
 * dialog's footer — on the footer's own line above the buttons, where the dialog shows it instead.
 */
export async function formMessageOf(actions: WtFormActions): Promise<Element | null> {
  await actions.updateComplete;
  const dialog = actions.slot === "footer" ? actions.parentElement : null;
  if (dialog?.localName === "wt-dialog" || dialog?.localName === "wt-modal") {
    await (dialog as WtDialog).updateComplete;
    return dialog.shadowRoot!.querySelector(".footer > [data-error]");
  }
  return actions.shadowRoot!.querySelector("[data-error]");
}

/** Sets `value` on a wt-combobox and sends the `wt-change` (bubbling, composed) a click on its row
 * sends. Unlike a click, it neither closes the list nor moves focus to the trigger. */
export async function chooseOption(el: Element, value: string): Promise<void> {
  const box = el as HTMLElement & { value: string; updateComplete?: Promise<unknown> };
  box.value = value;
  box.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await box.updateComplete;
}

/** Sets `values` on a multiple wt-combobox and sends the `wt-change` (bubbling, composed) a click on
 * one of its rows sends, carrying every value now ticked. Unlike clicks, it sends one event for the
 * whole list, where a person ticks one row per click and each click sends its own. */
export async function chooseOptions(el: Element, values: string[]): Promise<void> {
  const box = el as HTMLElement & { values: string[]; updateComplete?: Promise<unknown> };
  box.values = values;
  box.dispatchEvent(
    new CustomEvent("wt-change", { detail: { values }, bubbles: true, composed: true }),
  );
  await box.updateComplete;
}

/**
 * The line boxes of the first non-blank text node inside `element`. A Range over the element's whole
 * contents would also return the boxes of the elements inside it.
 */
export function textLines(element: Element): DOMRectList {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node && !node.textContent!.trim()) node = walker.nextNode();
  const range = document.createRange();
  range.selectNodeContents(node!);
  return range.getClientRects();
}

/**
 * Whether a box's vertical middle falls within `line`. Middles, not whole boxes: line boxes differ by
 * a pixel between machines' fonts.
 */
export function middleWithin(line: DOMRect): (box: DOMRect) => boolean {
  return (box) => {
    const at = (box.top + box.bottom) / 2;
    return at >= line.top && at <= line.bottom;
  };
}

/** Valid stored references for browser fixtures; labels remain readable at their call sites. */
export function mediaTestReference(label: string): string {
  const dot = label.lastIndexOf(".");
  const hex = [...new TextEncoder().encode(label.slice(0, dot))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.padEnd(64, "0")}.${label.slice(dot + 1)}`;
}

/** The rendition address `useMediaPresentations` answers for `source`'s `shape`. */
export function mediaTestRendition(source: string, shape: "square" | "till" | "display"): string {
  return `/media/renditions/v1/${source}/${shape}/7500-2500-200.webp`;
}

/** Supplies the public metadata boundary while keeping the real image directive mounted. */
export function useMediaPresentations() {
  const replacements = new Map<string, string>();
  beforeEach(() => {
    replacements.clear();
    const original = globalThis.fetch.bind(globalThis);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
      const url = new URL(String(input), location.origin);
      if (url.pathname !== "/media/presentations") return original(input, options);
      const images = Object.fromEntries(
        (url.searchParams.get("references") ?? "")
          .split(",")
          .filter(Boolean)
          .map((reference) => {
            const source = replacements.get(reference) ?? reference;
            return [
              reference,
              {
                id: reference,
                revision: replacements.has(reference) ? 2 : 1,
                source: `/media/${source}`,
                square: mediaTestRendition(source, "square"),
                till: mediaTestRendition(source, "till"),
                display: mediaTestRendition(source, "display"),
              },
            ];
          }),
      );
      return new Response(JSON.stringify({ images }), {
        headers: { "Content-Type": "application/json" },
      });
    });
  });
  afterEach(() => vi.restoreAllMocks());
  return replacements;
}

/**
 * Where the first line of text inside `element` sits on the page: the bottom of an empty inline
 * block placed in that line, which the browser sets on the line's baseline.
 */
export function textBaseline(element: Element): number {
  const probe = document.createElement("span");
  probe.style.cssText = "display: inline-block; width: 0; height: 0";
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node && !node.textContent!.trim()) node = walker.nextNode();
  node!.parentNode!.insertBefore(probe, node!.nextSibling);
  const bottom = probe.getBoundingClientRect().bottom;
  probe.remove();
  return bottom;
}

/**
 * Where the lockup's word sits on the page: the bottom of its "I", the one rectangle among the
 * word's letters. A letter's outline box would not do: the "W" and "N" points dip below the line.
 */
export function lockupWordBaseline(lockup: Element): number {
  const bar = lockup.shadowRoot!.querySelector<SVGRectElement>("svg > .ink > rect")!;
  const bottom = bar.y.baseVal.value + bar.height.baseVal.value;
  return new DOMPoint(0, bottom).matrixTransform(bar.getScreenCTM()!).y;
}

/**
 * A lockup file's inks in file order — the near-black pieces, then the sky and the teal of the W —
 * spelled as computed styles spell them, so a test can compare them with what the drawn lockup's
 * pieces compute to.
 */
export function lockupFileInks(svg: string): string[] {
  return [
    ...svg.matchAll(/class="(?:ink|sky|teal)" fill="#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})"/g),
  ].map(
    (m) =>
      `rgb(${m
        .slice(1, 4)
        .map((hex) => parseInt(hex, 16))
        .join(", ")})`,
  );
}

/** The native file control inside a `wt-file-input`. */
export function fileControl(picker: Element): HTMLInputElement {
  return picker.shadowRoot!.querySelector<HTMLInputElement>("input[type=file]")!;
}

/** Chooses `files` through the picker's own native control, so the primitive's real `change`
 * handler runs. With no files it sends the empty change the primitive also passes on for a drop
 * that carries no files. */
export function chooseFiles(picker: Element, ...files: File[]): void {
  const input = fileControl(picker);
  const selection = new DataTransfer();
  for (const file of files) selection.items.add(file);
  input.files = selection.files;
  input.dispatchEvent(new Event("change"));
}

/** The name of the file a `wt-file-input` draws as chosen, or null when it draws none. The native
 * control is emptied after every change, so the drawing is the only record a person sees. */
export function drawnFileName(picker: Element): string | null {
  return picker.shadowRoot!.querySelector(".selected strong")?.textContent ?? null;
}

/** The message a `wt-file-input` shows under itself, or null when there is none. */
export function fileError(picker: Element): HTMLElement | null {
  return picker.shadowRoot!.querySelector<HTMLElement>("[data-error]");
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
