import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  categoryDependants,
  createCatalogue,
  createCategory,
  createProduct,
  createUnit,
  deleteCategory,
  readCategory,
} from "@waitron/catalogue";
import { asAppUser, CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import type { LocationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { configureZone, createDepartment, createPreparationRoute } from "./operations.js";

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});

async function venue() {
  const tenantId = await seedTenant(suite.db);
  const location = await suite.db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Main', array['en'], 'Restaurant') returning id
  `);
  return { tenantId, locationId: location.rows[0]!.id as LocationId };
}

it("deleting a category removes its preparation routes and the category", async () => {
  const { tenantId, locationId } = await venue();
  await withTransaction(suite.db, async (tx) => {
    await asAppUser(tx);
    const category = await createCategory(tx, tenantId, { name: { en: "Drinks" } });
    await createPreparationRoute(
      tx,
      { tenantId, locationId },
      { categoryId: category.id, target: { kind: "no_preparation" } },
    );
    await expect(deleteCategory(tx, tenantId, category.id)).resolves.toBeUndefined();
    const routes = await tx.execute(
      sql`select 1 from preparation_routes where category_id = ${category.id}`,
    );
    expect(routes.rows).toHaveLength(0);
    await expect(readCategory(tx, tenantId, category.id)).rejects.toMatchObject({
      code: "category.not_found",
    });
  });
});

it("an open order keeps its copied category label after the category is deleted", async () => {
  const { tenantId, locationId } = await venue();
  await withTransaction(suite.db, async (tx) => {
    await asAppUser(tx);
    const till = await tx.execute<{ id: string }>(sql`
      insert into tills (tenant_id, location_id, name)
      values (${tenantId}, ${locationId}, 'Till') returning id
    `);
    const catalogue = await createCatalogue(tx, tenantId, { name: "Menu" });
    const category = await createCategory(tx, tenantId, { name: { en: "Bakery" } });
    const unit = await createUnit(
      tx,
      tenantId,
      { name: { en: "each" }, precision: 0, abbreviation: { en: "ea" } },
      "en",
    );
    const product = await createProduct(tx, tenantId, {
      catalogueId: catalogue.id,
      categoryId: category.id,
      name: "Bread",
      unitId: unit.id,
      unitPrice: "2.00",
      vatClass: "general",
    });
    const order = await tx.execute<{ id: string }>(sql`
      insert into working_orders (tenant_id, till_id, order_number, label)
      values (${tenantId}, ${till.rows[0]!.id}, 1, 'Historical') returning id
    `);
    await tx.execute(sql`
      insert into working_order_lines
        (tenant_id, working_order_id, line_no, product_id, name, descriptions, quantity,
         unit_price, unit_price_gross, vat_rate, line_total, category)
      values
        (${tenantId}, ${order.rows[0]!.id}, 1, ${product.id}, 'Bread', '{"en":"Bread"}'::jsonb, 1,
         2, 2, 10, 2, 'Bakery')
    `);

    await deleteCategory(tx, tenantId, category.id);
    const snapshot = await tx.execute<{ category: string | null }>(sql`
      select category from working_order_lines where tenant_id = ${tenantId}
        and working_order_id = ${order.rows[0]!.id}
    `);
    expect(snapshot.rows).toEqual([{ category: "Bakery" }]);
  });
});

it("dependants lists a category's preparation routes with station and zone names", async () => {
  const { tenantId, locationId } = await venue();
  await withTransaction(suite.db, async (tx) => {
    await asAppUser(tx);
    const category = await createCategory(tx, tenantId, { name: { en: "Grill" } });
    const zone = await tx.execute<{ id: string }>(sql`
      insert into floor_zones (tenant_id, location_id, name)
      values (${tenantId}, ${locationId}, 'Terrace') returning id`);
    const station = await tx.execute<{ id: string }>(sql`
      insert into kitchen_stations (tenant_id, location_id, name)
      values (${tenantId}, ${locationId}, 'Plancha') returning id`);
    // A route may carry a zone, and a zoned route requires the zone to be a configured service zone.
    const department = await createDepartment(
      tx,
      { tenantId, locationId },
      { name: "Restaurant", defaultServiceMode: "table_tab" },
    );
    await configureZone(
      tx,
      { tenantId, locationId },
      { zoneId: zone.rows[0]!.id, departmentId: department.id },
    );
    const routeId = await createPreparationRoute(
      tx,
      { tenantId, locationId },
      {
        categoryId: category.id,
        zoneId: zone.rows[0]!.id,
        target: { kind: "station", stationId: station.rows[0]!.id },
      },
    );
    const deps = await categoryDependants(tx, tenantId, category.id);
    expect(deps.routes).toEqual([{ id: routeId, station: "Plancha", zone: "Terrace" }]);
  });
});

it("dependants reports a no-preparation route with a null station", async () => {
  const { tenantId, locationId } = await venue();
  await withTransaction(suite.db, async (tx) => {
    await asAppUser(tx);
    const category = await createCategory(tx, tenantId, { name: { en: "Drinks" } });
    const routeId = await createPreparationRoute(
      tx,
      { tenantId, locationId },
      { categoryId: category.id, target: { kind: "no_preparation" } },
    );
    const deps = await categoryDependants(tx, tenantId, category.id);
    expect(deps.routes).toEqual([{ id: routeId, station: null, zone: null }]);
  });
});
