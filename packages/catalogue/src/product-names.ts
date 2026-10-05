import { and, asc, eq, isNull, or } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { firstNewClash, foldName } from "./name-uniqueness.js";
import { parentJoin, parentProducts } from "./variant-fallback.js";
import "./errors.js";

/** A stored product or variant, as the unique-name rule reads it. */
export interface StoredName {
  id: string;
  name: string;
  active: boolean;
}

/** One row of a product family (a product and its variants) as a write leaves it. */
interface FamilyName {
  name: string;
  /** Where a refusal of this row's name is shown: `name`, or `variants.<i>.name`. */
  field: string;
  /** Whether the write creates the row, renames it, or makes it count. */
  changed: boolean;
  /** Whether the row counts once the write is done. */
  counted: boolean;
}

/** `before` is whether the row counted before the write and its stored name; absent for a row the
 * write creates. */
function nameChanged(
  before: { counted: boolean; name: string } | undefined,
  name: string,
): boolean {
  return before === undefined || !before.counted || foldName(before.name) !== foldName(name);
}

/**
 * Refuses a write that would leave two counting rows — Active products, and Active variants of
 * Active products — sharing a staff name across the whole venue, catalogue and category aside.
 * `family` is the set of rows the write decides, as it leaves them; `familyIds` every stored row in
 * that set, which are judged by `family` rather than by what they store now, so a save that swaps
 * names within the set passes. Only a clash involving a changed row is refused (`firstNewClash`).
 */
async function assertProductNamesFree(
  tx: Transaction,
  family: readonly FamilyName[],
  familyIds: readonly string[],
): Promise<void> {
  const entries = family.filter((row) => row.counted);
  if (!entries.some((row) => row.changed)) return;
  const excluded = new Set(familyIds);
  const counting = await tx
    .select({ id: products.id, name: products.name })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .where(
      and(
        eq(products.active, true),
        or(isNull(products.parentId), eq(parentProducts.active, true)),
      ),
    );
  const others = counting
    .filter((row) => !excluded.has(row.id))
    .map((row) => ({ name: row.name, field: "", changed: false }));
  const clash = firstNewClash([...others, ...entries]);
  if (clash)
    throw new AppError("product.name_taken", { field: clash.field, name: clash.name.trim() });
}

/**
 * {@link assertProductNamesFree} for a write to a product with no parent and its variants.
 * `stored` is the product as stored, null for one the write creates, with its variants in variant
 * order; they are read when absent. `product` holds the fields the write sets; `variants`, when
 * given, is the whole list the write leaves, in order, and a stored variant it leaves out is made
 * Inactive (`writeProductVariants`); absent, the stored variants stay as they are.
 */
export async function assertFamilyNamesFree(
  tx: Transaction,
  stored: { product: StoredName; variants?: readonly StoredName[] } | null,
  product: { name?: string; active?: boolean },
  variants?: readonly { id?: string; name: string; active: boolean }[],
): Promise<void> {
  const storedVariants =
    stored === null
      ? []
      : (stored.variants ??
        (await tx
          .select({ id: products.id, name: products.name, active: products.active })
          .from(products)
          .where(eq(products.parentId, stored.product.id))
          .orderBy(asc(products.variantOrder), asc(products.id))));
  const was = stored?.product;
  const active = product.active ?? was!.active;
  const name = product.name ?? was!.name;
  const byId = new Map(storedVariants.map((row) => [row.id, row]));
  const family: FamilyName[] = [
    {
      name,
      field: "name",
      changed: nameChanged(was && { counted: was.active, name: was.name }, name),
      counted: active,
    },
    ...(variants ?? storedVariants).map((row, index) => {
      const before = row.id === undefined ? undefined : byId.get(row.id);
      return {
        name: row.name,
        field: `variants.${index}.name`,
        changed: nameChanged(
          before && { counted: was!.active && before.active, name: before.name },
          row.name,
        ),
        counted: active && row.active,
      };
    }),
  ];
  await assertProductNamesFree(tx, family, [
    ...(was === undefined ? [] : [was.id]),
    ...storedVariants.map((row) => row.id),
  ]);
}

/** A row `updateProduct` writes, with whether its parent, if it has one, is Active. */
export interface UpdatedName extends StoredName {
  parentId: string | null;
  parentActive: boolean | null;
}

/** The row {@link assertUpdatedNamesFree} judges, or undefined when `id` names none. */
export async function readUpdatedName(
  tx: Transaction,
  id: string,
): Promise<UpdatedName | undefined> {
  const [row] = await tx
    .select({
      id: products.id,
      name: products.name,
      active: products.active,
      parentId: products.parentId,
      parentActive: parentProducts.active,
    })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .where(eq(products.id, id));
  return row;
}

/** {@link assertProductNamesFree} for a write of one row's name or Active state through
 * `updateProduct`. */
export async function assertUpdatedNamesFree(
  tx: Transaction,
  row: UpdatedName,
  patch: { name?: string; active?: boolean },
): Promise<void> {
  if (row.parentId === null) return assertFamilyNamesFree(tx, { product: row }, patch);
  // A variant's siblings and parent are outside this write, so they are judged as stored.
  const parentActive = row.parentActive === true;
  const name = patch.name ?? row.name;
  await assertProductNamesFree(
    tx,
    [
      {
        name,
        field: "name",
        changed: nameChanged({ counted: row.active && parentActive, name: row.name }, name),
        counted: (patch.active ?? row.active) && parentActive,
      },
    ],
    [row.id],
  );
}
