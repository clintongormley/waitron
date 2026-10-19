import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WtInput } from "@waitron/ui";
import { userEvent } from "vitest/browser";
import type { AllergySendTarget, PartyAllergyRead } from "@waitron/module";
import { deviceZonesFixture } from "../test/device-zones.js";
import { HOME_DISPLAY_DEFAULTS } from "@waitron/catalogue/src/device-home.js";
import {
  cleanupWidgets,
  draftServer,
  mountWidget,
  type DraftServer,
} from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillFloorScreen } from "./screens/till-floor-screen.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import type { TillMenuBrowser } from "./widgets/menu-browser.js";
import type { TillPartyAllergyDialog } from "./widgets/party-allergy-dialog.js";
import type { FormFactor, CapabilityFlag } from "./layout.js";
import type {
  TableParty,
  TableState,
  TillApi,
  TillMenuOffer,
  ZoneOfferCatalogue,
} from "./api/client.js";
const unit = {
  id: "unit-each",
  name: { es: "unit", en: "unit" },
  abbreviation: { es: "ea", en: "ea" },
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
    status: null,
    nextReservation: null,
    today: null,
    signals: [],
    party: tableParty,
  };
}

const table4 = table("t4", "4", party());
const table7 = table(
  "t7",
  "7",
  party({ id: "v7", revision: 9, mainBillId: "wo-7", tableIds: ["t7"] }),
);

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
  server.bills.add("wo-7");
  server.bills.add("wo-new");
  return {
    getDeviceZones: vi.fn().mockResolvedValue(deviceZonesFixture(undefined, ["z1"])),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Spanish" },
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
    getStationQueue: vi.fn().mockResolvedValue({ items: [], notices: [] }),
    listDefaultZoneOffers: vi.fn().mockResolvedValue({
      ...catalogue("v1"),
      context: { ...catalogue("v1").context, zoneId: "zc" },
    }),
    listZoneOffers: vi.fn().mockResolvedValue(catalogue("v1")),
    menuState: vi.fn(() => new Promise(() => {})),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
    getTablesState: vi.fn().mockResolvedValue([table4, table7]),
    listZones: vi
      .fn()
      .mockResolvedValue([
        { id: "z1", name: "Dining room", displayOrder: 0, active: true, serviceMode: "table_tab" },
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
    readPartyAllergy: vi.fn().mockImplementation(async () => allergyView("none")),
    previewPartyAllergy: vi
      .fn()
      .mockImplementation(async (_partyId: string, target: AllergySendTarget) =>
        allergyView(null, target),
      ),
    takeOverDraft: server.takeOverDraft,
    logout: vi.fn().mockResolvedValue(undefined),
    sendLines: vi.fn().mockResolvedValue(undefined),
    fireGroup: vi.fn().mockResolvedValue({ revision: 4 }),
    fireHeldLine: vi.fn().mockResolvedValue({ revision: 4 }),
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
const browser = (el: TillApp) =>
  tableOrder(el)!.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser");
const draft = (el: TillApp) => tableOrder(el)!.draftStore!;

async function signIn(el: TillApp, personId = "p1", displayName = "Ana"): Promise<void> {
  server.personId = personId;
  server.personName = displayName;
  emit(lock(el), "logged-in", { personId, displayName, permissions: [] });
  await flush(el);
}

async function openTable(el: TillApp, tableId = "t4"): Promise<TillTableOrderScreen> {
  await flush(el);
  await signIn(el);
  emit(shell(el), "screen-select", { screen: "floor" });
  await flush(el);
  emit(floor(el)!, "open-table", { tableId, seated: true });
  await flush(el);
  return tableOrder(el)!;
}

/** Taps a dish's tile, without waiting. */
async function addDish(el: TillApp): Promise<void> {
  const tile = [...browser(el)!.shadowRoot!.querySelectorAll<HTMLElement>("wt-button")].find(
    (button) => button.querySelector(".name")?.textContent === "Steak",
  )!;
  await userEvent.click(tile);
  await flush(el);
  const review = tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>("[data-review-open]");
  if (review && review.getBoundingClientRect().width > 0) await userEvent.click(review);
  await flush(el);
}
const dialog = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillPartyAllergyDialog>("till-party-allergy-dialog");
function allergyView(
  answer: null | "none" | "allergies",
  target?: AllergySendTarget,
): PartyAllergyRead {
  return {
    partyId: "v1",
    snapshot: { answer, guests: [], ticks: [], changedAt: null, changedBy: null, revision: 3 },
    dishes:
      target?.kind === "draft"
        ? target.lineIds.map((id) => ({
            line: { kind: "draft", id },
            billId: "wo-4",
            name: "Steak",
            quantity: "1.000",
            allergens: null,
            extras: [],
            sentAt: null,
            offeredBefore: false,
          }))
        : target === undefined
          ? []
          : [
              {
                line: { kind: "working", id: "held-line" },
                billId: "wo-4",
                name: "Steak",
                quantity: "1.000",
                allergens: null,
                extras: [],
                sentAt: null,
                offeredBefore: true,
              },
            ],
  };
}
const originalLocale = currentLocale();
beforeEach(() => {
  setLocale("en");
  server = draftServer();
});
afterEach(() => {
  cleanupWidgets();
  setLocale(originalLocale);
});

describe("A669 table orchestration", () => {
  it.each(["send-all", "fire-selected"])(
    "asks before %s and sends saved ids and the editing observation with the answer",
    async (action) => {
      const { el } = await mountApp();
      await openTable(el);
      await addDish(el);
      const screen = tableOrder(el)!;
      if (action === "fire-selected")
        await userEvent.click(
          screen.shadowRoot!.querySelector<HTMLElement>("[data-draft-select]")!,
        );
      await userEvent.click(
        screen.shadowRoot!.querySelector<HTMLElement>(`[data-draft-action="${action}"]`)!,
      );
      await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
      expect(api.submitDraft).not.toHaveBeenCalled();
      expect(draft(el).sending).toBe(true);
      const preview = api.previewPartyAllergy!.mock.calls[0]![1] as Extract<
        AllergySendTarget,
        { kind: "draft" }
      >;
      expect(preview).toEqual({
        kind: "draft",
        draftId: server.drafts[0]!.id,
        lineIds: [server.drafts[0]!.lines[0]!.id],
      });
      await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
      await vi.waitFor(() => expect(api.submitDraft).toHaveBeenCalledOnce());
      const packet = api.submitDraft!.mock.calls[0]![2];
      expect(packet).toMatchObject({
        expectedPartyRevision: 3,
        draftRevision: 1,
        allergy: { party: { answer: "none", guests: [] }, ticks: [] },
        groups: [{ release: action === "send-all" ? "hold" : "fire", lineIds: preview.lineIds }],
      });
      expect(packet.expectedEdit).toMatchObject({
        billId: "wo-4",
        draftId: preview.draftId,
        draftRevision: 1,
      });
    },
  );
  it("cancels without sending or dropping the draft", async () => {
    const { el } = await mountApp();
    await openTable(el);
    await addDish(el);
    await userEvent.click(
      tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
    );
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!);
    await vi.waitFor(() => expect(draft(el).sending).toBe(false));
    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(draft(el).lines).toHaveLength(1);
  });
  it("a failed preview blocks the send without inventing an answer", async () => {
    const { el } = await mountApp({
      previewPartyAllergy: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    await openTable(el);
    await addDish(el);
    await userEvent.click(
      tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
    );
    await vi.waitFor(() => expect(api.previewPartyAllergy).toHaveBeenCalledOnce());
    await flush(el);
    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(draft(el).sending).toBe(false);
    expect(el.shadowRoot!.querySelector(".error")?.textContent?.trim()).toBeTruthy();
  });
});

it.each([
  { kind: "lines", event: "send-lines", method: "sendLines" },
  { kind: "group", event: "fire-group", method: "fireGroup" },
  { kind: "held-line", event: "fire-held-line", method: "fireHeldLine" },
] as const)(
  "asks before releasing $kind and attaches the explicit answer",
  async ({ kind, event, method }) => {
    const { el } = await mountApp();
    const screen = await openTable(el);
    const expectedEdit = screen.billEdit;
    emit(
      screen,
      event,
      kind === "lines"
        ? { lineNos: [2], expectedEdit }
        : kind === "group"
          ? { groupId: "held-group" }
          : { lineId: "held-line" },
    );
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    expect(api[method]).not.toHaveBeenCalled();
    await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
    await vi.waitFor(() => expect(api[method]).toHaveBeenCalledOnce());
    const command = api[method]!.mock.calls[0]![kind === "lines" ? 3 : 2];
    expect(command).toMatchObject({
      expectedPartyRevision: 3,
      allergy: { party: { answer: "none", guests: [] }, ticks: [] },
    });
    expect(command.submissionId).toEqual(expect.any(String));
    if (kind === "lines")
      expect(api[method]!.mock.calls[0]!.slice(0, 3)).toEqual(["wo-4", [2], expectedEdit]);
    else
      expect(api[method]!.mock.calls[0]!.slice(0, 2)).toEqual([
        "v1",
        kind === "group" ? "held-group" : "held-line",
      ]);
  },
);

it("refreshes party metadata before using a newer allergy revision without replacing the draft", async () => {
  const getTablesState = vi.fn().mockResolvedValue([table4]);
  const listGroups = vi.fn().mockResolvedValue({ revision: 5, groups: [] });
  const readCurrentOrders = vi.fn().mockResolvedValue({
    revision: 5,
    hasGroups: false,
    nextDisplayNumber: 1,
    retainedCourses: [],
    groups: [],
    ungrouped: [],
    reminder: null,
  });
  const previewPartyAllergy = vi
    .fn()
    .mockImplementation(async (_id: string, target: AllergySendTarget) => ({
      ...allergyView(null, target),
      snapshot: { ...allergyView(null).snapshot, revision: 5 },
    }));
  const { el } = await mountApp({
    getTablesState,
    listGroups,
    readCurrentOrders,
    previewPartyAllergy,
  });
  await openTable(el);
  await addDish(el);
  const store = draft(el);
  const loadsBefore = server.listDrafts.mock.calls.length;
  getTablesState.mockResolvedValue([table("t4", "4", party({ revision: 5 }))]);
  const floorReads = getTablesState.mock.calls.length;
  await userEvent.click(
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
  );
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  expect(getTablesState.mock.calls.length).toBeGreaterThan(floorReads);
  expect(tableOrder(el)!.party?.revision).toBe(5);
  expect(draft(el)).toBe(store);
  expect(server.listDrafts.mock.calls.length).toBe(loadsBefore);
  expect(api.submitDraft).not.toHaveBeenCalled();
  await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
  await vi.waitFor(() => expect(api.submitDraft).toHaveBeenCalledOnce());
  expect(api.submitDraft!.mock.calls[0]![2].expectedPartyRevision).toBe(5);
});

it("keeps the answer and permits retry after the server refuses an allergy write", async () => {
  const submitDraft = vi
    .fn<TillApi["submitDraft"]>()
    .mockRejectedValueOnce({ code: "allergy.unanswered" })
    .mockImplementation((id, did, packet) => server.submitDraft(id, did, packet));
  const { el } = await mountApp({ submitDraft });
  await openTable(el);
  await addDish(el);
  await userEvent.click(
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
  );
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  const form = dialog(el)!;
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
  await vi.waitFor(() => expect(form.busy).toBe(false));
  expect(form.refusal).not.toBe("");
  expect(dialog(el)).toBe(form);
  expect(draft(el).sending).toBe(true);
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
  await vi.waitFor(() => expect(submitDraft).toHaveBeenCalledTimes(2));
  expect(submitDraft.mock.calls[1]![2].allergy).toEqual({
    party: { answer: "none", guests: [] },
    ticks: [],
  });
});

it("does not spend the network deadline while the waiter is answering", async () => {
  const { el } = await mountApp();
  await openTable(el);
  await addDish(el);
  const timers = vi.spyOn(window, "setTimeout");
  const cleared = vi.spyOn(window, "clearTimeout");
  try {
    await userEvent.click(
      tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
    );
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    const { TABLE_REQUEST_LIMIT_MS } = await import("./state/draft-sync.js");
    const requestTimers = timers.mock.calls.flatMap(([, delay], index) =>
      delay === TABLE_REQUEST_LIMIT_MS ? [timers.mock.results[index]!.value] : [],
    );
    expect(requestTimers.length).toBeGreaterThan(0);
    for (const timer of requestTimers) expect(cleared.mock.calls.flat()).toContain(timer);
  } finally {
    timers.mockRestore();
    cleared.mockRestore();
  }
});

it("puts a server's guest field refusal on that guest and permits correction", async () => {
  const submitDraft = vi.fn().mockRejectedValue({ code: "allergy.invalid", field: "guests.0.who" });
  const { el } = await mountApp({ submitDraft });
  await openTable(el);
  await addDish(el);
  await userEvent.click(
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
  );
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  const form = dialog(el)!;
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-allergies]")!);
  await userEvent.fill(
    form
      .shadowRoot!.querySelector('wt-input[name="guest-0-who"]')!
      .shadowRoot!.querySelector("input")!,
    "Blue shirt",
  );
  await userEvent.click(form.shadowRoot!.querySelector<HTMLInputElement>('[data-code="milk"]')!);
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!);
  await vi.waitFor(() => expect(submitDraft).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(form.fieldRefusal).toMatchObject({ field: "who", guestIndex: 0 }));
  expect(form.shadowRoot!.querySelector<WtInput>('wt-input[name="guest-0-who"]')!.error).not.toBe(
    "",
  );
});

it("never moves the shown party backwards to match an older allergy read", async () => {
  const getTablesState = vi.fn().mockResolvedValue([table("t4", "4", party({ revision: 5 }))]);
  const { el } = await mountApp({ getTablesState });
  await openTable(el);
  await addDish(el);
  getTablesState.mockResolvedValue([table4]);
  await userEvent.click(
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
  );
  await vi.waitFor(() => expect(api.previewPartyAllergy).toHaveBeenCalledOnce());
  await flush(el);
  expect(tableOrder(el)!.party!.revision).toBe(5);
  expect(dialog(el)).toBeNull();
  expect(api.submitDraft).not.toHaveBeenCalled();
});

it.each(["success", "refusal"] as const)(
  "does not apply a late %s submit to a replacement API's view",
  async (outcome) => {
    let resolve!: (value: Awaited<ReturnType<TillApi["submitDraft"]>>) => void;
    let reject!: (error: unknown) => void;
    const pending = new Promise<Awaited<ReturnType<TillApi["submitDraft"]>>>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const submitDraft = vi.fn().mockReturnValue(pending);
    const { el } = await mountApp({
      submitDraft,
      previewPartyAllergy: vi
        .fn()
        .mockImplementation(async (_id: string, target: AllergySendTarget) =>
          allergyView("none", target),
        ),
    });
    await openTable(el);
    await addDish(el);
    await userEvent.click(
      tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
    );
    await vi.waitFor(() => expect(submitDraft).toHaveBeenCalledOnce());
    const [partyId, draftId, packet] = submitDraft.mock.calls[0]!;
    el.api = { ...api } as unknown as TillApi;
    await flush(el, 6);
    if (outcome === "success") resolve(server.apply(partyId, draftId, packet));
    else reject({ code: "party.out_of_date" });
    await flush(el, 6);
    expect(tableOrder(el)).not.toBeNull();
    expect(tableOrder(el)!.party!.revision).toBe(3);
    expect(el.shadowRoot!.querySelector(".error")?.textContent?.trim() ?? "").toBe("");
  },
);

it("keeps the newest release opening when older previews answer last", async () => {
  const answers: ((view: PartyAllergyRead) => void)[] = [];
  const previewPartyAllergy = vi.fn().mockImplementation(
    () =>
      new Promise<PartyAllergyRead>((resolve) => {
        answers.push(resolve);
      }),
  );
  const { el } = await mountApp({ previewPartyAllergy });
  const screen = await openTable(el);
  emit(screen, "send-lines", { lineNos: [2], expectedEdit: screen.billEdit });
  emit(screen, "send-lines", { lineNos: [2], expectedEdit: screen.billEdit });
  await vi.waitFor(() => expect(answers).toHaveLength(2));
  const view = allergyView(null, { kind: "lines", orderId: "wo-4", lineNos: [2] });
  answers[1]!(view);
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  const key = dialog(el)!.scopeKey;
  answers[0]!(view);
  await flush(el, 6);
  expect(dialog(el)!.scopeKey).toBe(key);
  await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
  await vi.waitFor(() => expect(api.sendLines).toHaveBeenCalledOnce());
});

it("keeps a duplicate grouped submit frozen until the allergy confirmation finishes", async () => {
  const { el } = await mountApp();
  const screen = await openTable(el);
  await addDish(el);
  const store = draft(el);
  const detail = {
    groups: [{ release: "hold", joinGroupId: "held-group", lineIndexes: [0] }],
    sent: [store.lines[0]!],
    store,
  };
  emit(screen, "submit-draft", detail);
  emit(screen, "submit-draft", detail);
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  await flush(el, 6);
  expect(store.sending).toBe(true);
  expect(api.submitDraft).not.toHaveBeenCalled();
  await userEvent.click(dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-none]")!);
  await vi.waitFor(() => expect(api.submitDraft).toHaveBeenCalledOnce());
});
