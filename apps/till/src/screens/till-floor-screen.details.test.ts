import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import "./till-floor-screen.js";
import type { TillTableDetailsSheet } from "../widgets/table-details-sheet.js";
import type { FloorZone, TableParty, TableState, TableToday } from "../api/client.js";

function zone(): FloorZone {
  return {
    id: "z1",
    name: "Terrace",
    displayOrder: 0,
    active: true,
    closesAt: null,
    closed: false,
  };
}

function today(over: Partial<TableToday> = {}): TableToday {
  return {
    placement: { x: 2, y: 3, width: 2, height: 2, shape: "round", rotation: 0 },
    seats: 4,
    fixed: false,
    takenOff: false,
    joinId: null,
    joinSeats: null,
    ...over,
  };
}

function party(over: Partial<TableParty> = {}): TableParty {
  return {
    id: "p1",
    revision: 1,
    guestCount: null,
    state: "open",
    name: null,
    displayName: "Terrace 4",
    mainBillId: null,
    outstanding: "10.00",
    billCount: 1,
    tableIds: ["t4"],
    unsentDrafts: [],
    reminder: null,
    ...over,
  };
}

function table(id: string, over: Partial<TableState> = {}): TableState {
  return {
    id,
    label: `Terrace ${id.slice(1)}`,
    zoneId: "z1",
    capacity: 4,
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
    posX: null,
    posY: null,
    shape: null,
    rotation: null,
    today: today(),
    signals: [],
    party: null,
    ...over,
  };
}

const seated = { state: "open-tab" as const, condition: "held" as const, hasOpenTab: true };

const mount = (tables: TableState[]) =>
  mountWidget<TillFloorScreen>("till-floor-screen", { zones: [zone()], tables }).then(
    ({ el }) => el,
  );

const sheetOf = (el: TillFloorScreen) =>
  el.shadowRoot!.querySelector<TillTableDetailsSheet>("till-table-details-sheet");

async function askDetails(el: TillFloorScreen, tableId: string): Promise<TillTableDetailsSheet> {
  el.shadowRoot!.querySelector("wt-floor-map")!.dispatchEvent(
    new CustomEvent("wt-table-details", { detail: { tableId }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  const sheet = sheetOf(el)!;
  await sheet.updateComplete;
  return sheet;
}

const sheetText = (sheet: TillTableDetailsSheet, selector: string) =>
  sheet.shadowRoot!.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim();

afterEach(() => {
  vi.useRealTimers();
  cleanupWidgets();
});

describe("till-floor-screen's details sheet", () => {
  it("opens the sheet on the map's request, headed as the map draws the table", async () => {
    const el = await mount([
      table("t4", { today: today({ joinId: "j1", joinSeats: 6 }) }),
      table("t5", { today: today({ joinId: "j1", joinSeats: 6 }) }),
    ]);
    expect(sheetOf(el)).toBeNull();
    const sheet = await askDetails(el, "t4");
    expect(sheet.table?.id).toBe("t4");
    expect(sheet.heading).toBe("Terrace 4+5");
  });

  it("the open sheet shows Time to fire when the floor redraws at the due time", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(Date.parse("2026-10-10T11:59:59Z"));
    const el = await mount([
      table("t4", {
        ...seated,
        party: party({ reminder: { groupId: "g1", dueAt: "2026-10-10T12:00:00Z" } }),
      }),
    ]);
    const sheet = await askDetails(el, "t4");
    expect(sheet.shadowRoot!.querySelector("[data-fire-due]")).toBeNull();

    vi.advanceTimersByTime(1000);
    await el.updateComplete;
    await sheet.updateComplete;
    vi.useRealTimers();
    expect(sheetText(sheet, "[data-fire-due]")).toBe("Time to fire");
  });

  it("a re-read updates the open sheet", async () => {
    const el = await mount([table("t4", { ...seated, party: party() })]);
    const sheet = await askDetails(el, "t4");
    expect(sheetText(sheet, "[data-kitchen]")).toBeUndefined();

    el.tables = [table("t4", { ...seated, party: party(), pendingToServe: 2, readyToServe: 2 })];
    await el.updateComplete;
    await sheet.updateComplete;
    expect(sheetText(sheet, "[data-kitchen]")).toBe("2 ready");
  });

  it("a re-read without the table closes the sheet", async () => {
    const el = await mount([table("t4", { ...seated, party: party() }), table("t5")]);
    await askDetails(el, "t4");

    el.tables = [table("t5")];
    await el.updateComplete;
    expect(sheetOf(el)).toBeNull();

    el.tables = [table("t4", { ...seated, party: party() }), table("t5")];
    await el.updateComplete;
    expect(sheetOf(el)).toBeNull();
  });

  it("a re-read that merges the open sheet's table renames the sheet", async () => {
    const el = await mount([table("t4"), table("t5")]);
    const sheet = await askDetails(el, "t4");
    expect(sheet.heading).toBe("Terrace 4");

    el.tables = [
      table("t4", { today: today({ joinId: "j1", joinSeats: 6 }) }),
      table("t5", { today: today({ joinId: "j1", joinSeats: 6 }) }),
    ];
    await el.updateComplete;
    await sheet.updateComplete;
    expect(sheet.heading).toBe("Terrace 4+5");
  });

  it("a merged table the map no longer draws keeps its own name on the open sheet", async () => {
    const el = await mount([
      table("t4", { today: today({ joinId: "j1", joinSeats: 6 }) }),
      table("t5", { today: today({ joinId: "j1", joinSeats: 6 }) }),
    ]);
    const sheet = await askDetails(el, "t4");
    expect(sheet.heading).toBe("Terrace 4+5");

    el.tables = [
      table("t4", { today: today({ joinId: "j1", joinSeats: 6, placement: null }) }),
      table("t5", { today: today({ joinId: "j1", joinSeats: 6 }) }),
    ];
    await el.updateComplete;
    await sheet.updateComplete;
    expect(sheet.heading).toBe("Terrace 4");
  });

  it("after a re-read removes the open sheet, the rest of the page takes a real click", async () => {
    const el = await mount([table("t4", { ...seated, party: party() }), table("t5")]);
    await askDetails(el, "t4");
    const elsewhere = document.createElement("button");
    elsewhere.textContent = "Elsewhere";
    const clicked = vi.fn();
    elsewhere.addEventListener("click", clicked);
    document.body.append(elsewhere);
    try {
      el.tables = [table("t5")];
      await el.updateComplete;
      expect(sheetOf(el)).toBeNull();
      await userEvent.click(elsewhere);
      expect(clicked).toHaveBeenCalledTimes(1);
    } finally {
      elsewhere.remove();
    }
  });

  it("Close in the sheet closes it, and the request goes no further", async () => {
    const el = await mount([table("t4", { ...seated, party: party() })]);
    const outside = vi.fn();
    document.addEventListener("details-close", outside);
    try {
      const sheet = await askDetails(el, "t4");
      sheet.shadowRoot!.querySelector<HTMLElement>("[data-details-close]")!.click();
      await el.updateComplete;
      expect(sheetOf(el)).toBeNull();
      expect(outside).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("details-close", outside);
    }
  });

  it("Mark cleared in the sheet reaches the app and closes the sheet", async () => {
    const el = await mount([table("t4", { condition: "needs_clearing" })]);
    const heard: unknown[] = [];
    const listener = (event: Event) => heard.push((event as CustomEvent).detail);
    document.addEventListener("mark-cleared", listener);
    try {
      const sheet = await askDetails(el, "t4");
      sheet.shadowRoot!.querySelector<HTMLElement>("[data-mark-cleared]")!.click();
      await el.updateComplete;
      expect(heard).toEqual([{ tableId: "t4" }]);
      expect(sheetOf(el)).toBeNull();
    } finally {
      document.removeEventListener("mark-cleared", listener);
    }
  });

  it("ignores a request naming a table the floor no longer has", async () => {
    const el = await mount([table("t4")]);
    el.shadowRoot!.querySelector("wt-floor-map")!.dispatchEvent(
      new CustomEvent("wt-table-details", {
        detail: { tableId: "gone" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    expect(sheetOf(el)).toBeNull();
  });
});
