import { describe, expect, it } from "vitest";
import type { Placement } from "./floor-reset-plan.js";
import { type LaidPart, partPlaces, standsIn } from "./joined-split-layout.js";

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
});

describe("standsIn", () => {
  const bar = (x: number, y: number, rotation = 0): Placement => ({
    x,
    y,
    width: 2,
    height: 2,
    shape: "rect",
    rotation,
  });

  it("a table over part of Long table's saved place stands in it", () => {
    expect(standsIn(LONG, bar(11, 20))).toBe(true);
  });

  it("a table touching Long table's right edge does not", () => {
    expect(standsIn(LONG, bar(16, 20))).toBe(false);
  });

  it("Bar pushed onto Long table's left side, touching it, does not", () => {
    expect(standsIn(LONG, bar(8, 20))).toBe(false);
  });

  it("a table over one square of Long table's corner, both ways, does", () => {
    expect(standsIn(LONG, bar(15, 21))).toBe(true);
  });

  it("a table touching Long table's corner does not", () => {
    expect(standsIn(LONG, bar(16, 21))).toBe(false);
  });

  it("a turned Bar centred on Long table's centre does", () => {
    expect(standsIn(LONG, bar(12, 20, 45))).toBe(true);
  });

  it("a turned Bar whose corner only reaches Long table's edge does not", () => {
    expect(standsIn(LONG, bar(12, 19 - Math.SQRT2, 45))).toBe(false);
  });

  it("a turned Bar whose corner reaches half a square into Long table does not", () => {
    expect(standsIn(LONG, bar(12, 19.5 - Math.SQRT2, 45))).toBe(false);
  });

  it("a table inside a turned Long table's bounding box but clear of its sides does not", () => {
    expect(standsIn({ ...LONG, rotation: 45 }, bar(14, 18))).toBe(false);
    expect(standsIn(bar(14, 18), { ...LONG, rotation: 45 })).toBe(false);
  });

  it("a Bar turned 195° with its centre on Long table's corner overlaps it by exactly one square, and does", () => {
    expect(standsIn(LONG, bar(9, 19, 195))).toBe(true);
  });
});
