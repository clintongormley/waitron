import { customerMenuStyles, menus, type Transaction } from "@waitron/db";
import {
  AppError,
  isStoredColor,
  type CustomerMenuAppearance,
  type CustomerMenuStyle,
} from "@waitron/shared";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import { assertMenuWritable } from "./delete.js";
import { refuseSetMenu } from "./set-menus.js";
import "./errors.js";

const isTypeface = (value: unknown) => value === "system" || value === "serif";

const fields = {
  pageColor: isStoredColor,
  textColor: isStoredColor,
  headingColor: isStoredColor,
  headingFont: isTypeface,
  textFont: isTypeface,
} satisfies Record<keyof CustomerMenuAppearance, (value: unknown) => boolean>;

export function checkedCustomerMenuAppearance(
  value: unknown,
  refuse: (field: string) => never,
): CustomerMenuAppearance {
  if (typeof value !== "object" || value === null || Array.isArray(value)) refuse("appearance");
  for (const [name, field] of Object.entries(value)) {
    if (!Object.hasOwn(fields, name) || !fields[name as keyof CustomerMenuAppearance](field))
      refuse(name);
  }
  return value as CustomerMenuAppearance;
}

export async function defaultCustomerMenuStyle(
  tx: Transaction,
  menuId: string,
  edited?: CustomerMenuAppearance,
): Promise<CustomerMenuStyle> {
  await assertMenuWritable(tx, menuId);
  await refuseSetMenu(tx, menuId);
  const [style] = await tx
    .select({
      id: customerMenuStyles.id,
      name: customerMenuStyles.name,
      appearance: customerMenuStyles.appearance,
    })
    .from(customerMenuStyles)
    .where(eq(customerMenuStyles.isDefault, true));
  if (!style) throw new AppError("menu.reset_required", { menuId });
  if (edited !== undefined)
    await tx
      .update(customerMenuStyles)
      .set({ appearance: edited, updatedAt: new Date() })
      .where(eq(customerMenuStyles.id, style.id));
  const affectedMenus = await tx
    .select({ id: menus.id, name: menus.name })
    .from(menus)
    .where(
      and(
        eq(menus.active, true),
        ne(menus.id, menuId),
        or(isNull(menus.customerMenuStyleId), eq(menus.customerMenuStyleId, style.id)),
      ),
    )
    .orderBy(menus.name);
  return { name: style.name, appearance: edited ?? style.appearance, affectedMenus };
}

export async function customerMenuAppearanceFor(
  tx: Transaction,
  menuId: string,
): Promise<CustomerMenuAppearance | undefined> {
  const [style] = await tx
    .select({ appearance: customerMenuStyles.appearance })
    .from(menus)
    .innerJoin(
      customerMenuStyles,
      or(
        eq(menus.customerMenuStyleId, customerMenuStyles.id),
        and(isNull(menus.customerMenuStyleId), eq(customerMenuStyles.isDefault, true)),
      ),
    )
    .where(eq(menus.id, menuId));
  return style?.appearance;
}
