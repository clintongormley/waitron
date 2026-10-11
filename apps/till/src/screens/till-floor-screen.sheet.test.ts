import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mergeLabel } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import "./till-floor-screen.js";
import type { FloorZone, TableParty, TableState, TableToday, TillApi } from "../api/client.js";

const zone: FloorZone = {
  id: "z1",
  name: "Comedor",
  displayOrder: 0,
  active: true,
  closesAt: null,
  closed: false,
  hasPlan: false,
};

function party(id: string, revision: number, tableIds: string[]): TableParty {
  return {
    id,
    revision,
    guestCount: 2,
    state: "open",
    name: null,
    displayName: tableIds.join(", "),
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
  seated: TableParty | null = null,
): TableState {
  return {
    id,
    label: id.slice(1),
    zoneId: "z1",
    state: seated === null ? "free" : "open-tab",
    condition: seated === null ? "free" : "held",
    hasOpenTab: false,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    status: null,
    nextReservation: null,
    today: {
      placement: { x, y: 3, width: 2, height: 2, shape: "round", rotation: 0 },
      seats: 4,
      fixed: false,
      takenOff: false,
      joinId: null,
      joinSeats: null,
      ...over,
    },
    signals: [],
    party: seated,
  };
}

function stubApi() {
  const done = () => Promise.resolve();
  return {
    mergeToday: vi.fn<TillApi["mergeToday"]>(done),
    splitToday: vi.fn<TillApi["splitToday"]>(done),
    rotateToday: vi.fn<TillApi["rotateToday"]>(done),
    setSeatsToday: vi.fn<TillApi["setSeatsToday"]>(done),
    backToSavedToday: vi.fn<TillApi["backToSavedToday"]>(done),
    takeOffToday: vi.fn<TillApi["takeOffToday"]>(done),
    splitTable: vi.fn<TillApi["splitTable"]>(() =>
      Promise.resolve({ partyId: "N", mainBillId: null }),
    ),
    joinTables: vi.fn<TillApi["joinTables"]>(() =>
      Promise.resolve({} as Awaited<ReturnType<TillApi["joinTables"]>>),
    ),
  };
}

type Stub = ReturnType<typeof stubApi>;

async function mount(tables: TableState[], api: Stub, canChangeToday = true) {
  const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    zones: [zone],
    tables,
    api: api as unknown as TillApi,
    canChangeToday,
  });
  return el;
}

function send(target: Element, type: string, detail?: unknown): void {
  target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

const sheetOf = (el: TillFloorScreen) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["till-table-details-sheet"]>(
    "till-table-details-sheet",
  );

async function openSheet(el: TillFloorScreen, tableId: string) {
  send(el.shadowRoot!.querySelector("wt-floor-map")!, "wt-table-details", { tableId });
  await el.updateComplete;
  const sheet = sheetOf(el)!;
  await sheet.updateComplete;
  return sheet;
}

async function press(el: TillFloorScreen, tableId: string, action: string): Promise<void> {
  const sheet = await openSheet(el, tableId);
  sheet.shadowRoot!.querySelector<HTMLElement>(`[data-today-action="${action}"]`)!.click();
  await settle(el);
}

async function settle(el: TillFloorScreen): Promise<void> {
  for (let i = 0; i < 3; i++) await Promise.resolve();
  await el.updateComplete;
}

function countRefreshes(el: TillFloorScreen): { count: number } {
  const seen = { count: 0 };
  el.addEventListener("floor-refresh", () => seen.count++);
  return seen;
}

const refusal = (el: TillFloorScreen) =>
  el.shadowRoot!.querySelector("[data-floor-refusal]")?.textContent?.trim() ?? null;

const joinDialog = (el: TillFloorScreen) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["till-join-with-dialog"]>(
    "till-join-with-dialog",
  );

const targetIds = (el: TillFloorScreen) => joinDialog(el)!.targets.map((table) => table.id);

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

describe("till-floor-screen: the details sheet's changes for today", () => {
  it("passes the sheet its actions", async () => {
    const el = await mount([planned("t1", 2)], stubApi());
    expect((await openSheet(el, "t1")).actions).toBe(true);
  });

  it("offers no changes to a device whose profile takes no orders", async () => {
    const el = await mount([planned("t1", 2)], stubApi(), false);
    expect((await openSheet(el, "t1")).actions).toBe(false);
  });

  it("lets the map drag tables only when the profile takes orders", async () => {
    const mapOf = (el: TillFloorScreen) =>
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-floor-map"]>("wt-floor-map")!;
    expect(mapOf(await mount([planned("t1", 2)], stubApi(), false)).canDrag).toBe(false);
    cleanupWidgets();
    expect(mapOf(await mount([planned("t1", 2)], stubApi())).canDrag).toBe(true);
  });

  it("an action with no connection to the server sends nothing", async () => {
    const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
      zones: [zone],
      tables: [planned("t1", 2)],
      canChangeToday: true,
    });
    const refreshes = countRefreshes(el);
    await press(el, "t1", "take-off");
    expect(refreshes.count).toBe(0);
    expect(refusal(el)).toBeNull();
  });

  it("Join with… joins the chosen table as a drop on it would", async () => {
    const api = stubApi();
    const el = await mount([planned("t1", 2), planned("t2", 20)], api);
    const refreshes = countRefreshes(el);

    await press(el, "t1", "join-with");

    expect(sheetOf(el)).toBeNull();
    const dialog = joinDialog(el)!;
    expect(dialog.heading).toBe("Join 1 with");
    expect(dialog.table!.id).toBe("t1");
    expect(targetIds(el)).toEqual(["t2"]);

    send(dialog, "join-with-pick", { tableId: "t1", targetId: "t2" });
    send(dialog, "join-with-close");
    await settle(el);

    expect(joinDialog(el)).toBeNull();
    expect(api.mergeToday).toHaveBeenCalledExactlyOnceWith("t1", {
      targetId: "t2",
      side: "left",
    });
    expect(refreshes.count).toBe(1);
  });

  it("Join with… places the table on the side of the target it stands on", async () => {
    const api = stubApi();
    const el = await mount([planned("t1", 20), planned("t2", 2)], api);
    await press(el, "t1", "join-with");
    send(joinDialog(el)!, "join-with-pick", { tableId: "t1", targetId: "t2" });
    await settle(el);
    expect(api.mergeToday).toHaveBeenCalledExactlyOnceWith("t1", {
      targetId: "t2",
      side: "right",
    });
  });

  it("Join with… closes when its table loses its place", async () => {
    const api = stubApi();
    const el = await mount([planned("t1", 2), planned("t2", 20)], api);
    await press(el, "t1", "join-with");
    expect(joinDialog(el)).not.toBeNull();
    el.tables = [planned("t1", 2, { placement: null, takenOff: true }), planned("t2", 20)];
    await settle(el);
    expect(joinDialog(el)).toBeNull();
    el.tables = [planned("t1", 2), planned("t2", 20)];
    await settle(el);
    expect(joinDialog(el)).toBeNull();
    expect(api.mergeToday).not.toHaveBeenCalled();
  });

  it("Join with… lists the tables of the latest floor read", async () => {
    const el = await mount([planned("t1", 2), planned("t2", 20)], stubApi());
    await press(el, "t1", "join-with");
    el.tables = [planned("t1", 2), planned("t2", 20), planned("t3", 40)];
    await settle(el);
    expect(targetIds(el)).toEqual(["t2", "t3"]);
  });

  it("Join with… names a merge as the map does, once", async () => {
    const el = await mount(
      [
        planned("t1", 2),
        planned("t4", 20, { joinId: "J" }),
        planned("t5", 22, { joinId: "J" }),
        planned("t6", 40, { placement: null, takenOff: true }),
      ],
      stubApi(),
    );
    await press(el, "t1", "join-with");
    expect(joinDialog(el)!.targets.map((table) => [table.id, table.label])).toEqual([
      ["t4", "4+5"],
    ]);
  });

  it("Join with… lists a party at several tables once, named as the map links them", async () => {
    const P = party("P", 3, ["t22", "t21"]);
    const el = await mount(
      [
        planned("t1", 2),
        planned("t22", 30, { fixed: true }, P),
        planned("t21", 20, { fixed: true }, P),
        planned("t3", 40),
      ],
      stubApi(),
    );
    await press(el, "t1", "join-with");
    expect(joinDialog(el)!.targets.map((table) => [table.id, table.label])).toEqual([
      ["t3", "3"],
      ["t21", "21+22"],
    ]);
  });

  it("Join with… leaves out the table's own party's other tables", async () => {
    const P = party("P", 3, ["t1", "t2"]);
    const el = await mount(
      [planned("t1", 2, {}, P), planned("t2", 20, {}, P), planned("t3", 40)],
      stubApi(),
    );
    await press(el, "t1", "join-with");
    expect(targetIds(el)).toEqual(["t3"]);
  });

  it("Join with… closed without a pick changes nothing", async () => {
    const api = stubApi();
    const el = await mount([planned("t1", 2), planned("t2", 20)], api);
    const refreshes = countRefreshes(el);
    await press(el, "t1", "join-with");
    send(joinDialog(el)!, "join-with-close");
    await settle(el);
    expect(joinDialog(el)).toBeNull();
    expect(api.mergeToday).not.toHaveBeenCalled();
    expect(refreshes.count).toBe(0);
  });

  it("Split ends a free merge, and splits the last table off a seated one", async () => {
    const free = stubApi();
    const freeFloor = await mount(
      [planned("t4", 20, { joinId: "J" }), planned("t5", 22, { joinId: "J" })],
      free,
    );
    await press(freeFloor, "t4", "split");
    expect(free.splitToday).toHaveBeenCalledExactlyOnceWith("t4");
    expect(free.splitTable).not.toHaveBeenCalled();
    cleanupWidgets();

    const P = party("P", 6, ["t5", "t4"]);
    const seated = stubApi();
    const seatedFloor = await mount(
      [planned("t5", 22, { joinId: "J" }, P), planned("t4", 20, { joinId: "J" }, P)],
      seated,
    );
    const refreshes = countRefreshes(seatedFloor);
    await press(seatedFloor, "t4", "split");
    expect(seated.splitTable).toHaveBeenCalledExactlyOnceWith("P", "t5", null, 6);
    expect(seated.splitToday).not.toHaveBeenCalled();
    expect(refreshes.count).toBe(1);
  });

  it("Rotate, Back and Take off call their routes; Change seats asks first", async () => {
    const api = stubApi();
    const el = await mount([planned("t1", 2, { seats: 6 })], api);
    const refreshes = countRefreshes(el);

    await press(el, "t1", "rotate");
    expect(api.rotateToday).toHaveBeenCalledExactlyOnceWith("t1");
    expect(sheetOf(el)).not.toBeNull();
    await press(el, "t1", "back");
    expect(api.backToSavedToday).toHaveBeenCalledExactlyOnceWith("t1");
    await press(el, "t1", "take-off");
    expect(api.takeOffToday).toHaveBeenCalledExactlyOnceWith("t1");
    expect(refreshes.count).toBe(3);

    await press(el, "t1", "seats");
    const dialog = el.shadowRoot!.querySelector("till-today-seats-dialog")!;
    expect(dialog.action).toBe("save");
    expect(dialog.seats).toBe(6);
    expect(dialog.heading).toBe("Seats for 1");
    expect(api.setSeatsToday).not.toHaveBeenCalled();

    send(dialog, "today-seats-confirm", { seats: 8 });
    await settle(el);
    expect(api.setSeatsToday).toHaveBeenCalledExactlyOnceWith("t1", 8);
    expect(el.shadowRoot!.querySelector("till-today-seats-dialog")).toBeNull();
    expect(refreshes.count).toBe(4);
  });

  it("Split takes off the table the merge's name ends with", async () => {
    const P = party("P", 2, ["t1", "t2"]);
    const api = stubApi();
    const el = await mount(
      [
        { ...planned("t1", 20, { joinId: "J" }, P), label: "1.10" },
        { ...planned("t2", 22, { joinId: "J" }, P), label: "1.5" },
      ],
      api,
    );
    await press(el, "t1", "split");
    expect(mergeLabel(["1.10", "1.5"])).toBe("1.5+1.10");
    expect(api.splitTable).toHaveBeenCalledExactlyOnceWith("P", "t1", null, 2);
  });

  it("Change seats on a table with no seats opens empty", async () => {
    const el = await mount([planned("t1", 2, { seats: null })], stubApi());
    await press(el, "t1", "seats");
    const dialog = el.shadowRoot!.querySelector("till-today-seats-dialog")!;
    await dialog.updateComplete;
    expect(dialog.seats).toBe(0);
    const stepper =
      dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-number-stepper"]>("[name=seats]")!;
    expect(stepper.shadowRoot!.querySelector("input")!.value).toBe("");
  });

  it("Change seats cancelled sends nothing and re-reads nothing", async () => {
    const api = stubApi();
    const el = await mount([planned("t1", 2, { seats: 6 })], api);
    const refreshes = countRefreshes(el);
    await press(el, "t1", "seats");
    send(el.shadowRoot!.querySelector("till-today-seats-dialog")!, "today-seats-cancel");
    await settle(el);
    expect(el.shadowRoot!.querySelector("till-today-seats-dialog")).toBeNull();
    expect(api.setSeatsToday).not.toHaveBeenCalled();
    expect(refreshes.count).toBe(0);
  });

  it("a refused action is said on the floor", async () => {
    const api = stubApi();
    api.takeOffToday.mockRejectedValueOnce({ code: "tab.already_open", status: 409 });
    const el = await mount([planned("t1", 2)], api);
    const refreshes = countRefreshes(el);

    await press(el, "t1", "take-off");

    expect(refusal(el)).toBe(codeMessage("tab.already_open"));
    expect(refreshes.count).toBe(1);
  });
});
