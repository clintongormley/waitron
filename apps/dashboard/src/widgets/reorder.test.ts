import { expect, it } from "vitest";
import { reorder } from "./reorder.js";
it("moves an item and clamps to the ends", () => {
  expect(reorder(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  expect(reorder(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  expect(reorder(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]); // clamped, no-op
  expect(reorder(["a", "b", "c"], 2, 5)).toEqual(["a", "b", "c"]); // clamped, no-op
});
