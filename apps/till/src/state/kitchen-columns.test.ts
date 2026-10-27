import { describe, expect, it, vi } from "vitest";
import {
  moveColumn,
  readColumnState,
  saveColumnState,
  setColumnVisible,
  STATION_COLUMNS,
  toggleColumnCollapsed,
  type ColumnScope,
  type ColumnState,
} from "./kitchen-columns.js";

const scope: ColumnScope = {
  venueId: "https://box.local",
  deviceId: "dev-1",
  screen: "station",
  stationId: "st-1",
};
const st1Key = 'waitron.kitchenColumns.v1.["https://box.local","dev-1","station","st-1"]';

function fakeStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

const readyCollapsed: ColumnState = {
  order: ["waiting", "preparing", "ready"],
  hidden: [],
  collapsed: ["ready"],
};

function deepFreeze(state: ColumnState): ColumnState {
  Object.freeze(state.order);
  Object.freeze(state.hidden);
  Object.freeze(state.collapsed);
  return Object.freeze(state);
}

describe("A773 columns state: the device's kitchen columns", () => {
  it("reads the defaults when nothing is stored", () => {
    const storage = fakeStorage();
    const state = readColumnState(storage, scope, STATION_COLUMNS);
    expect(state).toEqual({
      order: ["overview", "waiting", "preparing", "ready"],
      hidden: [],
      collapsed: [],
    });
    expect(state).toEqual(STATION_COLUMNS);
    expect(state).not.toBe(STATION_COLUMNS);
    expect(state.order).not.toBe(STATION_COLUMNS.order);
    expect(storage.getItem).toHaveBeenCalledWith(st1Key);
  });

  it("keeps a saved layout for its venue, device, screen and station only", () => {
    const storage = fakeStorage();
    const saved: ColumnState = {
      ...readyCollapsed,
      order: ["overview", "waiting", "preparing", "ready"],
    };
    saveColumnState(storage, scope, saved);
    expect(readColumnState(storage, scope, STATION_COLUMNS)).toEqual(saved);
    for (const other of [
      { ...scope, venueId: "https://other.local" },
      { ...scope, deviceId: "dev-2" },
      { ...scope, screen: "pass" as const },
      { ...scope, stationId: "st-2" },
    ]) {
      expect(readColumnState(storage, other, STATION_COLUMNS)).toEqual(STATION_COLUMNS);
    }

    saveColumnState(
      storage,
      { venueId: scope.venueId, deviceId: scope.deviceId, screen: scope.screen },
      saved,
    );
    expect(readColumnState(storage, { ...scope, stationId: "" }, STATION_COLUMNS)).toEqual(saved);
  });

  it("stores under the versioned key, as JSON", () => {
    const storage = fakeStorage();
    saveColumnState(storage, scope, readyCollapsed);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    const [key, value] = storage.setItem.mock.calls[0]!;
    expect(key).toBe(st1Key);
    expect(JSON.parse(value)).toEqual({
      version: 1,
      order: ["waiting", "preparing", "ready"],
      hidden: [],
      collapsed: ["ready"],
    });
  });

  it("never reads or writes without a venue and a device", () => {
    for (const missing of [
      { ...scope, venueId: "" },
      { ...scope, deviceId: "" },
    ]) {
      const storage = fakeStorage();
      expect(readColumnState(storage, missing, STATION_COLUMNS)).toEqual(STATION_COLUMNS);
      saveColumnState(storage, missing, readyCollapsed);
      expect(storage.getItem).not.toHaveBeenCalled();
      expect(storage.setItem).not.toHaveBeenCalled();
    }
  });

  it.each([
    "not json",
    "null",
    "[]",
    JSON.stringify({ version: 2, order: ["ready"], hidden: [], collapsed: ["ready"] }),
    JSON.stringify({ version: 1, order: "ready", hidden: [], collapsed: [] }),
    JSON.stringify({ version: 1, order: [1], hidden: [], collapsed: [] }),
    JSON.stringify({ version: 1, order: ["ready"], hidden: [] }),
  ])("reads the defaults for a value it cannot trust (%s)", (raw) => {
    const storage = fakeStorage();
    storage.values.set(st1Key, raw);
    const state = readColumnState(storage, scope, STATION_COLUMNS);
    expect(state).toEqual(STATION_COLUMNS);
    expect(state).not.toBe(STATION_COLUMNS);
  });

  it("drops unknown and repeated keys, and puts back a missing one at its default place", () => {
    const storage = fakeStorage();
    storage.values.set(
      st1Key,
      JSON.stringify({
        version: 1,
        order: ["ready", "waiting", "ready", "toFire"],
        hidden: ["ready", "held", "ready"],
        collapsed: ["waiting", "nonsense"],
      }),
    );
    const defaults: ColumnState = {
      order: ["overview", "waiting", "preparing", "ready"],
      hidden: [],
      collapsed: [],
    };
    expect(readColumnState(storage, scope, defaults)).toEqual({
      order: ["overview", "ready", "waiting", "preparing"],
      hidden: ["ready"],
      collapsed: ["waiting"],
    });
  });

  it("a store that throws reads the defaults and saves nothing, without throwing", () => {
    const refusing = {
      getItem: vi.fn((): string | null => {
        throw new Error("storage blocked");
      }),
      setItem: vi.fn(() => {
        throw new Error("storage full");
      }),
    };
    expect(readColumnState(refusing, scope, STATION_COLUMNS)).toEqual(STATION_COLUMNS);
    expect(() => saveColumnState(refusing, scope, readyCollapsed)).not.toThrow();
    expect(refusing.getItem).toHaveBeenCalledTimes(1);
    expect(refusing.setItem).toHaveBeenCalledTimes(1);
  });

  it("moves a column one place up or down, never past either end", () => {
    const state = deepFreeze({
      order: ["waiting", "preparing", "ready"],
      hidden: ["ready"],
      collapsed: ["waiting"],
    });
    expect(moveColumn(state, "preparing", "up")).toEqual({
      order: ["preparing", "waiting", "ready"],
      hidden: ["ready"],
      collapsed: ["waiting"],
    });
    expect(moveColumn(state, "preparing", "down")).toEqual({
      order: ["waiting", "ready", "preparing"],
      hidden: ["ready"],
      collapsed: ["waiting"],
    });
    expect(moveColumn(state, "waiting", "up")).toEqual(state);
    expect(moveColumn(state, "ready", "down")).toEqual(state);
    expect(moveColumn(state, "held", "up")).toEqual(state);
    expect(state.order).toEqual(["waiting", "preparing", "ready"]);
  });

  it("collapses a column and opens it again", () => {
    const state = deepFreeze({
      order: ["waiting", "preparing", "ready"],
      hidden: ["preparing"],
      collapsed: [],
    });
    const collapsed = toggleColumnCollapsed(state, "ready");
    expect(collapsed).toEqual({
      order: ["waiting", "preparing", "ready"],
      hidden: ["preparing"],
      collapsed: ["ready"],
    });
    expect(toggleColumnCollapsed(deepFreeze(collapsed), "ready")).toEqual(state);
    expect(state.collapsed).toEqual([]);
  });

  it("hides a column and shows it again", () => {
    const state = deepFreeze({
      order: ["waiting", "preparing", "ready"],
      hidden: [],
      collapsed: ["ready"],
    });
    const hidden = setColumnVisible(state, "preparing", false);
    expect(hidden).toEqual({
      order: ["waiting", "preparing", "ready"],
      hidden: ["preparing"],
      collapsed: ["ready"],
    });
    expect(setColumnVisible(deepFreeze(hidden), "preparing", false).hidden).toEqual(["preparing"]);
    expect(setColumnVisible(hidden, "preparing", true)).toEqual(state);
    expect(state.hidden).toEqual([]);
  });

  it("puts back several missing columns each after the one before it", () => {
    const storage = fakeStorage();
    storage.values.set(
      st1Key,
      JSON.stringify({
        version: 1,
        order: ["ready", "waiting", "preparing"],
        hidden: [],
        collapsed: [],
      }),
    );
    const defaults: ColumnState = {
      order: ["overview", "held", "waiting", "preparing", "ready"],
      hidden: [],
      collapsed: [],
    };
    expect(readColumnState(storage, scope, defaults).order).toEqual([
      "overview",
      "held",
      "ready",
      "waiting",
      "preparing",
    ]);
  });

  it("a column put back takes its default hidden and collapsed; a stored one keeps its own", () => {
    const storage = fakeStorage();
    storage.values.set(
      st1Key,
      JSON.stringify({ version: 1, order: ["held", "waiting"], hidden: [], collapsed: [] }),
    );
    const hiddenOverview = readColumnState(storage, scope, {
      order: ["overview", "held", "waiting"],
      hidden: ["overview"],
      collapsed: [],
    });
    expect(hiddenOverview).toEqual({
      order: ["overview", "held", "waiting"],
      hidden: ["overview"],
      collapsed: [],
    });

    const keepsOpen = readColumnState(storage, scope, {
      order: ["overview", "held", "waiting"],
      hidden: [],
      collapsed: ["overview", "waiting"],
    });
    expect(keepsOpen.collapsed).toEqual(["overview"]);
  });

  it("a column put back ignores its stored hidden and collapsed when its defaults hold neither", () => {
    const storage = fakeStorage();
    storage.values.set(
      st1Key,
      JSON.stringify({
        version: 1,
        order: ["waiting", "preparing"],
        hidden: ["ready"],
        collapsed: ["ready"],
      }),
    );
    expect(readColumnState(storage, scope, STATION_COLUMNS)).toEqual(STATION_COLUMNS);
  });

  it("a column put back is hidden and collapsed once each when its defaults hold it and so does the store", () => {
    const storage = fakeStorage();
    storage.values.set(
      st1Key,
      JSON.stringify({
        version: 1,
        order: ["waiting", "preparing"],
        hidden: ["ready", "waiting"],
        collapsed: ["preparing", "ready"],
      }),
    );
    const defaults: ColumnState = {
      order: ["waiting", "preparing", "ready"],
      hidden: ["ready"],
      collapsed: ["ready"],
    };
    expect(readColumnState(storage, scope, defaults)).toEqual({
      order: ["waiting", "preparing", "ready"],
      hidden: ["waiting", "ready"],
      collapsed: ["preparing", "ready"],
    });
  });
});
