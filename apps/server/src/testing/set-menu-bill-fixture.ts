import { eq } from "drizzle-orm";
import {
  billSetMenuCopies,
  kitchenCourses,
  products,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import {
  addMember,
  addSetMenuDishes,
  createMenu,
  menuItems,
  readInvoiceLocales,
  requireMenuRoot,
} from "@waitron/menu";
import { publishWorkingMenu } from "./publish-menu.js";

export async function setMenuOnFullMenu(
  tx: Transaction,
  fullMenuId: string,
  productId: string,
  name = "Daily menu",
  price = "14.00",
) {
  const { id: menuId } = await createMenu(tx, {
    kind: "set_menu",
    name,
    setPrice: price,
    setVatClass: "reduced",
    setTakeawayVatClass: "general",
  });
  const [{ id: courseId }] = await tx
    .insert(kitchenCourses)
    .values({ name: `${name} course`, displayOrder: 4 })
    .returning({ id: kitchenCourses.id });
  await tx.update(products).set({ courseId }).where(eq(products.id, productId));
  await addSetMenuDishes(tx, menuId, [{ productId, excludedVariantIds: [] }]);
  await addMember(tx, await requireMenuRoot(tx, fullMenuId), { kind: "set_menu", menuId });
  const [{ id: menuItemId }] = await tx
    .select({ id: menuItems.id })
    .from(menuItems)
    .where(eq(menuItems.menuId, menuId));
  const versionId = await publishWorkingMenu(tx, fullMenuId);
  return { menuId, versionId, fullMenuId, menuItemId, courseId, productId, name };
}

export async function seedBillSetMenu(
  tx: Transaction,
  workingOrderId: string,
  copy: { menuId: string; versionId: string; name: string },
  lineNo: number,
  cents = 1400,
) {
  await tx
    .insert(billSetMenuCopies)
    .values({ workingOrderId, setMenuId: copy.menuId, menuVersionId: copy.versionId })
    .onConflictDoNothing({
      target: [billSetMenuCopies.workingOrderId, billSetMenuCopies.setMenuId],
    });
  const locales = await readInvoiceLocales(tx);
  const [{ id }] = await tx
    .insert(workingOrderLines)
    .values({
      workingOrderId,
      lineNo,
      name: copy.name,
      descriptions: Object.fromEntries(locales.map((locale) => [locale, copy.name])),
      quantity: 1000,
      unitPriceGross: cents,
      lineTotal: cents,
      vatClass: "reduced",
      takeawayVatClass: "general",
      sentAt: "2026-11-19T12:00:00.000Z",
      servedAt: "2026-11-19T12:00:00.000Z",
      servedQuantity: 1000,
      setMenuRole: "set_menu",
      setMenuId: copy.menuId,
      setMenuVersionId: copy.versionId,
    })
    .returning({ id: workingOrderLines.id });
  return id;
}
