import { expect } from "vitest";
import { applyTokens } from "./tokens/index.js";

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
 * Holds that `table` (a `wt-data-table`) is wider than its box, is unscrolled, and shows each of its
 * `rows` row menus inside the box and the window with nothing painted over the menu's button.
 * `menu` is the CSS selector for the row menu element the table renders.
 */
export function expectRowMenusOnScreen(
  table: Element,
  rows: number,
  menu = "wt-row-actions",
): void {
  const scroll = table.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
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
