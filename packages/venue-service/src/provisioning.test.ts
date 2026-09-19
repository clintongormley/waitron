import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { VENUE_SERVICE_PROVISIONING } from "./provisioning.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

describe("VENUE_SERVICE_PROVISIONING", () => {
  it("seeds one counter policy idempotently without resetting authored mode", async () => {
    await seedTenant(db);
    const location = await db.execute<{ id: string }>(sql`
      insert into locations (name, invoice_locales, operation_description) values ('Venue', array['en-GB'], 'Hospitality') returning id`);
    const locationId = brandLocationId(location.rows[0]!.id);
    const nodeId = await seedNode(db, locationId);
    const node = { locationId, nodeId };
    const runSeed = () => db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));

    await expect(runSeed()).resolves.toBe("default department and counter zone ready");
    const menus = await db.execute<{ id: string }>(sql`
      insert into catalogues (name) values ('Provisioned'), ( 'Authored') returning id`);
    await db.execute(sql`
      update locations set catalogue_id = ${menus.rows[0]!.id} where id = ${locationId}`);
    await db.execute(sql`
      insert into zone_menus (zone_id, menu_id, display_order)
      select zone_id, ${menus.rows[1]!.id}, 1
      from zone_service_policies`);
    await db.execute(sql`
      update zone_service_policies
      set service_mode = 'invoice_first', default_menu_id = ${menus.rows[1]!.id}`);
    await runSeed();

    const departments = await db.execute<{ count: number }>(sql`
      select count(*)::int as count from departments`);
    const zones = await db.execute<{ count: number }>(sql`
      select count(*)::int as count from floor_zones`);
    const policies = await db.execute<{ service_mode: string | null; default_menu_id: string }>(sql`
      select service_mode, default_menu_id from zone_service_policies`);
    expect(departments.rows[0]!.count).toBe(1);
    expect(zones.rows[0]!.count).toBe(1);
    expect(policies.rows).toEqual([
      { service_mode: "invoice_first", default_menu_id: menus.rows[1]!.id },
    ]);
  });
});
