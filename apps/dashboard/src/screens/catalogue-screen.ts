import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ContentLanguages } from "@waitron/shared";
import { baseStyles, selectStyles, setContentLanguages, UrlStateController } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { DashboardQueries } from "../api/query-controller.js";
import type {
  CatalogueSummary,
  CategoryInput,
  CategorySummary,
  DashboardApi,
  Modifier,
  ModifierInput,
  Product,
  ProductEditorInput,
  ProductEditorValue,
  Station,
  Course,
  Unit,
  UnitInput,
} from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { dashboardPath } from "../navigation.js";
import { ProductChildCreate, type ProductChildKind } from "../state/product-child-create.js";
import { productEditorField, type ProductEditor } from "../widgets/product-editor.js";
import "../widgets/category-form.js";
import "../widgets/content-languages.js";
import "../widgets/modifier-form.js";
import "../widgets/product-editor.js";
import "../widgets/product-list.js";
import "../widgets/unit-form.js";

@customElement("dashboard-catalogue-screen")
export class CatalogueScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }
      .header,
      .actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        margin-bottom: var(--wt-space-4);
      }
      h1 {
        margin: 0;
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-lg);
      }
      .error {
        color: var(--wt-color-danger);
      }
      label {
        display: grid;
        gap: var(--wt-space-2);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @state() private contentLanguages: ContentLanguages | null = null;
  @state() private catalogues: CatalogueSummary[] = [];
  @state() private categories: CategorySummary[] = [];
  @state() private units: Unit[] = [];
  @state() private modifiers: Modifier[] = [];
  @state() private products: Product[] = [];
  @state() private stations: Station[] = [];
  @state() private courses: Course[] = [];
  @state() private selectedCatalogueId = "";
  @state() private editorOpen = false;
  @state() private editorValue: ProductEditorValue | null = null;
  @state() private busy = false;
  @state() private errorKey: string | null = null;
  @state() private languageSettingsOpen = false;
  /** The modifier the nested form is EDITING, or null when it is creating one. The product editor
   * opens the same form for both, and this is what decides which write its Save performs. */
  @state() private editingModifier: Modifier | null = null;
  /** The rejected save's problem, keyed by the editor field that holds it. Empty when the server
   * named no field this screen can point at. */
  @state() private editorFieldErrors: Record<string, string> = {};
  #editorGeneration = 0;
  #linkedProduct: string | null = null;

  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.errorKey = codeOf(error);
    },
  );
  readonly #url = new UrlStateController(
    this,
    () => {
      if (this.#url.read("dashboard") !== "catalogue") return;
      this.#linkedProduct = this.#url.read("product");
      if (this.#linkedProduct === null) this.#closeEditor(false);
      else void this.#openLinkedProduct();
    },
    dashboardPath,
  );
  readonly #child = new ProductChildCreate(this, {
    accept: (kind, value) => {
      if (kind === "modifier") this.editingModifier = null;
      this.#editor()?.selectRelated(kind, value.id);
    },
    refresh: (kind) => this.#refreshRelated(kind),
    loadError: (error) => {
      this.errorKey = codeOf(error);
    },
    focus: (kind) => this.#editor()?.returnRelatedFocus(kind),
  });

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      await Promise.all([
        this.#queries.watch("getContentLanguages", [], (value) => {
          this.contentLanguages = value;
          setContentLanguages(value);
        }),
        this.#queries.watch("listCategories", [], (value) => {
          this.categories = value;
        }),
        this.#queries.watch("listUnits", [], (value) => {
          this.units = value;
        }),
        this.#queries.watch("listModifiers", [], (value) => {
          this.modifiers = value;
        }),
        this.#queries.watch("listCatalogues", [], (value) => {
          this.catalogues = value;
        }),
        this.#queries.watch("listStations", [], (value) => {
          this.stations = value;
        }),
        this.#queries.watch("listCourses", [], (value) => {
          this.courses = value;
        }),
      ]);
      if (!this.catalogues.some(({ id }) => id === this.selectedCatalogueId))
        this.selectedCatalogueId = this.catalogues[0]?.id ?? "";
      await this.#reloadProducts();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  async #reloadProducts(): Promise<void> {
    if (!this.catalogues.length) {
      this.products = [];
      this.#queries.release("listProducts");
      return;
    }
    await this.#queries.watchGroup(
      "listProducts",
      this.catalogues.map(({ id }) => [id]),
      (lists) => {
        this.products = [...new Map(lists.flat().map((product) => [product.id, product])).values()];
      },
    );
    await this.#openLinkedProduct();
  }

  /** Drops everything that belonged to the editor's previous product — a half-finished nested
   * create or edit, and the field the last refused save named — so a switched product never
   * inherits any of it. */
  #resetEditorState(): void {
    this.#child.reset();
    this.editingModifier = null;
    this.editorFieldErrors = {};
  }

  #editor(): ProductEditor | null {
    return this.shadowRoot?.querySelector<ProductEditor>("dashboard-product-editor") ?? null;
  }

  #openCreate(): void {
    this.#editorGeneration++;
    this.#resetEditorState();
    this.editorValue = null;
    this.errorKey = null;
    this.editorOpen = true;
  }

  async #openProduct(productId: string): Promise<void> {
    if (!this.products.some(({ id }) => id === productId)) return;
    this.#resetEditorState();
    this.editorOpen = false;
    this.editorValue = null;
    this.errorKey = null;
    const generation = ++this.#editorGeneration;
    try {
      const value = await this.api.getProductEditor(productId);
      if (generation !== this.#editorGeneration) return;
      this.editorValue = value;
      this.editorOpen = true;
      this.#url.write({ product: productId }, true);
    } catch (error) {
      if (generation === this.#editorGeneration) this.errorKey = codeOf(error);
    }
  }

  async #openLinkedProduct(): Promise<void> {
    const id = this.#linkedProduct;
    if (id === null || !this.products.some((product) => product.id === id)) return;
    this.#linkedProduct = null;
    await this.#openProduct(id);
  }

  #closeEditor(writeUrl = true): void {
    this.#editorGeneration++;
    this.#resetEditorState();
    this.editorOpen = false;
    this.editorValue = null;
    this.#linkedProduct = null;
    if (writeUrl && this.#url.read("product") !== null) this.#url.write({ product: null }, true);
  }

  async #save(event: CustomEvent<{ value: ProductEditorInput }>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return;
    this.busy = true;
    this.errorKey = null;
    this.editorFieldErrors = {};
    try {
      if (this.editorValue === null)
        await this.api.createProductEditor(this.selectedCatalogueId, event.detail.value);
      else await this.api.updateProductEditor(this.editorValue.id, event.detail.value);
      this.#closeEditor();
      await this.#reloadProducts();
    } catch (error) {
      const fieldErrors = this.#rejectedField(error);
      this.editorFieldErrors = fieldErrors;
      // A refusal that names a field is reported INSIDE the editor, beside that field — which is
      // also what opens the section the field is folded into. Only a refusal with nothing to point
      // at falls back to this screen's own banner, so the same problem is never said twice.
      this.errorKey = Object.keys(fieldErrors).length ? null : codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  /** The editor field a rejected product write names, as a `fieldErrors` entry. */
  #rejectedField(error: unknown): Record<string, string> {
    const field = (error as { params?: { field?: unknown } }).params?.field;
    if (typeof field !== "string") return {};
    const name = productEditorField(field, this.contentLanguages?.defaultLanguage ?? "");
    return name === null ? {} : { [name]: t("editor.field_rejected") };
  }

  async #refreshRelated(kind: ProductChildKind): Promise<void> {
    if (kind === "unit") this.units = await this.api.background.listUnits();
    if (kind === "category") this.categories = await this.api.background.listCategories();
    if (kind === "modifier") this.modifiers = await this.api.background.listModifiers();
  }

  #submitUnit(event: CustomEvent<{ value: UnitInput }>): void {
    event.stopPropagation();
    void this.#child.submit(async () => {
      const value = await this.api.createUnit(event.detail.value);
      return { id: value.id, name: value.name };
    });
  }

  #submitCategory(event: CustomEvent<{ value: CategoryInput }>): void {
    event.stopPropagation();
    void this.#child.submit(async () => {
      const value = await this.api.createCategory(event.detail.value);
      return { id: value.id, name: value.name };
    });
  }

  #submitModifier(event: CustomEvent<{ value: ModifierInput }>): void {
    event.stopPropagation();
    const editing = this.editingModifier;
    void this.#child.submit(async () => {
      const value = editing
        ? await this.api.updateModifier(editing.id, event.detail.value)
        : await this.api.createModifier(event.detail.value);
      return { id: value.id, name: value.name };
    });
  }

  /** The product editor asked to edit one of its attached modifiers. The list is already loaded, so
   * this opens the same nested form the create path uses, seeded with that modifier. */
  #editRelated(event: CustomEvent<{ kind: ProductChildKind; id: string }>): void {
    event.stopPropagation();
    if (event.detail.kind !== "modifier") return;
    const modifier = this.modifiers.find(({ id }) => id === event.detail.id);
    if (!modifier) return;
    this.editingModifier = modifier;
    this.#child.open("modifier");
  }

  override render() {
    const locales = this.contentLanguages?.languages ?? [];
    return html`
      <div class="header">
        <h1>${t("nav.catalogue")}</h1>
        <div class="actions">
          <wt-button
            variant="secondary"
            data-test="edit-languages"
            ?disabled=${this.contentLanguages === null}
            @click=${() => {
              this.languageSettingsOpen = true;
            }}
            >${t("content_languages.title")}</wt-button
          >
          ${
            this.catalogues.length
              ? html`<wt-button
                  data-test="add-product"
                  ?disabled=${!locales.length || !this.units.length}
                  @click=${this.#openCreate}
                  >${t("catalogue.add_product")}</wt-button
                >`
              : nothing
          }
        </div>
      </div>
      ${
        this.catalogues.length > 1
          ? html`<label
              >${t("catalogue.title")}<select
                name="product-catalogue"
                @change=${(event: Event) => {
                  this.selectedCatalogueId = (event.target as HTMLSelectElement).value;
                }}
              >
                ${this.catalogues.map(
                  (catalogue) =>
                    html`<option
                      value=${catalogue.id}
                      .selected=${catalogue.id === this.selectedCatalogueId}
                    >
                      ${catalogue.name}
                    </option>`,
                )}
              </select></label
            >`
          : nothing
      }
      ${
        this.catalogues.length
          ? html`<dashboard-product-list
              .products=${this.products}
              @edit-product=${(event: CustomEvent<{ productId: string }>) => {
                event.stopPropagation();
                void this.#openProduct(event.detail.productId);
              }}
            ></dashboard-product-list>`
          : html`<p data-test="no-catalogue">${t("catalogue.empty_prompt")}</p>`
      }
      ${this.errorKey ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>` : nothing}
      <dashboard-product-editor
        .open=${this.editorOpen}
        .busy=${this.busy}
        .childOpen=${this.#child.kind !== null}
        .locales=${locales}
        .value=${this.editorValue}
        .fieldErrors=${this.editorFieldErrors}
        .units=${this.units}
        .categories=${this.categories}
        .modifiers=${this.modifiers}
        .stations=${this.stations}
        .courses=${this.courses}
        .api=${this.api}
        @wt-submit=${(event: CustomEvent<{ value: ProductEditorInput }>) => void this.#save(event)}
        @wt-cancel=${(event: Event) => {
          event.stopPropagation();
          this.#closeEditor();
        }}
        @wt-create-related=${(event: CustomEvent<{ kind: ProductChildKind }>) => {
          event.stopPropagation();
          this.#child.open(event.detail.kind);
        }}
        @wt-edit-related=${this.#editRelated}
      ></dashboard-product-editor>
      <dashboard-unit-form
        .open=${this.#child.kind === "unit"}
        .busy=${this.#child.busy}
        .locales=${locales}
        @wt-submit=${this.#submitUnit}
        @wt-cancel=${() => this.#child.cancel()}
      ></dashboard-unit-form>
      ${
        // The form's name fields follow the content languages, so it waits for them rather than
        // offering a field in a guessed language.
        this.contentLanguages
          ? html`<dashboard-category-form
              .open=${this.#child.kind === "category"}
              .busy=${this.#child.busy}
              .languages=${this.contentLanguages}
              .categories=${this.categories}
              .api=${this.api}
              @wt-submit=${this.#submitCategory}
              @wt-cancel=${() => this.#child.cancel()}
            ></dashboard-category-form>`
          : nothing
      }
      <dashboard-modifier-form
        .open=${this.#child.kind === "modifier"}
        .busy=${this.#child.busy}
        .locales=${locales}
        .value=${this.editingModifier}
        @wt-submit=${this.#submitModifier}
        @wt-cancel=${() => {
          this.editingModifier = null;
          this.#child.cancel();
        }}
      ></dashboard-modifier-form>
      ${
        this.contentLanguages
          ? html`<dashboard-content-languages
              .open=${this.languageSettingsOpen}
              .config=${this.contentLanguages}
              .api=${this.api}
              @languages-closed=${() => {
                this.languageSettingsOpen = false;
              }}
              @languages-saved=${(event: CustomEvent<ContentLanguages>) => {
                event.stopPropagation();
                this.languageSettingsOpen = false;
                this.contentLanguages = event.detail;
                setContentLanguages(event.detail);
              }}
            ></dashboard-content-languages>`
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-catalogue-screen": CatalogueScreen;
  }
}
