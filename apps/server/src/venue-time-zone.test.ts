import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS, locations } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { readVenueTimeZone } from "./venue-time-zone.js";

// PGlite exercises the read and its location predicate; no concurrency or privilege claim is made.
let locationId: string;
const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS],
  setup: async (db) => {
    await seedTenant(db);
    // Inserted through the table definition, as `apps/server/src/testing/fiscal-fixtures.ts` is:
    // `locations.id` is a `$defaultFn(newId)` generator that a raw insert never reaches, and
    // `invoice_locales` is a JSON array in a text column rather than a PostgreSQL `text[]`.
    const [location] = await db
      .insert(locations)
      .values({
        name: "Island venue",
        invoiceLocales: ["es-ES"],
        operationDescription: "Retail",
        timeZone: "Atlantic/Canary",
      })
      .returning({ id: locations.id });
    locationId = location!.id;
  },
});

it("reads the location's stored time zone instead of inferring it from language", async () => {
  expect(await readVenueTimeZone(suite.db, { locationId })).toBe("Atlantic/Canary");
});

it("uses UTC when the location is missing", async () => {
  await expect(readVenueTimeZone(suite.db, { locationId: randomUUID() })).resolves.toBe("UTC");
});

it.each(["", "Not/AZone"])("uses UTC for an invalid stored zone %j", async (timeZone) => {
  const [location] = await suite.db
    .insert(locations)
    .values({
      name: "Invalid zone venue",
      invoiceLocales: ["es-ES"],
      operationDescription: "Retail",
      timeZone,
    })
    .returning({ id: locations.id });
  const invalidLocationId = location!.id;
  try {
    expect(await readVenueTimeZone(suite.db, { locationId: invalidLocationId })).toBe("UTC");
  } finally {
    await suite.db.execute(sql`delete from locations where id = ${invalidLocationId}`);
  }
});
