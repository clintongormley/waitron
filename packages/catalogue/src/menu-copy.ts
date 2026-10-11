import { eq, inArray } from "drizzle-orm";
import { newId, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { batches } from "./batches.js";
import { insertCatalogue, type Catalogue } from "./operations.js";
import { menuDetails, menuItems } from "./schema/menu.js";
import { sectionMembers, sections } from "./schema/sections.js";
import { menuItemVariantOverrides } from "./schema/variant-overrides.js";
import { sectionPatchValues } from "./sections.js";
import "./errors.js";

/**
 * A new menu holding the source's working copy as stored: its sections, their members, its details,
 * its menu items and their variant prices. Nothing published or scheduled is copied, and nothing
 * outside the menu is changed to point at the copy. A member naming a section another menu owns (an
 * include, or a shortcut reached through one) keeps naming it. The source is read, and the name
 * checked, before the first write.
 */
export async function duplicateMenu(
  tx: Transaction,
  sourceMenuId: string,
  name: string,
): Promise<Catalogue> {
  const [details] = await tx.select().from(menuDetails).where(eq(menuDetails.menuId, sourceMenuId));
  if (details === undefined)
    throw new AppError("catalogue.not_found", { catalogueId: sourceMenuId });
  const { internalName } = await sectionPatchValues(tx, { internalName: name });
  const owned = await tx.select().from(sections).where(eq(sections.ownerMenuId, sourceMenuId));
  const members = [];
  for (const batch of batches(owned.map((section) => section.id)))
    members.push(
      ...(await tx.select().from(sectionMembers).where(inArray(sectionMembers.sectionId, batch))),
    );
  const items = await tx.select().from(menuItems).where(eq(menuItems.menuId, sourceMenuId));
  const overrides = await tx
    .select({
      menuItemId: menuItemVariantOverrides.menuItemId,
      productId: menuItemVariantOverrides.productId,
      variantId: menuItemVariantOverrides.variantId,
      price: menuItemVariantOverrides.price,
    })
    .from(menuItemVariantOverrides)
    .innerJoin(menuItems, eq(menuItems.id, menuItemVariantOverrides.menuItemId))
    .where(eq(menuItems.menuId, sourceMenuId));

  const copy = await insertCatalogue(tx, internalName!);
  const sectionIds = new Map(owned.map((section) => [section.id, newId()]));
  const itemIds = new Map(items.map((item) => [item.id, newId()]));
  // Readers break a position tie by member id, so the new ids keep the old ids' order.
  const byId = (a: string, b: string) => (a < b ? -1 : 1);
  const memberIds = members.map(() => newId()).sort(byId);
  const copiedMembers = members
    .sort((a, b) => byId(a.id, b.id))
    .map((member, index) => ({
      ...member,
      id: memberIds[index]!,
      sectionId: sectionIds.get(member.sectionId)!,
      childSectionId:
        member.childSectionId === null
          ? null
          : (sectionIds.get(member.childSectionId) ?? member.childSectionId),
    }));
  for (const batch of batches(owned))
    await tx.insert(sections).values(
      batch.map((section) => ({
        ...section,
        id: sectionIds.get(section.id)!,
        ownerMenuId: copy.id,
        internalName: section.id === details.rootSectionId ? copy.name : section.internalName,
      })),
    );
  for (const batch of batches(copiedMembers)) await tx.insert(sectionMembers).values(batch);
  await tx.insert(menuDetails).values({
    ...details,
    menuId: copy.id,
    rootSectionId: sectionIds.get(details.rootSectionId)!,
    homeSectionId: sectionIds.get(details.homeSectionId)!,
  });
  for (const batch of batches(items))
    await tx
      .insert(menuItems)
      .values(batch.map((item) => ({ ...item, id: itemIds.get(item.id)!, menuId: copy.id })));
  for (const batch of batches(overrides))
    await tx
      .insert(menuItemVariantOverrides)
      .values(
        batch.map((override) => ({ ...override, menuItemId: itemIds.get(override.menuItemId)! })),
      );
  return copy;
}
