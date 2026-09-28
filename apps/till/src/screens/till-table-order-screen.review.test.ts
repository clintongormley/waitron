import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget, servedMenus } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./till-table-order-screen.js";
import {
  DRAFT_SIDE_BY_SIDE_MIN_WIDTH,
  type TillTableOrderScreen,
} from "./till-table-order-screen.js";
import { DraftStore } from "../state/draft-sync.js";
import type { OfferedModifier, TillProduct } from "../api/client.js";
import type { TillMenuBrowser } from "../widgets/menu-browser.js";

// Beer and Flan ring straight in; the Burger asks for its doneness and its extras first (Bacon
// comes preselected); Jamón is sold by weight.

const beer: TillProduct = {
  id: "beer",
  menuItemId: "offer-beer",
  catalogueId: "menu-table",
  name: "Beer",
  customerName: { es: "Cerveza de barril" },
  pricingUnit: "each",
  unitPrice: "3.00",
  vatClass: "general",
  category: null,
  allergens: null,
  courseId: null,
};

const flan: TillProduct = { ...beer, id: "flan", menuItemId: "offer-flan", name: "Flan" };

const cookedList: OfferedModifier = {
  kind: "options",
  id: "list-cooked",
  name: "Doneness",
  customerName: { es: "Punto carta" },
  kitchenName: "Punto KDS",
  defaultLabelId: "label-medium",
  labels: [
    {
      id: "label-rare",
      name: "Rare",
      customerName: { es: "Poco hecha carta" },
      kitchenName: "Poco hecha KDS",
      available: true,
    },
    {
      id: "label-medium",
      name: "Medium",
      customerName: { es: "Al punto carta" },
      kitchenName: "Al punto KDS",
      available: true,
    },
  ],
};

const extrasList: OfferedModifier = {
  kind: "extras",
  id: "list-extras",
  name: "Extras",
  customerName: { es: "Extras carta" },
  kitchenName: "Extras KDS",
  minPicks: 0,
  maxPicks: null,
  items: [
    {
      productId: "p-bacon",
      name: "Bacon",
      customerName: { es: "Bacon carta" },
      kitchenName: "Bacon KDS",
      price: "1.00",
      vatClass: "general",
      maxQuantity: 3,
      preselected: true,
      addAllergens: null,
      suitableFor: [],
    },
  ],
};

const burger: TillProduct = {
  ...beer,
  id: "burger",
  menuItemId: "offer-burger",
  name: "Burger",
  unitPrice: "9.50",
  offeredModifiers: [cookedList, extrasList],
};

const jamon: TillProduct = {
  ...beer,
  id: "jamon",
  menuItemId: "offer-jamon",
  name: "Jamón",
  pricingUnit: "weight",
  unitPrice: "20.00",
};

const products = [beer, flan, burger, jamon];

function menuOf(offered: TillProduct[], section?: (product: TillProduct) => string | undefined) {
  return servedMenus(
    [{ id: "menu-table", name: "Carta", isDefault: true, versionId: "menu-table-v1" }],
    offered.map((product) => {
      const placed = section?.(product);
      return {
        id: product.menuItemId!,
        menuId: "menu-table",
        productId: product.id,
        ...(placed === undefined ? {} : { section: placed }),
      };
    }),
  );
}

async function mount(over: Partial<TillTableOrderScreen> = {}) {
  const offered = over.products ?? products;
  return mountWidget<TillTableOrderScreen>("till-table-order-screen", {
    products: offered,
    menus: menuOf(offered),
    lines: [],
    statuses: [],
    orderId: "wo-4",
    draftStore: new DraftStore(),
    ...over,
  });
}

const browser = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!;
const store = (el: TillTableOrderScreen) => el.draftStore!;
const rows = (el: TillTableOrderScreen) =>
  store(el).lines.map(
    (line) => `${line.product.name} ×${line.quantity}${line.noMerge === true ? " apart" : ""}`,
  );

/** Taps the menu browser's tile named `name`. */
async function tap(el: TillTableOrderScreen, name: string): Promise<void> {
  [...browser(el).shadowRoot!.querySelectorAll<HTMLElement>("wt-button.tile")]
    .find((tile) => tile.querySelector(".name")?.textContent === name)!
    .click();
  await el.updateComplete;
}

/** Lets a ResizeObserver see a new width and the screen render what it decided. */
async function resized(el: TillTableOrderScreen): Promise<void> {
  for (let frame = 0; frame < 2; frame++)
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  await el.updateComplete;
}

const shown = (element: Element | null) => element !== null && element.checkVisibility();

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

describe("till-table-order-screen: browsing and the draft by the screen's width", () => {
  const review = (el: TillTableOrderScreen) =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-review-open]");
  const draftPane = (el: TillTableOrderScreen) =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-draft-pane]");
  const browsing = (el: TillTableOrderScreen) =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-browsing]");

  it("keeps browsing and the draft apart below the width, and opens the whole draft on Review", async () => {
    const { el, host } = await mount();
    host.style.width = "390px";
    await resized(el);
    await tap(el, "Beer");
    await tap(el, "Beer");
    await tap(el, "Flan");

    expect(shown(browsing(el))).toBe(true);
    expect(shown(draftPane(el))).toBe(false);
    expect(review(el)!.textContent!.trim()).toBe(t("table.review").replace("{n}", "3"));

    review(el)!.click();
    await el.updateComplete;

    expect(shown(draftPane(el))).toBe(true);
    expect(shown(browsing(el))).toBe(false);
    const toggles = [...el.shadowRoot!.querySelectorAll("[data-draft-select]")];
    expect(toggles.map((toggle) => shown(toggle))).toEqual([true, true]);
    expect(shown(el.shadowRoot!.querySelector('[data-draft-action="send-all"]'))).toBe(true);
  });

  it("gives each line's name the Review view's width at 390 px, so it is not broken letter by letter", async () => {
    const { el, host } = await mount();
    host.style.width = "390px";
    await resized(el);
    await tap(el, "Beer");
    await tap(el, "Beer");
    review(el)!.click();
    await el.updateComplete;
    for (const basket of el.shadowRoot!.querySelectorAll<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("till-basket"))
      await basket.updateComplete;

    const toggle = el.shadowRoot!.querySelector<HTMLElement>("[data-draft-select]")!;
    expect(toggle.getBoundingClientRect().height).toBeLessThan(2 * 44);
  });

  it("comes Back to the same browsing, its open section and its scroll position, with the draft kept", async () => {
    const fillers = Array.from({ length: 40 }, (_, n) => ({
      ...beer,
      id: `tapa-${n}`,
      menuItemId: `offer-tapa-${n}`,
      name: `Tapa ${n}`,
    }));
    const offered = [beer, ...fillers];
    const { el, host } = await mount({
      products: offered,
      menus: menuOf(offered, (product) => (product.id.startsWith("tapa") ? "Tapas" : undefined)),
    });
    host.style.width = "390px";
    host.style.height = "500px";
    host.style.overflowY = "auto";
    await resized(el);
    await tap(el, "Beer");
    const section = [
      ...browser(el).shadowRoot!.querySelectorAll<HTMLElement>('wt-button[data-kind="section"]'),
    ][0]!;
    section.click();
    await browser(el).updateComplete;
    await tap(el, "Tapa 30");
    host.scrollTop = 900;
    const scrolled = host.scrollTop;
    expect(scrolled).toBeGreaterThan(0);
    const before = browser(el);

    review(el)!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-review-back]")!.click();
    await resized(el);

    expect(browser(el)).toBe(before);
    expect(browser(el).shadowRoot!.querySelector('[data-region="section"]')).not.toBeNull();
    expect(host.scrollTop).toBe(scrolled);
    expect(rows(el)).toEqual(["Beer ×1", "Tapa 30 ×1"]);
    expect(shown(browsing(el))).toBe(true);
  });

  it("shows browsing and the draft side by side at the width and above, with no Review", async () => {
    const { el, host } = await mount();
    host.style.width = `${DRAFT_SIDE_BY_SIDE_MIN_WIDTH}px`;
    await resized(el);
    await tap(el, "Beer");

    expect(review(el)).toBeNull();
    expect(shown(browsing(el))).toBe(true);
    expect(shown(draftPane(el))).toBe(true);
    const side = browsing(el)!.getBoundingClientRect();
    const pane = draftPane(el)!.getBoundingClientRect();
    expect(pane.left).toBeGreaterThanOrEqual(side.right);
  });

  it("goes back to Review below the width, from side by side", async () => {
    const { el, host } = await mount();
    host.style.width = "1280px";
    await resized(el);
    await tap(el, "Beer");
    expect(review(el)).toBeNull();

    host.style.width = `${DRAFT_SIDE_BY_SIDE_MIN_WIDTH - 1}px`;
    await resized(el);

    expect(shown(review(el))).toBe(true);
    expect(shown(draftPane(el))).toBe(false);
  });
});
