import { type TemplateResult, css, html, nothing } from "lit";
import { t } from "../i18n/t.js";
import type { DietProfile } from "../api/client.js";

/**
 * The shared DIET & CONTAINS badge row (dietary-classification, Task 7) — rendered beside the
 * as-served allergen chips on the basket line, the KDS station display and the expo/pass board, so all
 * three read a plate's diet identically. Kept in one place (unlike the per-screen allergen `#allergens`
 * helpers, which predate this) precisely so the CAUTIOUS rule below cannot drift between surfaces.
 *
 * What it renders, from a {@link DietProfile} (the client-side `asServedDiet(line)` for a basket line,
 * or the server-projected `asServedDiet` on a station/expo item):
 *  - a POSITIVE label badge for each claim the profile actually ASSERTS — `vegan`/`vegetarian` only
 *    when exactly `"yes"`, `halal`/`kosher` only when `"yes"`. A `"no"` or `"unknown"` renders NO
 *    badge: the absence of a badge is not a claim, so an unreviewed or non-vegan dish never shows one.
 *  - a "contains meat"/"contains fish" chip for each entry in `contains`, which the derivation asserts
 *    from KNOWN ingredient presence (spec §3.1) — shown regardless of the pending state.
 *  - a NEUTRAL "not reviewed" note whenever the derivation is pending (`vegan === "unknown"`, the
 *    cautious default for a dish whose recipe was never reviewed). This is the ONLY thing a pending
 *    profile says about vegan/vegetarian — never a positive claim (§2, the food-safety invariant).
 *
 * Returns `nothing` when there is nothing to say — no positive claim, no contains-tag, not pending — so
 * a plain reviewed-but-unremarkable dish (e.g. contains dairy, not vegan, nothing tagged) renders no
 * row at all rather than an empty one.
 *
 * `dataTest` is echoed as the row's `data-test` so a caller can target a specific line/item. `locale`
 * (optional) forces the copy language — the allergen screen's Print path passes the INVOICE locale so
 * the printed sheet's badges follow the customer's language, exactly as its allergen names do; on-screen
 * callers omit it and get `currentLocale()`. The badges carry text labels, so the text IS the accessible
 * name (no `aria-label` needed) — the same approach the allergen chips take.
 */
export function dietBadges(
  diet: DietProfile | null | undefined,
  dataTest: string,
  locale?: string,
): TemplateResult | typeof nothing {
  if (!diet) return nothing;
  const tr = (key: Parameters<typeof t>[0]): string => t(key, locale);
  const pending = diet.vegan === "unknown";
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
    ${positives.map(
      (p) => html`<span class="diet-badge diet-${p.key}" data-diet=${p.key}>${p.label}</span>`,
    )}
    ${contains.map(
      (tag) =>
        html`<span class="diet-contains" data-diet-contains=${tag}
          >${tr(`diet.contains.${tag}` as "diet.contains.meat" | "diet.contains.fish")}</span
        >`,
    )}
    ${pending ? html`<span class="diet-pending" data-diet-pending>${tr("diet.not_reviewed")}</span>` : nothing}
  </span>`;
}

/**
 * The badge-row styles, shared into each host's `static styles` array (a Lit template function cannot
 * carry styles across shadow boundaries). A POSITIVE claim reads as a success-toned pill and a CONTAINS
 * chip as a plain outlined pill — but colour is NEVER the only signal (house a11y rule): each carries
 * its own text label, so the meaning survives a monochrome display and the contrast sweep. The pending
 * note earns weight, like the allergen-pending note beside it.
 */
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
