import { expect, it } from "vitest";
import { effectiveOrderStart } from "./zone-order-start.js";

it.each([
  ["counter", "table", "counter"],
  ["table", "counter", "table"],
  [null, "table", "table"],
  [null, "counter", "counter"],
  [undefined, undefined, "counter"],
] as const)("resolves zone %s over department %s to %s", (zone, department, expected) => {
  expect(effectiveOrderStart(zone, department)).toBe(expected);
});
