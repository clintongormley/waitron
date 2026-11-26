import { staffPresentationName } from "@waitron/shared";
import type { Product } from "../api/client.js";

export type ExtraProductChoice = Pick<Product, "id" | "name" | "unit" | "unitPrice" | "active"> & {
  familyName: string;
  hasActiveVariants: boolean;
};

export function extraProductChoices(products: readonly Product[]): Map<string, ExtraProductChoice> {
  const choices = new Map<string, ExtraProductChoice>();
  for (const { id, name, unit, unitPrice, active, variants } of products) {
    const activeVariants = variants.filter((variant) => variant.active);
    choices.set(id, {
      id,
      name,
      familyName: name,
      unit,
      unitPrice,
      active,
      hasActiveVariants: activeVariants.length > 0,
    });
    if (!active) continue;
    for (const variant of activeVariants) {
      choices.set(variant.id, {
        id: variant.id,
        name: staffPresentationName({ name, variantName: variant.name }),
        familyName: name,
        unit,
        unitPrice: variant.effective.unitPrice,
        active: true,
        hasActiveVariants: false,
      });
    }
  }
  return choices;
}
