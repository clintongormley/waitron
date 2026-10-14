import { expect, it } from "vitest";
import { joinedPlaceAfter } from "./joined-split-layout.js";

it.each([
  [0, false, 100, 100, 10, 2],
  [90, false, 97, 103, 10, 2],
  [180, false, 94, 100, 10, 2],
  [270, false, 97, 97, 10, 2],
  [0, true, 98, 98, 12, 6],
  [90, true, 96, 100, 12, 6],
  [180, true, 94, 98, 12, 6],
  [270, true, 96, 96, 12, 6],
] as const)(
  "rejoins from a later part's standing anchor at %d degrees (whole: %s)",
  (rotation, whole, x, y, width, height) => {
    expect(
      joinedPlaceAfter({
        row: { x: 100, y: 100, width: 4, height: 2, shape: "round", rotation },
        standing: true,
        saved: { x: 10, y: 20, width: 12, height: 6, shape: "rect", rotation: 45 },
        parts: [
          { tableId: "first", width: 2, height: 3 },
          { tableId: "middle", width: 4, height: 2 },
          { tableId: "last", width: 6, height: 9 },
        ],
        covered: 1,
        staying: [1, 2],
        whole,
      }),
    ).toEqual({ x, y, width, height, shape: "round", rotation });
  },
);
