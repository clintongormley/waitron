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
  resizeCursor,
  resizeFrom,
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

  describe("resizeFrom", () => {
    /** Where `side`'s midpoint is drawn, in squares, with the table turned round its centre. */
    function midpoint(p: PlanPlacement, side: "top" | "right" | "bottom" | "left") {
      const a = (p.rotation * Math.PI) / 180;
      const [u, v] = {
        top: [0, -p.height / 2],
        right: [p.width / 2, 0],
        bottom: [0, p.height / 2],
        left: [-p.width / 2, 0],
      }[side];
      return {
        x: p.x + p.width / 2 + u * Math.cos(a) - v * Math.sin(a),
        y: p.y + p.height / 2 + u * Math.sin(a) + v * Math.cos(a),
      };
    }

    it("moves the dragged side and keeps the opposite one", () => {
      const p = table(10, 10, 8, 4);
      expect(resizeFrom(p, "right", 2)).toEqual({ ...p, x: 10, width: 10 });
      expect(resizeFrom(p, "left", 2)).toEqual({ ...p, x: 8, width: 10 });
      expect(resizeFrom(p, "top", 1)).toEqual({ ...p, y: 9, height: 5 });
      expect(resizeFrom(p, "bottom", -1)).toEqual({ ...p, y: 10, height: 3 });
    });

    it.each([90, 30, 225])("keeps the opposite side's midpoint on screen at %i°", (rotation) => {
      const p = table(10, 10, 8, 4, rotation);
      for (const [side, opposite, grows] of [
        ["right", "left", "width"],
        ["left", "right", "width"],
        ["bottom", "top", "height"],
        ["top", "bottom", "height"],
      ] as const) {
        const q = resizeFrom(p, side, 2);
        expect(q[grows]).toBe(p[grows] + 2);
        expect(q.rotation).toBe(rotation);
        const before = midpoint(p, opposite);
        const after = midpoint(q, opposite);
        expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(0.5);
      }
    });

    it("holds the size to 1–99 squares", () => {
      expect(resizeFrom(table(10, 10, 8, 4), "right", -20).width).toBe(1);
      expect(resizeFrom(table(10, 10, 8, 4), "bottom", 200).height).toBe(99);
      expect(resizeFrom(table(10, 10, 98, 4), "left", 5)).toMatchObject({ x: 9, width: 99 });
    });

    it("grows a side at the grid's edge only as far as fits, keeping the opposite side", () => {
      // Unturned at (1, 1): the right side is at 9 and the bottom at 5 before and after.
      expect(resizeFrom(table(1, 1, 8, 4), "left", 5)).toEqual(table(0, 1, 9, 4));
      expect(resizeFrom(table(1, 1, 8, 4), "top", 5)).toEqual(table(1, 0, 8, 5));
      expect(resizeFrom(table(0, 0, 8, 4), "left", 2)).toEqual(table(0, 0, 8, 4));
      expect(resizeFrom(table(0, 0, 8, 4), "top", 2)).toEqual(table(0, 0, 8, 4));
      // Turned 90°, the left side is drawn at the top and the right side at the bottom, which is
      // drawn at y 7 with its midpoint at x 14 both before (centre 14, 3) and after (centre 14, 2).
      expect(resizeFrom(table(10, 1, 8, 4, 90), "left", 4)).toEqual(table(9, 0, 10, 4, 90));
    });

    it("shrinks a side at the grid's edge, moving the opposite side instead", () => {
      // Turned 90° at y 0, the right side faces down and the left side up; shrinking the right
      // side would put y at -1, so y stays 0 and the left side, drawn at the top, moves down.
      expect(resizeFrom(table(10, 0, 8, 4, 90), "right", -1)).toEqual(table(11, 0, 7, 4, 90));
      expect(resizeFrom(table(10, 0, 8, 4, 270), "left", -1)).toEqual(table(11, 0, 7, 4, 270));
    });

    it.each([0, 45, 90, 180, 270])("undoes a resize with the opposite one at %i°", (rotation) => {
      const p = table(10, 10, 8, 4, rotation);
      for (const side of ["top", "right", "bottom", "left"] as const) {
        for (const squares of [1, 2, 3]) {
          expect(resizeFrom(resizeFrom(p, side, squares), side, -squares)).toEqual(p);
          expect(resizeFrom(resizeFrom(p, side, -squares), side, squares)).toEqual(p);
        }
      }
    });

    it("rounds a half-square shift at a right angle away from where the table was", () => {
      // At 90° the right side faces down: one more square of width moves the centre half a square
      // left (half the width) and half a square down (the side moving out).
      expect(resizeFrom(table(10, 10, 8, 4, 90), "right", 1)).toEqual(table(9, 11, 9, 4, 90));
      expect(resizeFrom(table(9, 11, 9, 4, 90), "right", -1)).toEqual(table(10, 10, 8, 4, 90));
    });
  });

  describe("resizeCursor", () => {
    const sides = ["top", "right", "bottom", "left"] as const;
    const cursorsAt = (rotation: number) => sides.map((side) => resizeCursor(side, rotation));

    it("gives each side the arrow nearest the way its dot drags on screen", () => {
      expect(cursorsAt(0)).toEqual(["ns-resize", "ew-resize", "ns-resize", "ew-resize"]);
      expect(cursorsAt(90)).toEqual(["ew-resize", "ns-resize", "ew-resize", "ns-resize"]);
      expect(cursorsAt(180)).toEqual(["ns-resize", "ew-resize", "ns-resize", "ew-resize"]);
      expect(cursorsAt(270)).toEqual(["ew-resize", "ns-resize", "ew-resize", "ns-resize"]);
      // Turned 45° clockwise, the right side faces down-right and the top up-right.
      expect(cursorsAt(45)).toEqual(["nesw-resize", "nwse-resize", "nesw-resize", "nwse-resize"]);
      expect(cursorsAt(315)).toEqual(["nwse-resize", "nesw-resize", "nwse-resize", "nesw-resize"]);
      expect(cursorsAt(30)).toEqual(["nesw-resize", "nwse-resize", "nesw-resize", "nwse-resize"]);
      expect(cursorsAt(-90)).toEqual(cursorsAt(270));
      expect(cursorsAt(-45)).toEqual(cursorsAt(315));
    });

    it("switches arrow between the 15° turns either side of each halfway mark", () => {
      expect(cursorsAt(15)).toEqual(["ns-resize", "ew-resize", "ns-resize", "ew-resize"]);
      expect(cursorsAt(60)).toEqual(["nesw-resize", "nwse-resize", "nesw-resize", "nwse-resize"]);
      expect(cursorsAt(75)).toEqual(["ew-resize", "ns-resize", "ew-resize", "ns-resize"]);
      expect(cursorsAt(105)).toEqual(["ew-resize", "ns-resize", "ew-resize", "ns-resize"]);
      expect(cursorsAt(120)).toEqual(["nwse-resize", "nesw-resize", "nwse-resize", "nesw-resize"]);
      expect(cursorsAt(150)).toEqual(["nwse-resize", "nesw-resize", "nwse-resize", "nesw-resize"]);
      expect(cursorsAt(165)).toEqual(["ns-resize", "ew-resize", "ns-resize", "ew-resize"]);
    });

    // A table turns in 15° steps, so it never sits exactly halfway between two arrows.
    it("takes the arrows of the next 45° turn clockwise when a direction is exactly halfway", () => {
      expect(cursorsAt(22.5)).toEqual(cursorsAt(45));
      expect(cursorsAt(67.5)).toEqual(cursorsAt(90));
      expect(cursorsAt(112.5)).toEqual(cursorsAt(135));
      expect(cursorsAt(157.5)).toEqual(cursorsAt(180));
      expect(cursorsAt(-22.5)).toEqual(cursorsAt(157.5));
    });
  });
});
