import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  catalogues,
  categories,
  diningTables,
  floorZones,
  kitchenCourses,
  kitchenStations,
  products,
  saleLines,
  saleSettlements,
  saleSubstitutions,
  saleVoids,
  sales,
  tableServiceStatuses,
  tenders,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "./index.js";
import { CORE_ENROLMENT } from "./enrolment.js";

const byName = new Map(CORE_ENROLMENT.map((e) => [e.table, e]));
const SCHEMA = {
  sales,
  sale_lines: saleLines,
  tenders,
  sale_settlements: saleSettlements,
  sale_substitutions: saleSubstitutions,
  sale_voids: saleVoids,
  catalogues,
  categories,
  products,
  working_orders: workingOrders,
  working_order_lines: workingOrderLines,
  dining_tables: diningTables,
  floor_zones: floorZones,
  table_service_statuses: tableServiceStatuses,
  kitchen_stations: kitchenStations,
  kitchen_courses: kitchenCourses,
  ticket_items: ticketItems,
} as const;

describe("CORE_ENROLMENT", () => {
  it("enrols exactly the 17 core-resident tables", () => {
    expect([...byName.keys()].sort()).toEqual(Object.keys(SCHEMA).sort());
    expect(CORE_ENROLMENT).toHaveLength(17);
  });

  it("each entry's columns equal getTableColumns(schema) — derived, cannot drift", () => {
    for (const [table, drizzleTable] of Object.entries(SCHEMA)) {
      const e = byName.get(table);
      if (e === undefined) throw new Error(`missing enrolment for ${table}`);
      const expected = Object.values(getTableColumns(drizzleTable)).map((c) => c.name);
      expect(e.columns).toEqual(expected);
    }
  });

  it("pins the representative metadata (sales insert-only, working_orders group-C, payment none here)", () => {
    expect(byName.get("sales")).toMatchObject({
      mode: "insert-only",
      conflictKey: ["id"],
      watermarkColumn: null,
      captureOps: ["insert"],
      fkRank: 3,
      lane: "ordered",
    });
    expect(byName.get("catalogues")).toMatchObject({
      mode: "watermark-upsert",
      watermarkColumn: "updated_at",
      captureOps: ["insert", "update"],
      fkRank: 0,
      lane: "ordered",
    });
    expect(byName.get("working_orders")).toMatchObject({
      mode: "watermark-upsert",
      watermarkColumn: null,
      captureOps: ["insert", "update", "delete"],
      fkRank: 2,
      lane: "ordered",
    });
  });

  it("every non-null watermarkColumn is a real column of its table", () => {
    for (const e of CORE_ENROLMENT) {
      if (e.watermarkColumn !== null) expect(e.columns).toContain(e.watermarkColumn);
    }
  });
});
