import { TABLE_REQUEST_LIMIT_MS } from "./state/draft-sync.js";
import { deviceZonesFixture } from "../test/device-zones.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { TillBasket } from "./widgets/basket.js";
import type { TillModifierPicker } from "./widgets/modifier-picker.js";
import { BUILD_CHANGED_EVENT } from "@waitron/diagnostics";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import type { TillApp } from "./till-app.js";
import "./till-app.js";
import { setLocale, t } from "./i18n/t.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillCounterWaiting } from "./widgets/counter-waiting.js";
import type { TillStationChoiceDialog } from "./widgets/station-choice-dialog.js";
import type { FormFactor } from "./layout.js";
import type {
  CounterWaitingOrder,
  HeldOrder,
  TabLine,
  TabLines,
  Station,
  StationQueue,
  TillApi,
  ZoneOfferCatalogue,
} from "./api/client.js";

// Move to station on a paid counter order waiting to be handed over: one request naming, at most 100
// at a time, the order's movable dishes not already at the chosen station, through the table's move
// route and dialog.

const formFactor: FormFactor = "till";

const till = {
  locale: "en",
  invoiceLocale: "es-ES",
  venueName: "Bar Pepe",
  nif: "B12345678",
  orderFlow: "ticket_then_pay" as const,
  receiptPrintMode: "auto" as const,
  bumpMode: "line" as const,
  fireControl: "waiter" as const,
  courses: [] as { id: string; name: string; displayOrder: number }[],
  cardProvider: "none" as const,
  tipsEnabled: false,
  formFactor: formFactor,
  capabilities: ["take-orders"],
  inactivityTimeoutSeconds: null as number | null,
  nodeId: "n1",
  servers: [],
};

const offers: ZoneOfferCatalogue = {
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
    zoneId: "zone-counter",
    departmentId: "department-default",
    serviceMode: "ticket_then_pay",
  },
  defaultMenuId: null,
  menus: [],
  offers: [],
};

const station = (id: string, name: string, displayOrder: number): Station => ({
  id,
  name,
  isDefault: displayOrder === 0,
  active: true,
  open: true,
  byHand: null,
  sendsTo: null,
  why: "default" as const,
});
const stations = [station("kitchen", "Kitchen", 0), station("grill", "Grill", 1)];

const paid: CounterWaitingOrder = {
  items: [],
  id: "wo-paid",
  orderNumber: 11,
  label: "Ana",
  status: "settled",
  openedAt: "2026-10-01T10:00:00.000Z",
  settledAt: "2026-10-01T10:01:00.000Z",
  collectedAt: null,
  total: "18.00",
  canHandOver: true,
  serviceMode: null,
  movableDishes: [
    { lineId: "line-1", stationId: "kitchen" },
    { lineId: "line-2", stationId: "kitchen" },
  ],
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let api: TillApi;

/** The server's side: a moved dish is still queued, so it is still listed as movable, at its new
 * station. */
function waitingServer(first: CounterWaitingOrder[] = [paid]) {
  const server = {
    waiting: first,
    listCounterWaiting: vi.fn(async () => server.waiting),
    moveDishStation: vi.fn(async (_id: string, body: { lineIds: string[]; stationId: string }) => {
      server.waiting = server.waiting.map((row) => ({
        ...row,
        movableDishes: row.movableDishes.map((dish) =>
          body.lineIds.includes(dish.lineId) ? { ...dish, stationId: body.stationId } : dish,
        ),
      }));
      return { revision: 2, stationId: body.stationId, moved: [] };
    }),
  };
  return server;
}

function stubApi(overrides: Record<string, unknown> = {}): TillApi {
  return {
    getDeviceZones: vi.fn().mockResolvedValue(deviceZonesFixture(undefined, [])),
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
    getTill: vi.fn().mockResolvedValue(till),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "till-dev",
      name: "Till 1",
      formFactor: "till",
      stationId: null,
    }),
    getDeviceStation: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    listStaff: vi.fn().mockResolvedValue([]),
    listDefaultZoneOffers: vi.fn().mockResolvedValue(offers),
    listZoneOffers: vi.fn().mockResolvedValue(offers),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    getTablesState: vi.fn().mockResolvedValue([]),
    listZones: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue(stations),
    getFindBill: vi.fn(async (workingOrderId: string) => ({
      workingOrderId,
      partyId: null,
      edit: null,
    })),
    getStationQueue: vi.fn().mockResolvedValue({ items: [], notices: [] }),
    logout: vi.fn().mockResolvedValue(undefined),
    ...waitingServer(),
    ...overrides,
  } as unknown as TillApi;
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

const lock = (el: TillApp) => el.shadowRoot!.querySelector<TillLockScreen>("till-lock-screen");
const counter = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
const waitingList = (el: TillApp) =>
  counter(el).shadowRoot!.querySelector<TillCounterWaiting>("till-counter-waiting");
const moveButton = (el: TillApp, id = "wo-paid") =>
  waitingList(el)?.shadowRoot!.querySelector<HTMLElement>(
    `[data-waiting-order="${id}"] [data-waiting-move-station]`,
  ) ?? null;
const dialog = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillStationChoiceDialog>("till-station-choice-dialog");
const dialogRefusal = (el: TillApp) =>
  dialog(el)!.shadowRoot!.querySelector(".refusal")?.textContent?.trim() ?? null;
const alert = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>('[role="alert"]');
/** Installs the waiting list as a refresh would, without one. */
const listNow = (el: TillApp, rows: CounterWaitingOrder[]) =>
  ((el as unknown as { counterWaiting: CounterWaitingOrder[] }).counterWaiting = rows);

async function signedIn(
  overrides: Record<string, unknown> = {},
  props: Partial<TillApp> = {},
): Promise<TillApp> {
  api = stubApi(overrides);
  const { el } = await mountWidget<TillApp>("till-app", { api, ...props });
  await flush(el);
  emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
  await flush(el);
  emit(el.shadowRoot!.querySelector("till-shell")!, "show-counter-orders", { kind: "waiting" });
  await flush(el);
  return el;
}

async function openMove(
  overrides: Record<string, unknown> = {},
  props: Partial<TillApp> = {},
): Promise<TillApp> {
  const el = await signedIn(overrides, props);
  moveButton(el)!.click();
  await flush(el);
  return el;
}

async function choose(el: TillApp, stationId = "grill", rounds = 6): Promise<void> {
  emit(dialog(el)!, "station-chosen", { stationId });
  await flush(el, rounds);
}

/** Picks a station in the open dialog's own field, as a person would. */
async function pick(el: TillApp, index: number): Promise<void> {
  const field = dialog(el)!.shadowRoot!.querySelector<
    HTMLElement & { updateComplete: Promise<unknown> }
  >('wt-combobox[name="station"]')!;
  field.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!.click();
  await field.updateComplete;
  field.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')[index]!.click();
  await flush(el);
}
const dialogMove = (el: TillApp) =>
  dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!;

function held<T>() {
  let answer!: (value: T) => void;
  const promise = new Promise<T>((resolve) => (answer = resolve));
  return { promise, answer };
}

async function changeOperator(el: TillApp): Promise<void> {
  emit(counter(el), "logout");
  await flush(el);
  emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Sam", permissions: [] });
  await flush(el);
}

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

const sentDish = (id: string, lineNo: number, over: Partial<TabLine> = {}): TabLine => ({
  id,
  lineNo,
  stationId: "kitchen",
  movable: true,
  name: `Staff dish ${lineNo}`,
  productId: `dish-${lineNo}`,
  parentLineNo: null,
  quantity: "1.000",
  unitPrecision: 0,
  unitPriceGross: "5.00",
  servedAt: null,
  courseId: null,
  sentAt: "2026-10-19T10:00:00Z",
  firedAt: "2026-10-19T10:00:00Z",
  state: "queued",
  groupId: null,
  note: "No salt",
  listId: null,
  menuItemId: null,
  parentProductId: null,
  ...over,
});

function placedServer() {
  const order: HeldOrder = {
    id: "wo-placed",
    orderNumber: 12,
    label: "Lunch",
    revision: 7,
    kitchenNote: {
      scope: { workingOrderId: "wo-placed" },
      note: null,
      revision: 0,
      ownerRevision: 7,
    },
    lines: [1, 2].map((n) => ({
      workingOrderLineId: `dish-line-${n}`,
      productId: `dish-${n}`,
      quantity: "1.000",
      note: "No salt",
      product: {
        id: `dish-${n}`,
        name: `Staff dish ${n}`,
        customerName: { en: `Customer dish ${n}` },
        unitPrice: "5.00",
        pricingUnit: "each",
        vatClass: "general",
        category: null,
        allergens: null,
      },
    })),
  };
  const server = {
    order,
    lines: {
      revision: 7,
      editSentLines: false,
      lines: [sentDish("dish-line-1", 1), sentDish("dish-line-2", 2)],
    } as TabLines,
    retrievePlacedOrder: vi.fn(async () => structuredClone(server.order)),
    getTabLines: vi.fn(async () => structuredClone(server.lines)),
    moveDishStation: vi.fn(async (_id: string, body: { lineIds: string[]; stationId: string }) => {
      server.order = {
        ...server.order,
        revision: 8,
        kitchenNote: { ...server.order.kitchenNote, ownerRevision: 8 },
      };
      server.lines = {
        ...server.lines,
        revision: 8,
        lines: server.lines.lines.map((line) =>
          body.lineIds.includes(line.id) ? { ...line, stationId: body.stationId } : line,
        ),
      };
      return { revision: 8, stationId: body.stationId, moved: body.lineIds };
    }),
    listCounterWaiting: vi.fn(
      async () =>
        [
          {
            ...paid,
            id: "wo-placed",
            status: "placed",
            settledAt: null,
            canHandOver: false,
            serviceMode: "ticket_then_pay",
            movableDishes: [],
          },
        ] as CounterWaitingOrder[],
    ),
  };
  return server;
}

const basketOf = (el: TillApp) => counter(el).shadowRoot!.querySelector<TillBasket>("till-basket")!;

async function inspectPlaced(overrides: Record<string, unknown> = {}) {
  const server = placedServer();
  const el = await signedIn({ ...server, ...overrides });
  emit(counter(el), "pay-waiting-order", { id: "wo-placed" });
  await flush(el, 6);
  expect(counter(el).stage).toBe("collect");
  expect(basketOf(el).readOnly).toBe(true);
  await userEvent.click(
    basketOf(el).shadowRoot!.querySelector<HTMLElement>('[data-line-detail="1"]')!,
  );
  await flush(el);
  const picker =
    basketOf(el).shadowRoot!.querySelector<TillModifierPicker>("till-modifier-picker")!;
  expect(picker).not.toBeNull();
  return { el, server, picker };
}

it("A738 collection line-window Move sends exactly its dish and keeps collection facts read-only after refresh", async () => {
  const { el, server, picker } = await inspectPlaced();
  expect(picker.readOnly).toBe(true);
  expect(picker.initialSelections?.note).toBe("No salt");
  expect(counter(el).storedLines).toBeNull();
  expect(basketOf(el).shadowRoot!.querySelector("[data-discount-line]")).toBeNull();
  const action = picker.querySelector<HTMLElement>("[data-move-station]");
  expect(action, "collection inspection must have the dish's current move facts").not.toBeNull();
  await userEvent.click(action!);
  await flush(el);
  expect(dialog(el)?.dishName).toBe("Staff dish 2");
  expect(dialog(el)?.wholeOrder).toBe(false);
  expect(dialog(el)?.currentStationId).toBe("kitchen");
  await choose(el);
  expect(server.moveDishStation).toHaveBeenCalledExactlyOnceWith(
    "wo-placed",
    {
      submissionId: expect.stringMatching(UUID),
      lineIds: ["dish-line-2"],
      stationId: "grill",
      expectedEdit: null,
    },
    { signal: expect.any(AbortSignal) },
  );
  expect(server.retrievePlacedOrder).toHaveBeenCalledTimes(2);
  expect(server.getTabLines).toHaveBeenCalledTimes(2);
  expect(counter(el).stage).toBe("collect");
  expect(counter(el).storedLines).toBeNull();
  expect(counter(el).store.revision).toBe(8);
  expect(counter(el).store.total).toBe("10.00");
  expect(
    counter(el).store.lines.map((line) => [line.workingOrderLineId, line.quantity, line.note]),
  ).toEqual([
    ["dish-line-1", "1", "No salt"],
    ["dish-line-2", "1", "No salt"],
  ]);
  expect(dialog(el)).toBeNull();
  expect(server.lines.lines.map((line) => line.stationId)).toEqual(["kitchen", "grill"]);
});

type MoveInvalidation =
  | "order"
  | "generation"
  | "store revision"
  | "listing revision"
  | "listing order"
  | "movable"
  | "missing line"
  | "dirty"
  | "sending"
  | "edit lock"
  | "order action"
  | "capability"
  | "API"
  | "session"
  | "disconnect";

async function invalidateMove(el: TillApp, reason: MoveInvalidation) {
  const store = counter(el).store;
  const state = el as unknown as {
    counterLines: { orderId: string; revision: number; lines: TabLine[] };
    submitting: boolean;
    capabilities: string[];
  };
  switch (reason) {
    case "order":
      store.loadFrom("replacement", [...store.lines], undefined, 7);
      break;
    case "generation":
      store.loadFrom(store.id, [...store.lines], undefined, 7);
      break;
    case "store revision":
      store.loadFrom(store.id, [...store.lines], undefined, 8);
      break;
    case "listing revision":
      state.counterLines = { ...state.counterLines, revision: 8 };
      break;
    case "listing order":
      state.counterLines = { ...state.counterLines, orderId: "replacement" };
      break;
    case "movable":
      state.counterLines = {
        ...state.counterLines,
        lines: state.counterLines.lines.map((line) => ({ ...line, movable: false })),
      };
      break;
    case "missing line":
      state.counterLines = { ...state.counterLines, lines: [] };
      break;
    case "dirty":
      store.setLineExtras(0, { note: "Later local edit" });
      expect(store.dirty).toBe(true);
      break;
    case "sending":
      store.sending = true;
      break;
    case "edit lock":
      store.lockEdits();
      break;
    case "order action":
      state.submitting = true;
      break;
    case "capability":
      state.capabilities = [];
      break;
    case "API":
      el.api = stubApi();
      break;
    case "session":
      await changeOperator(el);
      break;
    case "disconnect":
      el.remove();
      break;
  }
}

for (const phase of ["while stations load", "before confirmation"])
  it.each<MoveInvalidation>([
    "order",
    "generation",
    "store revision",
    "listing revision",
    "listing order",
    "movable",
    "missing line",
    "dirty",
    "sending",
    "edit lock",
    "order action",
    "capability",
    "API",
    "session",
    "disconnect",
  ])(`A738 line-window Move rejects %s ${phase}`, async (reason) => {
    const { el, server, picker } = await inspectPlaced();
    const originalApi = api;
    const stationRead = held<Station[]>();
    if (phase === "while stations load")
      vi.mocked(originalApi.listStations).mockReturnValueOnce(stationRead.promise);
    await userEvent.click(picker.querySelector<HTMLElement>("[data-move-station]")!);
    await flush(el);
    const chooser = dialog(el);
    if (phase === "before confirmation") expect(chooser).not.toBeNull();
    await invalidateMove(el, reason);
    if (phase === "while stations load") {
      stationRead.answer(stations);
      await flush(el);
      expect(dialog(el)).toBeNull();
    } else {
      emit(chooser!, "station-chosen", { stationId: "grill" });
      await flush(el);
    }
    expect(server.moveDishStation).not.toHaveBeenCalled();
    expect(originalApi.moveDishStation).not.toHaveBeenCalled();
  });

it.each(["read failure", "preparing", "collected", "no capability"])(
  "A738 collection inspection offers no station action for %s",
  async (reason) => {
    const server = placedServer();
    if (reason === "preparing" || reason === "collected")
      server.lines.lines[1] = {
        ...server.lines.lines[1]!,
        movable: false,
        ...(reason === "preparing" ? { state: "preparing" } : {}),
      };
    const overrides: Record<string, unknown> = {
      ...server,
      ...(reason === "read failure"
        ? { getTabLines: vi.fn().mockRejectedValue({ code: "server.internal" }) }
        : {}),
      ...(reason === "no capability"
        ? { getTill: vi.fn().mockResolvedValue({ ...till, capabilities: [] }) }
        : {}),
    };
    const { el, picker } = await inspectPlaced(overrides);
    expect(picker.querySelector("[data-move-station]")).toBeNull();
    expect(picker.readOnly).toBe(true);
    expect(picker.shadowRoot!.querySelector(".confirm")).toBeNull();
    expect(counter(el).storedLines).toBeNull();
  },
);

it("A738 collection movement refusal keeps the station choice and refreshes its exact order", async () => {
  const moveDishStation = vi.fn().mockRejectedValue({ code: "ticket.already_started" });
  const { el, server, picker } = await inspectPlaced({ moveDishStation });
  await userEvent.click(picker.querySelector<HTMLElement>("[data-move-station]")!);
  await flush(el);
  await choose(el);
  expect(moveDishStation).toHaveBeenCalledOnce();
  expect(server.retrievePlacedOrder).toHaveBeenCalledTimes(2);
  expect(dialog(el)?.busy).toBe(false);
  expect(dialogRefusal(el)).toBe(t("move_station.refused.ticket.already_started"));
  expect(counter(el).stage).toBe("collect");
  expect(counter(el).storedLines).toBeNull();
  expect(counter(el).store.total).toBe("10.00");
});

it.each(["order", "session", "API"])(
  "A738 drops collection movement facts after the %s changes during their read",
  async (reason) => {
    const server = placedServer();
    const read = held<TabLines>();
    const el = await signedIn({ ...server, getTabLines: vi.fn(() => read.promise) });
    emit(counter(el), "pay-waiting-order", { id: "wo-placed" });
    await flush(el);
    expect(counter(el).store.editsLocked).toBe(true);
    if (reason === "order") counter(el).store.loadFrom("replacement", [], undefined, 3);
    if (reason === "session") await changeOperator(el);
    if (reason === "API") el.api = stubApi();
    await flush(el);
    read.answer(server.lines);
    await flush(el, 6);
    expect(counter(el).store.id).not.toBe("wo-placed");
    expect(counter(el).stage).toBe("order");
    expect(basketOf(el).stationMoveLines).toBeNull();
    expect(server.moveDishStation).not.toHaveBeenCalled();
    expect(counter(el).store.editsLocked).toBe(false);
  },
);

it("A738 collection station confirmation sends once and locks the basket until its refresh", async () => {
  const result = held<{ revision: number }>();
  const moveDishStation = vi.fn(() => result.promise);
  const { el, picker } = await inspectPlaced({ moveDishStation });
  await userEvent.click(picker.querySelector<HTMLElement>("[data-move-station]")!);
  await flush(el);
  await pick(el, 1);
  dialogMove(el).click();
  dialogMove(el).click();
  await flush(el);
  expect(moveDishStation).toHaveBeenCalledOnce();
  expect(counter(el).store.editsLocked).toBe(true);
  result.answer({ revision: 8 });
  await flush(el, 6);
  expect(dialog(el)).toBeNull();
  expect(counter(el).store.editsLocked).toBe(false);
  expect(counter(el).stage).toBe("collect");
});

it("A738 collection station read is bounded and offers no chooser after a refused read", async () => {
  const { el, picker } = await inspectPlaced();
  let signal: AbortSignal | undefined;
  vi.mocked(api.listStations).mockImplementationOnce((_options) => {
    signal = _options?.signal;
    return new Promise((_resolve, reject) =>
      signal?.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")), {
        once: true,
      }),
    );
  });
  try {
    vi.useFakeTimers();
    picker.querySelector<HTMLElement>("[data-move-station]")!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(TABLE_REQUEST_LIMIT_MS);
    expect(signal?.aborted).toBe(true);
  } finally {
    vi.useRealTimers();
  }
  await flush(el);
  expect(dialog(el)).toBeNull();
  expect(api.moveDishStation).not.toHaveBeenCalled();
});

describe("till-app: moving a paid counter order to another station", () => {
  it("reads the stations and opens the move dialog headed with the order, at the station its dishes share", async () => {
    const el = await signedIn();
    const reads = vi.mocked(api.listStations).mock.calls.length;

    moveButton(el)!.click();
    await flush(el);

    expect(api.listStations).toHaveBeenCalledTimes(reads + 1);
    const open = dialog(el)!;
    expect(open.mode).toBe("move");
    expect(open.dishName).toBe("#11 Ana");
    expect(open.wholeOrder).toBe(true);
    expect(open.currentStationId).toBe("kitchen");
    expect(open.stations).toEqual(stations);
    expect(api.moveDishStation).not.toHaveBeenCalled();
  });

  it("opens at no station when the order's dishes are at different ones", async () => {
    const el = await openMove(
      waitingServer([
        {
          ...paid,
          movableDishes: [
            { lineId: "line-1", stationId: "kitchen" },
            { lineId: "line-2", stationId: "grill" },
          ],
        },
      ]),
    );

    expect(dialog(el)!.currentStationId).toBeNull();
  });

  it("A773 cancels an unanswered bill observation and allows a later destination choice", async () => {
    const getFindBill = vi.fn(
      (_id: string, options?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          options?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Timed out", "AbortError")),
            { once: true },
          ),
        ),
    );
    const el = await signedIn({ getFindBill });
    try {
      vi.useFakeTimers();
      moveButton(el)!.click();
      await vi.advanceTimersByTimeAsync(0);
      expect(getFindBill).toHaveBeenCalledExactlyOnceWith("wo-paid", {
        signal: expect.any(AbortSignal),
      });
      const signal = getFindBill.mock.calls[0]![1]!.signal!;
      expect(signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(TABLE_REQUEST_LIMIT_MS);
      expect(signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    await flush(el);
    expect(dialog(el)).toBeNull();
    vi.mocked(api.getFindBill).mockResolvedValue({
      workingOrderId: "wo-paid",
      partyId: null,
      edit: null,
    } as Awaited<ReturnType<TillApi["getFindBill"]>>);
    moveButton(el)!.click();
    await expect.poll(() => dialog(el)).not.toBeNull();
  });

  it("A773 reads and retains a waiting table bill's editing observation", async () => {
    const expectedEdit = {
      billId: "wo-paid",
      editorVersion: 6,
      draftId: null,
      draftRevision: null,
    };
    const getFindBill = vi.fn().mockResolvedValue({
      workingOrderId: "wo-paid",
      partyId: "party-1",
      edit: { ...expectedEdit, editorId: null, editorName: null },
    });
    const el = await openMove({ getFindBill });
    await choose(el, "grill");
    await expect.poll(() => vi.mocked(api.moveDishStation).mock.calls.length).toBe(1);
    expect(getFindBill).toHaveBeenCalledOnce();
    expect(vi.mocked(api.moveDishStation).mock.calls[0]![1]).toEqual({
      submissionId: expect.any(String),
      lineIds: ["line-1", "line-2"],
      stationId: "grill",
      expectedEdit,
    });
  });

  it("sends one move naming every dish the list holds that is not already at the chosen station, then closes", async () => {
    const el = await openMove();
    listNow(el, [
      {
        ...paid,
        movableDishes: [
          { lineId: "line-2", stationId: "kitchen" },
          { lineId: "line-3", stationId: "kitchen" },
        ],
      },
    ]);

    await choose(el);

    expect(api.moveDishStation).toHaveBeenCalledOnce();
    expect(api.moveDishStation).toHaveBeenCalledWith(
      "wo-paid",
      {
        submissionId: expect.stringMatching(UUID),
        lineIds: ["line-2", "line-3"],
        stationId: "grill",
        expectedEdit: null,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(dialog(el)).toBeNull();
  });

  it("reads the kitchen queue and then the waiting list again after the move", async () => {
    const server = waitingServer();
    server.moveDishStation.mockImplementation(async (_id, body) => {
      server.waiting = [{ ...paid, movableDishes: [] }];
      return { revision: 2, stationId: body.stationId, moved: [] };
    });
    const el = await openMove(server);
    const queueReads = vi.mocked(api.getStationQueue).mock.calls.length;
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;

    await choose(el);

    expect(api.getStationQueue).toHaveBeenCalledTimes(queueReads + 1);
    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads + 1);
    expect(vi.mocked(api.getStationQueue).mock.invocationCallOrder.at(-1)!).toBeLessThan(
      vi.mocked(api.listCounterWaiting).mock.invocationCallOrder.at(-1)!,
    );
    expect(moveButton(el)).toBeNull();
  });

  it.each([
    ["kitchen queue", "station", "refresh.station_after_move"],
    ["waiting list", "waiting", "refresh.waiting_after_move"],
  ] as const)(
    "says the dishes moved when the %s cannot be read after the move",
    async (_list, list, key) => {
      const el = await openMove();
      if (list === "station")
        vi.mocked(api.getStationQueue).mockRejectedValue(new TypeError("Failed to fetch"));
      else vi.mocked(api.listCounterWaiting).mockRejectedValue(new TypeError("Failed to fetch"));

      await choose(el);

      const notice = el.shadowRoot!.querySelector<HTMLElement>(`[data-refresh-notice="${list}"]`)!;
      expect(notice.textContent).toContain(t(key));
    },
  );

  it("a refusal whose order still has dishes to move keeps the dialog open, in the order's words", async () => {
    const el = await openMove({
      moveDishStation: vi.fn().mockRejectedValue({ code: "ticket.already_started" }),
    });
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;

    await choose(el);

    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads + 1);
    expect(dialog(el)).not.toBeNull();
    expect(dialog(el)!.busy).toBe(false);
    expect(dialogRefusal(el)).toBe(t("move_station.order_refused.ticket.already_started"));
    expect(alert(el)).toBeNull();
  });

  it("a refusal whose order has left the list closes the dialog and says it in the till's message line", async () => {
    const server = waitingServer();
    server.moveDishStation.mockImplementation(async () => {
      server.waiting = [];
      throw { code: "ticket.already_started" };
    });
    const el = await openMove(server);

    await choose(el);

    expect(dialog(el)).toBeNull();
    expect(alert(el)!.textContent!.trim()).toBe(
      t("move_station.order_refused.ticket.already_started"),
    );
  });

  it("a refusal whose order has nothing left to move closes the dialog too", async () => {
    const server = waitingServer();
    server.moveDishStation.mockImplementation(async () => {
      server.waiting = [{ ...paid, movableDishes: [] }];
      throw { code: "route.station_inactive" };
    });
    const el = await openMove(server);

    await choose(el);

    expect(dialog(el)).toBeNull();
    expect(alert(el)).not.toBeNull();
  });

  it.each([
    ["has left the list", [] as CounterWaitingOrder[]],
    ["has nothing left to move", [{ ...paid, movableDishes: [] }]],
    [
      "has every dish at the chosen station already",
      [{ ...paid, movableDishes: [{ lineId: "line-1", stationId: "grill" }] }],
    ],
  ])(
    "sends nothing, and closes, when the order %s before the station is chosen",
    async (_how, rows) => {
      const el = await openMove();
      listNow(el, rows);
      await flush(el);

      await choose(el);

      expect(api.moveDishStation).not.toHaveBeenCalled();
      expect(dialog(el)).toBeNull();
    },
  );

  it("sends the first 100 of 101 movable dishes, the most one move takes", async () => {
    const movableDishes = Array.from({ length: 101 }, (_, n) => ({
      lineId: `line-${n}`,
      stationId: "kitchen",
    }));
    const el = await openMove(waitingServer([{ ...paid, movableDishes }]));

    await choose(el);

    const sent = vi.mocked(api.moveDishStation).mock.calls[0]![1].lineIds;
    expect(sent).toEqual(movableDishes.slice(0, 100).map((dish) => dish.lineId));
  });

  it("a second move to the same station sends only the dishes the first left behind", async () => {
    const movableDishes = Array.from({ length: 101 }, (_, n) => ({
      lineId: `line-${n}`,
      stationId: "kitchen",
    }));
    const server = waitingServer([{ ...paid, movableDishes }]);
    const el = await openMove(server);
    await choose(el);
    expect(dialog(el)).toBeNull();

    moveButton(el)!.click();
    await flush(el);
    expect(dialog(el)!.currentStationId).toBeNull();
    await choose(el);

    const calls = vi.mocked(api.moveDishStation).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]![1].lineIds).toEqual(movableDishes.slice(0, 100).map((dish) => dish.lineId));
    expect(calls[1]![1].lineIds).toEqual(["line-100"]);
    expect(server.waiting[0]!.movableDishes).toEqual(
      movableDishes.map((dish) => ({ ...dish, stationId: "grill" })),
    );
  });

  it("is not offered on a device whose profile may not take orders", async () => {
    const el = await signedIn({
      getTill: vi.fn().mockResolvedValue({ ...till, capabilities: [] }),
    });

    expect(waitingList(el)!.shadowRoot!.querySelector("[data-waiting-hand-over]")).not.toBeNull();
    expect(moveButton(el)).toBeNull();
  });

  it("a refusal arriving after the operator signed out shows nothing to the next one", async () => {
    let refuse!: (error: unknown) => void;
    const el = await openMove({
      moveDishStation: vi.fn(() => new Promise((_resolve, reject) => (refuse = reject))),
    });
    await choose(el);

    emit(counter(el), "logout");
    await flush(el);
    emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Sam", permissions: [] });
    await flush(el);
    const queueReads = vi.mocked(api.getStationQueue).mock.calls.length;
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    refuse({ code: "ticket.already_started" });
    await flush(el, 6);

    expect(api.getStationQueue).toHaveBeenCalledTimes(queueReads);
    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
    expect(dialog(el)).toBeNull();
    expect(alert(el)).toBeNull();
  });

  it("opens nothing when the operator signs out while the stations are read", async () => {
    const el = await signedIn();
    let answer!: (rows: Station[]) => void;
    vi.mocked(api.listStations).mockImplementationOnce(
      () => new Promise<Station[]>((resolve) => (answer = resolve)),
    );
    moveButton(el)!.click();
    await flush(el);

    emit(counter(el), "logout");
    await flush(el);
    emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Sam", permissions: [] });
    await flush(el);
    answer(stations);
    await flush(el);

    expect(dialog(el)).toBeNull();
  });

  it("a second press of Move to station while the stations are read reads them once and opens one dialog", async () => {
    const el = await signedIn();
    const reads = vi.mocked(api.listStations).mock.calls.length;
    const stationsRead = held<Station[]>();
    vi.mocked(api.listStations).mockImplementation(() => stationsRead.promise);

    moveButton(el)!.click();
    await flush(el);
    moveButton(el)!.click();
    await flush(el);
    stationsRead.answer(stations);
    await flush(el);

    expect(api.listStations).toHaveBeenCalledTimes(reads + 1);
    expect(el.shadowRoot!.querySelectorAll("till-station-choice-dialog")).toHaveLength(1);
    expect(dialog(el)!.currentStationId).toBe("kitchen");
  });

  it("a second press of the dialog's Move handled before the till redraws sends no second move", async () => {
    const el = await openMove();
    await pick(el, 1);

    dialogMove(el).click();
    dialogMove(el).click();
    await flush(el, 6);

    expect(api.moveDishStation).toHaveBeenCalledOnce();
    expect(dialog(el)).toBeNull();
  });

  it("does not read the waiting list when the operator changes while the kitchen queue is read after a move", async () => {
    const queueRead = held<StationQueue>();
    const el = await openMove();
    vi.mocked(api.getStationQueue).mockImplementationOnce(() => queueRead.promise);
    await choose(el);
    expect(api.moveDishStation).toHaveBeenCalledOnce();

    await changeOperator(el);
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    queueRead.answer({ printersDown: [], items: [], notices: [] });
    await flush(el, 6);

    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not read the waiting list when the operator changes while the kitchen queue is read after a refusal", async () => {
    const queueRead = held<StationQueue>();
    const el = await openMove({
      moveDishStation: vi.fn().mockRejectedValue({ code: "ticket.already_started" }),
    });
    vi.mocked(api.getStationQueue).mockImplementationOnce(() => queueRead.promise);
    await choose(el);
    expect(api.moveDishStation).toHaveBeenCalledOnce();

    await changeOperator(el);
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    queueRead.answer({ printersDown: [], items: [], notices: [] });
    await flush(el, 6);

    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
    expect(dialog(el)).toBeNull();
    expect(alert(el)).toBeNull();
  });
});

describe("till-app: a box update while a station move still waits for the server", () => {
  it("shows the bar instead of reloading after an idle sign-out", async () => {
    const activity = {
      configure: vi.fn(),
      noteInteraction: vi.fn(),
      reacquire: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const reload = vi.fn();
    const moveDishStation = vi.fn(() => new Promise(() => {}));
    const el = await openMove({ moveDishStation }, { reload, sessionActivity: activity as never });
    await choose(el);
    expect(moveDishStation).toHaveBeenCalledOnce();

    (activity.configure.mock.calls.at(-1)![0] as { onIdle: () => void }).onIdle();
    await flush(el, 6);
    window.dispatchEvent(new Event(BUILD_CHANGED_EVENT));
    await flush(el);

    expect(reload).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("wt-banner[data-test=update-bar]")).not.toBeNull();
  });
});
