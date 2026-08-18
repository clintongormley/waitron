import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-button.js";
import { t } from "../i18n/t.js";
import { allergenState, allergenStateName } from "../i18n/domain.js";
import type { Ingredient } from "../api/client.js";

/**
 * The recipe-authoring dashboard's INGREDIENT LIST: one `wt-card` row per ingredient showing its
 * `name` and an allergen-state pill (the three states PENDING/none/declared). An Edit control per row
 * emits `edit-ingredient { id }`.
 *
 * It is a PURE DISPLAY widget — it holds no state and never talks to the API (like `product-list` and
 * `staff-list`). The recipe screen owns the list (`DashboardApi.listIngredients`) and hands it down as
 * `ingredients`; the Edit control emits a composed, bubbling `edit-ingredient` carrying only the `id`,
 * which the screen turns into an edit flow.
 *
 * Everything that carries meaning does so in TEXT, not colour alone (a11y): the allergen pill's three
 * states read as three different words. The allergen state renders through the i18n layer as a
 * localised display name (`allergenStateName`) at the render edge, exactly as `product-list` does;
 * `data-state` stays the raw token.
 */
@customElement("dashboard-ingredient-list")
export class IngredientList extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .list {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }

      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
      }

      .details {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        min-width: 0;
      }

      .name {
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text);
      }

      .badges {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        margin-top: var(--wt-space-1);
      }

      /* A bordered text pill: the label carries the meaning, so nothing here depends on colour to be
         understood (the product-list badge convention). The wt-color-text token on the card surface is
         the highest-contrast pairing in both themes. */
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 0 var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];

  /** The ingredients to list, straight from `DashboardApi.listIngredients`. The screen owns and
   * refreshes it; defaults to empty so the widget renders safely before the screen assigns the list. */
  @property({ attribute: false }) ingredients: Ingredient[] = [];

  /**
   * Ask the recipe screen to edit `id`. `stopPropagation` keeps the button's own composed `click`
   * inside this widget's shadow boundary, so the consumer hears the semantic `edit-ingredient` and not
   * a raw click as well (the house pattern — `product-list` stops its composed events the same way).
   * Dispatched `bubbles`+`composed` so it crosses the boundary to the screen.
   */
  #edit(event: Event, id: string): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<{ id: string }>("edit-ingredient", {
        detail: { id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    const editLabel = t("action.edit"); // locale-invariant across rows — resolve once per render
    return html`
      <div class="list">
        ${this.ingredients.map((ingredient) => {
          const state = allergenState(ingredient.allergens);
          return html`
            <wt-card data-test="row">
              <div class="row">
                <div class="details">
                  <span class="name">${ingredient.name}</span>
                  <span class="badges">
                    <span class="badge" data-test="allergen-state" data-state=${state}
                      >${allergenStateName(state)}</span
                    >
                  </span>
                </div>
                <wt-button
                  variant="ghost"
                  data-test=${`edit-${ingredient.id}`}
                  aria-label=${`${editLabel} ${ingredient.name}`}
                  @click=${(event: Event) => this.#edit(event, ingredient.id)}
                >
                  ${editLabel}
                </wt-button>
              </div>
            </wt-card>
          `;
        })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-ingredient-list": IngredientList;
  }
}
