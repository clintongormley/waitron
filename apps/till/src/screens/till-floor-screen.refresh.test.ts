import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget, toggleFloorView } from "../widgets/test-helpers.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import "./till-floor-screen.js";
import type { TillSeatDialog } from "../widgets/seat-dialog.js";
import type { FloorZone, TableState, TableToday } from "../api/client.js";

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

function table(over: Partial<TableState> = {}): TableState {
  return {
    id: "t1",
    label: "1",
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
    today: null,
    signals: [],
    party: null,
    ...over,
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
    inJoinedTable: null,
    joined: null,
    splitOffFrom: null,
    zoneRevision: 0,
    ...over,
  };
}

function planned(id: string, over: Partial<TableToday> = {}): TableState {
  return table({ id, label: id.slice(1), today: today(over) });
}

async function mount(over: Partial<TillFloorScreen> = {}): Promise<TillFloorScreen> {
  const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    zones: [zone()],
    tables: [planned("t1")],
    ...over,
  });
  return el;
}

function countRefreshes(el: TillFloorScreen): { count: number } {
  const seen = { count: 0 };
  el.addEventListener("floor-refresh", () => seen.count++);
  return seen;
}

async function click(el: TillFloorScreen, selector: string): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
  await el.updateComplete;
}

async function tapMap(el: TillFloorScreen, tableId: string): Promise<void> {
  el.shadowRoot!.querySelector("wt-floor-map")!.dispatchEvent(
    new CustomEvent("wt-table-tap", { detail: { tableId }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

const seatDialog = (el: TillFloorScreen) =>
  el.shadowRoot!.querySelector<TillSeatDialog>("till-seat-dialog");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});

afterEach(() => {
  cleanupWidgets();
  vi.useRealTimers();
});

describe("till-floor-screen's guest count and re-read", () => {
  it("leaves the seat dialog's placeholder empty for today's seats or a merge", async () => {
    const el = await mount({
      tables: [planned("t1", { seats: 6 }), planned("t2", { joinId: "j1", joinSeats: 10 })],
    });

    await tapMap(el, "t1");
    await seatDialog(el)!.updateComplete;
    const field6 = seatDialog(el)!.shadowRoot!.querySelector("wt-input")!;
    await field6.updateComplete;
    expect(field6.shadowRoot!.querySelector<HTMLInputElement>("input")!.placeholder).toBe("");
    seatDialog(el)!.dispatchEvent(
      new CustomEvent("seat-cancel", { bubbles: true, composed: true }),
    );
    await el.updateComplete;

    await tapMap(el, "t2");
    await seatDialog(el)!.updateComplete;
    const field10 = seatDialog(el)!.shadowRoot!.querySelector("wt-input")!;
    await field10.updateComplete;
    expect(field10.shadowRoot!.querySelector<HTMLInputElement>("input")!.placeholder).toBe("");
    seatDialog(el)!.dispatchEvent(
      new CustomEvent("seat-cancel", { bubbles: true, composed: true }),
    );
    await el.updateComplete;
  });

  it("asks for the floor every 15 s while a planned zone's map shows", async () => {
    const el = await mount();
    const seen = countRefreshes(el);

    vi.advanceTimersByTime(14_999);
    expect(seen.count).toBe(0);
    vi.advanceTimersByTime(1);
    expect(seen.count).toBe(1);
    vi.advanceTimersByTime(15_000);
    expect(seen.count).toBe(2);
  });

  it("polls an empty map with no today's rows after the view is chosen", async () => {
    const el = await mount({ tables: [table()] });
    const seen = countRefreshes(el);
    await toggleFloorView(el);
    vi.advanceTimersByTime(15_000);
    expect(seen.count).toBe(1);
  });

  it("marks the 15-second ask as a poll", async () => {
    const el = await mount();
    const details: unknown[] = [];
    el.addEventListener("floor-refresh", (event) => details.push((event as CustomEvent).detail));

    vi.advanceTimersByTime(15_000);
    expect(details).toEqual([{ poll: true }]);
  });

  it("does not ask while the list shows", async () => {
    const el = await mount();
    const seen = countRefreshes(el);

    await toggleFloorView(el);
    expect(el.shadowRoot!.querySelector("wt-floor-map")).toBeNull();
    vi.advanceTimersByTime(30_000);
    expect(seen.count).toBe(0);
  });

  it("a redraw while the map stays up keeps the running interval", async () => {
    const el = await mount();
    const seen = countRefreshes(el);

    vi.advanceTimersByTime(10_000);
    el.tables = [planned("t1", { seats: 6 })];
    await el.updateComplete;
    vi.advanceTimersByTime(5_000);
    expect(seen.count).toBe(1);
  });

  it("starts again when the map comes back, and stops when the screen leaves", async () => {
    const el = await mount();
    const seen = countRefreshes(el);

    await toggleFloorView(el);
    await toggleFloorView(el);
    vi.advanceTimersByTime(15_000);
    expect(seen.count).toBe(1);

    const host = el.parentElement!;
    el.remove();
    vi.advanceTimersByTime(30_000);
    expect(seen.count).toBe(1);

    host.appendChild(el);
    vi.advanceTimersByTime(15_000);
    expect(seen.count).toBe(2);
  });

  it("an update queued before the screen is removed does not restart its re-read", async () => {
    const el = await mount();
    const seen = countRefreshes(el);
    el.tables = [planned("t1", { seats: 6 })];
    el.remove();
    await el.updateComplete;
    vi.advanceTimersByTime(30_000);
    expect(seen.count).toBe(0);
  });
});

describe("hierarchy deletion snapshots", () => {
  it("removes the deleted zone tab and draws the first surviving zone", async () => {
    const el = await mount({
      zones: [zone(), zone({ id: "z2", name: "Terrace", displayOrder: 1 })],
      tables: [
        planned("t1"),
        table({ id: "t2", zoneId: "z2", label: "Surviving table", today: today() }),
      ],
    });
    await click(el, '[data-zone="z1"]');
    el.zones = [zone({ id: "z2", name: "Terrace", displayOrder: 1 })];
    el.tables = [table({ id: "t2", zoneId: "z2", label: "Surviving table", today: today() })];
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('[data-zone="z1"]')).toBeNull();
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { fitKey: string }>("wt-floor-map")!.fitKey,
    ).toBe("z2");
    const opens: unknown[] = [];
    el.addEventListener("open-table", (event) => opens.push((event as CustomEvent).detail));
    el.shadowRoot!.querySelector("wt-floor-map")!.dispatchEvent(
      new CustomEvent("wt-table-tap", { detail: { tableId: "t1" }, bubbles: true, composed: true }),
    );
    expect(opens).toEqual([]);
  });

  it("closes seating for a deleted table and refuses its retained confirmation", async () => {
    const el = await mount();
    await tapMap(el, "t1");
    const removedDialog = seatDialog(el)!;
    await removedDialog.updateComplete;
    const opens: unknown[] = [];
    el.addEventListener("open-table", (event) => opens.push((event as CustomEvent).detail));
    el.tables = [];
    await el.updateComplete;
    expect(seatDialog(el)).toBeNull();
    removedDialog.dispatchEvent(
      new CustomEvent("seat-confirm", {
        detail: { guestCount: 2 },
        bubbles: true,
        composed: true,
      }),
    );
    expect(opens).toEqual([]);
  });

  it("keeps seating for an unaffected table after another zone is deleted", async () => {
    const el = await mount({ zones: [zone(), zone({ id: "z2" })] });
    await tapMap(el, "t1");
    el.zones = [zone()];
    el.tables = [planned("t1")];
    await el.updateComplete;
    expect(seatDialog(el)).not.toBeNull();
    const opens: unknown[] = [];
    el.addEventListener("open-table", (event) => opens.push((event as CustomEvent).detail));
    seatDialog(el)!.dispatchEvent(
      new CustomEvent("seat-confirm", {
        detail: { guestCount: 2 },
        bubbles: true,
        composed: true,
      }),
    );
    expect(opens).toEqual([{ tableId: "t1", seated: false, guestCount: 2 }]);
  });
});

it("refuses a retained table card after the table is removed", async () => {
  const el = await mount();
  await toggleFloorView(el);
  const card = el.shadowRoot!.querySelector<HTMLElement>('[data-table="t1"]')!;
  el.tables = [];
  await el.updateComplete;
  card.click();
  await el.updateComplete;
  expect(seatDialog(el)).toBeNull();
});

it("closes clearing for a removed table and refuses its retained action", async () => {
  const el = await mount({ tables: [table({ today: today(), condition: "needs_clearing" })] });
  await tapMap(el, "t1");
  const action = el.shadowRoot!.querySelector<HTMLElement>(
    "[data-clear-dialog] [data-mark-cleared]",
  )!;
  expect(action).not.toBeNull();
  const clears: unknown[] = [];
  el.addEventListener("mark-cleared", (event) => clears.push((event as CustomEvent).detail));
  el.tables = [];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-clear-dialog]")).toBeNull();
  action.click();
  expect(clears).toEqual([]);
});

it("refuses a retained occupied table card after its table is removed", async () => {
  const el = await mount({ tables: [table({ hasOpenTab: true })] });
  const card = el.shadowRoot!.querySelector<HTMLElement>('[data-table="t1"]')!;
  expect(card).not.toBeNull();
  const opens: unknown[] = [];
  el.addEventListener("open-table", (event) => opens.push((event as CustomEvent).detail));
  el.tables = [];
  await el.updateComplete;
  card.click();
  expect(opens).toEqual([]);
});

it("keeps clearing an unaffected table after another zone is deleted", async () => {
  const el = await mount({
    zones: [zone(), zone({ id: "z2" })],
    tables: [table({ today: today(), condition: "needs_clearing" })],
  });
  await tapMap(el, "t1");
  el.zones = [zone()];
  await el.updateComplete;
  const clears: unknown[] = [];
  el.addEventListener("mark-cleared", (event) => clears.push((event as CustomEvent).detail));
  await click(el, "[data-clear-dialog] [data-mark-cleared]");
  expect(clears).toEqual([{ tableId: "t1" }]);
});

it("opens an unaffected occupied table after another zone is deleted", async () => {
  const el = await mount({
    zones: [zone(), zone({ id: "z2" })],
    tables: [table({ hasOpenTab: true })],
  });
  el.zones = [zone()];
  await el.updateComplete;
  const opens: unknown[] = [];
  el.addEventListener("open-table", (event) => opens.push((event as CustomEvent).detail));
  await click(el, '[data-table="t1"]');
  expect(opens).toEqual([{ tableId: "t1", seated: true }]);
});
