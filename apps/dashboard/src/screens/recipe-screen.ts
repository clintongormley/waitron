import { ContentLanguageController } from "@waitron/ui";
import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
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

@customElement("dashboard-recipe-screen")
export class RecipeScreen extends LitElement {
  constructor() {
    super();
    new ContentLanguageController(this);
  }

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

  @property({ attribute: false }) api!: DashboardApi;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.errorKey = codeOf(error);
    },
  );

  @state() private ingredients: Ingredient[] = [];
  @state() private catalogues: CatalogueSummary[] = [];
  @state() private selectedCatalogueId = "";
  @state() private products: Product[] = [];
  @state() private selectedProductId = "";
  @state() private recipe: RecipeLine[] = [];
  @state() private formOpen = false;
  @state() private editingIngredient: Ingredient | null = null;
  @state() private errorKey: string | null = null;
  // Set synchronously on entry, so a double-fired event files at most one mutation.
  @state() private busy = false;
  // While the recipe loads it reads as empty, so a Save then would wipe the product's recipe.
  @state() private recipeLoading = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      await Promise.all([
        this.#queries.watch("listIngredients", [], (value) => {
          this.ingredients = value;
        }),
        this.#queries.watch("listCatalogues", [], (value) => {
          this.catalogues = value;
        }),
      ]);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  async #reloadIngredients(): Promise<void> {
    this.ingredients = await this.api.listIngredients();
  }

  #openForm(): void {
    this.errorKey = null;
    this.editingIngredient = null;
    this.formOpen = true;
  }

  #onEditIngredient(event: CustomEvent<{ id: string }>): void {
    event.stopPropagation();
    const ingredient = this.ingredients.find((i) => i.id === event.detail.id);
    if (ingredient === undefined) return;
    this.errorKey = null;
    this.editingIngredient = ingredient;
    this.formOpen = true;
  }

  async #onCreateIngredient(event: CustomEvent<CreateIngredientDetail>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return;
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

  async #onUpdateIngredient(event: CustomEvent<UpdateIngredientDetail>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return;
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

  #onSelectCatalogue(event: Event): void {
    event.stopPropagation();
    this.selectedCatalogueId = (event.target as HTMLSelectElement).value;
    this.selectedProductId = "";
    this.recipe = [];
    this.recipeLoading = false;
    this.products = [];
    if (this.selectedCatalogueId === "") {
      this.#queries.release("listProducts");
      return;
    }
    void this.#loadProducts();
  }

  async #loadProducts(): Promise<void> {
    this.errorKey = null;
    try {
      await this.#queries.watch("listProducts", [this.selectedCatalogueId], (value) => {
        this.products = value;
      });
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  #onSelectProduct(event: Event): void {
    event.stopPropagation();
    this.selectedProductId = (event.target as HTMLSelectElement).value;
    this.recipe = [];
    this.recipeLoading = this.selectedProductId !== "";
    if (this.selectedProductId === "") return;
    void this.#loadRecipe();
  }

  /** A slow earlier load must not overwrite, or report an error over, a product picked since. */
  async #loadRecipe(): Promise<void> {
    const productId = this.selectedProductId;
    this.errorKey = null;
    try {
      const recipe = await this.api.getProductRecipe(productId);
      if (this.selectedProductId !== productId) return;
      this.recipe = recipe;
    } catch (error) {
      if (this.selectedProductId !== productId) return;
      this.errorKey = codeOf(error);
    } finally {
      if (this.selectedProductId === productId) this.recipeLoading = false;
    }
  }

  async #onSaveRecipe(event: CustomEvent<SaveRecipeDetail>): Promise<void> {
    event.stopPropagation();
    if (this.busy || this.recipeLoading) return;
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

  #closeEditor(): void {
    this.selectedProductId = "";
    this.recipe = [];
    this.recipeLoading = false;
  }

  #selectedProduct(): Product | null {
    return this.products.find((p) => p.id === this.selectedProductId) ?? null;
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
                          ${p.name}
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
