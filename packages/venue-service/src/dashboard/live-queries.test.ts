import { expect, it } from "vitest";
import { QUERY_DEPENDENCIES } from "./live-queries.js";

it("declares the health sources for counts, names, context, thresholds and output problems", () => {
  expect(QUERY_DEPENDENCIES.health).toEqual([
    "kitchen_stations",
    "kitchen_timing_defaults",
    "kitchen_station_timing",
    "ticket_items",
    "working_order_lines",
    "working_orders",
    "party_tables",
    "dining_tables",
    "devices",
    "station_printers",
    "printers",
    "print_jobs",
  ]);
});
