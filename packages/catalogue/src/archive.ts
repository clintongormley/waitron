import { and, eq, gt, inArray } from "drizzle-orm";
import { catalogues, now, products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { batches } from "./batches.js";
import type { MenuDocument } from "./menu-document-types.js";
import { liveVersions } from "./menu-publication.js";
import { menuScheduledPublications, menuVersions } from "./schema/publication.js";
import { takeOffMenus, dropMenuPrices } from "./menu-removal.js";
import { extraListItems } from "./schema/extras.js";
import { readUpdatedName } from "./product-names.js";
import "./errors.js";

export interface HoldingMenu {
  id: string;
  name: string;
}

export function documentProductIds(document: MenuDocument): Set<string> {
  const ids = new Set<string>();
  for (const offer of Object.values(document.offers)) {
    ids.add(offer.productId);
    for (const variant of offer.variants) ids.add(variant.id);
    for (const entry of offer.offeredModifiers)
      if (entry.kind === "extras") for (const item of entry.items) ids.add(item.productId);
  }
  for (const tile of document.home.shortcuts) if (tile.kind === "product") ids.add(tile.productId);
  return ids;
}

export async function publishedMenusHolding(
  tx: Transaction,
  productIds: readonly string[],
  at: Date = now(),
): Promise<Map<string, HoldingMenu[]>> {
  const wanted = new Set(productIds);
  if (wanted.size === 0) return new Map();
  const documents: MenuDocument[] = [];
  for (const version of (await liveVersions(tx, undefined, "document", at)).values())
    documents.push(version.document!);
  for (const row of await tx
    .select({ document: menuVersions.document })
    .from(menuScheduledPublications)
    .innerJoin(menuVersions, eq(menuVersions.id, menuScheduledPublications.versionId))
    .where(
      and(
        eq(menuScheduledPublications.state, "queued"),
        gt(menuScheduledPublications.activatesAt, at),
      ),
    ))
    documents.push(row.document);
  const served = new Map(
    (
      await tx
        .select({ id: catalogues.id, name: catalogues.name })
        .from(catalogues)
        .where(eq(catalogues.active, true))
    ).map((row) => [row.id, row.name]),
  );
  const holding = new Map<string, Map<string, HoldingMenu>>();
  for (const document of documents) {
    const name = served.get(document.menuId);
    if (name === undefined) continue;
    for (const productId of documentProductIds(document)) {
      if (!wanted.has(productId)) continue;
      const menus = holding.get(productId) ?? new Map<string, HoldingMenu>();
      menus.set(document.menuId, { id: document.menuId, name });
      holding.set(productId, menus);
    }
  }
  return new Map(
    [...holding].map(([productId, menus]) => [
      productId,
      [...menus.values()].sort((a, b) => a.name.localeCompare(b.name)),
    ]),
  );
}

export async function assertOffPublishedMenus(
  tx: Transaction,
  productIds: readonly string[],
): Promise<void> {
  const holding = await publishedMenusHolding(tx, productIds);
  if (holding.size === 0) return;
  const names = new Map<string, string>();
  for (const batch of batches([...holding.keys()]))
    for (const row of await tx
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(inArray(products.id, batch)))
      names.set(row.id, row.name);
  const menus = new Map<string, HoldingMenu>();
  for (const list of holding.values()) for (const menu of list) menus.set(menu.id, menu);
  throw new AppError("product.on_live_menu", {
    products: [...holding.keys()].map((id) => ({ id, name: names.get(id)! })),
    menus: [...menus.values()].sort((a, b) => a.name.localeCompare(b.name)),
  });
}

export async function markInactive(tx: Transaction, ids: readonly string[]): Promise<void> {
  for (const batch of batches(ids))
    await tx
      .update(products)
      .set({ active: false, updatedAt: now() })
      .where(inArray(products.id, batch));
}

export async function removeFromExtraLists(
  tx: Transaction,
  productIds: readonly string[],
): Promise<void> {
  for (const batch of batches(productIds))
    await tx.delete(extraListItems).where(inArray(extraListItems.productId, batch));
}

// A missing row retains the caller's own not-found behavior.
export async function assertProductWritable(tx: Transaction, productId: string): Promise<void> {
  const row = await readUpdatedName(tx, productId);
  if (row !== undefined && (!row.active || row.parentActive === false))
    throw new AppError("product.archived", { productId });
}

export async function archiveProducts(tx: Transaction, ids: readonly string[]): Promise<void> {
  const named: { id: string; parentId: string | null; active: boolean }[] = [];
  for (const batch of batches(ids))
    named.push(
      ...(await tx
        .select({ id: products.id, parentId: products.parentId, active: products.active })
        .from(products)
        .where(inArray(products.id, batch))),
    );
  const dishes = named.filter((r) => r.active && r.parentId === null).map((r) => r.id);
  const variants = new Set(named.filter((r) => r.active && r.parentId !== null).map((r) => r.id));
  for (const batch of batches(dishes))
    for (const variant of await tx
      .select({ id: products.id })
      .from(products)
      .where(and(inArray(products.parentId, batch), eq(products.active, true))))
      variants.add(variant.id);
  const all = [...dishes, ...variants];
  await assertOffPublishedMenus(tx, all);
  await markInactive(tx, all);
  await removeFromExtraLists(tx, all);
  await takeOffMenus(tx, dishes);
  await dropMenuPrices(tx, [...variants]);
}
