import { deviceZonesFixture } from "../test/device-zones.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupWidgets,
  draftServer,
  mountWidget,
  type DraftServer,
} from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import { setLocale } from "./i18n/t.js";
import { DRAFT_SAVE_DELAY_MS } from "./state/draft-sync.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import type { TillFloorScreen } from "./screens/till-floor-screen.js";
import type { TillMenuBrowser } from "./widgets/menu-browser.js";
import type { TillShell } from "./widgets/till-shell.js";
import type { FormFactor, CapabilityFlag } from "./layout.js";
import type {
  TableState,
  TableParty,
  TillApi,
  TillMenuOffer,
  UnsentDraft,
  ZoneOfferCatalogue,
} from "./api/client.js";
import { HOME_DISPLAY_DEFAULTS } from "@waitron/catalogue/src/device-home.js";
import { ServerRouter } from "./api/server-router.js";

// T4 holds party v1 on bill wo-4 and T9 party v9 on bill wo-9, both in zone z1, whose Lunch menu
// offers Beer, Steak and Flan. Ana is p1, Sam p2.

const unit = {
  staffName: "Staff unit",
  staffAbbreviation: "su",
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

function catalogue(version: string, prices: Record<string, string> = {}): ZoneOfferCatalogue {
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
          handheld: HOME_DISPLAY_DEFAULTS.handheld,
          till: HOME_DISPLAY_DEFAULTS.till,
        },
      },
    ],
    offers,
  };
}

const courses = [
  { id: "drinks", name: "Drinks", displayOrder: 0, heldUntilFired: true },
  { id: "mains", name: "Mains", displayOrder: 1, heldUntilFired: true },
  { id: "desserts", name: "Desserts", displayOrder: 2, heldUntilFired: true },
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
    displayName: "T4",
    mainBillId: "wo-4",
    outstanding: "0.00",
    billCount: 1,
    tableIds: ["t4"],
    unsentDrafts: [],
    reminder: null,
    ...over,
  };
}

function table(
  id: string,
  label: string,
  tableParty: TableParty | null,
  zoneId = "z1",
): TableState {
  return {
    id,
    label,
    shortName: label,
    zoneId,
    state: tableParty === null ? "free" : "open-tab",
    condition: tableParty === null ? "free" : "held",
    hasOpenTab: tableParty !== null,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: null,
    signals: [],
    party: tableParty,
  };
}

function unsent(billId: string, ownerId: string): UnsentDraft {
  return {
    billId,
    billNumber: 1,
    ownerId,
    ownerName: ownerId === "p1" ? "Ana" : "Sam",
    lineCount: 2,
    savedAt: "2026-10-26T12:00:00.000Z",
  };
}

const mesa4 = table("t4", "T4", party());
const mesa9 = table(
  "t9",
  "T9",
  party({ id: "v9", revision: 9, displayName: "T9", mainBillId: "wo-9", tableIds: ["t9"] }),
);
/** The floor read with a New order of `ownerId`'s saved on T4's bill. */
const mesa4With = (ownerId: string) =>
  table("t4", "T4", party({ unsentDrafts: [unsent("wo-4", ownerId)] }));
const mesa9WithAnas = table(
  "t9",
  "T9",
  party({
    id: "v9",
    revision: 9,
    displayName: "T9",
    mainBillId: "wo-9",
    tableIds: ["t9"],
    unsentDrafts: [unsent("wo-9", "p1")],
  }),
);

const phone: FormFactor = "phone-portrait";

function till(formFactor: FormFactor) {
  return {
    locale: "en",
    invoiceLocale: "es-ES",
    venueName: "Bar Pepe",
    nif: "B12345678",
    orderFlow: "prepay" as const,
    receiptPrintMode: "auto" as const,
    fireControl: "waiter" as const,
    courses,
    cardProvider: "none" as const,
    tipsEnabled: false,
    formFactor,
    capabilities: ["print-receipt"] as CapabilityFlag[],
    inactivityTimeoutSeconds: null,
    nodeId: "n1",
    servers: [],
  };
}

let server: DraftServer;
let api: Record<string, ReturnType<typeof vi.fn>>;

function stubApi(formFactor: FormFactor, overrides: Record<string, unknown> = {}) {
  server.bills.add("wo-9");
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
    getTill: vi.fn().mockResolvedValue(till(formFactor)),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "device-1",
      name: "Device 1",
      formFactor,
    }),
    getDeviceStationScreen: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    listStaff: vi.fn().mockResolvedValue([]),
    listDefaultZoneOffers: vi.fn().mockResolvedValue({
      ...catalogue("v1"),
      context: { ...catalogue("v1").context, zoneId: "zc" },
    }),
    listZoneOffers: vi.fn(async (zoneId: string) => ({
      ...catalogue("v1"),
      context: { ...catalogue("v1").context, zoneId },
    })),
    menuState: vi.fn(() => new Promise(() => {})),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
    getTablesState: vi.fn().mockResolvedValue([mesa4, mesa9]),
    listZones: vi.fn().mockResolvedValue([
      { id: "z1", name: "Comedor", displayOrder: 0, active: true, serviceMode: "table_tab" },
      { id: "z2", name: "Terraza", displayOrder: 1, active: true, serviceMode: "table_tab" },
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
    getTabLines: vi.fn().mockResolvedValue({ lines: [], revision: 0 }),
    listGroups: vi.fn().mockResolvedValue({ revision: 3, groups: [] }),
    readCurrentOrders: vi.fn().mockResolvedValue({
      revision: 3,
      hasGroups: false,
      nextDisplayNumber: 1,
      retainedCourses: [],
      groups: [],
      ungrouped: [],
      reminder: null,
    }),
    listPrintProblems: vi.fn().mockResolvedValue({ problems: [] }),
    listDrafts: server.listDrafts,
    saveDraft: server.saveDraft,
    submitDraft: server.submitDraft,
    takeOverDraft: server.takeOverDraft,
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as Record<string, ReturnType<typeof vi.fn>>;
}

async function mountApp(overrides: Record<string, unknown> = {}, formFactor: FormFactor = phone) {
  api = stubApi(formFactor, overrides);
  return mountWidget<TillApp>("till-app", { api: api as unknown as TillApi });
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
const shell = (el: TillApp) => el.shadowRoot!.querySelector<TillShell>("till-shell")!;
const floor = (el: TillApp) => el.shadowRoot!.querySelector<TillFloorScreen>("till-floor-screen");
const tableOrder = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen");
const browser = (el: TillApp) =>
  tableOrder(el)!.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser");
const draft = (el: TillApp) => tableOrder(el)!.draftStore!;

/** The bar's tabs as `[Floor]`, `✎ T4`: brackets mark the selected one, ✎ the unsent icon. */
function bar(el: TillApp): string[] {
  return [...shell(el).shadowRoot!.querySelectorAll<HTMLElement>('[role="tab"]')].map((tab) => {
    const icon = tab.querySelector('wt-icon[name="floor-unsent"]') === null ? "" : "✎ ";
    const label = `${icon}${tab.textContent!.trim()}`;
    return tab.getAttribute("aria-selected") === "true" ? `[${label}]` : label;
  });
}

/** The selected tab's name alone. */
const selected = (el: TillApp) =>
  bar(el)
    .filter((tab) => tab.startsWith("["))
    .map((tab) => tab.replace(/[[\]]|✎ /g, ""));

function barButton(el: TillApp, tableId: string): HTMLElement {
  return shell(el).shadowRoot!.querySelector<HTMLElement>(`[data-bar-table="${tableId}"]`)!;
}

async function signIn(el: TillApp, personId = "p1", displayName = "Ana"): Promise<void> {
  server.personId = personId;
  server.personName = displayName;
  emit(lock(el), "logged-in", { personId, displayName, permissions: [] });
  await flush(el);
}

async function toFloor(el: TillApp): Promise<void> {
  emit(shell(el), "screen-select", { screen: "floor" });
  await flush(el);
}

async function openMesa(el: TillApp, tableId = "t4"): Promise<TillTableOrderScreen> {
  await flush(el);
  await signIn(el);
  await toFloor(el);
  emit(floor(el)!, "open-table", { tableId, seated: true });
  await flush(el);
  return tableOrder(el)!;
}

async function tap(el: TillApp, name: string): Promise<void> {
  [...browser(el)!.shadowRoot!.querySelectorAll<HTMLElement>("wt-button")]
    .find((button) => button.querySelector(".name")?.textContent === name)!
    .click();
  await flush(el);
}

const waitForSave = () => new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));

beforeEach(() => {
  setLocale("en");
  server = draftServer();
});
afterEach(async () => {
  await cleanupWidgets();
  history.replaceState(null, "", "/");
});

describe("till-app: a handheld's bar buttons for this person's tables", () => {
  it("shows ✎ T4 on the Floor when the floor read names this person's unsent order there", async () => {
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([mesa4With("p1"), mesa9]),
    });
    await flush(el);
    await signIn(el);
    await toFloor(el);
    expect(bar(el)).toEqual(["[Floor]", "✎ T4"]);
  });

  it("shows no button for another person's unsent order", async () => {
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([mesa4With("p2"), mesa9]),
    });
    await flush(el);
    await signIn(el);
    await toFloor(el);
    expect(bar(el)).toEqual(["[Floor]"]);
  });

  it("selects the open table's button, with ✎ from the first dish added and none once it is removed", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    expect(bar(el)).toEqual(["Floor", "[T4]"]);
    await tap(el, "Beer");
    expect(bar(el)).toEqual(["Floor", "[✎ T4]"]);
    draft(el).removeLine(0);
    await flush(el);
    expect(bar(el)).toEqual(["Floor", "[T4]"]);
    expect(tableOrder(el)?.checkVisibility()).toBe(true);
  });

  it("keeps ✎ T4 after Floor, and its button returns to the same draft without a re-read", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    const store = draft(el);
    await toFloor(el);
    expect(bar(el)).toEqual(["[Floor]", "✎ T4"]);

    const reads = api.getTablesState!.mock.calls.length;
    barButton(el, "t4").click();
    await flush(el);
    expect(tableOrder(el)?.checkVisibility()).toBe(true);
    expect(draft(el)).toBe(store);
    expect(api.getTablesState).toHaveBeenCalledTimes(reads);
    expect(bar(el)).toEqual(["Floor", "[✎ T4]"]);
  });

  it("drops the open table's button on Floor when nothing of this person's is unsent there", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    expect(bar(el)).toEqual(["Floor", "[T4]"]);
    await toFloor(el);
    expect(bar(el)).toEqual(["[Floor]"]);
  });

  it("opens another table's button as a Floor tap does, closing an open overlay", async () => {
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([mesa4, mesa9WithAnas]),
    });
    await flush(el);
    await signIn(el);
    await toFloor(el);
    emit(shell(el), "find-bill");
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-find-bill-screen")?.checkVisibility()).toBe(true);
    const offerReads = api.listZoneOffers!.mock.calls.length;

    barButton(el, "t9").click();
    await flush(el, 6);
    expect(el.shadowRoot!.querySelector("till-find-bill-screen")?.checkVisibility() ?? false).toBe(
      false,
    );
    expect(tableOrder(el)?.party?.id).toBe("v9");
    expect(api.listZoneOffers!.mock.calls.length).toBeGreaterThan(offerReads);
    expect(selected(el)).toEqual(["T9"]);
  });

  it("loses ✎ at once when another device takes the open bill, keeping the button selected", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    await waitForSave();
    const anas = structuredClone(server.drafts[0]!);
    server.personId = "p2";
    server.personName = "Sam";
    server.takeOver("v1", anas.id, anas.revision);
    server.personId = "p1";
    server.personName = "Ana";
    expect(bar(el)).toEqual(["Floor", "[✎ T4]"]);

    await tap(el, "Flan");
    await waitForSave();
    await flush(el);
    expect(draft(el).editsLocked).toBe(true);
    expect(bar(el)).toEqual(["Floor", "[T4]"]);
  });

  it("keeps ✎ T4 after a failed save, on the Order screen and after Floor", async () => {
    const { el } = await mountApp({
      saveDraft: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    await openMesa(el);
    await tap(el, "Beer");
    await waitForSave();
    await flush(el);
    expect(api.saveDraft).toHaveBeenCalled();
    expect(draft(el).editsLocked).toBe(true);
    expect(draft(el).lines).toHaveLength(0);
    expect(tableOrder(el)!.retainedDraft?.lines).toHaveLength(1);
    expect(bar(el)).toEqual(["Floor", "[✎ T4]"]);
    await toFloor(el);
    await flush(el);
    expect(bar(el)).toEqual(["[Floor]", "✎ T4"]);
  });

  it("hands the shell the same array when a redraw changes no button", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    const shown = shell(el).barTables;
    expect(shown).toHaveLength(1);
    const updated = vi.spyOn(
      shell(el) as unknown as { updated(changed: Map<string, unknown>): void },
      "updated",
    );
    await tap(el, "Flan");
    expect(draft(el).lines).toHaveLength(2);
    expect(updated).toHaveBeenCalled();
    expect(shell(el).barTables).toBe(shown);
    expect(updated.mock.calls.filter(([changed]) => changed.has("barTables"))).toEqual([]);
  });

  it("selects the table being opened while it loads", async () => {
    const { el } = await mountApp({
      getTablesState: vi
        .fn()
        .mockResolvedValue([mesa4With("p1"), table("t9", "T9", mesa9WithAnas.party, "z2")]),
      getDeviceZones: vi.fn().mockResolvedValue(deviceZonesFixture(undefined, ["z1", "z2"])),
      listZoneOffers: vi.fn(async (zoneId: string) =>
        zoneId === "z2"
          ? new Promise(() => {})
          : { ...catalogue("v1"), context: { ...catalogue("v1").context, zoneId } },
      ),
    });
    await openMesa(el);
    await tap(el, "Beer");
    expect(bar(el)).toEqual(["Floor", "[✎ T4]", "✎ T9"]);

    barButton(el, "t9").click();
    await flush(el);
    expect(api.listZoneOffers).toHaveBeenLastCalledWith("z2");
    expect(selected(el)).toEqual(["T9"]);

    barButton(el, "t4").click();
    await flush(el, 6);
    expect(tableOrder(el)?.party?.id).toBe("v1");
    expect(selected(el)).toEqual(["T4"]);
  });

  it("does nothing when the open table's own button is tapped", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    const store = draft(el);
    const reads = api.getTablesState!.mock.calls.length;
    const offerReads = api.listZoneOffers!.mock.calls.length;
    barButton(el, "t4").click();
    await flush(el);
    expect(draft(el)).toBe(store);
    expect(api.getTablesState).toHaveBeenCalledTimes(reads);
    expect(api.listZoneOffers).toHaveBeenCalledTimes(offerReads);
    expect(bar(el)).toEqual(["Floor", "[✎ T4]"]);
  });

  it("keeps ✎ T9 while T9's draft loads after its button is tapped", async () => {
    const { el } = await mountApp();
    await openMesa(el, "t9");
    await tap(el, "Beer");
    await waitForSave();
    api.getTablesState!.mockResolvedValue([mesa4, mesa9WithAnas]);
    await toFloor(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    await toFloor(el);
    expect(bar(el)).toEqual(["[Floor]", "✎ T9"]);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const read = api.listDrafts!.getMockImplementation() as (...args: unknown[]) => unknown;
    api.listDrafts!.mockImplementation(async (partyId: string, ...rest: unknown[]) => {
      if (partyId === "v9") await gate;
      return read(partyId, ...rest);
    });
    barButton(el, "t9").click();
    const shown: string[][] = [];
    const arrays = new Set<unknown>();
    for (let i = 0; i < 8; i++) {
      await flush(el, 1);
      shown.push(bar(el));
      arrays.add(shell(el).barTables);
    }
    expect(api.listDrafts).toHaveBeenCalledWith("v9", expect.anything());
    expect(shown).toEqual(shown.map(() => ["Floor", "[✎ T9]"]));
    expect(arrays.size).toBe(1);

    release();
    await flush(el, 6);
    expect(draft(el).lines).toHaveLength(1);
    expect(bar(el)).toEqual(["Floor", "[✎ T9]"]);
    expect(arrays.has(shell(el).barTables)).toBe(true);
  });

  it("rebuilds the buttons for the next person", async () => {
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([mesa4With("p1"), mesa9]),
    });
    await flush(el);
    await signIn(el);
    await toFloor(el);
    expect(bar(el)).toEqual(["[Floor]", "✎ T4"]);
    emit(shell(el), "logout");
    await flush(el);
    await signIn(el, "p2", "Sam");
    await toFloor(el);
    expect(bar(el)).toEqual(["[Floor]"]);
  });

  it("keeps a hidden zone's table's ✎ button", async () => {
    const { el } = await mountApp({
      getDeviceZones: vi.fn().mockResolvedValue(deviceZonesFixture(undefined, ["z2"])),
      getTablesState: vi.fn().mockResolvedValue([mesa4With("p1"), table("t5", "T5", null, "z2")]),
    });
    await flush(el);
    await signIn(el);
    await toFloor(el);
    expect(bar(el)).toEqual(["[Floor]", "✎ T4"]);
  });

  it("keeps ✎ T9 when a later floor read fails", async () => {
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([mesa4, table("t5", "T5", null), mesa9WithAnas]),
      seatTable: vi.fn().mockResolvedValue({ tabId: "wo-5", partyId: "v5", revision: 1 }),
    });
    await flush(el);
    await signIn(el);
    await toFloor(el);
    expect(bar(el)).toEqual(["[Floor]", "✎ T9"]);
    api.getTablesState!.mockRejectedValue(new TypeError("Failed to fetch"));

    // Seating re-reads the floor through `#reloadTables`, which empties `tables` when it fails.
    emit(floor(el)!, "open-table", { tableId: "t5", seated: false, guestCount: 2 });
    await flush(el, 6);
    expect(api.seatTable).toHaveBeenCalledOnce();
    expect(api.getTablesState!.mock.settledResults.at(-1)?.type).toBe("rejected");
    expect(bar(el)).toEqual(["Floor", "[T5]", "✎ T9"]);
  });

  it("selects Floor on the Order screen with no table", async () => {
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([mesa4With("p1"), mesa9]),
    });
    await flush(el);
    await signIn(el);
    await toFloor(el);
    history.pushState(null, "", "/tabs/order");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await flush(el);
    expect(tableOrder(el)).not.toBeNull();
    expect(bar(el)).toEqual(["[Floor]", "✎ T4"]);
  });
});

describe("till-app: a till's bar", () => {
  it("has no table buttons", async () => {
    const { el } = await mountApp(
      { getTablesState: vi.fn().mockResolvedValue([mesa4With("p1"), mesa9WithAnas]) },
      "till",
    );
    await openMesa(el);
    await tap(el, "Beer");
    expect(shell(el).shadowRoot!.querySelectorAll("[data-bar-table]")).toHaveLength(0);
    expect(shell(el).barTables).toEqual([]);
  });
});

type SaveAnswer = "saved" | "failed" | { code: string; ownerName?: string };

/** Holds the next draft save until the returned function answers it as saved, failed or refused. */
function holdNextSave(): (answer?: SaveAnswer) => void {
  let release!: (answer: SaveAnswer) => void;
  const held = new Promise<SaveAnswer>((resolve) => (release = resolve));
  server.saveDraft.mockImplementationOnce(async (partyId, save) => {
    const sentBy = server.personId;
    const answer = await held;
    if (answer === "failed") throw new TypeError("Failed to fetch");
    if (answer !== "saved") throw answer;
    const now = server.personId;
    server.personId = sentBy;
    const saved = server.save(partyId, save);
    server.personId = now;
    return server.snapshot(saved);
  });
  return (answer = "saved") => release(answer);
}

/** Holds the next floor read until the returned function lets it answer `tables`. */
function holdNextTablesRead(tables: TableState[]): () => void {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  api.getTablesState!.mockImplementationOnce(async () => {
    await held;
    return tables;
  });
  return release;
}

describe("till-app: a table left for another keeps its button", () => {
  /** Ana at T4 with Beer added, T9 on the bar from an earlier visit, and T4's save held open. */
  async function leaveT4ForT9(formFactor: FormFactor = phone, overrides = {}) {
    const { el } = await mountApp(
      { getTablesState: vi.fn().mockResolvedValue([mesa4, mesa9WithAnas]), ...overrides },
      formFactor,
    );
    await openMesa(el);
    const answer = holdNextSave();
    await tap(el, "Beer");
    return { el, answer };
  }

  async function openT9(el: TillApp): Promise<void> {
    barButton(el, "t9").click();
    await flush(el, 1);
  }

  it("keeps ✎ T4 while T4's save is out after ✎ T9 is tapped", async () => {
    const { el, answer } = await leaveT4ForT9();
    expect(bar(el)).toEqual(["Floor", "[✎ T4]", "✎ T9"]);
    await openT9(el);
    expect(bar(el)).toContain("✎ T4");
    await flush(el, 6);
    expect(api.saveDraft).toHaveBeenCalledOnce();
    expect(tableOrder(el)?.party?.id).toBe("v9");
    expect(selected(el)).toEqual(["T9"]);
    expect(bar(el)).toContain("✎ T4");
    answer();
    await flush(el, 6);
  });

  it("keeps ✎ T4 after the save answers, until a floor read started later says so", async () => {
    const { el, answer } = await leaveT4ForT9();
    await openT9(el);
    await flush(el, 6);
    const reads = api.getTablesState!.mock.calls.length;
    const answerRead = holdNextTablesRead([mesa4With("p1"), mesa9WithAnas]);
    answer();
    await flush(el, 6);
    expect(api.getTablesState).toHaveBeenCalledTimes(reads + 1);
    expect(bar(el)).toContain("✎ T4");
    answerRead();
    await flush(el, 6);
    expect(bar(el)).toContain("✎ T4");

    // From here the floor read decides for T4.
    api.getTablesState!.mockResolvedValue([mesa4, mesa9WithAnas]);
    await toFloor(el);
    expect(bar(el)).not.toContain("✎ T4");
  });

  it("drops T4's button at once when its last dish was removed before leaving, and the later read keeps it gone", async () => {
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([mesa4, mesa9WithAnas]),
    });
    await openMesa(el);
    await tap(el, "Beer");
    await waitForSave();
    api.getTablesState!.mockResolvedValue([mesa4With("p1"), mesa9WithAnas]);
    await toFloor(el);
    barButton(el, "t4").click();
    await flush(el);
    expect(bar(el)).toEqual(["Floor", "[✎ T4]", "✎ T9"]);

    const answer = holdNextSave();
    draft(el).removeLine(0);
    await flush(el, 1);
    await openT9(el);
    expect(bar(el).some((tab) => tab.includes("T4"))).toBe(false);
    api.getTablesState!.mockResolvedValue([mesa4, mesa9WithAnas]);
    const reads = api.getTablesState!.mock.calls.length;
    answer();
    await flush(el, 6);
    expect(api.getTablesState!.mock.calls.length).toBeGreaterThan(reads);
    expect(bar(el).some((tab) => tab.includes("T4"))).toBe(false);
  });

  it("keeps ✎ T4 while T4's save has failed", async () => {
    const { el, answer } = await leaveT4ForT9();
    await openT9(el);
    await flush(el, 6);
    answer("failed");
    await flush(el, 6);
    expect(bar(el)).toContain("✎ T4");

    barButton(el, "t4").click();
    await flush(el, 6);
    expect(tableOrder(el)?.party?.id).toBe("v1");
    expect(tableOrder(el)!.retainedDraft?.lines.map((line) => line.product.name)).toEqual(["Beer"]);
    expect(bar(el)).toContain("[✎ T4]");
  });

  it("a till starts no extra floor read when a draft is released", async () => {
    const { el, answer } = await leaveT4ForT9("till");
    // A till's Floor waits for the save before it reads, so T9 is opened from T4's screen.
    emit(tableOrder(el)!, "open-table", { tableId: "t9", seated: true });
    await flush(el, 6);
    expect(tableOrder(el)?.party?.id).toBe("v9");
    const reads = api.getTablesState!.mock.calls.length;
    answer();
    await flush(el, 6);
    expect(api.saveDraft).toHaveBeenCalledOnce();
    expect(api.getTablesState).toHaveBeenCalledTimes(reads);
  });

  it("drops T4's kept button and re-reads the floor when T4's save is refused", async () => {
    const { el, answer } = await leaveT4ForT9();
    await openT9(el);
    await flush(el, 6);
    const reads = api.getTablesState!.mock.calls.length;
    const answerRead = holdNextTablesRead([mesa4With("p2"), mesa9WithAnas]);
    answer({ code: "draft.taken_over", ownerName: "Sam" });
    await flush(el, 6);
    expect(api.getTablesState).toHaveBeenCalledTimes(reads + 1);
    expect(bar(el).some((tab) => tab.includes("T4"))).toBe(false);
    answerRead();
    await flush(el, 6);
    expect(bar(el).some((tab) => tab.includes("T4"))).toBe(false);
  });

  it.each<[string, SaveAnswer]>([
    ["saved", "saved"],
    ["refused", { code: "draft.taken_over", ownerName: "Sam" }],
  ])(
    "starts no floor read when the person signs out before the save answers (%s)",
    async (_, saved) => {
      const { el, answer } = await leaveT4ForT9();
      await openT9(el);
      await flush(el, 6);
      emit(shell(el), "logout");
      await flush(el);
      expect(lock(el)).not.toBeNull();
      const reads = api.getTablesState!.mock.calls.length;
      answer(saved);
      await flush(el, 6);
      expect(api.getTablesState).toHaveBeenCalledTimes(reads);

      await signIn(el);
      await toFloor(el);
      expect(bar(el)).toEqual(["[Floor]"]);
    },
  );

  it("keeps ✎ T4 when T4's save had already failed before leaving", async () => {
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([mesa4, mesa9WithAnas]),
      saveDraft: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    await openMesa(el);
    await tap(el, "Beer");
    await waitForSave();
    await flush(el);
    expect(draft(el).lines).toHaveLength(0);
    expect(tableOrder(el)!.retainedDraft?.lines).toHaveLength(1);
    await openT9(el);
    expect(bar(el)).toContain("✎ T4");
    await flush(el, 6);
    expect(bar(el)).toContain("✎ T4");
  });

  /** T4 left for T9 with Beer unsaved: T4's save fails and its button stays. */
  async function failT4Save(el: TillApp, answer: (answer?: SaveAnswer) => void): Promise<void> {
    await openT9(el);
    await flush(el, 6);
    answer("failed");
    await flush(el, 6);
    expect(bar(el)).toContain("✎ T4");
  }

  it("drops T4's kept button once T4 is reopened, its kept copy discarded and T4 left again", async () => {
    const { el, answer } = await leaveT4ForT9();
    await failT4Save(el, answer);
    barButton(el, "t4").click();
    await flush(el, 6);
    const candidate = tableOrder(el)!.retainedDraft!;
    expect(candidate.lines).toHaveLength(1);
    emit(tableOrder(el)!, "resolve-draft-candidate", { candidate, apply: false });
    await flush(el, 6);
    expect(tableOrder(el)!.retainedDraft ?? null).toBeNull();

    const reads = api.getTablesState!.mock.calls.length;
    emit(tableOrder(el)!, "open-table", { tableId: "t9", seated: true });
    await flush(el, 6);
    expect(tableOrder(el)?.party?.id).toBe("v9");
    expect(api.getTablesState!.mock.calls.length).toBeGreaterThan(reads);
    expect(bar(el).some((tab) => tab.includes("T4"))).toBe(false);
  });

  it("gives the next person no button for the last person's kept table after a restart with no sign-out", async () => {
    const { el, answer } = await leaveT4ForT9();
    await failT4Save(el, answer);
    emit(shell(el), "device-unauthorized");
    await flush(el, 6);
    expect(lock(el)).not.toBeNull();
    await signIn(el, "p2", "Sam");
    await toFloor(el);
    expect(bar(el)).toEqual(["[Floor]"]);
  });

  it("drops the kept button when the server changes", async () => {
    const data = new Map<string, string>();
    const router = new ServerRouter({
      origin: "https://box.deli.test",
      fetchImpl: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
      storage: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) },
    });
    api = stubApi(phone, { getTablesState: vi.fn().mockResolvedValue([mesa4, mesa9WithAnas]) });
    const { el } = await mountWidget<TillApp>("till-app", {
      api: api as unknown as TillApi,
      router,
    });
    await openMesa(el);
    const answer = holdNextSave();
    await tap(el, "Beer");
    await failT4Save(el, answer);
    router.dispatchEvent(
      new CustomEvent("server-changed", {
        detail: { from: "https://box.deli.test", to: "https://cloud.deli.test" },
      }),
    );
    await flush(el, 6);
    await signIn(el);
    await toFloor(el);
    expect(bar(el)).toEqual(["[Floor]"]);
  });

  it("lets only a floor read started after the save answered drop the kept button", async () => {
    const { el, answer } = await leaveT4ForT9();
    await openT9(el);
    await flush(el, 6);
    const answerBefore = holdNextTablesRead([mesa4, mesa9WithAnas]);
    const answerAfter = holdNextTablesRead([mesa4With("p1"), mesa9WithAnas]);
    const reads = api.getTablesState!.mock.calls.length;
    await toFloor(el);
    expect(api.getTablesState).toHaveBeenCalledTimes(reads + 1);
    answer();
    await flush(el, 6);
    expect(api.getTablesState).toHaveBeenCalledTimes(reads + 2);

    answerBefore();
    await flush(el, 6);
    expect(bar(el)).toContain("✎ T4");
    answerAfter();
    await flush(el, 6);
    expect(bar(el)).toContain("✎ T4");
  });

  it("keeps ✎ T4 when a floor read after its save fails", async () => {
    const { el, answer } = await leaveT4ForT9(phone, {
      getTablesState: vi.fn().mockResolvedValue([mesa4, table("t5", "T5", null), mesa9WithAnas]),
      seatTable: vi.fn().mockResolvedValue({ tabId: "wo-5", partyId: "v5", revision: 1 }),
    });
    await openT9(el);
    await flush(el, 6);
    api.getTablesState!.mockRejectedValue(new TypeError("Failed to fetch"));
    answer();
    await flush(el, 6);
    expect(bar(el)).toContain("✎ T4");

    // Seating re-reads the floor through `#reloadTables`, which applies a failed read as no tables.
    await toFloor(el);
    emit(floor(el)!, "open-table", { tableId: "t5", seated: false, guestCount: 2 });
    await flush(el, 6);
    expect(api.seatTable).toHaveBeenCalledOnce();
    expect(api.getTablesState!.mock.settledResults.at(-1)?.type).toBe("rejected");
    expect(bar(el)).toContain("✎ T4");
  });
});
