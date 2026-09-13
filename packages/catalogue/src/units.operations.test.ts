import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTenant, type Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import {
  assignProductUnit,
  createUnit,
  deleteUnit,
  getUnit,
  listUnits,
  updateUnit,
} from "./units.js";
import { assertQuantityPrecision } from "./units.js";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });

async function product(tx: Transaction, tenantId: string, name: string) {
  const menu = await tx.execute<{ id: string }>(sql`
    insert into catalogues (tenant_id, name) values (${tenantId}, 'Menu') returning id`);
  return (
    await tx.execute<{ id: string }>(sql`
      insert into products (tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class)
      values (${tenantId}, ${menu.rows[0]!.id}, ${JSON.stringify({ en: name })}::jsonb, 'each', '1', 'general')
      returning id`)
  ).rows[0]!.id;
}

describe("unit operations", () => {
  it("creates, reads, updates, assigns and deletes within a tenant", async () => {
    const tenantId = await seedTenant(suite.db);
    await withTenant(suite.db, tenantId, async (tx) => {
      const unit = await createUnit(tx, tenantId, { name: { en: "portion" }, precision: 2 }, "en");
      expect(await getUnit(tx, tenantId, unit.id)).toEqual(unit);
      expect(await listUnits(tx, tenantId)).toEqual([unit]);
      await updateUnit(tx, tenantId, unit.id, { name: { en: "serving" }, precision: 1 }, "en");
      expect(await getUnit(tx, tenantId, unit.id)).toMatchObject({
        name: { en: "serving" },
        precision: 1,
      });

      const productId = await product(tx, tenantId, "Soup");
      await assignProductUnit(tx, tenantId, productId, unit.id);
      await tx.execute(sql`
        update products set active = false where tenant_id = ${tenantId} and id = ${productId}`);
      await expect(deleteUnit(tx, tenantId, unit.id)).rejects.toMatchObject({
        code: "unit.in_use",
        params: { products: [{ en: "Soup" }] },
      });
    });
  });

  it("does not read or mutate another tenant's unit or attach it to a product", async () => {
    const owner = await seedTenant(suite.db);
    const other = await seedTenant(suite.db);
    const unit = await withTenant(suite.db, owner, (tx) =>
      createUnit(tx, owner, { name: { en: "cup" }, precision: 0 }, "en"),
    );
    await withTenant(suite.db, other, async (tx) => {
      const productId = await product(tx, other, "Tea");
      await expect(getUnit(tx, other, unit.id)).rejects.toMatchObject({ code: "unit.not_found" });
      await expect(updateUnit(tx, other, unit.id, { precision: 1 }, "en")).rejects.toMatchObject({
        code: "unit.not_found",
      });
      await expect(deleteUnit(tx, other, unit.id)).rejects.toMatchObject({
        code: "unit.not_found",
      });
      await expect(assignProductUnit(tx, other, productId, unit.id)).rejects.toMatchObject({
        code: "unit.not_found",
      });
    });
  });

  it("rejects excess precision before numeric(12,3) can round it", async () => {
    const rounded = await suite.db.execute<{ value: string }>(
      sql`select 1.2345::numeric(12,3)::text as value`,
    );
    expect(rounded.rows).toEqual([{ value: "1.235" }]);
    expect(() => assertQuantityPrecision("1.2345", 3, { positive: true })).toThrowError(
      expect.objectContaining({ code: "quantity.invalid", params: { reason: "precision" } }),
    );
  });
});
