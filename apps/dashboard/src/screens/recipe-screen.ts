import { ContentLanguageController } from "@waitron/ui";
import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import "../widgets/ingredient-list.js";
import "../widgets/ingredient-form.js";
import "../widgets/recipe-editor.js";
import {
  ingredientRefusalErrors,
  type CreateIngredientDetail,
  type IngredientFormErrors,
  type UpdateIngredientDetail,
} from "../widgets/ingredient-form.js";
import type { RecipeEditor, SaveRecipeDetail } from "../widgets/recipe-editor.js";
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
      .pickers wt-combobox {
        flex: 1 1 calc(var(--wt-space-6) * 8);
        min-width: 0;
        max-width: calc(var(--wt-space-6) * 12);
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
    (error) => this.#showReadError(error),
    () => {
      if (this.#readErrorShown) this.#showError(null);
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
  /** Whether `errorKey` is a read's failure, the only message the reads' recovery may clear. */
  #readErrorShown = false;
  @state() private formErrors: IngredientFormErrors = {};
  // Set synchronously on entry, so a double-fired event files at most one mutation.
  @state() private busy = false;
  // While the recipe loads it reads as empty, so a Save then would wipe the product's recipe.
  @state() private recipeLoading = false;

  #generation = 0;
  #recipeGeneration = 0;
  #retainedProduct: Product | null = null;

  #editor(): RecipeEditor | null {
    return this.shadowRoot?.querySelector("dashboard-recipe-editor") ?? null;
  }

  override disconnectedCallback(): void {
    this.#generation++;
    this.#recipeGeneration++;
    this.selectedCatalogueId = "";
    this.selectedProductId = "";
    this.#retainedProduct = null;
    this.recipe = [];
    this.products = [];
    this.busy = false;
    this.recipeLoading = false;
    this.formOpen = false;
    this.editingIngredient = null;
    this.formErrors = {};
    this.#showError(null);
    super.disconnectedCallback();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    this.#showError(null);
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
      this.#showReadError(error);
    }
  }

  #showError(code: string | null, fromRead = false): void {
    this.errorKey = code;
    this.#readErrorShown = fromRead;
  }

  /** A read's failure never replaces an action's message. */
  #showReadError(error: unknown): void {
    if (this.errorKey === null || this.#readErrorShown) this.#showError(codeOf(error), true);
  }

  async #reloadIngredients(): Promise<void> {
    const generation = this.#generation;
    const ingredients = await this.api.listIngredients();
    if (this.isConnected && this.#generation === generation) this.ingredients = ingredients;
  }

  #openForm(): void {
    this.#showError(null);
    this.formErrors = {};
    this.editingIngredient = null;
    this.formOpen = true;
  }

  #onEditIngredient(event: CustomEvent<{ id: string }>): void {
    event.stopPropagation();
    const ingredient = this.ingredients.find((i) => i.id === event.detail.id);
    if (ingredient === undefined) return;
    this.#showError(null);
    this.formErrors = {};
    this.editingIngredient = ingredient;
    this.formOpen = true;
  }

  async #onCreateIngredient(event: CustomEvent<CreateIngredientDetail>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return;
    this.busy = true;
    this.formErrors = {};
    const generation = this.#generation;
    const current = () => this.isConnected && this.#generation === generation;
    try {
      try {
        await this.api.createIngredient(event.detail);
      } catch (error) {
        if (!current()) return;
        this.formErrors = ingredientRefusalErrors(error);
        return;
      }
      if (!current()) return;
      this.shadowRoot!.querySelector("dashboard-ingredient-form")!.closeSaved(event.detail);
      await this.#afterWrite();
    } finally {
      if (current()) this.busy = false;
    }
  }

  async #afterWrite(): Promise<void> {
    const generation = this.#generation;
    this.formOpen = false;
    this.#showError(null);
    try {
      await this.#reloadIngredients();
    } catch (error) {
      if (this.isConnected && this.#generation === generation) this.#showReadError(error);
    }
  }

  async #onUpdateIngredient(event: CustomEvent<UpdateIngredientDetail>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return;
    this.busy = true;
    this.formErrors = {};
    const generation = this.#generation;
    const current = () => this.isConnected && this.#generation === generation;
    try {
      try {
        await this.api.updateIngredient(event.detail.id, event.detail.patch);
      } catch (error) {
        if (!current()) return;
        this.formErrors = ingredientRefusalErrors(error);
        return;
      }
      if (!current()) return;
      this.shadowRoot!.querySelector("dashboard-ingredient-form")!.closeSaved(event.detail.patch);
      await this.#afterWrite();
    } finally {
      if (current()) this.busy = false;
    }
  }

  #onSelectCatalogue(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const catalogueId = event.detail.value;
    if (catalogueId === this.selectedCatalogueId) return;
    (event.currentTarget as HTMLElementTagNameMap["wt-combobox"]).value = this.selectedCatalogueId;
    const select = () => {
      this.#recipeGeneration++;
      this.selectedCatalogueId = catalogueId;
      this.selectedProductId = "";
      this.#retainedProduct = null;
      this.recipe = [];
      this.recipeLoading = false;
      this.products = [];
      if (catalogueId === "") this.#queries.release("listProducts");
      else void this.#loadProducts();
    };
    const editor = this.#editor();
    if (editor) editor.requestLeave("navigation", select);
    else select();
  }

  async #loadProducts(): Promise<void> {
    this.#showError(null);
    try {
      await this.#queries.watch("listProducts", [this.selectedCatalogueId], (value) => {
        const current = this.#selectedProduct();
        this.#retainedProduct = this.#editor()?.isDirty() ? current : null;
        this.products = value;
      });
    } catch (error) {
      this.#showReadError(error);
    }
  }

  #onSelectProduct(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const productId = event.detail.value;
    if (productId === this.selectedProductId) return;
    (event.currentTarget as HTMLElementTagNameMap["wt-combobox"]).value = this.selectedProductId;
    const select = () => {
      this.#recipeGeneration++;
      this.selectedProductId = productId;
      this.#retainedProduct = null;
      this.recipe = [];
      this.recipeLoading = productId !== "";
      if (productId !== "") void this.#loadRecipe();
    };
    const editor = this.#editor();
    if (editor) editor.requestLeave("navigation", select);
    else select();
  }

  async #loadRecipe(): Promise<void> {
    const productId = this.selectedProductId;
    const generation = this.#recipeGeneration;
    this.#showError(null);
    try {
      const recipe = await this.api.getProductRecipe(productId);
      if (this.#recipeGeneration !== generation || !this.isConnected) return;
      this.recipe = recipe;
    } catch (error) {
      if (this.#recipeGeneration !== generation || !this.isConnected) return;
      this.#showReadError(error);
    } finally {
      if (this.#recipeGeneration === generation && this.isConnected) this.recipeLoading = false;
    }
  }

  async #onSaveRecipe(event: CustomEvent<SaveRecipeDetail>): Promise<void> {
    event.stopPropagation();
    if (this.busy || this.recipeLoading) return;
    this.busy = true;
    this.#showError(null);
    const generation = this.#generation;
    const recipeGeneration = this.#recipeGeneration;
    const editor = this.#editor();
    const submitted = {
      productId: event.detail.productId,
      ingredientIds: [...event.detail.ingredientIds],
    };
    const current = () =>
      this.isConnected &&
      this.#generation === generation &&
      this.#recipeGeneration === recipeGeneration;
    let written = false;
    try {
      await this.api.setProductRecipe(submitted.productId, submitted.ingredientIds);
      if (!current()) return;
      editor?.commitSaved(submitted);
      written = true;
      const recipe = await this.api.getProductRecipe(submitted.productId);
      if (current()) this.recipe = recipe;
    } catch (error) {
      if (!current()) return;
      if (written) this.#showReadError(error);
      else this.#showError(codeOf(error));
    } finally {
      if (this.isConnected && this.#generation === generation) this.busy = false;
    }
  }

  #closeEditor(): void {
    this.#recipeGeneration++;
    this.#retainedProduct = null;
    this.selectedProductId = "";
    this.recipe = [];
    this.recipeLoading = false;
  }

  #selectedProduct(): Product | null {
    return this.products.find((p) => p.id === this.selectedProductId) ?? this.#retainedProduct;
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
              ? html`<wt-combobox
                  name="catalogueId"
                  data-test="recipe-catalogue-select"
                  label=${t("recipe.select_catalogue")}
                  search="auto"
                  placeholder=${t("recipe.select_catalogue")}
                  searchPlaceholder=${t("categories.combobox_search")}
                  noResultsLabel=${t("categories.combobox_no_results")}
                  .options=${[
                    { value: "", label: t("recipe.select_catalogue") },
                    ...this.catalogues.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                  .value=${this.selectedCatalogueId}
                  @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onSelectCatalogue(e)}
                ></wt-combobox>`
              : nothing
          }
          ${
            this.selectedCatalogueId !== ""
              ? html`<wt-combobox
                  name="productId"
                  data-test="recipe-product-select"
                  label=${t("recipe.select_product")}
                  search="auto"
                  placeholder=${t("recipe.select_product")}
                  searchPlaceholder=${t("categories.combobox_search")}
                  noResultsLabel=${t("categories.combobox_no_results")}
                  .options=${[
                    { value: "", label: t("recipe.select_product") },
                    ...this.products.map((p) => ({ value: p.id, label: p.name })),
                  ]}
                  .value=${this.selectedProductId}
                  @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onSelectProduct(e)}
                ></wt-combobox>`
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
        .fieldErrors=${this.formErrors}
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
