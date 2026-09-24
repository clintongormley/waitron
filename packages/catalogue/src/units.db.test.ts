import { inArray } from "drizzle-orm";
import { expect, it } from "vitest";
import { catalogues, CORE_MIGRATIONS, products, withTransaction } from "@waitron/db";
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
import { racePair, storedUnitId } from "../test/fixtures.js";

/**
 * Units against a real database: rollback, two transactions started together, and the bulk
 * reassignment's scoping.
 */
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });

const app = <T>(action: (tx: Parameters<typeof getUnit>[0]) => Promise<T>) =>
  withTransaction(suite.db, action);

/**
 * One product on its own catalogue. Both rows go through their drizzle tables, because `id`,
 * `created_at` and `updated_at` come from each table's `$defaultFn` rather than from a SQL default.
 * `id` is supplied only where a test needs the rows' key order to be predictable.
 */
async function product(id: string | null = null): Promise<string> {
  const [menu] = await suite.db
    .insert(catalogues)
    .values({ name: "Menu" })
    .returning({ id: catalogues.id });
  const [row] = await suite.db
    .insert(products)
    .values({
      ...(id === null ? {} : { id }),
      catalogueId: menu!.id,
      name: "Soup",
      pricingUnit: "each",
      unitPrice: 1,
      vatClass: "general",
    })
    .returning({ id: products.id });
  return row!.id;
}

it("rolls back unit creation and editing with the caller's transaction", async () => {
  await seedTenant(suite.db);
  await expect(
    app(async (tx) => {
      await createUnit(
        tx,
        { name: { en: "crate" }, precision: 0, abbreviation: { en: "u" } },
        "en",
      );
      throw new Error("rollback create");
    }),
  ).rejects.toThrow("rollback create");
  expect(await app((tx) => listUnits(tx))).toEqual([]);

  const unit = await app((tx) =>
    createUnit(tx, { name: { en: "box" }, precision: 0, abbreviation: { en: "u" } }, "en"),
  );
  await expect(
    app(async (tx) => {
      await updateUnit(tx, unit.id, { name: { en: "carton" } }, "en");
      throw new Error("rollback edit");
    }),
  ).rejects.toThrow("rollback edit");
  expect(await app((tx) => getUnit(tx, unit.id))).toMatchObject({ name: { en: "box" } });
});

it("serializes assignment against deletion so the committed product reference wins", async () => {
  await seedTenant(suite.db);
  const productId = await product();
  const unit = await app((tx) =>
    createUnit(tx, { name: { en: "portion" }, precision: 0, abbreviation: { en: "u" } }, "en"),
  );

  const [assignedResult, deletedResult] = await racePair(
    suite.db,
    (tx) => assignProductUnit(tx, productId, unit.id),
    (tx) => deleteUnit(tx, unit.id),
  );

  expect(assignedResult.status).toBe("fulfilled");
  expect(deletedResult.status).toBe("rejected");
  if (deletedResult.status === "rejected")
    expect(deletedResult.reason).toMatchObject({ code: "unit.in_use" });
  await expect(app((tx) => getUnit(tx, unit.id))).resolves.toBeDefined();
});

it("reports unit.not_found when deletion commits before a concurrent assignment", async () => {
  await seedTenant(suite.db);
  const productId = await product();
  const unit = await app((tx) =>
    createUnit(tx, { name: { en: "portion" }, precision: 0, abbreviation: { en: "u" } }, "en"),
  );

  const [deletedResult, assignedResult] = await racePair(
    suite.db,
    (tx) => deleteUnit(tx, unit.id),
    (tx) => assignProductUnit(tx, productId, unit.id),
  );

  expect(deletedResult.status).toBe("fulfilled");
  expect(assignedResult.status).toBe("rejected");
  if (assignedResult.status === "rejected")
    expect(assignedResult.reason).toMatchObject({ code: "unit.not_found" });
  expect(await app((tx) => productsUsingUnit(tx, unit.id))).toHaveLength(0);
});

// The contract: a bulk reassignment moves only the products STILL on the source unit when it
// writes, so a selection made stale by another manager's move is skipped, never overwritten.
it("skips a product another manager moved off the source unit while the selection was stale", async () => {
  await seedTenant(suite.db);
  const productId = await product();
  const [source, other, target] = await app(async (tx) => [
    await createUnit(tx, { name: { en: "each" }, precision: 0, abbreviation: { en: "u" } }, "en"),
    await createUnit(tx, { name: { en: "kg" }, precision: 3, abbreviation: { en: "u" } }, "en"),
    await createUnit(tx, { name: { en: "litre" }, precision: 2, abbreviation: { en: "u" } }, "en"),
  ]);
  await app((tx) => assignProductUnit(tx, productId, source!.id));

  // The stale selection is read in an earlier request and acted on in a later one, with the move
  // committed in between: nothing can land inside another write transaction's body.
  await app((tx) => getUnit(tx, source!.id));
  await app((tx) => assignProductUnit(tx, productId, other!.id));
  await app((tx) => reassignProductsToUnit(tx, source!.id, [productId], target!.id));

  expect(await app((tx) => storedUnitId(tx, productId))).toBe(other!.id);
});

it("two bulk reassignments listing the same products in opposite orders both complete", async () => {
  await seedTenant(suite.db);
  // Fixed ids, inserted in this order, so the row reached first is the same under a table scan
  // (insertion order) and under an index scan (id order).
  const first = await product("11111111-1111-4111-8111-111111111111");
  const second = await product("22222222-2222-4222-8222-222222222222");
  const [source, target] = await app(async (tx) => [
    await createUnit(tx, { name: { en: "each" }, precision: 0, abbreviation: { en: "u" } }, "en"),
    await createUnit(tx, { name: { en: "kg" }, precision: 3, abbreviation: { en: "u" } }, "en"),
  ]);
  await app(async (tx) => {
    await assignProductUnit(tx, first, source!.id);
    await assignProductUnit(tx, second, source!.id);
  });

  const results = await racePair(
    suite.db,
    (tx) => reassignProductsToUnit(tx, source!.id, [first, second], target!.id),
    (tx) => reassignProductsToUnit(tx, source!.id, [second, first], target!.id),
  );
  expect(
    results.map((outcome) => (outcome.status === "fulfilled" ? "ok" : outcome.reason)),
  ).toEqual(["ok", "ok"]);

  expect(await app((tx) => storedUnitId(tx, first))).toBe(target!.id);
  expect(await app((tx) => storedUnitId(tx, second))).toBe(target!.id);
});

it("reassigning to null clears the products' unit (they become Each)", async () => {
  await seedTenant(suite.db);
  const p1 = await product();
  const p2 = await product();
  const sourceUnit = await app((tx) =>
    createUnit(tx, { name: { en: "kg" }, precision: 3, abbreviation: { en: "u" } }, "en"),
  );
  await app(async (tx) => {
    await assignProductUnit(tx, p1, sourceUnit.id);
    await assignProductUnit(tx, p2, sourceUnit.id);
  });

  await app((tx) => reassignProductsToUnit(tx, sourceUnit.id, [p1, p2], null));

  expect(await app((tx) => productsUsingUnit(tx, sourceUnit.id))).toHaveLength(0);
  expect(await app((tx) => storedUnitId(tx, p1))).toBeNull();
});

it("reassigning to null returns the products to each-priced and leaves products on other units alone", async () => {
  await seedTenant(suite.db);
  const onSource = await product();
  const onOther = await product();
  const sourceUnit = await app((tx) =>
    createUnit(tx, { name: { en: "kg" }, precision: 3, abbreviation: { en: "u" } }, "en"),
  );
  const otherUnit = await app((tx) =>
    createUnit(tx, { name: { en: "litre" }, precision: 2, abbreviation: { en: "u" } }, "en"),
  );
  // Put both products in the real "sold by weight" state: a unit row plus pricing_unit = 'weight'.
  await app(async (tx) => {
    await assignProductUnit(tx, onSource, sourceUnit.id);
    await assignProductUnit(tx, onOther, otherUnit.id);
  });
  await suite.db
    .update(products)
    .set({ pricingUnit: "weight" })
    .where(inArray(products.id, [onSource, onOther]));

  // onOther is in the list but on a different unit, so it stands in for a product already moved
  // elsewhere: scoped by the source unit, it must be skipped by both the delete and the update.
  await app((tx) => reassignProductsToUnit(tx, sourceUnit.id, [onSource, onOther], null));

  const pricing = await suite.db
    .select({ id: products.id, pricingUnit: products.pricingUnit })
    .from(products)
    .where(inArray(products.id, [onSource, onOther]));
  const pricingById = Object.fromEntries(pricing.map((row) => [row.id, row.pricingUnit]));
  // The reassigned top-level product loses its unit row AND returns to each-priced.
  expect(await app((tx) => storedUnitId(tx, onSource))).toBeNull();
  expect(pricingById[onSource]).toBe("each");
  // The product on another unit keeps both its unit row and its weight pricing.
  expect(await app((tx) => storedUnitId(tx, onOther))).toBe(otherUnit.id);
  expect(pricingById[onOther]).toBe("weight");
});

it("reassigning a variant's own unit to null leaves its pricing unit blank, so it follows its parent's", async () => {
  await seedTenant(suite.db);
  const parent = await product();
  const [parentRow] = await suite.db
    .select({ catalogueId: products.catalogueId })
    .from(products)
    .where(inArray(products.id, [parent]));
  const [variantRow] = await suite.db
    .insert(products)
    .values({
      catalogueId: parentRow!.catalogueId,
      parentId: parent,
      name: "Small",
      pricingUnit: "weight",
    })
    .returning({ id: products.id });
  const variant = variantRow!.id;
  const sourceUnit = await app((tx) =>
    createUnit(tx, { name: { en: "kg" }, precision: 3, abbreviation: { en: "u" } }, "en"),
  );
  await app(async (tx) => {
    await assignProductUnit(tx, parent, sourceUnit.id);
    await assignProductUnit(tx, variant, sourceUnit.id);
  });
  await suite.db
    .update(products)
    .set({ pricingUnit: "weight" })
    .where(inArray(products.id, [parent]));

  await app((tx) => reassignProductsToUnit(tx, sourceUnit.id, [parent, variant], null));

  const pricing = await suite.db
    .select({ id: products.id, pricingUnit: products.pricingUnit })
    .from(products)
    .where(inArray(products.id, [parent, variant]));
  expect(Object.fromEntries(pricing.map((row) => [row.id, row.pricingUnit]))).toEqual({
    [parent]: "each",
    [variant]: null,
  });
  expect(await app((tx) => storedUnitId(tx, variant))).toBeNull();
});
