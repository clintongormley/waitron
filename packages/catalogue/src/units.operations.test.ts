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
    // The rounding this guards against used to belong to the column, a `numeric(12, 3)`. The column
    // counts whole thousandths now, so the rounding moved to `decimalToThousandths` — and the two
    // agree, which is why the storage change did not move this boundary. The SQL cast stays as the
    // control for the half it used to be: both readings round 1.2345 to three places the same way,
    // half away from zero.
    //
    // **LEFT RED BY THE STORAGE SWITCH, deliberately.** `1.2345::numeric(12,3)::text` is not SQL
    // this engine has, and the control does not translate: SQLite has no exact decimal type, so
    // the nearest readings go through a double. Measured on node:sqlite (Node v26.7.0):
    // `round(1.2345, 3)` is 1.234 and `printf('%.3f', 1.2345)` is "1.234", where PostgreSQL's
    // numeric gave 1.235 and `decimalToThousandths` still gives 1235. Control in the other
    // direction, so this is float representation and not "SQLite always rounds down":
    // `round(1.2355, 3)` is 1.236. So the two readings this line exists to compare no longer AGREE,
    // and rewriting the expected value would assert the opposite of what the line is for. The
    // product path reaches no SQL rounding at all now — the column is an integer count of
    // thousandths written by `decimalToThousandths` — so whether this control keeps a home is a
    // decision, not a translation. The two assertions below are the case's own subject and are
    // untouched.
    const rounded = await suite.db.execute<{ value: string }>(
      sql`select 1.2345::numeric(12,3)::text as value`,
    );
    expect(rounded.rows).toEqual([{ value: "1.235" }]);
    expect(decimalToThousandths(decimal("1.2345"))).toBe(1235);
    expect(() => assertQuantityPrecision("1.2345", 3, { positive: true })).toThrowError(
      expect.objectContaining({ code: "quantity.invalid", params: { reason: "precision" } }),
    );
  });
});
