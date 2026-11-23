import type { DemoCourseKey } from "@waitron/country";
import type { Transaction } from "@waitron/db";
import {
  addMember,
  addSetMenuDishes,
  createMenu,
  listProductVariants,
  menuItems,
  readSetMenu,
  requireMenuRoot,
  saveSetMenuDishCourse,
  saveSetMenuLines,
  updateMenuItem,
} from "@waitron/menu";
import { eq } from "drizzle-orm";
import { demoPlainText, inLanguages, type DemoDataSet } from "./data-set.js";
import type { SeedLocale } from "./locale.js";

export async function seedSetMenus(
  tx: Transaction,
  input: {
    dataSet: DemoDataSet;
    locale: SeedLocale;
    languages: readonly string[];
    holderId: string;
    productsByImage: ReadonlyMap<string, string>;
    courseIds: ReadonlyMap<DemoCourseKey, string>;
  },
): Promise<void> {
  const { dataSet, locale, languages, holderId, productsByImage, courseIds } = input;
  const holderRoot = await requireMenuRoot(tx, holderId);
  const products = [dataSet.menus.restaurant, dataSet.menus.lunch].flatMap(({ categories }) =>
    categories.flatMap((category) => category.products),
  );
  const courseIdFor = (course: DemoCourseKey) => {
    const id = courseIds.get(course);
    if (id === undefined) throw new Error(`seedSetMenus: missing course "${course}"`);
    return id;
  };

  for (const setMenu of dataSet.menus.setMenus) {
    const name = demoPlainText(setMenu.name, dataSet, locale);
    const { id } = await createMenu(tx, {
      name,
      names: inLanguages(setMenu.customerName, languages),
      kind: "set_menu",
      setPrice: setMenu.price,
      setVatClass: setMenu.vatClass,
    });
    const dishes = [];
    for (const dish of setMenu.dishes) {
      const productId = productsByImage.get(dish.productImage);
      if (productId === undefined)
        throw new Error(`seedSetMenus: no product for "${dish.productImage}"`);
      const excludedVariantIds: string[] = [];
      if (dish.excludedVariants?.length) {
        const authored = products.find((product) => product.image === dish.productImage)?.variants;
        const variants = await listProductVariants(tx, productId);
        for (const excluded of dish.excludedVariants) {
          const definition = authored?.find(
            (variant) => (variant.staffName ?? variant.customerName).en === excluded,
          );
          const seededName = (definition?.staffName ?? definition?.customerName)?.[locale];
          const variant = variants.find(({ name }) => name === seededName);
          if (variant === undefined)
            throw new Error(`seedSetMenus: "${dish.productImage}" has no variant "${excluded}"`);
          excludedVariantIds.push(variant.id);
        }
      }
      dishes.push({ dish, productId, excludedVariantIds });
    }

    await addSetMenuDishes(tx, id, dishes);
    const items = await tx
      .select({ id: menuItems.id, productId: menuItems.productId })
      .from(menuItems)
      .where(eq(menuItems.menuId, id));
    const itemIds = new Map(items.map(({ id, productId }) => [productId, id]));
    for (const { dish, productId } of dishes) {
      const itemId = itemIds.get(productId);
      if (itemId === undefined)
        throw new Error(`seedSetMenus: "${name}" has no menu item for "${dish.productImage}"`);
      if (dish.course !== undefined)
        await saveSetMenuDishCourse(tx, id, itemId, courseIdFor(dish.course));
      if (dish.surcharge !== null)
        await updateMenuItem(tx, id, itemId, { grossPrice: dish.surcharge });
    }
    await saveSetMenuLines(
      tx,
      id,
      setMenu.lines.map(({ count, courses }) => ({
        count,
        courseIds: courses.map(courseIdFor),
      })),
    );
    const { problems } = await readSetMenu(tx, id);
    if (problems.length > 0)
      throw new Error(
        `seedSetMenus: "${name}" is incomplete: ${problems.map(({ kind }) => kind).join(", ")}`,
      );
    await addMember(tx, holderRoot, { kind: "set_menu", menuId: id });
  }
}
