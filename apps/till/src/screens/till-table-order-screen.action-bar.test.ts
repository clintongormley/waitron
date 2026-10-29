import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import { beer, menuOf, mount, resized, tap } from "./till-table-order-screen.test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

const dishes = Array.from({ length: 12 }, (_, n) => ({
  ...beer,
  id: `dish-${n}`,
  menuItemId: `offer-dish-${n}`,
  name: `Dish ${n}`,
}));

/** Mounts the screen in a scroll area shaped like the till shell's body, with every dish ordered. */
async function orderedInWindow(width: number, height: number) {
  const { el, host } = await mount({ products: dishes, menus: menuOf(dishes) });
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  host.style.overflowY = "auto";
  await resized(el);
  for (const dish of dishes) await tap(el, dish.name);
  return { el, host };
}

async function linesRendered(el: TillTableOrderScreen): Promise<void> {
  for (const basket of el.shadowRoot!.querySelectorAll<
    HTMLElement & { updateComplete: Promise<unknown> }
  >("till-basket"))
    await basket.updateComplete;
  await resized(el);
}

function expectInside(button: Element, host: HTMLElement): void {
  const box = button.getBoundingClientRect();
  const area = host.getBoundingClientRect();
  expect(box.height).toBeGreaterThan(0);
  expect(box.top).toBeGreaterThanOrEqual(area.top);
  expect(box.bottom).toBeLessThanOrEqual(area.bottom);
}

describe("till-table-order-screen: the unsent order's action bar stays in the window", () => {
  it("keeps Send all on screen without scrolling at 1024 × 768, with a long order beside the menu", async () => {
    const { el, host } = await orderedInWindow(1024, 768);
    await linesRendered(el);

    expect(host.scrollHeight).toBeGreaterThan(host.clientHeight);
    expect(host.scrollTop).toBe(0);
    expectInside(el.shadowRoot!.querySelector('[data-draft-action="send-all"]')!, host);
  });

  it("keeps Send all on screen without scrolling on the phone's Review view, with a long order", async () => {
    const { el, host } = await orderedInWindow(390, 700);
    el.shadowRoot!.querySelector<HTMLElement>("[data-review-open]")!.click();
    await el.updateComplete;
    await linesRendered(el);
    host.scrollTop = 0;

    expect(host.scrollHeight).toBeGreaterThan(host.clientHeight);
    expectInside(el.shadowRoot!.querySelector('[data-draft-action="send-all"]')!, host);
  });
});
