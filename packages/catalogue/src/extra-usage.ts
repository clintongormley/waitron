import { asc, eq, inArray } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import { buildMenuDocuments } from "./menu-document.js";
import { extraListItems, extraLists } from "./schema/extras.js";

export interface ExtraOfferUsage {
  productId: string;
  productName: string;
  lists: { id: string; name: string; menus: { id: string; name: string }[] }[];
}

export async function extraOfferUsage(
  tx: Transaction,
  productIds: readonly string[],
): Promise<ExtraOfferUsage[]> {
  if (productIds.length === 0) return [];
  const rows = await tx
    .select({
      productId: products.id,
      productName: products.name,
      listId: extraLists.id,
      listName: extraLists.name,
    })
    .from(extraListItems)
    .innerJoin(products, eq(products.id, extraListItems.productId))
    .innerJoin(extraLists, eq(extraLists.id, extraListItems.listId))
    .where(inArray(extraListItems.productId, [...new Set(productIds)]))
    .orderBy(asc(products.id), asc(extraLists.name), asc(extraLists.id));
  if (rows.length === 0) return [];

  const offeredMenus = new Map<string, { id: string; name: string }[]>();
  const { menus } = await buildMenuDocuments(tx);
  for (const { document } of menus.values()) {
    const offeredLists = new Set(
      Object.values(document.offers).flatMap((offer) =>
        offer.offeredModifiers
          .filter((modifier) => modifier.kind === "extras")
          .map((list) => list.id),
      ),
    );
    for (const listId of offeredLists) {
      const using = offeredMenus.get(listId) ?? [];
      using.push({ id: document.menuId, name: document.menuName });
      offeredMenus.set(listId, using);
    }
  }
  for (const using of offeredMenus.values())
    using.sort(
      (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );

  const byProduct = new Map<string, ExtraOfferUsage>();
  for (const row of rows) {
    let usage = byProduct.get(row.productId);
    if (usage === undefined) {
      usage = { productId: row.productId, productName: row.productName, lists: [] };
      byProduct.set(row.productId, usage);
    }
    usage.lists.push({
      id: row.listId,
      name: row.listName,
      menus: offeredMenus.get(row.listId) ?? [],
    });
  }
  return [...byProduct.values()];
}
