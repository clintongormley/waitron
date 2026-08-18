import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-switch.js";
import { t } from "../i18n/t.js";
import type { Ingredient, Product, RecipeLine } from "../api/client.js";

/**
 * The `save-recipe` event detail: which product's recipe was authored, and the FULL set of ingredient
 * ids that compose it after editing. The set is authoritative — `setProductRecipe` REPLACES the recipe
 * with exactly these lines, so an ingredient left unchecked (absent from the array) is a removal, and
 * an empty array clears the recipe. Not a delta.
 */
export interface SaveRecipeDetail {
  productId: string;
  ingredientIds: string[];
}

/**
 * The recipe-authoring dashboard's RECIPE EDITOR: for one chosen product, a `wt-card` with one
 * `wt-switch` per available ingredient, each pre-checked when that ingredient is already in the
 * product's recipe. Confirm emits `save-recipe { productId, ingredientIds }` carrying the WHOLE checked
 * set; Cancel emits `wt-close`. Like its card/dialog siblings it does NOT call the API and does NOT
 * clear itself on confirm — the recipe screen (a later task) owns `getProductRecipe`/`setProductRecipe`
 * and closes the editor on a successful save, so a rejected write leaves the toggles as the operator
 * left them.
 *
 * SEEDING. `willUpdate` reseeds `checked` from `recipe` whenever `product` or `recipe` changes — and
 * crucially NOT on a plain `checked` change, or every operator toggle would be thrown straight away
 * again on the next render. The guard is on those two properties for exactly that reason. `checked` is
 * a `Set<string>` of ingredient ids; a toggle mutates a COPY and reassigns it, because an in-place
 * `add`/`delete` on the same Set is not a new reference and Lit would not re-render.
 *
 * With no product selected the editor renders nothing — the screen shows it only once a product is
 * chosen. Switch order (hence the emitted `ingredientIds` order) follows `ingredients`, seeded ids
 * first because a Set preserves insertion order.
 */
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

  /** The product whose recipe is being authored, or null — nothing rendered until the screen sets it. */
  @property({ attribute: false }) product: Product | null = null;

  /** Every available ingredient — one switch each. The screen owns the list (`listIngredients`). */
  @property({ attribute: false }) ingredients: Ingredient[] = [];

  /** The product's CURRENT recipe lines; each id seeds its switch checked. Defaults empty. */
  @property({ attribute: false }) recipe: RecipeLine[] = [];

  /** Single-flight: the screen sets it true while a save round-trips; confirm is then a no-op. */
  @property({ type: Boolean }) busy = false;

  /** The checked ingredient ids — reseeded from `recipe`, then mutated by the switches. */
  @state() private checked = new Set<string>();

  /**
   * Reseed `checked` from the product's recipe on a `product` OR `recipe` change — never on a plain
   * `checked` change, which would discard the operator's toggles. Runs before render so the first
   * paint shows the seeded switches.
   */
  override willUpdate(changed: PropertyValues): void {
    if (!changed.has("product") && !changed.has("recipe")) return;
    this.checked = new Set(this.recipe.map((line) => line.id));
  }

  /**
   * Toggle one ingredient. `stopPropagation` keeps the switch's composed `wt-change` inside this
   * widget's shadow boundary. The update is IMMUTABLE — a fresh Set — so Lit sees a new reference and
   * re-renders; an in-place add/delete would leave the reference unchanged and paint nothing.
   */
  #toggle(event: CustomEvent<{ checked: boolean }>, id: string): void {
    event.stopPropagation();
    const next = new Set(this.checked);
    if (event.detail.checked) next.add(id);
    else next.delete(id);
    this.checked = next;
  }

  /**
   * Emit the whole authored set. `stopPropagation` keeps the button's own composed `click` inside this
   * boundary; a `busy` gate makes a second confirm a no-op while a save is in flight (the write is not
   * server-idempotent). `ingredientIds` is `[...checked]` — insertion order, seeded ids first.
   */
  #confirm(event: Event): void {
    event.stopPropagation();
    if (this.busy) return; // single-flight: a second confirm while one is in flight is ignored
    this.dispatchEvent(
      new CustomEvent<SaveRecipeDetail>("save-recipe", {
        detail: { productId: this.product!.id, ingredientIds: [...this.checked] },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Cancel: ask the screen to close the editor. `wt-close` is dispatched bubbles+composed to cross the
   * shadow boundary — the same event a `wt-dialog` close emits, so the screen hears one `wt-close`
   * whichever primitive an editor happens to use.
   */
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
