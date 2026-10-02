import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
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
} from "../api/client.js";
import type { ModifierListChoice } from "./product-editor-model.js";
import {
  categoryAncestors,
  categoryPath,
  categoryRefusalErrors,
  categoryWithDescendants,
} from "./category-form.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-spinner.js";
import { acceptsCatalogueDrop } from "./product-list.js";
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
      .drop-target {
        background: var(--wt-color-surface-lifted);
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
      .views {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      wt-input {
        flex: 1 1 calc(var(--wt-tap-min) * 7);
        min-width: min(100%, calc(var(--wt-tap-min) * 7));
      }
      .breadcrumb {
        margin-block-end: var(--wt-space-3);
      }
      .breadcrumb ol {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-1);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .breadcrumb li {
        display: flex;
        align-items: center;
        gap: var(--wt-space-1);
        overflow-wrap: anywhere;
      }
      .breadcrumb [aria-current] {
        font-weight: var(--wt-font-weight-bold);
        padding-inline: var(--wt-space-2);
      }
      .sep {
        color: var(--wt-color-text-muted);
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
  @property({ attribute: false }) folderId: string | null = null;
  @property() view: "folders" | "all" = "folders";
  /** The screen's Add button, drawn under an empty list's sentence; not while a search is typed. */
  @property({ attribute: false }) emptyAction?: () => TemplateResult;
  @state() private search = "";
  @state() private folderForm: { value: CategorySummary | null } | null = null;
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
  #dragged: string[] = [];
  #dropTarget: HTMLElement | null = null;

  #clearDropTarget(): void {
    this.#dropTarget?.classList.remove("drop-target");
    this.#dropTarget = null;
  }
  #overCrumb(target: HTMLElement | null, folderId: string | null): void {
    this.#clearDropTarget();
    if (
      !target ||
      this.operationBusy ||
      this.summaryLoading ||
      !acceptsCatalogueDrop(this.#dragged, folderId, this.categories)
    )
      return;
    this.#dropTarget = target;
    this.#dropTarget.classList.add("drop-target");
  }
  async #drop(keys: string[], folderId: string | null): Promise<void> {
    this.#clearDropTarget();
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
  #dropCrumb(folderId: string | null): void {
    const keys = this.#dragged;
    this.#clearDropTarget();
    if (!acceptsCatalogueDrop(keys, folderId, this.categories)) return;
    this.#dragged = [];
    void this.#drop(keys, folderId);
  }

  override willUpdate(changed: PropertyValues): void {
    if (changed.has("folderId") || changed.has("view") || changed.has("search")) this.selected = [];
  }
  #selection(keys = this.selected): CatalogueSelection {
    return {
      productIds: keys.filter((key) => !key.startsWith("folder:")),
      categoryIds: keys.filter((key) => key.startsWith("folder:")).map((key) => key.slice(7)),
    };
  }
  #navigate(name: string, detail: unknown): void {
    this.selected = [];
    this.#emit(name, detail);
  }
  #openMove(): void {
    if (this.operationBusy || this.summaryLoading) return;
    this.summaryFailed = false;
    this.operationSelection = this.#selection();
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

  get #current(): string | null {
    return this.categories.some(({ id }) => id === this.folderId) ? this.folderId : null;
  }
  #visible() {
    const query = this.search.trim().toLocaleLowerCase(currentLocale());
    if (query) {
      const hit = (value: string) => value.toLocaleLowerCase(currentLocale()).includes(query);
      return {
        folders: this.categories.filter((category) => hit(categoryPath(category, this.categories))),
        products: this.products.filter((product) => {
          const category = this.categories.find(({ id }) => id === product.primaryCategoryId);
          return (
            hit(product.name) ||
            product.variants.some((variant) => hit(variant.name)) ||
            (category && hit(categoryPath(category, this.categories)))
          );
        }),
        showPath: true,
      };
    }
    if (this.view === "all") return { folders: [], products: this.products, showPath: true };
    return {
      folders: this.categories.filter(({ parentId }) => parentId === this.#current),
      products: this.products.filter(
        ({ primaryCategoryId }) => primaryCategoryId === this.#current,
      ),
      showPath: false,
    };
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
  #openForm(value: CategorySummary | null): void {
    this.formErrors = {};
    this.folderForm = { value };
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
  #breadcrumb() {
    const current = this.categories.find(({ id }) => id === this.#current);
    const crumbs = [
      { id: null, name: t("folders.all_products") },
      ...(current ? categoryAncestors(current, this.categories).reverse() : []),
    ];
    return html`<nav class="breadcrumb" aria-label=${t("folders.breadcrumb")}>
      <ol>
        ${crumbs.map(
          (crumb, index) =>
            html`<li data-crumb-drop=${crumb.id ?? ""}>
              ${index === crumbs.length - 1 ? html`<span aria-current="location">${crumb.name}</span>` : html`<wt-button variant="ghost" data-test=${`crumb-${index}`} @click=${() => this.#navigate("open-folder", { folderId: crumb.id })}>${crumb.name}</wt-button><span class="sep" aria-hidden="true">›</span>`}
            </li>`,
        )}
      </ol>
    </nav>`;
  }
  override render() {
    const visible = this.#visible();
    return html`${this.view === "folders" && !this.search.trim() ? this.#breadcrumb() : nothing}
      <div class="toolbar">
        ${!this.operation && (this.summaryLoading || this.operationBusy) ? html`<wt-spinner></wt-spinner>` : nothing}
        ${
          !this.selecting
            ? html`<div class="views">
                <wt-button
                  data-test="view-folders"
                  variant="secondary"
                  aria-pressed=${String(this.view === "folders")}
                  @click=${() => this.#navigate("view-change", { view: "folders" })}
                  >${t("folders.view_folders")}</wt-button
                >
                <wt-button
                  data-test="view-all"
                  variant="secondary"
                  aria-pressed=${String(this.view === "all")}
                  @click=${() => this.#navigate("view-change", { view: "all" })}
                  >${t("folders.view_all")}</wt-button
                >
              </div>`
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
        @pointer-drag-move=${(event: CustomEvent<{ path: EventTarget[] }>) => {
          event.stopPropagation();
          const target =
            event.detail.path.find(
              (item): item is HTMLElement =>
                item instanceof HTMLElement && item.matches("li[data-crumb-drop]"),
            ) ?? null;
          this.#overCrumb(target, target?.dataset.crumbDrop || null);
        }}
        @pointer-drag-end=${(event: CustomEvent<{ cancelled: boolean }>) => {
          event.stopPropagation();
          if (!event.detail.cancelled && this.#dropTarget)
            this.#dropCrumb(this.#dropTarget.dataset.crumbDrop || null);
          this.#clearDropTarget();
        }}
        @drag-items=${(event: CustomEvent<{ keys: string[] }>) => {
          event.stopPropagation();
          this.#dragged = event.detail.keys;
          this.#clearDropTarget();
        }}
        @drop-items=${(event: CustomEvent<{ keys: string[]; folderId: string }>) => {
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
        .folders=${visible.folders}
        .products=${visible.products}
        .madeAt=${this.madeAt}
        .unroutedFolderIds=${this.#unroutedFolderIds()}
        .showPath=${visible.showPath}
        .categories=${this.categories}
        .extraLists=${this.extraLists}
        .optionLists=${this.optionLists}
        .emptyAction=${this.search.trim() ? undefined : this.emptyAction}
        .emptyMessage=${this.search.trim() ? tableNoMatches() : t("catalogue.no_products")}
        @open-folder=${(event: CustomEvent<{ folderId: string }>) => {
          event.stopPropagation();
          this.#navigate("open-folder", event.detail);
        }}
        @rename-folder=${(event: CustomEvent<{ folderId: string }>) => {
          event.stopPropagation();
          const value = this.categories.find(({ id }) => id === event.detail.folderId);
          if (value) this.#openForm(value);
        }}
      ></dashboard-product-list>
      <dashboard-category-form
        .open=${this.folderForm !== null}
        .value=${this.folderForm?.value ?? null}
        .defaultParentId=${this.#current}
        .categories=${this.categories}
        .busy=${this.formBusy}
        .fieldErrors=${this.formErrors}
        @wt-submit=${(event: CustomEvent<{ value: CategoryInput }>) => void this.#save(event)}
        @wt-cancel=${(event: Event) => {
          event.stopPropagation();
          if (!this.formBusy) this.folderForm = null;
        }}
      ></dashboard-category-form
      >${this.#operationDialog()}${this.dropError ? html`<p class="error" role="alert">${this.dropError}</p>` : nothing}`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-catalogue-browser": CatalogueBrowser;
  }
}
