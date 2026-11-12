import type { AllergenCode, Kind, ProductAllergens } from "@waitron/shared";
import type { TillProduct } from "./api/client.js";
import { offeredListsOf, productAsVariant } from "./state/order-line.js";

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

type Exclusion = "all" | readonly Kind[];

export interface MenuFilters {
  readonly diets: readonly DietPredicate[];
  readonly exclude: Readonly<Partial<Record<AllergenCode, Exclusion>>>;
}

export const EMPTY_MENU_FILTERS: MenuFilters = Object.freeze({
  diets: Object.freeze([]),
  exclude: Object.freeze({}),
});

function isActiveExclusion(selected: Exclusion): boolean {
  return selected === "all" || selected.length > 0;
}

export function activeFilterCount(filters: MenuFilters): number {
  return filters.diets.length + Object.values(filters.exclude).filter(isActiveExclusion).length;
}

function passesExclusions(
  allergens: ProductAllergens,
  exclusions: readonly [string, Exclusion][],
): boolean {
  return exclusions.every(([code, selected]) => {
    const declaration = allergens[code];
    if (declaration === undefined) return true;
    if (selected === "all") return false;
    if (selected.length === 0) return true;
    // A declared cereal or nut without kinds can match any selected kind.
    return (
      declaration.kinds !== undefined &&
      declaration.kinds.length > 0 &&
      !selected.some((kind) => declaration.kinds!.includes(kind))
    );
  });
}

export function allowsAllergenChoice(
  allergens: ProductAllergens | null,
  filters: MenuFilters,
): boolean {
  const exclusions = Object.entries(filters.exclude);
  return (
    !exclusions.some(([, selected]) => isActiveExclusion(selected)) ||
    (allergens !== null && passesExclusions(allergens, exclusions))
  );
}

function hasCompatibleExtras(product: TillProduct, filters: MenuFilters): boolean {
  return offeredListsOf(product).every(
    (entry) =>
      entry.kind !== "extras" ||
      entry.items.reduce(
        (capacity, item) =>
          capacity +
          (allowsAllergenChoice(item.addAllergens, filters) ? (item.maxQuantity ?? Infinity) : 0),
        0,
      ) >= entry.minPicks,
  );
}

export function visibleProducts(
  products: TillProduct[],
  selectedMenuId: string,
  filters: MenuFilters,
): TillProduct[] {
  const byMenu = filterProductsByMenu(products, selectedMenuId);
  const byDiet = filters.diets.reduce(filterProductsByDiet, byMenu);
  const exclusions = Object.entries(filters.exclude);
  if (!exclusions.some(([, selected]) => isActiveExclusion(selected))) return byDiet;
  return byDiet.flatMap((product) => {
    if ((product.variants?.length ?? 0) > 0) {
      const variants = product.variants!.filter(
        (variant) =>
          allowsAllergenChoice(variant.allergens, filters) &&
          hasCompatibleExtras(productAsVariant(product, variant), filters),
      );
      return variants.length > 0 ? [{ ...product, variants }] : [];
    }
    return allowsAllergenChoice(product.allergens, filters) && hasCompatibleExtras(product, filters)
      ? [product]
      : [];
  });
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
