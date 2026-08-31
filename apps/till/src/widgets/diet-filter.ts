import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
import { segmentedOptionStyles } from "./segmented-control-styles.js";
import type { DietPredicate } from "../menu-filter.js";

/** The four dietary lenses the filter offers, in display order, each with its i18n label key. `vegan`/
 *  `vegetarian` reuse the badge labels (the CAUTIOUS positive claims); `no-meat`/`no-fish` carry their
 *  own PREFERENCE labels (they keep unreviewed dishes). */
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
 * The till's MENU DIET FILTER (dietary-classification, Task 7): a segmented control above the product
 * grid that narrows the tiles to a dietary lens (vegan / vegetarian / no-meat / no-fish), calling
 * Task 6's `filterProductsByDiet`. It holds NO state — the parent screen owns the `selected` predicate,
 * re-filters the grid, and feeds the new `selected` back down. Props in, event out, exactly like
 * `till-menu-switcher`.
 *
 * SINGLE-select toggle: tapping the ACTIVE lens clears it (`detail.predicate = null`) — "show all"
 * again — because `filterProductsByDiet` takes one predicate. (Combining lenses — vegan AND no-fish —
 * is a deliberate non-goal here; the design note flags it as a possible follow-up.)
 *
 * Accessibility mirrors `till-menu-switcher`: NATIVE `<button>` options inside a `role="group"` labelled
 * by the `diet.filter.label` string, each carrying `aria-pressed` for its selected state — keeping the
 * state on the element the AT reaches (a `wt-button` would land it on the non-interactive host). The
 * `min-height: var(--wt-tap-min)` preserves the POS tap target. Themed with HA-style tokens only.
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

  /** The active dietary lens, owned by the parent — echoed here to mark the pressed option. `null`/
   *  absent means no filter (all dishes shown). */
  @property() selected: DietPredicate | null = null;

  /** Ask the parent to switch to `predicate`, or to CLEAR when the active lens is tapped again. The
   *  widget does not change its own selection — see the class doc. */
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
