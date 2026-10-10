import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
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
    ...over,
  };
}

function table(over: Partial<TableState> = {}): TableState {
  return {
    id: "t1",
    label: "1",
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
    ...over,
  };
}

function planned(id: string, over: Partial<TableToday> = {}): TableState {
  return table({ id, label: id.slice(1), today: today(over) });
}

/** A table on the old canvas, in a zone with no plan. */
function oldPlaced(id: string): TableState {
  return table({
    id,
    label: id.slice(1),
    zoneId: "z2",
    posX: 250,
    posY: 400,
    shape: "round",
    rotation: 0,
  });
}

const twoZones = [zone(), zone({ id: "z2", name: "Terraza", displayOrder: 1 })];

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

async function selectZone(el: TillFloorScreen, zoneId: string): Promise<void> {
  await click(el, `[data-zone="${zoneId}"]`);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});

afterEach(() => {
  cleanupWidgets();
  vi.useRealTimers();
});

describe("till-floor-screen's seats placeholder and re-read", () => {
  it("gives the seat dialog today's seats, a merge's, or the old capacity", async () => {
    const el = await mount({
      zones: twoZones,
      tables: [
        planned("t1", { seats: 6 }),
        planned("t2", { joinId: "j1", joinSeats: 10 }),
        oldPlaced("t3"),
      ],
    });

    await tapMap(el, "t1");
    expect(seatDialog(el)!.seats).toBe(6);
    seatDialog(el)!.dispatchEvent(
      new CustomEvent("seat-cancel", { bubbles: true, composed: true }),
    );
    await el.updateComplete;

    await tapMap(el, "t2");
    expect(seatDialog(el)!.seats).toBe(10);
    seatDialog(el)!.dispatchEvent(
      new CustomEvent("seat-cancel", { bubbles: true, composed: true }),
    );
    await el.updateComplete;

    await selectZone(el, "z2");
    el.shadowRoot!.querySelector("wt-floor-canvas")!.dispatchEvent(
      new CustomEvent("wt-open-table", {
        detail: { tableId: "t3" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    expect(seatDialog(el)!.seats).toBe(4);
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

  it("marks the 15-second ask as a poll", async () => {
    const el = await mount();
    const details: unknown[] = [];
    el.addEventListener("floor-refresh", (event) => details.push((event as CustomEvent).detail));

    vi.advanceTimersByTime(15_000);
    expect(details).toEqual([{ poll: true }]);
  });

  it("does not ask while the list shows, or for the old map", async () => {
    const el = await mount({ zones: twoZones, tables: [planned("t1"), oldPlaced("t3")] });
    const seen = countRefreshes(el);

    await click(el, "[data-view-toggle]");
    expect(el.shadowRoot!.querySelector("wt-floor-map")).toBeNull();
    vi.advanceTimersByTime(30_000);
    expect(seen.count).toBe(0);

    await click(el, "[data-view-toggle]");
    await selectZone(el, "z2");
    expect(el.shadowRoot!.querySelector("wt-floor-canvas")).not.toBeNull();
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

    await click(el, "[data-view-toggle]");
    await click(el, "[data-view-toggle]");
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
