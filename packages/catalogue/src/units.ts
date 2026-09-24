import { and, asc, eq, inArray } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import type { ProductUsingUnit } from "./unit-types.js";

export type { ProductUsingUnit };
import { AppError } from "@waitron/shared";
import { validateContentTranslations } from "./content-languages.js";
import { productUnits, units } from "./schema/units.js";
import { validateUnitPrecision } from "./unit-validation.js";
import { clearedPricingUnit } from "./variant-fallback.js";
export {
  MAX_UNIT_PRECISION,
  assertQuantityPrecision,
  validateUnitPrecision,
} from "./unit-validation.js";
import "./errors.js";
import type { Unit, SellableUnit } from "./product-types.js";
export type { Unit, SellableUnit } from "./product-types.js";

/** The unit a product reads as when it has NO stored unit. It is NEVER written to `units` or
 * `product_units`. Its id matches the till's own "each" fallback
 * (apps/till/src/widgets/product-name.ts) so server and till agree. */
export const EACH_UNIT_ID = "00000000-0000-0000-0000-000000000001";
export const EACH_UNIT: SellableUnit = {
  id: EACH_UNIT_ID,
  name: { en: "Each", es: "Unidad", ca: "Unitat", gl: "Unidade", eu: "Unitatea" },
  abbreviation: { en: "ea", es: "ud", ca: "u", gl: "u", eu: "u" },
  precision: 0,
  hardwareUnit: null,
};

export interface CreateUnitInput {
  name: Record<string, string>;
  precision: number;
  abbreviation: Record<string, string>;
}

export interface UpdateUnitInput {
  name?: Record<string, string>;
  precision?: number;
  abbreviation?: Record<string, string>;
}

const UNIT_COLUMNS = {
  id: units.id,
  name: units.name,
  precision: units.precision,
  abbreviation: units.abbreviation,
};
const SELLABLE_UNIT_COLUMNS = { ...UNIT_COLUMNS, hardwareUnit: units.hardwareUnit };

function toSellableUnit(row: {
  id: string;
  name: Record<string, string>;
  precision: number;
  abbreviation: Record<string, string>;
  hardwareUnit: string | null;
}): SellableUnit {
  return { ...row, hardwareUnit: row.hardwareUnit as SellableUnit["hardwareUnit"] };
}

export async function createUnit(
  tx: Transaction,
  input: CreateUnitInput,
  fallbackLanguage: string,
): Promise<Unit> {
  await validateContentTranslations(tx, input.name, fallbackLanguage);
  await validateContentTranslations(tx, input.abbreviation, fallbackLanguage);
  validateUnitPrecision(input.precision);
  const [row] = await tx
    .insert(units)
    .values({
      name: input.name,
      abbreviation: input.abbreviation,
      precision: input.precision,
    })
    .returning(UNIT_COLUMNS);
  return row!;
}

export async function listUnits(tx: Transaction): Promise<Unit[]> {
  return tx.select(UNIT_COLUMNS).from(units).orderBy(asc(units.id));
}

export async function getUnit(tx: Transaction, unitId: string): Promise<Unit> {
  const [row] = await tx.select(UNIT_COLUMNS).from(units).where(eq(units.id, unitId));
  if (row === undefined) throw new AppError("unit.not_found", { unitId });
  return row;
}

/** Sale-facing read; the scale mapping is stored data and is never inferred from editable text. */
export async function getSellableUnit(tx: Transaction, unitId: string): Promise<SellableUnit> {
  const [row] = await tx.select(SELLABLE_UNIT_COLUMNS).from(units).where(eq(units.id, unitId));
  if (row === undefined) throw new AppError("unit.not_found", { unitId });
  return toSellableUnit(row);
}

/** Resolve a legacy product choice to the retained seed unit, never to a made-up identifier. */
export async function getSeededUnit(
  tx: Transaction,
  seedKey: "each" | "kg",
): Promise<SellableUnit | null> {
  const [row] = await tx
    .select(SELLABLE_UNIT_COLUMNS)
    .from(units)
    .where(eq(units.seedKey, seedKey));
  return row === undefined ? null : toSellableUnit(row);
}

export async function updateUnit(
  tx: Transaction,
  unitId: string,
  patch: UpdateUnitInput,
  fallbackLanguage: string,
): Promise<Unit> {
  if (patch.name !== undefined) {
    await validateContentTranslations(tx, patch.name, fallbackLanguage);
  }
  if (patch.abbreviation !== undefined) {
    await validateContentTranslations(tx, patch.abbreviation, fallbackLanguage);
  }
  if (patch.precision !== undefined) validateUnitPrecision(patch.precision);
  if (
    patch.name === undefined &&
    patch.precision === undefined &&
    patch.abbreviation === undefined
  ) {
    return getUnit(tx, unitId);
  }
  const [row] = await tx
    .update(units)
    .set(patch)
    .where(eq(units.id, unitId))
    .returning(UNIT_COLUMNS);
  if (row === undefined) throw new AppError("unit.not_found", { unitId });
  return row;
}

export async function assignProductUnit(
  tx: Transaction,
  productId: string,
  unitId: string,
): Promise<void> {
  // No row lock: `withTransaction` is the venue file's one write lock (packages/db/src/tenancy.ts).
  const [unit] = await tx.select({ id: units.id }).from(units).where(eq(units.id, unitId));
  if (unit === undefined) throw new AppError("unit.not_found", { unitId });
  const [product] = await tx
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, productId));
  if (product === undefined) throw new AppError("product.not_found", { productId });
  await tx.insert(productUnits).values({ productId, unitId }).onConflictDoUpdate({
    target: productUnits.productId,
    set: { unitId },
  });
}

/** Move the listed products onto the target unit, scoped to the products still on `sourceUnitId`:
 * one another manager has already moved elsewhere is left where it is, and an id not currently on
 * `sourceUnitId` (an unknown id included) is skipped, never an error. A `null` target instead
 * deletes those rows, so the product becomes Each and a variant reads its parent's unit. */
export async function reassignProductsToUnit(
  tx: Transaction,
  sourceUnitId: string,
  productIds: readonly string[],
  targetUnitId: string | null,
): Promise<void> {
  const scope = and(
    eq(productUnits.unitId, sourceUnitId),
    inArray(productUnits.productId, productIds),
  );
  if (targetUnitId === null) {
    // The UPDATE runs BEFORE the DELETE so it can scope by the product_units rows still present.
    await tx
      .update(products)
      .set({ pricingUnit: clearedPricingUnit() })
      .where(
        inArray(
          products.id,
          tx.select({ id: productUnits.productId }).from(productUnits).where(scope),
        ),
      );
    await tx.delete(productUnits).where(scope);
    return;
  }
  const [target] = await tx.select({ id: units.id }).from(units).where(eq(units.id, targetUnitId));
  if (target === undefined) throw new AppError("unit.not_found", { unitId: targetUnitId });
  await tx.update(productUnits).set({ unitId: targetUnitId }).where(scope);
}

/** Remove a product's unit assignment: a top-level product then reads as Each, a variant as its
 * parent's unit. It leaves `pricing_unit` alone, so the caller sets that. A no-op when there is no row. */
export async function clearProductUnit(tx: Transaction, productId: string): Promise<void> {
  await tx.delete(productUnits).where(eq(productUnits.productId, productId));
}

/** The products that assign this unit, ordered by product id. */
export async function productsUsingUnit(
  tx: Transaction,
  unitId: string,
): Promise<ProductUsingUnit[]> {
  return tx
    .select({ id: products.id, name: products.name, available: products.active })
    .from(productUnits)
    .innerJoin(products, eq(products.id, productUnits.productId))
    .where(eq(productUnits.unitId, unitId))
    .orderBy(asc(products.id));
}

export async function deleteUnit(tx: Transaction, unitId: string): Promise<void> {
  // No row lock: `withTransaction` is the venue file's one write lock (packages/db/src/tenancy.ts).
  const [existing] = await tx.select({ id: units.id }).from(units).where(eq(units.id, unitId));
  if (existing === undefined) throw new AppError("unit.not_found", { unitId });
  const references = await productsUsingUnit(tx, unitId);
  if (references.length > 0) {
    throw new AppError("unit.in_use", { products: references });
  }
  await tx.delete(units).where(eq(units.id, unitId));
}
