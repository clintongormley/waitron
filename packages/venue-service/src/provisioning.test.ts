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
  it("names the default department after the venue", async () => {
    await seedTenant(db);
    const [location] = await db
      .insert(locations)
      .values({
        name: "La Plaza",
        invoiceLocales: ["es-ES"],
        operationDescription: "Restaurante",
      })
      .returning({ id: locations.id });
    const locationId = brandLocationId(location!.id);
    const node = { locationId, nodeId: await seedNode(db, locationId) };

    await db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));

    const rows = await db.execute<{ name: string; trading_name: string }>(sql`
      select name, trading_name from departments where location_id = ${locationId}`);
    expect(rows.rows).toEqual([{ name: "La Plaza", trading_name: "La Plaza" }]);
  });

  it("seeds quick-sale and receipt defaults without a zone override", async () => {
    await seedTenant(db);
    const [location] = await db
      .insert(locations)
      .values({
        name: "Corner Kitchen",
        invoiceLocales: ["en-GB"],
        operationDescription: "Hospitality",
      })
      .returning({ id: locations.id });
    const locationId = brandLocationId(location!.id);
    const node = { locationId, nodeId: await seedNode(db, locationId) };

    await db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));

    const department = await db.execute<{
      paid_when: string;
      collection_number: string;
      receipt_print_mode: string;
      print_trading_name: number;
    }>(sql`
      select paid_when, collection_number, receipt_print_mode, print_trading_name
      from department_sale_policies
      where department_id = (
        select id from departments where location_id = ${locationId} and is_default = 1
      )`);
    expect(department.rows).toEqual([
      {
        paid_when: "prepay",
        collection_number: "none",
        receipt_print_mode: "auto",
        print_trading_name: 1,
      },
    ]);
    const zone = await db.execute<{
      paid_when: string | null;
      collection_number: string | null;
      receipt_print_mode: string | null;
    }>(sql`
      select paid_when, collection_number, receipt_print_mode
      from zone_sale_policies
      where zone_id = (
        select zone_id from zone_service_policies
        where location_id = ${locationId} and is_counter_default = 1
      )`);
    expect(zone.rows).toEqual([
      { paid_when: null, collection_number: null, receipt_print_mode: null },
    ]);
  });

  it("seeds one counter policy idempotently without resetting authored mode", async () => {
    await seedTenant(db);
    const [location] = await db
      .insert(locations)
      .values({ name: "Venue", invoiceLocales: ["en-GB"], operationDescription: "Hospitality" })
      .returning({ id: locations.id });
    const locationId = brandLocationId(location!.id);
    const nodeId = await seedNode(db, locationId);
    const node = { locationId, nodeId };
    const runSeed = () => db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));

    await expect(runSeed()).resolves.toBe(
      "default department, counter zone and service settings ready",
    );
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
      set service_mode = 'ticket_then_pay', default_menu_id = ${menus[1]!.id}`);
    await runSeed();

    const departments = await db.execute<{ count: number }>(sql`
      select count(*) as count from departments`);
    const zones = await db.execute<{ count: number }>(sql`
      select count(*) as count from floor_zones`);
    const policies = await db.execute<{ service_mode: string | null; default_menu_id: string }>(sql`
      select service_mode, default_menu_id from zone_service_policies`);
    expect(departments.rows[0]!.count).toBe(1);
    expect(zones.rows[0]!.count).toBe(1);
    expect(policies.rows).toEqual([
      { service_mode: "ticket_then_pay", default_menu_id: menus[1]!.id },
    ]);
  });

  it("seeds the service settings row with changes to sent items allowed, and keeps a later choice", async () => {
    await seedTenant(db);
    const [location] = await db
      .insert(locations)
      .values({ name: "Venue", invoiceLocales: ["en-GB"], operationDescription: "Hospitality" })
      .returning({ id: locations.id });
    const locationId = brandLocationId(location!.id);
    const node = { locationId, nodeId: await seedNode(db, locationId) };
    const runSeed = () => db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, node));
    const settings = async () =>
      (await db.execute(sql`select id, edit_sent_lines from service_settings`)).rows;

    await runSeed();
    expect(await settings()).toEqual([{ id: 1, edit_sent_lines: 1 }]);
    await db.execute(sql`update service_settings set edit_sent_lines = 0`);
    await runSeed();
    expect(await settings()).toEqual([{ id: 1, edit_sent_lines: 0 }]);
  });
});
