import { describe, expect, it, vi } from "vitest";
import { KitchenColumnLayouts } from "./kitchen-column-layouts.js";
import {
  type ColumnScope,
  STATION_COLUMNS,
  readColumnState,
  saveColumnState,
} from "./kitchen-columns.js";

const scope: ColumnScope = {
  venueId: "https://box.local",
  deviceId: "dev-1",
  screen: "station",
  stationId: "st-1",
};

function fakeStorage(): Storage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

/** Reads what was saved without counting as the helper's own read. */
function saved(storage: { values: Map<string, string> }) {
  return readColumnState(
    { getItem: (key) => storage.values.get(key) ?? null },
    scope,
    STATION_COLUMNS,
  );
}

function moveEvent(key: string, direction: "up" | "down"): CustomEvent {
  return new CustomEvent("column-move", { detail: { key, direction } });
}

function showEvent(key: string, visible: boolean): CustomEvent {
  return new CustomEvent("column-show", { detail: { key, visible } });
}

describe("A773 column layouts", () => {
  it("reads a scope's layout from storage once and saves a kept layout", () => {
    const storage = fakeStorage();
    saveColumnState(storage, scope, { ...STATION_COLUMNS, collapsed: ["held"] });
    vi.mocked(storage.setItem).mockClear();
    const layouts = new KitchenColumnLayouts(STATION_COLUMNS, () => storage);
    expect(layouts.get(scope, "st-1").collapsed).toEqual(["held"]);
    layouts.get(scope, "st-1");
    expect(storage.getItem).toHaveBeenCalledTimes(1);

    layouts.applyMove(scope, "st-1", moveEvent("preparing", "up"));
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    const moved = saved(storage);
    expect(moved.order.indexOf("preparing")).toBe(STATION_COLUMNS.order.indexOf("preparing") - 1);
    expect(layouts.get(scope, "st-1")).toEqual(moved);

    layouts.applyShow(scope, "st-1", showEvent("ready", false));
    expect(saved(storage).hidden).toContain("ready");
    expect(layouts.get(scope, "st-1").hidden).toContain("ready");
    expect(storage.getItem).toHaveBeenCalledTimes(1);
  });

  it("keeps a layout in memory per board when there is no scope, storing nothing", () => {
    const storage = fakeStorage();
    const layouts = new KitchenColumnLayouts(STATION_COLUMNS, () => storage);
    layouts.applyShow(null, "st-1", showEvent("ready", false));
    expect(layouts.get(null, "st-1").hidden).toContain("ready");
    expect(layouts.get(null, "st-2").hidden).not.toContain("ready");
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.values.size).toBe(0);
  });

  it("keeps a layout in memory when the browser refuses storage", () => {
    const layouts = new KitchenColumnLayouts(STATION_COLUMNS, () => {
      throw new DOMException("refused", "SecurityError");
    });
    expect(layouts.get(scope, "st-1")).toEqual(STATION_COLUMNS);
    layouts.keep(scope, "st-1", { ...STATION_COLUMNS, hidden: ["ready"] });
    expect(layouts.get(scope, "st-1").hidden).toEqual(["ready"]);
  });
});
