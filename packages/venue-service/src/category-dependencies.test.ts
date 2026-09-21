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
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import type { LocationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { configureZone, createDepartment, createPreparationRoute } from "./operations.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});

async function venue() {
  await seedTenant(suite.db);
  const location = await suite.db.execute<{ id: string }>(sql`
    insert into locations (name, invoice_locales, operation_description) values ('Main', array['en'], 'Restaurant') returning id
  `);
  return { locationId: location.rows[0]!.id as LocationId };
}

it("deleting a category removes its preparation routes and the category", async () => {
  const { locationId } = await venue();
  await withTransaction(suite.db, async (tx) => {
    await asAppUser(tx);
    const category = await createCategory(tx, { name: { en: "Drinks" } });
    await createPreparationRoute(
      tx,
      { locationId },
      { categoryId: category.id, target: { kind: "no_preparation" } },
    );
    await expect(deleteCategory(tx, category.id)).resolves.toBeUndefined();
    const routes = await tx.execute(
      sql`select 1 from preparation_routes where category_id = ${category.id}`,
    );
    expect(routes.rows).toHaveLength(0);
    await expect(readCategory(tx, category.id)).rejects.toMatchObject({
      code: "category.not_found",
    });
  });
});

it("an open order keeps its copied category label after the category is deleted", async () => {
  const { locationId } = await venue();
  await withTransaction(suite.db, async (tx) => {
    await asAppUser(tx);
    const till = await tx.execute<{ id: string }>(sql`
      insert into tills (location_id, name) values (${locationId}, 'Till') returning id
    `);
    const catalogue = await createCatalogue(tx, { name: "Menu" });
    const category = await createCategory(tx, { name: { en: "Bakery" } });
    const unit = await createUnit(
      tx,
      { name: { en: "each" }, precision: 0, abbreviation: { en: "ea" } },
      "en",
    );
    const product = await createProduct(tx, {
      catalogueId: catalogue.id,
      categoryId: category.id,
      name: "Bread",
      unitId: unit.id,
      unitPrice: "2.00",
      vatClass: "general",
    });
    const order = await tx.execute<{ id: string }>(sql`
      insert into working_orders (till_id, order_number, label) values (${till.rows[0]!.id}, 1, 'Historical') returning id
    `);
    await tx.execute(sql`
      insert into working_order_lines (working_order_id, line_no, product_id, name, descriptions, quantity, unit_price, unit_price_gross, vat_rate, line_total, category) values (${order.rows[0]!.id}, 1, ${product.id}, 'Bread', '{"en":"Bread"}'::jsonb, 1000,
         200, 200, 1000, 200, 'Bakery')
    `);

    await deleteCategory(tx, category.id);
    // The counts come back beside the snapshot this case is about, because every number in the
    // insert above is a count at its own scale and the columns refuse none of the wrong ones:
    // one loaf is 1000 thousandths, 10.00% is 1000 basis points, and the 2.00 the product was
    // priced at is 200 cents. Written as `1` and `10` this case still passed, measured by doing
    // exactly that.
    const snapshot = await tx.execute<{
      category: string | null;
      quantity: string;
      vat_rate: string;
      line_total: string;
    }>(sql`
      select category, quantity::text as quantity, vat_rate::text as vat_rate,
             line_total::text as line_total
        from working_order_lines where working_order_id = ${order.rows[0]!.id}
    `);
    expect(snapshot.rows).toEqual([
      { category: "Bakery", quantity: "1000", vat_rate: "1000", line_total: "200" },
    ]);
  });
});

it("dependants lists a category's preparation routes with station and zone names", async () => {
  const { locationId } = await venue();
  await withTransaction(suite.db, async (tx) => {
    await asAppUser(tx);
    const category = await createCategory(tx, { name: { en: "Grill" } });
    const zone = await tx.execute<{ id: string }>(sql`
      insert into floor_zones (location_id, name) values (${locationId}, 'Terrace') returning id`);
    const station = await tx.execute<{ id: string }>(sql`
      insert into kitchen_stations (location_id, name) values (${locationId}, 'Plancha') returning id`);
    // A route may carry a zone, and a zoned route requires the zone to be a configured service zone.
    const department = await createDepartment(
      tx,
      { locationId },
      { name: "Restaurant", defaultServiceMode: "table_tab" },
    );
    await configureZone(
      tx,
      { locationId },
      { zoneId: zone.rows[0]!.id, departmentId: department.id },
    );
    const routeId = await createPreparationRoute(
      tx,
      { locationId },
      {
        categoryId: category.id,
        zoneId: zone.rows[0]!.id,
        target: { kind: "station", stationId: station.rows[0]!.id },
      },
    );
    const deps = await categoryDependants(tx, category.id);
    expect(deps.routes).toEqual([{ id: routeId, station: "Plancha", zone: "Terrace" }]);
  });
});

it("dependants reports a no-preparation route with a null station", async () => {
  const { locationId } = await venue();
  await withTransaction(suite.db, async (tx) => {
    await asAppUser(tx);
    const category = await createCategory(tx, { name: { en: "Drinks" } });
    const routeId = await createPreparationRoute(
      tx,
      { locationId },
      { categoryId: category.id, target: { kind: "no_preparation" } },
    );
    const deps = await categoryDependants(tx, category.id);
    expect(deps.routes).toEqual([{ id: routeId, station: null, zone: null }]);
  });
});
