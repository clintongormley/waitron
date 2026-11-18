import { and, eq } from "drizzle-orm";
import { menus, type Transaction } from "@waitron/db";
import { AppError, MAX_SET_MENU_AMOUNT_CENTS, stringToCents, VAT_CLASSES } from "@waitron/shared";
import type { VatClass } from "@waitron/shared";
import { isProductPrice } from "./modifier-limits.js";
import "./errors.js";

export async function requireSetMenu(tx: Transaction, menuId: string): Promise<void> {
  const [menu] = await tx
    .select({ id: menus.id })
    .from(menus)
    .where(and(eq(menus.id, menuId), eq(menus.active, true), eq(menus.kind, "set_menu")));
  if (menu === undefined) throw new AppError("set_menu.not_found", { menuId });
}

export async function refuseSetMenu(tx: Transaction, menuId: string): Promise<void> {
  const [menu] = await tx.select({ kind: menus.kind }).from(menus).where(eq(menus.id, menuId));
  if (menu?.kind === "set_menu") throw new AppError("set_menu.wrong_place", { menuId });
}

export function setMenuPriceCents(price: string | null | undefined): number {
  if (typeof price !== "string" || !isProductPrice(price))
    throw new AppError("set_menu.invalid", { field: "setPrice" });
  const cents = stringToCents(price);
  if (cents > MAX_SET_MENU_AMOUNT_CENTS)
    throw new AppError("set_menu.invalid", { field: "setPrice" });
  return cents;
}

export function setMenuVatClass(vatClass: VatClass | null | undefined): VatClass {
  if (vatClass == null || !VAT_CLASSES.includes(vatClass))
    throw new AppError("set_menu.invalid", { field: "setVatClass" });
  return vatClass;
}
