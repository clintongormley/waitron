import { expect, it } from "vitest";
import { popupIndex, popupPlacement } from "./popup-helpers.js";

it.each([
  ["ArrowDown", -1, 3, 0],
  ["ArrowUp", -1, 3, 2],
  ["ArrowDown", 2, 3, 0],
  ["ArrowUp", 0, 3, 2],
  ["ArrowDown", 0, 3, 1],
  ["ArrowUp", 2, 3, 1],
  ["ArrowDown", 9, 3, 0],
  ["ArrowUp", 9, 3, 1],
  ["Home", 2, 3, 0],
  ["End", 0, 3, 2],
  ["ArrowDown", -1, 0, -1],
  ["ArrowUp", -1, 0, -1],
  ["Home", -1, 0, -1],
  ["End", -1, 0, -1],
  ["ArrowDown", 0, 1, 0],
  ["ArrowUp", 0, 1, 0],
  ["Enter", 0, 3, undefined],
  ["Tab", 0, 0, undefined],
] as const)("%s from %i in %i rows chooses %s", (key, current, count, expected) => {
  expect(popupIndex(key, current, count)).toBe(expected);
});

it.each([
  ["fit", 100, 140, 80, 400, 140, 384],
  ["fit", 300, 340, 150, 400, 242, 384],
  ["fit", 300, 340, 600, 400, 8, 384],
  ["below", 100, 140, 600, 400, 140, 252],
  ["above", 300, 340, 150, 400, 150, 292],
  ["above", 100, 140, 600, 400, 140, 252],
  ["above", 210, 250, 600, 400, 8, 202],
  ["above", 50, 90, 80, 400, 90, 302],
] as const)(
  "%s placement at %i–%i for %ipx in %ipx",
  (mode, top, bottom, height, viewport, y, maxHeight) => {
    expect(popupPlacement({ top, bottom }, height, viewport, mode)).toEqual({ top: y, maxHeight });
  },
);
