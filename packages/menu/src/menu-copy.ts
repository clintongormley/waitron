import { eq, inArray } from "drizzle-orm";
import { menus, menuItems, newId, sectionMembers, sections, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { batches } from "./batches.js";
import { insertMenu, type Menu } from "./operations.js";
import { sectionPatchValues } from "./sections.js";
import { copyMenuItemChoices, copySetMenuLines } from "./set-menus.js";
import "./errors.js";

/**
 * A new menu holding the source's working copy as stored: its sections, their members, its details,
 * its menu items and their variant prices. Nothing published or scheduled is copied, and nothing
 * outside the menu is changed to point at the copy. A member naming a section another menu owns (an
 * include, or a shortcut reached through one) keeps naming it.
 */
export async function duplicateMenu(
  tx: Transaction,
  sourceMenuId: string,
  name: string,
): Promise<Menu> {
  const [details] = await tx.select().from(menus).where(eq(menus.id, sourceMenuId));
  if (details === undefined) throw new AppError("menu.not_found", { menuId: sourceMenuId });
  const { internalName } = await sectionPatchValues(tx, { internalName: name });
  const owned = await tx.select().from(sections).where(eq(sections.ownerMenuId, sourceMenuId));
  const members = [];
  for (const batch of batches(owned.map((section) => section.id)))
    members.push(
      ...(await tx.select().from(sectionMembers).where(inArray(sectionMembers.sectionId, batch))),
    );
  const items = await tx.select().from(menuItems).where(eq(menuItems.menuId, sourceMenuId));

  const copy = await insertMenu(tx, internalName!, {
    kind: details.kind,
    setPrice: details.setPrice,
    setVatClass: details.setVatClass,
    setTakeawayVatClass: details.setTakeawayVatClass,
  });
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
        internalName: section.role === "menu_root" ? null : section.internalName,
      })),
    );
  for (const batch of batches(copiedMembers)) await tx.insert(sectionMembers).values(batch);
  await tx
    .update(menus)
    .set({
      handheldColumns: details.handheldColumns,
      handheldTiles: details.handheldTiles,
      handheldOrder: details.handheldOrder,
      tillColumns: details.tillColumns,
      tillTiles: details.tillTiles,
      tillOrder: details.tillOrder,
    })
    .where(eq(menus.id, copy.id));
  for (const batch of batches(items))
    await tx
      .insert(menuItems)
      .values(batch.map((item) => ({ ...item, id: itemIds.get(item.id)!, menuId: copy.id })));
  await copyMenuItemChoices(tx, itemIds, details.kind === "set_menu");
  if (details.kind === "set_menu") await copySetMenuLines(tx, sourceMenuId, copy.id);
  return copy;
}
