import { describe, expect, it } from "vitest";
import { CORE_CLASSIFICATION } from "@waitron/db";
import { VENUE_SERVICE_TABLES } from "./classification.js";

/** This module's share of core's classification, which holds its tables. */
const VENUE_SERVICE_CLASSIFICATION = CORE_CLASSIFICATION.filter(({ table }) =>
  (VENUE_SERVICE_TABLES as readonly string[]).includes(table),
);

describe("VENUE_SERVICE_CLASSIFICATION", () => {
  it("copies today's zone extensions as state", () => {
    expect(
      CORE_CLASSIFICATION.filter((entry) => entry.table === "floor_zones").map((entry) => [
        entry.table,
        entry.class,
      ]),
    ).toEqual([["floor_zones", "state"]]);
  });
  it("does not copy the retired local-holiday table", () => {
    expect(CORE_CLASSIFICATION.map((entry) => entry.table)).not.toContain("local_holidays");
  });
  it("copies a period's staff-only menu choices as state", () => {
    expect(
      VENUE_SERVICE_CLASSIFICATION.filter((entry) => entry.table === "menu_periods").map(
        (entry) => [entry.table, entry.class],
      ),
    ).toEqual([["menu_periods", "state"]]);
  });
  it("replicates opening hours, station fallbacks and today's state", () => {
    const timing = ["station_hours", "department_hours", "kitchen_stations"];
    expect(
      CORE_CLASSIFICATION.filter((entry) => timing.includes(entry.table)).map((entry) => [
        entry.table,
        entry.class,
      ]),
    ).toEqual([["kitchen_stations", "state"]]);
  });
  it("classifies routing_cells as replicated state", () => {
    expect(
      VENUE_SERVICE_CLASSIFICATION.filter((entry) => entry.table === "routing_cells").map(
        (entry) => [entry.table, entry.class],
      ),
    ).toEqual([["routing_cells", "state"]]);
  });
  it("classifies the kitchen screens profiles configure as replicated state", () => {
    expect(
      CORE_CLASSIFICATION.filter((entry) => entry.table === "device_profiles").map((entry) => [
        entry.table,
        entry.class,
      ]),
    ).toEqual([["device_profiles", "state"]]);
  });
  it("classifies a routing cell's period choices as replicated state", () => {
    expect(
      VENUE_SERVICE_CLASSIFICATION.filter((entry) => entry.table === "routing_cell_periods").map(
        (entry) => [entry.table, entry.class],
      ),
    ).toEqual([["routing_cell_periods", "state"]]);
  });
  it("classifies the kitchen notices as replicated state", () => {
    expect(
      VENUE_SERVICE_CLASSIFICATION.filter((entry) => entry.table === "kitchen_notices").map(
        (entry) => [entry.table, entry.class],
      ),
    ).toEqual([["kitchen_notices", "state"]]);
  });
  it("classifies seasons, special days and their day rows as replicated state", () => {
    const seasons = ["seasons", "special_days", "special_day_dates", "opening_hours"];
    expect(
      VENUE_SERVICE_CLASSIFICATION.filter((entry) => seasons.includes(entry.table)).map((entry) => [
        entry.table,
        entry.class,
      ]),
    ).toEqual(seasons.map((table) => [table, "state"]));
  });

  it("classifies each owned table once, with issued receipt headers and the bill-number history in the ledger", () => {
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
