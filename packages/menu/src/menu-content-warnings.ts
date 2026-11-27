import type { MenuDocument, MenuPreview } from "@waitron/shared";
import { documentSetMenuOffers } from "./menu-document.js";

type MenuWarning = MenuPreview["warnings"][number];
type UnreviewedProduct = Extract<MenuWarning, { kind: "allergens_unreviewed" }>["products"][number];

export function menuContentWarnings(
  document: MenuDocument,
  unreviewedProducts: readonly UnreviewedProduct[],
): MenuWarning[] {
  const unreviewed = new Map<string, UnreviewedProduct>(
    unreviewedProducts.map((product) => [product.id, product]),
  );
  const precisionWarnings: MenuWarning[] = [];
  const warned = new Set<string>();
  for (const offer of [...Object.values(document.offers), ...documentSetMenuOffers(document)])
    for (const list of offer.offeredModifiers) {
      if (list.kind !== "extras") continue;
      for (const item of list.items) {
        if (item.addAllergens === null) {
          const { name, variantName } = item.presentation;
          const product = unreviewed.get(item.productId) ?? {
            id: item.productId,
            name: variantName ?? name,
            parentName: variantName === null ? null : name,
          };
          const dishes = (product.extraOn ??= []);
          if (!dishes.includes(offer.name)) dishes.push(offer.name);
          unreviewed.set(item.productId, product);
        }
        const key = `${list.id}:${item.productId}`;
        if (warned.has(key)) continue;
        warned.add(key);
        const portion = item.portion ?? "1.000";
        const significantPlaces = (portion.split(".")[1] ?? "").replace(/0+$/, "").length;
        if (significantPlaces <= (item.unit?.precision ?? 0)) continue;
        precisionWarnings.push({
          kind: "extra_portion_precision",
          listName: list.name,
          name: item.name,
          portion,
          abbreviation: item.unit?.abbreviation ?? {},
          precision: item.unit?.precision ?? 0,
        });
      }
    }
  return [
    ...precisionWarnings,
    ...(unreviewed.size === 0
      ? []
      : [{ kind: "allergens_unreviewed" as const, products: [...unreviewed.values()] }]),
  ];
}
