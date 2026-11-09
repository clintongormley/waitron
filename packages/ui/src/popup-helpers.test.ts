import { expect, it } from "vitest";
import { popupIndex } from "./popup-helpers.js";

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
