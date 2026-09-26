import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import { setLocale } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillTenderPay } from "./widgets/tender-pay.js";
import type { TillBasketRefreshDialog } from "./widgets/basket-refresh-dialog.js";
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
    menus: [{ id: "lunch", name: "Lunch", isDefault: true, versionId: version }],
    offers,
  };
}

const V1 = catalogue("v1", [offer("offer-lemonade", "Lemonade", "3.00"), burgerOffer()]);

const NOTHING: MenuUnavailable = { products: [], optionLabels: [], extraItems: [] };

function menuState(version: string, unavailable: Partial<MenuUnavailable> = {}): MenuState {
  return {
    menus: [{ menuId: "lunch", versionId: version }],
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
      .querySelector("till-product-grid")!
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
