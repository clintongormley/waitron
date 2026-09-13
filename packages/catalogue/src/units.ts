import { and, asc, eq, inArray } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { validateContentTranslations } from "./content-languages.js";
import { productUnits, units } from "./schema/units.js";
import { validateUnitPrecision } from "./unit-validation.js";
export {
  MAX_UNIT_PRECISION,
  assertQuantityPrecision,
  validateUnitPrecision,
} from "./unit-validation.js";
import "./errors.js";

export interface Unit {
  id: string;
  name: Record<string, string>;
  precision: number;
}

/** A product that assigns a given unit — the shape both the deletion refusal and the read return. */
export interface ProductUsingUnit {
  id: string;
  name: Record<string, string>;
  available: boolean;
}

export interface SellableUnit extends Unit {
  hardwareUnit: "kg" | "g" | "mg" | null;
}

export interface CreateUnitInput {
  name: Record<string, string>;
  precision: number;
}

export interface UpdateUnitInput {
  name?: Record<string, string>;
  precision?: number;
}

const UNIT_COLUMNS = { id: units.id, name: units.name, precision: units.precision };
const SELLABLE_UNIT_COLUMNS = { ...UNIT_COLUMNS, hardwareUnit: units.hardwareUnit };

function toSellableUnit(row: {
  id: string;
  name: Record<string, string>;
  precision: number;
  hardwareUnit: string | null;
}): SellableUnit {
  return { ...row, hardwareUnit: row.hardwareUnit as SellableUnit["hardwareUnit"] };
}

export async function createUnit(
  tx: Transaction,
  tenantId: string,
  input: CreateUnitInput,
  fallbackLanguage: string,
): Promise<Unit> {
  await validateContentTranslations(tx, tenantId, input.name, fallbackLanguage);
  validateUnitPrecision(input.precision);
  const [row] = await tx
    .insert(units)
    .values({ tenantId, name: input.name, precision: input.precision })
    .returning(UNIT_COLUMNS);
  return row!;
}

export async function listUnits(tx: Transaction, tenantId: string): Promise<Unit[]> {
  return tx
    .select(UNIT_COLUMNS)
    .from(units)
    .where(eq(units.tenantId, tenantId))
    .orderBy(asc(units.id));
}

export async function getUnit(tx: Transaction, tenantId: string, unitId: string): Promise<Unit> {
  const [row] = await tx
    .select(UNIT_COLUMNS)
    .from(units)
    .where(and(eq(units.tenantId, tenantId), eq(units.id, unitId)));
  if (row === undefined) throw new AppError("unit.not_found", { unitId });
  return row;
}

/** Sale-facing read; the scale mapping is stored data and is never inferred from editable text. */
export async function getSellableUnit(
  tx: Transaction,
  tenantId: string,
  unitId: string,
): Promise<SellableUnit> {
  const [row] = await tx
    .select(SELLABLE_UNIT_COLUMNS)
    .from(units)
    .where(and(eq(units.tenantId, tenantId), eq(units.id, unitId)));
  if (row === undefined) throw new AppError("unit.not_found", { unitId });
  return toSellableUnit(row);
}

/** Resolve a legacy product choice to the tenant's retained seed, never to a made-up identifier. */
export async function getSeededUnit(
  tx: Transaction,
  tenantId: string,
  seedKey: "each" | "kg",
): Promise<SellableUnit | null> {
  const [row] = await tx
    .select(SELLABLE_UNIT_COLUMNS)
    .from(units)
    .where(and(eq(units.tenantId, tenantId), eq(units.seedKey, seedKey)));
  return row === undefined ? null : toSellableUnit(row);
}

export async function updateUnit(
  tx: Transaction,
  tenantId: string,
  unitId: string,
  patch: UpdateUnitInput,
  fallbackLanguage: string,
): Promise<Unit> {
  if (patch.name !== undefined) {
    await validateContentTranslations(tx, tenantId, patch.name, fallbackLanguage);
  }
  if (patch.precision !== undefined) validateUnitPrecision(patch.precision);
  if (patch.name === undefined && patch.precision === undefined) {
    return getUnit(tx, tenantId, unitId);
  }
  const [row] = await tx
    .update(units)
    .set(patch)
    .where(and(eq(units.tenantId, tenantId), eq(units.id, unitId)))
    .returning(UNIT_COLUMNS);
  if (row === undefined) throw new AppError("unit.not_found", { unitId });
  return row;
}

export async function assignProductUnit(
  tx: Transaction,
  tenantId: string,
  productId: string,
  unitId: string,
): Promise<void> {
  const [unit] = await tx
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.tenantId, tenantId), eq(units.id, unitId)))
    .for("key share");
  if (unit === undefined) throw new AppError("unit.not_found", { unitId });
  const [product] = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)));
  if (product === undefined) throw new AppError("product.not_found", { productId });
  await tx
    .insert(productUnits)
    .values({ tenantId, productId, unitId })
    .onConflictDoUpdate({
      target: [productUnits.tenantId, productUnits.productId],
      set: { unitId },
    });
}

/** Move the listed products onto the target unit, in ONE statement scoped to the products still on
 * `sourceUnitId`. Both halves matter: a product another manager has already moved elsewhere since
 * the caller's list was read is left where it is rather than overwritten, and a single UPDATE takes
 * its row locks in one scan instead of interleaving N separate statements' locks across a loop. The
 * scan order is PostgreSQL's choice, not the caller's list order, which is what `units.pg.test.ts`
 * runs two opposite-order reassignments against. An id that is not currently on `sourceUnitId` —
 * an unknown id or another tenant's included — matches no row and is skipped, never an error. */
export async function reassignProductsToUnit(
  tx: Transaction,
  tenantId: string,
  sourceUnitId: string,
  productIds: readonly string[],
  targetUnitId: string,
): Promise<void> {
  const [target] = await tx
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.tenantId, tenantId), eq(units.id, targetUnitId)))
    .for("key share");
  if (target === undefined) throw new AppError("unit.not_found", { unitId: targetUnitId });
  await tx
    .update(productUnits)
    .set({ unitId: targetUnitId })
    .where(
      and(
        eq(productUnits.tenantId, tenantId),
        eq(productUnits.unitId, sourceUnitId),
        inArray(productUnits.productId, productIds),
      ),
    );
}

export async function readProductUnitId(
  tx: Transaction,
  tenantId: string,
  productId: string,
): Promise<string> {
  const [row] = await tx
    .select({ productId: products.id, unitId: productUnits.unitId })
    .from(products)
    .leftJoin(
      productUnits,
      and(eq(productUnits.tenantId, products.tenantId), eq(productUnits.productId, products.id)),
    )
    .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)));
  if (row === undefined) throw new AppError("product.not_found", { productId });
  if (row.unitId === null) throw new AppError("unit.not_found", { unitId: productId });
  return row.unitId;
}

/** The products that assign this unit, each with its availability, ordered stably by product id.
 * Tenant-scoped on both tables (one tenant per database is not the query's isolation boundary). */
export async function productsUsingUnit(
  tx: Transaction,
  tenantId: string,
  unitId: string,
): Promise<ProductUsingUnit[]> {
  return tx
    .select({ id: products.id, name: products.descriptions, available: products.active })
    .from(productUnits)
    .innerJoin(
      products,
      and(eq(products.tenantId, productUnits.tenantId), eq(products.id, productUnits.productId)),
    )
    .where(and(eq(productUnits.tenantId, tenantId), eq(productUnits.unitId, unitId)))
    .orderBy(asc(products.id));
}

export async function deleteUnit(tx: Transaction, tenantId: string, unitId: string): Promise<void> {
  const [locked] = await tx
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.tenantId, tenantId), eq(units.id, unitId)))
    .for("update");
  if (locked === undefined) throw new AppError("unit.not_found", { unitId });
  const references = await productsUsingUnit(tx, tenantId, unitId);
  if (references.length > 0) {
    throw new AppError("unit.in_use", { products: references });
  }
  await tx.delete(units).where(and(eq(units.tenantId, tenantId), eq(units.id, unitId)));
}
