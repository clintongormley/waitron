import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { WorkingOrderStore } from "../state/working-order.js";
import type { TabDef } from "../layout.js";
import type { Station, TillProduct, TillZoneMenu } from "../api/client.js";
import { cleanupWidgets, mountWidget, servedMenus } from "../widgets/test-helpers.js";
import "./till-counter-screen.js";
import indexHtml from "../../index.html?raw";
import type { TillCounterScreen } from "./till-counter-screen.js";

// Vitest's own default frame, which every other case runs in.
const DEFAULT_FRAME = [414, 896] as const;

let pageStyle: HTMLStyleElement | undefined;

afterEach(async () => {
  cleanupWidgets();
  pageStyle?.remove();
  pageStyle = undefined;
  await page.viewport(...DEFAULT_FRAME);
});

/** The till's default Counter tab (`packages/layouts/src/default-canvases.ts`). */
const counterTab: TabDef = {
  key: "counter",
  title: "Counter",
  columns: 12,
  cards: [
    { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} },
    { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
    { type: "total", colSpan: 4, rowSpan: 1, config: {} },
    { type: "tender-pay", colSpan: 4, rowSpan: 2, config: {} },
  ],
};

function product(key: string, name: string, unitPrice: string): TillProduct {
  return {
    id: `p-${key}`,
    productId: `p-${key}`,
    menuItemId: `mi-drinks-${key}`,
    catalogueId: "drinks",
    available: true,
    name,
    unitPrice,
    vatClass: "general",
    category: null,
    allergens: null,
  };
}

const cafe = product("cafe", "Café solo", "1.50");
const croquetasDish = product("croquetas", "Croquetas", "7.80");
// Two stations, so each line offers Make at… as it does on a venue with a kitchen and a bar.
const stations: Station[] = [
  { id: "bar", name: "Bar", displayOrder: 0, isDefault: true, active: true, open: true },
  { id: "grill", name: "Grill", displayOrder: 1, isDefault: false, active: true, open: true },
];
const menus: TillZoneMenu[] = servedMenus(
  [{ id: "drinks", name: "Drinks", isDefault: true, versionId: "drinks-v1" }],
  [cafe, croquetasDish].map((each) => ({
    id: each.menuItemId!,
    menuId: "drinks",
    productId: each.id,
  })),
);

/** `croquetas` of fifteen make a three-digit line total, wider than the 1280 px basket fits on one row. */
async function mountCounter(width: number, height: number, croquetas = "15"): Promise<HTMLElement> {
  await page.viewport(width, height);
  expect(window.innerWidth).toBe(width);
  const store = new WorkingOrderStore();
  store.addProduct(cafe, "1");
  store.addProduct(croquetasDish, croquetas);
  // The page's own style (apps/till/index.html), whose padding narrows the screen on a phone.
  pageStyle = document.createElement("style");
  pageStyle.textContent = /<style>([\s\S]*?)<\/style>/.exec(indexHtml)![1]!;
  document.head.append(pageStyle);
  const { el } = await mountWidget<TillCounterScreen>("till-counter-screen", {
    counterTab,
    store,
    products: [cafe, croquetasDish],
    menus,
    selectedMenuId: "drinks",
    makeAtStations: stations,
    operatorName: "Ana",
  });
  const grid = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    "till-card-grid",
  )!;
  await grid.updateComplete;
  return grid;
}

function inShadow(host: Element | null | undefined, selector: string): HTMLElement {
  const found = host?.shadowRoot?.querySelector<HTMLElement>(selector);
  if (found === null || found === undefined) throw new Error(`no ${selector}`);
  return found;
}

/** The share of `target` the browser reports on screen: an `overflow` ancestor that cuts it off
 * lowers this, where its own bounding box would still report it inside the viewport. The page alone
 * is scrolled to bring it level with the viewport first, so a target below the fold of a stacked
 * layout is not mistaken for a clipped one. */
async function shownShare(target: HTMLElement): Promise<number> {
  const top = target.getBoundingClientRect().top;
  if (top < 0 || top > innerHeight / 2) window.scrollBy(0, top - innerHeight / 4);
  const ratio = await new Promise<number>((resolve) => {
    const observer = new IntersectionObserver((entries) => {
      observer.disconnect();
      resolve(entries.at(-1)!.intersectionRatio);
    });
    observer.observe(target);
  });
  return Math.round(ratio * 100) / 100;
}

/** Each control a selling till needs from the basket side, by name, with the card it belongs to. */
function sellingControls(el: HTMLElement): Record<string, [HTMLElement, HTMLElement]> {
  const card = (tag: string) => el.shadowRoot!.querySelector<HTMLElement>(tag)!;
  const basket = card("till-basket");
  const total = card("till-total");
  const tender = card("till-tender-pay");
  const controls: Record<string, [HTMLElement, HTMLElement]> = {};
  for (const line of basket.shadowRoot!.querySelectorAll<HTMLElement>(".line")) {
    const name = line.querySelector(".name")!.textContent!.trim();
    controls[`${name} price`] = [line.querySelector<HTMLElement>(".line-total")!, basket];
    controls[`${name} remove`] = [line.querySelector<HTMLElement>(".remove")!, basket];
  }
  controls.total = [inShadow(total, ".amount"), total];
  controls["cash button"] = [inShadow(tender, ".pay"), tender];
  controls["card button"] = [inShadow(tender, ".pay-card"), tender];
  controls["hold button"] = [inShadow(tender, ".hold"), tender];
  return controls;
}

/** "whole" for a control wholly on screen and inside its own card's box; otherwise what was seen. A
 * control spilling past its card can still be on screen, on a wider page than the card allows. */
async function placement(el: HTMLElement): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [name, [target, card]] of Object.entries(sellingControls(el))) {
    const share = await shownShare(target);
    const spill = Math.round(
      target.getBoundingClientRect().right - card.getBoundingClientRect().right,
    );
    result[name] = share === 1 && spill <= 0 ? "whole" : `${share} shown, ${spill}px past its card`;
  }
  return result;
}

const allWhole = Object.fromEntries(
  [
    "Café solo price",
    "Café solo remove",
    "Croquetas price",
    "Croquetas remove",
    "total",
    "cash button",
    "card button",
    "hold button",
  ].map((name) => [name, "whole"]),
);

const box = (el: HTMLElement, tag: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(tag)!.getBoundingClientRect();

it("on a 390 px phone, puts the basket under the menu at its width, with each line's price and remove button, the total and the pay buttons whole", async () => {
  const el = await mountCounter(390, 844);
  const browser = box(el, "till-menu-browser");
  const basket = box(el, "till-basket");
  expect({ left: basket.left, width: basket.width }).toEqual({
    left: browser.left,
    width: browser.width,
  });
  expect(basket.top).toBeGreaterThanOrEqual(browser.bottom);
  expect(await placement(el)).toEqual(allWhole);
});

it("on a 1280 px till, keeps the basket beside the menu, with the same controls whole", async () => {
  const el = await mountCounter(1280, 800, "2");
  const browser = box(el, "till-menu-browser");
  const basket = box(el, "till-basket");
  expect(basket.left).toBeGreaterThanOrEqual(browser.right);
  expect(basket.top).toBeLessThan(browser.bottom);
  expect(await placement(el)).toEqual(allWhole);
});

it("stacks the basket when a till narrows to a phone's width while open", async () => {
  const el = await mountCounter(1280, 800);
  await page.viewport(390, 844);
  await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  expect(box(el, "till-basket").left).toBe(box(el, "till-menu-browser").left);
  expect(await placement(el)).toEqual(allWhole);
});
