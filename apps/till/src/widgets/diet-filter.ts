import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
import { segmentedOptionStyles } from "./segmented-control-styles.js";
import type { DietPredicate } from "../menu-filter.js";

/** `vegan`/`vegetarian` reuse the badge labels (the CAUTIOUS positive claims); `no-meat`/`no-fish`
 *  carry their own PREFERENCE labels (they keep unreviewed dishes). */
const OPTIONS: {
  predicate: DietPredicate;
  key: "diet.vegan" | "diet.vegetarian" | "diet.filter.no_meat" | "diet.filter.no_fish";
}[] = [
  { predicate: "vegan", key: "diet.vegan" },
  { predicate: "vegetarian", key: "diet.vegetarian" },
  { predicate: "no-meat", key: "diet.filter.no_meat" },
  { predicate: "no-fish", key: "diet.filter.no_fish" },
];

/**
 * SINGLE-select, because `filterProductsByDiet` takes one predicate: tapping the ACTIVE lens clears it.
 * Native `<button>` options with `aria-pressed`, for the reason `till-menu-switcher` gives.
 */
@customElement("till-diet-filter")
export class TillDietFilter extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .filter {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        margin-bottom: var(--wt-space-3);
      }
    `,
    segmentedOptionStyles,
  ];

  @property() selected: DietPredicate | null = null;

  #pick(predicate: DietPredicate): void {
    const next = this.selected === predicate ? null : predicate;
    this.dispatchEvent(
      new CustomEvent<{ predicate: DietPredicate | null }>("diet-filter-selected", {
        detail: { predicate: next },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    return html`
      <div class="filter" role="group" aria-label=${t("diet.filter.label")}>
        ${OPTIONS.map(
          (opt) =>
            html`<button
              type="button"
              class="option"
              data-test=${`diet-filter-${opt.predicate}`}
              aria-pressed=${opt.predicate === this.selected}
              @click=${() => this.#pick(opt.predicate)}
            >
              ${t(opt.key)}
            </button>`,
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-diet-filter": TillDietFilter;
  }
}
