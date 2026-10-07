import { expect, vi } from "vitest";
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
 * dialog's footer — at the end of that dialog's body, where the dialog shows it instead.
 */
export async function formMessageOf(actions: WtFormActions): Promise<Element | null> {
  await actions.updateComplete;
  const dialog = actions.slot === "footer" ? actions.parentElement : null;
  if (dialog?.localName === "wt-dialog" || dialog?.localName === "wt-modal") {
    await (dialog as WtDialog).updateComplete;
    return dialog.shadowRoot!.querySelector(".body > [data-error]");
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
 * one of its rows sends, carrying every value now ticked. */
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
