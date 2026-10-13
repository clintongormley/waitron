import { afterEach, describe, expect, it, vi } from "vitest";
import type { FloorMapDrop, WtFloorMap } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import "./till-floor-screen.js";
import type { FloorAnswer, FloorZone, TableState, TableToday, TillApi } from "../api/client.js";
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

function planned(id: string, x: number, over: Partial<TableToday> = {}): TableState {
  return {
    id,
    label: id.slice(1),
    zoneId: "z1",
    state: "free",
    condition: "free",
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
    party: null,
  };
}

/** Each write waits for the test to answer it, so a case can look between the drop and the answer. */
function stubApi() {
  const answer = () => Promise.resolve({ zoneId: "z1", revision: 0 });
  return {
    moveToday: vi.fn<TillApi["moveToday"]>(answer),
    mergeToday: vi.fn<TillApi["mergeToday"]>(answer),
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

/** Lets a settled write's handler finish. */
async function settle(el: TillFloorScreen): Promise<void> {
  for (let i = 0; i < 3; i++) await Promise.resolve();
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe("till-floor-screen: dragging on today's plan", () => {
  it("a drop on empty space moves the table and draws it there until the next read", async () => {
    const api = stubApi();
    let answer!: () => void;
    api.moveToday.mockImplementation(
      () =>
        new Promise<FloorAnswer>(
          (resolve) => (answer = () => resolve({ zoneId: "z1", revision: 1 })),
        ),
    );
    const el = await mount([planned("t1", 2), planned("t2", 20)], api);
    const refreshes = countRefreshes(el);
    const escaped: Event[] = [];
    el.addEventListener("wt-table-drag-end", (event) => escaped.push(event));

    await drop(el, { tableId: "t1", x: 12, y: 5, targetId: null });

    expect(escaped).toEqual([]);
    expect(api.moveToday).toHaveBeenCalledExactlyOnceWith("t1", { x: 12, y: 5 }, 0);
    expect(drawnAt(el, "t1")).toBe(12);
    expect(refreshes.count).toBe(0);

    answer();
    await settle(el);
    expect(refreshes.count).toBe(1);
    expect(drawnAt(el, "t1")).toBe(12);

    el.tables = [planned("t1", 30), planned("t2", 20)];
    await el.updateComplete;
    expect(drawnAt(el, "t1")).toBe(30);
  });

  it("a refused move puts the table back and says why", async () => {
    const api = stubApi();
    api.moveToday.mockRejectedValue({ code: "table.fixed", status: 409 });
    const el = await mount([planned("t1", 2)], api);
    const refreshes = countRefreshes(el);

    await drop(el, { tableId: "t1", x: 12, y: 5, targetId: null });
    await settle(el);

    expect(drawnAt(el, "t1")).toBe(2);
    expect(refusal(el)).toBe("That table is fixed in place");
    expect(el.shadowRoot!.querySelector("[data-floor-refusal]")!.getAttribute("role")).toBe(
      "status",
    );
    expect(refreshes.count).toBe(1);
  });

  it("two free tables merge, asking for seats when the server wants them", async () => {
    const api = stubApi();
    api.mergeToday.mockRejectedValueOnce({
      code: "merge.seats_required",
      status: 400,
    });
    const el = await mount([planned("t1", 2), planned("t2", 20)], api);
    const refreshes = countRefreshes(el);

    await drop(el, { tableId: "t2", x: 5, y: 3, targetId: "t1" });
    expect(api.mergeToday).toHaveBeenCalledExactlyOnceWith(
      "t2",
      { targetId: "t1", side: "right" },
      0,
    );
    expect(drawnAt(el, "t2")).toBe(4);
    await settle(el);

    const dialog = el.shadowRoot!.querySelector("till-today-seats-dialog")!;
    expect(dialog).not.toBeNull();
    expect(dialog.action).toBe("join");
    expect(dialog.seats).toBeNull();
    expect(dialog.heading).toBe("Seats for 1+2");
    expect(drawnAt(el, "t2")).toBe(4);
    expect(refusal(el)).toBeNull();

    dialog.dispatchEvent(
      new CustomEvent("today-seats-confirm", {
        detail: { seats: 10 },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(el);

    expect(api.mergeToday).toHaveBeenLastCalledWith(
      "t2",
      {
        targetId: "t1",
        side: "right",
        seats: 10,
      },
      0,
    );
    expect(api.mergeToday).toHaveBeenCalledTimes(2);
    expect(el.shadowRoot!.querySelector("till-today-seats-dialog")).toBeNull();
    expect(refreshes.count).toBe(1);
  });

  it("a third table dropped on a merge asks for seats again, empty", async () => {
    const api = stubApi();
    api.mergeToday.mockRejectedValueOnce({ code: "merge.seats_required", status: 400 });
    const el = await mount(
      [
        planned("t1", 2, { joinId: "j1", joinSeats: 6 }),
        planned("t2", 4, { joinId: "j1", joinSeats: 6 }),
        planned("t3", 20),
      ],
      api,
    );
    await drop(el, { tableId: "t3", x: 7, y: 3, targetId: "t2" });
    await settle(el);
    const dialog = el.shadowRoot!.querySelector("till-today-seats-dialog")!;
    expect(dialog.action).toBe("join");
    expect(dialog.seats).toBeNull();
    expect(dialog.heading).toBe("Seats for 1+2+3");
  });

  it("a re-read while the seats are asked keeps the table where it was dropped", async () => {
    const api = stubApi();
    api.mergeToday.mockRejectedValueOnce({
      code: "merge.seats_required",
      status: 400,
    });
    const el = await mount([planned("t1", 2), planned("t2", 20)], api);
    await drop(el, { tableId: "t2", x: 5, y: 3, targetId: "t1" });
    await settle(el);
    expect(el.shadowRoot!.querySelector("till-today-seats-dialog")).not.toBeNull();

    el.tables = [planned("t1", 2), planned("t2", 20)];
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector("till-today-seats-dialog")).not.toBeNull();
    expect(drawnAt(el, "t2")).toBe(4);
  });

  it("cancelling the seats puts the table back", async () => {
    const api = stubApi();
    api.mergeToday.mockRejectedValueOnce({
      code: "merge.seats_required",
      status: 400,
    });
    const el = await mount([planned("t1", 2), planned("t2", 20)], api);
    await drop(el, { tableId: "t2", x: 5, y: 3, targetId: "t1" });
    await settle(el);

    el.shadowRoot!.querySelector("till-today-seats-dialog")!.dispatchEvent(
      new CustomEvent("today-seats-cancel", { bubbles: true, composed: true }),
    );
    await settle(el);

    expect(el.shadowRoot!.querySelector("till-today-seats-dialog")).toBeNull();
    expect(drawnAt(el, "t2")).toBe(20);
    expect(api.mergeToday).toHaveBeenCalledTimes(1);
    expect(api.moveToday).not.toHaveBeenCalled();
  });

  it("a merge refused for another reason puts the table back and says why", async () => {
    const api = stubApi();
    api.mergeToday.mockRejectedValueOnce({ code: "table.merged", status: 409 });
    const el = await mount([planned("t1", 2), planned("t2", 20)], api);
    const refreshes = countRefreshes(el);
    await drop(el, { tableId: "t2", x: 5, y: 3, targetId: "t1" });
    await settle(el);

    expect(el.shadowRoot!.querySelector("till-today-seats-dialog")).toBeNull();
    expect(drawnAt(el, "t2")).toBe(20);
    expect(refusal(el)).toBe("That table is joined to another. Split it first");
    expect(refreshes.count).toBe(1);
  });

  it("a merge refused for its seats a second time, or for another field, says why", async () => {
    const api = stubApi();
    const seatsRefusal = { code: "merge.seats_required", status: 400 };
    api.mergeToday
      .mockRejectedValueOnce(seatsRefusal)
      .mockRejectedValueOnce(seatsRefusal)
      .mockRejectedValueOnce({ code: "floor_plan.invalid", status: 400, field: "side" });
    const el = await mount([planned("t1", 2), planned("t2", 20)], api);
    await drop(el, { tableId: "t2", x: 5, y: 3, targetId: "t1" });
    await settle(el);
    el.shadowRoot!.querySelector("till-today-seats-dialog")!.dispatchEvent(
      new CustomEvent("today-seats-confirm", {
        detail: { seats: 10 },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(el);
    expect(el.shadowRoot!.querySelector("till-today-seats-dialog")).toBeNull();
    expect(refusal(el)).toBe("Enter the seats for this merge");
    expect(drawnAt(el, "t2")).toBe(20);

    await drop(el, { tableId: "t2", x: 5, y: 3, targetId: "t1" });
    await settle(el);
    expect(el.shadowRoot!.querySelector("till-today-seats-dialog")).toBeNull();
    expect(refusal(el)).toBe("Something went wrong, try again");
  });

  it("a write that fails with no code says the generic words", async () => {
    const api = stubApi();
    api.moveToday
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(null);
    const el = await mount([planned("t1", 2)], api);
    for (let attempt = 0; attempt < 2; attempt++) {
      await drop(el, { tableId: "t1", x: 12, y: 5, targetId: null });
      await settle(el);
      expect(refusal(el)).toBe("Something went wrong, try again");
      expect(drawnAt(el, "t1")).toBe(2);
    }
    expect(api.moveToday).toHaveBeenCalledTimes(2);
  });

  it("without an api a drop sends nothing and draws nothing new", async () => {
    const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
      zones: [zone()],
      tables: [planned("t1", 2), planned("t2", 20)],
    });
    const refreshes = countRefreshes(el);
    await drop(el, { tableId: "t1", x: 12, y: 5, targetId: null });
    await drop(el, { tableId: "t2", x: 5, y: 3, targetId: "t1" });
    await settle(el);
    expect(drawnAt(el, "t1")).toBe(2);
    expect(drawnAt(el, "t2")).toBe(20);
    expect(refreshes.count).toBe(0);
    expect(refusal(el)).toBeNull();
  });

  it("a drop that asks for nothing changes nothing", async () => {
    const api = stubApi();
    const el = await mount([planned("t1", 2), planned("t2", 20)], api);
    await drop(el, { tableId: "t9", x: 12, y: 5, targetId: null });
    await drop(el, { tableId: "t1", x: 2, y: 3, targetId: "t1" });
    await settle(el);
    expect(api.moveToday).not.toHaveBeenCalled();
    expect(api.mergeToday).not.toHaveBeenCalled();
    expect(refusal(el)).toBeNull();
  });

  it("a merge dropped on a table says to drag the other one", async () => {
    const api = stubApi();
    const el = await mount(
      [planned("t1", 2, { joinId: "j1" }), planned("t2", 4, { joinId: "j1" }), planned("t3", 20)],
      api,
    );
    await drop(el, { tableId: "t1", x: 18, y: 3, targetId: "t3" });

    expect(refusal(el)).toBe("Drag the other table onto it");
    expect(api.moveToday).not.toHaveBeenCalled();
    expect(api.mergeToday).not.toHaveBeenCalled();
    expect(drawnAt(el, "t1")).toBe(2);
  });

  it("the status line clears on the next drop and on a change of zone", async () => {
    const api = stubApi();
    const zones = [zone(), zone({ id: "z2", name: "Terraza", displayOrder: 1 })];
    const tables = [
      planned("t1", 2, { joinId: "j1" }),
      planned("t2", 4, { joinId: "j1" }),
      planned("t3", 20),
    ];
    const el = await mount(tables, api, zones);
    await drop(el, { tableId: "t1", x: 18, y: 3, targetId: "t3" });
    expect(refusal(el)).not.toBeNull();

    await drop(el, { tableId: "t3", x: 20, y: 3, targetId: null });
    expect(refusal(el)).toBeNull();

    await drop(el, { tableId: "t1", x: 18, y: 3, targetId: "t3" });
    expect(refusal(el)).not.toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>('[data-zone="z2"]')!.click();
    await el.updateComplete;
    expect(refusal(el)).toBeNull();
  });

  it("a press on the map still reaches the page", async () => {
    const el = await mount([planned("t1", 2)], stubApi());
    const map = mapOf(el);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    await map.updateComplete;
    const button = map.shadowRoot!.querySelector<HTMLElement>('[data-table-id="t1"]')!;
    const heard: Event[] = [];
    const listen = (event: Event) => heard.push(event);
    document.addEventListener("pointerdown", listen);
    document.addEventListener("keydown", listen);
    const box = button.getBoundingClientRect();
    const press = new PointerEvent("pointerdown", {
      bubbles: true,
      composed: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    });
    button.dispatchEvent(press);
    const key = new KeyboardEvent("keydown", {
      key: "a",
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    button.dispatchEvent(key);
    document.removeEventListener("pointerdown", listen);
    document.removeEventListener("keydown", listen);
    expect(heard).toEqual([press, key]);
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
  });
});

describe("till-floor-screen: the room's revision on today's plan", () => {
  const at7 = () => [planned("t1", 2, { zoneRevision: 7 }), planned("t2", 20, { zoneRevision: 7 })];

  it("a drop on empty space sends the read's revision", async () => {
    const api = stubApi();
    const el = await mount(at7(), api);
    await drop(el, { tableId: "t1", x: 12, y: 5, targetId: null });
    expect(api.moveToday).toHaveBeenCalledExactlyOnceWith("t1", { x: 12, y: 5 }, 7);
  });

  it("a merge's seats resend sends the revision read at the drop, not a later read's", async () => {
    const api = stubApi();
    api.mergeToday.mockRejectedValueOnce({ code: "merge.seats_required", status: 400 });
    const el = await mount(at7(), api);
    await drop(el, { tableId: "t2", x: 5, y: 3, targetId: "t1" });
    await settle(el);
    expect(api.mergeToday).toHaveBeenCalledExactlyOnceWith(
      "t2",
      { targetId: "t1", side: "right" },
      7,
    );

    el.tablesReadAt = nextFloorMoment();
    el.tables = [planned("t1", 2, { zoneRevision: 8 }), planned("t2", 20, { zoneRevision: 8 })];
    await el.updateComplete;
    el.shadowRoot!.querySelector("till-today-seats-dialog")!.dispatchEvent(
      new CustomEvent("today-seats-confirm", {
        detail: { seats: 10 },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(el);

    expect(api.mergeToday).toHaveBeenLastCalledWith(
      "t2",
      { targetId: "t1", side: "right", seats: 10 },
      7,
    );
  });

  /** Moves t1 on a floor read at 7, answered 8, and returns when the read that drew it started. */
  async function movedTo8() {
    const api = stubApi();
    api.moveToday.mockResolvedValueOnce({ zoneId: "z1", revision: 8 });
    const el = await mount(at7(), api);
    const readStarted = nextFloorMoment();
    el.tablesReadAt = readStarted;
    await drop(el, { tableId: "t1", x: 12, y: 5, targetId: null });
    await settle(el);
    return { api, el, readStarted };
  }

  it("a second drag before any read sends the screen's own answer", async () => {
    const { api, el } = await movedTo8();
    await drop(el, { tableId: "t1", x: 14, y: 5, targetId: null });
    expect(api.moveToday).toHaveBeenLastCalledWith("t1", { x: 14, y: 5 }, 8);
  });

  it("a read that started before the answer leaves the answer as the revision sent", async () => {
    const { api, el, readStarted } = await movedTo8();
    el.tablesReadAt = readStarted;
    el.tables = at7();
    await el.updateComplete;
    await drop(el, { tableId: "t1", x: 14, y: 5, targetId: null });
    expect(api.moveToday).toHaveBeenLastCalledWith("t1", { x: 14, y: 5 }, 8);
  });

  it("a read that started just before the answer leaves the answer as the revision sent, though the clock read the same at both", async () => {
    const api = stubApi();
    let answer!: () => void;
    api.moveToday.mockImplementationOnce(
      () =>
        new Promise<FloorAnswer>(
          (resolve) => (answer = () => resolve({ zoneId: "z1", revision: 8 })),
        ),
    );
    const el = await mount(at7(), api);
    await drop(el, { tableId: "t1", x: 12, y: 5, targetId: null });
    const clock = vi.spyOn(performance, "now").mockReturnValue(100);
    try {
      el.tablesReadAt = nextFloorMoment();
      answer();
      await settle(el);
    } finally {
      clock.mockRestore();
    }
    el.tables = at7();
    await el.updateComplete;

    await drop(el, { tableId: "t1", x: 14, y: 5, targetId: null });

    expect(api.moveToday).toHaveBeenLastCalledWith("t1", { x: 14, y: 5 }, 8);
  });

  it("a read that started after the answer replaces it, higher or lower", async () => {
    for (const read of [9, 6]) {
      const { api, el } = await movedTo8();
      el.tablesReadAt = nextFloorMoment();
      el.tables = [
        planned("t1", 2, { zoneRevision: read }),
        planned("t2", 20, { zoneRevision: read }),
      ];
      await el.updateComplete;
      await drop(el, { tableId: "t1", x: 14, y: 5, targetId: null });
      expect(api.moveToday).toHaveBeenLastCalledWith("t1", { x: 14, y: 5 }, read);
      cleanupWidgets();
    }
  });

  it("a change in another room keeps the first room's answer as the revision sent", async () => {
    const api = stubApi();
    api.moveToday
      .mockResolvedValueOnce({ zoneId: "z1", revision: 8 })
      .mockResolvedValueOnce({ zoneId: "z2", revision: 4 });
    const el = await mount(
      [
        planned("t1", 2, { zoneRevision: 7 }),
        { ...planned("t3", 2, { zoneRevision: 3 }), zoneId: "z2" },
      ],
      api,
      [zone(), zone({ id: "z2", name: "Terrace", displayOrder: 1 })],
    );
    await drop(el, { tableId: "t1", x: 12, y: 5, targetId: null });
    await settle(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-zone="z2"]')!.click();
    await el.updateComplete;
    await drop(el, { tableId: "t3", x: 12, y: 5, targetId: null });
    await settle(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-zone="z1"]')!.click();
    await el.updateComplete;

    await drop(el, { tableId: "t1", x: 14, y: 5, targetId: null });

    expect(api.moveToday.mock.calls.map(([tableId, , sent]) => [tableId, sent])).toEqual([
      ["t1", 7],
      ["t3", 3],
      ["t1", 8],
    ]);
  });

  it("a change refused as out of date says the floor has changed, drops the drawn drop and re-reads", async () => {
    const api = stubApi();
    api.moveToday.mockRejectedValueOnce({
      code: "floor_today.out_of_date",
      status: 409,
      params: { zoneId: "z1", revision: 9 },
    });
    const el = await mount(at7(), api);
    const refreshes = countRefreshes(el);
    await drop(el, { tableId: "t1", x: 12, y: 5, targetId: null });
    await settle(el);
    expect(refusal(el)).toBe("The floor has changed. Check and try again");
    expect(drawnAt(el, "t1")).toBe(2);
    expect(refreshes.count).toBe(1);
  });
});
