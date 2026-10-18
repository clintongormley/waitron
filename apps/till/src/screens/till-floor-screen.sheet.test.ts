import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import "./till-floor-screen.js";
import type { FloorZone, TableParty, TableState, TableToday, TillApi } from "../api/client.js";
import { nextFloorMoment } from "../state/floor-today.js";

const zone: FloorZone = {
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
};

function party(id: string, revision: number, tableIds: string[]): TableParty {
  return {
    kitchenNote: { scope: { partyId: id }, note: null, revision: 0, ownerRevision: revision },
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
      inJoinedTable: null,
      joined: null,
      splitOffFrom: null,
      zoneRevision: 0,
      ...over,
    },
    signals: [],
    party: seated,
  };
}

function stubApi() {
  const done = () => Promise.resolve({ zoneId: "z1", revision: 0 });
  return {
    mergeToday: vi.fn<TillApi["mergeToday"]>(done),
    rotateToday: vi.fn<TillApi["rotateToday"]>(done),
    setSeatsToday: vi.fn<TillApi["setSeatsToday"]>(done),
    backToSavedToday: vi.fn<TillApi["backToSavedToday"]>(done),
    takeOffToday: vi.fn<TillApi["takeOffToday"]>(done),
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
    expect(api.mergeToday).toHaveBeenCalledExactlyOnceWith(
      "t1",
      {
        targetId: "t2",
        side: "left",
      },
      0,
    );
    expect(refreshes.count).toBe(1);
  });

  it("Join with… places the table on the side of the target it stands on", async () => {
    const api = stubApi();
    const el = await mount([planned("t1", 20), planned("t2", 2)], api);
    await press(el, "t1", "join-with");
    send(joinDialog(el)!, "join-with-pick", { tableId: "t1", targetId: "t2" });
    await settle(el);
    expect(api.mergeToday).toHaveBeenCalledExactlyOnceWith(
      "t1",
      {
        targetId: "t2",
        side: "right",
      },
      0,
    );
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

  it("Join with… leaves out a joined table that has come apart and a part still joined, though each kept a place", async () => {
    const el = await mount(
      [
        planned("t1", 2),
        planned("tL", 20, { joined: { parts: [], splitOff: ["t3"], apart: true } }),
        planned("t3", 30, { splitOffFrom: "tL" }),
        planned("tM", 40, { joined: { parts: ["t5", "t6"], splitOff: [], apart: false } }),
        planned("t5", 60, { inJoinedTable: "M" }),
      ],
      stubApi(),
    );
    await press(el, "t1", "join-with");
    expect(targetIds(el)).toEqual(["t3", "tM"]);
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

  it("Rotate, Back and Take off call their routes; Change seats asks first", async () => {
    const api = stubApi();
    const el = await mount([planned("t1", 2, { seats: 6 })], api);
    const refreshes = countRefreshes(el);

    await press(el, "t1", "rotate");
    expect(api.rotateToday).toHaveBeenCalledExactlyOnceWith("t1", 0);
    expect(sheetOf(el)).not.toBeNull();
    await press(el, "t1", "back");
    expect(api.backToSavedToday).toHaveBeenCalledExactlyOnceWith("t1", 0);
    await press(el, "t1", "take-off");
    expect(api.takeOffToday).toHaveBeenCalledExactlyOnceWith("t1", 0);
    expect(refreshes.count).toBe(3);

    await press(el, "t1", "seats");
    const dialog = el.shadowRoot!.querySelector("till-today-seats-dialog")!;
    expect(dialog.action).toBe("save");
    expect(dialog.seats).toBe(6);
    expect(dialog.heading).toBe("Seats for 1");
    expect(api.setSeatsToday).not.toHaveBeenCalled();

    send(dialog, "today-seats-confirm", { seats: 8 });
    await settle(el);
    expect(api.setSeatsToday).toHaveBeenCalledExactlyOnceWith("t1", 8, 0);
    expect(el.shadowRoot!.querySelector("till-today-seats-dialog")).toBeNull();
    expect(refreshes.count).toBe(4);
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

describe("till-floor-screen: the sheet's actions and the room's revision", () => {
  it("Rotate, Back, Take off and Join with… send the read's revision", async () => {
    const calls: [string, (api: Stub) => unknown, unknown[]][] = [
      ["rotate", (api) => api.rotateToday, ["t1", 7]],
      ["back", (api) => api.backToSavedToday, ["t1", 7]],
      ["take-off", (api) => api.takeOffToday, ["t1", 7]],
    ];
    for (const [action, route, args] of calls) {
      const api = stubApi();
      const el = await mount([planned("t1", 2, { zoneRevision: 7 })], api);
      await press(el, "t1", action);
      expect(route(api)).toHaveBeenCalledExactlyOnceWith(...args);
      cleanupWidgets();
    }

    const joining = stubApi();
    const el = await mount(
      [planned("t1", 2, { zoneRevision: 7 }), planned("t2", 20, { zoneRevision: 7 })],
      joining,
    );
    await press(el, "t1", "join-with");
    send(joinDialog(el)!, "join-with-pick", { tableId: "t1", targetId: "t2" });
    await settle(el);
    expect(joining.mergeToday).toHaveBeenCalledExactlyOnceWith(
      "t1",
      { targetId: "t2", side: "left" },
      7,
    );
  });

  it("Change seats sends the revision read at the press that opened it", async () => {
    const api = stubApi();
    const el = await mount([planned("t1", 2, { seats: 6, zoneRevision: 7 })], api);
    await press(el, "t1", "seats");

    el.tablesReadAt = nextFloorMoment();
    el.tables = [planned("t1", 2, { seats: 6, zoneRevision: 8 })];
    await el.updateComplete;
    send(el.shadowRoot!.querySelector("till-today-seats-dialog")!, "today-seats-confirm", {
      seats: 8,
    });
    await settle(el);

    expect(api.setSeatsToday).toHaveBeenCalledExactlyOnceWith("t1", 8, 7);
  });
});

describe("till-floor-screen: Join with… in a zone that seats no one", () => {
  async function mountIn(serviceMode: FloorZone["serviceMode"], tables: TableState[]) {
    const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
      zones: [{ ...zone, serviceMode }],
      tables,
      api: stubApi() as unknown as TillApi,
      canChangeToday: true,
    });
    return el;
  }

  const offersJoinWith = (sheet: HTMLElementTagNameMap["till-table-details-sheet"]) =>
    sheet.shadowRoot!.querySelector('[data-today-action="join-with"]') !== null;

  const fixedPair = () => [planned("t1", 2, { fixed: true }), planned("t2", 20, { fixed: true })];

  it("is not offered for one of two fixed free tables", async () => {
    const el = await mountIn("prepay", fixedPair());
    expect(offersJoinWith(await openSheet(el, "t1"))).toBe(false);
  });

  it("lists only the free tables a drop would merge with", async () => {
    const el = await mountIn("prepay", [
      planned("t1", 2, { fixed: true }),
      planned("t2", 10),
      planned("t3", 20, {}, party("P", 1, ["t3"])),
      planned("t4", 30),
    ]);
    await press(el, "t4", "join-with");
    expect(targetIds(el)).toEqual(["t2"]);
  });

  it("is offered as before in a zone with table service, and the pick opens Seat for both", async () => {
    const el = await mountIn("table_tab", fixedPair());
    expect(offersJoinWith(await openSheet(el, "t1"))).toBe(true);
    await press(el, "t1", "join-with");
    expect(targetIds(el)).toEqual(["t2"]);
    send(joinDialog(el)!, "join-with-pick", { tableId: "t1", targetId: "t2" });
    await settle(el);
    const dialog = el.shadowRoot!.querySelector("till-seat-dialog")!;
    expect(dialog).not.toBeNull();
    expect(dialog.tableLabel).toBe("1+2");
  });
});
