import type { TillProduct } from "./api/client.js";

/**
 * The products the till's GRID shows for the selected menu: only those whose `catalogueId` matches
 * `selectedMenuId`. Filtering the grid (never the grid widget) keeps a menu switch to which tiles are
 * visible — the basket/round store is untouched, and the FULL product set stays available to a
 * screen's name-resolution and allergen lookup (a tab may span several menus).
 *
 * With no menu selected (`selectedMenuId === ""` — pre-login, or a location with no catalogue at all)
 * it returns EVERY product rather than nothing: there is no menu to narrow by. A real single-menu
 * location DOES select its one menu, and its products carry that `catalogueId`, so they match without
 * relying on this fallback.
 *
 * Pure — the counter screen and the table-order screen both call it so the filter lives in one place.
 */
export function filterProductsByMenu(
  products: TillProduct[],
  selectedMenuId: string,
): TillProduct[] {
  if (selectedMenuId === "") return products;
  return products.filter((product) => product.catalogueId === selectedMenuId);
}

/** The four dietary lenses the till's menu offers (dietary-classification, Task 6). `vegan`/
 * `vegetarian` keep only dishes whose PUBLISHED diet asserts that suitability; `no-meat`/`no-fish`
 * keep dishes that do NOT carry that contains-tag. */
export type DietPredicate = "vegan" | "vegetarian" | "no-meat" | "no-fish";

/**
 * Narrow the grid to the dishes that satisfy a dietary lens, reading each product's PUBLISHED `diet`
 * (catalogue's `products.diet`, folded from the recipe derivation + staff override).
 *
 * A `null`/absent `diet` (a product from a pre-diet fixture, or one the server never projected a diet
 * onto) is dropped from EVERY lens — there is nothing to assert about it. Beyond that:
 * - `vegan`/`vegetarian` are POSITIVE, cautious claims: they keep ONLY a label of exactly `"yes"`. An
 *   `"unknown"` (the derivation's pending default for an unreviewed recipe) is NOT vegan → excluded.
 * - `no-meat`/`no-fish` read the `contains` set, which the derivation asserts from KNOWN ingredient
 *   presence (spec §3.1): they keep a dish that does not carry that contains-tag. Per the design these
 *   are a "hide dishes known to contain X" preference filter, so an unreviewed dish whose `contains`
 *   has not (yet) recorded the tag IS kept — the cautious posture is confined to the vegan/vegetarian
 *   labels. (See the concern in the Task 6 report: whether these two should also gate on `pending`.)
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

/**
 * The tiles a till grid shows: the selected menu's products ({@link filterProductsByMenu}), then
 * narrowed to the active diet lens ({@link filterProductsByDiet}) when one is set. Pure — both the
 * counter screen and the table-order screen call it so the compose order lives in one place.
 */
export function visibleProducts(
  products: TillProduct[],
  selectedMenuId: string,
  selectedDiet: DietPredicate | null,
): TillProduct[] {
  const byMenu = filterProductsByMenu(products, selectedMenuId);
  return selectedDiet ? filterProductsByDiet(byMenu, selectedDiet) : byMenu;
}

/** Whether any product carries a published diet — the screens gate their diet-filter chrome on it so
 * a venue with no dietary data adds no filter above the grid. Pure. */
export function hasDietData(products: TillProduct[]): boolean {
  return products.some((product) => product.diet != null);
}
