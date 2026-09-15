import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction, type Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import {
  assignProductUnit,
  createUnit,
  deleteUnit,
  getUnit,
  listUnits,
  productsUsingUnit,
  reassignProductsToUnit,
  updateUnit,
} from "./units.js";
import { assertQuantityPrecision } from "./units.js";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });

async function product(tx: Transaction, tenantId: string, name: string) {
  const menu = await tx.execute<{ id: string }>(sql`
    insert into catalogues (tenant_id, name) values (${tenantId}, 'Menu') returning id`);
  return (
    await tx.execute<{ id: string }>(sql`
      insert into products (tenant_id, catalogue_id, name, pricing_unit, unit_price, vat_class)
      values (${tenantId}, ${menu.rows[0]!.id}, ${name}, 'each', '1', 'general')
      returning id`)
  ).rows[0]!.id;
}

describe("unit operations", () => {
  it("requires an abbreviation in the default language", async () => {
    await withTransaction(suite.db, async (tx) => {
      await expect(
        createUnit(tx, { name: { en: "Litre" }, precision: 3, abbreviation: {} }, "en"),
      ).rejects.toMatchObject({ code: "content.translation_required" });
    });
  });

  it("stores and returns the abbreviation", async () => {
    await withTransaction(suite.db, async (tx) => {
      const unit = await createUnit(
        tx,
        { name: { en: "Litre" }, precision: 3, abbreviation: { en: "l" } },
        "en",
      );
      expect(unit.abbreviation).toEqual({ en: "l" });
      const [listed] = await listUnits(tx);
      expect(listed!.abbreviation).toEqual({ en: "l" });
    });
  });

  it("updates the abbreviation and revalidates it against the default language", async () => {
    await withTransaction(suite.db, async (tx) => {
      const unit = await createUnit(
        tx,
        { name: { en: "Litre" }, precision: 3, abbreviation: { en: "l" } },
        "en",
      );
      const updated = await updateUnit(tx, unit.id, { abbreviation: { en: "L" } }, "en");
      expect(updated.abbreviation).toEqual({ en: "L" });
      await expect(updateUnit(tx, unit.id, { abbreviation: {} }, "en")).rejects.toMatchObject({
        code: "content.translation_required",
      });
    });
  });

  it("creates, reads, updates, assigns and deletes within a tenant", async () => {
    const tenantId = await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const unit = await createUnit(
        tx,
        { name: { en: "portion" }, precision: 2, abbreviation: { en: "u" } },
        "en",
      );
      expect(await getUnit(tx, unit.id)).toEqual(unit);
      expect(await listUnits(tx)).toEqual([unit]);
      await updateUnit(tx, unit.id, { name: { en: "serving" }, precision: 1 }, "en");
      expect(await getUnit(tx, unit.id)).toMatchObject({
        name: { en: "serving" },
        precision: 1,
      });

      const productId = await product(tx, tenantId, "Soup");
      await assignProductUnit(tx, productId, unit.id);
      await tx.execute(sql`
        update products set active = false where tenant_id = ${tenantId} and id = ${productId}`);
      await expect(deleteUnit(tx, unit.id)).rejects.toMatchObject({
        code: "unit.in_use",
        params: { products: [{ id: productId, name: "Soup", available: false }] },
      });
    });
  });

  it("lists the products using a unit, with each product's availability", async () => {
    const tenantId = await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const unit = await createUnit(
        tx,
        { name: { en: "portion" }, precision: 0, abbreviation: { en: "u" } },
        "en",
      );
      expect(await productsUsingUnit(tx, unit.id)).toEqual([]);

      const soup = await product(tx, tenantId, "Soup");
      const tea = await product(tx, tenantId, "Tea");
      await assignProductUnit(tx, soup, unit.id);
      await assignProductUnit(tx, tea, unit.id);
      await tx.execute(sql`
        update products set active = false where tenant_id = ${tenantId} and id = ${tea}`);

      const using = await productsUsingUnit(tx, unit.id);
      expect(using).toHaveLength(2);
      expect(using).toEqual(
        expect.arrayContaining([
          { id: soup, name: "Soup", available: true },
          { id: tea, name: "Tea", available: false },
        ]),
      );
    });
  });

  it("reassigns products from one unit to another", async () => {
    const tenantId = await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const from = await createUnit(
        tx,
        { name: { en: "each" }, precision: 0, abbreviation: { en: "u" } },
        "en",
      );
      const to = await createUnit(
        tx,
        { name: { en: "kg" }, precision: 3, abbreviation: { en: "u" } },
        "en",
      );
      const a = await product(tx, tenantId, "A");
      const b = await product(tx, tenantId, "B");
      await assignProductUnit(tx, a, from.id);
      await assignProductUnit(tx, b, from.id);
      expect(await productsUsingUnit(tx, from.id)).toHaveLength(2);

      await reassignProductsToUnit(tx, from.id, [a, b], to.id);
      expect(await productsUsingUnit(tx, from.id)).toEqual([]);
      expect((await productsUsingUnit(tx, to.id)).map((p) => p.id).sort()).toEqual([a, b].sort());
    });
  });

  // The contract the single-statement reassignment settled on: an id the source unit does not
  // currently hold is not an error, it is simply not matched.
  it("skips an unknown product id instead of failing the reassignment", async () => {
    const owner = await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const from = await createUnit(
        tx,
        { name: { en: "each" }, precision: 0, abbreviation: { en: "u" } },
        "en",
      );
      const to = await createUnit(
        tx,
        { name: { en: "kg" }, precision: 3, abbreviation: { en: "u" } },
        "en",
      );
      const a = await product(tx, owner, "A");
      await assignProductUnit(tx, a, from.id);

      await expect(
        reassignProductsToUnit(tx, from.id, [a, "00000000-0000-4000-8000-0000000000aa"], to.id),
      ).resolves.toBeUndefined();

      // The valid id moved; the unmatched id neither stopped it nor was itself touched.
      expect(await productsUsingUnit(tx, from.id)).toEqual([]);
      expect((await productsUsingUnit(tx, to.id)).map((p) => p.id)).toEqual([a]);
    });
  });

  it("refuses to reassign to a unit that does not exist", async () => {
    const tenantId = await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const from = await createUnit(
        tx,
        { name: { en: "each" }, precision: 0, abbreviation: { en: "u" } },
        "en",
      );
      const a = await product(tx, tenantId, "A");
      await assignProductUnit(tx, a, from.id);
      await expect(
        reassignProductsToUnit(tx, from.id, [a], "00000000-0000-4000-8000-000000000000"),
      ).rejects.toMatchObject({ code: "unit.not_found" });
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
