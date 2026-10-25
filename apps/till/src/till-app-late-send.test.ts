import { deviceZonesFixture } from "../test/device-zones.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, draftServer, mountWidget } from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import { setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { FormFactor, CapabilityFlag } from "./layout.js";
import { menuOfferToTillProduct } from "./api/client.js";
import type {
  DraftSubmission,
  MenuState,
  RecalledDraftLine,
  TillApi,
  TillMenuOffer,
  TillSaleResult,
  ZoneOfferCatalogue,
} from "./api/client.js";
import type { WorkingOrderStore } from "./state/working-order.js";
import { DRAFT_SAVE_DELAY_MS } from "./state/draft-sync.js";
import { HOME_DISPLAY_DEFAULTS } from "@waitron/catalogue/src/device-home.js";
import type { AllergySendTarget } from "@waitron/module";
import {
  addDish as addSteak,
  allergyView,
  api as allergyApi,
  catalogue as allergyCatalogue,
  dialog as allergyDialog,
  draft as allergyDraft,
  mountApp as mountAllergyApp,
  openTable as openAllergyTable,
  resetAllergyFixture,
  server as allergyServer,
  tableOrder as allergyOrder,
} from "../test/allergy-app-fixture.js";

interface Menu {
  id: string;
  name: string;
  products: string[];
}
/** Breakfast's menu; its Coffee is also sold by Lunch, as a running menu sells a drink. */
const BREAKFAST_MENU: Menu = {
  id: "breakfast-menu",
  name: "Breakfast menu",
  products: ["Omelette", "Coffee"],
};
const LUNCH: Menu = { id: "lunch", name: "Lunch", products: ["Steak", "Coffee"] };

const unit = {
  staffName: "Staff unit",
  staffAbbreviation: "su",
  id: "unit-each",
  name: { es: "unidad", en: "unit" },
  abbreviation: { es: "ud", en: "ea" },
  precision: 0,
  hardwareUnit: null,
};

const offerId = (menu: Menu, product: string) => `offer-${menu.id}-${product.toLowerCase()}`;

function offer(menu: Menu, product: string): TillMenuOffer {
  return {
    id: offerId(menu, product),
    menuId: menu.id,
    productId: product,
    grossPrice: null,
    unitPrice: "3.00",
    available: true,
    image: null,
    description: null,
    menuName: menu.name,
    placements: [[]],
    name: product,
    customerName: { en: product },
    kitchenName: product,
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
  } satisfies TillMenuOffer;
}

const breakfastRunning = {
  open: true,
  zoneOpen: true,
  periodName: "Breakfast",
  periodOccurrenceKey: '["department","2026-10-12","Breakfast","08:00"]',
  keepOpen: null,
  zoneKeepOpen: null,
};
const lunchRunning = {
  ...breakfastRunning,
  periodName: "Lunch",
  periodOccurrenceKey: '["department","2026-10-12","Lunch","12:00"]',
};

/** Breakfast running with the Breakfast menu orderable, or Lunch running with Breakfast ended earlier today. */
function catalogue(
  phase: "breakfast" | "lunch",
  zoneId = "zone-dining-room",
  serviceMode: ZoneOfferCatalogue["context"]["serviceMode"] = "table_tab",
): ZoneOfferCatalogue {
  const running = phase === "breakfast" ? BREAKFAST_MENU.id : LUNCH.id;
  return {
    service: phase === "breakfast" ? breakfastRunning : lunchRunning,
    context: {
      departmentName: "Restaurant",
      zoneId,
      departmentId: "department-restaurant",
      serviceMode,
    },
    defaultMenuId: running,
    menus: [BREAKFAST_MENU, LUNCH].map((menu) => ({
      id: menu.id,
      name: menu.name,
      isDefault: menu.id === running,
      orderable: menu.id === running,
      endedPeriodName: phase === "lunch" && menu.id === BREAKFAST_MENU.id ? "Breakfast" : null,
      audience: "customer",
      versionId: "v1",
      structure: {
        members: menu.products.map((product) => ({
          kind: "product" as const,
          menuItemId: offerId(menu, product),
          productId: product,
        })),
      },
      home: {
        shortcuts: [],
        handheld: HOME_DISPLAY_DEFAULTS.handheld,
        till: HOME_DISPLAY_DEFAULTS.till,
      },
    })),
    offers: [BREAKFAST_MENU, LUNCH].flatMap((menu) => menu.products.map((p) => offer(menu, p))),
    zones: [
      {
        id: "zone-dining-room",
        name: "Dining room",
        departmentId: "department-restaurant",
        departmentName: "Restaurant",
        serviceMode: "table_tab",
      },
    ],
  };
}

function polled(current: ZoneOfferCatalogue): MenuState & { defaultMenuId?: string } {
  return {
    service: current.service,
    menus: current.menus.map((menu) => ({
      menuId: menu.id,
      versionId: menu.versionId,
      orderable: menu.orderable,
      endedPeriodName: menu.endedPeriodName,
    })),
    unavailable: { products: [], optionLabels: [] },
    ...(current.defaultMenuId === null ? {} : { defaultMenuId: current.defaultMenuId }),
  };
}

/** The counter's zone, which stays on Breakfast's menus throughout. */
const BAR = catalogue("breakfast", "zone-bar", "prepay");

const tableFormFactor: FormFactor = "till";

const till = {
  locale: "en-GB",
  invoiceLocale: "es-ES",
  venueName: "Casa Delgado",
  nif: "B12345678",
  orderFlow: "prepay" as const,
  receiptPrintMode: "auto" as const,
  fireControl: "waiter" as const,
  courses: [],
  cardProvider: "none" as const,
  tipsEnabled: false,
  formFactor: tableFormFactor,
  capabilities: ["print-receipt", "take-cash"] as CapabilityFlag[],
  inactivityTimeoutSeconds: null,
  nodeId: "n1",
  servers: [],
};

const table = {
  id: "t2",
  label: "2",
  zoneId: "zone-dining-room",
  state: "open-tab",
  hasOpenTab: true,
  tabLineCount: 0,
  tabTotal: "0.00",
  pendingDeliveries: 0,
  pendingToServe: 0,
  readyToServe: 0,
  timingBand: "fresh",
  nextReservation: null,
  today: null,
  signals: [],
  party: {
    kitchenNote: { scope: { partyId: "party-a" }, note: null, revision: 0, ownerRevision: 1 },
    id: "party-a",
    revision: 1,
    guestCount: 2,
    state: "open" as const,
    mainBillId: "wo-7",
    outstanding: "0.00",
    billCount: 1,
    tableIds: ["t2"],
    unsentDrafts: [],
    reminder: null,
  },
};

let drafts: ReturnType<typeof draftServer>;
let api: Record<string, ReturnType<typeof vi.fn>>;
let current: ZoneOfferCatalogue;

function stubApi(overrides: Record<string, unknown> = {}) {
  return {
    getDeviceZones: vi
      .fn()
      .mockResolvedValue(deviceZonesFixture(["zone-bar"], ["z1", "zone-dining-room"])),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "en", languages: ["en", "es"] }),
    getKitchenNote: vi.fn(async (scope: { workingOrderId: string } | { partyId: string }) => ({
      scope,
      note: null,
      revision: 0,
      ownerRevision: 0,
    })),
    getTill: vi.fn().mockResolvedValue(till),
    getLocales: vi.fn().mockResolvedValue({ locales: [], venueDefault: "es-ES" }),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "till-dev",
      name: "Till 1",
      formFactor: "till",
    }),
    listStaff: vi.fn().mockResolvedValue([]),
    listDefaultZoneOffers: vi.fn(async () => BAR),
    listZoneOffers: vi.fn(async (zoneId: string) =>
      zoneId === "zone-dining-room" ? current : BAR,
    ),
    menuState: vi.fn(async (zoneId: string) =>
      polled(zoneId === "zone-dining-room" ? current : BAR),
    ),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    logout: vi.fn().mockResolvedValue(undefined),
    getTablesState: vi.fn().mockResolvedValue([table]),
    listZones: vi.fn().mockResolvedValue([
      {
        id: "zone-dining-room",
        name: "Dining room",
        displayOrder: 0,
        active: true,
        serviceMode: "table_tab",
      },
    ]),
    getTabLines: vi.fn().mockResolvedValue({ lines: [], revision: 0 }),
    previewPartyAllergy: vi.fn(async (partyId: string) => ({
      partyId,
      snapshot: {
        answer: "none",
        guests: [],
        ticks: [],
        changedAt: null,
        changedBy: null,
        revision: table.party.revision,
      },
      dishes: [],
    })),
    listDrafts: drafts.listDrafts,
    saveDraft: drafts.saveDraft,
    submitDraft: drafts.submitDraft,
    ...overrides,
  } as Record<string, ReturnType<typeof vi.fn>>;
}

async function mountApp(overrides: Record<string, unknown> = {}) {
  api = stubApi(overrides);
  return mountWidget<TillApp>("till-app", { api: api as unknown as TillApi });
}

/** Settles awaited API promises (the real `setTimeout` is not faked) and Lit's render. */
async function flush(el: TillApp, rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
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

const lock = (el: TillApp) => el.shadowRoot!.querySelector<TillLockScreen>("till-lock-screen")!;
const screen = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen")!.shadowRoot!;
/** The draft's store, read from the menu browser before it gives way to the order's review. */
let store: WorkingOrderStore;
const windowOf = (el: TillApp) => el.shadowRoot!.querySelector("till-late-send-dialog");
const windowDishes = (el: TillApp) =>
  [...windowOf(el)!.shadowRoot!.querySelectorAll("li")].map((li) => li.textContent?.trim());
const names = () => store.lines.map((line) => line.product.name);
const submissions = () => api.submitDraft!.mock.calls.map((call) => call[2] as DraftSubmission);

/** Seats table 2 under Breakfast and orders an Omelette and a Coffee from the Breakfast menu; no poll has
 * yet told the till that Breakfast ended, so nothing is marked. */
async function breakfastTable(overrides: Record<string, unknown> = {}): Promise<TillApp> {
  current = catalogue("breakfast");
  const { el } = await mountApp(overrides);
  await flush(el);
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
  await flush(el);
  emit(el.shadowRoot!.querySelector("till-shell")!, "screen-select", { screen: "floor" });
  await flush(el);
  emit(el.shadowRoot!.querySelector("till-floor-screen")!, "open-table", {
    tableId: "t2",
    seated: true,
  });
  await flush(el);
  store = screen(el).querySelector<HTMLElement & { store: WorkingOrderStore }>(
    "till-menu-browser",
  )!.store;
  for (const product of ["Omelette", "Coffee"])
    store.addProduct(menuOfferToTillProduct(offer(BREAKFAST_MENU, product), "v1"), "1");
  await flush(el);
  return el;
}

/** As `breakfastTable`, then lets Lunch start: the Omelette is marked "Breakfast ended", the Coffee
 * is not, because Lunch sells it too. */
async function lateTable(overrides: Record<string, unknown> = {}): Promise<TillApp> {
  const el = await breakfastTable(overrides);
  current = catalogue("lunch");
  await poll(el);
  expect(store.lines.map((line) => line.endedPeriod)).toEqual([
    { menuId: BREAKFAST_MENU.id, periodName: "Breakfast" },
    undefined,
  ]);
  return el;
}

async function act(el: TillApp, kind: "send-all" | "fire-selected"): Promise<void> {
  screen(el).querySelector<HTMLElement>(`[data-draft-action="${kind}"]`)!.click();
  await flush(el, 6);
}

async function tick(el: TillApp, name: string): Promise<void> {
  [...screen(el).querySelectorAll<HTMLElement>("[data-draft-select]")]
    .find((button) => button.textContent!.includes(name))!
    .click();
  await flush(el);
}

async function choose(el: TillApp, button: "data-late-remove" | "data-late-agreed"): Promise<void> {
  windowOf(el)!.shadowRoot!.querySelector<HTMLElement>(`[${button}]`)!.click();
  await flush(el, 6);
}

beforeEach(() => {
  for (const key of Object.keys(localStorage))
    if (key.startsWith("waitron.zoneMenu.")) localStorage.removeItem(key);
  setLocale("en-GB");
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  drafts = draftServer(() => ({ tabId: "wo-7", revision: 2, groups: [] }));
  drafts.bills.add("wo-7");
});
afterEach(() => {
  cleanupWidgets();
  vi.useRealTimers();
  sessionStorage.removeItem("waitron.lastMenu");
});

describe("a table's send from the marks", () => {
  it("asks about the marked dish alone before Send all sends anything", async () => {
    const el = await lateTable();

    await act(el, "send-all");

    expect(windowDishes(el)).toEqual(["1× Omelette"]);
    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(names()).toEqual(["Omelette", "Coffee"]);
  });

  it("sends both dishes once the kitchen agreed, carrying the ended menu, and does not ask again", async () => {
    const el = await lateTable();
    await act(el, "send-all");

    await choose(el, "data-late-agreed");

    expect(windowOf(el)).toBeNull();
    expect(submissions()).toHaveLength(1);
    expect(submissions()[0]!.lateSend).toEqual({ menuIds: [BREAKFAST_MENU.id] });
    expect(
      drafts
        .sentGroups(submissions()[0]!)
        .flatMap((group) => group.lines.map((line) => line.menuItemId))
        .sort(),
    ).toEqual([offerId(BREAKFAST_MENU, "Coffee"), offerId(BREAKFAST_MENU, "Omelette")]);
  });

  it("keeps the confirmation on the send it repeats after a menu version change", async () => {
    const el = await lateTable({
      submitDraft: vi.fn(drafts.submitDraft).mockRejectedValueOnce({
        code: "menu.version_changed",
        status: 409,
        menus: [{ menuId: LUNCH.id, liveVersionId: "v1" }],
      }),
    });
    await act(el, "send-all");

    await choose(el, "data-late-agreed");

    expect(windowOf(el)).toBeNull();
    expect(submissions()).toHaveLength(2);
    expect(submissions().map((each) => each.lateSend)).toEqual([
      { menuIds: [BREAKFAST_MENU.id] },
      { menuIds: [BREAKFAST_MENU.id] },
    ]);
  });

  it("takes the marked dish out of the draft on Remove them and sends nothing", async () => {
    const el = await lateTable();
    await act(el, "send-all");

    await choose(el, "data-late-remove");

    expect(windowOf(el)).toBeNull();
    expect(names()).toEqual(["Coffee"]);
    expect(api.submitDraft).not.toHaveBeenCalled();
    const saves = api.saveDraft!.mock.calls.length;
    await vi.waitFor(
      () => {
        expect(api.saveDraft!.mock.calls.length).toBeGreaterThan(saves);
        const saved = api.saveDraft!.mock.calls.at(-1)![1] as { lines: { menuItemId: string }[] };
        expect(saved.lines.map((line) => line.menuItemId)).toEqual([
          offerId(BREAKFAST_MENU, "Coffee"),
        ]);
      },
      { timeout: DRAFT_SAVE_DELAY_MS * 5 },
    );
  });

  it("keeps the dish when the draft can no longer be edited, and closes the window", async () => {
    const el = await lateTable();
    await act(el, "send-all");
    store.lockEdits();

    await choose(el, "data-late-remove");

    expect(windowOf(el)).toBeNull();
    expect(names()).toEqual(["Omelette", "Coffee"]);
    expect(api.submitDraft).not.toHaveBeenCalled();
  });

  it("asks again when a dish it sends was marked for a menu the confirmation does not name", async () => {
    const el = await lateTable();
    await act(el, "send-all");
    store.setEndedPeriods(
      [
        { menuId: BREAKFAST_MENU.id, periodName: "Breakfast" },
        { menuId: "brunch", periodName: "Brunch" },
      ],
      false,
    );

    await choose(el, "data-late-agreed");

    expect(api.submitDraft).not.toHaveBeenCalled();
    // The window lists the dishes in the order they are sent, the Coffee first.
    expect(windowDishes(el)).toEqual(["1× Coffee", "1× Omelette"]);
    expect(windowOf(el)!.shadowRoot!.querySelector("wt-dialog")!.heading).toBe(
      "Brunch and Breakfast have ended",
    );
    await choose(el, "data-late-agreed");
    expect(submissions().map((each) => each.lateSend)).toEqual([
      { menuIds: ["brunch", BREAKFAST_MENU.id] },
    ]);
  });

  it("closes on sign-out, and leaves nothing to send in the next session", async () => {
    const el = await lateTable();
    await act(el, "send-all");
    const order = el.shadowRoot!.querySelector("till-table-order-screen")!;

    emit(order, "logout");
    await flush(el, 6);

    expect(windowOf(el)).toBeNull();
    emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
    await flush(el);
    emit(el.shadowRoot!.querySelector("till-shell")!, "screen-select", { screen: "floor" });
    await flush(el);
    emit(el.shadowRoot!.querySelector("till-floor-screen")!, "open-table", {
      tableId: "t2",
      seated: true,
    });
    await flush(el, 6);
    expect(windowOf(el)).toBeNull();
    expect(api.submitDraft).not.toHaveBeenCalled();
  });

  it("sends nothing and removes nothing on Escape", async () => {
    const el = await lateTable();
    await act(el, "send-all");
    const dialog = windowOf(el)!.shadowRoot!.querySelector("wt-dialog")!;
    const closed = new Promise((resolve) =>
      dialog.addEventListener("wt-close", resolve, { once: true }),
    );

    await userEvent.keyboard("{Escape}");
    await closed;
    await flush(el);

    expect(windowOf(el)).toBeNull();
    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(names()).toEqual(["Omelette", "Coffee"]);
  });

  it("fires the selected unmarked dish without asking or carrying a confirmation", async () => {
    const el = await lateTable();
    await tick(el, "Coffee");

    await act(el, "fire-selected");

    expect(windowOf(el)).toBeNull();
    expect(submissions()).toHaveLength(1);
    expect(submissions()[0]).not.toHaveProperty("lateSend");
  });

  it("lists only the marked dish when both are selected for Fire selected", async () => {
    const el = await lateTable();
    await tick(el, "Omelette");
    await tick(el, "Coffee");

    await act(el, "fire-selected");

    expect(windowDishes(el)).toEqual(["1× Omelette"]);
    expect(api.submitDraft).not.toHaveBeenCalled();
  });
});

/** The server's 409 for dishes it finds late that the till had not marked (D21's params). */
function refusal(periods: readonly { menuId: string; periodName: string }[], items: string[]) {
  return {
    code: "menu_period.ended",
    status: 409,
    departmentId: "department-restaurant",
    menus: periods,
    menuItemIds: items,
    needsManager: false,
  };
}
const BREAKFAST_ENDED = refusal(
  [{ menuId: BREAKFAST_MENU.id, periodName: "Breakfast" }],
  [offerId(BREAKFAST_MENU, "Omelette")],
);

/** An Omelette sent earlier and recalled into Ana's draft on table 2. */
function seedRecalledOmelette(): void {
  const line: RecalledDraftLine["source"]["line"] = {
    changesAfterSending: null,
    id: "sent-omelette",
    name: "Omelette",
    productId: "Omelette",
    parentProductId: null,
    menuItemId: offerId(BREAKFAST_MENU, "Omelette"),
    lineNo: 1,
    parentLineNo: null,
    quantity: "1",
    priceQuantity: "1",
    unitPrecision: 0,
    unitPriceGross: "3.00",
    listUnitPriceGross: "3.00",
    servedAt: null,
    courseId: null,
    sentAt: null,
    firedAt: null,
    state: null,
    stationId: null,
    movable: true,
    groupId: null,
    note: null,
    listId: null,
  };
  drafts.drafts.push({
    id: "draft-recalled",
    partyId: "party-a",
    billId: "wo-7",
    ownerId: "p1",
    ownerName: "Ana",
    revision: 2,
    takenOverFrom: null,
    lines: [
      {
        id: "reference-sent-omelette",
        sourceLineId: "sent-omelette",
        source: { line, extras: [], netAmount: "2.48" },
        quantity: "1",
        note: null,
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
}

const heading = (el: TillApp) => windowOf(el)!.shadowRoot!.querySelector("wt-dialog")!.heading;

describe("a table's send from the refusal", () => {
  it("opens the window from a refusal the till had not marked, and Kitchen agreed sends the refused menu", async () => {
    const el = await breakfastTable({
      submitDraft: vi.fn(drafts.submitDraft).mockRejectedValueOnce(BREAKFAST_ENDED),
    });
    expect(store.lines.map((line) => line.endedPeriod)).toEqual([undefined, undefined]);

    await act(el, "send-all");

    expect(windowDishes(el)).toEqual(["1× Omelette"]);
    expect(heading(el)).toBe("Breakfast has ended");
    expect(submissions()).toHaveLength(1);
    expect(submissions()[0]).not.toHaveProperty("lateSend");
    expect(store.sending).toBe(false);

    await choose(el, "data-late-agreed");

    expect(windowOf(el)).toBeNull();
    expect(submissions()).toHaveLength(2);
    expect(submissions()[1]!.lateSend).toEqual({ menuIds: [BREAKFAST_MENU.id] });
  });

  it("opens the window again from a second refusal naming another period", async () => {
    const el = await breakfastTable({
      submitDraft: vi
        .fn(drafts.submitDraft)
        .mockRejectedValueOnce(BREAKFAST_ENDED)
        .mockRejectedValueOnce(
          refusal(
            [{ menuId: "brunch", periodName: "Brunch" }],
            [offerId(BREAKFAST_MENU, "Omelette")],
          ),
        ),
    });
    await act(el, "send-all");

    await choose(el, "data-late-agreed");

    expect(windowDishes(el)).toEqual(["1× Omelette"]);
    expect(heading(el)).toBe("Brunch has ended");
    await choose(el, "data-late-agreed");
    expect(submissions().map((each) => each.lateSend)).toEqual([
      undefined,
      { menuIds: [BREAKFAST_MENU.id] },
      { menuIds: ["brunch"] },
    ]);
  });

  it("lists the fresh dish alone, and Remove keeps the recalled dish and the Coffee", async () => {
    seedRecalledOmelette();
    const el = await breakfastTable({
      submitDraft: vi.fn(drafts.submitDraft).mockRejectedValueOnce(BREAKFAST_ENDED),
    });
    expect(store.lines.map((line) => line.source?.line.id)).toEqual([
      "sent-omelette",
      undefined,
      undefined,
    ]);
    await act(el, "send-all");
    expect(windowDishes(el)).toEqual(["1× Omelette"]);

    await choose(el, "data-late-remove");

    expect(windowOf(el)).toBeNull();
    expect(store.lines.map((line) => line.source?.line.id ?? line.product.name)).toEqual([
      "sent-omelette",
      "Coffee",
    ]);
    expect(submissions()).toHaveLength(1);
  });

  it("shows the code's sentence when the refusal names none of the sent dishes", async () => {
    const el = await breakfastTable({
      submitDraft: vi
        .fn(drafts.submitDraft)
        .mockRejectedValueOnce(
          refusal([{ menuId: BREAKFAST_MENU.id, periodName: "Breakfast" }], ["offer-elsewhere"]),
        ),
    });

    await act(el, "send-all");

    expect(windowOf(el)).toBeNull();
    expect(el.shadowRoot!.querySelector(".error")?.textContent?.trim()).toBe(
      codeMessage("menu_period.ended"),
    );
    expect(names()).toEqual(["Omelette", "Coffee"]);
    expect(store.sending).toBe(false);
  });

  it("opens the same window on a handheld's Send", async () => {
    const handheld = { ...till, formFactor: "phone-portrait" as FormFactor };
    const el = await breakfastTable({
      getTill: vi.fn().mockResolvedValue(handheld),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "till-dev", name: "Móvil", formFactor: "phone-portrait" }),
      submitDraft: vi.fn(drafts.submitDraft).mockRejectedValueOnce(BREAKFAST_ENDED),
    });
    expect(
      el.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen")!.handheld,
    ).toBe(true);

    await act(el, "send-all");

    expect(windowDishes(el)).toEqual(["1× Omelette"]);
    await choose(el, "data-late-agreed");
    expect(submissions().map((each) => each.lateSend)).toEqual([
      undefined,
      { menuIds: [BREAKFAST_MENU.id] },
    ]);
  });
});

describe("an allergy party's send refused for an ended period", () => {
  beforeEach(() => resetAllergyFixture());

  it("closes the allergy dialog and opens the late-send window", async () => {
    const lunchEnded = refusal([{ menuId: "lunch", periodName: "Lunch" }], ["offer-steak"]);
    const { el } = await mountAllergyApp({
      submitDraft: vi
        .fn<TillApi["submitDraft"]>()
        .mockRejectedValueOnce(lunchEnded)
        .mockImplementation((id, did, packet) => allergyServer.submitDraft(id, did, packet)),
    });
    await openAllergyTable(el);
    await addSteak(el);
    await userEvent.click(
      allergyOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
    );
    await vi.waitFor(() => expect(allergyDialog(el)).not.toBeNull());

    await userEvent.click(
      allergyDialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!,
    );

    await vi.waitFor(() => expect(windowOf(el)).not.toBeNull());
    expect(allergyDialog(el)).toBeNull();
    expect(windowDishes(el)).toEqual(["1× Steak"]);
    expect(heading(el)).toBe("Lunch has ended");
  });

  it("sends the allergy answer already given on Kitchen agreed, without asking again", async () => {
    const lunchEnded = refusal([{ menuId: "lunch", periodName: "Lunch" }], ["offer-steak"]);
    const submitDraft = vi
      .fn<TillApi["submitDraft"]>()
      .mockRejectedValueOnce(lunchEnded)
      .mockImplementation((id, did, packet) => allergyServer.submitDraft(id, did, packet));
    const { el } = await mountAllergyApp({ submitDraft });
    await openAllergyTable(el);
    await addSteak(el);
    await sendWithAllergy(el, "Blue shirt");
    await vi.waitFor(() => expect(windowOf(el)).not.toBeNull());

    await choose(el, "data-late-agreed");

    await vi.waitFor(() => expect(submitDraft).toHaveBeenCalledTimes(2));
    await flush(el, 6);
    expect(allergyDialog(el)).toBeNull();
    expect(windowOf(el)).toBeNull();
    const [first, rerun] = submitDraft.mock.calls.map((call) => call[2]);
    expect(first!.allergy?.party?.guests).toEqual([
      expect.objectContaining({ who: "Blue shirt", allergens: { milk: {} } }),
    ]);
    expect(rerun!.allergy).toEqual(first!.allergy);
    expect(rerun!.expectedPartyRevision).toBe(first!.expectedPartyRevision);
    expect(rerun!.lateSend).toEqual({ menuIds: ["lunch"] });
  });
});

describe("an allergy party's rerun reads the party again", () => {
  beforeEach(() => resetAllergyFixture());

  it("previews the party's allergy question again on Kitchen agreed, and sends without asking when it needs none", async () => {
    const lunchEnded = refusal([{ menuId: "lunch", periodName: "Lunch" }], ["offer-steak"]);
    const submitDraft = vi
      .fn<TillApi["submitDraft"]>()
      .mockRejectedValueOnce(lunchEnded)
      .mockImplementation((id, did, packet) => allergyServer.submitDraft(id, did, packet));
    const previewPartyAllergy = vi.fn(async (_id: string, target: AllergySendTarget) =>
      allergyView("none", target),
    );
    const { el } = await mountAllergyApp({ submitDraft, previewPartyAllergy });
    await openAllergyTable(el);
    await addSteak(el);
    await userEvent.click(
      allergyOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
    );
    await vi.waitFor(() => expect(windowOf(el)).not.toBeNull());

    await choose(el, "data-late-agreed");

    await vi.waitFor(() => expect(submitDraft).toHaveBeenCalledTimes(2));
    expect(previewPartyAllergy).toHaveBeenCalledTimes(2);
    expect(allergyDialog(el)).toBeNull();
    expect(submitDraft.mock.calls.map((call) => call[2].allergy)).toEqual([undefined, undefined]);
  });
});

/** Sends, and answers the allergy question with one guest, `who`, allergic to milk. */
async function sendWithAllergy(el: TillApp, who: string): Promise<void> {
  await userEvent.click(
    allergyOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
  );
  await answerAllergy(el, who);
}

async function answerAllergy(el: TillApp, who: string): Promise<void> {
  await vi.waitFor(() => expect(allergyDialog(el)).not.toBeNull());
  const form = allergyDialog(el)!;
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-allergies]")!);
  await userEvent.fill(
    form
      .shadowRoot!.querySelector('wt-input[name="guest-0-who"]')!
      .shadowRoot!.querySelector("input")!,
    who,
  );
  await userEvent.click(form.shadowRoot!.querySelector<HTMLInputElement>('[data-code="milk"]')!);
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
}

const MANAGER_NEEDED = {
  code: "authorization.not_permitted",
  status: 403,
  permission: "venue_service.manage",
};
const WRONG_PIN = { code: "pin.invalid", status: 401 };
const MARTA = { personId: "p-marta", displayName: "Marta" };
const approval = (el: TillApp) => el.shadowRoot!.querySelector("till-supervisor-override-dialog");
const approvalText = (el: TillApp, selector: string) =>
  approval(el)!.shadowRoot!.querySelector(selector)?.textContent?.trim();

/** Picks Marta when the dialog still asks who approves, then types `digits` on the keypad. */
async function typePin(el: TillApp, digits: string): Promise<void> {
  const override = approval(el)!;
  override.shadowRoot!.querySelector<HTMLElement>(`[data-person="${MARTA.personId}"]`)?.click();
  await override.updateComplete;
  for (const digit of digits) {
    override
      .shadowRoot!.querySelector("till-numeric-pad")!
      .shadowRoot!.querySelector<HTMLElement>(`[data-key="${digit}"]`)!
      .click();
    await override.updateComplete;
  }
}

async function authorize(el: TillApp, digits: string): Promise<void> {
  await typePin(el, digits);
  approval(el)!.shadowRoot!.querySelector<HTMLElement>(".authorize")!.click();
  await flush(el, 6);
}

/** A table whose Kitchen agreed was refused for want of a manager. */
async function managerAsked(...answers: unknown[]): Promise<TillApp> {
  const submitDraft = vi.fn(drafts.submitDraft).mockRejectedValueOnce(MANAGER_NEEDED);
  for (const answer of answers) submitDraft.mockRejectedValueOnce(answer);
  const el = await lateTable({
    submitDraft,
    serviceDayAuthorizers: vi.fn().mockResolvedValue([MARTA]),
  });
  await act(el, "send-all");
  await choose(el, "data-late-agreed");
  await vi.waitFor(() => expect(approval(el)).not.toBeNull());
  return el;
}

describe("a manager's PIN", () => {
  it("asks for a manager when the department needs one, and sends again with their PIN", async () => {
    const el = await managerAsked();

    expect(api.serviceDayAuthorizers).toHaveBeenCalledTimes(1);
    expect(approvalText(el, ".prompt")).toBe("Choose a manager");
    expect(windowOf(el)).toBeNull();
    await authorize(el, "0123");

    expect(submissions().map((each) => each.lateSend)).toEqual([
      { menuIds: [BREAKFAST_MENU.id] },
      { menuIds: [BREAKFAST_MENU.id], override: { personId: MARTA.personId, pin: "0123" } },
    ]);
    expect(approval(el)).toBeNull();
    expect(windowOf(el)).toBeNull();
  });

  it("keeps Send busy while the managers are read, so a second Send opens no window under the PIN dialog", async () => {
    let answer!: (managers: (typeof MARTA)[]) => void;
    const el = await lateTable({
      submitDraft: vi.fn(drafts.submitDraft).mockRejectedValueOnce(MANAGER_NEEDED),
      serviceDayAuthorizers: vi.fn(() => new Promise((resolve) => (answer = resolve))),
    });
    await act(el, "send-all");
    await choose(el, "data-late-agreed");
    expect(api.serviceDayAuthorizers).toHaveBeenCalledOnce();
    await userEvent.click(screen(el).querySelector<HTMLElement>("[data-review-open]")!);
    await flush(el);

    const send = screen(el).querySelector<HTMLElement>('[data-draft-action="send-all"]')!;
    expect(send.hasAttribute("disabled")).toBe(true);
    await userEvent.click(send, { force: true });
    await flush(el, 6);
    expect(windowOf(el)).toBeNull();

    answer([MARTA]);
    await flush(el, 6);
    expect(approval(el)).not.toBeNull();
    expect(windowOf(el)).toBeNull();
    expect(submissions()).toHaveLength(1);
  });

  it("keeps the dialog open on a wrong PIN, and closes it once a right one sends", async () => {
    const el = await managerAsked(WRONG_PIN);
    await authorize(el, "0123");

    expect(approval(el)).not.toBeNull();
    expect(approvalText(el, ".error")).toBe("Wrong PIN, try again");
    expect(el.shadowRoot!.querySelector(".error")).toBeNull();
    await authorize(el, "4567");

    expect(submissions().map((each) => each.lateSend?.override)).toEqual([
      undefined,
      { personId: MARTA.personId, pin: "0123" },
      { personId: MARTA.personId, pin: "4567" },
    ]);
    expect(approval(el)).toBeNull();
    expect(windowOf(el)).toBeNull();
  });

  it("sends nothing more on Cancel", async () => {
    const el = await managerAsked();

    approval(el)!.shadowRoot!.querySelector<HTMLElement>(".cancel")!.click();
    await flush(el, 6);

    expect(approval(el)).toBeNull();
    expect(submissions()).toHaveLength(1);
    expect(names()).toEqual(["Omelette", "Coffee"]);
  });

  it("asks Keep or Discard on Escape once digits are typed", async () => {
    const el = await managerAsked();
    await typePin(el, "01");

    await userEvent.keyboard("{Escape}");
    await flush(el);

    const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await question.updateComplete;
    expect(question.open).toBe(true);
    expect(approval(el)).not.toBeNull();
    expect(submissions()).toHaveLength(1);
  });

  it("shows the read's refusal and opens no dialog when the managers cannot be read", async () => {
    const el = await lateTable({
      submitDraft: vi.fn(drafts.submitDraft).mockRejectedValueOnce(MANAGER_NEEDED),
      serviceDayAuthorizers: vi.fn().mockRejectedValue({ code: "connection.failed" }),
    });
    await act(el, "send-all");
    await choose(el, "data-late-agreed");

    expect(approval(el)).toBeNull();
    expect(el.shadowRoot!.querySelector(".error")?.textContent?.trim()).toBe(
      codeMessage("connection.failed"),
    );
    expect(submissions()).toHaveLength(1);
  });

  it("opens no dialog for a refusal naming another permission", async () => {
    const el = await lateTable({
      submitDraft: vi
        .fn(drafts.submitDraft)
        .mockRejectedValueOnce({ ...MANAGER_NEEDED, permission: "sale.take_payment" }),
      serviceDayAuthorizers: vi.fn().mockResolvedValue([MARTA]),
    });
    await act(el, "send-all");
    await choose(el, "data-late-agreed");

    expect(approval(el)).toBeNull();
    expect(api.serviceDayAuthorizers).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector(".error")?.textContent?.trim()).toBe(t("table.error"));
  });

  it("keeps the dialog open with the lock-out sentence on a throttled PIN", async () => {
    const el = await managerAsked({ code: "pin.throttled", status: 429 });
    await authorize(el, "0123");

    expect(approvalText(el, ".error")).toBe(t("pin.throttled"));
    expect(el.shadowRoot!.querySelector(".error")).toBeNull();
    expect(submissions()).toHaveLength(2);
  });

  it("says in the dialog when the person who approved may not, and keeps it open", async () => {
    const el = await managerAsked(MANAGER_NEEDED);
    await authorize(el, "0123");

    expect(approval(el)!.shadowRoot!.querySelector("wt-dialog")!.open).toBe(true);
    expect(approvalText(el, ".error")).toBe(codeMessage("authorization.not_permitted"));
    expect(api.serviceDayAuthorizers).toHaveBeenCalledTimes(1);
    expect(submissions()).toHaveLength(2);
  });

  it("shows a refused approver on the app's line when the dialog was closed while it was sent", async () => {
    let answer!: (refused: unknown) => void;
    const held = new Promise<never>((_, reject) => (answer = reject));
    const el = await managerAsked();
    api.submitDraft!.mockImplementationOnce(() => held);
    await authorize(el, "0123");

    await userEvent.keyboard("{Escape}");
    await flush(el);
    answer(MANAGER_NEEDED);
    await flush(el, 6);

    expect(approval(el)).toBeNull();
    expect(el.shadowRoot!.querySelector(".error")?.textContent?.trim()).toBe(
      codeMessage("authorization.not_permitted"),
    );
  });

  it("shows a wrong PIN on the app's line when the dialog was closed while it was sent, and asks afresh next time", async () => {
    let answer!: (refused: unknown) => void;
    const held = new Promise<never>((_, reject) => (answer = reject));
    const el = await managerAsked();
    api.submitDraft!.mockImplementationOnce(() => held).mockRejectedValueOnce(MANAGER_NEEDED);
    await authorize(el, "0123");

    await userEvent.keyboard("{Escape}");
    await flush(el);
    answer(WRONG_PIN);
    await flush(el, 6);

    expect(approval(el)).toBeNull();
    expect(el.shadowRoot!.querySelector(".error")?.textContent?.trim()).toBe(t("pin.invalid"));
    await act(el, "send-all");
    await choose(el, "data-late-agreed");
    expect(approval(el)!.shadowRoot!.querySelector("wt-dialog")!.open).toBe(true);
    expect(approvalText(el, ".prompt")).toBe("Choose a manager");
    expect(submissions()).toHaveLength(3);
  });
});

describe("an allergy party's send that needs a manager's PIN", () => {
  beforeEach(() => resetAllergyFixture());

  it("closes the allergy dialog for the PIN, reruns with the answer already given, and shows a wrong PIN in the PIN's dialog", async () => {
    const lunchEnded = refusal([{ menuId: "lunch", periodName: "Lunch" }], ["offer-steak"]);
    const submitDraft = vi
      .fn<TillApi["submitDraft"]>()
      .mockRejectedValueOnce(lunchEnded)
      .mockRejectedValueOnce(MANAGER_NEEDED)
      .mockRejectedValueOnce(WRONG_PIN)
      .mockImplementation((id, did, packet) => allergyServer.submitDraft(id, did, packet));
    const { el } = await mountAllergyApp({
      submitDraft,
      serviceDayAuthorizers: vi.fn().mockResolvedValue([MARTA]),
    });
    await openAllergyTable(el);
    await addSteak(el);
    await sendWithAllergy(el, "Blue shirt");
    await vi.waitFor(() => expect(windowOf(el)).not.toBeNull());
    expect(allergyDialog(el)).toBeNull();

    await choose(el, "data-late-agreed");

    await vi.waitFor(() => expect(approval(el)).not.toBeNull());
    expect(allergyDialog(el)).toBeNull();
    expect(submitDraft.mock.calls[1]![2].lateSend).toEqual({ menuIds: ["lunch"] });
    await authorize(el, "0123");

    await vi.waitFor(() => expect(approvalText(el, ".error")).toBe("Wrong PIN, try again"));
    expect(allergyDialog(el)).toBeNull();
    expect(submitDraft.mock.calls[2]![2].lateSend).toEqual({
      menuIds: ["lunch"],
      override: { personId: MARTA.personId, pin: "0123" },
    });
    await authorize(el, "4567");

    await vi.waitFor(() => expect(submitDraft).toHaveBeenCalledTimes(4));
    await flush(el, 6);
    expect(approval(el)).toBeNull();
    expect(allergyDialog(el)).toBeNull();
    const packets = submitDraft.mock.calls.map((call) => call[2]);
    expect(packets[0]!.allergy?.party?.guests).toEqual([
      expect.objectContaining({ who: "Blue shirt", allergens: { milk: {} } }),
    ]);
    for (const rerun of packets.slice(1)) {
      expect(rerun.allergy).toEqual(packets[0]!.allergy);
      expect(rerun.expectedPartyRevision).toBe(packets[0]!.expectedPartyRevision);
    }
  });
});

describe("an allergy party's PIN rerun", () => {
  beforeEach(() => resetAllergyFixture());

  async function pinAsked(
    submitDraft: ReturnType<typeof vi.fn<TillApi["submitDraft"]>>,
    overrides: Record<string, unknown> = {},
  ): Promise<TillApp> {
    const { el } = await mountAllergyApp({
      submitDraft,
      serviceDayAuthorizers: vi.fn().mockResolvedValue([MARTA]),
      ...overrides,
    });
    await openAllergyTable(el);
    await addSteak(el);
    await sendWithAllergy(el, "Blue shirt");
    await vi.waitFor(() => expect(windowOf(el)).not.toBeNull());
    await choose(el, "data-late-agreed");
    await vi.waitFor(() => expect(approval(el)).not.toBeNull());
    return el;
  }

  it("keeps the answer through a silent menu version change, and shows a wrong PIN in the PIN's dialog", async () => {
    const lunchEnded = refusal([{ menuId: "lunch", periodName: "Lunch" }], ["offer-steak"]);
    const submitDraft = vi
      .fn<TillApi["submitDraft"]>()
      .mockRejectedValueOnce(lunchEnded)
      .mockRejectedValueOnce(MANAGER_NEEDED)
      .mockRejectedValueOnce({
        code: "menu.version_changed",
        status: 409,
        menus: [{ menuId: "lunch", liveVersionId: "v2" }],
      })
      .mockRejectedValueOnce(WRONG_PIN)
      .mockImplementation((id, did, packet) => allergyServer.submitDraft(id, did, packet));
    const el = await pinAsked(submitDraft);
    allergyApi.listZoneOffers!.mockResolvedValue(allergyCatalogue("v2"));

    await authorize(el, "0123");

    await vi.waitFor(() => expect(approvalText(el, ".error")).toBe("Wrong PIN, try again"));
    expect(allergyDialog(el)).toBeNull();
    expect(submitDraft).toHaveBeenCalledTimes(4);
    const packets = submitDraft.mock.calls.map((call) => call[2]);
    for (const rerun of packets.slice(2)) {
      expect(rerun.lateSend).toEqual({
        menuIds: ["lunch"],
        override: { personId: MARTA.personId, pin: "0123" },
      });
      expect(rerun.allergy).toEqual(packets[0]!.allergy);
      expect(rerun.expectedPartyRevision).toBe(packets[0]!.expectedPartyRevision);
    }
  });

  it("asks again with the PIN's dialog closed when the dishes changed, and shows a wrong PIN on the app's line", async () => {
    const lunchEnded = refusal([{ menuId: "lunch", periodName: "Lunch" }], ["offer-steak"]);
    const submitDraft = vi
      .fn<TillApi["submitDraft"]>()
      .mockRejectedValueOnce(lunchEnded)
      .mockRejectedValueOnce(MANAGER_NEEDED)
      .mockRejectedValueOnce(WRONG_PIN)
      .mockImplementation((id, did, packet) => allergyServer.submitDraft(id, did, packet));
    let reads = 0;
    const previewPartyAllergy = vi.fn(async (_id: string, target: AllergySendTarget) => {
      const view = allergyView(null, target);
      if (++reads >= 3)
        view.dishes = view.dishes.map((dish) => ({ ...dish, allergens: { milk: {} } }));
      return view;
    });
    const el = await pinAsked(submitDraft, { previewPartyAllergy });

    await authorize(el, "0123");

    await vi.waitFor(() => expect(allergyDialog(el)).not.toBeNull());
    expect(approval(el)).toBeNull();
    await answerAllergy(el, "Blue shirt");

    await vi.waitFor(() => expect(submitDraft).toHaveBeenCalledTimes(3));
    await flush(el, 6);
    expect(allergyDialog(el)).toBeNull();
    expect(approval(el)).toBeNull();
    expect(el.shadowRoot!.querySelector(".error")?.textContent?.trim()).toBe(t("pin.invalid"));
    expect(submitDraft.mock.calls[2]![2].lateSend).toEqual({
      menuIds: ["lunch"],
      override: { personId: MARTA.personId, pin: "0123" },
    });
  });
});

describe("an allergy party's send the till marked, that needs a manager's PIN", () => {
  beforeEach(() => resetAllergyFixture());

  it("asks the allergy question after Kitchen agreed, then opens the PIN and reruns with the same answer", async () => {
    const submitDraft = vi
      .fn<TillApi["submitDraft"]>()
      .mockRejectedValueOnce(MANAGER_NEEDED)
      .mockImplementation((id, did, packet) => allergyServer.submitDraft(id, did, packet));
    const { el } = await mountAllergyApp({
      submitDraft,
      serviceDayAuthorizers: vi.fn().mockResolvedValue([MARTA]),
    });
    await openAllergyTable(el);
    await addSteak(el);
    allergyDraft(el).setEndedPeriods([{ menuId: "lunch", periodName: "Lunch" }], false);
    await userEvent.click(
      allergyOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
    );
    await vi.waitFor(() => expect(windowOf(el)).not.toBeNull());
    expect(allergyDialog(el)).toBeNull();

    await choose(el, "data-late-agreed");
    await answerAllergy(el, "Blue shirt");

    await vi.waitFor(() => expect(approval(el)).not.toBeNull());
    expect(allergyDialog(el)).toBeNull();
    expect(submitDraft.mock.calls[0]![2].lateSend).toEqual({ menuIds: ["lunch"] });
    await authorize(el, "0123");

    await vi.waitFor(() => expect(submitDraft).toHaveBeenCalledTimes(2));
    await flush(el, 6);
    expect(approval(el)).toBeNull();
    expect(allergyDialog(el)).toBeNull();
    const [first, rerun] = submitDraft.mock.calls.map((call) => call[2]);
    expect(first!.allergy?.party?.guests).toEqual([
      expect.objectContaining({ who: "Blue shirt", allergens: { milk: {} } }),
    ]);
    expect(rerun!.allergy).toEqual(first!.allergy);
    expect(rerun!.expectedPartyRevision).toBe(first!.expectedPartyRevision);
    expect(rerun!.lateSend).toEqual({
      menuIds: ["lunch"],
      override: { personId: MARTA.personId, pin: "0123" },
    });
  });
});

describe("an allergy party's send the till marked, refused for a menu version change", () => {
  beforeEach(() => resetAllergyFixture());

  /** Sends a Steak marked "Lunch ended", answers the allergy question after Kitchen agreed, and has
   * that send refused for a menu version change whose new version keeps every price. */
  async function answeredThenVersionChanged(
    submitDraft: ReturnType<typeof vi.fn<TillApi["submitDraft"]>>,
    previewPartyAllergy: (id: string, target: AllergySendTarget) => Promise<unknown>,
  ): Promise<TillApp> {
    const { el } = await mountAllergyApp({ submitDraft, previewPartyAllergy });
    await openAllergyTable(el);
    await addSteak(el);
    allergyDraft(el).setEndedPeriods([{ menuId: "lunch", periodName: "Lunch" }], false);
    await userEvent.click(
      allergyOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
    );
    await vi.waitFor(() => expect(windowOf(el)).not.toBeNull());
    await choose(el, "data-late-agreed");
    allergyApi.listZoneOffers!.mockResolvedValue(allergyCatalogue("v2"));
    await answerAllergy(el, "Blue shirt");
    await vi.waitFor(() => expect(submitDraft).toHaveBeenCalled());
    await flush(el, 15);
    return el;
  }

  const versionChanged = {
    code: "menu.version_changed",
    status: 409,
    menus: [{ menuId: "lunch", liveVersionId: "v2" }],
  };

  it("sends again with the answer just given when the party and its dishes are unchanged", async () => {
    const submitDraft = vi
      .fn<TillApi["submitDraft"]>()
      .mockRejectedValueOnce(versionChanged)
      .mockImplementation((id, did, packet) => allergyServer.submitDraft(id, did, packet));
    const previewPartyAllergy = vi.fn(async (_id: string, target: AllergySendTarget) =>
      allergyView(null, target),
    );
    const el = await answeredThenVersionChanged(submitDraft, previewPartyAllergy);

    await vi.waitFor(() => expect(submitDraft).toHaveBeenCalledTimes(2));
    await flush(el, 6);
    expect(allergyDialog(el)).toBeNull();
    expect(previewPartyAllergy).toHaveBeenCalledTimes(2);
    const [first, rerun] = submitDraft.mock.calls.map((call) => call[2]);
    expect(first!.allergy?.party?.guests).toEqual([
      expect.objectContaining({ who: "Blue shirt", allergens: { milk: {} } }),
    ]);
    expect(rerun!.allergy).toEqual(first!.allergy);
    expect(rerun!.expectedPartyRevision).toBe(first!.expectedPartyRevision);
    expect(rerun!.lateSend).toEqual({ menuIds: ["lunch"] });
  });

  it("asks again when the party read after the refusal names other dishes", async () => {
    const submitDraft = vi
      .fn<TillApi["submitDraft"]>()
      .mockRejectedValueOnce(versionChanged)
      .mockImplementation((id, did, packet) => allergyServer.submitDraft(id, did, packet));
    let reads = 0;
    const previewPartyAllergy = vi.fn(async (_id: string, target: AllergySendTarget) => {
      const view = allergyView(null, target);
      if (++reads >= 2)
        view.dishes = view.dishes.map((dish) => ({ ...dish, allergens: { milk: {} } }));
      return view;
    });
    const el = await answeredThenVersionChanged(submitDraft, previewPartyAllergy);

    await vi.waitFor(() => expect(allergyDialog(el)).not.toBeNull());
    expect(submitDraft).toHaveBeenCalledOnce();
  });
});

const saleResult: TillSaleResult = {
  receiptTrim: {},
  venueAddress: [],
  receiptSettings: { printAddress: false },
  orderLabel: null,
  orderNumber: 1,
  invoiceNumber: "F-0001",
  issuedAt: "2026-10-12T13:00:00.000Z",
  total: "6.00",
  vatBreakdown: [{ rate: "10", base: "5.45", tax: "0.55" }],
  lines: [{ descriptions: { en: "Omelette" }, quantity: "1", gross: "3.00" }],
  tender: { method: "cash", change: "4.00" },
  qr: "https://example.test/vf?nif=B1&num=F-0001&fecha=12-10-2026&total=6.00",
};
const CASH = { method: "cash", amount: "10" };
const BREAKFAST_CONFIRMED = { menuIds: [BREAKFAST_MENU.id] };

/** The counter's menus, which a counter case moves from Breakfast to Lunch. */
let counterMenus: ZoneOfferCatalogue;
let counterFlow: "prepay" | "ticket_then_pay";
const counterScreen = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
const counterNames = (el: TillApp) =>
  counterScreen(el).store.lines.map((line) => line.product.name);
const lastArgument = (fn: ReturnType<typeof vi.fn>, call: number) => fn.mock.calls[call]!.at(-1);

/** An order held earlier with one Omelette of the Breakfast menu already stored on it. */
const heldOmelette = {
  kitchenNote: { scope: { workingOrderId: "wo-1" }, note: null, revision: 0, ownerRevision: 0 },
  id: "wo-1",
  orderNumber: 5,
  label: null,
  revision: 3,
  lines: [
    {
      menuItemId: offerId(BREAKFAST_MENU, "Omelette"),
      quantity: "1.000",
      workingOrderLineId: "wol-omelette",
    },
  ],
};

/** Signs in at the counter under Breakfast; `held` retrieves `heldOmelette` first. Then adds
 * `products` from the Breakfast menu; nothing is marked yet. */
async function counterBasket(
  overrides: Record<string, unknown> = {},
  {
    products = ["Omelette", "Coffee"],
    held = false,
    flow = "prepay",
  }: { products?: string[]; held?: boolean; flow?: "prepay" | "ticket_then_pay" } = {},
): Promise<TillApp> {
  current = catalogue("breakfast");
  counterFlow = flow;
  counterMenus = catalogue("breakfast", "zone-bar", flow);
  const { el } = await mountApp({
    listDefaultZoneOffers: vi.fn(async () => counterMenus),
    listZoneOffers: vi.fn(async (zoneId: string) =>
      zoneId === "zone-dining-room" ? current : counterMenus,
    ),
    menuState: vi.fn(async (zoneId: string) =>
      polled(zoneId === "zone-dining-room" ? current : counterMenus),
    ),
    recordSale: vi.fn().mockResolvedValue(saleResult),
    retrieveWorkingOrder: vi.fn().mockResolvedValue(heldOmelette),
    updateWorkingOrder: vi.fn().mockResolvedValue({ revision: 4 }),
    ...overrides,
  });
  await flush(el);
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
  await flush(el);
  if (held) {
    emit(counterScreen(el), "retrieve-order", { id: "wo-1" });
    await flush(el);
  }
  for (const product of products)
    counterScreen(el).store.addProduct(
      menuOfferToTillProduct(offer(BREAKFAST_MENU, product), "v1"),
      "1",
    );
  await flush(el);
  return el;
}

/** As `counterBasket`, then lets Lunch start at the counter: the new Omelette is marked. */
async function lateCounter(
  overrides: Record<string, unknown> = {},
  options: { products?: string[]; held?: boolean; flow?: "prepay" | "ticket_then_pay" } = {},
): Promise<TillApp> {
  const el = await counterBasket(overrides, options);
  counterMenus = catalogue("lunch", "zone-bar", counterFlow);
  await poll(el);
  expect(
    counterScreen(el)
      .store.lines.filter((line) => line.endedPeriod !== undefined)
      .map((line) => line.endedPeriod),
  ).toEqual([{ menuId: BREAKFAST_MENU.id, periodName: "Breakfast" }]);
  return el;
}

const integratedCard = () => ({
  getTill: vi.fn().mockResolvedValue({
    ...till,
    cardProvider: "simulator",
    capabilities: [...till.capabilities, "integrated-card-payment"] as CapabilityFlag[],
  }),
  pay: vi.fn().mockResolvedValue({ outcome: "captured", ticket: saleResult }),
});

describe("counter pay", () => {
  it("asks about the marked dish before cash Pay records anything", async () => {
    const el = await lateCounter();

    emit(counterScreen(el), "confirm-payment", CASH);
    await flush(el, 6);

    expect(windowDishes(el)).toEqual(["1× Omelette"]);
    expect(api.recordSale).not.toHaveBeenCalled();
  });

  it("records the sale once with the ended menu once the kitchen agreed, and does not ask again", async () => {
    const el = await lateCounter();
    emit(counterScreen(el), "confirm-payment", CASH);
    await flush(el, 6);

    await choose(el, "data-late-agreed");

    expect(api.recordSale).toHaveBeenCalledOnce();
    expect(lastArgument(api.recordSale!, 0)).toEqual(BREAKFAST_CONFIRMED);
    expect(windowOf(el)).toBeNull();
  });

  it("takes the marked dish out of the basket on Remove them and records nothing", async () => {
    const el = await lateCounter();
    emit(counterScreen(el), "confirm-payment", CASH);
    await flush(el, 6);

    await choose(el, "data-late-remove");

    expect(counterNames(el)).toEqual(["Coffee"]);
    expect(api.recordSale).not.toHaveBeenCalled();
  });

  it("keeps the confirmation on the pay it repeats after the dead-ends question", async () => {
    const el = await lateCounter(
      {
        updateWorkingOrder: vi
          .fn()
          .mockRejectedValueOnce({ code: "route.station_inactive", status: 409 })
          .mockResolvedValue({ revision: 4 }),
        askSaleDeadEnds: vi.fn().mockResolvedValue({ sends: false, deadEnds: [], stations: [] }),
      },
      { products: ["Omelette"], held: true },
    );
    emit(counterScreen(el), "confirm-payment", CASH);
    await flush(el, 6);

    await choose(el, "data-late-agreed");

    expect(api.askSaleDeadEnds).toHaveBeenCalledOnce();
    expect(api.updateWorkingOrder!.mock.calls.map(([, request]) => request.lateSend)).toEqual([
      BREAKFAST_CONFIRMED,
      BREAKFAST_CONFIRMED,
    ]);
    expect(api.recordSale).toHaveBeenCalledOnce();
    expect(lastArgument(api.recordSale!, 0)).toEqual(BREAKFAST_CONFIRMED);
    expect(windowOf(el)).toBeNull();
  });

  it("keeps the confirmation on the card payment it repeats after the dead-ends question", async () => {
    const el = await lateCounter(
      {
        ...integratedCard(),
        updateWorkingOrder: vi
          .fn()
          .mockRejectedValueOnce({ code: "route.station_inactive", status: 409 })
          .mockResolvedValue({ revision: 4 }),
        askSaleDeadEnds: vi.fn().mockResolvedValue({ sends: false, deadEnds: [], stations: [] }),
      },
      { products: ["Omelette"], held: true },
    );
    emit(counterScreen(el), "collect-card", {});
    await flush(el, 6);

    await choose(el, "data-late-agreed");

    expect(api.askSaleDeadEnds).toHaveBeenCalledOnce();
    expect(api.updateWorkingOrder!.mock.calls.map(([, request]) => request.lateSend)).toEqual([
      BREAKFAST_CONFIRMED,
      BREAKFAST_CONFIRMED,
    ]);
    expect(api.pay).toHaveBeenCalledOnce();
    expect(api.pay!.mock.calls[0]![0].lateSend).toEqual(BREAKFAST_CONFIRMED);
    expect(windowOf(el)).toBeNull();
  });

  const VERSION_CHANGED = {
    code: "menu.version_changed",
    status: 409,
    menus: [{ menuId: LUNCH.id, liveVersionId: "v1" }],
  };

  it("keeps the confirmation on the cash pay it repeats after a menu version change", async () => {
    const recordSale = vi.fn().mockRejectedValueOnce(VERSION_CHANGED).mockResolvedValue(saleResult);
    const el = await lateCounter({ recordSale });
    emit(counterScreen(el), "confirm-payment", CASH);
    await flush(el, 6);

    await choose(el, "data-late-agreed");

    expect(windowOf(el)).toBeNull();
    expect(recordSale.mock.calls.map((call) => call.at(-1))).toEqual([
      BREAKFAST_CONFIRMED,
      BREAKFAST_CONFIRMED,
    ]);
  });

  it("keeps the confirmation on the card payment it repeats after a menu version change", async () => {
    const pay = vi
      .fn()
      .mockRejectedValueOnce(VERSION_CHANGED)
      .mockResolvedValue({ outcome: "captured", ticket: saleResult });
    const el = await lateCounter({ ...integratedCard(), pay });
    emit(counterScreen(el), "collect-card", {});
    await flush(el, 6);

    await choose(el, "data-late-agreed");

    expect(windowOf(el)).toBeNull();
    expect(pay.mock.calls.map(([request]) => request.lateSend)).toEqual([
      BREAKFAST_CONFIRMED,
      BREAKFAST_CONFIRMED,
    ]);
  });

  it("asks before the card reader takes a payment, and pays with the ended menu once agreed", async () => {
    const el = await lateCounter(integratedCard());
    emit(counterScreen(el), "collect-card", {});
    await flush(el, 6);

    expect(windowDishes(el)).toEqual(["1× Omelette"]);
    expect(api.pay).not.toHaveBeenCalled();

    await choose(el, "data-late-agreed");

    expect(api.pay).toHaveBeenCalledOnce();
    expect(api.pay!.mock.calls[0]![0].lateSend).toEqual(BREAKFAST_CONFIRMED);
    expect(windowOf(el)).toBeNull();
  });

  it("opens the window from the card reader's refusal of a dish the till had not marked", async () => {
    const pay = vi
      .fn()
      .mockRejectedValueOnce(BREAKFAST_ENDED)
      .mockResolvedValue({ outcome: "captured", ticket: saleResult });
    const el = await counterBasket({ ...integratedCard(), pay });
    emit(counterScreen(el), "collect-card", {});
    await flush(el, 6);

    expect(windowDishes(el)).toEqual(["1× Omelette"]);

    await choose(el, "data-late-agreed");

    expect(pay).toHaveBeenCalledTimes(2);
    expect(pay.mock.calls[1]![0].lateSend).toEqual(BREAKFAST_CONFIRMED);
  });

  it("opens the window from cash Pay's refusal of a dish the till had not marked", async () => {
    const recordSale = vi.fn().mockRejectedValueOnce(BREAKFAST_ENDED).mockResolvedValue(saleResult);
    const el = await counterBasket({ recordSale });
    emit(counterScreen(el), "confirm-payment", CASH);
    await flush(el, 6);

    expect(windowDishes(el)).toEqual(["1× Omelette"]);
    expect(recordSale.mock.calls[0]![9]).toBeUndefined();

    await choose(el, "data-late-agreed");

    expect(recordSale).toHaveBeenCalledTimes(2);
    expect(lastArgument(recordSale, 1)).toEqual(BREAKFAST_CONFIRMED);
  });

  it("saves a retrieved order and records its sale with the confirmation, listing only the new dish", async () => {
    const el = await lateCounter({}, { products: ["Omelette"], held: true });
    emit(counterScreen(el), "confirm-payment", CASH);
    await flush(el, 6);

    expect(windowDishes(el)).toEqual(["1× Omelette"]);

    await choose(el, "data-late-agreed");

    expect(api.updateWorkingOrder).toHaveBeenCalledOnce();
    expect(api.updateWorkingOrder!.mock.calls[0]![1].lateSend).toEqual(BREAKFAST_CONFIRMED);
    expect(lastArgument(api.recordSale!, 0)).toEqual(BREAKFAST_CONFIRMED);
    expect(api.updateWorkingOrder!.mock.invocationCallOrder[0]).toBeLessThan(
      api.recordSale!.mock.invocationCallOrder[0]!,
    );
  });

  it("keeps a retrieved order's stored dish on Remove them", async () => {
    const el = await lateCounter({}, { products: ["Omelette"], held: true });
    emit(counterScreen(el), "confirm-payment", CASH);
    await flush(el, 6);

    await choose(el, "data-late-remove");

    expect(
      counterScreen(el).store.lines.map((line) => [line.product.name, line.workingOrderLineId]),
    ).toEqual([["Omelette", "wol-omelette"]]);
    expect(api.updateWorkingOrder).not.toHaveBeenCalled();
  });

  it("lists only the new dish from a refusal of a retrieved order's save", async () => {
    const updateWorkingOrder = vi
      .fn()
      .mockRejectedValueOnce(BREAKFAST_ENDED)
      .mockResolvedValue({ revision: 4 });
    const el = await counterBasket({ updateWorkingOrder }, { products: ["Omelette"], held: true });
    emit(counterScreen(el), "confirm-payment", CASH);
    await flush(el, 6);

    expect(windowDishes(el)).toEqual(["1× Omelette"]);
    expect(api.recordSale).not.toHaveBeenCalled();

    await choose(el, "data-late-remove");

    expect(counterScreen(el).store.lines.map((line) => line.workingOrderLineId)).toEqual([
      "wol-omelette",
    ]);
  });

  it("asks nothing and carries no confirmation when a stored dish's quantity is raised after its period", async () => {
    const el = await counterBasket({}, { products: [], held: true });
    counterMenus = catalogue("lunch", "zone-bar", "prepay");
    await poll(el);
    counterScreen(el).store.setLineQuantity(0, "2");
    await flush(el);
    expect(el.shadowRoot!.querySelector(".error")!.textContent!.trim()).toBe(
      t("menu.last_orders_ended"),
    );
    expect(counterScreen(el).store.lines.map((line) => line.quantity)).toEqual(["1"]);

    emit(counterScreen(el), "confirm-payment", CASH);
    await flush(el, 6);

    expect(windowOf(el)).toBeNull();
    expect(api.updateWorkingOrder).not.toHaveBeenCalled();
    expect(api.recordSale).toHaveBeenCalledOnce();
    expect(api.recordSale!.mock.calls[0]![9]).toBeUndefined();
  });

  it("records a manual card payment with the ended menu once the kitchen agreed", async () => {
    const el = await lateCounter();
    emit(counterScreen(el), "confirm-payment", { method: "card", amount: "6.00" });
    await flush(el, 6);

    expect(windowDishes(el)).toEqual(["1× Omelette"]);
    expect(api.recordSale).not.toHaveBeenCalled();

    await choose(el, "data-late-agreed");

    expect(api.recordSale).toHaveBeenCalledOnce();
    expect(api.recordSale!.mock.calls[0]![1]).toEqual({ method: "card", amount: "6.00" });
    expect(lastArgument(api.recordSale!, 0)).toEqual(BREAKFAST_CONFIRMED);
  });

  it.each([
    {
      way: "cash Pay",
      event: "confirm-payment",
      detail: CASH,
      paid: () => api.recordSale!,
      sent: () => lastArgument(api.recordSale!, 0),
      overrides: {},
    },
    {
      way: "the card reader",
      event: "collect-card",
      detail: {},
      paid: () => api.pay!,
      sent: () => api.pay!.mock.calls[0]![0].lateSend,
      overrides: integratedCard(),
    },
  ])(
    "asks for the invoice's recipient before the window at $way on a bill over the simplified-invoice limit",
    async ({ event, detail, paid, sent, overrides }) => {
      const el = await counterBasket(
        {
          ...overrides,
          getTill: vi.fn().mockResolvedValue({
            ...till,
            ...(event === "collect-card"
              ? {
                  cardProvider: "simulator",
                  capabilities: [...till.capabilities, "integrated-card-payment"],
                }
              : {}),
            fullInvoices: true,
            simplifiedInvoiceLimit: "4.00",
          }),
          getInvoiceDeliveryOptions: vi
            .fn()
            .mockResolvedValue({ invoicePrinter: null, emailAvailable: false }),
        },
        { products: [] },
      );
      // Loaded rather than added: the basket refuses an add that takes it past the limit.
      counterScreen(el).store.loadFrom(
        "large",
        ["Omelette", "Coffee"].map((product) => ({
          product: menuOfferToTillProduct(offer(BREAKFAST_MENU, product), "v1"),
          quantity: "1",
        })),
      );
      counterMenus = catalogue("lunch", "zone-bar", "prepay");
      await poll(el);
      expect(counterScreen(el).store.lines.map((line) => line.endedPeriod?.menuId)).toEqual([
        BREAKFAST_MENU.id,
        undefined,
      ]);
      emit(counterScreen(el), event, detail);
      await flush(el, 6);

      const recipient = el.shadowRoot!.querySelector("till-invoice-recipient-dialog");
      expect(recipient).not.toBeNull();
      expect(windowOf(el)).toBeNull();
      emit(recipient!, "invoice-recipient-confirm", {
        invoiceType: "F1",
        recipient: {
          taxId: "12345678Z",
          legalName: "Example Guest",
          address: "1 Main Street",
          countryCode: "ES",
        },
        delivery: { medium: "receipt" },
      });
      await flush(el);

      emit(counterScreen(el), event, detail);
      await flush(el, 6);
      expect(windowDishes(el)).toEqual(["1× Omelette"]);
      await choose(el, "data-late-agreed");

      expect(el.shadowRoot!.querySelector("till-invoice-recipient-dialog")).toBeNull();
      expect(paid()).toHaveBeenCalledOnce();
      expect(sent()).toEqual(BREAKFAST_CONFIRMED);
    },
  );
});

/** The held order `wo-1` with a payment on it, so the counter takes the rest as a bill payment. */
const partlyPaid = {
  items: [],
  id: "wo-1",
  orderNumber: 5,
  label: null,
  counts: { ordered: 1, unsent: 0, held: 0, waiting: 0, ready: 0 },
  total: "6.00",
  outstanding: "3.00",
  hasPayments: true,
  partyId: null,
  openedAt: "2026-10-12T12:00:00.000Z",
  signals: [],
};
const partlyPaidBalance = {
  workingOrderId: "wo-1",
  status: "open",
  total: "6.00",
  received: "3.00",
  reserved: "0.00",
  outstanding: "3.00",
  tips: "0.00",
  payments: [],
  paidLines: [],
};
const billPayDialog = (el: TillApp) => el.shadowRoot!.querySelector("till-bill-pay-dialog");
const billPayment = (overrides: Record<string, unknown> = {}) => ({
  listWorkingOrders: vi.fn().mockResolvedValue([partlyPaid]),
  getBillBalance: vi.fn().mockResolvedValue(partlyPaidBalance),
  ...overrides,
});
const errorLine = (el: TillApp) =>
  el.shadowRoot!.querySelector(".error")?.textContent?.trim() ?? "";
const savedLateSends = () =>
  api.updateWorkingOrder!.mock.calls.map(([, request]) => request.lateSend);

describe("counter pay of a partly paid order", () => {
  it("asks about a new marked dish, and saves it with the ended menu before the bill payment opens", async () => {
    const el = await lateCounter(billPayment(), { products: ["Omelette"], held: true });
    emit(counterScreen(el), "counter-bill-pay", { amount: "3.00" });
    await flush(el, 6);

    expect(windowDishes(el)).toEqual(["1× Omelette"]);
    expect(api.updateWorkingOrder).not.toHaveBeenCalled();
    expect(billPayDialog(el)).toBeNull();

    await choose(el, "data-late-agreed");

    expect(savedLateSends()).toEqual([BREAKFAST_CONFIRMED]);
    expect(api.updateWorkingOrder!.mock.invocationCallOrder[0]).toBeLessThan(
      api.getBillBalance!.mock.invocationCallOrder[0]!,
    );
    expect(billPayDialog(el)).not.toBeNull();
    expect(windowOf(el)).toBeNull();
  });

  it("opens the window from the save's refusal of a dish the till had not marked", async () => {
    const updateWorkingOrder = vi
      .fn()
      .mockRejectedValueOnce(BREAKFAST_ENDED)
      .mockResolvedValue({ revision: 4 });
    const el = await counterBasket(billPayment({ updateWorkingOrder }), {
      products: ["Omelette"],
      held: true,
    });
    const notice = errorLine(el);
    emit(counterScreen(el), "counter-bill-pay", { amount: "3.00" });
    await flush(el, 6);

    expect(windowDishes(el)).toEqual(["1× Omelette"]);
    expect(errorLine(el)).toBe(notice);
    expect(billPayDialog(el)).toBeNull();

    await choose(el, "data-late-agreed");

    expect(savedLateSends()).toEqual([undefined, BREAKFAST_CONFIRMED]);
    expect(billPayDialog(el)).not.toBeNull();
  });

  it("keeps the confirmation on the save it repeats after the dead-ends question", async () => {
    const el = await lateCounter(
      billPayment({
        updateWorkingOrder: vi
          .fn()
          .mockRejectedValueOnce({ code: "route.station_inactive", status: 409 })
          .mockResolvedValue({ revision: 4 }),
        askSaleDeadEnds: vi.fn().mockResolvedValue({ sends: false, deadEnds: [], stations: [] }),
      }),
      { products: ["Omelette"], held: true },
    );
    emit(counterScreen(el), "counter-bill-pay", { amount: "3.00" });
    await flush(el, 6);

    await choose(el, "data-late-agreed");

    expect(api.askSaleDeadEnds).toHaveBeenCalledOnce();
    expect(savedLateSends()).toEqual([BREAKFAST_CONFIRMED, BREAKFAST_CONFIRMED]);
    expect(billPayDialog(el)).not.toBeNull();
  });

  it("asks for a manager's PIN when the save needs one, and saves again with it", async () => {
    const updateWorkingOrder = vi
      .fn()
      .mockRejectedValueOnce(MANAGER_NEEDED)
      .mockResolvedValue({ revision: 4 });
    const el = await lateCounter(
      billPayment({
        updateWorkingOrder,
        serviceDayAuthorizers: vi.fn().mockResolvedValue([MARTA]),
      }),
      { products: ["Omelette"], held: true },
    );
    const notice = errorLine(el);
    emit(counterScreen(el), "counter-bill-pay", { amount: "3.00" });
    await flush(el, 6);
    await choose(el, "data-late-agreed");

    expect(approval(el)).not.toBeNull();
    expect(errorLine(el)).toBe(notice);
    expect(billPayDialog(el)).toBeNull();
    await authorize(el, "0123");

    expect(savedLateSends()).toEqual([
      BREAKFAST_CONFIRMED,
      { ...BREAKFAST_CONFIRMED, override: { personId: MARTA.personId, pin: "0123" } },
    ]);
    expect(approval(el)).toBeNull();
    expect(billPayDialog(el)).not.toBeNull();
  });
  it("holds Pay while the managers are read, so a second Pay opens no window under the PIN dialog", async () => {
    let answer!: (managers: (typeof MARTA)[]) => void;
    const el = await lateCounter(
      billPayment({
        updateWorkingOrder: vi.fn().mockRejectedValueOnce(MANAGER_NEEDED),
        serviceDayAuthorizers: vi.fn(() => new Promise((resolve) => (answer = resolve))),
      }),
      { products: ["Omelette"], held: true },
    );
    emit(counterScreen(el), "counter-bill-pay", { amount: "3.00" });
    await flush(el, 6);
    await choose(el, "data-late-agreed");
    expect(api.serviceDayAuthorizers).toHaveBeenCalledOnce();
    const payRest = counterScreen(el).shadowRoot!.querySelector<
      HTMLElement & { disabled: boolean }
    >("[data-pay-rest]")!;
    expect(payRest.disabled).toBe(true);

    await userEvent.click(payRest);
    emit(counterScreen(el), "counter-bill-pay", { amount: "3.00" });
    await flush(el, 6);
    expect(windowOf(el)).toBeNull();

    answer([MARTA]);
    await flush(el, 6);
    expect(approval(el)).not.toBeNull();
    expect(windowOf(el)).toBeNull();
    expect(payRest.disabled).toBe(false);
    expect(api.updateWorkingOrder).toHaveBeenCalledOnce();
  });

  it("keeps the dialog open on a wrong PIN on the save, and opens the bill payment once a right one saves", async () => {
    const updateWorkingOrder = vi
      .fn()
      .mockRejectedValueOnce(MANAGER_NEEDED)
      .mockRejectedValueOnce(WRONG_PIN)
      .mockResolvedValue({ revision: 4 });
    const el = await lateCounter(
      billPayment({
        updateWorkingOrder,
        serviceDayAuthorizers: vi.fn().mockResolvedValue([MARTA]),
      }),
      { products: ["Omelette"], held: true },
    );
    emit(counterScreen(el), "counter-bill-pay", { amount: "3.00" });
    await flush(el, 6);
    await choose(el, "data-late-agreed");
    await authorize(el, "0123");

    expect(approval(el)).not.toBeNull();
    expect(approvalText(el, ".error")).toBe("Wrong PIN, try again");
    expect(billPayDialog(el)).toBeNull();
    await authorize(el, "4567");

    expect(savedLateSends()).toEqual([
      BREAKFAST_CONFIRMED,
      { ...BREAKFAST_CONFIRMED, override: { personId: MARTA.personId, pin: "0123" } },
      { ...BREAKFAST_CONFIRMED, override: { personId: MARTA.personId, pin: "4567" } },
    ]);
    expect(approval(el)).toBeNull();
    expect(billPayDialog(el)).not.toBeNull();
  });
});

describe("counter pay with a manager's PIN", () => {
  const MARTA_OVERRIDE = (pin: string) => ({
    ...BREAKFAST_CONFIRMED,
    override: { personId: MARTA.personId, pin },
  });

  it("asks for a manager on cash Pay, and records the sale again with their PIN", async () => {
    const recordSale = vi.fn().mockRejectedValueOnce(MANAGER_NEEDED).mockResolvedValue(saleResult);
    const el = await lateCounter({
      recordSale,
      serviceDayAuthorizers: vi.fn().mockResolvedValue([MARTA]),
    });
    emit(counterScreen(el), "confirm-payment", CASH);
    await flush(el, 6);
    await choose(el, "data-late-agreed");

    expect(approvalText(el, ".prompt")).toBe("Choose a manager");
    expect(el.shadowRoot!.querySelector(".error")).toBeNull();
    await authorize(el, "0123");

    expect(recordSale.mock.calls.map((call) => call.at(-1))).toEqual([
      BREAKFAST_CONFIRMED,
      MARTA_OVERRIDE("0123"),
    ]);
    expect(approval(el)).toBeNull();
    expect(windowOf(el)).toBeNull();
  });

  it("keeps the dialog open on a wrong PIN at cash Pay, and closes it once a right one records", async () => {
    const recordSale = vi
      .fn()
      .mockRejectedValueOnce(MANAGER_NEEDED)
      .mockRejectedValueOnce(WRONG_PIN)
      .mockResolvedValue(saleResult);
    const el = await lateCounter({
      recordSale,
      serviceDayAuthorizers: vi.fn().mockResolvedValue([MARTA]),
    });
    emit(counterScreen(el), "confirm-payment", CASH);
    await flush(el, 6);
    await choose(el, "data-late-agreed");
    await authorize(el, "0123");

    expect(approval(el)).not.toBeNull();
    expect(approvalText(el, ".error")).toBe("Wrong PIN, try again");
    expect(el.shadowRoot!.querySelector(".error")).toBeNull();
    await authorize(el, "4567");

    expect(recordSale.mock.calls.map((call) => call.at(-1))).toEqual([
      BREAKFAST_CONFIRMED,
      MARTA_OVERRIDE("0123"),
      MARTA_OVERRIDE("4567"),
    ]);
    expect(approval(el)).toBeNull();
  });

  it("opens no dialog for a refusal at cash Pay naming another permission, and says why", async () => {
    const el = await lateCounter({
      recordSale: vi
        .fn()
        .mockRejectedValueOnce({ ...MANAGER_NEEDED, permission: "sale.take_payment" }),
      serviceDayAuthorizers: vi.fn().mockResolvedValue([MARTA]),
    });
    emit(counterScreen(el), "confirm-payment", CASH);
    await flush(el, 6);
    await choose(el, "data-late-agreed");

    expect(approval(el)).toBeNull();
    expect(api.serviceDayAuthorizers).not.toHaveBeenCalled();
    expect(errorLine(el)).toBe(t("take_payment.not_permitted"));
  });

  it("ignores a second Pay tap while the managers are read, and opens no window under the PIN dialog", async () => {
    let answer!: (managers: (typeof MARTA)[]) => void;
    const el = await lateCounter({
      recordSale: vi.fn().mockRejectedValueOnce(MANAGER_NEEDED).mockResolvedValue(saleResult),
      serviceDayAuthorizers: vi.fn(() => new Promise((resolve) => (answer = resolve))),
    });
    emit(counterScreen(el), "confirm-payment", CASH);
    await flush(el, 6);
    await choose(el, "data-late-agreed");
    expect(api.serviceDayAuthorizers).toHaveBeenCalledOnce();

    emit(counterScreen(el), "confirm-payment", CASH);
    await flush(el, 6);
    expect(windowOf(el)).toBeNull();

    answer([MARTA]);
    await flush(el, 6);
    expect(approval(el)).not.toBeNull();
    expect(windowOf(el)).toBeNull();
    expect(api.recordSale).toHaveBeenCalledOnce();
  });

  it("says in the dialog when the person who approved at cash Pay may not, and keeps it open", async () => {
    const recordSale = vi.fn().mockRejectedValue(MANAGER_NEEDED);
    const el = await lateCounter({
      recordSale,
      serviceDayAuthorizers: vi.fn().mockResolvedValue([MARTA]),
    });
    emit(counterScreen(el), "confirm-payment", CASH);
    await flush(el, 6);
    await choose(el, "data-late-agreed");
    await authorize(el, "0123");

    expect(approval(el)).not.toBeNull();
    expect(approvalText(el, ".error")).toBe(codeMessage("authorization.not_permitted"));
    expect(recordSale).toHaveBeenCalledTimes(2);
  });

  it("asks for a manager on the card reader, and pays again with their PIN", async () => {
    const pay = vi
      .fn()
      .mockRejectedValueOnce(MANAGER_NEEDED)
      .mockResolvedValue({ outcome: "captured", ticket: saleResult });
    const el = await lateCounter({
      ...integratedCard(),
      pay,
      serviceDayAuthorizers: vi.fn().mockResolvedValue([MARTA]),
    });
    emit(counterScreen(el), "collect-card", {});
    await flush(el, 6);
    await choose(el, "data-late-agreed");

    expect(approvalText(el, ".prompt")).toBe("Choose a manager");
    await authorize(el, "0123");

    expect(pay.mock.calls.map(([request]) => request.lateSend)).toEqual([
      BREAKFAST_CONFIRMED,
      MARTA_OVERRIDE("0123"),
    ]);
    expect(approval(el)).toBeNull();
  });

  it("keeps the dialog open on a wrong PIN at the card reader", async () => {
    const pay = vi
      .fn()
      .mockRejectedValueOnce(MANAGER_NEEDED)
      .mockRejectedValueOnce(WRONG_PIN)
      .mockResolvedValue({ outcome: "captured", ticket: saleResult });
    const el = await lateCounter({
      ...integratedCard(),
      pay,
      serviceDayAuthorizers: vi.fn().mockResolvedValue([MARTA]),
    });
    emit(counterScreen(el), "collect-card", {});
    await flush(el, 6);
    await choose(el, "data-late-agreed");
    await authorize(el, "0123");

    expect(approval(el)).not.toBeNull();
    expect(approvalText(el, ".error")).toBe("Wrong PIN, try again");
    await authorize(el, "4567");

    expect(pay.mock.calls.map(([request]) => request.lateSend)).toEqual([
      BREAKFAST_CONFIRMED,
      MARTA_OVERRIDE("0123"),
      MARTA_OVERRIDE("4567"),
    ]);
    expect(approval(el)).toBeNull();
  });
});

describe("counter place and park", () => {
  const PLACE = { flow: "ticket_then_pay" as const };
  const parking = (overrides: Record<string, unknown> = {}) => ({
    parkOrder: vi.fn().mockResolvedValue({ id: "wo-new", orderNumber: 7 }),
    placeOrder: vi.fn().mockResolvedValue({ id: "wo-new", status: "placed" }),
    askSaleDeadEnds: vi.fn().mockResolvedValue({ sends: false, deadEnds: [], stations: [] }),
    ...overrides,
  });
  const agreedText = (el: TillApp) =>
    windowOf(el)!.shadowRoot!.querySelector("[data-late-agreed]")!.textContent!.trim();
  const parkedLateSends = () => api.parkOrder!.mock.calls.map(([request]) => request.lateSend);
  const VERSION_CHANGED = {
    code: "menu.version_changed",
    status: 409,
    menus: [{ menuId: LUNCH.id, liveVersionId: "v1" }],
  };

  async function place(el: TillApp): Promise<void> {
    emit(counterScreen(el), "place-order");
    await flush(el, 6);
  }
  async function park(el: TillApp): Promise<void> {
    emit(counterScreen(el), "park-order", {});
    await flush(el, 6);
  }

  it("asks about the marked dish before Place parks anything, offering to send", async () => {
    const el = await lateCounter(parking(), PLACE);
    await place(el);

    expect(windowDishes(el)).toEqual(["1× Omelette"]);
    expect(agreedText(el)).toBe("Kitchen agreed — send");
    expect(api.parkOrder).not.toHaveBeenCalled();
    expect(api.placeOrder).not.toHaveBeenCalled();
  });

  it("parks with the ended menu once the kitchen agreed, then places", async () => {
    const el = await lateCounter(parking(), PLACE);
    await place(el);

    await choose(el, "data-late-agreed");

    expect(parkedLateSends()).toEqual([BREAKFAST_CONFIRMED]);
    expect(api.placeOrder).toHaveBeenCalledOnce();
    expect(api.parkOrder!.mock.invocationCallOrder[0]).toBeLessThan(
      api.placeOrder!.mock.invocationCallOrder[0]!,
    );
    expect(windowOf(el)).toBeNull();
  });

  it("saves a retrieved order with the ended menu before Place", async () => {
    const el = await lateCounter(parking(), { ...PLACE, products: ["Omelette"], held: true });
    await place(el);

    expect(windowDishes(el)).toEqual(["1× Omelette"]);
    await choose(el, "data-late-agreed");

    expect(savedLateSends()).toEqual([BREAKFAST_CONFIRMED]);
    expect(api.placeOrder).toHaveBeenCalledOnce();
  });

  it("opens the window from Place's refusal of a dish the till had not marked", async () => {
    const parkOrder = vi
      .fn()
      .mockRejectedValueOnce(BREAKFAST_ENDED)
      .mockResolvedValue({ id: "wo-new", orderNumber: 7 });
    const el = await counterBasket(parking({ parkOrder }), PLACE);
    await place(el);

    expect(windowDishes(el)).toEqual(["1× Omelette"]);
    expect(api.placeOrder).not.toHaveBeenCalled();

    await choose(el, "data-late-agreed");

    expect(parkedLateSends()).toEqual([undefined, BREAKFAST_CONFIRMED]);
    expect(api.placeOrder).toHaveBeenCalledOnce();
  });

  it("keeps the confirmation on the Place it repeats after a menu version change", async () => {
    const parkOrder = vi
      .fn()
      .mockRejectedValueOnce(VERSION_CHANGED)
      .mockResolvedValue({ id: "wo-new", orderNumber: 7 });
    const el = await lateCounter(parking({ parkOrder }), PLACE);
    await place(el);

    await choose(el, "data-late-agreed");

    expect(windowOf(el)).toBeNull();
    expect(parkedLateSends()).toEqual([BREAKFAST_CONFIRMED, BREAKFAST_CONFIRMED]);
    expect(api.placeOrder).toHaveBeenCalledOnce();
  });

  it("keeps the confirmation on the Place it repeats after the dead-ends question", async () => {
    const parkOrder = vi
      .fn()
      .mockRejectedValueOnce({ code: "route.station_inactive", status: 409 })
      .mockResolvedValue({ id: "wo-new", orderNumber: 7 });
    const el = await lateCounter(parking({ parkOrder }), PLACE);
    await place(el);

    await choose(el, "data-late-agreed");

    expect(parkedLateSends()).toEqual([BREAKFAST_CONFIRMED, BREAKFAST_CONFIRMED]);
    expect(api.placeOrder).toHaveBeenCalledOnce();
  });

  it("asks for a manager on Place, and parks again with their PIN", async () => {
    const parkOrder = vi
      .fn()
      .mockRejectedValueOnce(MANAGER_NEEDED)
      .mockResolvedValue({ id: "wo-new", orderNumber: 7 });
    const el = await lateCounter(
      parking({ parkOrder, serviceDayAuthorizers: vi.fn().mockResolvedValue([MARTA]) }),
      PLACE,
    );
    await place(el);
    await choose(el, "data-late-agreed");

    expect(approvalText(el, ".prompt")).toBe("Choose a manager");
    await authorize(el, "0123");

    expect(parkedLateSends()).toEqual([
      BREAKFAST_CONFIRMED,
      { ...BREAKFAST_CONFIRMED, override: { personId: MARTA.personId, pin: "0123" } },
    ]);
    expect(api.placeOrder).toHaveBeenCalledOnce();
    expect(approval(el)).toBeNull();
  });

  it("asks about the marked dish before Park saves anything, offering to save", async () => {
    const el = await lateCounter(parking());
    await park(el);

    expect(windowDishes(el)).toEqual(["1× Omelette"]);
    expect(agreedText(el)).toBe("Kitchen agreed — save");
    expect(api.parkOrder).not.toHaveBeenCalled();
  });

  it("parks with the ended menu once the kitchen agreed", async () => {
    const el = await lateCounter(parking());
    await park(el);

    await choose(el, "data-late-agreed");

    expect(parkedLateSends()).toEqual([BREAKFAST_CONFIRMED]);
    expect(windowOf(el)).toBeNull();
    expect(counterNames(el)).toEqual([]);
  });

  it("saves a retrieved order with the ended menu on Park", async () => {
    const el = await lateCounter(parking(), { products: ["Omelette"], held: true });
    await park(el);

    expect(agreedText(el)).toBe("Kitchen agreed — save");
    await choose(el, "data-late-agreed");

    expect(savedLateSends()).toEqual([BREAKFAST_CONFIRMED]);
  });

  it("keeps the confirmation on the Park it repeats after a menu version change", async () => {
    const parkOrder = vi
      .fn()
      .mockRejectedValueOnce(VERSION_CHANGED)
      .mockResolvedValue({ id: "wo-new", orderNumber: 7 });
    const el = await lateCounter(parking({ parkOrder }));
    await park(el);

    await choose(el, "data-late-agreed");

    expect(windowOf(el)).toBeNull();
    expect(parkedLateSends()).toEqual([BREAKFAST_CONFIRMED, BREAKFAST_CONFIRMED]);
  });

  it("keeps the confirmation on the Park it repeats after the dead-ends question", async () => {
    const parkOrder = vi
      .fn()
      .mockRejectedValueOnce({ code: "route.station_inactive", status: 409 })
      .mockResolvedValue({ id: "wo-new", orderNumber: 7 });
    const el = await lateCounter(parking({ parkOrder }));
    await park(el);

    await choose(el, "data-late-agreed");

    expect(parkedLateSends()).toEqual([BREAKFAST_CONFIRMED, BREAKFAST_CONFIRMED]);
  });

  it("opens the window from Park's refusal of a dish the till had not marked", async () => {
    const parkOrder = vi
      .fn()
      .mockRejectedValueOnce(BREAKFAST_ENDED)
      .mockResolvedValue({ id: "wo-new", orderNumber: 7 });
    const el = await counterBasket(parking({ parkOrder }));
    await park(el);

    expect(windowDishes(el)).toEqual(["1× Omelette"]);
    expect(agreedText(el)).toBe("Kitchen agreed — save");

    await choose(el, "data-late-agreed");

    expect(parkedLateSends()).toEqual([undefined, BREAKFAST_CONFIRMED]);
  });

  it("takes the marked dish out of the basket on Remove them and parks nothing", async () => {
    const el = await lateCounter(parking());
    await park(el);

    await choose(el, "data-late-remove");

    expect(counterNames(el)).toEqual(["Coffee"]);
    expect(api.parkOrder).not.toHaveBeenCalled();
  });

  it("asks for a manager on Park, and parks again with their PIN", async () => {
    const parkOrder = vi
      .fn()
      .mockRejectedValueOnce(MANAGER_NEEDED)
      .mockResolvedValue({ id: "wo-new", orderNumber: 7 });
    const el = await lateCounter(
      parking({ parkOrder, serviceDayAuthorizers: vi.fn().mockResolvedValue([MARTA]) }),
    );
    await park(el);
    await choose(el, "data-late-agreed");

    expect(approvalText(el, ".prompt")).toBe("Choose a manager");
    await authorize(el, "0123");

    expect(parkedLateSends()).toEqual([
      BREAKFAST_CONFIRMED,
      { ...BREAKFAST_CONFIRMED, override: { personId: MARTA.personId, pin: "0123" } },
    ]);
    expect(approval(el)).toBeNull();
    expect(counterNames(el)).toEqual([]);
  });

  it("keeps the dialog open on a wrong PIN at Park", async () => {
    const parkOrder = vi
      .fn()
      .mockRejectedValueOnce(MANAGER_NEEDED)
      .mockRejectedValueOnce(WRONG_PIN)
      .mockResolvedValue({ id: "wo-new", orderNumber: 7 });
    const el = await lateCounter(
      parking({ parkOrder, serviceDayAuthorizers: vi.fn().mockResolvedValue([MARTA]) }),
    );
    await park(el);
    await choose(el, "data-late-agreed");
    await authorize(el, "0123");

    expect(approval(el)).not.toBeNull();
    expect(approvalText(el, ".error")).toBe("Wrong PIN, try again");
    expect(parkOrder).toHaveBeenCalledTimes(2);
  });
});
