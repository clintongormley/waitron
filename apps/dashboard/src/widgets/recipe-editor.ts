import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, leaveCoordinatorFor } from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason } from "@waitron/ui";
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

  #scope?: DraftScope<string[]>;
  #leave?: LeaveCoordinator;

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.checked = new Set();
    super.disconnectedCallback();
  }

  #equal(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((id) => b.includes(id));
  }

  isDirty(): boolean {
    return this.#scope?.isDirty() ?? false;
  }

  commitSaved(submitted: SaveRecipeDetail): void {
    if (this.product?.id === submitted.productId) this.#scope?.commit(submitted.ingredientIds);
  }

  requestLeave(reason: LeaveReason, proceed: () => void): void {
    if (!this.#leave) proceed();
    else void this.#leave.request({ scopes: [this], reason, proceed });
  }

  override willUpdate(changed: PropertyValues): void {
    const previous = changed.get("product") as Product | null | undefined;
    const replaced = changed.has("product") && previous?.id !== this.product?.id;
    if (replaced || this.product === null) {
      this.#scope?.dispose();
      this.#scope = undefined;
      this.#leave = undefined;
      this.checked = new Set(this.recipe.map((line) => line.id));
    } else if (changed.has("recipe") && !this.isDirty()) {
      const fetched = this.recipe.map((line) => line.id);
      if (!this.#equal(fetched, [...this.checked])) {
        this.checked = new Set(fetched);
        this.#scope?.commit(fetched);
      }
    }
    if (this.product && !this.#scope) {
      this.#leave = leaveCoordinatorFor(this);
      this.#scope = this.#leave?.register<string[]>({
        id: this,
        current: () => [...this.checked],
        snapshot: (value) => [...value],
        equal: (a, b) => this.#equal(a, b),
        restore: (value) => {
          this.checked = new Set(value);
        },
      });
    }
  }

  #toggle(event: CustomEvent<{ checked: boolean }>, id: string): void {
    event.stopPropagation();
    const next = new Set(this.checked);
    if (event.detail.checked) next.add(id);
    else next.delete(id);
    this.checked = next;
    this.#scope?.changed();
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

  #cancel(event: Event): void {
    event.stopPropagation();
    this.requestLeave("cancel", () => {
      this.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
    });
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
