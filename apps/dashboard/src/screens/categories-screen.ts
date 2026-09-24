import { LocaleChangeController } from "../state/locale-controller.js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import {
  baseStyles,
  isHexColor,
  selectStyles,
  setContentLanguages,
  type DataTableColumn,
} from "@waitron/ui";
import { resolveEnabledContentText, type ContentLanguages } from "@waitron/shared";
import { DashboardQueries } from "../api/query-controller.js";
import type {
  CategoryDependants,
  CategoryInput,
  CategorySummary,
  DashboardApi,
  Product,
  ProductCategories,
} from "../api/client.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeOf, codeMessage } from "../i18n/codes.js";
import { categoryPath } from "../widgets/category-form.js";
import "../widgets/category-membership-picker.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-spinner.js";
import "@waitron/ui/src/components/wt-lozenge.js";

const MODE_KEY = "waitron.categories.mode";
const OTHER_CATEGORIES_PREVIEW_LIMIT = 3;
type ViewMode = "tree" | "flat";

@customElement("dashboard-categories-screen")
export class CategoriesScreen extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }
      .heading {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
      }
      h1,
      h2 {
        margin: var(--wt-space-4) 0;
      }
      .header-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        align-items: center;
      }
      .mode-toggle {
        display: flex;
        gap: var(--wt-space-2);
      }
      .error {
        color: var(--wt-color-danger);
      }
      a {
        color: var(--wt-color-primary);
      }
      /* The name column's markup is built here but handed to <wt-data-table> as a cell callback, so
         the nodes are parented in THAT element's shadow root, not this screen's. A class selector in
         this stylesheet can never reach them; a part= attribute on the markup plus ::part() here
         crosses exactly that one boundary — the pattern printers-screen.ts uses for its cell markup. */
      wt-data-table::part(thumbnail),
      wt-data-table::part(thumbnail-placeholder) {
        width: var(--wt-tap-min);
        height: var(--wt-tap-min);
        flex: none;
      }
      wt-data-table::part(thumbnail) {
        object-fit: cover;
        border-radius: var(--wt-radius-sm);
      }
      wt-data-table::part(name-cell) {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-2);
      }
      wt-data-table::part(swatch) {
        width: var(--wt-space-4);
        height: var(--wt-space-4);
        flex: none;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
      }
      wt-data-table::part(swatch-none) {
        background: transparent;
      }
      wt-data-table::part(name) {
        overflow-wrap: anywhere;
        text-align: start;
      }
      /* The products modal's "no other categories" dash, also cell markup handed to a table. */
      wt-data-table::part(muted) {
        color: var(--wt-color-text-muted);
      }
      /* Marks a tree-mode ancestor kept only to show a matching descendant's path — the table
         reports it through the cell's ancestorOnly context. The colour has to reach the <button> inside wt-button's OWN
         shadow root, which is one boundary further than ::part() can select. Re-pointing the token
         that wt-button's ghost variant reads for its colour (--wt-color-text) on the host does it,
         because a custom property set on an element is inherited by its shadow tree. Scoped to this
         one button instance, so no other element's text colour moves. */
      wt-data-table::part(name-muted) {
        --wt-color-text: var(--wt-color-text-muted);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @state() private categories: CategorySummary[] = [];
  @state() private products: Product[] = [];
  @state() private languages: ContentLanguages = { defaultLanguage: "en", languages: ["en"] };
  @state() private loading = true;
  @state() private loadError = false;
  @state() private saveError = "";
  @state() private fieldErrors: Record<string, string> = {};
  @state() private mode: ViewMode = this.#readMode();
  @state() private selected: string | null = null;
  @state() private addingProducts = false;
  @state() private picked = new Set<string>();
  @state() private editorOpen = false;
  @state() private edited: CategorySummary | null = null;
  @state() private deleting: CategorySummary | null = null;
  @state() private dependants: CategoryDependants | null = null;
  /** The preview fetch failed. Distinct from `dependants === null` (still loading) and from a
   * loaded object whose lists are all empty (genuinely nothing depends on this category). */
  @state() private dependantsError = false;
  @state() private membershipOpen = false;
  @state() private memberProduct: Product | null = null;
  @state() private membership: ProductCategories = { categoryIds: [], primaryCategoryId: null };
  @state() private busy = false;
  #queries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.loadError = true;
    },
  );
  protected override updated(changes: PropertyValues<this>) {
    if (changes.has("api") && this.api) void this.#load();
  }
  #readMode(): ViewMode {
    try {
      return localStorage.getItem(MODE_KEY) === "flat" ? "flat" : "tree";
    } catch {
      return "tree";
    }
  }
  #setMode(mode: ViewMode): void {
    this.mode = mode;
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // The remembered view is a convenience; browsing without storage still works.
    }
  }
  async #load(): Promise<void> {
    this.loadError = false;
    try {
      await Promise.all([
        this.#queries.watch("getContentLanguages", [], (value) => {
          this.languages = value;
          setContentLanguages(value);
        }),
        this.#queries.watch("listCategories", [], (value) => {
          this.categories = value;
        }),
        this.#queries.watch("listLibraryProducts", [], (value) => {
          this.products = value;
        }),
      ]);
      // A `?category=<id>` deep link opens the editor; an unknown id is ignored. Clearing the param
      // stops a refresh reopening the editor.
      const linked = new URL(location.href).searchParams.get("category");
      const category = linked ? this.categories.find((item) => item.id === linked) : undefined;
      if (category) {
        this.#edit(category);
        const url = new URL(location.href);
        url.searchParams.delete("category");
        history.replaceState(null, "", url);
      }
    } catch {
      this.loadError = true;
    } finally {
      this.loading = false;
    }
  }
  #text(name: Record<string, string>): string {
    return resolveEnabledContentText(name, currentLocale(), this.languages);
  }
  #error(error: unknown): string {
    return codeMessage(codeOf(error));
  }
  #edit(value: CategorySummary | null): void {
    this.edited = value;
    this.fieldErrors = {};
    this.saveError = "";
    this.editorOpen = true;
  }
  async #save(event: CustomEvent<{ value: CategoryInput }>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return;
    this.fieldErrors = {};
    this.busy = true;
    this.saveError = "";
    try {
      if (this.edited) await this.api.updateCategory(this.edited.id, event.detail.value);
      else await this.api.createCategory(event.detail.value);
      this.editorOpen = false;
    } catch (error) {
      this.saveError = this.#error(error);
      const code = codeOf(error);
      const language = (error as { params?: { language?: string } } | null)?.params?.language;
      const field =
        code === "category.parent_cycle"
          ? "parent"
          : code === "category.image_not_found"
            ? "image"
            : code === "category.color_invalid"
              ? "color"
              : code === "content.translation_required" && language
                ? `name-${language}`
                : "save";
      this.fieldErrors = { [field]: this.saveError };
      return;
    } finally {
      this.busy = false;
    }
    await this.#load();
  }
  #deleteGeneration = 0;
  #openDelete(category: CategorySummary): void {
    this.saveError = "";
    this.dependants = null;
    this.dependantsError = false;
    this.deleting = category;
    const generation = ++this.#deleteGeneration;
    void this.#loadDependants(category.id, generation);
  }
  #closeDelete(): void {
    this.deleting = null;
    this.dependants = null;
    this.dependantsError = false;
    this.#deleteGeneration++;
  }
  /** The preview is the delete's only warning: it cascades and nothing refuses it server-side. So a
   * failed fetch gets its own state, never an empty stand-in that reads as "nothing depends on this".
   * `generation` guards a reopened dialog: comparing `this.deleting?.id` alone cannot tell a
   * superseded fetch from the current one when the SAME category is reopened. */
  async #loadDependants(id: string, generation: number): Promise<void> {
    try {
      const dependants = await this.api.getCategoryDependants(id);
      if (generation === this.#deleteGeneration) this.dependants = dependants;
    } catch {
      if (generation === this.#deleteGeneration) this.dependantsError = true;
    }
  }
  async #delete(): Promise<void> {
    if (!this.deleting || this.busy) return;
    this.busy = true;
    this.saveError = "";
    try {
      await this.api.deleteCategory(this.deleting.id);
      if (this.selected === this.deleting.id) this.selected = null;
      this.#closeDelete();
    } catch (error) {
      this.saveError = this.#error(error);
      return;
    } finally {
      this.busy = false;
    }
    await this.#load();
  }
  #openAdding(): void {
    this.addingProducts = true;
    this.picked = new Set();
    this.saveError = "";
  }
  #closeAdding(): void {
    this.addingProducts = false;
  }
  async #addPicked(): Promise<void> {
    if (!this.selected || this.busy || this.picked.size === 0) return;
    this.busy = true;
    this.saveError = "";
    try {
      await this.api.addProductsToCategory(this.selected, [...this.picked]);
    } catch (error) {
      this.saveError = this.#error(error);
      return;
    } finally {
      this.busy = false;
    }
    this.#closeAdding();
    this.picked = new Set();
    await this.#load();
  }
  #assign(product: Product, remove = false): void {
    const ids = remove
      ? product.categoryIds.filter((id) => id !== this.selected)
      : [...new Set([...product.categoryIds, this.selected!])];
    let primary = product.primaryCategoryId;
    if (!primary && ids.length === 1) primary = ids[0]!;
    if (primary && !ids.includes(primary)) primary = null;
    this.memberProduct = product;
    this.membership = { categoryIds: ids, primaryCategoryId: primary };
    this.membershipOpen = true;
    this.saveError = "";
  }
  async #saveMembership(event: CustomEvent<{ value: ProductCategories }>): Promise<void> {
    event.stopPropagation();
    if (this.busy || !this.memberProduct) return;
    this.busy = true;
    this.saveError = "";
    try {
      await this.api.replaceProductCategories(this.memberProduct.id, event.detail.value);
      this.membershipOpen = false;
    } catch (error) {
      this.saveError = this.#error(error);
      return;
    } finally {
      this.busy = false;
    }
    await this.#load();
  }
  #rowParent = (category: CategorySummary): string | null => category.parentId;
  // `part=` rather than `class=` throughout this cell: see the ::part() block in static styles.
  /** The colour goes into an inline `style`, so it is checked here rather than trusted: anything
   * that is not a lower-case `#rrggbb` draws the empty swatch, exactly as a category with no colour
   * does. `wt-lozenge` guards its own colour the same way. */
  #swatch(color: string | null) {
    return color !== null && isHexColor(color)
      ? html`<span part="swatch" style=${`background:${color}`} aria-hidden="true"></span>`
      : html`<span part="swatch swatch-none" aria-hidden="true"></span>`;
  }
  #nameCell(category: CategorySummary, ancestorOnly: boolean) {
    // In tree mode a row can be present only to keep a matching descendant's ancestor chain
    // visible; the table reports that through the cell's `ancestorOnly` context. Mute those so
    // the match itself stands out.
    const muted = this.mode === "tree" && ancestorOnly;
    return html`<span part="name-cell">
      ${
        category.image
          ? html`<img
              part="thumbnail"
              src=${`/media/${encodeURIComponent(category.image)}`}
              alt=""
            />`
          : html`<span part="thumbnail-placeholder" aria-hidden="true"></span>`
      }
      ${this.#swatch(category.color)}
      <wt-button
        part=${muted ? "name name-muted" : "name"}
        variant="ghost"
        data-category=${category.id}
        ?data-muted=${muted}
        @click=${() => {
          this.selected = category.id;
          this.addingProducts = false;
          this.picked = new Set();
          this.saveError = "";
        }}
        >${this.#text(category.name)}</wt-button
      >
    </span>`;
  }
  #lozenge(category: CategorySummary) {
    return html`<wt-lozenge color=${category.color ?? ""}
      >${this.#text(category.name)}</wt-lozenge
    >`;
  }
  #parentPath(category: CategorySummary): string | null {
    const parent = this.categories.find((item) => item.id === category.parentId);
    return parent ? categoryPath(parent, this.categories, currentLocale(), this.languages) : null;
  }
  #columns(): DataTableColumn<CategorySummary>[] {
    return [
      {
        key: "name",
        label: t("categories.name"),
        searchValue: (category) => this.#text(category.name),
        sortValue: (category) => this.#text(category.name),
        cell: (category, context) => this.#nameCell(category, context.ancestorOnly),
      },
      {
        key: "parent",
        label: t("categories.parent"),
        sortValue: (category) => this.#parentPath(category) ?? "",
        cell: (category) => this.#parentPath(category) ?? t("categories.no_parent"),
        filter: {
          label: t("categories.parent"),
          allLabel: t("categories.filter_parent_all"),
          value: (category) => category.parentId ?? "",
          options: this.#categoryOptions(
            this.categories.map((category) => category.parentId),
            (category) => categoryPath(category, this.categories, currentLocale(), this.languages),
          ),
        },
      },
      {
        key: "products",
        label: t("categories.products"),
        sortValue: (category) =>
          this.products.filter((product) => product.categoryIds.includes(category.id)).length,
        cell: (category) =>
          this.products.filter((product) => product.categoryIds.includes(category.id)).length,
      },
      {
        key: "actions",
        label: t("categories.actions"),
        cell: (category) =>
          html`<wt-row-actions label=${`${t("categories.actions")}: ${this.#text(category.name)}`}
            ><wt-button align="start" variant="ghost" @click=${() => this.#edit(category)}
              >${t("action.edit")}</wt-button
            ><wt-button align="start" variant="ghost" @click=${() => this.#openDelete(category)}
              >${t("action.delete")}</wt-button
            ></wt-row-actions
          >`,
      },
    ];
  }
  /** Tree mode nests by `parentId` and shows the hierarchy itself, so a separate Parent column
   * would repeat what the indentation already shows. */
  #treeColumns(): DataTableColumn<CategorySummary>[] {
    return this.#columns().filter((column) => column.key !== "parent");
  }
  /** Filter options for the categories whose ids appear in `ids` (some category's parent, or some
   * product's reporting category): a category nothing refers to would match no row. */
  #categoryOptions(
    ids: readonly (string | null)[],
    label: (category: CategorySummary) => string,
  ): { value: string; label: string }[] {
    const referenced = new Set(ids);
    return this.categories
      .filter((category) => referenced.has(category.id))
      .map((category) => ({ value: category.id, label: label(category) }));
  }
  #reportingCategory(product: Product): CategorySummary | undefined {
    return this.categories.find((item) => item.id === product.primaryCategoryId);
  }
  #reportingCell(product: Product) {
    const category = this.#reportingCategory(product);
    return category ? this.#lozenge(category) : t("categories.none");
  }
  #otherCategories(product: Product): CategorySummary[] {
    return product.categoryIds
      .filter((id) => id !== product.primaryCategoryId)
      .map((id) => this.categories.find((category) => category.id === id))
      .filter((category): category is CategorySummary => category !== undefined);
  }
  #otherCategoriesCell(product: Product) {
    const others = this.#otherCategories(product);
    if (others.length === 0) return html`<span part="muted" aria-hidden="true">—</span>`;
    if (others.length > OTHER_CATEGORIES_PREVIEW_LIMIT)
      return t("categories.other_categories_count").replace("{count}", String(others.length));
    return others.map((category) => this.#lozenge(category));
  }
  #nameSortValue(product: Product): string {
    return product.name;
  }
  #reportingSortValue(product: Product): string {
    const category = this.#reportingCategory(product);
    return category ? this.#text(category.name) : "";
  }
  #productColumns(trailing?: DataTableColumn<Product>): DataTableColumn<Product>[] {
    const base: DataTableColumn<Product>[] = [
      {
        key: "name",
        label: t("categories.name"),
        cell: (product) => product.name,
        searchValue: (product) => product.name,
        sortValue: (product) => this.#nameSortValue(product),
      },
      {
        key: "primary",
        label: t("editor.reporting_category"),
        cell: (product) => this.#reportingCell(product),
        sortValue: (product) => this.#reportingSortValue(product),
        filter: {
          label: t("editor.reporting_category"),
          allLabel: t("categories.filter_reporting_all"),
          value: (product) => product.primaryCategoryId ?? "",
          options: this.#categoryOptions(
            this.products.map((product) => product.primaryCategoryId),
            (category) => this.#text(category.name),
          ),
        },
      },
      {
        key: "other",
        label: t("categories.other_categories"),
        cell: (product) => this.#otherCategoriesCell(product),
        searchValue: (product) =>
          this.#otherCategories(product)
            .map((category) => this.#text(category.name))
            .join(" "),
      },
    ];
    return trailing ? [...base, trailing] : base;
  }
  /** Remove pre-fills the picker with this category taken out, so a cleared reporting category is a
   * deliberate (still-confirmed) choice rather than an immediate write. */
  #memberColumns(): DataTableColumn<Product>[] {
    return this.#productColumns({
      key: "actions",
      label: t("categories.actions"),
      cell: (product) =>
        html`<wt-row-actions label=${`${t("categories.actions")}: ${product.name}`}
          ><wt-button align="start" variant="ghost" @click=${() => this.#assign(product)}
            >${t("categories.edit_membership")}</wt-button
          ><wt-button
            align="start"
            data-test="remove-membership"
            variant="ghost"
            @click=${() => this.#assign(product, true)}
            >${t("categories.remove_from")}</wt-button
          ></wt-row-actions
        >`,
    });
  }
  /** Only called when there IS something to lose. */
  #deleteWarning(dependants: CategoryDependants): string {
    const parts = [t("categories.delete_warning_intro")];
    if (dependants.products.length > 0)
      parts.push(
        t("categories.delete_warning_products").replace(
          "{count}",
          String(dependants.products.length),
        ),
      );
    if (dependants.children.length > 0) {
      const parent = this.categories.find((category) => category.id === dependants.parentId);
      parts.push(
        dependants.parentId
          ? t("categories.delete_warning_children_under")
              .replace("{count}", String(dependants.children.length))
              .replace("{parent}", parent ? this.#text(parent.name) : "")
          : t("categories.delete_warning_children_top").replace(
              "{count}",
              String(dependants.children.length),
            ),
      );
    }
    return parts.join(" ");
  }
  /** A failed fetch says so, because silence here would read as "nothing to lose". */
  #renderDependants() {
    if (this.dependantsError)
      return html`<p class="error" data-test="dependants-error" role="alert">
        ${t("categories.delete_preview_error")}
      </p>`;
    const dependants = this.dependants;
    if (!dependants) return html`<wt-spinner></wt-spinner>`;
    const sections: TemplateResult[] = [];
    if (dependants.products.length > 0) {
      const affected = dependants.products
        .map((entry) => this.products.find((product) => product.id === entry.id))
        .filter((product): product is Product => product !== undefined);
      sections.push(
        html`<wt-data-table
          data-test="category-delete-products"
          aria-label=${t("categories.products_modal")}
          searchable
          searchLabel=${t("categories.search_products")}
          noMatchesMessage=${t("categories.products_no_matches")}
          viewKey="waitron.categories.delete.table"
          .rows=${affected}
          .columns=${this.#productColumns()}
          .rowKey=${(product: Product) => product.id}
          .emptyMessage=${t("categories.no_products")}
        ></wt-data-table>`,
      );
    }
    if (dependants.children.length > 0) {
      sections.push(
        html`<ul>
          ${dependants.children.map(
            (child) =>
              html`<li>
                <a href=${`/manage/categories?category=${encodeURIComponent(child.id)}`}
                  >${this.#text(child.name)}</a
                >
              </li>`,
          )}
        </ul>`,
      );
    }
    return sections.length === 0
      ? nothing
      : html`<p class="error" data-test="delete-warning" role="alert">
            ${this.#deleteWarning(dependants)}
          </p>
          ${sections}`;
  }
  override render() {
    const selected = this.categories.find((category) => category.id === this.selected);
    // Each table searches and filters its own rows, so these are the full member and add lists.
    const members = this.products.filter((product) =>
      product.categoryIds.includes(this.selected ?? ""),
    );
    const addRows = this.products.filter(
      (product) => !product.categoryIds.includes(this.selected ?? ""),
    );
    return html`<div class="heading">
        <h1>${t("nav.categories")}</h1>
        <div class="header-actions">
          <div class="mode-toggle">
            <wt-button
              data-test="mode-tree"
              variant=${this.mode === "tree" ? "primary" : "secondary"}
              aria-pressed=${this.mode === "tree" ? "true" : "false"}
              @click=${() => this.#setMode("tree")}
              >${t("categories.mode_tree")}</wt-button
            >
            <wt-button
              data-test="mode-flat"
              variant=${this.mode === "flat" ? "primary" : "secondary"}
              aria-pressed=${this.mode === "flat" ? "true" : "false"}
              @click=${() => this.#setMode("flat")}
              >${t("categories.mode_flat")}</wt-button
            >
          </div>
          <wt-button data-test="create-category" variant="primary" @click=${() => this.#edit(null)}
            >${t("categories.add")}</wt-button
          >
        </div>
      </div>
      ${this.loading ? html`<wt-spinner></wt-spinner>` : nothing}
      ${
        this.loadError
          ? html`<p class="error" data-test="load-error" role="alert">
                ${t("categories.load_error")}
              </p>
              <wt-button variant="secondary" @click=${() => void this.#load()}
                >${t("location_settings.retry")}</wt-button
              >`
          : nothing
      }
      <wt-data-table
        aria-label=${t("nav.categories")}
        searchable
        searchLabel=${t("categories.search")}
        noMatchesMessage=${t("categories.no_matches")}
        viewKey="waitron.categories.table"
        sortKey="name"
        sortDirection="ascending"
        .rows=${this.categories}
        .columns=${this.mode === "tree" ? this.#treeColumns() : this.#columns()}
        .rowKey=${(category: CategorySummary) => category.id}
        .rowParent=${this.mode === "tree" ? this.#rowParent : undefined}
        collapseLabel=${t("categories.collapse")}
        expandLabel=${t("categories.expand")}
        .emptyMessage=${t("categories.empty")}
      ></wt-data-table>
      <wt-modal
        data-test="products-modal"
        .open=${this.selected !== null}
        heading=${selected ? `${this.#text(selected.name)} · ${t("categories.products_modal")}` : ""}
        @keydown=${(event: KeyboardEvent) => {
          if (this.busy && event.key === "Escape") event.preventDefault();
        }}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (this.busy) return;
          this.selected = null;
          this.addingProducts = false;
          this.picked = new Set();
        }}
      >
        ${this.saveError ? html`<p role="alert">${this.saveError}</p>` : nothing}
        ${
          this.addingProducts
            ? html`<wt-data-table
                  data-test="category-add-products"
                  aria-label=${t("categories.add_products")}
                  searchable
                  searchLabel=${t("categories.search_products")}
                  noMatchesMessage=${t("categories.products_no_matches")}
                  viewKey="waitron.categories.add.table"
                  selectable
                  .selected=${[...this.picked]}
                  .selectionLabel=${(product: Product) =>
                    `${t("categories.add_products")}: ${product.name}`}
                  selectAllLabel=${t("categories.select_all_products")}
                  @wt-selection-change=${(event: CustomEvent<{ selected: string[] }>) => {
                    event.stopPropagation();
                    this.picked = new Set(event.detail.selected);
                  }}
                  .rows=${addRows}
                  .columns=${this.#productColumns()}
                  .rowKey=${(product: Product) => product.id}
                  .emptyMessage=${t("categories.no_products")}
                ></wt-data-table>
                <wt-form-actions slot="footer"
                  ><wt-button
                    slot="cancel"
                    variant="secondary"
                    .disabled=${this.busy}
                    @click=${() => this.#closeAdding()}
                    >${t("action.cancel")}</wt-button
                  ><wt-button
                    variant="primary"
                    data-test="add-selected"
                    .disabled=${this.busy || this.picked.size === 0}
                    @click=${() => void this.#addPicked()}
                    >${t("categories.add_selected").replace(
                      "{count}",
                      String(this.picked.size),
                    )}</wt-button
                  ></wt-form-actions
                >`
            : html`<div class="heading">
                  <h2>${t("categories.products")}</h2>
                  <wt-button
                    data-test="add-products"
                    variant="primary"
                    @click=${() => this.#openAdding()}
                    >${t("categories.add_products")}</wt-button
                  >
                </div>
                <!-- Keyed on the opened category: each open gets a fresh table, so a search typed
                     for one category never hides another's products. -->
                ${keyed(
                  this.selected,
                  html`<wt-data-table
                    data-test="category-products"
                    aria-label=${t("categories.products_modal")}
                    searchable
                    searchLabel=${t("categories.search_products")}
                    noMatchesMessage=${t("categories.products_no_matches")}
                    viewKey="waitron.categories.members.table"
                    .rows=${members}
                    .columns=${this.#memberColumns()}
                    .rowKey=${(product: Product) => product.id}
                    .emptyMessage=${t("categories.no_products")}
                  ></wt-data-table>`,
                )}
                <wt-form-actions slot="footer"
                  ><wt-button
                    slot="cancel"
                    data-test="close-products"
                    variant="secondary"
                    .disabled=${this.busy}
                    @click=${() => {
                      this.selected = null;
                      this.addingProducts = false;
                      this.picked = new Set();
                    }}
                    >${t("action.close")}</wt-button
                  ></wt-form-actions
                >`
        }
      </wt-modal>
      <dashboard-category-form
        .open=${this.editorOpen}
        .busy=${this.busy}
        .languages=${this.languages}
        .value=${this.edited}
        .categories=${this.categories}
        .api=${this.api}
        .fieldErrors=${this.fieldErrors}
        @wt-submit=${(event: CustomEvent<{ value: CategoryInput }>) => void this.#save(event)}
        @wt-cancel=${(event: Event) => {
          event.stopPropagation();
          this.editorOpen = false;
        }}
      ></dashboard-category-form>
      <wt-modal
        data-test="delete-dialog"
        .open=${this.deleting !== null}
        heading=${t("categories.delete_named").replace(
          "{name}",
          this.deleting ? this.#text(this.deleting.name) : "",
        )}
        @keydown=${(event: KeyboardEvent) => {
          if (this.busy && event.key === "Escape") event.preventDefault();
        }}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (!this.busy) this.#closeDelete();
        }}
      >
        ${this.deleting ? this.#renderDependants() : nothing}
        ${this.saveError ? html`<p role="alert">${this.saveError}</p>` : nothing}
        <wt-form-actions slot="footer"
          ><wt-button
            slot="cancel"
            variant="secondary"
            .disabled=${this.busy}
            @click=${() => this.#closeDelete()}
            >${t("action.cancel")}</wt-button
          ><wt-button
            variant="danger"
            .disabled=${this.busy || !this.dependants}
            @click=${() => void this.#delete()}
            >${t("action.delete")}</wt-button
          ></wt-form-actions
        >
      </wt-modal>
      <wt-modal
        .open=${this.membershipOpen}
        heading=${t("categories.membership")}
        @keydown=${(event: KeyboardEvent) => {
          if (this.busy && event.key === "Escape") event.preventDefault();
        }}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (!this.busy) this.membershipOpen = false;
        }}
      >
        ${this.saveError ? html`<p role="alert">${this.saveError}</p>` : nothing}
        ${
          this.memberProduct
            ? html`<p>${this.memberProduct.name}</p>
                <dashboard-category-membership-picker
                  .categories=${this.categories}
                  .languages=${this.languages}
                  .value=${this.membership}
                  .busy=${this.busy}
                  @wt-submit=${(event: CustomEvent<{ value: ProductCategories }>) => void this.#saveMembership(event)}
                  @wt-cancel=${(event: Event) => {
                    event.stopPropagation();
                    this.membershipOpen = false;
                  }}
                ></dashboard-category-membership-picker>`
            : nothing
        }
      </wt-modal>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-categories-screen": CategoriesScreen;
  }
}
