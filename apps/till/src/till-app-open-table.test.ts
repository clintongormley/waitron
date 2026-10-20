import { answeredPartyAllergy } from "../test/answered-party-allergy.js";
import { deviceZonesFixture } from "../test/device-zones.js";
import { billOptions, billRow, listPage } from "../test/find-bill-fixtures.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupWidgets,
  draftServer,
  mountWidget,
  type DraftServer,
} from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import type { TillFloorScreen } from "./screens/till-floor-screen.js";
import type { FormFactor, CapabilityFlag } from "./layout.js";
import type {
  MenuStateAnswer,
  TableState,
  TableParty,
  TillApi,
  TillMenuOffer,
  ZoneOfferCatalogue,
} from "./api/client.js";
import { HOME_DISPLAY_DEFAULTS } from "@waitron/catalogue/src/device-home.js";
import { ServerRouter } from "./api/server-router.js";
import type { TillMenuBrowser } from "./widgets/menu-browser.js";
import { setLocale, t } from "./i18n/t.js";
import { DRAFT_SAVE_DELAY_MS } from "./state/draft-sync.js";

// Mesa 4 holds party v1, on tab wo-4, in zone z1, whose Lunch menu offers Beer, Steak and Flan.

const unit = {
  id: "unit-each",
  name: { es: "unidad", en: "unit" },
  abbreviation: { es: "ud", en: "ea" },
  precision: 0,
  hardwareUnit: null,
};

function offer(id: string, name: string, courseId: string | null = null): TillMenuOffer {
  return {
    id,
    menuId: "lunch",
    productId: `product-${id}`,
    grossPrice: null,
    unitPrice: "5.00",
    available: true,
    image: null,
    description: null,
    menuName: "Lunch",
    placements: [[]],
    name,
    customerName: null,
    kitchenName: null,
    unit,
    vatClass: "general",
    category: null,
    allergens: null,
    diet: null,
    dietDerivation: null,
    dietOverride: null,
    dietaryDeclarations: [],
    courseId,
    offeredModifiers: [],
    variants: [],
  } satisfies TillMenuOffer;
}

function catalogue(
  version: string,
  prices: Record<string, string> = {},
  liveFields = "lf-1",
): ZoneOfferCatalogue {
  const offers = [
    offer("offer-beer", "Beer", "drinks"),
    offer("offer-steak", "Steak", "mains"),
    offer("offer-flan", "Flan", "desserts"),
  ].map((each) => ({ ...each, unitPrice: prices[each.name] ?? each.unitPrice }));
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
      departmentName: "Restaurant",
      zoneId: "z1",
      departmentId: "department-bar",
      serviceMode: "table_tab",
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
    liveFields,
  };
}

function state(version: string, liveFields = "lf-1"): MenuStateAnswer {
  return {
    service: {
      open: true,
      zoneOpen: true,
      periodName: null,
      periodOccurrenceKey: null,
      keepOpen: null,
      zoneKeepOpen: null,
    },
    menus: [{ menuId: "lunch", versionId: version, orderable: true, sendable: true }],
    unavailable: { products: [], optionLabels: [] },
    defaultMenuId: "lunch",
    liveFields,
  };
}

const courses = [
  { id: "drinks", name: "Drinks", displayOrder: 0 },
  { id: "mains", name: "Mains", displayOrder: 1 },
  { id: "desserts", name: "Desserts", displayOrder: 2 },
];

function party(over: Partial<TableParty> = {}): TableParty {
  return {
    kitchenNote: {
      scope: { partyId: over.id ?? "v1" },
      note: null,
      revision: 0,
      ownerRevision: over.revision ?? 3,
    },
    id: "v1",
    revision: 3,
    guestCount: 2,
    state: "open",
    name: null,
    displayName: "4",
    mainBillId: "wo-4",
    outstanding: "0.00",
    billCount: 1,
    tableIds: ["t4"],
    unsentDrafts: [],
    reminder: null,
    ...over,
  };
}

function table(id: string, label: string, tableParty: TableParty | null): TableState {
  return {
    id,
    label,
    zoneId: "z1",
    state: tableParty === null ? "free" : "open-tab",
    condition: tableParty === null ? "free" : "held",
    hasOpenTab: tableParty !== null,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: null,
    signals: [],
    party: tableParty,
  };
}

const mesa4 = table("t4", "4", party());
const mesa7 = table(
  "t7",
  "7",
  party({ id: "v7", revision: 9, mainBillId: "wo-7", tableIds: ["t7"] }),
);

const mesa9 = {
  ...table("t9", "9", party({ id: "v9", mainBillId: "wo-9", tableIds: ["t9"] })),
  zoneId: "z2",
};

const drillFormFactor: FormFactor = "till";

function till(formFactor: FormFactor) {
  return {
    locale: "en",
    invoiceLocale: "es-ES",
    venueName: "Bar Pepe",
    nif: "B12345678",
    orderFlow: "prepay" as const,
    receiptPrintMode: "auto" as const,
    bumpMode: "line" as const,
    fireControl: "waiter" as const,
    courses,
    cardProvider: "none" as const,
    tipsEnabled: false,
    formFactor: formFactor,
    capabilities: ["print-receipt"] as CapabilityFlag[],
    inactivityTimeoutSeconds: null,
    nodeId: "n1",
    servers: [],
  };
}

let server: DraftServer;
let api: Record<string, ReturnType<typeof vi.fn>>;

function stubApi(overrides: Record<string, unknown> = {}) {
  for (const id of ["wo-7", "wo-9", "wo-new"]) server.bills.add(id);
  return {
    getDeviceZones: vi.fn().mockResolvedValue(deviceZonesFixture(undefined, ["z1"])),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "en",
      loginDefault: "en",
    }),
    getTill: vi.fn().mockResolvedValue(till(drillFormFactor)),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "till-dev",
      name: "Till 1",
      formFactor: "till",
    }),
    getDeviceStationScreen: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    listStaff: vi.fn().mockResolvedValue([]),
    listDefaultZoneOffers: vi.fn().mockResolvedValue({
      ...catalogue("v1"),
      context: { ...catalogue("v1").context, zoneId: "zc" },
    }),
    listZoneOffers: vi.fn().mockResolvedValue(catalogue("v1")),
    menuState: vi.fn(async () => state("v1")),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
    getTablesState: vi.fn().mockResolvedValue([mesa4, mesa7, mesa9]),
    listZones: vi
      .fn()
      .mockResolvedValue([
        { id: "z1", name: "Comedor", displayOrder: 0, active: true, serviceMode: "table_tab" },
      ]),
    getBillBalance: vi.fn(async (workingOrderId: string) => ({
      workingOrderId,
      status: "open",
      total: "3.00",
      received: "0.00",
      reserved: "0.00",
      outstanding: "3.00",
      tips: "0.00",
      payments: [],
      paidLines: [],
    })),
    getPartyBills: vi.fn().mockResolvedValue([]),
    getTabLines: vi.fn().mockResolvedValue({ lines: [], revision: 0, editSentLines: true }),
    listGroups: vi.fn().mockResolvedValue({ revision: 3, groups: [] }),
    listPrintProblems: vi.fn().mockResolvedValue({ problems: [] }),
    submitGroups: vi.fn().mockRejectedValue(new Error("the table no longer sends groups inline")),
    listDrafts: server.listDrafts,
    saveDraft: server.saveDraft,
    submitDraft: server.submitDraft,
    takeOverDraft: server.takeOverDraft,
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as Record<string, ReturnType<typeof vi.fn>>;
}

async function mountApp(
  overrides: Record<string, unknown> = {},
  sessionActivity?: TillApp["sessionActivity"],
  theme?: "light" | "dark",
) {
  api = stubApi(overrides);
  const mounted = await mountWidget<TillApp>(
    "till-app",
    {
      api: api as unknown as TillApi,
      ...(sessionActivity ? { sessionActivity } : {}),
    },
    theme,
  );
  Object.assign(api, answeredPartyAllergy(mounted.el));
  return mounted;
}

async function flush(el: TillApp, rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}

function emit(source: Element, type: string, detail?: unknown): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

const lock = (el: TillApp) => el.shadowRoot!.querySelector<TillLockScreen>("till-lock-screen")!;
const shell = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>("till-shell")!;
const cardGrid = (el: TillApp) => el;
const floor = (el: TillApp) =>
  cardGrid(el)?.shadowRoot?.querySelector<TillFloorScreen>("till-floor-screen") ?? null;
const tableOrder = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen") ??
  cardGrid(el)?.shadowRoot?.querySelector<TillTableOrderScreen>("till-table-order-screen") ??
  null;

async function signIn(el: TillApp, personId = "p1", displayName = "Ana"): Promise<void> {
  server.personId = personId;
  server.personName = displayName;
  emit(lock(el), "logged-in", { personId, displayName, permissions: [] });
  await flush(el);
}

async function openMesa(el: TillApp, tableId = "t4"): Promise<TillTableOrderScreen> {
  await flush(el);
  await signIn(el);
  emit(shell(el), "screen-select", { screen: "floor" });
  await flush(el);
  emit(floor(el)!, "open-table", { tableId, seated: true });
  await flush(el);
  return tableOrder(el)!;
}

async function back(el: TillApp): Promise<void> {
  tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>("[data-back]")!.click();
  await flush(el);
}

async function reopen(el: TillApp, tableId: string): Promise<TillTableOrderScreen> {
  emit(floor(el)!, "open-table", { tableId, seated: true });
  await flush(el);
  return tableOrder(el)!;
}

async function mountWithRouter(): Promise<{ el: TillApp; switchServer: () => Promise<void> }> {
  const data = new Map<string, string>();
  const router = new ServerRouter({
    origin: "https://box.deli.test",
    fetchImpl: vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch,
    storage: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) },
  });
  api = stubApi();
  const { el } = await mountWidget<TillApp>("till-app", {
    api: api as unknown as TillApi,
    router,
  });
  const switchServer = async () => {
    router.dispatchEvent(
      new CustomEvent("server-changed", {
        detail: { from: "https://box.deli.test", to: "https://cloud.deli.test" },
      }),
    );
    await flush(el);
  };
  return { el, switchServer };
}

describe("A768 a moved course or category is read again", () => {
  beforeEach(() => {
    server = draftServer();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupWidgets();
  });

  async function poll(el: TillApp): Promise<void> {
    vi.advanceTimersByTime(15_000);
    await flush(el);
  }

  const zoneReads = () =>
    api.listZoneOffers.mock.calls.filter(([zoneId]) => zoneId === "z1").length;

  it("an open table reads its offers again when a poll names new live fields", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    const before = zoneReads();
    const moved = catalogue("v1", {}, "lf-2");
    moved.offers = moved.offers.map((each) =>
      each.name === "Beer" ? { ...each, courseId: "mains" } : each,
    );
    api.listZoneOffers.mockResolvedValue(moved);
    api.menuState.mockImplementation(async () => state("v1", "lf-2"));
    await poll(el);
    expect(zoneReads()).toBe(before + 1);
    expect(tableOrder(el)!.products.find((p) => p.name === "Beer")!.courseId).toBe("mains");
  });

  it("an open table reads nothing more when a poll names the same live fields", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    const before = api.listZoneOffers.mock.calls.length;
    const checks = api.menuState.mock.calls.length;
    api.menuState.mockImplementation(async () => state("v1", "lf-1"));
    await poll(el);
    expect(api.menuState.mock.calls.slice(checks).map(([zoneId]) => zoneId)).toContain("z1");
    expect(api.listZoneOffers.mock.calls.length).toBe(before);
  });
});

describe("A768 a held zone's menu", () => {
  beforeEach(() => {
    server = draftServer();
  });

  afterEach(() => {
    cleanupWidgets();
  });

  const beer = (el: TillApp) => tableOrder(el)!.products.find((p) => p.name === "Beer");

  it("a second open of a table in a zone already read sends no offers read and one menu-state read", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await back(el);
    api.listZoneOffers.mockClear();
    api.menuState.mockClear();
    const screen = await reopen(el, "t7");
    expect(api.listZoneOffers).not.toHaveBeenCalled();
    expect(api.menuState).toHaveBeenCalledTimes(1);
    expect(api.menuState.mock.calls[0]![0]).toBe("z1");
    expect(screen.draftStore).toBeTruthy();
    expect(beer(el)).toBeDefined();
  });

  it("a menu published while the zone was off screen is read again when the table opens", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await back(el);
    api.listZoneOffers.mockClear();
    api.listZoneOffers.mockResolvedValue(catalogue("v2", { Beer: "6.00" }));
    api.menuState.mockImplementation(async () => state("v2"));
    await reopen(el, "t7");
    await flush(el);
    expect(api.listZoneOffers).toHaveBeenCalledTimes(1);
    expect(beer(el)!.unitPrice).toBe("6.00");
  });

  it("a table in a zone not yet read reads its offers", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await back(el);
    api.listZoneOffers.mockClear();
    await reopen(el, "t9");
    expect(api.listZoneOffers).toHaveBeenCalledWith("z2");
  });

  it("a server switch forgets every held menu", async () => {
    const { el, switchServer } = await mountWithRouter();
    await openMesa(el);
    await back(el);
    await switchServer();
    api.listZoneOffers.mockClear();
    await openMesa(el, "t7");
    expect(api.listZoneOffers).toHaveBeenCalledWith("z1");
  });

  it("a server switch forgets a menu the old server answers after it", async () => {
    const { el, switchServer } = await mountWithRouter();
    await flush(el);
    await signIn(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    let answerOld!: (value: ZoneOfferCatalogue) => void;
    api.listZoneOffers.mockImplementationOnce(
      () => new Promise<ZoneOfferCatalogue>((resolve) => (answerOld = resolve)),
    );
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    await switchServer();
    answerOld(catalogue("v1", { Beer: "9.99" }));
    await flush(el);
    api.listZoneOffers.mockClear();
    await openMesa(el, "t7");
    expect(api.listZoneOffers).toHaveBeenCalledWith("z1");
    expect(beer(el)!.unitPrice).toBe("5.00");
  });

  it("a new api forgets every held menu", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await back(el);
    const next = stubApi();
    el.api = next as unknown as TillApi;
    await flush(el);
    await reopen(el, "t7");
    expect(next.listZoneOffers).toHaveBeenCalledWith("z1");
  });
});

describe("A768 a held zone's menu follows the server", () => {
  beforeEach(() => {
    server = draftServer();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupWidgets();
  });

  async function poll(el: TillApp): Promise<void> {
    vi.advanceTimersByTime(15_000);
    await flush(el);
  }

  function later<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => (resolve = done));
    return { promise, resolve };
  }

  const beer = (el: TillApp) => tableOrder(el)!.products.find((p) => p.name === "Beer");

  function twoMenus(defaultMenuId: string): ZoneOfferCatalogue {
    const base = catalogue("v1");
    const lunch = base.menus[0]!;
    return {
      ...base,
      defaultMenuId,
      menus: [
        { ...lunch, isDefault: defaultMenuId === "lunch" },
        { ...lunch, id: "dinner", name: "Dinner", isDefault: defaultMenuId === "dinner" },
      ],
    };
  }

  function twoMenuState(defaultMenuId: string): MenuStateAnswer {
    const base = state("v1");
    return {
      ...base,
      defaultMenuId,
      menus: [
        ...base.menus,
        { menuId: "dinner", versionId: "v1", orderable: true, sendable: true },
      ],
    };
  }

  it("a default menu changed while the zone was off screen is selected when the table opens again", async () => {
    const { el } = await mountApp({
      listZoneOffers: vi.fn().mockResolvedValue(twoMenus("lunch")),
      menuState: vi.fn(async () => twoMenuState("lunch")),
    });
    await openMesa(el);
    expect(tableOrder(el)!.selectedMenuId).toBe("lunch");
    await back(el);
    api.menuState.mockImplementation(async () => twoMenuState("dinner"));
    await reopen(el, "t7");
    await poll(el);
    expect(tableOrder(el)!.selectedMenuId).toBe("dinner");
  });

  it("a check for the table just left loads nothing into the next table while it opens", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await back(el);
    const check = later<MenuStateAnswer>();
    api.menuState.mockImplementationOnce(() => check.promise);
    await reopen(el, "t7");
    await back(el);
    const z2 = later<ZoneOfferCatalogue>();
    api.listZoneOffers.mockClear();
    api.listZoneOffers.mockImplementation((zoneId: string) =>
      zoneId === "z2" ? z2.promise : Promise.resolve(catalogue("v2", { Beer: "6.00" })),
    );
    emit(floor(el)!, "open-table", { tableId: "t9", seated: true });
    await flush(el);
    check.resolve(state("v2"));
    await flush(el);
    expect(api.listZoneOffers.mock.calls.map(([zoneId]) => zoneId)).toEqual(["z2"]);
    z2.resolve({
      ...catalogue("v1", { Beer: "8.00" }),
      context: { ...catalogue("v1").context, zoneId: "z2" },
    });
    await flush(el);
    expect(beer(el)!.unitPrice).toBe("8.00");
  });

  it("a poll after both held opens' checks have answered keeps the menu the table shows", async () => {
    const { el } = await mountApp({
      listZoneOffers: vi.fn().mockResolvedValue(twoMenus("lunch")),
      menuState: vi.fn(async () => twoMenuState("lunch")),
    });
    await openMesa(el);
    await back(el);
    const first = later<MenuStateAnswer>();
    const second = later<MenuStateAnswer>();
    api.menuState.mockImplementationOnce(() => first.promise);
    api.menuState.mockImplementationOnce(() => second.promise);
    await reopen(el, "t7");
    await back(el);
    await reopen(el, "t4");
    first.resolve(twoMenuState("lunch"));
    await flush(el);
    second.resolve(twoMenuState("lunch"));
    await flush(el);
    api.menuState.mockImplementation(async () => twoMenuState("dinner"));
    await poll(el);
    expect(tableOrder(el)!.selectedMenuId).toBe("lunch");
  });

  it("an older menu read answering after a newer one does not replace it", async () => {
    const { el } = await mountApp();
    await flush(el);
    await signIn(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    const older = later<ZoneOfferCatalogue>();
    const newer = later<ZoneOfferCatalogue>();
    api.listZoneOffers.mockImplementationOnce(() => older.promise);
    api.listZoneOffers.mockImplementationOnce(() => newer.promise);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
    await flush(el);
    newer.resolve(catalogue("v1", { Beer: "7.00" }));
    await flush(el);
    older.resolve(catalogue("v1", { Beer: "6.00" }));
    await flush(el);
    expect(beer(el)!.unitPrice).toBe("7.00");
    await back(el);
    api.listZoneOffers.mockClear();
    await reopen(el, "t4");
    expect(api.listZoneOffers).not.toHaveBeenCalled();
    expect(beer(el)!.unitPrice).toBe("7.00");
  });
});

describe("A768 the left draft saves in the background", () => {
  beforeEach(() => {
    setLocale("en");
    server = draftServer();
  });

  afterEach(() => {
    cleanupWidgets();
  });

  const banner = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>(".error");
  const rows = (el: TillApp) =>
    tableOrder(el)!.draftStore?.lines.map((line) => `${line.product.name} ×${line.quantity}`) ??
    null;
  const savedLines = () =>
    server.drafts.flatMap((each) =>
      each.lines.map((line) => `${line.menuItemId} ×${Number(line.quantity)}`),
    );

  async function tap(el: TillApp, name: string): Promise<void> {
    [
      ...tableOrder(el)!
        .shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!
        .shadowRoot!.querySelectorAll<HTMLElement>("wt-button"),
    ]
      .find((button) => button.querySelector(".name")?.textContent === name)!
      .click();
    await flush(el);
  }

  /** Holds the next save until the returned function is called, then saves it as the person who
   * sent it, or fails it with `error`. */
  function holdNextSave(): (error?: unknown) => void {
    let answer!: (error?: unknown) => void;
    const held = new Promise<unknown>((resolve) => (answer = resolve));
    server.saveDraft.mockImplementationOnce(async (partyId, save) => {
      const sentBy = server.personId;
      const error = await held;
      if (error !== undefined) throw error;
      const now = server.personId;
      server.personId = sentBy;
      const saved = server.save(partyId, save);
      server.personId = now;
      return server.snapshot(saved);
    });
    return answer;
  }

  it("another party's table shows its order before the left draft's save answers", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    const release = holdNextSave();
    await back(el);
    await reopen(el, "t7");
    expect(tableOrder(el)!.draftStore).not.toBeNull();
    expect(tableOrder(el)!.party?.id).toBe("v7");
    release();
    await flush(el);
    expect(savedLines()).toContain("offer-beer ×1");
  });

  /** Opens Mesa 7 from Mesa 4's order screen, so the save of Mesa 4's draft is the release's own. */
  async function moveToMesa7(el: TillApp): Promise<void> {
    emit(tableOrder(el)!, "open-table", { tableId: "t7", seated: true });
    await flush(el);
  }

  it("a background save that fails is said on the next table", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    const release = holdNextSave();
    await moveToMesa7(el);
    expect(tableOrder(el)!.party?.id).toBe("v7");
    expect(banner(el)).toBeNull();
    release(new TypeError("Failed to fetch"));
    await flush(el);
    expect(tableOrder(el)!.party?.id).toBe("v7");
    expect(banner(el)!.textContent).toContain(t("table.draft_save_failed"));
  });

  it("reopening a failed left draft reads the saved bill before offering its local candidate", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    const release = holdNextSave();
    await moveToMesa7(el);
    release(new TypeError("Failed to fetch"));
    await flush(el, 6);
    await back(el);
    const reads = api.listDrafts.mock.calls.length;
    const saves = api.saveDraft.mock.calls.length;
    await reopen(el, "t4");
    await flush(el, 6);
    expect(api.listDrafts.mock.calls.slice(reads).map(([id]) => id)).toContain("v1");
    expect(rows(el)).toEqual([]);
    expect(
      tableOrder(el)!.retainedDraft?.lines.map((line) => `${line.product.name} ×${line.quantity}`),
    ).toEqual(["Beer ×1"]);
    expect(api.saveDraft.mock.calls.length).toBe(saves);
    expect(savedLines()).toEqual([]);
  });

  it("a background save refused for another reason says it on the next table", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    const release = holdNextSave();
    await moveToMesa7(el);
    release({ code: "draft.taken_over", status: 409, ownerName: "Bea" });
    await flush(el);
    expect(tableOrder(el)!.party?.id).toBe("v7");
    expect(banner(el)!.textContent).toContain("Bea");
  });

  it("a background save refused for an ended session says nothing", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    const release = holdNextSave();
    await moveToMesa7(el);
    release({ code: "session.required", status: 401 });
    await flush(el);
    expect(tableOrder(el)!.party?.id).toBe("v7");
    expect(banner(el)).toBeNull();
  });

  it("signing out fences unsent local edits while an earlier background save completes", async () => {
    const savedBy: string[] = [];
    const { el } = await mountApp({
      saveDraft: vi.fn(async (...args: Parameters<DraftServer["saveDraft"]>) => {
        savedBy.push(server.personId);
        return server.saveDraft(...args);
      }),
    });
    await openMesa(el);
    await tap(el, "Beer");
    const release = holdNextSave();
    await back(el);
    await reopen(el, "t7");
    expect(tableOrder(el)!.party?.id).toBe("v7");
    await tap(el, "Steak");
    emit(shell(el), "logout");
    await flush(el);
    expect(api.logout).not.toHaveBeenCalled();
    release();
    await flush(el);
    expect(api.logout).toHaveBeenCalledOnce();
    await signIn(el, "p2", "Bea");
    await flush(el);
    expect(savedBy).not.toContain("p2");
    expect(savedLines()).toEqual(["offer-beer ×1"]);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    await reopen(el, "t7");
    expect(tableOrder(el)!.retainedDraft).toBeNull();
    expect(rows(el)).toEqual([]);
    emit(shell(el), "logout");
    await flush(el, 6);
    await signIn(el, "p1", "Ana");
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    await reopen(el, "t7");
    expect(rows(el)).toEqual([]);
    expect(tableOrder(el)!.retainedDraft?.lines.map((line) => line.product.name)).toEqual([
      "Steak",
    ]);
    expect(savedBy).not.toContain("p2");
  });

  it("the same party's table still waits for its own save", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    const release = holdNextSave();
    await back(el);
    await reopen(el, "t4");
    expect(tableOrder(el)?.draftStore ?? null).toBeNull();
    release();
    await flush(el);
    expect(rows(el)).toEqual(["Beer ×1"]);
  });

  it("A, B, then A again waits for A's own save", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    const release = holdNextSave();
    await back(el);
    await reopen(el, "t7");
    await back(el);
    const reads = api.listDrafts.mock.calls.length;
    await reopen(el, "t4");
    expect(tableOrder(el)?.draftStore ?? null).toBeNull();
    expect(api.listDrafts.mock.calls.slice(reads).map(([partyId]) => partyId)).not.toContain("v1");
    release();
    await flush(el);
    expect(rows(el)).toEqual(["Beer ×1"]);
    await tap(el, "Steak");
    await back(el);
    expect(banner(el)).toBeNull();
    expect(savedLines()).toEqual(["offer-beer ×1", "offer-steak ×1"]);
  });

  it("a server switch lets go of a left draft's save sent to the old server", async () => {
    const { el, switchServer } = await mountWithRouter();
    await openMesa(el);
    await tap(el, "Beer");
    holdNextSave();
    await moveToMesa7(el);
    await switchServer();
    await openMesa(el, "t4");
    expect(tableOrder(el)?.party?.id).toBe("v1");
    expect(rows(el)).toEqual([]);
  });

  it("a background save that fails leaves the next table's own error showing", async () => {
    const { el } = await mountApp({
      listDrafts: vi.fn(async (...args: Parameters<DraftServer["listDrafts"]>) => {
        if (args[0] === "v7") throw new TypeError("Failed to fetch");
        return server.listDrafts(...args);
      }),
    });
    await openMesa(el);
    await tap(el, "Beer");
    const release = holdNextSave();
    await moveToMesa7(el);
    expect(banner(el)!.textContent).toContain(t("table.draft_read_failed"));
    release(new TypeError("Failed to fetch"));
    await flush(el);
    expect(banner(el)!.textContent).toContain(t("table.draft_read_failed"));
  });

  it("signing in again resumes the left party's draft only once its save answers", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    const release = holdNextSave();
    await moveToMesa7(el);
    await back(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    emit(shell(el), "logout");
    await flush(el);
    const reads = api.listDrafts.mock.calls.length;
    await signIn(el);
    expect(api.listDrafts.mock.calls.slice(reads).map(([partyId]) => partyId)).not.toContain("v1");
    release();
    await flush(el, 6);
    expect(api.listDrafts.mock.calls.slice(reads).map(([partyId]) => partyId)).toContain("v1");
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    await reopen(el, "t4");
    expect(rows(el)).toEqual(["Beer ×1"]);
  });

  it("a failed left draft is reviewed separately before the same person explicitly saves it", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    const release = holdNextSave();
    await moveToMesa7(el);
    expect(tableOrder(el)!.party?.id).toBe("v7");
    release(new TypeError("Failed to fetch"));
    await flush(el, 6);
    expect(banner(el)!.textContent).toContain(t("table.draft_save_failed"));
    await back(el);
    await reopen(el, "t4");
    await flush(el, 6);
    expect(rows(el)).toEqual([]);
    expect(savedLines()).toEqual([]);
    expect(tableOrder(el)!.retainedDraft?.lines.map((line) => line.product.name)).toEqual(["Beer"]);
    expect(api.saveDraft).toHaveBeenCalledOnce();
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>("[data-candidate-apply]")!.click();
    await flush(el, 6);
    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(savedLines()).toEqual([]);
    await back(el);
    expect(savedLines()).toEqual(["offer-beer ×1"]);
  });

  it("a left draft whose save and the next table's menu both failed is shown when its table opens again", async () => {
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([mesa4, { ...mesa7, zoneId: "z2" }, mesa9]),
      listZoneOffers: vi
        .fn()
        .mockResolvedValueOnce(catalogue("v1"))
        .mockRejectedValueOnce(new TypeError("Failed to fetch menu"))
        .mockResolvedValue(catalogue("v1")),
    });
    await openMesa(el);
    await tap(el, "Beer");
    const release = holdNextSave();
    await moveToMesa7(el);
    release(new TypeError("Failed to fetch save"));
    await flush(el, 6);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el, 6);
    await reopen(el, "t4");
    await flush(el, 6);
    expect(rows(el)).toEqual([]);
    expect(tableOrder(el)!.retainedDraft?.lines.map((line) => line.product.name)).toEqual(["Beer"]);
    expect(api.saveDraft).toHaveBeenCalledOnce();
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>("[data-candidate-apply]")!.click();
    await flush(el, 6);
    expect(rows(el)).toEqual(["Beer ×1"]);
    await back(el);
    expect(savedLines()).toEqual(["offer-beer ×1"]);
  });

  it("a left draft whose background save was refused is read afresh when its table opens again", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    const release = holdNextSave();
    await moveToMesa7(el);
    release({ code: "product.not_sold_separately", status: 409 });
    await flush(el, 6);
    await back(el);
    await reopen(el, "t4");
    await flush(el, 6);
    expect(rows(el)).toEqual([]);
  });

  it("signing out retains an unanswered left draft privately without sending another save", async () => {
    const savedBy: string[] = [];
    const calls: string[] = [];
    const { el } = await mountApp({
      saveDraft: vi.fn(async (...args: Parameters<DraftServer["saveDraft"]>) => {
        savedBy.push(server.personId);
        calls.push("save");
        return server.saveDraft(...args);
      }),
      logout: vi.fn(async () => void calls.push("logout")),
    });
    await openMesa(el);
    await tap(el, "Beer");
    const release = holdNextSave();
    await moveToMesa7(el);
    release(new TypeError("Failed to fetch"));
    await flush(el, 6);
    calls.length = 0;
    emit(shell(el), "logout");
    await flush(el, 6);
    expect(calls).toEqual(["logout"]);
    expect(savedLines()).toEqual([]);
    await signIn(el, "p2", "Bea");
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    await reopen(el, "t4");
    await flush(el, 6);
    expect(rows(el)).toEqual([]);
    expect(savedBy).not.toContain("p2");
    expect(tableOrder(el)!.retainedDraft).toBeNull();
    emit(shell(el), "logout");
    await flush(el, 6);
    await signIn(el, "p1", "Ana");
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    await reopen(el, "t4");
    expect(rows(el)).toEqual([]);
    expect(tableOrder(el)!.retainedDraft?.lines.map((line) => line.product.name)).toEqual(["Beer"]);
    expect(savedBy).toEqual(["p1"]);
    expect(savedLines()).toEqual([]);
  });

  /** Records who each save was sent as, the held one included. */
  function mountRecordingSaves(): { savedBy: string[]; mounted: ReturnType<typeof mountApp> } {
    const savedBy: string[] = [];
    const mounted = mountApp({
      saveDraft: vi.fn(async (...args: Parameters<DraftServer["saveDraft"]>) => {
        savedBy.push(server.personId);
        return server.saveDraft(...args);
      }),
    });
    return { savedBy, mounted };
  }

  /** The device is refused and the till starts again on the lock screen, with no sign-out. */
  async function restartWithoutSignOut(el: TillApp): Promise<void> {
    emit(shell(el), "device-unauthorized");
    await flush(el, 6);
    expect(lock(el)).not.toBeNull();
  }

  it("after a restart with no sign-out, the next person never sees or saves the order kept for the one before", async () => {
    const { savedBy, mounted } = mountRecordingSaves();
    const { el } = await mounted;
    await openMesa(el);
    await tap(el, "Beer");
    const release = holdNextSave();
    await moveToMesa7(el);
    release(new TypeError("Failed to fetch"));
    await flush(el, 6);
    await restartWithoutSignOut(el);
    await signIn(el, "p2", "Bea");
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    await reopen(el, "t4");
    await flush(el, 6);
    expect(rows(el)).toEqual([]);
    expect(savedBy).toEqual(["p1"]);
  });

  it("after a restart with no sign-out, the next person's sign-out does not send the order kept for the one before", async () => {
    const { savedBy, mounted } = mountRecordingSaves();
    const { el } = await mounted;
    await openMesa(el);
    await tap(el, "Beer");
    const release = holdNextSave();
    await moveToMesa7(el);
    release(new TypeError("Failed to fetch"));
    await flush(el, 6);
    await restartWithoutSignOut(el);
    await signIn(el, "p2", "Bea");
    emit(shell(el), "logout");
    await flush(el, 6);
    expect(api.logout).toHaveBeenCalledOnce();
    expect(savedBy).toEqual(["p1"]);
  });

  it("after a restart with no sign-out, a left order whose save fails once the next person is in is not theirs", async () => {
    const { savedBy, mounted } = mountRecordingSaves();
    const { el } = await mounted;
    await openMesa(el);
    await tap(el, "Beer");
    const release = holdNextSave();
    await moveToMesa7(el);
    await restartWithoutSignOut(el);
    await signIn(el, "p2", "Bea");
    release(new TypeError("Failed to fetch"));
    await flush(el, 6);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    await reopen(el, "t4");
    await flush(el, 6);
    expect(rows(el)).toEqual([]);
    emit(shell(el), "logout");
    await flush(el, 6);
    expect(savedBy).toEqual(["p1"]);
  });

  it("after a restart with no sign-out, its author reviews a kept candidate before saving again", async () => {
    const { savedBy, mounted } = mountRecordingSaves();
    const { el } = await mounted;
    await openMesa(el);
    await tap(el, "Beer");
    const release = holdNextSave();
    await moveToMesa7(el);
    release(new TypeError("Failed to fetch"));
    await flush(el, 6);
    await restartWithoutSignOut(el);
    await signIn(el, "p1", "Ana");
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    await reopen(el, "t4");
    await flush(el, 6);
    expect(rows(el)).toEqual([]);
    expect(tableOrder(el)!.retainedDraft?.lines.map((line) => line.product.name)).toEqual(["Beer"]);
    expect(savedBy).toEqual(["p1"]);
    expect(savedLines()).toEqual([]);
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>("[data-candidate-apply]")!.click();
    await flush(el, 6);
    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(savedBy).toEqual(["p1"]);
    await back(el);
    expect(savedBy).toEqual(["p1", "p1"]);
    expect(savedLines()).toEqual(["offer-beer ×1"]);
  });

  /** Holds the next sign-in's zone read until the returned function is called. */
  function holdNextZones(): () => void {
    let answer!: () => void;
    api.getDeviceZones!.mockImplementationOnce(
      () =>
        new Promise((resolve) => (answer = () => resolve(deviceZonesFixture(undefined, ["z1"])))),
    );
    return () => answer();
  }

  it("after a restart with no sign-out, a reopen waiting on a left order's save does not save it as the next person while their sign-in loads", async () => {
    const { savedBy, mounted } = mountRecordingSaves();
    const { el } = await mounted;
    await openMesa(el);
    await tap(el, "Beer");
    const release = holdNextSave();
    await moveToMesa7(el);
    await back(el);
    await reopen(el, "t4");
    await restartWithoutSignOut(el);
    const zones = holdNextZones();
    await signIn(el, "p2", "Bea");
    release(new TypeError("Failed to fetch"));
    await flush(el, 6);
    zones();
    await flush(el, 6);
    expect(savedBy).toEqual(["p1"]);
    expect(server.drafts).toEqual([]);
  });

  it("after a restart with no sign-out, a left order's save queued behind one still out is not sent as the next person", async () => {
    const { savedBy, mounted } = mountRecordingSaves();
    const { el } = await mounted;
    await openMesa(el);
    const release = holdNextSave();
    await tap(el, "Beer");
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    await tap(el, "Beer");
    await moveToMesa7(el);
    await restartWithoutSignOut(el);
    await signIn(el, "p2", "Bea");
    await flush(el, 6);
    release(new TypeError("Failed to fetch"));
    await flush(el, 6);
    expect(savedBy).toEqual(["p1"]);
    expect(server.drafts).toEqual([]);
    expect(banner(el)).toBeNull();
  });

  it("after a restart with no sign-out, the order on screen is not saved as the next person while their sign-in loads", async () => {
    const { savedBy, mounted } = mountRecordingSaves();
    const { el } = await mounted;
    await openMesa(el);
    const release = holdNextSave();
    await tap(el, "Beer");
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    await tap(el, "Beer");
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    await restartWithoutSignOut(el);
    const zones = holdNextZones();
    await signIn(el, "p2", "Bea");
    release(new TypeError("Failed to fetch"));
    await flush(el, 6);
    zones();
    await flush(el, 6);
    expect(savedBy).toEqual(["p1"]);
    expect(server.drafts).toEqual([]);
  });

  it("after a restart with no sign-out, an order kept for the one before is not saved as the next person by a reopen still reading its bills", async () => {
    const savedBy: string[] = [];
    const bills = [
      {
        workingOrderId: "wo-4",
        partyId: "v1",
        status: "open",
        revision: 0,
        invoiceType: "F2",
        recipient: null,
        label: null,
        total: "0.00",
        outstanding: "0.00",
        hasPayments: false,
        receiptAvailable: false,
      },
    ];
    const { el } = await mountApp({
      getTablesState: vi
        .fn()
        .mockResolvedValue([table("t4", "4", party({ mainBillId: null })), mesa7, mesa9]),
      getPartyBills: vi.fn().mockResolvedValue(bills),
      saveDraft: vi.fn(async (...args: Parameters<DraftServer["saveDraft"]>) => {
        savedBy.push(server.personId);
        return server.saveDraft(...args);
      }),
    });
    await openMesa(el);
    await tap(el, "Beer");
    const release = holdNextSave();
    await moveToMesa7(el);
    release(new TypeError("Failed to fetch"));
    await flush(el, 6);
    await back(el);
    let answerBills!: () => void;
    api.getPartyBills!.mockImplementationOnce(
      () => new Promise((resolve) => (answerBills = () => resolve(bills))),
    );
    await reopen(el, "t4");
    await restartWithoutSignOut(el);
    const zones = holdNextZones();
    await signIn(el, "p2", "Bea");
    answerBills();
    await flush(el, 6);
    zones();
    await flush(el, 6);
    expect(savedBy).toEqual(["p1"]);
    expect(server.drafts).toEqual([]);
  });

  it("after a restart with no sign-out, the next person is not left loading a table behind a left order's save that never answers", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    holdNextSave();
    await moveToMesa7(el);
    await back(el);
    await reopen(el, "t4");
    expect(tableOrder(el)?.draftStore ?? null).toBeNull();
    await restartWithoutSignOut(el);
    await signIn(el, "p2", "Bea");
    await flush(el, 6);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    await reopen(el, "t4");
    await flush(el, 6);
    expect(tableOrder(el)!.party?.id).toBe("v1");
    expect(rows(el)).toEqual([]);
  });

  /** Mesa 9 free, its seating held until `seat` is called, and who each save was sent as. */
  function mountHeldSeating(): {
    savedBy: string[];
    seat: () => void;
    mounted: ReturnType<typeof mountApp>;
  } {
    const savedBy: string[] = [];
    const free = table("t9", "9", null);
    const seated = table(
      "t9",
      "9",
      party({ id: "v-new", revision: 0, mainBillId: "wo-new", tableIds: ["t9"] }),
    );
    let answer!: () => void;
    const held = new Promise<void>((resolve) => (answer = resolve));
    const mounted = mountApp({
      getTablesState: vi.fn().mockResolvedValue([mesa4, mesa7, free]),
      seatTable: vi.fn(async () => {
        await held;
        vi.mocked(api.getTablesState).mockResolvedValue([mesa4, mesa7, seated]);
        return { partyId: "v-new", tabId: "wo-new", revision: 0, orderNumber: 12 };
      }),
      saveDraft: vi.fn(async (...args: Parameters<DraftServer["saveDraft"]>) => {
        savedBy.push(server.personId);
        return server.saveDraft(...args);
      }),
    });
    return { savedBy, seat: () => answer(), mounted };
  }

  async function seatMesa9WithBeer(el: TillApp): Promise<void> {
    await openMesa(el, "t9");
    await tap(el, "Beer");
    emit(tableOrder(el)!, "open-table", { tableId: "t9", seated: false, guestCount: 2 });
    await flush(el);
    expect(api.seatTable).toHaveBeenCalledOnce();
  }

  const pastSaveDelay = () =>
    new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
  const beersOwnedBy = (personId: string) =>
    server.drafts
      .filter((draft) => draft.ownerId === personId)
      .flatMap((draft) => draft.lines.map((line) => line.menuItemId));

  it("after a restart with no sign-out, lines carried to a table whose seating answers once the next person is in are not saved as them", async () => {
    const { savedBy, seat, mounted } = mountHeldSeating();
    const { el } = await mounted;
    await seatMesa9WithBeer(el);
    await restartWithoutSignOut(el);
    await signIn(el, "p2", "Bea");
    await flush(el, 6);
    seat();
    await flush(el, 6);
    await pastSaveDelay();
    await flush(el, 6);
    expect(savedBy).not.toContain("p2");
    expect(beersOwnedBy("p2")).not.toContain("offer-beer");
  });

  it("after a restart with no sign-out, lines carried to a table whose seating answers while the next person's sign-in loads are not saved as them", async () => {
    const { savedBy, seat, mounted } = mountHeldSeating();
    const { el } = await mounted;
    await seatMesa9WithBeer(el);
    await restartWithoutSignOut(el);
    const zones = holdNextZones();
    await signIn(el, "p2", "Bea");
    seat();
    await flush(el, 6);
    await pastSaveDelay();
    await flush(el, 6);
    zones();
    await flush(el, 6);
    await pastSaveDelay();
    await flush(el, 6);
    expect(savedBy).not.toContain("p2");
    expect(beersOwnedBy("p2")).not.toContain("offer-beer");
  });

  it("after a restart with no sign-out, lines carried to a table whose seating answers once the same person is back in are saved as them", async () => {
    const { savedBy, seat, mounted } = mountHeldSeating();
    const { el } = await mounted;
    await seatMesa9WithBeer(el);
    await restartWithoutSignOut(el);
    await signIn(el, "p1", "Ana");
    await flush(el, 6);
    seat();
    await flush(el, 6);
    await pastSaveDelay();
    await flush(el, 6);
    expect(savedBy).toEqual(["p1"]);
    expect(beersOwnedBy("p1")).toEqual(["offer-beer"]);
  });

  it("a server switch lets go of a left draft whose background save got no answer", async () => {
    const { el, switchServer } = await mountWithRouter();
    await openMesa(el);
    await tap(el, "Beer");
    const release = holdNextSave();
    await moveToMesa7(el);
    release(new TypeError("Failed to fetch"));
    await flush(el, 6);
    await switchServer();
    const saves = api.saveDraft.mock.calls.length;
    await openMesa(el, "t4");
    await flush(el, 6);
    expect(tableOrder(el)?.party?.id).toBe("v1");
    expect(rows(el)).toEqual([]);
    expect(api.saveDraft.mock.calls.length).toBe(saves);
  });

  it("leaving while a move waits for a background save never reads or moves the abandoned destination", async () => {
    const { el } = await mountApp({
      moveGuests: vi.fn().mockResolvedValue({ partyId: "v1", mainBillId: "wo-4", merged: true }),
    });
    await openMesa(el);
    await tap(el, "Beer");
    const release = holdNextSave();
    await moveToMesa7(el);
    emit(tableOrder(el)!, "move-guests", { toTableId: "t4", bills: "merge" });
    await flush(el, 6);
    await back(el);
    await reopen(el, "t9");
    expect(tableOrder(el)!.party?.id).toBe("v9");
    const reads = api.listDrafts.mock.calls.length;
    release();
    await flush(el, 6);
    expect(api.listDrafts.mock.calls.slice(reads).map(([partyId]) => partyId)).not.toContain("v1");
    expect(api.moveGuests).not.toHaveBeenCalled();
    expect(tableOrder(el)!.party?.id).toBe("v9");
    expect(rows(el)).toEqual([]);
    expect(savedLines()).toEqual(["offer-beer ×1"]);
  });

  it("moving guests onto the table just left waits for its own save", async () => {
    const { el } = await mountApp({
      moveGuests: vi.fn().mockResolvedValue({ partyId: "v1", mainBillId: "wo-4", merged: true }),
    });
    await openMesa(el);
    await tap(el, "Beer");
    const release = holdNextSave();
    await moveToMesa7(el);
    expect(tableOrder(el)!.party?.id).toBe("v7");
    api.getTablesState.mockResolvedValue([
      table("t4", "4", party({ revision: 4, tableIds: ["t4", "t7"] })),
      table("t7", "7", party({ revision: 4, tableIds: ["t4", "t7"] })),
      mesa9,
    ]);
    const reads = api.listDrafts.mock.calls.length;
    emit(tableOrder(el)!, "move-guests", { toTableId: "t4", bills: "merge" });
    await flush(el, 6);
    expect(api.moveGuests).not.toHaveBeenCalled();
    expect(tableOrder(el)!.party?.id).toBe("v7");
    expect(api.listDrafts.mock.calls.slice(reads).map(([partyId]) => partyId)).not.toContain("v1");
    release();
    await flush(el, 6);
    expect(api.moveGuests).toHaveBeenCalledOnce();
    expect(tableOrder(el)!.party?.id).toBe("v1");
    expect(rows(el)).toEqual(["Beer ×1"]);
    await tap(el, "Steak");
    await back(el);
    expect(banner(el)).toBeNull();
    expect(savedLines()).toEqual(["offer-beer ×1", "offer-steak ×1"]);
  });
});

describe("A768 the order screen shows at once", () => {
  beforeEach(() => {
    setLocale("en");
    server = draftServer();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanupWidgets();
  });

  const banner = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>(".error");
  const loadingLine = (el: TillApp) =>
    tableOrder(el)?.shadowRoot?.querySelector<HTMLElement>("[data-loading]") ?? null;
  const opening = (el: TillApp) => (el as unknown as { tableOpening: boolean }).tableOpening;
  const orderTabFormFactor: FormFactor = "tablet-landscape";

  function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => (resolve = done));
    return { promise, resolve };
  }

  const savedBeers = () =>
    server.drafts.flatMap((each) =>
      each.lines.map((line) => `${line.menuItemId} ×${Number(line.quantity)}`),
    );

  async function onFloor(el: TillApp): Promise<void> {
    await flush(el);
    await signIn(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
  }

  async function tap(el: TillApp, name: string): Promise<void> {
    [
      ...tableOrder(el)!
        .shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!
        .shadowRoot!.querySelectorAll<HTMLElement>("wt-button"),
    ]
      .find((button) => button.querySelector(".name")?.textContent === name)!
      .click();
    await flush(el);
  }

  function holdNextSave(): () => void {
    let answer!: () => void;
    const held = new Promise<void>((resolve) => (answer = resolve));
    server.saveDraft.mockImplementationOnce(async (partyId, save) => {
      const sentBy = server.personId;
      await held;
      const now = server.personId;
      server.personId = sentBy;
      const saved = server.save(partyId, save);
      server.personId = now;
      return server.snapshot(saved);
    });
    return answer;
  }

  const orderPushes = () =>
    vi
      .mocked(history.pushState)
      .mock.calls.filter(([, , url]) => String(url).includes("/tabs/order"));
  const orderReplaces = () =>
    vi
      .mocked(history.replaceState)
      .mock.calls.filter(([, , url]) => String(url).includes("/tabs/order"));

  it("the order screen shows with its loading line before the table's reads answer", async () => {
    const lines = deferred<{ lines: never[]; revision: number; editSentLines: boolean }>();
    const drafts = deferred<void>();
    const { el } = await mountApp({
      getTabLines: vi.fn(() => lines.promise),
      listDrafts: vi.fn(async (...args: Parameters<DraftServer["listDrafts"]>) => {
        await drafts.promise;
        return server.listDrafts(...args);
      }),
    });
    await onFloor(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el, 1);
    expect(tableOrder(el)!.loading).toBe(true);
    expect(loadingLine(el)).not.toBeNull();
    lines.resolve({ lines: [], revision: 0, editSentLines: true });
    drafts.resolve();
    await flush(el);
    expect(tableOrder(el)!.loading).toBe(false);
    expect(tableOrder(el)!.draftStore).toBeTruthy();
  });

  it("a second open during the first's loading shows only the second table", async () => {
    const mesa4Lines = deferred<{ lines: never[]; revision: number; editSentLines: boolean }>();
    const z2Offers = deferred<ZoneOfferCatalogue>();
    const { el } = await mountApp();
    await openMesa(el, "t7");
    await back(el);
    api.getTabLines.mockImplementation(async (tabId: string) =>
      tabId === "wo-4" ? mesa4Lines.promise : { lines: [], revision: 0, editSentLines: true },
    );
    api.listZoneOffers.mockImplementation(async (zoneId: string) =>
      zoneId === "z2" ? z2Offers.promise : catalogue("v1"),
    );
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    emit(tableOrder(el)!, "open-table", { tableId: "t9", seated: true });
    await flush(el);
    const z2 = catalogue("v1", { Beer: "7.00" });
    z2Offers.resolve({ ...z2, context: { ...z2.context, zoneId: "z2" } });
    await flush(el);
    mesa4Lines.resolve({ lines: [], revision: 0, editSentLines: true });
    await flush(el);
    expect(tableOrder(el)!.party?.id).toBe("v9");
    expect(tableOrder(el)!.products.find((p) => p.name === "Beer")!.unitPrice).toBe("7.00");
    expect(tableOrder(el)!.loading).toBe(false);
  });

  it("a first open's reads answering while a second table's menu is read keep the second loading", async () => {
    const mesa4Lines = deferred<{ lines: never[]; revision: number; editSentLines: boolean }>();
    const z2Offers = deferred<ZoneOfferCatalogue>();
    const { el } = await mountApp();
    await openMesa(el, "t7");
    await back(el);
    api.getTabLines.mockImplementation(async (tabId: string) =>
      tabId === "wo-4" ? mesa4Lines.promise : { lines: [], revision: 0, editSentLines: true },
    );
    api.listZoneOffers.mockImplementation(async (zoneId: string) =>
      zoneId === "z2" ? z2Offers.promise : catalogue("v1"),
    );
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    expect(tableOrder(el)!.loading).toBe(true);
    await back(el);
    emit(floor(el)!, "open-table", { tableId: "t9", seated: true });
    await flush(el);
    mesa4Lines.resolve({ lines: [], revision: 0, editSentLines: true });
    await flush(el, 6);
    expect(tableOrder(el)!.loading).toBe(true);
    expect(loadingLine(el)).not.toBeNull();
    const z2 = catalogue("v1", { Beer: "7.00" });
    z2Offers.resolve({ ...z2, context: { ...z2.context, zoneId: "z2" } });
    await flush(el, 6);
    expect(tableOrder(el)!.loading).toBe(false);
    expect(tableOrder(el)!.party?.id).toBe("v9");
    expect(tableOrder(el)!.products.find((p) => p.name === "Beer")!.unitPrice).toBe("7.00");
    expect(api.listDrafts).toHaveBeenLastCalledWith("v9", expect.anything());
  });

  it("a refused seat of an open already left keeps the next table loading", async () => {
    const free = table("t5", "5", null);
    let refuse!: () => void;
    const lines = deferred<{ lines: never[]; revision: number; editSentLines: boolean }>();
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([mesa4, mesa7, free]),
      seatTable: vi.fn(
        () =>
          new Promise(
            (_, reject) => (refuse = () => reject({ code: "table.occupied", status: 409 })),
          ),
      ),
    });
    await openMesa(el, "t7");
    await back(el);
    api.getTabLines.mockImplementation(async (tabId: string) =>
      tabId === "wo-4" ? lines.promise : { lines: [], revision: 0, editSentLines: true },
    );
    emit(floor(el)!, "open-table", { tableId: "t5", seated: false, guestCount: 2 });
    await flush(el);
    await back(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    refuse();
    await flush(el, 6);
    expect(tableOrder(el)!.loading).toBe(true);
    lines.resolve({ lines: [], revision: 0, editSentLines: true });
    await flush(el, 6);
    expect(tableOrder(el)!.party?.id).toBe("v1");
    expect(tableOrder(el)!.loading).toBe(false);
  });

  it("the table resumed at sign-in shows its loading line", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    emit(shell(el), "logout");
    await flush(el);
    const lines = deferred<{ lines: never[]; revision: number; editSentLines: boolean }>();
    api.getTabLines.mockImplementation(() => lines.promise);
    await signIn(el);
    await flush(el, 6);
    expect(tableOrder(el)!.loading).toBe(true);
    expect(loadingLine(el)).not.toBeNull();
    lines.resolve({ lines: [], revision: 0, editSentLines: true });
    await flush(el, 6);
    expect(tableOrder(el)!.party?.id).toBe("v1");
    expect(tableOrder(el)!.loading).toBe(false);
  });

  it("an order tab left for the floor while loading is never written to history", async () => {
    const lines = deferred<{ lines: never[]; revision: number; editSentLines: boolean }>();
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(till(orderTabFormFactor)),
      getTabLines: vi.fn(() => lines.promise),
    });
    await onFloor(el);
    vi.spyOn(history, "pushState");
    vi.spyOn(history, "replaceState");
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    lines.resolve({ lines: [], revision: 0, editSentLines: true });
    await flush(el, 6);
    expect(floor(el)).not.toBeNull();
    expect(tableOrder(el)).toBeNull();
    expect(orderPushes()).toEqual([]);
    expect(orderReplaces()).toEqual([]);
  });

  it("a table whose menu cannot be read goes back to the floor with the error", async () => {
    const { el } = await mountApp({
      listZoneOffers: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    await onFloor(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    expect(tableOrder(el)).toBeNull();
    expect(floor(el)).not.toBeNull();
    expect(banner(el)!.textContent).toContain(t("table.error"));
  });

  it("a menu read that fails after a server switch leaves the switch's message", async () => {
    const { el, switchServer } = await mountWithRouter();
    let fail!: () => void;
    api.listZoneOffers.mockImplementation(async (zoneId: string) =>
      zoneId === "z2"
        ? new Promise((_, reject) => (fail = () => reject(new TypeError("Failed to fetch"))))
        : catalogue("v1"),
    );
    await onFloor(el);
    emit(floor(el)!, "open-table", { tableId: "t9", seated: true });
    await flush(el);
    expect(fail).toBeDefined();
    await switchServer();
    expect(banner(el)!.textContent).toContain(t("server.switched"));
    const floorReads = api.getTablesState.mock.calls.length;
    fail();
    await flush(el, 6);
    expect(lock(el)).not.toBeNull();
    expect(banner(el)!.textContent).toContain(t("server.switched"));
    expect(api.getTablesState.mock.calls.length).toBe(floorReads);
  });

  it("a seating that fails after a server switch leaves the switch's message", async () => {
    const { el, switchServer } = await mountWithRouter();
    let refuse!: () => void;
    api.getTablesState.mockResolvedValue([mesa4, mesa7, table("t5", "5", null)]);
    api.seatTable = vi.fn(
      () =>
        new Promise(
          (_, reject) => (refuse = () => reject({ code: "table.occupied", status: 409 })),
        ),
    );
    await onFloor(el);
    emit(floor(el)!, "open-table", { tableId: "t5", seated: false, guestCount: 2 });
    await flush(el);
    expect(refuse).toBeDefined();
    await switchServer();
    expect(banner(el)!.textContent).toContain(t("server.switched"));
    const floorReads = api.getTablesState.mock.calls.length;
    refuse();
    await flush(el, 6);
    expect(lock(el)).not.toBeNull();
    expect(banner(el)!.textContent).toContain(t("server.switched"));
    expect(api.getTablesState.mock.calls.length).toBe(floorReads);
  });

  it("a free table whose seating is refused goes back to the floor with the error", async () => {
    const free = table("t5", "5", null);
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([mesa4, mesa7, free]),
      seatTable: vi.fn().mockRejectedValue({ code: "table.occupied", status: 409 }),
    });
    await onFloor(el);
    emit(floor(el)!, "open-table", { tableId: "t5", seated: false, guestCount: 2 });
    await flush(el);
    expect(tableOrder(el)).toBeNull();
    expect(floor(el)).not.toBeNull();
    expect(banner(el)!.textContent).toContain(t("table.error"));
  });

  it("a bill opened from Find a bill shows no loading line, and Back during its read stops it", async () => {
    const offers = deferred<ZoneOfferCatalogue>();
    const { el } = await mountApp({
      findBillOptions: vi.fn().mockResolvedValue(billOptions),
      listBills: vi.fn().mockResolvedValue(listPage()),
      getFindBill: vi.fn().mockResolvedValue(billRow({ partyId: "v1", workingOrderId: "wo-4" })),
      listZoneOffers: vi.fn(() => offers.promise),
    });
    await onFloor(el);
    emit(shell(el), "find-bill");
    await flush(el);
    const findBill = () => el.shadowRoot!.querySelector("till-find-bill-screen");
    emit(findBill()!, "find-bill-open", { row: billRow({ workingOrderId: "wo-4" }) });
    await vi.waitFor(() => expect(api.getFindBill).toHaveBeenCalledTimes(1));
    await flush(el);
    expect(findBill()).not.toBeNull();
    expect(tableOrder(el)).toBeNull();
    expect(opening(el)).toBe(false);
    await vi.waitFor(() => expect(api.listZoneOffers).toHaveBeenCalledTimes(1));
    emit(findBill()!, "find-bill-back");
    await flush(el);
    offers.resolve(catalogue("v1"));
    await flush(el);
    expect(tableOrder(el)).toBeNull();
    expect(loadingLine(el)).toBeNull();
    expect(api.getTabLines).not.toHaveBeenCalled();
  });

  it("a same-party open shows its loading line while the left save is out", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    const release = holdNextSave();
    await back(el);
    await reopen(el, "t4");
    expect(loadingLine(el)).not.toBeNull();
    release();
    await flush(el);
    expect(loadingLine(el)).toBeNull();
  });

  it("an open abandoned during its flush leaves no loading line", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    const release = holdNextSave();
    await back(el);
    await reopen(el, "t4");
    expect(loadingLine(el)).not.toBeNull();
    emit(shell(el), "logout");
    await flush(el);
    release();
    await flush(el);
    await signIn(el);
    expect(opening(el)).toBe(false);
    expect(loadingLine(el)).toBeNull();
  });

  it("signing out while a table loads does not resume it at the next sign-in", async () => {
    const lines = deferred<{ lines: never[]; revision: number; editSentLines: boolean }>();
    const { el } = await mountApp({ getTabLines: vi.fn(() => lines.promise) });
    await onFloor(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    expect(loadingLine(el)).not.toBeNull();
    emit(shell(el), "logout");
    await flush(el);
    lines.resolve({ lines: [], revision: 0, editSentLines: true });
    await flush(el);
    api.getTabLines.mockClear();
    await signIn(el);
    await flush(el, 6);
    expect(api.getTabLines).not.toHaveBeenCalled();
    expect(tableOrder(el)).toBeNull();
  });

  it("the order tab shows at once and is written to history once it has loaded", async () => {
    const lines = deferred<{ lines: never[]; revision: number; editSentLines: boolean }>();
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(till(orderTabFormFactor)),
      getTabLines: vi.fn(() => lines.promise),
    });
    await onFloor(el);
    vi.spyOn(history, "pushState");
    vi.spyOn(history, "replaceState");
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    expect(tableOrder(el)!.loading).toBe(true);
    expect(orderPushes()).toEqual([]);
    expect(orderReplaces()).toEqual([]);
    lines.resolve({ lines: [], revision: 0, editSentLines: true });
    await flush(el);
    expect(tableOrder(el)!.loading).toBe(false);
    expect(orderPushes()).toHaveLength(1);
    expect(orderReplaces()).toEqual([]);
  });

  it("a failed open on the card mount returns to the floor tab with no history entry", async () => {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(till(orderTabFormFactor)),
      listZoneOffers: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    await onFloor(el);
    vi.spyOn(history, "pushState");
    vi.spyOn(history, "replaceState");
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    expect(tableOrder(el)).toBeNull();
    expect(floor(el)).not.toBeNull();
    expect(banner(el)!.textContent).toContain(t("table.error"));
    expect(vi.mocked(history.pushState)).not.toHaveBeenCalled();
    expect(orderReplaces()).toEqual([]);
  });

  it("Back while loading returns to the floor and the late answers do not bring the order back", async () => {
    const offers = deferred<ZoneOfferCatalogue>();
    const { el } = await mountApp({ listZoneOffers: vi.fn(() => offers.promise) });
    await onFloor(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    expect(loadingLine(el)).not.toBeNull();
    await back(el);
    expect(tableOrder(el)).toBeNull();
    offers.resolve(catalogue("v1"));
    await flush(el, 6);
    expect(tableOrder(el)).toBeNull();
    expect(floor(el)).not.toBeNull();
    expect(api.getTabLines).not.toHaveBeenCalled();
    expect(api.listDrafts).not.toHaveBeenCalled();
    expect(opening(el)).toBe(false);
  });

  it("leaving the loading order tab for another tab abandons the open", async () => {
    const offers = deferred<ZoneOfferCatalogue>();
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(till(orderTabFormFactor)),
      listZoneOffers: vi.fn(() => offers.promise),
    });
    await onFloor(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    expect(tableOrder(el)!.loading).toBe(true);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    offers.resolve(catalogue("v1"));
    await flush(el, 6);
    expect(tableOrder(el)).toBeNull();
    expect(floor(el)).not.toBeNull();
    expect(api.getTabLines).not.toHaveBeenCalled();
    expect(opening(el)).toBe(false);
  });

  it("Back during seating keeps the carried lines", async () => {
    const free = table("t9", "9", null);
    const seated = table(
      "t9",
      "9",
      party({ id: "v-new", revision: 0, mainBillId: "wo-new", tableIds: ["t9"] }),
    );
    const seat = deferred<void>();
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([mesa4, mesa7, free]),
      seatTable: vi.fn(async () => {
        await seat.promise;
        vi.mocked(api.getTablesState).mockResolvedValue([mesa4, mesa7, seated]);
        return { partyId: "v-new", tabId: "wo-new", revision: 0, orderNumber: 12 };
      }),
    });
    await openMesa(el, "t9");
    await tap(el, "Beer");
    emit(tableOrder(el)!, "open-table", { tableId: "t9", seated: false, guestCount: 2 });
    await flush(el);
    expect(api.seatTable).toHaveBeenCalledTimes(1);
    await back(el);
    expect(tableOrder(el)).toBeNull();
    seat.resolve();
    await flush(el, 6);
    expect(tableOrder(el)).toBeNull();
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el, 6);
    await reopen(el, "t9");
    await flush(el, 6);
    expect(
      tableOrder(el)!.draftStore?.lines.map((line) => `${line.product.name} ×${line.quantity}`),
    ).toEqual(["Beer ×1"]);
    expect(savedBeers()).toEqual(["offer-beer ×1"]);
  });

  it("lines carried to a newly seated table are saved, and are there when it is reopened", async () => {
    const free = table("t9", "9", null);
    const seated = table(
      "t9",
      "9",
      party({ id: "v-new", revision: 0, mainBillId: "wo-new", tableIds: ["t9"] }),
    );
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([mesa4, mesa7, free]),
      seatTable: vi.fn(async () => {
        vi.mocked(api.getTablesState).mockResolvedValue([mesa4, mesa7, seated]);
        return { partyId: "v-new", tabId: "wo-new", revision: 0, orderNumber: 12 };
      }),
    });
    await openMesa(el, "t9");
    await tap(el, "Beer");
    emit(tableOrder(el)!, "open-table", { tableId: "t9", seated: false, guestCount: 2 });
    await flush(el, 6);
    await vi.waitFor(() => expect(savedBeers()).toEqual(["offer-beer ×1"]));
    expect(server.saveDraft).toHaveBeenCalledWith(
      "v-new",
      expect.objectContaining({ lines: [expect.objectContaining({ menuItemId: "offer-beer" })] }),
      expect.anything(),
    );
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el, 6);
    await reopen(el, "t9");
    await flush(el, 6);
    expect(
      tableOrder(el)!.draftStore?.lines.map((line) => `${line.product.name} ×${line.quantity}`),
    ).toEqual(["Beer ×1"]);
  });

  it("lines carried to a newly seated table are sent when the waiter sends at once", async () => {
    const free = table("t9", "9", null);
    const seated = table(
      "t9",
      "9",
      party({ id: "v-new", revision: 0, mainBillId: "wo-new", tableIds: ["t9"] }),
    );
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([mesa4, mesa7, free]),
      seatTable: vi.fn(async () => {
        vi.mocked(api.getTablesState).mockResolvedValue([mesa4, mesa7, seated]);
        return { partyId: "v-new", tabId: "wo-new", revision: 0, orderNumber: 12 };
      }),
    });
    await openMesa(el, "t9");
    await tap(el, "Beer");
    emit(tableOrder(el)!, "open-table", { tableId: "t9", seated: false, guestCount: 2 });
    await flush(el, 6);
    tableOrder(el)!
      .shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!
      .click();
    await flush(el);
    await flush(el, 6);
    expect(server.submitDraft).toHaveBeenCalledOnce();
    const [partyId, draftId] = server.submitDraft.mock.calls[0]!;
    expect(partyId).toBe("v-new");
    expect(server.saveDraft.mock.calls.at(-1)![1].lines).toEqual([
      expect.objectContaining({ menuItemId: "offer-beer" }),
    ]);
    expect(await server.saveDraft.mock.results.at(-1)!.value).toMatchObject({
      draft: { id: draftId, billId: "wo-new" },
      edit: { billId: "wo-new", draftId },
    });
  });
});
