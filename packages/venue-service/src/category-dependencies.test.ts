import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  createCatalogue,
  createCategory,
  createProduct,
  createUnit,
  deleteCatalogueItems,
  deleteCategory,
  readCategory,
  updateProduct,
} from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  kitchenStations,
  locations,
  products,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import { randomUUID } from "node:crypto";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import type { LocationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { resolveMakers, setRoutingCell } from "./routing-store.js";
import { routingCells } from "./schema/routing.js";

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

it("deleting a category removes its own and its subtree's category cells and keeps product cells", async () => {
  const { locationId } = await venue();
  const cfg = { locationId };
  const { negroniId, barId, foodId } = await withTransaction(suite.db, async (tx) => {
    const [kitchen, bar] = (
      await tx
        .insert(kitchenStations)
        .values([
          { locationId, name: "Kitchen" },
          { locationId, name: "Bar" },
        ])
        .returning({ id: kitchenStations.id })
    ).map((row) => row.id);
    const catalogue = await createCatalogue(tx, { name: "Menu" });
    const food = await createCategory(tx, { name: "Food" });
    const drinks = await createCategory(tx, { name: "Drinks", parentId: food.id });
    const cocktails = await createCategory(tx, { name: "Cocktails", parentId: drinks.id });
    const negroni = await createProduct(tx, {
      catalogueId: catalogue.id,
      categoryId: cocktails.id,
      name: "Negroni",
      pricingUnit: "each",
      unitPrice: "9.00",
      vatClass: "general",
    });
    const category = (categoryId: string) => ({
      row: { kind: "category" as const, categoryId },
      zoneId: null,
    });
    await setRoutingCell(tx, cfg, category(food.id), { kind: "station", stationId: kitchen! });
    await setRoutingCell(tx, cfg, category(drinks.id), { kind: "no_preparation" });
    await setRoutingCell(tx, cfg, category(cocktails.id), { kind: "no_preparation" });
    await setRoutingCell(
      tx,
      cfg,
      { row: { kind: "product", productId: negroni.id }, zoneId: null },
      { kind: "station", stationId: bar! },
    );

    await expect(
      deleteCatalogueItems(tx, { productIds: [], categoryIds: [drinks.id] }, "delete"),
    ).resolves.toBeUndefined();

    const cells = await tx
      .select({ categoryId: routingCells.categoryId, productId: routingCells.productId })
      .from(routingCells);
    expect(cells).toEqual(
      expect.arrayContaining([
        { categoryId: food.id, productId: null },
        { categoryId: null, productId: negroni.id },
      ]),
    );
    expect(cells).toHaveLength(2);
    await expect(readCategory(tx, drinks.id)).rejects.toMatchObject({
      code: "category.not_found",
    });
    const [vacated] = await tx
      .select({ categoryId: products.categoryId, active: products.active })
      .from(products)
      .where(eq(products.id, negroni.id));
    expect(vacated).toEqual({ categoryId: food.id, active: false });

    return { negroniId: negroni.id, barId: bar, foodId: food.id };
  });
  await expect(
    withTransaction(suite.db, (tx) => updateProduct(tx, negroniId, { active: true })),
  ).rejects.toMatchObject({ code: "product.archived", params: { productId: negroniId } });
  expect(
    await suite.db
      .select({ categoryId: products.categoryId, active: products.active })
      .from(products)
      .where(eq(products.id, negroniId)),
  ).toEqual([{ categoryId: foodId, active: false }]);
  await expect(
    withTransaction(suite.db, (tx) =>
      resolveMakers(tx, cfg, null, [negroniId], new Date("2026-10-02T18:30:00Z")),
    ),
  ).resolves.toEqual(
    new Map([[negroniId, { kind: "made", route: { kind: "station", stationId: barId } }]]),
  );
});

it("an open order keeps its copied category label after the category is deleted", async () => {
  const { locationId } = await venue();
  await withTransaction(suite.db, async (tx) => {
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
      .values({
        source: "dashboard",
        deviceId: null,
        locationId,
        orderNumber: 1,
        label: "Historical",
      })
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
