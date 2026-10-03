import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ContentLanguages } from "@waitron/shared";
import type { RoutingModel } from "@waitron/venue-service/routing";
import { baseStyles, setContentLanguages, UrlStateController, type WtModal } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-modal.js";
import { DashboardQueries } from "../api/query-controller.js";
import type {
  CatalogueSummary,
  CategorySummary,
  DashboardApi,
  ExtraList,
  ExtraListInput,
  OptionList,
  OptionListInput,
  Product,
  MadeAt,
  ProductEditorInput,
  ProductEditorValue,
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
import {
  placementMenus,
  type PlacementFailure,
  type PlacementMenu,
} from "../widgets/add-to-menus.js";
import "../widgets/extra-list-form.js";
import "../widgets/option-list-form.js";
import "../widgets/product-editor.js";
import "../widgets/catalogue-browser.js";
import "../widgets/course-list.js";
import type { CourseList } from "../widgets/course-list.js";
import { unitRefusalErrors, type UnitFormErrors } from "../widgets/unit-form.js";

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
      .header {
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
  @state() private productsLoaded = false;
  @state() private madeAt: Record<string, MadeAt> = {};
  @state() private routing: RoutingModel | null = null;
  @state() private courses: Course[] = [];
  @state() private selectedCatalogueId = "";
  @state() private editorOpen = false;
  @state() private editorValue: ProductEditorValue | null = null;
  @state() private busy = false;
  @state() private errorKey: string | null = null;
  /** Whether `errorKey` is a read's failure, the only message the reads' recovery may clear. */
  #readErrorShown = false;
  @state() private refusedLists: string[] = [];
  @state() private deletingProduct: { id: string; name: string; isVariant: boolean } | null = null;
  @state() private deleteErrorKey: string | null = null;
  /** The list the nested form is EDITING, or null while it is creating one: this decides which write
   * its Save performs. One state serves both kinds because only one nested form is ever open. */
  @state() private editingList: {
    kind: "extras" | "options";
    value: ExtraList | OptionList;
  } | null = null;
  /** The rejected save's problem, keyed by the editor field that holds it. Empty when the server
   * named no field this screen can point at. */
  @state() private editorFieldErrors: Record<string, string> = {};
  /** The product just created, while the Add to menus step that follows its create is open. */
  @state() private placing: { id: string; name: string } | null = null;
  @state() private placementMenus: PlacementMenu[] | null = null;
  @state() private placementLoadError: string | null = null;
  @state() private placementFailures: PlacementFailure[] = [];
  @state() private placementBusy = false;
  #editorGeneration = 0;
  /** The category whose menu started the open add, or null for All products; undefined while none is. */
  #addFrom: string | null | undefined = undefined;
  #linkedProduct: string | null = null;
  /** Rebuilt only when a new refusal arrives: a form takes a new `fieldErrors` object as a new
   * refusal and shows again the ones the operator had since dismissed. */
  #childRefusals: { error: unknown; errors: ChildRefusals } | null = null;
  /** The last course the open courses window added. */
  #addedCourse: string | null = null;
  /** The editor generation whose courses window is waiting on its saves to close. */
  #closingCourses: number | null = null;

  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => this.#showReadError(error),
    () => {
      if (this.#readErrorShown) this.#showError(null);
      if (this.#loadFailed) void this.#load();
    },
  );
  #loadFailed = false;
  readonly #routingQueries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.routing = null;
    },
  );
  // A re-read that fails after the step's first load keeps the menus it already shows.
  readonly #placementQueries = new DashboardQueries(
    this,
    () => this.api,
    () => undefined,
    (error) => {
      if (this.placementLoadError === codeMessage(codeOf(error))) this.placementLoadError = null;
    },
  );
  readonly #url = new UrlStateController(
    this,
    () => {
      if (this.#url.read("dashboard") !== "catalogue") return;
      this.categoryId = this.#url.read("category");
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
    loadError: (error) => this.#showReadError(error),
    focus: (kind) => this.#editor()?.returnRelatedFocus(kind),
  });

  override connectedCallback(): void {
    super.connectedCallback();
    this.#showError(null);
    void this.#load();
  }

  async #load(): Promise<void> {
    this.#loadFailed = false;
    try {
      await Promise.all([
        this.#queries.watch("getContentLanguages", [], (value) => {
          this.contentLanguages = value;
          setContentLanguages(value);
        }),
        this.#queries.watch("listCategories", [], (value) => {
          this.categories = value;
        }),
        this.#routingQueries
          .watch("getFolderRouting", [], (value) => {
            this.routing = value;
          })
          .catch(() => {
            this.routing = null;
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
        this.#queries.watch("listCourses", [], (value) => {
          this.courses = value;
        }),
      ]);
      if (!this.catalogues.some(({ id }) => id === this.selectedCatalogueId))
        this.selectedCatalogueId = this.catalogues[0]?.id ?? "";
      await this.#reloadProducts();
      this.productsLoaded = true;
    } catch (error) {
      this.#loadFailed = true;
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

  async #reloadProducts(): Promise<void> {
    await this.#queries.watch("listMadeAt", [], (value) => {
      this.madeAt = value;
    });
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
    this.#addedCourse = null;
  }

  #coursesWindow(): WtModal {
    return this.shadowRoot!.querySelector<WtModal>("[data-test=courses-dialog]")!;
  }

  #editor(): ProductEditor | null {
    return this.shadowRoot?.querySelector<ProductEditor>("dashboard-product-editor") ?? null;
  }

  @state() private categoryId: string | null = null;
  @state() private newCategoryId: string | null = null;

  #openCreate(categoryId: string | null): void {
    this.newCategoryId = this.categories.some(({ id }) => id === categoryId) ? categoryId : null;
    this.#editorGeneration++;
    this.#resetEditorState();
    this.editorValue = null;
    this.#showError(null);
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
    this.#showError(null);
    const generation = ++this.#editorGeneration;
    try {
      const value = await this.api.getProductEditor(productId);
      if (generation !== this.#editorGeneration) return;
      this.editorValue = value;
      this.editorOpen = true;
      this.#url.write({ product: productId }, true);
    } catch (error) {
      if (generation === this.#editorGeneration) this.#showReadError(error);
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
    this.#showError(null);
  }

  #closeDelete(): void {
    this.deletingProduct = null;
    this.deleteErrorKey = null;
  }

  async #deleteProduct(): Promise<void> {
    const product = this.deletingProduct;
    if (!product || this.busy) return;
    this.busy = true;
    this.#showError(null);
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
      this.#showReadError(error);
    } finally {
      this.busy = false;
    }
  }

  async #restoreProduct(productId: string): Promise<void> {
    if (this.busy || !this.#knows(productId)) return;
    this.busy = true;
    this.#showError(null);
    try {
      const value = await this.api.getProductEditor(productId);
      await this.api.updateProductEditor(productId, { ...value, active: true });
    } catch (error) {
      this.#showError(codeOf(error));
      this.refusedLists = extraListNames(error);
      this.busy = false;
      return;
    }
    try {
      await this.#reloadProducts();
    } catch (error) {
      this.#showReadError(error);
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
    this.#showError(null);
    this.editorFieldErrors = {};
    let written = false;
    try {
      let created: ProductEditorValue | null = null;
      if (this.editorValue === null)
        created = await this.api.createProductEditor(this.selectedCatalogueId, event.detail.value);
      else await this.api.updateProductEditor(this.editorValue.id, event.detail.value);
      written = true;
      this.#closeEditor();
      if (created) void this.#openPlacement(created);
      await this.#reloadProducts();
      if (created) {
        await this.updateComplete;
        await this.#browser()?.revealProduct(created.id);
      }
    } catch (error) {
      const fieldErrors = this.#rejectedField(error, event.detail.value);
      this.editorFieldErrors = fieldErrors;
      // A refusal that names a field is reported INSIDE the editor — beside that field when it has
      // one, which also opens the section the field is folded into, else in the message above Save.
      // Only a refusal with nothing to point at falls back to this screen's own banner, so the same
      // problem is never said twice.
      if (written) this.#showReadError(error);
      else this.#showError(Object.keys(fieldErrors).length ? null : codeOf(error));
      this.refusedLists = extraListNames(error);
    } finally {
      this.busy = false;
    }
  }

  async #openPlacement(product: { id: string; name: string }): Promise<void> {
    const placing = { id: product.id, name: product.name };
    this.placing = placing;
    this.placementMenus = null;
    this.placementLoadError = null;
    this.placementFailures = [];
    const menus = [...this.catalogues];
    try {
      await this.#placementQueries.watchGroup(
        "getMenuStructure",
        menus.map(({ id }) => [id]),
        (structures) => {
          if (this.placing === placing) this.placementMenus = placementMenus(menus, structures);
        },
      );
    } catch (error) {
      if (this.placing === placing) this.placementLoadError = codeMessage(codeOf(error));
    }
  }

  /** One request per section, so a section that refuses leaves the others' additions in place. */
  async #place(event: CustomEvent<{ sectionIds: string[] }>): Promise<void> {
    event.stopPropagation();
    const placing = this.placing;
    if (placing === null || this.placementBusy) return;
    this.placementBusy = true;
    this.placementFailures = [];
    const { sectionIds } = event.detail;
    const settled = await Promise.allSettled(
      sectionIds.map((sectionId) => this.api.addSectionProducts(sectionId, [placing.id])),
    );
    const failures = settled.flatMap((result, index): PlacementFailure[] =>
      result.status === "rejected"
        ? [{ sectionId: sectionIds[index]!, reason: codeMessage(codeOf(result.reason)) }]
        : [],
    );
    this.placementBusy = false;
    if (this.placing !== placing) return;
    if (failures.length) this.placementFailures = failures;
    else this.#closePlacement();
  }

  #browser() {
    return this.shadowRoot?.querySelector("dashboard-catalogue-browser") ?? null;
  }

  /** An add hands focus back to the ⋮ of the row it started from once its last window closes. */
  #refocusAdd(): void {
    const from = this.#addFrom;
    this.#addFrom = undefined;
    if (from !== undefined) this.#browser()?.focusRowMenu(from);
  }

  #closePlacement(): void {
    this.placing = null;
    this.placementMenus = null;
    this.placementLoadError = null;
    this.placementFailures = [];
    this.#placementQueries.release("getMenuStructure");
  }

  /**
   * A refusal carries the FIELD it is about, the LANGUAGE whose text is missing, or the id of a
   * choice that no longer exists; one that points at no field reaches the screen's banner.
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
    const name = missingChoiceField(code, error, submitted);
    return name === null ? {} : { [name]: codeMessage(code) };
  }

  /** Empty while nothing has been refused: the create controller clears its error whenever a form
   * opens or is cancelled. */
  #childRefusalErrors(): ChildRefusals {
    const error = this.#child.error ?? null;
    if (this.#childRefusals?.error === error) return this.#childRefusals.errors;
    const errors: ChildRefusals = { unit: {}, lists: {} };
    if (error !== null && this.#child.kind === "unit") errors.unit = unitRefusalErrors(error);
    if (error !== null && (this.#child.kind === "extras" || this.#child.kind === "options")) {
      // Keyed by the field path the server named, or `_form` when it names none.
      const params = (error as { params?: { field?: unknown } }).params ?? {};
      const field = typeof params.field === "string" ? params.field : "_form";
      errors.lists = { [field]: codeMessage(codeOf(error)) };
    }
    this.#childRefusals = { error, errors };
    return errors;
  }

  async #refreshRelated(kind: ProductChildKind): Promise<void> {
    if (kind === "unit") this.units = await this.api.background.listUnits();
    if (kind === "extras") this.extraLists = await this.api.background.listExtraLists();
    if (kind === "options") this.optionLists = await this.api.background.listOptionLists();
  }

  /** The window saves each change as it is made; closing waits for the last of them, then brings the
   * product's course in line. The editor is not reseeded, so the product's unsaved edits survive. */
  async #closeCourses(): Promise<void> {
    const generation = this.#editorGeneration;
    if (this.#child.kind !== "courses" || this.#closingCourses === generation) return;
    const list = this.shadowRoot!.querySelector<CourseList>("dashboard-course-list")!;
    this.#closingCourses = generation;
    await list.settled();
    if (this.#closingCourses === generation) this.#closingCourses = null;
    if (generation !== this.#editorGeneration) return;
    // A refused name stays on screen to be fixed, unless Escape has already shut the window.
    if (list.unsaved && this.#coursesWindow().open) return;
    const added = this.#addedCourse;
    this.#addedCourse = null;
    this.#child.cancel();
    try {
      this.courses = await this.api.background.listCourses();
    } catch (error) {
      this.#showReadError(error);
      return;
    }
    if (generation !== this.#editorGeneration) return;
    const editor = this.#editor()!;
    const exists = (id: string | null) => this.courses.some((course) => course.id === id);
    if (added !== null && exists(added)) editor.selectRelated("courses", added);
    else if (!exists(editor.currentValue.courseId)) editor.clearCourse();
  }

  /** Every submission is a new refusal, even one the API answers with an identical error object. */
  #submitChild(write: () => Promise<{ id: string }>): Promise<void> {
    this.#childRefusals = null;
    return this.#child.submit(write);
  }

  #submitUnit(event: CustomEvent<{ value: UnitInput }>): void {
    event.stopPropagation();
    void this.#submitChild(async () => {
      const value = await this.api.createUnit(event.detail.value);
      return { id: value.id, name: value.name };
    });
  }

  #submitExtraList(event: CustomEvent<{ value: ExtraListInput }>): void {
    event.stopPropagation();
    const editing = this.editingList?.kind === "extras" ? this.editingList.value : null;
    void this.#submitChild(async () =>
      editing
        ? await this.api.updateExtraList(editing.id, event.detail.value)
        : await this.api.createExtraList(event.detail.value),
    );
  }

  #submitOptionList(event: CustomEvent<{ value: OptionListInput }>): void {
    event.stopPropagation();
    const editing = this.editingList?.kind === "options" ? this.editingList.value : null;
    void this.#submitChild(async () =>
      editing
        ? await this.api.updateOptionList(editing.id, event.detail.value)
        : await this.api.createOptionList(event.detail.value),
    );
  }

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
   * Honoured only while a form of that KIND is the open one. A form that does not check its own
   * `open` sends a SECOND `wt-cancel` a task later (the closed `<dialog>`'s native `close`, which
   * `wt-dialog.ts` turns into `wt-close`), and by then a different form can be open. The same kind
   * reopened inside that task needs no check: `wt-dialog.ts` drops the late report for a dialog
   * that is open again.
   */
  #cancelChild(kind: ProductChildKind): void {
    if (this.#child.kind !== kind) return;
    this.editingList = null;
    this.#child.cancel();
  }

  override render() {
    const locales = this.contentLanguages?.languages ?? [];
    const refusals = this.#childRefusalErrors();
    return html`
      <div class="header">
        <h1>${t("nav.catalogue")}</h1>
      </div>
      ${
        this.catalogues.length
          ? html`<dashboard-catalogue-browser
              .api=${this.api}
              .categoryId=${this.categoryId}
              @open-category=${(event: CustomEvent<{ categoryId: string | null }>) => {
                event.stopPropagation();
                this.categoryId = event.detail.categoryId;
                this.#url.write({ category: this.categoryId }, true);
              }}
              .products=${this.products}
              .madeAt=${this.madeAt}
              .routing=${this.routing}
              .categories=${this.categories}
              .extraLists=${this.extraLists}
              .optionLists=${this.optionLists}
              .units=${this.units}
              .unitLanguage=${
                this.contentLanguages?.languages[0] ??
                this.contentLanguages?.defaultLanguage ??
                "en"
              }
              .canAddProduct=${locales.length > 0 && this.units.length > 0}
              .loaded=${this.productsLoaded}
              @add-product=${(event: CustomEvent<{ categoryId: string | null }>) => {
                event.stopPropagation();
                this.#addFrom = event.detail.categoryId;
                this.#openCreate(event.detail.categoryId);
              }}
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
            ></dashboard-catalogue-browser>`
          : html`<p data-test="no-catalogue">${t("catalogue.empty_prompt")}</p>`
      }
      ${
        this.errorKey
          ? html`<p class="error" role="alert">${refusalText(this.errorKey, this.refusedLists)}</p>`
          : nothing
      }
      <dashboard-product-editor
        @wt-close=${() => {
          if (!this.editorOpen && this.placing === null) this.#refocusAdd();
        }}
        .open=${this.editorOpen}
        .busy=${this.busy}
        .childOpen=${this.#child.kind !== null}
        .locales=${locales}
        .value=${this.editorValue}
        .newCategoryId=${this.newCategoryId}
        .fieldErrors=${this.editorFieldErrors}
        .units=${this.units}
        .categories=${this.categories}
        .extraLists=${this.extraLists}
        .optionLists=${this.optionLists}
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
      <dashboard-add-to-menus
        @wt-close=${() => this.#refocusAdd()}
        .open=${this.placing !== null}
        .busy=${this.placementBusy}
        productName=${this.placing?.name ?? ""}
        .menus=${this.placementMenus}
        .loadError=${this.placementLoadError}
        .failures=${this.placementFailures}
        @wt-submit=${(event: CustomEvent<{ sectionIds: string[] }>) => void this.#place(event)}
        @wt-cancel=${(event: Event) => {
          event.stopPropagation();
          if (!this.placementBusy) this.#closePlacement();
        }}
      ></dashboard-add-to-menus>
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
        <wt-form-actions
          slot="footer"
          .error=${this.deleteErrorKey ? codeMessage(this.deleteErrorKey) : ""}
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
      <wt-modal
        data-test="courses-dialog"
        .open=${this.#child.kind === "courses"}
        heading=${t("kitchen.courses_title")}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          void this.#closeCourses();
        }}
        @course-added=${(event: CustomEvent<{ id: string }>) => {
          event.stopPropagation();
          this.#addedCourse = event.detail.id;
        }}
      >
        ${
          this.#child.kind === "courses"
            ? html`<dashboard-course-list .api=${this.api}></dashboard-course-list>`
            : nothing
        }
        <wt-form-actions slot="footer"
          ><wt-button
            slot="cancel"
            data-test="courses-done"
            @click=${() => void this.#closeCourses()}
            >${t("action.done")}</wt-button
          ></wt-form-actions
        >
      </wt-modal>
      <dashboard-unit-form
        .open=${this.#child.kind === "unit"}
        .busy=${this.#child.busy}
        .locales=${locales}
        .fieldErrors=${refusals.unit}
        @wt-submit=${this.#submitUnit}
        @wt-cancel=${() => this.#cancelChild("unit")}
      ></dashboard-unit-form>
      ${
        // Both list forms carry translated name fields, so they wait for the content languages
        // rather than offering a field in a guessed language.
        this.contentLanguages
          ? html`<dashboard-extra-list-form
                .open=${this.#child.kind === "extras"}
                .busy=${this.#child.busy}
                .languages=${this.contentLanguages}
                .value=${this.editingList?.kind === "extras" ? (this.editingList.value as ExtraList) : null}
                .products=${this.products}
                .fieldErrors=${refusals.lists}
                @wt-submit=${this.#submitExtraList}
                @wt-cancel=${() => this.#cancelChild("extras")}
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
                .fieldErrors=${refusals.lists}
                @wt-submit=${this.#submitOptionList}
                @wt-cancel=${() => this.#cancelChild("options")}
              ></dashboard-option-list-form>`
          : nothing
      }
    `;
  }
}

/** The editor field that chose the id a not-found refusal names, or null when the save sent no such
 * id there. */
function missingChoiceField(
  code: string,
  error: unknown,
  submitted: ProductEditorInput,
): string | null {
  const params = (error as { params?: Record<string, unknown> }).params ?? {};
  const named = (key: string, sent: string | null | undefined) =>
    typeof params[key] === "string" && params[key] === sent;
  if (code === "category.not_found" && named("categoryId", submitted.primaryCategoryId))
    return "primary";
  if (code === "unit.not_found" && named("unitId", submitted.unitId)) return "unit";
  if (code === "course.not_found" && named("courseId", submitted.courseId)) return "product-course";
  if (code === "product.variant_not_found") {
    const index = submitted.variants.findIndex((variant) => named("variantId", variant.id));
    if (index !== -1) return `variant-${index}-name`;
  }
  return null;
}

interface ChildRefusals {
  unit: UnitFormErrors;
  lists: Record<string, string>;
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-catalogue-screen": CatalogueScreen;
  }
}
