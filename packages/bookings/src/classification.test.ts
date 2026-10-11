import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  CORE_CHANGE_SOURCES,
  diningTables,
  floorTodayTables,
  floorZones,
  installChangeFeed,
  locations,
  subscribeToChanges,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { locationId } from "@waitron/shared";
import type { ResourceChange } from "@waitron/shared";
import { BOOKINGS_TEST_MIGRATIONS } from "./testing/migrations.js";
import { createBooking, updateBooking, cancelBooking } from "./bookings.js";
import { BOOKINGS_CHANGE_SOURCES } from "./classification.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOOKINGS_CLASSIFICATION } from "./classification.js";

const DRIZZLE = join(import.meta.dirname, "..", "drizzle");

function tablesInDrizzle(): string[] {
  const names: string[] = [];
  for (const file of readdirSync(DRIZZLE).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(join(DRIZZLE, file), "utf8");
    for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?[`"]?([a-z0-9_]+)[`"]?/gi)) {
      names.push(m[1]!);
    }
  }
  return names;
}

describe("BOOKINGS_CLASSIFICATION", () => {
  it("has a valid class and a non-empty reason for every entry", () => {
    for (const c of BOOKINGS_CLASSIFICATION) {
      expect(["ledger", "state", "local"]).toContain(c.class);
      expect(c.reason.trim().length).toBeGreaterThan(0);
    }
  });
  it("names each table at most once", () => {
    const names = BOOKINGS_CLASSIFICATION.map((c) => c.table);
    expect(new Set(names).size).toBe(names.length);
  });
  it("classifies exactly the tables this module's migrations create", () => {
    const classified = new Set(BOOKINGS_CLASSIFICATION.map((c) => c.table));
    const created = new Set(tablesInDrizzle());
    // The control: the next assertion passes against an empty `created`, so it says nothing unless
    // the scan found the migrations.
    expect(created.size).toBeGreaterThan(0);
    expect([...created].filter((t) => !classified.has(t)).sort()).toEqual([]);
    expect([...classified].filter((t) => !created.has(t)).sort()).toEqual([]);
  });
});

describe("booking change interests", () => {
  const suite = useVenueDb({ migrations: BOOKINGS_TEST_MIGRATIONS });
  it("booking create/move/cancel invalidates old and new table interests", async () => {
    await seedTenant(suite.db);
    const [loc] = await suite.db
      .insert(locations)
      .values({ name: "Events", invoiceLocales: ["es"], operationDescription: "test" })
      .returning();
    const cfg = { locationId: locationId(loc!.id) };
    const [zone] = await suite.db
      .insert(floorZones)
      .values({ locationId: cfg.locationId, name: "Events" })
      .returning();
    const tables = await suite.db
      .insert(diningTables)
      .values(
        ["Old", "New"].map((label) => ({ locationId: cfg.locationId, zoneId: zone!.id, label })),
      )
      .returning();
    for (const table of tables)
      await suite.db.insert(floorTodayTables).values({ tableId: table.id });
    const oldId = tables[0]!.id;
    const newId = tables[1]!.id;
    await installChangeFeed(suite.db, [...CORE_CHANGE_SOURCES, ...BOOKINGS_CHANGE_SOURCES]);
    const events: ResourceChange[] = [];
    const unsubscribe = subscribeToChanges((event) => {
      events.push(event);
    });
    try {
      const { id } = await withTransaction(suite.db, (tx) =>
        createBooking(tx, cfg, {
          tableId: oldId,
          bookingDate: "2026-10-11",
          bookingTime: "20:00",
          partySize: 2,
          contactName: "Ana",
          createdBy: randomUUID(),
        }),
      );
      expect(events).toEqual([
        {
          resources: [
            { type: "bookings", id },
            { type: "dining_tables", id: oldId },
          ],
        },
      ]);
      events.length = 0;
      await withTransaction(suite.db, (tx) => updateBooking(tx, cfg, id, { tableId: newId }));
      expect(events).toEqual([
        {
          resources: [
            { type: "bookings", id },
            { type: "dining_tables", id: oldId },
          ],
        },
        {
          resources: [
            { type: "bookings", id },
            { type: "dining_tables", id: newId },
          ],
        },
      ]);
      events.length = 0;
      await withTransaction(suite.db, (tx) => cancelBooking(tx, cfg, id));
      expect(events).toEqual([
        {
          resources: [
            { type: "bookings", id },
            { type: "dining_tables", id: newId },
          ],
        },
        {
          resources: [
            { type: "bookings", id },
            { type: "dining_tables", id: newId },
          ],
        },
      ]);
      expect(
        suite.db.execute<{ n: number }>(sql`select count(*) as n from change_log`).rows[0]!.n,
      ).toBe(0);
    } finally {
      unsubscribe();
    }
  });
});
