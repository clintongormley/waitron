import { describe, expect, it } from "vitest";
import {
  GRID_SQUARE_PX,
  NAME_MIN_PX,
  NEW_TABLE_SIZE,
  automaticNames,
  bounds,
  clampToGrid,
  cropToTables,
  firstFreeSpot,
  fitScale,
  gridExtent,
  rotatedRect,
  showsName,
  snapToSquare,
  type PlanPlacement,
} from "./floor-plan-geometry.js";

function table(x: number, y: number, width: number, height: number, rotation = 0): PlanPlacement {
  return { x, y, width, height, shape: "rect", rotation };
}

describe("floor plan geometry", () => {
  it("names its constants", () => {
    expect(GRID_SQUARE_PX).toBe(12);
    expect(NEW_TABLE_SIZE).toBe(8);
    expect(NAME_MIN_PX).toBe(28);
  });

  it("snaps pixels to the nearest whole square", () => {
    expect(snapToSquare(17, 12)).toBe(1);
    expect(snapToSquare(18, 12)).toBe(2);
    expect(snapToSquare(-7, 12)).toBe(-1);
    expect(snapToSquare(25, 10)).toBe(3);
    expect(snapToSquare(18)).toBe(2);
  });

  it("clamps a coordinate to 0–999 in whole squares", () => {
    expect(clampToGrid(-3)).toBe(0);
    expect(clampToGrid(1000)).toBe(999);
    expect(clampToGrid(12.4)).toBe(12);
    expect(clampToGrid(0)).toBe(0);
    expect(clampToGrid(999)).toBe(999);
  });

  it("leaves an unturned table's box as it is", () => {
    expect(rotatedRect(table(10, 5, 8, 4))).toEqual({ x: 10, y: 5, width: 8, height: 4 });
  });

  it("turns a table about its centre, exactly at right angles", () => {
    expect(rotatedRect(table(10, 10, 8, 4, 90))).toEqual({ x: 12, y: 8, width: 4, height: 8 });
    expect(rotatedRect(table(10, 10, 8, 4, 270))).toEqual({ x: 12, y: 8, width: 4, height: 8 });
    expect(rotatedRect(table(10, 10, 8, 4, 180))).toEqual({ x: 10, y: 10, width: 8, height: 4 });
  });

  it("boxes a table turned 45° around its corners", () => {
    const box = rotatedRect(table(0, 0, 8, 4, 45));
    const side = (12 * Math.SQRT2) / 2;
    expect(box.width).toBeCloseTo(side, 4);
    expect(box.height).toBeCloseTo(side, 4);
    expect(box.x + box.width / 2).toBeCloseTo(4, 9);
    expect(box.y + box.height / 2).toBeCloseTo(2, 9);
  });

  it("bounds nothing as null and several tables as their union", () => {
    expect(bounds([])).toBeNull();
    expect(bounds([table(0, 0, 8, 8), table(20, 10, 4, 4)])).toEqual({
      x: 0,
      y: 0,
      width: 24,
      height: 14,
    });
    expect(bounds([table(20, 10, 4, 4), table(5, 3, 2, 2)])).toEqual({
      x: 5,
      y: 3,
      width: 19,
      height: 11,
    });
  });

  it("crops to the tables with a two-square margin, below 0 when a table touches the edge", () => {
    expect(cropToTables([table(10, 5, 8, 4)])).toEqual({ x: 8, y: 3, width: 12, height: 8 });
    expect(cropToTables([table(0, 0, 8, 8)])).toEqual({ x: -2, y: -2, width: 12, height: 12 });
    expect(cropToTables([table(10, 5, 8, 4)], 1)).toEqual({ x: 9, y: 4, width: 10, height: 6 });
    expect(cropToTables([])).toBeNull();
  });

  it("crops a rotated table by its turned box", () => {
    expect(cropToTables([table(10, 10, 8, 4, 90)])).toEqual({ x: 10, y: 6, width: 8, height: 12 });
  });

  it("fits a crop to the space by its tighter side", () => {
    const crop = { x: 0, y: 0, width: 12, height: 8 };
    expect(fitScale(crop, { width: 600, height: 300 })).toBe(37.5);
    expect(fitScale(crop, { width: 600, height: 800 })).toBe(50);
  });

  it("keeps the grid the visible size with no tables, and 8 squares past the furthest table", () => {
    const visible = { columns: 50, rows: 30 };
    expect(gridExtent([], visible)).toEqual({ columns: 50, rows: 30 });
    expect(gridExtent([table(200, 3, 8, 4)], visible)).toEqual({ columns: 216, rows: 30 });
    expect(gridExtent([table(0, 40, 8, 4)], visible)).toEqual({ columns: 50, rows: 52 });
    expect(gridExtent([table(0, 40, 8, 4)], visible, 2)).toEqual({ columns: 50, rows: 46 });
  });

  it("rounds a turned table's far edge up to a whole square", () => {
    expect(gridExtent([table(0, 0, 8, 4, 45)], { columns: 10, rows: 10 })).toEqual({
      columns: 17,
      rows: 15,
    });
  });

  it("finds the top-left spot of an empty plan", () => {
    expect(firstFreeSpot([])).toEqual({ x: 0, y: 0 });
  });

  it("leaves a one-square gap beside a table", () => {
    expect(firstFreeSpot([table(0, 0, 8, 8)])).toEqual({ x: 9, y: 0 });
  });

  it("moves to the next free row when a row is full", () => {
    expect(firstFreeSpot([table(0, 0, 40, 8)])).toEqual({ x: 0, y: 9 });
  });

  it("scans as far as the widest table when it reaches past the columns", () => {
    expect(firstFreeSpot([table(0, 0, 40, 8), table(0, 9, 30, 8)], undefined, 20)).toEqual({
      x: 31,
      y: 9,
    });
  });

  it("places a smaller table in a narrower gap", () => {
    expect(firstFreeSpot([table(0, 0, 8, 8), table(13, 0, 8, 8)], { width: 3, height: 3 })).toEqual(
      { x: 9, y: 0 },
    );
    expect(firstFreeSpot([table(0, 0, 36, 8)], undefined, 44)).toEqual({ x: 0, y: 9 });
    expect(firstFreeSpot([table(0, 0, 36, 8)], undefined, 45)).toEqual({ x: 37, y: 0 });
  });

  it("still finds a spot for a table wider than the columns", () => {
    expect(firstFreeSpot([], { width: 10, height: 10 }, 5)).toEqual({ x: 0, y: 0 });
  });

  it("avoids a turned table's whole box", () => {
    expect(firstFreeSpot([table(0, 0, 8, 2, 90)])).toEqual({ x: 6, y: 0 });
    expect(firstFreeSpot([table(0, 0, 8, 2, 270)])).toEqual({ x: 6, y: 0 });
  });

  it("treats a spot exactly a gap away as free", () => {
    expect(firstFreeSpot([table(0, 0, 8, 8, 180)])).toEqual({ x: 9, y: 0 });
    expect(firstFreeSpot([table(0, 9, 8, 8)])).toEqual({ x: 0, y: 0 });
    expect(firstFreeSpot([table(0, 20, 8, 8)])).toEqual({ x: 0, y: 0 });
  });

  it("moves across to free columns when the band's rows run out of the coordinate range", () => {
    const column = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 999].map((y) =>
      table(0, y, 99, 99),
    );
    expect(firstFreeSpot(column)).toEqual({ x: 100, y: 0 });
  });

  it("only offers a spot where the whole box stays inside the coordinate range", () => {
    expect(firstFreeSpot([table(0, 0, 991, 8)], { width: 8, height: 8 }, 1000)).toEqual({
      x: 0,
      y: 9,
    });
  });

  it("answers null when nothing inside the range is free", () => {
    const full = Array.from({ length: 11 }, (_, i) =>
      Array.from({ length: 11 }, (_, j) => table(i * 99, j * 99, 99, 99)),
    ).flat();
    expect(firstFreeSpot(full)).toBeNull();
  });

  it("shows a name at 28 px and hides it below", () => {
    expect(showsName({ width: 2, height: 2 }, 14)).toBe(true);
    expect(showsName({ width: 2, height: 2 }, 13.9)).toBe(false);
    expect(showsName({ width: 2, height: 9 }, 12)).toBe(false);
    expect(showsName({ width: 9, height: 2 }, 12)).toBe(false);
    expect(showsName({ width: 3, height: 3 }, 12)).toBe(true);
  });

  it("numbers on from the highest name with the prefix", () => {
    expect(
      automaticNames(
        "Terrace",
        ["Terrace 1", "Terrace 5", "Terrace bar 3", "Terraces 9", "terrace 7"],
        3,
      ),
    ).toEqual(["Terrace 6", "Terrace 7", "Terrace 8"]);
  });

  it("starts at 1 when no name has the prefix, and trims the prefix", () => {
    expect(automaticNames(" Bar ", ["T1"], 2)).toEqual(["Bar 1", "Bar 2"]);
  });

  it("reads a leading zero as its number", () => {
    expect(automaticNames("Terrace", ["Terrace 05"], 1)).toEqual(["Terrace 6"]);
  });

  it("numbers bare digits when the prefix is empty", () => {
    expect(automaticNames("", ["4", "T1", "12a"], 2)).toEqual(["5", "6"]);
  });

  it("counts only a single space and digits after the prefix", () => {
    expect(
      automaticNames("Bar", ["Bar  4", "Bar 3a", "Bar 2", "xBar 9", "Bar 7 ", "Bar "], 1),
    ).toEqual(["Bar 3"]);
    expect(automaticNames("", [" 9", "9 ", "3"], 1)).toEqual(["4"]);
  });

  it("never repeats a name past the largest whole number JavaScript counts exactly", () => {
    const existing = ["T 9007199254740992"];
    const names = automaticNames("T", existing, 2);
    expect(names).toEqual(["T 9007199254740993", "T 9007199254740994"]);
    expect(new Set([...existing, ...names]).size).toBe(3);
  });
});
