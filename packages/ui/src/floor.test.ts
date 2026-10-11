import { expect, test } from "vitest";
import {
  ROTATION_STEP,
  buildZoneTabs,
  resolveActiveTabKey,
  snapRotation,
  toFloorTable,
} from "./floor.js";

test("ROTATION_STEP is the shared snap increment", () => {
  expect(ROTATION_STEP).toBe(15);
});

test("snapRotation snaps to the nearest 15 degrees and wraps at 360", () => {
  expect(snapRotation(7)).toBe(0);
  expect(snapRotation(8)).toBe(15);
  expect(snapRotation(22)).toBe(15);
  expect(snapRotation(360)).toBe(0);
  expect(snapRotation(375)).toBe(15);
  expect(snapRotation(90)).toBe(90);
  expect(snapRotation(352)).toBe(345);
  expect(snapRotation(353)).toBe(0);
  expect(snapRotation(720)).toBe(0);
});

test("snapRotation normalizes a negative rotation into the [0, 360) contract", () => {
  expect(snapRotation(-8)).toBe(345);
  expect(snapRotation(-10)).toBe(345);
  expect(snapRotation(-7)).toBe(0);
  expect(snapRotation(-15)).toBe(345);
  expect(snapRotation(-360)).toBe(0);
});

test("buildZoneTabs orders the zone tabs by displayOrder", () => {
  const zones = [
    { id: "z2", name: "Terraza", displayOrder: 2 },
    { id: "z1", name: "Comedor", displayOrder: 1 },
  ];
  const tabs = buildZoneTabs(zones);
  expect(tabs).toEqual([
    { key: "z1", name: "Comedor" },
    { key: "z2", name: "Terraza" },
  ]);
});

test("resolveActiveTabKey falls back to the first tab when nothing is requested", () => {
  const tabs = [
    { key: "z1", name: "A" },
    { key: "z2", name: "B" },
  ];
  expect(resolveActiveTabKey(undefined, tabs)).toBe("z1");
});

test("resolveActiveTabKey returns undefined when nothing is requested and there are no tabs", () => {
  expect(resolveActiveTabKey(undefined, [])).toBeUndefined();
});

test("resolveActiveTabKey falls back to the first tab when the requested key is no longer present", () => {
  const tabs = [
    { key: "z1", name: "A" },
    { key: "z2", name: "B" },
  ];
  expect(resolveActiveTabKey("z9", tabs)).toBe("z1");
});

test("toFloorTable maps a table's seats and occupancy", () => {
  const table = toFloorTable(
    {
      id: "t1",
      label: "1",
      seats: 4,
    },
    { state: "open-tab", tabTotal: "12.50", pendingToServe: 2, status: null },
  );
  expect(table).toEqual({
    id: "t1",
    label: "1",
    seats: 4,
    state: "open-tab",
    tabTotal: "12.50",
    pendingToServe: 2,
    status: null,
    reservedTime: null,
  });
});

test("toFloorTable carries the reserved time through the occupancy half", () => {
  const table = toFloorTable(
    {
      id: "t1",
      label: "1",
      seats: 4,
    },
    {
      state: "open-tab",
      tabTotal: "12.50",
      pendingToServe: 0,
      status: null,
      reservedTime: "20:30",
    },
  );
  expect(table.reservedTime).toBe("20:30");
});

test("toFloorTable carries the party's name through the occupancy half", () => {
  const placement = {
    id: "t1",
    label: "4",
    seats: 4,
  };
  const named = toFloorTable(placement, {
    state: "open-tab",
    pendingToServe: 0,
    status: null,
    partyName: "Ana",
  });
  const free = toFloorTable(placement, { state: "free", pendingToServe: 0, status: null });
  expect(named.partyName).toBe("Ana");
  expect(free.partyName).toBeUndefined();
});

test("toFloorTable carries whether a party's release reminder is due through the occupancy half", () => {
  const placement = {
    id: "t1",
    label: "4",
    seats: 4,
  };
  const occupancy = { state: "open-tab" as const, pendingToServe: 0, status: null };
  expect(toFloorTable(placement, { ...occupancy, fireDue: true }).fireDue).toBe(true);
  expect(toFloorTable(placement, { ...occupancy, fireDue: false }).fireDue).toBe(false);
  expect(toFloorTable(placement, occupancy).fireDue).toBeUndefined();
});

test("toFloorTable defaults a missing tab total to null", () => {
  const table = toFloorTable(
    {
      id: "t2",
      label: "2",
      seats: null,
    },
    { state: "free", pendingToServe: 0, status: null },
  );
  expect(table.tabTotal).toBeNull();
  expect(table.state).toBe("free");
});

test("toFloorTable threads a supplied timingBand through onto the FloorTable", () => {
  const table = toFloorTable(
    {
      id: "t1",
      label: "1",
      seats: 4,
    },
    {
      state: "open-tab",
      tabTotal: "12.50",
      pendingToServe: 2,
      status: null,
      timingBand: "forgotten",
    },
  );
  expect(table.timingBand).toBe("forgotten");
});

test("toFloorTable leaves timingBand undefined when the occupancy input omits it (the dashboard's neutral case)", () => {
  const table = toFloorTable(
    {
      id: "t2",
      label: "2",
      seats: null,
    },
    { state: "free", pendingToServe: 0, status: null },
  );
  expect(table.timingBand).toBeUndefined();
});

test("toFloorTable carries the names of the people with an unsent order through the occupancy half", () => {
  const table = toFloorTable(
    {
      id: "t4",
      label: "4",
      seats: 4,
    },
    { state: "open-tab", pendingToServe: 0, status: null, unsentDrafts: ["Alex", "Sam"] },
  );
  expect(table.unsentDrafts).toEqual(["Alex", "Sam"]);
});

test("toFloorTable carries the consumer's signal chips through the occupancy half", () => {
  const chips = [
    { key: "bill-requested", text: "Bill requested", tone: "primary-filled" as const },
  ];
  const table = toFloorTable(
    { id: "t1", label: "4", posX: 200, posY: 300 },
    { state: "open-tab", pendingToServe: 0, chips },
  );
  expect(table.chips).toEqual(chips);
});

test("buildZoneTabs is the zones in display order, and nothing else", () => {
  expect(
    buildZoneTabs([
      { id: "b", name: "B", displayOrder: 2 },
      { id: "a", name: "A", displayOrder: 1 },
    ]),
  ).toEqual([
    { key: "a", name: "A" },
    { key: "b", name: "B" },
  ]);
});

test("resolveActiveTabKey honours an explicit zone request", () => {
  expect(
    resolveActiveTabKey("z2", [
      { key: "z1", name: "A" },
      { key: "z2", name: "B" },
    ]),
  ).toBe("z2");
});
