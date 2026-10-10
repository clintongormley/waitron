import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { newId, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { venueWallClockAt } from "./wall-clock.js";
import { BOOKINGS_TEST_MIGRATIONS } from "./testing/migrations.js";

const suite = useVenueDb({ migrations: BOOKINGS_TEST_MIGRATIONS, timeoutMs: 60_000 });

let db: Database;
beforeAll(async () => {
  db = suite.db;
  await seedTenant(db);
});

async function makeLocation(timeZone: string): Promise<string> {
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (id, name, invoice_locales, operation_description, time_zone)
    values (${newId()}, 'Barra', '["es-ES"]', 'Venta en establecimiento', ${timeZone})
    returning id`);
  return loc.rows[0]!.id;
}

// 00:30 on 2026-09-16 in Madrid (CEST), 18:30 on 2026-09-15 in New York (EDT).
const NOW = new Date("2026-09-15T22:30:00Z");

describe("venueWallClockAt", () => {
  it("reads the clock in the location's zone", async () => {
    const id = await makeLocation("America/New_York");
    await expect(withTransaction(db, (tx) => venueWallClockAt(tx, id, NOW))).resolves.toEqual({
      date: "2026-09-15",
      time: "18:30",
    });
  });

  it("reads the clock in the default zone when no location has the id", async () => {
    await expect(withTransaction(db, (tx) => venueWallClockAt(tx, newId(), NOW))).resolves.toEqual({
      date: "2026-09-16",
      time: "00:30",
    });
  });
});
