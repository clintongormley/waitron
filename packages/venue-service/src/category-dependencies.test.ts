import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  createCatalogue,
  createCategory,
  createProduct,
  createUnit,
  deleteCategory,
  replaceProductCategories,
} from "@waitron/catalogue";
import { asAppUser, CORE_MIGRATIONS, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import type { LocationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { createPreparationRoute, deletePreparationRoute } from "./operations.js";

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

it("refuses to delete a category referenced only by a preparation route", async () => {
  const { tenantId, locationId } = await venue();
  await withTenant(suite.db, tenantId, async (tx) => {
    await asAppUser(tx);
    const category = await createCategory(tx, tenantId, { name: { en: "Drinks" } });
    const routeId = await createPreparationRoute(
      tx,
      { tenantId, locationId },
      {
        categoryId: category.id,
        target: { kind: "no_preparation" },
      },
    );

    await expect(deleteCategory(tx, tenantId, category.id)).rejects.toMatchObject({
      code: "category.in_use",
      params: { children: 0, products: 0, routes: 1 },
    });

    await deletePreparationRoute(tx, { tenantId, locationId }, routeId);
    await expect(deleteCategory(tx, tenantId, category.id)).resolves.toBeUndefined();
  });
});

it("allows deletion after memberships clear even when an open order keeps the copied category label", async () => {
  const { tenantId, locationId } = await venue();
  await withTenant(suite.db, tenantId, async (tx) => {
    await asAppUser(tx);
    const till = await tx.execute<{ id: string }>(sql`
      insert into tills (tenant_id, location_id, name)
      values (${tenantId}, ${locationId}, 'Till') returning id
    `);
    const catalogue = await createCatalogue(tx, tenantId, { name: "Menu" });
    const category = await createCategory(tx, tenantId, { name: { en: "Bakery" } });
    const unit = await createUnit(tx, tenantId, { name: { en: "each" }, precision: 0 }, "en");
    const product = await createProduct(tx, tenantId, {
      catalogueId: catalogue.id,
      categoryId: category.id,
      descriptions: { en: "Bread" },
      unitId: unit.id,
      unitPrice: "2.00",
      vatClass: "general",
    });
    await replaceProductCategories(tx, tenantId, product.id, { categoryIds: [] });
    const order = await tx.execute<{ id: string }>(sql`
      insert into working_orders (tenant_id, till_id, order_number, label)
      values (${tenantId}, ${till.rows[0]!.id}, 1, 'Historical') returning id
    `);
    await tx.execute(sql`
      insert into working_order_lines
        (tenant_id, working_order_id, line_no, product_id, descriptions, quantity,
         unit_price, unit_price_gross, vat_rate, line_total, category)
      values
        (${tenantId}, ${order.rows[0]!.id}, 1, ${product.id}, '{"en":"Bread"}'::jsonb, 1,
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
