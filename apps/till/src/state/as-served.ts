// Deep-import the SHARED derivation leaves, exactly as `working-order.ts` deep-imports `priceBasket`
// from `@waitron/catalogue/src/pricing.js`: a barrel `import { … } from "@waitron/catalogue"` would
// pull the package's runtime dependencies (drizzle, the DB layer) into the browser bundle. These are
// runtime-dependency-free leaf modules, so the deep paths keep the bundle clean. Types come via
// `import type`, fully erased at build.
import { deriveDietProfile, overlayDietProfile } from "@waitron/catalogue/src/dietary.js";
import { expandDietaryDeclarations } from "@waitron/catalogue/src/dietary-declarations.js";
import type { DietaryLabel } from "@waitron/catalogue/src/dietary-declarations.js";
import type { DietDerivation, DietOverride, DietProfile } from "@waitron/catalogue/src/dietary.js";
import type { OrderLine } from "./working-order.js";

/** The dish's own allergen profile: its declared set, and `pending` when the dish's own allergens are
 *  unreviewed (a null base). A local shape — catalogue's `AsServedAllergens` and the modifier fold it
 *  served are removed. `removed` is always empty now (nothing subtracts from the dish) and kept only so
 *  the basket's shared render reads one field. Each extra's own list is shown separately (Task 4). */
interface AsServedAllergens {
  allergens: NonNullable<OrderLine["product"]["allergens"]>;
  pending: boolean;
  removed: string[];
}

/** The dish's OWN published allergens — no modifier contribution (removed in the nutrition redesign). */
export function asServedAllergens(line: OrderLine): AsServedAllergens {
  return {
    allergens: line.product.allergens ?? {},
    pending: line.product.allergens == null,
    removed: [],
  };
}

/** The dish's OWN diet profile — recipe-derived, with no modifier overlay. Direct declarations take
 *  precedence; otherwise the product-level derivation (no overlays) plus any staff override. */
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
