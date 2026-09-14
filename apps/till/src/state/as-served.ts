// Deep-import the SHARED derivation leaf, exactly as `working-order.ts` deep-imports `priceBasket`
// from `@waitron/catalogue/src/pricing.js`: a barrel `import { … } from "@waitron/catalogue"` would
// pull the package's runtime dependencies (drizzle, the DB layer) into the browser bundle. This
// module is a runtime-dependency-free leaf, so the deep path keeps the bundle clean. Types come via
// `import type`, fully erased at build.
import { deriveAsServedAllergens } from "@waitron/catalogue/src/derivation.js";
import type {
  AsServedAllergens,
  OptionAllergenOverlay,
} from "@waitron/catalogue/src/derivation.js";
// The DIET twin of the allergen leaf (dietary-classification, Task 6). Deep-imported from the same
// runtime-dependency-free leaf module (`dietary.ts`, not the barrel) for the identical bundle reason.
import { deriveAsServedDiet } from "@waitron/catalogue/src/dietary.js";
import {
  applyDietaryEffects,
  expandDietaryDeclarations,
} from "@waitron/catalogue/src/dietary-declarations.js";
import type { DietaryLabel } from "@waitron/catalogue/src/dietary-declarations.js";
import type {
  DietaryOrigin,
  DietDerivation,
  DietOverride,
  DietProfile,
  OptionOriginOverlay,
} from "@waitron/catalogue/src/dietary.js";
import type { OrderLine } from "./working-order.js";

/** Both priced extras and nonprice choices contribute effects; saved selections retain their ids. */
function selectedItems(line: OrderLine) {
  const itemById = new Map(
    (line.product.modifiers === undefined
      ? (line.product.optionGroups ?? []).flatMap((group) => group.items)
      : line.product.modifiers.flatMap((modifier) =>
          modifier.type === "extras" || modifier.type === "options" ? modifier.choices : [],
        )
    ).map((item) => [item.id, item]),
  );
  const selectedIds = new Set((line.options ?? []).map((option) => option.optionGroupItemId));
  for (const selection of line.modifierSelections ?? line.modifierSnapshots ?? []) {
    if (selection.type === "options") selectedIds.add(selection.choiceId);
    if (selection.type === "extras") {
      for (const choice of selection.choices) {
        if (choice.quantity > 0) selectedIds.add(choice.choiceId);
      }
    }
  }
  return Array.from(selectedIds, (id) => itemById.get(id));
}

/** Fold selected effects over the reviewed allergen base; missing choices contribute no overlay. */
export function asServedAllergens(line: OrderLine): AsServedAllergens {
  const overlays: OptionAllergenOverlay[] = selectedItems(line).map((item) => ({
    add: item?.addAllergens ?? null,
    remove: item?.removeAllergens ?? null,
  }));
  return deriveAsServedAllergens(line.product.allergens ?? null, overlays);
}

/** Direct declarations take precedence; an omitted field retains the derived-profile fallback. */
export function asServedDiet(line: OrderLine): DietProfile {
  if (line.product.dietaryDeclarations !== undefined) {
    const declarations = asServedDietaryDeclarations(line);
    const result: DietProfile = {
      vegan: declarations.includes("vegan") ? "yes" : "unknown",
      vegetarian: declarations.includes("vegetarian") ? "yes" : "unknown",
      contains: [],
    };
    if (declarations.includes("halal")) result.halal = "yes";
    if (declarations.includes("kosher")) result.kosher = "yes";
    return result;
  }
  const overlays: OptionOriginOverlay[] = selectedItems(line).map((item) => ({
    add: (item?.addOrigins ?? null) as DietaryOrigin[] | null,
    remove: (item?.removeOrigins ?? null) as DietaryOrigin[] | null,
  }));
  const derivation: DietDerivation = line.product.dietDerivation ?? { origins: [], pending: true };
  const override: DietOverride | null = line.product.dietOverride ?? null;
  return deriveAsServedDiet(derivation, override, overlays);
}

/** Direct suitability declarations after every selected modifier's invalidation; a choice with no
 * dietary effect invalidates nothing and leaves the dish's claims intact. */
export function asServedDietaryDeclarations(line: OrderLine): DietaryLabel[] {
  const base = line.product.dietaryDeclarations as DietaryLabel[] | undefined;
  if (base === undefined) return [];
  const effects = selectedItems(line)
    .filter((item) => item !== undefined)
    .map((item) =>
      item!.dietaryEffect == null
        ? { invalidates: [] as DietaryLabel[] }
        : { invalidates: item!.dietaryEffect.invalidates as DietaryLabel[] },
    );
  return effects.length === 0
    ? expandDietaryDeclarations(base)
    : applyDietaryEffects(base, effects);
}
