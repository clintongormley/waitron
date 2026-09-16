import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { captureError, pgErrorCode } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";

const suite = useTemplateDb({ template: "manifest" });

async function fixture() {
  const tenantA = await seedTenant(suite.admin);
  const tenantB = await seedTenant(suite.admin);
  const categoryA = await suite.admin.execute<{ id: string }>(sql`
    insert into categories (tenant_id, name) values (${tenantA}, '{"en":"A"}'::jsonb) returning id
  `);
  const categoryB = await suite.admin.execute<{ id: string }>(sql`
    insert into categories (tenant_id, name) values (${tenantB}, '{"en":"B"}'::jsonb) returning id
  `);
  const catalogueA = await suite.admin.execute<{ id: string }>(sql`
    insert into catalogues (tenant_id, name) values (${tenantA}, 'A') returning id
  `);
  const productA = await suite.admin.execute<{ id: string }>(sql`
    insert into products (tenant_id, catalogue_id, name, pricing_unit, unit_price, vat_class)
    values (${tenantA}, ${catalogueA.rows[0]!.id}, 'A', 'each', 1, 'general')
    returning id
  `);
  return {
    tenantA,
    tenantB,
    categoryA: categoryA.rows[0]!.id,
    categoryB: categoryB.rows[0]!.id,
    productA: productA.rows[0]!.id,
  };
}

it("rejects a category detail parent from another tenant", async () => {
  const { tenantA, categoryA, categoryB } = await fixture();
  const error = await captureError(() =>
    suite.admin.execute(sql`
      insert into category_details (tenant_id, category_id, parent_id)
      values (${tenantA}, ${categoryA}, ${categoryB})
    `),
  );
  expect(pgErrorCode(error)).toBe("23503");
});

it("rejects product-category memberships whose product or category belongs to another tenant", async () => {
  const { tenantA, tenantB, categoryA, categoryB, productA } = await fixture();
  const foreignCategory = await captureError(() =>
    suite.admin.execute(sql`
      insert into product_categories (tenant_id, product_id, category_id)
      values (${tenantA}, ${productA}, ${categoryB})
    `),
  );
  const foreignProduct = await captureError(() =>
    suite.admin.execute(sql`
      insert into product_categories (tenant_id, product_id, category_id)
      values (${tenantB}, ${productA}, ${categoryB})
    `),
  );
  expect(pgErrorCode(foreignCategory)).toBe("23503");
  expect(pgErrorCode(foreignProduct)).toBe("23503");

  await expect(
    suite.admin.execute(sql`
      insert into product_categories (tenant_id, product_id, category_id)
      values (${tenantA}, ${productA}, ${categoryA})
    `),
  ).resolves.toBeDefined();
});
