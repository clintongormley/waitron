import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget, toggleFloorView } from "../widgets/test-helpers.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import "./till-floor-screen.js";
import type { FloorZone, TableState } from "../api/client.js";
import type { FloorView, FloorViewChoices } from "../state/floor-view-memory.js";

function zone(id: string, name: string): FloorZone {
  return {
    id,
    name,
    displayOrder: 0,
    active: true,
    closesAt: null,
    closed: false,
    hasPlan: id === "z1",
    layoutSetName: null,
    layoutDue: null,
    serviceMode: "table_tab",
  };
}

function table(id: string, zoneId: string, placed: boolean): TableState {
  return {
    id,
    label: id.slice(1),
    shortName: id.slice(1),
    zoneId,
    state: "free",
    condition: "free",
    hasOpenTab: false,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: placed
      ? {
          placement: { x: 2, y: 3, width: 8, height: 8, shape: "rect", rotation: 0 },
          seats: 4,
          fixed: false,
          takenOff: false,
          joinId: null,
          joinSeats: null,
          inJoinedTable: null,
          joined: null,
          splitOffFrom: null,
          zoneRevision: 0,
        }
      : null,
    signals: [],
    party: null,
  };
}

// z1 has a table on the map, so it defaults to Map; z2 has none, so it defaults to List.
const zones = [zone("z1", "Terrace"), zone("z2", "Bar")];
const tables = [table("t1", "z1", true), table("t5", "z2", false)];

function memory(stored: Record<string, FloorView> = {}) {
  return {
    read: vi.fn<FloorViewChoices["read"]>((zoneId) => stored[zoneId]),
    remember: vi.fn<FloorViewChoices["remember"]>(),
  };
}

async function mount(props: Record<string, unknown> = {}): Promise<TillFloorScreen> {
  const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    zones,
    tables,
    ...props,
  });
  return el;
}

async function showZone(el: TillFloorScreen, zoneId: string): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>(`.tabs [data-zone="${zoneId}"]`)!.click();
  await el.updateComplete;
}

const viewOf = (el: TillFloorScreen): FloorView =>
  el.shadowRoot!.querySelector("wt-floor-map") === null ? "list" : "map";

afterEach(cleanupWidgets);

describe("till-floor-screen: List or Map for each zone", () => {
  it("a tap on one zone leaves the other zone's view alone", async () => {
    const el = await mount();
    await showZone(el, "z1");
    expect(viewOf(el)).toBe("map");
    await toggleFloorView(el);
    expect(viewOf(el)).toBe("list");

    await showZone(el, "z2");
    expect(viewOf(el)).toBe("list");
    await toggleFloorView(el);
    expect(viewOf(el)).toBe("map");

    await showZone(el, "z1");
    expect(viewOf(el)).toBe("list");
  });

  it("opens each zone in the view this device remembered", async () => {
    const viewMemory = memory({ z1: "list" });
    const el = await mount({ viewMemory });
    await showZone(el, "z1");
    expect(viewOf(el)).toBe("list");
    await showZone(el, "z2");
    expect(viewOf(el)).toBe("list");
  });

  it("a tap tells the device's memory", async () => {
    const viewMemory = memory();
    const el = await mount({ viewMemory });
    await showZone(el, "z1");
    await toggleFloorView(el);
    expect(viewMemory.remember).toHaveBeenCalledTimes(1);
    expect(viewMemory.remember).toHaveBeenCalledWith("z1", "list");
  });

  it("a tap this session wins over the memory", async () => {
    const viewMemory = memory({ z1: "list" });
    const el = await mount({ viewMemory });
    await showZone(el, "z1");
    expect(viewOf(el)).toBe("list");
    await toggleFloorView(el);
    expect(viewOf(el)).toBe("map");
  });

  it("a floor with no zones toggles without remembering", async () => {
    const viewMemory = memory();
    const el = await mount({ zones: [], tables: [], viewMemory });
    const before = viewOf(el);
    await toggleFloorView(el);
    expect(viewOf(el)).not.toBe(before);
    expect(viewMemory.remember).not.toHaveBeenCalled();
  });
});
