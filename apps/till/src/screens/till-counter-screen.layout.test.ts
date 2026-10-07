import { afterEach, expect, it, describe } from "vitest";
import { currentLocale, setLocale } from "../i18n/t.js";
import { page } from "vitest/browser";
import { WorkingOrderStore } from "../state/working-order.js";
import type { TabDef } from "../layout.js";
import type { Station, TillProduct, TillZoneMenu } from "../api/client.js";
import {
  cleanupWidgets,
  mountWidget,
  servedMenus,
  expectNoA11yViolations,
} from "../widgets/test-helpers.js";
import "./till-counter-screen.js";
import "../widgets/tab-shell.js";
import type { TillTabShell } from "../widgets/tab-shell.js";
import indexHtml from "../../index.html?raw";
import type { TillTenderPay } from "../widgets/tender-pay.js";
import type { TillCounterScreen } from "./till-counter-screen.js";

// Vitest's own default frame, which every other case runs in.
const DEFAULT_FRAME = [414, 896] as const;

const originalLocale = currentLocale();

let pageStyle: HTMLStyleElement | undefined;

afterEach(async () => {
  cleanupWidgets();
  setLocale(originalLocale);
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

/** `croquetas` of fifteen make a three-digit line total. */
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

// A line's remove button already reaches the basket's edge at this width (the backlog's open 1280 px
// item), so only the cards outside the basket are held whole.
it("on a 1280 px till, keeps the basket beside the menu, with the total and the pay buttons whole", async () => {
  const el = await mountCounter(1280, 800, "2");
  const browser = box(el, "till-menu-browser");
  const basket = box(el, "till-basket");
  expect(basket.left).toBeGreaterThanOrEqual(browser.right);
  expect(basket.top).toBeLessThan(browser.bottom);
  const shown = await placement(el);
  const outsideBasket = ["total", "cash button", "card button", "hold button"];
  expect(Object.fromEntries(outsideBasket.map((name) => [name, shown[name]]))).toEqual(
    Object.fromEntries(outsideBasket.map((name) => [name, "whole"])),
  );
});

it("stacks the basket when a till narrows to a phone's width while open", async () => {
  const el = await mountCounter(1280, 800);
  await page.viewport(390, 844);
  await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  expect(box(el, "till-basket").left).toBe(box(el, "till-menu-browser").left);
  expect(await placement(el)).toEqual(allWhole);
});

it.each([390, 720, 1024, 1280, 1920])(
  "keeps a three-digit line's remove control inside its basket at %i px",
  async (width) => {
    const el = await mountCounter(width, 800);
    const store = (el as HTMLElement & { store: WorkingOrderStore }).store;
    for (const quantity of ["1", "2", "15"]) {
      store.addProduct(
        product(`long-${quantity}`, "A dish with a very long unbrokennameandmoretext", "7.80"),
        quantity,
      );
    }
    const basket = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "till-basket",
    )!;
    await basket.updateComplete;
    const edge = basket.getBoundingClientRect();
    for (const remove of basket.shadowRoot!.querySelectorAll<HTMLElement>(".remove")) {
      const rect = remove.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(edge.left);
      expect(rect.right).toBeLessThanOrEqual(edge.right);
    }
  },
);

describe.each(["light", "dark"] as const)("sale rail in %s theme", (theme) => {
  describe.each(["en-GB", "es-ES"])("sale rail in %s", (locale) => {
    it.each([
      [1280, 800],
      [1024, 768],
    ])(
      "keeps total and payment controls visible while a long basket scrolls at %i × %i",
      async (width, height) => {
        const grid = await mountCounter(width, height);
        const screen = grid.getRootNode() as ShadowRoot;
        const counter = screen.host as TillCounterScreen;
        setLocale(locale);
        counter.embedded = true;
        counter.serviceZones = [
          {
            id: "bar",
            name: "Downstairs bar",
            departmentId: "bar",
            departmentName: "Bar",
            serviceMode: "prepay",
          },
        ];
        counter.selectedServiceZoneId = "bar";
        counter.cardProvider = "simulator";
        counter.menus = [
          { ...menus[0]!, name: "Casa Delgado" },
          { ...menus[0]!, id: "lunch", name: "Menú del Día", isDefault: false },
          { ...menus[0]!, id: "dinner", name: "Dinner and special occasions", isDefault: false },
          { ...menus[0]!, id: "drinks-extra", name: "Drinks and cocktails", isDefault: false },
        ];
        counter.products = [
          { ...cafe, diet: { vegan: "yes", vegetarian: "yes", contains: [] } },
          croquetasDish,
        ];
        const { el: shell, host } = await mountWidget<TillTabShell>(
          "till-tab-shell",
          {
            tabs: [counterTab, { ...counterTab, key: "floor", title: "Floor", cards: [] }],
            transferAvailable: true,
            canSwitchProfile: true,
            activeTabKey: "counter",
            operatorName: "Administradora",
            affordances: ["station", "expo", "schedule", "find-bill"],
          },
          theme,
        );
        host.style.height = `${height - 109}px`;
        host.style.marginTop = "61px";
        shell.style.height = "100%";
        shell.append(counter);
        for (let i = 0; i < 25; i++) {
          counter.store.addProduct(product(`long-${i}`, `Long dish name ${i}`, "117.00"), "1");
        }
        await counter.updateComplete;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await expect
          .element(page.getByRole("button", { name: "Casa Delgado", exact: true }))
          .toBeVisible();
        await expect
          .element(
            page.getByRole("button", {
              name: locale === "es-ES" ? "Vegano" : "Vegan",
              exact: true,
            }),
          )
          .toBeVisible();
        const controls = sellingControls(grid);
        for (const name of ["total", "cash button", "card button", "hold button"]) {
          const [control] = controls[name]!;
          const rect = control.getBoundingClientRect();
          expect(rect.top, name).toBeGreaterThanOrEqual(0);
          expect(rect.bottom, name).toBeLessThanOrEqual(height);
        }
        const basket = grid.shadowRoot!.querySelector<HTMLElement>("till-basket")!;
        const scroller = basket.parentElement!;
        expect(scroller.clientHeight).toBeGreaterThanOrEqual(44);
        expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
        scroller.scrollTop = scroller.scrollHeight;
        expect(scroller.scrollTop).toBeGreaterThan(0);
        const lastRemove = [...basket.shadowRoot!.querySelectorAll<HTMLElement>(".remove")].at(-1)!;
        expect(lastRemove.getBoundingClientRect().bottom).toBeLessThanOrEqual(
          scroller.getBoundingClientRect().bottom,
        );
        await expectNoA11yViolations(host);
      },
    );
  });
});

it.each([
  {
    name: "reordered cards",
    cards: [counterTab.cards[1]!, counterTab.cards[0]!, counterTab.cards[2]!, counterTab.cards[3]!],
  },
  {
    name: "payment before total",
    cards: [counterTab.cards[0]!, counterTab.cards[1]!, counterTab.cards[3]!, counterTab.cards[2]!],
  },
  {
    name: "a menu narrower than its configured row",
    cards: [{ ...counterTab.cards[0]!, colSpan: 7 }, ...counterTab.cards.slice(1)],
  },
  {
    name: "a wider total",
    cards: counterTab.cards.map((card) => (card.type === "total" ? { ...card, colSpan: 5 } : card)),
  },
  {
    name: "a wider payment card",
    cards: counterTab.cards.map((card) =>
      card.type === "tender-pay" ? { ...card, colSpan: 5 } : card,
    ),
  },
  { name: "an extra total card", cards: [...counterTab.cards, counterTab.cards[2]!] },
])("preserves configured row spans for $name", async ({ cards }) => {
  const grid = await mountCounter(1280, 800);
  const screen = (grid.getRootNode() as ShadowRoot).host as TillCounterScreen;
  screen.counterTab = { ...counterTab, cards };
  await screen.updateComplete;
  await (grid as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  const basket = grid.shadowRoot!.querySelector("till-basket")!;
  expect(getComputedStyle(basket.parentElement!).gridRowStart).toBe("span 4");
});

it("keeps a usable basket and payment controls when the default canvas has many held orders", async () => {
  const grid = await mountCounter(1280, 800);
  const counter = (grid.getRootNode() as ShadowRoot).host as TillCounterScreen;
  counter.embedded = true;
  counter.counterTab = {
    ...counterTab,
    cards: [
      ...counterTab.cards,
      { type: "held-orders", colSpan: 8, rowSpan: 2, config: {}, visibleWhen: ["has-parked"] },
    ],
  };
  counter.heldOrders = Array.from({ length: 20 }, (_, i) => ({
    id: `held-${i}`,
    orderNumber: i + 1,
    label: `Order ${i + 1}`,
    itemCount: 1,
    total: "7.80",
    outstanding: "7.80",
    hasPayments: false,
    partyId: null,
    openedAt: "2026-10-08T12:00:00.000Z",
    signals: [],
  }));
  const { el: shell, host } = await mountWidget<TillTabShell>("till-tab-shell", {
    tabs: [counterTab],
    activeTabKey: "counter",
    operatorName: "Ana",
  });
  host.style.height = "752px";
  shell.style.height = "100%";
  shell.append(counter);
  for (let i = 0; i < 25; i++)
    counter.store.addProduct(product(`held-long-${i}`, `Long dish ${i}`, "117.00"), "1");
  await counter.updateComplete;
  await (grid as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  const basket = grid.shadowRoot!.querySelector("till-basket")!;
  expect(basket.parentElement!.scrollHeight).toBeGreaterThan(basket.parentElement!.clientHeight);
  basket.parentElement!.scrollTop = basket.parentElement!.scrollHeight;
  expect(basket.parentElement!.scrollTop).toBeGreaterThan(0);
  const lastRemove = [...basket.shadowRoot!.querySelectorAll<HTMLElement>(".remove")].at(-1)!;
  expect(lastRemove.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    basket.parentElement!.getBoundingClientRect().bottom,
  );
  expect(basket.parentElement!.clientHeight).toBeGreaterThanOrEqual(44);
  expect(
    inShadow(grid.shadowRoot!.querySelector("till-tender-pay"), ".hold").getBoundingClientRect()
      .bottom,
  ).toBeLessThanOrEqual(800);
  expect(grid.shadowRoot!.querySelector("till-held-orders")).not.toBeNull();
});

describe.each(["light", "dark"] as const)("idle payment layout in %s", (theme) => {
  describe.each(["en-GB", "es-ES"])("idle payment layout in %s", (locale) => {
    it.each(["prepay", "ticket_then_pay"] as const)(
      "keeps invoice and hold together in %s mode",
      async (mode) => {
        await page.viewport(1024, 768);
        setLocale(locale);
        const store = new WorkingOrderStore();
        store.addProduct(cafe, "1");
        const { el, host } = await mountWidget<TillTenderPay>(
          "till-tender-pay",
          { store, mode },
          theme,
        );
        host.style.width = "360px";
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const invoice = inShadow(el, "[data-full-invoice]").getBoundingClientRect();
        const hold = inShadow(el, ".hold").getBoundingClientRect();
        expect(hold.top).toBe(invoice.top);
        expect(hold.left).toBeGreaterThanOrEqual(invoice.right);
        for (const selector of [".pay", ".pay-card", ".hold"]) {
          const rect = inShadow(el, selector).getBoundingClientRect();
          expect(rect.height).toBeGreaterThanOrEqual(44);
          expect(rect.width).toBeGreaterThanOrEqual(44);
        }
        if (mode !== "prepay") {
          const place = inShadow(el, ".place").getBoundingClientRect();
          expect(place.bottom).toBeLessThanOrEqual(invoice.top);
          expect(place.width).toBe(inShadow(el, ".idle-actions").getBoundingClientRect().width);
        }
        await expectNoA11yViolations(host);
      },
    );
  });
});

it("keeps the cash-at-till explanation across the payment card", async () => {
  const store = new WorkingOrderStore();
  store.addProduct(cafe, "1");
  const { el, host } = await mountWidget<TillTenderPay>("till-tender-pay", {
    store,
    takesCash: false,
  });
  host.style.width = "360px";
  const note = inShadow(el, ".cash-at-till").getBoundingClientRect();
  expect(note.width).toBe(inShadow(el, ".idle-actions").getBoundingClientRect().width);
});
