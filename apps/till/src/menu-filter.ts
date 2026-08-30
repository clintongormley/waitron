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
