import { and, asc, eq, inArray } from "drizzle-orm";
import {
  settings,
  decodeSettingsRow,
  VENUE_SETTINGS,
  products,
  units,
  type Transaction,
} from "@waitron/db";
import { readProductModifiers } from "./product-modifiers.js";
import type { ProductUsingUnit } from "./unit-types.js";

export type { ProductUsingUnit };
import { AppError } from "@waitron/shared";
import { contentLanguagesOr } from "./content-languages.js";
import {
  mergeOptionalTranslations,
  validateOptionalTranslations,
} from "./optional-translations.js";
import { EACH_UNIT_ID, unitStaffText, validateUnitPrecision } from "./unit-validation.js";
import { isTopLevelProduct, productWithId } from "./variant-fallback.js";
export {
  EACH_UNIT_ID,
  MAX_UNIT_PRECISION,
  assertQuantityPrecision,
  validateUnitPrecision,
} from "./unit-validation.js";
import "./errors.js";
import type { Unit, SellableUnit } from "@waitron/shared";
export type { Unit, SellableUnit } from "@waitron/shared";

/** The unit a product reads as when it has NO stored unit. It is NEVER written to `units` or
 * a product's unit column. */
export const EACH_UNIT: SellableUnit = {
  id: EACH_UNIT_ID,
  staffName: "Each",
  staffAbbreviation: "ea",
  name: { en: "Each", es: "Unidad", ca: "Unitat", gl: "Unidade", eu: "Unitatea" },
  abbreviation: { en: "ea", es: "ud", ca: "u", gl: "u", eu: "u" },
  precision: 0,
  hardwareUnit: null,
};

/**
 * Whether a unit is Each, decided by its identity and never by its abbreviation, which a venue can
 * rename. A stored unit seeded as `each` is Each too.
 */
export function isEachUnit(unit: { id: string; seedKey: string | null }): boolean {
  return unit.id === EACH_UNIT_ID || unit.seedKey === "each";
}

export interface CreateUnitInput {
  staffName: string;
  staffAbbreviation: string;
  name: Record<string, string>;
  precision: number;
  abbreviation: Record<string, string>;
  measure?: boolean;
}

export interface UpdateUnitInput {
  staffName?: string;
  staffAbbreviation?: string;
  name?: Record<string, string>;
  precision?: number;
  abbreviation?: Record<string, string>;
  measure?: boolean;
}

/** The stored switch as every unit shape carries it: the key is present only when on. */
export function unitMeasure(measure: boolean): { measure?: true } {
  return measure ? { measure: true } : {};
}

const UNIT_COLUMNS = {
  id: units.id,
  staffName: units.staffName,
  staffAbbreviation: units.staffAbbreviation,
  name: units.name,
  precision: units.precision,
  abbreviation: units.abbreviation,
  measure: units.measure,
};

function toUnit({ measure, ...row }: { measure: boolean } & Omit<Unit, "measure">): Unit {
  return { ...row, ...unitMeasure(measure) };
}
const SELLABLE_UNIT_COLUMNS = { ...UNIT_COLUMNS, hardwareUnit: units.hardwareUnit };

function toSellableUnit(row: {
  id: string;
  name: Record<string, string>;
  precision: number;
  abbreviation: Record<string, string>;
  hardwareUnit: string | null;
  staffName: string;
  staffAbbreviation: string;
  measure: boolean;
}): SellableUnit {
  return { ...toUnit(row), hardwareUnit: row.hardwareUnit as SellableUnit["hardwareUnit"] };
}

export async function createUnit(
  tx: Transaction,
  input: CreateUnitInput,
  fallbackLanguage: string,
): Promise<SellableUnit> {
  void fallbackLanguage;
  const staffName = unitStaffText(input.staffName, "staffName");
  const staffAbbreviation = unitStaffText(input.staffAbbreviation, "staffAbbreviation");
  const name = validateOptionalTranslations(input.name);
  const abbreviation = validateOptionalTranslations(input.abbreviation);
  validateUnitPrecision(input.precision);
  const [row] = await tx
    .insert(units)
    .values({
      staffName,
      staffAbbreviation,
      name,
      abbreviation,
      precision: input.precision,
      measure: input.measure ?? false,
    })
    .returning(SELLABLE_UNIT_COLUMNS);
  return toSellableUnit(row!);
}

export async function listUnits(tx: Transaction): Promise<SellableUnit[]> {
  const rows = await tx.select(SELLABLE_UNIT_COLUMNS).from(units).orderBy(asc(units.id));
  return rows.map(toSellableUnit);
}

export async function getUnit(tx: Transaction, unitId: string): Promise<SellableUnit> {
  const [row] = await tx.select(SELLABLE_UNIT_COLUMNS).from(units).where(eq(units.id, unitId));
  if (row === undefined) throw new AppError("unit.not_found", { unitId });
  return toSellableUnit(row);
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
): Promise<SellableUnit> {
  const values: UpdateUnitInput = {};
  if (patch.staffName !== undefined) values.staffName = unitStaffText(patch.staffName, "staffName");
  if (patch.staffAbbreviation !== undefined)
    values.staffAbbreviation = unitStaffText(patch.staffAbbreviation, "staffAbbreviation");
  if (patch.precision !== undefined) values.precision = validateUnitPrecision(patch.precision);
  if (patch.name !== undefined || patch.abbreviation !== undefined) {
    const [stored] = await tx
      .select({
        unit: UNIT_COLUMNS,
        config: {
          module: settings.module,
          version: settings.version,
          revision: settings.revision,
          doc: settings.doc,
        },
      })
      .from(units)
      .leftJoin(settings, eq(settings.module, "venue"))
      .where(eq(units.id, unitId));
    if (stored === undefined) throw new AppError("unit.not_found", { unitId });
    const { doc } = decodeSettingsRow(stored.config ?? undefined, VENUE_SETTINGS);
    const config = contentLanguagesOr(
      doc.contentLanguages === null
        ? undefined
        : { defaultLanguage: doc.defaultContentLanguage!, languages: doc.contentLanguages },
      fallbackLanguage,
    );
    for (const field of ["name", "abbreviation"] as const) {
      if (patch[field] !== undefined) {
        validateOptionalTranslations(patch[field]);
        values[field] = mergeOptionalTranslations(stored.unit[field], patch[field], config) ?? {};
      }
    }
  }
  if (patch.measure !== undefined) values.measure = patch.measure;
  if (Object.keys(values).length === 0) return getUnit(tx, unitId);
  const [row] = await tx
    .update(units)
    .set(values)
    .where(eq(units.id, unitId))
    .returning(SELLABLE_UNIT_COLUMNS);
  if (row === undefined) throw new AppError("unit.not_found", { unitId });
  return toSellableUnit(row);
}

/** Give a product its unit. A variant has none of its own (it always reads its parent's), so its id
 * answers as an id that names no product. */
export async function assignProductUnit(
  tx: Transaction,
  productId: string,
  unitId: string,
): Promise<void> {
  const [unit] = await tx.select({ id: units.id }).from(units).where(eq(units.id, unitId));
  if (unit === undefined) throw new AppError("unit.not_found", { unitId });
  const [product] = await tx
    .select({ id: products.id })
    .from(products)
    .where(productWithId(productId, "top-level"));
  if (product === undefined) throw new AppError("product.not_found", { productId });
  await tx.update(products).set({ unitId }).where(eq(products.id, productId));
}

/** Move the listed products onto the target unit, scoped to the products still on `sourceUnitId`:
 * one another manager has already moved elsewhere is left where it is, and an id not currently on
 * `sourceUnitId` (an unknown id included), or a variant's, is skipped, never an error. A `null`
 * target clears the column, so the product becomes Each. */
export async function reassignProductsToUnit(
  tx: Transaction,
  sourceUnitId: string,
  productIds: readonly string[],
  targetUnitId: string | null,
): Promise<void> {
  const scope = and(
    eq(products.unitId, sourceUnitId),
    inArray(products.id, productIds),
    isTopLevelProduct,
  );
  const [archived] = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.active, false), scope));
  if (archived !== undefined) throw new AppError("product.archived", { productId: archived.id });
  if (targetUnitId !== null) {
    const [target] = await tx
      .select({ id: units.id })
      .from(units)
      .where(eq(units.id, targetUnitId));
    if (target === undefined) throw new AppError("unit.target_not_found", { unitId: targetUnitId });
  }
  await tx.update(products).set({ unitId: targetUnitId }).where(scope);
}

/** Clear the stored assignment; a product without a unit reads as Each. */
export async function clearProductUnit(tx: Transaction, productId: string): Promise<void> {
  await tx.update(products).set({ unitId: null }).where(eq(products.id, productId));
}

/** The products that assign this unit, ordered by product id. A row a variant still stores is not
 * listed: a variant always reads its parent's unit. */
export async function productsUsingUnit(
  tx: Transaction,
  unitId: string,
  { activeOnly = false }: { activeOnly?: boolean } = {},
): Promise<ProductUsingUnit[]> {
  return tx
    .select({ id: products.id, name: products.name, active: products.active })
    .from(products)
    .where(
      and(
        eq(products.unitId, unitId),
        isTopLevelProduct,
        activeOnly ? eq(products.active, true) : undefined,
      ),
    )
    .orderBy(asc(products.id));
}

export async function countProductsWithAttachedExtras(
  tx: Transaction,
  unitId: string,
): Promise<number> {
  const dishes = await productsUsingUnit(tx, unitId);
  const modifiers = await readProductModifiers(
    tx,
    dishes.map((dish) => dish.id),
  );
  return dishes.filter((dish) => modifiers.get(dish.id)?.some((list) => list.kind === "extras"))
    .length;
}

export async function deleteUnit(tx: Transaction, unitId: string): Promise<void> {
  const [existing] = await tx.select({ id: units.id }).from(units).where(eq(units.id, unitId));
  if (existing === undefined) throw new AppError("unit.not_found", { unitId });
  const references = await productsUsingUnit(tx, unitId, { activeOnly: true });
  if (references.length > 0) {
    throw new AppError("unit.in_use", { products: references });
  }
  await tx.update(products).set({ unitId: null }).where(eq(products.unitId, unitId));
  await tx.delete(units).where(eq(units.id, unitId));
}
