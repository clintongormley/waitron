import { and, asc, eq } from "drizzle-orm";
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
  return { ...row, hardwareUnit: row.hardwareUnit as SellableUnit["hardwareUnit"] };
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
  await getUnit(tx, tenantId, unitId);
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

export async function deleteUnit(tx: Transaction, tenantId: string, unitId: string): Promise<void> {
  const [locked] = await tx
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.tenantId, tenantId), eq(units.id, unitId)))
    .for("update");
  if (locked === undefined) throw new AppError("unit.not_found", { unitId });
  const references = await tx
    .select({ name: products.descriptions })
    .from(productUnits)
    .innerJoin(
      products,
      and(eq(products.tenantId, productUnits.tenantId), eq(products.id, productUnits.productId)),
    )
    .where(and(eq(productUnits.tenantId, tenantId), eq(productUnits.unitId, unitId)))
    .orderBy(asc(products.id));
  if (references.length > 0) {
    throw new AppError("unit.in_use", { products: references.map(({ name }) => name) });
  }
  await tx.delete(units).where(and(eq(units.tenantId, tenantId), eq(units.id, unitId)));
}
