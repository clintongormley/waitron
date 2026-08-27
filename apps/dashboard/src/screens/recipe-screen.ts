import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
// Value imports (not `import type`): pull in the widget modules for their `@customElement` side
// effects, so `<dashboard-ingredient-list>`, `<dashboard-ingredient-form>` and
// `<dashboard-recipe-editor>` are registered before this screen renders them (the catalogue-screen
// widget-registration pattern).
import "../widgets/ingredient-list.js";
import "../widgets/ingredient-form.js";
import "../widgets/recipe-editor.js";
import type { CreateIngredientDetail, UpdateIngredientDetail } from "../widgets/ingredient-form.js";
import type { SaveRecipeDetail } from "../widgets/recipe-editor.js";
import type {
  CatalogueSummary,
  DashboardApi,
  Ingredient,
  Product,
  RecipeLine,
} from "../api/client.js";

/**
 * The management dashboard's RECIPE SCREEN: the composition point (sibling of
 * `dashboard-catalogue-screen`) that wires the pure-display `<dashboard-ingredient-list>`, the
 * `<dashboard-ingredient-form>` create/edit dialog and the `<dashboard-recipe-editor>` to the injected
 * `DashboardApi`. It is the single owner of the loaded ingredients, the form's open state, the selected
 * catalogue/product and the chosen product's recipe — the recipe-authoring surface (#92) that feeds a
 * product's recipe-derived allergen floor.
 *
 * ON CONNECT it loads every ingredient (`listIngredients`) and every catalogue (`listCatalogues`); the
 * catalogue's products wait for the operator to CHOOSE a catalogue (a catalogue drives one
 * `listProducts` call, a product one `getProductRecipe` call) so the screen never guesses which
 * catalogue to open. The ingredient list emits `edit-ingredient { id }`; the form emits
 * `create-ingredient` (an `IngredientInput`) and `update-ingredient { id, patch }`; the recipe editor
 * emits `save-recipe { productId, ingredientIds }` and a `wt-close` (Cancel). Each is turned into an
 * API call here, followed by the relevant reload.
 *
 * ERROR HANDLING, every async path, mirrors `catalogue-screen.ts`: `#load`, `#onCreate`, `#onUpdate`,
 * `#loadProducts`, `#loadRecipe` and `#onSaveRecipe` are each fully `try/catch`ed (invoked via `void`)
 * — a rejection becomes `errorKey` (the thrown `{ code }`, falling back to `server.internal`) rendered
 * in a `role="alert"` banner, localised at the render edge by `codeMessage`, never an unhandled promise
 * rejection. A single-flight `busy` gate on the ingredient create/update AND the recipe save (passed
 * DOWN to the form and the editor to disable their confirm) drops a double-fired mutation, since none
 * is server-idempotent. `stopPropagation` on every child event keeps the composed events inside this
 * screen (the house pattern).
 */
@customElement("dashboard-recipe-screen")
export class RecipeScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        margin-bottom: var(--wt-space-4);
      }
      .title {
        margin: 0;
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      .section {
        margin-top: var(--wt-space-6);
      }
      .section-title {
        margin: 0 0 var(--wt-space-3);
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text);
      }
      .pickers {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        margin-bottom: var(--wt-space-4);
      }
      .picker {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        color: var(--wt-color-text);
        min-width: 12rem;
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  /** The HTTP face of the dashboard. The app shell injects a real client; a test injects a stub. */
  @property({ attribute: false }) api!: DashboardApi;

  @state() private ingredients: Ingredient[] = [];
  @state() private catalogues: CatalogueSummary[] = [];
  /** Which catalogue's products the product picker lists; empty until the operator chooses one. */
  @state() private selectedCatalogueId = "";
  @state() private products: Product[] = [];
  /** Which product the editor authors; empty until the operator chooses one (editor hidden then). */
  @state() private selectedProductId = "";
  /** The chosen product's current recipe lines; seeds the editor's switches. */
  @state() private recipe: RecipeLine[] = [];
  @state() private formOpen = false;
  /** The ingredient the form is open for (null for a create). */
  @state() private editingIngredient: Ingredient | null = null;
  @state() private errorKey: string | null = null;
  // Single-flight for the ingredient create/update AND the recipe save, passed DOWN to the form and
  // the editor as `.busy` so their confirm disables while a mutation round-trips. Reactive because
  // both render off it; set synchronously at handler entry so a double-fired event files at most one
  // mutation.
  @state() private busy = false;
  // True while the chosen product's recipe is loading. Passed DOWN to the editor as part of `.busy` so
  // its Save is disabled until the recipe resolves — otherwise the loading window (recipe momentarily
  // []) would let an operator Save an empty set and wipe the product's existing recipe.
  @state() private recipeLoading = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /** (Re)load every ingredient + catalogue. Called on connect. A rejection becomes the `errorKey`
   * banner. Products/recipe wait for the operator's catalogue/product choice. */
  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      const [ingredients, catalogues] = await Promise.all([
        this.api.listIngredients(),
        this.api.listCatalogues(),
      ]);
      this.ingredients = ingredients;
      this.catalogues = catalogues;
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Reload the ingredient list (after a create/update). Throws to its caller's catch. */
  async #reloadIngredients(): Promise<void> {
    this.ingredients = await this.api.listIngredients();
  }

  /** Open the create form. Clears any prior error and the edit target. */
  #openForm(): void {
    this.errorKey = null;
    this.editingIngredient = null;
    this.formOpen = true;
  }

  /** The list asked to edit `id`. Resolve it against the list we hold (it is OURS — an unknown id can
   * only be a stale event; drop it) and open the form pre-filled. */
  #onEditIngredient(event: CustomEvent<{ id: string }>): void {
    event.stopPropagation();
    const ingredient = this.ingredients.find((i) => i.id === event.detail.id);
    if (ingredient === undefined) return;
    this.errorKey = null;
    this.editingIngredient = ingredient;
    this.formOpen = true;
  }

  /** Create an ingredient from the form's detail, then close and reload. On rejection the form stays
   * open with its values intact for a retry. Single-flight. */
  async #onCreateIngredient(event: CustomEvent<CreateIngredientDetail>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return; // single-flight: drop a double-click's second create
    this.busy = true;
    this.errorKey = null;
    try {
      await this.api.createIngredient(event.detail);
      this.formOpen = false;
      await this.#reloadIngredients();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  /** Update an ingredient from the form's edit detail, then close and reload. Single-flight. */
  async #onUpdateIngredient(event: CustomEvent<UpdateIngredientDetail>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return; // single-flight
    this.busy = true;
    this.errorKey = null;
    try {
      await this.api.updateIngredient(event.detail.id, event.detail.patch);
      this.formOpen = false;
      await this.#reloadIngredients();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  /** The catalogue selector changed. Native `change` is `composed:false`; `stopPropagation` is
   * defensive consistency with the composed handlers (the catalogue-screen pattern). Reset the product
   * selection and load the newly chosen catalogue's products (the empty placeholder clears them). */
  #onSelectCatalogue(event: Event): void {
    event.stopPropagation();
    this.selectedCatalogueId = (event.target as HTMLSelectElement).value;
    this.selectedProductId = "";
    this.recipe = [];
    this.recipeLoading = false;
    this.products = [];
    if (this.selectedCatalogueId === "") return;
    void this.#loadProducts();
  }

  async #loadProducts(): Promise<void> {
    this.errorKey = null;
    try {
      this.products = await this.api.listProducts(this.selectedCatalogueId);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** The product selector changed. Reset the recipe and load the chosen product's recipe (the empty
   * placeholder hides the editor). */
  #onSelectProduct(event: Event): void {
    event.stopPropagation();
    this.selectedProductId = (event.target as HTMLSelectElement).value;
    this.recipe = [];
    this.recipeLoading = this.selectedProductId !== "";
    if (this.selectedProductId === "") return;
    void this.#loadRecipe();
  }

  /** Load the chosen product's recipe. The selection is captured up front and the result is applied only
   * if it is still current, so a slow earlier load cannot overwrite a newer product the operator picked
   * meanwhile. `recipeLoading` gates the editor's Save until it resolves. */
  async #loadRecipe(): Promise<void> {
    const productId = this.selectedProductId;
    this.errorKey = null;
    try {
      const recipe = await this.api.getProductRecipe(productId);
      if (this.selectedProductId !== productId) return; // superseded by a newer selection
      this.recipe = recipe;
    } catch (error) {
      if (this.selectedProductId !== productId) return; // superseded — its error is not ours to show
      this.errorKey = codeOf(error);
    } finally {
      if (this.selectedProductId === productId) this.recipeLoading = false;
    }
  }

  /** Replace the chosen product's recipe with the editor's authored set, then reload it. On rejection
   * the editor stays with the toggles the operator left. Single-flight. */
  async #onSaveRecipe(event: CustomEvent<SaveRecipeDetail>): Promise<void> {
    event.stopPropagation();
    if (this.busy || this.recipeLoading) return; // single-flight; never save over a not-yet-loaded recipe
    this.busy = true;
    this.errorKey = null;
    try {
      await this.api.setProductRecipe(event.detail.productId, event.detail.ingredientIds);
      this.recipe = await this.api.getProductRecipe(event.detail.productId);
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  /** The editor's Cancel (`wt-close`) — deselect the product so the editor hides. */
  #closeEditor(): void {
    this.selectedProductId = "";
    this.recipe = [];
    this.recipeLoading = false;
  }

  /** The chosen product (or null), resolved against the loaded list. Drives the editor's visibility. */
  #selectedProduct(): Product | null {
    return this.products.find((p) => p.id === this.selectedProductId) ?? null;
  }

  /** A product's display name: its `es` description, falling back to any other, then the bare id — a
   * name in the wrong language beats a blank option, and an id beats nothing (the product-list rule). */
  #productName(product: Product): string {
    return product.descriptions["es"] ?? Object.values(product.descriptions)[0] ?? product.id;
  }

  override render(): TemplateResult {
    const hasCatalogue = this.catalogues.length > 0;
    return html`
      <div class="header">
        <h1 class="title">${t("recipe.title")}</h1>
        <wt-button variant="primary" data-test="new-ingredient" @click=${() => this.#openForm()}
          >${t("ingredient.new")}</wt-button
        >
      </div>

      <section class="section">
        <h2 class="section-title">${t("recipe.ingredients_heading")}</h2>
        <dashboard-ingredient-list
          .ingredients=${this.ingredients}
          @edit-ingredient=${(e: CustomEvent<{ id: string }>) => this.#onEditIngredient(e)}
        ></dashboard-ingredient-list>
      </section>

      <section class="section">
        <h2 class="section-title">${t("recipe.products_heading")}</h2>
        <div class="pickers">
          ${
            hasCatalogue
              ? html`<label class="picker"
                  >${t("recipe.select_catalogue")}
                  <select
                    data-test="recipe-catalogue-select"
                    @change=${(e: Event) => this.#onSelectCatalogue(e)}
                  >
                    <option value="" .selected=${this.selectedCatalogueId === ""}>
                      ${t("recipe.select_catalogue")}
                    </option>
                    ${this.catalogues.map(
                      (c) =>
                        html`<option value=${c.id} .selected=${c.id === this.selectedCatalogueId}>
                          ${c.name}
                        </option>`,
                    )}
                  </select>
                </label>`
              : nothing
          }
          ${
            this.selectedCatalogueId !== ""
              ? html`<label class="picker"
                  >${t("recipe.select_product")}
                  <select
                    data-test="recipe-product-select"
                    @change=${(e: Event) => this.#onSelectProduct(e)}
                  >
                    <option value="" .selected=${this.selectedProductId === ""}>
                      ${t("recipe.select_product")}
                    </option>
                    ${this.products.map(
                      (p) =>
                        html`<option value=${p.id} .selected=${p.id === this.selectedProductId}>
                          ${this.#productName(p)}
                        </option>`,
                    )}
                  </select>
                </label>`
              : nothing
          }
        </div>

        <dashboard-recipe-editor
          .product=${this.#selectedProduct()}
          .ingredients=${this.ingredients}
          .recipe=${this.recipe}
          .busy=${this.busy || this.recipeLoading}
          @save-recipe=${(e: CustomEvent<SaveRecipeDetail>) => void this.#onSaveRecipe(e)}
          @wt-close=${() => this.#closeEditor()}
        ></dashboard-recipe-editor>
      </section>

      ${this.errorKey ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>` : nothing}

      <dashboard-ingredient-form
        .open=${this.formOpen}
        .ingredient=${this.editingIngredient}
        .busy=${this.busy}
        @create-ingredient=${(e: CustomEvent<CreateIngredientDetail>) =>
          void this.#onCreateIngredient(e)}
        @update-ingredient=${(e: CustomEvent<UpdateIngredientDetail>) =>
          void this.#onUpdateIngredient(e)}
        @wt-close=${() => (this.formOpen = false)}
      ></dashboard-ingredient-form>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-recipe-screen": RecipeScreen;
  }
}
