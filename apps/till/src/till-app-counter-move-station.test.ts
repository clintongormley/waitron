import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import type { TillApp } from "./till-app.js";
import "./till-app.js";
import { setLocale, t } from "./i18n/t.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillCounterWaiting } from "./widgets/counter-waiting.js";
import type { TillStationChoiceDialog } from "./widgets/station-choice-dialog.js";
import type { CanvasDef } from "./layout.js";
import type {
  CounterWaitingOrder,
  Station,
  StationQueue,
  TillApi,
  ZoneOfferCatalogue,
} from "./api/client.js";

// Move to station on a paid counter order waiting to be handed over: one request naming, at most 100
// at a time, the order's movable dishes not already at the chosen station, through the table's move
// route and dialog.

const canvas: CanvasDef = {
  formFactor: "till",
  tabs: [
    {
      key: "counter",
      title: "Counter",
      columns: 12,
      cards: [
        { type: "product-grid", colSpan: 8, rowSpan: 4, config: {} },
        { type: "basket", colSpan: 4, rowSpan: 6, config: {} },
        { type: "held-orders", colSpan: 8, rowSpan: 2, config: {} },
      ],
    },
  ],
};

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
  canvas,
  capabilities: ["take-orders"],
  inactivityTimeoutSeconds: null as number | null,
  nodeId: "n1",
  servers: [],
};

const offers: ZoneOfferCatalogue = {
  service: { open: true, zoneOpen: true, periodName: null, keepOpen: null, zoneKeepOpen: null },
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
  displayOrder,
  isDefault: displayOrder === 0,
  active: true,
  open: true,
  byHand: null,
  sendsTo: null,
  why: "default" as const,
});
const stations = [station("kitchen", "Kitchen", 0), station("grill", "Grill", 1)];

const paid: CounterWaitingOrder = {
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
    listStatuses: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue(stations),
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
  counter(el)
    .shadowRoot!.querySelector("till-card-grid")!
    .shadowRoot!.querySelector<TillCounterWaiting>("till-counter-waiting");
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

async function signedIn(overrides: Record<string, unknown> = {}): Promise<TillApp> {
  api = stubApi(overrides);
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await flush(el);
  emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
  await flush(el);
  return el;
}

async function openMove(overrides: Record<string, unknown> = {}): Promise<TillApp> {
  const el = await signedIn(overrides);
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
