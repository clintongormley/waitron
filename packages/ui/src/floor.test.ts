import { expect, test } from "vitest";
import {
  FLOOR_ASPECT,
  GRID_STEP,
  ROTATION_STEP,
  buildZoneTabs,
  clampPermille,
  defaultTraySlot,
  isTableZoneless,
  resolveActiveTabKey,
  sizeForCapacity,
  snapRotation,
  snapToGrid,
  toFloorTable,
} from "./floor.js";

test("FLOOR_ASPECT is the single 3:2 canvas ratio", () => {
  expect(FLOOR_ASPECT).toBe(1.5);
  expect(FLOOR_ASPECT).toBe(3 / 2);
});

// sizeForCapacity buckets: <=2 -> S, 3-4 -> M, 5-6 -> L, >=7 -> XL, nullish -> M.
test.each([
  [1, "S"],
  [2, "S"],
  [3, "M"],
  [4, "M"],
  [5, "L"],
  [6, "L"],
  [7, "XL"],
  [8, "XL"],
  [20, "XL"],
] as const)("sizeForCapacity(%i) === %s", (capacity, expected) => {
  expect(sizeForCapacity(capacity)).toBe(expected);
});

test("sizeForCapacity treats an unknown capacity as medium", () => {
  expect(sizeForCapacity(undefined)).toBe("M");
  expect(sizeForCapacity(null as unknown as undefined)).toBe("M");
});

test("GRID_STEP and ROTATION_STEP are the shared snap increments", () => {
  expect(GRID_STEP).toBe(50);
  expect(ROTATION_STEP).toBe(15);
});

test("snapToGrid rounds to the nearest 50 permille step", () => {
  expect(snapToGrid(333)).toBe(350);
  expect(snapToGrid(520)).toBe(500);
  expect(snapToGrid(0)).toBe(0);
  expect(snapToGrid(1000)).toBe(1000);
  // Always lands on a multiple of the step.
  expect(snapToGrid(333) % GRID_STEP).toBe(0);
});

test("snapToGrid accepts a custom step", () => {
  expect(snapToGrid(17, 10)).toBe(20);
});

test("snapRotation snaps to the nearest 15 degrees and wraps at 360", () => {
  expect(snapRotation(7)).toBe(0);
  expect(snapRotation(8)).toBe(15);
  expect(snapRotation(22)).toBe(15);
  expect(snapRotation(360)).toBe(0);
  expect(snapRotation(375)).toBe(15);
});

test("clampPermille pins a coordinate into the 0..1000 canvas range", () => {
  expect(clampPermille(-40)).toBe(0);
  expect(clampPermille(500)).toBe(500);
  expect(clampPermille(1400)).toBe(1000);
});

// defaultTraySlot: the tap-to-place slot is the canvas centre (500,500) nudged right by one GRID_STEP
// per already-placed table (so successive placements don't stack exactly), clamped into range.
test("defaultTraySlot centres the first placement and nudges each later one right by a grid step", () => {
  expect(defaultTraySlot(0)).toEqual({ posX: 500, posY: 500 });
  expect(defaultTraySlot(1)).toEqual({ posX: 550, posY: 500 });
  expect(defaultTraySlot(3)).toEqual({ posX: 650, posY: 500 });
});

test("defaultTraySlot clamps posX into the 0..1000 range once the nudges run off the edge", () => {
  // 500 + 20 * 50 = 1500, clamped to 1000; posY is always the centre.
  expect(defaultTraySlot(20)).toEqual({ posX: 1000, posY: 500 });
});

// isTableZoneless: a table belongs under the "no zone" tab when it has no zone OR points at a zone
// not among the currently-active ones (a deactivated zone is never nulled on the table).
test("isTableZoneless is true for a null zone and for a zone missing from the known set", () => {
  const known = new Set(["z1", "z2"]);
  expect(isTableZoneless({ zoneId: null }, known)).toBe(true);
  expect(isTableZoneless({ zoneId: "z9" }, known)).toBe(true);
});

test("isTableZoneless is false for a table whose zone is active", () => {
  expect(isTableZoneless({ zoneId: "z1" }, new Set(["z1", "z2"]))).toBe(false);
});

// buildZoneTabs: the active zones sorted by displayOrder, mapped to { key, name }, plus a trailing
// no-zone tab (key null, the passed label) iff some table is zoneless or points at a deactivated zone.
test("buildZoneTabs orders the zone tabs by displayOrder", () => {
  const zones = [
    { id: "z2", name: "Terraza", displayOrder: 2 },
    { id: "z1", name: "Comedor", displayOrder: 1 },
  ];
  const tabs = buildZoneTabs(zones, [{ zoneId: "z1" }], "Sin zona");
  expect(tabs).toEqual([
    { key: "z1", name: "Comedor" },
    { key: "z2", name: "Terraza" },
  ]);
});

test("buildZoneTabs omits the no-zone tab when every table has an active zone", () => {
  const zones = [{ id: "z1", name: "Comedor", displayOrder: 1 }];
  expect(buildZoneTabs(zones, [{ zoneId: "z1" }], "Sin zona")).toEqual([
    { key: "z1", name: "Comedor" },
  ]);
});

test("buildZoneTabs appends the no-zone tab for a table with a null zone", () => {
  const zones = [{ id: "z1", name: "Comedor", displayOrder: 1 }];
  expect(buildZoneTabs(zones, [{ zoneId: "z1" }, { zoneId: null }], "No zone")).toEqual([
    { key: "z1", name: "Comedor" },
    { key: null, name: "No zone" },
  ]);
});

test("buildZoneTabs appends the no-zone tab for a table pointing at a deactivated zone", () => {
  // z9 is not among the active zones, so the table that points at it lands under the no-zone tab.
  const zones = [{ id: "z1", name: "Comedor", displayOrder: 1 }];
  expect(buildZoneTabs(zones, [{ zoneId: "z9" }], "Sin zona")).toEqual([
    { key: "z1", name: "Comedor" },
    { key: null, name: "Sin zona" },
  ]);
});

// resolveActiveTabKey: an explicit request wins; `undefined` (nothing picked yet) falls back to the
// first tab's key, or `undefined` when there are no tabs at all.
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

test("resolveActiveTabKey honours an explicit request, including the null no-zone key", () => {
  const tabs = [
    { key: "z1", name: "A" },
    { key: null, name: "Sin zona" },
  ];
  expect(resolveActiveTabKey("z1", tabs)).toBe("z1");
  expect(resolveActiveTabKey(null, tabs)).toBeNull();
});

// toFloorTable: the placement half maps verbatim (null coords default to 0); the occupancy half is
// supplied separately (a live read-model on the till, neutral "free" defaults on the dashboard).
test("toFloorTable maps a placed table's coordinates and occupancy", () => {
  const table = toFloorTable(
    {
      id: "t1",
      label: "1",
      capacity: 4,
      posX: 200,
      posY: 300,
      shape: "rect",
      rotation: 90,
      zoneId: "z1",
    },
    { state: "open-tab", tabTotal: "12.50", pendingToServe: 2, status: null },
  );
  expect(table).toEqual({
    id: "t1",
    label: "1",
    capacity: 4,
    posX: 200,
    posY: 300,
    shape: "rect",
    rotation: 90,
    zoneId: "z1",
    state: "open-tab",
    tabTotal: "12.50",
    pendingToServe: 2,
    status: null,
  });
});

test("toFloorTable defaults null coordinates to 0 and a missing tab total to null", () => {
  const table = toFloorTable(
    {
      id: "t2",
      label: "2",
      capacity: null,
      posX: null,
      posY: null,
      shape: null,
      rotation: null,
      zoneId: null,
    },
    { state: "free", pendingToServe: 0, status: null },
  );
  expect(table.posX).toBe(0);
  expect(table.posY).toBe(0);
  expect(table.tabTotal).toBeNull();
  expect(table.state).toBe("free");
});
