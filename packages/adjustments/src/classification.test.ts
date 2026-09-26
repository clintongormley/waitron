import { describe, expect, it } from "vitest";
import { ADJUSTMENTS_CHANGE_SOURCES, ADJUSTMENTS_CLASSIFICATION } from "./classification.js";

describe("ADJUSTMENTS_CLASSIFICATION", () => {
  it("classifies the reasons as replicated state, which product code may update", () => {
    expect(ADJUSTMENTS_CLASSIFICATION.map((entry) => [entry.table, entry.class])).toEqual([
      ["adjustment_reasons", "state"],
    ]);
    expect(ADJUSTMENTS_CLASSIFICATION.every((entry) => entry.appendOnly !== true)).toBe(true);
    expect(ADJUSTMENTS_CLASSIFICATION.every((entry) => entry.reason.trim().length > 0)).toBe(true);
  });

  it("feeds a change for each classified table, under the table's own name", () => {
    expect(ADJUSTMENTS_CHANGE_SOURCES).toEqual([
      { table: "adjustment_reasons", type: "adjustment_reasons" },
    ]);
  });
});
