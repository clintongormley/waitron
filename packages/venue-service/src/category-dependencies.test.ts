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
  asAppUser,
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
  // Every fixture row in this file goes through the insert BUILDER rather than raw SQL, for two
  // things the raw statements relied on PostgreSQL for. `array['en']` is refused at prepare —
  // `near "['en']": syntax error` — because SQLite has no array literal and `invoice_locales` is
  // now a JSON array in a TEXT column that `labelList` encodes. And each table's `id` and its
  // timestamps are JavaScript `$defaultFn` generators rather than SQL DEFAULTs, which only the
  // builder runs; measured, a raw insert is refused with `NOT NULL constraint failed: <table>.id`.
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Main", invoiceLocales: ["en"], operationDescription: "Restaurant" })
    .returning({ id: locations.id });
  return { locationId: location!.id as LocationId };
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
    // This one stays raw SQL so the five counts below stay literally where the comment puts them.
    // Two changes only: `id` is named (no SQL DEFAULT to fill it), and the `::jsonb` cast is gone —
    // `descriptions` is a TEXT column holding JSON here, and the cast is refused at prepare with
    // `unrecognized token: ":"`.
    await tx.execute(sql`
      insert into working_order_lines (id, working_order_id, line_no, product_id, name, descriptions, quantity, unit_price, unit_price_gross, vat_rate, line_total, category) values (${randomUUID()}, ${order!.id}, 1, ${product.id}, 'Bread', '{"en":"Bread"}', 1000,
         200, 200, 1000, 200, 'Bakery')
    `);

    await deleteCategory(tx, category.id);
    // The counts come back beside the snapshot this case is about, because every number in the
    // insert above is a count at its own scale and the columns refuse none of the wrong ones:
    // one loaf is 1000 thousandths, 10.00% is 1000 basis points, and the 2.00 the product was
    // priced at is 200 cents. Written as `1` and `10` this case still passed, measured by doing
    // exactly that.
    // `cast(… as text)`, not `::text`: the cast this carried is refused at prepare with
    // `unrecognized token: ":"`, a colon opening a bind parameter to SQLite's parser. It still
    // yields the STRING the assertion below compares against, so no expected value moved.
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
    await asAppUser(tx);
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
