import { describe, expect, it } from "vitest";
import { ADJUSTMENTS_CHANGE_SOURCES, ADJUSTMENTS_CLASSIFICATION } from "./classification.js";
import { ADJUSTMENTS_MIGRATIONS } from "./migrations.js";

describe("ADJUSTMENTS_CLASSIFICATION", () => {
  it("classifies the reasons as replicated state and the adjustments as an append-only ledger", () => {
    expect(
      ADJUSTMENTS_CLASSIFICATION.map((entry) => [entry.table, entry.class, entry.appendOnly]),
    ).toEqual([
      ["adjustment_reasons", "state", undefined],
      ["adjustments", "ledger", true],
      ["adjustment_settings", "state", undefined],
    ]);
    expect(ADJUSTMENTS_CLASSIFICATION.every((entry) => entry.reason.trim().length > 0)).toBe(true);
  });

  it("carries the append-only table in the migration set a suite hands useVenueDb", () => {
    expect(ADJUSTMENTS_MIGRATIONS.appendOnlyTables).toEqual(["adjustments"]);
  });

  it("feeds a change for each classified table, under the table's own name", () => {
    expect(ADJUSTMENTS_CHANGE_SOURCES).toEqual([
      { table: "adjustment_reasons", type: "adjustment_reasons" },
      { table: "adjustments", type: "adjustments" },
      { table: "adjustment_settings", type: "adjustment_settings" },
    ]);
  });
});
