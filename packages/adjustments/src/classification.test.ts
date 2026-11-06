import { describe, expect, it } from "vitest";
import { CORE_CLASSIFICATION, CORE_MIGRATIONS } from "@waitron/db";
import { ADJUSTMENTS_CHANGE_SOURCES, ADJUSTMENTS_TABLES } from "./classification.js";

/** This module's share of core's classification, which holds its tables. */
const ADJUSTMENTS_CLASSIFICATION = CORE_CLASSIFICATION.filter(({ table }) =>
  (ADJUSTMENTS_TABLES as readonly string[]).includes(table),
);

describe("ADJUSTMENTS_CLASSIFICATION", () => {
  it("classifies the reasons as replicated state and the adjustments as an append-only ledger", () => {
    expect(
      ADJUSTMENTS_CLASSIFICATION.map((entry) => [entry.table, entry.class, entry.appendOnly]),
    ).toEqual([
      ["adjustment_reasons", "state", undefined],
      ["adjustments", "ledger", true],
      ["adjustment_settings", "state", undefined],
      ["adjustment_refunds", "ledger", true],
      ["adjustment_lines", "ledger", true],
    ]);
    expect(ADJUSTMENTS_CLASSIFICATION.every((entry) => entry.reason.trim().length > 0)).toBe(true);
  });

  it("carries the append-only table in the migration set a suite hands useVenueDb", () => {
    expect(
      CORE_MIGRATIONS.appendOnlyTables.filter((table) =>
        (ADJUSTMENTS_TABLES as readonly string[]).includes(table),
      ),
    ).toEqual(["adjustments", "adjustment_refunds", "adjustment_lines"]);
  });

  it("feeds a change for each classified table, under the table's own name", () => {
    expect(ADJUSTMENTS_CHANGE_SOURCES).toEqual([
      { table: "adjustment_reasons", type: "adjustment_reasons" },
      { table: "adjustments", type: "adjustments" },
      { table: "adjustment_settings", type: "adjustment_settings" },
      { table: "adjustment_refunds", type: "adjustment_refunds" },
      { table: "adjustment_lines", type: "adjustment_lines" },
    ]);
  });
});
