import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { TillShell } from "../widgets/till-shell.js";
import {
  expectChooserFaces,
  cleanupWidgets,
  mountWidget,
  servedMenus,
} from "../widgets/test-helpers.js";
import { TillCounterScreen } from "./till-counter-screen.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import type { ServiceZoneSummary, TillApi, TillProduct, TillZoneMenu } from "../api/client.js";

const cafe: TillProduct = {
  id: "p1",
  catalogueId: "cat-default",
  name: "Café",
  customerName: { es: "Café para el cliente" },
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
};

const products: TillProduct[] = [cafe];

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
    operatorName: "Ana",
    ...over,
  });

const body = (el: TillCounterScreen) => el;
const tender = (el: TillCounterScreen) => el.shadowRoot!.querySelector("till-tender-pay")!;
const menuBrowser = (el: TillCounterScreen) => el.shadowRoot!.querySelector("till-menu-browser")!;
const waitingList = (el: TillCounterScreen) =>
  el.shadowRoot!.querySelector("till-counter-waiting")!;
const heldList = (el: TillCounterScreen) => el.shadowRoot!.querySelector("till-held-orders")!;
const heldOrder = {
  id: "held",
  orderNumber: 1,
  label: "Ana",
  itemCount: 1,
  total: "1.50",
  outstanding: "1.50",
  hasPayments: false,
  partyId: null,
  openedAt: "2026-10-16T10:00:00.000Z",
  signals: [],
};
const waitingOrder = {
  id: "waiting",
  orderNumber: 2,
  label: "Luis",
  status: "settled" as const,
  openedAt: "2026-10-16T10:00:00.000Z",
  settledAt: "2026-10-16T10:01:00.000Z",
  collectedAt: null,
  total: "1.50",
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

describe("closed zone ordering", () => {
  it("replaces add controls with the area notice and retains the counter basket", async () => {
    const previous = currentLocale();
    try {
      setLocale("en-GB");
      const store = new WorkingOrderStore();
      store.addProduct(cafe, "2");
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
    store.addProduct(cafe, "1");
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

  it("keeps the non-default prep-queue rail out of fixed Counter", async () => {
    const { el } = await mount({ defaultStationId: "st-1" });
    expect(el.shadowRoot!.querySelector("till-station-queue")).toBeNull();
    expect(el.shadowRoot!.querySelector("till-basket")).not.toBeNull();
  });

  it("passes held orders to the rendered list", async () => {
    const heldOrders = [
      {
        id: "wo-1",
        orderNumber: 5,
        label: "Mesa 4",
        itemCount: 2,
        total: "3.00",
        outstanding: "3.00",
        hasPayments: false,
        partyId: null,
        openedAt: "2026-08-05T10:00:00.000Z",
        signals: [],
      },
    ];
    const { el } = await mount({ heldOrders });
    expect(heldList(el).orders).toBe(heldOrders);
  });

  it("passes the floor tables to held orders for Move to table", async () => {
    const tables = [{ id: "t9", label: "Mesa 9" }];
    const { el } = await mount({ tables, heldOrders: [heldOrder] } as never);
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
      waitingList((await mount({ canMoveStation: true, counterWaiting: [waitingOrder] })).el)
        .canMoveStation,
    ).toBe(true);
    expect(waitingList((await mount({ counterWaiting: [waitingOrder] })).el).canMoveStation).toBe(
      false,
    );
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
    ...cafe,
    id: "vegan",
    name: "Ensalada",
    customerName: { es: "Ensalada para el cliente" },
    diet: { vegan: "yes", vegetarian: "yes", contains: [] },
  };
  const meatDish: TillProduct = {
    ...cafe,
    id: "meat",
    name: "Chuleta",
    customerName: { es: "Chuleta para el cliente" },
    diet: { vegan: "no", vegetarian: "no", contains: ["meat"] },
  };

  it("offers Filter without a published diet so allergen exclusions stay reachable", async () => {
    const { el } = await mount(); // cafe only — no diet
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

  it("shows the logged-in operator name in the header", async () => {
    const { el } = await mount({ operatorName: "Bruno" });
    expect(el.shadowRoot!.querySelector(".operator")!.textContent).toContain("Bruno");
  });

  it("labels the Log out control with the localised action", async () => {
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector("wt-button.logout")!.textContent).toContain(
      t("action.logout"),
    );
  });

  it("emits a composed logout event when Log out is tapped", async () => {
    const { el } = await mount();
    let captured: Event | undefined;
    el.addEventListener("logout", (event) => (captured = event));
    el.shadowRoot!.querySelector<HTMLElement>("wt-button.logout")!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
  });

  it("labels and emits a composed, bubbling show-schedule event when My schedule is tapped", async () => {
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector("wt-button.schedule")!.textContent).toContain(
      t("schedule.open"),
    );
    let captured: Event | undefined;
    el.addEventListener("show-schedule", (event) => (captured = event));
    el.shadowRoot!.querySelector<HTMLElement>("wt-button.schedule")!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("labels and emits a composed, bubbling show-floor event when Sala is tapped (FP-1)", async () => {
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector("wt-button.floor")!.textContent).toContain(t("floor.open"));
    let captured: Event | undefined;
    el.addEventListener("show-floor", (event) => (captured = event));
    el.shadowRoot!.querySelector<HTMLElement>("wt-button.floor")!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("labels and emits a composed, bubbling show-expo event when Pass is tapped (KDS-3)", async () => {
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector("wt-button.expo")!.textContent).toContain(t("expo.open"));
    let captured: Event | undefined;
    el.addEventListener("show-expo", (event) => (captured = event));
    el.shadowRoot!.querySelector<HTMLElement>("wt-button.expo")!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("labels and emits a composed, bubbling show-station event when the station control is tapped", async () => {
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector("wt-button.station")!.textContent).toContain(
      t("station.open"),
    );
    let captured: CustomEvent | undefined;
    el.addEventListener("show-station", (event) => (captured = event as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>("wt-button.station")!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.detail).toBeNull();
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("feeds the header's language chooser from the venue's locale list", async () => {
    const getLocales = vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "es-ES",
    });
    const { el } = await mount({ api: { getLocales } as unknown as TillApi });
    const chooser = el.shadowRoot!.querySelector("wt-language-chooser")!;
    chooser.shadowRoot!.querySelector<HTMLElement>('[data-test="lang-trigger"]')!.click();
    await vi.waitFor(() => {
      const menu = chooser.shadowRoot!.querySelector('[role="menu"]');
      expect(menu?.textContent).toContain("English");
    });
    expect(getLocales).toHaveBeenCalledTimes(1);
  });

  it("keeps the sale body without a retired Allergens control", async () => {
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector("wt-button.allergens")).toBeNull();
    expect(el.shadowRoot!.querySelector(".body")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".sale-grid")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("till-allergen-screen")).toBeNull();
  });

  it("offers Equipment in its own header, emitting open-equipment", async () => {
    const { el } = await mount();
    const equipment = el.shadowRoot!.querySelector<HTMLElement>("wt-button.equipment")!;
    expect(equipment.textContent).toContain(t("equipment.open"));
    let fired = 0;
    el.addEventListener("open-equipment", () => (fired += 1));
    equipment.click();
    expect(fired).toBe(1);
  });

  it("puts the language chooser in its own header, just before the operator's name", async () => {
    const { el } = await mount();
    const chooser = el.shadowRoot!.querySelector("wt-language-chooser")!;
    expect(chooser).not.toBeNull();
    expect(chooser.parentElement).toBe(el.shadowRoot!.querySelector(".header .session"));
    expect(chooser.nextElementSibling).toBe(el.shadowRoot!.querySelector(".operator"));
  });

  it("shows the language's full name at 1280 wide and its short code at 390, always named in full", async () => {
    setLocale("es-ES");
    const { el } = await mount();
    await expectChooserFaces(el.shadowRoot!.querySelector("wt-language-chooser")!, {
      wide: { shown: ["Español"], name: "Español" },
      phone: { shown: ["ES"], name: "ES Español" },
    });
  });

  it("draws no language chooser when embedded (the shell owns it)", async () => {
    const { el } = await mount({ embedded: true });
    expect(el.shadowRoot!.querySelector("wt-language-chooser")).toBeNull();
  });

  it("updates the standalone counter's chooser when the till locale changes", async () => {
    setLocale("es-ES");
    try {
      const { el } = await mount();
      setLocale("en-GB");
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("wt-language-chooser")!.getAttribute("active")).toBe(
        "en-GB",
      );
    } finally {
      setLocale("es-ES");
    }
  });

  it("lets the chooser's wt-locale-selected bubble out composed (the screen does NOT handle it)", async () => {
    const { el } = await mount();
    const spy = vi.fn();
    el.addEventListener("wt-locale-selected", (e) => spy((e as CustomEvent).detail));
    const chooser = el.shadowRoot!.querySelector("wt-language-chooser")!;
    chooser.dispatchEvent(
      new CustomEvent("wt-locale-selected", {
        detail: { code: "en-GB" },
        bubbles: true,
        composed: true,
      }),
    );
    expect(spy).toHaveBeenCalledWith({ code: "en-GB" });
  });

  it("suppresses its own header when embedded (chrome lives in the shell)", async () => {
    const { el } = await mount({ embedded: true });
    expect(el.shadowRoot!.querySelector(".header")).toBeNull();
    expect(el.shadowRoot!.querySelector(".body")).not.toBeNull();
  });
});

it("lets a held-order retrieve event reach the fixed Counter host", async () => {
  const { el } = await mountWidget<TillCounterScreen>("till-counter-screen", {
    store: new WorkingOrderStore(),
    heldOrders: [{ ...heldOrder, id: "wo-2" }],
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
        store.addProduct(cafe, "2");
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
          const button = pay.shadowRoot!.querySelector<HTMLElement>(
            state === "cash" ? ".pay" : ".pay-card",
          )!;
          expect(button).not.toBeNull();
          await userEvent.click(button);
          await pay.updateComplete;
          expect(pay.shadowRoot!.querySelector(".confirm")).not.toBeNull();
        }
        if (state === "busy") expect(pay.busy).toBe(true);
        if (state === "pay-rest")
          expect(el.shadowRoot!.querySelector("[data-pay-rest]")).not.toBeNull();
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
