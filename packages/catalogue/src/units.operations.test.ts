import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { decimal, decimalToThousandths } from "@waitron/shared";
import {
  catalogues,
  CORE_MIGRATIONS,
  products,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import {
  assignProductUnit,
  createUnit,
  deleteUnit,
  getSellableUnit,
  getUnit,
  listUnits,
  productsUsingUnit,
  reassignProductsToUnit,
  updateUnit,
} from "./units.js";
import { assertQuantityPrecision } from "./units.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });

/**
 * Both rows go through their drizzle tables: `catalogues.id` and `products.id` come from each
 * table's own `$defaultFn` rather than from a SQL default, so a raw insert naming the other columns
 * is refused `NOT NULL constraint failed: catalogues.id`.
 */
async function product(tx: Transaction, name: string) {
  const [menu] = await tx
    .insert(catalogues)
    .values({ name: "Menu" })
    .returning({ id: catalogues.id });
  const [row] = await tx
    .insert(products)
    .values({
      catalogueId: menu!.id,
      name,
      pricingUnit: "each",
      unitPrice: 1,
      vatClass: "general",
    })
    .returning({ id: products.id });
  return row!.id;
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
    await seedTenant(suite.db);
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

      const productId = await product(tx, "Soup");
      await assignProductUnit(tx, productId, unit.id);
      await tx.execute(sql`
        update products set active = false where id = ${productId}`);
      await expect(deleteUnit(tx, unit.id)).rejects.toMatchObject({
        code: "unit.in_use",
        params: { products: [{ id: productId, name: "Soup", available: false }] },
      });
    });
  });

  it("lists the products using a unit, with each product's availability", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const unit = await createUnit(
        tx,
        { name: { en: "portion" }, precision: 0, abbreviation: { en: "u" } },
        "en",
      );
      expect(await productsUsingUnit(tx, unit.id)).toEqual([]);

      const soup = await product(tx, "Soup");
      const tea = await product(tx, "Tea");
      await assignProductUnit(tx, soup, unit.id);
      await assignProductUnit(tx, tea, unit.id);
      await tx.execute(sql`
        update products set active = false where id = ${tea}`);

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
    await seedTenant(suite.db);
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
      const a = await product(tx, "A");
      const b = await product(tx, "B");
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
    await seedTenant(suite.db);
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
      const a = await product(tx, "A");
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
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const from = await createUnit(
        tx,
        { name: { en: "each" }, precision: 0, abbreviation: { en: "u" } },
        "en",
      );
      const a = await product(tx, "A");
      await assignProductUnit(tx, a, from.id);
      await expect(
        reassignProductsToUnit(tx, from.id, [a], "00000000-0000-4000-8000-000000000000"),
      ).rejects.toMatchObject({ code: "unit.not_found" });
    });
  });

  it("rejects excess precision before anything downstream can round it", async () => {
    // The database never rounds a quantity: the column holds a whole count of thousandths and
    // `decimalToThousandths` owns the third place, so storage has no rounding of its own for this
    // case to be checked against. A SQL-side control cannot exist here either — the engine has no
    // exact decimal type, so `round(1.2345, 3)` is 1.234 and `cast(1.2345 as numeric(12,3))` keeps
    // all four places (node:sqlite, Node v26.7.0; receipt in docs/developers/conventions-data.md).
    expect(decimalToThousandths(decimal("1.2345"))).toBe(1235);
    expect(() => assertQuantityPrecision("1.2345", 3, { positive: true })).toThrowError(
      expect.objectContaining({ code: "quantity.invalid", params: { reason: "precision" } }),
    );
  });
});

describe("what a unit operation refuses for an id that names nothing", () => {
  const MISSING = "00000000-0000-4000-8000-0000000000bb";

  it("refuses to read, sell by, update or delete a unit no row holds", async () => {
    await withTransaction(suite.db, async (tx) => {
      for (const attempt of [
        () => getUnit(tx, MISSING),
        () => getSellableUnit(tx, MISSING),
        () => updateUnit(tx, MISSING, { precision: 1 }, "en"),
        () => updateUnit(tx, MISSING, {}, "en"),
        () => deleteUnit(tx, MISSING),
      ]) {
        await expect(attempt()).rejects.toMatchObject({
          code: "unit.not_found",
          params: { unitId: MISSING },
        });
      }
    });
  });

  it("refuses to assign a unit to a product no row holds", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const unit = await createUnit(
        tx,
        { name: { en: "portion" }, precision: 0, abbreviation: { en: "u" } },
        "en",
      );
      await expect(assignProductUnit(tx, MISSING, unit.id)).rejects.toMatchObject({
        code: "product.not_found",
        params: { productId: MISSING },
      });
      expect(await productsUsingUnit(tx, unit.id)).toEqual([]);
    });
  });

  it("answers an empty patch with the unit as stored, changing nothing", async () => {
    await withTransaction(suite.db, async (tx) => {
      const unit = await createUnit(
        tx,
        { name: { en: "portion" }, precision: 2, abbreviation: { en: "u" } },
        "en",
      );
      expect(await updateUnit(tx, unit.id, {}, "en")).toEqual(unit);
    });
  });
});
