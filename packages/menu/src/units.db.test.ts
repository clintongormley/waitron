import { eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, products, units, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTaxpayer } from "@waitron/db/testing/seed.js";
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
import { updateProduct } from "./operations.js";
import { plantStoredUnit, racePair, storedUnitId } from "../test/fixtures.js";

/**
 * Units against a real database: rollback, two transactions started together, and the bulk
 * reassignment's scoping.
 */
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

const app = <T>(action: (tx: Parameters<typeof getUnit>[0]) => Promise<T>) =>
  withTransaction(suite.db, action);

/**
 * One product on its own menu. Both rows go through their drizzle tables, because `id`,
 * `created_at` and `updated_at` come from each table's `$defaultFn` rather than from a SQL default.
 * `id` is supplied only where a test needs the rows' key order to be predictable.
 */
async function product(id: string | null = null): Promise<string> {
  const [row] = await suite.db
    .insert(products)
    .values({
      ...(id === null ? {} : { id }),
      name: "Soup",
      unitPrice: 1,
      vatClass: "general",
    })
    .returning({ id: products.id });
  return row!.id;
}

it("rolls back unit creation and editing with the caller's transaction", async () => {
  await seedTaxpayer(suite.db);
  await expect(
    app(async (tx) => {
      await createUnit(
        tx,
        {
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: { en: "crate" },
          precision: 0,
          abbreviation: { en: "u" },
        },
        "en",
      );
      throw new Error("rollback create");
    }),
  ).rejects.toThrow("rollback create");
  expect(await app((tx) => listUnits(tx))).toEqual([]);

  const unit = await app((tx) =>
    createUnit(
      tx,
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "box" },
        precision: 0,
        abbreviation: { en: "u" },
      },
      "en",
    ),
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
  await seedTaxpayer(suite.db);
  const productId = await product();
  const unit = await app((tx) =>
    createUnit(
      tx,
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "portion" },
        precision: 0,
        abbreviation: { en: "u" },
      },
      "en",
    ),
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
  await seedTaxpayer(suite.db);
  const productId = await product();
  const unit = await app((tx) =>
    createUnit(
      tx,
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "portion" },
        precision: 0,
        abbreviation: { en: "u" },
      },
      "en",
    ),
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
  await seedTaxpayer(suite.db);
  const productId = await product();
  const [source, other, target] = await app(async (tx) => [
    await createUnit(
      tx,
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "each" },
        precision: 0,
        abbreviation: { en: "u" },
      },
      "en",
    ),
    await createUnit(
      tx,
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "kg" },
        precision: 3,
        abbreviation: { en: "u" },
      },
      "en",
    ),
    await createUnit(
      tx,
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "litre" },
        precision: 2,
        abbreviation: { en: "u" },
      },
      "en",
    ),
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
  await seedTaxpayer(suite.db);
  // Fixed ids, inserted in this order, so the row reached first is the same under a table scan
  // (insertion order) and under an index scan (id order).
  const first = await product("11111111-1111-4111-8111-111111111111");
  const second = await product("22222222-2222-4222-8222-222222222222");
  const [source, target] = await app(async (tx) => [
    await createUnit(
      tx,
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "each" },
        precision: 0,
        abbreviation: { en: "u" },
      },
      "en",
    ),
    await createUnit(
      tx,
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "kg" },
        precision: 3,
        abbreviation: { en: "u" },
      },
      "en",
    ),
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
  await seedTaxpayer(suite.db);
  const p1 = await product();
  const p2 = await product();
  const sourceUnit = await app((tx) =>
    createUnit(
      tx,
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "kg" },
        precision: 3,
        abbreviation: { en: "u" },
      },
      "en",
    ),
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
  await seedTaxpayer(suite.db);
  const onSource = await product();
  const onOther = await product();
  const sourceUnit = await app((tx) =>
    createUnit(
      tx,
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "kg" },
        precision: 3,
        abbreviation: { en: "u" },
      },
      "en",
    ),
  );
  const otherUnit = await app((tx) =>
    createUnit(
      tx,
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "litre" },
        precision: 2,
        abbreviation: { en: "u" },
      },
      "en",
    ),
  );
  // Both products have stored units; only the source selection may change.
  await app(async (tx) => {
    await assignProductUnit(tx, onSource, sourceUnit.id);
    await assignProductUnit(tx, onOther, otherUnit.id);
  });

  // onOther is in the list but on a different unit, so it stands in for a product already moved
  // elsewhere: scoped by the source unit, it must be skipped by the update.
  await app((tx) => reassignProductsToUnit(tx, sourceUnit.id, [onSource, onOther], null));

  expect(await app((tx) => storedUnitId(tx, onSource))).toBeNull();
  expect(await app((tx) => storedUnitId(tx, onOther))).toBe(otherUnit.id);
});

/** A variant of `parent`, with no unit of its own. */
async function variantOf(parent: string): Promise<string> {
  const [variantRow] = await suite.db
    .insert(products)
    .values({ parentId: parent, name: "Small" })
    .returning({ id: products.id });
  return variantRow!.id;
}

const kg = () =>
  app((tx) =>
    createUnit(
      tx,
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "kg" },
        precision: 3,
        abbreviation: { en: "u" },
      },
      "en",
    ),
  );

it("reassigning to null skips a variant's stored unit, as it skips an id not on the unit", async () => {
  await seedTaxpayer(suite.db);
  const parent = await product();
  const variant = await variantOf(parent);
  const sourceUnit = await kg();
  await app((tx) => assignProductUnit(tx, parent, sourceUnit.id));
  await plantStoredUnit(suite.db, variant, sourceUnit.id);

  await app((tx) => reassignProductsToUnit(tx, sourceUnit.id, [parent, variant], null));

  expect(await app((tx) => storedUnitId(tx, parent))).toBeNull();
  expect(await app((tx) => storedUnitId(tx, variant))).toBe(sourceUnit.id);
});

describe("a variant's stored unit, from before a variant always took its product's", () => {
  it("refuses to give a variant a unit, as it refuses an id that names no product", async () => {
    await seedTaxpayer(suite.db);
    const variant = await variantOf(await product());
    const unit = await kg();
    await expect(app((tx) => assignProductUnit(tx, variant, unit.id))).rejects.toMatchObject({
      code: "product.not_found",
      params: { productId: variant },
    });
    expect(await app((tx) => storedUnitId(tx, variant))).toBeNull();
  });

  it("is not listed among the products using the unit", async () => {
    await seedTaxpayer(suite.db);
    const parent = await product();
    const variant = await variantOf(parent);
    const unit = await kg();
    await app((tx) => assignProductUnit(tx, parent, unit.id));
    await plantStoredUnit(suite.db, variant, unit.id);
    expect(await app((tx) => productsUsingUnit(tx, unit.id))).toEqual([
      { id: parent, name: "Soup", active: true },
    ]);
  });

  it("does not stop the unit being deleted, and is cleared with it", async () => {
    await seedTaxpayer(suite.db);
    const parent = await product();
    const variant = await variantOf(parent);
    const unit = await kg();
    await plantStoredUnit(suite.db, variant, unit.id);
    await app((tx) => deleteUnit(tx, unit.id));
    await expect(app((tx) => getUnit(tx, unit.id))).rejects.toMatchObject({
      code: "unit.not_found",
    });
    expect(await app((tx) => storedUnitId(tx, variant))).toBeNull();
  });

  it("is left where it is when the unit's products move to another unit", async () => {
    await seedTaxpayer(suite.db);
    const parent = await product();
    const variant = await variantOf(parent);
    const source = await kg();
    const target = await app((tx) =>
      createUnit(
        tx,
        {
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: { en: "litre" },
          precision: 2,
          abbreviation: { en: "u" },
        },
        "en",
      ),
    );
    await app((tx) => assignProductUnit(tx, parent, source.id));
    await plantStoredUnit(suite.db, variant, source.id);
    await app((tx) => reassignProductsToUnit(tx, source.id, [parent, variant], target.id));
    expect(await app((tx) => storedUnitId(tx, parent))).toBe(target.id);
    expect(await app((tx) => storedUnitId(tx, variant))).toBe(source.id);
  });
});

it.each(["target", "each"])(
  "refuses a mixed active/archived reassignment to %s without changing either product",
  async (destination) => {
    await seedTaxpayer(suite.db);
    const active = await product();
    const archived = await product();
    const source = await kg();
    const target = await kg();
    await app(async (tx) => {
      await assignProductUnit(tx, active, source.id);
      await assignProductUnit(tx, archived, source.id);
      await tx
        .update(products)
        .set({ active: false })
        .where(inArray(products.id, [archived]));
    });
    const reassignment = app((tx) =>
      reassignProductsToUnit(
        tx,
        source.id,
        [active, archived],
        destination === "each" ? null : target.id,
      ),
    );
    await expect(reassignment).rejects.toMatchObject({ code: "product.archived" });
    await expect(reassignment).rejects.toHaveProperty("params", { productId: archived });
    expect(await app((tx) => storedUnitId(tx, active))).toBe(source.id);
    expect(await app((tx) => storedUnitId(tx, archived))).toBe(source.id);
  },
);

it("skips an archived selection already moved off the source while moving an active product", async () => {
  await seedTaxpayer(suite.db);
  const active = await product();
  const archived = await product();
  const source = await kg();
  const other = await kg();
  const target = await kg();
  await app(async (tx) => {
    await assignProductUnit(tx, active, source.id);
    await assignProductUnit(tx, archived, other.id);
    await tx
      .update(products)
      .set({ active: false })
      .where(inArray(products.id, [archived]));
  });
  await app((tx) => reassignProductsToUnit(tx, source.id, [active, archived], target.id));
  expect(await app((tx) => storedUnitId(tx, active))).toBe(target.id);
  expect(await app((tx) => storedUnitId(tx, archived))).toBe(other.id);
});

it("retains an archived product's unit and refuses deletion or reassignment without any write", async () => {
  await seedTaxpayer(suite.db);
  const archivedId = await product();
  const source = await app((tx) =>
    createUnit(
      tx,
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "portion" },
        abbreviation: { en: "p" },
        precision: 0,
      },
      "en",
    ),
  );
  const target = await app((tx) =>
    createUnit(
      tx,
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "other" },
        abbreviation: { en: "o" },
        precision: 0,
      },
      "en",
    ),
  );
  await app(async (tx) => {
    await assignProductUnit(tx, archivedId, source.id);
    await tx
      .update(products)
      .set({ active: false })
      .where(inArray(products.id, [archivedId]));
  });
  const snapshot = () =>
    app(async (tx) => ({
      products: await tx.select().from(products),
      units: await tx.select().from(units),
    }));
  const before = await snapshot();
  await expect(app((tx) => deleteUnit(tx, source.id))).rejects.toMatchObject({
    code: "unit.in_use",
    params: { products: [{ id: archivedId, name: "Soup", active: false }] },
  });
  expect(await snapshot()).toEqual(before);
  for (const destination of [null, target.id]) {
    await expect(
      app((tx) => reassignProductsToUnit(tx, source.id, [archivedId], destination)),
    ).rejects.toMatchObject({
      code: "product.archived",
      params: { productId: archivedId },
    });
    expect(await snapshot()).toEqual(before);
  }
  await app((tx) => deleteUnit(tx, target.id));
  expect(await app((tx) => listUnits(tx))).toEqual([source]);
});

it("lets a manager delete the unit separately after deleting its last product", async () => {
  await seedTaxpayer(suite.db);
  const id = await product();
  const unit = await kg();
  await app((tx) => assignProductUnit(tx, id, unit.id));
  await expect(app((tx) => deleteUnit(tx, unit.id))).rejects.toMatchObject({ code: "unit.in_use" });

  await app((tx) => updateProduct(tx, id, { active: false, unitId: unit.id }));
  expect(await app((tx) => listUnits(tx))).toContainEqual(unit);
  await app((tx) => deleteUnit(tx, unit.id));
  expect(await app((tx) => listUnits(tx))).not.toContainEqual(unit);
  const [retained] = await suite.db
    .select({ name: products.name, active: products.active })
    .from(products)
    .where(eq(products.id, id));
  expect(retained).toEqual({ name: "Soup", active: false });
});

it("stores the unit on the product and refuses deleting a unit in use", async () => {
  await seedTaxpayer(suite.db);
  const productId = await product();
  const used = await kg();
  const unused = await kg();
  await app((tx) => assignProductUnit(tx, productId, used.id));
  const columns = await suite.db.execute<{ name: string }>(sql`pragma table_info(products)`);
  expect(columns.rows.map((column) => column.name)).toContain("unit_id");
  expect(columns.rows.map((column) => column.name)).not.toContain("pricing_unit");
  expect(
    await app((tx) =>
      tx.select({ unitId: products.unitId }).from(products).where(eq(products.id, productId)),
    ),
  ).toEqual([{ unitId: used.id }]);
  await expect(
    Promise.resolve().then(() => suite.db.execute(sql`delete from units where id = ${used.id}`)),
  ).rejects.toThrow("FOREIGN KEY constraint failed");
  await suite.db.execute(sql`delete from units where id = ${unused.id}`);
  expect(await app((tx) => listUnits(tx))).toEqual([used]);
});
