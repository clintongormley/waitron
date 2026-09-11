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

it("refuses a location belonging to a different tenant", async () => {
  await expect(
    readVenueTimeZone(suite.db, { tenantId: otherTenantId, locationId }),
  ).rejects.toMatchObject({ code: "server.config_invalid" });
});

it("refuses a missing location", async () => {
  await expect(
    readVenueTimeZone(suite.db, { tenantId, locationId: randomUUID() }),
  ).rejects.toMatchObject({ code: "server.config_invalid" });
});
