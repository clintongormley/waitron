import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UNDECLARED_DIET } from "@waitron/shared";
import { page, userEvent } from "vitest/browser";
import { TillShell } from "../widgets/till-shell.js";
import {
  cleanupWidgets,
  mountWidget,
  measured,
  pageAt,
  resetPage,
  servedMenus,
} from "../widgets/test-helpers.js";
import { TillCounterScreen } from "./till-counter-screen.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { ServiceZoneSummary, TillProduct, TillZoneMenu } from "../api/client.js";

const coffee: TillProduct = {
  id: "p1",
  menuId: "cat-default",
  name: "Café",
  customerName: { es: "Café para el cliente" },
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
};

const products: TillProduct[] = [coffee];

/** Two counter zones, with Deli counter listed second. */
const deliSecond: ServiceZoneSummary[] = [
  {
    id: "downstairs",
    name: "Downstairs bar",
    departmentId: "bar",
    departmentName: "Bar",
    serviceMode: "prepay",
  },
  {
    id: "deli",
    name: "Deli counter",
    departmentId: "deli",
    departmentName: "Deli",
    serviceMode: "prepay",
  },
];

const mount = (over: Partial<TillCounterScreen> = {}) =>
  mountWidget<TillCounterScreen>("till-counter-screen", {
    store: new WorkingOrderStore(),
    products,
    menus: servedMenus(
      [{ id: "cat-default", name: "Carta", isDefault: true, versionId: "v1" }],
      [],
    ),
    ...over,
  });

const body = (el: TillCounterScreen) => el;
const tender = (el: TillCounterScreen) => el.shadowRoot!.querySelector("till-tender-pay")!;
const menuBrowser = (el: TillCounterScreen) => el.shadowRoot!.querySelector("till-menu-browser")!;
const waitingList = (el: TillCounterScreen) =>
  el.shadowRoot!.querySelector("till-counter-waiting")!;
const heldList = (el: TillCounterScreen) => el.shadowRoot!.querySelector("till-held-orders")!;
const heldOrder = {
  zoneId: null,
  items: [],
  id: "held",
  orderNumber: 1,
  label: "Ana",
  counts: { ordered: 1, unsent: 0, held: 0, waiting: 0, ready: 0 },
  total: "1.50",
  outstanding: "1.50",
  hasPayments: false,
  partyId: null,
  billNumber: null,
  billName: null,
  openedAt: "2026-10-16T10:00:00.000Z",
  signals: [],
};
const waitingOrder = {
  items: [],
  id: "waiting",
  orderNumber: 2,
  label: "Luis",
  status: "settled" as const,
  openedAt: "2026-10-16T10:00:00.000Z",
  settledAt: "2026-10-16T10:01:00.000Z",
  collectedAt: null,
  total: "1.50",
  counts: { ordered: 1, unsent: 0, held: 0, waiting: 0, ready: 0 },
  canHandOver: true,
  serviceMode: null,
  movableDishes: [],
};

async function mountZones(serviceZones: ServiceZoneSummary[], selectedCounterZoneId: string) {
  return mountWidget<TillShell>("till-shell", {
    counterZones: serviceZones,
    selectedCounterZoneId,
  });
}
const zoneMenu = (el: TillShell) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-counter-zones]")!;
async function pickZone(el: TillShell, id: string) {
  const menu = zoneMenu(el);
  await (menu as TillShell).updateComplete;
  await userEvent.click(menu.shadowRoot!.querySelector("button")!);
  await userEvent.click(menu.querySelector<HTMLElement>(`[data-counter-zone="${id}"]`)!);
}
const selectedZone = (el: TillShell) =>
  zoneMenu(el).querySelector('[aria-checked="true"]')!.textContent!.trim().replace("✓", "").trim();

afterEach(cleanupWidgets);

it.each(["en", "es"] as const)(
  "an empty counter order explains disabled Pay and Send (%s)",
  async (locale) => {
    const previous = currentLocale();
    try {
      setLocale(locale);
      const { el } = await mount({ orderFlow: "ticket_then_pay" });
      const basket = el.shadowRoot!.querySelector("till-basket")!;
      const pay = tender(el);
      await Promise.all([basket.updateComplete, pay.updateComplete]);
      expect(basket.shadowRoot!.querySelector(".empty")?.textContent?.trim()).toBe(
        locale === "en" ? "Basket is empty" : "La cesta está vacía",
      );
      expect(
        pay.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(".pay")!.disabled,
      ).toBe(true);
      expect(
        pay.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(".place")!.disabled,
      ).toBe(true);
    } finally {
      setLocale(previous);
    }
  },
);

describe("closed zone ordering", () => {
  it("replaces add controls with the area notice and retains the counter basket", async () => {
    const previous = currentLocale();
    try {
      setLocale("en-GB");
      const store = new WorkingOrderStore();
      store.addProduct(coffee, "2");
      const { el } = await mount({
        store,
        zoneName: "Terrace",
        service: {
          open: true,
          zoneOpen: false,
          periodName: "Lunch",
          periodOccurrenceKey: '["department","2026-10-12","Lunch","08:00"]',
          keepOpen: null,
          zoneKeepOpen: null,
        },
      });
      expect(el.shadowRoot!.querySelector("[data-zone-closed]")?.textContent?.trim()).toBe(
        "Terrace is closed: nothing new can be ordered here. Bills can be paid or moved to another area.",
      );
      const cards = body(el)!;
      await cards.updateComplete;
      expect(cards.shadowRoot!.querySelector("till-menu-browser")).toBeNull();
      expect(el.shadowRoot!.querySelector("till-menu-switcher")).toBeNull();
      expect(cards.shadowRoot!.querySelector("till-basket")).not.toBeNull();
      expect(store.lines.map((line) => [line.product.id, line.quantity])).toEqual([["p1", "2"]]);
      el.service = {
        open: true,
        zoneOpen: true,
        periodName: "Lunch",
        periodOccurrenceKey: '["department","2026-10-12","Lunch","08:00"]',
        keepOpen: null,
        zoneKeepOpen: null,
      };
      await el.updateComplete;
      await cards.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-zone-closed]")).toBeNull();
      expect(cards.shadowRoot!.querySelector("till-menu-browser")).not.toBeNull();
    } finally {
      setLocale(previous);
    }
  });
});

describe("till-counter-screen", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-counter-screen")).toBe(TillCounterScreen);
  });

  it("the header shows the effective zone and emits explicit list selections", async () => {
    const { el } = await mountZones(deliSecond, "deli");
    const seen: string[] = [];
    el.addEventListener("counter-zone-selected", (event) =>
      seen.push((event as CustomEvent<{ zoneId: string }>).detail.zoneId),
    );
    expect(zoneMenu(el).textContent).toContain("Deli counter");
    expect(selectedZone(el)).toBe("Deli counter");
    await pickZone(el, "downstairs");
    await pickZone(el, "deli");
    expect(seen).toEqual(["downstairs", "deli"]);
  });

  it("the header lists the profile's counter choices in order and emits one pick", async () => {
    const { el } = await mountZones(deliSecond, "deli");
    const seen: string[] = [];
    el.addEventListener("counter-zone-selected", (event) =>
      seen.push((event as CustomEvent<{ zoneId: string }>).detail.zoneId),
    );
    expect(
      [...zoneMenu(el).querySelectorAll("[data-counter-zone]")].map((row) => [
        row.getAttribute("data-counter-zone"),
        row.textContent!.trim().replace("✓", "").trim(),
      ]),
    ).toEqual([
      ["downstairs", "Downstairs bar"],
      ["deli", "Deli counter"],
    ]);
    await pickZone(el, "downstairs");
    expect(seen).toEqual(["downstairs"]);
  });

  it("shows the chosen zone on first render when it is not the first listed", async () => {
    const { el } = await mountZones(deliSecond, "deli");
    expect(zoneMenu(el).querySelector('[slot="trigger"]')!.textContent).toContain("Deli counter");
    expect(selectedZone(el)).toBe("Deli counter");
  });

  it("follows the chosen zone when the app switches it after a pick", async () => {
    const { el } = await mountZones(deliSecond, "deli");
    await pickZone(el, "downstairs");
    el.selectedCounterZoneId = "downstairs";
    await el.updateComplete;
    expect(selectedZone(el)).toBe("Downstairs bar");
    el.selectedCounterZoneId = "deli";
    await el.updateComplete;
    expect(selectedZone(el)).toBe("Deli counter");
  });

  it("shows the zone the app kept on the next render after a refused pick", async () => {
    const { el } = await mountZones(deliSecond, "deli");
    await pickZone(el, "downstairs");
    el.operatorName = "Luis";
    await el.updateComplete;
    expect(selectedZone(el)).toBe("Deli counter");
  });

  it("leaves zone changes to the header while the basket has lines", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(coffee, "1");
    const { el } = await mount({ store, serviceZones: deliSecond, selectedServiceZoneId: "deli" });
    expect(el.shadowRoot!.querySelector('wt-combobox[name="service-zone"]')).toBeNull();
    expect(el.shadowRoot!.querySelector(".service-zone-refresh")).toBeNull();
    expect(el.selectedServiceZoneId).toBe("deli");
    expect(store.lines.map((line) => [line.product.id, line.quantity])).toEqual([["p1", "1"]]);
  });

  it("renders the fixed menu, basket, total and tender controls", async () => {
    const { el } = await mount();
    const grid = body(el)!;
    expect(grid).not.toBeNull();
    await grid.updateComplete;
    expect(grid.shadowRoot!.querySelector("till-menu-browser")).not.toBeNull();
    expect(grid.shadowRoot!.querySelector("till-basket")).not.toBeNull();
    expect(grid.shadowRoot!.querySelector("till-total")).not.toBeNull();
    expect(grid.shadowRoot!.querySelector("till-tender-pay")).not.toBeNull();
  });

  it("renders its fixed sale body without an authored layout", async () => {
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector("till-card-grid")).toBeNull();
    expect(el.shadowRoot!.querySelector("till-basket")).not.toBeNull();
  });

  it("renders the fixed sale body without legacy region containers", async () => {
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector(".sale-grid")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".region-main")).toBeNull();
    expect(el.shadowRoot!.querySelector(".region-aside")).toBeNull();
    expect(el.shadowRoot!.querySelector(".grid-body")).not.toBeNull();
  });

  it("passes held orders to the rendered list", async () => {
    const heldOrders = [
      {
        items: [],
        id: "wo-1",
        orderNumber: 5,
        label: "Table 4",
        counts: { ordered: 2, unsent: 0, held: 0, waiting: 0, ready: 0 },
        total: "3.00",
        outstanding: "3.00",
        hasPayments: false,
        partyId: null,
        billNumber: null,
        billName: null,
        openedAt: "2026-08-05T10:00:00.000Z",
        signals: [],
        zoneId: null,
      },
    ];
    const { el } = await mount({ heldOrders, orderList: "parked" });
    expect(heldList(el).orders).toBe(heldOrders);
  });

  it("passes the floor tables to held orders for Move to table", async () => {
    const tables = [{ id: "t9", label: "Table 9" }];
    const { el } = await mount({ tables, heldOrders: [heldOrder], orderList: "parked" } as never);
    expect(heldList(el).tables).toBe(tables);
  });

  it("coordinates menu, basket, total and payment through the same store", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mount({ store });
    for (const tag of ["till-menu-browser", "till-basket", "till-total", "till-tender-pay"])
      expect(
        (el.shadowRoot!.querySelector(tag) as HTMLElement & { store: WorkingOrderStore }).store,
      ).toBe(store);
  });

  it("passes provider, tips and card outcome to payment controls", async () => {
    const { el } = await mount({
      cardProvider: "stripe_on_device",
      tipsEnabled: true,
      cardOutcome: { outcome: "declined" },
    });
    const grid = tender(el);
    expect(grid.cardProvider).toBe("stripe_on_device");
    expect(grid.tipsEnabled).toBe(true);
    expect(grid.cardOutcome).toEqual({ outcome: "declined" });
  });

  it("passes the attempt count to payment controls", async () => {
    const { el } = await mount({ cardAttemptsOver: 3 });
    expect(tender(el).cardAttemptsOver).toBe(3);
  });

  it("passes canMoveStation to Waiting, off by default", async () => {
    expect(
      waitingList(
        (
          await mount({
            canMoveStation: true,
            counterWaiting: [waitingOrder],
            orderList: "waiting",
          })
        ).el,
      ).canMoveStation,
    ).toBe(true);
    expect(
      waitingList((await mount({ counterWaiting: [waitingOrder], orderList: "waiting" })).el)
        .canMoveStation,
    ).toBe(false);
  });

  it("defaults cardProvider 'none'/tipsEnabled false, reproducing the #62 manual path unchanged", async () => {
    const { el } = await mount();
    const grid = tender(el);
    expect(grid.cardProvider).toBe("none");
    expect(grid.tipsEnabled).toBe(false);
    expect(grid.cardOutcome).toBeUndefined();
  });

  it("passes the shown products to the menu browser", async () => {
    const { el } = await mount();
    expect(menuBrowser(el).products).toEqual(products);
  });

  const veganDish: TillProduct = {
    ...coffee,
    id: "vegan",
    name: "Ensalada",
    customerName: { es: "Ensalada para el cliente" },
    diet: UNDECLARED_DIET,
    dietaryDeclarations: ["vegan"],
  };
  const meatDish: TillProduct = {
    ...coffee,
    id: "meat",
    name: "Chuleta",
    customerName: { es: "Chuleta para el cliente" },
    diet: UNDECLARED_DIET,
    dietaryDeclarations: ["no_fish"],
  };

  it("offers Filter without a published diet so allergen exclusions stay reachable", async () => {
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector("till-diet-filter")).not.toBeNull();
  });

  it("shows the diet filter when some product carries a diet, and narrows the grid to the picked lens", async () => {
    const { el } = await mount({ products: [veganDish, meatDish] });
    const filter = el.shadowRoot!.querySelector("till-diet-filter")!;
    expect(filter).not.toBeNull();
    // Both dishes are shown before a lens is selected.
    expect(
      menuBrowser(el)
        .products.map((p) => p.id)
        .sort(),
    ).toEqual(["meat", "vegan"]);
    await userEvent.click(filter.shadowRoot!.querySelector<HTMLElement>("[data-filter-open]")!);
    await filter.updateComplete;
    await userEvent.click(
      filter.shadowRoot!.querySelector<HTMLElement>('[data-test="diet-filter-vegan"]')!,
    );
    await el.updateComplete;
    await body(el)!.updateComplete;
    const browser = body(el)!.shadowRoot!.querySelector<HTMLElement & { products: TillProduct[] }>(
      "till-menu-browser",
    )!;
    expect(browser.products.map((p) => p.id)).toEqual(["vegan"]);
  });

  it("passes menus, selected menu, diet lens and device kind to their rendered controls", async () => {
    const menus: TillZoneMenu[] = servedMenus(
      [{ id: "lunch", name: "Lunch", isDefault: true, versionId: "v1" }],
      [],
    );
    const { el } = await mount({
      menus,
      selectedMenuId: "lunch",
      selectedFilters: { diets: ["vegan"], exclude: {} },
      handheld: true,
    });
    expect(menuBrowser(el).menus).toBe(menus);
    expect(menuBrowser(el).menu!.id).toBe("lunch");
    expect(el.shadowRoot!.querySelector("till-diet-filter")!.selected).toEqual({
      diets: ["vegan"],
      exclude: {},
    });
    expect(menuBrowser(el).products).toEqual([]);
    expect(menuBrowser(el).handheld).toBe(true);
  });

  it("keeps the sale body without a retired Allergens control", async () => {
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector("wt-button.allergens")).toBeNull();
    expect(el.shadowRoot!.querySelector(".body")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".sale-grid")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("till-allergen-screen")).toBeNull();
  });
});

it("lets a held-order retrieve event reach the fixed Counter host", async () => {
  const { el } = await mountWidget<TillCounterScreen>("till-counter-screen", {
    store: new WorkingOrderStore(),
    heldOrders: [{ ...heldOrder, id: "wo-2" }],
    orderList: "parked",
  });
  let captured: CustomEvent<{ id: string }> | undefined;
  el.addEventListener(
    "retrieve-order",
    (event) => (captured = event as CustomEvent<{ id: string }>),
  );
  el.shadowRoot!.querySelector("till-held-orders")!
    .shadowRoot!.querySelector<HTMLElement>("wt-button.retrieve")!
    .click();
  expect(captured?.composed).toBe(true);
  expect(captured?.bubbles).toBe(true);
  expect(captured?.detail).toEqual({ id: "wo-2" });
});

const retirementLooks = (["en-GB", "es-ES"] as const).flatMap((locale) =>
  (["light", "dark"] as const).flatMap((theme) =>
    [390, 1280].map((width) => ({ locale, theme, width })),
  ),
);
it.each(retirementLooks)(
  "A182 LOOK fixed Counter actions $locale $theme $width",
  async ({ locale, theme, width }) => {
    const previous = currentLocale();
    try {
      setLocale(locale);
      await page.viewport(width, 900);
      for (const state of ["cash", "card", "collect", "pay-rest", "busy"] as const) {
        const store = new WorkingOrderStore();
        store.addProduct(coffee, "2");
        const { el, host } = await mountWidget<TillCounterScreen>(
          "till-counter-screen",
          {
            store,
            products,
            menus: servedMenus(
              [{ id: "cat-default", name: "Carta", isDefault: true, versionId: "v1" }],
              [],
            ),
            service: {
              open: true,
              zoneOpen: true,
              periodName: null,
              periodOccurrenceKey: null,
              keepOpen: null,
              zoneKeepOpen: null,
            },
            takesCash: true,
            stage: state === "collect" ? "collect" : "order",
            payRest: state === "pay-rest" ? "1.50" : null,
            busy: state === "busy",
          },
          theme,
        );
        const pay = tender(el);
        await pay.updateComplete;
        if (state === "cash" || state === "card") {
          const button = pay.shadowRoot!.querySelector<HTMLElement>("[data-counter-pay]")!;
          expect(button).not.toBeNull();
          await userEvent.click(button);
          await pay.updateComplete;
          expect(pay.shadowRoot!.querySelector(".pay-card")).toBeNull();
        }
        if (state === "busy") expect(pay.busy).toBe(true);
        if (state === "pay-rest")
          expect(el.shadowRoot!.querySelector("[data-counter-bill-payments]")).not.toBeNull();
        expect(window.innerWidth).toBe(width);
        expect(getComputedStyle(host).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
        pay.scrollIntoView();
        await page.screenshot({
          path: `__screenshots__/a182-actions/${state}-${locale}-${theme}-${width}.png`,
        });
        cleanupWidgets();
      }
    } finally {
      setLocale(previous);
      await page.viewport(1280, 768);
    }
  },
);

describe("eaten here or taken away", () => {
  let previous = currentLocale();
  beforeEach(() => {
    previous = currentLocale();
    setLocale("en-GB");
  });
  afterEach(() => setLocale(previous));

  const segmented = (el: TillCounterScreen) =>
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-segmented-control"]>(
      "wt-segmented-control[name='dining']",
    );
  const label = (el: TillCounterScreen) =>
    el.shadowRoot!.querySelector("[data-dining-label]")?.textContent?.trim();
  const saved = (dining: "eat_in" | "takeaway", policy: "eat_in" | "takeaway" | "till_choice") => {
    const store = new WorkingOrderStore();
    store.setDiningStart({ policy, startsAs: policy === "takeaway" ? "takeaway" : "eat_in" });
    store.loadFrom("saved", [], undefined, 1, undefined, dining);
    return store;
  };

  it("offers the switch for a draft in a department that leaves the way to the till", async () => {
    const store = new WorkingOrderStore();
    store.setDiningStart({ policy: "till_choice", startsAs: "eat_in" });
    const { el } = await mount({ store });
    const control = segmented(el)!;
    expect(control).not.toBeNull();
    expect(control.value).toBe("eat_in");
    expect(control.options.map((option) => option.label)).toEqual(["Eat here", "Take away"]);
    expect(label(el)).toBeUndefined();
  });

  it("offers the switch for a saved order the server still lets switch", async () => {
    const { el } = await mount({ store: saved("takeaway", "takeaway"), diningChoice: "open" });
    expect(segmented(el)?.value).toBe("takeaway");
  });

  it("labels a saved order whose way is locked", async () => {
    const { el } = await mount({ store: saved("takeaway", "till_choice"), diningChoice: "locked" });
    expect(segmented(el)).toBeNull();
    expect(label(el)).toBe("Take away");
  });

  it("labels a takeaway order in a takeaway department", async () => {
    const { el } = await mount({ store: saved("takeaway", "takeaway"), diningChoice: "none" });
    expect(segmented(el)).toBeNull();
    expect(label(el)).toBe("Take away");
  });

  it("shows nothing for an eat-in order in an eat-in department", async () => {
    const { el } = await mount({ store: saved("eat_in", "eat_in"), diningChoice: "none" });
    expect(segmented(el)).toBeNull();
    expect(label(el)).toBeUndefined();
  });

  it("shows nothing for an eat-in draft where the region has no distinction", async () => {
    const { el } = await mount({ store: new WorkingOrderStore() });
    expect(segmented(el)).toBeNull();
    expect(label(el)).toBeUndefined();
  });

  it("labels a takeaway order whose department now sells eaten here as Take away", async () => {
    const { el } = await mount({ store: saved("takeaway", "eat_in"), diningChoice: "none" });
    expect(segmented(el)).toBeNull();
    expect(label(el)).toBe("Take away");
  });

  it("labels an eat-in order whose department now sells taken away as Eat here", async () => {
    const { el } = await mount({ store: saved("eat_in", "takeaway"), diningChoice: "none" });
    expect(segmented(el)).toBeNull();
    expect(label(el)).toBe("Eat here");
  });

  it("words the switch in Spanish", async () => {
    const previous = currentLocale();
    try {
      setLocale("es");
      const store = new WorkingOrderStore();
      store.setDiningStart({ policy: "till_choice", startsAs: "eat_in" });
      const { el } = await mount({ store });
      expect(segmented(el)!.options.map((option) => option.label)).toEqual([
        "Para tomar aquí",
        "Para llevar",
      ]);
    } finally {
      setLocale(previous);
    }
  });

  it.each([
    ["collecting", { stage: "collect" as const }],
    ["busy", { busy: true }],
    ["sending the order", { orderInFlight: true }],
  ])("disables the switch while %s", async (_case, over) => {
    const store = new WorkingOrderStore();
    store.setDiningStart({ policy: "till_choice", startsAs: "eat_in" });
    const { el } = await mount({ store });
    expect(segmented(el)!.disabled).toBe(false);
    Object.assign(el, over);
    await el.updateComplete;
    expect(segmented(el)!.disabled).toBe(true);
  });

  it("labels Eat here as a plain chip", async () => {
    const { el } = await mount({ store: saved("eat_in", "takeaway"), diningChoice: "none" });
    const chip = el.shadowRoot!.querySelector("[data-dining-label]")!;
    expect([...chip.classList]).toEqual(["chip"]);
  });

  it("asks for Take away with the screen's dining-change event", async () => {
    const store = new WorkingOrderStore();
    store.setDiningStart({ policy: "till_choice", startsAs: "eat_in" });
    const { el } = await mount({ store });
    const changes: unknown[] = [];
    const outer: unknown[] = [];
    el.parentElement!.addEventListener("dining-change", (event) =>
      changes.push((event as CustomEvent<{ dining: string }>).detail),
    );
    el.parentElement!.addEventListener("wt-change", (event) => outer.push(event));
    const control = segmented(el)!;
    await control.updateComplete;
    await userEvent.click(
      [...control.shadowRoot!.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Take away",
      )!,
    );
    expect(changes).toEqual([{ dining: "takeaway" }]);
    expect(outer).toEqual([]);
    expect(store.dining).toBe("eat_in");
  });
});

it("Counter gives names at 1280 at least the room they get at 1024", async () => {
  try {
    await pageAt(1024, 768);
    const store = new WorkingOrderStore();
    store.addProduct(
      { ...coffee, name: "Roasted pumpkin soup with seasonal garden vegetables" },
      "2",
    );
    const { el } = await mount({ store });
    const basket = el.shadowRoot!.querySelector("till-basket")!;
    await basket.updateComplete;
    await measured();
    const name = basket.shadowRoot!.querySelector<HTMLElement>(".line .name")!;
    const narrow = name.getBoundingClientRect().width;
    await pageAt(1280, 768);
    await measured();
    expect(name.getBoundingClientRect().width).toBeGreaterThanOrEqual(narrow);
  } finally {
    await resetPage();
  }
});
