import { expect, it } from "vitest";
import { takesExtras } from "./unit-extras.js";

it.each([
  [{ hardwareUnit: null, precision: 0 }, true],
  [{ hardwareUnit: null, precision: 0, measure: false }, true],
  [{ hardwareUnit: null, precision: 0, measure: true }, false],
  [{ hardwareUnit: null, precision: 1 }, false],
  [{ hardwareUnit: "g", precision: 0 }, false],
  [{ hardwareUnit: "kg", precision: 3, measure: true }, false],
] as const)("decides extras eligibility from unit facts %j", (unit, want) => {
  expect(takesExtras(unit)).toBe(want);
});
