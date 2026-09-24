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
import {
  CORE_MIGRATIONS,
  floorZones,
  kitchenStations,
  locations,
  tills,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import { randomUUID } from "node:crypto";
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
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Main", invoiceLocales: ["en"], operationDescription: "Restaurant" })
    .returning({ id: locations.id });
  return { locationId: location!.id as LocationId };
}

it("deleting a category removes its preparation routes and the category", async () => {
  const { locationId } = await venue();
  await withTransaction(suite.db, async (tx) => {
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
    const [till] = await tx
      .insert(tills)
      .values({ locationId, name: "Till" })
      .returning({ id: tills.id });
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
    const [order] = await tx
      .insert(workingOrders)
      .values({ tillId: till!.id, orderNumber: 1, label: "Historical" })
      .returning({ id: workingOrders.id });
    // Raw SQL so the stored counts are written literally; `id` is named because only the insert
    // builder generates one.
    await tx.execute(sql`
      insert into working_order_lines (id, working_order_id, line_no, product_id, name, descriptions, quantity, unit_price, unit_price_gross, vat_rate, line_total, category) values (${randomUUID()}, ${order!.id}, 1, ${product.id}, 'Bread', '{"en":"Bread"}', 1000,
         200, 200, 1000, 200, 'Bakery')
    `);

    await deleteCategory(tx, category.id);
    // The counts are read back because each is at its own scale and the columns refuse none of
    // the wrong ones: one loaf is 1000 thousandths, 10.00% is 1000 basis points, 2.00 is 200 cents.
    const snapshot = await tx.execute<{
      category: string | null;
      quantity: string;
      vat_rate: string;
      line_total: string;
    }>(sql`
      select category, cast(quantity as text) as quantity, cast(vat_rate as text) as vat_rate,
             cast(line_total as text) as line_total
        from working_order_lines where working_order_id = ${order!.id}
    `);
    expect(snapshot.rows).toEqual([
      { category: "Bakery", quantity: "1000", vat_rate: "1000", line_total: "200" },
    ]);
  });
});

it("dependants lists a category's preparation routes with station and zone names", async () => {
  const { locationId } = await venue();
  await withTransaction(suite.db, async (tx) => {
    const category = await createCategory(tx, { name: { en: "Grill" } });
    const [zone] = await tx
      .insert(floorZones)
      .values({ locationId, name: "Terrace" })
      .returning({ id: floorZones.id });
    const [station] = await tx
      .insert(kitchenStations)
      .values({ locationId, name: "Plancha" })
      .returning({ id: kitchenStations.id });
    // A route may carry a zone, and a zoned route requires the zone to be a configured service zone.
    const department = await createDepartment(
      tx,
      { locationId },
      { name: "Restaurant", defaultServiceMode: "table_tab" },
    );
    await configureZone(tx, { locationId }, { zoneId: zone!.id, departmentId: department.id });
    const routeId = await createPreparationRoute(
      tx,
      { locationId },
      {
        categoryId: category.id,
        zoneId: zone!.id,
        target: { kind: "station", stationId: station!.id },
      },
    );
    const deps = await categoryDependants(tx, category.id);
    expect(deps.routes).toEqual([{ id: routeId, station: "Plancha", zone: "Terrace" }]);
  });
});

it("dependants reports a no-preparation route with a null station", async () => {
  const { locationId } = await venue();
  await withTransaction(suite.db, async (tx) => {
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
