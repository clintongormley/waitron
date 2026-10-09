import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import {
  cleanupWidgets,
  draftServer,
  mountWidget,
  type DraftServer,
} from "./widgets/test-helpers.js";
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
import { HOME_DISPLAY_DEFAULTS } from "@waitron/catalogue/src/device-home.js";

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
            portion: "1",
            unit: {
              name: { en: "Each", es: "Unidad", ca: "Unitat", eu: "Unitatea", gl: "Unidade" },
              hardwareUnit: null,
              id: "00000000-0000-0000-0000-000000000001",
              abbreviation: { en: "ea", es: "ud", ca: "u", eu: "u", gl: "u" },
              precision: 0,
            },
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
        publishedDefaultLabelId: null,
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
    service: { open: true, zoneOpen: true, periodName: null, keepOpen: null },
    context: {
      departmentName: "Restaurant",
      zoneId: "zone-counter",
      departmentId: "department-bar",
      serviceMode: "prepay",
    },
    defaultMenuId: "lunch",
    menus: [
      {
        id: "lunch",
        name: "Lunch",
        isDefault: true,
        orderable: true,
        sendable: true,
        audience: "customer",
        versionId: version,
        structure: {
          members: offers.map((each) => ({
            kind: "product" as const,
            menuItemId: each.id,
            productId: each.productId,
          })),
        },
        home: {
          shortcuts: [],
          handheld: HOME_DISPLAY_DEFAULTS.handheld,
          till: HOME_DISPLAY_DEFAULTS.till,
        },
      },
    ],
    offers,
  };
}

const V1 = catalogue("v1", [offer("offer-lemonade", "Lemonade", "3.00"), burgerOffer()]);

const NOTHING: MenuUnavailable = { products: [], optionLabels: [] };

function menuState(version: string, unavailable: Partial<MenuUnavailable> = {}): MenuState {
  return {
    service: { open: true, zoneOpen: true, periodName: null, keepOpen: null },
    menus: [{ menuId: "lunch", versionId: version, orderable: true, sendable: true }],
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
  capabilities: ["print-receipt", "take-cash"] as CapabilityFlag[],
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
    listCounterWaiting: vi.fn().mockResolvedValue([]),
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
  emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
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

let drafts: DraftServer;

beforeEach(() => {
  setLocale("en-GB");
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  drafts = draftServer(() => landed("wo-7"));
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
      "an extras product made Unavailable",
      { products: ["cheese"] },
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
      { menuItemId: "offer-lemonade", menuVersionId: "v2", quantity: "1", makeAt: null },
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
      { menuItemId: "offer-lemonade", menuVersionId: "v2", quantity: "1", makeAt: null },
      { menuItemId: "offer-lemonade", menuVersionId: "v2", quantity: "1", makeAt: null },
    ]);
  });

  it("shows Lemonade €3.00 each → €3.00/kg and waits when v2 sells it by the kilo at the same price", async () => {
    const kg = {
      id: "unit-kg",
      name: { es: "kilo", en: "kilogram" },
      abbreviation: { es: "kg", en: "kg" },
      precision: 3,
      hardwareUnit: "kg" as const,
    };
    const { el } = await mountApp({
      listZoneOffers: vi
        .fn()
        .mockResolvedValue(
          catalogue("v2", [
            offer("offer-lemonade", "Lemonade", "3.00", { unit: kg }),
            burgerOffer(),
          ]),
        ),
    });
    await toCounter(el);
    add(el, "Lemonade");
    api.menuState.mockResolvedValue(menuState("v2"));
    await poll(el);

    expect(dialog(el)).not.toBeNull();
    expect(dialogText(el)).toContain("Lemonade €3.00 each → €3.00/kg");
    expect(counter(el).store.lines[0]!.product.unit).toEqual(unit);
    expect(payButton(el).disabled).toBe(true);

    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!.click();
    await flush(el);
    expect(dialog(el)).toBeNull();
    expect(counter(el).store.lines[0]!.product.unit).toEqual(kg);
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
      [{ menuItemId: "offer-lemonade", menuVersionId: "v1", quantity: "1", makeAt: null }],
      [{ menuItemId: "offer-lemonade", menuVersionId: "v2", quantity: "1", makeAt: null }],
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
      [{ menuItemId: "offer-lemonade", menuVersionId: "v1", quantity: "1", makeAt: null }],
      [{ menuItemId: "offer-lemonade", menuVersionId: "v2", quantity: "1", makeAt: null }],
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

  it("keeps the pay card waiting on the reader through the retry, and puts its choices back when the retry is refused", async () => {
    let refuseRetry: (reason: unknown) => void = () => undefined;
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({
        ...till,
        cardProvider: "stripe_terminal",
        capabilities: ["print-receipt", "integrated-card-payment"] as CapabilityFlag[],
      }),
      listZoneOffers: vi.fn().mockResolvedValue(catalogue("v2", V1.offers)),
      pay: vi
        .fn()
        .mockRejectedValueOnce(refusal)
        .mockImplementationOnce(() => new Promise((_resolve, reject) => (refuseRetry = reject))),
    });
    await toCounter(el);
    add(el, "Lemonade");
    await flush(el);
    tenderPay(el).shadowRoot!.querySelector<HTMLElement>(".pay-card")!.click();
    await flush(el);

    expect(api.pay).toHaveBeenCalledTimes(2);
    await tenderPay(el).updateComplete;
    expect(tenderPay(el).shadowRoot!.querySelector(".collecting")).not.toBeNull();

    refuseRetry({ code: "server.internal", status: 500 });
    await flush(el);
    await tenderPay(el).updateComplete;
    expect(tenderPay(el).shadowRoot!.querySelector(".collecting")).toBeNull();
    expect(tenderPay(el).shadowRoot!.querySelector(".pay-card")).not.toBeNull();
  });

  it("retries placing an order once after a silent adoption", async () => {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
      listDefaultZoneOffers: vi.fn().mockResolvedValue({
        ...V1,
        context: { ...V1.context, serviceMode: "ticket_then_pay" },
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

  it("blocks an unsaved line v2 sells only as an extra, holding Pay until it is removed", async () => {
    const { el } = await mountApp({
      listZoneOffers: vi
        .fn()
        .mockResolvedValue(
          catalogue("v2", [
            offer("offer-lemonade", "Lemonade", "3.00", { ordering: "not_sold_separately" }),
            burgerOffer(),
          ]),
        ),
    });
    await toCounter(el);
    add(el, "Burger");
    add(el, "Lemonade");
    api.menuState.mockResolvedValue(menuState("v2"));
    await poll(el);

    expect(dialogText(el)).toContain("Lemonade is now sold only as an extra on another dish");
    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!.click();
    await flush(el);
    expect(counter(el).store.lines.map((line) => line.blocked)).toEqual([
      undefined,
      "not_sold_separately",
    ]);
    expect(payButton(el).disabled).toBe(true);

    counter(el).store.removeLine(1);
    await flush(el);
    expect(payButton(el).disabled).toBe(false);
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
        departmentName: "Restaurant",
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
  id: "party-a",
  revision: 1,
  guestCount: 2,
  state: "open" as const,
  mainBillId: "wo-7",
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
  signals: [],
  party: party as typeof party | null,
};

/** What a round's submission answers when its lines went on `tabId`. */
const landed = (tabId: string) => ({ tabId, revision: 2, groups: [] });
type Landed = ReturnType<typeof landed>;
/** The lines a round's submission sent, whichever group each went in, read back from the draft. */
const sentLines = (call: unknown[]) =>
  drafts
    .sentGroups(call[2] as Parameters<DraftServer["sentGroups"]>[0])
    .flatMap((group) => group.lines);

type SubmitArgs = Parameters<DraftServer["apply"]>;
/** A draft submission whose reply waits: `hold` is given the function that has the server take the
 * submission and answer `value`. */
const replyLater = (hold: (reply: (value: Landed) => void) => void) =>
  vi.fn(
    (...args: SubmitArgs) =>
      new Promise((resolve) => hold((value) => resolve({ ...drafts.apply(...args), ...value }))),
  );
/** A draft submission the server takes, answering `value`. */
const answering = (value: Landed) =>
  vi.fn(async (...args: SubmitArgs) => ({ ...drafts.apply(...args), ...value }));
/** A draft submission that gets no answer until `hold`'s function is called, and then fails each
 * time it is sent. */
const failLater = (hold: (fail: (error: unknown) => void) => void) => {
  const failure = new Promise<never>((_resolve, reject) => hold(reject));
  failure.catch(() => {});
  return vi.fn(() => failure);
};

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
    listDrafts: drafts.listDrafts,
    saveDraft: drafts.saveDraft,
    submitDraft: drafts.submitDraft,
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
        submitDraft: vi.fn(drafts.submitDraft).mockRejectedValueOnce(versionRefusal),
      }),
    );
    await toTable(el);
    const round = roundGrid(el).store;
    await sendLemonadeRound(el);

    expect(api.submitDraft.mock.calls.map(sentLines)).toEqual([
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
        submitDraft: vi.fn(drafts.submitDraft).mockRejectedValueOnce(versionRefusal),
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

    expect(api.submitDraft.mock.calls.map(sentLines)).toEqual([
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
        submitDraft: vi.fn().mockRejectedValue(versionRefusal),
      }),
    );
    await toTable(el);
    await sendLemonadeRound(el);

    expect(api.submitDraft).toHaveBeenCalledOnce();
    expect(dialogText(el)).toContain("Lemonade €3.00 → €2.50");
    expect(roundGrid(el).store.lineCount).toBe(1);

    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!.click();
    await flush(el);
    expect(roundGrid(el).store.lineCount).toBe(1);
    expect(api.submitDraft).toHaveBeenCalledOnce();
  });

  it("keeps a round whose line the new version removed, marked, and sends nothing", async () => {
    const { el } = await mountApp(
      tableStubs(catalogue("v2", [burgerOffer()]), {
        submitDraft: vi.fn().mockRejectedValue(versionRefusal),
      }),
    );
    await toTable(el);
    await sendLemonadeRound(el);

    expect(dialogText(el)).toContain("Lemonade is no longer on this menu");
    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!.click();
    await flush(el);
    expect(roundGrid(el).store.lines.map((line) => line.blocked)).toEqual(["removed"]);
    expect(api.submitDraft).toHaveBeenCalledOnce();
  });

  it("empties the round once the server has taken it", async () => {
    const { el } = await mountApp(tableStubs());
    await toTable(el);
    const round = roundGrid(el).store;
    await sendLemonadeRound(el);
    expect(api.submitDraft).toHaveBeenCalledOnce();
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
        departmentName: "Restaurant",
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
        submitDraft: replyLater((reply) => (answer = reply)),
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
    expect(sentLines(api.submitDraft.mock.calls[0]!)).toEqual([
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
        submitDraft: vi.fn(drafts.submitDraft).mockRejectedValueOnce(versionRefusal),
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
    expect(api.submitDraft).toHaveBeenCalledTimes(2);
    expect(round.lineCount).toBe(0);
  });
});

describe("a table round refused for another reason", () => {
  it("says a sold-out dish in its own words, and keeps the round", async () => {
    const { el } = await mountApp(
      tableStubs(DINING, {
        submitDraft: vi
          .fn()
          .mockRejectedValue({ code: "product.unavailable", status: 409, productId: "Lemonade" }),
      }),
    );
    await toTable(el);
    await sendLemonadeRound(el);

    expect(banner(el)!.textContent).toContain(codeMessage("product.unavailable"));
    expect(roundStore(el).lineCount).toBe(1);
  });

  it("says a dish sold only as an extra in its own words, keeps the round, and marks the line from the offers read again", async () => {
    const onlyAsExtra = {
      ...DINING,
      offers: [
        offer("offer-lemonade", "Lemonade", "3.00", { ordering: "not_sold_separately" }),
        burgerOffer(),
      ],
    };
    const { el } = await mountApp(
      tableStubs(onlyAsExtra, {
        submitDraft: vi.fn().mockRejectedValue({
          code: "product.not_sold_separately",
          status: 409,
          productId: "Lemonade",
        }),
      }),
    );
    await toTable(el);
    await sendLemonadeRound(el);

    expect(banner(el)!.textContent).toContain(codeMessage("product.not_sold_separately"));
    expect(roundStore(el).lineCount).toBe(1);
    expect(roundStore(el).lines[0]!.blocked).toBe("not_sold_separately");
  });
});

describe("a round line's mark", () => {
  it("clears when the table's zone shows the dish can be sold again", async () => {
    const soldOut = catalogue("v2", [
      offer("offer-lemonade", "Lemonade", "3.00", { available: false }),
      burgerOffer(),
    ]);
    const { el } = await mountApp(
      tableStubs(soldOut, { submitDraft: vi.fn().mockRejectedValue(versionRefusal) }),
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
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
      await flush(el);
      emit(shellGrid(el).shadowRoot!.querySelector("till-floor-screen")!, "open-table", {
        tableId: "t2",
        seated: true,
      });
      await flush(el);
      roundGrid(el).shadowRoot!.querySelector<HTMLElement>("wt-button")!.click();
      await flush(el);
      tableScreen(el).shadowRoot!.querySelector<HTMLElement>("[data-review-open]")!.click();
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
  party: { ...party, id: "party-c", mainBillId: "wo-8", tableIds: ["t3"] },
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
        submitDraft: vi
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

describe("a round refused because a dish in it sold out", () => {
  it("marks the sold-out line", async () => {
    const soldOut = {
      ...DINING,
      offers: [offer("offer-lemonade", "Lemonade", "3.00", { available: false }), burgerOffer()],
    };
    const { el } = await mountApp(
      tableStubs(soldOut, {
        submitDraft: vi
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

    expect(api.submitDraft).toHaveBeenCalledOnce();
    expect(roundStore(el).lineCount).toBe(0);
    expect(roundSending(el)).toBeNull();
    lemonadeTile(el).click();
    await flush(el);
    expect(roundStore(el).lineCount).toBe(1);
  });

  it("opens a round refused sold out for edits while the table's offers are read again", async () => {
    const { el } = await mountApp(
      tableStubs(DINING, { submitDraft: vi.fn().mockRejectedValue(soldOutRefusal) }),
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
      tableStubs(DINING, { submitDraft: vi.fn().mockRejectedValue(versionRefusal) }),
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
    expect(api.submitDraft).toHaveBeenCalledOnce();
  });
});

describe("a round refused sold out whose offers could not be read again", () => {
  it("is marked by the next read of the table's offers that succeeds", async () => {
    const { el } = await mountApp(
      tableStubs(DINING, { submitDraft: vi.fn().mockRejectedValue(soldOutRefusal) }),
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
        submitDraft: vi.fn().mockRejectedValue(soldOutRefusal),
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
      tableStubs(DINING, { submitDraft: answering(landed("wo-next")) }),
    );
    await toTable(el);
    const round = roundStore(el);
    await sendLemonadeRound(el);

    expect(api.submitDraft).toHaveBeenCalledWith(
      "party-a",
      "draft-1",
      expect.objectContaining({ expectedPartyRevision: 1 }),
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
        submitDraft: replyLater((reply) => (answer = reply)),
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
    "The server did not answer, so the items may have been added. Check the tab before sending them again.";

  const shownParty = (el: TillApp) =>
    (tableScreen(el) as unknown as { party: { id: string } | null }).party?.id;

  it("reads the table's party again and shows the tab the table now points at", async () => {
    const { el } = await mountApp(
      tableStubs(DINING, {
        getTablesState: vi.fn().mockResolvedValue([seated]),
        getPartyBills: vi.fn().mockResolvedValue([]),
        submitDraft: vi.fn(async (...args: SubmitArgs) => {
          drafts.apply(...args);
          throw new TypeError("offline");
        }),
      }),
    );
    await toTable(el);
    api.getTablesState.mockResolvedValue([
      { ...seated, party: { ...party, revision: 2, mainBillId: "wo-next" } },
    ]);
    const round = roundStore(el);
    await sendLemonadeRound(el);
    // Two pauses between the three tries run on real time; wait for the message they end in.
    await vi.waitFor(() => expect(banner(el)?.textContent).toContain(unconfirmed), {
      timeout: 4000,
      interval: 50,
    });
    await flush(el);

    expect(shownTab(el)).toBe("wo-next");
    expect(api.getTabLines).toHaveBeenLastCalledWith("wo-next");
    expect(shownParty(el)).toBe("party-a");
    expect(api.getPartyBills).toHaveBeenLastCalledWith("party-a");
    expect(round.lineCount).toBe(0);
    expect(banner(el)!.textContent).toContain(unconfirmed);
  });

  it("does not follow the table onto a new party's tab", async () => {
    const { el } = await mountApp(
      tableStubs(DINING, {
        getTablesState: vi.fn().mockResolvedValue([seated]),
        getPartyBills: vi.fn().mockResolvedValue([]),
        submitDraft: vi.fn().mockRejectedValue(new TypeError("offline")),
      }),
    );
    await toTable(el);
    // Another till settled and cleared the party, and seated a new one at the same table.
    api.getTablesState.mockResolvedValue([
      { ...seated, party: { ...party, id: "party-b", mainBillId: "wo-other" } },
    ]);
    await sendLemonadeRound(el);
    // Two pauses between the three tries run on real time; wait for the message they end in.
    await vi.waitFor(() => expect(banner(el)?.textContent).toContain(unconfirmed), {
      timeout: 4000,
      interval: 50,
    });
    await flush(el);

    expect(shownTab(el)).toBe("wo-7");
    expect(api.getTabLines).not.toHaveBeenCalledWith("wo-other");
    expect(shownParty(el)).toBe("party-a");
    expect(api.getPartyBills).not.toHaveBeenCalledWith("party-b");
    expect(banner(el)!.textContent).toContain(unconfirmed);
  });

  it("sends nothing, and follows nothing, when the tab had no party", async () => {
    // The till opens a table by its party's bills, so the order on screen has no party only once
    // its party has left the table.
    const { el } = await mountApp(
      tableStubs(DINING, {
        getTablesState: vi.fn().mockResolvedValue([seated]),
        getPartyBills: vi.fn().mockResolvedValue([]),
        mergeBills: vi.fn().mockResolvedValue(undefined),
      }),
    );
    await toTable(el);
    api.getTablesState.mockResolvedValue([{ ...table, party: null }]);
    emit(tableScreen(el), "merge-bills", { fromBillId: "wo-9" });
    await flush(el);
    api.getTablesState.mockResolvedValue([
      { ...seated, party: { ...party, id: "party-b", mainBillId: "wo-other" } },
    ]);
    const floorReads = api.getTablesState.mock.calls.length;
    await sendLemonadeRound(el);
    await flush(el);

    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(shownTab(el)).toBe("wo-7");
    expect(api.getTabLines).not.toHaveBeenCalledWith("wo-other");
    expect(api.getTablesState).toHaveBeenCalledTimes(floorReads);
    expect(roundStore(el).lineCount).toBe(1);
  });

  it("leaves the operator on the table they opened while the send was out", async () => {
    let fail!: (error: unknown) => void;
    const { el } = await mountApp(
      tableStubs(DINING, {
        getTablesState: vi.fn().mockResolvedValue([seated, tableB]),
        getPartyBills: vi.fn().mockResolvedValue([]),
        submitDraft: failLater((reject) => (fail = reject)),
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
      { ...seated, party: { ...party, revision: 2, mainBillId: "wo-next" } },
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
        submitDraft: vi.fn(
          (
            partyId: string,
            draftId: string,
            submission: SubmitArgs[2],
            options?: { signal?: AbortSignal },
          ) => {
            drafts.apply(partyId, draftId, submission);
            return new Promise<void>((_resolve, reject) => {
              options?.signal?.addEventListener("abort", () =>
                reject(new DOMException("The operation was aborted.", "AbortError")),
              );
            });
          },
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
      tableStubs(DINING, { submitDraft: answering(landed("wo-next")) }),
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
        getPartyBills: vi.fn().mockResolvedValue([]),
        submitDraft: failLater((reject) => (fail = reject)),
        moveGuests: vi
          .fn()
          .mockResolvedValue({ partyId: "party-a", mainBillId: "wo-other", merged: false }),
      }),
    );
    await toTable(el);
    await sendLemonadeRound(el);
    // The guests move from t2 to t4, and the party, which holds both, has a new main bill.
    const spread = { ...party, revision: 2, mainBillId: "wo-other", tableIds: ["t2", "t4"] };
    api.getTablesState.mockResolvedValue([
      { ...seated, party: spread },
      { ...seated, id: "t4", label: "4", party: spread },
    ]);
    emit(tableScreen(el), "move-guests", { toTableId: "t4", bills: "merge" });
    await flush(el);
    expect(api.moveGuests).toHaveBeenCalledOnce();

    fail(new TypeError("offline"));
    await flush(el);
    await flush(el);
    expect(shownTab(el)).toBe("wo-7");
    expect(api.getTabLines).not.toHaveBeenCalledWith("wo-other");
  });
});

type Shortcuts = ZoneOfferCatalogue["menus"][number]["home"]["shortcuts"];

/** Lunch at `version`, offering V1's dishes, with these shortcuts on its Device Home Page. */
function withShortcuts(version: string, shortcuts: Shortcuts): ZoneOfferCatalogue {
  const source = catalogue(version, V1.offers);
  return {
    ...source,
    menus: source.menus.map((menu) => ({ ...menu, home: { ...menu.home, shortcuts } })),
  };
}

const browser = (el: TillApp) => grid(el).querySelector<TillMenuBrowser>("till-menu-browser")!;
const shortcuts = (el: TillApp) =>
  [...browser(el).shadowRoot!.querySelectorAll('[data-region="shortcuts"] wt-button .name')].map(
    (name) => name.textContent,
  );

describe("the menu's Device Home Page", () => {
  it("keeps the home block it shows until it has read the version a poll names", async () => {
    let answer!: (value: ZoneOfferCatalogue) => void;
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(withShortcuts("v1", [])),
      listZoneOffers: vi.fn(() => new Promise((resolve) => (answer = resolve))),
    });
    await toCounter(el);
    const shown = browser(el).menu;
    api.menuState.mockResolvedValue({
      service: { open: true, zoneOpen: true, periodName: null, keepOpen: null },
      menus: [{ menuId: "lunch", versionId: "v2", orderable: true, sendable: true }],
      unavailable: NOTHING,
    } satisfies MenuState);
    await poll(el);
    expect(browser(el).menu).toBe(shown);
    expect(shortcuts(el)).toEqual([]);

    answer(withShortcuts("v2", [{ kind: "product", productId: "Lemonade" }]));
    await flush(el);
    expect(browser(el).menu!.versionId).toBe("v2");
    expect(shortcuts(el)).toEqual(["Lemonade"]);
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

describe("keep-open changes refresh the order screen", () => {
  const initialService = {
    open: true,
    zoneOpen: true,
    periodName: "Lunch",
    keepOpen: {
      periodId: "lunch",
      periodName: "Lunch",
      endsAt: "14:00",
      running: true,
      extendedUntil: null,
    },
  };
  const extendedService = {
    ...initialService,
    keepOpen: { ...initialService.keepOpen, extendedUntil: "14:30" },
  };
  it("redraws the counter after a poll changes only the extension", async () => {
    let service = initialService as ZoneOfferCatalogue["service"];
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue({ ...V1, service: initialService }),
      listZoneOffers: vi.fn(() => Promise.resolve({ ...V1, service })),
      menuState: vi.fn(() => Promise.resolve({ ...menuState("v1"), service })),
    });
    await toCounter(el);
    add(el, "Lemonade");
    service = extendedService;
    await poll(el);
    await expect
      .poll(() =>
        counter(el).shadowRoot!.querySelector("[data-service-period]")?.textContent?.trim(),
      )
      .toBe("Lunch · kept open until 14:30");
    expect(
      counter(el).store.lines.map((line) => [
        line.product.productId,
        line.quantity,
        line.product.unitPrice,
      ]),
    ).toEqual([["Lemonade", "1", "3.00"]]);
  });
  it("refreshes the counter immediately after a successful keep-open change", async () => {
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue({ ...V1, service: initialService }),
      listZoneOffers: vi.fn().mockResolvedValue({ ...V1, service: extendedService }),
      menuState: vi.fn().mockResolvedValue({ ...menuState("v1"), service: extendedService }),
    });
    await toCounter(el);
    const widget = counter(el).shadowRoot!.querySelector("till-keep-open");
    expect(widget, "the app mounts the counter control").not.toBeNull();
    emit(widget!, "keep-open-changed", { zoneId: "zone-counter" });
    await expect
      .poll(() =>
        counter(el).shadowRoot!.querySelector("[data-service-period]")?.textContent?.trim(),
      )
      .toBe("Lunch · kept open until 14:30");
    expect(api.menuState.mock.calls.map(([zone]) => zone)).toEqual(["zone-counter"]);
  });
  it("redraws the canvas table screen after a poll changes only the extension", async () => {
    let service = initialService as ZoneOfferCatalogue["service"];
    const { el } = await mountApp(
      tableStubs(DINING, {
        listZoneOffers: vi.fn((zone: string) =>
          Promise.resolve(zone === "zone-dining" ? { ...DINING, service } : V1),
        ),
        menuState: vi.fn(() => Promise.resolve({ ...menuState("v1"), service })),
      }),
    );
    await toTable(el);
    api.listZoneOffers.mockImplementation((zone: string) =>
      Promise.resolve(zone === "zone-dining" ? { ...DINING, service } : V1),
    );
    service = extendedService;
    await poll(el);
    await expect
      .poll(() =>
        tableScreen(el).shadowRoot!.querySelector("[data-service-period]")?.textContent?.trim(),
      )
      .toBe("Lunch · kept open until 14:30");
    expect(dialog(el)).toBeNull();
  });
  it("passes the API and dining zone through the canvas card and refreshes it after a change", async () => {
    const { el } = await mountApp(
      tableStubs(DINING, {
        listZoneOffers: vi.fn((zone: string) =>
          Promise.resolve(zone === "zone-dining" ? { ...DINING, service: initialService } : V1),
        ),
        menuState: vi.fn().mockResolvedValue({ ...menuState("v1"), service: extendedService }),
      }),
    );
    await toTable(el);
    api.listZoneOffers.mockImplementation((zone: string) =>
      Promise.resolve(zone === "zone-dining" ? { ...DINING, service: extendedService } : V1),
    );
    const widget = tableScreen(el).shadowRoot!.querySelector<
      HTMLElement & { api: TillApi; zoneId: string }
    >("till-keep-open");
    expect(widget, "the embedded table control is mounted").not.toBeNull();
    expect(widget!.api).toBe(api);
    expect(widget!.zoneId).toBe("zone-dining");
    emit(widget!, "keep-open-changed", { zoneId: "zone-dining" });
    await expect
      .poll(() =>
        tableScreen(el).shadowRoot!.querySelector("[data-service-period]")?.textContent?.trim(),
      )
      .toBe("Lunch · kept open until 14:30");
    expect(api.menuState.mock.calls.map(([zone]) => zone)).toEqual(["zone-dining"]);
  });
});

it("passes keep-open recovery through a standalone table drill", async () => {
  const service = {
    open: false,
    zoneOpen: true,
    periodName: null,
    keepOpen: {
      periodId: "lunch",
      periodName: "Lunch",
      endsAt: "14:00",
      running: false,
      extendedUntil: null,
    },
  };
  const { el } = await mountApp(
    tableStubs(DINING, {
      getTill: vi.fn().mockResolvedValue({
        ...till,
        canvas: { ...tableCanvas, tabs: tableCanvas.tabs.filter((tab) => tab.key !== "order") },
      }),
      listZoneOffers: vi.fn((zone: string) =>
        Promise.resolve(zone === "zone-dining" ? { ...DINING, service } : V1),
      ),
      menuState: vi.fn().mockResolvedValue({
        ...menuState("v1"),
        service: {
          ...service,
          open: true,
          zoneOpen: true,
          periodName: "Lunch",
          keepOpen: { ...service.keepOpen, running: true, extendedUntil: "14:30" },
        },
      }),
    }),
  );
  await toTable(el);
  api.listZoneOffers.mockImplementation((zone: string) =>
    Promise.resolve(
      zone === "zone-dining"
        ? {
            ...DINING,
            service: {
              ...service,
              open: true,
              zoneOpen: true,
              periodName: "Lunch",
              keepOpen: { ...service.keepOpen, running: true, extendedUntil: "14:30" },
            },
          }
        : V1,
    ),
  );
  const screen = el.shadowRoot!.querySelector("till-table-order-screen")!;
  expect(screen, "the standalone order drill is reachable").not.toBeNull();
  const widget = screen.shadowRoot!.querySelector<HTMLElement & { api: TillApi; zoneId: string }>(
    "till-keep-open",
  )!;
  expect(widget, "the closed drill exposes recovery").not.toBeNull();
  expect(widget.api).toBe(api);
  expect(widget.zoneId).toBe("zone-dining");
  emit(widget, "keep-open-changed", { zoneId: "zone-dining" });
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-service-period]")?.textContent?.trim())
    .toBe("Lunch · kept open until 14:30");
  expect(api.menuState.mock.calls.map(([zone]) => zone)).toEqual(["zone-dining"]);
});

describe("zone-only menu-state changes", () => {
  it("redraws the counter when only its zone closes and reopens", async () => {
    const { el } = await mountApp();
    await toCounter(el);
    const closed = { ...V1, service: { ...V1.service, zoneOpen: false } };
    api.listZoneOffers.mockResolvedValue(closed);
    api.menuState.mockResolvedValue({ ...menuState("v1"), service: closed.service });
    await poll(el);
    await vi.waitFor(() =>
      expect(counter(el).shadowRoot!.querySelector("[data-zone-closed]")).not.toBeNull(),
    );
    expect(counter(el).shadowRoot!.querySelector("till-menu-switcher")).toBeNull();
    api.listZoneOffers.mockResolvedValue(V1);
    api.menuState.mockResolvedValue(menuState("v1"));
    await poll(el);
    await vi.waitFor(() =>
      expect(counter(el).shadowRoot!.querySelector("[data-zone-closed]")).toBeNull(),
    );
    expect(counter(el).shadowRoot!.querySelector("till-menu-switcher")).not.toBeNull();
  });

  it("redraws the open table when only its zone closes and reopens", async () => {
    const { el } = await mountApp(tableStubs());
    await toTable(el);
    const closed = { ...DINING, service: { ...DINING.service, zoneOpen: false } };
    api.listZoneOffers.mockImplementation((id: string) =>
      Promise.resolve(id === "zone-dining" ? closed : V1),
    );
    api.menuState.mockImplementation((id: string) =>
      Promise.resolve({
        ...menuState("v1"),
        service: id === "zone-dining" ? closed.service : V1.service,
      }),
    );
    await poll(el);
    await vi.waitFor(() =>
      expect(tableScreen(el).shadowRoot!.querySelector("[data-zone-closed]")).not.toBeNull(),
    );
    expect(tableScreen(el).shadowRoot!.querySelector("till-menu-browser")).toBeNull();
    api.listZoneOffers.mockImplementation((id: string) =>
      Promise.resolve(id === "zone-dining" ? DINING : V1),
    );
    api.menuState.mockResolvedValue(menuState("v1"));
    await poll(el);
    await vi.waitFor(() =>
      expect(tableScreen(el).shadowRoot!.querySelector("[data-zone-closed]")).toBeNull(),
    );
    expect(tableScreen(el).shadowRoot!.querySelector("till-menu-browser")).not.toBeNull();
  });
});
