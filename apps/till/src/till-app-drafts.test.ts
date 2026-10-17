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
import { DRAFT_SAVE_DELAY_MS } from "./state/draft-sync.js";
import { WorkingOrderStore } from "./state/working-order.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import { resized } from "./screens/till-table-order-screen.test-helpers.js";
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
import { HOME_DISPLAY_DEFAULTS } from "@waitron/catalogue/src/device-home.js";

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
const banner = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>(".error");
const browser = (el: TillApp) =>
  tableOrder(el)!.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser");
const draft = (el: TillApp) => tableOrder(el)!.draftStore!;
const rows = (el: TillApp) =>
  draft(el).lines.map((line) => `${line.product.name} ×${line.quantity}`);

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

  it("releases Send after three seconds and ignores a later station answer", async () => {
    let answer!: (value: unknown) => void;
    const askDraftDeadEnds = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    const { el } = await mountApp({ askDraftDeadEnds });
    await openMesa(el);
    await tap(el, "Beer");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    tableOrder(el)!
      .shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!
      .click();
    await settleTimers(el);
    expect(askDraftDeadEnds).toHaveBeenCalledOnce();
    const screen = tableOrder(el)!;
    const confirm = () =>
      screen.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
        "[data-draft-confirm]",
      )!;
    expect(confirm().disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(2_999);
    await settleTimers(el);
    expect(confirm().disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await settleTimers(el);
    expect(confirm().disabled).toBe(false);
    answer({
      sends: true,
      deadEnds: [
        {
          key: "late-id",
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
  });
});

it("saves a Send preview station choice on the matching live draft line", async () => {
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
  await actOpenPreview(el, "send-all");
  const screen = tableOrder(el)!;
  expect(askDraftDeadEnds).toHaveBeenCalledWith(
    "v1",
    "draft-1",
    expect.any(Array),
    expect.any(Object),
  );
  expect(
    screen.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-draft-confirm]")!
      .disabled,
  ).toBe(true);
  screen
    .shadowRoot!.querySelector<HTMLElement>("till-dead-ends-section")!
    .dispatchEvent(new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }));
  await flush(el);
  screen.shadowRoot!.querySelector<HTMLElement>("[data-draft-confirm]")!.click();
  await flush(el, 6);
  expect(api.saveDraft.mock.calls.at(-1)![1].lines[0].makeAt).toBe("kitchen");
  expect(api.submitDraft).toHaveBeenCalledOnce();
});

it("reopens the Send preview and checks again after a station refusal", async () => {
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
  await act(el, "send-all");
  expect(submitDraft).toHaveBeenCalledOnce();
  expect(askDraftDeadEnds).toHaveBeenCalledTimes(2);
  expect(tableOrder(el)!.shadowRoot!.querySelector("till-dead-ends-section")).not.toBeNull();
  expect(
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      "[data-draft-confirm]",
    )!.disabled,
  ).toBe(true);
});

it("keeps Confirm available when the station question fails", async () => {
  const { el } = await mountApp({
    askDraftDeadEnds: vi.fn().mockRejectedValue(new TypeError("offline")),
  });
  await openMesa(el);
  await tap(el, "Beer");
  await actOpenPreview(el, "send-all");
  const screen = tableOrder(el)!;
  expect(screen.shadowRoot!.querySelector("till-dead-ends-section")).toBeNull();
  expect(
    screen.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-draft-confirm]")!
      .disabled,
  ).toBe(false);
});

async function actOpenPreview(el: TillApp, kind: string): Promise<void> {
  tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>(`[data-draft-action="${kind}"]`)!.click();
  await flush(el);
}

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
    return structuredClone(saved);
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
      return structuredClone(server.save(partyId, save));
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
    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(banner(el)!.textContent).toContain(t("table.draft_save_failed"));
    expect(api.submitDraft).not.toHaveBeenCalled();
    api.saveDraft.mockImplementation(async (partyId, save) =>
      structuredClone(server.save(partyId, save)),
    );
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
      return structuredClone(server.save(partyId, save));
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

    expect(unsentMark(el, "t4")).toBe("Ana has an unsent order: 2 items");
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

  it("saves a course picked for a line with the draft", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Flan");
    const picker = tableOrder(el)!.shadowRoot!.querySelector<WtCombobox>("[data-round-course]")!;
    await chooseOption(picker, "mains");
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
  it("saves the person's edits to the party they were made on, then shows the new party's draft", async () => {
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

    expect(server.drafts.map((each) => [each.partyId, each.lines.length])).toEqual([
      ["v9", 1],
      ["v1", 1],
    ]);
    expect(api.listDrafts).toHaveBeenLastCalledWith("v9", expect.anything());
    expect(rows(el)).toEqual(["Flan ×1"]);
  });
});

describe("till-app: signing out with a draft", () => {
  it("shows the box-update bar instead of reloading while the sign-out's save of the draft is still out", async () => {
    const answer = holdNextSave();
    const reload = vi.fn();
    const { el } = await mountApp();
    el.reload = reload;
    await openMesa(el);
    await tap(el, "Beer");

    emit(tableOrder(el)!, "logout");
    await flush(el);
    expect(lock(el)).not.toBeNull();
    expect(api.saveDraft).toHaveBeenCalledOnce();
    expect(api.logout).not.toHaveBeenCalled();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
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

  it("reloads only once the sign-out's save of the draft is answered, when Reload was pressed while it was out", async () => {
    const answer = holdNextSave();
    const reload = vi.fn();
    const { el } = await mountApp();
    el.reload = reload;
    await openMesa(el);
    await tap(el, "Beer");
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
    server.saveDraft.mockImplementationOnce(async (partyId, save) => {
      const sentBy = server.personId;
      await new Promise<void>((resolve) => (answer = resolve));
      const now = server.personId;
      server.personId = sentBy;
      const saved = server.save(partyId, save);
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
    expect(rows(el)).toEqual(["Beer ×1"]);
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
  it("sends Send all as one held group per course, under the ids the save answered", async () => {
    const { el } = await mountApp();
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
    expect(rows(el)).toEqual([]);
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
    expect(banner(el)!.textContent).toContain(t("table.error"));
    expect(rows(el)).toEqual(["Beer ×1"]);
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
      return structuredClone(server.save(partyId, save));
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
    expect(who.calls).toEqual([]);
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
    const { el } = await mountApp();
    await openMesa(el);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    press(el, "Beer");
    await settle(el);
    tableOrder(el)!
      .shadowRoot!.querySelector<HTMLElement>('[data-draft-action="fire-all"]')!
      .click();
    await settle(el);
    api.saveDraft.mockImplementation(noAnswer);
    draft(el).setLineCourse(0, "mains");
    await settle(el);
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>("[data-draft-confirm]")!.click();
    await settle(el);

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
    tableOrder(el)!
      .shadowRoot!.querySelector<HTMLElement>('[data-draft-action="fire-all"]')!
      .click();
    await settle(el);
    release();
    await settle(el);
    api.saveDraft.mockImplementation(noAnswer);
    draft(el).setLineCourse(0, "mains");
    await settle(el);
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>("[data-draft-confirm]")!.click();
    await settle(el);

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
    expect(actions).toEqual(["submit"]);
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
      .shadowRoot!.querySelector<HTMLElement>("[data-last-added]")
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

    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-last-added-step="1"]')!.click();
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

    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-last-added-step="1"]')!.click();
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
  const steakLine = {
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
  };
  const visible = (el: TillApp, selector: string) =>
    tableOrder(el)!.shadowRoot!.querySelector(selector)?.checkVisibility() ?? false;
  const bar = (el: TillApp) =>
    tableOrder(el)!
      .shadowRoot!.querySelector<HTMLElement>("[data-last-added]")
      ?.textContent?.replace(/\s+/g, " ")
      .trim();
  const ticks = (el: TillApp) =>
    [...tableOrder(el)!.shadowRoot!.querySelectorAll("[data-draft-select]")].map((tick) =>
      tick.textContent!.replace(/[☑☐]/g, "").replace(/\s+/g, " ").trim(),
    );
  const saveWait = () => new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));

  it("on Review, shows the server's draft there, says so, and sends nothing again", async () => {
    const { el } = await mountApp();
    await openMesa(el);
    server.save("v1", { billId: "wo-4", draftId: null, revision: 0, lines: [steakLine] });
    await tap(el, "Beer");
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>("[data-review-open]")!.click();
    await flush(el);

    await saveWait();
    await flush(el, 6);

    expect(banner(el)!.textContent).toContain(t("table.draft_changed_elsewhere"));
    expect(visible(el, "[data-draft-pane]")).toBe(true);
    expect(ticks(el)).toEqual(["Steak ×2"]);
    expect(bar(el)).toBeUndefined();
    expect(api.saveDraft).toHaveBeenCalledOnce();
    expect(api.submitDraft).not.toHaveBeenCalled();
  });

  it("keeps the bar on the dish tapped when the server's draft still orders it", async () => {
    const { el } = await mountApp();
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

    expect(rows(el)).toEqual([]);
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
      alexs.revision,
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

    expect(rows(el)).toEqual([]);
    await reviewed(el);
    expect(panelOf(el)).toMatchObject({
      heading: "Taken over by Sam",
      lines: ["Beer ×1", "Flan ×1"],
      sends: false,
    });
    await reviewed(el);
    expect(panelOf(el).takeOver).not.toBeNull();
  });

  it("adds Alex's lines into the draft Sam already holds, and keeps that draft's id", async () => {
    const { el } = await mountApp();
    const alexs = savedBy(ALEX, "Alex", "offer-beer", "offer-flan");
    const sams = savedBy(SAM, "Sam", "offer-flan", "offer-steak");
    await openAs(el, SAM, "Sam");
    expect(rows(el)).toEqual(["Flan ×1", "Steak ×1"]);

    await takeOver(el);

    expect(api.takeOverDraft).toHaveBeenCalledExactlyOnceWith(
      "v1",
      alexs.id,
      alexs.revision,
      expect.anything(),
    );
    expect(rows(el)).toEqual(["Flan ×2", "Steak ×1", "Beer ×1"]);
    expect(panels(el)).toEqual([]);
    await browsing(el);
    await tap(el, "Steak");
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    expect(api.saveDraft).toHaveBeenLastCalledWith(
      "v1",
      expect.objectContaining({ draftId: sams.id, revision: sams.revision + 1 }),
      expect.anything(),
    );
  });

  it("drops Alex's save refused because Sam took the draft over, says the change was not saved, and shows it taken over", async () => {
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
    expect(rows(el)).toEqual([]);
    await reviewed(el);
    expect(panelOf(el)).toMatchObject({ heading: "Taken over by Sam", lines: ["Beer ×1"] });
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    expect(api.saveDraft).toHaveBeenCalledTimes(2);

    await browsing(el);

    await tap(el, "Steak");
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    expect(api.saveDraft).toHaveBeenCalledTimes(3);
    expect(api.saveDraft).toHaveBeenLastCalledWith(
      "v1",
      expect.objectContaining({ draftId: null, revision: 0 }),
      expect.anything(),
    );
  });

  it("takes nothing over, and says so, when Sam's own change could not be saved first", async () => {
    const { el } = await mountApp({
      saveDraft: vi.fn(server.saveDraft).mockRejectedValueOnce(new TypeError("Failed to fetch")),
    });
    savedBy(ALEX, "Alex", "offer-beer");
    await openAs(el, SAM, "Sam");
    await browsing(el);
    press(el, "Flan");

    await takeOver(el);

    expect(api.saveDraft).toHaveBeenCalledOnce();
    expect(api.takeOverDraft).not.toHaveBeenCalled();
    expect(banner(el)!.textContent).toContain(t("table.error"));
    expect(dialogOpen(el)).toBe(false);
    expect(rows(el)).toEqual(["Flan ×1"]);
  });

  it("keeps the words of a refusal of Sam's own change, and takes nothing over", async () => {
    const { el } = await mountApp({
      saveDraft: vi.fn().mockRejectedValue({ code: "party.not_open", status: 409 }),
    });
    savedBy(ALEX, "Alex", "offer-beer");
    await openAs(el, SAM, "Sam");
    await browsing(el);
    press(el, "Flan");

    await takeOver(el);

    expect(api.takeOverDraft).not.toHaveBeenCalled();
    expect(banner(el)!.textContent).toContain(codeMessage("party.not_open"));
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

  it("sends no take-over as the next person when Sam's take-over was waiting on his own save at sign-out", async () => {
    const { el } = await mountApp();
    const alex = savedBy(ALEX, "Alex", "offer-beer");
    await openAs(el, SAM, "Sam");
    await browsing(el);
    const answer = holdNextSave();
    press(el, "Flan");
    await takeOver(el);
    expect(api.saveDraft).toHaveBeenCalledOnce();

    emit(shell(el), "logout");
    await flush(el);
    await signIn(el, "p-kim", "Kim");
    answer();
    await flush(el, 8);

    expect(api.takeOverDraft).not.toHaveBeenCalled();
    expect(server.drafts.find((each) => each.id === alex.id)!.ownerId).toBe(ALEX);
    expect(banner(el)).toBeNull();
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
    expect(rows(el)).toEqual([]);
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

  it("asks nothing while the check before sending is open, and asks at the next poll once it is closed", async () => {
    const { el } = await mountApp({ menuState: vi.fn().mockResolvedValue(state("v1")) });
    await openMesa(el);
    await tap(el, "Beer");
    await saved(el);
    const screen = tableOrder(el)!.shadowRoot!;
    screen.querySelector<HTMLElement>('[data-draft-action="send-all"]')!.click();
    await flush(el);

    await publish(el, { Beer: "6.00" });
    expect(refresh(el)).toBeNull();
    screen.querySelector<HTMLElement>("[data-draft-dismiss]")!.click();
    await flush(el);
    await poll(el);

    expect(refreshText(el)).toContain("Beer €5.00 → €6.00");
  });

  it("asks nothing while the take-over question is open, and asks at the next poll once it is closed", async () => {
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

    expect(refreshText(el)).toContain("Beer €5.00 → €6.00");
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
    expect(rows(el)).toEqual(["Beer ×1", "Flan ×1"]);
    expect(refresh(el)).toBeNull();

    await poll(el);
    expect(refreshText(el)).toContain("Beer €6.00");
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
      return answer;
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

  async function pressAndRead(el: TillApp, action: string): Promise<string> {
    screen(el).querySelector<HTMLElement>(`[data-draft-action="${action}"]`)!.click();
    await flush(el);
    return screen(el)
      .querySelector("[data-preview-body]")!
      .textContent!.replace(/\s+/g, " ")
      .trim();
  }

  async function confirm(el: TillApp): Promise<void> {
    screen(el).querySelector<HTMLElement>("[data-draft-confirm]")!.click();
    await flush(el, 6);
  }

  it("shows a line the server alone flags, and Send all leaves it out with a message, sending the rest", async () => {
    server.unavailable.add("offer-flan");
    const { el } = await mountApp();
    await openMesa(el);
    await tap(el, "Beer");
    await tap(el, "Flan");
    await saved(el);

    expect(flagText(el)).toEqual([t("basket.blocked.server")]);
    expect(await pressAndRead(el, "send-all")).toContain(
      t("table.left_out_one").replace("{names}", "Flan ×1"),
    );
    await confirm(el);

    expect(sentNames()).toEqual(["offer-beer"]);
    expect(rows(el)).toEqual(["Flan ×1"]);
    expect(server.drafts[0]!.lines.map((line) => line.menuItemId)).toEqual(["offer-flan"]);
  });

  it("shows a line the till's own poll flags, and Fire all leaves it out", async () => {
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
      expect(await pressAndRead(el, "fire-all")).toContain(
        t("table.left_out_one").replace("{names}", "Flan ×1"),
      );
      await confirm(el);

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
        draftId: null,
        revision: 0,
        lines: [
          {
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
      expect(await pressAndRead(el, "fire-all")).toContain(t("table.nothing_sent"));
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
        expect(await pressAndRead(el, "send-all")).toContain(
          t("table.left_out_one").replace("{names}", "Flan ×1"),
        );
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

    expect(await pressAndRead(el, "send-all")).toContain(t("table.nothing_sent"));
    expect(screen(el).querySelector("[data-draft-confirm]")).toBeNull();
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
      expect(await pressAndRead(el, "fire-all")).toContain(t("table.nothing_sent"));
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
          applyRole: "staff",
          approverRole: "manager",
        },
      ]),
      previewAdjustment: vi.fn().mockResolvedValue({
        reduction: "17.25",
        nominalValue: "17.25",
        needsApproval: null,
        overBillDiscountLimit: false,
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
      },
      {
        expectedRevision: 0,
        lineId: "source-9",
        action: "cancel",
        reasonId: "mistake",
        note: "Duplicate order",
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
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(api.listAdjustmentReasons).not.toHaveBeenCalled();
    expect(api.applyAdjustment).not.toHaveBeenCalled();
    expect(rows(el)).toEqual([]);
  });

  it("Discard combines the source previews and requires the highest returned approval role", async () => {
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
          needsApproval: ask.lineId === "source-7" ? "admin" : "manager",
          overBillDiscountLimit: ask.lineId === "source-9",
          lines: [
            {
              lineId: ask.lineId,
              lineNo: ask.lineId === "source-7" ? 7 : 9,
              reduction: ask.lineId === "source-7" ? "17.25" : "8.63",
              rows: [],
            },
          ],
        })),
        listAdjustmentApprovers: vi
          .fn()
          .mockResolvedValue([{ personId: "admin-1", displayName: "Marta" }]),
      },
      [reference("source-9", "8.63", "1")],
    );
    await discardPreview(el, order);
    expect(adjustment(el)?.preview).toEqual({
      reduction: "25.88",
      nominalValue: "25.88",
      needsApproval: "admin",
      overBillDiscountLimit: true,
      lines: [
        { lineId: "source-7", lineNo: 7, reduction: "17.25", rows: [] },
        { lineId: "source-9", lineNo: 9, reduction: "8.63", rows: [] },
      ],
    });
    emit(adjustment(el)!, "adjust-confirm");
    await flush(el);
    expect(api.listAdjustmentApprovers).toHaveBeenCalledWith("admin");
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
      params: { approverRole: "manager" },
    });
    const { el, order } = await cancellationOpening({
      discardDraft,
      listAdjustmentApprovers: vi
        .fn()
        .mockResolvedValue([{ personId: "manager-1", displayName: "Marta" }]),
    });
    await discardPreview(el, order);
    emit(adjustment(el)!, "adjust-confirm");
    await flush(el, 6);
    expect(rows(el)).toEqual(["Recorded steak ×2"]);
    expect(adjustment(el)?.preview?.needsApproval).toBe("manager");
    expect(draft(el).editsLocked).toBe(true);
    emit(adjustment(el)!, "adjust-confirm");
    await flush(el);
    expect(api.listAdjustmentApprovers).toHaveBeenCalledWith("manager");
    expect(discardDraft).toHaveBeenCalledOnce();
  });

  it("Discard replaces a lower-role PIN prompt when the command requires a higher approver", async () => {
    const { el, order } = await cancellationOpening({
      discardDraft: vi.fn().mockRejectedValue({
        code: "adjustment.approval_required",
        params: { approverRole: "admin" },
      }),
      previewAdjustment: vi.fn().mockResolvedValue({
        reduction: "17.25",
        nominalValue: "17.25",
        needsApproval: "manager",
        overBillDiscountLimit: false,
        lines: [],
      }),
      listAdjustmentApprovers: vi.fn(async (role) => [
        { personId: `${role}-1`, displayName: role === "admin" ? "Alba" : "Marta" },
      ]),
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
    expect(adjustment(el)?.preview?.needsApproval).toBe("admin");
    expect(rows(el)).toEqual(["Recorded steak ×2"]);
    emit(adjustment(el)!, "adjust-confirm");
    await flush(el);
    expect(prompt()?.authorizers).toEqual([{ personId: "admin-1", displayName: "Alba" }]);
    expect(api.listAdjustmentApprovers!.mock.calls.map((call) => call[0])).toEqual([
      "manager",
      "admin",
    ]);
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
    expect(rows(el)).toEqual([]);
    expect(adjustment(el)).toBeNull();
    expect(banner(el)?.textContent).toContain("Luis");
    expect(server.drafts[0]!.lines).toHaveLength(1);
    expect(draft(el).editsLocked).toBe(false);
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
    expect(draft(el).lines[0]!.note).toBe("Keep this unsaved note");
    expect(draft(el).editsLocked).toBe(false);
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

  it("Discard of fresh dishes retains unsaved edits when its save is refused", async () => {
    const discardDraft = vi.fn();
    const { el } = await mountApp({ discardDraft });
    const order = await openMesa(el);
    await tap(el, "Beer");
    const review = order.shadowRoot!.querySelector<HTMLElement>("[data-review-open]");
    if (review?.checkVisibility()) await userEvent.click(review);
    await order.updateComplete;
    server.saveDraft.mockRejectedValue(new Error("Offline"));
    await userEvent.click(order.shadowRoot!.querySelector<HTMLElement>("[data-discard-draft]")!);
    await flush(el);
    expect(discardDraft).not.toHaveBeenCalled();
    expect(rows(el)).toEqual(["Beer ×1"]);
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
        needsApproval: "manager",
        overBillDiscountLimit: false,
        lines: [],
      }),
      listAdjustmentApprovers: vi
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
    expect(rows(el)).toEqual([]);
    expect(banner(el)?.textContent).toContain("Luis");
    expect(api.applyAdjustment).toHaveBeenCalledOnce();
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

  it("source cancellation keeps prior edits when their save fails and sends no money command", async () => {
    const { el } = await cancellationOpening();
    draft(el).setLineExtras(0, { note: "No salt" });
    server.saveDraft.mockRejectedValueOnce(new Error("Offline"));
    draft(el).removeLine(0);
    await flush(el, 6);
    expect(rows(el)).toEqual(["Recorded steak ×2"]);
    expect(draft(el).lines[0]!.note).toBe("No salt");
    expect(adjustment(el)).toBeNull();
    expect(banner(el)?.textContent).toContain(t("table.draft_save_failed"));
    expect(api.listAdjustmentReasons).not.toHaveBeenCalled();
    expect(api.applyAdjustment).not.toHaveBeenCalled();
    expect(draft(el).sending).toBe(false);
    expect(draft(el).editsLocked).toBe(false);
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
    expect(old.editsLocked).toBe(false);
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
    const button = order.shadowRoot!.querySelector<HTMLElement>("[data-split-draft-line='0']")!;
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
      { submissionId: expect.any(String), expectedPartyRevision: 3 },
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
      return { tabId: "wo-4", revision: 5, groups: [], draft: null };
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
    expect(button.shadowRoot!.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
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
    expect(rows(el)).toEqual([]);
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
    const next = tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>(
      "[data-split-draft-line='0']",
    )!;
    expect(next.shadowRoot!.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
    emit(tableOrder(el)!, "split-draft-source", old);
    await flush(el);
    expect(split).toHaveBeenCalledOnce();
  });

  it("does not send a source removed by the pending save's authoritative answer", async () => {
    const split = vi.fn().mockResolvedValue({ revision: 4 });
    const { el, button } = await opening(split);
    api.saveDraft.mockImplementationOnce(async (partyId, ask) => {
      const saved = server.save(partyId, ask);
      saved.lines = [];
      return structuredClone(saved);
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
      return structuredClone(server.save(partyId, ask));
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
    expect(draft(el).lines[0]!.note).toBe("No pepper");
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
      await userEvent.click(order.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!);
      await order.updateComplete;
      const button = order.shadowRoot!.querySelector<HTMLElement>("[data-recall-line='7']");
      expect(button).not.toBeNull();
      await userEvent.click(button!);
      await flush(el, 6);
      expect(api.recallToDraft).toHaveBeenCalledWith(
        "v1",
        "source-7",
        {
          expectedPartyRevision: 3,
          submissionId: expect.any(String),
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

    it("saves preceding fresh edits before Recall and sends a repeated press only once", async () => {
      const { el, order } = await recallOpening();
      await tap(el, "Beer");
      let release!: () => void;
      api.saveDraft.mockImplementationOnce(async (partyId, ask) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return structuredClone(server.save(partyId, ask));
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

    it("retains the fresh edit and does not Recall when its preceding save fails", async () => {
      const { el, order } = await recallOpening();
      await tap(el, "Beer");
      api.saveDraft.mockRejectedValue(new TypeError("offline"));
      emit(order, "recall-lines", { lineNos: [7] });
      await flush(el, 6);
      expect(api.saveDraft).toHaveBeenCalledOnce();
      expect(api.recallToDraft).not.toHaveBeenCalled();
      expect(api.recallLines).not.toHaveBeenCalled();
      expect(rows(el)).toEqual(["Beer ×1"]);
      expect(banner(el)?.textContent).toContain(t("table.draft_save_failed"));
      expect(draft(el).sending).toBe(false);
    });
    it("retains this owner's fresh dishes and another owner's separate draft", async () => {
      const other = server.save("v1", { draftId: null, revision: 0, billId: "wo-4", lines: [] });
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
      expect(order.otherDrafts.map((each) => each.ownerName)).toEqual(["Luis"]);
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
            { expectedPartyRevision: 4, submissionId: expect.any(String) },
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
