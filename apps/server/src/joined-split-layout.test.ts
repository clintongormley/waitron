import { describe, expect, it } from "vitest";
import type { Placement } from "./floor-reset-plan.js";
import { type LaidPart, partPlaces, remainingPlace } from "./joined-split-layout.js";

const LONG: Placement = { x: 10, y: 20, width: 6, height: 2, shape: "rect", rotation: 0 };

const part = (tableId: string, width: number, height: number): LaidPart => ({
  tableId,
  width,
  height,
});

const PARTS: LaidPart[] = [part("c3", 2, 2), part("c4", 2, 2), part("c5", 8, 8)];

describe("partPlaces", () => {
  it("lays Long table's parts side by side from its left edge, each centred on its middle line", () => {
    expect(partPlaces(LONG, PARTS, 0)).toEqual([
      { x: 10, y: 20, width: 2, height: 2, shape: "rect", rotation: 0 },
      { x: 12, y: 20, width: 2, height: 2, shape: "rect", rotation: 0 },
      { x: 14, y: 17, width: 8, height: 8, shape: "rect", rotation: 0 },
    ]);
  });

  it("leaves the rest of the outline empty when the parts are narrower", () => {
    const narrow = [part("c3", 1, 2), part("c4", 1, 2), part("c5", 1, 2)];
    expect(partPlaces(LONG, narrow, 0).map((p) => p.x)).toEqual([10, 11, 12]);
    expect(remainingPlace(LONG, narrow, 0, 0, 2)).toEqual({
      x: 10,
      y: 20,
      width: 3,
      height: 2,
      shape: "rect",
      rotation: 0,
    });
  });

  it("turns the parts with the joined table", () => {
    expect(partPlaces({ ...LONG, rotation: 90 }, PARTS, 0)).toEqual([
      { x: 12, y: 18, width: 2, height: 2, shape: "rect", rotation: 90 },
      { x: 12, y: 20, width: 2, height: 2, shape: "rect", rotation: 90 },
      { x: 9, y: 22, width: 8, height: 8, shape: "rect", rotation: 90 },
    ]);
  });

  it("gives each part the joined table's shape", () => {
    const places = partPlaces({ ...LONG, shape: "round" }, PARTS, 0);
    expect(places.map((p) => p.shape)).toEqual(["round", "round", "round"]);
  });

  it("pulls a place that would fall off the map back inside it", () => {
    const row: Placement = { x: 995, y: 0, width: 4, height: 2, shape: "rect", rotation: 0 };
    const places = partPlaces(row, [part("c3", 2, 2), part("c4", 2, 2), part("c5", 2, 4)], 0);
    expect(places[2]).toMatchObject({ x: 999, y: 0 });
  });

  it("works a later split from where the joined table stands now", () => {
    const row = remainingPlace(LONG, PARTS, 0, 1, 2);
    expect(row).toEqual({ x: 12, y: 20, width: 10, height: 2, shape: "rect", rotation: 0 });
    const again = partPlaces(row, PARTS, 1);
    expect(again[1]).toMatchObject({ x: 12, y: 20 });
    expect(again[2]).toMatchObject({ x: 14, y: 17 });
    const moved = partPlaces({ ...row, x: row.x + 5, y: row.y + 5 }, PARTS, 1);
    expect(moved[1]).toMatchObject({ x: 17, y: 25 });
  });

  it("lands a later split within one square of the first split's places when the table is turned 45°", () => {
    const turned: Placement = { ...LONG, rotation: 45 };
    const first = partPlaces(turned, PARTS, 0);
    const row = remainingPlace(turned, PARTS, 0, 1, 2);
    const again = partPlaces(row, PARTS, 1);
    for (const i of [1, 2]) {
      expect(Math.abs(again[i]!.x - first[i]!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(again[i]!.y - first[i]!.y)).toBeLessThanOrEqual(1);
    }
  });
});

describe("remainingPlace", () => {
  it("covers the remaining parts' slots at the joined table's own depth", () => {
    expect(remainingPlace(LONG, PARTS, 0, 0, 1)).toEqual({
      x: 10,
      y: 20,
      width: 4,
      height: 2,
      shape: "rect",
      rotation: 0,
    });
    expect(remainingPlace(LONG, PARTS, 0, 0, 2)).toEqual({
      x: 10,
      y: 20,
      width: 12,
      height: 2,
      shape: "rect",
      rotation: 0,
    });
  });

  it("holds the joined table that remains to 99 squares wide, keeping its left edge", () => {
    const row: Placement = { x: 0, y: 100, width: 6, height: 2, shape: "rect", rotation: 0 };
    const wide = [part("c3", 60, 2), part("c4", 60, 2), part("c5", 2, 2)];
    expect(remainingPlace(row, wide, 0, 0, 1)).toEqual({
      x: 0,
      y: 100,
      width: 99,
      height: 2,
      shape: "rect",
      rotation: 0,
    });
  });
});
