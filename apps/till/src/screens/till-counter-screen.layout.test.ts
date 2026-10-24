import { afterEach, expect, it, describe } from "vitest";
import { currentLocale, setLocale } from "../i18n/t.js";
import { page } from "vitest/browser";
import { WorkingOrderStore } from "../state/working-order.js";
import { currentContentLanguages, setContentLanguages } from "@waitron/ui";
import { TEXT_130_SHEET } from "@waitron/ui/test/venue-theme-fixture.js";
import type { Station, TillProduct, TillZoneMenu } from "../api/client.js";
import {
  cleanupWidgets,
  mountWidget,
  servedMenus,
  expectNoA11yViolations,
} from "../widgets/test-helpers.js";
import "./till-counter-screen.js";
import "../widgets/till-shell.js";
import type { TillShell } from "../widgets/till-shell.js";
import indexHtml from "../../index.html?raw";
import type { TillTenderPay } from "../widgets/tender-pay.js";
import type { TillCounterScreen } from "./till-counter-screen.js";

// Vitest's own default frame, which every other case runs in.
const DEFAULT_FRAME = [414, 896] as const;

const originalLocale = currentLocale();
const originalContentLanguages = currentContentLanguages();

let pageStyle: HTMLStyleElement | undefined;

afterEach(async () => {
  cleanupWidgets();
  setLocale(originalLocale);
  pageStyle?.remove();
  pageStyle = undefined;
  document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
    (sheet) => sheet !== TEXT_130_SHEET,
  );
  setContentLanguages(originalContentLanguages);
  await page.viewport(...DEFAULT_FRAME);
});

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
  {
    id: "bar",
    name: "Bar",
    isDefault: true,
    active: true,
    open: true,
    byHand: null,
    sendsTo: null,
    why: "default" as const,
  },
  {
    id: "grill",
    name: "Grill",
    isDefault: false,
    active: true,
    open: true,
    byHand: null,
    sendsTo: null,
    why: "open" as const,
  },
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
    store,
    products: [cafe, croquetasDish],
    menus,
    selectedMenuId: "drinks",
    makeAtStations: stations,
    operatorName: "Ana",
  });
  return el;
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

/** The client rects of `node`'s text, which a break inside a word splits. */
function textRects(node: Node): DOMRect[] {
  const range = document.createRange();
  range.selectNodeContents(node);
  return [...range.getClientRects()].filter((rect) => rect.width > 0);
}

// What this browser does with one long word, so a CI log says which browser hyphenated what before
// the layout cases below rely on it.
it.each(["es", "en"])("one long word in a 70 px box under lang=%s", async (lang) => {
  await document.fonts.ready;
  const word = document.createElement("div");
  word.lang = lang;
  word.style.cssText = "width: 70px; font: 16px system-ui; hyphens: auto; overflow-wrap: normal;";
  word.textContent = "Strawberries";
  document.body.append(word);
  try {
    const rects = textRects(word);
    const lines = new Set(rects.map((rect) => Math.round(rect.top))).size;
    const right = Math.round(
      Math.max(...rects.map((rect) => rect.right)) - word.getBoundingClientRect().left,
    );
    expect(lines, `${navigator.userAgent}: ${lines} lines, right edge ${right}px`).toBe(
      lang === "es" ? 2 : 1,
    );
  } finally {
    word.remove();
  }
});

/** Puts the till at `scale`% text: 130 adopts the real theme sheet at that size, 100 leaves Waitron's. */
async function atScale(scale: number): Promise<void> {
  if (scale === 130) document.adoptedStyleSheets = [...document.adoptedStyleSheets, TEXT_130_SHEET];
  await document.fonts.ready;
}

it.each([100, 130])(
  "on a 1280 × 800 till at %i%, the basket stays beside the menu, the pay buttons are whole and Park ends above the screen's bottom",
  async (scale) => {
    await atScale(scale);
    const el = await mountCounter(1280, 800, "2");
    await document.fonts.ready;
    const hold = inShadow(el.shadowRoot!.querySelector("till-tender-pay"), ".hold");
    expect(hold.getBoundingClientRect().bottom).toBeLessThanOrEqual(innerHeight);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1280);
    const browser = box(el, "till-menu-browser");
    const basket = box(el, "till-basket");
    expect(basket.left).toBeGreaterThanOrEqual(browser.right);
    expect(basket.top).toBeLessThan(browser.bottom);
    const shown = await placement(el);
    const outsideBasket = ["total", "cash button", "card button", "hold button"];
    expect(Object.fromEntries(outsideBasket.map((name) => [name, shown[name]]))).toEqual(
      Object.fromEntries(outsideBasket.map((name) => [name, "whole"])),
    );
  },
);

it.each([100, 130])("at 1024 × 768 and %i%, every selling control is whole", async (scale) => {
  await atScale(scale);
  const el = await mountCounter(1024, 768);
  await document.fonts.ready;
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1024);
  expect(await placement(el)).toEqual(allWhole);
});

it.each([100, 130])(
  "on a 390 px phone at %i%, the basket sits under the menu with every selling control whole",
  async (scale) => {
    await atScale(scale);
    const el = await mountCounter(390, 844);
    await document.fonts.ready;
    const browser = box(el, "till-menu-browser");
    const basket = box(el, "till-basket");
    expect({ left: basket.left, width: basket.width }).toEqual({
      left: browser.left,
      width: browser.width,
    });
    expect(basket.top).toBeGreaterThanOrEqual(browser.bottom);
    expect(await placement(el)).toEqual(allWhole);
  },
);

// English words, so the case keeps to English fixtures: Chromium hyphenates them by Spanish rules
// under lang="es" and not at all under lang="en".
const LONG_NAMES = [
  "Cheeseburger",
  "Strawberries and cream",
  "Hamburger",
  "Mushrooms with garlic",
  "Meatballs",
  "Aubergines",
  "Watermelon",
  "Elderflower lemonade",
  "Chocolate",
  "Raspberries",
  "Blackcurrant",
  "Gingerbread",
].map((name, index) => product(`long-name-${index}`, name, "9.50"));

/** The counter at 130% under content language `lang`, the long names on its tiles and the first,
 * second and fourth on its bill, with every break other than a hyphen switched off. */
async function mountLongNames(width: number, height: number, lang: string): Promise<HTMLElement> {
  setContentLanguages({ defaultLanguage: lang, languages: [lang] });
  await atScale(130);
  await page.viewport(width, height);
  const store = new WorkingOrderStore();
  for (const index of [0, 1, 3]) store.addProduct(LONG_NAMES[index]!, "1");
  pageStyle = document.createElement("style");
  pageStyle.textContent = /<style>([\s\S]*?)<\/style>/.exec(indexHtml)![1]!;
  document.head.append(pageStyle);
  const { el } = await mountWidget<TillCounterScreen>("till-counter-screen", {
    store,
    products: LONG_NAMES,
    menus: servedMenus(
      [{ id: "drinks", name: "Drinks", isDefault: true, versionId: "drinks-v1" }],
      LONG_NAMES.map((each) => ({ id: each.menuItemId!, menuId: "drinks", productId: each.id })),
    ),
    selectedMenuId: "drinks",
    makeAtStations: stations,
    operatorName: "Ana",
  });
  const noBreak = new CSSStyleSheet();
  noBreak.replaceSync(".name, .product-name { overflow-wrap: normal !important; }");
  for (const tag of ["till-menu-browser", "till-basket"]) {
    const root = el.shadowRoot!.querySelector(tag)!.shadowRoot!;
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, noBreak];
  }
  await document.fonts.ready;
  return el;
}

interface DrawnName {
  name: string;
  /** The name's own box, which its text must stay inside. */
  box: HTMLElement;
  text: HTMLElement;
}

function drawnNames(el: HTMLElement): DrawnName[] {
  const browser = el.shadowRoot!.querySelector("till-menu-browser")!.shadowRoot!;
  const basket = el.shadowRoot!.querySelector("till-basket")!.shadowRoot!;
  const tiles = [...browser.querySelectorAll<HTMLElement>('[data-kind="product"] .name')];
  const lines = [...basket.querySelectorAll<HTMLElement>(".line .product-name")];
  return [
    ...tiles.map((text) => ({
      name: `tile ${text.textContent!.trim()}`,
      box: text,
      text,
    })),
    ...lines.map((text) => ({
      name: `bill ${text.textContent!.trim()}`,
      box: text.closest<HTMLElement>(".name")!,
      text,
    })),
  ];
}

/** Each name whose text runs outside its own box, with that box's width. */
function overflows(names: DrawnName[]): string[] {
  return names.flatMap(({ name, box: own, text }) => {
    const edge = own.getBoundingClientRect();
    const out = textRects(text).some(
      (rect) => rect.left < edge.left - 0.5 || rect.right > edge.right + 0.5,
    );
    return out ? [`${name} (box ${Math.round(edge.width)}px)`] : [];
  });
}

/** Each word drawn on more than one line. */
function brokenWords(names: DrawnName[]): string[] {
  return names.flatMap(({ name, text }) => {
    const node = [...text.childNodes].find(
      (child) => child.nodeType === Node.TEXT_NODE && child.textContent!.trim() !== "",
    )!;
    const broken: string[] = [];
    for (const match of node.textContent!.matchAll(/\S+/g)) {
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      const tops = new Set(
        [...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)),
      );
      if (tops.size > 1) broken.push(`${name}: ${match[0]}`);
    }
    return broken;
  });
}

it.each([
  [1280, 800],
  [1024, 768],
])(
  "at %ix%i and 130%, long names under Spanish break only with a hyphen",
  async (width, height) => {
    const el = await mountLongNames(width, height, "es");
    const names = drawnNames(el);
    expect(names.length, "tiles and bill lines drawn").toBe(LONG_NAMES.length + 3);
    const over = overflows(names);
    const broken = brokenWords(names);
    const seen = [
      navigator.userAgent,
      `overflowing: ${over.join(", ") || "none"}`,
      `words on two lines: ${broken.join(", ") || "none"}`,
    ].join("; ");
    expect(over.length, seen).toBe(0);
    expect(broken.length, seen).toBeGreaterThan(0);
  },
);

it("the same names under English overflow their boxes", async () => {
  const el = await mountLongNames(1280, 800, "en");
  const names = drawnNames(el);
  expect(names.length, "tiles and bill lines drawn").toBe(LONG_NAMES.length + 3);
  expect(overflows(names).length, navigator.userAgent).toBeGreaterThan(0);
});

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
        const counter = grid as TillCounterScreen;
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
        const { el: shell, host } = await mountWidget<TillShell>(
          "till-shell",
          {
            formFactor: "till",
            transferAvailable: true,
            canSwitchProfile: true,
            activeScreen: "counter",
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
              name: locale === "es-ES" ? "Filtros" : "Filter",
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

it("keeps a usable basket and payment controls when many orders are held", async () => {
  const grid = await mountCounter(1280, 800);
  const counter = grid as TillCounterScreen;
  counter.embedded = true;
  counter.orderList = "parked";
  counter.heldOrders = Array.from({ length: 20 }, (_, i) => ({
    items: [],
    id: `held-${i}`,
    orderNumber: i + 1,
    label: `Order ${i + 1}`,
    counts: { ordered: 1, unsent: 0, held: 0, waiting: 0, ready: 0 },
    total: "7.80",
    outstanding: "7.80",
    hasPayments: false,
    partyId: null,
    openedAt: "2026-10-08T12:00:00.000Z",
    signals: [],
  }));
  const { el: shell, host } = await mountWidget<TillShell>("till-shell", {
    formFactor: "till",
    activeScreen: "counter",
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
          { store, mode, fullInvoices: true },
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

    it.each(["prepay", "ticket_then_pay"] as const)(
      "keeps hold and the tenders usable without Full invoice in %s mode",
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
        expect(el.shadowRoot!.querySelector("[data-full-invoice]")).toBeNull();
        for (const selector of [".pay", ".pay-card", ".hold"]) {
          const rect = inShadow(el, selector).getBoundingClientRect();
          expect(rect.height).toBeGreaterThanOrEqual(44);
          expect(rect.width).toBeGreaterThanOrEqual(44);
        }
        const hold = inShadow(el, ".hold").getBoundingClientRect();
        const card = host.getBoundingClientRect();
        expect(hold.left).toBeGreaterThanOrEqual(card.left);
        expect(hold.right).toBeLessThanOrEqual(card.right);
        expect(hold.bottom).toBeLessThanOrEqual(window.innerHeight);
        const actions = inShadow(el, ".idle-actions").getBoundingClientRect();
        expect(hold.left).toBe(actions.left);
        expect(hold.right).toBeLessThan(actions.left + actions.width / 2);
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

it.each([390, 1280])("shows the Spanish Counter zone in the header at %i px", async (width) => {
  setLocale("es-ES");
  await page.viewport(width, 844);
  const { el } = await mountWidget<TillShell>("till-shell", {
    counterZones: [
      { id: "bar", name: "Barra" },
      { id: "deli", name: "Deli" },
    ],
    selectedCounterZoneId: "bar",
    activeScreen: "counter",
  });
  const menu = el.shadowRoot!.querySelector<HTMLElement>("[data-counter-zones]")!;
  await (menu as TillShell).updateComplete;
  const label = menu.querySelector<HTMLElement>('[slot="trigger"]')!;
  expect(label.textContent!.trim()).toBe("Mostrador: Barra ▾");
  expect(menu.getBoundingClientRect().right).toBeLessThanOrEqual(width);
  expect(menu.shadowRoot!.querySelector("button")!.scrollWidth).toBeLessThanOrEqual(
    menu.shadowRoot!.querySelector("button")!.clientWidth,
  );
});
