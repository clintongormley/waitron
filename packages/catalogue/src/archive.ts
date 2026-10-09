import { and, eq, gt, inArray } from "drizzle-orm";
import { catalogues, now, products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { batches } from "./batches.js";
import type { MenuDocument } from "./menu-document-types.js";
import { liveVersions } from "./menu-publication.js";
import { menuScheduledPublications, menuVersions } from "./schema/publication.js";
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
