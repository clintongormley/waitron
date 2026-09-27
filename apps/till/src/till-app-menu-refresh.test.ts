import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import { setLocale } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillTenderPay } from "./widgets/tender-pay.js";
import type { TillBasketRefreshDialog } from "./widgets/basket-refresh-dialog.js";
import type { TillMenuBrowser } from "./widgets/menu-browser.js";
import type { CanvasDef, CapabilityFlag } from "./layout.js";
import type {
  MenuState,
  MenuUnavailable,
  TillApi,
  TillMenuOffer,
  TillSaleResult,
  ZoneOfferCatalogue,
} from "./api/client.js";

// Lunch is published as v1 and then as v2. Lemonade and Burger are on it; Burger offers an extras list
// (cheese) and an options list (rare / medium).

const unit = {
  id: "unit-each",
  name: { es: "unidad", en: "unit" },
  abbreviation: { es: "ud", en: "ea" },
  precision: 0,
  hardwareUnit: null,
};

function offer(
  id: string,
  productId: string,
  unitPrice: string,
  extra: Partial<TillMenuOffer> = {},
) {
  return {
    id,
    menuId: "lunch",
    productId,
    grossPrice: null,
    unitPrice,
    active: true,
    available: true,
    image: null,
    description: null,
    menuName: "Lunch",
    placements: [[]],
    name: productId,
    customerName: { es: `${productId} carta` },
    kitchenName: `${productId} KDS`,
    unit,
    vatClass: "general",
    category: null,
    allergens: null,
    diet: null,
    dietDerivation: null,
    dietOverride: null,
    dietaryDeclarations: [],
    courseId: null,
    offeredModifiers: [],
    variants: [],
    ...extra,
  } satisfies TillMenuOffer;
}

function burgerOffer(cheesePrice = "1.00"): TillMenuOffer {
  return offer("offer-burger", "Burger", "9.00", {
    offeredModifiers: [
      {
        kind: "extras",
        id: "list-extras",
        name: "Extras",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: null,
        items: [
          {
            productId: "cheese",
            name: "Extra cheese",
            customerName: null,
            kitchenName: null,
            price: cheesePrice,
            vatClass: "general",
            maxQuantity: 1,
            preselected: false,
            addAllergens: null,
            suitableFor: [],
            image: null,
            available: true,
          },
        ],
      },
      {
        kind: "options",
        id: "list-cooked",
        name: "Cooked",
        customerName: null,
        kitchenName: null,
        defaultLabelId: null,
        labels: [
          { id: "rare", name: "Rare", customerName: null, kitchenName: null, available: true },
          { id: "medium", name: "Medium", customerName: null, kitchenName: null, available: true },
        ],
      },
    ],
  });
}

function catalogue(version: string, offers: TillMenuOffer[]): ZoneOfferCatalogue {
  return {
    context: { zoneId: "zone-counter", departmentId: "department-bar", serviceMode: "prepay" },
    defaultMenuId: "lunch",
    menus: [
      {
        id: "lunch",
        name: "Lunch",
        isDefault: true,
        versionId: version,
        structure: {
          members: offers.map((each) => ({
            kind: "product" as const,
            menuItemId: each.id,
            productId: each.productId,
          })),
        },
        homeLayouts: [{ id: "layout-home", name: "Home", tiles: [] }],
        defaultHomeLayoutId: "layout-home",
        homeLayoutId: "layout-home",
        layoutFallback: null,
      },
    ],
    offers,
  };
}

const V1 = catalogue("v1", [offer("offer-lemonade", "Lemonade", "3.00"), burgerOffer()]);

const NOTHING: MenuUnavailable = { products: [], optionLabels: [], extraItems: [] };

function menuState(version: string, unavailable: Partial<MenuUnavailable> = {}): MenuState {
  return {
    menus: [
      { menuId: "lunch", versionId: version, homeLayoutId: "layout-home", layoutFallback: null },
    ],
    unavailable: { ...NOTHING, ...unavailable },
  };
}

const saleResult: TillSaleResult = {
  orderLabel: null,
  orderNumber: 1,
  invoiceNumber: "F-0001",
  issuedAt: "2026-09-26T10:00:00.000Z",
  total: "3.00",
  vatBreakdown: [{ rate: "21", base: "2.48", tax: "0.52" }],
  lines: [{ descriptions: { "es-ES": "Lemonade" }, quantity: "1", gross: "3.00" }],
  tender: { method: "cash", change: "2.00" },
  qr: "https://example.test/vf",
};

const canvas: CanvasDef = {
  formFactor: "till",
  tabs: [
    {
      key: "counter",
      title: "Counter",
      columns: 12,
      cards: [
        { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} },
        { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
        { type: "tender-pay", colSpan: 4, rowSpan: 2, config: {} },
      ],
    },
  ],
};

const till = {
  locale: "en-GB",
  invoiceLocale: "es-ES",
  venueName: "Bar Pepe",
  nif: "B12345678",
  orderFlow: "prepay" as const,
  receiptPrintMode: "auto" as const,
  bumpMode: "line" as const,
  fireControl: "waiter" as const,
  courses: [],
  cardProvider: "none" as const,
  tipsEnabled: false,
  canvas,
  capabilities: ["print-receipt"] as CapabilityFlag[],
  inactivityTimeoutSeconds: null,
  nodeId: "n1",
  servers: [],
};

let api: Record<string, ReturnType<typeof vi.fn>>;
function stubApi(overrides: Record<string, unknown> = {}) {
  return {
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getTill: vi.fn().mockResolvedValue(till),
    getLocales: vi.fn().mockResolvedValue({ locales: [], venueDefault: "es-ES" }),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "till-dev",
      name: "Till 1",
      formFactor: "till",
      stationId: null,
    }),
    listStaff: vi.fn().mockResolvedValue([]),
    listDefaultZoneOffers: vi.fn().mockResolvedValue(V1),
    listZoneOffers: vi.fn().mockResolvedValue(V1),
    menuState: vi.fn().mockResolvedValue(menuState("v1")),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    recordSale: vi.fn().mockResolvedValue(saleResult),
    parkOrder: vi.fn().mockResolvedValue({ id: "wo-1", orderNumber: 5 }),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as Record<string, ReturnType<typeof vi.fn>>;
}

function fakeSessionActivity() {
  return {
    configure: vi.fn(),
    noteInteraction: vi.fn(),
    reacquire: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

async function mountApp(overrides: Record<string, unknown> = {}, props: Partial<TillApp> = {}) {
  api = stubApi(overrides);
  return mountWidget<TillApp>("till-app", { api: api as unknown as TillApi, ...props });
}

/** Settles awaited API promises (the real `setTimeout` is not faked) and Lit's render. */
async function flush(el: TillApp): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}

/** One poll tick: only `setInterval` is faked, so every other wait in the app keeps real time. */
async function poll(el: TillApp): Promise<void> {
  vi.advanceTimersByTime(15_000);
  await flush(el);
}

function emit(source: Element, type: string, detail?: unknown): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

const lock = (el: TillApp) => el.shadowRoot!.querySelector<TillLockScreen>("till-lock-screen");
const counter = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
const grid = (el: TillApp) =>
  counter(el).shadowRoot!.querySelector<HTMLElement>("till-card-grid")!.shadowRoot!;
const tenderPay = (el: TillApp) => grid(el).querySelector<TillTenderPay>("till-tender-pay")!;
const payButton = (el: TillApp) =>
  tenderPay(el).shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(".pay")!;
const tile = (el: TillApp, name: string) =>
  [
    ...grid(el)
      .querySelector("till-menu-browser")!
      .shadowRoot!.querySelectorAll<HTMLElement & { disabled: boolean }>("wt-button"),
  ].find((button) => button.querySelector(".name")!.textContent === name)!;
const dialog = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillBasketRefreshDialog>("till-basket-refresh-dialog");
const dialogText = (el: TillApp) =>
  (dialog(el)!.shadowRoot!.textContent ?? "").replace(/\s+/g, " ");
const banner = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>(".error");

async function toCounter(el: TillApp): Promise<TillCounterScreen> {
  await flush(el);
  emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
  await flush(el);
  return counter(el);
}

/** Adds the counter's own product for `productId`, as a tap on its tile would. */
function add(el: TillApp, productId: string, selection = {}): void {
  const c = counter(el);
  c.store.addProduct(
    c.products.find((product) => product.productId === productId)!,
    "1",
    selection,
  );
}

async function pay(el: TillApp): Promise<void> {
  emit(counter(el), "confirm-payment", { method: "cash", amount: "20" });
  await flush(el);
}

beforeEach(() => {
  setLocale("en-GB");
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});
afterEach(() => {
  cleanupWidgets();
  vi.useRealTimers();
  sessionStorage.removeItem("waitron.lastMenu");
});

describe("the till's menu-state poll", () => {
  it("reads the counter zone's menu state every 15 seconds only while an operator is signed in", async () => {
    const { el } = await mountApp();
    await flush(el);
    await poll(el);
    expect(api.menuState).not.toHaveBeenCalled();

    await toCounter(el);
    await poll(el);
    expect(api.menuState).toHaveBeenCalledOnce();
    expect(api.menuState.mock.calls[0]![0]).toBe("zone-counter");

    emit(counter(el), "logout");
    await flush(el);
    await poll(el);
    await poll(el);
    expect(api.menuState).toHaveBeenCalledOnce();
  });

  it("stops after a session.required answer, as after a sign-out", async () => {
    const { el } = await mountApp({
      menuState: vi.fn().mockRejectedValue({ code: "session.required", status: 401 }),
    });
    await toCounter(el);
    await poll(el);
    await poll(el);
    await poll(el);
    expect(api.menuState).toHaveBeenCalledOnce();
  });

  it("makes no activity of its own, so it cannot keep a till signed in", async () => {
    const sessionActivity = fakeSessionActivity();
    const { el } = await mountApp({}, { sessionActivity: sessionActivity as never });
    await toCounter(el);
    sessionActivity.noteInteraction.mockClear();
    await poll(el);
    expect(api.menuState).toHaveBeenCalledOnce();
    expect(sessionActivity.noteInteraction).not.toHaveBeenCalled();
  });
});

describe("the unavailable set", () => {
  it("greys Burger within one poll without reloading the offers, and restores it when it is back", async () => {
    const { el } = await mountApp();
    await toCounter(el);
    expect(tile(el, "Burger").disabled).toBe(false);

    api.menuState.mockResolvedValue(menuState("v1", { products: ["Burger"] }));
    await poll(el);
    expect(tile(el, "Burger").disabled).toBe(true);
    expect(tile(el, "Lemonade").disabled).toBe(false);
    expect(api.listDefaultZoneOffers).toHaveBeenCalledOnce();
    expect(api.listZoneOffers).not.toHaveBeenCalled();

    api.menuState.mockResolvedValue(menuState("v1"));
    await poll(el);
    expect(tile(el, "Burger").disabled).toBe(false);
  });

  it.each([
    ["the dish", { products: ["Burger"] }, {}, "unavailable"],
    [
      "an option label it answers",
      { optionLabels: ["rare"] },
      { options: [{ listId: "list-cooked", labelId: "rare" }] },
      "extra_unavailable",
    ],
    [
      "an extras item its offer switched off",
      {
        extraItems: [
          { menuItemId: "offer-burger", extraListId: "list-extras", productId: "cheese" },
        ],
      },
      {
        extras: [
          {
            listId: "list-extras",
            productId: "cheese",
            name: "Extra cheese",
            price: "1.00",
            quantity: 1,
          },
        ],
      },
      "extra_unavailable",
    ],
  ])(
    "blocks a Burger already in the basket when %s cannot be sold, and clears it when it can",
    async (_what, unavailable, selection, reason) => {
      const { el } = await mountApp();
      await toCounter(el);
      add(el, "Burger", selection);
      await flush(el);
      expect(payButton(el).disabled).toBe(false);

      api.menuState.mockResolvedValue(menuState("v1", unavailable));
      await poll(el);
      expect(counter(el).store.lines[0]!.blocked).toBe(reason);
      expect(payButton(el).disabled).toBe(true);

      api.menuState.mockResolvedValue(menuState("v1"));
      await poll(el);
      expect(counter(el).store.lines[0]!.blocked).toBeUndefined();
      expect(payButton(el).disabled).toBe(false);
      expect(api.listZoneOffers).not.toHaveBeenCalled();
    },
  );
});

describe("a basket that spans a publish", () => {
  it("adopts v2 silently when only a line the basket does not hold changed, keeping the lines", async () => {
    const { el } = await mountApp({
      listZoneOffers: vi
        .fn()
        .mockResolvedValue(
          catalogue("v2", [offer("offer-lemonade", "Lemonade", "3.00"), burgerOffer("1.20")]),
        ),
    });
    await toCounter(el);
    add(el, "Lemonade");
    api.menuState.mockResolvedValue(menuState("v2"));
    await poll(el);

    expect(api.listZoneOffers).toHaveBeenCalledWith("zone-counter");
    expect(dialog(el)).toBeNull();
    expect(
      counter(el).store.lines.map((line) => [line.product.name, line.product.unitPrice]),
    ).toEqual([["Lemonade", "3.00"]]);
    expect(payButton(el).disabled).toBe(false);
    await pay(el);
    expect(api.recordSale.mock.calls[0]![0]).toEqual([
      { menuItemId: "offer-lemonade", menuVersionId: "v2", quantity: "1" },
    ]);
  });

  it("shows Lemonade €3.00 → €2.50 and waits; confirming re-prices it and the next request asserts v2", async () => {
    const { el } = await mountApp({
      listZoneOffers: vi
        .fn()
        .mockResolvedValue(
          catalogue("v2", [offer("offer-lemonade", "Lemonade", "2.50"), burgerOffer()]),
        ),
    });
    await toCounter(el);
    add(el, "Lemonade");
    api.menuState.mockResolvedValue(menuState("v2"));
    await poll(el);

    expect(dialogText(el)).toContain("Lemonade €3.00 → €2.50");
    expect(counter(el).store.lines[0]!.product.unitPrice).toBe("3.00");
    expect(payButton(el).disabled).toBe(true);

    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!.click();
    await flush(el);
    expect(dialog(el)).toBeNull();
    expect(counter(el).store.lines[0]!.product.unitPrice).toBe("2.50");
    expect(payButton(el).disabled).toBe(false);

    add(el, "Lemonade");
    await pay(el);
    expect(api.recordSale.mock.calls[0]![0]).toEqual([
      { menuItemId: "offer-lemonade", menuVersionId: "v2", quantity: "1" },
      { menuItemId: "offer-lemonade", menuVersionId: "v2", quantity: "1" },
    ]);
  });

  it("keeps the basket as it was and Pay disabled when the dialog is cancelled, until the changes are reviewed", async () => {
    const { el } = await mountApp({
      listZoneOffers: vi
        .fn()
        .mockResolvedValue(
          catalogue("v2", [offer("offer-lemonade", "Lemonade", "2.50"), burgerOffer()]),
        ),
    });
    await toCounter(el);
    add(el, "Lemonade");
    api.menuState.mockResolvedValue(menuState("v2"));
    await poll(el);

    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!.click();
    await flush(el);
    expect(dialog(el)).toBeNull();
    expect(counter(el).store.lines[0]!.product).toMatchObject({
      unitPrice: "3.00",
      menuVersionId: "v1",
    });
    expect(payButton(el).disabled).toBe(true);
    // The poll now matches what the till loaded, so it does not interrupt again.
    await poll(el);
    expect(dialog(el)).toBeNull();

    el.shadowRoot!.querySelector<HTMLElement>("[data-menu-review]")!.click();
    await flush(el);
    expect(dialogText(el)).toContain("Lemonade €3.00 → €2.50");
  });

  it("blocks a line v2 removed until it is removed, the rest re-priced on confirm", async () => {
    const { el } = await mountApp({
      listZoneOffers: vi.fn().mockResolvedValue(catalogue("v2", [burgerOffer()])),
    });
    await toCounter(el);
    add(el, "Burger");
    add(el, "Lemonade");
    api.menuState.mockResolvedValue(menuState("v2"));
    await poll(el);

    expect(dialogText(el)).toContain("Lemonade is no longer on this menu");
    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!.click();
    await flush(el);
    expect(counter(el).store.lines.map((line) => line.blocked)).toEqual([undefined, "removed"]);
    expect(counter(el).store.lines[0]!.product.menuVersionId).toBe("v2");
    expect(payButton(el).disabled).toBe(true);

    counter(el).store.removeLine(1);
    await flush(el);
    expect(payButton(el).disabled).toBe(false);
  });

  it("blocks a line whose extra v2 made unavailable until it is replaced", async () => {
    const soldOutCheese = burgerOffer();
    const [extras] = soldOutCheese.offeredModifiers;
    if (extras!.kind === "extras") extras!.items[0]!.available = false;
    const { el } = await mountApp({
      listZoneOffers: vi
        .fn()
        .mockResolvedValue(
          catalogue("v2", [offer("offer-lemonade", "Lemonade", "3.00"), soldOutCheese]),
        ),
    });
    await toCounter(el);
    add(el, "Burger", {
      extras: [
        {
          listId: "list-extras",
          productId: "cheese",
          name: "Extra cheese",
          price: "1.00",
          quantity: 1,
        },
      ],
    });
    api.menuState.mockResolvedValue(menuState("v2"));
    await poll(el);

    expect(dialogText(el)).toContain("Extra cheese is not available");
    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!.click();
    await flush(el);
    expect(counter(el).store.lines[0]!.blocked).toBe("extra_unavailable");
    expect(payButton(el).disabled).toBe(true);

    counter(el).store.removeLine(0);
    add(el, "Burger");
    await flush(el);
    expect(counter(el).store.lines[0]!.blocked).toBeUndefined();
    expect(payButton(el).disabled).toBe(false);
  });
});

describe("a pay refused because the menu changed", () => {
  const refusal = {
    code: "menu.version_changed",
    status: 409,
    menus: [{ menuId: "lunch", liveVersionId: "v2" }],
  };

  it("runs the refresh flow, and after a silent adoption retries the pay once, asserting v2", async () => {
    const { el } = await mountApp({
      listZoneOffers: vi.fn().mockResolvedValue(catalogue("v2", V1.offers)),
      recordSale: vi.fn().mockRejectedValueOnce(refusal).mockResolvedValueOnce(saleResult),
    });
    await toCounter(el);
    add(el, "Lemonade");
    await pay(el);

    expect(api.listZoneOffers).toHaveBeenCalledOnce();
    expect(api.recordSale.mock.calls.map((call) => call[0])).toEqual([
      [{ menuItemId: "offer-lemonade", menuVersionId: "v1", quantity: "1" }],
      [{ menuItemId: "offer-lemonade", menuVersionId: "v2", quantity: "1" }],
    ]);
    expect(el.shadowRoot!.querySelector("till-ticket-view")).not.toBeNull();
  });

  it("retries only once: a second refusal is shown in the menu-change words", async () => {
    const { el } = await mountApp({
      listZoneOffers: vi.fn().mockResolvedValue(catalogue("v2", V1.offers)),
      recordSale: vi.fn().mockRejectedValue(refusal),
    });
    await toCounter(el);
    add(el, "Lemonade");
    await pay(el);

    expect(api.recordSale).toHaveBeenCalledTimes(2);
    expect(banner(el)!.textContent).toContain(codeMessage("menu.version_changed"));
    expect(counter(el).store.lines).toHaveLength(1);
  });

  it("shows the dialog instead of retrying when a line in the basket changed", async () => {
    const { el } = await mountApp({
      listZoneOffers: vi
        .fn()
        .mockResolvedValue(
          catalogue("v2", [offer("offer-lemonade", "Lemonade", "2.50"), burgerOffer()]),
        ),
      recordSale: vi.fn().mockRejectedValue(refusal),
    });
    await toCounter(el);
    add(el, "Lemonade");
    await pay(el);

    expect(api.recordSale).toHaveBeenCalledOnce();
    expect(dialogText(el)).toContain("Lemonade €3.00 → €2.50");
    expect(banner(el)).toBeNull();
  });

  it("runs the same flow when a hold is refused", async () => {
    const { el } = await mountApp({
      listZoneOffers: vi.fn().mockResolvedValue(catalogue("v2", V1.offers)),
      parkOrder: vi
        .fn()
        .mockRejectedValueOnce(refusal)
        .mockResolvedValueOnce({ id: "wo-1", orderNumber: 5 }),
    });
    await toCounter(el);
    add(el, "Lemonade");
    emit(counter(el), "park-order", { label: "Mesa 4" });
    await flush(el);

    expect(api.parkOrder.mock.calls.map((call) => call[0].lines)).toEqual([
      [{ menuItemId: "offer-lemonade", menuVersionId: "v1", quantity: "1" }],
      [{ menuItemId: "offer-lemonade", menuVersionId: "v2", quantity: "1" }],
    ]);
    expect(counter(el).store.lines).toHaveLength(0);
  });
});

describe("the other counter requests refused because the menu changed", () => {
  const refusal = { code: "menu.version_changed", status: 409, menus: [] };

  it("retries a card payment once after a silent adoption", async () => {
    const { el } = await mountApp({
      listZoneOffers: vi.fn().mockResolvedValue(catalogue("v2", V1.offers)),
      pay: vi
        .fn()
        .mockRejectedValueOnce(refusal)
        .mockResolvedValueOnce({ outcome: "captured", ticket: saleResult }),
    });
    await toCounter(el);
    add(el, "Lemonade");
    emit(counter(el), "collect-card", {});
    await flush(el);

    expect(api.pay.mock.calls.map((call) => call[0].lines[0].menuVersionId)).toEqual(["v1", "v2"]);
    expect(el.shadowRoot!.querySelector("till-ticket-view")).not.toBeNull();
  });

  it("retries placing an order once after a silent adoption", async () => {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
      listDefaultZoneOffers: vi.fn().mockResolvedValue({
        ...V1,
        context: { ...V1.context, serviceMode: "invoice_first" },
      }),
      listZoneOffers: vi.fn().mockResolvedValue(catalogue("v2", V1.offers)),
      parkOrder: vi
        .fn()
        .mockRejectedValueOnce(refusal)
        .mockResolvedValueOnce({ id: "wo-1", orderNumber: 5 }),
      placeOrder: vi.fn().mockResolvedValue({ id: "wo-1", status: "placed" }),
    });
    await toCounter(el);
    add(el, "Lemonade");
    emit(counter(el), "place-order");
    await flush(el);

    expect(api.parkOrder.mock.calls.map((call) => call[0].lines[0].menuVersionId)).toEqual([
      "v1",
      "v2",
    ]);
    expect(api.placeOrder).toHaveBeenCalledOnce();
  });

  it("says the menu changed, and does not retry, when the offers cannot be reloaded", async () => {
    const { el } = await mountApp({
      listZoneOffers: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      recordSale: vi.fn().mockRejectedValue(refusal),
    });
    await toCounter(el);
    add(el, "Lemonade");
    await pay(el);

    expect(api.recordSale).toHaveBeenCalledOnce();
    expect(banner(el)!.textContent).toContain(codeMessage("menu.version_changed"));
  });

  it("confirming a dialog whose every line is gone re-prices nothing and keeps Pay shut", async () => {
    const { el } = await mountApp({
      listZoneOffers: vi.fn().mockResolvedValue(catalogue("v2", [burgerOffer()])),
    });
    await toCounter(el);
    add(el, "Lemonade");
    api.menuState.mockResolvedValue(menuState("v2"));
    await poll(el);
    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!.click();
    await flush(el);

    expect(counter(el).store.lines[0]!.product.menuVersionId).toBe("v1");
    expect(counter(el).store.lines[0]!.blocked).toBe("removed");
    expect(payButton(el).disabled).toBe(true);
  });
});

describe("a refresh overtaken by a change of service area", () => {
  it("does not let the old zone's reloaded offers replace the new zone's", async () => {
    let answerRefresh!: (value: ZoneOfferCatalogue) => void;
    const terrace = {
      ...catalogue("t1", [offer("offer-terrace-water", "Water", "2.00")]),
      context: {
        zoneId: "zone-terrace",
        departmentId: "department-bar",
        serviceMode: "prepay" as const,
      },
    };
    const listZoneOffers = vi.fn((zoneId: string) =>
      zoneId === "zone-counter"
        ? new Promise<ZoneOfferCatalogue>((resolve) => (answerRefresh = resolve))
        : Promise.resolve(terrace),
    );
    const zone = (id: string) => ({
      id,
      name: id,
      departmentId: "department-bar",
      departmentName: "Bar",
      serviceMode: "prepay" as const,
    });
    const { el } = await mountApp({
      listDefaultZoneOffers: vi
        .fn()
        .mockResolvedValue({ ...V1, zones: [zone("zone-counter"), zone("zone-terrace")] }),
      listZoneOffers,
    });
    await toCounter(el);
    api.menuState.mockResolvedValue(menuState("v2"));
    await poll(el);
    expect(listZoneOffers).toHaveBeenCalledWith("zone-counter");

    emit(counter(el), "counter-zone-selected", { zoneId: "zone-terrace" });
    await flush(el);
    answerRefresh(catalogue("v2", V1.offers));
    await flush(el);

    expect(counter(el).products.map((product) => product.productId)).toEqual(["Water"]);
  });
});

describe("an offers load", () => {
  it("checks a basket kept across a sign-out against the version it loads", async () => {
    const { el } = await mountApp();
    await toCounter(el);
    add(el, "Lemonade");
    emit(counter(el), "logout");
    await flush(el);
    api.listDefaultZoneOffers.mockResolvedValue(
      catalogue("v2", [offer("offer-lemonade", "Lemonade", "2.50"), burgerOffer()]),
    );
    await toCounter(el);
    expect(dialogText(el)).toContain("Lemonade €3.00 → €2.50");
  });
});

// ── Fix round 1 ──────────────────────────────────────────────────────────────────────────────────

/** A till whose canvas mounts the table screen as the `order` tab's card, beside the counter. */
const tableCanvas: CanvasDef = {
  formFactor: "till",
  tabs: [
    canvas.tabs[0]!,
    {
      key: "floor",
      title: "Floor",
      columns: 24,
      cards: [{ type: "floor-plan", colSpan: 24, rowSpan: 12, config: {} }],
    },
    {
      key: "order",
      title: "Order",
      columns: 12,
      cards: [{ type: "table-order", colSpan: 12, rowSpan: 8, config: {} }],
    },
  ],
};

const DINING = {
  ...V1,
  context: { ...V1.context, zoneId: "zone-dining", serviceMode: "table_tab" as const },
};

const party = {
  id: "visit-a",
  revision: 1,
  guestCount: 2,
  state: "open" as const,
  outstanding: "3.00",
  billCount: 1,
  tableIds: ["t2"],
};

const table = {
  id: "t2",
  label: "2",
  zoneId: "zone-dining",
  capacity: 4,
  state: "open-tab",
  hasOpenTab: true,
  tabId: "wo-7",
  tabLineCount: 1,
  tabTotal: "3.00",
  pendingDeliveries: 0,
  pendingToServe: 1,
  readyToServe: 0,
  enRoute: 0,
  timingBand: "fresh",
  status: null,
  nextReservation: null,
  posX: null,
  posY: null,
  shape: null,
  rotation: null,
  visit: party as typeof party | null,
};

/** What a round's submission answers when its lines went on `tabId`. */
const landed = (tabId: string) => ({ tabId, revision: 2, groups: [] });
type Landed = ReturnType<typeof landed>;
/** The lines a round's submission sent, whichever group each went in. */
const sentLines = (call: unknown[]) =>
  (call[1] as { groups: { lines: unknown[] }[] }).groups.flatMap((group) => group.lines);

const tabLemonade = {
  lineNo: 1,
  productId: "Lemonade",
  quantity: "1.000",
  unitPriceGross: "3.00",
  servedAt: null,
  courseId: null,
  sentAt: "2026-09-26T09:59:00.000Z",
  firedAt: "2026-09-26T09:59:00.000Z",
  state: "queued",
  note: null,
  listId: null,
  menuItemId: "offer-lemonade",
  parentProductId: null,
};

/** Table-service stubs; `diningOffers` answers every read of the table's zone after the first. */
function tableStubs(
  diningOffers: ZoneOfferCatalogue = DINING,
  overrides: Record<string, unknown> = {},
) {
  return {
    getTill: vi.fn().mockResolvedValue({ ...till, canvas: tableCanvas }),
    listZoneOffers: vi.fn((zoneId: string) =>
      Promise.resolve(zoneId === "zone-dining" ? DINING : V1),
    ),
    getTablesState: vi.fn().mockResolvedValue([table]),
    listZones: vi
      .fn()
      .mockResolvedValue([{ id: "zone-dining", name: "Comedor", displayOrder: 0, active: true }]),
    listStatuses: vi.fn().mockResolvedValue([]),
    getTabLines: vi
      .fn()
      .mockResolvedValue({ lines: [tabLemonade], revision: 0, editSentLines: true }),
    submitGroups: vi.fn().mockResolvedValue(landed("wo-7")),
    _dining: diningOffers,
    ...overrides,
  };
}

const shellGrid = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>("till-card-grid")!;
const tableScreen = (el: TillApp) =>
  shellGrid(el).shadowRoot!.querySelector<
    HTMLElement & { products: { id: string; available?: boolean }[] }
  >("till-table-order-screen")!;
const roundGrid = (el: TillApp) =>
  tableScreen(el).shadowRoot!.querySelector<
    HTMLElement & { store: { lines: { blocked?: string }[]; lineCount: number } }
  >("till-menu-browser")!;

async function toTable(el: TillApp): Promise<void> {
  await toCounter(el);
  emit(el.shadowRoot!.querySelector("till-tab-shell")!, "tab-select", { key: "floor" });
  await flush(el);
  const floorScreen = shellGrid(el).shadowRoot!.querySelector("till-floor-screen")!;
  emit(floorScreen, "open-table", { tableId: "t2", seated: true });
  await flush(el);
  // After the open, every read of the dining zone answers the republished offers.
  const dining = api._dining as unknown as ZoneOfferCatalogue;
  api.listZoneOffers.mockImplementation((zoneId: string) =>
    Promise.resolve(zoneId === "zone-dining" ? dining : V1),
  );
}

/** Presses Fire all now; the preview it opens is confirmed by {@link confirmPreview}. */
function pressFireAll(el: TillApp): void {
  tableScreen(el).shadowRoot!.querySelector<HTMLElement>('[data-draft-action="fire-all"]')!.click();
}

function confirmPreview(el: TillApp): void {
  tableScreen(el).shadowRoot!.querySelector<HTMLElement>("[data-draft-confirm]")!.click();
}

/** Taps the round's Lemonade tile, then Fire all now, and confirms its preview. */
async function sendLemonadeRound(el: TillApp): Promise<void> {
  const tileButton = [...roundGrid(el).shadowRoot!.querySelectorAll<HTMLElement>("wt-button")].find(
    (button) => button.querySelector(".name")!.textContent === "Lemonade",
  )!;
  tileButton.click();
  await flush(el);
  pressFireAll(el);
  await flush(el);
  confirmPreview(el);
  await flush(el);
}

const versionRefusal = {
  code: "menu.version_changed",
  status: 409,
  menus: [{ menuId: "lunch", liveVersionId: "v2" }],
};

describe("a table round refused because the menu changed", () => {
  it("re-sends the round once, asserting v2, when nothing in it changed", async () => {
    const { el } = await mountApp(
      tableStubs(catalogue("v2", V1.offers), {
        submitGroups: vi
          .fn()
          .mockRejectedValueOnce(versionRefusal)
          .mockResolvedValueOnce(landed("wo-7")),
      }),
    );
    await toTable(el);
    const round = roundGrid(el).store;
    await sendLemonadeRound(el);

    expect(api.submitGroups.mock.calls.map(sentLines)).toEqual([
      [{ menuItemId: "offer-lemonade", menuVersionId: "v1", quantity: "1" }],
      [{ menuItemId: "offer-lemonade", menuVersionId: "v2", quantity: "1" }],
    ]);
    expect(dialog(el)).toBeNull();
    expect(round.lineCount).toBe(0);
  });

  it("re-asserts each line's own dish on the re-send, with the lines in course order rather than tap order", async () => {
    const offers = [
      offer("offer-lemonade", "Lemonade", "3.00", { courseId: "desserts" }),
      offer("offer-water", "Water", "2.00", { courseId: "starters" }),
    ];
    const dining = (version: string) => ({
      ...catalogue(version, offers),
      context: DINING.context,
    });
    const { el } = await mountApp(
      tableStubs(dining("v2"), {
        getTill: vi.fn().mockResolvedValue({
          ...till,
          canvas: tableCanvas,
          courses: [
            { id: "starters", name: "Starters", displayOrder: 0 },
            { id: "desserts", name: "Desserts", displayOrder: 1 },
          ],
        }),
        listZoneOffers: vi.fn((zoneId: string) =>
          Promise.resolve(zoneId === "zone-dining" ? dining("v1") : V1),
        ),
        submitGroups: vi
          .fn()
          .mockRejectedValueOnce(versionRefusal)
          .mockResolvedValueOnce(landed("wo-7")),
      }),
    );
    await toTable(el);
    for (const name of ["Lemonade", "Water"]) {
      [...roundGrid(el).shadowRoot!.querySelectorAll<HTMLElement>("wt-button")]
        .find((button) => button.querySelector(".name")!.textContent === name)!
        .click();
      await flush(el);
    }
    pressFireAll(el);
    await flush(el);
    confirmPreview(el);
    await flush(el);

    expect(api.submitGroups.mock.calls.map(sentLines)).toEqual([
      [
        { menuItemId: "offer-water", menuVersionId: "v1", quantity: "1" },
        { menuItemId: "offer-lemonade", menuVersionId: "v1", quantity: "1" },
      ],
      [
        { menuItemId: "offer-water", menuVersionId: "v2", quantity: "1" },
        { menuItemId: "offer-lemonade", menuVersionId: "v2", quantity: "1" },
      ],
    ]);
  });

  it("keeps the round and shows the dialog when a price in it changed, sending nothing more", async () => {
    const { el } = await mountApp(
      tableStubs(catalogue("v2", [offer("offer-lemonade", "Lemonade", "2.50"), burgerOffer()]), {
        submitGroups: vi.fn().mockRejectedValue(versionRefusal),
      }),
    );
    await toTable(el);
    await sendLemonadeRound(el);

    expect(api.submitGroups).toHaveBeenCalledOnce();
    expect(dialogText(el)).toContain("Lemonade €3.00 → €2.50");
    expect(roundGrid(el).store.lineCount).toBe(1);

    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!.click();
    await flush(el);
    expect(roundGrid(el).store.lineCount).toBe(1);
    expect(api.submitGroups).toHaveBeenCalledOnce();
  });

  it("keeps a round whose line the new version removed, marked, and sends nothing", async () => {
    const { el } = await mountApp(
      tableStubs(catalogue("v2", [burgerOffer()]), {
        submitGroups: vi.fn().mockRejectedValue(versionRefusal),
      }),
    );
    await toTable(el);
    await sendLemonadeRound(el);

    expect(dialogText(el)).toContain("Lemonade is no longer on this menu");
    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!.click();
    await flush(el);
    expect(roundGrid(el).store.lines.map((line) => line.blocked)).toEqual(["removed"]);
    expect(api.submitGroups).toHaveBeenCalledOnce();
  });

  it("empties the round once the server has taken it", async () => {
    const { el } = await mountApp(tableStubs());
    await toTable(el);
    const round = roundGrid(el).store;
    await sendLemonadeRound(el);
    expect(api.submitGroups).toHaveBeenCalledOnce();
    expect(round.lineCount).toBe(0);
    expect(banner(el)?.textContent ?? null).toBeNull();
  });
});

describe("the counter's basket hold stays on the counter", () => {
  it("leaves a table tab's Pay enabled while a counter line is sold out", async () => {
    const { el } = await mountApp(tableStubs());
    await toCounter(el);
    add(el, "Burger");
    api.menuState.mockResolvedValue(menuState("v1", { products: ["Burger"] }));
    await poll(el);
    expect(payButton(el).disabled).toBe(true);

    emit(el.shadowRoot!.querySelector("till-tab-shell")!, "tab-select", { key: "floor" });
    await flush(el);
    emit(shellGrid(el).shadowRoot!.querySelector("till-floor-screen")!, "open-table", {
      tableId: "t2",
      seated: true,
    });
    await flush(el);
    tableScreen(el).shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await flush(el);
    const tablePay = tableScreen(el)
      .shadowRoot!.querySelector<TillTenderPay>("till-tender-pay")!
      .shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(".pay")!;
    expect(tablePay.disabled).toBe(false);
  });
});

describe("the poll's own costs", () => {
  it("does not rebuild the counter's products when the sold-out list has not changed", async () => {
    const { el } = await mountApp();
    await toCounter(el);
    api.menuState.mockResolvedValue(menuState("v1", { products: ["Burger"] }));
    await poll(el);
    const built = counter(el).products;
    api.menuState.mockResolvedValue(menuState("v1", { products: ["Burger"] }));
    await poll(el);
    expect(counter(el).products).toBe(built);
  });

  it("stops reading a table's zone once the waiter has left the table", async () => {
    const { el } = await mountApp(tableStubs());
    await toTable(el);
    await poll(el);
    expect(api.menuState.mock.calls.map((call) => call[0])).toEqual([
      "zone-counter",
      "zone-dining",
    ]);

    emit(el.shadowRoot!.querySelector("till-tab-shell")!, "tab-select", { key: "floor" });
    await flush(el);
    api.menuState.mockClear();
    await poll(el);
    expect(api.menuState.mock.calls.map((call) => call[0])).toEqual(["zone-counter"]);
  });

  it("does not discard a change of service area that a poll's reload overlaps", async () => {
    let answerSwitch!: (value: ZoneOfferCatalogue) => void;
    const terrace = {
      ...catalogue("t1", [offer("offer-terrace-water", "Water", "2.00")]),
      context: {
        zoneId: "zone-terrace",
        departmentId: "department-bar",
        serviceMode: "prepay" as const,
      },
    };
    const zone = (id: string) => ({
      id,
      name: id,
      departmentId: "department-bar",
      departmentName: "Bar",
      serviceMode: "prepay" as const,
    });
    const { el } = await mountApp({
      listDefaultZoneOffers: vi
        .fn()
        .mockResolvedValue({ ...V1, zones: [zone("zone-counter"), zone("zone-terrace")] }),
      listZoneOffers: vi.fn((zoneId: string) =>
        zoneId === "zone-terrace"
          ? new Promise<ZoneOfferCatalogue>((resolve) => (answerSwitch = resolve))
          : Promise.resolve(catalogue("v2", V1.offers)),
      ),
    });
    await toCounter(el);
    emit(counter(el), "counter-zone-selected", { zoneId: "zone-terrace" });
    await flush(el);
    api.menuState.mockResolvedValue(menuState("v2"));
    await poll(el);
    answerSwitch(terrace);
    await flush(el);

    expect(counter(el).selectedServiceZoneId).toBe("zone-terrace");
    expect(counter(el).products.map((product) => product.productId)).toEqual(["Water"]);
  });
});

describe("a sign-in whose offers fail to load", () => {
  it("marks no kept line as gone, and keeps Pay shut", async () => {
    const { el } = await mountApp();
    await toCounter(el);
    add(el, "Lemonade");
    emit(counter(el), "logout");
    await flush(el);
    api.listDefaultZoneOffers.mockRejectedValue(new TypeError("Failed to fetch"));
    await toCounter(el);

    expect(counter(el).store.lines[0]!.blocked).toBeUndefined();
    expect(payButton(el).disabled).toBe(true);
  });
});

// ── Fix round 2 ──────────────────────────────────────────────────────────────────────────────────

type RoundStore = {
  lines: { quantity: string; blocked?: string }[];
  lineCount: number;
  setLineQuantity(index: number, quantity: string): void;
  removeLine(index: number): void;
};
const roundStore = (el: TillApp) => roundGrid(el).store as unknown as RoundStore;

describe("a table round while it is being sent", () => {
  it("takes no quantity change until the answer, so the kitchen gets what the screen shows", async () => {
    let answer!: (value: Landed) => void;
    const { el } = await mountApp(
      tableStubs(DINING, {
        submitGroups: vi.fn(() => new Promise<Landed>((resolve) => (answer = resolve))),
      }),
    );
    await toTable(el);
    await sendLemonadeRound(el);
    const round = roundStore(el) as RoundStore & { sending: boolean };

    round.setLineQuantity(0, "2");
    await flush(el);
    expect(round.lines[0]!.quantity).toBe("1");
    expect(tableScreen(el).shadowRoot!.querySelector("[data-round-sending]")).not.toBeNull();

    answer(landed("wo-7"));
    await flush(el);
    expect(sentLines(api.submitGroups.mock.calls[0]!)).toEqual([
      { menuItemId: "offer-lemonade", menuVersionId: "v1", quantity: "1" },
    ]);
    expect(round.lineCount).toBe(0);
    // The whole draft went, so the till is back on the floor, with the draft open for the next one.
    expect(round.sending).toBe(false);
  });

  it("takes no removal while a refusal's reload is out, so the re-send is what the screen shows", async () => {
    let answerReload!: (value: ZoneOfferCatalogue) => void;
    const { el } = await mountApp(
      tableStubs(DINING, {
        submitGroups: vi
          .fn()
          .mockRejectedValueOnce(versionRefusal)
          .mockResolvedValueOnce(landed("wo-7")),
      }),
    );
    await toTable(el);
    api.listZoneOffers.mockImplementation((zoneId: string) =>
      zoneId === "zone-dining"
        ? new Promise<ZoneOfferCatalogue>((resolve) => (answerReload = resolve))
        : Promise.resolve(V1),
    );
    await sendLemonadeRound(el);
    const round = roundStore(el);

    round.removeLine(0);
    await flush(el);
    expect(round.lineCount).toBe(1);

    answerReload(catalogue("v2", V1.offers));
    await flush(el);
    expect(api.submitGroups).toHaveBeenCalledTimes(2);
    expect(round.lineCount).toBe(0);
  });
});

describe("a table round refused for another reason", () => {
  it("says a sold-out dish in its own words, and keeps the round", async () => {
    const { el } = await mountApp(
      tableStubs(DINING, {
        submitGroups: vi
          .fn()
          .mockRejectedValue({ code: "product.unavailable", status: 409, productId: "Lemonade" }),
      }),
    );
    await toTable(el);
    await sendLemonadeRound(el);

    expect(banner(el)!.textContent).toContain(codeMessage("product.unavailable"));
    expect(roundStore(el).lineCount).toBe(1);
  });
});

describe("a round line's mark", () => {
  it("clears when the table's zone shows the dish can be sold again", async () => {
    const soldOut = catalogue("v2", [
      offer("offer-lemonade", "Lemonade", "3.00", { available: false }),
      burgerOffer(),
    ]);
    const { el } = await mountApp(
      tableStubs(soldOut, { submitGroups: vi.fn().mockRejectedValue(versionRefusal) }),
    );
    await toTable(el);
    await sendLemonadeRound(el);
    expect(dialogText(el)).toContain("Lemonade is not available");
    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!.click();
    await flush(el);
    expect(roundStore(el).lines[0]!.blocked).toBe("unavailable");

    api.menuState.mockImplementation(async (zoneId: string) =>
      menuState(zoneId === "zone-dining" ? "v2" : "v1"),
    );
    await poll(el);
    expect(roundStore(el).lines[0]!.blocked).toBeUndefined();
  });
});

describe("a round at phone width", () => {
  it("keeps each round line's remove control on screen", async () => {
    await page.viewport(390, 844);
    try {
      const phone: CanvasDef = {
        formFactor: "phone-portrait",
        tabs: [tableCanvas.tabs[1]!, tableCanvas.tabs[2]!],
      };
      api = stubApi({
        ...tableStubs(),
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: phone }),
        getDeviceIdentity: vi.fn().mockResolvedValue({
          deviceId: "h1",
          name: "H",
          formFactor: "phone-portrait",
          stationId: null,
        }),
      });
      const { el } = await mountWidget<TillApp>("till-app", { api: api as unknown as TillApi });
      await flush(el);
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
      await flush(el);
      emit(shellGrid(el).shadowRoot!.querySelector("till-floor-screen")!, "open-table", {
        tableId: "t2",
        seated: true,
      });
      await flush(el);
      roundGrid(el).shadowRoot!.querySelector<HTMLElement>("wt-button")!.click();
      await flush(el);
      const basket = tableScreen(el).shadowRoot!.querySelector(".round-bar till-basket")!;
      const remove = basket.shadowRoot!.querySelector<HTMLElement>("wt-button.remove")!;
      expect(remove.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    } finally {
      await page.viewport(1280, 720);
    }
  });
});

// ── Fix round 3 ──────────────────────────────────────────────────────────────────────────────────

const tableB = {
  ...table,
  id: "t3",
  label: "3",
  tabId: "wo-8",
  visit: { ...party, id: "visit-c", tableIds: ["t3"] },
};

describe("a kept round and another table", () => {
  it("does not carry a refused round to the next table opened on the same screen", async () => {
    // Floor and order share one tab, as a tablet canvas can, so the table screen stays mounted.
    const sideBySide: CanvasDef = {
      formFactor: "till",
      tabs: [
        canvas.tabs[0]!,
        {
          key: "service",
          title: "Service",
          columns: 24,
          cards: [
            { type: "floor-plan", colSpan: 12, rowSpan: 12, config: {} },
            { type: "table-order", colSpan: 12, rowSpan: 12, config: {} },
          ],
        },
      ],
    };
    const { el } = await mountApp(
      tableStubs(DINING, {
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: sideBySide }),
        getTablesState: vi.fn().mockResolvedValue([table, tableB]),
        submitGroups: vi
          .fn()
          .mockRejectedValue({ code: "product.unavailable", status: 409, productId: "Lemonade" }),
      }),
    );
    await toCounter(el);
    emit(el.shadowRoot!.querySelector("till-tab-shell")!, "tab-select", { key: "service" });
    await flush(el);
    const floorScreen = () => shellGrid(el).shadowRoot!.querySelector("till-floor-screen")!;
    emit(floorScreen(), "open-table", { tableId: "t2", seated: true });
    await flush(el);
    const screenForA = tableScreen(el);
    await sendLemonadeRound(el);
    expect(roundStore(el).lineCount).toBe(1);

    emit(floorScreen(), "open-table", { tableId: "t3", seated: true });
    await flush(el);
    expect(tableScreen(el)).toBe(screenForA);
    expect(roundStore(el).lineCount).toBe(0);
    expect(
      tableScreen(el)
        .shadowRoot!.querySelector('[data-draft-action="fire-all"]')!
        .hasAttribute("disabled"),
    ).toBe(true);

    emit(floorScreen(), "open-table", { tableId: "t2", seated: true });
    await flush(el);
    expect(roundStore(el).lineCount).toBe(1);
  });
});

describe("a round send that gets no answer", () => {
  it("gives up after 150 seconds, takes the round out, re-reads the tab and says to check it", async () => {
    let signal: AbortSignal | undefined;
    const { el } = await mountApp(
      tableStubs(DINING, {
        submitGroups: vi.fn(
          (_visitId: string, _submission: unknown, options?: { signal?: AbortSignal }) =>
            new Promise<void>((_resolve, reject) => {
              signal = options?.signal;
              signal?.addEventListener("abort", () =>
                reject(new DOMException("The operation was aborted.", "AbortError")),
              );
            }),
        ),
      }),
    );
    await toTable(el);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const settle = async () => {
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;
    };
    const tileButton = [
      ...roundGrid(el).shadowRoot!.querySelectorAll<HTMLElement>("wt-button"),
    ].find((button) => button.querySelector(".name")!.textContent === "Lemonade")!;
    tileButton.click();
    await settle();
    pressFireAll(el);
    await settle();
    confirmPreview(el);
    await settle();
    const tabReads = api.getTabLines.mock.calls.length;

    await vi.advanceTimersByTimeAsync(149_999);
    await el.updateComplete;
    expect(signal?.aborted).toBe(false);
    expect(roundStore(el).lineCount).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    await settle();
    await settle();
    expect(signal?.aborted).toBe(true);
    expect(roundStore(el).lineCount).toBe(0);
    expect(api.getTabLines.mock.calls.length).toBe(tabReads + 1);
    expect(banner(el)!.textContent).toContain(
      "The server did not answer, so the round may have been added. Check the tab before sending it again.",
    );
    expect(api.submitGroups).toHaveBeenCalledOnce();
  });
});

describe("a round refused because a dish in it sold out", () => {
  it("marks the sold-out line", async () => {
    const soldOut = {
      ...DINING,
      offers: [offer("offer-lemonade", "Lemonade", "3.00", { available: false }), burgerOffer()],
    };
    const { el } = await mountApp(
      tableStubs(soldOut, {
        submitGroups: vi
          .fn()
          .mockRejectedValue({ code: "product.unavailable", status: 409, productId: "Lemonade" }),
      }),
    );
    await toTable(el);
    await sendLemonadeRound(el);
    expect(roundStore(el).lines[0]!.blocked).toBe("unavailable");
  });
});

// ── Fix round 4 ──────────────────────────────────────────────────────────────────────────────────

const lemonadeTile = (el: TillApp) =>
  [...roundGrid(el).shadowRoot!.querySelectorAll<HTMLElement>("wt-button")].find(
    (button) => button.querySelector(".name")!.textContent === "Lemonade",
  )!;
const roundSending = (el: TillApp) =>
  tableScreen(el).shadowRoot!.querySelector("[data-round-sending]");
const soldOutRefusal = { code: "product.unavailable", status: 409, productId: "Lemonade" };

describe("a round's lock once its send is decided", () => {
  it("opens the round for the next one while the tab's lines are still being read", async () => {
    const { el } = await mountApp(tableStubs(DINING));
    await toTable(el);
    api.getTabLines.mockImplementation(() => new Promise(() => {}));
    await sendLemonadeRound(el);

    expect(api.submitGroups).toHaveBeenCalledOnce();
    expect(roundStore(el).lineCount).toBe(0);
    expect(roundSending(el)).toBeNull();
    lemonadeTile(el).click();
    await flush(el);
    expect(roundStore(el).lineCount).toBe(1);
  });

  it("opens a round refused sold out for edits while the table's offers are read again", async () => {
    const { el } = await mountApp(
      tableStubs(DINING, { submitGroups: vi.fn().mockRejectedValue(soldOutRefusal) }),
    );
    await toTable(el);
    api.listZoneOffers.mockImplementation((zoneId: string) =>
      zoneId === "zone-dining" ? new Promise(() => {}) : Promise.resolve(V1),
    );
    await sendLemonadeRound(el);

    expect(banner(el)!.textContent).toContain(codeMessage("product.unavailable"));
    expect(roundSending(el)).toBeNull();
    roundStore(el).setLineQuantity(0, "2");
    await flush(el);
    expect(roundStore(el).lines[0]!.quantity).toBe("2");
  });

  it("gives up on a menu-change refusal's offers read after 150 seconds, keeping the round", async () => {
    let signal: AbortSignal | undefined;
    const { el } = await mountApp(
      tableStubs(DINING, { submitGroups: vi.fn().mockRejectedValue(versionRefusal) }),
    );
    await toTable(el);
    api.listZoneOffers.mockImplementation((zoneId: string, options?: { signal?: AbortSignal }) =>
      zoneId === "zone-dining"
        ? new Promise((_resolve, reject) => {
            signal = options?.signal;
            signal?.addEventListener("abort", () =>
              reject(new DOMException("The operation was aborted.", "AbortError")),
            );
          })
        : Promise.resolve(V1),
    );
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const settle = async () => {
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;
    };
    lemonadeTile(el).click();
    await settle();
    pressFireAll(el);
    await settle();
    confirmPreview(el);
    await settle();

    await vi.advanceTimersByTimeAsync(149_999);
    await el.updateComplete;
    expect(signal?.aborted).toBe(false);
    expect(roundSending(el)).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    await settle();
    await settle();
    expect(signal?.aborted).toBe(true);
    expect(roundSending(el)).toBeNull();
    expect(roundStore(el).lineCount).toBe(1);
    expect(banner(el)!.textContent).toContain(codeMessage("menu.version_changed"));
    expect(api.submitGroups).toHaveBeenCalledOnce();
  });
});

describe("a round refused sold out whose offers could not be read again", () => {
  it("is marked by the next read of the table's offers that succeeds", async () => {
    const { el } = await mountApp(
      tableStubs(DINING, { submitGroups: vi.fn().mockRejectedValue(soldOutRefusal) }),
    );
    await toTable(el);
    api.listZoneOffers.mockImplementation((zoneId: string) =>
      zoneId === "zone-dining" ? Promise.reject({ code: "server.internal" }) : Promise.resolve(V1),
    );
    await sendLemonadeRound(el);
    expect(roundStore(el).lines[0]!.blocked).toBeUndefined();

    const soldOutV2 = {
      ...catalogue("v2", [
        offer("offer-lemonade", "Lemonade", "3.00", { available: false }),
        burgerOffer(),
      ]),
      context: DINING.context,
    };
    api.listZoneOffers.mockImplementation((zoneId: string) =>
      Promise.resolve(zoneId === "zone-dining" ? soldOutV2 : V1),
    );
    api.menuState.mockImplementation(async (zoneId: string) =>
      menuState(zoneId === "zone-dining" ? "v2" : "v1"),
    );
    await poll(el);
    expect(roundStore(el).lines[0]!.blocked).toBe("unavailable");
  });
});

// ── Fix round 5 ──────────────────────────────────────────────────────────────────────────────────

describe("a remembered round when another table's menu cannot be loaded", () => {
  async function refusedThenOpen(tableC: typeof table, diningReadsFail: boolean) {
    const soldOut = {
      ...DINING,
      offers: [offer("offer-lemonade", "Lemonade", "3.00", { available: false }), burgerOffer()],
    };
    const { el } = await mountApp(
      tableStubs(soldOut, {
        getTablesState: vi.fn().mockResolvedValue([table, tableC]),
        submitGroups: vi.fn().mockRejectedValue(soldOutRefusal),
      }),
    );
    await toTable(el);
    await sendLemonadeRound(el);
    const round = roundStore(el);
    expect(round.lines[0]!.blocked).toBe("unavailable");

    if (diningReadsFail)
      api.listZoneOffers.mockImplementation((zoneId: string) =>
        zoneId === "zone-dining"
          ? Promise.reject({ code: "server.internal" })
          : Promise.resolve(V1),
      );
    emit(el.shadowRoot!.querySelector("till-tab-shell")!, "tab-select", { key: "floor" });
    await flush(el);
    emit(shellGrid(el).shadowRoot!.querySelector("till-floor-screen")!, "open-table", {
      tableId: tableC.id,
      seated: true,
    });
    await flush(el);
    return round;
  }

  it("keeps its mark when the other table's offers fail to load", async () => {
    const round = await refusedThenOpen(tableB, true);
    expect(round.lines[0]!.blocked).toBe("unavailable");
  });

  it("keeps its mark when the other table has no service zone", async () => {
    const round = await refusedThenOpen(
      { ...tableB, zoneId: null } as unknown as typeof table,
      false,
    );
    expect(round.lines[0]!.blocked).toBe("unavailable");
  });
});

// ── A round that lands on the party's next tab ───────────────────────────────────────────────────

const shownTab = (el: TillApp) => (tableScreen(el) as unknown as { orderId?: string }).orderId;
const seated = table;

describe("a round the server adds to another tab", () => {
  it("moves the screen to that tab and takes the sent lines out of the round", async () => {
    const { el } = await mountApp(
      tableStubs(DINING, { submitGroups: vi.fn().mockResolvedValue(landed("wo-next")) }),
    );
    await toTable(el);
    const round = roundStore(el);
    await sendLemonadeRound(el);

    expect(api.submitGroups).toHaveBeenCalledWith(
      "visit-a",
      expect.objectContaining({ expectedVisitRevision: 1 }),
      expect.anything(),
    );
    expect(api.getTabLines).toHaveBeenLastCalledWith("wo-next");
    expect(round.lineCount).toBe(0);
    expect(banner(el)).toBeNull();
    // The whole draft went, so the till is on the floor; its Order tab shows the tab it landed on.
    emit(el.shadowRoot!.querySelector("till-tab-shell")!, "tab-select", { key: "order" });
    await flush(el);
    expect(shownTab(el)).toBe("wo-next");
  });

  it("leaves the operator on the table they opened while the answer was out", async () => {
    let answer!: (value: Landed) => void;
    const { el } = await mountApp(
      tableStubs(DINING, {
        getTablesState: vi.fn().mockResolvedValue([table, tableB]),
        submitGroups: vi.fn(() => new Promise<Landed>((resolve) => (answer = resolve))),
      }),
    );
    await toTable(el);
    await sendLemonadeRound(el);
    emit(el.shadowRoot!.querySelector("till-tab-shell")!, "tab-select", { key: "floor" });
    await flush(el);
    emit(shellGrid(el).shadowRoot!.querySelector("till-floor-screen")!, "open-table", {
      tableId: "t3",
      seated: true,
    });
    await flush(el);
    expect(shownTab(el)).toBe("wo-8");

    answer(landed("wo-next"));
    await flush(el);
    expect(shownTab(el)).toBe("wo-8");
    expect(api.getTabLines).not.toHaveBeenCalledWith("wo-next");
  });
});

describe("a round that got no answer while the party moved on to its next tab", () => {
  const unconfirmed =
    "The server did not answer, so the round may have been added. Check the tab before sending it again.";

  const shownParty = (el: TillApp) =>
    (tableScreen(el) as unknown as { visit: { id: string } | null }).visit?.id;

  it("reads the table's party again and shows the tab the table now points at", async () => {
    const { el } = await mountApp(
      tableStubs(DINING, {
        getTablesState: vi.fn().mockResolvedValue([seated]),
        getVisitBills: vi.fn().mockResolvedValue([]),
        submitGroups: vi.fn().mockRejectedValue(new TypeError("offline")),
      }),
    );
    await toTable(el);
    api.getTablesState.mockResolvedValue([
      { ...seated, tabId: "wo-next", visit: { ...party, revision: 2 } },
    ]);
    const round = roundStore(el);
    await sendLemonadeRound(el);
    await flush(el);

    expect(shownTab(el)).toBe("wo-next");
    expect(api.getTabLines).toHaveBeenLastCalledWith("wo-next");
    expect(shownParty(el)).toBe("visit-a");
    expect(api.getVisitBills).toHaveBeenLastCalledWith("visit-a");
    expect(round.lineCount).toBe(0);
    expect(banner(el)!.textContent).toContain(unconfirmed);
  });

  it("does not follow the table onto a new party's tab", async () => {
    const { el } = await mountApp(
      tableStubs(DINING, {
        getTablesState: vi.fn().mockResolvedValue([seated]),
        getVisitBills: vi.fn().mockResolvedValue([]),
        submitGroups: vi.fn().mockRejectedValue(new TypeError("offline")),
      }),
    );
    await toTable(el);
    // Another till settled and cleared the party, and seated a new one at the same table.
    api.getTablesState.mockResolvedValue([
      { ...seated, tabId: "wo-other", visit: { ...party, id: "visit-b" } },
    ]);
    await sendLemonadeRound(el);
    await flush(el);

    expect(shownTab(el)).toBe("wo-7");
    expect(api.getTabLines).not.toHaveBeenCalledWith("wo-other");
    expect(shownParty(el)).toBe("visit-a");
    expect(api.getVisitBills).not.toHaveBeenCalledWith("visit-b");
    expect(banner(el)!.textContent).toContain(unconfirmed);
  });

  it("sends nothing, and follows nothing, when the tab had no party", async () => {
    const { el } = await mountApp(
      tableStubs(DINING, {
        getTablesState: vi.fn().mockResolvedValue([{ ...table, visit: null }]),
      }),
    );
    await toTable(el);
    api.getTablesState.mockResolvedValue([{ ...table, visit: null, tabId: "wo-other" }]);
    await sendLemonadeRound(el);
    await flush(el);

    expect(api.submitGroups).not.toHaveBeenCalled();
    expect(shownTab(el)).toBe("wo-7");
    expect(api.getTabLines).not.toHaveBeenCalledWith("wo-other");
    expect(roundStore(el).lineCount).toBe(1);
  });

  it("leaves the operator on the table they opened while the send was out", async () => {
    let fail!: (error: unknown) => void;
    const { el } = await mountApp(
      tableStubs(DINING, {
        getTablesState: vi.fn().mockResolvedValue([seated, tableB]),
        getVisitBills: vi.fn().mockResolvedValue([]),
        submitGroups: vi.fn(() => new Promise((_resolve, reject) => (fail = reject))),
      }),
    );
    await toTable(el);
    await sendLemonadeRound(el);
    emit(el.shadowRoot!.querySelector("till-tab-shell")!, "tab-select", { key: "floor" });
    await flush(el);
    emit(shellGrid(el).shadowRoot!.querySelector("till-floor-screen")!, "open-table", {
      tableId: "t3",
      seated: true,
    });
    await flush(el);
    expect(shownTab(el)).toBe("wo-8");

    api.getTablesState.mockResolvedValue([
      { ...seated, tabId: "wo-next", visit: { ...party, revision: 2 } },
      tableB,
    ]);
    fail(new TypeError("offline"));
    await flush(el);
    await flush(el);
    expect(shownTab(el)).toBe("wo-8");
    expect(api.getTabLines).not.toHaveBeenCalledWith("wo-next");
  });
});

describe("an edit that changes a basket line's mark", () => {
  it("notifies the basket's other listeners once, with the mark already set", async () => {
    const { el } = await mountApp();
    await toCounter(el);
    api.menuState.mockResolvedValue(menuState("v1", { products: ["Burger"] }));
    await poll(el);
    const seen: (string | undefined)[][] = [];
    const store = counter(el).store;
    store.subscribe(() => seen.push(store.lines.map((line) => line.blocked)));

    add(el, "Burger");

    expect(seen).toEqual([["unavailable"]]);
  });
});

describe("a round send that timed out while the floor cannot be read either", () => {
  it("opens the round for edits without waiting for the floor", async () => {
    const { el } = await mountApp(
      tableStubs(DINING, {
        submitGroups: vi.fn(
          (_visitId: string, _submission: unknown, options?: { signal?: AbortSignal }) =>
            new Promise<void>((_resolve, reject) => {
              options?.signal?.addEventListener("abort", () =>
                reject(new DOMException("The operation was aborted.", "AbortError")),
              );
            }),
        ),
      }),
    );
    await toTable(el);
    api.getTablesState.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const settle = async () => {
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;
    };
    lemonadeTile(el).click();
    await settle();
    pressFireAll(el);
    await settle();
    confirmPreview(el);
    await settle();

    await vi.advanceTimersByTimeAsync(150_000);
    await settle();
    await settle();
    expect(roundStore(el).lineCount).toBe(0);
    expect(roundSending(el)).toBeNull();
    lemonadeTile(el).click();
    await settle();
    expect(roundStore(el).lineCount).toBe(1);
  });
});

describe("a round the server adds to another tab while the floor cannot be read", () => {
  it("opens the round for edits without waiting for the floor", async () => {
    const { el } = await mountApp(
      tableStubs(DINING, { submitGroups: vi.fn().mockResolvedValue(landed("wo-next")) }),
    );
    await toTable(el);
    api.getTablesState.mockImplementation(() => new Promise(() => {}));
    await sendLemonadeRound(el);

    expect(roundStore(el).lineCount).toBe(0);
    expect(roundSending(el)).toBeNull();
    lemonadeTile(el).click();
    await flush(el);
    expect(roundStore(el).lineCount).toBe(1);
  });
});

describe("a round that got no answer while its tab moved to another table", () => {
  it("does not follow the table the round was sent from", async () => {
    let fail!: (error: unknown) => void;
    const { el } = await mountApp(
      tableStubs(DINING, {
        getTablesState: vi.fn().mockResolvedValue([seated]),
        getVisitBills: vi.fn().mockResolvedValue([]),
        submitGroups: vi.fn(() => new Promise((_resolve, reject) => (fail = reject))),
        moveTab: vi.fn().mockResolvedValue(undefined),
      }),
    );
    await toTable(el);
    await sendLemonadeRound(el);
    // The tab moves from t2 to t4, and the party, which holds both, has a new tab at t2.
    const spread = { ...party, revision: 2, tableIds: ["t2", "t4"] };
    api.getTablesState.mockResolvedValue([
      { ...seated, tabId: "wo-other", visit: spread },
      { ...seated, id: "t4", label: "4", visit: spread },
    ]);
    emit(tableScreen(el), "move-tab", { toTableId: "t4" });
    await flush(el);
    expect(api.moveTab).toHaveBeenCalledOnce();

    fail(new TypeError("offline"));
    await flush(el);
    await flush(el);
    expect(shownTab(el)).toBe("wo-7");
    expect(api.getTabLines).not.toHaveBeenCalledWith("wo-other");
  });
});

type Layout = ZoneOfferCatalogue["menus"][number]["homeLayouts"][number];
type Fallback = MenuState["menus"][number]["layoutFallback"];

const HOME: Layout = { id: "layout-home", name: "Home", tiles: [] };
const COUNTER: Layout = {
  id: "layout-counter",
  name: "Counter",
  tiles: [{ kind: "product", productId: "Lemonade" }],
};

/** Lunch at `version`, offering V1's dishes, with these layouts and the device's layout. */
function laidOut(
  version: string,
  homeLayouts: Layout[],
  homeLayoutId: string,
  layoutFallback: Fallback = null,
): ZoneOfferCatalogue {
  const source = catalogue(version, V1.offers);
  return {
    ...source,
    menus: source.menus.map((menu) => ({ ...menu, homeLayouts, homeLayoutId, layoutFallback })),
  };
}

function layoutState(version: string, homeLayoutId: string, layoutFallback: Fallback = null) {
  return {
    menus: [{ menuId: "lunch", versionId: version, homeLayoutId, layoutFallback }],
    unavailable: NOTHING,
  } satisfies MenuState;
}

const browser = (el: TillApp) => grid(el).querySelector<TillMenuBrowser>("till-menu-browser")!;
const shortcuts = (el: TillApp) =>
  [...browser(el).shadowRoot!.querySelectorAll('[data-region="shortcuts"] wt-button .name')].map(
    (name) => name.textContent,
  );
const layoutNotice = (el: TillApp) =>
  el
    .shadowRoot!.querySelector<HTMLElement>("[data-layout-notice]")
    ?.textContent?.replace(/\s+/g, " ")
    .trim() ?? null;

describe("the device's home layout", () => {
  it("switches to the layout a poll names for the loaded version, silently and without a reload", async () => {
    const { el } = await mountApp({
      listDefaultZoneOffers: vi
        .fn()
        .mockResolvedValue(laidOut("v1", [HOME, COUNTER], "layout-home")),
    });
    await toCounter(el);
    expect(shortcuts(el)).toEqual([]);
    const shown = browser(el).menu;

    api.menuState.mockResolvedValue(layoutState("v1", "layout-counter"));
    await poll(el);
    expect(browser(el).menu).not.toBe(shown);
    expect(browser(el).menu!.homeLayoutId).toBe("layout-counter");
    expect(shortcuts(el)).toEqual(["Lemonade"]);
    expect(layoutNotice(el)).toBeNull();
    expect(api.listZoneOffers).not.toHaveBeenCalled();
  });

  it("warns once, naming the layout a republish removed, and shows the default", async () => {
    const { el } = await mountApp({
      listDefaultZoneOffers: vi
        .fn()
        .mockResolvedValue(laidOut("v1", [HOME, COUNTER], "layout-counter")),
      listZoneOffers: vi
        .fn()
        .mockResolvedValue(laidOut("v2", [HOME], "layout-home", "layout_removed")),
    });
    await toCounter(el);
    expect(shortcuts(el)).toEqual(["Lemonade"]);

    api.menuState.mockResolvedValue(layoutState("v2", "layout-home", "layout_removed"));
    await poll(el);
    expect(layoutNotice(el)).toContain(
      'The home page layout "Counter" was removed — showing the default',
    );
    expect(shortcuts(el)).toEqual([]);

    el.shadowRoot!.querySelector<HTMLElement>("[data-layout-dismiss]")!.click();
    await flush(el);
    expect(layoutNotice(el)).toBeNull();

    // The server repeats the reason on every answer until a manager changes the choice.
    await poll(el);
    api.listZoneOffers.mockResolvedValue(laidOut("v3", [HOME], "layout-home", "layout_removed"));
    api.menuState.mockResolvedValue(layoutState("v3", "layout-home", "layout_removed"));
    await poll(el);
    expect(api.listZoneOffers).toHaveBeenCalledTimes(2);
    expect(layoutNotice(el)).toBeNull();
  });

  it("warns again when a second layout chosen on the same menu is removed later", async () => {
    const BAR: Layout = {
      id: "layout-bar",
      name: "Bar",
      tiles: [{ kind: "product", productId: "Burger" }],
    };
    const { el } = await mountApp({
      listDefaultZoneOffers: vi
        .fn()
        .mockResolvedValue(laidOut("v1", [HOME, COUNTER, BAR], "layout-counter")),
      listZoneOffers: vi
        .fn()
        .mockResolvedValue(laidOut("v2", [HOME, BAR], "layout-home", "layout_removed")),
    });
    await toCounter(el);
    api.menuState.mockResolvedValue(layoutState("v2", "layout-home", "layout_removed"));
    await poll(el);
    expect(layoutNotice(el)).toContain('"Counter" was removed');
    el.shadowRoot!.querySelector<HTMLElement>("[data-layout-dismiss]")!.click();
    await flush(el);

    // A manager chooses Bar, then deletes it and publishes again.
    api.menuState.mockResolvedValue(layoutState("v2", "layout-bar"));
    await poll(el);
    expect(shortcuts(el)).toEqual(["Burger"]);
    api.listZoneOffers.mockResolvedValue(laidOut("v3", [HOME], "layout-home", "layout_removed"));
    api.menuState.mockResolvedValue(layoutState("v3", "layout-home", "layout_removed"));
    await poll(el);
    expect(layoutNotice(el)).toContain(
      'The home page layout "Bar" was removed — showing the default',
    );
    expect(shortcuts(el)).toEqual([]);
  });

  it("switches silently to the default when the chosen layout was never published", async () => {
    const { el } = await mountApp({
      listDefaultZoneOffers: vi
        .fn()
        .mockResolvedValue(laidOut("v1", [HOME, COUNTER], "layout-counter")),
      listZoneOffers: vi
        .fn()
        .mockResolvedValue(laidOut("v2", [HOME, COUNTER], "layout-home", "layout_unpublished")),
    });
    await toCounter(el);
    api.menuState.mockResolvedValue(layoutState("v2", "layout-home", "layout_unpublished"));
    await poll(el);
    expect(browser(el).menu!.versionId).toBe("v2");
    expect(shortcuts(el)).toEqual([]);
    expect(layoutNotice(el)).toBeNull();
  });

  it("names the menu instead when the till never showed the removed layout", async () => {
    const { el } = await mountApp({
      listDefaultZoneOffers: vi
        .fn()
        .mockResolvedValue(laidOut("v1", [HOME], "layout-home", "layout_removed")),
    });
    await toCounter(el);
    expect(layoutNotice(el)).toContain(
      "The home page layout chosen for the Lunch menu was removed — showing the default",
    );
    expect(shortcuts(el)).toEqual([]);
  });

  it("names the menu, not the default, when the till was already showing the default", async () => {
    const { el } = await mountApp({
      listDefaultZoneOffers: vi
        .fn()
        .mockResolvedValue(laidOut("v1", [HOME, COUNTER], "layout-home", "layout_unpublished")),
    });
    await toCounter(el);
    expect(layoutNotice(el)).toBeNull();
    api.menuState.mockResolvedValue(layoutState("v1", "layout-home", "layout_removed"));
    await poll(el);
    expect(layoutNotice(el)).toContain(
      "The home page layout chosen for the Lunch menu was removed — showing the default",
    );
  });

  it("keeps the loaded layout until it has read the version a poll names a new layout at", async () => {
    let answer!: (value: ZoneOfferCatalogue) => void;
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(laidOut("v1", [HOME], "layout-home")),
      listZoneOffers: vi.fn(() => new Promise((resolve) => (answer = resolve))),
    });
    await toCounter(el);
    const shown = browser(el).menu;
    api.menuState.mockResolvedValue(layoutState("v2", "layout-counter"));
    await poll(el);
    expect(browser(el).menu).toBe(shown);

    answer(laidOut("v2", [HOME, COUNTER], "layout-counter"));
    await flush(el);
    expect(browser(el).menu!.versionId).toBe("v2");
    expect(shortcuts(el)).toEqual(["Lemonade"]);
  });

  it("changes nothing and says nothing when the chosen layout is only renamed (D14)", async () => {
    const renamed: Layout = { ...COUNTER, name: "Bar counter" };
    const { el } = await mountApp({
      listDefaultZoneOffers: vi
        .fn()
        .mockResolvedValue(laidOut("v1", [HOME, COUNTER], "layout-counter")),
      listZoneOffers: vi.fn().mockResolvedValue(laidOut("v2", [HOME, renamed], "layout-counter")),
    });
    await toCounter(el);
    api.menuState.mockResolvedValue(layoutState("v2", "layout-counter"));
    await poll(el);
    expect(browser(el).menu!.versionId).toBe("v2");
    expect(browser(el).menu!.homeLayoutId).toBe("layout-counter");
    expect(shortcuts(el)).toEqual(["Lemonade"]);
    expect(layoutNotice(el)).toBeNull();
  });

  it("says it in the till's language", async () => {
    const { el } = await mountApp({
      listDefaultZoneOffers: vi
        .fn()
        .mockResolvedValue(laidOut("v1", [HOME, COUNTER], "layout-counter")),
      listZoneOffers: vi
        .fn()
        .mockResolvedValue(laidOut("v2", [HOME], "layout-home", "layout_removed")),
      menuState: vi.fn().mockResolvedValue(layoutState("v2", "layout-home", "layout_removed")),
    });
    await toCounter(el);
    setLocale("es-ES");
    await poll(el);
    expect(layoutNotice(el)).toContain(
      "Se ha eliminado la página de inicio «Counter»: se muestra la predeterminada",
    );
  });

  it("warns about a removed layout it first sees on a table's menu", async () => {
    const dining = {
      ...laidOut("v1", [HOME], "layout-home", "layout_removed"),
      context: DINING.context,
    };
    const { el } = await mountApp(
      tableStubs(dining, {
        listZoneOffers: vi.fn((zoneId: string) =>
          Promise.resolve(zoneId === "zone-dining" ? dining : V1),
        ),
      }),
    );
    await toTable(el);
    expect(layoutNotice(el)).toContain(
      "The home page layout chosen for the Lunch menu was removed",
    );
  });

  it("warns once when the counter and the open table both lose the layout they showed", async () => {
    const shown = laidOut("v1", [HOME, COUNTER], "layout-counter");
    const removed = laidOut("v2", [HOME], "layout-home", "layout_removed");
    const inDining = (source: ZoneOfferCatalogue) => ({ ...source, context: DINING.context });
    const { el } = await mountApp(
      tableStubs(inDining(removed), {
        listDefaultZoneOffers: vi.fn().mockResolvedValue(shown),
        listZoneOffers: vi.fn((zoneId: string) =>
          Promise.resolve(zoneId === "zone-dining" ? inDining(shown) : shown),
        ),
      }),
    );
    await toTable(el);
    api.listZoneOffers.mockImplementation((zoneId: string) =>
      Promise.resolve(zoneId === "zone-dining" ? inDining(removed) : removed),
    );
    api.menuState.mockResolvedValue(layoutState("v2", "layout-home", "layout_removed"));
    await poll(el);
    expect(api.listZoneOffers).toHaveBeenCalledWith("zone-dining", expect.anything());
    const lines = el.shadowRoot!.querySelectorAll("[data-layout-notice] [role='status']");
    expect([...lines].map((line) => line.textContent!.trim())).toEqual([
      'The home page layout "Counter" was removed — showing the default',
    ]);
  });

  it("applies a poll's layout to the open table's menu too", async () => {
    const { el } = await mountApp(tableStubs());
    await toTable(el);
    api.menuState.mockResolvedValue(layoutState("v1", "layout-counter"));
    await poll(el);
    const round = roundGrid(el) as unknown as TillMenuBrowser;
    expect(round.menu!.homeLayoutId).toBe("layout-counter");
  });
});

describe("a device behind the live version (§9)", () => {
  const drinks = {
    kind: "section" as const,
    sectionId: "sec-drinks",
    internalName: "drinks",
    names: { en: "Drinks" },
    image: null,
    color: null,
    members: [{ kind: "product" as const, menuItemId: "offer-lemonade", productId: "Lemonade" }],
  };
  const burger = { kind: "product" as const, menuItemId: "offer-burger", productId: "Burger" };

  it("shows the new version as soon as it has read it, while the basket's changes wait for review", async () => {
    const v1 = catalogue("v1", V1.offers);
    v1.menus[0] = { ...v1.menus[0]!, structure: { members: [drinks, burger] } };
    const v2 = catalogue("v2", [offer("offer-lemonade", "Lemonade", "2.50"), burgerOffer()]);
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(v1),
      listZoneOffers: vi.fn().mockResolvedValue(v2),
    });
    await toCounter(el);
    add(el, "Lemonade");
    const drinksButton = [
      ...browser(el).shadowRoot!.querySelectorAll<HTMLElement>(
        '[data-region="structure"] wt-button',
      ),
    ].find((button) => button.textContent!.includes("Drinks"))!;
    drinksButton.click();
    await flush(el);
    expect(browser(el).shadowRoot!.querySelector('[data-region="section"]')).not.toBeNull();

    api.menuState.mockResolvedValue(menuState("v2"));
    await poll(el);
    expect(dialog(el)).not.toBeNull();
    expect(browser(el).menu!.versionId).toBe("v2");
    expect(browser(el).shadowRoot!.querySelector("[role='alert']")!.textContent).toContain(
      "Not found",
    );
  });
});
