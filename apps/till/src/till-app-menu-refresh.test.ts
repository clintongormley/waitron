import { idleLiveReadFor } from "./widgets/test-helpers.js";
import { liveReadFixture } from "../test/live-connection.js";
import { answeredPartyAllergy } from "../test/answered-party-allergy.js";
import { deviceZonesFixture, deviceZonesFor } from "../test/device-zones.js";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  floorPartyBills,
  partyBillOf,
  cleanupWidgets,
  draftServer,
  mountWidget,
  type DraftServer,
} from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import { DRAFT_SAVE_DELAY_MS, TABLE_REQUEST_LIMIT_MS } from "./state/draft-sync.js";
import { setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillTenderPay } from "./widgets/tender-pay.js";
import type { TillBasketRefreshDialog } from "./widgets/basket-refresh-dialog.js";
import type { TillMenuBrowser } from "./widgets/menu-browser.js";
import type { FormFactor, CapabilityFlag } from "./layout.js";
import { setMenuProduct } from "./widgets/product-pick.js";
import type { WorkingOrderStore } from "./state/working-order.js";
import { menuOfferToTillProduct } from "./api/client.js";
import type {
  MenuState,
  DeviceEquipment,
  MenuUnavailable,
  TillApi,
  TillMenuOffer,
  TillProduct,
  TillSaleResult,
  ZoneOffers,
} from "./api/client.js";
import { DEFAULT_HOME_ORDER, setMenuCopyOf, type SetMenuTerms } from "@waitron/shared";

// Lunch is published as v1 and then as v2. Lemonade and Burger are on it; Burger offers an extras list
// (cheese) and an options list (rare / medium).

const unit = {
  staffName: "Staff unit",
  staffAbbreviation: "su",
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
    takeawayVatClass: "general",
    category: null,
    allergens: null,
    diet: null,
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
            presentation: {
              name: "Extra cheese",
              customerName: null,
              kitchenName: null,
              variantName: null,
              variantCustomerName: null,
              variantKitchenName: null,
            },
            portion: "1",
            unit: {
              staffName: "Staff unit",
              staffAbbreviation: "su",
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
            takeawayVatClass: "general",
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

function menu(version: string, offers: TillMenuOffer[]): ZoneOffers {
  return {
    service: {
      open: true,
      zoneOpen: true,
      periodName: null,
      periodOccurrenceKey: null,
      keepOpen: null,
      zoneKeepOpen: null,
    },
    context: {
      dining: null,
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
        endedPeriodName: null,
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
          order: DEFAULT_HOME_ORDER,
        },
      },
    ],
    offers,
  };
}

const V1 = menu("v1", [offer("offer-lemonade", "Lemonade", "3.00"), burgerOffer()]);

const NOTHING: MenuUnavailable = { products: [], optionLabels: [] };

function menuState(version: string, unavailable: Partial<MenuUnavailable> = {}): MenuState {
  return {
    service: {
      open: true,
      zoneOpen: true,
      periodName: null,
      periodOccurrenceKey: null,
      keepOpen: null,
      zoneKeepOpen: null,
    },
    menus: [{ menuId: "lunch", versionId: version, orderable: true, endedPeriodName: null }],
    unavailable: { ...NOTHING, ...unavailable },
  };
}

const saleResult: TillSaleResult = {
  receiptTrim: {},
  venueAddress: [],
  receiptSettings: { printAddress: false },
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

const formFactor: FormFactor = "till";

const till = {
  locale: "en-GB",
  invoiceLocale: "es-ES",
  venueName: "Bar Pepe",
  nif: "B12345678",
  orderFlow: "prepay" as const,
  courses: [],
  cardProvider: "none" as const,
  tipsEnabled: false,
  formFactor: formFactor,
  capabilities: ["print-receipt", "take-cash"] as CapabilityFlag[],
  inactivityTimeoutSeconds: null,
  nodeId: "n1",
  servers: [],
};

let api: Record<string, ReturnType<typeof vi.fn>>;
function stubApi(overrides: Record<string, unknown> = {}) {
  return idleLiveReadFor({
    getDeviceZones: vi.fn().mockResolvedValue(deviceZonesFixture(undefined, ["zone-dining"])),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    setWorkingOrderLabel: vi.fn(async (_id: string, request: { revision: number }) => ({
      revision: request.revision + 1,
    })),
    getKitchenNote: vi.fn(async (scope: { workingOrderId: string } | { partyId: string }) => ({
      scope,
      note: null,
      revision: 0,
      ownerRevision: 0,
    })),
    getTill: vi.fn().mockResolvedValue(till),
    getLocales: vi.fn().mockResolvedValue({ locales: [], venueDefault: "es-ES" }),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal", status: 404 }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "till-dev",
      name: "Till 1",
      formFactor: "till",
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
  } as Record<string, ReturnType<typeof vi.fn>>);
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
  const mounted = await mountWidget<TillApp>("till-app", {
    api: api as unknown as TillApi,
    ...props,
  });
  Object.assign(api, answeredPartyAllergy(mounted.el));
  return mounted;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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
const grid = (el: TillApp) => counter(el).shadowRoot!;
const tenderPay = (el: TillApp) => grid(el).querySelector<TillTenderPay>("till-tender-pay")!;
const payButton = (el: TillApp) =>
  tenderPay(el).shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
    "[data-counter-pay], .pay, .pay-card",
  )!;
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
  for (const id of ["wo-7", "wo-8", "wo-9", "wo-next"]) drafts.bills.add(id);
});
afterEach(() => {
  cleanupWidgets();
  vi.useRealTimers();
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
    expect(tile(el, "Burger").hasAttribute("data-sold-out")).toBe(true);
    expect(tile(el, "Lemonade").disabled).toBe(false);
    expect(api.listDefaultZoneOffers).toHaveBeenCalledOnce();
    expect(api.listZoneOffers).not.toHaveBeenCalled();

    api.menuState.mockResolvedValue(menuState("v1"));
    await poll(el);
    expect(tile(el, "Burger").disabled).toBe(false);
  });

  it.each([
    [
      "the dish",
      { products: ["Burger"] },
      { options: [{ listId: "list-cooked", labelId: "rare" }] },
      "unavailable",
    ],
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
        options: [{ listId: "list-cooked", labelId: "rare" }],
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

describe("a department's way of selling on a running till (A1522)", () => {
  it("a poll answering a changed way changes the next draft and the sale it sends", async () => {
    const { el } = await mountApp();
    await toCounter(el);
    expect(counter(el).store.dining).toBe("eat_in");

    api.menuState.mockResolvedValue({
      ...menuState("v1"),
      dining: { policy: "takeaway", startsAs: "takeaway" },
    });
    await poll(el);

    expect(api.listZoneOffers).not.toHaveBeenCalled();
    expect(counter(el).store.dining).toBe("takeaway");
    add(el, "Lemonade");
    await pay(el);
    expect(api.recordSale.mock.calls[0]![9]).toBe("takeaway");
  });

  it("a poll answering a region without takeaway VAT starts the next draft eaten here", async () => {
    const takeaway = { policy: "takeaway", startsAs: "takeaway" } as const;
    const { el } = await mountApp({
      listDefaultZoneOffers: vi
        .fn()
        .mockResolvedValue({ ...V1, context: { ...V1.context, dining: takeaway } }),
    });
    await toCounter(el);
    expect(counter(el).store.dining).toBe("takeaway");
    api.menuState.mockResolvedValue({ ...menuState("v1"), dining: null });
    await poll(el);

    expect(counter(el).store.dining).toBe("eat_in");
  });

  it("a poll answering a changed way for an open table's zone hands the table that way", async () => {
    const { el } = await mountApp(tableStubs());
    await toTable(el);
    expect(tableScreen(el).diningStart).toBeNull();
    const takeaway = { policy: "takeaway", startsAs: "takeaway" } as const;

    api.menuState.mockImplementation(async (zoneId: string) => ({
      ...menuState("v1"),
      dining: zoneId === "zone-dining" ? takeaway : null,
    }));
    await poll(el);

    expect(tableScreen(el).diningStart).toEqual(takeaway);
  });
});

describe("a basket that spans a publish", () => {
  it("adopts v2 silently when only a line the basket does not hold changed, keeping the lines", async () => {
    const { el } = await mountApp({
      listZoneOffers: vi
        .fn()
        .mockResolvedValue(
          menu("v2", [offer("offer-lemonade", "Lemonade", "3.00"), burgerOffer("1.20")]),
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

  it("defers a poll answer while the basket is locked for editing", async () => {
    const offers = deferred<ZoneOffers>();
    const listZoneOffers = vi.fn().mockReturnValueOnce(offers.promise);
    const { el } = await mountApp({ listZoneOffers });
    const { store } = await toCounter(el);
    add(el, "Lemonade");
    api.menuState.mockResolvedValue(menuState("v2"));
    await poll(el);
    expect(listZoneOffers).toHaveBeenCalledOnce();

    const unlock = store.lockEdits();
    const v2 = menu("v2", V1.offers);
    listZoneOffers.mockResolvedValue(v2);
    offers.resolve(v2);
    await flush(el);
    expect(store.lines[0]!.product.menuVersionId).toBe("v1");

    unlock();
    await poll(el);
    expect(listZoneOffers).toHaveBeenCalledTimes(2);
    expect(store.lines[0]!.product.menuVersionId).toBe("v2");
  });

  it("picks up postponed offers when payment clears the basket before another poll", async () => {
    const offers = deferred<ZoneOffers>();
    const sale = deferred<typeof saleResult>();
    const listZoneOffers = vi.fn().mockReturnValueOnce(offers.promise);
    const { el } = await mountApp({
      listZoneOffers,
      recordSale: vi.fn().mockReturnValueOnce(sale.promise),
      printReceipt: vi.fn().mockResolvedValue(undefined),
    });
    const { store } = await toCounter(el);
    add(el, "Lemonade");
    api.menuState.mockResolvedValue(menuState("v2"));
    await poll(el);
    expect(listZoneOffers).toHaveBeenCalledOnce();

    await pay(el);
    expect(api.recordSale).toHaveBeenCalledOnce();
    const v2 = menu("v2", V1.offers);
    listZoneOffers.mockResolvedValue(v2);
    offers.resolve(v2);
    await flush(el);
    expect(store.lines[0]!.product.menuVersionId).toBe("v1");

    sale.resolve(saleResult);
    await flush(el);
    emit(el.shadowRoot!.querySelector("till-settlement-document-dialog")!, "settlement-close");
    await flush(el);
    expect(store.lines).toEqual([]);
    expect(
      counter(el).products.find((product) => product.productId === "Lemonade")!.menuVersionId,
    ).toBe("v2");
  });

  it("does not read new offers while an empty basket is locked for editing", async () => {
    const { el } = await mountApp({
      listZoneOffers: vi.fn().mockResolvedValue(menu("v2", V1.offers)),
    });
    const { store } = await toCounter(el);
    const unlock = store.lockEdits();
    api.menuState.mockResolvedValue(menuState("v2"));
    await poll(el);
    expect(api.listZoneOffers).not.toHaveBeenCalled();

    unlock();
    await poll(el);
    expect(api.listZoneOffers).toHaveBeenCalledOnce();
  });

  it("shows Lemonade €3.00 → €2.50 and waits; confirming re-prices it and the next request asserts v2", async () => {
    const { el } = await mountApp({
      listZoneOffers: vi
        .fn()
        .mockResolvedValue(
          menu("v2", [offer("offer-lemonade", "Lemonade", "2.50"), burgerOffer()]),
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
      staffName: "Staff unit",
      staffAbbreviation: "su",
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
          menu("v2", [offer("offer-lemonade", "Lemonade", "3.00", { unit: kg }), burgerOffer()]),
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
          menu("v2", [offer("offer-lemonade", "Lemonade", "2.50"), burgerOffer()]),
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
      listZoneOffers: vi.fn().mockResolvedValue(menu("v2", [burgerOffer()])),
    });
    await toCounter(el);
    add(el, "Burger", { options: [{ listId: "list-cooked", labelId: "rare" }] });
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
          menu("v2", [offer("offer-lemonade", "Lemonade", "3.00"), soldOutCheese]),
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
      options: [{ listId: "list-cooked", labelId: "rare" }],
    });
    api.menuState.mockResolvedValue(menuState("v2"));
    await poll(el);

    expect(dialogText(el)).toContain("Extra cheese is not available");
    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!.click();
    await flush(el);
    expect(counter(el).store.lines[0]!.blocked).toBe("extra_unavailable");
    expect(payButton(el).disabled).toBe(true);

    counter(el).store.removeLine(0);
    add(el, "Burger", { options: [{ listId: "list-cooked", labelId: "rare" }] });
    await flush(el);
    expect(counter(el).store.lines[0]!.blocked).toBeUndefined();
    expect(payButton(el).disabled).toBe(false);
  });

  it("blocks a line whose dish v2 sells in a measure, for its extra, until it is replaced", async () => {
    const measured = { ...burgerOffer("1.20"), unit: { ...unit, measure: true as const } };
    const { el } = await mountApp({
      listZoneOffers: vi
        .fn()
        .mockResolvedValue(menu("v2", [offer("offer-lemonade", "Lemonade", "3.00"), measured])),
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
      options: [{ listId: "list-cooked", labelId: "rare" }],
    });
    api.menuState.mockResolvedValue(menuState("v2"));
    await poll(el);

    expect(dialogText(el)).toContain("Extra cheese is no longer offered with this dish");
    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!.click();
    await flush(el);
    expect(counter(el).store.lines[0]!.blocked).toBe("extra_removed");
    expect(counter(el).store.lines[0]!.extras).toEqual([
      expect.objectContaining({ productId: "cheese", price: "1.00" }),
    ]);
    expect(payButton(el).disabled).toBe(true);

    counter(el).store.removeLine(0);
    add(el, "Burger", { options: [{ listId: "list-cooked", labelId: "rare" }] });
    await flush(el);
    expect(counter(el).store.lines[0]!.blocked).toBeUndefined();
    expect(payButton(el).disabled).toBe(false);
  });
});

describe("a pay refused because the menu changed", () => {
  it("retains manual tip details after the automatic menu retry refuses the tip", async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce({ code: "menu.version_changed", status: 409, menus: [] })
      .mockRejectedValueOnce({ code: "bill.tip_not_allowed", status: 400 });
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({
        ...till,
        tipsEnabled: true,
        capabilities: [...till.capabilities, "hand-keyed-card-payment"],
      }),
      listZoneOffers: vi.fn().mockResolvedValue(menu("v2", V1.offers)),
      recordSale: write,
    });
    await toCounter(el);
    add(el, "Lemonade");
    await flush(el);
    const form = tenderPay(el);
    emit(form, "confirm-payment", {
      method: "card",
      amount: "3.00",
      addedTip: "0.30",
      externalRef: "OP-TIP",
      externalMachine: "Spare Solo",
    });
    await flush(el);
    expect(write).toHaveBeenCalledTimes(2);
    expect(
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(".tip-input")?.value,
    ).toBe("0.30");
    expect(
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(".ref-input")?.value,
    ).toBe("OP-TIP");
  });

  const refusal = {
    code: "menu.version_changed",
    status: 409,
    menus: [{ menuId: "lunch", liveVersionId: "v2" }],
  };

  it("runs the refresh flow, and after a silent adoption retries the pay once, asserting v2", async () => {
    const { el } = await mountApp({
      listZoneOffers: vi.fn().mockResolvedValue(menu("v2", V1.offers)),
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
    expect(el.shadowRoot!.querySelector("till-settlement-document-dialog")).not.toBeNull();
  });

  it("retries a refused payment using the offers read already started by the poll", async () => {
    const offers = deferred<ZoneOffers>();
    const { el } = await mountApp({
      listZoneOffers: vi.fn().mockReturnValue(offers.promise),
      recordSale: vi.fn().mockRejectedValueOnce(refusal).mockResolvedValueOnce(saleResult),
    });
    await toCounter(el);
    add(el, "Lemonade");
    api.menuState.mockResolvedValue(menuState("v2"));
    await poll(el);
    expect(api.listZoneOffers).toHaveBeenCalledOnce();

    await pay(el);
    expect(api.recordSale).toHaveBeenCalledOnce();
    offers.resolve(menu("v2", V1.offers));
    await flush(el);

    expect(api.listZoneOffers).toHaveBeenCalledOnce();
    expect(api.recordSale.mock.calls.map((call) => call[0][0].menuVersionId)).toEqual(["v1", "v2"]);
  });

  it("retries only once: a second refusal is shown in the menu-change words", async () => {
    const { el } = await mountApp({
      listZoneOffers: vi.fn().mockResolvedValue(menu("v2", V1.offers)),
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
          menu("v2", [offer("offer-lemonade", "Lemonade", "2.50"), burgerOffer()]),
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
      listZoneOffers: vi.fn().mockResolvedValue(menu("v2", V1.offers)),
      parkOrder: vi
        .fn()
        .mockRejectedValueOnce(refusal)
        .mockResolvedValueOnce({ id: "wo-1", orderNumber: 5 }),
    });
    await toCounter(el);
    add(el, "Lemonade");
    emit(counter(el), "park-order", { label: "Table 4" });
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
      listZoneOffers: vi.fn().mockResolvedValue(menu("v2", V1.offers)),
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
    expect(el.shadowRoot!.querySelector("till-settlement-document-dialog")).not.toBeNull();
  });

  it("keeps the pay card waiting on the reader through the retry, and puts its choices back when the retry is refused", async () => {
    let refuseRetry: (reason: unknown) => void = () => undefined;
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({
        ...till,
        cardProvider: "stripe_terminal",
        capabilities: ["print-receipt", "integrated-card-payment"] as CapabilityFlag[],
      }),
      listZoneOffers: vi.fn().mockResolvedValue(menu("v2", V1.offers)),
      pay: vi
        .fn()
        .mockRejectedValueOnce(refusal)
        .mockImplementationOnce(() => new Promise((_resolve, reject) => (refuseRetry = reject))),
    });
    await toCounter(el);
    add(el, "Lemonade");
    await flush(el);
    Object.assign(el, { stage: "collect", collectFlow: "ticket_then_pay" });
    el.requestUpdate();
    emit(counter(el), "collect-card", {});
    await flush(el);

    expect(api.pay).toHaveBeenCalledTimes(2);
    await tenderPay(el).updateComplete;
    expect(payButton(el).shadowRoot!.querySelector("button")!.disabled).toBe(true);

    refuseRetry({ code: "server.internal", status: 500 });
    await flush(el);
    await tenderPay(el).updateComplete;
    expect(payButton(el).shadowRoot!.querySelector("button")!.disabled).toBe(false);
    expect(tenderPay(el).shadowRoot!.querySelector("[data-counter-pay], .pay-card")).not.toBeNull();
  });

  it("retries placing an order once after a silent adoption", async () => {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
      listDefaultZoneOffers: vi.fn().mockResolvedValue({
        ...V1,
        context: { ...V1.context, serviceMode: "ticket_then_pay" },
      }),
      listZoneOffers: vi.fn().mockResolvedValue(menu("v2", V1.offers)),
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
          menu("v2", [
            offer("offer-lemonade", "Lemonade", "3.00", { ordering: "not_sold_separately" }),
            burgerOffer(),
          ]),
        ),
    });
    await toCounter(el);
    add(el, "Burger", { options: [{ listId: "list-cooked", labelId: "rare" }] });
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
      listZoneOffers: vi.fn().mockResolvedValue(menu("v2", [burgerOffer()])),
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
    let answerRefresh!: (value: ZoneOffers) => void;
    const terrace = {
      ...menu("t1", [offer("offer-terrace-water", "Water", "2.00", { allergens: { milk: {} } })]),
      context: {
        departmentName: "Restaurant",
        zoneId: "zone-terrace",
        departmentId: "department-bar",
        serviceMode: "prepay" as const,
        dining: null,
      },
    };
    const listZoneOffers = vi.fn((zoneId: string) =>
      zoneId === "zone-counter"
        ? new Promise<ZoneOffers>((resolve) => (answerRefresh = resolve))
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
      getDeviceZones: vi
        .fn()
        .mockResolvedValue(deviceZonesFixture(["zone-counter", "zone-terrace"], ["zone-dining"])),
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
    add(el, "Water");
    answerRefresh(
      menu("v2", [
        ...V1.offers,
        offer("offer-terrace-water", "Water", "2.00", { allergens: { eggs: {} } }),
      ]),
    );
    await flush(el);

    expect(counter(el).products.map((product) => product.productId)).toEqual(["Water"]);
    expect(counter(el).store.lines[0]!.product.allergens).toEqual({ milk: {} });
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
      menu("v2", [offer("offer-lemonade", "Lemonade", "2.50"), burgerOffer()]),
    );
    api.listZoneOffers.mockResolvedValue(
      menu("v2", [offer("offer-lemonade", "Lemonade", "2.50"), burgerOffer()]),
    );
    await toCounter(el);
    expect(dialogText(el)).toContain("Lemonade €3.00 → €2.50");
  });
});

// ── Fix round 1 ──────────────────────────────────────────────────────────────────────────────────

const tableFormFactor: FormFactor = "till";

const DINING = {
  ...V1,
  context: { ...V1.context, zoneId: "zone-dining", serviceMode: "table_tab" as const },
};

const DINING_V2 = {
  ...DINING,
  menus: DINING.menus.map((each) => ({ ...each, versionId: "v2" })),
};

const party = {
  kitchenNote: { scope: { partyId: "party-a" }, note: null, revision: 0, ownerRevision: 1 },
  id: "party-a",
  revision: 1,
  guestCount: 2,
  state: "open" as const,
  openingBillId: "wo-7",
  outstanding: "3.00",
  billCount: 1,
  tableIds: ["t2"],
  unsentDrafts: [],
  reminder: null,
};

const table = {
  id: "t2",
  label: "2",
  shortName: "2",
  zoneId: "zone-dining",
  state: "open-tab",
  hasOpenTab: true,
  tabLineCount: 1,
  tabTotal: "3.00",
  pendingDeliveries: 0,
  pendingToServe: 1,
  readyToServe: 0,
  timingBand: "fresh",
  nextReservation: null,
  today: null,
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
function tableStubs(diningOffers: ZoneOffers = DINING, overrides: Record<string, unknown> = {}) {
  return {
    getTill: vi.fn().mockResolvedValue({ ...till, formFactor: tableFormFactor }),
    listZoneOffers: vi.fn((zoneId: string) =>
      Promise.resolve(zoneId === "zone-dining" ? DINING : V1),
    ),
    getTablesState: vi.fn().mockResolvedValue([table]),
    listZones: vi.fn().mockResolvedValue([
      {
        id: "zone-dining",
        name: "Dining room",
        displayOrder: 0,
        active: true,
        serviceMode: "table_tab",
      },
    ]),
    getTabLines: vi.fn().mockResolvedValue({ lines: [tabLemonade], revision: 0 }),
    listDrafts: drafts.listDrafts,
    saveDraft: drafts.saveDraft,
    submitDraft: drafts.submitDraft,
    _dining: diningOffers,
    ...overrides,
  };
}

const shellGrid = (el: TillApp) => el;
const tableScreen = (el: TillApp) =>
  shellGrid(el).shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen")!;
const roundGrid = (el: TillApp) =>
  tableScreen(el).shadowRoot!.querySelector<
    HTMLElement & { store: { lines: { blocked?: string }[]; lineCount: number } }
  >("till-menu-browser")!;

async function toTable(el: TillApp): Promise<void> {
  await toCounter(el);
  emit(el.shadowRoot!.querySelector("till-shell")!, "screen-select", { screen: "floor" });
  await flush(el);
  const floorScreen = shellGrid(el).shadowRoot!.querySelector("till-floor-screen")!;
  emit(floorScreen, "open-table", { tableId: "t2", seated: true });
  await flush(el);
  // After the open, every read of the dining zone answers the republished offers.
  const dining = api._dining as unknown as ZoneOffers;
  api.listZoneOffers.mockImplementation((zoneId: string) =>
    Promise.resolve(zoneId === "zone-dining" ? dining : V1),
  );
}

function pressSendAll(el: TillApp): void {
  tableScreen(el).shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!.click();
}

/** Taps the round's Lemonade tile and sends its saved arrangement. */
async function sendLemonadeRound(el: TillApp): Promise<void> {
  const tileButton = [...roundGrid(el).shadowRoot!.querySelectorAll<HTMLElement>("wt-button")].find(
    (button) => button.querySelector(".name")!.textContent === "Lemonade",
  )!;
  tileButton.click();
  await flush(el);
  pressSendAll(el);
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
      tableStubs(menu("v2", V1.offers), {
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
      ...menu(version, offers),
      context: DINING.context,
    });
    const { el } = await mountApp(
      tableStubs(dining("v2"), {
        getTill: vi.fn().mockResolvedValue({
          ...till,
          formFactor: tableFormFactor,
          courses: [
            { id: "starters", name: "Starters", displayOrder: 0, fireNowZoneIds: [] },
            { id: "desserts", name: "Desserts", displayOrder: 1, fireNowZoneIds: [] },
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
    pressSendAll(el);
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

  it("saves the lines it took when the re-send is refused too and the menu has moved again", async () => {
    const { el } = await mountApp(
      tableStubs(DINING, { submitDraft: vi.fn().mockRejectedValue(versionRefusal) }),
    );
    await toTable(el);
    const versions = ["v2", "v3"];
    api.listZoneOffers.mockImplementation((zoneId: string) =>
      Promise.resolve(
        zoneId === "zone-dining"
          ? { ...menu(versions.shift() ?? "v3", V1.offers), context: DINING.context }
          : V1,
      ),
    );
    await sendLemonadeRound(el);
    expect(api.submitDraft).toHaveBeenCalledTimes(2);
    expect(banner(el)!.textContent).toContain(codeMessage("menu.version_changed"));

    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));

    const lastSave = drafts.saveDraft.mock.calls.at(-1)![1];
    expect(lastSave.lines.map((line) => line.menuVersionId)).toEqual(["v3"]);
  });

  it("keeps the round and shows the dialog when a price in it changed, sending nothing more", async () => {
    const { el } = await mountApp(
      tableStubs(menu("v2", [offer("offer-lemonade", "Lemonade", "2.50"), burgerOffer()]), {
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
      tableStubs(menu("v2", [burgerOffer()]), {
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

    emit(el.shadowRoot!.querySelector("till-shell")!, "screen-select", { screen: "floor" });
    await flush(el);
    emit(shellGrid(el).shadowRoot!.querySelector("till-floor-screen")!, "open-table", {
      tableId: "t2",
      seated: true,
    });
    await flush(el);
    const tablePay = tableScreen(el).shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      "[data-pay-sheet]",
    )!;
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

    emit(el.shadowRoot!.querySelector("till-shell")!, "screen-select", { screen: "floor" });
    await flush(el);
    api.menuState.mockClear();
    await poll(el);
    expect(api.menuState.mock.calls.map((call) => call[0])).toEqual(["zone-counter"]);
  });

  it("does not discard a change of service area that a poll's reload overlaps", async () => {
    let answerSwitch!: (value: ZoneOffers) => void;
    const terrace = {
      ...menu("t1", [offer("offer-terrace-water", "Water", "2.00")]),
      context: {
        departmentName: "Restaurant",
        zoneId: "zone-terrace",
        departmentId: "department-bar",
        serviceMode: "prepay" as const,
        dining: null,
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
      getDeviceZones: vi
        .fn()
        .mockResolvedValue(deviceZonesFixture(["zone-counter", "zone-terrace"], ["zone-dining"])),
      listDefaultZoneOffers: vi
        .fn()
        .mockResolvedValue({ ...V1, zones: [zone("zone-counter"), zone("zone-terrace")] }),
      listZoneOffers: vi.fn((zoneId: string) =>
        zoneId === "zone-terrace"
          ? new Promise<ZoneOffers>((resolve) => (answerSwitch = resolve))
          : Promise.resolve(menu("v2", V1.offers)),
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
    api.listZoneOffers.mockRejectedValue(new TypeError("Failed to fetch"));
    await toCounter(el);

    expect(counter(el).store.lines[0]!.blocked).toBeUndefined();
    expect(payButton(el).disabled).toBe(true);
  });
});

// ── Fix round 2 ──────────────────────────────────────────────────────────────────────────────────

type RoundStore = {
  lines: {
    quantity: string;
    blocked?: string;
    unavailableOnServer?: true;
    product: { variantId?: string };
  }[];
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
    let answerReload!: (value: ZoneOffers) => void;
    const { el } = await mountApp(
      tableStubs(DINING, {
        submitDraft: vi.fn(drafts.submitDraft).mockRejectedValueOnce(versionRefusal),
      }),
    );
    await toTable(el);
    api.listZoneOffers.mockImplementation((zoneId: string) =>
      zoneId === "zone-dining"
        ? new Promise<ZoneOffers>((resolve) => (answerReload = resolve))
        : Promise.resolve(V1),
    );
    await sendLemonadeRound(el);
    const round = roundStore(el);

    round.removeLine(0);
    await flush(el);
    expect(round.lineCount).toBe(1);

    answerReload(menu("v2", V1.offers));
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

  it("says a sold-out variant in its own words, keeps the round, and marks the line from the offers read again", async () => {
    const lemonade = (smallAvailable: boolean) =>
      offer("offer-lemonade", "Lemonade", "3.00", {
        variants: [
          {
            ...offer("offer-lemonade", "Small", "3.00"),
            id: "lemonade-small",
            menuPrice: null,
            pricingUnit: "each",
            available: smallAvailable,
          },
          {
            ...offer("offer-lemonade", "Large", "4.00"),
            id: "lemonade-large",
            menuPrice: null,
            pricingUnit: "each",
            available: true,
          },
        ],
      });
    const atOpen = { ...DINING, offers: [lemonade(true), burgerOffer()] };
    const { el } = await mountApp(
      tableStubs(
        { ...DINING, offers: [lemonade(false), burgerOffer()] },
        {
          listZoneOffers: vi.fn((zoneId: string) =>
            Promise.resolve(zoneId === "zone-dining" ? atOpen : V1),
          ),
          submitDraft: vi.fn().mockRejectedValue({
            code: "product.variant_unavailable",
            status: 409,
            variantId: "lemonade-small",
          }),
        },
      ),
    );
    await toTable(el);
    const tileButton = [
      ...roundGrid(el).shadowRoot!.querySelectorAll<HTMLElement>("wt-button"),
    ].find((button) => button.querySelector(".name")!.textContent === "Lemonade")!;
    tileButton.click();
    await flush(el);
    const picker = roundGrid(el).shadowRoot!.querySelector("till-modifier-picker")!;
    picker.shadowRoot!.querySelector<HTMLInputElement>('input[value="lemonade-small"]')!.click();
    await picker.updateComplete;
    picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!.click();
    await flush(el);
    expect(roundStore(el).lines[0]!.product.variantId).toBe("lemonade-small");
    expect(roundStore(el).lines[0]!.blocked).toBeUndefined();
    pressSendAll(el);
    await flush(el);

    expect(banner(el)!.textContent).toContain(codeMessage("product.variant_unavailable"));
    expect(roundStore(el).lineCount).toBe(1);
    expect(roundStore(el).lines[0]!.blocked).toBe("unavailable");
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

  it("says extras on a dish not sold by the unit in its own words, and keeps the round", async () => {
    const { el } = await mountApp(
      tableStubs(DINING, {
        submitDraft: vi.fn().mockRejectedValue({
          code: "extras.unsupported_product",
          status: 400,
          productId: "Lemonade",
          soldBy: "fraction",
        }),
      }),
    );
    await toTable(el);
    await sendLemonadeRound(el);

    expect(banner(el)!.textContent).toContain(codeMessage("extras.unsupported_product"));
    expect(banner(el)!.textContent).not.toContain(t("table.error"));
    expect(roundStore(el).lineCount).toBe(1);
  });
});

describe("a round line's mark", () => {
  it("clears when the table's zone shows the dish can be sold again", async () => {
    const soldOut = menu("v2", [
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
      const phone: FormFactor = "phone-portrait";
      api = stubApi({
        ...tableStubs(),
        getTill: vi.fn().mockResolvedValue({ ...till, formFactor: phone }),
        getDeviceIdentity: vi.fn().mockResolvedValue({
          deviceId: "h1",
          name: "H",
          formFactor: "phone-portrait",
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
      tableScreen(el).shadowRoot!.querySelector<HTMLElement>("[data-view=order]")!.click();
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
  shortName: "3",
  party: {
    ...party,
    kitchenNote: {
      scope: { partyId: "party-c" },
      note: null,
      revision: 0,
      ownerRevision: party.revision,
    },
    id: "party-c",
    openingBillId: "wo-8",
    tableIds: ["t3"],
  },
};

describe("a kept round and another table", () => {
  it("does not carry a refused round to the next table opened on the same screen", async () => {
    const sideBySide: FormFactor = "till";
    const { el } = await mountApp(
      tableStubs(DINING, {
        getTill: vi.fn().mockResolvedValue({ ...till, formFactor: sideBySide }),
        getTablesState: vi.fn().mockResolvedValue([table, tableB]),
        submitDraft: vi
          .fn()
          .mockRejectedValue({ code: "product.unavailable", status: 409, productId: "Lemonade" }),
      }),
    );
    await toCounter(el);
    emit(el.shadowRoot!.querySelector("till-shell")!, "screen-select", { screen: "floor" });
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
        .shadowRoot!.querySelector('[data-draft-action="send-all"]')!
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
    pressSendAll(el);
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
      ...menu("v2", [
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
        zoneId === tableC.zoneId
          ? Promise.reject({ code: "server.internal" })
          : Promise.resolve(V1),
      );
    emit(el.shadowRoot!.querySelector("till-shell")!, "screen-select", { screen: "floor" });
    await flush(el);
    emit(shellGrid(el).shadowRoot!.querySelector("till-floor-screen")!, "open-table", {
      tableId: tableC.id,
      seated: true,
    });
    await flush(el);
    return round;
  }

  it("keeps its mark when the other table's offers fail to load", async () => {
    const round = await refusedThenOpen({ ...tableB, zoneId: "zone-terrace" }, true);
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
      tableStubs(DINING, {
        submitDraft: answering(landed("wo-next")),
        getTill: vi.fn().mockResolvedValue({ ...till, formFactor: "tablet-landscape" }),
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValue({ deviceId: "tablet-1", formFactor: "tablet-landscape" }),
      }),
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
    emit(el.shadowRoot!.querySelector("till-shell")!, "screen-select", { screen: "floor" });
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
    "The box did not answer, so the items may have been added. Check the tab before sending them again.";

  const shownParty = (el: TillApp) =>
    (tableScreen(el) as unknown as { party: { id: string } | null }).party?.id;

  it("reads the table's party again and stays on the bill the round was sent from, now paid, beside the tab the table points at", async () => {
    const { el } = await mountApp(
      tableStubs(DINING, {
        getTablesState: vi.fn().mockResolvedValue([seated]),
        // Another till took payment for wo-7, and the party moved on to its next tab, wo-next.
        getPartyBills: vi.fn(async () =>
          api.submitDraft.mock.calls.length === 0
            ? [partyBillOf("party-a", "wo-7", 1)]
            : [
                partyBillOf("party-a", "wo-7", 1, { status: "settled" }),
                partyBillOf("party-a", "wo-next", 2),
              ],
        ),
        submitDraft: vi.fn(async (...args: SubmitArgs) => {
          drafts.apply(...args);
          throw new TypeError("offline");
        }),
      }),
    );
    await toTable(el);
    api.getTablesState.mockResolvedValue([
      { ...seated, party: { ...party, revision: 2, openingBillId: "wo-next" } },
    ]);
    const round = roundStore(el);
    await sendLemonadeRound(el);
    // Two pauses between the three tries run on real time; wait for the message they end in.
    await vi.waitFor(() => expect(banner(el)?.textContent).toContain(unconfirmed), {
      timeout: 4000,
      interval: 50,
    });
    await flush(el);

    expect(shownTab(el)).toBe("wo-7");
    expect(api.getTabLines).toHaveBeenLastCalledWith("wo-7");
    expect(shownParty(el)).toBe("party-a");
    expect(api.getPartyBills).toHaveBeenLastCalledWith("party-a");
    expect(round.lineCount).toBe(0);
    expect(banner(el)!.textContent).toContain(unconfirmed);
  });

  it("reads the table's party again and shows the bill the table now points at once the round's bill has left the party", async () => {
    const { el } = await mountApp(
      tableStubs(DINING, {
        getTablesState: vi.fn().mockResolvedValue([seated]),
        // Another till merged the round's bill, wo-7, into the party's next one, wo-next.
        getPartyBills: vi.fn(async () =>
          api.submitDraft.mock.calls.length === 0
            ? [partyBillOf("party-a", "wo-7", 1)]
            : [partyBillOf("party-a", "wo-next", 2)],
        ),
        submitDraft: vi.fn(async (...args: SubmitArgs) => {
          drafts.apply(...args);
          throw new TypeError("offline");
        }),
      }),
    );
    await toTable(el);
    api.getTablesState.mockResolvedValue([
      { ...seated, party: { ...party, revision: 2, openingBillId: "wo-next" } },
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
    expect(tableScreen(el).shadowRoot!.querySelector("[data-bill-gone]")!.textContent!.trim()).toBe(
      "Bill 1 is no longer at this table. Now showing Bill 2.",
    );
  });

  it("does not follow the table onto a new party's tab", async () => {
    const { el } = await mountApp(
      tableStubs(DINING, {
        getTablesState: vi.fn().mockResolvedValue([seated]),
        getPartyBills: floorPartyBills(),
        submitDraft: vi.fn().mockRejectedValue(new TypeError("offline")),
      }),
    );
    await toTable(el);
    // Another till settled and cleared the party, and seated a new one at the same table.
    api.getTablesState.mockResolvedValue([
      { ...seated, party: { ...party, id: "party-b", openingBillId: "wo-other" } },
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
        getPartyBills: floorPartyBills(),
        mergeBills: vi.fn().mockResolvedValue(undefined),
      }),
    );
    await toTable(el);
    api.getTablesState.mockResolvedValue([{ ...table, party: null }]);
    emit(tableScreen(el), "merge-bills", { fromBillId: "wo-9" });
    await flush(el);
    api.getTablesState.mockResolvedValue([
      { ...seated, party: { ...party, id: "party-b", openingBillId: "wo-other" } },
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
        getPartyBills: floorPartyBills(),
        submitDraft: failLater((reject) => (fail = reject)),
      }),
    );
    await toTable(el);
    await sendLemonadeRound(el);
    emit(el.shadowRoot!.querySelector("till-shell")!, "screen-select", { screen: "floor" });
    await flush(el);
    emit(shellGrid(el).shadowRoot!.querySelector("till-floor-screen")!, "open-table", {
      tableId: "t3",
      seated: true,
    });
    await flush(el);
    expect(shownTab(el)).toBe("wo-8");

    api.getTablesState.mockResolvedValue([
      { ...seated, party: { ...party, revision: 2, openingBillId: "wo-next" } },
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
    pressSendAll(el);
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
    const moveGuests = vi
      .fn()
      .mockResolvedValue({ partyId: "party-a", billIds: ["wo-other", "wo-7"] });
    const { el } = await mountApp(
      tableStubs(DINING, {
        getTablesState: vi.fn().mockResolvedValue([seated]),
        // Once the guests move, the party also holds wo-other, the bill the floor then names.
        getPartyBills: vi.fn(async () =>
          moveGuests.mock.calls.length === 0
            ? [partyBillOf("party-a", "wo-7", 2)]
            : [partyBillOf("party-a", "wo-other", 1), partyBillOf("party-a", "wo-7", 2)],
        ),
        submitDraft: failLater((reject) => (fail = reject)),
        moveGuests,
      }),
    );
    await toTable(el);
    await sendLemonadeRound(el);
    // The guests move from t2 to t4; the party, which holds both, also holds another bill.
    const spread = {
      ...party,
      kitchenNote: { scope: { partyId: party.id }, note: null, revision: 0, ownerRevision: 2 },
      revision: 2,
      openingBillId: "wo-other",
      tableIds: ["t2", "t4"],
    };
    api.getTablesState.mockResolvedValue([
      { ...seated, party: spread },
      { ...seated, id: "t4", label: "4", shortName: "4", party: spread },
    ]);
    emit(tableScreen(el), "move-guests", { toTableId: "t4" });
    await flush(el);
    expect(api.moveGuests).toHaveBeenCalledOnce();

    fail(new TypeError("offline"));
    await flush(el);
    await flush(el);
    expect(shownTab(el)).toBe("wo-7");
    expect(api.getTabLines).not.toHaveBeenCalledWith("wo-other");
  });
});

type Shortcuts = ZoneOffers["menus"][number]["home"]["shortcuts"];

/** Lunch at `version`, offering V1's dishes, with these shortcuts on its Device Home Page. */
function withShortcuts(version: string, shortcuts: Shortcuts): ZoneOffers {
  const source = menu(version, V1.offers);
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
    let answer!: (value: ZoneOffers) => void;
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(withShortcuts("v1", [])),
      listZoneOffers: vi.fn(() => new Promise((resolve) => (answer = resolve))),
    });
    await toCounter(el);
    const shown = browser(el).menu;
    api.menuState.mockResolvedValue({
      service: {
        open: true,
        zoneOpen: true,
        periodName: null,
        periodOccurrenceKey: null,
        keepOpen: null,
        zoneKeepOpen: null,
      },
      menus: [{ menuId: "lunch", versionId: "v2", orderable: true, endedPeriodName: null }],
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

describe("a device behind the live version (menus spec §9)", () => {
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
    const v1 = menu("v1", V1.offers);
    v1.menus[0] = { ...v1.menus[0]!, structure: { members: [drinks, burger] } };
    const v2 = menu("v2", [offer("offer-lemonade", "Lemonade", "2.50"), burgerOffer()]);
    const { el } = await mountApp({
      getDeviceZones: vi.fn().mockResolvedValue(deviceZonesFor(v1)),
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

const zoneKeepOpen = (zoneId: string, closesAt: string, extendedUntil: string | null) => ({
  zoneId,
  zoneName: "Terrace",
  closesAt,
  running: true,
  extendedUntil,
});
type ZoneWidget = HTMLElement & {
  api: TillApi;
  zoneId: string;
  zoneKeepOpen: ZoneOffers["service"]["zoneKeepOpen"];
};
describe("keep-open changes refresh the order screen", () => {
  const initialService = {
    open: true,
    zoneOpen: true,
    periodName: "Lunch",
    periodOccurrenceKey: '["department","2026-10-12","Lunch","08:00"]',
    zoneKeepOpen: null,
    keepOpen: {
      periodId: "lunch",
      periodName: "Lunch",
      endsAt: "14:00",
      running: true,
    },
  };
  const laterService = {
    ...initialService,
    keepOpen: { ...initialService.keepOpen, endsAt: "14:30" },
  };
  const withZone = (zoneId: string, closesAt: string, extendedUntil: string | null) => ({
    ...initialService,
    zoneKeepOpen: zoneKeepOpen(zoneId, closesAt, extendedUntil),
  });
  const zoneWidget = (screen: HTMLElement) =>
    screen.shadowRoot!.querySelector<ZoneWidget>("till-keep-open");
  it("redraws the counter after a poll changes only the period's end", async () => {
    let service = initialService as ZoneOffers["service"];
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue({ ...V1, service: initialService }),
      listZoneOffers: vi.fn(() => Promise.resolve({ ...V1, service })),
      menuState: vi.fn(() => Promise.resolve({ ...menuState("v1"), service })),
    });
    await toCounter(el);
    add(el, "Lemonade");
    service = laterService;
    await poll(el);
    await expect
      .poll(() =>
        counter(el).shadowRoot!.querySelector("[data-service-period]")?.textContent?.trim(),
      )
      .toBe("Open · until 14:30");
    expect(
      counter(el).store.lines.map((line) => [
        line.product.productId,
        line.quantity,
        line.product.unitPrice,
      ]),
    ).toEqual([["Lemonade", "1", "3.00"]]);
  });
  it("refreshes the counter immediately after a successful keep-open change", async () => {
    const extended = withZone("zone-counter", "14:30", "14:30");
    const { el } = await mountApp({
      listDefaultZoneOffers: vi
        .fn()
        .mockResolvedValue({ ...V1, service: withZone("zone-counter", "14:00", null) }),
      listZoneOffers: vi.fn().mockResolvedValue({ ...V1, service: extended }),
      menuState: vi.fn().mockResolvedValue({ ...menuState("v1"), service: extended }),
    });
    await toCounter(el);
    const widget = zoneWidget(counter(el));
    expect(widget, "the app mounts the counter control").not.toBeNull();
    expect(widget!.zoneKeepOpen!.closesAt).toBe("14:00");
    emit(widget!, "keep-open-changed", { zoneId: "zone-counter" });
    await expect.poll(() => zoneWidget(counter(el))?.zoneKeepOpen?.closesAt).toBe("14:30");
    expect(api.menuState.mock.calls.map(([zone]) => zone)).toEqual(["zone-counter"]);
  });
  it("redraws the embedded Order screen after a poll changes only the period's end", async () => {
    let service = initialService as ZoneOffers["service"];
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
    service = laterService;
    await poll(el);
    await expect
      .poll(() =>
        tableScreen(el).shadowRoot!.querySelector("[data-service-period]")?.textContent?.trim(),
      )
      .toBe("Open · until 14:30");
    expect(dialog(el)).toBeNull();
  });
  it("passes the API and dining zone through the embedded Order mount and refreshes it after a change", async () => {
    const extended = withZone("zone-dining", "14:30", "14:30");
    const { el } = await mountApp(
      tableStubs(DINING, {
        listZoneOffers: vi.fn((zone: string) =>
          Promise.resolve(
            zone === "zone-dining"
              ? { ...DINING, service: withZone("zone-dining", "14:00", null) }
              : V1,
          ),
        ),
        menuState: vi.fn().mockResolvedValue({ ...menuState("v1"), service: extended }),
      }),
    );
    await toTable(el);
    api.listZoneOffers.mockImplementation((zone: string) =>
      Promise.resolve(zone === "zone-dining" ? { ...DINING, service: extended } : V1),
    );
    const widget = zoneWidget(tableScreen(el));
    expect(widget, "the embedded table control is mounted").not.toBeNull();
    expect(widget!.api).toBe(api);
    expect(widget!.zoneId).toBe("zone-dining");
    expect(widget!.zoneKeepOpen!.closesAt).toBe("14:00");
    emit(widget!, "keep-open-changed", { zoneId: "zone-dining" });
    await expect.poll(() => zoneWidget(tableScreen(el))?.zoneKeepOpen?.closesAt).toBe("14:30");
    expect(api.menuState.mock.calls.map(([zone]) => zone)).toEqual(["zone-dining"]);
  });
});

it("passes keep-open recovery through a standalone table drill", async () => {
  const zone = { ...zoneKeepOpen("zone-dining", "14:00", null), running: false };
  const service = {
    open: false,
    zoneOpen: true,
    periodName: null,
    periodOccurrenceKey: null,
    zoneKeepOpen: zone,
    keepOpen: null,
  };
  const extended = {
    ...service,
    zoneKeepOpen: zoneKeepOpen("zone-dining", "14:30", "14:30"),
  };
  const { el } = await mountApp(
    tableStubs(DINING, {
      getTill: vi.fn().mockResolvedValue({
        ...till,
        formFactor: "till",
      }),
      listZoneOffers: vi.fn((zone: string) =>
        Promise.resolve(zone === "zone-dining" ? { ...DINING, service } : V1),
      ),
      menuState: vi.fn().mockResolvedValue({ ...menuState("v1"), service: extended }),
    }),
  );
  await toTable(el);
  api.listZoneOffers.mockImplementation((zone: string) =>
    Promise.resolve(zone === "zone-dining" ? { ...DINING, service: extended } : V1),
  );
  const screen = el.shadowRoot!.querySelector("till-table-order-screen")!;
  expect(screen, "the standalone order drill is reachable").not.toBeNull();
  const widget = screen.shadowRoot!.querySelector<ZoneWidget>("till-keep-open")!;
  expect(widget, "the closed drill exposes recovery").not.toBeNull();
  expect(widget.api).toBe(api);
  expect(widget.zoneId).toBe("zone-dining");
  expect(widget.zoneKeepOpen!.closesAt).toBe("14:00");
  emit(widget, "keep-open-changed", { zoneId: "zone-dining" });
  await expect.poll(() => widget.zoneKeepOpen?.closesAt).toBe("14:30");
  expect(api.menuState.mock.calls.map(([zone]) => zone)).toEqual(["zone-dining"]);
});

describe("zone-only menu-state changes", () => {
  it("redraws the counter when only its zone closes and reopens", async () => {
    const open = {
      ...V1,
      menus: [
        ...V1.menus,
        {
          ...V1.menus[0]!,
          id: "staff-lunch",
          name: "Staff lunch",
          isDefault: false,
          audience: "staff" as const,
        },
      ],
    };
    const { el } = await mountApp({ listDefaultZoneOffers: vi.fn().mockResolvedValue(open) });
    await toCounter(el);
    const closed = { ...open, service: { ...open.service, zoneOpen: false } };
    api.listZoneOffers.mockResolvedValue(closed);
    api.menuState.mockResolvedValue({ ...menuState("v1"), service: closed.service });
    await poll(el);
    await vi.waitFor(() =>
      expect(counter(el).shadowRoot!.querySelector("[data-zone-closed]")).not.toBeNull(),
    );
    expect(counter(el).shadowRoot!.querySelector("till-menu-switcher")).toBeNull();
    api.listZoneOffers.mockResolvedValue(open);
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

for (const kind of ["counter", "table"] as const) {
  it(`redraws the ${kind} zone control after a poll changes only its closing time`, async () => {
    const initialService: ZoneOffers["service"] = {
      open: true,
      zoneOpen: true,
      periodName: "Lunch",
      periodOccurrenceKey: '["department","2026-10-12","Lunch","08:00"]',
      keepOpen: null,
      zoneKeepOpen: {
        zoneId: kind === "counter" ? "zone-counter" : "zone-dining",
        zoneName: "Terrace",
        closesAt: "14:00",
        running: true,
        extendedUntil: null,
      },
    };
    let service = initialService;
    const stubs = {
      listDefaultZoneOffers: vi.fn().mockResolvedValue({ ...V1, service }),
      listZoneOffers: vi.fn((zone: string) =>
        Promise.resolve({ ...(zone === "zone-dining" ? DINING : V1), service }),
      ),
      menuState: vi.fn(() => Promise.resolve({ ...menuState("v1"), service })),
    };
    const { el } = await mountApp(kind === "counter" ? stubs : tableStubs(DINING, stubs));
    if (kind === "counter") await toCounter(el);
    else await toTable(el);
    const screen = () => (kind === "counter" ? counter(el) : tableScreen(el));
    const widget = () =>
      screen().shadowRoot!.querySelector<
        HTMLElement & { zoneKeepOpen: ZoneOffers["service"]["zoneKeepOpen"] }
      >("till-keep-open");
    expect(widget()).not.toBeNull();
    expect(widget()!.zoneKeepOpen!.closesAt).toBe("14:00");
    api.listZoneOffers.mockImplementation((zone: string) =>
      Promise.resolve({ ...(zone === "zone-dining" ? DINING : V1), service }),
    );
    service = {
      ...initialService,
      zoneKeepOpen: { ...initialService.zoneKeepOpen!, closesAt: "14:30", extendedUntil: "14:30" },
    };
    await poll(el);
    await expect.poll(() => widget()!.zoneKeepOpen!.closesAt).toBe("14:30");
  });
}

it.each(["counter", "table"] as const)(
  "A461 search section tap changes %s menu through the app without changing basket",
  async (kind) => {
    const source = menu("v1", V1.offers);
    const otherOffer = {
      ...offer("offer-other", "Other dish", "7.00"),
      menuId: "other",
      menuName: "Other",
    };
    const other = {
      ...source.menus[0]!,
      id: "other",
      name: "Other",
      isDefault: false,
      structure: {
        members: [
          {
            kind: "section" as const,
            sectionId: "other-parent",
            internalName: "internal-parent",
            names: { en: "Drinks" },
            color: null,
            image: null,
            members: [
              {
                kind: "section" as const,
                sectionId: "other-coffee",
                internalName: "internal-coffee",
                names: { en: "Coffee" },
                color: null,
                image: null,
                members: [
                  {
                    kind: "product" as const,
                    productId: otherOffer.productId,
                    menuItemId: otherOffer.id,
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    source.menus.push(other);
    source.offers.push(otherOffer);
    const reads = {
      getDeviceZones: vi
        .fn()
        .mockResolvedValue(
          kind === "counter"
            ? deviceZonesFor(source)
            : deviceZonesFixture(undefined, ["zone-dining"]),
        ),
      listDefaultZoneOffers: vi.fn().mockResolvedValue(source),
      listZoneOffers: vi.fn().mockResolvedValue(source),
    };
    const { el } = await mountApp(kind === "counter" ? reads : tableStubs(source, reads));
    if (kind === "counter") await toCounter(el);
    else await toTable(el);
    const shown = () =>
      kind === "counter"
        ? browser(el)
        : tableScreen(el).shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!;
    expect(shown().menu!.id).toBe("lunch");
    shown().store.addProduct(
      shown().products.find((p) => p.id === "Lemonade")!,
      "1",
    );
    const basket = [...shown().store.lines];
    const mounted = shown();
    const input = shown()
      .shadowRoot!.querySelector("wt-input")!
      .shadowRoot!.querySelector("input")!;
    input.value = "coffee";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await flush(el);
    await shown().updateComplete;
    const tile = [
      ...shown().shadowRoot!.querySelectorAll<HTMLElement>('wt-button[data-kind="section"]'),
    ].find((t) => t.querySelector(".name")!.textContent === "Coffee");
    expect(tile).toBeDefined();
    tile!.shadowRoot!.querySelector("button")!.click();
    await flush(el);
    await shown().updateComplete;
    expect(shown()).toBe(mounted);
    expect(shown().menu!.id).toBe("other");
    expect(shown().shadowRoot!.querySelector("nav.breadcrumb [aria-current]")).not.toBeNull();
    expect(shown().shadowRoot!.querySelector("nav.breadcrumb [aria-current]")!.textContent).toBe(
      "Coffee",
    );
    expect(
      [...shown().shadowRoot!.querySelectorAll('[data-region="section"] .name')].map(
        (n) => n.textContent,
      ),
    ).toEqual(["Other dish"]);
    expect(shown().store.lines).toEqual(basket);
    expect(
      shown().shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("input")!.value,
    ).toBe("");
  },
);

it.each(["counter", "table"] as const)(
  "A738 %s receipt status follows the existing equipment poll",
  async (kind) => {
    let available = false;
    const read = vi.fn(async (): Promise<DeviceEquipment> => ({
      roles: (["receipt", "payment_slip", "cash_drawer", "invoice", "card_terminal"] as const).map(
        (role) => ({
          role,
          selection: "default",
          chosenId: null,
          chosen: null,
          default: null,
          choices: [],
          resolved:
            role === "receipt" ? { id: "front-printer", name: "Front printer", available } : null,
        }),
      ),
    }));
    const service: ZoneOffers["service"] = {
      open: true,
      zoneOpen: true,
      periodName: "Lunch",
      periodOccurrenceKey: "lunch",
      keepOpen: null,
      zoneKeepOpen: null,
    };
    const overrides = {
      getDeviceEquipment: read,
      listDefaultZoneOffers: vi.fn().mockResolvedValue({ ...V1, service }),
      listZoneOffers: vi.fn((zone: string) =>
        Promise.resolve({ ...(zone === "zone-dining" ? DINING : V1), service }),
      ),
    };
    const { el } = await mountApp(kind === "counter" ? overrides : tableStubs(DINING, overrides));
    if (kind === "counter") await toCounter(el);
    else await toTable(el);
    const screen = () => (kind === "counter" ? counter(el) : tableScreen(el));
    const status = () =>
      screen().shadowRoot!.querySelector("[data-receipt-status]")?.textContent?.trim();
    await expect.poll(status).toBe("Receipt printer unavailable: Front printer");
    const before = read.mock.calls.length;
    available = true;
    await poll(el);
    await expect.poll(status).toBe("Receipt printer available: Front printer");
    expect(read.mock.calls.length).toBe(before + 1);
  },
);

it.each([
  ["counter", "rare"],
  ["table", "rare"],
  ["counter", "cheese"],
  ["table", "cheese"],
] as const)(
  "changes a modifier from %s information (%s) and refreshes immediately",
  async (kind, itemId) => {
    const width = window.innerWidth,
      height = window.innerHeight;
    onTestFinished(() => page.viewport(width, height));
    await page.viewport(390, 844);
    const setOptionAvailability = vi.fn().mockResolvedValue(undefined);
    const setAvailability = vi.fn().mockResolvedValue(undefined);
    const overrides = {
      setOptionAvailability,
      setAvailability,
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, capabilities: [...till.capabilities, "take-orders"] }),
    };
    const { el } = await mountApp(kind === "counter" ? overrides : tableStubs(DINING, overrides));
    if (kind === "counter") await toCounter(el);
    else {
      await toTable(el);
      await userEvent.click(
        tableScreen(el).shadowRoot!.querySelector<HTMLElement>("[data-view=menu]")!,
      );
      await flush(el);
    }
    const screen = kind === "counter" ? counter(el) : tableScreen(el);
    const browser = screen.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!;
    const dish = [
      ...browser.shadowRoot!.querySelectorAll<HTMLElement>('[data-kind="product"]'),
    ].find((row) => row.textContent!.includes("Burger"))!;
    dish.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, composed: true }),
    );
    await browser.updateComplete;
    const info = browser.shadowRoot!.querySelector("till-product-info")!;
    await info.updateComplete;
    const control = info.shadowRoot!.querySelector<HTMLElement>(`[data-availability="${itemId}"]`)!;
    expect(control).not.toBeNull();
    api.menuState.mockResolvedValue(
      menuState("v1", itemId === "rare" ? { optionLabels: [itemId] } : { products: [itemId] }),
    );
    await userEvent.click(control);
    await flush(el);
    const zoneId = kind === "counter" ? "zone-counter" : "zone-dining";
    if (itemId === "rare")
      expect(setOptionAvailability).toHaveBeenCalledExactlyOnceWith(
        zoneId,
        "list-cooked",
        itemId,
        false,
      );
    else expect(setAvailability).toHaveBeenCalledExactlyOnceWith(zoneId, itemId, false);
    const product = screen.products.find((row) => row.productId === "Burger")!;
    const modifier = product.modifierAvailability!.find(
      (row) => row.kind === (itemId === "rare" ? "options" : "extras"),
    )!;
    expect(
      modifier.kind === "options"
        ? modifier.labels.find((row) => row.id === itemId)!.available
        : modifier.items.find((row) => row.productId === itemId)!.available,
    ).toBe(false);
    expect(browser.shadowRoot!.querySelector("till-product-info")).toBeNull();
  },
);

it.each([
  [null, false],
  [false, false],
  [true, true],
] as const)(
  "shows extras on a fractional dish only with an available whole-portion variant (%s)",
  async (variantAvailable, visible) => {
    const dish = burgerOffer();
    dish.unit = { ...dish.unit, precision: 3 };
    if (variantAvailable !== null)
      dish.variants = [
        {
          ...burgerOffer(),
          id: "piece",
          name: "Piece",
          menuPrice: null,
          pricingUnit: "each",
          available: variantAvailable,
        },
      ];
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(menu("v1", [dish])),
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, capabilities: [...till.capabilities, "take-orders"] }),
    });
    await toCounter(el);
    const browser = grid(el).querySelector("till-menu-browser")!;
    tile(el, "Burger").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, composed: true }),
    );
    await browser.updateComplete;
    const info = browser.shadowRoot!.querySelector("till-product-info")!;
    await info.updateComplete;
    expect(info.shadowRoot!.querySelector('[data-availability="cheese"]') !== null).toBe(visible);
    expect(info.shadowRoot!.querySelector('[data-availability="rare"]')).not.toBeNull();
  },
);

it("changes availability from Counter information then refreshes immediately", async () => {
  const setAvailability = vi.fn().mockResolvedValue({ available: false });
  const { el } = await mountApp({
    setAvailability,
    getTill: vi
      .fn()
      .mockResolvedValue({ ...till, capabilities: [...till.capabilities, "take-orders"] }),
  });
  await toCounter(el);
  const browser = grid(el).querySelector("till-menu-browser")!;
  tile(el, "Burger").dispatchEvent(
    new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, composed: true }),
  );
  await browser.updateComplete;
  const info = browser.shadowRoot!.querySelector("till-product-info")!;
  await info.updateComplete;
  const control = info.shadowRoot!.querySelector<HTMLElement>('[data-availability="Burger"]')!;
  expect(control).not.toBeNull();
  api.menuState.mockResolvedValue(menuState("v1", { products: ["Burger"] }));
  await userEvent.click(control);
  await flush(el);
  expect(setAvailability).toHaveBeenCalledExactlyOnceWith("zone-counter", "Burger", false);
  expect(tile(el, "Burger").hasAttribute("data-sold-out")).toBe(true);
  expect(browser.shadowRoot!.querySelector("till-product-info")).toBeNull();
});

it("offers table-zone availability controls only on an ordering device", async () => {
  const width = window.innerWidth,
    height = window.innerHeight;
  onTestFinished(() => page.viewport(width, height));
  await page.viewport(390, 844);
  const setAvailability = vi.fn().mockResolvedValue(undefined);
  const { el } = await mountApp(
    tableStubs(DINING, {
      setAvailability,
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, capabilities: [...till.capabilities, "take-orders"] }),
    }),
  );
  await toTable(el);
  await userEvent.click(
    tableScreen(el).shadowRoot!.querySelector<HTMLElement>("[data-view=menu]")!,
  );
  await flush(el);
  const browser = tableScreen(el).shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!;
  const tile = [...browser.shadowRoot!.querySelectorAll<HTMLElement>('[data-kind="product"]')].find(
    (t) => t.textContent!.includes("Lemonade"),
  )!;
  tile.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, composed: true }),
  );
  await browser.updateComplete;
  const info = browser.shadowRoot!.querySelector("till-product-info")!;
  await info.updateComplete;
  await userEvent.click(
    info.shadowRoot!.querySelector<HTMLElement>('[data-availability="Lemonade"]')!,
  );
  await flush(el);
  expect(setAvailability).toHaveBeenCalledExactlyOnceWith("zone-dining", "Lemonade", false);
});
it("hides availability actions without take-orders", async () => {
  const { el } = await mountApp();
  await toCounter(el);
  const browser = grid(el).querySelector("till-menu-browser")!;
  tile(el, "Burger").dispatchEvent(
    new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, composed: true }),
  );
  await browser.updateComplete;
  const info = browser.shadowRoot!.querySelector("till-product-info")!;
  await info.updateComplete;
  expect(info.shadowRoot!.querySelector("[data-availability]")).toBeNull();
});

async function retrieveForRefresh(
  el: TillApp,
  product: TillProduct,
  sentAt: string | null = null,
  readable = true,
) {
  api.retrieveWorkingOrder = vi.fn().mockResolvedValue({
    id: "held-order",
    zoneId: null,
    revision: 7,
    label: "Lunch",
    expectedEdit: null,
    kitchenNote: {
      scope: { workingOrderId: "held-order" },
      note: null,
      revision: 0,
      ownerRevision: 0,
    },
    lines: [
      {
        product,
        productId: "Lemonade",
        menuItemId: "offer-lemonade",
        workingOrderLineId: "held-line",
        quantity: "1.000",
        note: "Keep cold",
      },
    ],
  });
  api.getTabLines = readable
    ? vi.fn().mockResolvedValue({
        revision: 7,
        lines: [{ ...tabLemonade, id: "held-line", sentAt, note: "Keep cold" }],
      })
    : vi.fn().mockRejectedValue(new Error("read failed"));
  emit(counter(el), "retrieve-order", { id: "held-order" });
  await flush(el);
  expect(counter(el).store.id).toBe("held-order");
}

it.each([
  ["counter", "3.00"],
  ["counter", "99.00"],
  ["table", "3.00"],
  ["table", "99.00"],
  ["held", "99.00"],
] as const)(
  "shows a new version's declarations in the open %s selling at %s, leaving a repriced line to its dialog and a saved line as it was",
  async (kind, price) => {
    const { el } = await mountApp(kind === "table" ? tableStubs() : {});
    if (kind === "table") await toTable(el);
    else await toCounter(el);
    const screen = () => (kind === "table" ? tableScreen(el) : counter(el));
    const shown = screen().shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!;
    const store = shown.store;
    const picked = shown.products.find((product) => product.productId === "Lemonade")!;
    if (kind === "held") await retrieveForRefresh(el, picked);
    else {
      store.addProduct(picked, "1", { note: "Keep cold" });
      await flush(el);
    }
    if (kind === "table") await vi.waitFor(() => expect(api.saveDraft).toHaveBeenCalled());
    const line = store.lines[0]!;
    const product = { ...line.product };
    const last = store.lastAdded;
    const dirty = store.dirty;
    const saves = api.saveDraft?.mock.calls.length ?? 0;
    const updateWorkingOrder = vi.fn();
    api.updateWorkingOrder = updateWorkingOrder;
    const changed = menu("v2", [
      offer("offer-lemonade", "Lemonade", price, {
        name: "Renamed",
        allergens: { eggs: {} },
        dietaryDeclarations: ["halal"],
        diet: { vegan: "no", vegetarian: "yes", contains: [] },
      }),
      burgerOffer(),
    ]);
    const adopted = kind !== "held" && price === "3.00";
    const asked = kind !== "held" && price === "99.00";
    api.listZoneOffers.mockResolvedValue(changed);
    api.menuState.mockResolvedValue(menuState("v2"));
    await poll(el);
    expect(store.lines[0]).toBe(line);
    expect(line.product).toMatchObject({
      ...product,
      ...(adopted ? { name: "Renamed", menuVersionId: "v2" } : {}),
      allergens: { eggs: {} },
      dietaryDeclarations: ["halal"],
      diet: { vegan: "no", vegetarian: "yes", contains: [] },
    });
    expect(line.note).toBe("Keep cold");
    expect(store.lastAdded).toBe(last);
    expect(store.dirty).toBe(dirty);
    expect(store.total).toBe("3.00");
    expect(dialog(el) !== null).toBe(asked);
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 30));
    expect(api.saveDraft?.mock.calls.length ?? 0).toBe(
      saves + (adopted && kind === "table" ? 1 : 0),
    );
    expect(updateWorkingOrder).not.toHaveBeenCalled();
  },
);

it.each(["counter", "table"] as const)(
  "a product save with no new version changes nothing on the till (%s)",
  async (kind) => {
    const { el } = await mountApp(kind === "table" ? tableStubs() : {});
    if (kind === "table") await toTable(el);
    else await toCounter(el);
    const screen = kind === "table" ? tableScreen(el) : counter(el);
    const shown = screen.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!;
    shown.store.addProduct(
      shown.products.find((row) => row.productId === "Lemonade")!,
      "1",
    );
    await flush(el);
    const line = shown.store.lines[0]!;
    const before = { ...line, product: { ...line.product } };
    const reads = api.listZoneOffers.mock.calls.length;
    const tabReads = api.getTabLines?.mock.calls.length ?? 0;
    const polls = api.menuState.mock.calls.length;
    api.listZoneOffers.mockResolvedValue(
      menu("v1", [offer("offer-lemonade", "Lemonade", "3.00", { allergens: { fish: {} } })]),
    );
    await poll(el);
    expect(api.menuState.mock.calls.length).toBeGreaterThan(polls);
    expect(api.listZoneOffers.mock.calls.length).toBe(reads);
    expect(api.getTabLines?.mock.calls.length ?? 0).toBe(tabReads);
    expect(shown.store.lines[0]).toBe(line);
    expect(line).toEqual(before);
    expect(shown.products.find((row) => row.productId === "Lemonade")!.allergens).toBeNull();
  },
);

it.each([
  ["information", "counter"],
  ["information", "table"],
  ["extras choice", "counter"],
  ["extras choice", "table"],
] as const)("updates the open %s from a new version (%s)", async (window, kind) => {
  const { el } = await mountApp(kind === "table" ? tableStubs() : {});
  if (kind === "table") await toTable(el);
  else await toCounter(el);
  const screen = kind === "table" ? tableScreen(el) : counter(el);
  const browser = screen.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!;
  const dish = [...browser.shadowRoot!.querySelectorAll<HTMLElement>('[data-kind="product"]')].find(
    (row) => row.textContent!.includes("Burger"),
  )!;
  const next = burgerOffer();
  next.allergens = { gluten: { kinds: ["wheat"] } };
  const list = next.offeredModifiers[0]!;
  if (list.kind !== "extras") throw new Error("expected extras");
  list.items[0]!.addAllergens = { sesame: {} };
  api.listZoneOffers.mockResolvedValue(
    menu("v2", [offer("offer-lemonade", "Lemonade", "3.00"), next]),
  );
  if (window === "information") {
    dish.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, composed: true }),
    );
    await browser.updateComplete;
    const info = browser.shadowRoot!.querySelector("till-product-info")!;
    await info.updateComplete;
    expect(info.shadowRoot!.textContent).not.toContain("Wheat");
    api.menuState.mockResolvedValue(menuState("v2"));
    await poll(el);
    await info.updateComplete;
    expect(browser.shadowRoot!.querySelector("till-product-info")).toBe(info);
    expect(info.shadowRoot!.textContent).toContain("Wheat");
  } else {
    dish.click();
    await browser.updateComplete;
    const picker = browser.shadowRoot!.querySelector("till-modifier-picker")!;
    await picker.updateComplete;
    expect(picker.shadowRoot!.textContent).not.toContain("Sesame");
    api.menuState.mockResolvedValue(menuState("v2"));
    await poll(el);
    await picker.updateComplete;
    expect(browser.shadowRoot!.querySelector("till-modifier-picker")).toBe(picker);
    expect(picker.shadowRoot!.textContent).toContain("Sesame");
  }
});

it.each(["counter", "table"] as const)(
  "takes a new version's allergens while a weighed dish is weighed and its choices are open (%s)",
  async (kind) => {
    const weighed = (version: string, allergens: TillMenuOffer["allergens"]) => {
      const [, cooked] = burgerOffer().offeredModifiers;
      const kilos = { ...unit, id: "unit-kg", precision: 3, hardwareUnit: "kg" as const };
      const dish = offer("offer-ham", "Ham", "9.00", {
        allergens,
        unit: kilos,
        offeredModifiers: [cooked!],
      });
      return menu(version, [dish]);
    };
    const { el, store, browser, serve } = await openSelling(
      kind,
      weighed("v1", {}),
      menuState("v1"),
    );
    [...browser.shadowRoot!.querySelectorAll<HTMLElement>('[data-kind="product"]')]
      .find((row) => row.textContent!.includes("Ham"))!
      .click();
    await flush(el);
    const screen = kind === "table" ? browser : counter(el);
    const pay = screen.shadowRoot!.querySelector<TillTenderPay>("till-tender-pay")!;
    emit(pay.shadowRoot!.querySelector("till-numeric-pad")!, "wt-change", { value: "2" });
    await pay.updateComplete;

    await serve(weighed("v2", { milk: {} }), menuState("v2"));
    pay.shadowRoot!.querySelector<HTMLElement>(".add")!.click();
    await pay.updateComplete;
    const picker = pay.shadowRoot!.querySelector("till-modifier-picker")!;
    expect(picker.product.allergens).toEqual({ milk: {} });

    await serve(weighed("v3", { sesame: {} }), menuState("v3"));
    expect(pay.shadowRoot!.querySelector("till-modifier-picker")).toBe(picker);
    emit(picker, "wt-modifier-confirm", { product: picker.product, extras: [] });
    expect(store.lines).toHaveLength(1);
    expect(store.lines[0]!.product).toMatchObject({
      menuVersionId: "v1",
      allergens: { sesame: {} },
    });
  },
);

it("reads the counter's offers again when only the live fields move", async () => {
  const { el } = await mountApp();
  await toCounter(el);
  const reads = api.listZoneOffers.mock.calls.length;
  const course = (id: string) => counter(el).products.find((row) => row.productId === id)!.courseId;
  expect(course("Lemonade")).toBeNull();
  api.listZoneOffers.mockResolvedValue({
    ...menu("v1", [offer("offer-lemonade", "Lemonade", "3.00", { courseId: "mains" })]),
    liveFields: "changed",
  });
  api.menuState.mockResolvedValue({ ...menuState("v1"), liveFields: "changed" });
  await poll(el);
  expect(api.listZoneOffers.mock.calls.length).toBe(reads + 1);
  expect(course("Lemonade")).toBe("mains");
});

it.each([true, false])(
  "keeps a sent counter declaration when its listing is readable (%s)",
  async (readable) => {
    const { el } = await mountApp();
    await toCounter(el);
    await retrieveForRefresh(
      el,
      { ...counter(el).products[0]!, allergens: { milk: {} } },
      "2026-11-15T10:00:00Z",
      readable,
    );
    api.listZoneOffers.mockResolvedValue(
      menu("v2", [offer("offer-lemonade", "Lemonade", "3.00", { allergens: { eggs: {} } })]),
    );
    api.menuState.mockResolvedValue(menuState("v2"));
    await poll(el);
    expect(counter(el).products[0]!.allergens).toEqual({ eggs: {} });
    expect(counter(el).store.lines[0]!.product.allergens).toEqual({ milk: {} });
  },
);

it("refreshes an already-held table dish's declaration at a new version", async () => {
  const held = {
    ...tabLemonade,
    id: "held-table-line",
    sentAt: null,
    firedAt: null,
    nutrition: { allergens: { milk: {} }, dietaryDeclarations: [] },
  };
  const { el } = await mountApp(
    tableStubs(DINING, { getTabLines: vi.fn().mockResolvedValue({ lines: [held], revision: 0 }) }),
  );
  await toTable(el);
  expect(tableScreen(el).lines[0]!.nutrition?.allergens).toEqual({ milk: {} });
  api.getTabLines.mockResolvedValue({
    lines: [{ ...held, nutrition: { allergens: { eggs: {} }, dietaryDeclarations: [] } }],
    revision: 0,
  });
  api.listZoneOffers.mockResolvedValue(DINING_V2);
  api.menuState.mockResolvedValue(menuState("v2"));
  await poll(el);
  expect(tableScreen(el).lines[0]!.nutrition?.allergens).toEqual({ eggs: {} });
});

it("refreshes declarations in the draft of a table without a seated party", async () => {
  const { el } = await mountApp(
    tableStubs(DINING, {
      getTablesState: vi.fn().mockResolvedValue([
        {
          ...table,
          state: "free",
          party: null,
          hasOpenTab: false,
          tabLineCount: 0,
          tabTotal: "0.00",
        },
      ]),
    }),
  );
  await toTable(el);
  const shown = tableScreen(el).shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!;
  shown.store.addProduct(shown.products[0]!, "1");
  const line = shown.store.lines[0]!;
  expect(line.product.allergens).toBeNull();
  api.listZoneOffers.mockResolvedValue(
    menu("v2", [offer("offer-lemonade", "Lemonade", "3.00", { allergens: { eggs: {} } })]),
  );
  api.menuState.mockResolvedValue(menuState("v2"));
  await poll(el);
  expect(line.product.allergens).toEqual({ eggs: {} });
});

it("keeps the displayed table bill after a declaration read fails and retries on the next poll", async () => {
  const held = {
    ...tabLemonade,
    id: "held-table-line",
    sentAt: null,
    nutrition: { allergens: { milk: {} }, dietaryDeclarations: [] },
  };
  const listGroups = vi.fn().mockResolvedValue({ groups: [], printProblems: [] });
  const dining = { ...DINING, liveFields: "unchanged" };
  const { el } = await mountApp(
    tableStubs(dining, {
      listZoneOffers: vi.fn().mockResolvedValue(dining),
      getTabLines: vi.fn().mockResolvedValue({ lines: [held], revision: 0 }),
      listGroups,
    }),
  );
  await toTable(el);
  const groupsRead = listGroups.mock.calls.length;
  api.getTabLines.mockRejectedValue(new TypeError("offline"));
  api.listZoneOffers.mockResolvedValue({ ...DINING_V2, liveFields: "unchanged" });
  api.menuState.mockResolvedValue({ ...menuState("v2"), liveFields: "unchanged" });
  await poll(el);
  expect(tableScreen(el).lines).toHaveLength(1);
  expect(tableScreen(el).lines[0]!.nutrition?.allergens).toEqual({ milk: {} });
  expect(listGroups.mock.calls.length).toBe(groupsRead);
  api.getTabLines.mockResolvedValue({
    lines: [{ ...held, nutrition: { allergens: { eggs: {} }, dietaryDeclarations: [] } }],
    revision: 0,
  });
  await poll(el);
  expect(tableScreen(el).lines[0]!.nutrition?.allergens).toEqual({ eggs: {} });
  expect(listGroups.mock.calls.length).toBe(groupsRead);
});

/** `zone` with a second menu, Dinner, selling `offers`. */
function withDinner(zone: ZoneOffers, offers: TillMenuOffer[], version = "d1"): ZoneOffers {
  return {
    ...zone,
    menus: [
      ...zone.menus,
      { ...zone.menus[0]!, id: "dinner", name: "Dinner", isDefault: false, versionId: version },
    ],
    offers: [
      ...offers.map((each) => ({ ...each, menuId: "dinner", menuName: "Dinner" })),
      ...zone.offers,
    ],
  };
}

const withDinnerState = (state: MenuState) => ({
  ...state,
  menus: [
    ...state.menus,
    { menuId: "dinner", versionId: "d1", orderable: true, endedPeriodName: null },
  ],
});

function hakeDish(allergens: TillMenuOffer["allergens"], price = "5.00") {
  return {
    ...offer("menu-hake", "Hake", price, { allergens, menuId: "daily" }),
    ordering: "not_sold_separately" as const,
    countsAsCourseId: null as string | null,
    variantCountsAs: {},
  };
}

function dailyCopy(dish: ReturnType<typeof hakeDish>, key = "daily-copy") {
  return {
    key,
    menuId: "daily",
    name: "Daily",
    changedAt: "2026-11-19T08:00:00Z",
    terms: {
      price: "14.00",
      vatClass: "reduced" as const,
      takeawayVatClass: "reduced" as const,
      names: {},
      lines: [] as SetMenuTerms["lines"],
    },
    structure: { members: [] },
    offers: [dish],
  };
}

const onSale = (copy: ReturnType<typeof dailyCopy>, version: string) => ({
  ...copy,
  versionIds: [version],
  orderable: true,
  newestOnSale: true,
});

const recordedDaily = (copy: ReturnType<typeof dailyCopy>) => ({
  setMenus: {
    copies: [setMenuCopyOf(copy, "v1")],
    recorded: { daily: "v1" },
    exact: true,
    setMenus: [],
    dishes: [],
  },
  setMenuCopies: [copy],
});

const addHake = (store: WorkingOrderStore, dish: ReturnType<typeof hakeDish>) =>
  store.addProduct(setMenuProduct({ offer: dish, setMenuId: "daily", versionId: "v1" }), "1", {
    setMenu: { id: "daily" },
  });

type Surface = "counter" | "table";

/** `el` at `kind`, every read of its zone answering `zone` until `serve` changes it. */
async function openSelling(
  kind: Surface,
  zone: ZoneOffers,
  state: MenuState,
  overrides: Record<string, unknown> = {},
) {
  const served: ZoneOffers =
    kind === "table"
      ? { ...zone, context: DINING.context }
      : {
          ...zone,
          context: {
            ...zone.context,
            dining: { policy: "till_choice", startsAs: "takeaway" },
          },
        };
  const stubs = {
    listDefaultZoneOffers: vi.fn().mockResolvedValue(served),
    listZoneOffers: vi.fn().mockResolvedValue(served),
    menuState: vi.fn().mockResolvedValue(state),
    ...overrides,
  };
  const { el } = await mountApp(
    kind === "table"
      ? tableStubs(served, {
          getPartyBills: vi.fn().mockResolvedValue([partyBillOf("party-a", "wo-7", 1)]),
          ...stubs,
        })
      : stubs,
  );
  if (kind === "table") await toTable(el);
  else await toCounter(el);
  const screen = () => (kind === "table" ? tableScreen(el) : counter(el));
  const browser = screen().shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!;
  const serve = async (next: ZoneOffers, nextState: MenuState & { liveFields?: string }) => {
    const reads = api.listZoneOffers.mock.calls.length;
    api.listZoneOffers.mockResolvedValue({
      ...next,
      context: served.context,
      liveFields: nextState.liveFields,
    });
    api.menuState.mockResolvedValue(nextState);
    await poll(el);
    expect(api.listZoneOffers.mock.calls.length).toBeGreaterThan(reads);
  };
  return { el, store: browser.store, browser, serve };
}

it.each(["counter", "table"] as const)(
  "keeps a drafted set-menu dish's own allergens when another menu lists its product differently (%s)",
  async (kind) => {
    const hake = hakeDish({ fish: {} });
    const zone = withDinner({ ...V1, setMenus: [onSale(dailyCopy(hake), "v1")] }, [
      offer("offer-hake", "Hake", "12.00", { allergens: null }),
    ]);
    const { el, store, browser, serve } = await openSelling(
      kind,
      zone,
      withDinnerState(menuState("v1")),
    );
    addHake(store, hake);
    await flush(el);
    const line = store.lines[0]!;
    expect(line.product.allergens).toEqual({ fish: {} });

    await serve(
      withDinner({ ...V1, setMenus: zone.setMenus }, [
        offer("offer-hake", "Hake", "12.00", { allergens: { milk: {} } }),
      ]),
      { ...withDinnerState(menuState("v1")), liveFields: "changed" },
    );

    expect(
      browser.servedProducts.find(({ menuItemId }) => menuItemId === "offer-hake")!.allergens,
    ).toEqual({ milk: {} });
    expect(store.lines[0]).toBe(line);
    expect(line.product.allergens).toEqual({ fish: {} });
    expect(line.blocked).toBeUndefined();
    expect(dialog(el)).toBeNull();
  },
);

it.each([
  ["counter", true],
  ["counter", false],
  ["table", true],
  ["table", false],
] as const)(
  "keeps the allergens of a dish its own menu dropped (%s), another menu listing its product: %s",
  async (kind, elsewhere) => {
    const zone = menu("v1", [
      offer("offer-lemonade", "Lemonade", "3.00", { allergens: { fish: {} } }),
      burgerOffer(),
    ]);
    const { el, store, serve } = await openSelling(
      kind,
      withDinner(zone, []),
      withDinnerState(menuState("v1")),
    );
    store.addProduct(menuOfferToTillProduct(zone.offers[0]!, "v1"), "1");
    await flush(el);
    const line = store.lines[0]!;

    await serve(
      withDinner(
        menu("v2", [burgerOffer()]),
        elsewhere
          ? [offer("dinner-lemonade", "Lemonade", "4.00", { allergens: { milk: {} } })]
          : [],
      ),
      withDinnerState(menuState("v2")),
    );

    expect(line.blocked).toBe("removed");
    expect(line.product.allergens).toEqual({ fish: {} });
  },
);

it.each([
  ["counter", "5.00"],
  ["counter", "6.00"],
  ["table", "5.00"],
  ["table", "6.00"],
] as const)(
  "shows a drafted set-menu dish's new allergens from its republished copy (%s, at %s)",
  async (kind, price) => {
    const hake = hakeDish({ fish: {} });
    const { el, store, serve } = await openSelling(
      kind,
      { ...V1, setMenus: [onSale(dailyCopy(hake), "v1")] },
      menuState("v1"),
    );
    addHake(store, hake);
    await flush(el);
    const line = store.lines[0]!;

    await serve(
      {
        ...menu("v2", V1.offers),
        setMenus: [onSale(dailyCopy(hakeDish({ fish: {}, eggs: {} }, price), "copy-2"), "v2")],
      },
      menuState("v2"),
    );

    expect(store.lines[0]).toBe(line);
    expect(line.product.allergens).toEqual({ fish: {}, eggs: {} });
    expect(line.product.unitPrice).toBe("5.00");
    expect(line.product.menuVersionId).toBe(price === "5.00" ? "v2" : "v1");
    expect(dialog(el) !== null).toBe(price !== "5.00");
  },
);

/** Daily sold by Lunch and by Dinner, each menu's copy declaring the dish its own way. */
const lunchDaily = (dish: ReturnType<typeof hakeDish>, version: string, newestOnSale: boolean) => ({
  ...onSale(dailyCopy(dish, `lunch-${version}`), version),
  newestOnSale,
});
const dinnerDaily = (price: string, newestOnSale: boolean) => ({
  ...onSale(dailyCopy(hakeDish({ fish: {} }, price), "dinner-copy"), "d1"),
  newestOnSale,
});
const bothDaily = (price: string): ZoneOffers => ({
  ...withDinner(V1, []),
  setMenus: [lunchDaily(hakeDish({}), "v1", true), dinnerDaily(price, false)],
});
/** Lunch's v2, with Daily declared as `lunch` says or dropped, while Dinner's is the one on sale. */
const dinnerNewest = (
  price: string,
  lunch: TillMenuOffer["allergens"] | "dropped",
): ZoneOffers => ({
  ...withDinner(menu("v2", V1.offers), []),
  setMenus: [
    ...(lunch === "dropped" ? [] : [lunchDaily(hakeDish(lunch), "v2", false)]),
    dinnerDaily(price, true),
  ],
});

it.each([
  ["counter", "dropped", {}],
  ["counter", { milk: {} }, { milk: {} }],
  ["table", "dropped", {}],
  ["table", { milk: {} }, { milk: {} }],
] as const)(
  "shows a drafted set-menu dish its own menu's allergens until it is sold from another menu's copy (%s, Lunch's: %j)",
  async (kind, lunch, own) => {
    const { el, store, serve } = await openSelling(
      kind,
      bothDaily("6.00"),
      withDinnerState(menuState("v1")),
    );
    addHake(store, hakeDish({}));
    await flush(el);
    const line = store.lines[0]!;

    await serve(dinnerNewest("6.00", lunch), withDinnerState(menuState("v2")));
    expect(dialog(el)).not.toBeNull();
    expect(line.product).toMatchObject({ menuVersionId: "v1", unitPrice: "5.00" });
    expect(line.product.allergens).toEqual(own);

    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!.click();
    await flush(el);
    expect(store.lines[0]!.product).toMatchObject({ menuVersionId: "d1", unitPrice: "6.00" });
    expect(store.lines[0]!.product.allergens).toEqual({ fish: {} });
  },
);

it.each(["counter", "table"] as const)(
  "shows a drafted set-menu dish another menu's allergens once it is sold from that copy at the same price (%s)",
  async (kind) => {
    const { el, store, serve } = await openSelling(
      kind,
      bothDaily("5.00"),
      withDinnerState(menuState("v1")),
    );
    addHake(store, hakeDish({}));
    await flush(el);

    await serve(dinnerNewest("5.00", "dropped"), withDinnerState(menuState("v2")));

    expect(dialog(el)).toBeNull();
    expect(store.lines[0]!.product.menuVersionId).toBe("d1");
    expect(store.lines[0]!.product.allergens).toEqual({ fish: {} });
  },
);

it.each([
  ["dropped", {}],
  [{ milk: {} }, { milk: {} }],
] as const)(
  "shows a saved unsent set-menu dish only its own menu's allergens (Lunch's: %j)",
  async (lunch, own) => {
    const { el, store, serve } = await openSelling(
      "counter",
      bothDaily("5.00"),
      withDinnerState(menuState("v1")),
      {
        retrieveWorkingOrder: vi.fn().mockResolvedValue({
          ...heldDaily(dailyCopy(hakeDish({}))),
          setMenus: undefined,
          setMenuCopies: undefined,
        }),
        getTabLines: vi.fn().mockResolvedValue({
          revision: 7,
          lines: [{ ...tabLemonade, id: "held-line", productId: "Hake", sentAt: null }],
        }),
        getBillBalance: vi.fn().mockRejectedValue(new Error("not under test")),
      },
    );
    emit(counter(el), "retrieve-order", { id: "held-order" });
    await flush(el);

    await serve(dinnerNewest("5.00", lunch), withDinnerState(menuState("v2")));

    expect(store.lines[0]!.product.menuVersionId).toBe("v1");
    expect(store.lines[0]!.product.allergens).toEqual(own);
  },
);

it("follows its own menu for a saved set-menu dish whose version this till never saw live", async () => {
  const held = heldDaily(dailyCopy(hakeDish({})));
  const { el, store, serve } = await openSelling(
    "counter",
    dinnerNewest("5.00", {}),
    withDinnerState(menuState("v2")),
    {
      retrieveWorkingOrder: vi.fn().mockResolvedValue({
        ...held,
        setMenus: undefined,
        setMenuCopies: undefined,
      }),
      getTabLines: vi.fn().mockResolvedValue({
        revision: 7,
        lines: [{ ...tabLemonade, id: "held-line", productId: "Hake", sentAt: null }],
      }),
      getBillBalance: vi.fn().mockRejectedValue(new Error("not under test")),
    },
  );
  emit(counter(el), "retrieve-order", { id: "held-order" });
  await flush(el);

  await serve(
    {
      ...withDinner(menu("v3", V1.offers), []),
      setMenus: [lunchDaily(hakeDish({ milk: {} }), "v3", false), dinnerDaily("5.00", true)],
    },
    withDinnerState(menuState("v3")),
  );

  expect(store.lines[0]!.product.menuVersionId).toBe("v1");
  expect(store.lines[0]!.product.allergens).toEqual({ milk: {} });
});

it.each([
  ["dropped", null],
  [{ milk: {} }, { sesame: {} }],
] as const)(
  "opens a set-menu dish whose copy no bill records with only its own menu's extras' allergens (Lunch's: %j)",
  async (lunch, own) => {
    const withCheese = <T extends object>(dish: T, addAllergens: TillMenuOffer["allergens"]) => {
      const [extras] = burgerOffer().offeredModifiers;
      if (extras?.kind !== "extras") throw new Error("extras");
      const items = extras.items.map((item) => ({ ...item, addAllergens }));
      return { ...dish, offeredModifiers: [{ ...extras, items }] };
    };
    const zone = dinnerNewest("5.00", lunch);
    const served = {
      ...zone,
      setMenus: zone.setMenus!.map((copy) => ({
        ...copy,
        offers: copy.offers.map((dish) =>
          withCheese(dish, copy.key === "dinner-copy" ? {} : { sesame: {} }),
        ),
      })),
    };
    const held = heldDaily(dailyCopy(hakeDish({})));
    const { el, store } = await openSelling(
      "counter",
      served as ZoneOffers,
      withDinnerState(menuState("v2")),
      {
        retrieveWorkingOrder: vi.fn().mockResolvedValue({
          ...held,
          setMenus: undefined,
          setMenuCopies: undefined,
        }),
        getTabLines: vi.fn().mockResolvedValue({ revision: 7, lines: [] }),
        getBillBalance: vi.fn().mockRejectedValue(new Error("not under test")),
      },
    );
    emit(counter(el), "retrieve-order", { id: "held-order" });
    await flush(el);

    const [extras] = store.lines[0]!.product.offeredModifiers!;
    expect(extras?.kind === "extras" && extras.items[0]!.addAllergens).toEqual(own);
  },
);

it("shows a drafted set-menu dish's correction when its bill's recorded copy is read again", async () => {
  const hake = hakeDish({ fish: {} });
  const bill = (allergens: TillMenuOffer["allergens"]) =>
    partyBillOf("party-a", "wo-7", 1, recordedDaily(dailyCopy(hakeDish(allergens))));
  const stream = liveReadFixture();
  const { el, store } = await openSelling("table", V1, menuState("v1"), {
    getPartyBills: vi.fn().mockResolvedValue([bill({ fish: {} })]),
    readLiveEvents: stream.read,
  });
  stream.event("ready");
  addHake(store, hake);
  await flush(el);
  await vi.waitFor(() => expect(api.saveDraft).toHaveBeenCalled());
  await flush(el);
  const line = store.lines[0]!;
  const saves = api.saveDraft!.mock.calls.length;

  api.getPartyBills!.mockResolvedValue([bill({ fish: {}, eggs: {} })]);
  stream.event("change", JSON.stringify([{ type: "menu_versions" }]));
  await vi.waitFor(() => expect(line.product.allergens).toEqual({ fish: {}, eggs: {} }));

  expect(store.lines[0]).toBe(line);
  expect(dialog(el)).toBeNull();
  await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 30));
  expect(api.saveDraft!.mock.calls.length).toBe(saves);
});

/** An open counter order holding one saved Hake from Daily, its recorded copy being `copy`. */
const heldDaily = (copy: ReturnType<typeof dailyCopy>) => ({
  id: "held-order",
  zoneId: null,
  revision: 7,
  label: "Lunch",
  expectedEdit: null,
  dining: "takeaway",
  diningChoice: "locked",
  kitchenNote: {
    scope: { workingOrderId: "held-order" },
    note: null,
    revision: 0,
    ownerRevision: 0,
  },
  ...recordedDaily(copy),
  lines: [
    {
      product: {
        ...setMenuProduct({ offer: copy.offers[0]!, setMenuId: "daily", versionId: "v1" }),
        menuId: "lunch",
      },
      productId: "Hake",
      menuItemId: "menu-hake",
      menuVersionId: "v1",
      setMenuId: "daily",
      workingOrderLineId: "held-line",
      quantity: "1.000",
    },
  ],
});

async function openHeldDaily(sentAt: string | null, overrides: Record<string, unknown> = {}) {
  const opened = await openSelling("counter", V1, menuState("v1"), {
    retrieveWorkingOrder: vi.fn().mockResolvedValue(heldDaily(dailyCopy(hakeDish({ fish: {} })))),
    getTabLines: vi.fn().mockResolvedValue({
      revision: 7,
      lines: [{ ...tabLemonade, id: "held-line", productId: "Hake", sentAt }],
    }),
    getBillBalance: vi.fn().mockRejectedValue(new Error("not under test")),
    ...overrides,
  });
  const retrieve = async () => {
    emit(counter(opened.el), "retrieve-order", { id: "held-order" });
    await flush(opened.el);
  };
  return { ...opened, retrieve };
}

it.each([
  ["unsent", "answers", null, { fish: {}, eggs: {} }],
  ["sent", "answers", "2026-11-15T10:00:00Z", { fish: {} }],
  ["unsent", "fails at first", null, { fish: {}, eggs: {} }],
] as const)(
  "reads an open counter order's recorded set-menu copies again at a new version: a saved %s dish, the read %s",
  async (_state, read, sentAt, allergens) => {
    const { el, store, serve, retrieve } = await openHeldDaily(sentAt);
    await retrieve();
    const line = store.lines[0]!;
    expect(line.workingOrderLineId).toBe("held-line");
    addHake(store, hakeDish({ fish: {} }));
    const added = store.lines[1]!;

    api.retrieveWorkingOrder!.mockResolvedValue(
      heldDaily(dailyCopy(hakeDish({ fish: {}, eggs: {} }))),
    );
    if (read === "fails at first")
      api.retrieveWorkingOrder!.mockRejectedValueOnce(new Error("offline"));
    await serve(menu("v2", V1.offers), { ...menuState("v2"), liveFields: "same" });
    if (read === "fails at first") {
      expect(line.product.allergens).toEqual({ fish: {} });
      await poll(el);
    }
    const reads = api.retrieveWorkingOrder!.mock.calls.length;
    await poll(el);

    expect(api.retrieveWorkingOrder!.mock.calls.length).toBe(reads);
    expect(store.lines).toEqual([line, added]);
    expect(line.product.allergens).toEqual(allergens);
    expect(added.product.allergens).toEqual({ fish: {}, eggs: {} });
    expect(store.revision).toBe(7);
  },
);

it("drops a late answer about the copies of an order opened again since", async () => {
  const { el, store, serve, retrieve } = await openHeldDaily(null);
  await retrieve();
  const late = deferred<ReturnType<typeof heldDaily>>();
  api.retrieveWorkingOrder!.mockReturnValueOnce(late.promise);
  await serve(menu("v2", V1.offers), menuState("v2"));
  api.retrieveWorkingOrder!.mockResolvedValue(
    heldDaily(dailyCopy(hakeDish({ fish: {}, sesame: {} }))),
  );
  await retrieve();
  expect(store.lines[0]!.product.allergens).toEqual({ fish: {}, sesame: {} });

  late.resolve(heldDaily(dailyCopy(hakeDish({ fish: {} }))));
  await flush(el);

  expect(store.lines[0]!.product.allergens).toEqual({ fish: {}, sesame: {} });
});

/** Daily with a place for a main, whose Hake offers an extra: `allergens` are the dish's and the
 * extra's. */
function chosenDaily(allergens: TillMenuOffer["allergens"], menuId = "daily") {
  const [extras] = burgerOffer().offeredModifiers;
  if (extras?.kind !== "extras") throw new Error("extras");
  const copy = dailyCopy({
    ...hakeDish(allergens),
    offeredModifiers: [
      { ...extras, items: extras.items.map((item) => ({ ...item, addAllergens: allergens })) },
    ],
    countsAsCourseId: "mains",
  });
  return {
    ...copy,
    key: `${menuId}-copy`,
    menuId,
    name: menuId === "daily" ? "Daily" : "Special",
    terms: { ...copy.terms, lines: [{ id: "main", count: 1, courseIds: ["mains"] }] },
  };
}

/** A bill holding one of `copy`'s set menu, with nothing ordered on it. */
const oneOf = (copy: ReturnType<typeof chosenDaily>) => ({
  setMenus: {
    copies: [setMenuCopyOf(copy, "v1")],
    recorded: { [copy.menuId]: "v1" },
    exact: true,
    setMenus: [{ lineId: "held-menu", copyId: copy.key, lineNo: 1 }],
    dishes: [],
  },
  setMenuCopies: [copy],
});

/** The till at `kind` on a bill whose set menus are `bill`, with Hake's extras open from the folders
 * named `path`. */
async function openHakeChoices(
  kind: Surface,
  zone: ZoneOffers,
  bill: ReturnType<typeof oneOf>,
  path: string[],
) {
  const stream = liveReadFixture();
  const order = (held: ReturnType<typeof oneOf>) => ({
    ...heldDaily(dailyCopy(hakeDish({}))),
    ...held,
    lines: [],
  });
  const opened = await openSelling(kind, zone, menuState("v1"), {
    retrieveWorkingOrder: vi.fn().mockResolvedValue(order(bill)),
    getTabLines: vi.fn().mockResolvedValue({ revision: 7, lines: [] }),
    getBillBalance: vi.fn().mockRejectedValue(new Error("not under test")),
    getPartyBills: vi.fn().mockResolvedValue([partyBillOf("party-a", "wo-7", 1, bill)]),
    readLiveEvents: stream.read,
  });
  const { el, browser } = opened;
  stream.event("ready");
  if (kind === "counter") emit(counter(el), "retrieve-order", { id: "held-order" });
  await flush(el);
  for (const name of path) {
    [...browser.shadowRoot!.querySelectorAll<HTMLElement>("wt-button")]
      .find((button) => button.querySelector(".name")?.textContent === name)!
      .click();
    await browser.updateComplete;
  }
  const folder = browser.shadowRoot!.querySelector("till-set-menu-folder")!;
  await folder.updateComplete;
  [...folder.shadowRoot!.querySelectorAll<HTMLElement>("wt-button")]
    .find((button) => button.textContent!.includes("Hake"))!
    .click();
  await browser.updateComplete;
  const picker = browser.shadowRoot!.querySelector("till-modifier-picker")!;
  await picker.updateComplete;
  const shown = () => picker.shadowRoot!.textContent;
  expect(shown()).not.toContain("Milk");
  return {
    ...opened,
    shown,
    /** The bill's recorded copies read again as `held`, Lunch having been published. */
    correct: async (held: ReturnType<typeof oneOf>) => {
      api.retrieveWorkingOrder!.mockResolvedValue(order(held));
      api.getPartyBills!.mockResolvedValue([partyBillOf("party-a", "wo-7", 1, held)]);
      if (kind === "counter") await opened.serve(menu("v2", V1.offers), menuState("v2"));
      else stream.event("change", JSON.stringify([{ type: "menu_versions" }]));
      await vi.waitFor(async () => {
        await flush(el);
        expect(shown()).toContain("Milk");
      });
    },
    confirm: async () => {
      picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!.click();
      await flush(el);
      expect(browser.shadowRoot!.querySelector("till-modifier-picker")).toBeNull();
    },
  };
}

it.each(["counter", "table"] as const)(
  "shows, and adds with, a correction to the copy its bill recorded that arrives while a set-menu dish's choices are open (%s)",
  async (kind) => {
    const { store, correct, confirm } = await openHakeChoices(kind, V1, oneOf(chosenDaily({})), [
      t("set_menu.folders"),
      "Daily",
    ]);

    await correct(oneOf(chosenDaily({ milk: {} })));
    await confirm();

    expect(store.lines).toHaveLength(1);
    const { product } = store.lines[0]!;
    expect(product.allergens).toEqual({ milk: {} });
    const [extras] = product.offeredModifiers!;
    expect(extras?.kind === "extras" && extras.items[0]!.addAllergens).toEqual({ milk: {} });
  },
);

it.each(["counter", "table"] as const)(
  "shows the republished copy's allergens in a set-menu dish's open choices, and adds nothing at the old version (%s)",
  async (kind) => {
    const selling = (allergens: TillMenuOffer["allergens"], version: string): ZoneOffers => ({
      ...menu(version, V1.offers),
      menus: menu(version, V1.offers).menus.map((each) => ({
        ...each,
        structure: { members: [{ kind: "set_menu", menuId: "daily", name: "Daily" }] },
      })),
      setMenus: [onSale(chosenDaily(allergens), version)],
    });
    // The dish is picked from Daily, which no bill records, into the bill's Special.
    const { el, store, serve, shown, confirm } = await openHakeChoices(
      kind,
      selling({}, "v1"),
      oneOf(chosenDaily({}, "special")),
      ["Daily"],
    );

    await serve(selling({ milk: {} }, "v2"), menuState("v2"));
    await flush(el);

    expect(shown()).toContain("Milk");
    await confirm();
    expect(store.lines).toEqual([]);
  },
);

/** A held Daily order opened, and a re-read of its copies still out after Lunch was published. */
async function rereadOut(
  overrides: Record<string, unknown> = {},
  setMenus: ReturnType<typeof onSale>[] = [],
) {
  const opened = await openHeldDaily(null, overrides);
  await opened.retrieve();
  const asked = deferred<ReturnType<typeof heldDaily>>();
  api.retrieveWorkingOrder!.mockReturnValueOnce(asked.promise);
  await opened.serve(
    { ...menu("v2", V1.offers), setMenus },
    { ...menuState("v2"), liveFields: "v2" },
  );
  const answer = async (copy: ReturnType<typeof dailyCopy>) => {
    asked.resolve(heldDaily(copy));
    await flush(opened.el);
  };
  return { ...opened, answer };
}

const recordedOf = (el: TillApp) => counter(el).setMenuCopies.map(({ copy }) => copy);

it("changes only the allergens shown when an open counter order's copies are read again", async () => {
  const { el, store, answer } = await rereadOut();
  addHake(store, hakeDish({ fish: {} }));
  store.setLineQuantity(1, "3");
  store.setLineExtras(1, { note: "no lemon" });
  const before = structuredClone(store.lines);

  await answer(dailyCopy(hakeDish({ fish: {}, eggs: {} }, "9.00")));

  expect(store.lines).toEqual(
    before.map((line) => ({
      ...line,
      product: { ...line.product, allergens: { fish: {}, eggs: {} } },
    })),
  );
  expect(store.revision).toBe(7);
  expect(recordedOf(el)[0]!.offers[0]!.allergens).toEqual({ fish: {}, eggs: {} });
});

it("takes nothing from a copy of another menu's version that shares a recorded copy's key", async () => {
  const { el, store, answer } = await rereadOut();
  const other = heldDaily(dailyCopy(hakeDish({ milk: {} })));
  other.setMenus.copies[0]!.versionId = "d1";
  other.setMenus.recorded.daily = "d1";
  api.retrieveWorkingOrder!.mockResolvedValue(other);
  await answer(dailyCopy(hakeDish({ fish: {} })));
  api.menuState!.mockResolvedValue({ ...menuState("v2"), liveFields: "v3" });
  await poll(el);
  await poll(el);

  expect(store.lines[0]!.product.allergens).toEqual({ fish: {} });
  expect(recordedOf(el)[0]!.offers[0]!.allergens).toEqual({ fish: {} });
});

it("keeps a newer re-read of the copies when an earlier one answers after it", async () => {
  const { el, store, serve, answer } = await rereadOut();
  api.retrieveWorkingOrder!.mockResolvedValue(
    heldDaily(dailyCopy(hakeDish({ fish: {}, sesame: {} }))),
  );
  await serve(menu("v3", V1.offers), { ...menuState("v3"), liveFields: "v3" });
  expect(store.lines[0]!.product.allergens).toEqual({ fish: {}, sesame: {} });

  await answer(dailyCopy(hakeDish({ fish: {} })));

  expect(store.lines[0]!.product.allergens).toEqual({ fish: {}, sesame: {} });
  expect(recordedOf(el)[0]!.offers[0]!.allergens).toEqual({ fish: {}, sesame: {} });
});

it.each(["paid and cleared", "left for another operator"])(
  "drops a late answer about the copies of an order %s",
  async (end) => {
    const { el, store, answer } = await rereadOut();
    if (end === "paid and cleared") store.clear();
    else {
      emit(counter(el), "logout");
      await flush(el);
      emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Bea", permissions: [] });
      await flush(el);
    }
    const lines = structuredClone(counter(el).store.lines);
    const reads = api.listZoneOffers.mock.calls.length;

    await answer(dailyCopy(hakeDish({ fish: {}, eggs: {} })));

    expect(counter(el).store.lines).toEqual(lines);
    expect(
      recordedOf(el).flatMap(({ offers }) => offers.map((dish) => dish.allergens)),
    ).not.toContainEqual({
      fish: {},
      eggs: {},
    });
    await poll(el);
    expect(api.listZoneOffers.mock.calls.length).toBe(reads);
  },
);

it("keeps the correction, and the copy recorded meanwhile, when a set-menu change was out as the copies were read", async () => {
  const special = { ...dailyCopy(hakeDish({ milk: {} }), "special-copy"), menuId: "special" };
  const saved = deferred<unknown>();
  const { el, store, answer } = await rereadOut(
    {
      setSetMenuCount: vi.fn().mockReturnValue(saved.promise),
    },
    [onSale(special, "v2")],
  );
  const held = heldDaily(dailyCopy(hakeDish({ fish: {} })));
  const changed = counter(el).saveSetMenuCount!("special", 1);
  await flush(el);
  expect(api.setSetMenuCount).toHaveBeenCalledOnce();
  await answer(dailyCopy(hakeDish({ fish: {}, eggs: {} })));
  saved.resolve({
    setMenus: {
      ...held.setMenus,
      copies: [...held.setMenus.copies, setMenuCopyOf(special, "v2")],
      recorded: { daily: "v1", special: "v2" },
    },
    partyRevision: 8,
  });
  await changed;
  await flush(el);

  expect(store.revision).toBe(8);
  expect(store.lines[0]!.product.allergens).toEqual({ fish: {}, eggs: {} });
  expect(recordedOf(el).map(({ key, offers }) => [key, offers[0]!.allergens])).toEqual([
    ["daily-copy", { fish: {}, eggs: {} }],
    ["special-copy", { milk: {} }],
  ]);
});

it("keeps a copy the order recorded after its copies were asked for again", async () => {
  const special = { ...dailyCopy(hakeDish({ milk: {} }), "special-copy"), menuId: "special" };
  const { el, answer } = await rereadOut(
    {
      setSetMenuCount: vi.fn().mockImplementation(async () => {
        const { setMenus } = heldDaily(dailyCopy(hakeDish({ fish: {} })));
        return {
          setMenus: {
            ...setMenus,
            copies: [...setMenus.copies, setMenuCopyOf(special, "v2")],
            recorded: { daily: "v1", special: "v2" },
          },
          partyRevision: 8,
        };
      }),
    },
    [onSale(special, "v2")],
  );
  await counter(el).saveSetMenuCount!("special", 1);

  await answer(dailyCopy(hakeDish({ fish: {}, eggs: {} })));

  expect(recordedOf(el).map(({ key, offers }) => [key, offers[0]!.allergens])).toEqual([
    ["daily-copy", { fish: {}, eggs: {} }],
    ["special-copy", { milk: {} }],
  ]);
});

it("drops an answer about the copies of an order placed since they were asked for", async () => {
  const { el, store, answer } = await rereadOut({
    placeOrder: vi.fn().mockResolvedValue({}),
    updateWorkingOrder: vi.fn().mockResolvedValue({ revision: 7 }),
  });
  emit(counter(el), "place-order");
  await vi.waitFor(() => expect(counter(el).stage).toBe("collect"));
  const line = store.lines[0]!;
  expect(line.product.allergens).toEqual({ fish: {} });

  await answer(dailyCopy(hakeDish({ fish: {}, eggs: {} })));

  expect(store.lines[0]!.product.allergens).toEqual({ fish: {} });
});

it.each([
  ["cannot be reached", new Error("offline"), true],
  ["is gone", { code: "working_order.not_found", status: 404 }, false],
])(
  "asks again about an order's copies at the next poll when it %s: %s",
  async (_end, error, asks) => {
    const { el, serve, retrieve } = await openHeldDaily(null);
    await retrieve();
    api.retrieveWorkingOrder!.mockRejectedValue(error);
    await serve(menu("v2", V1.offers), { ...menuState("v2"), liveFields: "v2" });
    const reads = api.retrieveWorkingOrder!.mock.calls.length;
    await poll(el);
    expect(api.retrieveWorkingOrder!.mock.calls.length).toBe(reads + (asks ? 1 : 0));
  },
);

it("asks only for the order's copies again while that read keeps failing, leaving a dismissed price dialog shut", async () => {
  const { el, store, serve, retrieve } = await openHeldDaily(null);
  await retrieve();
  add(el, "Lemonade");
  api.retrieveWorkingOrder!.mockRejectedValue(new Error("offline"));
  const published = menu("v2", [offer("offer-lemonade", "Lemonade", "2.50"), burgerOffer()]);
  await serve(published, { ...menuState("v2"), liveFields: "v2" });
  expect(dialogText(el)).toContain("Lemonade €3.00 → €2.50");
  dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!.click();
  await flush(el);

  const zoneReads = api.listZoneOffers.mock.calls.length;
  const copyReads = api.retrieveWorkingOrder!.mock.calls.length;
  const dialogs: boolean[] = [];
  for (let polls = 0; polls < 4; polls++) {
    await poll(el);
    dialogs.push(dialog(el) !== null);
  }
  expect(dialogs).toEqual([false, false, false, false]);
  expect(api.listZoneOffers.mock.calls.length).toBe(zoneReads);
  expect(api.retrieveWorkingOrder!.mock.calls.length).toBe(copyReads + 4);

  api.retrieveWorkingOrder!.mockResolvedValue(
    heldDaily(dailyCopy(hakeDish({ fish: {}, eggs: {} }))),
  );
  await poll(el);
  await poll(el);
  expect(api.retrieveWorkingOrder!.mock.calls.length).toBe(copyReads + 5);
  expect(store.lines[0]!.product.allergens).toEqual({ fish: {}, eggs: {} });
});

it("asks for an order's copies again while a price dialog waits over it", async () => {
  const { el, store, serve, retrieve } = await openHeldDaily(null);
  await retrieve();
  add(el, "Lemonade");
  api.retrieveWorkingOrder!.mockRejectedValueOnce(new Error("offline"));
  const published = menu("v2", [offer("offer-lemonade", "Lemonade", "2.50"), burgerOffer()]);
  await serve(published, { ...menuState("v2"), liveFields: "v2" });
  api.retrieveWorkingOrder!.mockResolvedValue(
    heldDaily(dailyCopy(hakeDish({ fish: {}, eggs: {} }))),
  );
  await poll(el);
  expect(dialog(el)).not.toBeNull();
  expect(store.lines[0]!.product.allergens).toEqual({ fish: {}, eggs: {} });
});

it.each(["cleared", "opened again", "left for another operator", "sent unpaid", "read elsewhere"])(
  "does not ask again about the copies of an order %s since the read failed",
  async (end) => {
    const { el, store, serve, retrieve } = await openHeldDaily(null, {
      placeOrder: vi.fn().mockResolvedValue({}),
      updateWorkingOrder: vi.fn().mockResolvedValue({ revision: 7 }),
    });
    await retrieve();
    api.retrieveWorkingOrder!.mockRejectedValueOnce(new Error("offline"));
    await serve(menu("v2", V1.offers), { ...menuState("v2"), liveFields: "v2" });
    if (end === "cleared") store.clear();
    else if (end === "opened again") await retrieve();
    else if (end === "sent unpaid") {
      emit(counter(el), "place-order");
      await vi.waitFor(() => expect(counter(el).stage).toBe("collect"));
    } else if (end === "read elsewhere") el.api = { ...el.api } as unknown as TillApi;
    else {
      emit(counter(el), "logout");
      await flush(el);
      emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Bea", permissions: [] });
    }
    await flush(el);
    const reads = api.retrieveWorkingOrder!.mock.calls.length;
    const polls = api.menuState.mock.calls.length;

    await poll(el);

    expect(api.menuState.mock.calls.length).toBeGreaterThan(polls);
    expect(api.retrieveWorkingOrder!.mock.calls.length).toBe(reads);
  },
);

it("drops a late answer about an order's copies from a connection the till has left", async () => {
  const { el, store, answer } = await rereadOut();
  el.api = { ...el.api } as unknown as TillApi;
  await flush(el);

  await answer(dailyCopy(hakeDish({ fish: {}, eggs: {} })));

  expect(store.lines[0]!.product.allergens).toEqual({ fish: {} });
  expect(recordedOf(el)[0]!.offers[0]!.allergens).toEqual({ fish: {} });
});

it("gives up a read of an order's copies that hangs, and asks again at the next poll", async () => {
  const { el, store, serve, retrieve } = await openHeldDaily(null);
  await retrieve();
  const timers = vi.spyOn(window, "setTimeout");
  api.retrieveWorkingOrder!.mockImplementationOnce(
    (_id: string, options: { signal?: AbortSignal } = {}) =>
      new Promise((_resolve, reject) =>
        options.signal?.addEventListener("abort", () => reject(options.signal!.reason)),
      ),
  );
  await serve(menu("v2", V1.offers), { ...menuState("v2"), liveFields: "v2" });
  api.retrieveWorkingOrder!.mockResolvedValue(
    heldDaily(dailyCopy(hakeDish({ fish: {}, eggs: {} }))),
  );
  await poll(el);
  expect(store.lines[0]!.product.allergens).toEqual({ fish: {} });

  for (const [handler, delay] of timers.mock.calls)
    if (delay === TABLE_REQUEST_LIMIT_MS && typeof handler === "function") handler();
  timers.mockRestore();
  await flush(el);
  await poll(el);

  expect(store.lines[0]!.product.allergens).toEqual({ fish: {}, eggs: {} });
});

it("does not read an order sent unpaid as an open one when the menu changes", async () => {
  const { el, store, serve } = await openHeldDaily("2026-11-15T10:00:00Z", {
    retrievePlacedOrder: vi.fn().mockResolvedValue(heldDaily(dailyCopy(hakeDish({ fish: {} })))),
  });
  emit(counter(el), "pay-waiting-order", { id: "held-order" });
  await flush(el);
  expect(counter(el).stage).toBe("collect");
  expect(store.lines).toHaveLength(1);

  await serve(menu("v2", V1.offers), menuState("v2"));

  expect(api.retrieveWorkingOrder).not.toHaveBeenCalled();
});

it.each(["recorded", "live"] as const)(
  "restores a set-menu dish from its %s copy and follows sold-out changes",
  async (source) => {
    const dish = {
      ...offer("menu-hake", "Hake", "5.00"),
      ordering: "not_sold_separately" as const,
      countsAsCourseId: null,
      variantCountsAs: {},
    };
    const copy = {
      key: "daily-copy",
      menuId: "daily",
      name: "Daily",
      changedAt: "2026-11-19T08:00:00Z",
      terms: {
        price: "14.00",
        names: {},
        lines: [],
      },
      structure: { members: [] },
      offers: [dish],
    };
    const recorded = source === "recorded";
    const bill = partyBillOf(
      "party-a",
      "wo-7",
      1,
      !recorded
        ? {}
        : {
            setMenuCopies: [copy],
            setMenus: {
              copies: [setMenuCopyOf(copy, "retired")],
              recorded: { daily: "retired" },
              exact: true,
              setMenus: [],
              dishes: [],
            },
          },
    );
    drafts.drafts.push({
      id: "draft-1",
      partyId: "party-a",
      billId: "wo-7",
      ownerId: "p1",
      ownerName: "Ana",
      revision: 1,
      takenOverFrom: null,
      lines: [
        {
          id: "hake",
          sourceLineId: null,
          source: null,
          menuItemId: "menu-hake",
          menuVersionId: recorded ? "retired" : "v1",
          setMenuId: "daily",
          setMenuReservedLineId: null,
          setMenuReservedPlace: null,
          quantity: "1",
          variantId: null,
          courseId: null,
          slot: 0,
          joinGroupId: null,
          afterGroupId: null,
          note: null,
          options: [],
          extras: [],
          noMerge: false,
          unavailable: false,
        },
      ],
    });
    if (recorded) {
      const other = {
        ...drafts.drafts[0]!.lines[0]!,
        id: "lemonade",
        menuItemId: "offer-lemonade",
        menuVersionId: "v1",
        setMenuId: undefined,
        setMenuReservedLineId: undefined,
        setMenuReservedPlace: undefined,
      };
      drafts.drafts[0]!.lines.push(other);
    }
    const liveCopy = {
      ...copy,
      offers: recorded ? [] : [dish],
      versionIds: ["v1"],
      orderable: true,
      newestOnSale: true,
    };
    const dining = { ...DINING, setMenus: [liveCopy] };
    const stream = liveReadFixture();
    const { el } = await mountApp(
      tableStubs(dining, {
        listZoneOffers: vi.fn(async (zoneId: string) => (zoneId === "zone-dining" ? dining : V1)),
        getPartyBills: vi.fn().mockResolvedValue([bill]),
        submitDraft: vi.fn().mockRejectedValue({
          code: "product.unavailable",
          status: 409,
          productId: "Hake",
        }),
        readLiveEvents: stream.read,
      }),
    );
    await toTable(el);
    stream.event("ready");
    await flush(el);
    // The live menu poll cannot announce the availability of a dish it no longer offers.
    await poll(el);
    expect(roundStore(el).lines[0]).toMatchObject({ product: { name: "Hake", unitPrice: "5.00" } });
    expect(roundStore(el).lines[0]?.blocked).toBeUndefined();

    const showAvailability = async (available: boolean) => {
      if (recorded) {
        api.getPartyBills.mockResolvedValue([
          { ...bill, setMenuCopies: [{ ...copy, offers: [{ ...dish, available }] }] },
        ]);
        stream.event("change", JSON.stringify([{ type: "products" }]));
        await flush(el);
      } else {
        api.menuState.mockImplementation(async (zoneId: string) =>
          menuState(
            "v1",
            !available && zoneId === "zone-dining" ? { products: ["Hake"] } : NOTHING,
          ),
        );
      }
      await poll(el);
    };
    if (recorded) {
      pressSendAll(el);
      await flush(el);
      expect(api.submitDraft).toHaveBeenCalledOnce();
      expect(banner(el)?.textContent).toContain(codeMessage("product.unavailable"));
      let answerBills!: (bills: (typeof bill)[]) => void;
      api.getPartyBills.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerBills = resolve;
          }),
      );
      drafts.unavailable.add("offer-lemonade");
      stream.event("change", JSON.stringify([{ type: "bill_set_menu_copies" }]));
      await flush(el);
      expect(roundStore(el).lines[1]?.unavailableOnServer).toBe(true);
      answerBills([bill]);
      await flush(el);
      expect(roundStore(el).lines[1]?.unavailableOnServer).toBe(true);
    }

    await showAvailability(false);
    expect(roundStore(el).lines[0]?.blocked).toBe("unavailable");

    if (recorded) {
      api.menuState.mockImplementation(async (zoneId: string) =>
        menuState("v1", zoneId === "zone-dining" ? { products: ["Lemonade"] } : NOTHING),
      );
      await poll(el);
      expect(roundStore(el).lines[0]?.blocked).toBe("unavailable");
    }

    await showAvailability(true);
    expect(roundStore(el).lines[0]?.blocked).toBeUndefined();
    expect(dialog(el)).toBeNull();
  },
);
