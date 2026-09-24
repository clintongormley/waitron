import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-button.js";
import { t } from "../i18n/t.js";
import { allergenState, allergenStateName } from "../i18n/domain.js";
import type { Ingredient } from "../api/client.js";

/**
 * Everything that carries meaning does so in TEXT, not colour alone (a11y): the allergen pill's three
 * states read as three different words.
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

  @property({ attribute: false }) ingredients: Ingredient[] = [];

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
    const editLabel = t("action.edit");
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
