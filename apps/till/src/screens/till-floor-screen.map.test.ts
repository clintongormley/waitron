import { afterEach, describe, expect, it, vi } from "vitest";
import type { WtFloorMap } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { mapTables } from "../state/floor-map.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import "./till-floor-screen.js";
import type { FloorZone, TableState, TableToday, TillApi } from "../api/client.js";

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

function placed(id: string, over: Partial<TableState> = {}): TableState {
  return table({
    id,
    label: id.slice(1),
    posX: 250,
    posY: 400,
    shape: "round",
    rotation: 0,
    ...over,
  });
}

/** A table on today's plan, placed at grid square (2, 3). */
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

function planned(id: string, over: Partial<TableState> = {}): TableState {
  return table({ id, label: id.slice(1), today: today(), ...over });
}

const seated = { state: "open-tab" as const, condition: "held" as const, hasOpenTab: true };

const mount = (over: Partial<TillFloorScreen> = {}) =>
  mountWidget<TillFloorScreen>("till-floor-screen", {
    zones: [zone()],
    tables: [planned("t1")],
    ...over,
  }).then(({ el }) => el);

function mapOf(el: TillFloorScreen): WtFloorMap {
  return el.shadowRoot!.querySelector<WtFloorMap>("wt-floor-map")!;
}

async function tap(el: TillFloorScreen, tableId: string): Promise<void> {
  mapOf(el).dispatchEvent(
    new CustomEvent("wt-table-tap", { detail: { tableId }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

function captureOpenTable(el: TillFloorScreen): { detail?: unknown } {
  const seen: { detail?: unknown } = {};
  el.addEventListener("open-table", (event) => {
    seen.detail = (event as CustomEvent).detail;
  });
  return seen;
}

async function click(el: TillFloorScreen, selector: string): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe("till-floor-screen on the new map", () => {
  it("draws a planned zone on the new map, not the old canvas", async () => {
    const t1 = planned("t1");
    const el = await mount({ tables: [t1] });
    const map = mapOf(el);
    expect(map).not.toBeNull();
    expect(el.shadowRoot!.querySelector("wt-floor-canvas")).toBeNull();
    expect(map.tables).toEqual(mapTables([t1]));
    expect(map.fitKey).toBe("z1");
    expect(map.copy.label).toBe("Tables");
  });

  it("hands the map the screen's reduced-motion setting, unset by default", async () => {
    expect(mapOf(await mount()).reducedMotion).toBeUndefined();
    cleanupWidgets();
    const el = await mount({ reducedMotion: true });
    expect(mapOf(el).reducedMotion).toBe(true);
    el.reducedMotion = false;
    await el.updateComplete;
    expect(mapOf(el).reducedMotion).toBe(false);
  });

  it("keeps the old canvas for a zone with no today's rows", async () => {
    const el = await mount({ tables: [placed("t1")] });
    expect(el.shadowRoot!.querySelector("wt-floor-canvas")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("wt-floor-map")).toBeNull();
  });

  it("a tap on a free table asks for its guests, and goes no further", async () => {
    const el = await mount();
    const outside = vi.fn();
    el.addEventListener("wt-table-tap", outside);
    await tap(el, "t1");
    const dialog = el.shadowRoot!.querySelector<HTMLElement & { tableLabel: string }>(
      "till-seat-dialog",
    );
    expect(dialog?.tableLabel).toBe("1");
    expect(outside).not.toHaveBeenCalled();
  });

  it("a tap on a seated table opens its order", async () => {
    const el = await mount({ tables: [planned("t1", seated)] });
    const seen = captureOpenTable(el);
    await tap(el, "t1");
    expect(seen.detail).toEqual({ tableId: "t1", seated: true });
  });

  it("a tap on a table needing clearing offers Mark cleared", async () => {
    const el = await mount({ tables: [planned("t1", { condition: "needs_clearing" })] });
    await tap(el, "t1");
    expect(el.shadowRoot!.querySelector("[data-clear-dialog]")).not.toBeNull();
  });

  it("a closed zone refuses the map's free table", async () => {
    const el = await mount({ zones: [zone({ closed: true })] });
    await tap(el, "t1");
    expect(el.shadowRoot!.querySelector("till-seat-dialog")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-zone-closed]")).not.toBeNull();
  });

  it("a tap naming a table the floor no longer has does nothing", async () => {
    const el = await mount();
    const seen = captureOpenTable(el);
    await tap(el, "gone");
    expect(el.shadowRoot!.querySelector("till-seat-dialog")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-clear-dialog]")).toBeNull();
    expect(seen.detail).toBeUndefined();
  });

  it("leaves taken-off tables and free spares out of the map and the list", async () => {
    const el = await mount({
      tables: [
        planned("t1"),
        planned("t2", { today: today({ placement: null }) }),
        planned("t3", { today: today({ placement: null, takenOff: true }) }),
      ],
    });
    expect(mapOf(el).tables.map((t) => t.id)).toEqual(["t1"]);
    expect(el.shadowRoot!.querySelector("[data-tray-table]")).toBeNull();
    await click(el, "[data-view-toggle]");
    const listed = [...el.shadowRoot!.querySelectorAll("[data-table]")].map((card) =>
      card.getAttribute("data-table"),
    );
    expect(listed).toEqual(["t1"]);
  });

  it("puts a seated table with no place under the map, and in the list", async () => {
    const el = await mount({
      tables: [planned("t1"), planned("t4", { ...seated, today: today({ placement: null }) })],
    });
    expect(mapOf(el).tables.map((t) => t.id)).toEqual(["t1"]);
    expect(el.shadowRoot!.querySelector("[data-tray-table=t4]")).not.toBeNull();
    await click(el, "[data-view-toggle]");
    expect(el.shadowRoot!.querySelector("[data-table=t4]")).not.toBeNull();
  });

  it("keeps a held taken-off table reachable under the map and in the list", async () => {
    const el = await mount({
      tables: [planned("t1"), planned("t5", { ...seated, today: today({ takenOff: true }) })],
    });
    expect(mapOf(el).tables.map((t) => t.id)).toEqual(["t1"]);
    expect(el.shadowRoot!.querySelector("[data-tray-table=t5]")).not.toBeNull();
    await click(el, "[data-view-toggle]");
    expect(el.shadowRoot!.querySelector("[data-table=t5]")).not.toBeNull();
  });

  it("lists a never-planned table of a planned zone", async () => {
    const el = await mount({ tables: [planned("t1"), table({ id: "t7", label: "7" })] });
    expect(el.shadowRoot!.querySelector("[data-tray-table=t7]")).not.toBeNull();
    await click(el, "[data-view-toggle]");
    expect(el.shadowRoot!.querySelector("[data-table=t7]")).not.toBeNull();
  });

  it("shows today's seats on a planned table's card", async () => {
    const el = await mount({ tables: [planned("t1", { today: today({ seats: 6 }) })] });
    await click(el, "[data-view-toggle]");
    expect(el.shadowRoot!.querySelector("[data-table=t1] .capacity")?.textContent?.trim()).toBe(
      "6 pax",
    );
  });

  it("shows today's seats on a planned card needing clearing", async () => {
    const el = await mount({
      tables: [planned("t1", { condition: "needs_clearing", today: today({ seats: 6 }) })],
    });
    await click(el, "[data-view-toggle]");
    expect(el.shadowRoot!.querySelector("[data-table=t1] .capacity")?.textContent?.trim()).toBe(
      "6 pax",
    );
  });

  it("hides Edit plan while a planned zone shows", async () => {
    const el = await mount({
      canEdit: true,
      zones: [zone(), zone({ id: "z2", name: "Terraza", displayOrder: 1 })],
      tables: [planned("t1"), placed("t2", { zoneId: "z2" })],
    });
    expect(el.shadowRoot!.querySelector("[data-edit-toggle]")).toBeNull();
    await click(el, '[data-zone="z2"]');
    expect(el.shadowRoot!.querySelector("[data-edit-toggle]")).not.toBeNull();
  });

  it("an Edit plan left on in another zone does not place a planned zone's tray table", async () => {
    const setTablePlacement = vi.fn().mockResolvedValue(undefined);
    const api = { setTablePlacement } as unknown as TillApi;
    const el = await mount({
      canEdit: true,
      api,
      zones: [zone(), zone({ id: "z2", name: "Terraza", displayOrder: 1 })],
      tables: [
        planned("t1"),
        planned("t4", { ...seated, today: today({ placement: null }) }),
        placed("t2", { zoneId: "z2" }),
      ],
    });
    await click(el, '[data-zone="z2"]');
    await click(el, "[data-edit-toggle]");
    await click(el, '[data-zone="z1"]');
    const seen = captureOpenTable(el);
    await click(el, "[data-tray-table=t4]");
    expect(seen.detail).toEqual({ tableId: "t4", seated: true });
    expect(setTablePlacement).not.toHaveBeenCalled();
  });

  it("gives the map the active zone as its fitKey", async () => {
    const el = await mount({
      zones: [zone(), zone({ id: "z2", name: "Terraza", displayOrder: 1 })],
      tables: [planned("t1"), planned("t2", { zoneId: "z2" })],
    });
    await click(el, '[data-zone="z2"]');
    expect(mapOf(el).fitKey).toBe("z2");
    expect(mapOf(el).tables.map((t) => t.id)).toEqual(["t2"]);
  });

  it("gives the no-zone tab's map an empty fitKey", async () => {
    const el = await mount({ zones: [], tables: [planned("t1", { zoneId: null })] });
    expect(mapOf(el).fitKey).toBe("");
  });

  it("fits a newly chosen zone to its own tables", async () => {
    const far = today({
      placement: { x: 80, y: 60, width: 2, height: 2, shape: "round", rotation: 0 },
    });
    const el = await mount({
      zones: [zone(), zone({ id: "z2", name: "Terraza", displayOrder: 1 })],
      tables: [planned("t1"), planned("t2", { zoneId: "z2", today: far })],
    });
    const map = mapOf(el);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    await map.updateComplete;
    await click(el, '[data-zone="z2"]');
    expect(mapOf(el)).toBe(map);
    // Long enough for a second update to land, so a fit run one update early shows as misplaced.
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    await el.updateComplete;
    await map.updateComplete;
    const box = map.getBoundingClientRect();
    const drawn = map.shadowRoot!.querySelector<HTMLElement>('[data-table-id="t2"]')!;
    const rect = drawn.getBoundingClientRect();
    const centre = (r: DOMRect) => [r.left + r.width / 2, r.top + r.height / 2];
    const [cx, cy] = centre(rect);
    const [bx, by] = centre(box);
    expect(Math.abs(cx! - bx!)).toBeLessThan(1);
    expect(Math.abs(cy! - by!)).toBeLessThan(1);
  });

  it("a redraw that changes neither the tables nor the language hands the map what it had", async () => {
    const el = await mount({ tables: [planned("t1", seated)] });
    const { tables, copy } = mapOf(el);

    mapOf(el).dispatchEvent(
      new CustomEvent("wt-table-details", {
        detail: { tableId: "t1" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-table-details-sheet")).not.toBeNull();
    expect(mapOf(el).tables).toBe(tables);
    expect(mapOf(el).copy).toBe(copy);

    el.tables = [planned("t1", seated)];
    await el.updateComplete;
    expect(mapOf(el).tables).not.toBe(tables);
    expect(mapOf(el).copy).toBe(copy);

    const was = currentLocale();
    try {
      setLocale(was === "es" ? "en" : "es");
      el.requestUpdate();
      await el.updateComplete;
      expect(mapOf(el).copy).not.toBe(copy);
      expect(mapOf(el).copy).not.toEqual(copy);
    } finally {
      setLocale(was);
    }
  });

  it("opens on the list when a planned zone has nothing placed", async () => {
    const el = await mount({
      tables: [planned("t4", { ...seated, today: today({ placement: null }) })],
    });
    expect(el.shadowRoot!.querySelector("wt-floor-map")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-table=t4]")).not.toBeNull();
  });
});
