import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-switch.js";
import { t } from "../i18n/t.js";
import type { Ingredient, Product, RecipeLine } from "../api/client.js";

/**
 * `ingredientIds` is authoritative — `setProductRecipe` REPLACES the recipe with exactly these lines,
 * so an ingredient left unchecked (absent from the array) is a removal, and an empty array clears the
 * recipe.
 */
export interface SaveRecipeDetail {
  productId: string;
  ingredientIds: string[];
}

@customElement("dashboard-recipe-editor")
export class RecipeEditor extends LitElement {
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
        margin-bottom: var(--wt-space-4);
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) product: Product | null = null;
  @property({ attribute: false }) ingredients: Ingredient[] = [];
  @property({ attribute: false }) recipe: RecipeLine[] = [];
  @property({ type: Boolean }) busy = false;
  @state() private checked = new Set<string>();

  /**
   * Reseed `checked` from the product's recipe on a `product` OR `recipe` change — never on a plain
   * `checked` change, which would discard the operator's toggles.
   */
  override willUpdate(changed: PropertyValues): void {
    if (!changed.has("product") && !changed.has("recipe")) return;
    this.checked = new Set(this.recipe.map((line) => line.id));
  }

  /**
   * The update is IMMUTABLE — a fresh Set — so Lit sees a new reference and re-renders; an in-place
   * add/delete would leave the reference unchanged and paint nothing.
   */
  #toggle(event: CustomEvent<{ checked: boolean }>, id: string): void {
    event.stopPropagation();
    const next = new Set(this.checked);
    if (event.detail.checked) next.add(id);
    else next.delete(id);
    this.checked = next;
  }

  #confirm(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    this.dispatchEvent(
      new CustomEvent<SaveRecipeDetail>("save-recipe", {
        detail: { productId: this.product!.id, ingredientIds: [...this.checked] },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** The same event a `wt-dialog` close emits, so the screen hears one `wt-close` whichever
   * primitive an editor happens to use. */
  #cancel(event: Event): void {
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  }

  override render() {
    if (this.product === null) return nothing;
    return html`
      <wt-card>
        <div class="list">
          ${this.ingredients.map(
            (ingredient) => html`
              <wt-switch
                data-test=${`ing-${ingredient.id}`}
                label=${ingredient.name}
                .checked=${this.checked.has(ingredient.id)}
                @wt-change=${(e: CustomEvent<{ checked: boolean }>) =>
                  this.#toggle(e, ingredient.id)}
              ></wt-switch>
            `,
          )}
        </div>
        <div class="actions">
          <wt-button variant="secondary" data-test="cancel" @click=${(e: Event) => this.#cancel(e)}>
            ${t("action.cancel")}
          </wt-button>
          <wt-button
            variant="primary"
            data-test="confirm"
            ?disabled=${this.busy}
            @click=${(e: Event) => this.#confirm(e)}
          >
            ${t("action.save")}
          </wt-button>
        </div>
      </wt-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-recipe-editor": RecipeEditor;
  }
}
