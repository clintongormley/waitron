import { css, html, nothing, type TemplateResult } from "lit";
import type { KitchenAllergyBlock } from "@waitron/module";
import { currentLocale, t } from "../i18n/t.js";

export const kitchenAllergyStyles = css`
  .kitchen-allergy {
    display: block;
    flex-basis: 100%;
    min-width: 0;
    color: var(--wt-color-danger);
    font-weight: var(--wt-font-weight-bold);
    overflow-wrap: anywhere;
    white-space: normal;
  }
  .kitchen-allergy-note,
  .kitchen-allergy-clash {
    display: block;
  }
  .kitchen-allergy-marker {
    color: var(--wt-color-danger);
    font-weight: var(--wt-font-weight-bold);
  }
`;

export function kitchenAllergyMarker(visible: boolean): TemplateResult | typeof nothing {
  return visible
    ? html`<span
        class="kitchen-allergy-marker"
        data-allergy-marker
        role="img"
        aria-label=${t("kitchen_allergy.marker", currentLocale().split("-")[0] === "es" ? "es" : "en")}
        >!</span
      >`
    : nothing;
}

export function kitchenAllergyBlock(
  block: KitchenAllergyBlock | null,
): TemplateResult | typeof nothing {
  if (block === null) return nothing;
  const language = currentLocale().split("-")[0] === "es" ? "es" : "en";
  const labels = block.labels[language];
  const values = { who: block.who, allergens: labels.avoids.join(", ") };
  const heading = t("kitchen_allergy.line", language).replace(
    /\{(who|allergens)\}/g,
    (_whole, key: keyof typeof values) => values[key],
  );
  return html`<span class="kitchen-allergy" data-kitchen-allergy>
    <span>${heading}</span>
    ${block.note ? html`<span class="kitchen-allergy-note">${block.note}</span>` : nothing}
    ${labels.clashes.length === 0 ? nothing : html`<span class="kitchen-allergy-clash">${t("kitchen_allergy.clash", language).replace("{allergens}", () => labels.clashes.join(", "))}</span>`}
  </span>`;
}
