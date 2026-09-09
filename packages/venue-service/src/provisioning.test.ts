import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS } from "@waitron/db";
import type { Database } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { VENUE_SERVICE_PROVISIONING } from "./provisioning.js";

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

describe("VENUE_SERVICE_PROVISIONING", () => {
  it("seeds one counter policy idempotently without resetting authored mode", async () => {
    const tenantId = await seedTenant(db);
    const location = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Venue', array['en-GB'], 'Hospitality') returning id`);
    const locationId = brandLocationId(location.rows[0]!.id);
    const nodeId = await seedNode(db, tenantId, locationId);
    const node = { tenantId, locationId, nodeId };
    const runSeed = () => db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));

    await expect(runSeed()).resolves.toBe("default department and counter zone ready");
    await db.execute(sql`update zone_service_policies set service_mode = 'invoice_first'`);
    await runSeed();

    const departments = await db.execute<{ count: number }>(sql`
      select count(*)::int as count from departments where tenant_id = ${tenantId}`);
    const zones = await db.execute<{ count: number }>(sql`
      select count(*)::int as count from floor_zones where tenant_id = ${tenantId}`);
    const policies = await db.execute<{ service_mode: string | null }>(sql`
      select service_mode from zone_service_policies where tenant_id = ${tenantId}`);
    expect(departments.rows[0]!.count).toBe(1);
    expect(zones.rows[0]!.count).toBe(1);
    expect(policies.rows).toEqual([{ service_mode: "invoice_first" }]);
  });
});
