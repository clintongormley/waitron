import { eq } from "drizzle-orm";
import { menus, readSettings, type Transaction } from "@waitron/db";
import { GUEST_MENU_SETTINGS } from "./guest-menu-settings.js";
import { readDefaultMenuId } from "./operations.js";
import { readLiveMenu } from "./menu-publication.js";
import type { LiveMenu } from "./menu-patch-types.js";

export async function readGuestMenu(tx: Transaction): Promise<LiveMenu | null> {
  if (!(await readSettings(tx, GUEST_MENU_SETTINGS)).doc.enabled) return null;
  const menuId = await readDefaultMenuId(tx);
  if (menuId === null) return null;
  const [menu] = await tx
    .select({ active: menus.active })
    .from(menus)
    .where(eq(menus.id, menuId));
  if (!menu?.active) return null;
  return readLiveMenu(tx, menuId);
}
