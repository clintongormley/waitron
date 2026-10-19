import { openDraftLine } from "./screens/till-table-order-screen.test-helpers.js";
import { deviceZonesFixture } from "../test/device-zones.js";
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
import type { TillStationScreen } from "./screens/till-station-screen.js";
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
import type { WtCombobox } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";

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

function state(version: string, liveFields = "lf-1", setupRevision?: string): MenuStateAnswer {
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
    ...(setupRevision === undefined ? {} : { setupRevision }),
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
    status: null,
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
    setupRevision: "s1",
  };
}

let server: DraftServer;
let api: Record<string, ReturnType<typeof vi.fn>>;

function stubApi(overrides: Record<string, unknown> = {}) {
  for (const id of ["wo-7", "wo-9"]) server.bills.add(id);
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
    listStatuses: vi.fn().mockResolvedValue([]),
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
  return mountWidget<TillApp>(
    "till-app",
    {
      api: api as unknown as TillApi,
      ...(sessionActivity ? { sessionActivity } : {}),
    },
    theme,
  );
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

const venue = (el: TillApp) =>
  el as unknown as { courses: { id: string }[]; bumpMode: string; fireControl: string };

const courseIds = (list: { id: string }[]) => list.map((each) => each.id);

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

const rows = (el: TillApp) =>
  tableOrder(el)!.draftStore?.lines.map((line) => `${line.product.name} ×${line.quantity}`) ?? null;

describe("A768 the till follows the venue's setup revision", () => {
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

  const noCourses = { ...till(drillFormFactor), courses: [], setupRevision: "s1" };
  const moved = { ...till(drillFormFactor), courses, setupRevision: "s2" };

  it("new courses reach an open table without a reload", async () => {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValueOnce(noCourses).mockResolvedValue(moved),
    });
    await openMesa(el);
    await tap(el, "Beer");
    expect(tableOrder(el)!.courses).toEqual([]);
    const reads = api.getTill.mock.calls.length;
    api.menuState.mockImplementation(async () => state("v1", "lf-1", "s2"));
    await poll(el);
    expect(courseIds(tableOrder(el)!.courses)).toEqual(["drinks", "mains", "desserts"]);
    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(api.getTill.mock.calls.length).toBe(reads + 1);
  });

  it("the same revision reads nothing", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    const reads = api.getTill.mock.calls.length;
    const checks = api.menuState.mock.calls.length;
    api.menuState.mockImplementation(async () => state("v1", "lf-1", "s1"));
    await poll(el);
    expect(api.menuState.mock.calls.length).toBeGreaterThan(checks);
    expect(api.getTill.mock.calls.length).toBe(reads);
  });

  it("a failed settings read keeps the old values and asks again on the next poll", async () => {
    const { el } = await mountApp({
      getTill: vi
        .fn()
        .mockResolvedValueOnce(noCourses)
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValue(moved),
    });
    await openMesa(el);
    const reads = api.getTill.mock.calls.length;
    api.menuState.mockImplementation(async () => state("v1", "lf-1", "s2"));
    await poll(el);
    expect(api.getTill.mock.calls.length).toBe(reads + 1);
    expect(venue(el).courses).toEqual([]);
    expect(tableOrder(el)).not.toBeNull();
    await poll(el);
    expect(api.getTill.mock.calls.length).toBe(reads + 2);
    expect(courseIds(venue(el).courses)).toEqual(["drinks", "mains", "desserts"]);
  });

  it("bump mode and fire control reach the station screen", async () => {
    const stationTill = {
      ...till(drillFormFactor),
      capabilities: ["print-receipt", "show-station"] as CapabilityFlag[],
    };
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(stationTill),
      listStations: vi.fn().mockResolvedValue([]),
      getStationQueue: vi.fn().mockResolvedValue({ tickets: [] }),
    });
    await flush(el);
    await signIn(el);
    emit(shell(el), "show-station");
    await flush(el);
    const station = () => el.shadowRoot!.querySelector<TillStationScreen>("till-station-screen")!;
    expect(station().bumpMode).toBe("line");
    api.getTill.mockResolvedValue({
      ...stationTill,
      bumpMode: "ticket",
      fireControl: "kitchen",
      setupRevision: "s2",
    });
    api.menuState.mockImplementation(async () => state("v1", "lf-1", "s2"));
    await poll(el);
    expect(station().bumpMode).toBe("ticket");
    expect(station().fireControl).toBe("kitchen");
  });

  it("a settings read that answers after a server switch applies nothing", async () => {
    const { el, switchServer } = await mountWithRouter();
    await openMesa(el);
    let answerLate!: (value: unknown) => void;
    api.getTill.mockImplementationOnce(() => new Promise((resolve) => (answerLate = resolve)));
    api.menuState.mockImplementation(async () => state("v1", "lf-1", "s2"));
    const reads = api.getTill.mock.calls.length;
    await poll(el);
    expect(api.getTill.mock.calls.length).toBe(reads + 1);
    await switchServer();
    answerLate({
      ...till(drillFormFactor),
      courses: [{ id: "late", name: "Late", displayOrder: 0 }],
      bumpMode: "ticket",
      setupRevision: "s2",
    });
    await flush(el);
    expect(courseIds(venue(el).courses)).toEqual(["drinks", "mains", "desserts"]);
    expect(venue(el).bumpMode).toBe("line");
  });

  it("a profile switch takes the venue's new courses too", async () => {
    const { el } = await mountApp({
      getDeviceIdentity: vi.fn().mockResolvedValue({
        deviceId: "till-dev",
        name: "Till 1",
        formFactor: "till",
        profileId: "pr-counter",
        approvedProfiles: [
          { id: "pr-counter", name: "Counter till" },
          { id: "pr-bar", name: "Bar till" },
        ],
      }),
      switchDeviceProfile: vi.fn().mockResolvedValue({ activeProfileId: "pr-bar" }),
      getTill: vi.fn().mockResolvedValueOnce(noCourses).mockResolvedValue(moved),
    });
    await openMesa(el);
    shell(el).shadowRoot!.querySelector<HTMLElement>("wt-button.profile")!.click();
    await flush(el);
    emit(el.shadowRoot!.querySelector("till-profile-dialog")!, "profile-switch", {
      profileId: "pr-bar",
    });
    await flush(el, 6);
    expect(courseIds(venue(el).courses)).toEqual(["drinks", "mains", "desserts"]);
    const reads = api.getTill.mock.calls.length;
    api.menuState.mockImplementation(async () => state("v1", "lf-1", "s2"));
    await poll(el);
    expect(api.getTill.mock.calls.length).toBe(reads);
  });

  function held<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => (resolve = done));
    return { promise, resolve };
  }

  const switched = { ...till(drillFormFactor), courses, setupRevision: "s3" };
  const profileApi = {
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "till-dev",
      name: "Till 1",
      formFactor: "till",
      profileId: "pr-counter",
      approvedProfiles: [
        { id: "pr-counter", name: "Counter till" },
        { id: "pr-bar", name: "Bar till" },
      ],
    }),
    switchDeviceProfile: vi.fn().mockResolvedValue({ activeProfileId: "pr-bar" }),
  };

  async function switchProfile(el: TillApp): Promise<void> {
    shell(el).shadowRoot!.querySelector<HTMLElement>("wt-button.profile")!.click();
    await flush(el);
    emit(el.shadowRoot!.querySelector("till-profile-dialog")!, "profile-switch", {
      profileId: "pr-bar",
    });
    await flush(el, 6);
  }

  it("a settings read sent before a profile switch does not undo the switch's settings", async () => {
    const { el } = await mountApp({
      ...profileApi,
      getTill: vi.fn().mockResolvedValue(noCourses),
    });
    await openMesa(el);
    const stale = held<unknown>();
    api.getTill.mockImplementationOnce(() => stale.promise);
    api.menuState.mockImplementation(async () => state("v1", "lf-1", "s2"));
    await poll(el);
    api.getTill.mockResolvedValue({ ...switched, defaultReaderId: "reader-new" });
    await switchProfile(el);
    expect(courseIds(venue(el).courses)).toEqual(["drinks", "mains", "desserts"]);
    stale.resolve({ ...noCourses, setupRevision: "s2" });
    await flush(el);
    expect(courseIds(venue(el).courses)).toEqual(["drinks", "mains", "desserts"]);
    expect((el as unknown as { defaultReaderId?: string }).defaultReaderId).toBe("reader-new");
  });

  it("a profile switch's settings read answering after a newer poll's read does not undo it", async () => {
    const { el } = await mountApp({
      ...profileApi,
      getTill: vi.fn().mockResolvedValue(noCourses),
    });
    await openMesa(el);
    const stale = held<unknown>();
    api.getTill.mockImplementationOnce(() => stale.promise);
    api.getTill.mockResolvedValue(switched);
    await switchProfile(el);
    api.menuState.mockImplementation(async () => state("v1", "lf-1", "s3"));
    await poll(el);
    await flush(el, 3);
    expect(courseIds(venue(el).courses)).toEqual(["drinks", "mains", "desserts"]);
    stale.resolve({ ...noCourses, setupRevision: "s2" });
    await flush(el, 6);
    expect(courseIds(venue(el).courses)).toEqual(["drinks", "mains", "desserts"]);
  });

  it("a change of the device's zones applies the venue's new settings", async () => {
    const { el } = await mountApp({ getTill: vi.fn().mockResolvedValue(noCourses) });
    await openMesa(el);
    api.getTill.mockResolvedValue(switched);
    api.getDeviceZones.mockResolvedValue({
      ...deviceZonesFixture(undefined, ["z1"]),
      snapshot: "moved",
    });
    await poll(el);
    expect(courseIds(venue(el).courses)).toEqual(["drinks", "mains", "desserts"]);
  });

  it("a settings read sent before a change of the device's zones does not undo its settings", async () => {
    const { el } = await mountApp({ getTill: vi.fn().mockResolvedValue(noCourses) });
    await openMesa(el);
    const stale = held<unknown>();
    api.getTill.mockImplementationOnce(() => stale.promise);
    api.menuState.mockImplementation(async () => state("v1", "lf-1", "s2"));
    await poll(el);
    api.getTill.mockResolvedValue(switched);
    api.getDeviceZones.mockResolvedValue({
      ...deviceZonesFixture(undefined, ["z1"]),
      snapshot: "moved",
    });
    await poll(el);
    expect(courseIds(venue(el).courses)).toEqual(["drinks", "mains", "desserts"]);
    stale.resolve({ ...noCourses, setupRevision: "s2" });
    await flush(el);
    expect(courseIds(venue(el).courses)).toEqual(["drinks", "mains", "desserts"]);
  });

  it("a settings read left out across a server switch does not stop the next one", async () => {
    const { el, switchServer } = await mountWithRouter();
    await openMesa(el);
    api.getTill.mockImplementationOnce(() => new Promise(() => undefined));
    api.menuState.mockImplementation(async () => state("v1", "lf-1", "s2"));
    await poll(el);
    await switchServer();
    await openMesa(el);
    const reads = api.getTill.mock.calls.length;
    api.getTill.mockResolvedValue(moved);
    await poll(el);
    expect(api.getTill.mock.calls.length).toBe(reads + 1);
  });

  it("a settings read from before a server switch applies nothing while the new start read is out", async () => {
    const { el, switchServer } = await mountWithRouter();
    await openMesa(el);
    const late = held<unknown>();
    const start = held<unknown>();
    api.getTill.mockImplementationOnce(() => late.promise);
    api.menuState.mockImplementation(async () => state("v1", "lf-1", "s2"));
    await poll(el);
    api.getTill.mockImplementationOnce(() => start.promise);
    await switchServer();
    late.resolve({
      ...till(drillFormFactor),
      courses: [{ id: "late", name: "Late", displayOrder: 0 }],
      setupRevision: "s2",
    });
    await flush(el);
    expect(courseIds(venue(el).courses)).toEqual(["drinks", "mains", "desserts"]);
    start.resolve(till(drillFormFactor));
    await flush(el, 6);
  });

  it("a draft line keeps a course a refresh deleted, and still shows its name", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    const form = await openDraftLine(tableOrder(el)!, 0);
    await chooseOption(form.shadowRoot!.querySelector<WtCombobox>('[name="course"]')!, "mains");
    await form.updateComplete;
    form.shadowRoot!.querySelector<HTMLElement>(".confirm")!.click();
    await flush(el);
    api.getTill.mockResolvedValue({
      ...till(drillFormFactor),
      courses: courses.filter((course) => course.id !== "mains"),
      setupRevision: "s2",
    });
    api.menuState.mockImplementation(async () => state("v1", "lf-1", "s2"));
    await poll(el);
    expect(courseIds(tableOrder(el)!.courses)).toEqual(["drinks", "desserts"]);
    expect(tableOrder(el)!.draftStore!.lines.map((line) => line.courseId)).toEqual(["mains"]);
    const order = tableOrder(el)!.shadowRoot!;
    const retained = await openDraftLine(tableOrder(el)!, 0);
    expect(retained.shadowRoot!.querySelector('[name="course"]')!.getAttribute("placeholder")).toBe(
      "Mains",
    );
    expect(order.querySelector('[data-draft-group="fire"]')?.getAttribute("aria-label")).toBe(
      "Fire now · Mains",
    );
  });
});

describe("A768 a settings read that gets no answer", () => {
  // Fake timers from mount on, so the till's request limit can be passed.
  beforeEach(() => {
    server = draftServer();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupWidgets();
  });

  async function settle(el: TillApp, rounds = 3): Promise<void> {
    for (let i = 0; i < rounds; i++) {
      await vi.advanceTimersByTimeAsync(20);
      await el.updateComplete;
    }
  }

  async function tick(el: TillApp, ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await settle(el);
  }

  /** A read that answers only by failing once its signal aborts, as a fetch does. */
  const unanswered = (options?: { signal?: AbortSignal }) =>
    new Promise((_, reject) =>
      options?.signal?.addEventListener("abort", () =>
        reject(new DOMException("The operation was aborted.", "AbortError")),
      ),
    );

  it("is cut off at the till's request limit, and the next poll reads the settings again", async () => {
    const noCourses = { ...till(drillFormFactor), courses: [], setupRevision: "s1" };
    const moved = { ...till(drillFormFactor), courses, setupRevision: "s2" };
    const { el } = await mountApp({ getTill: vi.fn().mockResolvedValue(noCourses) });
    await settle(el);
    server.personId = "p1";
    emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
    await settle(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await settle(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await settle(el, 6);
    expect(tableOrder(el)).not.toBeNull();
    const reads = api.getTill.mock.calls.length;
    let sentAt = 0;
    api.getTill.mockImplementationOnce((options?: { signal?: AbortSignal }) => {
      sentAt = Date.now();
      return unanswered(options);
    });
    api.menuState.mockImplementation(async () => state("v1", "lf-1", "s2"));
    await tick(el, 15_000);
    expect(api.getTill.mock.calls.length).toBe(reads + 1);
    const [options] = api.getTill.mock.lastCall as [{ signal?: AbortSignal }?];
    api.getTill.mockResolvedValue(moved);
    // TABLE_REQUEST_LIMIT_MS in state/draft-sync.ts.
    await vi.advanceTimersByTimeAsync(sentAt + 149_999 - Date.now());
    expect(options?.signal?.aborted).toBe(false);
    expect(api.getTill.mock.calls.length).toBe(reads + 1);
    await vi.advanceTimersByTimeAsync(1);
    expect(options?.signal?.aborted).toBe(true);
    await tick(el, 15_000);
    expect(api.getTill.mock.calls.length).toBe(reads + 2);
    expect(courseIds(venue(el).courses)).toEqual(["drinks", "mains", "desserts"]);
  });
});
