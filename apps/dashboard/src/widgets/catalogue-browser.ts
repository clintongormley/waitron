import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { chooseMaker, type RoutingModel } from "@waitron/venue-service/routing";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-button.js";
import type {
  CategoryInput,
  CategorySummary,
  CatalogueSelection,
  FolderContents,
  FolderSummary,
  DashboardApi,
  Product,
  MadeAt,
  Unit,
} from "../api/client.js";
import type { ModifierListChoice } from "./product-editor-model.js";
import { categoryPath, categoryRefusalErrors, categoryWithDescendants } from "./category-form.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-spinner.js";
import { acceptsCatalogueDrop, type ProductList } from "./product-list.js";
import "./category-form.js";

@customElement("dashboard-catalogue-browser")
export class CatalogueBrowser extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
        margin-block-end: var(--wt-space-4);
      }
      .action-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
      }
      fieldset {
        margin: var(--wt-space-4) 0;
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }
      .radio {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
      }
      input[type="radio"] {
        flex-shrink: 0;
        margin: 0;
        accent-color: var(--wt-color-primary);
      }
      .error {
        color: var(--wt-color-danger);
      }
      wt-input {
        flex: 1 1 calc(var(--wt-tap-min) * 7);
        min-width: min(100%, calc(var(--wt-tap-min) * 7));
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) products: Product[] = [];
  @property({ attribute: false }) madeAt: Record<string, MadeAt> = {};
  @property({ attribute: false }) routing: RoutingModel | null = null;
  @property({ attribute: false }) categories: CategorySummary[] = [];
  @property({ attribute: false }) extraLists: ModifierListChoice[] = [];
  @property({ attribute: false }) optionLists: ModifierListChoice[] = [];
  @property({ attribute: false }) units: readonly Unit[] = [];
  @property() unitLanguage = "en";
  /** The category the address names; the browser opens it, and every category above it, once. */
  @property({ attribute: false }) categoryId: string | null = null;
  @property({ type: Boolean }) canAddProduct = false;
  @state() private search = "";
  @state() private folderForm: { value: CategorySummary | null; parentId: string | null } | null =
    null;
  @state() private formBusy = false;
  @state() private formErrors: Record<string, string> = {};

  @state() private selecting = false;
  @state() private selected: string[] = [];
  @state() private operation: "move" | "delete" | null = null;
  @state() private operationSelection: CatalogueSelection = { productIds: [], categoryIds: [] };
  @state() private destination = "";
  @state() private contents: FolderContents = "move_up";
  @state() private summaries: FolderSummary[] = [];
  @state() private summaryLoading = false;
  @state() private summaryFailed = false;
  @state() private operationBusy = false;
  @state() private operationError = "";
  @state() private dropError = "";
  #revealed: string | null = null;

  async #drop(keys: string[], folderId: string | null): Promise<void> {
    if (
      this.operationBusy ||
      this.summaryLoading ||
      !acceptsCatalogueDrop(keys, folderId, this.categories)
    )
      return;
    this.operationBusy = true;
    this.dropError = "";
    try {
      await this.api.moveCatalogueItems(this.#selection(keys), folderId);
      this.selected = [];
    } catch (error) {
      this.dropError = codeMessage(codeOf(error));
    } finally {
      this.operationBusy = false;
    }
  }
  override willUpdate(changed: PropertyValues): void {
    if (changed.has("search")) this.selected = [];
  }

  override updated(changed: PropertyValues): void {
    if (!changed.has("categoryId") && !changed.has("categories")) return;
    const id = this.categoryId;
    if (
      id === null ||
      id === this.#revealed ||
      !this.categories.some((category) => category.id === id)
    )
      return;
    this.#revealed = id;
    void this.#list()?.revealCategory(id);
  }

  #list(): ProductList | null {
    return this.shadowRoot?.querySelector("dashboard-product-list") ?? null;
  }

  /** Opens every category above a product, once the browser has drawn the list that holds it. */
  async revealProduct(id: string): Promise<void> {
    await this.updateComplete;
    await this.#list()?.revealProduct(id);
  }

  focusRowMenu(categoryId: string | null): void {
    this.#list()?.focusRowMenu(categoryId);
  }

  /** The address follows the category a person opens; closing it, or one above it, names its parent. */
  #categoryToggled(event: CustomEvent<{ categoryId: string; open: boolean }>): void {
    event.stopPropagation();
    const { categoryId, open } = event.detail;
    if (open) {
      this.#revealed = categoryId;
      this.#emit("open-category", { categoryId });
      return;
    }
    if (
      this.categoryId === null ||
      !categoryWithDescendants(categoryId, this.categories).has(this.categoryId)
    )
      return;
    const parentId = this.categories.find(({ id }) => id === categoryId)?.parentId ?? null;
    this.#revealed = parentId;
    this.#emit("open-category", { categoryId: parentId });
  }

  /** The category the address names, while it exists; New folder creates inside it. */
  #addressed(): string | null {
    return this.categories.some(({ id }) => id === this.categoryId) ? this.categoryId : null;
  }
  #selection(keys = this.selected): CatalogueSelection {
    return {
      productIds: keys.filter((key) => !key.startsWith("folder:")),
      categoryIds: keys.filter((key) => key.startsWith("folder:")).map((key) => key.slice(7)),
    };
  }
  #openMove(keys = this.selected): void {
    if (this.operationBusy || this.summaryLoading) return;
    this.summaryFailed = false;
    this.operationSelection = this.#selection(keys);
    this.destination = "";
    this.operationError = "";
    this.operation = "move";
  }
  async #openDelete(keys = this.selected): Promise<void> {
    if (this.operationBusy || this.summaryLoading) return;
    const selection = this.#selection(keys);
    this.operationSelection = selection;
    this.contents = "move_up";
    this.summaries = [];
    this.summaryFailed = false;
    this.operationError = "";
    this.operation = selection.productIds.length ? "delete" : null;
    if (!selection.categoryIds.length) return;
    this.summaryLoading = true;
    try {
      const summaries = await this.api.summariseFolders(selection.categoryIds);
      if (selection.categoryIds.some((id) => !summaries.some((summary) => summary.id === id)))
        throw new Error("incomplete summary");
      this.summaries = selection.categoryIds.map((id) =>
        summaries.find((summary) => summary.id === id)!,
      );
      if (
        !selection.productIds.length &&
        this.summaries.every((summary) => summary.folders === 0 && summary.products === 0)
      ) {
        this.summaryLoading = false;
        await this.#confirm("delete");
      } else this.operation = "delete";
    } catch {
      this.operation = "delete";
      this.summaryFailed = true;
      this.operationError = t("folders.summary_error");
    } finally {
      this.summaryLoading = false;
    }
  }
  async #confirm(operation = this.operation): Promise<void> {
    if (
      this.operationBusy ||
      this.summaryLoading ||
      this.summaryFailed ||
      !operation ||
      (operation === "move" && !this.destination)
    )
      return;
    this.operationBusy = true;
    this.operationError = "";
    try {
      if (operation === "move")
        await this.api.moveCatalogueItems(
          this.operationSelection,
          this.destination === "top" ? null : this.destination,
        );
      else await this.api.deleteCatalogueItems(this.operationSelection, this.contents);
      this.operation = null;
      this.selected = [];
    } catch (error) {
      this.operation = operation;
      this.operationError = codeMessage(codeOf(error));
    } finally {
      this.operationBusy = false;
    }
  }
  #plural(key: Parameters<typeof t>[0], count: number): string {
    return t(count === 1 ? (`${key}_one` as Parameters<typeof t>[0]) : key).replace(
      "{count}",
      String(count),
    );
  }
  #operationDialog() {
    if (!this.operation) return nothing;
    const selection = this.operationSelection;
    const count = selection.productIds.length + selection.categoryIds.length;
    const excluded = new Set(
      selection.categoryIds.flatMap((id) => [...categoryWithDescendants(id, this.categories)]),
    );
    const destinations = [
      { value: "top", label: t("folders.top_level") },
      ...this.categories
        .filter((category) => !excluded.has(category.id))
        .map((category) => ({
          value: category.id,
          label: categoryPath(category, this.categories),
        })),
    ];
    const rootSummaries = this.summaries.filter(
      (summary) =>
        !selection.categoryIds.some(
          (id) => id !== summary.id && categoryWithDescendants(id, this.categories).has(summary.id),
        ),
    );
    const totals = rootSummaries.reduce(
      (sum, summary) => ({
        folders: sum.folders + summary.folders,
        products: sum.products + summary.products,
        routes: sum.routes + summary.routes,
      }),
      { folders: 0, products: 0, routes: 0 },
    );
    const heading = this.#plural(
      this.operation === "move"
        ? "folders.move_heading"
        : selection.categoryIds.length
          ? "folders.delete_heading"
          : "folders.delete_products_heading",
      count,
    );
    return html`<wt-modal
      .open=${true}
      .heading=${heading}
      .dismissible=${!this.operationBusy && !this.summaryLoading}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (!this.operationBusy && !this.summaryLoading) this.operation = null;
      }}
    >
      <form
        @submit=${(event: Event) => {
          event.preventDefault();
          void this.#confirm();
        }}
      >
        ${
          this.operation === "move"
            ? html`<wt-combobox
                name="destination"
                required
                label=${t("folders.destination")}
                .options=${destinations}
                .value=${this.destination}
                .disabled=${this.operationBusy}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  this.destination = event.detail.value;
                }}
              ></wt-combobox>`
            : html`
                ${selection.productIds.length ? html`<p>${selection.productIds.length === 1 ? t("product.delete_warning") : t("folders.delete_products_body")}</p>` : nothing}
                ${this.summaryLoading ? html`<wt-spinner></wt-spinner>` : nothing}
                ${
                  selection.categoryIds.length && !this.summaryLoading && !this.summaryFailed
                    ? html`<fieldset .disabled=${this.operationBusy}>
                          <legend>${t("folders.contents_question")} *</legend>
                          <label class="radio"
                            ><input
                              type="radio"
                              name="contents"
                              required
                              value="move_up"
                              .checked=${this.contents === "move_up"}
                              @change=${() => (this.contents = "move_up")}
                            />${t("folders.contents_move_up")}</label
                          >
                          <label class="radio"
                            ><input
                              type="radio"
                              name="contents"
                              required
                              value="delete"
                              .checked=${this.contents === "delete"}
                              @change=${() => (this.contents = "delete")}
                            />${t("folders.contents_delete").replace("{categories}", this.#plural("folders.count", totals.folders)).replace("{products}", this.#plural("folders.product_count", totals.products))}</label
                          >
                        </fieldset>
                        ${totals.routes ? html`<p>${this.#plural("folders.routes_warning", totals.routes)}</p>` : nothing}`
                    : nothing
                }
              `
        }
        ${this.operationError ? html`<p role="alert" class="error">${this.operationError}</p>` : nothing}
      </form>
      <wt-form-actions slot="footer">
        <wt-button
          slot="cancel"
          variant="secondary"
          .disabled=${this.operationBusy || this.summaryLoading}
          @click=${() => (this.operation = null)}
          >${t("folders.cancel_selection")}</wt-button
        >
        <wt-button
          data-test="confirm"
          variant=${this.operation === "delete" ? "danger" : "primary"}
          .loading=${this.operationBusy}
          .disabled=${this.operationBusy || this.summaryLoading || this.summaryFailed || (this.operation === "move" && !this.destination)}
          @click=${() => void this.#confirm()}
          >${t(this.operation === "delete" ? "action.delete" : "folders.move")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }

  #unroutedFolderIds(): string[] {
    if (!this.routing) return [];
    const rules = {
      // A folder is covered only by rules that apply to every dish in every service zone.
      exceptions: this.routing.exceptions.filter(
        ({ zoneId, productId }) => zoneId === null && productId === null,
      ),
      claims: new Map(this.routing.claims.map(({ categoryId, target }) => [categoryId, target])),
      parentOf: new Map(this.categories.map(({ id, parentId }) => [id, parentId])),
      activeStationIds: new Set(
        this.routing.stations.filter(({ active }) => active).map(({ id }) => id),
      ),
      defaultStationId: null,
      timing: new Map(),
    };
    return this.categories
      .filter(
        ({ id }) =>
          chooseMaker(rules, { productId: "", routedProductId: "", categoryId: id }, null, null)
            .route === null,
      )
      .map(({ id }) => id);
  }
  #emit(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  #openForm(
    value: CategorySummary | null,
    parentId = value ? value.parentId : this.#addressed(),
  ): void {
    this.formErrors = {};
    this.folderForm = { value, parentId };
  }
  async #save(event: CustomEvent<{ value: CategoryInput }>): Promise<void> {
    event.stopPropagation();
    if (this.formBusy || !this.folderForm) return;
    this.formBusy = true;
    this.formErrors = {};
    try {
      const value = event.detail.value;
      if (this.folderForm.value) await this.api.updateCategory(this.folderForm.value.id, value);
      else await this.api.createCategory(value);
      this.folderForm = null;
    } catch (error) {
      this.formErrors = categoryRefusalErrors(error, event.detail.value.parentId);
    } finally {
      this.formBusy = false;
    }
  }
  override render() {
    return html`<div class="toolbar">
        ${
          !this.operation && (this.summaryLoading || this.operationBusy)
            ? html`<wt-spinner></wt-spinner>`
            : nothing
        }
        <wt-input
          name="catalogue-search"
          type="search"
          label=${t("folders.search")}
          .value=${this.search}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.search = event.detail.value;
          }}
        ></wt-input>
        ${
          this.selecting
            ? html`<div class="action-bar">
                <span data-test="selected-count" aria-live="polite"
                  >${this.#plural("folders.selected", this.selected.length)}</span
                >
                <wt-button
                  data-test="move"
                  variant="secondary"
                  .disabled=${!this.selected.length || this.summaryLoading || this.operationBusy}
                  @click=${() => this.#openMove()}
                  >${t("folders.move")}</wt-button
                >
                <wt-button
                  data-test="delete"
                  variant="danger"
                  .disabled=${!this.selected.length || this.summaryLoading || this.operationBusy}
                  @click=${() => void this.#openDelete()}
                  >${t("action.delete")}</wt-button
                >
                <wt-button
                  data-test="cancel-selection"
                  variant="secondary"
                  @click=${() => {
                    this.selected = [];
                    this.selecting = false;
                  }}
                  >${t("folders.cancel_selection")}</wt-button
                >
              </div>`
            : html`<wt-button
                  data-test="select"
                  variant="secondary"
                  @click=${() => (this.selecting = true)}
                  >${t("folders.select")}</wt-button
                >
                <wt-button data-test="new-folder" @click=${() => this.#openForm(null)}
                  >${t("folders.new")}</wt-button
                >`
        }
      </div>
      <dashboard-product-list
        @drop-items=${(event: CustomEvent<{ keys: string[]; folderId: string | null }>) => {
          event.stopPropagation();
          void this.#drop(event.detail.keys, event.detail.folderId);
        }}
        .selecting=${this.selecting}
        .selected=${this.selected}
        @wt-selection-change=${(event: CustomEvent<{ selected: string[] }>) => {
          event.stopPropagation();
          this.selected = event.detail.selected;
        }}
        @wt-filter-change=${(event: Event) => {
          event.stopPropagation();
          this.selected = [];
        }}
        @delete-folder=${(event: CustomEvent<{ folderId: string }>) => {
          event.stopPropagation();
          void this.#openDelete([`folder:${event.detail.folderId}`]);
        }}
        @category-toggle=${this.#categoryToggled}
        .canAddProduct=${this.canAddProduct}
        @move-folder=${(event: CustomEvent<{ folderId: string }>) => {
          event.stopPropagation();
          this.#openMove([`folder:${event.detail.folderId}`]);
        }}
        @add-category=${(event: CustomEvent<{ parentId: string | null }>) => {
          event.stopPropagation();
          this.#openForm(null, event.detail.parentId);
        }}
        .categories=${this.categories}
        .products=${this.products}
        .search=${this.search}
        .madeAt=${this.madeAt}
        .unroutedFolderIds=${this.#unroutedFolderIds()}
        .extraLists=${this.extraLists}
        .optionLists=${this.optionLists}
        .units=${this.units}
        .unitLanguage=${this.unitLanguage}
        @rename-folder=${(event: CustomEvent<{ folderId: string }>) => {
          event.stopPropagation();
          const value = this.categories.find(({ id }) => id === event.detail.folderId);
          if (value) this.#openForm(value);
        }}
      ></dashboard-product-list>
      <dashboard-category-form
        .open=${this.folderForm !== null}
        .value=${this.folderForm?.value ?? null}
        .defaultParentId=${this.folderForm?.parentId ?? null}
        .categories=${this.categories}
        .busy=${this.formBusy}
        .fieldErrors=${this.formErrors}
        @wt-submit=${(event: CustomEvent<{ value: CategoryInput }>) => void this.#save(event)}
        @wt-cancel=${(event: Event) => {
          event.stopPropagation();
          if (!this.formBusy) this.folderForm = null;
        }}
      ></dashboard-category-form
      >${this.#operationDialog()}${
        this.dropError ? html`<p class="error" role="alert">${this.dropError}</p>` : nothing
      }`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-catalogue-browser": CatalogueBrowser;
  }
}
