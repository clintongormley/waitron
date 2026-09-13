import { expect, it } from "vitest";
import { reorder } from "./reorder.js";
it("moves an item and clamps to the ends", () => {
  expect(reorder(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  expect(reorder(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  expect(reorder(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]); // clamped, no-op
  expect(reorder(["a", "b", "c"], 2, 5)).toEqual(["a", "b", "c"]); // clamped, no-op
});
it("clamps an out-of-range source index too", () => {
  // Unclamped, splice(-1, 1) would remove the LAST item and reinsert it, and splice(5, 1) would
  // remove nothing and reinsert undefined.
  expect(reorder(["a", "b", "c"], -1, 1)).toEqual(["a", "b", "c"]);
  expect(reorder(["a", "b", "c"], 5, 1)).toEqual(["a", "b", "c"]);
});
