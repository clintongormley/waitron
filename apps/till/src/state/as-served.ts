// Deep imports, not the barrel, which would pull the DB layer into the browser bundle.
import { deriveDietProfile, overlayDietProfile } from "@waitron/catalogue/src/dietary.js";
import { expandDietaryDeclarations } from "@waitron/catalogue/src/dietary-declarations.js";
import type { DietaryLabel } from "@waitron/catalogue/src/dietary-declarations.js";
import type { DietDerivation, DietOverride, DietProfile } from "@waitron/catalogue/src/dietary.js";
import type { OrderLine } from "./working-order.js";

/** `pending` when the dish's own allergens are unreviewed (a null base). */
interface AsServedAllergens {
  allergens: NonNullable<OrderLine["product"]["allergens"]>;
  pending: boolean;
}

/** The dish's OWN allergens, with no modifier contribution: each extra's list is shown separately. */
export function asServedAllergens(line: OrderLine): AsServedAllergens {
  return {
    allergens: line.product.allergens ?? {},
    pending: line.product.allergens == null,
  };
}

/** The dish's OWN diet profile, with no modifier overlay. Direct declarations take precedence. */
export function asServedDiet(line: OrderLine): DietProfile {
  if (line.product.dietaryDeclarations !== undefined) {
    const declarations = expandDietaryDeclarations(
      line.product.dietaryDeclarations as DietaryLabel[],
    );
    const result: DietProfile = {
      vegan: declarations.includes("vegan") ? "yes" : "unknown",
      vegetarian: declarations.includes("vegetarian") ? "yes" : "unknown",
      contains: [],
    };
    if (declarations.includes("halal")) result.halal = "yes";
    if (declarations.includes("kosher")) result.kosher = "yes";
    return result;
  }
  const derivation: DietDerivation = line.product.dietDerivation ?? { origins: [], pending: true };
  const override: DietOverride | null = line.product.dietOverride ?? null;
  return overlayDietProfile(deriveDietProfile(derivation), override);
}
