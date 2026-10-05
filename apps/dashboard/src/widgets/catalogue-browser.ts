import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, iconButtonStyles, trackIconTooltip } from "@waitron/ui";
import { chooseMaker, type RoutingModel } from "@waitron/venue-service/routing";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-icon.js";
import type {
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
import {
  byLabel,
  categoryPath,
  categoryRefusalErrors,
  categoryWithDescendants,
} from "./category-form.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-spinner.js";
import { acceptsCatalogueDrop, type CategoryNameDraft, type ProductList } from "./product-list.js";
import { folderMadeAt, type FolderMadeAt } from "./folder-made-at.js";

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
      :host([sticky-header]) {
        display: flex;
        flex: 1 1 0;
        flex-direction: column;
      }
      /* Its controls wrap one by one with the table's own, rather than as one block on a line of
         its own. */
      .actions {
        display: contents;
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
      .deleting {
        overflow-wrap: anywhere;
      }
      wt-input {
        flex: 1 1 calc(var(--wt-tap-min) * 7);
        min-width: min(100%, calc(var(--wt-tap-min) * 7));
      }
      /* On a phone the search cannot share a line with the leading buttons, so it takes the line
         under them and the table's own buttons join them; Tab still reaches it before those. */
      @media (max-width: 30rem) {
        wt-input {
          order: 1;
        }
      }
    `,
    iconButtonStyles,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) products: Product[] = [];
  @property({ attribute: false }) madeAt: Record<string, MadeAt> = {};
  @property({ attribute: false }) routing: RoutingModel | null = null;
  /** Whether the routing read failed, as against not having answered yet. */
  @property({ type: Boolean }) routingFailed = false;
  @property({ attribute: false }) categories: CategorySummary[] = [];
  @property({ attribute: false }) extraLists: ModifierListChoice[] = [];
  @property({ attribute: false }) optionLists: ModifierListChoice[] = [];
  @property({ attribute: false }) units: readonly Unit[] = [];
  @property() unitLanguage = "en";
  /** The category the address names; the browser opens it, and every category above it, once. */
  @property({ attribute: false }) categoryId: string | null = null;
  @property({ type: Boolean }) canAddProduct = false;
  /** Fills a bounded flex column, with the Products table's rows scrolling under its headings. */
  @property({ type: Boolean, reflect: true, attribute: "sticky-header" }) stickyHeader = false;
  @property({ type: Boolean }) loaded = false;
  @state() private search = "";
  @state() private nameDraft: CategoryNameDraft | null = null;
  @state() private nameError = "";

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
  #folderMadeAt: ReadonlyMap<string, FolderMadeAt> = new Map();

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
      await this.api.moveCatalogueItems(this.#outermost(this.#selection(keys)), folderId);
      this.selected = this.selected.filter((key) => !keys.includes(key));
    } catch (error) {
      this.dropError = codeMessage(codeOf(error));
    } finally {
      this.operationBusy = false;
    }
  }
  override willUpdate(changed: PropertyValues): void {
    if (changed.has("search")) this.selected = [];
    // Worked out once per change of its inputs, not on every redraw of the browser.
    if (changed.has("routing") || changed.has("categories") || changed.has("products"))
      this.#folderMadeAt = this.routing
        ? folderMadeAt(this.routing, this.categories, this.products)
        : new Map();
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

  #selection(keys = this.selected): CatalogueSelection {
    return {
      productIds: keys.filter((key) => !key.startsWith("folder:")),
      categoryIds: keys.filter((key) => key.startsWith("folder:")).map((key) => key.slice(7)),
    };
  }
  /** A row inside a category that moves goes with it; listed as well, the server would re-file it
   * at the destination and pull it out of its category. */
  #outermost(selection: CatalogueSelection): CatalogueSelection {
    const under = (categoryId: string | null, self?: string) =>
      categoryId !== null &&
      selection.categoryIds.some(
        (id) => id !== self && categoryWithDescendants(id, this.categories).has(categoryId),
      );
    return {
      productIds: selection.productIds.filter(
        (id) =>
          !under(this.products.find((product) => product.id === id)?.primaryCategoryId ?? null),
      ),
      categoryIds: selection.categoryIds.filter((id) => !under(id, id)),
    };
  }
  #openMove(keys = this.selected): void {
    if (this.operationBusy || this.summaryLoading) return;
    this.summaryFailed = false;
    this.operationSelection = this.#outermost(this.#selection(keys));
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
  /** A confirmation from the dialog reads its counts again before deleting. */
  async #confirm(operation = this.operation, fromDialog = false): Promise<void> {
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
      else {
        if (fromDialog && this.operationSelection.categoryIds.length && !(await this.#unchanged()))
          return;
        try {
          await this.api.deleteCatalogueItems(
            this.operationSelection,
            this.contents,
            this.summaries.map(({ id, folders, activeProducts, routes, ownRoutes }) => ({
              id,
              folders,
              activeProducts,
              routes,
              ownRoutes,
            })),
          );
        } catch (error) {
          if (codeOf(error, "") !== "category.contents_changed") throw error;
          this.operation = operation;
          const fresh = await this.#readAgain();
          if (fresh) {
            this.summaries = fresh;
            this.operationError = codeMessage("category.contents_changed");
          }
          return;
        }
      }
      this.operation = null;
      this.selected = [];
    } catch (error) {
      this.operation = operation;
      this.operationError = codeMessage(codeOf(error));
    } finally {
      this.operationBusy = false;
    }
  }
  /** The selected categories' contents read again; when they cannot be read, says so and answers
   * null, leaving Delete to try again. A refusal carrying a code is left to the caller. */
  async #readAgain(): Promise<FolderSummary[] | null> {
    const ids = this.operationSelection.categoryIds;
    let read: unknown;
    try {
      read = await this.api.summariseFolders(ids);
    } catch (error) {
      if (codeOf(error, "") !== "") throw error;
    }
    const list: FolderSummary[] = Array.isArray(read) ? read : [];
    const fresh = ids.map((id) => list.find((summary) => summary.id === id));
    if (fresh.some((summary) => summary === undefined)) {
      this.operationError = t("folders.summary_error");
      return null;
    }
    return fresh as FolderSummary[];
  }
  /** When what the dialog showed has changed, shows the new counts instead. */
  async #unchanged(): Promise<boolean> {
    const fresh = await this.#readAgain();
    if (!fresh) return false;
    const same = fresh.every((summary, index) => {
      const shown = this.summaries[index];
      return (
        shown !== undefined &&
        summary.folders === shown.folders &&
        summary.activeProducts === shown.activeProducts &&
        summary.routes === shown.routes &&
        summary.ownRoutes === shown.ownRoutes
      );
    });
    if (same) return true;
    this.summaries = fresh;
    this.operationError = t("folders.summary_changed");
    return false;
  }
  #plural(key: Parameters<typeof t>[0], count: number): string {
    return t(count === 1 ? (`${key}_one` as Parameters<typeof t>[0]) : key).replace(
      "{count}",
      String(count),
    );
  }
  /** Each category's path, numbered where others share it in the order the list draws them: depth
   * first, with siblings in `categories` order, which is how the table breaks a tie in its sort. */
  #namedPaths(ids: readonly string[]): string[] {
    const known = new Set(this.categories.map(({ id }) => id));
    const children = new Map<string | null, CategorySummary[]>();
    for (const category of this.categories) {
      const parent =
        category.parentId !== null && known.has(category.parentId) ? category.parentId : null;
      (children.get(parent) ?? children.set(parent, []).get(parent)!).push(category);
    }
    const sharing = new Map<string, string[]>();
    const pathOf = new Map<string, string>();
    const walk = (parentId: string | null): void => {
      for (const category of children.get(parentId) ?? []) {
        if (pathOf.has(category.id)) continue;
        const path = categoryPath(category, this.categories);
        pathOf.set(category.id, path);
        (sharing.get(path) ?? sharing.set(path, []).get(path)!).push(category.id);
        walk(category.id);
      }
    };
    walk(null);
    return ids.map((id) => {
      const path = pathOf.get(id) ?? "";
      const same = sharing.get(path) ?? [];
      if (same.length < 2) return path;
      const values: Record<string, string> = {
        path,
        position: String(same.indexOf(id) + 1),
        total: String(same.length),
      };
      // One pass with a function replacement: a `$&` or `{total}` in a name stays literal.
      return t("folders.path_ordinal").replace(
        /\{(\w+)\}/g,
        (whole, name: string) => values[name] ?? whole,
      );
    });
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
        }))
        .sort((a, b) => byLabel(a.label, b.label)),
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
        products: sum.products + summary.activeProducts,
        routes: sum.routes + summary.routes,
      }),
      { folders: 0, products: 0, routes: 0 },
    );
    // Moving contents up removes only the selected categories themselves, each with its own rules.
    const routesRemoved =
      this.contents === "move_up"
        ? this.summaries.reduce((sum, summary) => sum + summary.ownRoutes, 0)
        : totals.routes;
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
          void this.#confirm(this.operation, true);
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
                ${
                  selection.categoryIds.length
                    ? html`<p>${t("folders.deleting")}</p>
                        <ul class="deleting" data-test="deleting">
                          ${this.#namedPaths(selection.categoryIds).map((name) => html`<li>${name}</li>`)}
                        </ul>`
                    : nothing
                }
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
                        ${routesRemoved ? html`<p>${this.#plural("folders.routes_warning", routesRemoved)}</p>` : nothing}`
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
          @click=${() => void this.#confirm(this.operation, true)}
          >${t(this.operation === "delete" ? "action.delete" : "folders.move")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }

  #unroutedFolderIds(): string[] {
    if (!this.routing) return [];
    const rules = {
      // A category is covered only by rules that apply to every dish in every service zone.
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
  async #saveName(event: CustomEvent<{ name: string }>): Promise<void> {
    event.stopPropagation();
    // A box sends its name once until refused, so saves run alongside each other, and each answer
    // reaches its own box only while that box is still open.
    const draft = this.nameDraft;
    if (!draft) return;
    this.nameError = "";
    const parentId = draft.kind === "create" ? draft.parentId : null;
    try {
      if (draft.kind === "create")
        await this.api.createCategory({ name: event.detail.name, parentId });
      else await this.api.updateCategory(draft.categoryId, { name: event.detail.name });
      if (this.nameDraft === draft) this.nameDraft = null;
    } catch (error) {
      const message = Object.values(categoryRefusalErrors(error, parentId))[0]!;
      if (this.nameDraft === draft) this.nameError = message;
      else this.dropError = message;
    }
  }
  override render() {
    return html`<dashboard-product-list
        @drop-items=${(event: CustomEvent<{ keys: string[]; folderId: string | null }>) => {
          event.stopPropagation();
          void this.#drop(event.detail.keys, event.detail.folderId);
        }}
        .stickyHeader=${this.stickyHeader}
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
        .nameDraft=${this.nameDraft}
        .nameError=${this.nameError}
        .loaded=${this.loaded}
        @add-category=${(event: CustomEvent<{ parentId: string | null }>) => {
          event.stopPropagation();
          this.search = "";
          this.nameError = "";
          this.nameDraft = { kind: "create", parentId: event.detail.parentId };
        }}
        .categories=${this.categories}
        .products=${this.products}
        .search=${this.search}
        .madeAt=${this.madeAt}
        .unroutedFolderIds=${this.#unroutedFolderIds()}
        .folderMadeAt=${this.#folderMadeAt}
        .routingFailed=${this.routingFailed}
        .extraLists=${this.extraLists}
        .optionLists=${this.optionLists}
        .units=${this.units}
        .unitLanguage=${this.unitLanguage}
        @rename-folder=${(event: CustomEvent<{ folderId: string }>) => {
          event.stopPropagation();
          this.nameError = "";
          this.nameDraft = { kind: "rename", categoryId: event.detail.folderId };
        }}
        @name-commit=${(event: CustomEvent<{ name: string }>) => void this.#saveName(event)}
        @name-cancel=${(event: Event) => {
          event.stopPropagation();
          this.nameDraft = null;
          this.nameError = "";
        }}
      >
        <!-- A native button: wt-button does not pass aria-pressed to its inner button. -->
        <button
          type="button"
          slot="toolbar-start"
          class="icon-button"
          data-test="select"
          aria-label=${t("folders.select")}
          aria-pressed=${String(this.selecting)}
          @click=${() => {
            this.selected = [];
            this.selecting = !this.selecting;
          }}
          @pointerenter=${trackIconTooltip}
          @pointerleave=${trackIconTooltip}
          @focus=${trackIconTooltip}
          @blur=${trackIconTooltip}
        >
          <wt-icon name="select-rows"></wt-icon
          ><span class="icon-tooltip" aria-hidden="true">${t("folders.select")}</span>
        </button>
        <wt-input
          slot="toolbar-start"
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
          this.selecting || this.summaryLoading || this.operationBusy
            ? html`<div slot="toolbar-end" class="actions">
                ${
                  !this.operation && (this.summaryLoading || this.operationBusy)
                    ? html`<wt-spinner></wt-spinner>`
                    : nothing
                }
                ${
                  this.selecting
                    ? html`<span data-test="selected-count" aria-live="polite"
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
                        >`
                    : nothing
                }
              </div>`
            : nothing
        }
      </dashboard-product-list>
      ${this.#operationDialog()}${
        this.dropError ? html`<p class="error" role="alert">${this.dropError}</p>` : nothing
      }`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-catalogue-browser": CatalogueBrowser;
  }
}
