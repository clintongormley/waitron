import { eq, inArray } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import { batches } from "./batches.js";
import { syncMenuOffers } from "./menu-structure.js";
import { sectionMembers } from "./schema/sections.js";
import { menuItemVariantOverrides } from "./schema/variant-overrides.js";
import { loadSectionGraph, menusContaining } from "./section-graph.js";
import { renumber } from "./section-members.js";

/**
 * Takes the products off every menu, deleted menus included, as a staff removal from each list
 * would: each list renumbers and each menu that reached it resets the product's settings. A Device
 * Home Page shortcut to one becomes a missing tile in its place, so the grid does not move. An id
 * that is a variant loses its price on every menu; it is listed only under its product.
 */
export async function takeOffMenus(tx: Transaction, productIds: readonly string[]): Promise<void> {
  for (const batch of batches(productIds))
    await tx
      .delete(menuItemVariantOverrides)
      .where(inArray(menuItemVariantOverrides.variantId, batch));
  const held: { id: string; sectionId: string; productId: string }[] = [];
  for (const batch of batches(productIds))
    for (const row of await tx
      .select({
        id: sectionMembers.id,
        sectionId: sectionMembers.sectionId,
        productId: sectionMembers.productId,
      })
      .from(sectionMembers)
      .where(inArray(sectionMembers.productId, batch)))
      held.push({ ...row, productId: row.productId! });
  if (held.length === 0) return;
  const before = await loadSectionGraph(tx);
  const removing = new Set(productIds);
  const lists = new Set<string>();
  const homes = new Set<string>();
  for (const { sectionId } of held)
    (before.role(sectionId) === "home_layout" ? homes : lists).add(sectionId);
  if (homes.size > 0) {
    const names = new Map<string, string>();
    const shortcutProducts = [
      ...new Set(held.filter((row) => homes.has(row.sectionId)).map((row) => row.productId)),
    ];
    for (const batch of batches(shortcutProducts))
      for (const row of await tx
        .select({ id: products.id, name: products.name })
        .from(products)
        .where(inArray(products.id, batch)))
        names.set(row.id, row.name);
    for (const { id, sectionId, productId } of held)
      if (homes.has(sectionId))
        await tx
          .update(sectionMembers)
          .set({ productId: null, childSectionId: null, missingName: names.get(productId)! })
          .where(eq(sectionMembers.id, id));
  }
  const listRows = held.filter((row) => lists.has(row.sectionId)).map((row) => row.id);
  for (const batch of batches(listRows))
    await tx.delete(sectionMembers).where(inArray(sectionMembers.id, batch));
  const menus = new Set<string>();
  for (const listId of lists) {
    for (const menuId of menusContaining(before, listId)) menus.add(menuId);
    await renumber(
      tx,
      before
        .children(listId)
        .filter((member) => !(member.ref.kind === "product" && removing.has(member.ref.productId))),
    );
  }
  // A Device Home Page writes no `menu_items` rows, so only the menus reaching a list are synced.
  await syncMenuOffers(tx, [...menus].sort(), before);
}
