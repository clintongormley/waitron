import { expect, test, vi } from "vitest";
import { FilterExpansion } from "./wt-data-table-filter-expansion.js";

// Only a direct call can show this: the table's closeBelow returns nothing for no keys.
test("choose with no temporary key hands back every key without calling closeBelow or recording anything", () => {
  const expansion = new FilterExpansion();
  const closeBelow = vi.fn(() => ["below"]);
  expect(expansion.choose(["a", "b"], false, () => false, closeBelow)).toEqual(["a", "b"]);
  expect(closeBelow).not.toHaveBeenCalled();
  expect(expansion.get("below")).toBeUndefined();
});
