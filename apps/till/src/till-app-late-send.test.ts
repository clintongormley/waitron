import { deviceZonesFixture } from "../test/device-zones.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, draftServer, mountWidget } from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import { setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import type { FormFactor, CapabilityFlag } from "./layout.js";
import { menuOfferToTillProduct } from "./api/client.js";
import type {
  DraftSubmission,
  MenuState,
  RecalledDraftLine,
  TillApi,
  TillMenuOffer,
  ZoneOfferCatalogue,
} from "./api/client.js";
import type { WorkingOrderStore } from "./state/working-order.js";
import { DRAFT_SAVE_DELAY_MS } from "./state/draft-sync.js";
import { HOME_DISPLAY_DEFAULTS } from "@waitron/catalogue/src/device-home.js";
import {
  addDish as addSteak,
  dialog as allergyDialog,
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
/** Breakfast's menu; its Coffee is also sold by Lunch, as a running menu sells the caña. */
const DESAYUNOS: Menu = { id: "desayunos", name: "Desayunos", products: ["Omelette", "Coffee"] };
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

/** Breakfast running with Desayunos orderable, or Lunch running with Breakfast ended earlier today. */
function catalogue(
  phase: "breakfast" | "lunch",
  zoneId = "zone-comedor",
  serviceMode: ZoneOfferCatalogue["context"]["serviceMode"] = "table_tab",
): ZoneOfferCatalogue {
  const running = phase === "breakfast" ? DESAYUNOS.id : LUNCH.id;
  return {
    service: phase === "breakfast" ? breakfastRunning : lunchRunning,
    context: {
      departmentName: "Restaurant",
      zoneId,
      departmentId: "department-restaurant",
      serviceMode,
    },
    defaultMenuId: running,
    menus: [DESAYUNOS, LUNCH].map((menu) => ({
      id: menu.id,
      name: menu.name,
      isDefault: menu.id === running,
      orderable: menu.id === running,
      endedPeriodName: phase === "lunch" && menu.id === DESAYUNOS.id ? "Breakfast" : null,
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
    offers: [DESAYUNOS, LUNCH].flatMap((menu) => menu.products.map((p) => offer(menu, p))),
    zones: [
      {
        id: "zone-comedor",
        name: "Comedor",
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
const BARRA = catalogue("breakfast", "zone-barra", "prepay");

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
  zoneId: "zone-comedor",
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
      .mockResolvedValue(deviceZonesFixture(["zone-barra"], ["z1", "zone-comedor"])),
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
    listDefaultZoneOffers: vi.fn(async () => BARRA),
    listZoneOffers: vi.fn(async (zoneId: string) => (zoneId === "zone-comedor" ? current : BARRA)),
    menuState: vi.fn(async (zoneId: string) => polled(zoneId === "zone-comedor" ? current : BARRA)),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    logout: vi.fn().mockResolvedValue(undefined),
    getTablesState: vi.fn().mockResolvedValue([table]),
    listZones: vi.fn().mockResolvedValue([
      {
        id: "zone-comedor",
        name: "Comedor",
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

/** Seats table 2 under Breakfast and orders an Omelette and a Coffee from Desayunos; no poll has
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
    store.addProduct(menuOfferToTillProduct(offer(DESAYUNOS, product), "v1"), "1");
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
    { menuId: DESAYUNOS.id, periodName: "Breakfast" },
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
    expect(submissions()[0]!.lateSend).toEqual({ menuIds: [DESAYUNOS.id] });
    expect(
      drafts
        .sentGroups(submissions()[0]!)
        .flatMap((group) => group.lines.map((line) => line.menuItemId))
        .sort(),
    ).toEqual([offerId(DESAYUNOS, "Coffee"), offerId(DESAYUNOS, "Omelette")]);
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
      { menuIds: [DESAYUNOS.id] },
      { menuIds: [DESAYUNOS.id] },
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
        expect(saved.lines.map((line) => line.menuItemId)).toEqual([offerId(DESAYUNOS, "Coffee")]);
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
        { menuId: DESAYUNOS.id, periodName: "Breakfast" },
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
      { menuIds: ["brunch", DESAYUNOS.id] },
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
  [{ menuId: DESAYUNOS.id, periodName: "Breakfast" }],
  [offerId(DESAYUNOS, "Omelette")],
);

/** An Omelette sent earlier and recalled into Ana's draft on table 2. */
function seedRecalledOmelette(): void {
  const line: RecalledDraftLine["source"]["line"] = {
    changesAfterSending: null,
    id: "sent-omelette",
    name: "Omelette",
    productId: "Omelette",
    parentProductId: null,
    menuItemId: offerId(DESAYUNOS, "Omelette"),
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
    expect(submissions()[1]!.lateSend).toEqual({ menuIds: [DESAYUNOS.id] });
  });

  it("opens the window again from a second refusal naming another period", async () => {
    const el = await breakfastTable({
      submitDraft: vi
        .fn(drafts.submitDraft)
        .mockRejectedValueOnce(BREAKFAST_ENDED)
        .mockRejectedValueOnce(
          refusal([{ menuId: "brunch", periodName: "Brunch" }], [offerId(DESAYUNOS, "Omelette")]),
        ),
    });
    await act(el, "send-all");

    await choose(el, "data-late-agreed");

    expect(windowDishes(el)).toEqual(["1× Omelette"]);
    expect(heading(el)).toBe("Brunch has ended");
    await choose(el, "data-late-agreed");
    expect(submissions().map((each) => each.lateSend)).toEqual([
      undefined,
      { menuIds: [DESAYUNOS.id] },
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
          refusal([{ menuId: DESAYUNOS.id, periodName: "Breakfast" }], ["offer-elsewhere"]),
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
      { menuIds: [DESAYUNOS.id] },
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
});

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
      { menuIds: [DESAYUNOS.id] },
      { menuIds: [DESAYUNOS.id], override: { personId: MARTA.personId, pin: "0123" } },
    ]);
    expect(approval(el)).toBeNull();
    expect(windowOf(el)).toBeNull();
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

  it("closes the allergy dialog for the PIN, and shows a wrong PIN in the PIN's dialog", async () => {
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
    await userEvent.click(
      allergyOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
    );
    await vi.waitFor(() => expect(allergyDialog(el)).not.toBeNull());
    await userEvent.click(
      allergyDialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!,
    );
    await vi.waitFor(() => expect(windowOf(el)).not.toBeNull());

    await choose(el, "data-late-agreed");
    // The refused send recorded no answer, so its rerun asks the allergy question again.
    expect(allergyDialog(el)).not.toBeNull();
    await userEvent.click(
      allergyDialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!,
    );

    await vi.waitFor(() => expect(approval(el)).not.toBeNull());
    expect(allergyDialog(el)).toBeNull();
    expect(submitDraft.mock.calls[1]![2].lateSend).toEqual({ menuIds: ["lunch"] });
    await authorize(el, "0123");
    await vi.waitFor(() => expect(allergyDialog(el)).not.toBeNull());
    await userEvent.click(
      allergyDialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!,
    );

    await vi.waitFor(() => expect(approvalText(el, ".error")).toBe("Wrong PIN, try again"));
    expect(allergyDialog(el)).toBeNull();
    expect(submitDraft.mock.calls[2]![2].lateSend).toEqual({
      menuIds: ["lunch"],
      override: { personId: MARTA.personId, pin: "0123" },
    });
  });
});
