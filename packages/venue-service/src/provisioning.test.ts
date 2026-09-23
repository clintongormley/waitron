import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS, catalogues, locations } from "@waitron/db";
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
    // Through the insert BUILDER, not raw SQL. Two things the raw statement relied on PostgreSQL
    // for are gone: `array['en-GB']` is refused at prepare — `near "['en-GB']": syntax error` —
    // because SQLite has no array literal and `invoice_locales` is a JSON array in a TEXT column
    // that `labelList` encodes; and `locations.id` and `created_at` are JavaScript `$defaultFn`
    // generators rather than SQL DEFAULTs, which only the builder runs. Same shape as every
    // converted fixture in the tree (`packages/identity/test/fixtures.ts`).
    const [location] = await db
      .insert(locations)
      .values({ name: "Venue", invoiceLocales: ["en-GB"], operationDescription: "Hospitality" })
      .returning({ id: locations.id });
    const locationId = brandLocationId(location!.id);
    const nodeId = await seedNode(db, locationId);
    const node = { locationId, nodeId };
    const runSeed = () => db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));

    await expect(runSeed()).resolves.toBe("default department and counter zone ready");
    // The builder again, for `catalogues.id` — measured, the raw insert was refused with
    // `NOT NULL constraint failed: catalogues.id`.
    const menus = await db
      .insert(catalogues)
      .values([{ name: "Provisioned" }, { name: "Authored" }])
      .returning({ id: catalogues.id });
    await db.execute(sql`
      update locations set catalogue_id = ${menus[0]!.id} where id = ${locationId}`);
    await db.execute(sql`
      insert into zone_menus (zone_id, menu_id, display_order)
      select zone_id, ${menus[1]!.id}, 1
      from zone_service_policies`);
    await db.execute(sql`
      update zone_service_policies
      set service_mode = 'invoice_first', default_menu_id = ${menus[1]!.id}`);
    await runSeed();

    // No cast on either count. `count(*)::int` was refused before the statement ran —
    // `unrecognized token: ":"`, a colon opening a bind parameter to SQLite's parser — and the cast
    // existed only to turn the PostgreSQL driver's BigInt into a number. Measured on node v26.7.0,
    // this driver returns `select count(*)` as a JavaScript number already.
    const departments = await db.execute<{ count: number }>(sql`
      select count(*) as count from departments`);
    const zones = await db.execute<{ count: number }>(sql`
      select count(*) as count from floor_zones`);
    const policies = await db.execute<{ service_mode: string | null; default_menu_id: string }>(sql`
      select service_mode, default_menu_id from zone_service_policies`);
    expect(departments.rows[0]!.count).toBe(1);
    expect(zones.rows[0]!.count).toBe(1);
    expect(policies.rows).toEqual([
      { service_mode: "invoice_first", default_menu_id: menus[1]!.id },
    ]);
  });
});
