import { describe, expect, it } from "vitest";
import { STAFFING_CHANGE_SOURCES, STAFFING_CLASSIFICATION } from "./classification.js";
import { STAFFING_MIGRATIONS } from "./migrations.js";

const TABLES = [
  "staff_roles",
  "person_staff_roles",
  "staffing_days",
  "staffing_blocks",
  "shift_assignments",
];

describe("STAFFING_CLASSIFICATION", () => {
  it("classifies every staffing table as replicated state, none append-only", () => {
    expect(
      STAFFING_CLASSIFICATION.map((entry) => [entry.table, entry.class, entry.appendOnly]),
    ).toEqual(TABLES.map((table) => [table, "state", undefined]));
    expect(STAFFING_CLASSIFICATION.every((entry) => entry.reason.trim().length > 0)).toBe(true);
  });

  it("hands useVenueDb no append-only table", () => {
    expect(STAFFING_MIGRATIONS.appendOnlyTables).toEqual([]);
  });

  it("feeds a change for each classified table, under the table's own name", () => {
    expect(STAFFING_CHANGE_SOURCES).toEqual(TABLES.map((table) => ({ table, type: table })));
  });
});
