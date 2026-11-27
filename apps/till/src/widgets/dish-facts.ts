import { type TemplateResult, html, nothing } from "lit";
import type { TillProduct } from "../api/menu-api.js";
import { nutritionDietLabels } from "../diet-labels.js";
import { allergenLabel } from "../i18n/allergen-names.js";
import { currentLocale, t } from "../i18n/t.js";
import { descriptionFor } from "./dish-format.js";
import { dietLabel } from "./nutrition-icons.js";

/** A dish's description, allergens and diet labels, as the information window and an opened row
 * both show them; the host styles `h3`, `ul` and `li`, and may style `.pending`. */
export function dishFacts(product: TillProduct): TemplateResult {
  const allergens = product.allergens;
  const description = descriptionFor(product.description ?? {}, "").trim();
  const labels = nutritionDietLabels(product.diet, product.dietaryDeclarations);
  return html`${description ? html`<p data-description>${description}</p>` : nothing}
    <h3>${t("allergens.contains")}</h3>
    ${
      allergens === null
        ? html`<p class="pending">${t("product_info.not_reviewed")}</p>`
        : Object.keys(allergens).length === 0
          ? html`<p>${t("allergens.as_served_none")}</p>`
          : html`<ul data-allergens>
              ${Object.keys(allergens)
                .sort()
                .map(
                  (code) =>
                    html`<li>
                      <wt-icon name=${`allergen-${code}`}></wt-icon
                      >${allergenLabel(code, allergens[code]!, currentLocale())}
                    </li>`,
                )}
            </ul>`
    }
    ${
      labels.length === 0
        ? nothing
        : html`<h3>${t("product_info.dietary")}</h3>
            <ul data-diet>
              ${labels.map((label) => html`<li><wt-icon name=${`diet-${label}`}></wt-icon>${dietLabel(label)}</li>`)}
            </ul>`
    }`;
}
