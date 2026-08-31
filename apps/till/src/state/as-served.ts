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
  const overlays: OptionAllergenOverlay[] = (line.options ?? []).map((sel) => {
    const item = (line.product.optionGroups ?? [])
      .flatMap((group) => group.items)
      .find((candidate) => candidate.id === sel.optionGroupItemId);
    return { add: item?.addAllergens ?? null, remove: item?.removeAllergens ?? null };
  });
  return deriveAsServedAllergens(line.product.allergens ?? null, overlays);
}
