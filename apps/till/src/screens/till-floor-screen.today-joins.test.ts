import { afterEach, describe, expect, it, vi } from "vitest";
import type { FloorMapDrop, WtFloorMap } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import "./till-floor-screen.js";
import { codeMessage } from "../i18n/codes.js";
import type {
  PartyDraftSnapshot,
  FloorZone,
  TableParty,
  TableState,
  TableToday,
  TillApi,
} from "../api/client.js";
import { nextFloorMoment } from "../state/floor-today.js";

function zone(over: Partial<FloorZone> = {}): FloorZone {
  return {
    id: "z1",
    name: "Comedor",
    displayOrder: 0,
    active: true,
    closesAt: null,
    closed: false,
    hasPlan: false,
    layoutSetName: null,
    layoutDue: null,
    serviceMode: "table_tab",
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
    inJoinedTable: null,
    joined: null,
    splitOffFrom: null,
    zoneRevision: 0,
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
    kitchenNote: { scope: { partyId: id }, note: null, revision: 0, ownerRevision: revision },
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
    timingBand: "fresh",
    nextReservation: null,
    today: today(x, over),
    signals: [],
    party: seated,
  };
}

function stubApi() {
  const answer = () => Promise.resolve({ zoneId: "z1", revision: 0 });
  return {
    listDrafts: vi.fn<TillApi["listDrafts"]>((partyId) =>
      Promise.resolve({
        drafts: [],
        billEdits: [
          {
            billId: `bill-${partyId}`,
            editorId: null,
            editorName: null,
            editorVersion: partyId === "P" ? 3 : 7,
            draftId: null,
            draftRevision: null,
          },
        ],
      }),
    ),
    moveToday: vi.fn<TillApi["moveToday"]>(answer),
    mergeToday: vi.fn<TillApi["mergeToday"]>(answer),
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
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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
const seatsRefusal = { code: "merge.seats_required", status: 400 };

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
      {
        expectedPartyRevision: 3,
        otherPartyId: null,
        expectedEdits: [{ billId: "bill-P", editorVersion: 3, draftId: null, draftRevision: null }],
      },
      { moving: "t1", target: "t2", side: "left", zoneRevision: 0 },
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
      {
        expectedPartyRevision: 3,
        otherPartyId: null,
        expectedEdits: [{ billId: "bill-P", editorVersion: 3, draftId: null, draftRevision: null }],
      },
      { moving: "t1", target: "t2", side: "left", seats: 9, zoneRevision: 0 },
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
      {
        expectedPartyRevision: 7,
        otherPartyId: "P",
        expectedOtherPartyRevision: 3,
        expectedEdits: [
          { billId: "bill-P", editorVersion: 3, draftId: null, draftRevision: null },
          { billId: "bill-Q", editorVersion: 7, draftId: null, draftRevision: null },
        ],
      },
      { moving: "t1", target: "t2", side: "left", zoneRevision: 0 },
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
    expect(el.shadowRoot!.querySelector("till-today-seats-dialog")!.seats).toBe(8);

    send(el.shadowRoot!.querySelector("till-today-seats-dialog")!, "today-seats-confirm", {
      seats: 6,
    });
    await settle(el);

    expect(api.joinTables).toHaveBeenLastCalledWith(
      "Q",
      "t1",
      "separate",
      {
        expectedPartyRevision: 7,
        otherPartyId: "P",
        expectedOtherPartyRevision: 3,
        expectedEdits: [
          { billId: "bill-P", editorVersion: 3, draftId: null, draftRevision: null },
          { billId: "bill-Q", editorVersion: 7, draftId: null, draftRevision: null },
        ],
      },
      { moving: "t1", target: "t2", side: "left", seats: 6, zoneRevision: 0 },
    );
  });

  it("a seated table dropped on a merge of two suggests their combined seats", async () => {
    const R = party("R", 5, ["t3"]);
    const api = stubApi();
    api.joinTables.mockRejectedValueOnce(seatsRefusal);
    const el = await mount(
      [
        planned("t1", 2, { joinId: "j1", joinSeats: 6 }),
        planned("t2", 4, { joinId: "j1", joinSeats: 6 }),
        planned("t3", 20, {}, "3", R),
      ],
      api,
    );
    await drop(el, { tableId: "t3", x: 7, y: 3, targetId: "t2" });
    await settle(el);
    expect(el.shadowRoot!.querySelector("till-bill-choice-dialog")).toBeNull();
    const dialog = el.shadowRoot!.querySelector("till-today-seats-dialog")!;
    expect(dialog.action).toBe("join");
    expect(dialog.seats).toBe(10);
    expect(dialog.heading).toBe("Seats for 1+2+3");
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
      expectedEdits: [{ billId: "bill-P", editorVersion: 3, draftId: null, draftRevision: null }],
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
    expect(refusal(el)).toBe("Enter the seats for this merge");
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
      {
        expectedPartyRevision: 7,
        otherPartyId: "P",
        expectedOtherPartyRevision: 3,
        expectedEdits: [
          { billId: "bill-P", editorVersion: 3, draftId: null, draftRevision: null },
          { billId: "bill-Q", editorVersion: 7, draftId: null, draftRevision: null },
        ],
      },
      { moving: "t1", target: "t2", side: "left", zoneRevision: 0 },
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
      {
        expectedPartyRevision: 7,
        otherPartyId: "P",
        expectedOtherPartyRevision: 3,
        expectedEdits: [
          { billId: "bill-P", editorVersion: 3, draftId: null, draftRevision: null },
          { billId: "bill-Q", editorVersion: 7, draftId: null, draftRevision: null },
        ],
      },
      { moving: "t1", target: "t2", side: "left", seats: 6, zoneRevision: 0 },
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

  describe("in a zone that seats no one", () => {
    const prepay = [zone({ serviceMode: "prepay" })];
    const noSeating = "That table is in an area that does not seat guests. Choose another table";

    it("two fixed free tables dropped together seat no one and say why", async () => {
      const api = stubApi();
      const el = await mount(
        [planned("F1", 2, { fixed: true }, "Bar 1"), planned("F2", 20, { fixed: true }, "Bar 2")],
        api,
        prepay,
      );
      const opened = vi.fn();
      el.addEventListener("open-table", opened);
      await drop(el, { tableId: "F1", x: 17, y: 3, targetId: "F2" });

      expect(el.shadowRoot!.querySelector("till-seat-dialog")).toBeNull();
      expect(refusal(el)).toBe(noSeating);
      expect(opened).not.toHaveBeenCalled();
      expect(api.joinTables).not.toHaveBeenCalled();
      expect(api.mergeToday).not.toHaveBeenCalled();
    });

    it("a seated table dropped on a free one sends nothing and stays where it was", async () => {
      const api = stubApi();
      const el = await mount([planned("t1", 2, {}, "1", P), planned("t2", 20)], api, prepay);
      await drop(el, { tableId: "t1", x: 17, y: 3, targetId: "t2" });

      expect(api.joinTables).not.toHaveBeenCalled();
      expect(drawnAt(el, "t1")).toBe(2);
      expect(refusal(el)).toBe(noSeating);
    });

    function lines(el: TillFloorScreen): string[] {
      return [
        ...el.shadowRoot!.querySelectorAll("[data-zone-no-seating], [data-floor-refusal]"),
      ].map((line) => line.textContent!.trim());
    }

    it("a tap and then a drop say why once", async () => {
      const api = stubApi();
      const el = await mount(
        [planned("F1", 2, { fixed: true }, "Bar 1"), planned("F2", 20, { fixed: true }, "Bar 2")],
        api,
        prepay,
      );
      send(mapOf(el), "wt-table-tap", { tableId: "F1" });
      await el.updateComplete;
      expect(lines(el)).toEqual([noSeating]);

      await drop(el, { tableId: "F1", x: 17, y: 3, targetId: "F2" });

      expect(lines(el)).toEqual([noSeating]);
    });

    it("a drop and then a tap say why once", async () => {
      const api = stubApi();
      const el = await mount(
        [planned("F1", 2, { fixed: true }, "Bar 1"), planned("F2", 20, { fixed: true }, "Bar 2")],
        api,
        prepay,
      );
      await drop(el, { tableId: "F1", x: 17, y: 3, targetId: "F2" });
      expect(lines(el)).toEqual([noSeating]);

      send(mapOf(el), "wt-table-tap", { tableId: "F1" });
      await el.updateComplete;

      expect(lines(el)).toEqual([noSeating]);
    });

    it("two seated tables still ask which bills to keep", async () => {
      const api = stubApi();
      const el = await mount(
        [planned("t1", 2, {}, "1", P), planned("t2", 20, {}, "2", Q)],
        api,
        prepay,
      );
      await drop(el, { tableId: "t1", x: 17, y: 3, targetId: "t2" });

      expect(el.shadowRoot!.querySelector("till-bill-choice-dialog")).not.toBeNull();
      expect(refusal(el)).toBeNull();
    });

    it("two free unfixed tables still merge", async () => {
      const api = stubApi();
      const el = await mount([planned("t1", 2), planned("t2", 20)], api, prepay);
      await drop(el, { tableId: "t1", x: 17, y: 3, targetId: "t2" });

      expect(api.mergeToday).toHaveBeenCalledTimes(1);
      expect(refusal(el)).toBeNull();
    });
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

describe("till-floor-screen: joins and the room's revision", () => {
  it("a join sends the revision read at the drop, through the bill choice and the seats window", async () => {
    const api = stubApi();
    api.joinTables.mockRejectedValueOnce(seatsRefusal);
    const el = await mount(
      [
        planned("t1", 2, { zoneRevision: 7 }, "1", P),
        planned("t2", 20, { zoneRevision: 7 }, "2", Q),
      ],
      api,
    );
    await drop(el, { tableId: "t1", x: 17, y: 3, targetId: "t2" });

    const at8 = () => [
      planned("t1", 2, { zoneRevision: 8 }, "1", P),
      planned("t2", 20, { zoneRevision: 8 }, "2", Q),
    ];
    el.tablesReadAt = nextFloorMoment();
    el.tables = at8();
    await el.updateComplete;
    send(el.shadowRoot!.querySelector("till-bill-choice-dialog")!, "bill-choice-confirm", {
      bills: "merge",
    });
    await settle(el);
    expect(api.joinTables).toHaveBeenLastCalledWith(
      "Q",
      "t1",
      "merge",
      {
        expectedPartyRevision: 7,
        otherPartyId: "P",
        expectedOtherPartyRevision: 3,
        expectedEdits: [
          { billId: "bill-P", editorVersion: 3, draftId: null, draftRevision: null },
          { billId: "bill-Q", editorVersion: 7, draftId: null, draftRevision: null },
        ],
      },
      { moving: "t1", target: "t2", side: "left", zoneRevision: 7 },
    );

    el.tablesReadAt = nextFloorMoment();
    el.tables = at8();
    await el.updateComplete;
    send(el.shadowRoot!.querySelector("till-today-seats-dialog")!, "today-seats-confirm", {
      seats: 6,
    });
    await settle(el);
    expect(api.joinTables).toHaveBeenLastCalledWith(
      "Q",
      "t1",
      "merge",
      {
        expectedPartyRevision: 7,
        otherPartyId: "P",
        expectedOtherPartyRevision: 3,
        expectedEdits: [
          { billId: "bill-P", editorVersion: 3, draftId: null, draftRevision: null },
          { billId: "bill-Q", editorVersion: 7, draftId: null, draftRevision: null },
        ],
      },
      { moving: "t1", target: "t2", side: "left", seats: 6, zoneRevision: 7 },
    );
  });

  it("a join's answer carries the revision of the room it sent and no other", async () => {
    const api = stubApi();
    api.joinTables.mockResolvedValueOnce({
      partyId: "P",
      mainBillId: null,
      merged: false,
      zoneRevisions: { z1: 8, z2: 3 },
    });
    const terrace = { ...planned("t9", 5, { zoneRevision: 5 }), zoneId: "z2" };
    const el = await mount(
      [
        planned("t1", 2, { zoneRevision: 7 }, "1", P),
        planned("t2", 20, { zoneRevision: 7 }),
        planned("t3", 40, { zoneRevision: 7 }),
        terrace,
      ],
      api,
      [zone(), zone({ id: "z2", name: "Terraza", displayOrder: 1 })],
    );
    await drop(el, { tableId: "t1", x: 17, y: 3, targetId: "t2" });
    await settle(el);

    await drop(el, { tableId: "t3", x: 44, y: 3, targetId: null });
    expect(api.moveToday).toHaveBeenLastCalledWith("t3", { x: 44, y: 3 }, 8);

    el.shadowRoot!.querySelector<HTMLElement>('[data-zone="z2"]')!.click();
    await el.updateComplete;
    await drop(el, { tableId: "t9", x: 9, y: 3, targetId: null });
    expect(api.moveToday).toHaveBeenLastCalledWith("t9", { x: 9, y: 3 }, 5);
  });
});

describe("floor join ownership observations", () => {
  const pair = () => [planned("t1", 2, {}, "1", P), planned("t2", 20, {}, "2", Q)];
  const dropPair = (el: TillFloorScreen) =>
    drop(el, { tableId: "t1", x: 17, y: 3, targetId: "t2" });
  const observations = [
    { billId: "bill-P", editorVersion: 3, draftId: null, draftRevision: null },
    { billId: "bill-Q", editorVersion: 7, draftId: null, draftRevision: null },
  ];
  async function finish(el: TillFloorScreen) {
    const choice = el.shadowRoot!.querySelector("till-bill-choice-dialog");
    expect(choice).not.toBeNull();
    send(choice!, "bill-choice-confirm", { bills: "separate" });
    await settle(el);
  }
  function deferred() {
    let resolve!: (value: PartyDraftSnapshot) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<PartyDraftSnapshot>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    return { promise, resolve, reject };
  }

  it("reads both parties before the bill question, then sends every original bill in sorted order", async () => {
    const api = stubApi();
    const read = deferred();
    api.listDrafts.mockImplementationOnce(() => read.promise);
    const el = await mount(pair(), api);
    await dropPair(el);
    expect(el.shadowRoot!.querySelector("till-bill-choice-dialog")).toBeNull();
    expect(api.joinTables).not.toHaveBeenCalled();
    read.resolve({
      drafts: [],
      billEdits: [
        {
          billId: "z-empty",
          editorId: null,
          editorName: null,
          editorVersion: 8,
          draftId: null,
          draftRevision: null,
        },
        {
          billId: "a-owned",
          editorId: "ana",
          editorName: "Ana",
          editorVersion: 4,
          draftId: "d-a",
          draftRevision: 9,
        },
      ],
    });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("till-bill-choice-dialog")).not.toBeNull(),
    );
    await finish(el);
    expect(api.listDrafts.mock.calls.map(([id]) => id).sort()).toEqual(["P", "Q"]);
    expect(api.joinTables).toHaveBeenCalledExactlyOnceWith(
      "Q",
      "t1",
      "separate",
      {
        expectedPartyRevision: 7,
        otherPartyId: "P",
        expectedOtherPartyRevision: 3,
        expectedEdits: [
          { billId: "a-owned", editorVersion: 4, draftId: "d-a", draftRevision: 9 },
          { billId: "bill-P", editorVersion: 3, draftId: null, draftRevision: null },
          { billId: "z-empty", editorVersion: 8, draftId: null, draftRevision: null },
        ],
      },
      { moving: "t1", target: "t2", side: "left", zoneRevision: 0 },
    );
  });

  it("joining a free table reads only the seated party and sends its empty bill expectation", async () => {
    const api = stubApi();
    const el = await mount([planned("t1", 2, {}, "1", P), planned("t2", 20)], api);
    await dropPair(el);
    expect(api.listDrafts.mock.calls.map(([id]) => id)).toEqual(["P"]);
    expect(api.joinTables.mock.calls[0]?.[3]).toEqual({
      expectedPartyRevision: 3,
      otherPartyId: null,
      expectedEdits: [observations[0]],
    });
  });

  it("the seats retry retains the original observations instead of reading newer versions", async () => {
    const api = stubApi();
    api.joinTables.mockRejectedValueOnce(seatsRefusal);
    const el = await mount(pair(), api);
    await dropPair(el);
    await finish(el);
    api.listDrafts.mockResolvedValue({ drafts: [], billEdits: [] });
    send(el.shadowRoot!.querySelector("till-today-seats-dialog")!, "today-seats-confirm", {
      seats: 9,
    });
    await settle(el);
    expect(api.joinTables).toHaveBeenCalledTimes(2);
    expect(api.listDrafts).toHaveBeenCalledTimes(2);
    expect(api.joinTables.mock.calls.map((call) => call[3])).toEqual([
      {
        expectedPartyRevision: 7,
        otherPartyId: "P",
        expectedOtherPartyRevision: 3,
        expectedEdits: observations,
      },
      {
        expectedPartyRevision: 7,
        otherPartyId: "P",
        expectedOtherPartyRevision: 3,
        expectedEdits: observations,
      },
    ]);
  });

  it.each(["draft.taken_over", "draft.out_of_date", undefined])(
    "a failed preparatory read (%s) opens no question and sends nothing",
    async (code) => {
      const api = stubApi();
      api.listDrafts.mockRejectedValueOnce(code === undefined ? undefined : { code });
      const el = await mount(pair(), api);
      await dropPair(el);
      expect(api.joinTables).not.toHaveBeenCalled();
      expect(el.shadowRoot!.querySelector("till-bill-choice-dialog")).toBeNull();
      expect(refusal(el)).toBe(
        code === undefined
          ? "The order on this table could not be read. Open the table again."
          : codeMessage(code),
      );
      expect(drawnAt(el, "t1")).toBe(2);
    },
  );

  it("duplicate bill metadata refuses before asking or joining", async () => {
    const api = stubApi();
    const snapshot = await api.listDrafts("P");
    api.listDrafts.mockResolvedValue(snapshot);
    const el = await mount(pair(), api);
    await dropPair(el);
    expect(api.joinTables).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("till-bill-choice-dialog")).toBeNull();
    expect(refusal(el)).not.toBeNull();
  });

  it.each(["api", "operator", "disconnect", "zone"] as const)(
    "a changed %s fences a delayed read and its question",
    async (change) => {
      const api = stubApi();
      const read = deferred();
      const snapshot = await api.listDrafts("Q");
      api.listDrafts.mockImplementationOnce(() => read.promise);
      const el = await mount(pair(), api);
      await dropPair(el);
      if (change === "api") el.api = stubApi() as unknown as TillApi;
      if (change === "operator") Object.assign(el, { operatorSession: 2 });
      if (change === "disconnect") el.remove();
      if (change === "zone") el.selectedZoneId = "another";
      await el.updateComplete;
      read.resolve(snapshot);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("till-bill-choice-dialog")).toBeNull();
      expect(api.joinTables).not.toHaveBeenCalled();
      expect(refusal(el)).toBeNull();
    },
  );

  it("a replaced API cannot send an already-open bill confirmation", async () => {
    const api = stubApi();
    const el = await mount(pair(), api);
    await dropPair(el);
    const choice = el.shadowRoot!.querySelector("till-bill-choice-dialog")!;
    el.api = stubApi() as unknown as TillApi;
    await el.updateComplete;
    send(choice, "bill-choice-confirm", { bills: "merge" });
    await settle(el);
    expect(api.joinTables).not.toHaveBeenCalled();
  });

  it("an old join refusal cannot open seats or overwrite the replacement screen", async () => {
    const api = stubApi();
    let reject!: (reason: unknown) => void;
    api.joinTables.mockImplementationOnce(
      () =>
        new Promise((_yes, no) => {
          reject = no;
        }),
    );
    const el = await mount(pair(), api);
    const refreshes = countRefreshes(el);
    await dropPair(el);
    await finish(el);
    el.api = stubApi() as unknown as TillApi;
    await el.updateComplete;
    reject(seatsRefusal);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-today-seats-dialog")).toBeNull();
    expect(refusal(el)).toBeNull();
    expect(refreshes.count).toBe(0);
  });
});

describe("floor join scope and recovery", () => {
  const tables = () => [planned("t1", 2, {}, "1", P), planned("t2", 20, {}, "2", Q)];
  const joinDrop = (el: TillFloorScreen) =>
    drop(el, { tableId: "t1", x: 17, y: 3, targetId: "t2" });

  it("switching the active zone closes the original bill question", async () => {
    const api = stubApi();
    const el = await mount(tables(), api, [zone(), zone({ id: "z2", name: "Terrace" })]);
    await joinDrop(el);
    expect(el.shadowRoot!.querySelector("till-bill-choice-dialog")).not.toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>('[data-zone="z2"]')!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-bill-choice-dialog")).toBeNull();
    expect(api.joinTables).not.toHaveBeenCalled();
  });

  it.each(["draft.taken_over", "draft.out_of_date"])(
    "a join refusal retains %s and refreshes without retrying",
    async (code) => {
      const api = stubApi();
      api.joinTables.mockRejectedValueOnce({ code });
      const el = await mount(tables(), api);
      const refreshes = countRefreshes(el);
      await joinDrop(el);
      send(el.shadowRoot!.querySelector("till-bill-choice-dialog")!, "bill-choice-confirm", {
        bills: "separate",
      });
      await settle(el);
      expect(refusal(el)).toBe(codeMessage(code));
      expect(api.joinTables).toHaveBeenCalledTimes(1);
      expect(refreshes.count).toBe(1);
      expect(drawnAt(el, "t1")).toBe(2);
    },
  );

  it("a later drop replaces a pending read without reopening its old question", async () => {
    const api = stubApi();
    const snapshot = await api.listDrafts("Q");
    let answer!: (value: PartyDraftSnapshot) => void;
    api.listDrafts.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const el = await mount(tables(), api);
    await joinDrop(el);
    await drop(el, { tableId: "t1", x: 8, y: 3, targetId: null });
    answer(snapshot);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-bill-choice-dialog")).toBeNull();
    expect(api.joinTables).not.toHaveBeenCalled();
    expect(api.moveToday).toHaveBeenCalledExactlyOnceWith("t1", { x: 8, y: 3 }, 0);
  });
});

describe("floor join cancellation and late replies", () => {
  const two = () => [planned("t1", 2, {}, "1", P), planned("t2", 20, {}, "2", Q)];
  const joining = (el: TillFloorScreen) => drop(el, { tableId: "t1", x: 17, y: 3, targetId: "t2" });

  it("cancelling seats retires the original confirmation", async () => {
    const api = stubApi();
    api.joinTables.mockRejectedValueOnce(seatsRefusal);
    const el = await mount(two(), api);
    await joining(el);
    send(el.shadowRoot!.querySelector("till-bill-choice-dialog")!, "bill-choice-confirm", {
      bills: "separate",
    });
    await settle(el);
    const seats = el.shadowRoot!.querySelector("till-today-seats-dialog")!;
    send(seats, "today-seats-cancel");
    await settle(el);
    send(seats, "today-seats-confirm", { seats: 8 });
    await settle(el);
    expect(api.joinTables).toHaveBeenCalledTimes(1);
    expect(drawnAt(el, "t1")).toBe(2);
  });

  it("a late read refusal cannot overwrite the replacement API's floor", async () => {
    const api = stubApi();
    let reject!: (reason: unknown) => void;
    api.listDrafts.mockImplementationOnce(
      () =>
        new Promise((_yes, no) => {
          reject = no;
        }),
    );
    const el = await mount(two(), api);
    const refreshes = countRefreshes(el);
    await joining(el);
    el.api = stubApi() as unknown as TillApi;
    await el.updateComplete;
    reject({ code: "draft.taken_over" });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await el.updateComplete;
    expect(refusal(el)).toBeNull();
    expect(refreshes.count).toBe(0);
    expect(api.joinTables).not.toHaveBeenCalled();
  });

  it("a late success cannot carry its room revision into the replacement API", async () => {
    const api = stubApi();
    let resolve!: (value: Awaited<ReturnType<TillApi["joinTables"]>>) => void;
    api.joinTables.mockImplementationOnce(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    const el = await mount(two(), api);
    const refreshes = countRefreshes(el);
    await joining(el);
    send(el.shadowRoot!.querySelector("till-bill-choice-dialog")!, "bill-choice-confirm", {
      bills: "separate",
    });
    await settle(el);
    const next = stubApi();
    el.api = next as unknown as TillApi;
    await el.updateComplete;
    resolve({ partyId: "Q", mainBillId: null, merged: false, zoneRevisions: { z1: 99 } });
    await new Promise<void>((done) => requestAnimationFrame(() => done()));
    await el.updateComplete;
    expect(refreshes.count).toBe(0);
    await drop(el, { tableId: "t1", x: 8, y: 3, targetId: null });
    expect(next.moveToday).toHaveBeenCalledExactlyOnceWith("t1", { x: 8, y: 3 }, 0);
  });
});

describe("floor join replaced prompts", () => {
  const two = () => [planned("t1", 2, {}, "1", P), planned("t2", 20, {}, "2", Q)];
  const joining = (el: TillFloorScreen) => drop(el, { tableId: "t1", x: 17, y: 3, targetId: "t2" });

  it.each(["bill-choice-confirm", "bill-choice-cancel"])(
    "an old %s cannot close the replacement question",
    async (type) => {
      const api = stubApi();
      const el = await mount(two(), api);
      await joining(el);
      const old = el.shadowRoot!.querySelector("till-bill-choice-dialog")!;
      await joining(el);
      const current = el.shadowRoot!.querySelector("till-bill-choice-dialog")!;
      expect(current).not.toBeNull();
      expect(current).not.toBe(old);
      send(old, type, { bills: "merge" });
      await settle(el);
      expect(el.shadowRoot!.querySelector("till-bill-choice-dialog")).toBe(current);
      expect(api.joinTables).not.toHaveBeenCalled();
      send(current, "bill-choice-confirm", { bills: "separate" });
      await settle(el);
      expect(api.joinTables).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["today-seats-confirm", "today-seats-cancel"])(
    "an old %s cannot close the replacement seats prompt",
    async (type) => {
      const api = stubApi();
      api.joinTables.mockRejectedValue(seatsRefusal);
      const el = await mount(two(), api);
      const choose = async () => {
        await joining(el);
        send(el.shadowRoot!.querySelector("till-bill-choice-dialog")!, "bill-choice-confirm", {
          bills: "separate",
        });
        await settle(el);
        return el.shadowRoot!.querySelector("till-today-seats-dialog")!;
      };
      const old = await choose();
      const current = await choose();
      expect(current).not.toBeNull();
      expect(current).not.toBe(old);
      send(old, type, { seats: 8 });
      await settle(el);
      expect(el.shadowRoot!.querySelector("till-today-seats-dialog")).toBe(current);
      expect(api.joinTables).toHaveBeenCalledTimes(2);
      send(current, "today-seats-confirm", { seats: 8 });
      await settle(el);
      expect(api.joinTables).toHaveBeenCalledTimes(3);
    },
  );
});
