import { describe, expect, it } from "vitest";
import type { Placement } from "./floor-reset-plan.js";
import {
  joinedPlaceAfter,
  type LaidPart,
  partPlaces,
  remainingPlace,
  wholePlace,
} from "./joined-split-layout.js";

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

describe("where a joined table stands after Join again", () => {
  const SIX_BY_TWO = { width: 6, height: 2 };
  const at = (x: number, y: number, width: number, height: number, rotation = 0): Placement => ({
    x,
    y,
    width,
    height,
    shape: "rect",
    rotation,
  });

  it("comes back whole at its saved size from where it stands", () => {
    const row = remainingPlace(LONG, PARTS, 0, 0, 1);
    expect(row).toEqual(at(10, 20, 4, 2));
    expect(wholePlace(row, PARTS, 0, SIX_BY_TWO)).toEqual(at(10, 20, 6, 2));
  });

  it("keeps its left end when the first table was split off", () => {
    const row = remainingPlace(LONG, PARTS, 0, 1, 2);
    expect(row).toEqual(at(12, 20, 10, 2));
    expect(wholePlace(row, PARTS, 1, SIX_BY_TWO)).toEqual(at(10, 20, 6, 2));
  });

  it("keeps where staff moved it", () => {
    expect(wholePlace(at(15, 25, 4, 2), PARTS, 0, SIX_BY_TWO)).toEqual(at(15, 25, 6, 2));
  });

  it("gives it the row's shape", () => {
    const round: Placement = { ...at(15, 25, 4, 2), shape: "round" };
    expect(wholePlace(round, PARTS, 0, SIX_BY_TWO)).toEqual({
      ...at(15, 25, 6, 2),
      shape: "round",
    });
  });

  it("turns with it", () => {
    const row = remainingPlace({ ...LONG, rotation: 90 }, PARTS, 0, 0, 1);
    expect(row).toEqual(at(11, 19, 4, 2, 90));
    expect(wholePlace(row, PARTS, 0, SIX_BY_TWO)).toEqual(at(10, 20, 6, 2, 90));
    for (let rotation = 0; rotation < 360; rotation += 15) {
      const turned = remainingPlace({ ...LONG, rotation }, PARTS, 0, 0, 1);
      const back = wholePlace(turned, PARTS, 0, SIX_BY_TWO);
      expect(Math.abs(back.x - 10), `x at ${rotation}°`).toBeLessThanOrEqual(1);
      expect(Math.abs(back.y - 20), `y at ${rotation}°`).toBeLessThanOrEqual(1);
      expect(back.rotation).toBe(rotation);
    }
  });

  const whole = {
    standing: true,
    saved: LONG,
    parts: PARTS,
    covered: 0,
    staying: [0, 1, 2],
    whole: true,
  };
  const apartSome = { ...whole, standing: false, staying: [1, 2], whole: false };

  it.each<[string, Parameters<typeof joinedPlaceAfter>[0], Placement | null]>([
    ["whole and standing", { ...whole, row: at(10, 20, 4, 2) }, at(10, 20, 6, 2)],
    ["whole, standing, moved", { ...whole, row: at(15, 25, 4, 2) }, at(15, 25, 6, 2)],
    ["whole and not standing", { ...whole, row: at(15, 25, 4, 2), standing: false }, LONG],
    [
      "whole, not standing, no saved place",
      { ...whole, row: at(15, 25, 4, 2), standing: false, saved: null },
      null,
    ],
    [
      "whole and standing with no saved place",
      { ...whole, row: at(10, 20, 4, 2), saved: null },
      at(10, 17, 8, 8),
    ],
    ["whole, standing but covered -1", { ...whole, row: at(15, 25, 4, 2), covered: -1 }, LONG],
    [
      "some apart, not standing: from its saved place",
      { ...apartSome, row: at(15, 25, 4, 2) },
      at(12, 20, 10, 2),
    ],
    [
      "some apart, not standing, turned 90°: from its saved place",
      { ...apartSome, row: at(15, 25, 4, 2), saved: { ...LONG, rotation: 90 } },
      at(8, 24, 10, 2, 90),
    ],
    [
      "some apart, a table left apart between two coming back",
      { ...apartSome, row: at(15, 25, 4, 2), staying: [0, 2] },
      at(10, 20, 12, 2),
    ],
    [
      "some apart, not standing, no saved place: from its today's place",
      { ...apartSome, row: at(10, 20, 4, 2), saved: null },
      at(12, 20, 10, 2),
    ],
    ["some apart, no place at all", { ...apartSome, row: null, saved: null }, null],
  ])("%s", (_name, args, expected) => {
    expect(joinedPlaceAfter(args)).toEqual(expected);
  });
});
