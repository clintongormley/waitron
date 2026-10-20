import { html, nothing } from "lit";
import type { LineNutrition } from "../api/client.js";
import { allergenLabel } from "../i18n/allergen-names.js";
import { currentLocale, t } from "../i18n/t.js";
import { dietLabel, nutritionDietLabels } from "./nutrition-icons.js";

export function lineNutrition(nutrition: LineNutrition | null | undefined) {
  if (nutrition == null) return nothing;
  const labels = nutritionDietLabels(undefined, nutrition.dietaryDeclarations);
  return html`<section data-line-nutrition>
    <h3>${t("allergens.contains")}</h3>
    ${
      nutrition.allergens === null
        ? html`<p>${t("product_info.not_reviewed")}</p>`
        : Object.keys(nutrition.allergens).length === 0
          ? html`<p>${t("allergens.as_served_none")}</p>`
          : html`<ul>
              ${Object.entries(nutrition.allergens).map(([code, value]) => html`<li>${allergenLabel(code, value, currentLocale())}</li>`)}
            </ul>`
    }
    ${
      labels.length === 0
        ? nothing
        : html`<h3>${t("product_info.dietary")}</h3>
            <ul>
              ${labels.map((label) => html`<li>${dietLabel(label)}</li>`)}
            </ul>`
    }
  </section>`;
}
