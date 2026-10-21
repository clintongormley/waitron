import {
  current,
  currentGroup,
  row,
  orderGroup,
} from "./screens/till-table-order-screen.current-orders.test-helpers.js";
import { deviceZonesFixture } from "../test/device-zones.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILD_CHANGED_EVENT } from "@waitron/diagnostics";
import { leaveCoordinatorFor, type WtCombobox } from "@waitron/ui";
import type { TillDeadEndsSection } from "./widgets/dead-ends-section.js";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { commands, page, userEvent } from "vitest/browser";
import {
  cleanupWidgets,
  expectNoA11yViolations,
  draftServer,
  mountWidget,
  type DraftServer,
} from "./widgets/test-helpers.js";
import { SUBMIT_RETRY_PAUSE_MS, TillApp } from "./till-app.js";
import { setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import {
  DRAFT_SAVE_DELAY_MS,
  DraftSync,
  type DraftCommandState,
  type DraftCommandOutcome,
} from "./state/draft-sync.js";
import { WorkingOrderStore } from "./state/working-order.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import { openDraftLine, resized } from "./screens/till-table-order-screen.test-helpers.js";
import type { TillFloorScreen } from "./screens/till-floor-screen.js";
import type { TillMenuBrowser } from "./widgets/menu-browser.js";
import type { TillProfileDialog } from "./widgets/profile-dialog.js";
import type { FormFactor, CapabilityFlag } from "./layout.js";
import type {
  FreshDraftLineInput,
  OrderGroup,
  TableState,
  TableParty,
  TillApi,
  TillMenuOffer,
  ZoneOfferCatalogue,
} from "./api/client.js";
import { openSentDish, openSentMore } from "./screens/till-table-order-screen.sent.test-helpers.js";
import { HOME_DISPLAY_DEFAULTS } from "@waitron/catalogue/src/device-home.js";

// Mesa 4 holds party v1, on tab wo-4, in zone z1, whose Lunch menu offers Beer, Steak and Flan.

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

const drillFormFactor: FormFactor = "till";

const orderTabFormFactor: FormFactor = "tablet-landscape";

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
  server.bills.add("wo-7");
  server.bills.add("wo-new");
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
    menuState: vi.fn(() => new Promise(() => {})),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
    getTablesState: vi.fn().mockResolvedValue([mesa4, mesa7]),
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
  if (overrides.previewPartyAllergy === undefined) {
    api.previewPartyAllergy = vi.fn(async (partyId: string) => {
      const shown = tableOrder(opened)?.party;
      if (shown?.id !== partyId) throw new Error("The answered party fixture is not open");
      return {
        partyId,
        snapshot: {
          answer: "none",
          guests: [],
          ticks: [],
          changedAt: null,
          changedBy: null,
          revision: shown.revision,
        },
        dishes: [],
      };
    });
  }
  const mounted = await mountWidget<TillApp>(
    "till-app",
    {
      api: api as unknown as TillApi,
      ...(sessionActivity ? { sessionActivity } : {}),
    },
    theme,
  );
  const opened = mounted.el;
  return mounted;
}

async function flush(el: TillApp, rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}

function emit(source: Element, type: string, detail?: unknown): void {
  if (
    type === "change-line" &&
    typeof detail === "object" &&
    detail !== null &&
    !Object.hasOwn(detail, "expectedEdit")
  ) {
    detail = { ...detail, expectedEdit: (source as TillTableOrderScreen).billEdit };
  }
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
const banner = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>(".error");
const browser = (el: TillApp) =>
  tableOrder(el)!.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser");
const draft = (el: TillApp) => tableOrder(el)!.draftStore!;
const rows = (el: TillApp) =>
  draft(el).lines.map((line) => `${line.product.name} ×${line.quantity}`);
const retainedCandidate = (el: TillApp) => tableOrder(el)!.retainedDraft;

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

/** Taps a dish's tile, without waiting. */
function press(el: TillApp, name: string): void {
  [...browser(el)!.shadowRoot!.querySelectorAll<HTMLElement>("wt-button")]
    .find((button) => button.querySelector(".name")?.textContent === name)!
    .click();
}

async function tap(el: TillApp, name: string): Promise<void> {
  press(el, name);
  await flush(el);
}

async function toggle(el: TillApp, name: string): Promise<void> {
  [...tableOrder(el)!.shadowRoot!.querySelectorAll<HTMLElement>("[data-draft-select]")]
    .find((button) => button.textContent!.includes(name))!
    .click();
  await flush(el);
}

async function act(el: TillApp, kind: string): Promise<void> {
  if (kind === "fire-all") {
    for (const row of tableOrder(el)!.shadowRoot!.querySelectorAll<HTMLElement>(
      '[data-draft-select][aria-pressed="false"]',
    ))
      row.click();
    await flush(el);
    kind = "fire-selected";
  }
  tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>(`[data-draft-action="${kind}"]`)!.click();
  await flush(el, 6);
}

async function back(el: TillApp): Promise<void> {
  tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>("[data-back]")!.click();
  await flush(el);
}

const savedLines = () =>
  server.drafts.flatMap((each) =>
    each.lines.map((line) => `${line.menuItemId} ×${Number(line.quantity)}`),
  );

describe("W69 unassigned table draft", () => {
  async function opening(
    overrides: Record<string, unknown> = {},
    activity?: TillApp["sessionActivity"],
    theme?: "light" | "dark",
  ) {
    const mounted = await mountApp(
      {
        getTablesState: vi.fn().mockResolvedValue([mesa4, table("t9", "9", null)]),
        ...overrides,
      },
      activity,
      theme,
    );
    await openMesa(mounted.el, "t9");
    return mounted;
  }
  function unloadCancelled() {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }
  async function question(el: TillApp) {
    await flush(el);
    const warning =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>(
        "wt-unsaved-changes",
      )!;
    await warning.updateComplete;
    return warning;
  }
  async function decide(el: TillApp, decision: "keep" | "discard") {
    emit(await question(el), "wt-unsaved-choice", { decision });
    await flush(el, 6);
  }

  it("retains carried dishes for review when the newly seated bill cannot be read", async () => {
    const { el } = await opening({
      seatTable: vi.fn(async () => {
        api.getTablesState.mockResolvedValue([
          mesa4,
          table("t9", "9", party({ id: "v-new", mainBillId: "wo-new", tableIds: ["t9"] })),
        ]);
        return { partyId: "v-new", tabId: "wo-new", revision: 0, orderNumber: 12 };
      }),
    });
    await tap(el, "Beer");
    await back(el);
    api.listDrafts.mockRejectedValueOnce(new TypeError("offline after seating"));
    emit(floor(el)!, "open-table", { tableId: "t9", seated: false, guestCount: 2 });
    await flush(el, 6);
    expect(tableOrder(el)!.draftStore).toBeNull();
    expect(api.saveDraft).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("focus"));
    await flush(el, 6);
    expect(rows(el)).toEqual([]);
    expect(
      tableOrder(el)!.shadowRoot!.querySelector("[data-draft-candidate]")?.textContent ?? "",
    ).toContain("Beer");
    expect(draft(el).editsLocked).toBe(true);
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it("places carried dishes as a first table order only when the table is seated", async () => {
    const { el } = await opening({
      getTill: vi.fn().mockResolvedValue({
        ...till(drillFormFactor),
        courses: [
          { id: "drinks", name: "Drinks", displayOrder: 0, heldUntilFired: false },
          { id: "mains", name: "Mains", displayOrder: 1, heldUntilFired: true },
          { id: "desserts", name: "Desserts", displayOrder: 2, heldUntilFired: true },
        ],
      }),
      seatTable: vi.fn(async () => {
        api.getTablesState!.mockResolvedValue([
          mesa4,
          table(
            "t9",
            "9",
            party({ id: "v-new", mainBillId: "wo-new", revision: 0, tableIds: ["t9"] }),
          ),
        ]);
        return { partyId: "v-new", tabId: "wo-new", revision: 0, orderNumber: 12 };
      }),
    });
    await tap(el, "Flan");
    await tap(el, "Steak");
    await tap(el, "Beer");
    expect(draft(el).lines.map((line) => line.place)).toEqual([undefined, undefined, undefined]);
    await back(el);
    emit(floor(el)!, "open-table", { tableId: "t9", seated: false, guestCount: 2 });
    await flush(el, 6);

    expect(draft(el).lines.map((line) => ({ name: line.product.name, place: line.place }))).toEqual(
      [
        { name: "Flan", place: { kind: "new", slot: 2 } },
        { name: "Steak", place: { kind: "new", slot: 1 } },
        { name: "Beer", place: { kind: "fire" } },
      ],
    );
    await back(el);
    expect(server.drafts).toHaveLength(1);
    expect(
      server.drafts[0]!.lines.map(({ menuItemId, slot, joinGroupId, afterGroupId }) => ({
        menuItemId,
        slot,
        joinGroupId,
        afterGroupId,
      })),
    ).toEqual([
      { menuItemId: "offer-flan", slot: 2, joinGroupId: null, afterGroupId: null },
      { menuItemId: "offer-steak", slot: 1, joinGroupId: null, afterGroupId: null },
      { menuItemId: "offer-beer", slot: 0, joinGroupId: null, afterGroupId: null },
    ]);
  });

  it("protects memory-only lines and clears unload protection when the edit is reverted", async () => {
    const { el } = await opening();
    expect(unloadCancelled()).toBe(false);
    await tap(el, "Beer");
    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(unloadCancelled()).toBe(true);
    draft(el).removeLine(0);
    await flush(el);
    expect(unloadCancelled()).toBe(false);
    expect(server.saveDraft).not.toHaveBeenCalled();
  });

  it("retains its memory-only lines through tabs, but asks before another table replaces them", async () => {
    const { el } = await opening();
    await tap(el, "Beer");
    const original = draft(el);
    await back(el);
    expect((await question(el)).open).toBe(false);
    expect(original.lines.map((line) => line.quantity)).toEqual(["1"]);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    expect((await question(el)).open).toBe(true);
    expect(unloadCancelled()).toBe(true);
    await decide(el, "keep");
    expect(original.lines.map((line) => line.product.name)).toEqual(["Beer"]);
    expect(tableOrder(el)).toBeNull();
    expect(server.listDrafts).not.toHaveBeenCalled();
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await decide(el, "discard");
    expect(rows(el)).toEqual([]);
    expect(server.listDrafts).toHaveBeenCalledTimes(1);
    expect(server.saveDraft).not.toHaveBeenCalled();
    expect(unloadCancelled()).toBe(false);
  });

  it("asks before voluntary signout; Keep retains lines and Discard sends only logout", async () => {
    const { el } = await opening();
    await tap(el, "Beer");
    const original = draft(el);
    emit(shell(el), "logout");
    expect((await question(el)).open).toBe(true);
    await decide(el, "keep");
    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(api.logout).not.toHaveBeenCalled();
    emit(shell(el), "logout");
    await decide(el, "discard");
    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(lock(el)).not.toBeNull();
    expect(original.lines).toEqual([]);
    expect(server.saveDraft).not.toHaveBeenCalled();
    expect(server.submitDraft).not.toHaveBeenCalled();
    expect(unloadCancelled()).toBe(false);
  });

  it.each(["clean", "reverted"])("%s draft opens another table directly", async (state) => {
    const { el } = await opening();
    if (state === "reverted") {
      await tap(el, "Beer");
      draft(el).removeLine(0);
      await flush(el);
    }
    await back(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el, 6);
    expect((await question(el)).open).toBe(false);
    expect(rows(el)).toEqual([]);
    expect(server.listDrafts).toHaveBeenCalledTimes(1);
    expect(unloadCancelled()).toBe(false);
  });

  it("a refused table read after Discard keeps the memory-only draft unload-protected", async () => {
    const { el } = await opening({
      getTablesState: vi
        .fn()
        .mockResolvedValue([{ ...mesa4, zoneId: "z2" }, table("t9", "9", null)]),
    });
    await tap(el, "Beer");
    const original = draft(el);
    await back(el);
    api.listZoneOffers!.mockRejectedValueOnce({ code: "connection.failed" });
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await decide(el, "discard");
    expect(tableOrder(el)).toBeNull();
    expect(original.lines.map((line) => line.product.name)).toEqual(["Beer"]);
    expect(unloadCancelled()).toBe(true);
    expect(server.listDrafts).not.toHaveBeenCalled();
    expect(server.saveDraft).not.toHaveBeenCalled();
  });

  it("a changed course invalidates an old replacement answer, while a display notification does not", async () => {
    const { el } = await opening();
    await tap(el, "Beer");
    const original = draft(el);
    await back(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    const q = await question(el);
    const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
    original.emit("changed");
    await flush(el);
    expect(q.open).toBe(true);
    original.setLineCourse(0, "desserts");
    await flush(el);
    expect(q.open).toBe(false);
    oldDiscard.click();
    await flush(el);
    expect(original.lines[0]!.courseId).toBe("desserts");
    expect(server.listDrafts).not.toHaveBeenCalled();
    expect(tableOrder(el)).toBeNull();
    expect(unloadCancelled()).toBe(true);
  });

  it("disconnect cancels a pending table replacement and removes unload protection", async () => {
    const { el } = await opening();
    await tap(el, "Beer");
    await back(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    const q = await question(el);
    expect(q.open).toBe(true);
    const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
    el.remove();
    await flush(el);
    expect(q.open).toBe(false);
    expect(unloadCancelled()).toBe(false);
    oldDiscard.click();
    await flush(el);
    expect(server.listDrafts).not.toHaveBeenCalled();
  });

  it("inactivity lock clears the unassigned draft and cancels its question without waiting", async () => {
    const activity = {
      configure: vi.fn(),
      noteInteraction: vi.fn(),
      reacquire: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const { el } = await opening({}, activity as never);
    await tap(el, "Beer");
    const original = draft(el);
    emit(shell(el), "logout");
    const q = await question(el);
    expect(q.open).toBe(true);
    const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
    const config = activity.configure.mock.calls.at(-1)![0] as { onIdle: () => void };
    config.onIdle();
    await flush(el);
    expect(q.open).toBe(false);
    expect(lock(el)).not.toBeNull();
    expect(original.lines).toEqual([]);
    expect(unloadCancelled()).toBe(false);
    oldDiscard.click();
    await flush(el);
    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(server.saveDraft).not.toHaveBeenCalled();
    expect(server.submitDraft).not.toHaveBeenCalled();
  });

  it("party drafts still save automatically and leave without a form warning", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    expect(unloadCancelled()).toBe(false);
    await back(el);
    expect((await question(el)).open).toBe(false);
    await expect.poll(savedLines).toEqual(["offer-beer ×1"]);
    expect(unloadCancelled()).toBe(false);
  });

  for (const locale of ["en-GB", "es-ES"])
    for (const theme of ["light", "dark"] as const)
      for (const width of [390, 1280])
        it(`native table replacement Escape/Keep/Discard, ${locale}, ${theme}, ${width}`, async () => {
          const size = { width: window.innerWidth, height: window.innerHeight };
          await page.viewport(width, 900);
          try {
            const { el } = await opening(
              { getTill: vi.fn().mockResolvedValue({ ...till(drillFormFactor), locale }) },
              undefined,
              theme,
            );
            await tap(el, "Beer");
            const original = draft(el);
            await back(el);
            const target =
              floor(el)!.shadowRoot!.querySelector<HTMLButtonElement>("[data-table=t4]")!;
            await userEvent.click(target);
            const q = await question(el);
            expect(q.open).toBe(true);
            const keep = q
              .shadowRoot!.querySelector("[data-choice=keep]")!
              .shadowRoot!.querySelector("button")!;
            await expect.poll(() => keep.matches(":focus")).toBe(true);
            expect(q.heading).toBe(
              locale === "en-GB"
                ? "Discard unsaved changes?"
                : "¿Descartar los cambios sin guardar?",
            );
            await commands.parkPointer();
            await expectNoA11yViolations(q);
            await page.screenshot({
              path: `__screenshots__/w69-partyless-look/${locale}-${theme}-${width}-warning.png`,
            });
            await userEvent.keyboard("{Escape}");
            await expect.poll(() => q.open).toBe(false);
            expect(original.lines.map((line) => line.product.name)).toEqual(["Beer"]);
            await expect.poll(() => target.matches(":focus")).toBe(true);
            await userEvent.click(target);
            await expect.poll(() => q.open).toBe(true);
            await userEvent.click(keep);
            await expect.poll(() => q.open).toBe(false);
            expect(server.listDrafts).not.toHaveBeenCalled();
            await page.screenshot({
              path: `__screenshots__/w69-partyless-look/${locale}-${theme}-${width}-kept.png`,
            });
            await userEvent.click(target);
            await expect.poll(() => q.open).toBe(true);
            await userEvent.click(
              q
                .shadowRoot!.querySelector("[data-choice=discard]")!
                .shadowRoot!.querySelector("button")!,
            );
            await expect.poll(() => tableOrder(el)).not.toBeNull();
            expect(rows(el)).toEqual([]);
            expect(server.listDrafts).toHaveBeenCalledTimes(1);
            expect(server.saveDraft).not.toHaveBeenCalled();
            expect(unloadCancelled()).toBe(false);
          } finally {
            cleanupWidgets();
            await page.viewport(size.width, size.height);
          }
        });
});

it("asks where a refused line edit should be made and retries with the chosen station", async () => {
  const updateOrderLine = vi
    .fn()
    .mockRejectedValueOnce({ code: "station.no_replacement" })
    .mockResolvedValueOnce({ revision: 1, party: { id: "v1", revision: 4 } });
  const askSaleDeadEnds = vi.fn().mockResolvedValue({
    sends: true,
    deadEnds: [
      {
        key: "0",
        name: "Beer",
        quantity: "2",
        stationId: "bar",
        stationName: "Upstairs bar",
        why: "switched_off",
      },
    ],
    stations: [{ id: "kitchen", name: "Kitchen", open: true }],
  });
  const { el } = await mountApp({ updateOrderLine, askSaleDeadEnds });
  const order = await openMesa(el);
  emit(order, "change-line", {
    lineNo: 1,
    lineName: "Beer",
    patch: { quantity: "2" },
    revision: 0,
    saleLine: { menuItemId: "offer-beer", quantity: "2" },
  });
  await flush(el);
  expect(askSaleDeadEnds).toHaveBeenCalledWith(
    [{ menuItemId: "offer-beer", quantity: "2" }],
    "wo-4",
  );
  const dialog = el.shadowRoot!.querySelector<HTMLElement>("[data-edit-dead-ends]")!;
  expect(dialog).not.toBeNull();
  const section = dialog.querySelector<HTMLElement>("till-dead-ends-section")!;
  section.dispatchEvent(new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }));
  await flush(el);
  dialog.querySelector<HTMLElement>("[data-edit-dead-ends-retry]")!.click();
  await flush(el);
  expect(updateOrderLine).toHaveBeenLastCalledWith(
    "wo-4",
    1,
    { quantity: "2", makeAt: "kitchen" },
    0,
    tableOrder(el)!.billEdit,
  );
});

it.each(["light", "dark"] as const)(
  "draws the refused edit's Confirm quiet like Cancel until a station is chosen, then blue (%s theme)",
  async (theme) => {
    const { el } = await mountApp(
      {
        updateOrderLine: vi.fn().mockRejectedValueOnce({ code: "station.no_replacement" }),
        askSaleDeadEnds: vi.fn().mockResolvedValue({
          sends: true,
          deadEnds: [
            {
              key: "0",
              name: "Beer",
              quantity: "2",
              stationId: "bar",
              stationName: "Upstairs bar",
              why: "switched_off",
            },
          ],
          stations: [{ id: "kitchen", name: "Kitchen", open: true }],
        }),
      },
      undefined,
      theme,
    );
    const order = await openMesa(el);
    emit(order, "change-line", {
      lineNo: 1,
      lineName: "Beer",
      patch: { quantity: "2" },
      revision: 0,
      saleLine: { menuItemId: "offer-beer", quantity: "2" },
    });
    await flush(el);
    const dialog = el.shadowRoot!.querySelector<HTMLElement>("[data-edit-dead-ends]")!;
    const confirm = dialog.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-edit-dead-ends-retry]",
    )!;
    const fill = (host: Element) =>
      getComputedStyle(host.shadowRoot!.querySelector("button")!).backgroundColor;
    const cancelFill = fill(dialog.querySelector("[data-edit-dead-ends-cancel]")!);
    await confirm.updateComplete;
    expect(confirm.hasAttribute("disabled")).toBe(true);
    expect(confirm.getAttribute("variant")).toBe("secondary");
    expect(fill(confirm)).toBe(cancelFill);
    dialog
      .querySelector<HTMLElement>("till-dead-ends-section")!
      .dispatchEvent(new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }));
    await flush(el);
    await confirm.updateComplete;
    expect(confirm.hasAttribute("disabled")).toBe(false);
    expect(confirm.getAttribute("variant")).toBe("primary");
    expect(fill(confirm)).not.toBe(cancelFill);
  },
);

describe("dead-end questions with no timely answer", () => {
  afterEach(() => vi.useRealTimers());

  async function settleTimers(el: TillApp): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;
    }
  }

  it("shows the original edit refusal after a stalled station question", async () => {
    const { el } = await mountApp({
      updateOrderLine: vi.fn().mockRejectedValue({ code: "station.no_replacement" }),
      askSaleDeadEnds: vi.fn(() => new Promise(() => {})),
    });
    const order = await openMesa(el);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    emit(order, "change-line", {
      lineNo: 1,
      lineName: "Beer",
      patch: { quantity: "2" },
      revision: 0,
      saleLine: { menuItemId: "offer-beer", quantity: "2" },
    });
    await settleTimers(el);
    expect(api.askSaleDeadEnds).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2_999);
    await settleTimers(el);
    expect(banner(el)).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await settleTimers(el);
    expect(el.shadowRoot!.querySelector("[data-edit-dead-ends]")).toBeNull();
    expect(banner(el)!.textContent).toContain(t("table.error"));
  });

  it("keeps direct Send available through a timed-out automatic check and ignores its late answer", async () => {
    let answer!: (value: unknown) => void;
    const askDraftDeadEnds = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    const { el } = await mountApp({ askDraftDeadEnds });
    await openMesa(el);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    press(el, "Beer");
    await settleTimers(el);
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS);
    await settleTimers(el);
    await vi.advanceTimersByTimeAsync(400);
    await settleTimers(el);
    expect(askDraftDeadEnds).toHaveBeenCalledOnce();
    const savedId = server.drafts[0]!.lines[0]!.id;
    const screen = tableOrder(el)!;
    const send = () =>
      screen.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
        '[data-draft-action="send-all"]',
      )!;
    expect(send().disabled).toBe(false);
    await vi.advanceTimersByTimeAsync(2_999);
    await settleTimers(el);
    expect(send().disabled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await settleTimers(el);
    expect(send().disabled).toBe(false);
    answer({
      sends: true,
      deadEnds: [
        {
          key: savedId,
          name: "Beer",
          quantity: "1",
          stationId: "bar",
          stationName: "Upstairs bar",
          why: "closed",
        },
      ],
      stations: [{ id: "kitchen", name: "Kitchen", open: true }],
    });
    await settleTimers(el);
    expect(screen.shadowRoot!.querySelector("till-dead-ends-section")).toBeNull();
    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(rows(el)).toEqual(["Beer ×1"]);
  });
});

it("saves an automatic-warning station choice on the matching live draft line", async () => {
  const askDraftDeadEnds = vi.fn(async (_partyId: string, _draftId: string, lineIds: string[]) => ({
    sends: true,
    deadEnds: [
      {
        key: lineIds[0]!,
        name: "Beer",
        quantity: "1",
        stationId: "bar",
        stationName: "Upstairs bar",
        why: "closed" as const,
      },
    ],
    stations: [{ id: "kitchen", name: "Kitchen", open: true }],
  }));
  const { el } = await mountApp({ askDraftDeadEnds });
  await openMesa(el);
  await tap(el, "Beer");
  await tap(el, "Steak");
  await expect.poll(() => askDraftDeadEnds.mock.calls.length, { timeout: 2000 }).toBe(1);
  const screen = tableOrder(el)!;
  expect(askDraftDeadEnds).toHaveBeenCalledWith(
    "v1",
    server.drafts[0]!.id,
    server.drafts[0]!.lines.map((line) => line.id),
    expect.any(Object),
  );
  expect(screen.shadowRoot!.querySelector("[data-draft-routing-warning]")).not.toBeNull();
  expect(api.submitDraft).not.toHaveBeenCalled();
  screen
    .shadowRoot!.querySelector<HTMLElement>("till-dead-ends-section")!
    .dispatchEvent(new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }));
  await flush(el);
  await act(el, "send-all");
  expect(api.saveDraft.mock.calls.at(-1)![1].lines[0].makeAt).toBe("kitchen");
  expect(api.submitDraft).toHaveBeenCalledOnce();
});

it("refreshes inline routing and keeps the outbox after a direct Send station refusal", async () => {
  const askDraftDeadEnds = vi
    .fn()
    .mockResolvedValueOnce({ sends: true, deadEnds: [], stations: [] })
    .mockImplementationOnce(async (_partyId: string, _draftId: string, ids: string[]) => ({
      sends: true,
      deadEnds: [
        {
          key: ids[0],
          name: "Beer",
          quantity: "1",
          stationId: "bar",
          stationName: "Upstairs bar",
          why: "closed",
        },
      ],
      stations: [{ id: "kitchen", name: "Kitchen", open: true }],
    }));
  const submitDraft = vi.fn().mockRejectedValueOnce({ code: "station.no_replacement" });
  const { el } = await mountApp({ askDraftDeadEnds, submitDraft });
  await openMesa(el);
  await tap(el, "Beer");
  await expect.poll(() => askDraftDeadEnds.mock.calls.length, { timeout: 2000 }).toBe(1);
  await act(el, "send-all");
  await expect.poll(() => askDraftDeadEnds.mock.calls.length).toBe(2);
  await flush(el);
  expect(submitDraft).toHaveBeenCalledOnce();
  expect(askDraftDeadEnds).toHaveBeenCalledTimes(2);
  expect(tableOrder(el)!.shadowRoot!.querySelector("till-dead-ends-section")).not.toBeNull();
  expect(
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      '[data-draft-action="send-all"]',
    )!.disabled,
  ).toBe(true);
  expect(rows(el)).toEqual(["Beer ×1"]);
  expect(savedLines()).toEqual(["offer-beer ×1"]);
});

it("keeps direct Send available when the automatic station question fails", async () => {
  const askDraftDeadEnds = vi.fn().mockRejectedValue(new TypeError("offline"));
  const { el } = await mountApp({ askDraftDeadEnds });
  await openMesa(el);
  await tap(el, "Beer");
  await expect.poll(() => askDraftDeadEnds.mock.calls.length, { timeout: 2000 }).toBe(1);
  await flush(el);
  const screen = tableOrder(el)!;
  expect(screen.shadowRoot!.querySelector("till-dead-ends-section")).toBeNull();
  expect(
    screen.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      '[data-draft-action="send-all"]',
    )!.disabled,
  ).toBe(false);
  await act(el, "send-all");
  expect(api.submitDraft).toHaveBeenCalledOnce();
});

/**
 * A floor read from what the draft server holds when it is asked, and saves that answer late, so a
 * floor read made before a save lands shows no unsent-order mark.
 */
function lateSaveLiveFloor() {
  const save = server.saveDraft.getMockImplementation()!;
  return {
    getTablesState: vi.fn(async () =>
      [mesa4, mesa7].map((each) => ({
        ...each,
        party: {
          ...each.party!,
          unsentDrafts: server.drafts
            .filter((one) => one.partyId === each.party!.id && one.lines.length > 0)
            .map((one) => ({
              billId: one.billId,
              billNumber: 1,
              ownerName: one.ownerName,
              lineCount: one.lines.length,
            })),
        },
      })),
    ),
    saveDraft: vi.fn(async (...args: Parameters<typeof save>) => {
      await new Promise((resolve) => setTimeout(resolve, SLOW_SAVE_MS));
      return save(...args);
    }),
  };
}

const SLOW_SAVE_MS = 30;

async function settle(el: TillApp): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, SLOW_SAVE_MS * 2));
  await flush(el);
}

/** Holds the next save until the returned function is called; it is then saved as the person who
 * sent it, whoever is signed in by then. */
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

/** A submission that records who was signed in when it was sent. */
function submitRecordingWho(sentBy: string[], lostFirst?: (lose: () => void) => void) {
  return vi.fn(async (...args: Parameters<DraftServer["apply"]>) => {
    sentBy.push(server.personId);
    if (lostFirst !== undefined && sentBy.length === 1) {
      await new Promise<void>((resolve) => lostFirst(resolve));
      throw new TypeError("Failed to fetch");
    }
    return structuredClone(server.apply(...args));
  });
}

const unsentMark = (el: TillApp, tableId: string) =>
  floor(el)!
    .shadowRoot!.querySelector(`[data-table="${tableId}"] [data-unsent]`)
    ?.textContent?.trim();

beforeEach(() => {
  setLocale("en");
  server = draftServer();
});
afterEach(cleanupWidgets);

describe("till-app: a table's draft is kept on the server", () => {
  it("keeps each bill's draft separate when switching and returning", async () => {
    const { el } = await mountApp();
    const order = await openMesa(el);
    await tap(el, "Beer");

    emit(order, "take-payment", { workingOrderId: "wo-check" });
    await flush(el);

    expect(server.drafts.map((each) => [each.billId, each.lines.length])).toEqual([["wo-4", 1]]);
    expect(rows(el)).toEqual([]);
    await tap(el, "Steak");
    emit(tableOrder(el)!, "take-payment", { workingOrderId: "wo-4" });
    await flush(el);

    expect(server.drafts.map((each) => [each.billId, each.lines[0]!.menuItemId])).toEqual([
      ["wo-4", "offer-beer"],
      ["wo-check", "offer-steak"],
    ]);
    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(api.submitDraft).not.toHaveBeenCalled();
  });

  it("waits for the old bill's save before showing the next bill's draft", async () => {
    const { el } = await mountApp();
    const order = await openMesa(el);
    await tap(el, "Beer");
    let answer!: () => void;
    api.saveDraft.mockImplementationOnce(async (partyId, save) => {
      await new Promise<void>((resolve) => (answer = resolve));
      return server.snapshot(server.save(partyId, save));
    });

    emit(order, "take-payment", { workingOrderId: "wo-check" });
    await flush(el);
    expect(api.saveDraft).toHaveBeenCalledOnce();
    expect(tableOrder(el)!.orderId).toBe("wo-4");
    answer();
    await flush(el);

    expect(tableOrder(el)!.orderId).toBe("wo-check");
    expect(rows(el)).toEqual([]);
    expect(server.drafts[0]!.billId).toBe("wo-4");
  });

  it("retains the current bill and edits when its draft save gets no answer", async () => {
    const { el } = await mountApp();
    const order = await openMesa(el);
    await tap(el, "Beer");
    api.saveDraft.mockRejectedValue(new TypeError("offline"));

    emit(order, "take-payment", { workingOrderId: "wo-check" });
    await flush(el);

    expect(tableOrder(el)!.orderId).toBe("wo-4");
    expect(rows(el)).toEqual([]);
    expect(retainedCandidate(el)?.lines.map((line) => line.product.name)).toEqual(["Beer"]);
    expect(draft(el).editsLocked).toBe(true);
    expect(banner(el)!.textContent).toContain(t("table.draft_save_failed"));
    expect(api.submitDraft).not.toHaveBeenCalled();
    api.saveDraft.mockImplementation(async (partyId, save) =>
      server.snapshot(server.save(partyId, save)),
    );
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>("[data-candidate-apply]")!.click();
    await flush(el, 6);
    emit(tableOrder(el)!, "take-payment", { workingOrderId: "wo-check" });
    await flush(el);
    expect(tableOrder(el)!.orderId).toBe("wo-check");
    expect(server.drafts[0]!.billId).toBe("wo-4");
  });

  it("ignores a late draft response from the bill left behind", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    let answer!: () => void;
    api.listDrafts.mockImplementationOnce(async (partyId) => {
      await new Promise<void>((resolve) => (answer = resolve));
      return server.listDrafts(partyId);
    });

    emit(tableOrder(el)!, "take-payment", { workingOrderId: "wo-check" });
    await flush(el);
    expect(tableOrder(el)!.orderId).toBe("wo-check");
    expect(tableOrder(el)!.draftStore).toBeNull();
    emit(tableOrder(el)!, "take-payment", { workingOrderId: "wo-4" });
    await flush(el);
    expect(tableOrder(el)!.orderId).toBe("wo-4");
    expect(tableOrder(el)!.draftStore).not.toBeNull();
    expect(rows(el)).toEqual(["Beer ×1"]);
    answer();
    await flush(el);

    expect(tableOrder(el)!.orderId).toBe("wo-4");
    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(banner(el)).toBeNull();
  });

  it("saves an edit made during the bill switch to the original bill", async () => {
    const { el } = await mountApp();
    const order = await openMesa(el);
    await tap(el, "Beer");
    let answer!: () => void;
    api.saveDraft.mockImplementationOnce(async (partyId, save) => {
      await new Promise<void>((resolve) => (answer = resolve));
      return server.snapshot(server.save(partyId, save));
    });

    emit(order, "take-payment", { workingOrderId: "wo-check" });
    await flush(el);
    await tap(el, "Steak");
    answer();
    await flush(el);

    expect(tableOrder(el)!.orderId).toBe("wo-check");
    expect(rows(el)).toEqual([]);
    expect(
      server.drafts.map((each) => [each.billId, each.lines.map((line) => line.menuItemId)]),
    ).toEqual([["wo-4", ["offer-beer", "offer-steak"]]]);
  });

  it("saves the draft on leaving the table, and sends nothing to the kitchen", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    await tap(el, "Steak");
    expect(api.saveDraft).not.toHaveBeenCalled();

    await back(el);

    expect(api.saveDraft).toHaveBeenCalledOnce();
    expect(savedLines()).toEqual(["offer-beer ×1", "offer-steak ×1"]);
    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(api.submitGroups).not.toHaveBeenCalled();
    expect(tableOrder(el)).toBeNull();
  });

  it("shows Mesa 4 on the floor with an unsent-order mark once the save has landed", async () => {
    const { el } = await mountApp(lateSaveLiveFloor());
    await openMesa(el);
    await tap(el, "Beer");
    await tap(el, "Steak");

    await back(el);
    await settle(el);

    expect(unsentMark(el, "t4")).toBe("Bill 1 · Ana has an unsent order: 2 items");
    expect(unsentMark(el, "t7")).toBeUndefined();
  });

  it("shows the mark when the Order tab is left for the floor, once the save has landed", async () => {
    const { el } = await mountApp({
      ...lateSaveLiveFloor(),
      getTill: vi.fn().mockResolvedValue(till(orderTabFormFactor)),
    });
    await openMesa(el);
    await tap(el, "Flan");

    emit(shell(el), "screen-select", { screen: "floor" });
    await settle(el);

    expect(unsentMark(el, "t4")).toBe("Bill 1 · Ana has an unsent order: 1 item");
  });

  it("restores the draft from the server on coming back to the table", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    await back(el);

    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);

    expect(api.listDrafts).toHaveBeenLastCalledWith("v1", expect.anything());
    expect(rows(el)).toEqual(["Beer ×1"]);
  });

  it("restores the draft after the till is reloaded", async () => {
    const first = await mountApp();
    await openMesa(first.el);
    await tap(first.el, "Beer");
    await tap(first.el, "Flan");
    await back(first.el);
    cleanupWidgets();
    const saves = server.saveDraft.mock.calls.length;

    const { el } = await mountApp();
    await openMesa(el);

    expect(rows(el)).toEqual(["Beer ×1", "Flan ×1"]);
    expect(server.saveDraft.mock.calls.length).toBe(saves);
  });

  it("saves three taps on Beer as one line, Beer ×3, in one save once the taps stop", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    await tap(el, "Beer");
    await tap(el, "Beer");
    expect(rows(el)).toEqual(["Beer ×3"]);

    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    await flush(el);

    expect(api.saveDraft).toHaveBeenCalledOnce();
    expect(savedLines()).toEqual(["offer-beer ×3"]);
    await back(el);
    expect(api.saveDraft).toHaveBeenCalledOnce();
  });

  it("saves the draft before opening another table", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    await back(el);
    emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
    await flush(el);
    await tap(el, "Steak");

    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);

    expect(server.drafts.map((each) => [each.partyId, each.lines.length])).toEqual([
      ["v1", 1],
      ["v7", 1],
    ]);
    expect(rows(el)).toEqual(["Beer ×1"]);
  });

  it("saves the draft when the Order tab is left for the floor", async () => {
    const { el } = await mountApp({ getTill: vi.fn().mockResolvedValue(till(orderTabFormFactor)) });
    await openMesa(el);
    await tap(el, "Flan");

    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);

    expect(savedLines()).toEqual(["offer-flan ×1"]);
    expect(api.submitDraft).not.toHaveBeenCalled();
  });

  it("A738 asks before leaving a staged table line for Parked and Keep retains the draft", async () => {
    const { el } = await mountApp();
    const order = await openMesa(el);
    await tap(el, "Beer");
    const store = draft(el);
    const picker = await openDraftLine(order, 0);
    picker.shadowRoot!.querySelector<HTMLElement>(".add-note")!.click();
    await picker.updateComplete;
    await picker.shadowRoot!.querySelector("wt-textarea")!.updateComplete;
    const note = picker
      .shadowRoot!.querySelector("wt-textarea")!
      .shadowRoot!.querySelector("textarea")!;
    await userEvent.fill(note, "No onions");
    await picker.updateComplete;
    const bar = shell(el) as import("./widgets/till-shell.js").TillShell;
    emit(bar, "show-counter-orders", { kind: "parked" });
    await flush(el);
    const warning =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>(
        "wt-unsaved-changes",
      )!;
    await warning.updateComplete;
    expect(warning.open).toBe(true);
    expect(bar.activeOrderList).toBeNull();
    emit(warning, "wt-unsaved-choice", { decision: "keep" });
    await flush(el);
    expect(tableOrder(el)).toBe(order);
    expect(draft(el)).toBe(store);
    expect(note.value).toBe("No onions");
    expect(store.lines.map((line) => [line.product.name, line.quantity, line.note])).toEqual([
      ["Beer", "1", undefined],
    ]);
    emit(bar, "show-counter-orders", { kind: "parked" });
    await flush(el);
    expect(warning.open).toBe(true);
    emit(warning, "wt-unsaved-choice", { decision: "discard" });
    await flush(el, 6);
    expect(bar.activeOrderList).toBe("parked");
    expect(tableOrder(el)).toBeNull();
    expect(store.lines.map((line) => [line.product.name, line.quantity, line.note])).toEqual([
      ["Beer", "1", undefined],
    ]);
    expect(api.submitDraft).not.toHaveBeenCalled();
  });

  it("saves a course picked for a line with the draft", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Flan");
    const form = await openDraftLine(tableOrder(el)!, 0);
    const picker = form.shadowRoot!.querySelector<WtCombobox>('[name="course"]')!;
    await chooseOption(picker, "mains");
    await form.updateComplete;
    form.shadowRoot!.querySelector<HTMLElement>(".confirm")!.click();
    await flush(el);
    await back(el);

    expect(server.drafts[0]!.lines.map((line) => line.courseId)).toEqual(["mains"]);
  });

  it("keeps unsent dishes on their original bill when a sent dish is split off", async () => {
    const { el } = await mountApp({
      splitBill: vi.fn().mockResolvedValue({ billId: "wo-check" }),
      getTabLines: vi.fn().mockResolvedValue({
        lines: [
          {
            id: "line-1",
            groupId: null,
            lineNo: 1,
            productId: "product-offer-beer",
            quantity: "1.000",
            unitPriceGross: "5.00",
            servedAt: null,
            courseId: null,
            sentAt: null,
            firedAt: null,
            state: null,
            note: null,
            listId: null,
            menuItemId: null,
            parentProductId: null,
          },
        ],
        revision: 0,
        editSentLines: true,
      }),
    });
    const order = await openMesa(el);
    await tap(el, "Beer");
    emit(order, "split-lines", { transfers: [{ lineNo: 1 }] });
    await flush(el);

    expect(tableOrder(el)!.orderId).toBe("wo-check");
    expect(browser(el)).not.toBeNull();
    expect(tableOrder(el)!.shadowRoot!.querySelector("[data-draft-action]")).not.toBeNull();
    expect(rows(el)).toEqual([]);
    expect(server.drafts.map((each) => [each.billId, each.lines[0]!.menuItemId])).toEqual([
      ["wo-4", "offer-beer"],
    ]);
    emit(tableOrder(el)!, "take-payment", { workingOrderId: "wo-4" });
    await flush(el);
    expect(rows(el)).toEqual(["Beer ×1"]);
  });
});

describe("till-app: an order that moves to another party", () => {
  it("retains local edits without saving to the old party, then reads the relocated bill", async () => {
    const { el } = await mountApp({
      moveGuests: vi.fn().mockRejectedValue({ code: "party.out_of_date", partyId: "v1" }),
    });
    await openMesa(el);
    server.save("v9", {
      billId: "wo-4",
      draftId: null,
      revision: 0,
      lines: [
        {
          slot: 0,
          joinGroupId: null,
          afterGroupId: null,
          menuItemId: "offer-flan",
          variantId: null,
          menuVersionId: "v1",
          options: [],
          extras: [],
          note: null,
          quantity: "1",
          courseId: null,
          noMerge: false,
        },
      ],
    });
    await tap(el, "Beer");
    api.getTablesState.mockResolvedValue([
      table("t4", "4", party({ id: "v9", revision: 1, tableIds: ["t4", "t7"] })),
      mesa7,
    ]);

    emit(tableOrder(el)!, "move-guests", { toTableId: "t7", bills: "merge" });
    await flush(el, 6);

    expect(server.drafts.map((each) => [each.partyId, each.lines.length])).toEqual([["v9", 1]]);
    expect(api.saveDraft).not.toHaveBeenCalled();
    expect(api.listDrafts).toHaveBeenLastCalledWith("v9", expect.anything());
    expect(rows(el)).toEqual(["Flan ×1"]);
    expect(retainedCandidate(el)).toMatchObject({ personId: "p1", partyId: "v1", billId: "wo-4" });
    expect(retainedCandidate(el)?.lines.map((line) => line.product.name)).toEqual(["Beer"]);
    expect(draft(el).editsLocked).toBe(true);
  });
});

describe("till-app: signing out with a draft", () => {
  it("shows the box-update bar instead of reloading while the draft's earlier save is still out", async () => {
    const answer = holdNextSave();
    const reload = vi.fn();
    const { el } = await mountApp();
    el.reload = reload;
    await openMesa(el);
    await tap(el, "Beer");
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    expect(api.saveDraft).toHaveBeenCalledOnce();

    emit(tableOrder(el)!, "logout");
    await flush(el);
    expect(lock(el)).not.toBeNull();
    expect(api.saveDraft).toHaveBeenCalledOnce();
    expect(api.logout).not.toHaveBeenCalled();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    window.dispatchEvent(new Event(BUILD_CHANGED_EVENT));
    await flush(el);

    expect(reload).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("wt-banner[data-test=update-bar]")).not.toBeNull();
    answer();
    await flush(el);
    expect(api.logout).toHaveBeenCalledOnce();
  });

  it("shows the box-update bar instead of reloading while a sent order still waits for the server after an idle sign-out", async () => {
    const activity = {
      configure: vi.fn(),
      noteInteraction: vi.fn(),
      reacquire: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const reload = vi.fn();
    const submitDraft = vi.fn(() => new Promise(() => {}));
    const { el } = await mountApp({ submitDraft }, activity as never);
    el.reload = reload;
    await openMesa(el);
    await tap(el, "Beer");
    await act(el, "fire-all");
    expect(submitDraft).toHaveBeenCalledOnce();

    (activity.configure.mock.calls.at(-1)![0] as { onIdle: () => void }).onIdle();
    await flush(el, 6);
    expect(api.logout).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event(BUILD_CHANGED_EVENT));
    await flush(el);

    expect(reload).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("wt-banner[data-test=update-bar]")).not.toBeNull();
  });

  it("reloads only once the earlier save is answered, when Reload was pressed while it was out", async () => {
    const answer = holdNextSave();
    const reload = vi.fn();
    const { el } = await mountApp();
    el.reload = reload;
    await openMesa(el);
    await tap(el, "Beer");
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    expect(api.saveDraft).toHaveBeenCalledOnce();
    emit(tableOrder(el)!, "logout");
    await flush(el);
    window.dispatchEvent(new Event(BUILD_CHANGED_EVENT));
    await flush(el);

    await userEvent.click(
      el
        .shadowRoot!.querySelector("wt-banner[data-test=update-bar]")!
        .shadowRoot!.querySelector("wt-button")!
        .shadowRoot!.querySelector("button")!,
    );
    await flush(el);
    expect(reload).not.toHaveBeenCalled();
    answer();
    await flush(el);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("ends the session without starting a save and retains its person's local candidate", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");

    emit(tableOrder(el)!, "logout");
    await flush(el);

    expect(api.saveDraft).not.toHaveBeenCalled();
    expect(api.logout).toHaveBeenCalledOnce();
    expect(lock(el)).not.toBeNull();
    await signIn(el, "p2", "Sam");
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    expect(retainedCandidate(el)).toBeNull();
    expect(rows(el)).toEqual([]);
    emit(tableOrder(el)!, "logout");
    await flush(el);
    await signIn(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    expect(rows(el)).toEqual([]);
    expect(retainedCandidate(el)?.lines.map((line) => line.product.name)).toEqual(["Beer"]);
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it("never sends one person's queued save after another has signed in", async () => {
    let answer!: () => void;
    const { el } = await mountApp();
    await openMesa(el);
    server.saveDraft.mockImplementationOnce(async (partyId, save) => {
      const sentBy = server.personId;
      await new Promise<void>((resolve) => (answer = resolve));
      const now = server.personId;
      server.personId = sentBy;
      const saved = server.save(partyId, save);
      server.personId = now;
      return server.snapshot(saved);
    });
    await tap(el, "Beer");
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    await tap(el, "Steak");
    expect(api.saveDraft).toHaveBeenCalledOnce();

    emit(tableOrder(el)!, "logout");
    await flush(el);
    await signIn(el, "p2", "Sam");
    answer();
    await flush(el);
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));

    expect(api.saveDraft).toHaveBeenCalledOnce();
    expect(server.drafts.map((each) => [each.ownerId, each.lines.length])).toEqual([["p1", 1]]);
    // Sam's session is live now: ending Ana's would end his.
    expect(api.logout).not.toHaveBeenCalled();
  });
});

describe("till-app: switching the device's profile with a table order open", () => {
  const profiles = {
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
  };
  const profileDialog = (el: TillApp) =>
    el.shadowRoot!.querySelector<TillProfileDialog>("till-profile-dialog");

  async function askToSwitch(el: TillApp): Promise<void> {
    shell(el).shadowRoot!.querySelector<HTMLElement>("wt-button.profile")!.click();
    await flush(el);
    emit(profileDialog(el)!, "profile-switch", { profileId: "pr-bar" });
    await flush(el, 6);
  }

  function switchStub() {
    return vi.fn().mockResolvedValue({
      activeProfileId: "pr-bar",
    });
  }

  it("sends no switch, and keeps the line, when the draft's last change cannot be saved", async () => {
    const switchDeviceProfile = switchStub();
    const { el } = await mountApp({
      ...profiles,
      switchDeviceProfile,
      saveDraft: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    await openMesa(el);
    await tap(el, "Beer");

    await askToSwitch(el);

    expect(switchDeviceProfile).not.toHaveBeenCalled();
    expect(profileDialog(el)!.notice).toBe("draft_unsaved");
    expect(rows(el)).toEqual([]);
    expect(retainedCandidate(el)?.lines.map((line) => line.product.name)).toEqual(["Beer"]);
    expect(draft(el).editsLocked).toBe(true);
  });

  it("saves a change still waiting to be saved before the switch is sent", async () => {
    const switchDeviceProfile = switchStub();
    const { el } = await mountApp({ ...profiles, switchDeviceProfile });
    await openMesa(el);
    press(el, "Beer");

    await askToSwitch(el);

    expect(api.saveDraft).toHaveBeenCalledOnce();
    expect(switchDeviceProfile).toHaveBeenCalledOnce();
    expect(api.saveDraft.mock.invocationCallOrder[0]!).toBeLessThan(
      switchDeviceProfile.mock.invocationCallOrder[0]!,
    );
    expect(savedLines()).toHaveLength(1);
  });

  it("holds the dialog open over the screen until the order's draft is opened again, so no edit lands in the draft being replaced", async () => {
    let answerTill: (value: unknown) => void = () => {};
    const switchDeviceProfile = switchStub();
    const { el } = await mountApp({
      ...profiles,
      switchDeviceProfile,
      getTill: vi
        .fn()
        .mockResolvedValueOnce(till(drillFormFactor))
        .mockImplementationOnce(() => new Promise((resolve) => (answerTill = resolve))),
    });
    await openMesa(el);

    await askToSwitch(el);

    expect(switchDeviceProfile).toHaveBeenCalledOnce();
    const dialog = profileDialog(el);
    expect(dialog).not.toBeNull();
    expect(dialog!.busy).toBe(true);
    const native = dialog!
      .shadowRoot!.querySelector("wt-dialog")!
      .shadowRoot!.querySelector("dialog")!;
    expect(native.matches(":modal")).toBe(true);

    answerTill(till(drillFormFactor));
    await flush(el, 6);

    expect(profileDialog(el)).toBeNull();
  });

  it("keeps the dialog open over the screen when Escape is pressed while the switch is out", async () => {
    let answerTill: (value: unknown) => void = () => {};
    const { el } = await mountApp({
      ...profiles,
      switchDeviceProfile: switchStub(),
      getTill: vi
        .fn()
        .mockResolvedValueOnce(till(drillFormFactor))
        .mockImplementationOnce(() => new Promise((resolve) => (answerTill = resolve))),
    });
    await openMesa(el);
    await askToSwitch(el);
    const dialog = profileDialog(el)!;
    const native = dialog
      .shadowRoot!.querySelector("wt-dialog")!
      .shadowRoot!.querySelector("dialog")!;
    expect(native.matches(":modal")).toBe(true);

    await userEvent.keyboard("{Escape}");
    await flush(el);

    expect(dialog.busy).toBe(true);
    expect(native.matches(":modal")).toBe(true);

    answerTill(till(drillFormFactor));
    await flush(el, 6);

    expect(profileDialog(el)).toBeNull();
  });

  it("says the order's change was refused and replaced, not that it could not be saved, when the switch's save is refused", async () => {
    const switchDeviceProfile = switchStub();
    const { el } = await mountApp({
      ...profiles,
      switchDeviceProfile,
      saveDraft: vi.fn(server.saveDraft).mockRejectedValueOnce({
        code: "draft.out_of_date",
        status: 409,
      }),
    });
    await openMesa(el);
    press(el, "Beer");

    await askToSwitch(el);

    expect(switchDeviceProfile).not.toHaveBeenCalled();
    expect(profileDialog(el)!.notice).toBe("draft_replaced");
    expect(rows(el)).toEqual([]);
  });

  it("refuses to switch while an order with no party holds lines, which are never saved", async () => {
    const switchDeviceProfile = switchStub();
    const unseated = table("t9", "9", null);
    const { el } = await mountApp({
      ...profiles,
      switchDeviceProfile,
      getTablesState: vi.fn().mockResolvedValue([mesa4, mesa7, unseated]),
    });
    await openMesa(el, "t9");
    await tap(el, "Beer");
    expect(rows(el)).toEqual(["Beer ×1"]);

    await askToSwitch(el);

    expect(switchDeviceProfile).not.toHaveBeenCalled();
    expect(profileDialog(el)!.notice).toBe("order_open");
    expect(rows(el)).toEqual(["Beer ×1"]);
  });
});

describe("till-app: a save the server refuses", () => {
  it("shows the draft another device saved, says so, and does not save over it", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    server.save("v1", {
      billId: "wo-4",
      draftId: null,
      revision: 0,
      lines: [
        {
          slot: 0,
          joinGroupId: null,
          afterGroupId: null,
          menuItemId: "offer-steak",
          variantId: null,
          menuVersionId: "v1",
          options: [],
          extras: [],
          note: null,
          quantity: "2",
          courseId: null,
          noMerge: false,
        },
      ],
    });
    await tap(el, "Beer");

    await back(el);

    expect(api.saveDraft).toHaveBeenCalledOnce();
    expect(savedLines()).toEqual(["offer-steak ×2"]);
    expect(banner(el)!.textContent).toContain(t("table.draft_changed_elsewhere"));
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    expect(rows(el)).toEqual(["Steak ×2"]);
  });

  it("re-reads the drafts after a save refused as taken over, and says who took it and that the change was not saved", async () => {
    const { el } = await mountApp({
      saveDraft: vi.fn(server.saveDraft).mockRejectedValueOnce({
        code: "draft.taken_over",
        status: 409,
        ownerId: "p2",
        ownerName: "Sam",
      }),
    });
    await openMesa(el);
    const reads = api.listDrafts.mock.calls.length;
    await tap(el, "Beer");

    await back(el);

    expect(api.listDrafts.mock.calls.length).toBe(reads + 1);
    expect(banner(el)!.textContent).toContain(
      "Sam has taken over this order. Your last change was not saved.",
    );
  });

  it("says a closed party in its own words", async () => {
    const { el } = await mountApp({
      saveDraft: vi.fn().mockRejectedValue({ code: "party.not_open", status: 409 }),
    });
    await openMesa(el);
    await tap(el, "Beer");

    await back(el);

    expect(banner(el)!.textContent).toContain(codeMessage("party.not_open"));
  });

  it("says nothing when the session had already ended", async () => {
    const { el } = await mountApp({
      saveDraft: vi.fn().mockRejectedValue({ code: "session.required", status: 401 }),
    });
    await openMesa(el);
    await tap(el, "Beer");

    await back(el);

    expect(banner(el)).toBeNull();
  });
});

describe("till-app: sending the draft", () => {
  describe("per-group draft destinations", () => {
    const held = (id: string, position: number): OrderGroup => ({
      id,
      position,
      displayNumber: position,
      numberPartyId: "v1",
      state: "held",
      firedAt: null,
      remindAt: null,
      courseIds: [],
      lineIds: [],
      summary: "1 × Fish",
    });
    const destinations = [held("g-mains", 1), held("g-desserts", 2)];

    async function arranged(overrides: Record<string, unknown> = {}) {
      const { el } = await mountApp({
        listGroups: vi.fn().mockResolvedValue({ revision: 3, groups: destinations }),
        ...overrides,
      });
      await openMesa(el);
      await tap(el, "Beer");
      await tap(el, "Steak");
      await tap(el, "Flan");
      const store = draft(el);
      store.setLinePlaces([0], { kind: "join", groupId: "g-mains" });
      store.setLinePlaces([1], { kind: "new", slot: 2, afterGroupId: "g-mains" });
      store.setLinePlaces([2], { kind: "join", groupId: "g-desserts" });
      const tally = { fired: 0, held: 0, joined: 0 };
      const detail = {
        groups: [
          { release: "hold", lineIndexes: [2], joinGroupId: "g-desserts" },
          { release: "hold", lineIndexes: [0], joinGroupId: "g-mains" },
          { release: "hold", lineIndexes: [1], afterGroupId: "g-mains" },
        ],
        store,
        sent: [...store.lines],
        draft: { laterAddition: true, tally },
      };
      return { el, store, detail, tally };
    }

    it("sends each join and anchor with the saved ids of its own lines", async () => {
      const { el, detail, tally } = await arranged();
      emit(tableOrder(el)!, "submit-draft", detail);
      await vi.waitFor(() => expect(api.submitDraft).toHaveBeenCalledOnce());
      await flush(el, 6);

      expect(api.submitDraft.mock.calls[0]![2]).toEqual({
        submissionId: expect.any(String),
        expectedPartyRevision: 3,
        draftRevision: 1,
        expectedEdit: { billId: "wo-4", editorVersion: 1, draftId: "draft-1", draftRevision: 1 },
        groups: [
          { release: "hold", lineIds: ["line-4"], joinGroupId: "g-desserts" },
          { release: "hold", lineIds: ["line-2"], joinGroupId: "g-mains" },
          { release: "hold", lineIds: ["line-3"], afterGroupId: "g-mains" },
        ],
      });
      expect(server.drafts).toEqual([]);
      expect(tally).toEqual({ fired: 0, held: 1, joined: 2 });
    });

    it("counts joined groups separately from new held groups", async () => {
      const { el, detail, tally } = await arranged();
      emit(tableOrder(el)!, "submit-draft", detail);
      await vi.waitFor(() => expect(tally).toEqual({ fired: 0, held: 1, joined: 2 }));
    });

    it("starts only one per-group send when the event is delivered twice before either save", async () => {
      const { el, detail } = await arranged();
      const screen = tableOrder(el)!;
      emit(screen, "submit-draft", detail);
      emit(screen, "submit-draft", detail);
      await vi.waitFor(() => expect(server.drafts).toEqual([]));
      await flush(el, 6);

      expect(api.submitDraft).toHaveBeenCalledOnce();
    });

    it("allows a Fire request with no group target when group reads failed", async () => {
      const { el, store, detail } = await arranged({
        listGroups: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      });
      emit(tableOrder(el)!, "submit-draft", {
        ...detail,
        groups: [{ release: "fire", lineIndexes: [0] }],
        sent: [store.lines[1]!],
      });
      await vi.waitFor(() => expect(store.lineCount).toBe(2));

      expect(api.submitDraft).toHaveBeenCalledOnce();
      expect(api.submitDraft.mock.calls[0]![2].groups).toEqual([
        { release: "fire", lineIds: ["line-3"] },
      ]);
      expect(savedLines()).toEqual(["offer-beer ×1", "offer-flan ×1"]);
    });

    it("retains unselected rows and their manual placement after a partial send", async () => {
      const { el, store, detail } = await arranged();
      const beer = store.lines[0]!;
      const flan = store.lines[2]!;
      emit(tableOrder(el)!, "submit-draft", {
        ...detail,
        groups: [{ release: "hold", lineIndexes: [0], afterGroupId: "g-desserts" }],
        sent: [store.lines[1]!],
      });
      await vi.waitFor(() => expect(store.lineCount).toBe(2));

      expect(api.submitDraft.mock.calls[0]![2].groups).toEqual([
        { release: "hold", lineIds: ["line-3"], afterGroupId: "g-desserts" },
      ]);
      expect(store.lines).toEqual([beer, flan]);
      expect(store.lines[0]).toBe(beer);
      expect(store.lines[1]).toBe(flan);
      expect(server.drafts[0]!.lines.map((line) => line.joinGroupId)).toEqual([
        "g-mains",
        "g-desserts",
      ]);
    });

    it("keeps the entire arrangement on a non-target refusal", async () => {
      const { el, store, detail, tally } = await arranged({
        submitDraft: vi.fn().mockRejectedValue({ code: "station.not_found", status: 404 }),
      });
      const before = [...store.lines];
      const places = structuredClone(before.map((line) => line.place));
      emit(tableOrder(el)!, "submit-draft", detail);
      await vi.waitFor(() =>
        expect(banner(el)?.textContent).toContain(codeMessage("station.not_found")),
      );

      expect(store.lines).toEqual(before);
      expect(store.lines.map((line) => line.place)).toEqual(places);
      expect(savedLines()).toEqual(["offer-beer ×1", "offer-steak ×1", "offer-flan ×1"]);
      expect(api.submitDraft).toHaveBeenCalledOnce();
      expect(tally).toEqual({ fired: 0, held: 0, joined: 0 });
    });

    it.each(["joinGroupId", "afterGroupId"] as const)(
      "sends nothing when a per-group %s names unread groups",
      async (target) => {
        const { el, store, detail } = await arranged({
          listGroups: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
        });
        emit(tableOrder(el)!, "submit-draft", {
          ...detail,
          groups: [{ release: "hold", lineIndexes: [0], [target]: "g-mains" }],
          sent: [store.lines[0]!],
        });
        await flush(el, 6);
        expect(api.submitDraft).not.toHaveBeenCalled();
        expect(banner(el)?.textContent ?? "").toContain(t("table.error"));
        expect(store.lineCount).toBe(3);
      },
    );
  });

  describe("A773 raced draft targets", () => {
    const mains: OrderGroup = {
      id: "held-mains",
      position: 1,
      displayNumber: 7,
      numberPartyId: "v1",
      state: "held",
      firedAt: null,
      remindAt: null,
      courseIds: ["mains"],
      lineIds: [],
      summary: "1 × Fish",
    };
    const desserts: OrderGroup = {
      ...mains,
      id: "held-desserts",
      position: 2,
      displayNumber: 9,
      courseIds: ["desserts"],
      summary: "1 × Flan",
    };
    const current = {
      revision: 4,
      nextDisplayNumber: 10,
      groups: [],
      ungrouped: [],
      retainedCourses: [],
      hasGroups: true,
      reminder: null,
    };

    async function raced(
      when: "save" | "submit" | "party",
      overrides: Record<string, unknown> = {},
    ) {
      const listGroups = vi.fn().mockResolvedValue({ revision: 3, groups: [mains, desserts] });
      const { el } = await mountApp({
        listGroups,
        readCurrentOrders: vi.fn().mockResolvedValue(current),
        getTill: vi.fn().mockResolvedValue({
          ...till(drillFormFactor),
          courses: [
            { id: "drinks", name: "Drinks", displayOrder: 0, heldUntilFired: false },
            { id: "mains", name: "Mains", displayOrder: 1, heldUntilFired: true },
            { id: "desserts", name: "Desserts", displayOrder: 2, heldUntilFired: true },
          ],
        }),
        ...overrides,
      });
      await openMesa(el);
      await tap(el, "Steak");
      await tap(el, "Beer");
      await tap(el, "Flan");
      const store = draft(el);
      store.setLinePlaces([0], { kind: "join", groupId: mains.id });
      store.setLinePlaces([1], { kind: "new", slot: 4, afterGroupId: mains.id });
      store.setLinePlaces([2], { kind: "new", slot: 8, afterGroupId: desserts.id });
      const before = [...store.lines];
      const refuse = () => {
        listGroups.mockResolvedValue({
          revision: 4,
          groups: [{ ...mains, state: "fired", firedAt: "2026-10-17T12:00:00.000Z" }, desserts],
        });
        api.getTablesState!.mockResolvedValue([
          { ...mesa4, party: { ...mesa4.party!, revision: 4 } },
          mesa7,
        ]);
        throw {
          code: when === "party" ? "party.out_of_date" : "group.not_held",
          status: 409,
          groupId: mains.id,
          partyId: "v1",
        };
      };
      if (when === "save") api.saveDraft!.mockImplementationOnce(refuse);
      else api.submitDraft!.mockImplementationOnce(refuse);
      const detail = {
        groups: [
          { release: "hold", lineIndexes: [0], joinGroupId: mains.id },
          { release: "hold", lineIndexes: [1], afterGroupId: mains.id },
          { release: "hold", lineIndexes: [2], afterGroupId: desserts.id },
        ],
        store,
        sent: [...store.lines],
      };
      return { el, store, before, detail, listGroups };
    }

    it.each(["save", "submit", "party"] as const)(
      "re-places only invalid joins and anchors after a %s refusal and waits for another press",
      async (when) => {
        const { el, store, before, detail } = await raced(when);
        emit(tableOrder(el)!, "submit-draft", detail);
        await vi.waitFor(() =>
          expect(store.lines.map((line) => line.place)).toEqual([
            { kind: "fire" },
            { kind: "fire" },
            { kind: "new", slot: 8, afterGroupId: "held-desserts" },
          ]),
        );
        await vi.waitFor(() =>
          expect(
            server.drafts[0]!.lines.map((line) => [line.slot, line.joinGroupId, line.afterGroupId]),
          ).toEqual([
            [0, null, null],
            [0, null, null],
            [8, null, "held-desserts"],
          ]),
        );
        expect(store.lines.every((line, index) => line === before[index])).toBe(true);
        expect(rows(el)).toEqual(["Steak ×1", "Beer ×1", "Flan ×1"]);
        expect(api.submitDraft).toHaveBeenCalledTimes(when === "save" ? 0 : 1);
        expect(tableOrder(el)!.orderId).toBe("wo-4");
        expect(tableOrder(el)!.party!.revision).toBe(4);
        expect(banner(el)?.textContent).toContain("Group 7");
        expect(banner(el)?.textContent).toContain("Send again");
        await flush(el, 6);
        expect(api.submitDraft).toHaveBeenCalledTimes(when === "save" ? 0 : 1);
      },
    );

    it.each(["getTablesState", "listGroups", "readCurrentOrders", "listDrafts"] as const)(
      "retains the candidate without another save or send when recovery %s fails",
      async (read) => {
        const { el, store, before, detail } = await raced("submit");
        const places = structuredClone(before.map((line) => line.place));
        api[read]!.mockRejectedValueOnce(new TypeError("Failed to fetch"));
        emit(tableOrder(el)!, "submit-draft", detail);
        await vi.waitFor(() => expect(store.sending).toBe(false));
        await flush(el, 6);
        expect(api.submitDraft).toHaveBeenCalledOnce();
        expect(api.saveDraft).toHaveBeenCalledOnce();
        expect(store.lines.map((line) => line.place)).toEqual(places);
        expect(store.lines.every((line, index) => line === before[index])).toBe(true);
        expect(banner(el)?.textContent).toContain(
          "Could not refresh the order. Your dishes are unchanged. Try again.",
        );
      },
    );

    it.each(["missing-party", "older-party", "older-groups", "older-orders"] as const)(
      "keeps the saved candidate and waits when recovery returns %s",
      async (snapshot) => {
        const { el, store, before, detail } = await raced("submit");
        api.submitDraft!.mockReset().mockImplementationOnce(() => {
          api.getTablesState!.mockResolvedValue([
            {
              ...mesa4,
              party:
                snapshot === "missing-party"
                  ? null
                  : {
                      ...mesa4.party!,
                      revision: snapshot === "older-party" ? 2 : 4,
                    },
            },
            mesa7,
          ]);
          api.listGroups!.mockResolvedValue({
            revision: snapshot === "older-groups" ? 2 : 4,
            groups: [desserts],
          });
          api.readCurrentOrders!.mockResolvedValue({
            ...current,
            revision: snapshot === "older-orders" ? 2 : 4,
          });
          throw { code: "group.not_held", status: 409, groupId: mains.id };
        });
        emit(tableOrder(el)!, "submit-draft", detail);
        await vi.waitFor(() => expect(store.sending).toBe(false));
        await flush(el, 6);
        expect(store.lines.map((line) => line.place)).toEqual([
          { kind: "join", groupId: "held-mains" },
          { kind: "new", slot: 4, afterGroupId: "held-mains" },
          { kind: "new", slot: 8, afterGroupId: "held-desserts" },
        ]);
        expect(store.lines.every((line, index) => line === before[index])).toBe(true);
        expect(rows(el)).toEqual(["Steak ×1", "Beer ×1", "Flan ×1"]);
        expect(api.saveDraft).toHaveBeenCalledOnce();
        expect(api.submitDraft).toHaveBeenCalledOnce();
        expect(banner(el)?.textContent).toContain(codeMessage("party.out_of_date"));
      },
    );

    it("keeps restored held targets after a delayed group refusal", async () => {
      const { el, store, before, detail } = await raced("submit");
      api.submitDraft!.mockReset().mockImplementationOnce(() => {
        api.listGroups!.mockResolvedValue({ revision: 4, groups: [mains, desserts] });
        api.getTablesState!.mockResolvedValue([
          { ...mesa4, party: { ...mesa4.party!, revision: 4 } },
          mesa7,
        ]);
        throw { code: "group.not_held", status: 409, groupId: mains.id };
      });
      emit(tableOrder(el)!, "submit-draft", detail);
      await vi.waitFor(() => expect(store.sending).toBe(false));
      await flush(el, 6);
      expect(store.lines.map((line) => line.place)).toEqual([
        { kind: "join", groupId: "held-mains" },
        { kind: "new", slot: 4, afterGroupId: "held-mains" },
        { kind: "new", slot: 8, afterGroupId: "held-desserts" },
      ]);
      expect(store.lines.every((line, index) => line === before[index])).toBe(true);
      expect(rows(el)).toEqual(["Steak ×1", "Beer ×1", "Flan ×1"]);
      expect(api.saveDraft).toHaveBeenCalledOnce();
      expect(api.submitDraft).toHaveBeenCalledOnce();
      expect(banner(el)).not.toBeNull();
    });

    it("keeps corrected dishes locally when their recovery save goes offline", async () => {
      const { el, store, detail } = await raced("submit");
      api
        .saveDraft!.mockImplementationOnce(async (partyId, save) =>
          server.snapshot(server.save(partyId, save)),
        )
        .mockRejectedValueOnce(new TypeError("Failed to fetch"));
      emit(tableOrder(el)!, "submit-draft", detail);
      await vi.waitFor(() => expect(store.sending).toBe(false));
      await flush(el, 6);
      expect(retainedCandidate(el)?.lines.map((line) => line.place)).toEqual([
        { kind: "fire" },
        { kind: "fire" },
        { kind: "new", slot: 8, afterGroupId: "held-desserts" },
      ]);
      expect(rows(el)).toEqual(["Steak ×1", "Beer ×1", "Flan ×1"]);
      expect(draft(el).editsLocked).toBe(true);
      expect(server.drafts[0]!.lines[0]!.joinGroupId).toBe("held-mains");
      expect(api.submitDraft).toHaveBeenCalledOnce();
      expect(banner(el)?.textContent).toContain(t("table.draft_recovery_failed"));
    });

    it("retains corrected local lines separately when their save loses a revision race", async () => {
      const { el, store, before, detail } = await raced("submit");
      api
        .saveDraft!.mockImplementationOnce(async (partyId, save) =>
          server.snapshot(server.save(partyId, save)),
        )
        .mockImplementationOnce(() => {
          const own = server.drafts[0]!;
          own.revision++;
          own.lines = own.lines.map((line) => ({ ...line, quantity: "9" }));
          throw { code: "draft.out_of_date", status: 409 };
        });
      emit(tableOrder(el)!, "submit-draft", detail);
      await vi.waitFor(() => expect(store.sending).toBe(false));
      await flush(el, 6);
      expect(rows(el)).toEqual(["Steak ×9", "Beer ×9", "Flan ×9"]);
      expect(draft(el).editsLocked).toBe(true);
      expect(
        retainedCandidate(el)?.lines.map((line) => [line.product.name, line.quantity]),
      ).toEqual([
        ["Steak", "1"],
        ["Beer", "1"],
        ["Flan", "1"],
      ]);
      expect(retainedCandidate(el)?.lines.map((line) => line.place)).toEqual([
        { kind: "fire" },
        { kind: "fire" },
        { kind: "new", slot: 8, afterGroupId: "held-desserts" },
      ]);
      expect(retainedCandidate(el)?.lines.map((line) => line.draftLineId)).toEqual(
        before.map((line) => line.draftLineId),
      );
      expect(server.drafts[0]!.lines.map((line) => line.quantity)).toEqual(["9", "9", "9"]);
      expect(api.saveDraft).toHaveBeenCalledTimes(2);
      expect(api.submitDraft).toHaveBeenCalledOnce();
      expect(banner(el)?.textContent).toContain(codeMessage("draft.out_of_date"));
    });

    it("ignores a target recovery after another table replaced its draft", async () => {
      const { el, store, detail } = await raced("submit");
      let answer!: (value: unknown) => void;
      api.readCurrentOrders!.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      );
      emit(tableOrder(el)!, "submit-draft", detail);
      await vi.waitFor(() => expect(answer).toBeTypeOf("function"));
      emit(tableOrder(el)!, "back", {});
      await flush(el, 6);
      emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
      await flush(el, 6);
      answer(current);
      await flush(el, 6);
      expect(tableOrder(el)!.orderId).toBe("wo-7");
      expect(rows(el)).toEqual([]);
      expect(store.lines.map((line) => line.place)).toEqual([
        { kind: "join", groupId: "held-mains" },
        { kind: "new", slot: 4, afterGroupId: "held-mains" },
        { kind: "new", slot: 8, afterGroupId: "held-desserts" },
      ]);
      expect(api.saveDraft).toHaveBeenCalledOnce();
      expect(api.submitDraft).toHaveBeenCalledOnce();
      expect(banner(el)).toBeNull();
    });

    it("retains the local candidate when the authoritative draft revision moved", async () => {
      const { el, store, before, detail } = await raced("submit");
      api.submitDraft!.mockReset().mockImplementationOnce(() => {
        api.listGroups!.mockResolvedValue({ revision: 4, groups: [desserts] });
        const own = server.drafts[0]!;
        server.drafts = [
          {
            ...own,
            revision: own.revision + 1,
            lines: own.lines.map((line) => ({ ...line, quantity: "9" })),
          },
        ];
        throw { code: "group.not_held", status: 409, groupId: mains.id };
      });
      emit(tableOrder(el)!, "submit-draft", detail);
      await vi.waitFor(() => expect(store.sending).toBe(false));
      await flush(el, 6);
      expect(rows(el)).toEqual(["Steak ×1", "Beer ×1", "Flan ×1"]);
      expect(store.lines.every((line, index) => line === before[index])).toBe(true);
      expect(api.saveDraft).toHaveBeenCalledOnce();
      expect(api.submitDraft).toHaveBeenCalledOnce();
      expect(server.drafts[0]!.revision).toBe(2);
      expect(banner(el)?.textContent).toContain(codeMessage("draft.out_of_date"));
    });
  });

  it("sends Send all as one held group per course, under the ids the save answered", async () => {
    const { el } = await mountApp({
      readCurrentOrders: vi.fn().mockResolvedValue({
        revision: 3,
        hasGroups: false,
        nextDisplayNumber: 1,
        retainedCourses: [],
        groups: [],
        ungrouped: [],
        reminder: null,
      }),
    });
    await openMesa(el);
    await tap(el, "Beer");
    await tap(el, "Steak");

    await act(el, "send-all");

    expect(api.submitDraft).toHaveBeenCalledOnce();
    const [partyId, draftId, submission] = api.submitDraft.mock.calls[0]!;
    expect([partyId, draftId]).toEqual(["v1", "draft-1"]);
    expect(submission).toEqual({
      submissionId: expect.any(String),
      expectedPartyRevision: 3,
      draftRevision: 1,
      expectedEdit: { billId: "wo-4", editorVersion: 1, draftId: "draft-1", draftRevision: 1 },
      groups: [
        { release: "hold", lineIds: ["line-2"] },
        { release: "hold", lineIds: ["line-3"] },
      ],
    });
    expect(
      server
        .sentGroups(api.submitDraft.mock.calls[0]![2])
        .map((group) => group.lines.map((line) => line.menuItemId)),
    ).toEqual([["offer-beer"], ["offer-steak"]]);
    expect(server.drafts).toEqual([]);
    expect(tableOrder(el)).toBeNull();
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { message: string }>(
        "wt-toast[data-submitted-toast]",
      )!.message,
    ).toBe("Held: 2 groups.");
  });

  it("keeps the unsent lines in the draft, on the server too, after Fire selected now", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    await tap(el, "Steak");
    const kept = draft(el).lines[1];

    await toggle(el, "Beer");
    await act(el, "fire-selected");

    expect(server.sentGroups(api.submitDraft.mock.calls[0]![2])).toEqual([
      {
        release: "fire",
        lines: [{ menuItemId: "offer-beer", menuVersionId: "v1", quantity: "1" }],
      },
    ]);
    expect(rows(el)).toEqual(["Steak ×1"]);
    expect(draft(el).lines[0]).toBe(kept);
    expect(savedLines()).toEqual(["offer-steak ×1"]);
    await back(el);
    expect(api.saveDraft).toHaveBeenCalledOnce();
  });

  it("moves a later addition into a held group and submits that saved per-group join", async () => {
    const held: OrderGroup = {
      courseIds: [],
      id: "g-mains",
      position: 1,
      displayNumber: 1,
      numberPartyId: "v1",
      state: "held",
      firedAt: null,
      remindAt: null,
      lineIds: ["l-9"],
      summary: "1 × Steak",
    };
    const { el } = await mountApp({
      listGroups: vi.fn().mockResolvedValue({ revision: 3, groups: [held] }),
      readCurrentOrders: vi.fn().mockResolvedValue(
        current({
          revision: 3,
          nextDisplayNumber: 2,
          reminder: null,
          groups: [
            currentGroup("g-mains", 1, "held", [
              row("l-9", "Steak", "1.000", {
                workingOrderId: "wo-4",
                released: false,
                kitchen: null,
                netAmount: "5.00",
              }),
            ]),
          ],
          ungrouped: [],
        }),
      ),
    });
    await openMesa(el);
    await tap(el, "Flan");
    await expect.poll(() => tableOrder(el)!.billEdit?.draftRevision).toBe(1);
    await toggle(el, "Flan");
    const screen = tableOrder(el)!.shadowRoot!;
    screen.querySelector<HTMLElement>("[data-review-open]")!.click();
    await flush(el);
    await userEvent.click(screen.querySelector<HTMLElement>("[data-draft-move]")!);
    await flush(el);
    const dialog = screen.querySelector<HTMLElement>("[data-draft-move-dialog]")!;
    const closed = new Promise((resolve) =>
      dialog.addEventListener("wt-close", resolve, { once: true }),
    );
    await userEvent.click(
      dialog.querySelector<HTMLElement>('[data-draft-move-to="join:g-mains"]')!,
    );
    await closed;
    await flush(el);
    expect(draft(el).lines[0]!.place).toEqual({ kind: "join", groupId: "g-mains" });
    await act(el, "send-all");

    expect(api.submitDraft.mock.calls[0]![2]).toEqual(
      expect.objectContaining({
        groups: [{ release: "hold", lineIds: ["line-2"], joinGroupId: "g-mains" }],
      }),
    );
  });

  it("sends the same request again when no answer comes, and takes the answer it then gets", async () => {
    const { el } = await mountApp({
      submitDraft: vi
        .fn(server.submitDraft)
        .mockRejectedValueOnce(new TypeError("Failed to fetch")),
    });
    await openMesa(el);
    await tap(el, "Beer");

    await act(el, "fire-all");
    await vi.waitFor(() => expect(tableOrder(el)).toBeNull(), { timeout: 4000, interval: 50 });
    await flush(el);

    const calls = api.submitDraft.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    expect(tableOrder(el)).toBeNull();
    expect(banner(el)).toBeNull();
  });

  it("gives up after two more tries, reads the draft again and says to check the tab", async () => {
    const { el } = await mountApp({
      submitDraft: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    await openMesa(el);
    await tap(el, "Beer");
    await tap(el, "Steak");
    const reads = api.listDrafts.mock.calls.length;

    await act(el, "fire-all");
    // Two pauses between the three tries run on real time; wait for the message they end in.
    await vi.waitFor(
      () => expect(banner(el)?.textContent).toContain(t("table.round_unconfirmed")),
      {
        timeout: 4000,
        interval: 50,
      },
    );
    await flush(el);

    const calls = api.submitDraft.mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[2]).toEqual(calls[0]);
    expect(api.listDrafts.mock.calls.length).toBe(reads + 1);
    expect(banner(el)!.textContent).toContain(t("table.round_unconfirmed"));
    expect(rows(el)).toEqual(["Beer ×1", "Steak ×1"]);
  });

  it("shows the draft as the server holds it after a reply that never came", async () => {
    const { el } = await mountApp({
      submitDraft: vi.fn(async (...args: Parameters<DraftServer["apply"]>) => {
        server.apply(...args);
        throw new TypeError("Failed to fetch");
      }),
    });
    await openMesa(el);
    await tap(el, "Beer");
    await tap(el, "Steak");
    await toggle(el, "Beer");

    await act(el, "fire-selected");
    // Two pauses between the three tries run on real time; wait for the message they end in.
    await vi.waitFor(
      () => expect(banner(el)?.textContent).toContain(t("table.round_unconfirmed")),
      {
        timeout: 4000,
        interval: 50,
      },
    );
    await flush(el);

    expect(api.submitDraft).toHaveBeenCalledTimes(3);
    expect(rows(el)).toEqual(["Steak ×1"]);
    expect(banner(el)!.textContent).toContain(t("table.round_unconfirmed"));
  });

  it("saves the lines under the new menu version, then sends them once under a new id", async () => {
    const { el } = await mountApp({
      submitDraft: vi.fn(server.submitDraft).mockRejectedValueOnce({
        code: "menu.version_changed",
        status: 409,
        menus: [{ menuId: "lunch", liveVersionId: "v2" }],
      }),
    });
    await openMesa(el);
    await tap(el, "Beer");
    api.listZoneOffers.mockResolvedValue(catalogue("v2"));

    await act(el, "fire-all");

    expect(api.saveDraft).toHaveBeenCalledTimes(2);
    expect(api.saveDraft.mock.calls[1]![1].lines).toEqual([
      expect.objectContaining({ menuItemId: "offer-beer", menuVersionId: "v2" }),
    ]);
    const calls = api.submitDraft.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]![2].submissionId).not.toBe(calls[0]![2].submissionId);
    expect(server.sentGroups(api.submitDraft.mock.calls[1]![2])[0]!.lines).toEqual([
      { menuItemId: "offer-beer", menuVersionId: "v2", quantity: "1" },
    ]);
    expect(tableOrder(el)).toBeNull();
  });

  it("sends nothing more when the new version changed a price, and saves what is confirmed", async () => {
    const { el } = await mountApp({
      submitDraft: vi.fn().mockRejectedValue({
        code: "menu.version_changed",
        status: 409,
        menus: [{ menuId: "lunch", liveVersionId: "v2" }],
      }),
    });
    await openMesa(el);
    await tap(el, "Beer");
    api.listZoneOffers.mockResolvedValue(catalogue("v2", { Beer: "6.00" }));

    await act(el, "fire-all");
    const dialog = el.shadowRoot!.querySelector("till-basket-refresh-dialog")!;
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!.click();
    await flush(el);
    await back(el);

    expect(api.submitDraft).toHaveBeenCalledOnce();
    expect(server.drafts[0]!.lines[0]!.menuVersionId).toBe("v2");
  });

  it("reads the draft again when another device changed it, and sends nothing", async () => {
    const { el } = await mountApp({
      submitDraft: vi.fn().mockRejectedValue({ code: "draft.out_of_date", status: 409 }),
    });
    await openMesa(el);
    await tap(el, "Beer");
    const reads = api.listDrafts.mock.calls.length;

    await act(el, "fire-all");

    expect(api.submitDraft).toHaveBeenCalledOnce();
    expect(api.listDrafts.mock.calls.length).toBe(reads + 1);
    expect(banner(el)!.textContent).toContain(t("table.draft_changed_elsewhere"));
    expect(rows(el)).toEqual(["Beer ×1"]);
  });

  it("reads the draft again when someone took it over, and says so", async () => {
    const { el } = await mountApp({
      submitDraft: vi.fn().mockRejectedValue({
        code: "draft.taken_over",
        status: 409,
        ownerId: "p2",
        ownerName: "Sam",
      }),
    });
    await openMesa(el);
    await tap(el, "Beer");
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    server.drafts[0]!.ownerId = "p2";

    await act(el, "fire-all");

    expect(banner(el)!.textContent).toContain(
      t("table.draft_taken_over_unsent").replace("{name}", "Sam"),
    );
    expect(banner(el)!.textContent).not.toContain(codeMessage("draft.taken_over"));
    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(draft(el).editsLocked).toBe(true);
    expect(api.submitDraft).toHaveBeenCalledOnce();
  });

  it("says someone else took it over when the refusal names no one", async () => {
    const { el } = await mountApp({
      submitDraft: vi.fn().mockRejectedValue({ code: "draft.taken_over", status: 409 }),
    });
    await openMesa(el);
    await tap(el, "Beer");

    await act(el, "fire-all");

    expect(banner(el)!.textContent).toContain(t("table.draft_taken_over_unsent_unnamed"));
  });

  it("reloads the draft, sends nothing and says so when the saved draft no longer lines up", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    draft(el).setLineExtras(0, { note: "cold" });
    await tap(el, "Beer");
    await back(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    expect(rows(el)).toEqual(["Beer ×1", "Beer ×1"]);
    draft(el).setLineExtras(1, { note: "cold" });

    await act(el, "fire-all");

    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(banner(el)!.textContent).toContain(t("table.draft_recount"));
    expect(rows(el)).toEqual(["Beer ×2"]);
  });

  it("sends nothing for lines that are not in the party's draft", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    const elsewhere = new WorkingOrderStore();

    emit(tableOrder(el)!, "submit-draft", {
      lines: [{ menuItemId: "offer-beer", quantity: "1" }],
      groups: [{ release: "fire", lineIndexes: [0] }],
      store: elsewhere,
      sent: elsewhere.lines,
    });
    await flush(el);

    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(banner(el)!.textContent).toContain(t("table.error"));
  });

  it("says a failed save and sends nothing", async () => {
    const { el } = await mountApp({
      saveDraft: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    await openMesa(el);
    await tap(el, "Beer");

    await act(el, "fire-all");

    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(banner(el)?.textContent ?? "").toContain(t("table.error"));
    expect(rows(el)).toEqual([]);
    expect(retainedCandidate(el)?.lines.map((line) => line.product.name)).toEqual(["Beer"]);
    expect(draft(el).editsLocked).toBe(true);
  });

  it("says a refused save and sends nothing", async () => {
    const { el } = await mountApp({
      saveDraft: vi.fn().mockRejectedValue({ code: "party.not_open", status: 409 }),
    });
    await openMesa(el);
    await tap(el, "Beer");

    await act(el, "fire-all");

    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(banner(el)!.textContent).toContain(codeMessage("party.not_open"));
  });
});

/** A request that gets no answer: it rejects only when the signal among its arguments is aborted. */
const noAnswer = (...args: unknown[]) =>
  new Promise<never>((_resolve, reject) => {
    const { signal } = args.at(-1) as { signal: AbortSignal };
    signal.addEventListener("abort", () =>
      reject(new DOMException("The operation was aborted.", "AbortError")),
    );
  });

const sending = (el: TillApp) =>
  tableOrder(el)!.shadowRoot!.querySelector("[data-round-sending]") !== null;

describe("till-app: a refused save when the draft is sent", () => {
  it("sends the refused edits again at Send, and says the refusal", async () => {
    const { el } = await mountApp({
      saveDraft: vi.fn().mockRejectedValue({ code: "party.not_open", status: 409 }),
    });
    await openMesa(el);
    await tap(el, "Beer");
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    await flush(el);
    expect(api.saveDraft).toHaveBeenCalledOnce();

    await act(el, "fire-all");

    expect(api.saveDraft).toHaveBeenCalledTimes(2);
    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(banner(el)!.textContent).toContain(codeMessage("party.not_open"));
    expect(tableOrder(el)).not.toBeNull();
  });

  it("says an ended session at Send", async () => {
    const { el } = await mountApp({
      saveDraft: vi.fn().mockRejectedValue({ code: "session.required", status: 401 }),
    });
    await openMesa(el);
    await tap(el, "Beer");

    await act(el, "fire-all");

    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(banner(el)!.textContent).toContain(codeMessage("session.required"));
  });

  it("says a closed party in its own words when the submission is refused, and stays on the table", async () => {
    const { el } = await mountApp({
      submitDraft: vi.fn().mockRejectedValue({ code: "party.not_open", status: 409 }),
    });
    await openMesa(el);
    await tap(el, "Beer");
    const floorReads = api.getTablesState.mock.calls.length;

    await act(el, "fire-all");

    expect(banner(el)!.textContent).toContain(codeMessage("party.not_open"));
    expect(tableOrder(el)).not.toBeNull();
    expect(api.getTablesState.mock.calls.length).toBe(floorReads);
    expect(rows(el)).toEqual(["Beer ×1"]);
  });
});

describe("till-app: a draft that cannot be saved or read", () => {
  it("says a change that could not be saved when the table is left", async () => {
    const { el } = await mountApp({
      saveDraft: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    await openMesa(el);
    await tap(el, "Beer");

    await back(el);

    expect(banner(el)!.textContent).toContain(t("table.draft_save_failed"));
  });

  it("shows no draft over the saved one when it cannot be read, and says so", async () => {
    const { el } = await mountApp({
      listDrafts: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    await openMesa(el);

    expect(tableOrder(el)).not.toBeNull();
    expect(browser(el)).toBeNull();
    expect(tableOrder(el)!.shadowRoot!.querySelector("[data-draft-action]")).toBeNull();
    expect(banner(el)!.textContent).toContain(t("table.draft_read_failed"));
  });
});

describe("till-app: signing out while a save is out", () => {
  it("starts no save after sign-out begins", async () => {
    let answer!: () => void;
    const { el } = await mountApp();
    await openMesa(el);
    server.saveDraft.mockImplementationOnce(async (partyId, save) => {
      await new Promise<void>((resolve) => (answer = resolve));
      return server.snapshot(server.save(partyId, save));
    });
    await tap(el, "Beer");
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    await tap(el, "Steak");
    // The second save is queued behind the first, which is still out.
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));

    emit(tableOrder(el)!, "logout");
    await flush(el);
    answer();
    await flush(el);
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));

    expect(api.saveDraft).toHaveBeenCalledOnce();
    expect(api.logout).toHaveBeenCalledOnce();
  });
});

describe("till-app: a Send the session outlives", () => {
  afterEach(() => vi.useRealTimers());

  it("sends nothing as the next person when Send was waiting on a save at sign-out", async () => {
    const sentBy: string[] = [];
    const { el } = await mountApp({ submitDraft: submitRecordingWho(sentBy) });
    await openMesa(el);
    const answer = holdNextSave();
    await tap(el, "Beer");
    await act(el, "fire-all");
    expect(api.saveDraft).toHaveBeenCalledOnce();

    emit(tableOrder(el)!, "logout");
    await flush(el);
    await signIn(el, "p2", "Sam");
    answer();
    await flush(el, 8);

    expect(sentBy).toEqual([]);
    expect(server.drafts.map((each) => [each.ownerId, each.lines.length])).toEqual([["p1", 1]]);
    expect(banner(el)).toBeNull();
  });

  it("does not send again as the next person a Send whose reply was lost after sign-out", async () => {
    let lose!: () => void;
    const sentBy: string[] = [];
    const { el } = await mountApp({
      submitDraft: submitRecordingWho(sentBy, (resolve) => (lose = resolve)),
    });
    await openMesa(el);
    await tap(el, "Beer");
    await act(el, "fire-all");
    expect(sentBy).toEqual(["p1"]);

    emit(tableOrder(el)!, "logout");
    await flush(el);
    await signIn(el, "p2", "Sam");
    const reads = api.listDrafts.mock.calls.length;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    lose();
    await vi.advanceTimersByTimeAsync(2 * SUBMIT_RETRY_PAUSE_MS);
    vi.useRealTimers();
    await flush(el);

    expect(sentBy).toEqual(["p1"]);
    expect(api.listDrafts.mock.calls.length).toBe(reads);
    expect(banner(el)).toBeNull();
  });

  it("says nothing to the next person when the read after a lost reply answers after sign-out", async () => {
    let answer!: () => void;
    const { el } = await mountApp({
      submitDraft: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    await openMesa(el);
    const read = server.listDrafts.getMockImplementation()!;
    server.listDrafts.mockImplementationOnce(async (partyId: string) => {
      await new Promise<void>((resolve) => (answer = resolve));
      return read(partyId);
    });
    await tap(el, "Beer");
    await act(el, "fire-all");
    // Two pauses between the three tries run on real time; wait for the read they end in.
    await vi.waitFor(() => expect(answer).toBeTypeOf("function"), { timeout: 4000, interval: 50 });
    await flush(el);
    expect(api.submitDraft).toHaveBeenCalledTimes(3);

    emit(tableOrder(el)!, "logout");
    await flush(el);
    await signIn(el, "p2", "Sam");
    answer();
    await flush(el, 6);

    expect(banner(el)).toBeNull();
  });

  it("says nothing to the next person when the floor read after a party changed elsewhere answers after sign-out", async () => {
    let answer!: () => void;
    const { el } = await mountApp({
      submitDraft: vi.fn().mockRejectedValue({ code: "party.out_of_date", partyId: "v1" }),
    });
    await openMesa(el);
    api.getTablesState.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => (answer = resolve));
      return [mesa4, mesa7];
    });
    await tap(el, "Beer");
    await act(el, "fire-all");
    expect(api.submitDraft).toHaveBeenCalledOnce();

    emit(tableOrder(el)!, "logout");
    await flush(el);
    await signIn(el, "p2", "Sam");
    answer();
    await flush(el, 6);

    expect(banner(el)).toBeNull();
  });

  it("asks the next person nothing when the offers read after a newer menu version answers after sign-out", async () => {
    let answer!: () => void;
    const { el } = await mountApp({
      submitDraft: vi.fn().mockRejectedValue({
        code: "menu.version_changed",
        status: 409,
        menus: [{ menuId: "lunch", liveVersionId: "v2" }],
      }),
    });
    await openMesa(el);
    api.listZoneOffers.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => (answer = resolve));
      return catalogue("v2", { Beer: "6.00" });
    });
    await tap(el, "Beer");
    await act(el, "fire-all");
    expect(api.submitDraft).toHaveBeenCalledOnce();

    emit(tableOrder(el)!, "logout");
    await flush(el);
    await signIn(el, "p2", "Sam");
    answer();
    await flush(el, 6);

    expect(el.shadowRoot!.querySelector("till-basket-refresh-dialog")).toBeNull();
    expect(banner(el)).toBeNull();
    expect(api.submitDraft).toHaveBeenCalledOnce();
  });

  it("leaves the next person where they are when the reads after a Send answer after sign-out", async () => {
    let answer!: () => void;
    const { el } = await mountApp();
    await openMesa(el);
    api.getTabLines.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => (answer = resolve));
      return { lines: [], revision: 0, editSentLines: true };
    });
    await tap(el, "Beer");
    await act(el, "fire-all");
    expect(api.submitDraft).toHaveBeenCalledOnce();

    emit(tableOrder(el)!, "logout");
    await flush(el);
    await signIn(el, "p2", "Sam");
    answer();
    await flush(el, 6);

    expect(floor(el)).toBeNull();
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { message: string }>(
        "wt-toast[data-submitted-toast]",
      )?.message ?? "",
    ).toBe("");
  });
});

describe("till-app: leaving a draft while a save is out, then signing out", () => {
  const mesa9 = table("t9", "9", null);
  const sideBySide: FormFactor = "till";

  /** Beer's save is held, and Steak is an edit waiting behind it, so the next save queues. */
  async function editBehindHeldSave(el: TillApp): Promise<() => void> {
    const answer = holdNextSave();
    await tap(el, "Beer");
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    await tap(el, "Steak");
    expect(api.saveDraft).toHaveBeenCalledOnce();
    return answer;
  }

  /** Resolves to how many floor reads there had been when the held save answered. */
  async function signOutAndInAsSam(el: TillApp, answer: () => void): Promise<number> {
    emit(el.shadowRoot!.querySelector("till-shell")!, "logout");
    await flush(el);
    await signIn(el, "p2", "Sam");
    const floorReads = api.getTablesState.mock.calls.length;
    answer();
    await flush(el, 8);
    return floorReads;
  }

  /** Every list, seat and read call so far, with who was signed in when it was sent. */
  function recordingWho() {
    const calls: string[] = [];
    const wrap =
      <A extends unknown[], R>(name: string, call: (...args: A) => R) =>
      (...args: A): R => {
        calls.push(`${name}(${String(args[0])}) as ${server.personId}`);
        return call(...args);
      };
    return { calls, wrap };
  }

  it("seats a free table for the first waiter at once while the left draft saves, and nothing for the next person", async () => {
    const who = recordingWho();
    const { el } = await mountApp({
      listDrafts: vi.fn(who.wrap("listDrafts", server.listDrafts)),
      getTill: vi.fn().mockResolvedValue(till(sideBySide)),
      getTablesState: vi.fn().mockResolvedValue([mesa4, mesa7, mesa9]),
      seatTable: vi.fn().mockResolvedValue({
        partyId: "v-new",
        tabId: "wo-new",
        revision: 0,
        orderNumber: 12,
      }),
    });
    await flush(el);
    await signIn(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    const answer = await editBehindHeldSave(el);
    const offerReads = api.listZoneOffers.mock.calls.length;
    const tabReads = api.getTabLines.mock.calls.length;
    who.calls.length = 0;
    emit(floor(el)!, "open-table", { tableId: "t9", seated: false, guestCount: 2 });
    await flush(el);

    expect(api.seatTable.mock.calls).toEqual([["t9", 2]]);
    expect(api.getTabLines.mock.calls.slice(tabReads)).toEqual([["wo-new"]]);
    expect(api.listZoneOffers.mock.calls.length).toBe(offerReads);
    expect(who.calls).toEqual(["listDrafts(v-new) as p1"]);
    who.calls.length = 0;
    const seatCalls = api.seatTable.mock.calls.length;
    const tabCalls = api.getTabLines.mock.calls.length;

    await signOutAndInAsSam(el, answer);

    expect(api.seatTable.mock.calls.length).toBe(seatCalls);
    expect(api.getTabLines.mock.calls.length).toBe(tabCalls);
    expect(api.listZoneOffers.mock.calls.length).toBe(offerReads);
    expect(who.calls).toEqual([]);
    expect(tableOrder(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("till-counter-screen")).not.toBeNull();
    expect(banner(el)).toBeNull();
  });

  it("opens a seated table for the first waiter at once while the left draft saves, and nothing for the next person", async () => {
    const who = recordingWho();
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(till(sideBySide)),
      listDrafts: vi.fn(who.wrap("listDrafts", server.listDrafts)),
    });
    await flush(el);
    await signIn(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    const answer = await editBehindHeldSave(el);
    const tabReads = api.getTabLines.mock.calls.length;
    const offerReads = api.listZoneOffers.mock.calls.length;
    who.calls.length = 0;
    emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
    await flush(el);

    expect(api.getTabLines.mock.calls.slice(tabReads)).toEqual([["wo-7"]]);
    expect(who.calls).toEqual(["listDrafts(v7) as p1"]);
    expect(api.listZoneOffers.mock.calls.length).toBe(offerReads);
    const tabCalls = api.getTabLines.mock.calls.length;
    who.calls.length = 0;

    await signOutAndInAsSam(el, answer);

    expect(api.getTabLines.mock.calls.length).toBe(tabCalls);
    expect(api.listZoneOffers.mock.calls.length).toBe(offerReads);
    expect(who.calls).toEqual(["listDrafts(v7) as p2"]);
    expect(tableOrder(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("till-counter-screen")).not.toBeNull();
    expect(banner(el)).toBeNull();
  });

  it("says nothing to the next person when Back to floor waited on a save at sign-out", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    const answer = await editBehindHeldSave(el);
    await back(el);

    const floorReads = await signOutAndInAsSam(el, answer);

    expect(banner(el)).toBeNull();
    expect(api.getTablesState.mock.calls.length).toBe(floorReads);
  });

  it("says nothing to the next person when choosing another tab waited on a save at sign-out", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    const answer = await editBehindHeldSave(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);

    const floorReads = await signOutAndInAsSam(el, answer);

    expect(banner(el)).toBeNull();
    expect(api.getTablesState.mock.calls.length).toBe(floorReads);
  });

  describe("when the next person has split a bill off before the save answers", () => {
    const splitting = () => ({
      splitBill: vi.fn().mockResolvedValue({ billId: "wo-check" }),
      mergeBills: vi.fn().mockResolvedValue(undefined),
    });

    /** Sam signs in, opens Mesa 7 from `floorTab` and splits a bill off it; then the held save
     * answers. */
    async function samSplitsBeforeTheSaveAnswers(
      el: TillApp,
      answer: () => void,
      floorTab: string,
    ): Promise<void> {
      emit(shell(el), "logout");
      await flush(el);
      await signIn(el, "p2", "Sam");
      emit(shell(el), "screen-select", { screen: floorTab });
      await flush(el);
      emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
      await flush(el);
      emit(tableOrder(el)!, "split-lines", { transfers: [{ lineNo: 1 }] });
      await flush(el);
      expect(api.splitBill).toHaveBeenCalledOnce();
      expect(tableOrder(el)!.orderId).toBe("wo-check");
      answer();
      await flush(el, 8);
    }

    it("keeps Sam on the split-off bill when Back to floor waited on the save and merges nothing back", async () => {
      const { el } = await mountApp(splitting());
      await openMesa(el);
      const answer = await editBehindHeldSave(el);
      await back(el);

      await samSplitsBeforeTheSaveAnswers(el, answer, "floor");

      expect(api.mergeBills).not.toHaveBeenCalled();
      expect(banner(el)).toBeNull();
      expect(tableOrder(el)!.orderId).toBe("wo-check");
    });

    it("keeps Sam on the split-off bill when choosing another tab waited on the save and merges nothing back", async () => {
      const { el } = await mountApp(splitting());
      await openMesa(el);
      const answer = await editBehindHeldSave(el);
      emit(shell(el), "screen-select", { screen: "floor" });
      await flush(el);

      await samSplitsBeforeTheSaveAnswers(el, answer, "floor");

      expect(api.mergeBills).not.toHaveBeenCalled();
      expect(banner(el)).toBeNull();
      expect(tableOrder(el)!.orderId).toBe("wo-check");
    });

    it("keeps Sam on the split-off bill when opening another table waited on the save and merges nothing back", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue(till(sideBySide)),
        ...splitting(),
      });
      await flush(el);
      await signIn(el);
      emit(shell(el), "screen-select", { screen: "floor" });
      await flush(el);
      emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
      await flush(el);
      const answer = await editBehindHeldSave(el);
      emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
      await flush(el);

      await samSplitsBeforeTheSaveAnswers(el, answer, "floor");

      expect(api.mergeBills).not.toHaveBeenCalled();
      expect(banner(el)).toBeNull();
      expect(tableOrder(el)!.orderId).toBe("wo-check");
    });
  });
});

describe("till-app: how long a send may take", () => {
  /** Settles answers and renders under fake timers. */
  async function settle(el: TillApp): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;
    }
  }

  async function confirmFireAll(el: TillApp): Promise<void> {
    for (const row of tableOrder(el)!.shadowRoot!.querySelectorAll<HTMLElement>(
      '[data-draft-select][aria-pressed="false"]',
    ))
      row.click();
    await settle(el);
    tableOrder(el)!
      .shadowRoot!.querySelector<HTMLElement>('[data-draft-action="fire-selected"]')!
      .click();
    await settle(el);
  }

  afterEach(() => vi.useRealTimers());

  it("cuts a send with no answer off at 150 seconds, not before, and does not send it again", async () => {
    const { el } = await mountApp({ submitDraft: vi.fn(noAnswer) });
    await openMesa(el);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    press(el, "Beer");
    await settle(el);
    await confirmFireAll(el);
    const [, , , options] = api.submitDraft.mock.calls[0] as [
      string,
      string,
      unknown,
      { signal: AbortSignal },
    ];

    await vi.advanceTimersByTimeAsync(149_999);
    await settle(el);
    expect(options.signal.aborted).toBe(false);
    expect(sending(el)).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    await settle(el);
    expect(options.signal.aborted).toBe(true);
    expect(api.submitDraft).toHaveBeenCalledOnce();
    expect(sending(el)).toBe(false);
    expect(banner(el)!.textContent).toContain(t("table.round_unconfirmed"));
    expect(rows(el)).toEqual(["Beer ×1"]);
  });

  it("waits a moment before sending again after a quick failure", async () => {
    const { el } = await mountApp({
      submitDraft: vi
        .fn(server.submitDraft)
        .mockRejectedValueOnce(new TypeError("Failed to fetch")),
    });
    await openMesa(el);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    press(el, "Beer");
    await settle(el);
    await confirmFireAll(el);
    expect(api.submitDraft).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(SUBMIT_RETRY_PAUSE_MS - 1);
    expect(api.submitDraft).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await settle(el);
    expect(api.submitDraft).toHaveBeenCalledTimes(2);
  });

  it("unlocks the draft at the limit when the save before the send gets no answer", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    press(el, "Beer");
    await settle(el);
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS);
    await settle(el);
    api.saveDraft.mockImplementation(noAnswer);
    draft(el).setLineCourse(0, "mains");
    await settle(el);
    await confirmFireAll(el);

    await vi.advanceTimersByTimeAsync(149_999);
    await settle(el);
    expect(sending(el)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await settle(el);

    expect(sending(el)).toBe(false);
    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(banner(el)!.textContent).toContain(t("table.error"));
  });

  it("unlocks the draft 150 seconds after Send even when a save was already out", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const saveDraft = vi.fn(server.saveDraft).mockImplementationOnce(async (...args) => {
      await held;
      return server.saveDraft(...args);
    });
    const { el } = await mountApp({ saveDraft });
    await openMesa(el);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    press(el, "Beer");
    await settle(el);
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS);
    expect(api.saveDraft).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(100_000);
    press(el, "Steak");
    await settle(el);
    release();
    await settle(el);
    api.saveDraft.mockImplementation(noAnswer);
    draft(el).setLineCourse(0, "mains");
    await settle(el);
    await confirmFireAll(el);

    await vi.advanceTimersByTimeAsync(149_999);
    await settle(el);
    expect(sending(el)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await settle(el);

    expect(sending(el)).toBe(false);
    expect(api.submitDraft).not.toHaveBeenCalled();
  });

  it("does not send again when the limit ends a pause between tries", async () => {
    const { el } = await mountApp({
      submitDraft: vi.fn(
        () =>
          new Promise((_resolve, reject) =>
            setTimeout(() => reject(new TypeError("Failed to fetch")), 149_800),
          ),
      ),
    });
    await openMesa(el);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    press(el, "Beer");
    await settle(el);
    await confirmFireAll(el);

    await vi.advanceTimersByTimeAsync(150_000);
    await settle(el);

    expect(api.submitDraft).toHaveBeenCalledOnce();
    expect(sending(el)).toBe(false);
    expect(banner(el)!.textContent).toContain(t("table.round_unconfirmed"));
  });

  it("unlocks the draft at the limit when the read after a lost reply gets no answer", async () => {
    const { el } = await mountApp({
      submitDraft: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    await openMesa(el);
    api.listDrafts.mockImplementation(noAnswer);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    press(el, "Beer");
    await settle(el);
    await confirmFireAll(el);
    await vi.advanceTimersByTimeAsync(2 * SUBMIT_RETRY_PAUSE_MS);
    await settle(el);
    expect(api.submitDraft).toHaveBeenCalledTimes(3);
    expect(sending(el)).toBe(true);

    await vi.advanceTimersByTimeAsync(150_000);
    await settle(el);

    expect(sending(el)).toBe(false);
    expect(banner(el)!.textContent).toContain(t("table.round_unconfirmed"));
  });
});

describe("till-app: a later addition is decided from the table's own groups", () => {
  const placementCourses = [
    { id: "drinks", name: "Drinks", displayOrder: 0, heldUntilFired: false },
    { id: "mains", name: "Mains", displayOrder: 1, heldUntilFired: true },
    { id: "desserts", name: "Desserts", displayOrder: 2, heldUntilFired: true },
  ];
  const placementGroup = (id: string, position: number, courseIds: string[]): OrderGroup => ({
    id,
    position,
    displayNumber: position,
    numberPartyId: "v1",
    courseIds,
    state: "held",
    firedAt: null,
    remindAt: null,
    lineIds: [],
    summary: id,
  });
  async function placementApp(
    hasGroups: boolean,
    groups: OrderGroup[] = [],
    retainedCourses = placementCourses,
  ) {
    const mounted = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till(drillFormFactor), courses: placementCourses }),
      listGroups: vi.fn().mockResolvedValue({ revision: 3, groups }),
      readCurrentOrders: vi.fn().mockResolvedValue({
        revision: 3,
        hasGroups,
        nextDisplayNumber: Math.max(0, ...groups.map((g) => g.displayNumber)) + 1,
        retainedCourses,
        groups: [],
        ungrouped: [],
        reminder: null,
      }),
    });
    await openMesa(mounted.el);
    return mounted;
  }

  it.each([
    { story: "first drinks", hasGroups: false, groups: [], dish: "Beer", place: { kind: "fire" } },
    {
      story: "first main",
      hasGroups: false,
      groups: [],
      dish: "Steak",
      place: { kind: "new", slot: 1 },
    },
    {
      story: "removed groups",
      hasGroups: true,
      groups: [],
      dish: "Steak",
      place: { kind: "fire" },
    },
    {
      story: "matching Mains",
      hasGroups: true,
      groups: [placementGroup("g-main", 2, ["mains"])],
      dish: "Steak",
      place: { kind: "join", groupId: "g-main" },
    },
    {
      story: "a drink beside held Mains",
      hasGroups: true,
      groups: [placementGroup("g-main", 2, ["mains"])],
      dish: "Beer",
      place: { kind: "fire" },
    },
    {
      story: "Desserts after Mains",
      hasGroups: true,
      groups: [placementGroup("g-main", 2, ["mains"])],
      dish: "Flan",
      place: { kind: "new", slot: 1 },
    },
    {
      story: "late main beside Desserts",
      hasGroups: true,
      groups: [placementGroup("g-dessert", 3, ["desserts"])],
      dish: "Steak",
      place: { kind: "fire" },
    },
    {
      story: "matching Desserts",
      hasGroups: true,
      groups: [placementGroup("g-dessert", 3, ["desserts"])],
      dish: "Flan",
      place: { kind: "join", groupId: "g-dessert" },
    },
  ])(
    "places a tapped dish using the server's table history: $story",
    async ({ hasGroups, groups, dish, place }) => {
      const { el } = await placementApp(hasGroups, groups);
      await tap(el, dish);
      expect(draft(el).lines.map((line) => line.place)).toEqual([place]);
    },
  );

  it("sends the saved first-order arrangement with its acquired bill observation", async () => {
    const { el } = await placementApp(false);
    await tap(el, "Flan");
    await tap(el, "Beer");
    await tap(el, "Steak");
    const sentStore = draft(el);
    await act(el, "send-all");
    expect(api.submitDraft.mock.calls[0]![2]).toEqual({
      submissionId: expect.any(String),
      expectedPartyRevision: 3,
      draftRevision: 1,
      expectedEdit: { billId: "wo-4", editorVersion: 1, draftId: "draft-1", draftRevision: 1 },
      groups: [
        { release: "fire", lineIds: ["line-3"] },
        { release: "hold", lineIds: ["line-4"] },
        { release: "hold", lineIds: ["line-2"] },
      ],
    });
    expect(sentStore.lines).toEqual([]);
    expect(tableOrder(el)).toBeNull();
    expect(server.drafts).toEqual([]);
  });

  it("keeps an inactive course in Fire now through the rendered Send and saved-line request", async () => {
    const inactive = catalogue("v1");
    inactive.offers[0]!.courseId = "retired";
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till(drillFormFactor), courses: placementCourses }),
      listZoneOffers: vi.fn().mockResolvedValue(inactive),
      listDefaultZoneOffers: vi.fn().mockResolvedValue(inactive),
    });
    await openMesa(el);
    await tap(el, "Beer");
    expect(draft(el).lines[0]!.place).toEqual({ kind: "fire" });
    const sentStore = draft(el);
    await act(el, "send-all");
    expect(api.submitDraft.mock.calls[0]![2]).toEqual({
      submissionId: expect.any(String),
      expectedPartyRevision: 3,
      draftRevision: 1,
      expectedEdit: { billId: "wo-4", editorVersion: 1, draftId: "draft-1", draftRevision: 1 },
      groups: [{ release: "fire", lineIds: ["line-2"] }],
    });
    expect(sentStore.lines).toEqual([]);
    expect(tableOrder(el)).toBeNull();
    expect(server.drafts).toEqual([]);
  });

  it("sorts first-order courses even when dessert is tapped before a main, and emits one change per tap", async () => {
    const { el } = await placementApp(false);
    const changed = vi.fn();
    draft(el).subscribe(changed);
    await tap(el, "Flan");
    await tap(el, "Steak");
    expect(draft(el).lines.map((line) => ({ name: line.product.name, place: line.place }))).toEqual(
      [
        { name: "Flan", place: { kind: "new", slot: 2 } },
        { name: "Steak", place: { kind: "new", slot: 1 } },
      ],
    );
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("uses retained course ordering when a held course is absent from the active course list", async () => {
    const { el } = await placementApp(
      true,
      [placementGroup("g-retained", 2, ["retained-starter"])],
      [{ id: "retained-starter", name: "Old starter", displayOrder: 0, heldUntilFired: true }],
    );
    await tap(el, "Flan");
    expect(draft(el).lines[0]!.place).toEqual({ kind: "new", slot: 1 });
  });

  it("replaces only a changed line's destination and keeps manual placement across a table refresh", async () => {
    const { el } = await placementApp(false);
    await tap(el, "Steak");
    await tap(el, "Flan");
    draft(el).setLinePlaces([1], { kind: "new", slot: 4 });
    draft(el).setLineCourse(0, "desserts");
    expect(draft(el).lines.map((line) => line.place)).toEqual([
      { kind: "new", slot: 4 },
      { kind: "new", slot: 4 },
    ]);
    await back(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    expect(draft(el).lines.map((line) => line.place)).toEqual([
      { kind: "new", slot: 4 },
      { kind: "new", slot: 4 },
    ]);
  });

  it("treats a restored draft as a first order when the table it opens has no group", async () => {
    const held: OrderGroup = {
      courseIds: [],
      id: "g-7",
      position: 1,
      displayNumber: 1,
      numberPartyId: "v1",
      state: "held",
      firedAt: null,
      remindAt: null,
      lineIds: ["l-1"],
      summary: "1 × Steak",
    };
    const sideBySide: FormFactor = "till";
    let answerGroups!: () => void;
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(till(sideBySide)),
      listGroups: vi.fn(async (partyId: string) => {
        if (partyId === "v7") return { revision: 9, groups: [held] };
        await new Promise<void>((resolve) => (answerGroups = resolve));
        return { revision: 3, groups: [] };
      }),
    });
    server.save("v1", {
      billId: "wo-4",
      draftId: null,
      revision: 0,
      lines: [
        {
          slot: 0,
          joinGroupId: null,
          afterGroupId: null,
          menuItemId: "offer-beer",
          variantId: null,
          menuVersionId: "v1",
          options: [],
          extras: [],
          note: null,
          quantity: "1",
          courseId: null,
          noMerge: false,
        },
      ],
    });
    await flush(el);
    await signIn(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
    await flush(el);

    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    answerGroups();
    await flush(el);

    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(
      tableOrder(el)!.shadowRoot!.querySelector('[data-draft-action="send-all"]'),
    ).not.toBeNull();
  });
});

describe("till-app: a table open that another overtakes", () => {
  const beerLine = {
    slot: 0,
    joinGroupId: null,
    afterGroupId: null,
    menuItemId: "offer-beer",
    variantId: null,
    menuVersionId: "v1",
    options: [],
    extras: [],
    note: null,
    quantity: "1",
    courseId: null,
    noMerge: false,
  };

  it("keeps the next table's draft on screen when an earlier table's read answers late", async () => {
    const sideBySide: FormFactor = "till";
    let answerMesa7!: () => void;
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(till(sideBySide)),
      listDrafts: vi.fn(async (partyId: string) => {
        if (partyId === "v7") await new Promise<void>((resolve) => (answerMesa7 = resolve));
        return server.listDrafts(partyId);
      }),
    });
    server.save("v1", { billId: "wo-4", draftId: null, revision: 0, lines: [beerLine] });
    await flush(el);
    await signIn(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    expect(rows(el)).toEqual(["Beer ×1"]);

    answerMesa7();
    await flush(el);

    expect(browser(el)).not.toBeNull();
    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(banner(el)).toBeNull();
  });

  it("gives no one the draft of a table opened by someone who has since signed out", async () => {
    let answerOffers!: () => void;
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(till(orderTabFormFactor)),
      listZoneOffers: vi.fn(async () => {
        await new Promise<void>((resolve) => (answerOffers = resolve));
        return catalogue("v1");
      }),
    });
    server.save("v1", { billId: "wo-4", draftId: null, revision: 0, lines: [beerLine] });
    await flush(el);
    await signIn(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);

    emit(el.shadowRoot!.querySelector("till-shell")!, "logout");
    await flush(el);
    answerOffers();
    await flush(el);
    await signIn(el, "p2", "Sam");
    emit(shell(el), "screen-select", { screen: "order" });
    await flush(el);

    expect(browser(el)?.store.lines ?? []).toEqual([]);
  });
});

describe("till-app: an order that moves to a party whose groups answer late", () => {
  it("decides a later addition from the new party's groups, not the old party's", async () => {
    const held: OrderGroup = {
      courseIds: [],
      id: "g-9",
      position: 1,
      displayNumber: 1,
      numberPartyId: "v1",
      state: "held",
      firedAt: null,
      remindAt: null,
      lineIds: ["l-9"],
      summary: "1 × Steak",
    };
    let answerGroups!: () => void;
    const { el } = await mountApp({
      moveGuests: vi.fn().mockRejectedValue({ code: "party.out_of_date", partyId: "v1" }),
      listGroups: vi.fn(async (partyId: string) => {
        if (partyId !== "v9") return { revision: 3, groups: [] };
        await new Promise<void>((resolve) => (answerGroups = resolve));
        return { revision: 1, groups: [held] };
      }),
    });
    await openMesa(el);
    server.save("v9", {
      billId: "wo-4",
      draftId: null,
      revision: 0,
      lines: [
        {
          slot: 0,
          joinGroupId: null,
          afterGroupId: null,
          menuItemId: "offer-flan",
          variantId: null,
          menuVersionId: "v1",
          options: [],
          extras: [],
          note: null,
          quantity: "1",
          courseId: null,
          noMerge: false,
        },
      ],
    });
    api.getTablesState.mockResolvedValue([
      table("t4", "4", party({ id: "v9", revision: 1, tableIds: ["t4", "t7"] })),
      mesa7,
    ]);

    emit(tableOrder(el)!, "move-guests", { toTableId: "t7", bills: "merge" });
    await flush(el, 6);
    answerGroups();
    await flush(el, 6);

    expect(rows(el)).toEqual(["Flan ×1"]);
    const actions = [...tableOrder(el)!.shadowRoot!.querySelectorAll("[data-draft-action]")].map(
      (action) => action.getAttribute("data-draft-action"),
    );
    expect(actions).toEqual(["fire-selected", "send-all"]);
    expect(
      tableOrder(el)!
        .shadowRoot!.querySelector("[data-draft-group]")!
        .getAttribute("data-draft-group"),
    ).toBe("fire");
    await act(el, "send-all");
    expect(api.submitDraft.mock.calls[0]![0]).toBe("v9");
    expect(server.sentGroups(api.submitDraft.mock.calls[0]![2])).toEqual([
      {
        release: "fire",
        lines: [{ menuItemId: "offer-flan", menuVersionId: "v1", quantity: "1" }],
      },
    ]);
  });
});

describe("till-app: a table open that the session outlives", () => {
  it("leaves the next person on no table when the open answers after a sign-out", async () => {
    let answerOffers!: () => void;
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(till(orderTabFormFactor)),
      listZoneOffers: vi.fn(async () => {
        await new Promise<void>((resolve) => (answerOffers = resolve));
        return catalogue("v1");
      }),
    });
    await flush(el);
    await signIn(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);

    emit(el.shadowRoot!.querySelector("till-shell")!, "logout");
    await flush(el);
    answerOffers();
    await flush(el);
    await signIn(el, "p2", "Sam");
    emit(shell(el), "screen-select", { screen: "order" });
    await flush(el);

    expect(tableOrder(el)!.orderId).toBeUndefined();
    expect(api.getTabLines).not.toHaveBeenCalledWith("wo-4");
  });
});

describe("till-app: seating a free table while something else happens", () => {
  const mesa9 = table("t9", "9", null);

  function seatingLater() {
    let answer!: () => void;
    const seatTable = vi.fn(async () => {
      await new Promise<void>((resolve) => (answer = resolve));
      return { partyId: "v-new", tabId: "wo-new", revision: 0, orderNumber: 12 };
    });
    return { seatTable, answer: () => answer() };
  }

  it("stays on the table opened after it when the seat answers late", async () => {
    const seat = seatingLater();
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(till(orderTabFormFactor)),
      getTablesState: vi.fn().mockResolvedValue([mesa4, mesa7, mesa9]),
      seatTable: seat.seatTable,
    });
    await flush(el);
    await signIn(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t9", seated: false, guestCount: 2 });
    await flush(el);
    expect(seat.seatTable).toHaveBeenCalledTimes(1);
    // The order tab replaces the floor at once, so the waiter goes back to it to open the next.
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
    await flush(el);
    expect(tableOrder(el)!.orderId).toBe("wo-7");

    seat.answer();
    await flush(el, 6);

    expect(tableOrder(el)!.orderId).toBe("wo-7");
    expect(api.listDrafts).toHaveBeenLastCalledWith("v7", expect.anything());
  });

  it("leaves the next person on no table when the seat answers after a sign-out", async () => {
    const seat = seatingLater();
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(till(orderTabFormFactor)),
      getTablesState: vi.fn().mockResolvedValue([mesa4, mesa7, mesa9]),
      seatTable: seat.seatTable,
    });
    await flush(el);
    await signIn(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t9", seated: false, guestCount: 2 });
    await flush(el);

    emit(el.shadowRoot!.querySelector("till-shell")!, "logout");
    await flush(el);
    seat.answer();
    await flush(el, 6);
    await signIn(el, "p2", "Sam");
    emit(shell(el), "screen-select", { screen: "order" });
    await flush(el);

    expect(tableOrder(el)!.orderId).toBeUndefined();
    expect(api.getTabLines).not.toHaveBeenCalledWith("wo-new");
  });
});

describe("till-app: Split quantity on a draft line", () => {
  it("saves the rows kept apart, and a later tap of the same dish as a line of its own", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    await tap(el, "Beer");
    await tap(el, "Beer");
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-split-draft-line="0"]')!.click();
    await flush(el);
    await tap(el, "Beer");

    await back(el);

    expect(
      server.drafts[0]!.lines.map((line) => [line.menuItemId, Number(line.quantity), line.noMerge]),
    ).toEqual([
      ["offer-beer", 1, true],
      ["offer-beer", 1, true],
      ["offer-beer", 1, true],
      ["offer-beer", 1, false],
    ]);
  });
});

// Vitest's own default frame, which every other case in this file runs in.
const DEFAULT_FRAME = [414, 896] as const;

describe("till-app: the draft beside browsing, or on its own Review view", () => {
  const phoneFormFactor: FormFactor = "phone-portrait";
  const visible = (el: TillApp, selector: string) =>
    tableOrder(el)!.shadowRoot!.querySelector(selector)?.checkVisibility() ?? false;

  it("on a 390 px phone, opens the whole draft on Review and comes Back to browsing with it kept", async () => {
    await page.viewport(390, 844);
    try {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue(till(phoneFormFactor)),
        getDeviceIdentity: vi.fn().mockResolvedValue({
          deviceId: "phone-1",
          name: "Phone",
          formFactor: "phone-portrait",
        }),
      });
      await openMesa(el);
      await tap(el, "Beer");
      await tap(el, "Beer");
      await tap(el, "Flan");
      expect(visible(el, "[data-draft-pane]")).toBe(false);
      const review = tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>("[data-review-open]")!;
      expect(review.textContent!.trim()).toBe("Review (3)");

      review.click();
      await flush(el);
      expect(visible(el, "[data-draft-pane]")).toBe(true);
      expect(visible(el, "[data-browsing]")).toBe(false);
      expect(visible(el, '[data-draft-action="send-all"]')).toBe(true);

      tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>("[data-review-back]")!.click();
      await flush(el);
      expect(visible(el, "[data-browsing]")).toBe(true);
      expect(rows(el)).toEqual(["Beer ×2", "Flan ×1"]);
    } finally {
      await page.viewport(...DEFAULT_FRAME);
    }
  });

  it("on a 390 px phone, comes Back from Review to where the menu was scrolled", async () => {
    await page.viewport(390, 844);
    try {
      const long = catalogue("v1");
      const tapas = Array.from({ length: 40 }, (_, n) => offer(`offer-tapa-${n}`, `Tapa ${n}`));
      long.offers = [...long.offers, ...tapas];
      long.menus[0]!.structure.members.push(
        ...tapas.map((each) => ({
          kind: "product" as const,
          menuItemId: each.id,
          productId: each.productId,
        })),
      );
      const { el } = await mountApp({
        listZoneOffers: vi.fn().mockResolvedValue(long),
        getTill: vi.fn().mockResolvedValue(till(phoneFormFactor)),
        getDeviceIdentity: vi.fn().mockResolvedValue({
          deviceId: "phone-1",
          name: "Phone",
          formFactor: "phone-portrait",
        }),
      });
      await openMesa(el);
      await tap(el, "Beer");
      const tile = () =>
        [...browser(el)!.shadowRoot!.querySelectorAll<HTMLElement>("wt-button")].find(
          (button) => button.querySelector(".name")?.textContent === "Tapa 30",
        )!;
      tile().scrollIntoView({ block: "center" });
      await flush(el);
      const where = tile().getBoundingClientRect().top;
      const menuTop = browser(el)!.getBoundingClientRect().top;
      expect(where - menuTop).toBeGreaterThan(844);

      tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>("[data-review-open]")!.click();
      await flush(el);
      tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>("[data-review-back]")!.click();
      await flush(el);

      expect(Math.round(tile().getBoundingClientRect().top)).toBe(Math.round(where));
    } finally {
      await page.viewport(...DEFAULT_FRAME);
    }
  });

  it("on a 1280 px till, shows browsing and the draft together, with no Review", async () => {
    await page.viewport(1280, 720);
    try {
      const { el } = await mountApp();
      await resized(await openMesa(el));
      await tap(el, "Beer");

      expect(visible(el, "[data-browsing]")).toBe(true);
      expect(visible(el, "[data-draft-pane]")).toBe(true);
      expect(tableOrder(el)!.shadowRoot!.querySelector("[data-review-open]")).toBeNull();
    } finally {
      await page.viewport(...DEFAULT_FRAME);
    }
  });
});

describe("till-app: the next person after an ordinary sign-out", () => {
  it("finds the table left open with its menu and their own draft on it", async () => {
    const { el } = await mountApp({ getTill: vi.fn().mockResolvedValue(till(orderTabFormFactor)) });
    server.personId = "p2";
    server.personName = "Sam";
    server.save("v1", {
      billId: "wo-4",
      draftId: null,
      revision: 0,
      lines: [
        {
          slot: 0,
          joinGroupId: null,
          afterGroupId: null,
          menuItemId: "offer-flan",
          variantId: null,
          menuVersionId: "v1",
          options: [],
          extras: [],
          note: null,
          quantity: "1",
          courseId: null,
          noMerge: false,
        },
      ],
    });
    await openMesa(el);
    await tap(el, "Beer");
    emit(el.shadowRoot!.querySelector("till-shell")!, "logout");
    await flush(el, 6);

    await signIn(el, "p2", "Sam");
    emit(shell(el), "screen-select", { screen: "order" });
    await flush(el);

    expect(tableOrder(el)!.orderId).toBe("wo-4");
    expect(browser(el)).not.toBeNull();
    expect(rows(el)).toEqual(["Flan ×1"]);
  });
});

describe("till-app: the last-added bar across a save", () => {
  const bar = (el: TillApp) =>
    tableOrder(el)!
      .shadowRoot!.querySelector("till-last-added")
      ?.shadowRoot!.querySelector<HTMLElement>("[data-last-added]")
      ?.textContent?.replace(/\s+/g, " ")
      .trim();

  it("still shows the line after the save answers, and +1 on it is saved", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    await tap(el, "Beer");
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    await flush(el);
    expect(api.saveDraft).toHaveBeenCalledOnce();
    expect(bar(el)).toContain("Beer ×2");

    tableOrder(el)!
      .shadowRoot!.querySelector("till-last-added")!
      .shadowRoot!.querySelector<HTMLElement>('[data-last-added-step="1"]')!
      .click();
    await back(el);

    expect(savedLines()).toEqual(["offer-beer ×3"]);
  });

  it("follows its line when the save's answer replaces the lines", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    draft(el).setLineExtras(0, { note: "no ice" });
    await tap(el, "Beer");
    draft(el).setLineExtras(1, { note: "no ice" });
    await flush(el);
    expect(rows(el)).toEqual(["Beer ×1", "Beer ×1"]);
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    await flush(el);
    expect(rows(el)).toEqual(["Beer ×2"]);
    expect(bar(el)).toContain("Beer ×2");

    tableOrder(el)!
      .shadowRoot!.querySelector("till-last-added")!
      .shadowRoot!.querySelector<HTMLElement>('[data-last-added-step="1"]')!
      .click();
    await back(el);

    expect(savedLines()).toEqual(["offer-beer ×3"]);
  });
});

describe("till-app: two table opens overlapping", () => {
  const mesa9 = table("t9", "9", null);
  const state = (el: TillApp) => {
    const own = el as unknown as { activeTableId?: string; activeTabId?: string };
    return {
      orderId: tableOrder(el)!.orderId,
      tableId: own.activeTableId,
      tabId: own.activeTabId,
      party: tableOrder(el)!.party?.id,
    };
  };

  it("ends on the newest table alone when a seat answers while the newer open reads its lines", async () => {
    let answerSeat!: () => void;
    let answerLines!: () => void;
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(till(orderTabFormFactor)),
      getTablesState: vi.fn().mockResolvedValue([mesa4, mesa7, mesa9]),
      seatTable: vi.fn(async () => {
        await new Promise<void>((resolve) => (answerSeat = resolve));
        return { partyId: "v-new", tabId: "wo-new", revision: 0, orderNumber: 12 };
      }),
      getTabLines: vi.fn(async (tabId: string) => {
        if (tabId === "wo-7") await new Promise<void>((resolve) => (answerLines = resolve));
        return { lines: [], revision: 0, editSentLines: true };
      }),
    });
    await flush(el);
    await signIn(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t9", seated: false, guestCount: 2 });
    await flush(el);
    expect(api.seatTable).toHaveBeenCalledTimes(1);
    // The order tab replaces the floor at once, so the waiter goes back to it to open the next.
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
    await flush(el);

    answerSeat();
    await flush(el, 6);
    answerLines();
    await flush(el, 6);

    expect(state(el)).toEqual({ orderId: "wo-7", tableId: "t7", tabId: "wo-7", party: "v7" });
    expect(api.listDrafts).toHaveBeenLastCalledWith("v7", expect.anything());
  });
});

describe("till-app: a table open whose last wait outlives the session", () => {
  const mesa9 = table("t9", "9", null);

  it("leaves the next person on their floor when the table's lines answer after a sign-out", async () => {
    let answerLines!: () => void;
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(till(orderTabFormFactor)),
      getTabLines: vi.fn(async () => {
        await new Promise<void>((resolve) => (answerLines = resolve));
        return { lines: [], revision: 0, editSentLines: true };
      }),
    });
    await flush(el);
    await signIn(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);

    emit(el.shadowRoot!.querySelector("till-shell")!, "logout");
    await flush(el);
    await signIn(el, "p2", "Sam");
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    answerLines();
    await flush(el, 6);

    expect(floor(el)).not.toBeNull();
    expect(tableOrder(el)).toBeNull();
  });

  it("leaves the next person on their floor when a seated table's read answers after a sign-out", async () => {
    let answerLines!: () => void;
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(till(orderTabFormFactor)),
      getTablesState: vi.fn().mockResolvedValue([mesa4, mesa7, mesa9]),
      seatTable: vi
        .fn()
        .mockResolvedValue({ partyId: "v-new", tabId: "wo-new", revision: 0, orderNumber: 12 }),
      getTabLines: vi.fn(async (tabId: string) => {
        if (tabId === "wo-new") await new Promise<void>((resolve) => (answerLines = resolve));
        return { lines: [], revision: 0, editSentLines: true };
      }),
    });
    await flush(el);
    await signIn(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t9", seated: false, guestCount: 2 });
    await flush(el);

    emit(el.shadowRoot!.querySelector("till-shell")!, "logout");
    await flush(el);
    await signIn(el, "p2", "Sam");
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    answerLines();
    await flush(el, 6);

    expect(floor(el)).not.toBeNull();
    expect(tableOrder(el)).toBeNull();
  });
});

describe("till-app: another device's save arriving while the draft is shown", () => {
  // Pre-save reads keep their opening snapshot so the conflict is answered by Save.
  async function mountBeforeSave() {
    const read = server.listDrafts.getMockImplementation()!;
    const save = server.saveDraft.getMockImplementation()!;
    const opening = await read("v1");
    let saving = false;
    return mountApp({
      listDrafts: vi.fn((...args: Parameters<typeof read>) =>
        saving ? read(...args) : Promise.resolve(structuredClone(opening)),
      ),
      saveDraft: vi.fn((...args: Parameters<typeof save>) => {
        saving = true;
        return save(...args);
      }),
    });
  }

  const steakLine = {
    slot: 1,
    joinGroupId: null,
    afterGroupId: null,
    menuItemId: "offer-steak",
    variantId: null,
    menuVersionId: "v1",
    options: [],
    extras: [],
    note: null,
    quantity: "2",
    courseId: null,
    noMerge: false,
  };
  const visible = (el: TillApp, selector: string) =>
    tableOrder(el)!.shadowRoot!.querySelector(selector)?.checkVisibility() ?? false;
  const bar = (el: TillApp) =>
    tableOrder(el)!
      .shadowRoot!.querySelector("till-last-added")
      ?.shadowRoot!.querySelector<HTMLElement>("[data-last-added]")
      ?.textContent?.replace(/\s+/g, " ")
      .trim();
  const displayedLines = (el: TillApp) =>
    [
      ...tableOrder(el)!.shadowRoot!.querySelectorAll(
        "[data-draft-select], span.draft-line-name[slot]",
      ),
    ].map((line) => line.textContent!.replace(/[☑☐]/g, "").replace(/\s+/g, " ").trim());
  const saveWait = () => new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));

  it("on Review, shows the server's draft there, says so, and sends nothing again", async () => {
    const { el } = await mountBeforeSave();
    await openMesa(el);
    server.save("v1", { billId: "wo-4", draftId: null, revision: 0, lines: [steakLine] });
    await tap(el, "Beer");
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>("[data-review-open]")!.click();
    await flush(el);

    await saveWait();
    await flush(el, 6);

    expect(banner(el)!.textContent).toContain(t("table.draft_changed_elsewhere"));
    expect(visible(el, "[data-draft-pane]")).toBe(true);
    expect(displayedLines(el)).toEqual(["Steak ×2"]);
    expect(tableOrder(el)!.shadowRoot!.querySelectorAll("[data-draft-select]")).toHaveLength(0);
    expect(bar(el)).toBeUndefined();
    expect(api.saveDraft).toHaveBeenCalledOnce();
    expect(api.submitDraft).not.toHaveBeenCalled();
  });

  it("keeps the bar on the dish tapped when the server's draft still orders it", async () => {
    const { el } = await mountBeforeSave();
    await openMesa(el);
    server.save("v1", { billId: "wo-4", draftId: null, revision: 0, lines: [steakLine] });
    await tap(el, "Steak");
    expect(bar(el)).toContain("Steak ×1");

    await saveWait();
    await flush(el, 6);

    expect(banner(el)!.textContent).toContain(t("table.draft_changed_elsewhere"));
    expect(rows(el)).toEqual(["Steak ×2"]);
    expect(bar(el)).toContain("Steak ×2");
    expect(api.saveDraft).toHaveBeenCalledOnce();
  });
});

describe("till-app: other people's drafts and taking one over", () => {
  const ALEX = "p-alex";
  const SAM = "p-sam";

  const line = (menuItemId: string, quantity = "1") => ({
    slot: 0,
    joinGroupId: null,
    afterGroupId: null,
    menuItemId,
    variantId: null,
    menuVersionId: "v1",
    options: [],
    extras: [],
    note: null,
    quantity,
    courseId: null,
    noMerge: false,
  });

  /** Saves a draft on Mesa 4's party straight into the server, as `personId` on another till. */
  function savedBy(personId: string, personName: string, ...menuItemIds: string[]) {
    const [signedIn, name] = [server.personId, server.personName];
    server.personId = personId;
    server.personName = personName;
    const saved = structuredClone(
      server.save("v1", {
        billId: "wo-4",
        draftId: null,
        revision: 0,
        lines: menuItemIds.map((id) => line(id)),
      }),
    );
    server.personId = signedIn;
    server.personName = name;
    return saved;
  }

  async function openAs(el: TillApp, personId: string, name: string): Promise<void> {
    await flush(el);
    await signIn(el, personId, name);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
  }

  const screen = (el: TillApp) => tableOrder(el)!.shadowRoot!;
  const panels = (el: TillApp) => [
    ...screen(el).querySelectorAll<HTMLElement>("[data-other-draft]"),
  ];
  /** At the default frame the draft pane is the Review view, so it is opened to read a panel. */
  async function reviewed(el: TillApp): Promise<void> {
    if (screen(el).querySelector("[data-draft-pane]")!.checkVisibility()) return;
    screen(el).querySelector<HTMLElement>("[data-review-open]")!.click();
    await flush(el);
  }

  /** Back from Review to browsing, where the dishes are tapped. */
  async function browsing(el: TillApp): Promise<void> {
    if (screen(el).querySelector("[data-browsing]")!.checkVisibility()) return;
    screen(el).querySelector<HTMLElement>("[data-review-back]")!.click();
    await flush(el);
  }

  const panelOf = (el: TillApp) => {
    const [panel] = panels(el);
    if (!panel!.checkVisibility()) throw new Error("the panel read must be on screen");
    return {
      heading: panel!.querySelector(".other-draft-title")!.textContent!.trim(),
      lines: [...panel!.querySelectorAll("[data-other-draft-line]")].map((one) =>
        one.textContent!.replace(/\s+/g, " ").trim(),
      ),
      sends: panel!.querySelector("[data-draft-action]") !== null,
      takeOver: panel!.querySelector<HTMLElement>("[data-take-over]"),
    };
  };
  const dialogOpen = (el: TillApp) =>
    screen(el).querySelector<HTMLElement & { open: boolean }>("[data-take-over-dialog]")!.open;

  async function takeOver(el: TillApp): Promise<void> {
    await reviewed(el);
    panelOf(el).takeOver!.click();
    await flush(el);
    screen(el).querySelector<HTMLElement>("[data-take-over-confirm]")!.click();
    await flush(el, 6);
  }

  it("A773 Pay requires takeover before paying a colleague's bill", async () => {
    const { el } = await mountApp({
      recordSale: vi.fn().mockRejectedValue({
        code: "bill.unsent_dishes",
        billId: "wo-4",
        owners: [{ personId: ALEX, name: "Alex", quantity: "2.000" }],
      }),
    });
    savedBy(ALEX, "Alex", "offer-beer", "offer-flan");
    await openAs(el, SAM, "Sam");
    emit(tableOrder(el)!, "pay-tab", { method: "cash", tendered: "3.00" });
    await flush(el, 6);
    expect(banner(el)?.textContent ?? "").toContain(
      t("table.draft_taken_over_unsaved").replace("{name}", "Alex"),
    );
    expect(api.recordSale).not.toHaveBeenCalled();
    expect(tableOrder(el)!.orderId).toBe("wo-4");
    await takeOver(el);
    expect(rows(el)).toEqual(["Beer ×1", "Flan ×1"]);
    expect(panels(el)).toEqual([]);
    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(server.drafts.map((draft) => [draft.billId, draft.ownerId])).toEqual([["wo-4", SAM]]);
  });

  it("shows no read-only panel when only the person's own draft is on the party", async () => {
    const { el } = await mountApp();
    savedBy(SAM, "Sam", "offer-flan");
    await openAs(el, SAM, "Sam");

    expect(rows(el)).toEqual(["Flan ×1"]);
    expect(panels(el)).toEqual([]);
  });

  it("two operators: Sam sees Alex's draft read-only, takes it over after confirming, and Alex then sees it taken over by Sam", async () => {
    const { el } = await mountApp();
    const alexs = savedBy(ALEX, "Alex", "offer-beer");
    await openAs(el, SAM, "Sam");

    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(draft(el).editsLocked).toBe(true);
    await reviewed(el);
    expect(panelOf(el)).toMatchObject({
      heading: "Alex has an unsent order",
      lines: ["Beer ×1"],
      sends: false,
    });

    await reviewed(el);
    panelOf(el).takeOver!.click();
    await flush(el);
    expect(dialogOpen(el)).toBe(true);
    screen(el).querySelector<HTMLElement>("[data-take-over-cancel]")!.click();
    await flush(el);
    expect(dialogOpen(el)).toBe(false);
    expect(api.takeOverDraft).not.toHaveBeenCalled();

    await takeOver(el);

    expect(api.takeOverDraft).toHaveBeenCalledExactlyOnceWith(
      "v1",
      alexs.id,
      {
        revision: alexs.revision,
        expectedEdit: {
          billId: "wo-4",
          editorVersion: 1,
          draftId: alexs.id,
          draftRevision: alexs.revision,
        },
        submissionId: expect.any(String),
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(dialogOpen(el)).toBe(false);
    expect(panels(el)).toEqual([]);
    expect(rows(el)).toEqual(["Beer ×1"]);
    await browsing(el);
    await tap(el, "Flan");
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    expect(api.saveDraft).toHaveBeenLastCalledWith(
      "v1",
      expect.objectContaining({ draftId: alexs.id, revision: alexs.revision + 1 }),
      expect.anything(),
    );
    expect(server.drafts.map(({ ownerId, lines }) => ({ ownerId, lines: lines.length }))).toEqual([
      { ownerId: SAM, lines: 2 },
    ]);

    emit(el.shadowRoot!.querySelector("till-shell")!, "logout");
    await flush(el, 6);
    await openAs(el, ALEX, "Alex");

    expect(rows(el)).toEqual(["Beer ×1", "Flan ×1"]);
    expect(draft(el).editsLocked).toBe(true);
    await reviewed(el);
    expect(panelOf(el)).toMatchObject({
      heading: "Taken over by Sam",
      lines: ["Beer ×1", "Flan ×1"],
      sends: false,
    });
    await reviewed(el);
    expect(panelOf(el).takeOver).not.toBeNull();
  });

  it("takes over this bill in place without absorbing the taker's other bill", async () => {
    const { el } = await mountApp();
    const alexs = savedBy(ALEX, "Alex", "offer-beer", "offer-flan");
    const sams = savedBy(SAM, "Sam", "offer-flan", "offer-steak");
    sams.billId = "wo-check";
    server.drafts.find((draft) => draft.id === sams.id)!.billId = "wo-check";
    const before = structuredClone(sams);
    await openAs(el, SAM, "Sam");
    expect(rows(el)).toEqual(["Beer ×1", "Flan ×1"]);
    expect(draft(el).editsLocked).toBe(true);

    await takeOver(el);

    expect(api.takeOverDraft).toHaveBeenCalledExactlyOnceWith(
      "v1",
      alexs.id,
      {
        revision: alexs.revision,
        expectedEdit: {
          billId: "wo-4",
          editorVersion: 1,
          draftId: alexs.id,
          draftRevision: alexs.revision,
        },
        submissionId: expect.any(String),
      },
      expect.anything(),
    );
    expect(rows(el)).toEqual(["Beer ×1", "Flan ×1"]);
    expect(server.drafts.find((draft) => draft.id === sams.id)).toEqual(before);
    expect(panels(el)).toEqual([]);
    await browsing(el);
    await tap(el, "Steak");
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    expect(api.saveDraft).toHaveBeenLastCalledWith(
      "v1",
      expect.objectContaining({ draftId: alexs.id, revision: alexs.revision + 1 }),
      expect.anything(),
    );
    expect(server.drafts.find((draft) => draft.id === sams.id)).toEqual(before);
  });

  it("retains Alex's refused save separately and shows Sam's saved bill read-only", async () => {
    const { el } = await mountApp();
    await openAs(el, ALEX, "Alex");
    await tap(el, "Beer");
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    const alexs = structuredClone(server.drafts[0]!);
    server.personId = SAM;
    server.personName = "Sam";
    server.takeOver("v1", alexs.id, alexs.revision);
    server.personId = ALEX;
    server.personName = "Alex";

    await browsing(el);

    await tap(el, "Flan");
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    await flush(el);

    expect(api.saveDraft).toHaveBeenCalledTimes(2);
    expect(banner(el)!.textContent).toBe(
      "Sam has taken over this order. Your last change was not saved.",
    );
    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(draft(el).editsLocked).toBe(true);
    expect(retainedCandidate(el)?.lines.map((line) => line.product.name)).toEqual(["Beer", "Flan"]);
    await reviewed(el);
    expect(panelOf(el)).toMatchObject({ heading: "Taken over by Sam", lines: ["Beer ×1"] });
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    expect(api.saveDraft).toHaveBeenCalledTimes(2);

    await browsing(el);

    await tap(el, "Steak");
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    expect(api.saveDraft).toHaveBeenCalledTimes(2);
    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(retainedCandidate(el)?.lines.map((line) => line.product.name)).toEqual(["Beer", "Flan"]);
    expect(server.drafts).toHaveLength(1);
  });

  it("takes over only the saved bill without retrying Sam's retained failed save", async () => {
    const { el } = await mountApp({
      saveDraft: vi.fn(server.saveDraft).mockRejectedValueOnce(new TypeError("Failed to fetch")),
    });
    await openAs(el, SAM, "Sam");
    await tap(el, "Flan");
    emit(tableOrder(el)!, "take-payment", { workingOrderId: "wo-check" });
    await flush(el, 6);
    const alex = savedBy(ALEX, "Alex", "offer-beer");
    window.dispatchEvent(new Event("focus"));
    await flush(el, 6);

    await takeOver(el);

    expect(api.saveDraft).toHaveBeenCalledOnce();
    expect(api.takeOverDraft).toHaveBeenCalledOnce();
    expect(dialogOpen(el)).toBe(false);
    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(retainedCandidate(el)?.lines.map((line) => line.product.name)).toEqual(["Flan"]);
    expect(draft(el).editsLocked).toBe(true);
    expect(server.drafts.find((draft) => draft.id === alex.id)?.ownerId).toBe(SAM);
    expect(server.drafts).toHaveLength(1);
    expect(api.submitDraft).not.toHaveBeenCalled();
  });

  it("shows a known takeover refusal without saving or merging the retained candidate", async () => {
    const { el } = await mountApp({
      takeOverDraft: vi.fn().mockRejectedValue({ code: "party.not_open", status: 409 }),
    });
    await openAs(el, SAM, "Sam");
    await tap(el, "Flan");
    const alex = savedBy(ALEX, "Alex", "offer-beer");
    const before = structuredClone(alex);
    window.dispatchEvent(new Event("focus"));
    await flush(el, 6);

    await takeOver(el);

    expect(api.saveDraft).not.toHaveBeenCalled();
    expect(api.takeOverDraft).toHaveBeenCalledOnce();
    expect(banner(el)!.textContent).toContain(codeMessage("party.not_open"));
    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(retainedCandidate(el)?.lines.map((line) => line.product.name)).toEqual(["Flan"]);
    expect(draft(el).editsLocked).toBe(true);
    expect(server.drafts).toEqual([before]);
    expect(api.submitDraft).not.toHaveBeenCalled();
  });

  it("says a take-over that got no answer, having read the drafts again", async () => {
    const { el } = await mountApp({
      takeOverDraft: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    savedBy(ALEX, "Alex", "offer-beer");
    await openAs(el, SAM, "Sam");
    const reads = api.listDrafts.mock.calls.length;

    await takeOver(el);

    expect(api.listDrafts.mock.calls.length).toBe(reads + 1);
    expect(banner(el)!.textContent).toContain(t("table.error"));
    expect(dialogOpen(el)).toBe(false);
  });

  it.each([
    ["draft.not_found", t("table.take_over_gone")],
    ["draft.already_submitted", t("table.take_over_sent")],
    ["draft.taken_over", t("table.take_over_changed")],
    ["party.not_open", codeMessage("party.not_open")],
  ])("says a take-over refused %s in words for what changed", async (code, words) => {
    const { el } = await mountApp({
      takeOverDraft: vi.fn().mockRejectedValue({ code, status: 409 }),
    });
    savedBy(ALEX, "Alex", "offer-beer");
    await openAs(el, SAM, "Sam");

    await takeOver(el);

    expect(banner(el)!.textContent).toContain(words);
  });

  it("says nothing of a take-over that answers after Sam has signed out", async () => {
    let refuse!: (error: unknown) => void;
    const { el } = await mountApp({
      takeOverDraft: vi.fn(() => new Promise((_resolve, reject) => (refuse = reject))),
    });
    savedBy(ALEX, "Alex", "offer-beer");
    await openAs(el, SAM, "Sam");
    await takeOver(el);
    emit(el.shadowRoot!.querySelector("till-shell")!, "logout");
    await flush(el, 6);
    await signIn(el, ALEX, "Alex");

    refuse(new TypeError("Failed to fetch"));
    await flush(el, 6);

    expect(banner(el)).toBeNull();
  });

  it("sends no takeover as the next person when it was waiting on Sam's already-sent save at sign-out", async () => {
    const { el } = await mountApp();
    await openAs(el, SAM, "Sam");
    const answer = holdNextSave();
    await tap(el, "Flan");
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    expect(api.saveDraft).toHaveBeenCalledOnce();
    const alex = savedBy(ALEX, "Alex", "offer-beer");
    window.dispatchEvent(new Event("focus"));
    await flush(el, 6);
    await takeOver(el);
    expect(api.takeOverDraft).not.toHaveBeenCalled();

    emit(shell(el), "logout");
    await flush(el);
    await signIn(el, "p-kim", "Kim");
    answer();
    await flush(el, 8);

    expect(api.takeOverDraft).not.toHaveBeenCalled();
    expect(server.drafts.find((each) => each.id === alex.id)!.ownerId).toBe(ALEX);
    expect(banner(el)).toBeNull();
    expect(api.saveDraft).toHaveBeenCalledOnce();
    expect(api.logout).not.toHaveBeenCalled();
  });

  it("answers a take-over asked for with no table's draft open, sending nothing", async () => {
    const { el } = await mountApp();
    await flush(el);
    await signIn(el, SAM, "Sam");

    emit(shell(el), "take-over-draft", { draftId: "draft-1", revision: 0 });
    await flush(el);

    expect(api.takeOverDraft).not.toHaveBeenCalled();
    expect(banner(el)!.textContent).toContain(t("table.error"));
  });

  it.each([
    ["no name", { ownerName: "" }],
    ["nothing about who", {}],
  ])(
    "says someone else took it over, and the change was not saved, when the refusal carries %s",
    async (_case, carries) => {
      const { el } = await mountApp({
        saveDraft: vi.fn(server.saveDraft).mockRejectedValueOnce({
          code: "draft.taken_over",
          status: 409,
          ...carries,
        }),
      });
      await openAs(el, ALEX, "Alex");
      await tap(el, "Beer");
      await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
      await flush(el);

      expect(banner(el)!.textContent).toBe(
        "Someone else has taken over this order. Your last change was not saved.",
      );
    },
  );

  it("says the change was not saved when Alex's Send finds the draft taken over by Sam", async () => {
    const { el } = await mountApp();
    await openAs(el, ALEX, "Alex");
    await tap(el, "Beer");
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    const alexs = structuredClone(server.drafts[0]!);
    server.personId = SAM;
    server.personName = "Sam";
    server.takeOver("v1", alexs.id, alexs.revision);
    server.personId = ALEX;
    server.personName = "Alex";
    await browsing(el);
    press(el, "Flan");

    await act(el, "fire-all");

    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(banner(el)!.textContent).toBe(
      "Sam has taken over this order. Your last change was not saved.",
    );
    await reviewed(el);
    expect(panelOf(el).heading).toBe("Taken over by Sam");
  });

  it("shows other people's drafts on a tablet's Order tab, and takes one over there", async () => {
    const { el } = await mountApp({ getTill: vi.fn().mockResolvedValue(till(orderTabFormFactor)) });
    savedBy(ALEX, "Alex", "offer-beer");
    await openAs(el, SAM, "Sam");
    emit(shell(el), "screen-select", { screen: "order" });
    await flush(el);

    await reviewed(el);

    expect(panelOf(el).heading).toBe("Alex has an unsent order");
    await takeOver(el);

    expect(dialogOpen(el)).toBe(false);
    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(panels(el)).toEqual([]);
  });

  it("names the other drafts' dishes again when the table's menu is published anew", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const state = (versionId: string) => ({
        service: {
          open: true,
          zoneOpen: true,
          periodName: null,
          periodOccurrenceKey: null,
          keepOpen: null,
          zoneKeepOpen: null,
        },
        menus: [{ menuId: "lunch", versionId, orderable: true, sendable: true }],
        unavailable: { products: [], optionLabels: [] },
      });
      const { el } = await mountApp({ menuState: vi.fn().mockResolvedValue(state("v1")) });
      savedBy(ALEX, "Alex", "offer-beer");
      await openAs(el, SAM, "Sam");
      await reviewed(el);
      expect(panelOf(el).lines).toEqual(["Beer ×1"]);
      const v2 = catalogue("v2");
      api.listZoneOffers.mockResolvedValue({
        ...v2,
        offers: v2.offers.map((each) =>
          each.id === "offer-beer" ? { ...each, name: "Caña" } : each,
        ),
      });
      api.menuState.mockResolvedValue(state("v2"));

      vi.advanceTimersByTime(15_000);
      await flush(el, 6);

      await reviewed(el);

      expect(panelOf(el).lines).toEqual(["Caña ×1"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads the drafts again and says so, sending nothing more, when Alex changed the draft before Sam's take-over", async () => {
    const { el } = await mountApp();
    const alexs = savedBy(ALEX, "Alex", "offer-beer");
    await openAs(el, SAM, "Sam");
    server.personId = ALEX;
    server.save("v1", {
      billId: "wo-4",
      draftId: alexs.id,
      revision: alexs.revision,
      lines: [line("offer-beer", "2")],
    });
    server.personId = SAM;
    const reads = api.listDrafts.mock.calls.length;

    await takeOver(el);

    expect(api.takeOverDraft).toHaveBeenCalledOnce();
    expect(api.listDrafts.mock.calls.length).toBe(reads + 1);
    expect(banner(el)!.textContent).toContain(t("table.take_over_changed"));
    expect(dialogOpen(el)).toBe(false);
    await reviewed(el);
    expect(panelOf(el)).toMatchObject({ heading: "Alex has an unsent order", lines: ["Beer ×2"] });
    expect(rows(el)).toEqual(["Beer ×2"]);
    expect(draft(el).editsLocked).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    expect(api.takeOverDraft).toHaveBeenCalledOnce();
    expect(api.saveDraft).not.toHaveBeenCalled();
  });
});

describe("till-app: a menu published while a table's draft is open (D9)", () => {
  const state = (versionId: string, soldOut: string[] = []) => ({
    service: {
      open: true,
      zoneOpen: true,
      periodName: null,
      periodOccurrenceKey: null,
      keepOpen: null,
      zoneKeepOpen: null,
    },
    menus: [{ menuId: "lunch", versionId, orderable: true, sendable: true }],
    unavailable: { products: soldOut, optionLabels: [] },
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function poll(el: TillApp): Promise<void> {
    vi.advanceTimersByTime(15_000);
    await flush(el, 6);
  }

  /** Lets a debounced save go out and answer. */
  async function saved(el: TillApp): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    await flush(el);
  }

  const refresh = (el: TillApp) => el.shadowRoot!.querySelector("till-basket-refresh-dialog");
  const refreshText = (el: TillApp) => refresh(el)!.shadowRoot!.textContent!.replace(/\s+/g, " ");
  const versions = () =>
    server.drafts.flatMap((each) =>
      each.lines.map((line) => `${line.menuItemId} ${line.menuVersionId}`),
    );

  async function publish(el: TillApp, prices: Record<string, string> = {}): Promise<void> {
    api.listZoneOffers.mockResolvedValue(catalogue("v2", prices));
    api.menuState.mockResolvedValue(state("v2"));
    await poll(el);
  }

  async function answerRefresh(el: TillApp, button: "confirm" | "cancel"): Promise<void> {
    refresh(el)!.shadowRoot!.querySelector<HTMLElement>(`[data-${button}]`)!.click();
    await flush(el);
  }

  it("shows a price the publish changed in the draft and waits; Confirm saves the lines under the new version", async () => {
    const { el } = await mountApp({ menuState: vi.fn().mockResolvedValue(state("v1")) });
    await openMesa(el);
    await tap(el, "Beer");
    await tap(el, "Flan");
    await saved(el);

    await publish(el, { Beer: "6.00" });

    expect(refreshText(el)).toContain("Beer €5.00 → €6.00");
    expect(refreshText(el)).not.toContain("Flan");
    expect(versions()).toEqual(["offer-beer v1", "offer-flan v1"]);
    await answerRefresh(el, "confirm");
    await saved(el);

    expect(refresh(el)).toBeNull();
    expect(versions()).toEqual(["offer-beer v2", "offer-flan v2"]);
    expect(api.submitDraft).not.toHaveBeenCalled();
  });

  it("takes the new version without asking, and saves it, when nothing in the draft changed", async () => {
    const { el } = await mountApp({ menuState: vi.fn().mockResolvedValue(state("v1")) });
    await openMesa(el);
    await tap(el, "Beer");
    await saved(el);

    await publish(el, { Steak: "12.00" });
    await saved(el);

    expect(refresh(el)).toBeNull();
    expect(versions()).toEqual(["offer-beer v2"]);
  });

  it("keeps the draft as it was on Cancel, and a later poll does not ask again", async () => {
    const { el } = await mountApp({ menuState: vi.fn().mockResolvedValue(state("v1")) });
    await openMesa(el);
    await tap(el, "Beer");
    await saved(el);
    await publish(el, { Beer: "6.00" });

    await answerRefresh(el, "cancel");
    await saved(el);
    await poll(el);

    expect(refresh(el)).toBeNull();
    expect(versions()).toEqual(["offer-beer v1"]);
    expect(rows(el)).toEqual(["Beer ×1"]);
  });

  it("asks nothing while a send is out, and asks at the next poll once it has answered", async () => {
    const { el } = await mountApp({ menuState: vi.fn().mockResolvedValue(state("v1")) });
    await openMesa(el);
    await tap(el, "Beer");
    await tap(el, "Flan");
    await saved(el);
    let answer!: () => void;
    const take = server.submitDraft.getMockImplementation()!;
    server.submitDraft.mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => (answer = resolve));
      return take(...args);
    });
    await toggle(el, "Flan");
    await act(el, "fire-selected");

    await publish(el, { Beer: "6.00" });
    expect(refresh(el)).toBeNull();
    answer();
    await flush(el, 6);
    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(refresh(el)).toBeNull();

    await poll(el);
    expect(refreshText(el)).toContain("Beer €5.00 → €6.00");
  });

  it("asks nothing while a save is out, and asks at the next poll once it has answered", async () => {
    const { el } = await mountApp({ menuState: vi.fn().mockResolvedValue(state("v1")) });
    await openMesa(el);
    await tap(el, "Beer");
    await saved(el);
    let answer!: () => void;
    const keep = server.saveDraft.getMockImplementation()!;
    server.saveDraft.mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => (answer = resolve));
      return keep(...args);
    });
    await tap(el, "Beer");
    await saved(el);

    await publish(el, { Beer: "6.00" });
    expect(refresh(el)).toBeNull();
    answer();
    await flush(el);
    await poll(el);

    expect(refreshText(el)).toContain("Beer €10.00 → €12.00");
  });

  it("asks nothing while Move to is open, and asks at the next poll once it is closed", async () => {
    const { el } = await mountApp({ menuState: vi.fn().mockResolvedValue(state("v1")) });
    await openMesa(el);
    await userEvent.click(
      [...browser(el)!.shadowRoot!.querySelectorAll<HTMLElement>("wt-button")].find(
        (button) => button.querySelector(".name")?.textContent === "Beer",
      )!,
    );
    await flush(el);
    await saved(el);
    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(refresh(el)).toBeNull();
    const screen = tableOrder(el)!.shadowRoot!;
    await toggle(el, "Beer");
    screen.querySelector<HTMLElement>("[data-review-open]")!.click();
    await flush(el);
    await userEvent.click(screen.querySelector<HTMLElement>("[data-draft-move]")!);
    await flush(el);
    expect(
      screen.querySelector<HTMLElement & { open: boolean }>("[data-draft-move-dialog]")!.open,
    ).toBe(true);

    await publish(el, { Beer: "6.00" });
    expect(refresh(el)).toBeNull();
    const dialog = screen.querySelector<HTMLElement>("[data-draft-move-dialog]")!;
    const closed = new Promise((resolve) =>
      dialog.addEventListener("wt-close", resolve, { once: true }),
    );
    await userEvent.click(dialog.querySelector<HTMLElement>('[slot="footer"]')!);
    await closed;
    await flush(el);
    await poll(el);

    expect(refreshText(el)).toContain("Beer €5.00 → €6.00");
  });

  it("offers no repricing of another editor's saved bill before or after cancelling takeover", async () => {
    server.personId = "p-alex";
    server.personName = "Alex";
    server.save("v1", {
      billId: "wo-4",
      draftId: null,
      revision: 0,
      lines: [
        {
          slot: 0,
          joinGroupId: null,
          afterGroupId: null,
          menuItemId: "offer-flan",
          variantId: null,
          menuVersionId: "v1",
          options: [],
          extras: [],
          note: null,
          quantity: "1",
          courseId: null,
          noMerge: false,
        },
      ],
    });
    const { el } = await mountApp({ menuState: vi.fn().mockResolvedValue(state("v1")) });
    await openMesa(el);
    await tap(el, "Beer");
    await saved(el);
    const screen = tableOrder(el)!.shadowRoot!;
    screen.querySelector<HTMLElement>("[data-review-open]")!.click();
    await flush(el);
    screen.querySelector<HTMLElement>("[data-take-over]")!.click();
    await flush(el);

    await publish(el, { Beer: "6.00" });
    expect(refresh(el)).toBeNull();
    screen.querySelector<HTMLElement>("[data-take-over-cancel]")!.click();
    await flush(el);
    await poll(el);

    expect(refresh(el)).toBeNull();
    expect(rows(el)).toEqual(["Flan ×1"]);
    expect(draft(el).editsLocked).toBe(true);
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it("asks nothing while a dish's choices are open in the table's menu, and asks at the next poll once they are closed", async () => {
    const withChoices = (each: ZoneOfferCatalogue): ZoneOfferCatalogue => ({
      ...each,
      offers: each.offers.map((dish) =>
        dish.name !== "Steak"
          ? dish
          : {
              ...dish,
              offeredModifiers: [
                {
                  kind: "options" as const,
                  id: "list-cooked",
                  name: "Cooked",
                  customerName: null,
                  kitchenName: null,
                  defaultLabelId: null,
                  publishedDefaultLabelId: null,
                  labels: [
                    {
                      id: "rare",
                      name: "Rare",
                      customerName: null,
                      kitchenName: null,
                      available: true,
                    },
                  ],
                },
              ],
            },
      ),
    });
    const { el } = await mountApp({
      menuState: vi.fn().mockResolvedValue(state("v1")),
      listZoneOffers: vi.fn().mockResolvedValue(withChoices(catalogue("v1"))),
    });
    await openMesa(el);
    await tap(el, "Beer");
    await saved(el);
    await tap(el, "Steak");
    const picker = () => browser(el)!.shadowRoot!.querySelector("till-modifier-picker");
    expect(picker()).not.toBeNull();

    await publish(el, { Beer: "6.00" });
    expect(refresh(el)).toBeNull();
    picker()!.shadowRoot!.querySelector<HTMLElement>(".cancel")!.click();
    await flush(el);
    await poll(el);

    expect(refreshText(el)).toContain("Beer €5.00 → €6.00");
  });

  it("asks nothing while another card on the order's tab has a dialog open, and asks at the next poll once it is closed", async () => {
    const withFloor: FormFactor = "till";
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(till(withFloor)),
      getTablesState: vi.fn().mockResolvedValue([mesa4, mesa7, table("t9", "9", null)]),
      menuState: vi.fn().mockResolvedValue(state("v1")),
    });
    await openMesa(el);
    await tap(el, "Beer");
    await saved(el);
    floor(el)!.shadowRoot!.querySelector<HTMLElement>('[data-table="t9"]')!.click();
    await flush(el);
    const seat = floor(el)!.shadowRoot!.querySelector("till-seat-dialog");
    expect(seat).not.toBeNull();

    await publish(el, { Beer: "6.00" });
    expect(refresh(el)).toBeNull();
    seat!.shadowRoot!.querySelector<HTMLElement>("[data-seat-cancel]")!.click();
    await flush(el);
    await poll(el);

    expect(refreshText(el)).toContain("Beer €5.00 → €6.00");
  });

  it("asks nothing while a take-over is out, and asks at the next poll once it has answered", async () => {
    server.personId = "p-alex";
    server.personName = "Alex";
    server.save("v1", {
      billId: "wo-4",
      draftId: null,
      revision: 0,
      lines: [
        {
          slot: 0,
          joinGroupId: null,
          afterGroupId: null,
          menuItemId: "offer-flan",
          variantId: null,
          menuVersionId: "v1",
          options: [],
          extras: [],
          note: null,
          quantity: "1",
          courseId: null,
          noMerge: false,
        },
      ],
    });
    const { el } = await mountApp({ menuState: vi.fn().mockResolvedValue(state("v1")) });
    await openMesa(el);
    await tap(el, "Beer");
    await saved(el);
    let answer!: () => void;
    const take = server.takeOverDraft.getMockImplementation()!;
    server.takeOverDraft.mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => (answer = resolve));
      return take(...args);
    });
    const screen = tableOrder(el)!.shadowRoot!;
    screen.querySelector<HTMLElement>("[data-review-open]")!.click();
    await flush(el);
    screen.querySelector<HTMLElement>("[data-take-over]")!.click();
    await flush(el);
    screen.querySelector<HTMLElement>("[data-take-over-confirm]")!.click();
    await flush(el, 6);

    await publish(el, { Beer: "6.00" });
    expect(refresh(el)).toBeNull();
    answer();
    await flush(el, 6);
    expect(rows(el)).toEqual(["Flan ×1"]);
    expect(api.saveDraft).not.toHaveBeenCalled();
    expect(refresh(el)).toBeNull();

    await poll(el);
    expect(refreshText(el)).not.toContain("Beer");
    expect(refreshText(el)).toContain("Flan €5.00");
  });

  it("still asks at the next poll when the publish's own offers read was overtaken by another read", async () => {
    const { el } = await mountApp({ menuState: vi.fn().mockResolvedValue(state("v1")) });
    await openMesa(el);
    await tap(el, "Beer");
    await saved(el);
    let answerPollRead!: (offers: ZoneOfferCatalogue) => void;
    api.listZoneOffers.mockImplementationOnce(
      () => new Promise<ZoneOfferCatalogue>((resolve) => (answerPollRead = resolve)),
    );
    api.menuState.mockResolvedValue(state("v2"));
    await poll(el);
    api.listZoneOffers.mockResolvedValue(catalogue("v2", { Beer: "6.00" }));
    api.submitDraft.mockRejectedValueOnce({
      code: "product.unavailable",
      status: 409,
      productId: "product-offer-flan",
    });
    await act(el, "fire-all");
    answerPollRead(catalogue("v2", { Beer: "6.00" }));
    await flush(el);

    await poll(el);

    expect(refreshText(el)).toContain("Beer €5.00 → €6.00");
  });

  /** Beer saved on Mesa 4 under v0, a version this till never read. */
  function savedUnderV0(): void {
    server.save("v1", {
      billId: "wo-4",
      draftId: null,
      revision: 0,
      lines: [
        {
          slot: 0,
          joinGroupId: null,
          afterGroupId: null,
          menuItemId: "offer-beer",
          variantId: null,
          menuVersionId: "v0",
          options: [],
          extras: [],
          note: null,
          quantity: "1",
          courseId: null,
          noMerge: false,
        },
      ],
    });
  }

  it("asks nothing about a line saved under another version while the offers cannot be read again, and asks at the next poll", async () => {
    savedUnderV0();
    const { el } = await mountApp({
      menuState: vi.fn().mockResolvedValue(state("v1")),
      listZoneOffers: vi
        .fn()
        .mockResolvedValueOnce(catalogue("v1"))
        .mockRejectedValueOnce({ code: "server.internal", status: 500 })
        .mockResolvedValue(catalogue("v1")),
    });

    await openMesa(el);
    expect(api.listZoneOffers).toHaveBeenCalledTimes(2);
    expect(refresh(el)).toBeNull();

    await poll(el);
    expect(api.listZoneOffers).toHaveBeenCalledTimes(3);
    expect(refreshText(el)).toContain("Beer €5.00");
  });

  it("reads the offers once when a poll comes while the read for a line saved under another version is out", async () => {
    savedUnderV0();
    let answer!: (offers: ZoneOfferCatalogue) => void;
    const { el } = await mountApp({
      menuState: vi.fn().mockResolvedValue(state("v1")),
      listZoneOffers: vi
        .fn()
        .mockResolvedValueOnce(catalogue("v1"))
        .mockImplementationOnce(() => new Promise((resolve) => (answer = resolve))),
    });
    await openMesa(el);

    await poll(el);
    expect(api.listZoneOffers).toHaveBeenCalledTimes(2);
    answer(catalogue("v1"));
    await flush(el);

    expect(refreshText(el)).toContain("Beer €5.00");
  });

  it("does not ask again at the next poll about a price Send found changed and the person put aside", async () => {
    const { el } = await mountApp({ menuState: vi.fn().mockResolvedValue(state("v1")) });
    await openMesa(el);
    await tap(el, "Beer");
    await saved(el);
    api.listZoneOffers.mockResolvedValue(catalogue("v2", { Beer: "6.00" }));
    api.submitDraft.mockRejectedValueOnce({
      code: "menu.version_changed",
      status: 409,
      menus: [{ menuId: "lunch", liveVersionId: "v2" }],
    });
    await act(el, "fire-all");
    expect(refreshText(el)).toContain("Beer €5.00 → €6.00");
    await answerRefresh(el, "cancel");
    api.menuState.mockResolvedValue(state("v2"));

    await poll(el);

    expect(refresh(el)).toBeNull();
    expect(versions()).toEqual(["offer-beer v1"]);
  });

  it("adopts nothing onto another line when the server's draft replaced the lines while it asked", async () => {
    const { el } = await mountApp({ menuState: vi.fn().mockResolvedValue(state("v1")) });
    await openMesa(el);
    await tap(el, "Beer");
    await tap(el, "Flan");
    await saved(el);
    await publish(el, { Beer: "6.00" });
    expect(refreshText(el)).toContain("Beer €5.00 → €6.00");
    server.saveDraft.mockImplementationOnce(async (partyId, save) => {
      const answer = server.flagged(structuredClone(server.save(partyId, save)));
      answer.lines.reverse();
      return server.snapshot(answer);
    });
    draft(el).setLineQuantity(1, "2");
    await saved(el);
    expect(rows(el)).toEqual(["Flan ×2", "Beer ×1"]);

    await answerRefresh(el, "confirm");

    expect(rows(el)).toEqual(["Flan ×2", "Beer ×1"]);
    expect(draft(el).lines.map((line) => line.product.menuVersionId)).toEqual(["v1", "v1"]);
  });

  it("asks nothing, and keeps the draft as it was, when the new offers cannot be read", async () => {
    const { el } = await mountApp({ menuState: vi.fn().mockResolvedValue(state("v1")) });
    await openMesa(el);
    await tap(el, "Beer");
    await saved(el);
    api.listZoneOffers.mockRejectedValue({ code: "server.internal", status: 500 });
    api.menuState.mockResolvedValue(state("v2"));

    await poll(el);
    await saved(el);

    expect(refresh(el)).toBeNull();
    expect(versions()).toEqual(["offer-beer v1"]);
  });

  it("does not ask again about a line put aside when a publish's offers cannot be read", async () => {
    server.save("v1", {
      billId: "wo-4",
      draftId: null,
      revision: 0,
      lines: [
        {
          slot: 0,
          joinGroupId: null,
          afterGroupId: null,
          menuItemId: "offer-beer",
          variantId: null,
          menuVersionId: "v0",
          options: [],
          extras: [],
          note: null,
          quantity: "1",
          courseId: null,
          noMerge: false,
        },
      ],
    });
    const { el } = await mountApp({ menuState: vi.fn().mockResolvedValue(state("v1")) });
    await openMesa(el);
    await answerRefresh(el, "cancel");
    api.listZoneOffers.mockRejectedValue({ code: "server.internal", status: 500 });
    api.menuState.mockResolvedValue(state("v2"));

    await poll(el);

    expect(refresh(el)).toBeNull();
    expect(versions()).toEqual(["offer-beer v0"]);
  });

  it("heads a line the publish took off the menu as staying unsent", async () => {
    const { el } = await mountApp({ menuState: vi.fn().mockResolvedValue(state("v1")) });
    await openMesa(el);
    await tap(el, "Flan");
    await saved(el);
    const v2 = catalogue("v2");
    api.listZoneOffers.mockResolvedValue({
      ...v2,
      offers: v2.offers.filter((each) => each.id !== "offer-flan"),
    });
    api.menuState.mockResolvedValue(state("v2"));

    await poll(el);

    expect(refreshText(el)).toContain(t("basket_refresh.blocked_send"));
    expect(refreshText(el)).toContain("Flan is no longer on this menu");
  });

  it("flags a line the publish took off the menu once its offers are read, even with the question put aside", async () => {
    const { el } = await mountApp({ menuState: vi.fn().mockResolvedValue(state("v1")) });
    await openMesa(el);
    await tap(el, "Beer");
    await tap(el, "Flan");
    await saved(el);
    const v2 = catalogue("v2");
    api.listZoneOffers.mockResolvedValue({
      ...v2,
      offers: v2.offers.filter((each) => each.id !== "offer-flan"),
    });
    api.menuState.mockResolvedValue(state("v2"));
    await poll(el);

    await answerRefresh(el, "cancel");

    expect(draft(el).lines.map((line) => line.blocked)).toEqual([undefined, "removed"]);
  });

  it("never re-prices another person's draft", async () => {
    server.personId = "p-alex";
    server.personName = "Alex";
    server.save("v1", {
      billId: "wo-4",
      draftId: null,
      revision: 0,
      lines: [
        {
          slot: 0,
          joinGroupId: null,
          afterGroupId: null,
          menuItemId: "offer-beer",
          variantId: null,
          menuVersionId: "v1",
          options: [],
          extras: [],
          note: null,
          quantity: "1",
          courseId: null,
          noMerge: false,
        },
      ],
    });
    const { el } = await mountApp({ menuState: vi.fn().mockResolvedValue(state("v1")) });
    await openMesa(el);

    await publish(el, { Beer: "6.00" });
    await saved(el);

    expect(refresh(el)).toBeNull();
    expect(api.saveDraft).not.toHaveBeenCalled();
    expect(versions()).toEqual(["offer-beer v1"]);
  });
});

describe("till-app: a draft read from the server with a line on an earlier menu version", () => {
  async function saved(el: TillApp): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    await flush(el);
  }

  function savedAt(version: string, ...menuItemIds: string[]): void {
    server.save("v1", {
      billId: "wo-4",
      draftId: null,
      revision: 0,
      lines: menuItemIds.map((menuItemId) => ({
        slot: 0,
        joinGroupId: null,
        afterGroupId: null,
        menuItemId,
        variantId: null,
        menuVersionId: version,
        options: [],
        extras: [],
        note: null,
        quantity: "1",
        courseId: null,
        noMerge: false,
      })),
    });
  }

  const refresh = (el: TillApp) => el.shadowRoot!.querySelector("till-basket-refresh-dialog");
  const changedLines = (el: TillApp) =>
    [...refresh(el)!.shadowRoot!.querySelectorAll("[data-changed] li")].map((line) =>
      line.textContent!.replace(/\s+/g, " ").trim(),
    );

  it("asks to confirm the line at its new price alone, and saves it under the live version on Confirm", async () => {
    savedAt("v1", "offer-beer");
    const { el } = await mountApp({
      listZoneOffers: vi.fn().mockResolvedValue(catalogue("v2", { Beer: "6.00" })),
    });

    await openMesa(el);

    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(changedLines(el)).toEqual(["Beer €6.00"]);
    refresh(el)!.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!.click();
    await flush(el);
    await saved(el);
    expect(server.drafts[0]!.lines.map((line) => line.menuVersionId)).toEqual(["v2"]);
  });

  it("reads the offers again, and asks nothing, when a line names a version newer than the one this till read", async () => {
    savedAt("v2", "offer-beer");
    const { el } = await mountApp({
      listZoneOffers: vi
        .fn()
        .mockResolvedValueOnce(catalogue("v1"))
        .mockResolvedValue(catalogue("v2", { Beer: "6.00" })),
    });

    await openMesa(el);
    await saved(el);

    expect(refresh(el)).toBeNull();
    expect(server.drafts[0]!.lines.map((line) => line.menuVersionId)).toEqual(["v2"]);
    expect(
      draft(el).lines.map((line) => [
        line.product.menuVersionId,
        line.product.unitPrice,
        line.earlierPriceUnknown,
      ]),
    ).toEqual([["v2", "6.00", undefined]]);
  });

  it("asks nothing, and saves nothing, when every line is on the live version", async () => {
    savedAt("v1", "offer-beer");
    const { el } = await mountApp();

    await openMesa(el);
    await saved(el);

    expect(refresh(el)).toBeNull();
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it("asks again at Send, rather than sending, when the question was put aside", async () => {
    savedAt("v1", "offer-beer");
    const { el } = await mountApp({
      listZoneOffers: vi.fn().mockResolvedValue(catalogue("v2")),
      submitDraft: vi.fn(server.submitDraft).mockRejectedValueOnce({
        code: "menu.version_changed",
        status: 409,
        menus: [{ menuId: "lunch", liveVersionId: "v2" }],
      }),
    });
    await openMesa(el);
    refresh(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!.click();
    await flush(el);

    await act(el, "fire-all");

    expect(api.submitDraft).toHaveBeenCalledOnce();
    expect(changedLines(el)).toEqual(["Beer €5.00"]);
    expect(rows(el)).toEqual(["Beer ×1"]);
  });
});

describe("till-app: a draft line that cannot be sold now", () => {
  const state = (soldOut: string[]) => ({
    service: {
      open: true,
      zoneOpen: true,
      periodName: null,
      periodOccurrenceKey: null,
      keepOpen: null,
      zoneKeepOpen: null,
    },
    menus: [{ menuId: "lunch", versionId: "v1", orderable: true, sendable: true }],
    unavailable: { products: soldOut, optionLabels: [] },
  });

  async function saved(el: TillApp): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    await flush(el);
  }

  const screen = (el: TillApp) => tableOrder(el)!.shadowRoot!;
  const flagText = (el: TillApp) =>
    [...screen(el).querySelectorAll("till-basket")]
      .flatMap((basket) => [...basket.shadowRoot!.querySelectorAll(".line .not-offered")])
      .map((marker) => marker.textContent!.trim());
  const sentNames = (call = 0) =>
    server
      .sentGroups(api.submitDraft.mock.calls[call]![2])
      .flatMap((group) => group.lines.map((line) => line.menuItemId));

  it("shows the server refusal on the line and direct Send all leaves it out, sending the rest", async () => {
    server.unavailable.add("offer-flan");
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    await tap(el, "Flan");
    await saved(el);

    expect(flagText(el)).toEqual([t("basket.blocked.server")]);
    expect(screen(el).querySelector('[data-flag-remove="1"]')).not.toBeNull();
    await act(el, "send-all");

    expect(sentNames()).toEqual(["offer-beer"]);
    expect(rows(el)).toEqual(["Flan ×1"]);
    expect(server.drafts[0]!.lines.map((line) => line.menuItemId)).toEqual(["offer-flan"]);
  });

  it("shows a line the till's own poll flags, and selected Fire leaves it out", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const { el } = await mountApp({
        menuState: vi.fn().mockResolvedValue(state(["product-offer-flan"])),
      });
      await openMesa(el);
      await tap(el, "Beer");
      await tap(el, "Flan");
      vi.advanceTimersByTime(15_000);
      await flush(el, 6);

      expect(flagText(el)).toEqual([t("basket.blocked.unavailable")]);
      expect(screen(el).querySelector('[data-flag-remove="1"]')).not.toBeNull();
      await act(el, "fire-all");

      expect(sentNames()).toEqual(["offer-beer"]);
      expect(rows(el)).toEqual(["Flan ×1"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("flags a line of a draft read from the server that the table's offers say is sold out", async () => {
    server.save("v1", {
      billId: "wo-4",
      draftId: null,
      revision: 0,
      lines: ["offer-beer", "offer-flan"].map((menuItemId) => ({
        slot: 0,
        joinGroupId: null,
        afterGroupId: null,
        menuItemId,
        variantId: null,
        menuVersionId: "v1",
        options: [],
        extras: [],
        note: null,
        quantity: "1",
        courseId: null,
        noMerge: false,
      })),
    });
    const offers = catalogue("v1");
    const { el } = await mountApp({
      listZoneOffers: vi.fn().mockResolvedValue({
        ...offers,
        offers: offers.offers.map((each) =>
          each.id === "offer-flan" ? { ...each, available: false } : each,
        ),
      }),
    });

    await openMesa(el);

    expect(rows(el)).toEqual(["Beer ×1", "Flan ×1"]);
    expect(flagText(el)).toEqual([t("basket.blocked.unavailable")]);
  });

  describe("a draft line with an extra, read from the server", () => {
    function savedBeerWithLemon(): void {
      server.save("v1", {
        billId: "wo-4",
        draftId: null,
        revision: 0,
        lines: [
          {
            slot: 0,
            joinGroupId: null,
            afterGroupId: null,
            menuItemId: "offer-beer",
            variantId: null,
            menuVersionId: "v1",
            options: [],
            extras: [{ listId: "beer-extras", picks: [{ productId: "p-lemon", quantity: 1 }] }],
            note: null,
            quantity: "1",
            courseId: null,
            noMerge: false,
          },
        ],
      });
    }

    /** Beer offers a lemon extra, and is sold in a measure when `measured`. */
    function beerWithLemon(measured: boolean): ZoneOfferCatalogue {
      const offers = catalogue("v1");
      return {
        ...offers,
        offers: offers.offers.map((each) =>
          each.id !== "offer-beer"
            ? each
            : {
                ...each,
                unit: measured ? { ...unit, measure: true as const } : unit,
                offeredModifiers: [
                  {
                    kind: "extras" as const,
                    id: "beer-extras",
                    name: "Extras",
                    customerName: null,
                    kitchenName: null,
                    minPicks: 0,
                    maxPicks: null,
                    items: [
                      {
                        portion: "1",
                        unit,
                        presentation: {
                          name: "Lemon",
                          customerName: null,
                          kitchenName: null,
                          variantName: null,
                          variantCustomerName: null,
                          variantKitchenName: null,
                        },
                        productId: "p-lemon",
                        name: "Lemon",
                        customerName: null,
                        kitchenName: null,
                        price: "0.50",
                        vatClass: "general" as const,
                        maxQuantity: 1,
                        preselected: false,
                        addAllergens: null,
                        suitableFor: [],
                        image: null,
                        available: true,
                      },
                    ],
                  },
                ],
              },
        ),
      };
    }

    it("is flagged, and not sent, once its dish is sold in a measure", async () => {
      savedBeerWithLemon();
      const { el } = await mountApp({
        listZoneOffers: vi.fn().mockResolvedValue(beerWithLemon(true)),
      });

      await openMesa(el);

      expect(rows(el)).toEqual(["Beer ×1"]);
      expect(flagText(el)).toEqual([t("basket.blocked.extra")]);
      await act(el, "send-all");
      expect(rows(el)).toEqual(["Beer ×1"]);
      expect(flagText(el)).toEqual([t("basket.blocked.extra")]);
      expect(api.submitDraft).not.toHaveBeenCalled();
    });

    it("is not flagged while its dish is not sold in a measure", async () => {
      savedBeerWithLemon();
      const { el } = await mountApp({
        listZoneOffers: vi.fn().mockResolvedValue(beerWithLemon(false)),
      });

      await openMesa(el);

      expect(rows(el)).toEqual(["Beer ×1"]);
      expect(flagText(el)).toEqual([]);
    });
  });

  describe("a line whose dish is now sold only as an extra", () => {
    const onlyFlanAsExtra = (): ZoneOfferCatalogue => {
      const offers = catalogue("v1");
      return {
        ...offers,
        offers: offers.offers.map((each) =>
          each.id === "offer-flan" ? { ...each, ordering: "not_sold_separately" as const } : each,
        ),
      };
    };

    function savedBeerAndFlan(): void {
      server.save("v1", {
        billId: "wo-4",
        draftId: null,
        revision: 0,
        lines: ["offer-beer", "offer-flan"].map((menuItemId) => ({
          slot: 0,
          joinGroupId: null,
          afterGroupId: null,
          menuItemId,
          variantId: null,
          menuVersionId: "v1",
          options: [],
          extras: [],
          note: null,
          quantity: "1",
          courseId: null,
          noMerge: false,
        })),
      });
    }

    it("is shown flagged in words for why, and Remove takes it out and saves that", async () => {
      savedBeerAndFlan();
      const { el } = await mountApp({
        listZoneOffers: vi.fn().mockResolvedValue(onlyFlanAsExtra()),
      });
      await openMesa(el);

      expect(rows(el)).toEqual(["Beer ×1", "Flan ×1"]);
      expect(flagText(el)).toEqual([t("basket.blocked.not_sold_separately")]);

      screen(el).querySelector<HTMLElement>('[data-flag-remove="1"]')!.click();
      await saved(el);

      expect(rows(el)).toEqual(["Beer ×1"]);
      expect(server.drafts[0]!.lines.map((line) => line.menuItemId)).toEqual(["offer-beer"]);
    });

    it("keeps its flag when a later poll finds nothing sold out", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      try {
        savedBeerAndFlan();
        server.unavailable.add("offer-flan");
        const { el } = await mountApp({
          listZoneOffers: vi.fn().mockResolvedValue(onlyFlanAsExtra()),
          menuState: vi.fn().mockResolvedValue(state([])),
        });
        await openMesa(el);
        vi.advanceTimersByTime(15_000);
        await flush(el, 6);

        expect(flagText(el)).toEqual([t("basket.blocked.not_sold_separately")]);
        await act(el, "send-all");
        expect(sentNames()).toEqual(["offer-beer"]);
        expect(rows(el)).toEqual(["Flan ×1"]);
        expect(flagText(el)).toEqual([t("basket.blocked.not_sold_separately")]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("says a save refused for it in the refusal's own words", async () => {
      const { el } = await mountApp({
        saveDraft: vi
          .fn()
          .mockRejectedValue({ code: "product.not_sold_separately", status: 409, productId: "x" }),
      });
      await openMesa(el);
      await tap(el, "Beer");
      await saved(el);

      expect(banner(el)!.textContent).toContain(codeMessage("product.not_sold_separately"));
    });

    it("reads the table's offers again after such a refused save, and flags the line", async () => {
      const { el } = await mountApp({
        saveDraft: vi
          .fn(server.saveDraft)
          .mockRejectedValueOnce({ code: "product.not_sold_separately", status: 409 }),
      });
      await openMesa(el);
      api.listZoneOffers.mockResolvedValue(onlyFlanAsExtra());
      await tap(el, "Flan");
      await saved(el);

      expect(flagText(el)).toEqual([t("basket.blocked.not_sold_separately")]);
    });
  });

  it("takes a flagged line out on Remove, and saves that", async () => {
    server.unavailable.add("offer-flan");
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    await tap(el, "Flan");
    await saved(el);

    screen(el).querySelector<HTMLElement>('[data-flag-remove="1"]')!.click();
    await saved(el);

    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(server.drafts[0]!.lines.map((line) => line.menuItemId)).toEqual(["offer-beer"]);
  });

  it("keeps a flagged line on Keep, still flagged and not sent, and sends it once it can be sold again", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const { el } = await mountApp({
        menuState: vi.fn().mockResolvedValue(state(["product-offer-flan"])),
      });
      await openMesa(el);
      await tap(el, "Beer");
      await tap(el, "Flan");
      vi.advanceTimersByTime(15_000);
      await flush(el, 6);
      screen(el).querySelector<HTMLElement>('[data-flag-keep="1"]')!.click();
      await flush(el);
      await act(el, "fire-all");
      expect(sentNames(0)).toEqual(["offer-beer"]);
      expect(flagText(el)).toEqual([t("basket.blocked.unavailable")]);

      api.menuState.mockResolvedValue(state([]));
      vi.advanceTimersByTime(15_000);
      await flush(el, 6);
      expect(flagText(el)).toEqual([]);
      await act(el, "fire-all");

      expect(sentNames(1)).toEqual(["offer-flan"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops a flag only the server gave once a later poll finds the dish can be sold", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      server.unavailable.add("offer-flan");
      const { el } = await mountApp({ menuState: vi.fn().mockResolvedValue(state([])) });
      await openMesa(el);
      await tap(el, "Flan");
      await saved(el);
      expect(flagText(el)).toEqual([t("basket.blocked.server")]);

      server.unavailable.clear();
      vi.advanceTimersByTime(15_000);
      await flush(el, 6);

      expect(flagText(el)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("flags the line again, and sends nothing, when a poll dropped the server's flag and the send is then refused as sold out", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      server.unavailable.add("offer-flan");
      const { el } = await mountApp({ menuState: vi.fn().mockResolvedValue(state([])) });
      await openMesa(el);
      await tap(el, "Beer");
      await tap(el, "Flan");
      await saved(el);
      vi.advanceTimersByTime(15_000);
      await flush(el, 6);
      expect(flagText(el)).toEqual([]);
      const offers = catalogue("v1");
      api.listZoneOffers.mockResolvedValue({
        ...offers,
        offers: offers.offers.map((each) =>
          each.id === "offer-flan" ? { ...each, available: false } : each,
        ),
      });
      api.submitDraft.mockRejectedValueOnce({
        code: "product.unavailable",
        status: 409,
        productId: "product-offer-flan",
      });

      await act(el, "fire-all");

      expect(api.submitDraft).toHaveBeenCalledOnce();
      expect(rows(el)).toEqual(["Beer ×1", "Flan ×1"]);
      expect(server.drafts[0]!.lines.map((line) => line.menuItemId)).toEqual([
        "offer-beer",
        "offer-flan",
      ]);
      expect(flagText(el)).toEqual([t("basket.blocked.unavailable")]);
      expect(screen(el).querySelector('[data-flag-remove="0"]')).toBeNull();
      expect(screen(el).querySelector('[data-flag-remove="1"]')).not.toBeNull();
      expect(screen(el).querySelector('[data-flag-keep="1"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends nothing, and says why, when every line is flagged", async () => {
    server.unavailable.add("offer-flan");
    server.unavailable.add("offer-beer");
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    await tap(el, "Flan");
    await saved(el);

    expect(flagText(el)).toEqual([t("basket.blocked.server"), t("basket.blocked.server")]);
    expect(
      screen(el).querySelector<HTMLElement & { disabled: boolean }>(
        '[data-draft-action="send-all"]',
      )!.disabled,
    ).toBe(true);
    await act(el, "send-all");
    expect(rows(el)).toEqual(["Beer ×1", "Flan ×1"]);
    expect(screen(el).querySelector("[data-draft-preview]")).toBeNull();
    expect(api.submitDraft).not.toHaveBeenCalled();
  });

  describe("a line kept while its menu was off the zone", () => {
    const menuOff = (): ZoneOfferCatalogue => ({
      ...catalogue("v1"),
      menus: [],
      offers: [],
      defaultMenuId: null,
    });
    const at = (versionId: string) => ({
      service: {
        open: true,
        zoneOpen: true,
        periodName: null,
        periodOccurrenceKey: null,
        keepOpen: null,
        zoneKeepOpen: null,
      },
      menus: [{ menuId: "lunch", versionId, orderable: true, sendable: true }],
      unavailable: { products: [], optionLabels: [] },
    });
    const refresh = (el: TillApp) => el.shadowRoot!.querySelector("till-basket-refresh-dialog");

    function savedBeer(over: Partial<FreshDraftLineInput> = {}): void {
      server.save("v1", {
        billId: "wo-4",
        draftId: null,
        revision: 0,
        lines: [
          {
            slot: 0,
            joinGroupId: null,
            afterGroupId: null,
            menuItemId: "offer-beer",
            variantId: null,
            menuVersionId: "v1",
            options: [],
            extras: [],
            note: null,
            quantity: "1",
            courseId: null,
            noMerge: false,
            ...over,
          },
        ],
      });
    }

    async function answerRefresh(el: TillApp, button: "confirm" | "cancel"): Promise<void> {
      refresh(el)!.shadowRoot!.querySelector<HTMLElement>(`[data-${button}]`)!.click();
      await flush(el);
    }

    /** Opens Mesa 4 while the zone offers no menu; the question that raises is still open. */
    async function openWithMenuOff(): Promise<TillApp> {
      const { el } = await mountApp({ listZoneOffers: vi.fn().mockResolvedValue(menuOff()) });
      await openMesa(el);
      expect(draft(el).lines.map((line) => line.notOffered)).toEqual([true]);
      expect(refresh(el)).not.toBeNull();
      return el;
    }

    async function poll(el: TillApp, offers: ZoneOfferCatalogue, version: string): Promise<void> {
      api.listZoneOffers.mockResolvedValue(offers);
      api.menuState.mockResolvedValue(at(version));
      vi.advanceTimersByTime(15_000);
      await flush(el, 8);
    }

    /** Opens Mesa 4 while the zone offers no menu, puts that question aside, and then lets a poll
     * find `back` offered. */
    async function menuComesBack(back: ZoneOfferCatalogue, version: string): Promise<TillApp> {
      const el = await openWithMenuOff();
      await answerRefresh(el, "cancel");
      await poll(el, back, version);
      expect(tableOrder(el)!.products.map((product) => product.name)).toContain("Beer");
      return el;
    }

    const changedLines = (el: TillApp) =>
      [...refresh(el)!.shadowRoot!.querySelectorAll("[data-changed] li")].map((line) =>
        line.textContent!.replace(/\s+/g, " ").trim(),
      );

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("names it and sends it as saved, asking nothing, when the menu is back under the version it was saved at", async () => {
      savedBeer({ quantity: "2", note: "no ice", courseId: "mains" });
      const el = await menuComesBack(catalogue("v1"), "v1");

      expect(rows(el)).toEqual(["Beer ×2"]);
      expect(flagText(el)).toEqual([]);
      expect(refresh(el)).toBeNull();
      await act(el, "fire-all");

      expect(
        server.sentGroups(api.submitDraft.mock.calls[0]![2]).flatMap((group) => group.lines),
      ).toEqual([
        {
          menuItemId: "offer-beer",
          quantity: "2",
          menuVersionId: "v1",
          note: "no ice",
          courseId: "mains",
        },
      ]);
    });

    it("asks its price when the menu is back under a newer version, and sends it under that version once confirmed", async () => {
      savedBeer();
      const el = await menuComesBack(catalogue("v2", { Beer: "6.00" }), "v2");

      expect(rows(el)).toEqual(["Beer ×1"]);
      expect(changedLines(el)).toEqual(["Beer €6.00"]);
      await answerRefresh(el, "confirm");
      await saved(el);
      await act(el, "fire-all");

      expect(sentNames()).toEqual(["offer-beer"]);
      expect(server.sentGroups(api.submitDraft.mock.calls[0]![2])[0]!.lines[0]!.menuVersionId).toBe(
        "v2",
      );
    });

    it("asks its price at the next poll when the menu came back under a newer version while the question raised at opening was still open", async () => {
      savedBeer();
      const el = await openWithMenuOff();
      await poll(el, catalogue("v2", { Beer: "6.00" }), "v2");
      expect(rows(el)).toEqual(["Beer ×1"]);

      await answerRefresh(el, "cancel");
      await poll(el, catalogue("v2", { Beer: "6.00" }), "v2");

      expect(changedLines(el)).toEqual(["Beer €6.00"]);
    });

    it("stays flagged, and is not sent, when an extra it was saved with is no longer offered with the dish", async () => {
      savedBeer({
        extras: [{ listId: "toppings", picks: [{ productId: "p-olives", quantity: 1 }] }],
      });
      const el = await menuComesBack(catalogue("v1"), "v1");

      expect(rows(el)).toEqual(["Beer ×1"]);
      expect(flagText(el)).toEqual([t("basket.blocked.extra")]);
      await toggle(el, "Beer");
      expect(
        screen(el).querySelector<HTMLElement & { disabled: boolean }>(
          '[data-draft-action="fire-selected"]',
        )!.disabled,
      ).toBe(true);
      await act(el, "fire-selected");
      expect(rows(el)).toEqual(["Beer ×1"]);
      expect(flagText(el)).toEqual([t("basket.blocked.extra")]);
      expect(api.submitDraft).not.toHaveBeenCalled();
    });
  });
});

describe("line-edit unsaved station choice", () => {
  async function opening(sessionActivity?: TillApp["sessionActivity"]) {
    const updateOrderLine = vi
      .fn()
      .mockRejectedValueOnce({ code: "station.no_replacement" })
      .mockResolvedValue({ revision: 1, party: { id: "v1", revision: 4 } });
    const askSaleDeadEnds = vi.fn().mockResolvedValue({
      sends: true,
      deadEnds: [
        {
          key: "0",
          name: "Beer",
          quantity: "2",
          stationId: "bar",
          stationName: "Bar",
          why: "closed",
        },
      ],
      stations: [{ id: "kitchen", name: "Kitchen", open: true }],
    });
    const mounted = await mountApp({ updateOrderLine, askSaleDeadEnds }, sessionActivity);
    const { el } = mounted;
    const order = await openMesa(el);
    const change = () =>
      emit(order, "change-line", {
        lineNo: 1,
        lineName: "Beer",
        patch: { quantity: "2" },
        revision: 0,
        saleLine: { menuItemId: "offer-beer", quantity: "2" },
      });
    change();
    await flush(el);
    const dialog =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>("[data-edit-dead-ends]")!;
    const section = dialog.querySelector<TillDeadEndsSection>("till-dead-ends-section")!;
    const choose = async (value = "kitchen") => {
      await section.updateComplete;
      const field = section.shadowRoot!.querySelector<WtCombobox>("wt-combobox")!;
      await chooseOption(field, value);
      await flush(el);
      return field;
    };
    const cancel = () => dialog.querySelector<HTMLElement>("[data-edit-dead-ends-cancel]")!.click();
    return { ...mounted, dialog, section, choose, cancel, change, updateOrderLine };
  }
  function unload() {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }
  async function question(el: TillApp) {
    await flush(el);
    const q =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>(
        "wt-unsaved-changes",
      )!;
    await q.updateComplete;
    return q;
  }
  for (const route of ["Cancel", "Escape"]) {
    it(`${route} retains station choice until explicit discard without retrying`, async () => {
      const { el, dialog, section, choose, cancel, updateOrderLine } = await opening();
      const field = await choose();
      field.focus();
      if (route === "Cancel") cancel();
      else await userEvent.keyboard("{Escape}");
      const q = await question(el);
      expect(q.open).toBe(true);
      expect(dialog.shadowRoot!.querySelector("dialog")!.open).toBe(true);
      expect(section.choices.get("0")).toBe("kitchen");
      expect(updateOrderLine).toHaveBeenCalledTimes(1);
      q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
      await expect.poll(() => q.open).toBe(false);
      expect(section.choices.get("0")).toBe("kitchen");
      expect(unload()).toBe(true);
      cancel();
      await question(el);
      q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
      await expect.poll(() => el.shadowRoot!.querySelector("[data-edit-dead-ends]")).toBeNull();
      expect(updateOrderLine).toHaveBeenCalledTimes(1);
      expect(unload()).toBe(false);
    });
  }
  it("untouched and reverted choices close directly without retrying", async () => {
    const { el, choose, cancel, updateOrderLine } = await opening();
    await choose();
    expect(unload()).toBe(true);
    await choose("");
    expect(unload()).toBe(false);
    cancel();
    await expect.poll(() => el.shadowRoot!.querySelector("[data-edit-dead-ends]")).toBeNull();
    expect((await question(el)).open).toBe(false);
    expect(updateOrderLine).toHaveBeenCalledTimes(1);
  });
  it("untouched choice closes directly", async () => {
    const { el, cancel, updateOrderLine } = await opening();
    expect(unload()).toBe(false);
    cancel();
    await expect.poll(() => el.shadowRoot!.querySelector("[data-edit-dead-ends]")).toBeNull();
    expect((await question(el)).open).toBe(false);
    expect(updateOrderLine).toHaveBeenCalledTimes(1);
  });
  it.each(["own", "other"])(
    "keeps the original line-edit observation after %s bill metadata changes",
    async (which) => {
      const { el, dialog, choose, updateOrderLine } = await opening();
      const { billId, editorVersion, draftId, draftRevision } = server.edit("wo-4");
      const original = { billId, editorVersion, draftId, draftRevision };
      const refreshed = await server.listDrafts("v1");
      const target = which === "own" ? "wo-4" : "wo-7";
      api.listDrafts.mockResolvedValue({
        ...refreshed,
        billEdits: refreshed.billEdits.map((edit) =>
          edit.billId === target ? { ...edit, editorVersion: edit.editorVersion + 2 } : edit,
        ),
      });
      window.dispatchEvent(new Event("focus"));
      await flush(el, 6);
      await choose();
      dialog.querySelector<HTMLElement>("[data-edit-dead-ends-retry]")!.click();
      await flush(el, 6);
      if (which === "own") {
        expect(updateOrderLine).toHaveBeenCalledOnce();
        expect(banner(el)?.textContent).toContain(codeMessage("draft.out_of_date"));
      } else {
        expect(updateOrderLine).toHaveBeenCalledTimes(2);
        expect(updateOrderLine).toHaveBeenLastCalledWith(
          "wo-4",
          1,
          { quantity: "2", makeAt: "kitchen" },
          0,
          original,
        );
      }
      expect(api.saveDraft).not.toHaveBeenCalled();
      expect(api.takeOverDraft).not.toHaveBeenCalled();
    },
  );

  it("retires the selected routing retry when its API is replaced", async () => {
    const { el, dialog, choose, updateOrderLine } = await opening();
    await choose();
    const retry = dialog.querySelector<HTMLElement>("[data-edit-dead-ends-retry]")!;
    el.api = { ...api } as unknown as TillApi;
    await flush(el, 6);
    retry.click();
    await flush(el);
    expect(updateOrderLine).toHaveBeenCalledOnce();
    expect(el.shadowRoot!.querySelector("[data-edit-dead-ends]")).toBeNull();
  });

  it("Confirm accepts the existing exact retry and invalidates pending discard", async () => {
    const { el, dialog, choose, cancel, updateOrderLine } = await opening();
    await choose();
    cancel();
    const q = await question(el);
    expect(q.open).toBe(true);
    const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
    dialog.querySelector<HTMLElement>("[data-edit-dead-ends-retry]")!.click();
    await flush(el);
    expect(q.open).toBe(false);
    expect(unload()).toBe(false);
    expect(updateOrderLine).toHaveBeenCalledTimes(2);
    expect(updateOrderLine).toHaveBeenLastCalledWith(
      "wo-4",
      1,
      { quantity: "2", makeAt: "kitchen" },
      0,
      tableOrder(el)!.billEdit,
    );
    oldDiscard.click();
    await flush(el);
    expect(updateOrderLine).toHaveBeenCalledTimes(2);
  });
  it("a child close report cannot clear the selected station", async () => {
    const { el, dialog, section, choose, updateOrderLine } = await opening();
    await choose();
    section.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-edit-dead-ends]")).toBe(dialog);
    expect(section.choices.get("0")).toBe("kitchen");
    expect(unload()).toBe(true);
    expect(updateOrderLine).toHaveBeenCalledTimes(1);
  });
  it("disconnect invalidates a pending answer and unregisters unload", async () => {
    const { el, choose, cancel, updateOrderLine } = await opening();
    await choose();
    cancel();
    const q = await question(el);
    expect(q.open).toBe(true);
    const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
    el.remove();
    await expect.poll(() => q.open).toBe(false);
    expect(unload()).toBe(false);
    oldDiscard.click();
    expect(updateOrderLine).toHaveBeenCalledTimes(1);
  });
  it("ancestor leave includes the choice but Keep does not run the continuation", async () => {
    const { el, section, choose, updateOrderLine } = await opening();
    await choose();
    const proceed = vi.fn();
    const result = leaveCoordinatorFor(el)!.request({
      scopes: [el],
      reason: "navigation",
      proceed,
    });
    const q = await question(el);
    expect(q.open).toBe(true);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    expect(await result).toBe("kept");
    expect(proceed).not.toHaveBeenCalled();
    expect(section.choices.get("0")).toBe("kitchen");
    expect(updateOrderLine).toHaveBeenCalledTimes(1);
  });
  it("replacement entry rejects departed choices, close reports and Confirm", async () => {
    const { el, dialog, section, choose, cancel, change, updateOrderLine } = await opening();
    await choose();
    cancel();
    const q = await question(el);
    expect(q.open).toBe(true);
    const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
    const oldCancel = dialog.querySelector<HTMLElement>("[data-edit-dead-ends-cancel]")!;
    const oldConfirm = dialog.querySelector<HTMLElement>("[data-edit-dead-ends-retry]")!;
    updateOrderLine.mockRejectedValueOnce({ code: "station.no_replacement" });
    change();
    await flush(el);
    const replacement =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>("[data-edit-dead-ends]")!;
    expect(replacement).not.toBe(dialog);
    expect(q.open).toBe(false);
    expect(unload()).toBe(false);
    oldDiscard.click();
    oldCancel.click();
    oldConfirm.click();
    section.dispatchEvent(
      new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }),
    );
    dialog.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-edit-dead-ends]")).toBe(replacement);
    expect(
      replacement.querySelector<TillDeadEndsSection>("till-dead-ends-section")!.choices.size,
    ).toBe(0);
    expect(updateOrderLine).toHaveBeenCalledTimes(2);
    expect(unload()).toBe(false);
  });
  it("reconnect retires the choice when history restores a route outside its order", async () => {
    const { el, host, dialog, section, choose, updateOrderLine } = await opening();
    await choose();
    const oldConfirm = dialog.querySelector<HTMLElement>("[data-edit-dead-ends-retry]")!;
    el.remove();
    expect(unload()).toBe(false);
    host.append(el);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-edit-dead-ends]")).toBeNull();
    expect(unload()).toBe(false);
    section.dispatchEvent(
      new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }),
    );
    oldConfirm.click();
    await flush(el);
    expect(updateOrderLine).toHaveBeenCalledTimes(1);
  });
  it("operator lock cancels the warning and immediately discards only the local station choice", async () => {
    const activity = {
      configure: vi.fn(),
      noteInteraction: vi.fn(),
      reacquire: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const { el, choose, cancel, updateOrderLine } = await opening(activity as never);
    await choose();
    cancel();
    const q = await question(el);
    expect(q.open).toBe(true);
    const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
    const config = activity.configure.mock.calls.at(-1)![0] as { onIdle: () => void };
    config.onIdle();
    await flush(el);
    expect(q.open).toBe(false);
    expect(lock(el)).not.toBeNull();
    expect(unload()).toBe(false);
    expect(el.shadowRoot!.querySelector("[data-edit-dead-ends]")).toBeNull();
    oldDiscard.click();
    await flush(el);
    expect(updateOrderLine).toHaveBeenCalledTimes(1);
    expect(api.logout).toHaveBeenCalledOnce();
  });
});

// The split response carries a party revision; the new draft references arrive on the following read.
describe("recalled draft source splitting", () => {
  type SourceLine = import("./api/client.js").RecalledDraftLine;

  function reference(id = "source-7", netAmount = "17.25", quantity = "2"): SourceLine {
    const line: SourceLine["source"]["line"] = {
      id,
      name: "Recorded steak",
      productId: "retired-steak",
      parentProductId: null,
      menuItemId: null,
      lineNo: id === "source-7" ? 7 : 9,
      parentLineNo: null,
      quantity,
      priceQuantity: "1",
      unitPrecision: 0,
      unitPriceGross: "7.50",
      listUnitPriceGross: "10.00",
      servedAt: null,
      courseId: null,
      sentAt: null,
      firedAt: null,
      state: null,
      stationId: null,
      movable: true,
      groupId: null,
      note: "Recorded note",
      listId: null,
    };
    return {
      id: `reference-${id}`,
      sourceLineId: id,
      source: {
        line,
        extras: [
          {
            ...line,
            id: `${id}-extra`,
            name: "Recorded cheese",
            lineNo: line.lineNo + 1,
            parentLineNo: line.lineNo,
            quantity: quantity === "2" ? "4" : "2",
            unitPriceGross: "0.75",
            listUnitPriceGross: "1.00",
            productId: "retired-cheese",
            listId: "toppings",
          },
        ],
        netAmount,
      },
      quantity,
      note: line.note,
      courseId: null,
      makeAt: null,
      noMerge: true,
      unavailable: false,
      slot: 0,
      joinGroupId: null,
      afterGroupId: null,
    };
  }

  function seedSource(): void {
    server.drafts.push({
      id: "draft-recalled",
      partyId: "v1",
      billId: "wo-4",
      ownerId: "p1",
      ownerName: "Ana",
      revision: 2,
      takenOverFrom: null,
      lines: [reference()],
    });
  }

  it("direct Fire resends a recalled source even after its fresh offer's period ends", async () => {
    seedSource();
    const { el } = await mountApp();
    await openMesa(el);
    const outbox = draft(el);
    const line = outbox.lines[0]!;
    expect(line.source?.line.id).toBe("source-7");
    line.blocked = "period_ended";
    line.notOffered = true;
    tableOrder(el)!.requestUpdate();
    await flush(el);
    await toggle(el, "Recorded steak");
    tableOrder(el)!
      .shadowRoot!.querySelector<HTMLElement>('[data-draft-action="fire-selected"]')!
      .click();
    await flush(el, 6);
    expect(api.submitDraft).toHaveBeenCalledOnce();
    expect(api.submitDraft.mock.calls[0]![2].groups).toEqual([
      { release: "fire", lineIds: ["reference-source-7"] },
    ]);
    expect(await api.submitDraft.mock.results[0]!.value).toMatchObject({ draft: null });
    expect(outbox.lineCount).toBe(0);
    expect(line.source!.netAmount).toBe("17.25");
    expect(line.source!.line.unitPriceGross).toBe("7.50");
  });

  function saveSplit(): void {
    const saved = server.drafts[0]!;
    saved.revision += 1;
    saved.lines = [reference("source-7", "8.62", "1"), reference("source-9", "8.63", "1")];
  }

  async function cancellationOpening(
    overrides: Record<string, unknown> = {},
    extraSources: SourceLine[] = [],
  ) {
    seedSource();
    server.drafts[0]!.lines.push(...extraSources);
    const mounted = await mountApp({
      listAdjustmentReasons: vi.fn().mockResolvedValue([
        {
          id: "mistake",
          name: "Mistake",
          actions: ["cancel"],
          noteRequired: true,
          maxPercentBp: null,
          maxAmount: null,
          kind: "void",
          applyRoles: [],
          approverRoles: [],
        },
      ]),
      previewAdjustment: vi.fn().mockResolvedValue({
        reduction: "17.25",
        nominalValue: "17.25",
        needsApproval: null,
        lines: [],
      }),
      applyAdjustment: vi.fn(async () => {
        server.drafts[0]!.lines = [];
        server.drafts[0]!.revision += 1;
        return { adjustmentIds: ["adjustment-1"], party: { id: "v1", revision: 4 } };
      }),
      ...overrides,
    });
    const order = await openMesa(mounted.el);
    const review = order.shadowRoot!.querySelector<HTMLElement>("[data-review-open]");
    if (review?.checkVisibility()) await userEvent.click(review);
    await order.updateComplete;
    return { ...mounted, order };
  }

  function adjustment(el: TillApp) {
    return el.shadowRoot!.querySelector<HTMLElementTagNameMap["till-adjustment-dialog"]>(
      "till-adjustment-dialog",
    );
  }

  async function cancellationPreview(el: TillApp): Promise<void> {
    draft(el).removeLine(0);
    await flush(el);
    emit(adjustment(el)!, "adjust-preview", {
      action: "cancel",
      reasonId: "mistake",
      note: "Wrong dish",
    });
    await flush(el);
  }

  async function discardPreview(el: TillApp, order: TillTableOrderScreen): Promise<void> {
    const button = order.shadowRoot!.querySelector<HTMLElement>("[data-discard-draft]");
    expect(button).not.toBeNull();
    await userEvent.click(button!);
    await flush(el);
    expect(adjustment(el)).not.toBeNull();
    emit(adjustment(el)!, "adjust-preview", {
      action: "cancel",
      reasonId: "mistake",
      note: "Duplicate order",
    });
    await flush(el);
  }

  it("Discard sends one atomic command for all recalled families and fresh dishes", async () => {
    const discardDraft = vi.fn(async () => {
      server.drafts.splice(0);
      return {
        draftId: "draft-recalled",
        billId: "wo-4",
        revision: 4,
        adjustmentIds: ["cancel-7", "cancel-9"],
        party: { id: "v1", revision: 5 },
      };
    });
    const { el, order } = await cancellationOpening({ discardDraft }, [
      reference("source-9", "8.63", "1"),
    ]);
    await tap(el, "Beer");
    await discardPreview(el, order);
    expect(rows(el)).toEqual(["Recorded steak ×2", "Recorded steak ×1", "Beer ×1"]);
    expect(adjustment(el)?.target).toMatchObject({
      name: t("table.draft_title"),
      total: "25.88",
      unitTotal: null,
    });
    expect(api.previewAdjustment!.mock.calls.map((call) => call[1])).toEqual([
      {
        expectedRevision: 0,
        lineId: "source-7",
        action: "cancel",
        reasonId: "mistake",
        note: "Duplicate order",
        sourceDraftId: "draft-recalled",
        expectedEdit: {
          billId: "wo-4",
          editorVersion: 1,
          draftId: "draft-recalled",
          draftRevision: 3,
        },
      },
      {
        expectedRevision: 0,
        lineId: "source-9",
        action: "cancel",
        reasonId: "mistake",
        note: "Duplicate order",
        sourceDraftId: "draft-recalled",
        expectedEdit: {
          billId: "wo-4",
          editorVersion: 1,
          draftId: "draft-recalled",
          draftRevision: 3,
        },
      },
    ]);
    emit(adjustment(el)!, "adjust-confirm");
    await flush(el);
    expect(discardDraft).toHaveBeenCalledOnce();
    expect(discardDraft.mock.calls[0]).toEqual([
      "v1",
      "draft-recalled",
      {
        submissionId: expect.any(String),
        revision: 3,
        expectedRevision: 0,
        expectedEdit: {
          billId: "wo-4",
          editorVersion: 1,
          draftId: "draft-recalled",
          draftRevision: 3,
        },
        reasonId: "mistake",
        note: "Duplicate order",
      },
      { signal: expect.any(AbortSignal) },
    ]);
    expect(api.applyAdjustment).not.toHaveBeenCalled();
    expect(rows(el)).toEqual([]);
    expect(adjustment(el)).toBeNull();
    expect(draft(el).editsLocked).toBe(false);
    expect(order.party?.revision).toBe(5);
  });

  it("Discard cancellation retains every draft row and sends no command", async () => {
    const discardDraft = vi.fn();
    const { el, order } = await cancellationOpening({ discardDraft });
    await discardPreview(el, order);
    expect(draft(el).editsLocked).toBe(true);
    emit(adjustment(el)!, "adjust-close");
    await flush(el);
    expect(rows(el)).toEqual(["Recorded steak ×2"]);
    expect(draft(el).editsLocked).toBe(false);
    expect(discardDraft).not.toHaveBeenCalled();
  });

  it("Discard of only fresh dishes saves first and sends no cancellation or reason request", async () => {
    const discardDraft = vi.fn(async () => {
      const saved = server.drafts[0]!;
      server.drafts.splice(0);
      return {
        draftId: saved.id,
        billId: "wo-4",
        revision: 2,
        adjustmentIds: [],
        party: { id: "v1", revision: 4 },
      };
    });
    const { el } = await mountApp({
      discardDraft,
      listAdjustmentReasons: vi.fn(),
      applyAdjustment: vi.fn(),
    });
    const order = await openMesa(el);
    await tap(el, "Beer");
    const review = order.shadowRoot!.querySelector<HTMLElement>("[data-review-open]");
    if (review?.checkVisibility()) await userEvent.click(review);
    await order.updateComplete;
    const button = order.shadowRoot!.querySelector<HTMLElement>("[data-discard-draft]");
    expect(button).not.toBeNull();
    await userEvent.click(button!);
    await flush(el);
    expect(server.saveDraft).toHaveBeenCalledOnce();
    expect(discardDraft).toHaveBeenCalledWith(
      "v1",
      expect.any(String),
      {
        submissionId: expect.any(String),
        revision: 1,
        expectedRevision: 0,
        expectedEdit: {
          billId: "wo-4",
          editorVersion: 1,
          draftId: expect.any(String),
          draftRevision: 1,
        },
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(api.listAdjustmentReasons).not.toHaveBeenCalled();
    expect(api.applyAdjustment).not.toHaveBeenCalled();
    expect(rows(el)).toEqual([]);
  });

  it("retires fresh Discard while its save waits across an API replacement", async () => {
    const discardDraft = vi.fn();
    const { el } = await mountApp({ discardDraft });
    const order = await openMesa(el);
    const old = draft(el);
    const saved = server.saveDraft.getMockImplementation()!;
    let release!: () => void;
    api.saveDraft.mockImplementationOnce(async (partyId, ask) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return saved(partyId, ask);
    });
    await tap(el, "Beer");
    const review = order.shadowRoot!.querySelector<HTMLElement>("[data-review-open]");
    if (review?.checkVisibility()) await userEvent.click(review);
    await order.updateComplete;
    await userEvent.click(order.shadowRoot!.querySelector<HTMLElement>("[data-discard-draft]")!);
    await expect.poll(() => api.saveDraft.mock.calls.length).toBe(1);
    expect(old.sending).toBe(true);
    const replacement = {
      ...api,
      discardDraft: vi.fn().mockResolvedValue({
        draftId: "draft-1",
        billId: "wo-4",
        revision: 2,
        adjustmentIds: [],
        party: { id: "v1", revision: 4 },
      }),
      listDrafts: vi.fn(server.listDrafts.getMockImplementation()!),
    };
    try {
      el.api = replacement as unknown as TillApi;
      await flush(el, 6);
    } finally {
      release();
    }
    await flush(el, 8);
    expect(discardDraft).not.toHaveBeenCalled();
    expect(replacement.discardDraft).not.toHaveBeenCalled();
    expect(replacement.listDrafts).toHaveBeenCalled();
    expect(draft(el)).not.toBe(old);
    expect(rows(el)).toEqual([]);
    expect(retainedCandidate(el)?.lines.map((line) => [line.product.name, line.quantity])).toEqual([
      ["Beer", "1"],
    ]);
    expect(draft(el).editsLocked).toBe(true);
    expect(old.sending).toBe(false);
    expect(tableOrder(el)!.groupCommandBusy).toBe(false);
  });

  it("Discard combines the source previews and requires the first approval one returns", async () => {
    const discardDraft = vi.fn(async () => {
      server.drafts.splice(0);
      return {
        draftId: "draft-recalled",
        billId: "wo-4",
        revision: 3,
        adjustmentIds: ["cancel-7", "cancel-9"],
        party: { id: "v1", revision: 5 },
      };
    });
    const { el, order } = await cancellationOpening(
      {
        discardDraft,
        previewAdjustment: vi.fn(async (_id, ask) => ({
          reduction: ask.lineId === "source-7" ? "17.25" : "8.63",
          nominalValue: ask.lineId === "source-7" ? "17.25" : "8.63",
          needsApproval: ask.lineId === "source-7" ? null : { by: "refund" },
          lines: [
            {
              lineId: ask.lineId,
              lineNo: ask.lineId === "source-7" ? 7 : 9,
              reduction: ask.lineId === "source-7" ? "17.25" : "8.63",
              rows: [],
            },
          ],
        })),
        listRefundAuthorizers: vi
          .fn()
          .mockResolvedValue([{ personId: "admin-1", displayName: "Marta" }]),
      },
      [reference("source-9", "8.63", "1")],
    );
    await discardPreview(el, order);
    expect(adjustment(el)?.preview).toEqual({
      reduction: "25.88",
      nominalValue: "25.88",
      needsApproval: { by: "refund" },
      lines: [
        { lineId: "source-7", lineNo: 7, reduction: "17.25", rows: [] },
        { lineId: "source-9", lineNo: 9, reduction: "8.63", rows: [] },
      ],
    });
    emit(adjustment(el)!, "adjust-confirm");
    await flush(el);
    expect(api.listRefundAuthorizers).toHaveBeenCalledOnce();
    expect(discardDraft).not.toHaveBeenCalled();
    const prompt = () =>
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["till-supervisor-override-dialog"]>(
        "[data-adjust-approval]",
      );
    discardDraft.mockRejectedValueOnce({ code: "pin.invalid" });
    emit(prompt()!, "override-confirm", { personId: "admin-1", pin: "0000" });
    await flush(el, 6);
    expect(prompt()?.error).toBe("pin.invalid");
    expect(rows(el)).toEqual(["Recorded steak ×2", "Recorded steak ×1"]);
    expect(draft(el).editsLocked).toBe(true);
    emit(prompt()!, "override-confirm", { personId: "admin-1", pin: "7777" });
    await flush(el, 6);
    expect(discardDraft).toHaveBeenCalledTimes(2);
    expect(discardDraft.mock.calls[1]).toEqual([
      "v1",
      "draft-recalled",
      {
        submissionId: expect.any(String),
        revision: 2,
        expectedRevision: 0,
        expectedEdit: {
          billId: "wo-4",
          editorVersion: 1,
          draftId: "draft-recalled",
          draftRevision: 2,
        },
        reasonId: "mistake",
        note: "Duplicate order",
        approver: { personId: "admin-1", pin: "7777" },
      },
      { signal: expect.any(AbortSignal) },
    ]);
    expect(rows(el)).toEqual([]);
    expect(adjustment(el)).toBeNull();
    expect(draft(el).editsLocked).toBe(false);
    expect(api.applyAdjustment).not.toHaveBeenCalled();
  });

  it("Discard honours a higher approval requirement returned by its atomic command", async () => {
    const discardDraft = vi.fn().mockRejectedValue({
      code: "adjustment.approval_required",
      params: { approval: "refund" },
    });
    const { el, order } = await cancellationOpening({
      discardDraft,
      listRefundAuthorizers: vi
        .fn()
        .mockResolvedValue([{ personId: "manager-1", displayName: "Marta" }]),
    });
    await discardPreview(el, order);
    emit(adjustment(el)!, "adjust-confirm");
    await flush(el, 6);
    expect(rows(el)).toEqual(["Recorded steak ×2"]);
    expect(adjustment(el)?.preview?.needsApproval).toEqual({ by: "refund" });
    expect(draft(el).editsLocked).toBe(true);
    emit(adjustment(el)!, "adjust-confirm");
    await flush(el);
    expect(api.listRefundAuthorizers).toHaveBeenCalledOnce();
    expect(discardDraft).toHaveBeenCalledOnce();
  });

  it("Discard replaces its PIN prompt when the command still requires approval", async () => {
    const { el, order } = await cancellationOpening({
      discardDraft: vi.fn().mockRejectedValue({
        code: "adjustment.approval_required",
        params: { approval: "refund" },
      }),
      previewAdjustment: vi.fn().mockResolvedValue({
        reduction: "17.25",
        nominalValue: "17.25",
        needsApproval: { by: "refund" },
        lines: [],
      }),
      listRefundAuthorizers: vi
        .fn()
        .mockResolvedValueOnce([{ personId: "manager-1", displayName: "Marta" }])
        .mockResolvedValue([{ personId: "admin-1", displayName: "Alba" }]),
    });
    const prompt = () =>
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["till-supervisor-override-dialog"]>(
        "[data-adjust-approval]",
      );
    await discardPreview(el, order);
    emit(adjustment(el)!, "adjust-confirm");
    await flush(el);
    expect(prompt()?.authorizers).toEqual([{ personId: "manager-1", displayName: "Marta" }]);
    emit(prompt()!, "override-confirm", { personId: "manager-1", pin: "7777" });
    await flush(el, 6);
    expect(prompt()).toBeNull();
    expect(adjustment(el)?.preview?.needsApproval).toEqual({ by: "refund" });
    expect(rows(el)).toEqual(["Recorded steak ×2"]);
    emit(adjustment(el)!, "adjust-confirm");
    await flush(el);
    expect(prompt()?.authorizers).toEqual([{ personId: "admin-1", displayName: "Alba" }]);
    expect(api.listRefundAuthorizers).toHaveBeenCalledTimes(2);
  });

  it("Discard ends its confirmation after takeover and shows the authoritative owner", async () => {
    const { el, order } = await cancellationOpening({
      discardDraft: vi.fn(async () => {
        server.drafts[0]!.ownerId = "p2";
        server.drafts[0]!.ownerName = "Luis";
        throw { code: "draft.taken_over", ownerName: "Luis" };
      }),
    });
    await discardPreview(el, order);
    emit(adjustment(el)!, "adjust-confirm");
    await flush(el, 6);
    expect(rows(el)).toEqual(["Recorded steak ×2"]);
    expect(adjustment(el)).toBeNull();
    expect(banner(el)?.textContent).toContain("Luis");
    expect(server.drafts[0]!.lines).toHaveLength(1);
    expect(draft(el).editsLocked).toBe(true);
  });

  it("Discard locks stale source rows if the successful command cannot reload its draft", async () => {
    const { el, order } = await cancellationOpening({
      discardDraft: vi.fn(async () => {
        server.drafts.splice(0);
        server.listDrafts.mockRejectedValue(new Error("Offline"));
        return {
          draftId: "draft-recalled",
          billId: "wo-4",
          revision: 3,
          adjustmentIds: ["cancel-7"],
          party: { id: "v1", revision: 5 },
        };
      }),
    });
    await discardPreview(el, order);
    emit(adjustment(el)!, "adjust-confirm");
    await flush(el, 6);
    expect(rows(el)).toEqual(["Recorded steak ×2"]);
    expect(adjustment(el)).toBeNull();
    expect(draft(el).editsLocked).toBe(true);
    expect(banner(el)?.textContent).toContain(t("table.draft_read_failed"));
    expect(order.party?.revision).toBe(5);
    draft(el).setLineExtras(0, { note: "Must not restore discarded charge" });
    expect(draft(el).lines[0]!.note).toBe("Recorded note");
  });

  it("Discard sends nothing when the draft's preceding save fails", async () => {
    const discardDraft = vi.fn();
    const { el, order } = await cancellationOpening({ discardDraft });
    draft(el).setLineExtras(0, { note: "Keep this unsaved note" });
    server.saveDraft.mockRejectedValue(new Error("Offline"));
    const button = order.shadowRoot!.querySelector<HTMLElement>("[data-discard-draft]")!;
    await userEvent.click(button);
    await flush(el);
    expect(adjustment(el)).toBeNull();
    expect(discardDraft).not.toHaveBeenCalled();
    expect(draft(el).lines[0]!.note).toBe("Recorded note");
    expect(tableOrder(el)!.retainedDraft?.lines[0]!.note).toBe("Keep this unsaved note");
    expect(tableOrder(el)!.shadowRoot!.querySelector("[data-draft-candidate]")).not.toBeNull();
    expect(draft(el).editsLocked).toBe(true);
    expect(banner(el)?.textContent).toContain(t("table.draft_save_failed"));
  });

  it("Discard closes a refused confirmation when the recovery read also fails", async () => {
    const { el, order } = await cancellationOpening({
      discardDraft: vi.fn(async () => {
        server.listDrafts.mockRejectedValue(new Error("Offline"));
        throw { code: "order.payment_in_flight" };
      }),
    });
    await discardPreview(el, order);
    emit(adjustment(el)!, "adjust-confirm");
    await flush(el, 6);
    expect(rows(el)).toEqual(["Recorded steak ×2"]);
    expect(adjustment(el)).toBeNull();
    expect(draft(el).editsLocked).toBe(true);
    expect(banner(el)?.textContent).toContain(t("table.draft_read_failed"));
  });

  it("Discard drops a late command answer after navigation and releases the table action lock", async () => {
    let answer!: () => void;
    const { el, order } = await cancellationOpening({
      discardDraft: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        server.drafts.splice(0);
        return {
          draftId: "draft-recalled",
          billId: "wo-4",
          revision: 3,
          adjustmentIds: ["cancel-7"],
          party: { id: "v1", revision: 99 },
        };
      }),
    });
    await discardPreview(el, order);
    emit(adjustment(el)!, "adjust-confirm");
    await flush(el);
    expect(draft(el).sending).toBe(true);
    emit(order, "back-to-floor");
    await flush(el);
    await userEvent.click(floor(el)!.shadowRoot!.querySelector<HTMLElement>("[data-table=t7]")!);
    await flush(el);
    const nextMessage = banner(el)?.textContent;
    answer();
    await flush(el, 6);
    expect(tableOrder(el)?.orderId).toBe("wo-7");
    expect(tableOrder(el)?.party?.revision).not.toBe(99);
    expect(adjustment(el)).toBeNull();
    expect(tableOrder(el)?.groupCommandBusy).toBe(false);
    expect(banner(el)?.textContent).toBe(nextMessage);
  });

  it.each(["offline", "refused"] as const)(
    "fresh Discard retains its saved dishes after an %s command and can retry",
    async (failure) => {
      const discardDraft = vi
        .fn()
        .mockRejectedValueOnce(
          failure === "offline"
            ? new TypeError("Failed to fetch")
            : { code: "order.payment_in_flight" },
        )
        .mockImplementationOnce(async () => {
          const saved = server.drafts[0]!;
          server.drafts.splice(0);
          return {
            draftId: saved.id,
            billId: "wo-4",
            revision: 2,
            adjustmentIds: [],
            party: { id: "v1", revision: 4 },
          };
        });
      const { el } = await mountApp({ discardDraft });
      const order = await openMesa(el);
      await tap(el, "Beer");
      const review = order.shadowRoot!.querySelector<HTMLElement>("[data-review-open]");
      if (review?.checkVisibility()) await userEvent.click(review);
      await order.updateComplete;
      const press = async () => {
        await userEvent.click(
          order.shadowRoot!.querySelector<HTMLElement>("[data-discard-draft]")!,
        );
        await flush(el, 6);
      };
      await press();
      expect(rows(el)).toEqual(["Beer ×1"]);
      expect(server.drafts[0]!.lines).toHaveLength(1);
      expect(draft(el).sending).toBe(false);
      expect(draft(el).editsLocked).toBe(false);
      expect(order.groupCommandBusy).toBe(false);
      expect(banner(el)?.textContent).toContain(
        failure === "offline" ? t("table.error") : codeMessage("order.payment_in_flight"),
      );
      await press();
      expect(rows(el)).toEqual([]);
      expect(server.drafts).toEqual([]);
      expect(discardDraft).toHaveBeenCalledTimes(2);
      expect(order.party?.revision).toBe(4);
    },
  );

  it("Discard of fresh dishes retains unsaved edits when its save is refused", async () => {
    const discardDraft = vi.fn();
    let refuse!: (error: Error) => void;
    const saveDraft = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          refuse = reject;
        }),
    );
    const { el } = await mountApp({ discardDraft, saveDraft });
    const order = await openMesa(el);
    await tap(el, "Beer");
    const review = order.shadowRoot!.querySelector<HTMLElement>("[data-review-open]");
    if (review?.checkVisibility()) await userEvent.click(review);
    await order.updateComplete;
    await userEvent.click(order.shadowRoot!.querySelector<HTMLElement>("[data-discard-draft]")!);
    await expect.poll(() => saveDraft.mock.calls.length).toBe(1);
    refuse(new Error("Offline"));
    await flush(el);
    expect(discardDraft).not.toHaveBeenCalled();
    expect(rows(el)).toEqual([]);
    expect(
      tableOrder(el)!.retainedDraft?.lines.map((line) => [line.product.name, line.quantity]),
    ).toEqual([["Beer", "1"]]);
    expect(draft(el).editsLocked).toBe(true);
    expect(banner(el)?.textContent).toContain(t("table.draft_save_failed"));
    expect(draft(el).sending).toBe(false);
  });

  it("source cancellation names its pending operation without announcing an order submission", async () => {
    let answer!: () => void;
    const { el } = await cancellationOpening({
      listAdjustmentReasons: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        return [];
      }),
    });
    draft(el).removeLine(0);
    await flush(el);
    try {
      expect(
        tableOrder(el)!.shadowRoot!.querySelector("[data-round-sending]")?.textContent?.trim(),
      ).toBe(t("adjust.cancel_title"));
    } finally {
      answer();
    }
    await flush(el);
    emit(adjustment(el)!, "adjust-close");
    await flush(el);
    expect(draft(el).busyAction).toBeUndefined();
  });

  it("source cancellation requires the reason's manager PIN and retains a refused source for retry", async () => {
    const { el } = await cancellationOpening({
      previewAdjustment: vi.fn().mockResolvedValue({
        reduction: "17.25",
        nominalValue: "17.25",
        needsApproval: { by: "refund" },
        lines: [],
      }),
      listRefundAuthorizers: vi
        .fn()
        .mockResolvedValue([{ personId: "manager-1", displayName: "Marta" }]),
    });
    await cancellationPreview(el);
    emit(adjustment(el)!, "adjust-confirm");
    await flush(el);
    expect(api.applyAdjustment).not.toHaveBeenCalled();
    const prompt = () =>
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["till-supervisor-override-dialog"]>(
        "[data-adjust-approval]",
      );
    expect(prompt()?.authorizers).toEqual([{ personId: "manager-1", displayName: "Marta" }]);
    api.applyAdjustment!.mockRejectedValueOnce({ code: "pin.invalid" });
    emit(prompt()!, "override-confirm", { personId: "manager-1", pin: "0000" });
    await flush(el, 6);
    expect(prompt()?.error).toBe("pin.invalid");
    expect(rows(el)).toEqual(["Recorded steak ×2"]);
    expect(draft(el).editsLocked).toBe(true);
    emit(prompt()!, "override-confirm", { personId: "manager-1", pin: "7777" });
    await flush(el, 6);
    expect(api.applyAdjustment).toHaveBeenCalledTimes(2);
    expect(api.applyAdjustment!.mock.calls[1]![1]).toMatchObject({
      lineId: "source-7",
      action: "cancel",
      quantity: "2",
      reasonId: "mistake",
      note: "Wrong dish",
      approver: { personId: "manager-1", pin: "7777" },
    });
    expect(rows(el)).toEqual([]);
    expect(adjustment(el)).toBeNull();
    expect(lock(el)).toBeNull();
    expect(api.logout).not.toHaveBeenCalled();
  });

  it("source cancellation ends its dialog after ownership changes and names the new owner", async () => {
    const { el } = await cancellationOpening({
      applyAdjustment: vi.fn(async () => {
        server.drafts[0]!.ownerId = "p2";
        server.drafts[0]!.ownerName = "Luis";
        throw { code: "draft.taken_over", ownerName: "Luis" };
      }),
    });
    await cancellationPreview(el);
    emit(adjustment(el)!, "adjust-confirm");
    await flush(el, 6);
    expect(adjustment(el)).toBeNull();
    expect(rows(el)).toEqual(["Recorded steak ×2"]);
    expect(draft(el).editsLocked).toBe(true);
    expect(banner(el)?.textContent).toContain("Luis");
    expect(api.applyAdjustment).toHaveBeenCalledOnce();
  });

  describe("recalled removal confirmation ownership", () => {
    async function refreshSource(el: TillApp): Promise<void> {
      const revision = ++server.drafts[0]!.revision;
      window.dispatchEvent(new Event("focus"));
      await expect.poll(() => tableOrder(el)?.billEdit?.draftRevision).toBe(revision);
      await flush(el);
    }

    it.each(["preview", "confirm", "approval"])(
      "does not refresh a recalled removal's authority at %s",
      async (stage) => {
        const { el } = await cancellationOpening({
          previewAdjustment: vi.fn().mockResolvedValue({
            reduction: "17.25",
            nominalValue: "17.25",
            needsApproval: stage === "approval" ? { by: "refund" } : null,
            lines: [],
          }),
          listRefundAuthorizers: vi
            .fn()
            .mockResolvedValue([{ personId: "manager-1", displayName: "Marta" }]),
        });
        if (stage === "preview") {
          draft(el).removeLine(0);
          await flush(el);
        } else await cancellationPreview(el);
        if (stage === "approval") {
          emit(adjustment(el)!, "adjust-confirm");
          await flush(el);
        }
        await refreshSource(el);
        if (stage === "preview")
          emit(adjustment(el)!, "adjust-preview", {
            action: "cancel",
            reasonId: "mistake",
            note: "Wrong dish",
          });
        else if (stage === "confirm") emit(adjustment(el)!, "adjust-confirm");
        else
          emit(el.shadowRoot!.querySelector("[data-adjust-approval]")!, "override-confirm", {
            personId: "manager-1",
            pin: "7777",
          });
        await flush(el, 6);
        if (stage === "preview") expect(api.previewAdjustment).not.toHaveBeenCalled();
        expect(api.applyAdjustment).not.toHaveBeenCalled();
        expect(server.drafts[0]!.lines).toEqual([reference()]);
        expect(adjustment(el)?.refusal).toBe("draft.out_of_date");
      },
    );

    it("does not open recalled removal after its reasons read outlives the bill observation", async () => {
      let resolve!: (reasons: []) => void;
      const { el } = await cancellationOpening({
        listAdjustmentReasons: vi.fn(
          () =>
            new Promise<[]>((answer) => {
              resolve = answer;
            }),
        ),
      });
      draft(el).removeLine(0);
      await expect.poll(() => api.listAdjustmentReasons!.mock.calls.length).toBe(1);
      await refreshSource(el);
      resolve([]);
      await flush(el, 6);
      expect(adjustment(el)).toBeNull();
      expect(api.previewAdjustment).not.toHaveBeenCalled();
      expect(api.applyAdjustment).not.toHaveBeenCalled();
      expect(server.drafts[0]!.lines).toEqual([reference()]);
      expect(draft(el).sending).toBe(false);
      expect(draft(el).editsLocked).toBe(false);
    });
  });

  it("recalled removal keeps its confirmation state while the source command waits", async () => {
    const { el } = await cancellationOpening();
    await cancellationPreview(el);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runCommand = DraftSync.prototype.runCommand;
    const command = vi.spyOn(DraftSync.prototype, "runCommand").mockImplementation(async function <
      T,
    >(
      this: DraftSync,
      send: (state: DraftCommandState, options: { signal: AbortSignal }) => Promise<T>,
    ): Promise<DraftCommandOutcome<T>> {
      await held;
      return (runCommand<T>).call(this, send);
    });
    try {
      emit(adjustment(el)!, "adjust-confirm");
      await expect.poll(() => command.mock.calls.length).toBe(1);
      const revision = ++server.drafts[0]!.revision;
      window.dispatchEvent(new Event("focus"));
      await expect.poll(() => tableOrder(el)?.billEdit?.draftRevision).toBe(revision);
      release();
      await flush(el, 8);
      expect(api.applyAdjustment).not.toHaveBeenCalled();
      expect(server.drafts[0]!.lines).toEqual([reference()]);
      expect(adjustment(el)).toBeNull();
      expect(banner(el)?.textContent).toContain(t("table.draft_changed_elsewhere"));
    } finally {
      release();
      command.mockRestore();
    }
  });

  it.each(["remove", "discard"])(
    "retires recalled %s while its command waits across an API replacement",
    async (action) => {
      const { el, order } = await cancellationOpening({ discardDraft: vi.fn() });
      if (action === "discard") await discardPreview(el, order);
      else await cancellationPreview(el);
      const old = draft(el);
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const runCommand = DraftSync.prototype.runCommand;
      const command = vi
        .spyOn(DraftSync.prototype, "runCommand")
        .mockImplementation(async function <T>(
          this: DraftSync,
          send: (state: DraftCommandState, options: { signal: AbortSignal }) => Promise<T>,
        ): Promise<DraftCommandOutcome<T>> {
          await held;
          return (runCommand<T>).call(this, send);
        });
      const replacement = {
        ...api,
        discardDraft: vi.fn(),
        applyAdjustment: vi.fn(),
        listDrafts: vi.fn(server.listDrafts.getMockImplementation()!),
      };
      try {
        emit(adjustment(el)!, "adjust-confirm");
        await expect.poll(() => command.mock.calls.length).toBe(1);
        el.api = replacement as unknown as TillApi;
        await flush(el, 6);
        release();
        await flush(el, 8);
        expect(api.applyAdjustment).not.toHaveBeenCalled();
        expect(api.discardDraft).not.toHaveBeenCalled();
        expect(replacement.applyAdjustment).not.toHaveBeenCalled();
        expect(replacement.discardDraft).not.toHaveBeenCalled();
        expect(replacement.listDrafts).toHaveBeenCalled();
        expect(draft(el)).not.toBe(old);
        expect(rows(el)).toEqual(["Recorded steak ×2"]);
        expect(server.drafts[0]!.lines).toEqual([reference()]);
        expect(adjustment(el)).toBeNull();
        expect(draft(el).editsLocked).toBe(false);
        expect(old.sending).toBe(false);
        expect(tableOrder(el)!.groupCommandBusy).toBe(false);
      } finally {
        release();
        command.mockRestore();
      }
    },
  );

  it("recalled Discard stops its preview list when the bill observation changes", async () => {
    let release!: (value: import("./api/client.js").AdjustmentPreview) => void;
    const preview = {
      reduction: "17.25",
      nominalValue: "17.25",
      needsApproval: null,
      lines: [],
    } as const;
    const previewAdjustment = vi
      .fn()
      .mockResolvedValue(preview)
      .mockImplementationOnce(
        () =>
          new Promise<import("./api/client.js").AdjustmentPreview>((resolve) => {
            release = resolve;
          }),
      );
    const { el, order } = await cancellationOpening({ previewAdjustment, discardDraft: vi.fn() }, [
      reference("source-9", "8.63", "1"),
    ]);
    try {
      await discardPreview(el, order);
      await expect.poll(() => previewAdjustment.mock.calls.length).toBe(1);
      const revision = ++server.drafts[0]!.revision;
      window.dispatchEvent(new Event("focus"));
      await expect.poll(() => tableOrder(el)?.billEdit?.draftRevision).toBe(revision);
      release({ ...preview, lines: [] });
      await flush(el, 6);
      expect(previewAdjustment).toHaveBeenCalledOnce();
      expect(adjustment(el)?.refusal).toBe("draft.out_of_date");
      expect(adjustment(el)?.preview).toBeNull();
      expect(server.drafts[0]!.lines).toEqual([reference(), reference("source-9", "8.63", "1")]);
      expect(api.applyAdjustment).not.toHaveBeenCalled();
      expect(api.discardDraft).not.toHaveBeenCalled();
    } finally {
      release({ ...preview, lines: [] });
    }
  });

  it("recalled removal retains its shown observation when another bill changes", async () => {
    let otherVersion = 0;
    const listDrafts = vi.fn(async (partyId: string) => {
      const snapshot = await server.listDrafts(partyId);
      return {
        ...snapshot,
        billEdits: snapshot.billEdits.map((edit) =>
          edit.billId === "wo-check" ? { ...edit, editorVersion: otherVersion } : edit,
        ),
      };
    });
    const { el } = await cancellationOpening({ listDrafts });
    await cancellationPreview(el);
    const read = listDrafts.mock.calls.length;
    otherVersion = 9;
    window.dispatchEvent(new Event("focus"));
    await expect.poll(() => listDrafts.mock.calls.length).toBeGreaterThan(read);
    await flush(el);
    emit(adjustment(el)!, "adjust-confirm");
    await flush(el, 6);
    expect(api.applyAdjustment).toHaveBeenCalledExactlyOnceWith(
      "wo-4",
      {
        action: "cancel",
        reasonId: "mistake",
        note: "Wrong dish",
        quantity: "2",
        lineId: "source-7",
        expectedRevision: 0,
        expectedEdit: {
          billId: "wo-4",
          editorVersion: 1,
          draftId: "draft-recalled",
          draftRevision: 2,
        },
        sourceDraftId: "draft-recalled",
        submissionId: expect.any(String),
      },
      expect.any(Object),
    );
    expect(adjustment(el)).toBeNull();
    expect(server.drafts[0]!.lines).toEqual([]);
  });

  it("source cancellation locks a stale draft after a successful write whose recovery read fails", async () => {
    const { el } = await cancellationOpening();
    await cancellationPreview(el);
    server.listDrafts.mockRejectedValueOnce(new Error("Read offline"));
    emit(adjustment(el)!, "adjust-confirm");
    await flush(el, 6);
    expect(adjustment(el)).toBeNull();
    expect(banner(el)?.textContent).toContain(t("table.draft_read_failed"));
    const store = draft(el);
    expect(store.editsLocked).toBe(true);
    store.setLineExtras(0, { note: "Must not restore the cancelled source" });
    expect(store.lines[0]!.note).toBe("Recorded note");
    expect(api.applyAdjustment).toHaveBeenCalledOnce();
    expect(tableOrder(el)?.party?.revision).toBe(4);
  });

  it("source cancellation closes a refused confirmation when its recovery read fails", async () => {
    const { el } = await cancellationOpening({
      applyAdjustment: vi.fn().mockRejectedValue({ code: "adjustment.note_required" }),
    });
    await cancellationPreview(el);
    server.listDrafts.mockRejectedValueOnce(new Error("Read offline"));
    emit(adjustment(el)!, "adjust-confirm");
    await flush(el, 6);
    expect(adjustment(el)).toBeNull();
    expect(banner(el)?.textContent).toContain(t("table.draft_read_failed"));
    expect(rows(el)).toEqual(["Recorded steak ×2"]);
    expect(draft(el).editsLocked).toBe(true);
    expect(api.applyAdjustment).toHaveBeenCalledOnce();
  });

  it("source cancellation drops a late reasons answer after leaving the table", async () => {
    let answer!: () => void;
    const { el } = await cancellationOpening({
      listAdjustmentReasons: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        return [];
      }),
    });
    const old = draft(el);
    old.removeLine(0);
    await flush(el);
    old.removeLine(0);
    expect(api.listAdjustmentReasons).toHaveBeenCalledOnce();
    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    answer();
    await flush(el, 6);
    expect(adjustment(el)).toBeNull();
    expect(old.sending).toBe(false);
    expect(old.editsLocked).toBe(false);
    expect(floor(el)).not.toBeNull();
    expect(api.applyAdjustment).not.toHaveBeenCalled();
  });

  it.each(["remove", "discard"] as const)(
    "source %s preserves recorded charges after a reasons read fails and can reopen",
    async (action) => {
      const { el, order } = await cancellationOpening({ discardDraft: vi.fn() });
      const reasons = api.listAdjustmentReasons!.getMockImplementation()!;
      api.listAdjustmentReasons!.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      const open = async () => {
        if (action === "remove") draft(el).removeLine(0);
        else
          await userEvent.click(
            order.shadowRoot!.querySelector<HTMLElement>("[data-discard-draft]")!,
          );
        await flush(el, 6);
      };
      await open();
      expect(adjustment(el)).toBeNull();
      expect(rows(el)).toEqual(["Recorded steak ×2"]);
      expect(server.drafts[0]!.lines[0]!).toMatchObject({
        source: { line: { id: "source-7", quantity: "2" } },
      });
      expect(draft(el).sending).toBe(false);
      expect(draft(el).editsLocked).toBe(false);
      expect(order.groupCommandBusy).toBe(false);
      expect(banner(el)?.textContent).toContain(t("adjust.reasons_error"));
      expect(api.applyAdjustment).not.toHaveBeenCalled();
      expect(api.discardDraft).not.toHaveBeenCalled();
      api.listAdjustmentReasons!.mockImplementation(reasons);
      await open();
      expect(adjustment(el)?.target).toMatchObject({
        lineId: action === "remove" ? "source-7" : null,
        total: "17.25",
      });
      expect(rows(el)).toEqual(["Recorded steak ×2"]);
      expect(draft(el).editsLocked).toBe(true);
      emit(adjustment(el)!, "adjust-close");
      await flush(el);
      expect(draft(el).editsLocked).toBe(false);
      expect(rows(el)).toEqual(["Recorded steak ×2"]);
    },
  );

  it("source cancellation keeps prior edits when their save fails and sends no money command", async () => {
    const { el } = await cancellationOpening();
    draft(el).setLineExtras(0, { note: "No salt" });
    server.saveDraft.mockRejectedValueOnce(new Error("Offline"));
    draft(el).removeLine(0);
    await flush(el, 6);
    expect(rows(el)).toEqual(["Recorded steak ×2"]);
    expect(draft(el).lines[0]!.note).toBe("Recorded note");
    expect(tableOrder(el)!.retainedDraft?.lines[0]!.note).toBe("No salt");
    expect(tableOrder(el)!.shadowRoot!.querySelector("[data-draft-candidate]")).not.toBeNull();
    expect(adjustment(el)).toBeNull();
    expect(banner(el)?.textContent).toContain(t("table.draft_save_failed"));
    expect(api.listAdjustmentReasons).not.toHaveBeenCalled();
    expect(api.applyAdjustment).not.toHaveBeenCalled();
    expect(draft(el).sending).toBe(false);
    expect(draft(el).editsLocked).toBe(true);
  });

  it("source cancellation ignores late answers after table navigation and releases the command lock", async () => {
    let answer!: () => void;
    const { el } = await cancellationOpening({
      applyAdjustment: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        return { adjustmentIds: ["adjustment-1"], party: { id: "v1", revision: 40 } };
      }),
    });
    await cancellationPreview(el);
    emit(adjustment(el)!, "adjust-confirm");
    await flush(el);
    const old = draft(el);
    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
    await flush(el);
    const nextMessage = banner(el)?.textContent;
    answer();
    await flush(el, 6);
    expect(tableOrder(el)?.party?.id).toBe("v7");
    expect(tableOrder(el)?.party?.revision).toBe(9);
    expect(banner(el)?.textContent).toBe(nextMessage);
    expect(adjustment(el)).toBeNull();
    expect(old.sending).toBe(false);
    expect(old.editsLocked).toBe(true);
    expect(tableOrder(el)?.groupCommandBusy).toBe(false);
  });

  it("source removal opens cancellation without dropping or autosaving its recorded charge", async () => {
    const { el, order } = await cancellationOpening();
    const basket = order.shadowRoot!.querySelector("till-basket")!;
    await userEvent.click(basket.shadowRoot!.querySelector<HTMLElement>(".remove")!);
    await flush(el);
    expect(rows(el)).toEqual(["Recorded steak ×2"]);
    expect(adjustment(el)?.kind).toBe("cancel");
    expect(adjustment(el)?.target).toMatchObject({
      lineId: "source-7",
      quantity: "2",
      total: "17.25",
      unitTotal: null,
    });
    expect(server.saveDraft).not.toHaveBeenCalled();
    expect(api.applyAdjustment).not.toHaveBeenCalled();
    emit(adjustment(el)!, "adjust-close");
    await flush(el);
    expect(rows(el)).toEqual(["Recorded steak ×2"]);
    expect(draft(el).editsLocked).toBe(false);
  });

  it("source quantity decrease waits for cancellation and sends only the requested difference", async () => {
    const { el } = await cancellationOpening({
      applyAdjustment: vi.fn(async () => {
        server.drafts[0]!.lines = [reference("source-7", "8.63", "1")];
        server.drafts[0]!.revision += 1;
        return { adjustmentIds: ["adjustment-1"], party: { id: "v1", revision: 4 } };
      }),
    });
    draft(el).setLineQuantity(0, "1");
    await flush(el);
    expect(rows(el)).toEqual(["Recorded steak ×2"]);
    expect(adjustment(el)?.target?.quantity).toBe("1");
    const choice = { action: "cancel", reasonId: "mistake", note: "Guest changed their mind" };
    emit(adjustment(el)!, "adjust-preview", choice);
    await flush(el);
    expect(api.previewAdjustment).toHaveBeenCalledWith("wo-4", {
      ...choice,
      lineId: "source-7",
      expectedRevision: 0,
      quantity: "1",
      expectedEdit: {
        billId: "wo-4",
        editorVersion: 1,
        draftId: "draft-recalled",
        draftRevision: 2,
      },
      sourceDraftId: "draft-recalled",
    });
    emit(adjustment(el)!, "adjust-confirm");
    await flush(el);
    expect(api.applyAdjustment).toHaveBeenCalledOnce();
    expect(api.applyAdjustment!.mock.calls[0]).toEqual([
      "wo-4",
      {
        ...choice,
        lineId: "source-7",
        quantity: "1",
        expectedRevision: 0,
        expectedEdit: {
          billId: "wo-4",
          editorVersion: 1,
          draftId: "draft-recalled",
          draftRevision: 2,
        },
        sourceDraftId: "draft-recalled",
        submissionId: expect.any(String),
      },
      { signal: expect.any(AbortSignal) },
    ]);
    expect(rows(el)).toEqual(["Recorded steak ×1"]);
    expect(draft(el).total).toBe("8.63");
    expect(adjustment(el)).toBeNull();
    expect(server.saveDraft).not.toHaveBeenCalled();
    expect(draft(el).editsLocked).toBe(false);
  });

  it("source cancellation saves earlier edits before fixing its bill revision and blocks later edits", async () => {
    const { el } = await cancellationOpening();
    draft(el).setLineExtras(0, { note: "No salt" });
    api.getTabLines!.mockResolvedValue({ lines: [], revision: 8, editSentLines: true });
    draft(el).removeLine(0);
    await flush(el);
    expect(server.saveDraft).toHaveBeenCalledOnce();
    expect(server.saveDraft.mock.calls[0]![1].lines[0]).toMatchObject({
      sourceLineId: "source-7",
      quantity: "2",
      note: "No salt",
    });
    expect(rows(el)).toEqual(["Recorded steak ×2"]);
    expect(draft(el).editsLocked).toBe(true);
    draft(el).setLineExtras(0, { note: "Must not save" });
    expect(draft(el).lines[0]!.note).toBe("No salt");
    emit(adjustment(el)!, "adjust-preview", {
      action: "cancel",
      reasonId: "mistake",
      note: "Wrong dish",
    });
    await flush(el);
    expect(api.previewAdjustment!.mock.calls[0]![1]).toMatchObject({ expectedRevision: 8 });
  });

  async function opening(split: ReturnType<typeof vi.fn>) {
    seedSource();
    const mounted = await mountApp({ splitHeldLineIntoUnits: split });
    const order = await openMesa(mounted.el);
    const review = order.shadowRoot!.querySelector<HTMLElement>("[data-review-open]");
    if (review?.checkVisibility()) await userEvent.click(review);
    await order.updateComplete;
    const button = order.shadowRoot!.querySelector<HTMLButtonElement>(
      "[data-split-draft-line='0']",
    )!;
    expect(button).not.toBeNull();
    return { ...mounted, order, button };
  }

  it("keeps the original family until the server splits and hydrates distinct recorded charges", async () => {
    let answer!: () => void;
    const split = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        answer = resolve;
      });
      saveSplit();
      return { revision: 4 };
    });
    const { el, button } = await opening(split);
    await userEvent.click(button);
    await flush(el);
    expect(rows(el)).toEqual(["Recorded steak ×2"]);
    expect(split).toHaveBeenCalledOnce();
    expect(split.mock.calls[0]).toEqual([
      "v1",
      "source-7",
      {
        submissionId: expect.any(String),
        expectedPartyRevision: 3,
        expectedEdit: {
          billId: "wo-4",
          editorVersion: 1,
          draftId: "draft-recalled",
          draftRevision: 2,
        },
      },
      { signal: expect.any(AbortSignal) },
    ]);
    expect(draft(el).sending).toBe(true);
    expect(draft(el).total).toBe("17.25");
    expect(
      tableOrder(el)!.shadowRoot!.querySelector("[data-round-sending]")!.textContent!.trim(),
    ).toBe(t("table.split_group_line"));
    answer();
    await flush(el, 6);
    expect(rows(el)).toEqual(["Recorded steak ×1", "Recorded steak ×1"]);
    expect(
      draft(el).lines.map((line) => [
        line.draftLineId,
        line.workingOrderLineId,
        line.source?.netAmount,
        line.source?.extras.map((extra) => [extra.id, extra.quantity]),
      ]),
    ).toEqual([
      ["reference-source-7", "source-7", "8.62", [["source-7-extra", "2"]]],
      ["reference-source-9", "source-9", "8.63", [["source-9-extra", "2"]]],
    ]);
    expect(draft(el).total).toBe("17.25");
    expect(tableOrder(el)?.party?.revision).toBe(4);
    expect(draft(el).sending).toBe(false);
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it("a later submission announces sending after the split operation has finished", async () => {
    const split = vi.fn(async () => {
      saveSplit();
      return { revision: 4 };
    });
    const { el, button } = await opening(split);
    await userEvent.click(button);
    await flush(el, 6);
    let answer!: () => void;
    api.submitDraft.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        answer = resolve;
      });
      server.drafts = server.drafts.filter((draft) => draft.billId !== "wo-4");
      return { tabId: "wo-4", revision: 5, groups: [], draft: null, edit: server.edit("wo-4") };
    });
    const store = draft(el);
    emit(tableOrder(el)!, "submit-draft", {
      store,
      sent: [...store.lines],
      groups: [{ release: "fire", lineIndexes: [0, 1] }],
      draft: { laterAddition: true, tally: { fired: 0, held: 0, joined: 0 } },
    });
    await flush(el, 6);
    try {
      expect(api.submitDraft).toHaveBeenCalledOnce();
      expect(
        tableOrder(el)!.shadowRoot!.querySelector("[data-round-sending]")!.textContent!.trim(),
      ).toBe(t("table.round_sending"));
    } finally {
      answer();
    }
    await flush(el, 6);
  });

  it("blocks repeated source split events and edits while the original request is pending", async () => {
    let answer!: () => void;
    const split = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        answer = resolve;
      });
      saveSplit();
      return { revision: 4 };
    });
    const { el, order, button } = await opening(split);
    const store = draft(el);
    const line = store.lines[0]!;
    await userEvent.click(button);
    emit(order, "split-draft-source", { store, line });
    store.setLineExtras(0, { note: "Late edit" });
    await flush(el);
    expect(split).toHaveBeenCalledOnce();
    expect(line.note).toBe("Recorded note");
    expect(button.disabled).toBe(true);
    answer();
    await flush(el, 6);
    expect(rows(el)).toEqual(["Recorded steak ×1", "Recorded steak ×1"]);
  });

  it("rereads ownership after a refused split and names the new owner without retrying", async () => {
    const split = vi.fn(async () => {
      server.drafts[0]!.ownerId = "p2";
      server.drafts[0]!.ownerName = "Sam";
      throw { code: "draft.taken_over", ownerName: "Sam" };
    });
    const { el, order, button } = await opening(split);
    await userEvent.click(button);
    await flush(el, 6);
    expect(rows(el)).toEqual(["Recorded steak ×2"]);
    expect(draft(el).editsLocked).toBe(true);
    expect(order.otherDrafts.map((other) => [other.ownerName, other.lines.length])).toEqual([
      ["Sam", 1],
    ]);
    expect(banner(el)?.textContent).toContain("Sam");
    expect(split).toHaveBeenCalledOnce();
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it("locks a stale source after a successful split with a failed read and recovers by reopening", async () => {
    const split = vi.fn(async () => {
      saveSplit();
      return { revision: 4 };
    });
    const { el, order, button } = await opening(split);
    api.listDrafts.mockRejectedValueOnce(new TypeError("offline"));
    const store = draft(el);
    const line = store.lines[0]!;
    await userEvent.click(button);
    await flush(el, 6);
    expect(store.editsLocked).toBe(true);
    store.setLineExtras(0, { note: "Would overwrite the split" });
    emit(order, "split-draft-source", { store, line });
    await flush(el);
    expect(split).toHaveBeenCalledOnce();
    expect(line.note).toBe("Recorded note");
    expect(rows(el)).toEqual(["Recorded steak ×2"]);
    expect(banner(el)?.textContent).toContain(t("table.draft_read_failed"));
    await back(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el, 6);
    expect(rows(el)).toEqual(["Recorded steak ×1", "Recorded steak ×1"]);
    expect(draft(el).editsLocked).toBe(false);
    expect(draft(el).total).toBe("17.25");
    expect(split).toHaveBeenCalledOnce();
  });

  it("drops late split answers after switching tables and releases the command lock", async () => {
    let answer!: () => void;
    const split = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        answer = resolve;
      });
      return { revision: 99 };
    });
    const { el, order, button } = await opening(split);
    server.drafts.push({
      ...structuredClone(server.drafts[0]!),
      id: "draft-table-7",
      partyId: "v7",
      billId: "wo-7",
    });
    const old = { store: draft(el), line: draft(el).lines[0]! };
    await userEvent.click(button);
    emit(order, "open-table", { tableId: "t7", seated: true });
    await flush(el, 6);
    expect(tableOrder(el)!.orderId).toBe("wo-7");
    const messageOnNewTable = banner(el)?.textContent;
    answer();
    await flush(el, 6);
    expect(banner(el)?.textContent).toBe(messageOnNewTable);
    expect(tableOrder(el)?.party?.revision).toBe(9);
    expect(draft(el).lines[0]!.workingOrderLineId).toBe("source-7");
    const next = tableOrder(el)!.shadowRoot!.querySelector<HTMLButtonElement>(
      "[data-split-draft-line='0']",
    )!;
    expect(next.disabled).toBe(false);
    emit(tableOrder(el)!, "split-draft-source", old);
    await flush(el);
    expect(split).toHaveBeenCalledOnce();
  });

  it("retires a source split while its save waits across an API replacement", async () => {
    const split = vi.fn(async () => {
      saveSplit();
      return { revision: 4 };
    });
    const { el, button } = await opening(split);
    const old = draft(el);
    let release!: () => void;
    let signal: AbortSignal | undefined;
    api.saveDraft.mockImplementationOnce(async (partyId, ask, options) => {
      signal = options?.signal;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return server.snapshot(server.save(partyId, ask));
    });
    old.setLineExtras(0, { note: "No pepper" });
    await userEvent.click(button);
    await flush(el);
    expect(api.saveDraft).toHaveBeenCalledOnce();
    expect(old.sending).toBe(true);
    expect(split).not.toHaveBeenCalled();
    const replacement = {
      ...api,
      splitHeldLineIntoUnits: vi.fn(split.getMockImplementation()!),
      listDrafts: vi.fn(server.listDrafts.getMockImplementation()!),
    };
    try {
      el.api = replacement as unknown as TillApi;
      await flush(el, 6);
    } finally {
      release();
    }
    await flush(el, 8);
    expect(split).not.toHaveBeenCalled();
    expect(replacement.splitHeldLineIntoUnits).not.toHaveBeenCalled();
    expect(replacement.listDrafts).toHaveBeenCalled();
    expect(draft(el)).not.toBe(old);
    expect(signal?.aborted).toBe(true);
    expect(rows(el)).toEqual(["Recorded steak ×2"]);
    expect(draft(el).lines[0]!.note).toBe("Recorded note");
    expect(retainedCandidate(el)?.lines[0]!.note).toBe("No pepper");
    expect(draft(el).editsLocked).toBe(true);
    expect(old.sending).toBe(false);
    expect(tableOrder(el)!.groupCommandBusy).toBe(false);
    expect(draft(el).total).toBe("17.25");
  });

  it("does not send a source removed by the pending save's authoritative answer", async () => {
    const split = vi.fn().mockResolvedValue({ revision: 4 });
    const { el, button } = await opening(split);
    api.saveDraft.mockImplementationOnce(async (partyId, ask) => {
      const saved = server.save(partyId, ask);
      saved.lines = [];
      return server.snapshot(saved);
    });
    draft(el).setLineExtras(0, { note: "No pepper" });
    await userEvent.click(button);
    await flush(el, 6);
    expect(split).not.toHaveBeenCalled();
    expect(rows(el)).toEqual([]);
    expect(banner(el)?.textContent).toContain(t("table.draft_changed_elsewhere"));
  });

  it("ignores a detached row or another store even when it names the same recorded source", async () => {
    const split = vi.fn().mockResolvedValue({ revision: 4 });
    const { el, order } = await opening(split);
    const store = draft(el);
    const line = store.lines[0]!;
    emit(order, "split-draft-source", { store: new WorkingOrderStore(), line });
    emit(order, "split-draft-source", { store, line: { ...line } });
    await flush(el);
    expect(split).not.toHaveBeenCalled();
    expect(rows(el)).toEqual(["Recorded steak ×2"]);
    expect(store.sending).toBe(false);
  });

  it("aborts the source split when the operator signs out and ignores its late answer", async () => {
    let answer!: () => void;
    let signal: AbortSignal | undefined;
    const split = vi.fn(async (...args: Parameters<TillApi["splitHeldLineIntoUnits"]>) => {
      signal = args[3]?.signal;
      await new Promise<void>((resolve) => {
        answer = resolve;
      });
      return { revision: 99 };
    });
    const { el, button } = await opening(split);
    await userEvent.click(button);
    try {
      emit(shell(el), "logout");
      await flush(el, 6);
      expect(signal?.aborted).toBe(true);
      expect(lock(el)).not.toBeNull();
      expect(api.logout).toHaveBeenCalledOnce();
    } finally {
      answer();
    }
    await flush(el, 6);
    expect(lock(el)).not.toBeNull();
    expect(tableOrder(el)?.party?.revision).not.toBe(99);
    expect(split).toHaveBeenCalledOnce();
  });

  it("keeps fresh-line splitting local without calling the recorded-family command", async () => {
    const split = vi.fn();
    const { el } = await mountApp({ splitHeldLineIntoUnits: split });
    await openMesa(el);
    await tap(el, "Beer");
    await tap(el, "Beer");
    const order = tableOrder(el)!;
    const review = order.shadowRoot!.querySelector<HTMLElement>("[data-review-open]");
    if (review?.checkVisibility()) await userEvent.click(review);
    await userEvent.click(
      order.shadowRoot!.querySelector<HTMLElement>("[data-split-draft-line='0']")!,
    );
    expect(rows(el)).toEqual(["Beer ×1", "Beer ×1"]);
    expect(draft(el).lines.every((line) => line.source === undefined)).toBe(true);
    expect(split).not.toHaveBeenCalled();
  });

  it("saves a pending source edit before splitting without locally duplicating its reference", async () => {
    const split = vi.fn(async () => {
      saveSplit();
      return { revision: 4 };
    });
    const { el, button } = await opening(split);
    let answer!: () => void;
    api.saveDraft.mockImplementationOnce(async (partyId, ask) => {
      await new Promise<void>((resolve) => {
        answer = resolve;
      });
      return server.snapshot(server.save(partyId, ask));
    });
    draft(el).setLineExtras(0, { note: "No pepper" });
    await userEvent.click(button);
    await flush(el);
    expect(api.saveDraft).toHaveBeenCalledOnce();
    expect(split).not.toHaveBeenCalled();
    expect(rows(el)).toEqual(["Recorded steak ×2"]);
    expect(draft(el).sending).toBe(true);
    answer();
    await flush(el, 6);
    expect(split).toHaveBeenCalledOnce();
    expect(rows(el)).toEqual(["Recorded steak ×1", "Recorded steak ×1"]);
    expect(api.saveDraft).toHaveBeenCalledOnce();
  });

  it("keeps the source and pending edit when the save before a split fails", async () => {
    const split = vi.fn().mockResolvedValue({ revision: 4 });
    const { el, button } = await opening(split);
    api.saveDraft.mockRejectedValue(new TypeError("offline"));
    draft(el).setLineExtras(0, { note: "No pepper" });
    await userEvent.click(button);
    await flush(el, 6);
    expect(api.saveDraft).toHaveBeenCalledOnce();
    expect(split).not.toHaveBeenCalled();
    expect(rows(el)).toEqual(["Recorded steak ×2"]);
    expect(draft(el).lines[0]!.note).toBe("Recorded note");
    expect(tableOrder(el)!.retainedDraft?.lines[0]!.note).toBe("No pepper");
    expect(draft(el).editsLocked).toBe(true);
    expect(banner(el)?.textContent).toContain(t("table.draft_save_failed"));
  });

  describe("party Recall into New order", () => {
    function recalled() {
      return { ...reference(), joinGroupId: "held-3" };
    }

    function recordRecall(): import("./api/client.js").Draft {
      let own = server.drafts.find((each) => each.ownerId === "p1" && each.billId === "wo-4");
      if (own === undefined)
        own = server.save("v1", { draftId: null, revision: 0, billId: "wo-4", lines: [] });
      own.revision += 1;
      own.lines.push(recalled());
      api.getTabLines.mockResolvedValue({ lines: [], revision: 8, editSentLines: true });
      return structuredClone(own);
    }

    async function recallOpening(overrides: Record<string, unknown> = {}) {
      const source = reference().source.line;
      const mounted = await mountApp({
        getTabLines: vi.fn().mockResolvedValue({
          lines: [
            {
              ...source,
              sentAt: "2026-10-17T08:00:00Z",
              firedAt: "2026-10-17T08:00:00Z",
              state: "queued",
            },
          ],
          revision: 7,
          editSentLines: true,
        }),
        readCurrentOrders: vi.fn().mockResolvedValue(
          current({
            revision: 3,
            groups: [],
            reminder: null,
            ungrouped: [
              row(source.id, source.name!, source.quantity, {
                lineNo: source.lineNo,
                workingOrderId: "wo-4",
                courseId: source.courseId,
                unitPrecision: source.unitPrecision ?? null,
                netAmount: reference().source.netAmount,
                firedAt: "2026-10-17T08:00:00Z",
                note: source.note,
                kitchen: {
                  stationId: null,
                  movable: true,
                  state: "queued",
                  firedAt: "2026-10-17T08:00:00Z",
                  awayAt: null,
                },
                extras: reference().source.extras.map((extra) => ({
                  lineId: extra.id,
                  name: extra.name!,
                  quantity: extra.quantity,
                  unitPriceGross: extra.unitPriceGross,
                  priceQuantity: extra.priceQuantity ?? "1",
                  netAmount: "3.00",
                })),
              }),
            ],
          }),
        ),
        recallLines: vi.fn().mockResolvedValue(undefined),
        recallToDraft: vi.fn(async () => ({ revision: 4, draft: recordRecall() })),
        ...overrides,
      });
      const order = await openMesa(mounted.el);
      return { ...mounted, order };
    }

    it("recalls the recorded family into its bill's draft and reads it before allowing edits", async () => {
      const { el, order } = await recallOpening();
      const reads = api.listDrafts.mock.calls.length;
      await openSentDish(order, "source-7");
      await openSentMore(order);
      const button = order.shadowRoot!.querySelector<HTMLElement>("[data-sent-line-recall]");
      expect(button).not.toBeNull();
      await userEvent.click(button!);
      await flush(el, 6);
      expect(api.recallToDraft).toHaveBeenCalledWith(
        "v1",
        "source-7",
        {
          expectedPartyRevision: 3,
          submissionId: expect.any(String),
          expectedEdit: { billId: "wo-4", editorVersion: 0, draftId: null, draftRevision: null },
        },
        { signal: expect.any(AbortSignal) },
      );
      expect(api.recallLines).not.toHaveBeenCalled();
      expect(api.listDrafts.mock.calls.length).toBe(reads + 1);
      expect(rows(el)).toEqual(["Recorded steak ×2"]);
      expect(draft(el).lines[0]).toMatchObject({
        workingOrderLineId: "source-7",
        draftLineId: "reference-source-7",
        place: { kind: "join", groupId: "held-3" },
        source: {
          netAmount: "17.25",
          line: { unitPriceGross: "7.50" },
          extras: [{ id: "source-7-extra" }],
        },
      });
      expect(order.lines).toEqual([]);
      expect(order.party?.revision).toBe(4);
      expect(draft(el).sending).toBe(false);
      expect(draft(el).editsLocked).toBe(false);
    });

    it("edits the recalled note through New order and autosaves only the source reference", async () => {
      const { el, order } = await recallOpening({ updateOrderLine: vi.fn() });
      await openSentDish(order, "source-7");
      await openSentMore(order);
      await userEvent.click(
        order.shadowRoot!.querySelector<HTMLElement>("[data-sent-line-recall]")!,
      );
      await flush(el, 6);
      const line = draft(el).lines[0]!;
      const picker = await openDraftLine(order, 0);
      const note = picker
        .shadowRoot!.querySelector("wt-textarea")!
        .shadowRoot!.querySelector("textarea")!;
      expect(note.value).toBe("Recorded note");
      await userEvent.fill(note, "No onions");
      await picker.updateComplete;
      await userEvent.click(picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!);
      await expect.poll(() => api.saveDraft.mock.calls.length).toBe(1);
      await flush(el, 6);
      expect(api.saveDraft).toHaveBeenLastCalledWith(
        "v1",
        {
          billId: "wo-4",
          draftId: "draft-1",
          revision: 2,
          expectedEdit: { billId: "wo-4", editorVersion: 1, draftId: "draft-1", draftRevision: 2 },
          lines: [
            {
              id: "reference-source-7",
              sourceLineId: "source-7",
              quantity: "2",
              note: "No onions",
              courseId: null,
              makeAt: null,
              slot: 0,
              joinGroupId: "held-3",
              afterGroupId: null,
            },
          ],
          personId: "p1",
        },
        { signal: expect.any(AbortSignal) },
      );
      expect(api.updateOrderLine).not.toHaveBeenCalled();
      expect(api.takeOverDraft).not.toHaveBeenCalled();
      expect(draft(el).lines[0]).toBe(line);
      expect(line.note).toBe("No onions");
      expect(line.product.unitPrice).toBe("7.50");
      expect(line.source!.netAmount).toBe("17.25");
      expect(line.source!.extras[0]!.unitPriceGross).toBe("0.75");
      expect(order.revision).toBe(8);
      expect(banner(el)).toBeNull();
    });

    it("a refreshed takeover retires an unconfirmed recalled note without saving or taking back the bill", async () => {
      seedSource();
      const { el } = await mountApp({ updateOrderLine: vi.fn() });
      const order = await openMesa(el);
      const picker = await openDraftLine(order, 0);
      const note = picker
        .shadowRoot!.querySelector("wt-textarea")!
        .shadowRoot!.querySelector("textarea")!;
      await userEvent.fill(note, "Unconfirmed note");
      await picker.updateComplete;
      const oldConfirm = picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!;
      const saved = server.drafts[0]!;
      saved.ownerId = "p2";
      saved.ownerName = "Luis";
      saved.revision += 1;
      window.dispatchEvent(new Event("focus"));
      await flush(el, 6);
      expect(draft(el).editsLocked).toBe(true);
      expect(picker.isConnected).toBe(false);
      oldConfirm.click();
      await flush(el, 6);
      expect(server.drafts[0]!.lines[0]!.note).toBe("Recorded note");
      expect(draft(el).lines[0]!.note).toBe("Recorded note");
      expect(order.billEdit?.editorVersion).toBe(2);
      expect(api.saveDraft).not.toHaveBeenCalled();
      expect(api.updateOrderLine).not.toHaveBeenCalled();
      expect(api.takeOverDraft).not.toHaveBeenCalled();
    });

    it("saves preceding fresh edits before Recall and sends a repeated press only once", async () => {
      const { el, order } = await recallOpening();
      await tap(el, "Beer");
      let release!: () => void;
      api.saveDraft.mockImplementationOnce(async (partyId, ask) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return server.snapshot(server.save(partyId, ask));
      });
      emit(order, "recall-lines", { lineNos: [7] });
      emit(order, "recall-lines", { lineNos: [7] });
      await flush(el);
      expect(api.saveDraft).toHaveBeenCalledOnce();
      expect(api.recallToDraft).not.toHaveBeenCalled();
      expect(draft(el).sending).toBe(true);
      expect(order.groupCommandBusy).toBe(true);
      release();
      await flush(el, 6);
      expect(api.recallToDraft).toHaveBeenCalledOnce();
      expect(rows(el)).toEqual(["Beer ×1", "Recorded steak ×2"]);
      expect(api.saveDraft).toHaveBeenCalledOnce();
      expect(draft(el).sending).toBe(false);
    });

    it("retires Recall while its save waits across an API replacement", async () => {
      const { el, order } = await recallOpening();
      await tap(el, "Beer");
      const old = draft(el);
      let release!: () => void;
      let signal: AbortSignal | undefined;
      api.saveDraft.mockImplementationOnce(async (partyId, ask, options) => {
        signal = options?.signal;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return server.snapshot(server.save(partyId, ask));
      });
      emit(order, "recall-lines", { lineNos: [7] });
      await flush(el);
      expect(api.saveDraft).toHaveBeenCalledOnce();
      expect(old.sending).toBe(true);
      expect(api.recallToDraft).not.toHaveBeenCalled();
      const replacement = {
        ...api,
        recallToDraft: vi.fn(api.recallToDraft.getMockImplementation()!),
        listDrafts: vi.fn(server.listDrafts.getMockImplementation()!),
      };
      try {
        el.api = replacement as unknown as TillApi;
        await flush(el, 6);
      } finally {
        release();
      }
      await flush(el, 8);
      expect(api.recallToDraft).not.toHaveBeenCalled();
      expect(replacement.recallToDraft).not.toHaveBeenCalled();
      expect(api.recallLines).not.toHaveBeenCalled();
      expect(replacement.listDrafts).toHaveBeenCalled();
      expect(draft(el)).not.toBe(old);
      expect(signal?.aborted).toBe(true);
      expect(rows(el)).toEqual([]);
      expect(retainedCandidate(el)?.lines.map((line) => line.product.name)).toEqual(["Beer"]);
      expect(draft(el).editsLocked).toBe(true);
      expect(old.sending).toBe(false);
      expect(tableOrder(el)!.groupCommandBusy).toBe(false);
    });

    it("retains the fresh edit and does not Recall when its preceding save fails", async () => {
      const { el, order } = await recallOpening();
      await tap(el, "Beer");
      api.saveDraft.mockRejectedValue(new TypeError("offline"));
      emit(order, "recall-lines", { lineNos: [7] });
      await flush(el, 6);
      expect(api.saveDraft).toHaveBeenCalledOnce();
      expect(api.recallToDraft).not.toHaveBeenCalled();
      expect(api.recallLines).not.toHaveBeenCalled();
      expect(rows(el)).toEqual([]);
      expect(
        tableOrder(el)!.retainedDraft?.lines.map((line) => [line.product.name, line.quantity]),
      ).toEqual([["Beer", "1"]]);
      expect(draft(el).editsLocked).toBe(true);
      expect(banner(el)?.textContent).toContain(t("table.draft_save_failed"));
      expect(draft(el).sending).toBe(false);
    });
    it("retains this owner's fresh dishes and another owner's separate draft", async () => {
      const other = server.save("v1", {
        draftId: null,
        revision: 0,
        billId: "wo-check",
        lines: [],
      });
      other.ownerId = "p2";
      other.ownerName = "Luis";
      other.lines = [reference("luis-source", "8.63", "1")];
      const frozen = structuredClone(other);
      const { el, order } = await recallOpening();
      await tap(el, "Beer");
      emit(order, "recall-lines", { lineNos: [7] });
      await flush(el, 6);
      expect(rows(el)).toEqual(["Beer ×1", "Recorded steak ×2"]);
      expect(server.drafts.find((each) => each.ownerId === "p2")).toEqual(frozen);
      expect(order.otherDrafts).toEqual([]);
      expect(api.takeOverDraft).not.toHaveBeenCalled();
    });

    it("recalls onto the shown split bill without following the party's main bill", async () => {
      const { el, order } = await recallOpening({
        recallToDraft: vi.fn(async () => {
          const own = server.save("v1", {
            draftId: null,
            revision: 0,
            billId: "wo-check",
            lines: [],
          });
          own.lines.push(recalled());
          return { revision: 4, draft: structuredClone(own) };
        }),
      });
      await tap(el, "Beer");
      emit(order, "take-payment", { workingOrderId: "wo-check" });
      await flush(el, 6);
      emit(tableOrder(el)!, "recall-lines", { lineNos: [7] });
      await flush(el, 6);
      expect(tableOrder(el)?.orderId).toBe("wo-check");
      expect(rows(el)).toEqual(["Recorded steak ×2"]);
      expect(server.drafts.find((each) => each.billId === "wo-4")?.lines).toHaveLength(1);
      expect(server.drafts.find((each) => each.billId === "wo-check")?.lines[0]?.sourceLineId).toBe(
        "source-7",
      );
      expect(api.recallToDraft).toHaveBeenCalledOnce();
    });

    it("reads a lost Recall answer without sending it again or creating a second source", async () => {
      const { el, order } = await recallOpening({
        recallToDraft: vi.fn(async () => {
          recordRecall();
          throw new TypeError("answer lost");
        }),
      });
      emit(order, "recall-lines", { lineNos: [7] });
      await flush(el, 6);
      expect(rows(el)).toEqual(["Recorded steak ×2"]);
      expect(api.recallToDraft).toHaveBeenCalledOnce();
      expect(api.recallLines).not.toHaveBeenCalled();
      expect(draft(el).editsLocked).toBe(false);
      expect(banner(el)?.textContent).toContain(t("table.error"));
    });

    it.each(["ticket.already_started", "ticket.already_fired", "order.payment_in_flight"])(
      "reloads the bill and preserves the specific %s Recall refusal",
      async (code) => {
        const { el, order } = await recallOpening({
          recallToDraft: vi.fn().mockRejectedValue({ code }),
        });
        const reads = api.getTabLines.mock.calls.length;
        emit(order, "recall-lines", { lineNos: [7] });
        await flush(el, 6);
        expect(banner(el)?.textContent).toContain(codeMessage(code));
        expect(api.getTabLines.mock.calls.length).toBe(reads + 1);
        expect(rows(el)).toEqual([]);
        expect(draft(el).editsLocked).toBe(false);
      },
    );

    it("keeps a successful Recall locked after a failed draft read until reopening", async () => {
      const { el, order } = await recallOpening({
        recallToDraft: vi.fn(async () => {
          const result = { revision: 4, draft: recordRecall() };
          api.listDrafts.mockRejectedValueOnce(new TypeError("read offline"));
          return result;
        }),
      });
      emit(order, "recall-lines", { lineNos: [7] });
      await flush(el, 6);
      expect(banner(el)?.textContent).toContain(t("table.draft_read_failed"));
      expect(draft(el).editsLocked).toBe(true);
      expect(draft(el).sending).toBe(false);
      expect(order.party?.revision).toBe(4);
      emit(order, "recall-lines", { lineNos: [7] });
      await flush(el);
      expect(api.recallToDraft).toHaveBeenCalledOnce();
      await back(el);
      emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
      await flush(el, 6);
      expect(rows(el)).toEqual(["Recorded steak ×2"]);
      expect(draft(el).editsLocked).toBe(false);
    });

    it("ignores a late Recall refusal after opening another table and releases the command lock", async () => {
      let reject!: (reason: unknown) => void;
      let settled!: Promise<unknown>;
      const { el, order } = await recallOpening({
        recallToDraft: vi.fn(
          () =>
            (settled = new Promise((_resolve, no) => {
              reject = no;
            })),
        ),
      });
      emit(order, "recall-lines", { lineNos: [7] });
      await flush(el);
      await back(el);
      emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
      await flush(el, 6);
      const message = banner(el)?.textContent;
      reject({ code: "ticket.already_started" });
      await settled.catch(() => {});
      await flush(el, 6);
      expect(tableOrder(el)?.party?.id).toBe("v7");
      expect(rows(el)).toEqual([]);
      expect(banner(el)?.textContent).toBe(message);
      expect(tableOrder(el)?.groupCommandBusy).toBe(false);
    });

    it("aborts Recall on sign-out and does not install its late draft", async () => {
      let answer!: () => void;
      let signal: AbortSignal | undefined;
      const { el, order } = await recallOpening({
        recallToDraft: vi.fn(async (...args: Parameters<TillApi["recallToDraft"]>) => {
          signal = args[3]?.signal;
          await new Promise<void>((resolve) => {
            answer = resolve;
          });
          return { revision: 99, draft: recordRecall() };
        }),
      });
      emit(order, "recall-lines", { lineNos: [7] });
      await flush(el);
      try {
        emit(shell(el), "logout");
        await flush(el, 6);
        expect(signal?.aborted).toBe(true);
        expect(lock(el)).not.toBeNull();
      } finally {
        answer();
      }
      await flush(el, 6);
      expect(lock(el)).not.toBeNull();
      expect(tableOrder(el)?.party?.revision).not.toBe(99);
    });

    it("does not Recall an omitted, unknown, multiple or child line", async () => {
      const { el, order } = await recallOpening({
        getTabLines: vi.fn().mockResolvedValue({
          lines: [reference().source.line, reference().source.extras[0]],
          revision: 7,
          editSentLines: true,
        }),
      });
      for (const lineNos of [[], [99], [7, 8], [8]]) emit(order, "recall-lines", { lineNos });
      await flush(el, 6);
      expect(api.recallToDraft).not.toHaveBeenCalled();
      expect(api.recallLines).not.toHaveBeenCalled();
      expect(draft(el).sending).toBe(false);
    });

    it.each([true, false])(
      "waits for an in-flight kitchen note before Recall (saved: %s)",
      async (saved) => {
        let finish!: (value: unknown) => void;
        let refuse!: (error: unknown) => void;
        const { el, order } = await recallOpening({
          setKitchenNote: vi.fn(
            () =>
              new Promise((yes, no) => {
                finish = yes;
                refuse = no;
              }),
          ),
        });
        const editor =
          order.shadowRoot!.querySelector<HTMLElementTagNameMap["till-order-kitchen-note"]>(
            "till-order-kitchen-note",
          )!;
        emit(editor, "save-kitchen-note", {
          scopeKey: "party:v1",
          revision: 0,
          visit: editor.visit,
          note: "Together",
        });
        await flush(el);
        expect(api.setKitchenNote).toHaveBeenCalledOnce();
        emit(order, "recall-lines", { lineNos: [7] });
        await flush(el);
        try {
          expect(api.recallToDraft).not.toHaveBeenCalled();
        } finally {
          if (saved)
            finish({ scope: { partyId: "v1" }, revision: 1, ownerRevision: 4, note: "Together" });
          else refuse(new TypeError("offline note"));
        }
        await flush(el, 6);
        if (saved) {
          expect(api.recallToDraft).toHaveBeenCalledWith(
            "v1",
            "source-7",
            {
              expectedPartyRevision: 4,
              submissionId: expect.any(String),
              expectedEdit: {
                billId: "wo-4",
                editorVersion: 0,
                draftId: null,
                draftRevision: null,
              },
            },
            { signal: expect.any(AbortSignal) },
          );
          expect(rows(el)).toEqual(["Recorded steak ×2"]);
        } else {
          expect(api.recallToDraft).not.toHaveBeenCalled();
          expect(editor.refusal).not.toBe("");
        }
        expect(order.groupCommandBusy).toBe(false);
      },
    );

    it("labels an in-flight Recall as Recall and restores the sending label afterwards", async () => {
      let answer!: () => void;
      const { el, order } = await recallOpening({
        recallToDraft: vi.fn(async () => {
          await new Promise<void>((resolve) => {
            answer = resolve;
          });
          return { revision: 4, draft: recordRecall() };
        }),
      });
      const review = order.shadowRoot!.querySelector<HTMLElement>("[data-review-open]");
      if (review?.checkVisibility()) await userEvent.click(review);
      emit(order, "recall-lines", { lineNos: [7] });
      await flush(el);
      try {
        expect(order.shadowRoot!.querySelector("[data-round-sending]")?.textContent?.trim()).toBe(
          t("table.recall_line"),
        );
      } finally {
        answer();
      }
      await flush(el, 6);
      expect(draft(el).busyAction).toBeUndefined();
      draft(el).sending = true;
      order.requestUpdate();
      await order.updateComplete;
      expect(order.shadowRoot!.querySelector("[data-round-sending]")?.textContent?.trim()).toBe(
        t("table.round_sending"),
      );
      draft(el).sending = false;
    });
  });
});

describe("A773 Pay saves the bill's New order before payment", () => {
  function saveGate() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }
  const bills = () => [
    {
      workingOrderId: "wo-4",
      revision: 0,
      invoiceType: "F2",
      recipient: null,
      partyId: "v1",
      label: null,
      status: "open",
      total: "3.00",
      outstanding: "3.00",
      hasPayments: false,
      receiptAvailable: false,
    },
  ];
  const unsent = {
    code: "bill.unsent_dishes",
    status: 409,
    billId: "wo-4",
    owners: [
      { personId: "p1", name: "Ana", quantity: "1.000" },
      { personId: "p2", name: "Alex", quantity: "2.500" },
    ],
  };

  it.each([
    { status: "open", tender: { method: "cash", tendered: "3.00" }, method: "recordSale" },
    { status: "open", tender: { method: "card", externalRef: "manual-1" }, method: "recordSale" },
    { status: "placed", tender: { method: "cash", tendered: "3.00" }, method: "collectOrder" },
    {
      status: "placed",
      tender: { method: "card", externalRef: "manual-1" },
      method: "collectOrder",
    },
  ])(
    "flushes before $status $tender.method Pay and retains the bill and dishes on refusal",
    async ({ status, tender, method }) => {
      const pending = saveGate();
      const save = server.saveDraft.getMockImplementation()!;
      const getPartyBills = vi.fn().mockResolvedValue(bills());
      const { el } = await mountApp({
        getPartyBills,
        mergeBills: vi.fn().mockRejectedValue({ code: "working_order.not_open" }),
        saveDraft: vi.fn(async (...args: Parameters<typeof save>) => {
          await pending.promise;
          return save(...args);
        }),
        recordSale: vi.fn().mockRejectedValue(unsent),
        collectOrder: vi.fn().mockRejectedValue(unsent),
      });
      const order = await openMesa(el);
      await tap(el, "Beer");
      if (status === "placed") {
        await vi.waitFor(() => expect(api.saveDraft).toHaveBeenCalledOnce());
        getPartyBills.mockResolvedValue(bills().map((bill) => ({ ...bill, status })));
        emit(order, "merge-bills", { fromBillId: "wo-check" });
        await flush(el);
      }
      emit(order, "pay-tab", tender);
      await flush(el);
      try {
        expect(api.saveDraft).toHaveBeenCalledOnce();
        expect(api[method]).not.toHaveBeenCalled();
      } finally {
        pending.resolve();
      }
      await flush(el, 8);
      expect(savedLines()).toEqual(["offer-beer ×1"]);
      expect(api[method]).toHaveBeenCalledOnce();
      expect(rows(el)).toEqual(["Beer ×1"]);
      expect(tableOrder(el)!.orderId).toBe("wo-4");
      expect(el.shadowRoot!.querySelector("till-ticket-screen")).toBeNull();
      expect(banner(el)!.textContent?.trim()).toBe(
        "4 · Bill 1. Send or remove the unsent dishes before paying.",
      );
      expect(api.submitDraft).not.toHaveBeenCalled();
    },
  );

  it.each(["items", "contribution", "share", "rest"])(
    "flushes before opening %s payment",
    async (way) => {
      const pending = saveGate();
      const save = server.saveDraft.getMockImplementation()!;
      const { el } = await mountApp({
        getPartyBills: vi.fn().mockResolvedValue(bills()),
        saveDraft: vi.fn(async (...args: Parameters<typeof save>) => {
          await pending.promise;
          return save(...args);
        }),
      });
      const order = await openMesa(el);
      await tap(el, "Beer");
      emit(order, "bill-pay", { way, lines: [], amount: "3.00" });
      await flush(el);
      try {
        expect(api.saveDraft).toHaveBeenCalledOnce();
        expect(el.shadowRoot!.querySelector("till-bill-pay-dialog")).toBeNull();
      } finally {
        pending.resolve();
      }
      await flush(el, 8);
      expect(savedLines()).toEqual(["offer-beer ×1"]);
      expect(el.shadowRoot!.querySelector("till-bill-pay-dialog")).not.toBeNull();
      expect(tableOrder(el)!.orderId).toBe("wo-4");
    },
  );

  it.each(["pay-tab", "bill-pay"])(
    "sends no %s when the local draft cannot be saved",
    async (kind) => {
      const { el } = await mountApp({
        getPartyBills: vi.fn().mockResolvedValue(bills()),
        saveDraft: vi.fn().mockRejectedValue(new TypeError("offline")),
        recordSale: vi.fn().mockRejectedValue(unsent),
        collectOrder: vi.fn().mockRejectedValue(unsent),
      });
      const order = await openMesa(el);
      await tap(el, "Beer");
      emit(
        order,
        kind,
        kind === "pay-tab"
          ? { method: "cash", tendered: "3.00" }
          : { way: "contribution", lines: [], amount: "3.00" },
      );
      await flush(el, 8);
      expect(api.recordSale).not.toHaveBeenCalled();
      expect(api.collectOrder).not.toHaveBeenCalled();
      expect(el.shadowRoot!.querySelector("till-bill-pay-dialog")).toBeNull();
      expect(rows(el)).toEqual([]);
      expect(retainedCandidate(el)?.lines.map((line) => line.product.name)).toEqual(["Beer"]);
      expect(draft(el).editsLocked).toBe(true);
      expect(tableOrder(el)!.orderId).toBe("wo-4");
      expect(banner(el)!.textContent).toContain(t("table.draft_save_failed"));
    },
  );
  it.each(["pay-tab", "bill-pay"])(
    "abandons %s when the API changes while saving",
    async (kind) => {
      const pending = saveGate();
      const save = server.saveDraft.getMockImplementation()!;
      const recordSale = vi.fn().mockRejectedValue(unsent);
      const { el } = await mountApp({
        getPartyBills: vi.fn().mockResolvedValue(bills()),
        recordSale,
        saveDraft: vi.fn(async (...args: Parameters<typeof save>) => {
          await pending.promise;
          return save(...args);
        }),
      });
      const order = await openMesa(el);
      await tap(el, "Beer");
      emit(
        order,
        kind,
        kind === "pay-tab"
          ? { method: "cash", tendered: "3.00" }
          : { way: "contribution", lines: [], amount: "3.00" },
      );
      await flush(el);
      const replacement = {
        ...api,
        recordSale: vi.fn().mockRejectedValue(unsent),
        getBillBalance: vi.fn(api.getBillBalance),
      };
      el.api = replacement as unknown as TillApi;
      await flush(el);
      pending.resolve();
      await flush(el, 8);
      expect(recordSale).not.toHaveBeenCalled();
      expect(replacement.recordSale).not.toHaveBeenCalled();
      expect(replacement.getBillBalance).not.toHaveBeenCalled();
      expect(el.shadowRoot!.querySelector("till-bill-pay-dialog")).toBeNull();
      expect(rows(el)).toEqual([]);
      expect(
        tableOrder(el)!.shadowRoot!.querySelector("[data-draft-candidate]")?.textContent ?? "",
      ).toContain("Beer");
      expect(draft(el).editsLocked).toBe(true);
    },
  );

  it.each(["pay-tab", "bill-pay"])(
    "abandons %s after leaving the table during its save",
    async (kind) => {
      const pending = saveGate();
      const save = server.saveDraft.getMockImplementation()!;
      const { el } = await mountApp({
        getPartyBills: vi.fn().mockResolvedValue(bills()),
        recordSale: vi.fn().mockRejectedValue(unsent),
        saveDraft: vi.fn(async (...args: Parameters<typeof save>) => {
          await pending.promise;
          return save(...args);
        }),
      });
      const order = await openMesa(el);
      await tap(el, "Beer");
      emit(
        order,
        kind,
        kind === "pay-tab"
          ? { method: "cash", tendered: "3.00" }
          : { way: "contribution", lines: [], amount: "3.00" },
      );
      await flush(el);
      emit(shell(el), "screen-select", { screen: "counter" });
      await flush(el);
      pending.resolve();
      await flush(el, 8);
      expect(api.recordSale).not.toHaveBeenCalled();
      expect(el.shadowRoot!.querySelector("till-bill-pay-dialog")).toBeNull();
      expect(savedLines()).toEqual(["offer-beer ×1"]);
    },
  );
  it("flushes local dishes before Find a bill collects, without sending them", async () => {
    const pending = saveGate();
    const save = server.saveDraft.getMockImplementation()!;
    const { el } = await mountApp({
      collectOrder: vi.fn().mockRejectedValue(unsent),
      saveDraft: vi.fn(async (...args: Parameters<typeof save>) => {
        await pending.promise;
        return save(...args);
      }),
    });
    await openMesa(el);
    await tap(el, "Beer");
    emit(shell(el), "find-bill-pay", {
      workingOrderId: "wo-4",
      tender: { method: "cash", amount: "3.00" },
      invoiced: false,
    });
    await flush(el);
    try {
      expect(api.saveDraft).toHaveBeenCalledOnce();
      expect(api.collectOrder).not.toHaveBeenCalled();
    } finally {
      pending.resolve();
    }
    await flush(el, 8);
    expect(savedLines()).toEqual(["offer-beer ×1"]);
    expect(api.collectOrder).toHaveBeenCalledOnce();
    expect(api.submitDraft).not.toHaveBeenCalled();
  });

  it("keeps an actionable Pay refusal if owner details are unavailable", async () => {
    const { el } = await mountApp({
      getPartyBills: vi.fn().mockResolvedValue(bills()),
      recordSale: vi
        .fn()
        .mockRejectedValue({ code: "bill.unsent_dishes", billId: "wo-4", owners: [] }),
    });
    const order = await openMesa(el);
    emit(order, "pay-tab", { method: "cash", tendered: "3.00" });
    await flush(el, 6);
    expect(banner(el)!.textContent).toContain("Send or remove the unsent dishes before paying.");
    expect(tableOrder(el)!.orderId).toBe("wo-4");
  });

  it("opens a bill payment without saving the draft while a part payment on the bill is out", async () => {
    const takeBillPayment = vi.fn(() => new Promise<never>(() => {}));
    const { el } = await mountApp({
      getPartyBills: vi.fn().mockResolvedValue(bills()),
      previewBillPayment: vi.fn().mockResolvedValue({
        kind: "allocated",
        choice: null,
        applied: "3.00",
        tip: "0.00",
        change: "0.00",
        charged: null,
      }),
      takeBillPayment,
    });
    const order = await openMesa(el);
    const payDialog = () => el.shadowRoot!.querySelector<HTMLElement>("till-bill-pay-dialog");
    const inPay = (selector: string) =>
      payDialog()!.shadowRoot!.querySelector<HTMLElement>(selector);
    emit(order, "bill-pay", { way: "contribution", lines: [], amount: "3.00" });
    await flush(el, 8);
    const reference = inPay('wt-input[name="externalRef"]')!.shadowRoot!.querySelector("input")!;
    reference.value = "manual-1";
    reference.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await flush(el);
    inPay("[data-pay-continue]")!.click();
    await flush(el, 8);
    inPay("[data-pay-confirm]")!.click();
    await flush(el);
    expect(takeBillPayment).toHaveBeenCalledOnce();
    emit(payDialog()!, "bill-pay-close");
    await flush(el);
    await tap(el, "Beer");
    const saves = api.saveDraft.mock.calls.length;

    emit(tableOrder(el)!, "bill-pay", { way: "contribution", lines: [], amount: "3.00" });
    await flush(el, 8);

    expect(api.saveDraft).toHaveBeenCalledTimes(saves);
    expect(payDialog()).not.toBeNull();
    expect((payDialog() as HTMLElement & { busy: boolean }).busy).toBe(true);
    expect(takeBillPayment).toHaveBeenCalledOnce();
  });
});

describe("A773 non-open bill draft restrictions", () => {
  const bill = (status: "open" | "placed" | "settled" | "abandoned") => ({
    workingOrderId: "wo-4",
    revision: 0,
    invoiceType: "F2",
    recipient: null,
    partyId: "v1",
    label: null,
    status,
    total: "3.00",
    outstanding: "3.00",
    hasPayments: false,
    receiptAvailable: status !== "open",
  });

  it.each(["placed", "settled", "abandoned"] as const)(
    "opening a %s bill keeps its Sent reads but accepts no fresh dishes",
    async (status) => {
      const { el } = await mountApp({ getPartyBills: vi.fn().mockResolvedValue([bill(status)]) });
      const order = await openMesa(el);
      await tap(el, "Beer");
      expect(rows(el)).toEqual([]);
      expect(browser(el)!.inert).toBe(true);
      expect(order.orderId).toBe("wo-4");
      expect(order.bills[0]!.status).toBe(status);
      expect(api.getTabLines).toHaveBeenCalledWith("wo-4");
      expect(server.saveDraft).not.toHaveBeenCalled();
    },
  );

  it("a refreshed presented bill freezes unsaved dishes and a failed later read cannot unlock it", async () => {
    const getPartyBills = vi.fn().mockResolvedValue([bill("open")]);
    const { el } = await mountApp({
      getPartyBills,
      mergeBills: vi.fn().mockRejectedValue({ code: "working_order.not_open" }),
      markServed: vi.fn().mockResolvedValue({ revision: 4 }),
    });
    await openMesa(el);
    await tap(el, "Beer");
    getPartyBills.mockResolvedValue([bill("placed")]);
    emit(tableOrder(el)!, "merge-bills", { fromBillId: "wo-check" });
    await flush(el);
    expect(tableOrder(el)!.bills[0]!.status).toBe("placed");
    await tap(el, "Steak");
    expect(rows(el)).toEqual(["Beer ×1"]);
    const count = server.saveDraft.mock.calls.length;
    getPartyBills.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    emit(tableOrder(el)!, "merge-bills", { fromBillId: "wo-check" });
    await flush(el);
    expect(tableOrder(el)!.bills).toEqual([]);
    emit(tableOrder(el)!, "serve-lines", { items: [{ lineId: "sent-line", quantity: "1" }] });
    await flush(el);
    expect(api.markServed).toHaveBeenCalledOnce();
    await tap(el, "Flan");
    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(server.saveDraft).toHaveBeenCalledTimes(count);
    expect(draft(el).editsLocked).toBe(true);
  });
});

describe("A773 known bill draft switch restrictions", () => {
  it("switching to a known paid bill cannot open an editable draft", async () => {
    const bills = ["wo-4", "wo-check"].map((id) => ({
      workingOrderId: id,
      revision: 0,
      invoiceType: "F2",
      recipient: null,
      partyId: "v1",
      label: null,
      status: id === "wo-4" ? "open" : "settled",
      total: "3.00",
      outstanding: id === "wo-4" ? "3.00" : "0.00",
      hasPayments: false,
      receiptAvailable: id !== "wo-4",
    }));
    const { el } = await mountApp({ getPartyBills: vi.fn().mockResolvedValue(bills) });
    const order = await openMesa(el);
    emit(order, "take-payment", { workingOrderId: "wo-check" });
    await flush(el);
    expect(tableOrder(el)!.orderId).toBe("wo-check");
    await tap(el, "Beer");
    expect(rows(el)).toEqual([]);
    expect(browser(el)!.inert).toBe(true);
    expect(server.saveDraft).not.toHaveBeenCalled();
  });
});

describe("A773 retained bill candidates in the app", () => {
  const candidate = (el: TillApp) =>
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>("[data-draft-candidate]");
  async function loseSave(el: TillApp): Promise<void> {
    await tap(el, "Beer");
    api.saveDraft.mockRejectedValueOnce(new TypeError("lost save reply"));
    emit(tableOrder(el)!, "take-payment", { workingOrderId: "wo-check" });
    await flush(el, 6);
  }
  async function reopen(el: TillApp, personId: string, name: string): Promise<void> {
    await signIn(el, personId, name);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el, 6);
  }

  it("keeps a failed save separate from the saved order without an automatic retry", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await loseSave(el);
    expect(rows(el)).toEqual([]);
    expect(candidate(el)?.textContent ?? "").toContain("Beer");
    expect(candidate(el)!.querySelector("[data-draft-select]")).toBeNull();
    expect(draft(el).editsLocked).toBe(true);
    await tap(el, "Steak");
    expect(rows(el)).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 20));
    expect(api.saveDraft).toHaveBeenCalledOnce();
    expect(api.submitDraft).not.toHaveBeenCalled();
  });

  it("retains the same person's candidate across sign-out and hides it from another person", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await loseSave(el);
    emit(tableOrder(el)!, "logout");
    await flush(el, 6);
    await reopen(el, "p2", "Luis");
    expect(candidate(el)).toBeNull();
    expect(rows(el)).toEqual([]);
    emit(tableOrder(el)!, "logout");
    await flush(el, 6);
    await reopen(el, "p1", "Ana");
    expect(candidate(el)?.textContent ?? "").toContain("Beer");
    expect(rows(el)).toEqual([]);
    expect(api.saveDraft).toHaveBeenCalledOnce();
  });

  it("signs the order's person out on this screen, keeps their lines, and leaves the device's session alone, when a live order's save is refused for them", async () => {
    const { el } = await mountApp({
      saveDraft: vi.fn().mockRejectedValue({ code: "draft.person_not_signed_in", status: 409 }),
    });
    await openMesa(el);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const settleTimers = async (ms: number) => {
        await vi.advanceTimersByTimeAsync(ms);
        for (let i = 0; i < 3; i++) {
          await vi.advanceTimersByTimeAsync(0);
          await el.updateComplete;
        }
      };
      // Replacing the API re-arms the 15 s bill refresh under the fake clock.
      el.api = { ...api } as unknown as TillApi;
      await settleTimers(0);
      press(el, "Beer");
      await settleTimers(DRAFT_SAVE_DELAY_MS);
      expect(lock(el)).not.toBeNull();
      expect(banner(el)).toBeNull();
      expect(api.logout).not.toHaveBeenCalled();
      expect(api.saveDraft).toHaveBeenCalledOnce();
      await settleTimers(20_000);
      expect(api.saveDraft).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
    await reopen(el, "p2", "Luis");
    expect(retainedCandidate(el)).toBeNull();
    expect(rows(el)).toEqual([]);
    emit(tableOrder(el)!, "logout");
    await flush(el, 6);
    await reopen(el, "p1", "Ana");
    expect(retainedCandidate(el)?.lines.map((line) => line.product.name)).toEqual(["Beer"]);
  });

  it("still signs the order's person out on this screen when the bill changed elsewhere while their refused save was out", async () => {
    let reject!: (error: unknown) => void;
    const { el } = await mountApp({
      saveDraft: vi.fn(() => new Promise<never>((_resolve, fail) => (reject = fail))),
    });
    await openMesa(el);
    await tap(el, "Beer");
    await vi.waitFor(() => expect(api.saveDraft).toHaveBeenCalledOnce());
    const reads = api.listDrafts.mock.calls.length;
    server.personId = "p2";
    server.personName = "Luis";
    const sent = api.saveDraft.mock.calls[0]![1];
    server.save("v1", {
      ...sent,
      draftId: null,
      revision: 0,
      lines: [{ ...sent.lines[0], menuItemId: "offer-steak" }],
    });
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(api.listDrafts.mock.calls.length).toBeGreaterThan(reads));
    await flush(el, 6);

    reject({ code: "draft.person_not_signed_in", status: 409 });
    await flush(el, 6);

    expect(lock(el)).not.toBeNull();
    expect(api.logout).not.toHaveBeenCalled();
    await reopen(el, "p2", "Luis");
    expect(retainedCandidate(el)).toBeNull();
    expect(rows(el)).toEqual(["Steak ×1"]);
    emit(tableOrder(el)!, "logout");
    await flush(el, 6);
    await reopen(el, "p1", "Ana");
    expect(retainedCandidate(el)?.lines.map((line) => line.product.name)).toEqual(["Beer"]);
  });

  it("names the signed-in person in each save, and the next person in theirs", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 20));
    await flush(el);
    expect(api.saveDraft.mock.calls.at(-1)![1].personId).toBe("p1");
    emit(tableOrder(el)!, "logout");
    await flush(el, 6);
    await signIn(el, "p2", "Luis");
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
    await flush(el, 6);
    await tap(el, "Steak");
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 20));
    await flush(el);
    expect(api.saveDraft.mock.calls.at(-1)![1].personId).toBe("p2");
  });

  it.each([
    "idle callback",
    "expired-session save refusal",
    "save refused for another signed-in person",
  ] as const)(
    "retains the complete local candidate after %s without exposing it to the next person",
    async (ending) => {
      const activity = {
        configure: vi.fn(),
        noteInteraction: vi.fn(),
        reacquire: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      const { el } = await mountApp({}, activity as never);
      await openMesa(el);
      await tap(el, "Beer");
      await tap(el, "Steak");
      draft(el).setLineExtras(1, { note: "No salt" });
      const local = structuredClone([...draft(el).lines]);
      if (ending === "expired-session save refusal") {
        api.saveDraft.mockRejectedValueOnce({ code: "session.required", status: 401 });
        await back(el);
        expect(api.saveDraft).toHaveBeenCalledOnce();
      }
      if (ending === "save refused for another signed-in person") {
        api.saveDraft.mockRejectedValueOnce({ code: "draft.person_not_signed_in", status: 409 });
        await back(el);
        expect(api.saveDraft).toHaveBeenCalledOnce();
        expect(lock(el)).not.toBeNull();
        expect(api.logout).not.toHaveBeenCalled();
      }
      (activity.configure.mock.calls.at(-1)![0] as { onIdle: () => void }).onIdle();
      await flush(el, 6);
      expect(lock(el)).not.toBeNull();
      expect(server.drafts).toEqual([]);
      const saves = api.saveDraft.mock.calls.length;
      await reopen(el, "p2", "Luis");
      expect(retainedCandidate(el)).toBeNull();
      expect(rows(el)).toEqual([]);
      emit(tableOrder(el)!, "logout");
      await flush(el, 6);
      await reopen(el, "p1", "Ana");
      expect(retainedCandidate(el)).toMatchObject({
        personId: "p1",
        partyId: "v1",
        billId: "wo-4",
        base: { billId: "wo-4", editorVersion: 0, draftId: null, draftRevision: null },
      });
      expect(retainedCandidate(el)?.lines).toEqual(local);
      expect(
        retainedCandidate(el)?.lines.map((line) => [line.product.name, line.quantity, line.note]),
      ).toEqual([
        ["Beer", "1", undefined],
        ["Steak", "1", "No salt"],
      ]);
      expect(rows(el)).toEqual([]);
      expect(draft(el).editsLocked).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 20));
      expect(api.saveDraft.mock.calls.length).toBe(saves);
      expect(api.submitDraft).not.toHaveBeenCalled();
      expect(server.drafts).toEqual([]);
    },
  );

  it("retains edits made after an unanswered save and keeps its late answer out of the candidate", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    const answer = holdNextSave();
    try {
      await tap(el, "Beer");
      await expect.poll(() => api.saveDraft.mock.calls.length).toBe(1);
      await tap(el, "Beer");
      await tap(el, "Steak");
      draft(el).setLineExtras(1, { note: "No salt" });
      const local = structuredClone([...draft(el).lines]);
      expect(local.map((line) => [line.product.name, line.quantity, line.note])).toEqual([
        ["Beer", "2", undefined],
        ["Steak", "1", "No salt"],
      ]);
      emit(tableOrder(el)!, "logout");
      await flush(el, 6);
      expect(lock(el)).not.toBeNull();
      await signIn(el, "p2", "Luis");
      answer();
      await flush(el, 8);
      emit(shell(el), "screen-select", { screen: "floor" });
      await flush(el);
      emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
      await flush(el, 6);
      expect(retainedCandidate(el)).toBeNull();
      expect(rows(el)).toEqual(["Beer ×1"]);
      emit(tableOrder(el)!, "logout");
      await flush(el, 6);
      await reopen(el, "p1", "Ana");
      expect(retainedCandidate(el)?.lines).toEqual(local);
      expect(retainedCandidate(el)).toMatchObject({
        personId: "p1",
        partyId: "v1",
        billId: "wo-4",
        base: { billId: "wo-4", editorVersion: 0, draftId: null, draftRevision: null },
      });
      expect(rows(el)).toEqual(["Beer ×1"]);
      expect(draft(el).editsLocked).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 20));
      expect(api.saveDraft).toHaveBeenCalledOnce();
      expect(api.submitDraft).not.toHaveBeenCalled();
      expect(
        server.drafts.map((saved) => [
          saved.ownerId,
          saved.lines.map((line) => [line.menuItemId, line.quantity]),
        ]),
      ).toEqual([["p1", [["offer-beer", "1"]]]]);
    } finally {
      answer();
    }
  });

  it("finds the bill's candidate after relocation without applying its old party or expectation", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await loseSave(el);
    emit(tableOrder(el)!, "logout");
    await flush(el, 6);
    api.getTablesState.mockResolvedValue([
      table("t4", "4", party({ id: "joined", mainBillId: "wo-4" })),
      mesa7,
    ]);
    await reopen(el, "p1", "Ana");
    expect(candidate(el)?.textContent ?? "").toContain("Beer");
    expect(rows(el)).toEqual([]);
    const saves = api.saveDraft.mock.calls.length;
    expect(candidate(el)).not.toBeNull();
    candidate(el)!.querySelector<HTMLElement>("[data-candidate-apply]")!.click();
    await flush(el, 6);
    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(candidate(el)).toBeNull();
    expect(api.saveDraft.mock.calls.length).toBe(saves);
    await back(el);
    expect(api.saveDraft.mock.calls.at(-1)![0]).toBe("joined");
    expect(api.saveDraft.mock.calls.at(-1)![1].expectedEdit).toEqual({
      billId: "wo-4",
      editorVersion: 0,
      draftId: null,
      draftRevision: null,
    });
  });

  it("requires an authoritative read before applying a reviewed candidate", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await loseSave(el);
    api.listDrafts.mockRejectedValueOnce(new TypeError("offline"));
    expect(candidate(el)).not.toBeNull();
    candidate(el)!.querySelector<HTMLElement>("[data-candidate-apply]")!.click();
    await flush(el, 6);
    expect(rows(el)).toEqual([]);
    expect(candidate(el)?.textContent ?? "").toContain("Beer");
    expect(draft(el).editsLocked).toBe(true);
    expect(api.saveDraft).toHaveBeenCalledOnce();
  });

  it("keeps writes frozen after discarding a candidate whose recovery read failed", async () => {
    const size = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(1280, 900);
    try {
      const { el } = await mountApp();
      await openMesa(el);
      await tap(el, "Beer");
      api.saveDraft.mockRejectedValueOnce({ code: "draft.out_of_date", status: 409 });
      const readDrafts = api.listDrafts.getMockImplementation()!;
      api.listDrafts.mockRejectedValue(new TypeError("Offline"));
      emit(tableOrder(el)!, "take-payment", { workingOrderId: "wo-4" });
      await flush(el, 6);
      expect(candidate(el)?.textContent ?? "").toContain("Beer");
      await resized(tableOrder(el)!);
      await userEvent.click(candidate(el)!.querySelector<HTMLElement>("[data-candidate-discard]")!);
      await flush(el, 6);
      expect(candidate(el)).toBeNull();
      expect(draft(el).editsLocked).toBe(true);
      expect(rows(el)).toEqual([]);
      await tap(el, "Steak");
      expect(rows(el)).toEqual([]);
      expect(api.saveDraft).toHaveBeenCalledOnce();

      api.listDrafts.mockImplementation(readDrafts);
      window.dispatchEvent(new Event("focus"));
      await flush(el, 6);
      expect(draft(el).editsLocked).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 20));
      expect(rows(el)).toEqual([]);
      expect(api.saveDraft).toHaveBeenCalledOnce();
      expect(api.submitDraft).not.toHaveBeenCalled();
      expect(server.drafts).toEqual([]);
      await tap(el, "Steak");
      expect(rows(el)).toEqual(["Steak ×1"]);
    } finally {
      await page.viewport(size.width, size.height);
    }
  });

  it("discards only the local candidate without writing or sending the saved order", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await loseSave(el);
    expect(candidate(el)).not.toBeNull();
    candidate(el)!.querySelector<HTMLElement>("[data-candidate-discard]")!.click();
    await flush(el, 6);
    expect(candidate(el)).toBeNull();
    expect(rows(el)).toEqual([]);
    expect(draft(el).editsLocked).toBe(false);
    expect(api.saveDraft).toHaveBeenCalledOnce();
    expect(api.submitDraft).not.toHaveBeenCalled();
    await tap(el, "Steak");
    expect(rows(el)).toEqual(["Steak ×1"]);
  });
  it("refreshes the visible bill on focus and separates a rival takeover from local edits", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    await back(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el, 6);
    await tap(el, "Steak");
    const saved = server.drafts[0]!;
    server.personId = "p2";
    server.personName = "Luis";
    server.takeOver("v1", saved.id, saved.revision);
    server.personId = "p1";
    server.personName = "Ana";
    const reads = api.listDrafts.mock.calls.length;
    window.dispatchEvent(new Event("focus"));
    await flush(el, 6);
    expect(api.listDrafts.mock.calls.length).toBe(reads + 1);
    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(draft(el).editsLocked).toBe(true);
    expect(candidate(el)?.textContent ?? "").toContain("Steak");
    expect(banner(el)?.textContent ?? "").toContain("Luis");
    expect(candidate(el)!.querySelector("[data-candidate-apply]")!.hasAttribute("disabled")).toBe(
      true,
    );
    expect(tableOrder(el)!.shadowRoot!.querySelectorAll("[data-draft-select]")).toHaveLength(0);
    await flush(el);
    expect(tableOrder(el)!.shadowRoot!.querySelectorAll("[data-draft-select]")).toHaveLength(0);
    expect(api.saveDraft).toHaveBeenCalledOnce();
  });

  it("refreshes every fifteen seconds and keeps confirmed authority after a failed periodic read", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      el.api = { ...api } as unknown as TillApi;
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;
      const reads = api.listDrafts.mock.calls.length;
      api.listDrafts.mockRejectedValueOnce(new TypeError("offline"));
      await vi.advanceTimersByTimeAsync(15_000);
      await el.updateComplete;
      expect(api.listDrafts.mock.calls.length).toBe(reads + 1);
      expect(draft(el).editsLocked).toBe(false);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(api.listDrafts.mock.calls.length).toBe(reads + 2);
      expect(api.saveDraft).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
    await back(el);
    const reads = api.listDrafts.mock.calls.length;
    window.dispatchEvent(new Event("focus"));
    await flush(el);
    expect(api.listDrafts.mock.calls.length).toBe(reads);
  });

  it("retains unsaved work when the API is replaced and ignores the old save reply", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    let answer!: () => void;
    api.saveDraft.mockImplementationOnce(async (partyId, save) => {
      await new Promise<void>((resolve) => (answer = resolve));
      return server.snapshot(server.save(partyId, save));
    });
    await tap(el, "Beer");
    emit(tableOrder(el)!, "take-payment", { workingOrderId: "wo-check" });
    await flush(el);
    const read = vi.fn(server.listDrafts.getMockImplementation()!);
    el.api = { ...api, listDrafts: read } as unknown as TillApi;
    await flush(el, 6);
    expect(read).toHaveBeenCalled();
    expect(candidate(el)?.textContent ?? "").toContain("Beer");
    expect(rows(el)).toEqual([]);
    answer();
    await flush(el, 6);
    expect(tableOrder(el)!.orderId).toBe("wo-4");
    expect(rows(el)).toEqual([]);
    expect(candidate(el)?.textContent ?? "").toContain("Beer");
  });

  it("protects retained candidates from browser unload until they are explicitly resolved", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await loseSave(el);
    const before = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
    expect(candidate(el)).not.toBeNull();
    candidate(el)!.querySelector<HTMLElement>("[data-candidate-discard]")!.click();
    await flush(el);
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("keeps the candidate when the saved bill changes during explicit review", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await loseSave(el);
    const originalRead = server.listDrafts.getMockImplementation()!;
    api.listDrafts.mockImplementationOnce(async (partyId) => {
      server.personId = "p1";
      server.personName = "Ana";
      server.save(partyId, {
        ...api.saveDraft.mock.calls[0]![1],
        lines: [{ ...api.saveDraft.mock.calls[0]![1].lines[0], menuItemId: "offer-flan" }],
      });
      server.personId = "p1";
      server.personName = "Ana";
      return originalRead(partyId);
    });
    expect(candidate(el)).not.toBeNull();
    candidate(el)!.querySelector<HTMLElement>("[data-candidate-apply]")!.click();
    await flush(el, 6);
    expect(rows(el)).toEqual(["Flan ×1"]);
    expect(candidate(el)?.textContent ?? "").toContain("Beer");
    expect(draft(el).editsLocked).toBe(true);
    expect(api.saveDraft).toHaveBeenCalledOnce();
  });

  for (const locale of ["en", "es"] as const)
    for (const theme of ["light", "dark"] as const)
      for (const width of [390, 1280])
        it(`retained candidate native review and discard ${locale} ${theme} ${width}`, async () => {
          const size = { width: window.innerWidth, height: window.innerHeight };
          await page.viewport(width, 900);
          try {
            const { el, host } = await mountApp({}, undefined, theme);
            await openMesa(el);
            await loseSave(el);
            setLocale(locale);
            await flush(el, 6);
            const screen = tableOrder(el)!;
            await resized(screen);
            const review = screen.shadowRoot!.querySelector<HTMLElement>("[data-review-open]");
            if (width === 390) {
              expect(review).not.toBeNull();
              await userEvent.click(review!);
              await flush(el);
            }
            const panel = candidate(el)!;
            expect(panel.getBoundingClientRect().width).toBeGreaterThan(0);
            expect(panel.textContent).toContain(t("unsaved.message"));
            expect(panel.textContent).toContain("Beer");
            await commands.parkPointer();
            await expectNoA11yViolations(host);
            await page.screenshot({
              path: `__screenshots__/a773-candidate-look/${locale}-${theme}-${width}.png`,
            });
            await userEvent.click(panel.querySelector<HTMLElement>("[data-candidate-discard]")!);
            await flush(el, 6);
            expect(candidate(el)).toBeNull();
            expect(rows(el)).toEqual([]);
            expect(api.saveDraft).toHaveBeenCalledOnce();
          } finally {
            setLocale("en");
            await page.viewport(size.width, size.height);
          }
        });
  it("keeps a pending reviewed candidate after leaving its table", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await loseSave(el);
    const read = server.listDrafts.getMockImplementation()!;
    let answer!: () => void;
    api.listDrafts.mockImplementationOnce(async (partyId) => {
      const observed = await read(partyId);
      await new Promise<void>((resolve) => (answer = resolve));
      return observed;
    });
    expect(candidate(el)).not.toBeNull();
    candidate(el)!.querySelector<HTMLElement>("[data-candidate-apply]")!.click();
    await flush(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    expect(tableOrder(el)).toBeNull();
    answer();
    await flush(el, 6);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el, 6);
    expect(rows(el)).toEqual([]);
    expect(candidate(el)?.textContent ?? "").toContain("Beer");
    expect(api.saveDraft).toHaveBeenCalledOnce();
  });
  it("starts another bill's candidate review while an old bill's read is still pending", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await loseSave(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
    await flush(el, 6);
    await tap(el, "Steak");
    api.saveDraft.mockRejectedValueOnce(new TypeError("lost second save"));
    emit(tableOrder(el)!, "take-payment", { workingOrderId: "wo-check" });
    await flush(el, 6);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el, 6);
    const read = server.listDrafts.getMockImplementation()!;
    let answer!: () => void;
    api.listDrafts.mockImplementationOnce(async (partyId) => {
      const observed = await read(partyId);
      await new Promise<void>((resolve) => (answer = resolve));
      return observed;
    });
    expect(candidate(el)).not.toBeNull();
    candidate(el)!.querySelector<HTMLElement>("[data-candidate-apply]")!.click();
    await flush(el);
    try {
      emit(shell(el), "screen-select", { screen: "floor" });
      await flush(el);
      emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
      await flush(el, 6);
      const apply = candidate(el)!.querySelector<HTMLElement>("[data-candidate-apply]")!;
      expect(apply.hasAttribute("disabled")).toBe(false);
      apply.click();
      await flush(el, 6);
      expect(rows(el)).toEqual(["Steak ×1"]);
      expect(candidate(el)).toBeNull();
      expect(api.saveDraft).toHaveBeenCalledTimes(2);
    } finally {
      answer();
      await flush(el, 6);
    }
  });
});

describe("direct line editing authority", () => {
  const observation = () => {
    const { billId, editorVersion, draftId, draftRevision } = server.edit("wo-4");
    return { billId, editorVersion, draftId, draftRevision };
  };
  const change = () => ({
    lineNo: 1,
    lineName: "Beer",
    patch: { quantity: "2" },
    revision: 0,
    expectedEdit: observation(),
  });

  it("carries the shown observation in the line change", async () => {
    const updateOrderLine = vi
      .fn()
      .mockResolvedValue({ revision: 1, party: { id: "v1", revision: 4 } });
    const { el } = await mountApp({ updateOrderLine });
    const order = await openMesa(el);
    const ask = change();
    emit(order, "change-line", ask);
    await flush(el);
    expect(updateOrderLine).toHaveBeenCalledExactlyOnceWith(
      "wo-4",
      1,
      { quantity: "2" },
      0,
      ask.expectedEdit,
    );
  });

  it("refreshes committed line facts after its own autosave without restoring the older bill observation", async () => {
    let answer!: (value: unknown) => void;
    const updateOrderLine = vi.fn(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const { el } = await mountApp({ updateOrderLine });
    const order = await openMesa(el);
    emit(order, "change-line", change());
    await flush(el);
    await tap(el, "Beer");
    await vi.waitFor(() => expect(tableOrder(el)!.billEdit?.editorVersion).toBe(1));
    const saved = tableOrder(el)!.billEdit;
    const reads = api.getTabLines.mock.calls.length;
    api.getTabLines.mockResolvedValue({ lines: [], revision: 5, editSentLines: true });
    answer({ revision: 2, party: { id: "v1", revision: 4 } });
    await flush(el, 6);
    expect(api.getTabLines).toHaveBeenCalledTimes(reads + 1);
    expect(tableOrder(el)!.revision).toBe(5);
    expect(tableOrder(el)!.billEdit).toEqual(saved);
    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(api.saveDraft).toHaveBeenCalledOnce();
    expect(api.takeOverDraft).not.toHaveBeenCalled();
  });

  it.each(["missing", "wrong bill", "old version", "old draft", "old draft revision"])(
    "sends nothing for a %s editing observation",
    async (kind) => {
      const updateOrderLine = vi.fn().mockResolvedValue({ revision: 1, party: null });
      const { el } = await mountApp({ updateOrderLine });
      const order = await openMesa(el);
      const ask = change();
      const expectedEdit =
        kind === "missing"
          ? undefined
          : {
              ...ask.expectedEdit,
              ...(kind === "wrong bill" ? { billId: "wo-7" } : {}),
              ...(kind === "old version" ? { editorVersion: 7 } : {}),
              ...(kind === "old draft" ? { draftId: "old-draft" } : {}),
              ...(kind === "old draft revision" ? { draftRevision: 7 } : {}),
            };
      emit(order, "change-line", { ...ask, expectedEdit });
      await flush(el);
      expect(updateOrderLine).not.toHaveBeenCalled();
      expect(banner(el)?.textContent).toContain(codeMessage("draft.out_of_date"));
      expect(api.saveDraft).not.toHaveBeenCalled();
      expect(api.takeOverDraft).not.toHaveBeenCalled();
    },
  );

  it.each(["success", "refusal"])(
    "keeps a newer editor observation after a late line-edit %s",
    async (outcome) => {
      let answer!: (value: unknown) => void;
      let refuse!: (error: unknown) => void;
      const updateOrderLine = vi.fn(
        () =>
          new Promise((resolve, reject) => {
            answer = resolve;
            refuse = reject;
          }),
      );
      const { el } = await mountApp({ updateOrderLine });
      const order = await openMesa(el);
      emit(order, "change-line", change());
      await flush(el);
      const refreshed = await server.listDrafts("v1");
      api.listDrafts.mockResolvedValue({
        ...refreshed,
        billEdits: refreshed.billEdits.map((edit) =>
          edit.billId === "wo-4" ? { ...edit, editorVersion: edit.editorVersion + 2 } : edit,
        ),
      });
      window.dispatchEvent(new Event("focus"));
      await flush(el, 6);
      const reads = api.getTabLines.mock.calls.length;
      if (outcome === "success") answer({ revision: 23, party: { id: "v1", revision: 23 } });
      else refuse({ code: "ticket.already_started" });
      await flush(el, 6);
      expect(updateOrderLine).toHaveBeenCalledOnce();
      expect(api.getTabLines).toHaveBeenCalledTimes(reads);
      expect(tableOrder(el)!.revision).not.toBe(23);
      expect(tableOrder(el)!.billEdit?.editorVersion).toBe(2);
      expect(tableOrder(el)!.cancelOffer).toBeNull();
      expect(banner(el)?.textContent ?? "").not.toContain(codeMessage("ticket.already_started"));
    },
  );

  it.each(["success", "refusal"])("ignores an old API's late line-edit %s", async (outcome) => {
    let answer!: (value: { revision: number; party: { id: string; revision: number } }) => void;
    let refuse!: (error: unknown) => void;
    const updateOrderLine = vi.fn(
      () =>
        new Promise((resolve, reject) => {
          answer = resolve;
          refuse = reject;
        }),
    );
    const { el } = await mountApp({ updateOrderLine });
    const order = await openMesa(el);
    emit(order, "change-line", change());
    await flush(el);
    expect(updateOrderLine).toHaveBeenCalledOnce();
    el.api = { ...api } as unknown as TillApi;
    await flush(el, 6);
    const calls = api.getTabLines.mock.calls.length;
    if (outcome === "success") answer({ revision: 23, party: { id: "v1", revision: 23 } });
    else refuse({ code: "ticket.already_started" });
    await flush(el, 6);
    expect(api.getTabLines).toHaveBeenCalledTimes(calls);
    expect(tableOrder(el)!.revision).not.toBe(23);
    expect(tableOrder(el)!.cancelOffer).toBeNull();
    expect(banner(el)?.textContent ?? "").not.toContain(codeMessage("ticket.already_started"));
  });
});

describe("direct course and send editing authority", () => {
  const observation = () => {
    const { billId, editorVersion, draftId, draftRevision } = server.edit("wo-4");
    return { billId, editorVersion, draftId, draftRevision };
  };
  const actions = [
    {
      type: "set-line-course",
      method: "setLineCourse",
      detail: { lineNo: 1, courseId: null },
      args: ["wo-4", 1, null],
    },
    { type: "send-lines", method: "sendLines", detail: { lineNos: [1] }, args: ["wo-4", [1]] },
  ] as const;

  describe.each(actions)("$type", ({ type, method, detail, args }) => {
    it("carries the shown editing observation and reloads after the command", async () => {
      const write = vi.fn().mockResolvedValue(undefined);
      const { el } = await mountApp({ [method]: write });
      const order = await openMesa(el);
      const expectedEdit = observation();
      const reads = api.getTabLines.mock.calls.length;
      emit(order, type, { ...detail, expectedEdit });
      await flush(el, 6);
      expect(write).toHaveBeenCalledExactlyOnceWith(
        ...args,
        expectedEdit,
        ...(type === "send-lines"
          ? [
              { submissionId: expect.any(String), expectedPartyRevision: 3 },
              { signal: expect.any(AbortSignal) },
            ]
          : []),
      );
      expect(api.getTabLines).toHaveBeenCalledTimes(reads + 1);
      expect(api.saveDraft).not.toHaveBeenCalled();
      expect(api.takeOverDraft).not.toHaveBeenCalled();
    });

    it.each(["missing", "wrong bill", "old version", "old draft", "old draft revision"])(
      "sends nothing for a %s observation",
      async (kind) => {
        const write = vi.fn().mockResolvedValue(undefined);
        const { el } = await mountApp({ [method]: write });
        const order = await openMesa(el);
        const expectedEdit =
          kind === "missing"
            ? undefined
            : {
                ...observation(),
                ...(kind === "wrong bill" ? { billId: "wo-7" } : {}),
                ...(kind === "old version" ? { editorVersion: 7 } : {}),
                ...(kind === "old draft" ? { draftId: "old-draft" } : {}),
                ...(kind === "old draft revision" ? { draftRevision: 7 } : {}),
              };
        emit(order, type, { ...detail, expectedEdit });
        await flush(el, 6);
        expect(write).not.toHaveBeenCalled();
        expect(banner(el)?.textContent).toContain(codeMessage("draft.out_of_date"));
        expect(api.saveDraft).not.toHaveBeenCalled();
        expect(api.takeOverDraft).not.toHaveBeenCalled();
      },
    );

    it.each(["success", "refusal"])(
      "ignores a late %s after an API replacement",
      async (outcome) => {
        let answer!: () => void;
        let refuse!: (error: unknown) => void;
        const write = vi.fn(
          () =>
            new Promise<void>((resolve, reject) => {
              answer = resolve;
              refuse = reject;
            }),
        );
        const { el } = await mountApp({ [method]: write });
        const order = await openMesa(el);
        emit(order, type, { ...detail, expectedEdit: observation() });
        await flush(el);
        expect(write).toHaveBeenCalledOnce();
        el.api = { ...api } as unknown as TillApi;
        await flush(el, 6);
        const reads = api.getTabLines.mock.calls.length;
        if (outcome === "success") answer();
        else refuse({ code: "ticket.already_started" });
        await flush(el, 6);
        expect(api.getTabLines).toHaveBeenCalledTimes(reads);
        expect(banner(el)?.textContent ?? "").not.toContain(codeMessage("ticket.already_started"));
      },
    );

    it.each(["success", "refusal"])(
      "keeps a newer editor observation after a late %s",
      async (outcome) => {
        let answer!: () => void;
        let refuse!: (error: unknown) => void;
        const write = vi.fn(
          () =>
            new Promise<void>((resolve, reject) => {
              answer = resolve;
              refuse = reject;
            }),
        );
        const { el } = await mountApp({ [method]: write });
        const order = await openMesa(el);
        emit(order, type, { ...detail, expectedEdit: observation() });
        await flush(el);
        expect(write).toHaveBeenCalledOnce();
        const refreshed = await server.listDrafts("v1");
        api.listDrafts.mockResolvedValue({
          ...refreshed,
          billEdits: refreshed.billEdits.map((edit) =>
            edit.billId === "wo-4" ? { ...edit, editorVersion: edit.editorVersion + 2 } : edit,
          ),
        });
        window.dispatchEvent(new Event("focus"));
        await flush(el, 6);
        const reads = api.getTabLines.mock.calls.length;
        if (outcome === "success") answer();
        else refuse({ code: "ticket.already_started" });
        await flush(el, 6);
        expect(api.getTabLines).toHaveBeenCalledTimes(reads);
        expect(tableOrder(el)!.billEdit?.editorVersion).toBe(2);
        expect(banner(el)?.textContent ?? "").not.toContain(codeMessage("ticket.already_started"));
      },
    );
  });
});

describe("held-line move editing authority", () => {
  const source = () => {
    const { billId, editorVersion, draftId, draftRevision } = server.edit("wo-7");
    return { billId, editorVersion, draftId, draftRevision };
  };
  const detail = () => ({
    lineId: "other-line",
    quantity: "2.000",
    target: { groupId: "g4" },
    expectedEdits: [source()],
  });
  async function chooseSourceBill(el: TillApp, order: TillTableOrderScreen) {
    expect(order.shadowRoot!.querySelector('[data-move-line="other-line"]')).toBeNull();
    await userEvent.click(
      order.shadowRoot!.querySelector<HTMLElement>('[data-bill="wo-7"] [data-take-payment]')!,
    );
    await flush(el, 6);
    expect(tableOrder(el)!.orderId).toBe("wo-7");
  }
  async function opening(
    write: ReturnType<typeof vi.fn>,
    formFactor: FormFactor = drillFormFactor,
  ) {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(till(formFactor)),
      moveLinesToGroup: write,
      listGroups: vi.fn().mockResolvedValue({
        revision: 3,
        groups: [orderGroup("g3", 3, "held"), orderGroup("g4", 4, "held")],
      }),
      readCurrentOrders: vi.fn().mockResolvedValue(
        current({
          revision: 3,
          groups: [
            currentGroup("g3", 3, "held", [
              row("other-line", "Other bill dish", "2.000", {
                workingOrderId: "wo-7",
                released: false,
              }),
            ]),
          ],
          ungrouped: [],
          reminder: null,
        }),
      ),
      getPartyBills: vi.fn().mockResolvedValue(
        ["wo-4", "wo-7"].map((workingOrderId) => ({
          workingOrderId,
          revision: 0,
          invoiceType: "F2",
          recipient: null,
          partyId: "v1",
          label: null,
          status: "open",
          total: "4.00",
          outstanding: "4.00",
          hasPayments: false,
          receiptAvailable: false,
        })),
      ),
    });
    return { el, order: await openMesa(el) };
  }

  it.each([drillFormFactor, orderTabFormFactor])(
    "the retained move command carries only the source bill on the %s screen",
    async (formFactor) => {
      const write = vi.fn().mockResolvedValue({ revision: 4 });
      const { el, order } = await opening(write, formFactor);
      order.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
      await flush(el);
      await chooseSourceBill(el, order);
      expect(order.shadowRoot!.querySelector('[data-move-line="other-line"]')).toBeNull();
      emit(order, "move-group-line", detail());
      await flush(el, 6);
      expect(write).toHaveBeenCalledExactlyOnceWith(
        "v1",
        [{ lineId: "other-line", quantity: "2.000" }],
        { groupId: "g4" },
        {
          submissionId: expect.any(String),
          expectedPartyRevision: 3,
          expectedEdits: [{ billId: "wo-7", editorVersion: 0, draftId: null, draftRevision: null }],
        },
      );
      expect(api.saveDraft).not.toHaveBeenCalled();
      expect(api.takeOverDraft).not.toHaveBeenCalled();
    },
  );

  it.each([
    "missing",
    "empty",
    "wrong bill",
    "old version",
    "old draft",
    "old draft revision",
    "extra bill",
    "duplicate bill",
    "unknown line",
  ])("sends no move for a %s observation", async (kind) => {
    const write = vi.fn().mockResolvedValue({ revision: 4 });
    const { el, order } = await opening(write);
    const expectedEdits =
      kind === "missing"
        ? undefined
        : kind === "empty"
          ? []
          : [
              {
                ...source(),
                ...(kind === "wrong bill" ? { billId: "wo-4" } : {}),
                ...(kind === "old version" ? { editorVersion: 7 } : {}),
                ...(kind === "old draft" ? { draftId: "old-draft" } : {}),
                ...(kind === "old draft revision" ? { draftRevision: 7 } : {}),
              },
              ...(kind === "extra bill"
                ? [{ billId: "wo-4", editorVersion: 0, draftId: null, draftRevision: null }]
                : kind === "duplicate bill"
                  ? [source()]
                  : []),
            ];
    emit(order, "move-group-line", {
      ...detail(),
      ...(kind === "unknown line" ? { lineId: "unknown" } : {}),
      expectedEdits,
    });
    await flush(el, 6);
    expect(write).not.toHaveBeenCalled();
    expect(banner(el)?.textContent).toContain(codeMessage("draft.out_of_date"));
    expect(api.saveDraft).not.toHaveBeenCalled();
    expect(api.takeOverDraft).not.toHaveBeenCalled();
  });

  it("refuses a retained move command whose captured source observation changed", async () => {
    const write = vi.fn().mockResolvedValue({ revision: 4 });
    const { el, order } = await opening(write);
    order.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await flush(el);
    await chooseSourceBill(el, order);
    const opened = detail();
    const refreshed = await server.listDrafts("v1");
    api.listDrafts.mockResolvedValue({
      ...refreshed,
      billEdits: refreshed.billEdits.map((edit) =>
        edit.billId === "wo-7" ? { ...edit, editorVersion: edit.editorVersion + 2 } : edit,
      ),
    });
    window.dispatchEvent(new Event("focus"));
    await flush(el, 6);
    emit(order, "move-group-line", opened);
    await flush(el, 6);
    expect(write).not.toHaveBeenCalled();
    expect(banner(el)?.textContent).toContain(codeMessage("draft.out_of_date"));
  });

  it.each(["success", "refusal"])(
    "ignores a late move %s after an API replacement",
    async (outcome) => {
      let answer!: (value: { revision: number }) => void;
      let refuse!: (error: unknown) => void;
      const write = vi.fn(
        () =>
          new Promise((resolve, reject) => {
            answer = resolve;
            refuse = reject;
          }),
      );
      const { el, order } = await opening(write);
      emit(order, "move-group-line", detail());
      await flush(el);
      expect(write).toHaveBeenCalledOnce();
      el.api = { ...api } as unknown as TillApi;
      await flush(el, 6);
      const reads = api.getTabLines.mock.calls.length;
      if (outcome === "success") answer({ revision: 25 });
      else refuse({ code: "group.not_held" });
      await flush(el, 6);
      expect(api.getTabLines).toHaveBeenCalledTimes(reads);
      expect(tableOrder(el)!.party?.revision).not.toBe(25);
      expect(banner(el)?.textContent ?? "").not.toContain(codeMessage("group.not_held"));
    },
  );
});

describe("automatic saved-draft routing", () => {
  it.each(["till", "phone-portrait"] as const)(
    "checks the %s's saved lines and shows routing warnings before Send",
    async (formFactor) => {
      const askDraftDeadEnds = vi.fn(async (_partyId: string, _draftId: string, ids: string[]) => ({
        sends: true,
        deadEnds: [
          {
            key: ids[0]!,
            name: "Beer",
            quantity: "1",
            stationId: "bar",
            stationName: "Bar",
            why: "closed",
          },
        ],
        stations: [{ id: "kitchen", name: "Kitchen", open: true }],
      }));
      const { el } = await mountApp({
        askDraftDeadEnds,
        getTill: vi.fn().mockResolvedValue(till(formFactor)),
      });
      await openMesa(el);
      await tap(el, "Beer");
      await expect.poll(() => askDraftDeadEnds.mock.calls.length, { timeout: 2000 }).toBe(1);
      const saved = server.drafts[0]!;
      expect(askDraftDeadEnds).toHaveBeenCalledWith(
        "v1",
        saved.id,
        [saved.lines[0]!.id],
        expect.any(Object),
      );
      await expect
        .poll(() => tableOrder(el)!.shadowRoot!.querySelector("[data-draft-routing-warning]"))
        .not.toBeNull();
      expect(api.saveDraft).toHaveBeenCalledOnce();
      expect(api.submitDraft).not.toHaveBeenCalled();
      expect(rows(el)).toEqual(["Beer ×1"]);
      expect(tableOrder(el)!.shadowRoot!.querySelector("[data-draft-preview]")).toBeNull();
    },
  );
});

describe("direct New order actions", () => {
  it.each(["send-all", "fire-selected"] as const)(
    "keeps %s locked through native repeated presses until the submit answers",
    async (kind) => {
      let answer!: () => void;
      const waiting = new Promise<void>((resolve) => (answer = resolve));
      let started!: () => void;
      const entered = new Promise<void>((resolve) => (started = resolve));
      const submitDraft = vi.fn(async (...args: Parameters<TillApi["submitDraft"]>) => {
        started();
        await waiting;
        return server.submitDraft(args[0], args[1], args[2]);
      });
      const { el } = await mountApp({ submitDraft });
      try {
        await openMesa(el);
        await tap(el, "Beer");
        await tap(el, "Steak");
        await expect.poll(() => tableOrder(el)!.billEdit?.draftRevision).toBe(1);
        const order = tableOrder(el)!;
        const outbox = draft(el);
        const before = [...outbox.lines];
        const saved = structuredClone(server.drafts);
        const root = order.shadowRoot!;
        await userEvent.click(root.querySelector<HTMLElement>("[data-review-open]")!);
        await userEvent.click(
          [...root.querySelectorAll<HTMLElement>("[data-draft-select]")].find((row) =>
            row.textContent!.includes("Steak"),
          )!,
        );
        const action = root.querySelector<HTMLElement>(`[data-draft-action="${kind}"]`)!;
        await userEvent.dblClick(action);
        await entered;
        await flush(el);

        expect(submitDraft).toHaveBeenCalledOnce();
        expect(outbox.sending).toBe(true);
        expect(outbox.lines).toEqual(before);
        expect(outbox.lines.every((line, index) => line === before[index])).toBe(true);
        expect(server.drafts).toEqual(saved);
        const native = (selector: string) =>
          root
            .querySelector<HTMLElement>(selector)!
            .shadowRoot!.querySelector<HTMLButtonElement>("button")!;
        for (const selector of [
          '[data-draft-action="send-all"]',
          '[data-draft-action="fire-selected"]',
          "[data-draft-move]",
        ]) {
          expect(native(selector).disabled).toBe(true);
        }
        await userEvent.click(native('[data-draft-action="send-all"]'), { force: true });
        await userEvent.click(native('[data-draft-action="fire-selected"]'), { force: true });
        await flush(el);
        expect(submitDraft).toHaveBeenCalledOnce();
        expect(outbox.lines).toEqual(before);
        expect(server.drafts).toEqual(saved);

        answer();
        await expect.poll(() => outbox.sending).toBe(false);
        await flush(el);
        expect(submitDraft).toHaveBeenCalledOnce();
        expect(banner(el)).toBeNull();
        expect(outbox.lines.map((line) => `${line.product.name} ×${line.quantity}`)).toEqual(
          kind === "send-all" ? [] : ["Beer ×1"],
        );
        expect(savedLines()).toEqual(kind === "send-all" ? [] : ["offer-beer ×1"]);
        expect(submitDraft.mock.calls[0]![2].groups).toEqual(
          kind === "send-all"
            ? [
                { release: "hold", lineIds: ["line-2"] },
                { release: "hold", lineIds: ["line-3"] },
              ]
            : [{ release: "fire", lineIds: ["line-3"] }],
        );
        if (kind === "fire-selected") {
          expect(native('[data-draft-action="send-all"]').disabled).toBe(false);
          await userEvent.click(root.querySelector<HTMLElement>('[data-draft-action="send-all"]')!);
          await expect.poll(() => outbox.lineCount).toBe(0);
          expect(submitDraft).toHaveBeenCalledTimes(2);
          expect(submitDraft.mock.calls[1]![2].groups).toEqual([
            { release: "hold", lineIds: ["line-2"] },
          ]);
          expect(server.drafts).toEqual([]);
        }
      } finally {
        answer();
        await flush(el);
      }
    },
  );

  it("keeps a saved selection and its Move window through an unchanged focus refresh", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await userEvent.click(
      [...browser(el)!.shadowRoot!.querySelectorAll<HTMLElement>("wt-button")].find(
        (button) => button.querySelector(".name")?.textContent === "Beer",
      )!,
    );
    await expect.poll(() => api.saveDraft.mock.calls.length).toBe(1);
    await expect.poll(() => tableOrder(el)!.billEdit?.draftRevision).toBe(1);
    const [selected] = draft(el).lines;
    expect(selected!.place).toEqual({ kind: "new", slot: 1 });
    const screen = tableOrder(el)!.shadowRoot!;
    await userEvent.click(screen.querySelector<HTMLElement>("[data-review-open]")!);
    const tick = screen.querySelector<HTMLElement>("[data-draft-select]")!;
    await userEvent.click(tick);
    expect(tick.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(screen.querySelector<HTMLElement>("[data-draft-move]")!);
    const move = screen.querySelector<HTMLElement & { open: boolean }>("[data-draft-move-dialog]")!;
    expect(move.open).toBe(true);
    const reads = api.listDrafts.mock.calls.length;

    window.dispatchEvent(new Event("focus"));
    await expect.poll(() => api.listDrafts.mock.calls.length).toBe(reads + 1);
    await flush(el, 6);

    expect(draft(el).lines[0]).toBe(selected);
    expect(screen.querySelector("[data-draft-select]")!.getAttribute("aria-pressed")).toBe("true");
    expect(move.open).toBe(true);
    const closed = new Promise<void>((resolve) =>
      move.addEventListener("wt-close", () => resolve(), { once: true }),
    );
    await userEvent.click(move.querySelector<HTMLElement>('[data-draft-move-to="new"]')!);
    await closed;
    await flush(el);
    expect(draft(el).lines[0]!.place).toEqual({ kind: "new", slot: 2 });
    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(api.takeOverDraft).not.toHaveBeenCalled();
  });

  async function direct(el: TillApp, kind: "send-all" | "fire-selected") {
    tableOrder(el)!
      .shadowRoot!.querySelector<HTMLElement>(`[data-draft-action="${kind}"]`)!
      .click();
    await flush(el, 6);
  }
  it("sends without a preview and empties the saved outbox only after the accepted response", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    await tap(el, "Steak");
    const outbox = draft(el);
    await direct(el, "send-all");
    expect(api.submitDraft).toHaveBeenCalledOnce();
    expect(api.submitDraft.mock.calls[0]![2].groups).toEqual([
      { release: "hold", lineIds: ["line-2"] },
      { release: "hold", lineIds: ["line-3"] },
    ]);
    expect(outbox.lineCount).toBe(0);
    expect(server.drafts).toEqual([]);
  });
  it("fires only the ticked saved row and retains the unticked dish and its bill", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    await tap(el, "Steak");
    await toggle(el, "Steak");
    await direct(el, "fire-selected");
    expect(api.submitDraft).toHaveBeenCalledOnce();
    expect(api.submitDraft.mock.calls[0]![2].groups).toEqual([
      { release: "fire", lineIds: ["line-3"] },
    ]);
    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(server.drafts[0]!.billId).toBe("wo-4");
    expect(savedLines()).toEqual(["offer-beer ×1"]);
  });
  it("refreshes routing warnings after a refused direct send, without preview or automatic resubmission", async () => {
    let refused = false;
    const submitDraft = vi.fn(async () => {
      refused = true;
      throw { code: "station.no_replacement" };
    });
    const askDraftDeadEnds = vi.fn(async (_party: string, _draft: string, ids: string[]) => ({
      sends: true,
      stations: [{ id: "kitchen", name: "Kitchen", open: true }],
      deadEnds: refused
        ? [
            {
              key: ids[0]!,
              name: "Beer",
              quantity: "1",
              stationId: "bar",
              stationName: "Bar",
              why: "closed",
            },
          ]
        : [],
    }));
    const { el } = await mountApp({ submitDraft, askDraftDeadEnds });
    await openMesa(el);
    await tap(el, "Beer");
    await expect.poll(() => askDraftDeadEnds.mock.calls.length).toBe(1);
    await direct(el, "send-all");
    await expect
      .poll(() => tableOrder(el)!.shadowRoot!.querySelector("[data-draft-routing-warning]"))
      .not.toBeNull();
    expect(submitDraft).toHaveBeenCalledOnce();
    expect(askDraftDeadEnds).toHaveBeenCalledTimes(2);
    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(savedLines()).toEqual(["offer-beer ×1"]);
    expect(tableOrder(el)!.shadowRoot!.querySelector("[data-draft-preview]")).toBeNull();
  });
  it("retains the whole outbox and sends nothing when its save is refused", async () => {
    const { el } = await mountApp({
      saveDraft: vi.fn().mockRejectedValue({ code: "draft.out_of_date", status: 409 }),
    });
    await openMesa(el);
    await tap(el, "Beer");
    await direct(el, "send-all");
    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(retainedCandidate(el)?.lines.map((line) => [line.product.name, line.quantity])).toEqual([
      ["Beer", "1"],
    ]);
    expect(banner(el)).not.toBeNull();
  });
});

describe("native app phone Review with mixed dish families", () => {
  for (const locale of ["en", "es"] as const)
    for (const theme of ["light", "dark"] as const)
      for (const width of [360, 390]) {
        it(`${locale}, ${theme}, ${width}px retains saved sources, placement and selection across Back`, async () => {
          const oldWidth = innerWidth,
            oldHeight = innerHeight;
          await page.viewport(width, 900);
          const menu = catalogue("v1");
          menu.offers[0]!.courseId = null;
          menu.offers[1]!.unit = {
            ...unit,
            id: "unit-weight",
            name: { en: "Kilogram", es: "Kilogramo" },
            abbreviation: { en: "kg", es: "kg" },
            precision: 3,
          };
          menu.offers[2]!.offeredModifiers = [
            {
              kind: "extras",
              id: "sauces",
              name: "Sauces",
              customerName: null,
              kitchenName: null,
              minPicks: 0,
              maxPicks: null,
              items: [
                {
                  presentation: {
                    name: "Sauce",
                    customerName: null,
                    kitchenName: null,
                    variantName: null,
                    variantCustomerName: null,
                    variantKitchenName: null,
                  },
                  productId: "sauce",
                  name: "Sauce",
                  image: null,
                  available: true,
                  customerName: null,
                  kitchenName: null,
                  price: "0.25",
                  vatClass: "general",
                  portion: "1",
                  unit,
                  maxQuantity: 3,
                  preselected: false,
                  addAllergens: null,
                  suitableFor: [],
                },
              ],
            },
          ];
          const fresh = (
            id: string,
            menuItemId: string,
            quantity: string,
            slot: number,
          ): import("./api/client.js").FreshDraftLine => ({
            id,
            menuItemId,
            quantity,
            sourceLineId: null,
            source: null,
            variantId: null,
            menuVersionId: "v1",
            options: [],
            extras: [],
            note: null,
            courseId: null,
            makeAt: null,
            noMerge: false,
            unavailable: false,
            slot,
            joinGroupId: null,
            afterGroupId: null,
          });
          const source: import("./api/client.js").TabLine = {
            id: "review-source",
            name: "Recorded dish",
            lineNo: 1,
            productId: "retired-product",
            menuItemId: null,
            parentProductId: null,
            quantity: "2.000",
            unitPrecision: 0,
            unitPriceGross: "3.25",
            groupId: null,
            stationId: null,
            movable: true,
            servedAt: null,
            courseId: null,
            sentAt: null,
            firedAt: null,
            state: null,
            note: "Recorded note",
            listId: null,
          };
          const extra: import("./api/client.js").TabLine = {
            ...source,
            id: "review-source-extra",
            lineNo: 2,
            parentLineNo: 1,
            name: "Recorded cheese",
            productId: "retired-cheese",
            unitPriceGross: "0.75",
            note: null,
            listId: "toppings",
          };
          server.drafts.push({
            id: "review-draft",
            partyId: "v1",
            billId: "wo-4",
            ownerId: "p1",
            ownerName: "Ana",
            revision: 2,
            takenOverFrom: null,
            lines: [
              fresh("review-beer", "offer-beer", "2", 0),
              {
                ...fresh("review-flan", "offer-flan", "1", 1),
                extras: [{ listId: "sauces", picks: [{ productId: "sauce", quantity: 3 }] }],
              },
              fresh("review-weight", "offer-steak", "0.375", 1),
              {
                id: "review-reference",
                sourceLineId: source.id,
                source: { line: source, extras: [extra], netAmount: "8.00" },
                quantity: "2.000",
                note: source.note,
                courseId: null,
                makeAt: null,
                noMerge: true,
                unavailable: false,
                slot: 0,
                joinGroupId: null,
                afterGroupId: null,
              },
            ],
          });
          const savedBefore = structuredClone(server.drafts);
          try {
            const { el, host } = await mountApp(
              {
                getTill: vi.fn().mockResolvedValue(till("phone-portrait")),
                listZoneOffers: vi.fn().mockResolvedValue(menu),
                getTabLines: vi.fn().mockResolvedValue({
                  lines: [source, extra],
                  revision: 0,
                  editSentLines: true,
                }),
              },
              undefined,
              theme,
            );
            await flush(el);
            await signIn(el);
            setLocale(locale);
            emit(shell(el), "screen-select", { screen: "floor" });
            await flush(el);
            await userEvent.click(
              floor(el)!.shadowRoot!.querySelector<HTMLElement>('[data-table="t4"]')!,
            );
            await expect.poll(() => tableOrder(el)?.draftStore?.lines.length).toBe(4);
            const order = tableOrder(el)!;
            const q = (selector: string) => order.shadowRoot!.querySelector<HTMLElement>(selector)!;
            const expectTarget = (selector: string) => {
              const target = q(selector).shadowRoot!.querySelector<HTMLButtonElement>("button")!;
              const box = target.getBoundingClientRect();
              expect(target.checkVisibility()).toBe(true);
              expect(box.width).toBeGreaterThanOrEqual(44);
              expect(box.height).toBeGreaterThanOrEqual(44);
              expect(box.left).toBeGreaterThanOrEqual(0);
              expect(box.right).toBeLessThanOrEqual(width);
            };
            await expect.poll(() => q("[data-review-open]").checkVisibility()).toBe(true);
            const originalRows = [...draft(el).lines];
            const before = structuredClone(draft(el).lines);
            const reviewText = locale === "es" ? "Revisar (6)" : "Review (6)";
            expect(innerWidth).toBe(width);
            expect(q("[data-review-open]").textContent!.trim()).toBe(reviewText);
            expectTarget("[data-review-open]");
            expect(rows(el)).toEqual(["Beer ×2", "Flan ×1", "Steak ×0.375", "Recorded dish ×2"]);
            expect(q("[data-browsing]").checkVisibility()).toBe(true);
            expect(q("[data-draft-pane]").checkVisibility()).toBe(false);
            await userEvent.click(q("[data-review-open]"));
            await expect.poll(() => q("[data-draft-pane]").checkVisibility()).toBe(true);
            expect(order.shadowRoot!.activeElement).toBe(q("[data-review-back]"));
            expectTarget("[data-review-back]");
            expect(
              [...order.shadowRoot!.querySelectorAll<HTMLElement>("[data-draft-group]")].map(
                (group) => group.dataset.draftGroup,
              ),
            ).toEqual(["fire", "new:1"]);
            expect(q('[data-draft-select="2"]').textContent).toContain(
              locale === "es" ? "0,375" : "0.375",
            );
            expect(draft(el).lines[1]!.extras).toEqual([
              expect.objectContaining({ productId: "sauce", quantity: 3 }),
            ]);
            expect(draft(el).lines[3]!.source).toEqual({
              line: source,
              extras: [extra],
              netAmount: "8.00",
            });
            await userEvent.click(q('[data-draft-select="0"]'));
            await flush(el);
            const reads = api.listDrafts!.mock.calls.length;
            window.dispatchEvent(new Event("focus"));
            await expect.poll(() => api.listDrafts!.mock.calls.length).toBeGreaterThan(reads);
            await flush(el);
            expect(q('[data-draft-select="0"]').getAttribute("aria-pressed")).toBe("true");
            for (let index = 0; index < originalRows.length; index++)
              expect(draft(el).lines[index]).toBe(originalRows[index]);
            expect(draft(el).lines).toEqual(before);
            await expectNoA11yViolations(host);
            await page.screenshot({
              path: `__screenshots__/a773-app-review-${locale}-${theme}-${width}.png`,
            });
            await userEvent.click(q("[data-review-back]"));
            await expect.poll(() => q("[data-browsing]").checkVisibility()).toBe(true);
            expect(q("[data-draft-pane]").checkVisibility()).toBe(false);
            expect(order.shadowRoot!.activeElement).toBe(q("[data-review-open]"));
            expect(q("[data-review-open]").textContent!.trim()).toBe(reviewText);
            expect(draft(el).lines).toEqual(before);
            expect(server.drafts).toEqual(savedBefore);
            expect(api.saveDraft).not.toHaveBeenCalled();
            expect(api.submitDraft).not.toHaveBeenCalled();
            expect(api.takeOverDraft).not.toHaveBeenCalled();
            expect(banner(el)).toBeNull();
            await expectNoA11yViolations(host);
            await page.screenshot({
              path: `__screenshots__/a773-app-back-${locale}-${theme}-${width}.png`,
            });
            await userEvent.click(q("[data-review-open]"));
            await expect.poll(() => q("[data-draft-pane]").checkVisibility()).toBe(true);
            expect(q('[data-draft-select="0"]').getAttribute("aria-pressed")).toBe("true");
            expect(draft(el).lines).toEqual(before);
            expect(api.submitDraft).not.toHaveBeenCalled();
          } finally {
            cleanupWidgets();
            setLocale("en");
            await page.viewport(oldWidth, oldHeight);
          }
        });
      }
});
