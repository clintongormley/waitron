import { type TemplateResult, css, html, nothing } from "lit";
import { currentLocale, t } from "../i18n/t.js";
import { allergenName } from "../i18n/allergen-names.js";
import type { DietProfile } from "../api/client.js";

const SUITABILITY_KEYS = {
  vegan: "diet.vegan",
  vegetarian: "diet.vegetarian",
  halal: "diet.halal",
  kosher: "diet.kosher",
} as const;

function dietBadge(key: string, label: string): TemplateResult {
  return html`<span class="diet-badge diet-${key}" data-diet=${key}>${label}</span>`;
}

/**
 * A SELECTED EXTRA's OWN nutrition. This is NOT a fold: the dish shows its figures and each extra shows
 * its own. Unlike {@link dietBadges}, an extra's suitability is a DIRECT positive claim, so there is no
 * pending/"not reviewed" state.
 */
export function extraNutrition(
  extra: {
    addAllergens?: Record<string, { presence: "contains" | "may_contain"; source?: string }> | null;
    suitableFor?: readonly string[] | null;
  },
  allergensTest: string,
  dietTest: string,
  locale?: string,
): TemplateResult | typeof nothing {
  const codes = Object.keys(extra.addAllergens ?? {}).sort();
  const diets = (extra.suitableFor ?? []).filter(
    (label): label is keyof typeof SUITABILITY_KEYS => label in SUITABILITY_KEYS,
  );
  if (codes.length === 0 && diets.length === 0) return nothing;
  const loc = locale ?? currentLocale();
  const tr = (key: Parameters<typeof t>[0]): string => t(key, loc);
  return html`<span class="extra-nutrition">
    ${
      codes.length > 0
        ? html`<span class="extra-allergens" data-test=${allergensTest}
            >${codes.map(
              (code) => html`<span class="allergen-chip">${allergenName(code, loc)}</span>`,
            )}</span
          >`
        : nothing
    }
    ${
      diets.length > 0
        ? html`<span class="extra-diet" data-test=${dietTest}
            >${diets.map((label) => dietBadge(label, tr(SUITABILITY_KEYS[label])))}</span
          >`
        : nothing
    }
  </span>`;
}

/**
 * Kept in one place so the CAUTIOUS rule cannot drift between surfaces: a badge only for `"yes"` (the
 * absence of a badge is not a claim), and "not reviewed" when EITHER derived label is `"unknown"` — a
 * staff override can resolve `vegan` while leaving `vegetarian` unreviewed. halal/kosher are never
 * derived, so they never make a profile pending.
 */
export function dietBadges(
  diet: DietProfile | null | undefined,
  dataTest: string,
  locale?: string,
): TemplateResult | typeof nothing {
  if (!diet) return nothing;
  const tr = (key: Parameters<typeof t>[0]): string => t(key, locale);
  const pending = diet.vegan === "unknown" || diet.vegetarian === "unknown";
  const positives: { key: string; label: string }[] = [];
  if (diet.vegan === "yes") positives.push({ key: "vegan", label: tr("diet.vegan") });
  if (diet.vegetarian === "yes")
    positives.push({ key: "vegetarian", label: tr("diet.vegetarian") });
  if (diet.halal === "yes") positives.push({ key: "halal", label: tr("diet.halal") });
  if (diet.kosher === "yes") positives.push({ key: "kosher", label: tr("diet.kosher") });
  const contains = [...diet.contains].sort();

  if (positives.length === 0 && contains.length === 0 && !pending) return nothing;

  return html`<span class="line-diet" data-test=${dataTest}>
    <span class="diet-label">${tr("diet.label")}</span>
    ${positives.map((p) => dietBadge(p.key, p.label))}
    ${contains.map(
      (tag) =>
        html`<span class="diet-contains" data-diet-contains=${tag}
          >${tr(`diet.contains.${tag}` as "diet.contains.meat" | "diet.contains.fish")}</span
        >`,
    )}
    ${pending ? html`<span class="diet-pending" data-diet-pending>${tr("diet.not_reviewed")}</span>` : nothing}
  </span>`;
}

/** Shared into each host's `static styles`: a Lit template function cannot carry styles across shadow
 * boundaries. */
export const dietBadgeStyles = css`
  .line-diet {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--wt-space-1) var(--wt-space-2);
    font-size: var(--wt-font-size-sm, 0.85em);
    color: var(--wt-color-text-muted);
  }

  .diet-label {
    font-weight: var(--wt-font-weight-bold, 600);
  }

  .diet-badge {
    display: inline-block;
    padding: 0 var(--wt-space-2);
    border: 1px solid var(--wt-color-success, var(--wt-color-border));
    border-radius: var(--wt-radius-full, 999px);
    color: var(--wt-color-success-text, var(--wt-color-text));
    font-weight: var(--wt-font-weight-bold, 600);
  }

  .diet-contains {
    display: inline-block;
    padding: 0 var(--wt-space-2);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-full, 999px);
  }

  /* The pending note — the neutral "not reviewed" state. Weight is the non-colour tell; it must NOT
     read as a positive claim, so it is deliberately plain text, never a badge. */
  .diet-pending {
    color: var(--wt-color-warning-text, var(--wt-color-text));
    font-weight: var(--wt-font-weight-bold, 600);
  }
`;
