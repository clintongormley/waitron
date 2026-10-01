import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  createCatalogue,
  createCategory,
  createProduct,
  createUnit,
  deleteCategory,
  readCategory,
} from "@waitron/catalogue";
import { CORE_MIGRATIONS, locations, tills, withTransaction, workingOrders } from "@waitron/db";
import { randomUUID } from "node:crypto";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import type { LocationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { createException, setClaim } from "./routing-store.js";

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

it("deleting a category removes its claim and exception with the category", async () => {
  const { locationId } = await venue();
  await withTransaction(suite.db, async (tx) => {
    const category = await createCategory(tx, { name: "Drinks" });
    await setClaim(tx, { locationId }, category.id, { kind: "no_preparation" });
    await createException(
      tx,
      { locationId },
      {
        zoneId: null,
        categoryId: category.id,
        productId: null,
        target: { kind: "no_preparation" },
      },
    );
    await expect(deleteCategory(tx, category.id)).resolves.toBeUndefined();
    const claims = await tx.execute(
      sql`select 1 from station_claims where category_id = ${category.id}`,
    );
    const exceptions = await tx.execute(
      sql`select 1 from route_exceptions where category_id = ${category.id}`,
    );
    expect(claims.rows).toHaveLength(0);
    expect(exceptions.rows).toHaveLength(0);
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
    const category = await createCategory(tx, { name: "Bakery" });
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
      insert into working_order_lines (id, working_order_id, line_no, product_id, name, descriptions, quantity, unit_price_gross, vat_class, line_total, category) values (${randomUUID()}, ${order!.id}, 1, ${product.id}, 'Bread', '{"en":"Bread"}', 1000,
         200, 'reduced', 200, 'Bakery')
    `);

    await deleteCategory(tx, category.id);
    // The counts are read back because each is at its own scale and the columns refuse none of
    // the wrong ones: one loaf is 1000 thousandths and 2.00 is 200 cents.
    const snapshot = await tx.execute<{
      category: string | null;
      quantity: string;
      vat_class: string;
      line_total: string;
    }>(sql`
      select category, cast(quantity as text) as quantity, vat_class,
             cast(line_total as text) as line_total
        from working_order_lines where working_order_id = ${order!.id}
    `);
    expect(snapshot.rows).toEqual([
      { category: "Bakery", quantity: "1000", vat_class: "reduced", line_total: "200" },
    ]);
  });
});
