import { eq, inArray, sql } from "drizzle-orm";
import {
  billSetMenuCopies,
  menus,
  products,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import type { ZoneSelling, ZoneSetMenus } from "@waitron/module";
import { copiesListing, newBillVersionOf, setMenuCopyOf, type SetMenuCopy } from "@waitron/shared";
import { serveRecordedSetMenus } from "@waitron/venue-service";
import { VENUE_SERVICE } from "./modules.js";
import { isSetMenuBill, readBillSetMenuVersions } from "./set-menu-bill.js";

/** A dish as a set menu lists it: a variant by its parent's id and its own. */
interface ListedDish {
  productId: string;
  variantId: string | null;
}

/** What linking a priced round's set menus needs, as pricing resolved it. */
export interface SetMenuLinks {
  zoneId: string | undefined;
  /** What the zone sold at the instant the lines were priced, or that instant when pricing
   *  resolved no service: a link never reads the clock again. */
  selling: Date | ZoneSelling;
  /** Every dish the round orders a portion of, a raised quantity included. */
  dishes: readonly ListedDish[];
}

type DishRow = Pick<
  typeof workingOrderLines.$inferInsert,
  "productId" | "parentLineId" | "setMenuRole"
>;

/** The newest copy on sale of each set menu the zone sells, with the version a new bill records. */
export function copiesOnSale(zone: ZoneSetMenus): SetMenuCopy[] {
  const selling = new Set(zone.sellingVersionIds);
  return zone.setMenus
    .filter(({ newestOnSale }) => newestOnSale)
    .map((copy) => setMenuCopyOf(copy, newBillVersionOf(copy.versionIds, selling)!));
}

function listingAny(copies: readonly SetMenuCopy[], dishes: readonly ListedDish[]) {
  const listed = new Map<string, SetMenuCopy>();
  for (const { productId, variantId } of dishes) {
    for (const copy of copiesListing(copies, productId, variantId))
      listed.set(copy.setMenuId, copy);
  }
  return [...listed.values()];
}

// No product path deletes a `menus` row or changes its kind, so a published document can hold a set
// menu only while a `set_menu` row exists, active or not.
async function venueHasSetMenus(tx: Transaction): Promise<boolean> {
  const [row] = await tx
    .select({ id: menus.id })
    .from(menus)
    .where(eq(menus.kind, "set_menu"))
    .limit(1);
  return row !== undefined;
}

function topLevelProductIds(rows: readonly DishRow[]): string[] {
  return [
    ...new Set(
      rows.flatMap(({ productId, parentLineId, setMenuRole }) =>
        productId == null || parentLineId != null || setMenuRole === "set_menu" ? [] : [productId],
      ),
    ),
  ];
}

async function listedDishes(tx: Transaction, productIds: readonly string[]) {
  const rows = await tx
    .select({ id: products.id, parentId: products.parentId })
    .from(products)
    .where(inArray(products.id, sql`(select value from json_each(${JSON.stringify(productIds)}))`));
  return rows.map(({ id, parentId }) => ({
    productId: parentId ?? id,
    variantId: parentId === null ? null : id,
  }));
}

/** Records on a set-menu bill the copy on sale of every set menu listing one of `links`' dishes; a
 *  set menu the bill already records keeps its copy. Any other bill is left alone. */
export async function linkSetMenusFor(
  tx: Transaction,
  billId: string,
  { zoneId, selling, dishes }: SetMenuLinks,
): Promise<void> {
  if (dishes.length === 0 || zoneId === undefined || !(await venueHasSetMenus(tx))) return;
  if (!(await isSetMenuBill(tx, billId))) return;
  const onSale = copiesOnSale(await VENUE_SERVICE.listZoneSetMenus(tx, zoneId, selling));
  if (onSale.length === 0) return;
  const linked = listingAny(onSale, dishes);
  if (linked.length === 0) return;
  await tx
    .insert(billSetMenuCopies)
    .values(
      linked.map(({ setMenuId, versionId }) => ({
        workingOrderId: billId,
        setMenuId,
        menuVersionId: versionId,
      })),
    )
    .onConflictDoNothing({
      target: [billSetMenuCopies.workingOrderId, billSetMenuCopies.setMenuId],
    });
}

/** The set menus `billId` records a copy of that list one of the top-level dishes among `rows`. */
export async function recordedSetMenusListing(
  tx: Transaction,
  billId: string,
  rows: readonly DishRow[],
): Promise<string[]> {
  const productIds = topLevelProductIds(rows);
  if (productIds.length === 0) return [];
  const recorded = await readBillSetMenuVersions(tx, billId);
  if (recorded.size === 0) return [];
  const requests = [...recorded].map(([menuId, versionId]) => ({ menuId, versionId }));
  const copies = (await serveRecordedSetMenus(tx, requests)).map((copy, index) =>
    setMenuCopyOf(copy, requests[index]!.versionId),
  );
  return listingAny(copies, await listedDishes(tx, productIds)).map(({ setMenuId }) => setMenuId);
}
