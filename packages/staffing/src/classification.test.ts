import { describe, expect, it } from "vitest";
import { WORKFORCE_CLASSIFICATION, WORKFORCE_MIGRATIONS } from "@waitron/workforce";
import { STAFFING_CHANGE_SOURCES, STAFFING_TABLES } from "./classification.js";

/** This module's share of workforce's classification, which holds its tables. */
const STAFFING_CLASSIFICATION = WORKFORCE_CLASSIFICATION.filter(({ table }) =>
  (STAFFING_TABLES as readonly string[]).includes(table),
);

const TABLES = ["staffing_days", "staffing_blocks", "shift_assignments"];

describe("STAFFING_CLASSIFICATION", () => {
  it("classifies every staffing table as replicated state, none append-only", () => {
    expect(
      STAFFING_CLASSIFICATION.map((entry) => [entry.table, entry.class, entry.appendOnly]),
    ).toEqual(TABLES.map((table) => [table, "state", undefined]));
    expect(STAFFING_CLASSIFICATION.every((entry) => entry.reason.trim().length > 0)).toBe(true);
  });

  it("hands useVenueDb no append-only table", () => {
    expect(
      WORKFORCE_MIGRATIONS.appendOnlyTables.filter((table) =>
        (STAFFING_TABLES as readonly string[]).includes(table),
      ),
    ).toEqual([]);
  });

  it("feeds a change for each classified table, under the table's own name", () => {
    expect(STAFFING_CHANGE_SOURCES).toEqual(TABLES.map((table) => ({ table, type: table })));
  });
});
