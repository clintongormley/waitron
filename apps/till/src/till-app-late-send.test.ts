import { deviceZonesFixture } from "../test/device-zones.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, draftServer, mountWidget } from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import { setLocale } from "./i18n/t.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import type { FormFactor, CapabilityFlag } from "./layout.js";
import { menuOfferToTillProduct } from "./api/client.js";
import type {
  DraftSubmission,
  MenuState,
  TillApi,
  TillMenuOffer,
  ZoneOfferCatalogue,
} from "./api/client.js";
import type { WorkingOrderStore } from "./state/working-order.js";
import { DRAFT_SAVE_DELAY_MS } from "./state/draft-sync.js";
import { HOME_DISPLAY_DEFAULTS } from "@waitron/catalogue/src/device-home.js";

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

/** Seats table 2 under Breakfast, orders an Omelette and a Coffee from Desayunos, then lets Lunch
 * start: the Omelette is marked "Breakfast ended", the Coffee is not, because Lunch sells it too. */
async function lateTable(overrides: Record<string, unknown> = {}): Promise<TillApp> {
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
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50));
    await flush(el);
    const saves = api.saveDraft!.mock.calls;
    expect(
      (saves.at(-1)![1] as { lines: { menuItemId: string }[] }).lines.map((l) => l.menuItemId),
    ).toEqual([offerId(DESAYUNOS, "Coffee")]);
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
