import { css, html, nothing } from "lit";
import { NUTRITION_ICONS, registerIcons, type WtIconSize } from "@waitron/ui";
import type { DietaryLabel, ProductAllergens } from "@waitron/shared";
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

export function dietLabel(label: DietaryLabel): string {
  return t(DIET_KEYS[label]);
}

// wt-icon reads no label; role and aria-label give it its name.
function namedIcon(name: string, label: string, size: WtIconSize) {
  return html`<wt-icon name=${name} size=${size} role="img" aria-label=${label}></wt-icon>`;
}

export function nutritionIcons(
  allergens: ProductAllergens | null | undefined,
  labels: readonly DietaryLabel[],
  { size = "md" }: { size?: WtIconSize } = {},
) {
  if (allergens == null) return nothing;
  const codes = Object.keys(allergens).sort();
  if (codes.length === 0 && labels.length === 0) return nothing;
  const locale = currentLocale();
  return html`<span class="nutrition-icons">
    ${codes.map((code) => namedIcon(`allergen-${code}`, allergenLabel(code, allergens[code]!, locale), size))}
    ${labels.map((label) => namedIcon(`diet-${label}`, dietLabel(label), size))}
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
    color: var(--wt-color-text-muted);
  }
`;
