import { afterEach, describe, expect, it, vi } from "vitest";
import type { FloorMapDrop, WtFloorMap } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import "./till-floor-screen.js";
import type { FloorZone, TableParty, TableState, TableToday, TillApi } from "../api/client.js";

function zone(over: Partial<FloorZone> = {}): FloorZone {
  return {
    id: "z1",
    name: "Comedor",
    displayOrder: 0,
    active: true,
    closesAt: null,
    closed: false,
    hasPlan: false,
    ...over,
  };
}

function today(x: number, over: Partial<TableToday> = {}): TableToday {
  return {
    placement: { x, y: 3, width: 2, height: 2, shape: "round", rotation: 0 },
    seats: 4,
    fixed: false,
    takenOff: false,
    joinId: null,
    joinSeats: null,
    ...over,
  };
}

function party(
  id: string,
  revision: number,
  tableIds: string[],
  name: string | null = null,
): TableParty {
  return {
    id,
    revision,
    guestCount: 2,
    state: "open",
    name,
    displayName: name ?? tableIds.join(", "),
    mainBillId: null,
    outstanding: "0.00",
    billCount: 1,
    tableIds,
    unsentDrafts: [],
    reminder: null,
  };
}

function planned(
  id: string,
  x: number,
  over: Partial<TableToday> = {},
  label = id.slice(1),
  seated: TableParty | null = null,
): TableState {
  return {
    id,
    label,
    zoneId: "z1",
    state: "free",
    condition: seated === null ? "free" : "held",
    hasOpenTab: false,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    status: null,
    nextReservation: null,
    today: today(x, over),
    signals: [],
    party: seated,
  };
}

function stubApi() {
  return {
    moveToday: vi.fn<TillApi["moveToday"]>(() => Promise.resolve()),
    mergeToday: vi.fn<TillApi["mergeToday"]>(() => Promise.resolve()),
    joinTables: vi.fn<TillApi["joinTables"]>(() =>
      Promise.resolve({} as Awaited<ReturnType<TillApi["joinTables"]>>),
    ),
  };
}

type Stub = ReturnType<typeof stubApi>;

async function mount(tables: TableState[], api: Stub, zones = [zone()]) {
  const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    zones,
    tables,
    api: api as unknown as TillApi,
  });
  return el;
}

function mapOf(el: TillFloorScreen): WtFloorMap {
  return el.shadowRoot!.querySelector<WtFloorMap>("wt-floor-map")!;
}

async function drop(el: TillFloorScreen, detail: FloorMapDrop): Promise<void> {
  mapOf(el).dispatchEvent(
    new CustomEvent("wt-table-drag-end", { detail, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

function drawnAt(el: TillFloorScreen, tableId: string): number | undefined {
  return mapOf(el).tables.find((table) => table.id === tableId)?.placement.x;
}

function refusal(el: TillFloorScreen): string | null {
  return el.shadowRoot!.querySelector("[data-floor-refusal]")?.textContent?.trim() ?? null;
}

function countRefreshes(el: TillFloorScreen): { count: number } {
  const seen = { count: 0 };
  el.addEventListener("floor-refresh", () => seen.count++);
  return seen;
}

async function settle(el: TillFloorScreen): Promise<void> {
  for (let i = 0; i < 3; i++) await Promise.resolve();
  await el.updateComplete;
}

function send(target: Element, type: string, detail?: unknown): void {
  target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

const P = party("P", 3, ["t1"], "Ana");
const Q = party("Q", 7, ["t2"]);
const seatsRefusal = { code: "floor_plan.invalid", status: 400, field: "seats" };

afterEach(cleanupWidgets);

describe("till-floor-screen: dragging on today's plan — joins and seating", () => {
  it("a seated table dropped on a free one joins and merges", async () => {
    const api = stubApi();
    let answer!: () => void;
    api.joinTables.mockImplementation(
      () => new Promise((resolve) => (answer = () => resolve({} as never))),
    );
    const el = await mount([planned("t1", 2, {}, "1", P), planned("t2", 20)], api);
    const refreshes = countRefreshes(el);

    await drop(el, { tableId: "t1", x: 17, y: 3, targetId: "t2" });

    expect(el.shadowRoot!.querySelector("till-bill-choice-dialog")).toBeNull();
    expect(api.joinTables).toHaveBeenCalledExactlyOnceWith(
      "P",
      "t2",
      "merge",
      { expectedPartyRevision: 3, otherPartyId: null },
      { moving: "t1", target: "t2", side: "left" },
    );
    expect(drawnAt(el, "t1")).toBe(18);
    expect(refreshes.count).toBe(0);

    answer();
    await settle(el);
    expect(refreshes.count).toBe(1);
    expect(refusal(el)).toBeNull();
  });

  it("a join that needs seats asks for them and sends them", async () => {
    const api = stubApi();
    api.joinTables.mockRejectedValueOnce(seatsRefusal);
    const el = await mount([planned("t1", 2, {}, "1", P), planned("t2", 20, { seats: 5 })], api);
    const refreshes = countRefreshes(el);

    await drop(el, { tableId: "t1", x: 17, y: 3, targetId: "t2" });
    await settle(el);

    const dialog = el.shadowRoot!.querySelector("till-today-seats-dialog")!;
    expect(dialog).not.toBeNull();
    expect(dialog.action).toBe("join");
    expect(dialog.seats).toBe(9);
    expect(dialog.heading).toBe("Seats for 1+2");
    expect(refreshes.count).toBe(0);
    expect(refusal(el)).toBeNull();

    el.tables = [planned("t1", 2, {}, "1", P), planned("t2", 20, { seats: 5 })];
    await el.updateComplete;
    expect(drawnAt(el, "t1")).toBe(18);

    send(dialog, "today-seats-confirm", { seats: 9 });
    await settle(el);

    expect(api.joinTables).toHaveBeenCalledTimes(2);
    expect(api.joinTables).toHaveBeenLastCalledWith(
      "P",
      "t2",
      "merge",
      { expectedPartyRevision: 3, otherPartyId: null },
      { moving: "t1", target: "t2", side: "left", seats: 9 },
    );
    expect(el.shadowRoot!.querySelector("till-today-seats-dialog")).toBeNull();
    expect(refreshes.count).toBe(1);
  });

  it("a join refused for another reason puts the table back and says why", async () => {
    const api = stubApi();
    api.joinTables.mockRejectedValueOnce({ code: "table.needs_clearing", status: 409 });
    const el = await mount([planned("t1", 2, {}, "1", P), planned("t2", 20)], api);
    const refreshes = countRefreshes(el);

    await drop(el, { tableId: "t1", x: 17, y: 3, targetId: "t2" });
    await settle(el);

    expect(el.shadowRoot!.querySelector("till-today-seats-dialog")).toBeNull();
    expect(drawnAt(el, "t1")).toBe(2);
    expect(refusal(el)).not.toBeNull();
    expect(refreshes.count).toBe(1);
  });

  it("two seated tables ask which bills to keep, then join", async () => {
    const api = stubApi();
    const el = await mount([planned("t1", 2, {}, "1", P), planned("t2", 20, {}, "2", Q)], api);
    const refreshes = countRefreshes(el);

    await drop(el, { tableId: "t1", x: 17, y: 3, targetId: "t2" });

    expect(api.joinTables).not.toHaveBeenCalled();
    const choice = el.shadowRoot!.querySelector("till-bill-choice-dialog")!;
    expect(choice).not.toBeNull();
    expect(choice.scope).toBe("Ana (1) joins 2");
    expect(drawnAt(el, "t1")).toBe(18);

    el.tables = [planned("t1", 2, {}, "1", P), planned("t2", 20, {}, "2", Q)];
    await el.updateComplete;
    expect(drawnAt(el, "t1")).toBe(18);

    send(choice, "bill-choice-confirm", { bills: "separate" });
    await settle(el);

    expect(el.shadowRoot!.querySelector("till-bill-choice-dialog")).toBeNull();
    expect(api.joinTables).toHaveBeenCalledExactlyOnceWith(
      "Q",
      "t1",
      "separate",
      { expectedPartyRevision: 7, otherPartyId: "P", expectedOtherPartyRevision: 3 },
      { moving: "t1", target: "t2", side: "left" },
    );
    expect(refreshes.count).toBe(1);
  });

  it("a join that needs seats after the bill choice keeps that choice", async () => {
    const api = stubApi();
    api.joinTables.mockRejectedValueOnce(seatsRefusal);
    const el = await mount([planned("t1", 2, {}, "1", P), planned("t2", 20, {}, "2", Q)], api);
    await drop(el, { tableId: "t1", x: 17, y: 3, targetId: "t2" });
    send(el.shadowRoot!.querySelector("till-bill-choice-dialog")!, "bill-choice-confirm", {
      bills: "separate",
    });
    await settle(el);

    send(el.shadowRoot!.querySelector("till-today-seats-dialog")!, "today-seats-confirm", {
      seats: 6,
    });
    await settle(el);

    expect(api.joinTables).toHaveBeenLastCalledWith(
      "Q",
      "t1",
      "separate",
      { expectedPartyRevision: 7, otherPartyId: "P", expectedOtherPartyRevision: 3 },
      { moving: "t1", target: "t2", side: "left", seats: 6 },
    );
  });

  it("cancelling the bill choice puts the table back and sends nothing", async () => {
    const api = stubApi();
    const el = await mount([planned("t1", 2, {}, "1", P), planned("t2", 20, {}, "2", Q)], api);
    const refreshes = countRefreshes(el);
    await drop(el, { tableId: "t1", x: 17, y: 3, targetId: "t2" });

    send(el.shadowRoot!.querySelector("till-bill-choice-dialog")!, "bill-choice-cancel");
    await settle(el);

    expect(el.shadowRoot!.querySelector("till-bill-choice-dialog")).toBeNull();
    expect(drawnAt(el, "t1")).toBe(2);
    expect(api.joinTables).not.toHaveBeenCalled();
    expect(refreshes.count).toBe(0);
  });

  it("two free fixed tables open the seat dialog for both, and seat them in one go", async () => {
    const api = stubApi();
    const el = await mount(
      [planned("F1", 2, { fixed: true }, "Bar 1"), planned("F2", 20, { fixed: true }, "Bar 2")],
      api,
    );
    const opened: unknown[] = [];
    el.addEventListener("open-table", (event) => opened.push((event as CustomEvent).detail));

    await drop(el, { tableId: "F1", x: 17, y: 3, targetId: "F2" });

    const dialog = el.shadowRoot!.querySelector("till-seat-dialog")!;
    expect(dialog).not.toBeNull();
    expect(dialog.tableLabel).toBe("Bar 1+2");
    expect(api.joinTables).not.toHaveBeenCalled();
    expect(api.mergeToday).not.toHaveBeenCalled();
    expect(drawnAt(el, "F1")).toBe(2);

    send(dialog, "seat-confirm", { guestCount: 2 });
    await el.updateComplete;

    expect(opened).toEqual([{ tableId: "F1", seated: false, guestCount: 2, withTableIds: ["F2"] }]);
    expect(el.shadowRoot!.querySelector("till-seat-dialog")).toBeNull();
  });

  it("a fixed table and a seated one join without a merge", async () => {
    const api = stubApi();
    const seated = party("P", 3, ["F1"]);
    const el = await mount(
      [planned("F1", 2, { fixed: true }, "1", seated), planned("F2", 20, { fixed: true })],
      api,
    );

    await drop(el, { tableId: "F2", x: 5, y: 3, targetId: "F1" });
    await settle(el);

    expect(el.shadowRoot!.querySelector("till-bill-choice-dialog")).toBeNull();
    expect(api.joinTables).toHaveBeenCalledExactlyOnceWith("P", "F2", "merge", {
      expectedPartyRevision: 3,
      otherPartyId: null,
    });
    expect(api.joinTables.mock.calls[0]).toHaveLength(4);
    expect(drawnAt(el, "F2")).toBe(20);
  });

  it("a join without a merge is not asked for seats", async () => {
    const api = stubApi();
    api.joinTables.mockRejectedValueOnce(seatsRefusal);
    const seated = party("P", 3, ["F1"]);
    const el = await mount(
      [planned("F1", 2, { fixed: true }, "1", seated), planned("F2", 20, { fixed: true })],
      api,
    );
    await drop(el, { tableId: "F2", x: 5, y: 3, targetId: "F1" });
    await settle(el);

    expect(el.shadowRoot!.querySelector("till-today-seats-dialog")).toBeNull();
    expect(refusal(el)).toBe("Something went wrong, try again");
  });

  it("without an api a join sends nothing and draws nothing new", async () => {
    const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
      zones: [zone()],
      tables: [planned("t1", 2, {}, "1", P), planned("t2", 20)],
    });
    await drop(el, { tableId: "t1", x: 17, y: 3, targetId: "t2" });
    await settle(el);
    expect(drawnAt(el, "t1")).toBe(2);
    expect(el.shadowRoot!.querySelector("till-bill-choice-dialog")).toBeNull();
  });

  it("a free merge's seat dialog is headed with the merge's name", async () => {
    const api = stubApi();
    const el = await mount(
      [planned("t4", 2, { joinId: "j1" }), planned("t5", 4, { joinId: "j1" }), planned("t6", 20)],
      api,
    );
    const map = mapOf(el);
    send(map, "wt-table-tap", { tableId: "t5" });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-seat-dialog")!.tableLabel).toBe("4+5");

    send(el.shadowRoot!.querySelector("till-seat-dialog")!, "seat-cancel");
    await el.updateComplete;
    send(map, "wt-table-tap", { tableId: "t6" });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-seat-dialog")!.tableLabel).toBe("6");
  });

  it("a re-read while the bills are asked still joins the party the question named", async () => {
    const api = stubApi();
    const el = await mount([planned("t1", 2, {}, "1", P), planned("t2", 20, {}, "2", Q)], api);
    await drop(el, { tableId: "t1", x: 17, y: 3, targetId: "t2" });

    const R = party("R", 11, ["t1"]);
    el.tables = [planned("t1", 2, {}, "1", R), planned("t2", 20, {}, "2", Q)];
    await el.updateComplete;
    send(el.shadowRoot!.querySelector("till-bill-choice-dialog")!, "bill-choice-confirm", {
      bills: "merge",
    });
    await settle(el);

    expect(api.joinTables).toHaveBeenCalledExactlyOnceWith(
      "Q",
      "t1",
      "merge",
      { expectedPartyRevision: 7, otherPartyId: "P", expectedOtherPartyRevision: 3 },
      { moving: "t1", target: "t2", side: "left" },
    );
  });

  it("a re-read that removes the dragged table while the bills are asked still sends the join", async () => {
    const api = stubApi();
    api.joinTables.mockRejectedValueOnce(seatsRefusal);
    const el = await mount([planned("t1", 2, {}, "1", P), planned("t2", 20, {}, "2", Q)], api);
    await drop(el, { tableId: "t1", x: 17, y: 3, targetId: "t2" });

    el.tables = [planned("t2", 20, {}, "2", Q)];
    await el.updateComplete;
    send(el.shadowRoot!.querySelector("till-bill-choice-dialog")!, "bill-choice-confirm", {
      bills: "merge",
    });
    await settle(el);
    expect(api.joinTables).toHaveBeenCalledTimes(1);

    send(el.shadowRoot!.querySelector("till-today-seats-dialog")!, "today-seats-confirm", {
      seats: 6,
    });
    await settle(el);
    expect(api.joinTables).toHaveBeenCalledTimes(2);
    expect(api.joinTables).toHaveBeenLastCalledWith(
      "Q",
      "t1",
      "merge",
      { expectedPartyRevision: 7, otherPartyId: "P", expectedOtherPartyRevision: 3 },
      { moving: "t1", target: "t2", side: "left", seats: 6 },
    );
  });

  it("two fixed tables dropped in a closed zone say it is closed and seat no one", async () => {
    const api = stubApi();
    const el = await mount(
      [planned("F1", 2, { fixed: true }, "Bar 1"), planned("F2", 20, { fixed: true }, "Bar 2")],
      api,
      [zone({ closed: true })],
    );
    await drop(el, { tableId: "F1", x: 17, y: 3, targetId: "F2" });

    expect(el.shadowRoot!.querySelector("till-seat-dialog")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-zone-closed]")).not.toBeNull();
  });

  it("a fixed table needing clearing dropped on a free one offers to clear it", async () => {
    const api = stubApi();
    const dirty = {
      ...planned("F1", 2, { fixed: true }, "Bar 1"),
      condition: "needs_clearing" as const,
    };
    const el = await mount([dirty, planned("F2", 20, { fixed: true }, "Bar 2")], api);
    await drop(el, { tableId: "F1", x: 17, y: 3, targetId: "F2" });

    expect(el.shadowRoot!.querySelector("till-seat-dialog")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-clear-dialog]")).not.toBeNull();
  });
});
