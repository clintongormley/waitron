import type { TillProduct } from "./api/client.js";

/**
 * Only the grid is filtered: a screen keeps the full product set for name and allergen lookups,
 * because a tab may span several menus. With no menu selected (`""`) every product is returned.
 */
export function filterProductsByMenu(
  products: TillProduct[],
  selectedMenuId: string,
): TillProduct[] {
  if (selectedMenuId === "") return products;
  return products.filter((product) => product.catalogueId === selectedMenuId);
}

export type DietPredicate = "vegan" | "vegetarian" | "no-meat" | "no-fish";

/**
 * A product with no `diet` is dropped from every lens. `vegan`/`vegetarian` keep only an exact
 * `"yes"`, so `"unknown"` is excluded. `no-meat`/`no-fish` only hide dishes KNOWN to contain it, so an
 * unreviewed dish whose `contains` lacks the tag is kept.
 */
export function filterProductsByDiet(
  products: TillProduct[],
  predicate: DietPredicate,
): TillProduct[] {
  return products.filter((product) => {
    const diet = product.diet;
    if (!diet) return false;
    if (predicate === "vegan") return diet.vegan === "yes";
    if (predicate === "vegetarian") return diet.vegetarian === "yes";
    if (predicate === "no-meat") return !diet.contains.includes("meat");
    return !diet.contains.includes("fish");
  });
}

export function visibleProducts(
  products: TillProduct[],
  selectedMenuId: string,
  selectedDiet: DietPredicate | null,
): TillProduct[] {
  const byMenu = filterProductsByMenu(products, selectedMenuId);
  return selectedDiet ? filterProductsByDiet(byMenu, selectedDiet) : byMenu;
}

export function hasDietData(products: TillProduct[]): boolean {
  return products.some((product) => product.diet != null);
}

interface OrderableMenu {
  isDefault: boolean;
  orderable: boolean;
  audience: "customer" | "staff";
}

export function orderableMenus<M extends OrderableMenu>(menus: readonly M[]): M[] {
  return menus
    .filter((menu) => menu.orderable)
    .sort((a, b) => Number(a.audience === "staff") - Number(b.audience === "staff"));
}

export function defaultMenu<M extends OrderableMenu>(menus: readonly M[]): M | undefined {
  const running = orderableMenus(menus);
  return running.find((menu) => menu.isDefault) ?? running[0];
}

export function shownMenu<M extends OrderableMenu & { id: string }>(
  menus: readonly M[],
  selectedId: string,
): M | undefined {
  return menus.find((menu) => menu.id === selectedId && menu.orderable) ?? defaultMenu(menus);
}

/**
 * {@link visibleProducts}, answering the same array while it is asked with the same three inputs:
 * the menu browser re-indexes its menu whenever it is handed a new array.
 */
export function memoVisibleProducts(): typeof visibleProducts {
  let last: { args: Parameters<typeof visibleProducts>; result: TillProduct[] } | undefined;
  return (...args) => {
    if (last !== undefined && args.every((arg, index) => arg === last!.args[index]))
      return last.result;
    last = { args, result: visibleProducts(...args) };
    return last.result;
  };
}
