import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { TillProduct } from "../api/client.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { mount as mountTableOrder } from "../screens/till-table-order-screen.test-helpers.js";
import "../screens/till-counter-screen.js";
import type { TillCounterScreen } from "../screens/till-counter-screen.js";
import {
  cleanupWidgets,
  measured,
  mountWidget,
  pageAt,
  resetPage,
  servedMenus,
} from "./test-helpers.js";
import type { TillMenuBrowser } from "./menu-browser.js";
import "./till-shell.js";
import type { TillShell } from "./till-shell.js";

afterEach(async () => {
  cleanupWidgets();
  await resetPage();
});

// Long enough that, at 390 × 700, the last section's tile sits far below the breadcrumb, and both
// cases fail when #revealTrail does not wait for the section's buttons.
const SECTIONS = 45;
const LAST_SECTION_DISHES = 60;
const LAST = `Section ${SECTIONS - 1}`;

const offers = Array.from({ length: SECTIONS }, (_, section) =>
  Array.from({ length: section === SECTIONS - 1 ? LAST_SECTION_DISHES : 1 }, (_, dish) => ({
    id: `mi-${section}-${dish}`,
    menuId: "lunch",
    productId: `p-${section}-${dish}`,
    section: `Section ${section}`,
  })),
).flat();
const products: TillProduct[] = offers.map((offer) => ({
  id: offer.productId,
  productId: offer.productId,
  menuItemId: offer.id,
  menuId: "lunch",
  available: true,
  name: `Dish ${offer.productId}`,
  unitPrice: "2.00",
  vatClass: "general",
  category: null,
  allergens: null,
}));
const menus = servedMenus(
  [{ id: "lunch", name: "Lunch", isDefault: true, versionId: "lunch-v1" }],
  offers,
);

function sectionTile(browser: TillMenuBrowser, name: string): HTMLElement {
  return [...browser.shadowRoot!.querySelectorAll<HTMLElement>("wt-button.tile")].find(
    (tile) => tile.querySelector(".name")?.textContent === name,
  )!;
}

/** Opens the last section from its tile, scrolled to the bottom of `scroller`'s view, and returns
 * the breadcrumb's box and the visible part of the scroller once everything has drawn. */
async function openLastSection(
  browser: TillMenuBrowser,
  scroller: Element,
): Promise<{ crumb: DOMRect; view: { top: number; bottom: number } }> {
  const tile = sectionTile(browser, LAST);
  tile.scrollIntoView({ block: "end" });
  expect(scroller.scrollTop).toBeGreaterThan(0);
  await userEvent.click(tile);
  await browser.updateComplete;
  await measured();
  const crumb = browser.shadowRoot!.querySelector("nav.breadcrumb")!.getBoundingClientRect();
  const box =
    scroller === document.scrollingElement
      ? { top: 0, bottom: innerHeight }
      : scroller.getBoundingClientRect();
  return { crumb, view: { top: Math.max(box.top, 0), bottom: Math.min(box.bottom, innerHeight) } };
}

async function atPhoneWidth(): Promise<void> {
  await pageAt(390, 700);
  expect(innerWidth).toBe(390);
}

it("on a phone, the counter screen shows the breadcrumb after opening a section from the bottom of a long menu", async () => {
  await atPhoneWidth();
  const { el } = await mountWidget<TillCounterScreen>("till-counter-screen", {
    store: new WorkingOrderStore(),
    menus,
    products,
  });
  const browser = el.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!;
  await browser.updateComplete;

  const { crumb, view } = await openLastSection(browser, document.scrollingElement!);

  expect(crumb.top).toBeGreaterThanOrEqual(view.top);
  expect(crumb.bottom).toBeLessThanOrEqual(view.bottom);
});

it("on a phone, a table's order screen in the shell's drill-in shows the breadcrumb after opening a section from the bottom of a long menu", async () => {
  await atPhoneWidth();
  const { el: screen } = await mountTableOrder({ menus, products });
  const { el: shell } = await mountWidget<TillShell>("till-shell", {
    activeScreen: "floor",
    formFactor: "phone-portrait",
  });
  screen.slot = "drill";
  shell.append(screen);
  await shell.updateComplete;
  await shell.updateComplete;
  const browser = screen.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!;
  await browser.updateComplete;
  const drill = shell.shadowRoot!.querySelector(".drill")!;

  const { crumb, view } = await openLastSection(browser, drill);

  expect(crumb.top).toBeGreaterThanOrEqual(view.top);
  expect(crumb.bottom).toBeLessThanOrEqual(view.bottom);
});
