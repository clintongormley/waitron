import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { readVenueTimeZone } from "./venue-time-zone.js";

// PGlite exercises the read and tenant predicate; no concurrency or privilege claim is made.
let tenantId: string;
let otherTenantId: string;
let locationId: string;
const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS],
  setup: async (db) => {
    tenantId = await seedTenant(db);
    otherTenantId = await seedTenant(db);
    const result = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description, time_zone)
      values (${tenantId}, 'Island venue', array['es-ES'], 'Retail', 'Atlantic/Canary') returning id
    `);
    locationId = result.rows[0]!.id;
  },
});

it("reads the location's stored time zone instead of inferring it from language", async () => {
  expect(await readVenueTimeZone(suite.db, { tenantId, locationId })).toBe("Atlantic/Canary");
});

it("uses UTC for a location belonging to a different tenant", async () => {
  await expect(readVenueTimeZone(suite.db, { tenantId: otherTenantId, locationId })).resolves.toBe(
    "UTC",
  );
});

it("uses UTC when the location is missing", async () => {
  await expect(readVenueTimeZone(suite.db, { tenantId, locationId: randomUUID() })).resolves.toBe(
    "UTC",
  );
});

it.each(["", "Not/AZone"])("uses UTC for an invalid stored zone %j", async (timeZone) => {
  const result = await suite.db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description, time_zone)
    values (${tenantId}, 'Invalid zone venue', array['es-ES'], 'Retail', ${timeZone}) returning id
  `);
  const invalidLocationId = result.rows[0]!.id;
  try {
    expect(await readVenueTimeZone(suite.db, { tenantId, locationId: invalidLocationId })).toBe(
      "UTC",
    );
  } finally {
    await suite.db.execute(sql`delete from locations where id = ${invalidLocationId}`);
  }
});
