import { and, asc, eq, isNull, or } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { firstNewClash, foldName } from "./name-uniqueness.js";
import { parentJoin, parentProducts } from "./variant-fallback.js";
import "./errors.js";

/** One row of a product family (a product and its variants) as a write leaves it. */
export interface FamilyName {
  name: string;
  /** Where a refusal of this row's name is shown: `name`, or `variants.<i>.name`. */
  field: string;
  /** Whether the row counted before the write: Active, and for a variant its parent Active too.
   * `nameBefore` is its stored name then; absent for a row the write creates. */
  before?: { counted: boolean; nameBefore: string };
  /** Whether the row counts once the write is done. */
  counted: boolean;
}

/**
 * Refuses a write that would leave two counting rows — Active products, and Active variants of
 * Active products — sharing a staff name across the whole venue, catalogue and category aside.
 * `family` is the set of rows the write decides, as it leaves them; `familyIds` every stored row in
 * that set, which are judged by `family` rather than by what they store now, so a save that swaps
 * names within the set passes. A row counts as changed when it is new, renamed, or starts to count;
 * only a clash involving a changed row is refused (`firstNewClash`).
 */
export async function assertProductNamesFree(
  tx: Transaction,
  family: readonly FamilyName[],
  familyIds: readonly string[],
): Promise<void> {
  const entries = family
    .map((row, index) => {
      const changed =
        row.before === undefined ||
        !row.before.counted ||
        foldName(row.before.nameBefore) !== foldName(row.name);
      return { ...row, group: changed ? String(index) : null };
    })
    .filter((row) => row.counted);
  if (entries.every((row) => row.group === null)) return;
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
    .map((row) => ({ name: row.name, field: "", group: null }));
  const clash = firstNewClash([...others, ...entries]);
  if (clash)
    throw new AppError("product.name_taken", { field: clash.field, name: clash.name.trim() });
}

/**
 * {@link assertProductNamesFree} for a write to a product with no parent and its variants.
 * `productId` is null for a product the write creates. `product` holds the fields the write sets;
 * `variants`, when given, is the whole list the write leaves, in order, and a stored variant it
 * leaves out is made Inactive (`writeProductVariants`); absent, the stored variants stay as they
 * are. A variant's absent `active` keeps its stored state, or is Active for a new one.
 */
export async function assertFamilyNamesFree(
  tx: Transaction,
  productId: string | null,
  product: { name?: string; active?: boolean },
  variants?: readonly { id?: string; name: string; active?: boolean }[],
): Promise<void> {
  let stored: { name: string; active: boolean } | undefined;
  let storedVariants: { id: string; name: string; active: boolean }[] = [];
  if (productId !== null) {
    [stored] = await tx
      .select({ name: products.name, active: products.active })
      .from(products)
      .where(eq(products.id, productId));
    if (stored === undefined) return;
    storedVariants = await tx
      .select({ id: products.id, name: products.name, active: products.active })
      .from(products)
      .where(eq(products.parentId, productId))
      .orderBy(asc(products.variantOrder), asc(products.id));
  }
  const active = product.active ?? stored?.active ?? true;
  const byId = new Map(storedVariants.map((row) => [row.id, row]));
  const family: FamilyName[] = [
    {
      name: product.name ?? stored!.name,
      field: "name",
      ...(stored && { before: { counted: stored.active, nameBefore: stored.name } }),
      counted: active,
    },
    ...(variants ?? storedVariants).map((row, index) => {
      const was = row.id === undefined ? undefined : byId.get(row.id);
      return {
        name: row.name,
        field: `variants.${index}.name`,
        ...(was && {
          before: { counted: stored!.active && was.active, nameBefore: was.name },
        }),
        counted: active && (row.active ?? was?.active ?? true),
      };
    }),
  ];
  await assertProductNamesFree(tx, family, [
    ...(productId === null ? [] : [productId]),
    ...storedVariants.map((row) => row.id),
  ]);
}

/** {@link assertProductNamesFree} for a write of one row's name or Active state through
 * `updateProduct`; a row that does not exist is left to that write. */
export async function assertUpdatedNamesFree(
  tx: Transaction,
  id: string,
  patch: { name?: string; active?: boolean },
): Promise<void> {
  const [row] = await tx
    .select({
      name: products.name,
      active: products.active,
      parentId: products.parentId,
      parentActive: parentProducts.active,
    })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .where(eq(products.id, id));
  if (row === undefined) return;
  if (row.parentId === null) return assertFamilyNamesFree(tx, id, patch);
  // A variant's siblings and parent are outside this write, so they are judged as stored.
  const parentActive = row.parentActive === true;
  await assertProductNamesFree(
    tx,
    [
      {
        name: patch.name ?? row.name,
        field: "name",
        before: { counted: row.active && parentActive, nameBefore: row.name },
        counted: (patch.active ?? row.active) && parentActive,
      },
    ],
    [id],
  );
}
