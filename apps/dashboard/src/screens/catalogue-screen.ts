import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
// Value imports (not `import type`): pull in the widget modules for their `@customElement` side
// effects, so `<dashboard-product-list>`, `<dashboard-product-form>` and
// `<dashboard-category-manager>` are registered before this screen renders them (the
// `staff-screen.ts` widget-registration pattern).
import "../widgets/product-list.js";
import "../widgets/product-form.js";
import "../widgets/category-manager.js";
import type { CreateProductDetail, UpdateProductDetail } from "../widgets/product-form.js";
import type {
  CatalogueSummary,
  CategorySummary,
  DashboardApi,
  Product,
  ProductInput,
  Station,
} from "../api/client.js";
import { selectStyles } from "../select-styles.js";

/**
 * The management dashboard's CATALOGUE SCREEN: the composition point (sibling of
 * `dashboard-staff-screen`) that wires the pure-display `<dashboard-product-list>`, the
 * `<dashboard-product-form>` create/edit dialog and the `<dashboard-category-manager>` panel to the
 * injected `DashboardApi`. It is the single owner of the selected catalogue, the form's open state and
 * the loaded catalogues/categories/products.
 *
 * ON CONNECT it loads catalogues + categories, picks the first catalogue and loads its products.
 * Because a product needs a catalogue (`products.catalogue_id` is `NOT NULL`), when NO catalogue
 * exists the screen prompts to create one first and hides the add-product affordance — a
 * create-catalogue field then calls `createCatalogue` and reloads. A catalogue selector switches which
 * catalogue's products show.
 *
 * `active` IS SETTABLE ON CREATE. `#onCreateProduct` threads the form's `active` straight into the
 * `ProductInput`, so a create-INACTIVE is ONE atomic request — never a create-then-patch that could
 * leave the product active/sellable at the till if the follow-up failed (a whole-branch review
 * finding). `active` stays a legal patch key on an edit too, which goes straight through
 * `updateProduct(id, patch)`.
 *
 * ERROR HANDLING, every async path, mirroring `staff-screen.ts`: `#load`, `#switchCatalogue`,
 * `#onCreateProduct`, `#onUpdateProduct`, `#onCreateCategory` and `#doCreateCatalogue` are each fully
 * `try/catch`ed — a rejection becomes `errorKey` (from the thrown `{ code }`, falling back to
 * `server.internal`) rendered in a `role="alert"` banner, never an unhandled promise rejection (the
 * handlers are invoked via `void`). A single-flight `busy` gate on product create/update (passed DOWN
 * to the form to disable its confirm) drops a double-fired mutation, since none is server-idempotent.
 * `stopPropagation` on every child event keeps the composed events inside this screen, the house
 * pattern the staff screen follows.
 */
@customElement("dashboard-catalogue-screen")
export class CatalogueScreen extends LitElement {
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
      .actions {
        display: flex;
        align-items: flex-end;
        gap: var(--wt-space-3);
      }
      .title {
        margin: 0;
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      .picker {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        color: var(--wt-color-text);
      }
      .prompt {
        color: var(--wt-color-text);
      }
      .new-catalogue {
        display: flex;
        align-items: flex-end;
        gap: var(--wt-space-3);
        margin-top: var(--wt-space-4);
      }
      .field {
        flex: 1;
        min-width: 0;
      }
      .categories {
        margin-top: var(--wt-space-6);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  /** The HTTP face of the dashboard. The app shell injects a real client; a test injects a stub. */
  @property({ attribute: false }) api!: DashboardApi;

  @state() private catalogues: CatalogueSummary[] = [];
  @state() private categories: CategorySummary[] = [];
  @state() private products: Product[] = [];
  /** The venue's active kitchen stations (KDS-1), loaded on connect and threaded to the category
   * manager + product form as the options their station-routing selects offer. */
  @state() private stations: Station[] = [];
  /** Which catalogue's products show; the catalogue new products are created under. */
  @state() private selectedCatalogueId = "";
  @state() private formOpen = false;
  /** The product the form is open for (null for a create). */
  @state() private editingProduct: Product | null = null;
  @state() private newCatalogueName = "";
  @state() private errorKey: string | null = null;
  // Single-flight for product create/update, passed DOWN to the form as `.busy` so its confirm
  // disables while a mutation round-trips. Reactive because the form renders off it; set synchronously
  // at handler entry so a double-fired event files at most one mutation.
  @state() private busy = false;

  // Separate re-entrancy guards for the two other create flows (nothing renders off them, so plain
  // fields, like the staff screen's `#creating`).
  #savingCategory = false;
  #savingCatalogue = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /**
   * (Re)load catalogues + categories, then the selected catalogue's products. Called on connect and
   * after a catalogue is created. Picks the first catalogue when the current selection is gone (or
   * unset); when NO catalogue exists it clears the selection and the product list (the no-catalogue
   * prompt renders instead). A rejection anywhere becomes the `errorKey` banner.
   */
  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      const [catalogues, categories, stations] = await Promise.all([
        this.api.listCatalogues(),
        this.api.listCategories(),
        this.api.listStations(),
      ]);
      this.catalogues = catalogues;
      this.categories = categories;
      this.stations = stations;
      if (catalogues.length === 0) {
        this.selectedCatalogueId = "";
        this.products = [];
        return;
      }
      if (!catalogues.some((c) => c.id === this.selectedCatalogueId)) {
        this.selectedCatalogueId = catalogues[0]!.id;
      }
      this.products = await this.api.listProducts(this.selectedCatalogueId);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Reload the selected catalogue's products (after a create/update). Throws to its caller's catch. */
  async #reloadProducts(): Promise<void> {
    this.products = await this.api.listProducts(this.selectedCatalogueId);
  }

  /** The catalogue selector changed. Native `change` is `composed:false`; `stopPropagation` is
   * defensive consistency with the composed handlers (the login-screen pattern). Reload the products
   * for the newly selected catalogue. */
  #onSelectCatalogue(event: Event): void {
    event.stopPropagation();
    this.selectedCatalogueId = (event.target as HTMLSelectElement).value;
    void this.#switchCatalogue();
  }

  async #switchCatalogue(): Promise<void> {
    this.errorKey = null;
    try {
      await this.#reloadProducts();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Open the create form for the selected catalogue. Clears any prior error and the edit target. */
  #openForm(): void {
    this.errorKey = null;
    this.editingProduct = null;
    this.formOpen = true;
  }

  /**
   * The product list asked to edit `productId`. Resolve it against the list we already hold (it is
   * OURS — from `listProducts` — so an unknown id can only be a stale event; drop it) and open the
   * form pre-filled. `stopPropagation` keeps the composed `edit-product` inside this screen.
   */
  #onEditProduct(event: CustomEvent<{ productId: string }>): void {
    event.stopPropagation();
    const product = this.products.find((p) => p.id === event.detail.productId);
    if (product === undefined) return;
    this.errorKey = null;
    this.editingProduct = product;
    this.formOpen = true;
  }

  /**
   * Create a product from the form's detail, then reload. `active` is threaded straight into the
   * `ProductInput`, so a create-INACTIVE is ONE atomic request — never a create-then-patch that could
   * leave the product active/sellable at the till if the follow-up failed. `allergens`/`image` are
   * carried only when the detail has them (the create-vs-patch asymmetry the form documents). On
   * rejection the form stays open with its values intact for a retry.
   */
  async #onCreateProduct(event: CustomEvent<CreateProductDetail>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return; // single-flight: drop a double-click's second create-product
    this.busy = true;
    this.errorKey = null;
    try {
      const detail = event.detail;
      const input: ProductInput = {
        catalogueId: detail.catalogueId,
        categoryId: detail.categoryId,
        descriptions: detail.descriptions,
        unitPrice: detail.unitPrice,
        vatClass: detail.vatClass,
        pricingUnit: detail.pricingUnit,
        active: detail.active,
      };
      if (detail.allergens !== undefined) input.allergens = detail.allergens;
      if (detail.image !== undefined) input.image = detail.image;
      await this.api.createProduct(input);
      this.formOpen = false;
      await this.#reloadProducts();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  /**
   * Patch a product from the form's edit detail, then reload. `active` is a legal patch key here (as it
   * is on create), so the patch goes straight through. On rejection the form stays open.
   */
  async #onUpdateProduct(event: CustomEvent<UpdateProductDetail>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return; // single-flight
    this.busy = true;
    this.errorKey = null;
    try {
      await this.api.updateProduct(event.detail.id, event.detail.patch);
      this.formOpen = false;
      await this.#reloadProducts();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  /** Create a category from the manager's detail, then reload the category list. Single-flight. */
  async #onCreateCategory(event: CustomEvent<{ name: string }>): Promise<void> {
    event.stopPropagation();
    if (this.#savingCategory) return;
    this.#savingCategory = true;
    this.errorKey = null;
    try {
      await this.api.createCategory(event.detail.name);
      this.categories = await this.api.listCategories();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.#savingCategory = false;
    }
  }

  /**
   * Route a CATEGORY to a station (KDS-1) from the category manager's `set-category-station` event.
   * `stopPropagation` keeps the composed event inside this screen. A rejection becomes the `errorKey`
   * banner; there is no reload — the catalogue read does not project a category's routing, so a resync
   * would show nothing new (the write itself is authoritative server-side).
   */
  async #onSetCategoryStation(
    event: CustomEvent<{ categoryId: string; stationId: string | null }>,
  ): Promise<void> {
    event.stopPropagation();
    this.errorKey = null;
    try {
      await this.api.setCategoryStation(event.detail.categoryId, event.detail.stationId);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /**
   * Override a PRODUCT's route to a station (KDS-1) from the product form's `set-product-station`
   * event — the same shape as {@link #onSetCategoryStation}. A rejection becomes the `errorKey` banner;
   * no reload for the same reason (the product read projects no `station_id`).
   */
  async #onSetProductStation(
    event: CustomEvent<{ productId: string; stationId: string | null }>,
  ): Promise<void> {
    event.stopPropagation();
    this.errorKey = null;
    try {
      await this.api.setProductStation(event.detail.productId, event.detail.stationId);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Capture the new-catalogue field. `stopPropagation` keeps its composed `wt-change` inside this
   * screen (the house field-handler pattern). */
  #onNewCatalogueNameChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.newCatalogueName = event.detail.value;
  }

  /** Create the first (or a further) catalogue, then reload everything and select it. An empty or
   * whitespace-only name is a no-op; a rejection becomes the error banner. Single-flight. */
  async #createCatalogue(): Promise<void> {
    const name = this.newCatalogueName.trim();
    if (name === "") return;
    if (this.#savingCatalogue) return;
    this.#savingCatalogue = true;
    this.errorKey = null;
    try {
      const created = await this.api.createCatalogue(name);
      this.newCatalogueName = "";
      this.selectedCatalogueId = created.id;
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.#savingCatalogue = false;
    }
  }

  override render(): TemplateResult {
    const hasCatalogue = this.catalogues.length > 0;
    return html`
      <div class="header">
        <h1 class="title">${t("catalogue.title")}</h1>
        ${
          hasCatalogue
            ? html`<div class="actions">
                <label class="picker"
                  >${t("catalogue.picker")}
                  <select
                    data-test="catalogue-select"
                    @change=${(e: Event) => this.#onSelectCatalogue(e)}
                  >
                    ${this.catalogues.map(
                      (c) =>
                        html`<option value=${c.id} .selected=${c.id === this.selectedCatalogueId}>
                          ${c.name}
                        </option>`,
                    )}
                  </select>
                </label>
                <wt-button
                  variant="primary"
                  data-test="add-product"
                  @click=${() => this.#openForm()}
                  >${t("catalogue.add_product")}</wt-button
                >
              </div>`
            : nothing
        }
      </div>

      ${
        hasCatalogue
          ? html`<dashboard-product-list
              .products=${this.products}
              @edit-product=${(e: CustomEvent<{ productId: string }>) => this.#onEditProduct(e)}
            ></dashboard-product-list>`
          : html`<p class="prompt" data-test="no-catalogue">${t("catalogue.empty_prompt")}</p>`
      }

      <section class="new-catalogue">
        <wt-input
          class="field"
          data-test="new-catalogue-name"
          label=${t("catalogue.new")}
          .value=${this.newCatalogueName}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onNewCatalogueNameChange(e)}
        ></wt-input>
        <wt-button
          variant="secondary"
          data-test="create-catalogue"
          @click=${() => void this.#createCatalogue()}
          >${t("catalogue.create")}</wt-button
        >
      </section>

      <section class="categories">
        <dashboard-category-manager
          .categories=${this.categories}
          .stations=${this.stations}
          @create-category=${(e: CustomEvent<{ name: string }>) => this.#onCreateCategory(e)}
          @set-category-station=${(e: CustomEvent<{ categoryId: string; stationId: string | null }>) =>
            void this.#onSetCategoryStation(e)}
        ></dashboard-category-manager>
      </section>

      ${this.errorKey ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>` : nothing}

      <dashboard-product-form
        .open=${this.formOpen}
        .catalogueId=${this.selectedCatalogueId}
        .categories=${this.categories}
        .stations=${this.stations}
        .product=${this.editingProduct}
        .api=${this.api}
        .busy=${this.busy}
        @create-product=${(e: CustomEvent<CreateProductDetail>) => void this.#onCreateProduct(e)}
        @update-product=${(e: CustomEvent<UpdateProductDetail>) => void this.#onUpdateProduct(e)}
        @set-product-station=${(e: CustomEvent<{ productId: string; stationId: string | null }>) =>
          void this.#onSetProductStation(e)}
        @wt-close=${() => (this.formOpen = false)}
      ></dashboard-product-form>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-catalogue-screen": CatalogueScreen;
  }
}
