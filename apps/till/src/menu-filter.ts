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
