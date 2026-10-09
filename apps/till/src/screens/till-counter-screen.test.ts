import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { WtCombobox } from "@waitron/ui";
import { chooserFaces, cleanupWidgets, mountWidget, servedMenus } from "../widgets/test-helpers.js";
import { TillCounterScreen } from "./till-counter-screen.js";
import type { TabDef } from "../layout.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import type { ServiceZoneSummary, TillApi, TillProduct, TillZoneMenu } from "../api/client.js";
import type { TillAllergenScreen } from "./till-allergen-screen.js";

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
    counterTab,
    operatorName: "Ana",
    ...over,
  });

const cardGrid = (el: TillCounterScreen) =>
  el.shadowRoot!.querySelector<
    HTMLElement & {
      updateComplete: Promise<unknown>;
      tab?: TabDef;
      store: unknown;
      products: TillProduct[];
      menus: unknown;
      selectedMenuId: string;
      selectedDiet: unknown;
      handheld: boolean;
      heldOrders: unknown;
      tables: unknown;
      stationQueue: unknown;
      defaultStationId?: string;
      cardProvider: string;
      tipsEnabled: boolean;
      cardOutcome?: string;
      cardAttemptsOver: number;
    }
  >("till-card-grid");

/** The text the dropdown's closed box shows, which is the chosen zone's name. */
async function shownText(select: WtCombobox): Promise<string> {
  await select.updateComplete;
  return select.shadowRoot!.querySelector(".value")!.textContent!.trim();
}

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
        service: { open: true, zoneOpen: false, periodName: "Lunch" },
      });
      expect(el.shadowRoot!.querySelector("[data-zone-closed]")?.textContent?.trim()).toBe(
        "Terrace is closed: nothing new can be ordered here. Bills can be paid or moved to another area.",
      );
      const cards = cardGrid(el)!;
      await cards.updateComplete;
      expect(cards.shadowRoot!.querySelector("till-menu-browser")).toBeNull();
      expect(el.shadowRoot!.querySelector("till-menu-switcher")).toBeNull();
      expect(cards.shadowRoot!.querySelector("till-basket")).not.toBeNull();
      expect(store.lines.map((line) => [line.product.id, line.quantity])).toEqual([["p1", "2"]]);
      el.service = { open: true, zoneOpen: true, periodName: "Lunch" };
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

  it("shows the effective service zone and emits zone changes and manual refreshes", async () => {
    const serviceZones: ServiceZoneSummary[] = [
      {
        id: "upstairs",
        name: "Upstairs bar",
        departmentId: "bar",
        departmentName: "Bar",
        serviceMode: "prepay",
      },
      {
        id: "downstairs",
        name: "Downstairs bar",
        departmentId: "bar",
        departmentName: "Bar",
        serviceMode: "prepay",
      },
    ];
    const { el } = await mount({ serviceZones, selectedServiceZoneId: "upstairs" });
    const seen: string[] = [];
    el.addEventListener("counter-zone-selected", (event) =>
      seen.push((event as CustomEvent<{ zoneId: string }>).detail.zoneId),
    );
    const select = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[name="service-zone"]')!;
    expect(select.value).toBe("upstairs");
    expect(select.label).toContain(t("service_zone.label"));
    await select.updateComplete;
    const shownLabel = select.shadowRoot!.querySelector<HTMLElement>(".field-label-text");
    expect(shownLabel?.textContent).toContain(t("service_zone.label"));
    expect(shownLabel!.checkVisibility()).toBe(true);

    await chooseOption(select, "downstairs");
    el.shadowRoot!.querySelector<HTMLElement>(".service-zone-refresh")!.click();
    expect(seen).toEqual(["downstairs", "upstairs"]);
  });

  it("picks the service zone from the shared dropdown, labelled and searchable in the till's language", async () => {
    const { el } = await mount({ serviceZones: deliSecond, selectedServiceZoneId: "deli" });
    const seen: string[] = [];
    el.addEventListener("counter-zone-selected", (event) =>
      seen.push((event as CustomEvent<{ zoneId: string }>).detail.zoneId),
    );
    const zone = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[name="service-zone"]');
    expect(zone).not.toBeNull();
    expect(zone!.label).toBe(t("service_zone.label"));
    expect(zone!.getAttribute("search")).toBe("auto");
    expect(zone!.searchPlaceholder).toBe(t("form.combobox_search"));
    expect(zone!.noResultsLabel).toBe(t("form.combobox_no_results"));
    expect(zone!.options).toEqual([
      { value: "downstairs", label: "Downstairs bar" },
      { value: "deli", label: "Deli counter" },
    ]);
    expect(zone!.value).toBe("deli");

    await chooseOption(zone!, "downstairs");
    expect(seen).toEqual(["downstairs"]);
  });

  it("shows the chosen service zone on first render when it is not the first zone listed", async () => {
    const { el } = await mount({ serviceZones: deliSecond, selectedServiceZoneId: "deli" });
    const select = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[name="service-zone"]')!;
    expect(await shownText(select)).toBe("Deli counter");
  });

  it("follows the chosen service zone when the app switches it after a pick", async () => {
    const { el } = await mount({ serviceZones: deliSecond, selectedServiceZoneId: "deli" });
    const select = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[name="service-zone"]')!;
    await chooseOption(select, "downstairs");
    el.selectedServiceZoneId = "downstairs";
    await el.updateComplete;
    expect(await shownText(select)).toBe("Downstairs bar");

    el.selectedServiceZoneId = "deli";
    await el.updateComplete;
    expect(await shownText(select)).toBe("Deli counter");
  });

  it("shows the zone the till serves again on its next render when the app kept it", async () => {
    const { el } = await mount({ serviceZones: deliSecond, selectedServiceZoneId: "deli" });
    const select = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[name="service-zone"]')!;
    await chooseOption(select, "downstairs");
    el.operatorName = "Luis";
    await el.updateComplete;
    expect(select.value).toBe("deli");
  });

  it("keeps the service zone fixed while the basket has lines", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "1");
    const serviceZones: ServiceZoneSummary[] = [
      {
        id: "upstairs",
        name: "Upstairs bar",
        departmentId: "bar",
        departmentName: "Bar",
        serviceMode: "prepay",
      },
      {
        id: "downstairs",
        name: "Downstairs bar",
        departmentId: "bar",
        departmentName: "Bar",
        serviceMode: "prepay",
      },
    ];
    const { el } = await mount({ store, serviceZones, selectedServiceZoneId: "upstairs" });
    const spy = vi.fn();
    el.addEventListener("counter-zone-selected", spy);
    const select = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[name="service-zone"]')!;
    await chooseOption(select, "downstairs");
    el.shadowRoot!.querySelector<HTMLElement>(".service-zone-refresh")!.click();

    expect(select.value).toBe("upstairs");
    expect(await shownText(select)).toBe("Upstairs bar");
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0].detail).toEqual({ zoneId: "downstairs" });
  });

  // A counter tab must ALWAYS yield the four sale-critical cards.
  it("renders the counter tab's sale-critical cards (product-grid/basket/total/tender-pay) via the card grid", async () => {
    const { el } = await mount();
    const grid = cardGrid(el)!;
    expect(grid).not.toBeNull();
    await grid.updateComplete;
    expect(grid.shadowRoot!.querySelector("till-menu-browser")).not.toBeNull();
    expect(grid.shadowRoot!.querySelector("till-basket")).not.toBeNull();
    expect(grid.shadowRoot!.querySelector("till-total")).not.toBeNull();
    expect(grid.shadowRoot!.querySelector("till-tender-pay")).not.toBeNull();
  });

  it("threads the counter tab through to the card grid", async () => {
    const { el } = await mount();
    expect(cardGrid(el)!.tab).toBe(counterTab);
  });

  it("renders the grid body and NONE of the legacy region containers (region model removed)", async () => {
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector("till-card-grid")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".region-main")).toBeNull();
    expect(el.shadowRoot!.querySelector(".region-aside")).toBeNull();
    expect(el.shadowRoot!.querySelector(".grid-body")).not.toBeNull();
  });

  it("threads the default station's queue (and station id) through to the card grid", async () => {
    const stationQueue = [
      {
        orderId: "wo-1",
        orderNumber: 5,
        label: "Mesa 4",
        queuedAt: "2026-08-17T10:00:00.000Z",
        status: "settled" as const,
        thresholds: { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 },
        items: [
          {
            id: "ti-1",
            workingOrderLineId: "wol-1",
            state: "queued" as const,
            name: "Paella",
            quantity: "2.000",
            course: null,
            firedAt: "2026-08-17T10:00:00.000Z",
          },
        ],
      },
    ];
    const { el } = await mount({ stationQueue, defaultStationId: "st-1" });
    const grid = cardGrid(el)!;
    expect(grid.stationQueue).toBe(stationQueue);
    expect(grid.defaultStationId).toBe("st-1");
  });

  it("threads the held-orders list through to the card grid", async () => {
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
    expect(cardGrid(el)!.heldOrders).toBe(heldOrders);
  });

  it("threads the floor's tables through to the card grid, for a held order's Move to table", async () => {
    const tables = [{ id: "t9", label: "Mesa 9" }];
    const { el } = await mount({ tables } as never);
    expect(cardGrid(el)!.tables).toBe(tables);
  });

  it("passes the SAME store instance to the card grid (which coordinates the cards through it)", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mount({ store });
    expect(cardGrid(el)!.store).toBe(store);
  });

  it("threads cardProvider, tipsEnabled and cardOutcome through to the card grid (Task 9)", async () => {
    const { el } = await mount({
      cardProvider: "stripe_on_device",
      tipsEnabled: true,
      cardOutcome: "declined",
    });
    const grid = cardGrid(el)!;
    expect(grid.cardProvider).toBe("stripe_on_device");
    expect(grid.tipsEnabled).toBe(true);
    expect(grid.cardOutcome).toBe("declined");
  });

  it("threads cardAttemptsOver through to the card grid", async () => {
    const { el } = await mount({ cardAttemptsOver: 3 });
    expect(cardGrid(el)!.cardAttemptsOver).toBe(3);
  });

  it("defaults cardProvider 'none'/tipsEnabled false, reproducing the #62 manual path unchanged", async () => {
    const { el } = await mount();
    const grid = cardGrid(el)!;
    expect(grid.cardProvider).toBe("none");
    expect(grid.tipsEnabled).toBe(false);
    expect(grid.cardOutcome).toBeUndefined();
  });

  it("passes the products through to the card grid", async () => {
    const { el } = await mount();
    // With no menu selected and no diet lens, the visible set is the whole product list (same ref).
    expect(cardGrid(el)!.products).toBe(products);
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

  it("shows NO diet filter when no product carries a published diet", async () => {
    const { el } = await mount(); // cafe only — no diet
    expect(el.shadowRoot!.querySelector("till-diet-filter")).toBeNull();
  });

  it("shows the diet filter when some product carries a diet, and narrows the grid to the picked lens", async () => {
    const { el } = await mount({ products: [veganDish, meatDish] });
    const filter = el.shadowRoot!.querySelector("till-diet-filter")!;
    expect(filter).not.toBeNull();
    // Both dishes are handed to the grid before any lens.
    expect(
      cardGrid(el)!
        .products.map((p) => p.id)
        .sort(),
    ).toEqual(["meat", "vegan"]);
    filter.shadowRoot!.querySelector<HTMLElement>('[data-test="diet-filter-vegan"]')!.click();
    await el.updateComplete;
    await cardGrid(el)!.updateComplete;
    const browser = cardGrid(el)!.shadowRoot!.querySelector<
      HTMLElement & { products: TillProduct[] }
    >("till-menu-browser")!;
    expect(browser.products.map((p) => p.id)).toEqual(["vegan"]);
  });

  it("hands the card grid the menus, the selected menu, the diet lens and the form factor", async () => {
    const menus: TillZoneMenu[] = servedMenus(
      [{ id: "lunch", name: "Lunch", isDefault: true, versionId: "v1" }],
      [],
    );
    const { el } = await mount({
      menus,
      selectedMenuId: "lunch",
      selectedDiet: "vegan",
      handheld: true,
    });
    expect(cardGrid(el)!.menus).toBe(menus);
    expect(cardGrid(el)!.selectedMenuId).toBe("lunch");
    expect(cardGrid(el)!.selectedDiet).toBe("vegan");
    expect(cardGrid(el)!.handheld).toBe(true);
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

  it("labels the Allergens control with the localised action and shows the sale body by default", async () => {
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector("wt-button.allergens")!.textContent).toContain(
      t("allergens.open"),
    );
    expect(el.shadowRoot!.querySelector(".body")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("till-card-grid")).not.toBeNull();
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

  it("tapping Allergens swaps the sale body for the allergen screen, passing products/locale/invoiceLocale", async () => {
    const { el } = await mount({ invoiceLocale: "en" });
    el.shadowRoot!.querySelector<HTMLElement>("wt-button.allergens")!.click();
    await el.updateComplete;
    const screen = el.shadowRoot!.querySelector<TillAllergenScreen>("till-allergen-screen");
    expect(screen).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".body")).toBeNull();
    expect(el.shadowRoot!.querySelector("till-card-grid")).toBeNull();
    expect(screen!.products).toBe(products);
    expect(screen!.locale).toBe(currentLocale());
    expect(screen!.invoiceLocale).toBe("en");
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
    const faces = await chooserFaces(el.shadowRoot!.querySelector("wt-language-chooser")!);
    expect(faces.wide).toEqual({ shown: ["Español"], name: "Español" });
    expect(faces.phone).toEqual({ shown: ["ES"], name: "Español" });
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

  it("returns to the sale body when the allergen screen asks to close", async () => {
    const { el } = await mount();
    el.shadowRoot!.querySelector<HTMLElement>("wt-button.allergens")!.click();
    await el.updateComplete;
    const screen = el.shadowRoot!.querySelector("till-allergen-screen")!;
    screen.dispatchEvent(new CustomEvent("close-allergens", { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-allergen-screen")).toBeNull();
    expect(el.shadowRoot!.querySelector(".body")).not.toBeNull();
  });

  it("suppresses its own header when embedded (chrome lives in the shell)", async () => {
    const { el } = await mount({ embedded: true });
    expect(el.shadowRoot!.querySelector(".header")).toBeNull();
    expect(el.shadowRoot!.querySelector(".body")).not.toBeNull();
  });
});
