import { customerMenuStyles, menus, type Transaction } from "@waitron/db";
import {
  AppError,
  isStoredColor,
  type CustomerMenuAppearance,
  type CustomerMenuStyle,
} from "@waitron/shared";
import { and, eq, ne, isNull, or } from "drizzle-orm";
import { foldName } from "./name-uniqueness.js";
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

const styleColumns = {
  id: customerMenuStyles.id,
  name: customerMenuStyles.name,
  isDefault: customerMenuStyles.isDefault,
  appearance: customerMenuStyles.appearance,
};

export async function requireCustomerMenuStyle(tx: Transaction, styleId: string) {
  const [style] = await tx
    .select()
    .from(customerMenuStyles)
    .where(eq(customerMenuStyles.id, styleId));
  if (!style) throw new AppError("management.request_invalid", { field: "styleId" });
  return style;
}

async function assertStyleEditable(tx: Transaction, menuId: string): Promise<void> {
  await assertMenuWritable(tx, menuId);
  await refuseSetMenu(tx, menuId);
}

export async function readCustomerMenuStyles(
  tx: Transaction,
  menuId: string,
): Promise<CustomerMenuStyle[]> {
  await assertStyleEditable(tx, menuId);
  const styles = await tx
    .select(styleColumns)
    .from(customerMenuStyles)
    .orderBy(customerMenuStyles.nameKey);
  const defaultStyle = styles.find(({ isDefault }) => isDefault);
  if (!defaultStyle) throw new AppError("menu.reset_required", { menuId });
  const users = await tx
    .select({ id: menus.id, name: menus.name, styleId: menus.customerMenuStyleId })
    .from(menus)
    .where(and(eq(menus.active, true), ne(menus.id, menuId)))
    .orderBy(menus.name);
  const affected = new Map<string, CustomerMenuStyle["affectedMenus"]>();
  for (const { id, name, styleId } of users) {
    const effective = styleId ?? defaultStyle.id;
    const inUse = affected.get(effective) ?? [];
    inUse.push({ id, name });
    affected.set(effective, inUse);
  }
  return styles.map((style) => ({ ...style, affectedMenus: affected.get(style.id) ?? [] }));
}

export async function writeCustomerMenuStyle(
  tx: Transaction,
  menuId: string,
  styleId: string,
  appearance: CustomerMenuAppearance,
  copyName?: string,
): Promise<CustomerMenuStyle> {
  if (copyName === undefined) {
    const style = (await readCustomerMenuStyles(tx, menuId)).find(({ id }) => id === styleId);
    if (!style) throw new AppError("management.request_invalid", { field: "styleId" });
    await tx
      .update(customerMenuStyles)
      .set({ appearance, updatedAt: new Date() })
      .where(eq(customerMenuStyles.id, styleId));
    return { ...style, appearance };
  }
  await assertStyleEditable(tx, menuId);
  const source = await requireCustomerMenuStyle(tx, styleId);
  const name = copyName.trim();
  if (!name) throw new AppError("management.request_invalid", { field: "name" });
  const nameKey = foldName(name);
  const [created] = await tx
    .insert(customerMenuStyles)
    .values({ name, nameKey, appearance, logoImage: source.logoImage })
    .onConflictDoNothing({ target: customerMenuStyles.nameKey })
    .returning(styleColumns);
  if (!created) throw new AppError("customer_menu.style_name_taken", { field: "name" });
  await tx.update(menus).set({ customerMenuStyleId: created.id }).where(eq(menus.id, menuId));
  return { ...created, affectedMenus: [] };
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
