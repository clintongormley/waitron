import { describe, expect, it } from "vitest";
import { VENUE_SERVICE_CLASSIFICATION } from "./classification.js";

describe("VENUE_SERVICE_CLASSIFICATION", () => {
  it("replicates opening hours, station fallbacks and today's state", () => {
    const timing = [
      "station_hours",
      "department_hours",
      "station_fallbacks",
      "station_day_states",
      "hours_week_cells",
      "hours_week_periods",
      "special_dates",
      "special_date_hours",
      "special_date_hours_periods",
    ];
    expect(
      VENUE_SERVICE_CLASSIFICATION.filter((entry) => timing.includes(entry.table)).map((entry) => [
        entry.table,
        entry.class,
      ]),
    ).toEqual([
      ["station_fallbacks", "state"],
      ["station_day_states", "state"],
      ["hours_week_cells", "state"],
      ["hours_week_periods", "state"],
      ["special_dates", "state"],
      ["special_date_hours", "state"],
      ["special_date_hours_periods", "state"],
    ]);
  });
  it("copies stored claims and exceptions as replicated state", () => {
    expect(
      VENUE_SERVICE_CLASSIFICATION.filter((entry) =>
        ["station_claims", "route_exceptions"].includes(entry.table),
      ).map((entry) => [entry.table, entry.class]),
    ).toEqual([
      ["station_claims", "state"],
      ["route_exceptions", "state"],
    ]);
  });
  it("classifies the service settings and kitchen notices as replicated state", () => {
    expect(
      VENUE_SERVICE_CLASSIFICATION.filter((entry) =>
        ["service_settings", "kitchen_notices"].includes(entry.table),
      ).map((entry) => [entry.table, entry.class]),
    ).toEqual([
      ["service_settings", "state"],
      ["kitchen_notices", "state"],
    ]);
  });

  it("classifies each owned table once, with only issued receipt headers in the ledger", () => {
    const tables = VENUE_SERVICE_CLASSIFICATION.map((entry) => entry.table);
    expect(new Set(tables).size).toBe(tables.length);
    expect(
      VENUE_SERVICE_CLASSIFICATION.filter((entry) => entry.class !== "state").map((entry) => [
        entry.table,
        entry.class,
      ]),
    ).toEqual([["sale_receipt_headers", "ledger"]]);
    expect(VENUE_SERVICE_CLASSIFICATION.every((entry) => entry.reason.trim().length > 0)).toBe(
      true,
    );
  });
});
