import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { readVenueTimeZone } from "./venue-time-zone.js";

// PGlite exercises the read and its location predicate; no concurrency or privilege claim is made.
let locationId: string;
const suite = usePgliteDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS],
  setup: async (db) => {
    await seedTenant(db);
    const result = await db.execute<{ id: string }>(sql`
      insert into locations (name, invoice_locales, operation_description, time_zone)
      values ('Island venue', array['es-ES'], 'Retail', 'Atlantic/Canary') returning id
    `);
    locationId = result.rows[0]!.id;
  },
});

it("reads the location's stored time zone instead of inferring it from language", async () => {
  expect(await readVenueTimeZone(suite.db, { locationId })).toBe("Atlantic/Canary");
});

it("uses UTC when the location is missing", async () => {
  await expect(readVenueTimeZone(suite.db, { locationId: randomUUID() })).resolves.toBe("UTC");
});

it.each(["", "Not/AZone"])("uses UTC for an invalid stored zone %j", async (timeZone) => {
  const result = await suite.db.execute<{ id: string }>(sql`
    insert into locations (name, invoice_locales, operation_description, time_zone)
    values ('Invalid zone venue', array['es-ES'], 'Retail', ${timeZone}) returning id
  `);
  const invalidLocationId = result.rows[0]!.id;
  try {
    expect(await readVenueTimeZone(suite.db, { locationId: invalidLocationId })).toBe("UTC");
  } finally {
    await suite.db.execute(sql`delete from locations where id = ${invalidLocationId}`);
  }
});
