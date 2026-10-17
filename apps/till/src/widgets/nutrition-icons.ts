import { css, html, nothing } from "lit";
import { NUTRITION_ICONS, registerIcons } from "@waitron/ui";
import {
  expandDietaryDeclarations,
  type DietaryLabel,
} from "@waitron/catalogue/src/dietary-declarations.js";
import type { ProductAllergens } from "@waitron/catalogue/src/allergens.js";
import type { DietProfile } from "../api/client.js";
import { allergenLabel } from "../i18n/allergen-names.js";
import { currentLocale, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";

registerIcons(NUTRITION_ICONS);

const DIET_KEYS: Record<DietaryLabel, StringKey> = {
  vegan: "diet.vegan",
  vegetarian: "diet.vegetarian",
  halal: "diet.halal",
  kosher: "diet.kosher",
  no_meat: "diet.filter.no_meat",
  no_fish: "diet.filter.no_fish",
};

export function nutritionDietLabels(
  diet?: DietProfile | null,
  declarations?: readonly string[],
): DietaryLabel[] {
  if (declarations !== undefined) return expandDietaryDeclarations(declarations as DietaryLabel[]);
  return (["vegan", "vegetarian", "halal", "kosher"] as const).filter(
    (label) => diet?.[label] === "yes",
  );
}

export function dietLabel(label: DietaryLabel): string {
  return t(DIET_KEYS[label]);
}

export function nutritionIcons(
  allergens: ProductAllergens | null | undefined,
  labels: readonly DietaryLabel[],
) {
  if (allergens == null) return nothing;
  const codes = Object.keys(allergens).sort();
  if (codes.length === 0 && labels.length === 0) return nothing;
  return html`<span class="nutrition-icons">
    ${codes.map((code) => html`<wt-icon name=${`allergen-${code}`} label=${allergenLabel(code, allergens[code]!, currentLocale())}></wt-icon>`)}
    ${labels.map((label) => html`<wt-icon name=${`diet-${label}`} label=${dietLabel(label)}></wt-icon>`)}
  </span>`;
}

export const nutritionIconStyles = css`
  .nutrition-icons {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--wt-space-1);
    vertical-align: middle;
    margin-inline-start: var(--wt-space-2);
  }
  .nutrition-icons wt-icon {
    --wt-icon-size: var(--wt-font-size-md);
    color: var(--wt-color-text-muted);
  }
`;
