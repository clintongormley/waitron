import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { menus, sections, type Database, type Transaction } from "@waitron/db";

export async function storedMenuParts(tx: Database | Transaction, menuId?: string) {
  const root = alias(sections, "stored_root");
  const home = alias(sections, "stored_home");
  return tx
    .select({
      menuId: menus.id,
      rootSectionId: root.id,
      homeSectionId: home.id,
      handheldColumns: menus.handheldColumns,
      handheldTiles: menus.handheldTiles,
      handheldOrder: menus.handheldOrder,
      tillColumns: menus.tillColumns,
      tillTiles: menus.tillTiles,
      tillOrder: menus.tillOrder,
    })
    .from(menus)
    .innerJoin(root, and(eq(root.ownerMenuId, menus.id), eq(root.role, "menu_root")))
    .innerJoin(home, and(eq(home.ownerMenuId, menus.id), eq(home.role, "home_layout")))
    .where(menuId === undefined ? undefined : eq(menus.id, menuId))
    .orderBy(menus.id);
}
