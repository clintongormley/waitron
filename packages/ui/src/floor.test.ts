import { expect, test } from "vitest";
import {
  FLOOR_ASPECT,
  GRID_STEP,
  ROTATION_STEP,
  clampPermille,
  sizeForCapacity,
  snapRotation,
  snapToGrid,
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
