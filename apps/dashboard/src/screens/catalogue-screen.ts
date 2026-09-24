import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ContentLanguages } from "@waitron/shared";
import { baseStyles, setContentLanguages, UrlStateController } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-modal.js";
import { DashboardQueries } from "../api/query-controller.js";
import type {
  CatalogueSummary,
  CategoryInput,
  CategorySummary,
  DashboardApi,
  ExtraList,
  ExtraListInput,
  OptionList,
  OptionListInput,
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
import {
  productEditorField,
  productEditorTranslationField,
  type ProductEditor,
} from "../widgets/product-editor.js";
import "../widgets/category-form.js";
import "../widgets/content-languages.js";
import "../widgets/extra-list-form.js";
import "../widgets/option-list-form.js";
import "../widgets/product-editor.js";
import "../widgets/product-list.js";
import "../widgets/unit-form.js";

/** The staff names of the extras lists a `product.offered_as_extra` refusal carries. */
function extraListNames(error: unknown): string[] {
  const lists = (error as { params?: { extraLists?: unknown } }).params?.extraLists;
  if (!Array.isArray(lists)) return [];
  return lists.flatMap((list: { name?: unknown }) =>
    typeof list.name === "string" ? [list.name] : [],
  );
}

/** A refusal's sentence, followed by the lists `product.offered_as_extra` names: the sentence
 * cannot say which lists the manager has to change. */
function refusalText(code: string, extraLists: readonly string[]): string {
  return code === "product.offered_as_extra" && extraLists.length
    ? `${codeMessage(code)} ${extraLists.join(", ")}`
    : codeMessage(code);
}

@customElement("dashboard-catalogue-screen")
export class CatalogueScreen extends LitElement {
  static override styles = [
    baseStyles,
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
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @state() private contentLanguages: ContentLanguages | null = null;
  @state() private catalogues: CatalogueSummary[] = [];
  @state() private categories: CategorySummary[] = [];
  @state() private units: Unit[] = [];
  @state() private extraLists: ExtraList[] = [];
  @state() private optionLists: OptionList[] = [];
  @state() private products: Product[] = [];
  @state() private stations: Station[] = [];
  @state() private courses: Course[] = [];
  @state() private selectedCatalogueId = "";
  @state() private editorOpen = false;
  @state() private editorValue: ProductEditorValue | null = null;
  @state() private busy = false;
  @state() private errorKey: string | null = null;
  /** The extras lists the refusal in `errorKey` names, when it names any. */
  @state() private refusedLists: string[] = [];
  @state() private languageSettingsOpen = false;
  /** The product or variant the Delete confirmation is open for. */
  @state() private deletingProduct: { id: string; name: string; isVariant: boolean } | null = null;
  @state() private deleteErrorKey: string | null = null;
  /** The modifier list the nested extras or options form is EDITING, or null while it is creating
   * one. The same form does both, and this is what decides which write its Save performs; one state
   * serves both kinds because only one nested form is ever open. */
  @state() private editingList: {
    kind: "extras" | "options";
    value: ExtraList | OptionList;
  } | null = null;
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
      // A nested form that was EDITING an existing list must not attach it: which lists a product
      // carries is the editor's own section's business, and the list being edited may belong to a
      // different product entirely.
      const edited = this.editingList !== null;
      this.editingList = null;
      if (edited && (kind === "extras" || kind === "options")) return;
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
        this.#queries.watch("listExtraLists", [], (value) => {
          this.extraLists = value;
        }),
        this.#queries.watch("listOptionLists", [], (value) => {
          this.optionLists = value;
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
    this.editingList = null;
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

  /** Whether a loaded product, or a variant nested under one, has this id: a variant has its own
   * page, and the list read carries it only under its parent. */
  #knows(productId: string): boolean {
    return this.products.some(
      ({ id, variants }) =>
        id === productId || variants.some((variant) => variant.id === productId),
    );
  }

  async #openProduct(productId: string): Promise<void> {
    if (!this.#knows(productId)) return;
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
    if (id === null || !this.#knows(id)) return;
    this.#linkedProduct = null;
    await this.#openProduct(id);
  }

  #openDelete(productId: string): void {
    const product = this.products.find(({ id }) => id === productId);
    const variant = this.products
      .flatMap(({ variants }) => variants)
      .find(({ id }) => id === productId);
    const found = product ?? variant;
    this.deletingProduct = found
      ? { id: found.id, name: found.name, isVariant: product === undefined }
      : null;
    this.deleteErrorKey = null;
    this.errorKey = null;
  }

  #closeDelete(): void {
    this.deletingProduct = null;
    this.deleteErrorKey = null;
  }

  async #deleteProduct(): Promise<void> {
    const product = this.deletingProduct;
    if (!product || this.busy) return;
    this.busy = true;
    this.errorKey = null;
    this.deleteErrorKey = null;
    try {
      const value = await this.api.getProductEditor(product.id);
      await this.api.updateProductEditor(product.id, { ...value, active: false });
    } catch (error) {
      this.deleteErrorKey = codeOf(error);
      this.busy = false;
      return;
    }
    this.#closeDelete();
    try {
      await this.#reloadProducts();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  /** Makes a removed variant Active again through its own page's write, the same write Delete
   * uses to make it Inactive. */
  async #restoreProduct(productId: string): Promise<void> {
    if (this.busy || !this.#knows(productId)) return;
    this.busy = true;
    this.errorKey = null;
    try {
      const value = await this.api.getProductEditor(productId);
      await this.api.updateProductEditor(productId, { ...value, active: true });
    } catch (error) {
      this.errorKey = codeOf(error);
      this.refusedLists = extraListNames(error);
      this.busy = false;
      return;
    }
    try {
      await this.#reloadProducts();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
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
      const fieldErrors = this.#rejectedField(error, event.detail.value);
      this.editorFieldErrors = fieldErrors;
      // A refusal that names a field is reported INSIDE the editor — beside that field when it has
      // one, which also opens the section the field is folded into, else in the editor's summary.
      // Only a refusal with nothing to point at falls back to this screen's own banner, so the same
      // problem is never said twice.
      this.errorKey = Object.keys(fieldErrors).length ? null : codeOf(error);
      this.refusedLists = extraListNames(error);
    } finally {
      this.busy = false;
    }
  }

  /**
   * The editor field a rejected product write belongs to, as a `fieldErrors` entry. A refusal
   * carries one of two things the editor has somewhere to put: the FIELD it is about, or — for the
   * content languages — the LANGUAGE whose text is missing, which is the shape this editor's own
   * translated inputs produce. Which refusals carry which is pinned by
   * `packages/catalogue/src/product-editor.test.ts`; a nutrition refusal carries neither, so it
   * reaches the screen's banner like any other refusal with nothing to point at.
   */
  #rejectedField(error: unknown, submitted: ProductEditorInput): Record<string, string> {
    const params = (error as { params?: { field?: unknown; language?: unknown } }).params ?? {};
    if (typeof params.field === "string") {
      const name = productEditorField(params.field, this.contentLanguages?.defaultLanguage ?? "");
      if (name === null) return {};
      const code = codeOf(error);
      return {
        [name]:
          code === "product.offered_as_extra"
            ? refusalText(code, extraListNames(error))
            : t("editor.field_rejected"),
      };
    }
    const code = codeOf(error);
    if (code === "content.translation_required" && typeof params.language === "string") {
      const name = productEditorTranslationField(submitted, params.language);
      return name === null ? {} : { [name]: codeMessage(code) };
    }
    return {};
  }

  /**
   * A refused nested list write, keyed by the field path the server named — which is the key both
   * list forms map onto their own inputs — or `_form` when it names none. The Modifiers screen
   * reads the same refusals the same way (`#fieldOf`, `modifiers-screen.ts`).
   *
   * Empty while nothing has been refused: the create controller clears its error whenever a form
   * opens or is cancelled, so one form never shows what another one earned. Without this the modal
   * covers the screen's own banner and a refused create says nothing at all.
   */
  #childFieldErrors(): Record<string, string> {
    const error = this.#child.error;
    if (error === null || error === undefined) return {};
    const params = (error as { params?: { field?: unknown } }).params ?? {};
    const field = typeof params.field === "string" ? params.field : "_form";
    return { [field]: codeMessage(codeOf(error)) };
  }

  async #refreshRelated(kind: ProductChildKind): Promise<void> {
    if (kind === "unit") this.units = await this.api.background.listUnits();
    if (kind === "category") this.categories = await this.api.background.listCategories();
    if (kind === "extras") this.extraLists = await this.api.background.listExtraLists();
    if (kind === "options") this.optionLists = await this.api.background.listOptionLists();
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

  #submitExtraList(event: CustomEvent<{ value: ExtraListInput }>): void {
    event.stopPropagation();
    const editing = this.editingList?.kind === "extras" ? this.editingList.value : null;
    void this.#child.submit(async () =>
      editing
        ? await this.api.updateExtraList(editing.id, event.detail.value)
        : await this.api.createExtraList(event.detail.value),
    );
  }

  #submitOptionList(event: CustomEvent<{ value: OptionListInput }>): void {
    event.stopPropagation();
    const editing = this.editingList?.kind === "options" ? this.editingList.value : null;
    void this.#child.submit(async () =>
      editing
        ? await this.api.updateOptionList(editing.id, event.detail.value)
        : await this.api.createOptionList(event.detail.value),
    );
  }

  /** The product editor asked to edit one of its attached modifier lists. Every one of them is
   * already loaded, so this opens the same nested form the create path uses, seeded with the row. */
  #editRelated(event: CustomEvent<{ kind: ProductChildKind; id: string }>): void {
    event.stopPropagation();
    const { kind, id } = event.detail;
    if (kind !== "extras" && kind !== "options") return;
    const lists: (ExtraList | OptionList)[] =
      kind === "extras" ? this.extraLists : this.optionLists;
    const value = lists.find((entry) => entry.id === id);
    if (!value) return;
    this.editingList = { kind, value };
    this.#child.open(kind);
  }

  /**
   * One list form's Cancel, honoured only while a form of that KIND is the open one. A dismissal
   * produces a SECOND `wt-cancel` later: the `<dialog>` this screen just closed delivers its native
   * `close` event a task afterwards, `wt-dialog.ts` turns that into `wt-close`, and the form answers
   * with another cancel. By then a different form can be open, and an unchecked handler closes that
   * one. The same kind reopened inside that task needs no check here: `wt-dialog.ts` drops the late
   * report for a dialog that is open again.
   */
  #cancelList(kind: "extras" | "options"): void {
    if (this.#child.kind !== kind) return;
    this.editingList = null;
    this.#child.cancel();
  }

  override render() {
    const locales = this.contentLanguages?.languages ?? [];
    const childErrors = this.#childFieldErrors();
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
        this.catalogues.length
          ? html`<dashboard-product-list
              .products=${this.products}
              .categories=${this.categories}
              .extraLists=${this.extraLists}
              .optionLists=${this.optionLists}
              @edit-product=${(event: CustomEvent<{ productId: string }>) => {
                event.stopPropagation();
                void this.#openProduct(event.detail.productId);
              }}
              @delete-product=${(event: CustomEvent<{ productId: string }>) => {
                event.stopPropagation();
                this.#openDelete(event.detail.productId);
              }}
              @restore-product=${(event: CustomEvent<{ productId: string }>) => {
                event.stopPropagation();
                void this.#restoreProduct(event.detail.productId);
              }}
            ></dashboard-product-list>`
          : html`<p data-test="no-catalogue">${t("catalogue.empty_prompt")}</p>`
      }
      ${
        this.errorKey
          ? html`<p class="error" role="alert">${refusalText(this.errorKey, this.refusedLists)}</p>`
          : nothing
      }
      <dashboard-product-editor
        .open=${this.editorOpen}
        .busy=${this.busy}
        .childOpen=${this.#child.kind !== null}
        .locales=${locales}
        .value=${this.editorValue}
        .fieldErrors=${this.editorFieldErrors}
        .units=${this.units}
        .categories=${this.categories}
        .extraLists=${this.extraLists}
        .optionLists=${this.optionLists}
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
        @wt-open-product=${(event: CustomEvent<{ productId: string }>) => {
          event.stopPropagation();
          void this.#openProduct(event.detail.productId);
        }}
      ></dashboard-product-editor>
      <wt-modal
        data-test="delete-dialog"
        .open=${this.deletingProduct !== null}
        heading=${t(
          this.deletingProduct?.isVariant ? "product.remove_variant_named" : "product.delete_named",
        ).replace("{name}", this.deletingProduct?.name ?? "")}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (!this.busy) this.#closeDelete();
        }}
      >
        <p>
          ${t(
            this.deletingProduct?.isVariant
              ? "product.remove_variant_warning"
              : "product.delete_warning",
          )}
        </p>
        ${
          this.deleteErrorKey
            ? html`<p class="error" role="alert">${codeMessage(this.deleteErrorKey)}</p>`
            : nothing
        }
        <wt-form-actions slot="footer"
          ><wt-button
            slot="cancel"
            variant="secondary"
            .disabled=${this.busy}
            @click=${this.#closeDelete}
            >${t("action.cancel")}</wt-button
          ><wt-button
            data-test="confirm-delete"
            variant="danger"
            .loading=${this.busy}
            @click=${() => void this.#deleteProduct()}
            >${t(this.deletingProduct?.isVariant ? "action.remove" : "action.delete")}</wt-button
          ></wt-form-actions
        >
      </wt-modal>
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
      ${
        // Both list forms carry translated name fields, so like the category form they wait for the
        // content languages rather than offering a field in a guessed language.
        this.contentLanguages
          ? html`<dashboard-extra-list-form
                .open=${this.#child.kind === "extras"}
                .busy=${this.#child.busy}
                .languages=${this.contentLanguages}
                .value=${this.editingList?.kind === "extras" ? (this.editingList.value as ExtraList) : null}
                .products=${this.products}
                .fieldErrors=${childErrors}
                @wt-submit=${this.#submitExtraList}
                @wt-cancel=${() => this.#cancelList("extras")}
              ></dashboard-extra-list-form>
              <dashboard-option-list-form
                .open=${this.#child.kind === "options"}
                .busy=${this.#child.busy}
                .languages=${this.contentLanguages}
                .value=${
                  this.editingList?.kind === "options"
                    ? (this.editingList.value as OptionList)
                    : null
                }
                .fieldErrors=${childErrors}
                @wt-submit=${this.#submitOptionList}
                @wt-cancel=${() => this.#cancelList("options")}
              ></dashboard-option-list-form>`
          : nothing
      }
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
