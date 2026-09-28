import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupWidgets,
  draftServer,
  mountWidget,
  type DraftServer,
} from "./widgets/test-helpers.js";
import { SUBMIT_RETRY_PAUSE_MS, TillApp } from "./till-app.js";
import { setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import { DRAFT_SAVE_DELAY_MS } from "./state/draft-sync.js";
import { WorkingOrderStore } from "./state/working-order.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import type { TillFloorScreen } from "./screens/till-floor-screen.js";
import type { TillMenuBrowser } from "./widgets/menu-browser.js";
import type { CanvasDef, CapabilityFlag } from "./layout.js";
import type {
  OrderGroup,
  TableState,
  TableVisit,
  TillApi,
  TillMenuOffer,
  ZoneOfferCatalogue,
} from "./api/client.js";

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
    active: true,
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
    context: { zoneId: "z1", departmentId: "department-bar", serviceMode: "table_tab" },
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

const courses = [
  { id: "drinks", name: "Drinks", displayOrder: 0 },
  { id: "mains", name: "Mains", displayOrder: 1 },
  { id: "desserts", name: "Desserts", displayOrder: 2 },
];

function party(over: Partial<TableVisit> = {}): TableVisit {
  return {
    id: "v1",
    revision: 3,
    guestCount: 2,
    state: "open",
    outstanding: "0.00",
    billCount: 1,
    tableIds: ["t4"],
    unsentDrafts: [],
    ...over,
  };
}

function table(id: string, label: string, visit: TableVisit | null, tabId?: string): TableState {
  return {
    id,
    label,
    zoneId: "z1",
    capacity: 4,
    state: visit === null ? "free" : "open-tab",
    hasOpenTab: visit !== null,
    ...(tabId === undefined ? {} : { tabId }),
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    status: null,
    nextReservation: null,
    posX: null,
    posY: null,
    shape: null,
    rotation: null,
    visit,
  };
}

const mesa4 = table("t4", "4", party(), "wo-4");
const mesa7 = table("t7", "7", party({ id: "v7", revision: 9, tableIds: ["t7"] }), "wo-7");

const drillCanvas: CanvasDef = {
  formFactor: "till",
  tabs: [
    {
      key: "counter",
      title: "Counter",
      columns: 12,
      cards: [{ type: "product-grid", colSpan: 8, rowSpan: 6, config: {} }],
    },
    {
      key: "floor",
      title: "Floor",
      columns: 24,
      cards: [{ type: "floor-plan", colSpan: 24, rowSpan: 12, config: {} }],
    },
  ],
};

const orderTabCanvas: CanvasDef = {
  formFactor: "till",
  tabs: [
    drillCanvas.tabs[1]!,
    {
      key: "order",
      title: "Order",
      columns: 12,
      cards: [{ type: "table-order", colSpan: 12, rowSpan: 8, config: {} }],
    },
  ],
};

function till(canvas: CanvasDef) {
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
    canvas,
    capabilities: ["print-receipt"] as CapabilityFlag[],
    inactivityTimeoutSeconds: null,
    nodeId: "n1",
    servers: [],
  };
}

let server: DraftServer;
let api: Record<string, ReturnType<typeof vi.fn>>;

function stubApi(overrides: Record<string, unknown> = {}) {
  return {
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getTill: vi.fn().mockResolvedValue(till(drillCanvas)),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "till-dev",
      name: "Till 1",
      formFactor: "till",
      stationId: null,
    }),
    getDeviceStation: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    listStaff: vi.fn().mockResolvedValue([]),
    listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue("v1")),
    listZoneOffers: vi.fn().mockResolvedValue(catalogue("v1")),
    menuState: vi.fn(() => new Promise(() => {})),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    getTablesState: vi.fn().mockResolvedValue([mesa4, mesa7]),
    listZones: vi
      .fn()
      .mockResolvedValue([{ id: "z1", name: "Comedor", displayOrder: 0, active: true }]),
    listStatuses: vi.fn().mockResolvedValue([]),
    getVisitBills: vi.fn().mockResolvedValue([]),
    getTabLines: vi.fn().mockResolvedValue({ lines: [], revision: 0, editSentLines: true }),
    listGroups: vi.fn().mockResolvedValue({ revision: 3, groups: [] }),
    listPrintProblems: vi.fn().mockResolvedValue({ problems: [] }),
    submitGroups: vi.fn().mockRejectedValue(new Error("the table no longer sends groups inline")),
    listDrafts: server.listDrafts,
    saveDraft: server.saveDraft,
    submitDraft: server.submitDraft,
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as Record<string, ReturnType<typeof vi.fn>>;
}

async function mountApp(overrides: Record<string, unknown> = {}) {
  api = stubApi(overrides);
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
const shell = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>("till-tab-shell")!;
const cardGrid = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>("till-card-grid");
const floor = (el: TillApp) =>
  cardGrid(el)?.shadowRoot?.querySelector<TillFloorScreen>("till-floor-screen") ?? null;
const tableOrder = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen") ??
  cardGrid(el)?.shadowRoot?.querySelector<TillTableOrderScreen>("till-table-order-screen") ??
  null;
const banner = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>(".error");
const browser = (el: TillApp) =>
  tableOrder(el)!.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser");
const draft = (el: TillApp) => browser(el)!.store;
const rows = (el: TillApp) =>
  draft(el).lines.map((line) => `${line.product.name} ×${line.quantity}`);

async function signIn(el: TillApp, personId = "p1", displayName = "Ana"): Promise<void> {
  server.personId = personId;
  server.personName = displayName;
  emit(lock(el), "logged-in", { personId, displayName, canConfigureTill: false });
  await flush(el);
}

async function openMesa(el: TillApp, tableId = "t4"): Promise<TillTableOrderScreen> {
  await flush(el);
  await signIn(el);
  emit(shell(el), "tab-select", { key: "floor" });
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
  tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>(`[data-draft-action="${kind}"]`)!.click();
  await flush(el);
  tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>("[data-draft-confirm]")!.click();
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
        visit: {
          ...each.visit!,
          unsentDrafts: server.drafts
            .filter((one) => one.visitId === each.visit!.id && one.lines.length > 0)
            .map((one) => ({ ownerName: one.ownerName, lineCount: one.lines.length })),
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

    expect(unsentMark(el, "t4")).toBe("Ana has an unsent order: 2 items");
    expect(unsentMark(el, "t7")).toBeUndefined();
  });

  it("shows the mark when the Order tab is left for the floor, once the save has landed", async () => {
    const { el } = await mountApp({
      ...lateSaveLiveFloor(),
      getTill: vi.fn().mockResolvedValue(till(orderTabCanvas)),
    });
    await openMesa(el);
    await tap(el, "Flan");

    emit(shell(el), "tab-select", { key: "floor" });
    await settle(el);

    expect(unsentMark(el, "t4")).toBe("Ana has an unsent order: 1 item");
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

    expect(server.drafts.map((each) => [each.visitId, each.lines.length])).toEqual([
      ["v1", 1],
      ["v7", 1],
    ]);
    expect(rows(el)).toEqual(["Beer ×1"]);
  });

  it("saves the draft when the Order tab is left for the floor", async () => {
    const { el } = await mountApp({ getTill: vi.fn().mockResolvedValue(till(orderTabCanvas)) });
    await openMesa(el);
    await tap(el, "Flan");

    emit(shell(el), "tab-select", { key: "floor" });
    await flush(el);

    expect(savedLines()).toEqual(["offer-flan ×1"]);
    expect(api.submitDraft).not.toHaveBeenCalled();
  });

  it("saves a course picked for a line with the draft", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Flan");
    const picker =
      tableOrder(el)!.shadowRoot!.querySelector<HTMLSelectElement>("[data-round-course]")!;
    picker.value = "mains";
    picker.dispatchEvent(new Event("change"));
    await back(el);

    expect(server.drafts[0]!.lines.map((line) => line.courseId)).toEqual(["mains"]);
  });

  it("shows no draft on a check split off the party's bill", async () => {
    const { el } = await mountApp({
      splitTab: vi.fn().mockResolvedValue({ checkId: "wo-check" }),
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
    expect(browser(el)).toBeNull();
    expect(tableOrder(el)!.shadowRoot!.querySelector("[data-draft-action]")).toBeNull();
  });
});

describe("till-app: an order that moves to another party", () => {
  it("saves the person's edits to the party they were made on, then shows the new party's draft", async () => {
    const { el } = await mountApp({
      moveTab: vi.fn().mockRejectedValue({ code: "visit.out_of_date", visitId: "v1" }),
    });
    await openMesa(el);
    server.save("v9", {
      draftId: null,
      revision: 0,
      lines: [
        {
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
      table("t4", "4", party({ id: "v9", revision: 1, tableIds: ["t4", "t7"] }), "wo-4"),
      mesa7,
    ]);

    emit(tableOrder(el)!, "move-tab", { toTableId: "t7" });
    await flush(el, 6);

    expect(server.drafts.map((each) => [each.visitId, each.lines.length])).toEqual([
      ["v9", 1],
      ["v1", 1],
    ]);
    expect(api.listDrafts).toHaveBeenLastCalledWith("v9", expect.anything());
    expect(rows(el)).toEqual(["Flan ×1"]);
  });
});

describe("till-app: signing out with a draft", () => {
  it("saves the draft before the session ends", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");

    emit(tableOrder(el)!, "logout");
    await flush(el);

    expect(api.saveDraft).toHaveBeenCalledOnce();
    expect(api.logout).toHaveBeenCalledOnce();
    expect(api.saveDraft.mock.invocationCallOrder[0]!).toBeLessThan(
      api.logout.mock.invocationCallOrder[0]!,
    );
    expect(lock(el)).not.toBeNull();
  });

  it("never sends one person's queued save after another has signed in", async () => {
    let answer!: () => void;
    const { el } = await mountApp();
    await openMesa(el);
    server.saveDraft.mockImplementationOnce(async (visitId, save) => {
      const sentBy = server.personId;
      await new Promise<void>((resolve) => (answer = resolve));
      const now = server.personId;
      server.personId = sentBy;
      const saved = server.save(visitId, save);
      server.personId = now;
      return structuredClone(saved);
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

describe("till-app: a save the server refuses", () => {
  it("shows the draft another device saved, says so, and does not save over it", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    server.save("v1", {
      draftId: null,
      revision: 0,
      lines: [
        {
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

  it("re-reads the drafts after a save refused as taken over, and says so in the code's words", async () => {
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
    expect(banner(el)!.textContent).toContain(codeMessage("draft.taken_over"));
  });

  it("says a closed party in its own words", async () => {
    const { el } = await mountApp({
      saveDraft: vi.fn().mockRejectedValue({ code: "visit.not_open", status: 409 }),
    });
    await openMesa(el);
    await tap(el, "Beer");

    await back(el);

    expect(banner(el)!.textContent).toContain(codeMessage("visit.not_open"));
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
  it("sends Send all as one held group per course, under the ids the save answered", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    await tap(el, "Steak");

    await act(el, "send-all");

    expect(api.submitDraft).toHaveBeenCalledOnce();
    const [visitId, draftId, submission] = api.submitDraft.mock.calls[0]!;
    expect([visitId, draftId]).toEqual(["v1", "draft-1"]);
    expect(submission).toEqual({
      submissionId: expect.any(String),
      expectedVisitRevision: 3,
      draftRevision: 1,
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

  it("adds a later addition to the held group picked, naming it", async () => {
    const held: OrderGroup = {
      id: "g-mains",
      position: 1,
      state: "held",
      firedAt: null,
      remindAt: null,
      lineIds: ["l-9"],
      summary: "1 × Steak",
    };
    const { el } = await mountApp({
      listGroups: vi.fn().mockResolvedValue({ revision: 3, groups: [held] }),
    });
    await openMesa(el);
    await tap(el, "Flan");
    tableOrder(el)!
      .shadowRoot!.querySelector<HTMLInputElement>('[data-destination="add-to-held"]')!
      .click();
    await flush(el);

    await act(el, "submit");

    expect(api.submitDraft.mock.calls[0]![2]).toEqual(
      expect.objectContaining({
        joinGroupId: "g-mains",
        groups: [{ release: "hold", lineIds: ["line-2"] }],
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
    await new Promise((resolve) => setTimeout(resolve, 2 * SUBMIT_RETRY_PAUSE_MS + 50));
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
    await new Promise((resolve) => setTimeout(resolve, 2 * SUBMIT_RETRY_PAUSE_MS + 50));
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
    await new Promise((resolve) => setTimeout(resolve, 2 * SUBMIT_RETRY_PAUSE_MS + 50));
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

    expect(banner(el)!.textContent).toContain(codeMessage("draft.taken_over"));
    expect(rows(el)).toEqual([]);
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
    expect(banner(el)!.textContent).toContain(t("table.error"));
    expect(rows(el)).toEqual(["Beer ×1"]);
  });

  it("says a refused save and sends nothing", async () => {
    const { el } = await mountApp({
      saveDraft: vi.fn().mockRejectedValue({ code: "visit.not_open", status: 409 }),
    });
    await openMesa(el);
    await tap(el, "Beer");

    await act(el, "fire-all");

    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(banner(el)!.textContent).toContain(codeMessage("visit.not_open"));
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
      saveDraft: vi.fn().mockRejectedValue({ code: "visit.not_open", status: 409 }),
    });
    await openMesa(el);
    await tap(el, "Beer");
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    await flush(el);
    expect(api.saveDraft).toHaveBeenCalledOnce();

    await act(el, "fire-all");

    expect(api.saveDraft).toHaveBeenCalledTimes(2);
    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(banner(el)!.textContent).toContain(codeMessage("visit.not_open"));
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
      submitDraft: vi.fn().mockRejectedValue({ code: "visit.not_open", status: 409 }),
    });
    await openMesa(el);
    await tap(el, "Beer");
    const floorReads = api.getTablesState.mock.calls.length;

    await act(el, "fire-all");

    expect(banner(el)!.textContent).toContain(codeMessage("visit.not_open"));
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
    server.saveDraft.mockImplementationOnce(async (visitId, save) => {
      await new Promise<void>((resolve) => (answer = resolve));
      return structuredClone(server.save(visitId, save));
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

describe("till-app: how long a send may take", () => {
  /** Settles answers and renders under fake timers. */
  async function settle(el: TillApp): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;
    }
  }

  async function confirmFireAll(el: TillApp): Promise<void> {
    tableOrder(el)!
      .shadowRoot!.querySelector<HTMLElement>('[data-draft-action="fire-all"]')!
      .click();
    await settle(el);
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>("[data-draft-confirm]")!.click();
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
    const { el } = await mountApp({ saveDraft: vi.fn(noAnswer) });
    await openMesa(el);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    press(el, "Beer");
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
    const { el } = await mountApp({ saveDraft: vi.fn(noAnswer) });
    await openMesa(el);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    press(el, "Beer");
    await settle(el);
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS);
    expect(api.saveDraft).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(100_000);
    press(el, "Steak");
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
  it("treats a restored draft as a first order when the table it opens has no group", async () => {
    const held: OrderGroup = {
      id: "g-7",
      position: 1,
      state: "held",
      firedAt: null,
      remindAt: null,
      lineIds: ["l-1"],
      summary: "1 × Steak",
    };
    const sideBySide: CanvasDef = {
      formFactor: "till",
      tabs: [
        drillCanvas.tabs[0]!,
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
    let answerGroups!: () => void;
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(till(sideBySide)),
      listGroups: vi.fn(async (visitId: string) => {
        if (visitId === "v7") return { revision: 9, groups: [held] };
        await new Promise<void>((resolve) => (answerGroups = resolve));
        return { revision: 3, groups: [] };
      }),
    });
    server.save("v1", {
      draftId: null,
      revision: 0,
      lines: [
        {
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
    emit(shell(el), "tab-select", { key: "service" });
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
    const sideBySide: CanvasDef = {
      formFactor: "till",
      tabs: [
        drillCanvas.tabs[0]!,
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
    let answerMesa7!: () => void;
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(till(sideBySide)),
      listDrafts: vi.fn(async (visitId: string) => {
        if (visitId === "v7") await new Promise<void>((resolve) => (answerMesa7 = resolve));
        return server.listDrafts(visitId);
      }),
    });
    server.save("v1", { draftId: null, revision: 0, lines: [beerLine] });
    await flush(el);
    await signIn(el);
    emit(shell(el), "tab-select", { key: "service" });
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
      getTill: vi.fn().mockResolvedValue(till(orderTabCanvas)),
      listZoneOffers: vi.fn(async () => {
        await new Promise<void>((resolve) => (answerOffers = resolve));
        return catalogue("v1");
      }),
    });
    server.save("v1", { draftId: null, revision: 0, lines: [beerLine] });
    await flush(el);
    await signIn(el);
    emit(shell(el), "tab-select", { key: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);

    emit(el.shadowRoot!.querySelector("till-tab-shell")!, "logout");
    await flush(el);
    answerOffers();
    await flush(el);
    await signIn(el, "p2", "Sam");
    emit(shell(el), "tab-select", { key: "order" });
    await flush(el);

    expect(browser(el)?.store.lines ?? []).toEqual([]);
  });
});
