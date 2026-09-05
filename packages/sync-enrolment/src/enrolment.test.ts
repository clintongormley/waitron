import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { SYNC_LANES, enrol, tablesForLane, type EnrolledTable } from "./index.js";

// A throwaway Drizzle table so enrol() has real columns to read — proves columns are DERIVED, not
// passed. Column names (not the JS keys) are what enrol must capture.
const fixture = pgTable("fixture_widgets", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name").notNull(),
});

describe("enrol", () => {
  it("derives the physical table name and the ordered column-name list from the Drizzle table", () => {
    const e = enrol(fixture, {
      mode: "watermark-upsert",
      conflictKey: ["id"],
      watermarkColumn: null,
      captureOps: ["insert", "update"],
      fkRank: 0,
      lane: "ordered",
    });
    expect(e.table).toBe("fixture_widgets");
    expect(e.columns).toEqual(["id", "display_name"]);
    expect(e.mode).toBe("watermark-upsert");
    expect(e.conflictKey).toEqual(["id"]);
    expect(e.lane).toBe("ordered");
  });

  it("defaults configClass to false when the caller omits it (membership Slice 7)", () => {
    const e = enrol(fixture, {
      mode: "watermark-upsert",
      conflictKey: ["id"],
      watermarkColumn: null,
      captureOps: ["insert", "update"],
      fkRank: 0,
      lane: "ordered",
    });
    expect(e.configClass).toBe(false);
  });

  it("carries configClass: true when the caller marks the table config-class (membership Slice 7)", () => {
    const e = enrol(fixture, {
      mode: "watermark-upsert",
      conflictKey: ["id"],
      watermarkColumn: null,
      captureOps: ["insert", "update"],
      fkRank: 0,
      lane: "ordered",
      configClass: true,
    });
    expect(e.configClass).toBe(true);
  });
});

describe("tablesForLane", () => {
  const enrolments: EnrolledTable[] = [
    enrol(fixture, {
      mode: "watermark-upsert",
      conflictKey: ["id"],
      watermarkColumn: null,
      captureOps: ["insert"],
      fkRank: 0,
      lane: "ordered",
    }),
    enrol(pgTable("fixture_fast", { id: uuid("id").primaryKey() }), {
      mode: "insert-only",
      conflictKey: ["id"],
      watermarkColumn: null,
      captureOps: ["insert"],
      fkRank: 0,
      lane: "fast",
    }),
  ];
  it("returns only the tables on the named lane", () => {
    expect(tablesForLane(enrolments, "fast")).toEqual(["fixture_fast"]);
    expect(tablesForLane(enrolments, "ordered")).toEqual(["fixture_widgets"]);
  });
});

describe("SYNC_LANES", () => {
  it("is exactly the two lanes", () => {
    expect(SYNC_LANES).toEqual(["ordered", "fast"]);
  });
});
