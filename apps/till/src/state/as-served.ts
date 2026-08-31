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
import type {
  DietaryOrigin,
  DietDerivation,
  DietOverride,
  DietProfile,
  OptionOriginOverlay,
} from "@waitron/catalogue/src/dietary.js";
import type { OrderLine } from "./working-order.js";

/**
 * The AS-SERVED allergen profile of one basket line, computed CLIENT-side — the dish's declared
 * allergens (`line.product.allergens`) folded with its selected modifiers' overlays — the same way
 * the basket prices lines client-side, with no server round trip. Each selected option is matched by
 * its `optionGroupItemId` against the product's `optionGroups` to recover its `addAllergens`/
 * `removeAllergens` overlay; an option whose item can't be found (a stale selection) contributes an
 * empty overlay rather than throwing. The fold itself — Cautious policy, adds always applied, removes
 * only against a REVIEWED base, `pending` when the base is unreviewed — lives in the shared
 * `deriveAsServedAllergens`, so the till, the KDS and the ticket all derive it identically.
 */
export function asServedAllergens(line: OrderLine): AsServedAllergens {
  // Flatten the product's option items into a by-id lookup ONCE, not per selected option — otherwise a
  // line with S options over G groups of I items rebuilt the flattened array S times (O(S·G·I)).
  const itemById = new Map(
    (line.product.optionGroups ?? [])
      .flatMap((group) => group.items)
      .map((item) => [item.id, item]),
  );
  const overlays: OptionAllergenOverlay[] = (line.options ?? []).map((sel) => {
    const item = itemById.get(sel.optionGroupItemId);
    return { add: item?.addAllergens ?? null, remove: item?.removeAllergens ?? null };
  });
  return deriveAsServedAllergens(line.product.allergens ?? null, overlays);
}

/**
 * The AS-SERVED diet profile of one basket line, computed CLIENT-side — EXACTLY mirrors
 * {@link asServedAllergens}. The product's recipe-derived diet basis (`line.product.dietDerivation`)
 * is folded with its selected options' ORIGIN overlays (`addOrigins`/`removeOrigins`), then the staff
 * override (`line.product.dietOverride`) is re-applied — all inside the shared, drizzle-free
 * `deriveAsServedDiet`, so the till, the KDS and the expo screen derive it identically.
 *
 * Same by-id lookup and stale-selection handling as the allergen twin: each selected option is matched
 * by its `optionGroupItemId` against the product's `optionGroups`; an option whose item can't be found
 * contributes an empty overlay rather than throwing. A null/absent derivation folds as `pending`
 * (`{ origins: [], pending: true }`) — the CAUTIOUS default the server publishes for an unreviewed
 * dish, so vegan/vegetarian read "unknown" rather than a false positive. The wire carries the origin
 * overlays as `string[]`; they are narrowed to the origin union at this fold boundary, the same cast
 * the server's `deriveAsServedDiet` call makes.
 */
export function asServedDiet(line: OrderLine): DietProfile {
  const itemById = new Map(
    (line.product.optionGroups ?? [])
      .flatMap((group) => group.items)
      .map((item) => [item.id, item]),
  );
  const overlays: OptionOriginOverlay[] = (line.options ?? []).map((sel) => {
    const item = itemById.get(sel.optionGroupItemId);
    return {
      add: (item?.addOrigins ?? null) as DietaryOrigin[] | null,
      remove: (item?.removeOrigins ?? null) as DietaryOrigin[] | null,
    };
  });
  const derivation: DietDerivation = line.product.dietDerivation ?? { origins: [], pending: true };
  const override: DietOverride | null = line.product.dietOverride ?? null;
  return deriveAsServedDiet(derivation, override, overlays);
}
