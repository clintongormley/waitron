import { describe, expect, it } from "vitest";
import {
  JOIN_SIDES,
  NEW_TABLE_SIZE,
  freeSide,
  groupStep,
  heldStep,
  joinSide,
  touchingPlace,
  type JoinPlace,
} from "./floor-join.js";
import * as shared from "./index.js";

const place = (x: number, y: number, width = 8, height = 8, rotation = 0): JoinPlace => ({
  x,
  y,
  width,
  height,
  rotation,
});

describe("joinSide", () => {
  it("picks the side the moving table is nearest, in the target's own frame", () => {
    const target = place(10, 10);
    expect(joinSide(target, place(30, 10))).toBe("right");
    expect(joinSide(target, place(-10, 10))).toBe("left");
    expect(joinSide(target, place(10, 30))).toBe("bottom");
    expect(joinSide(target, place(10, -10))).toBe("top");
    expect(joinSide(target, place(15, 14))).toBe("right");
    expect(joinSide(target, place(5, 14))).toBe("left");
    expect(joinSide(target, place(14, 15))).toBe("bottom");
    expect(joinSide(target, place(14, 5))).toBe("top");
    // A tie: |dx| / 16 = |dy| / 16 goes left–right.
    expect(joinSide(target, place(15, 15))).toBe("right");
    expect(joinSide(target, place(5, 5))).toBe("left");
    expect(joinSide(target, place(5, 15))).toBe("left");
    // Centres that coincide.
    expect(joinSide(target, place(10, 10))).toBe("right");
    const turned = place(10, 10, 8, 8, 90);
    expect(joinSide(turned, place(30, 10))).toBe("top");
    expect(joinSide(turned, place(-10, 10))).toBe("bottom");
    expect(joinSide(turned, place(10, 30))).toBe("right");
    expect(joinSide(turned, place(10, -10))).toBe("left");
    expect(joinSide(place(10, 10, 8, 8, 180), place(30, 10))).toBe("left");
  });

  it("weighs each axis by both tables' sizes", () => {
    /** A moving `width`×`height` table whose centre is (dx, dy) from a target's at (0, 0). */
    const offset = (target: JoinPlace, width: number, height: number, dx: number, dy: number) =>
      place(target.width / 2 + dx - width / 2, target.height / 2 + dy - height / 2, width, height);
    const long = place(0, 0, 16, 4);
    // 6 / 20 < 5 / 8.
    expect(joinSide(long, offset(long, 4, 4, 6, 5))).toBe("bottom");
    const small = place(0, 0, 4, 4);
    // 5 / 6 < 6 / 6: the moving table's width counts.
    expect(joinSide(small, offset(small, 2, 2, 5, 6))).toBe("bottom");
    // 3 / 6 < 5 / 6: the target's width counts, added to the moving one's.
    expect(joinSide(small, offset(small, 2, 2, 3, 5))).toBe("bottom");
    // 3 / 6 = 3 / 6: both heights count, added.
    expect(joinSide(small, offset(small, 2, 2, 3, 3))).toBe("right");
    // 5 / 6 > 3 / 6.
    expect(joinSide(small, offset(small, 2, 2, 5, 3))).toBe("right");
  });
});

describe("touchingPlace", () => {
  it("puts the moving table against the side, centred across it, at the target's rotation", () => {
    const target = place(10, 10);
    const square = { width: 8, height: 8 };
    expect(touchingPlace(target, square, "right")).toEqual({ x: 18, y: 10, rotation: 0 });
    expect(touchingPlace(target, square, "left")).toEqual({ x: 2, y: 10, rotation: 0 });
    expect(touchingPlace(target, square, "top")).toEqual({ x: 10, y: 2, rotation: 0 });
    expect(touchingPlace(target, square, "bottom")).toEqual({ x: 10, y: 18, rotation: 0 });
    const small = { width: 4, height: 2 };
    expect(touchingPlace(target, small, "right")).toEqual({ x: 18, y: 13, rotation: 0 });
    expect(touchingPlace(target, small, "left")).toEqual({ x: 6, y: 13, rotation: 0 });
    expect(touchingPlace(target, small, "top")).toEqual({ x: 12, y: 8, rotation: 0 });
    expect(touchingPlace(target, small, "bottom")).toEqual({ x: 12, y: 18, rotation: 0 });
  });

  it("turns the place with the target", () => {
    const turned = place(10, 10, 8, 8, 90);
    const square = { width: 8, height: 8 };
    // Its right side faces down: the moving centre is (14, 22).
    expect(touchingPlace(turned, square, "right")).toEqual({ x: 10, y: 18, rotation: 90 });
    expect(touchingPlace(turned, square, "left")).toEqual({ x: 10, y: 2, rotation: 90 });
    expect(touchingPlace(turned, square, "top")).toEqual({ x: 18, y: 10, rotation: 90 });
    expect(touchingPlace(turned, square, "bottom")).toEqual({ x: 2, y: 10, rotation: 90 });
    // At 45° the centre is (14 + 8 cos 45°, 14 + 8 sin 45°) ≈ (19.66, 19.66): corner ≈ (15.66, 15.66).
    expect(touchingPlace(place(10, 10, 8, 8, 45), square, "right")).toEqual({
      x: 16,
      y: 16,
      rotation: 45,
    });
    // At 30°: centre (14 + 8 cos 30°, 14 + 8 sin 30°) = (20.93, 18): corner (16.93, 14).
    expect(touchingPlace(place(10, 10, 8, 8, 30), square, "right")).toEqual({
      x: 17,
      y: 14,
      rotation: 30,
    });
    // At 30°, top: centre (14 + 8 sin 30°, 14 − 8 cos 30°) = (18, 7.07): corner (14, 3.07).
    expect(touchingPlace(place(10, 10, 8, 8, 30), square, "top")).toEqual({
      x: 14,
      y: 3,
      rotation: 30,
    });
  });

  it("holds the place within 0 to 999", () => {
    const square = { width: 8, height: 8 };
    expect(touchingPlace(place(2, 0), square, "left")).toEqual({ x: 0, y: 0, rotation: 0 });
    expect(touchingPlace(place(0, 2), square, "top")).toEqual({ x: 0, y: 0, rotation: 0 });
    expect(touchingPlace(place(995, 0), square, "right")).toEqual({ x: 999, y: 0, rotation: 0 });
    expect(touchingPlace(place(0, 995), square, "bottom")).toEqual({ x: 0, y: 999, rotation: 0 });
    expect(touchingPlace(place(991, 991), square, "bottom")).toEqual({
      x: 991,
      y: 999,
      rotation: 0,
    });
  });
});

describe("heldStep", () => {
  it("keeps a step that stays in the grid", () => {
    expect(heldStep(5, 10, 10)).toBe(5);
    expect(heldStep(-10, 10, 10)).toBe(-10);
    expect(heldStep(989, 10, 10)).toBe(989);
  });

  it("holds a step that would pass 0", () => {
    expect(heldStep(-11, 10, 10)).toBe(-10);
    expect(heldStep(-50, 5, 30)).toBe(-5);
  });

  it("holds a step that would pass 999", () => {
    expect(heldStep(990, 10, 10)).toBe(989);
    expect(heldStep(5, 999, 999)).toBe(0);
  });

  it("holds a group by its lowest and highest corners", () => {
    expect(heldStep(-8, 4, 20)).toBe(-4);
    expect(heldStep(990, 4, 990)).toBe(9);
    expect(heldStep(3, 4, 990)).toBe(3);
  });
});

describe("freeSide", () => {
  const target = place(10, 10);
  const square = { width: 8, height: 8 };
  const at = (side: "left" | "right" | "top" | "bottom"): JoinPlace => ({
    ...square,
    ...touchingPlace(target, square, side),
  });

  it("keeps the preferred side when nothing else stands there", () => {
    expect(freeSide(target, square, [target, at("right")], "left")).toBe("left");
    expect(freeSide(target, square, [target], "bottom")).toBe("bottom");
  });

  it("takes the next free side when a member covers the preferred one: the two across it, top or left first, then its opposite", () => {
    const chain = (preferred: "left" | "right" | "top" | "bottom"): string[] => {
      const members = [target];
      const taken: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        const side = freeSide(target, square, members, preferred);
        taken.push(side);
        members.push(at(side));
      }
      return taken;
    };
    expect(chain("right")).toEqual(["right", "top", "bottom", "left"]);
    expect(chain("left")).toEqual(["left", "top", "bottom", "right"]);
    expect(chain("top")).toEqual(["top", "left", "right", "bottom"]);
    expect(chain("bottom")).toEqual(["bottom", "left", "right", "top"]);
  });

  it("keeps the preferred side when every side is covered", () => {
    const all = [target, at("left"), at("right"), at("top"), at("bottom")];
    expect(freeSide(target, square, all, "top")).toBe("top");
  });

  it("counts the target as a member, so a side the grid's edge pushes onto it is covered", () => {
    const edge = place(2, 0);
    expect(freeSide(edge, square, [edge], "left")).toBe("bottom");
  });

  it("accepts an overlap under one square either way, on the boxes' extents in the target's frame", () => {
    expect(freeSide(target, square, [target, place(25.5, 10)], "right")).toBe("right");
    expect(freeSide(target, square, [target, place(25, 10)], "right")).toBe("top");
    expect(freeSide(target, square, [target, place(18, 17.5)], "right")).toBe("right");
    expect(freeSide(target, square, [target, place(18, 17)], "right")).toBe("top");
  });

  it("reads members in the turned target's frame", () => {
    const turned = place(10, 10, 8, 8, 90);
    const right = { ...square, ...touchingPlace(turned, square, "right") };
    expect(freeSide(turned, square, [turned, right], "right")).toBe("top");
    expect(freeSide(turned, square, [turned, right], "left")).toBe("left");
    const tilted = place(10, 10, 8, 8, 30);
    const beside = { ...square, ...touchingPlace(tilted, square, "right") };
    expect(freeSide(tilted, square, [tilted, beside], "right")).toBe("top");
    expect(freeSide(tilted, square, [tilted, beside], "left")).toBe("left");
  });

  it("bounds a member turned another way by its corners' extents, which can cover more than it does", () => {
    const diamond = place(18, 10, 8, 8, 45);
    // The diamond's extents reach the top and bottom places' corners; the diamond itself does not.
    expect(freeSide(target, square, [target, diamond], "right")).toBe("left");
    expect(freeSide(target, square, [target, place(24, 10, 8, 8, 45)], "right")).toBe("top");
    expect(freeSide(target, square, [target, place(27, 10, 8, 8, 45)], "right")).toBe("right");
  });

  it("reads a member's height across when it is turned a quarter", () => {
    const upright = place(18, 26, 8, 2, 90);
    expect(freeSide(target, square, [target, upright], "right")).toBe("right");
    expect(freeSide(target, square, [target, place(18, 20, 8, 2, 90)], "right")).toBe("top");
  });

  it("sizes the moving table's box by its own width and height", () => {
    const wide = { width: 16, height: 4 };
    expect(freeSide(target, wide, [target, place(34, 12)], "right")).toBe("right");
    expect(freeSide(target, wide, [target, place(32, 12)], "right")).toBe("top");
  });
});

describe("groupStep", () => {
  it("moves a group by the step, held so every member stays in the grid", () => {
    const group = [
      { x: 10, y: 20 },
      { x: 30, y: 5 },
    ];
    expect(groupStep(group, { x: 4, y: -3 })).toEqual({ dx: 4, dy: -3 });
    expect(groupStep(group, { x: -50, y: -50 })).toEqual({ dx: -10, dy: -5 });
    expect(groupStep(group, { x: 990, y: 990 })).toEqual({ dx: 969, dy: 979 });
  });
});

it("names the four sides and is exported from the package", () => {
  expect(JOIN_SIDES).toEqual(["left", "right", "top", "bottom"]);
  expect(shared.joinSide).toBe(joinSide);
  expect(shared.touchingPlace).toBe(touchingPlace);
  expect(shared.JOIN_SIDES).toBe(JOIN_SIDES);
  expect(shared.heldStep).toBe(heldStep);
  expect(shared.freeSide).toBe(freeSide);
  expect(shared.groupStep).toBe(groupStep);
  expect(shared.NEW_TABLE_SIZE).toBe(8);
  expect(NEW_TABLE_SIZE).toBe(8);
});
