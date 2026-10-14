import { afterEach, describe, expect, it, vi } from "vitest";
import type { FloorMapDrop, WtDialog, WtFloorMap } from "@waitron/ui";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import "./till-floor-screen.js";
import type {
  FloorAnswer,
  FloorZone,
  TableParty,
  TableState,
  TableToday,
  TillApi,
} from "../api/client.js";
import type { TillTableDetailsSheet } from "../widgets/table-details-sheet.js";
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

describe("till-floor-screen: today's names", () => {
  const party = (displayName: string, tableIds: string[]): TableParty => ({
    id: "p1",
    revision: 1,
    guestCount: null,
    state: "open",
    name: null,
    displayName,
    mainBillId: null,
    outstanding: "10.00",
    billCount: 1,
    tableIds,
    unsentDrafts: [],
    reminder: null,
  });
  const seatedAt = (displayName: string, tableIds: string[]): Partial<TableState> => ({
    state: "open-tab",
    condition: "held",
    hasOpenTab: true,
    party: party(displayName, tableIds),
  });

  /** Counter 4 named Window for today. */
  const counter4 = (over: Partial<TableState> = {}, todayOver: Partial<TableToday> = {}) => ({
    ...planned("t4", 2, { name: "Window", ...todayOver }),
    label: "Counter 4",
    ...over,
  });
  const counter5 = (todayOver: Partial<TableToday> = {}) => ({
    ...planned("t5", 4, todayOver),
    label: "Counter 5",
  });
  const bar = (todayOver: Partial<TableToday> = {}) => ({
    ...planned("tb", 20, todayOver),
    label: "Bar",
  });
  const inGroup = (joinName: string | null): Partial<TableToday> => ({
    joinId: "j1",
    joinSeats: 10,
    joinName,
  });

  async function details(el: TillFloorScreen, tableId: string): Promise<TillTableDetailsSheet> {
    mapOf(el).dispatchEvent(
      new CustomEvent("wt-table-details", { detail: { tableId }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    const sheet = el.shadowRoot!.querySelector<TillTableDetailsSheet>("till-table-details-sheet")!;
    await sheet.updateComplete;
    return sheet;
  }

  const savedLine = (sheet: TillTableDetailsSheet) =>
    sheet.shadowRoot!.querySelector("[data-saved-name]")?.textContent?.trim() ?? null;

  async function listView(el: TillFloorScreen): Promise<void> {
    el.shadowRoot!.querySelector<HTMLElement>("[data-view-toggle]")!.click();
    await el.updateComplete;
  }

  const card = (el: TillFloorScreen, tableId: string) =>
    el.shadowRoot!.querySelector<HTMLElement>(`.card[data-table="${tableId}"]`)!;

  it("heads a renamed table's details with today's name and says its saved name beneath", async () => {
    const el = await mount([counter4(), bar()], stubApi());
    const sheet = await details(el, "t4");
    expect(sheet.heading).toBe("Window");
    expect(savedLine(sheet)).toBe("Saved as Counter 4");
  });

  it("heads an unrenamed table's details as before, with no saved name", async () => {
    const el = await mount([counter4(), bar()], stubApi());
    const sheet = await details(el, "tb");
    expect(sheet.heading).toBe("Table Bar");
    expect(savedLine(sheet)).toBeNull();
  });

  it("heads a renamed group's details with the group's name and the tapped table's saved name", async () => {
    const el = await mount(
      [
        counter4({}, { name: null, ...inGroup("García birthday") }),
        counter5(inGroup("García birthday")),
      ],
      stubApi(),
    );
    const sheet = await details(el, "t5");
    expect(sheet.heading).toBe("García birthday");
    expect(savedLine(sheet)).toBe("Saved as Counter 5");
  });

  it("names an unnamed group from its tables' shown names, with no saved name", async () => {
    const el = await mount([counter4({}, inGroup(null)), bar(inGroup(null))], stubApi());
    const sheet = await details(el, "t4");
    expect(sheet.heading).toBe("Bar+Window");
    expect(savedLine(sheet)).toBeNull();
  });

  it("the list card shows today's name with the saved name small after it", async () => {
    const el = await mount([counter4(), bar()], stubApi());
    await listView(el);
    expect(card(el, "t4").querySelector(".label")!.textContent!.trim()).toBe("Window");
    expect(card(el, "t4").querySelector("[data-saved-label]")!.textContent!.trim()).toBe(
      "Counter 4",
    );
    expect(card(el, "tb").querySelector(".label")!.textContent!.trim()).toBe("Bar");
    expect(card(el, "tb").querySelector("[data-saved-label]")).toBeNull();
  });

  it("a party named after its renamed table shows no second name", async () => {
    const el = await mount([counter4(seatedAt("Window", ["t4"])), bar()], stubApi());
    await listView(el);
    expect(card(el, "t4").querySelector("[data-party-name]")).toBeNull();
  });

  it("a party named after its renamed group shows no second name", async () => {
    const seated = seatedAt("García birthday", ["t4", "t5"]);
    const el = await mount(
      [
        counter4(seated, { name: null, ...inGroup("García birthday") }),
        { ...counter5(inGroup("García birthday")), ...seated },
      ],
      stubApi(),
    );
    await listView(el);
    expect(card(el, "t4").querySelector("[data-party-name]")).toBeNull();
    expect(card(el, "t5").querySelector("[data-party-name]")).toBeNull();
  });

  it("the seat window for a free renamed group is headed with the group's name", async () => {
    const el = await mount(
      [
        counter4({}, { name: null, ...inGroup("García birthday") }),
        counter5(inGroup("García birthday")),
      ],
      stubApi(),
    );
    mapOf(el).dispatchEvent(
      new CustomEvent("wt-table-tap", { detail: { tableId: "t5" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-seat-dialog")!.tableLabel).toBe("García birthday");
  });

  async function press(el: TillFloorScreen, tableId: string, action: string): Promise<void> {
    el.canChangeToday = true;
    await el.updateComplete;
    const sheet = await details(el, tableId);
    sheet.shadowRoot!.querySelector<HTMLElement>(`[data-today-action="${action}"]`)!.click();
    await settle(el);
  }

  const clearingTitle = async (el: TillFloorScreen, tableId: string) => {
    mapOf(el).dispatchEvent(
      new CustomEvent("wt-table-tap", { detail: { tableId }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    return el.shadowRoot!.querySelector<WtDialog>("[data-clear-dialog]")!.heading;
  };
  const needsClearing = { condition: "needs_clearing" as const };

  it("the clearing window names a renamed table by today's name", async () => {
    const el = await mount([counter4(needsClearing), bar()], stubApi());
    expect(await clearingTitle(el, "t4")).toBe("Window needs clearing");
  });

  it("the clearing window names a renamed table by today's name in Spanish", async () => {
    setLocale("es");
    try {
      const el = await mount([counter4(needsClearing), bar()], stubApi());
      expect(await clearingTitle(el, "t4")).toBe("Window está por recoger");
    } finally {
      setLocale("en");
    }
  });

  it("the clearing window names a table in a group by its own saved name", async () => {
    const el = await mount(
      [counter4(needsClearing, { name: null, ...inGroup(null) }), bar(inGroup(null))],
      stubApi(),
    );
    expect(await clearingTitle(el, "t4")).toBe("Table Counter 4 needs clearing");
  });

  it("Change seats on a renamed table is headed with today's name", async () => {
    const el = await mount([counter4(), bar()], stubApi());
    await press(el, "t4", "seats");
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["till-today-seats-dialog"]>(
        "till-today-seats-dialog",
      )!.heading,
    ).toBe("Seats for Window");
  });

  it("Join with… names a linked party with a renamed table by the shown names", async () => {
    const linked = seatedAt("Bar, Window", ["tb", "t4"]);
    const el = await mount(
      [counter5(), { ...bar({ fixed: true }), ...linked }, counter4(linked, { fixed: true })],
      stubApi(),
    );
    await press(el, "t5", "join-with");
    const dialog =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["till-join-with-dialog"]>(
        "till-join-with-dialog",
      )!;
    expect(dialog.targets.map((table) => [table.id, table.label])).toEqual([["tb", "Bar+Window"]]);
  });

  it("Join with… lists a renamed group and a renamed table by their names and is headed with the joining table's name for today", async () => {
    const el = await mount(
      [
        counter4({}, { name: null, ...inGroup("García birthday") }),
        bar(inGroup("García birthday")),
        counter5({ name: "Corner" }),
        { ...planned("t6", 30, { name: "Patio" }), label: "Counter 6" },
      ],
      stubApi(),
    );
    await press(el, "t5", "join-with");
    const dialog =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["till-join-with-dialog"]>(
        "till-join-with-dialog",
      )!;
    expect(dialog.heading).toBe("Join Corner with");
    expect(dialog.targets.map((table) => [table.id, table.label])).toEqual([
      ["tb", "García birthday"],
      ["t6", "Patio"],
    ]);
  });

  it("Join with… lists its targets in the order of the names they show", async () => {
    const el = await mount(
      [counter5(), bar({ name: "Zinc" }), { ...planned("t6", 30), label: "Counter 6" }],
      stubApi(),
    );
    await press(el, "t5", "join-with");
    const dialog =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["till-join-with-dialog"]>(
        "till-join-with-dialog",
      )!;
    expect(dialog.targets.map((table) => [table.id, table.label])).toEqual([
      ["t6", "Counter 6"],
      ["tb", "Zinc"],
    ]);
  });

  const splitWindow = (el: TillFloorScreen) =>
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["till-split-joined-dialog"]>(
      "till-split-joined-dialog",
    )!;

  it("Split tables… on a renamed group is headed with its name and lists its tables by their shown names", async () => {
    const el = await mount(
      [counter4({}, inGroup("García birthday")), counter5(inGroup("García birthday"))],
      stubApi(),
    );
    await press(el, "t5", "split-off");
    expect(splitWindow(el).name).toBe("García birthday");
    await splitWindow(el).updateComplete;
    const options =
      splitWindow(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
        "[name=split-off]",
      )!.options;
    expect(options.map((option) => option.label)).toEqual(["Window", "Counter 5"]);
  });

  it("Split tables… on a renamed joined table is headed with its name for today", async () => {
    const part = (id: string, label: string) => ({
      ...planned(id, 0, { placement: null, inJoinedTable: "Long table" }),
      label,
    });
    const long = {
      ...planned("tl", 2, {
        name: "Window table",
        joined: { parts: ["t3", "t6"], splitOff: [], apart: false },
      }),
      label: "Long table",
    };
    const el = await mount([long, part("t3", "Counter 3"), part("t6", "Counter 6")], stubApi());
    await press(el, "tl", "split-off");
    expect(splitWindow(el).name).toBe("Window table");
  });

  it("the seat window for a renamed table on its own is headed with today's name", async () => {
    const el = await mount([counter4(), bar()], stubApi());
    mapOf(el).dispatchEvent(
      new CustomEvent("wt-table-tap", { detail: { tableId: "t4" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-seat-dialog")!.tableLabel).toBe("Window");
  });
});
