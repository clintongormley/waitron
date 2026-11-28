import { menus, refusalOn, UNIQUE_VIOLATION, type Transaction } from "@waitron/db";
import { AppError, isCustomerMenuAddress, type CustomerMenuOnlineSettings } from "@waitron/shared";
import { eq } from "drizzle-orm";
import { requireCustomerMenuStyle } from "./customer-menu-styles.js";
import { assertMenuWritable } from "./delete.js";
import { liveVersions } from "./menu-publication.js";
import { refuseSetMenu } from "./set-menus.js";
import "./errors.js";

const selection = {
  enabled: menus.onlineEnabled,
  address: menus.onlineAddress,
  photos: menus.onlinePhotos,
  styleId: menus.customerMenuStyleId,
};

export async function readCustomerMenuOnlineSettings(
  tx: Transaction,
  menuId: string,
): Promise<CustomerMenuOnlineSettings> {
  await assertMenuWritable(tx, menuId);
  await refuseSetMenu(tx, menuId);
  const [settings] = await tx.select(selection).from(menus).where(eq(menus.id, menuId));
  return settings!;
}

export async function saveCustomerMenuOnlineSettings(
  tx: Transaction,
  menuId: string,
  settings: CustomerMenuOnlineSettings,
): Promise<CustomerMenuOnlineSettings> {
  await assertMenuWritable(tx, menuId);
  await refuseSetMenu(tx, menuId);
  const { enabled, address, photos, styleId } = settings;
  if (address === null ? enabled : !isCustomerMenuAddress(address))
    throw new AppError("customer_menu.address_invalid", { field: "address" });
  if (enabled && !(await liveVersions(tx, [menuId], "format")).has(menuId))
    throw new AppError("customer_menu.not_published", { menuId });
  if (styleId !== null) await requireCustomerMenuStyle(tx, styleId);
  try {
    const [saved] = await tx
      .update(menus)
      .set({
        onlineEnabled: enabled,
        onlineAddress: address,
        onlinePhotos: photos,
        customerMenuStyleId: styleId,
      })
      .where(eq(menus.id, menuId))
      .returning(selection);
    return saved!;
  } catch (error) {
    if (refusalOn(error, UNIQUE_VIOLATION, { table: "menus", columns: ["online_address"] }))
      throw new AppError("customer_menu.address_taken", { field: "address" });
    throw error;
  }
}
