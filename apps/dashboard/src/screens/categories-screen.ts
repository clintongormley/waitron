import { LocaleChangeController } from "../state/locale-controller.js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
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
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-lozenge.js";

const MODE_KEY = "waitron.categories.mode";
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
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
      }
      h1,
      h2 {
        margin: var(--wt-space-4) 0;
      }
      .filters {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--wt-space-3);
        margin-block: var(--wt-space-3);
      }
      .mode-toggle {
        display: flex;
        gap: var(--wt-space-2);
      }
      .error,
      .danger {
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
      /* Marks a tree-mode ancestor kept only to show a matching descendant's path — see the
         filtering block in render(). The colour has to reach the <button> inside wt-button's OWN
         shadow root, which is one boundary further than ::part() can select. Re-pointing the token
         that wt-button's ghost variant reads for its colour (--wt-color-text) on the host does it,
         because a custom property set on an element is inherited by its shadow tree. Scoped to this
         one button instance, so no other element's text colour moves. */
      wt-data-table::part(name-muted) {
        --wt-color-text: var(--wt-color-text-muted);
      }
      label {
        display: grid;
        gap: var(--wt-space-2);
        margin-block: var(--wt-space-3);
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
  @state() private search = "";
  @state() private productSearch = "";
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
      // A `?category=<id>` deep link opens the editor rather than selecting the category (which
      // used to show its products below). An unknown id is ignored. Clearing the param stops a
      // refresh reopening the editor.
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
  #openDelete(category: CategorySummary): void {
    this.saveError = "";
    this.dependants = null;
    this.dependantsError = false;
    this.deleting = category;
    void this.#loadDependants(category.id);
  }
  #closeDelete(): void {
    this.deleting = null;
    this.dependants = null;
    this.dependantsError = false;
  }
  /** Feeds the delete confirmation's preview, which is the only warning there is: the delete
   * cascades and cannot be undone, and nothing refuses it server-side. So a failed fetch gets its
   * own state rather than an empty stand-in — an empty preview is indistinguishable from "nothing
   * depends on this", which would have a manager confirm the cascade blind. `dependants` stays
   * null, which keeps Delete disabled; `dependantsError` is what tells the dialog to say why. */
  async #loadDependants(id: string): Promise<void> {
    try {
      const dependants = await this.api.getCategoryDependants(id);
      if (this.deleting?.id === id) this.dependants = dependants;
    } catch {
      if (this.deleting?.id === id) this.dependantsError = true;
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
    this.productSearch = "";
    this.saveError = "";
  }
  #closeAdding(): void {
    this.addingProducts = false;
    this.productSearch = "";
  }
  #togglePick(id: string, checked: boolean): void {
    const next = new Set(this.picked);
    if (checked) next.add(id);
    else next.delete(id);
    this.picked = next;
  }
  #toggleAllPicked(visible: readonly Product[], checked: boolean): void {
    const next = new Set(this.picked);
    for (const product of visible) {
      if (checked) next.add(product.id);
      else next.delete(product.id);
    }
    this.picked = next;
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
  #nameCell(category: CategorySummary, matchIds: ReadonlySet<string>) {
    // In tree mode a row can be present only to keep a matching descendant's ancestor chain
    // visible (see the filtering block in render()); mute those so the match itself stands out.
    const muted = this.mode === "tree" && !matchIds.has(category.id);
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
          this.productSearch = "";
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
  #columns(matchIds: ReadonlySet<string>): DataTableColumn<CategorySummary>[] {
    return [
      {
        key: "name",
        label: t("categories.name"),
        cell: (category) => this.#nameCell(category, matchIds),
      },
      {
        key: "parent",
        label: t("categories.parent"),
        sortValue: (category) => {
          const parent = this.categories.find((item) => item.id === category.parentId);
          return parent
            ? categoryPath(parent, this.categories, currentLocale(), this.languages)
            : "";
        },
        cell: (category) => {
          const parent = this.categories.find((item) => item.id === category.parentId);
          return parent
            ? categoryPath(parent, this.categories, currentLocale(), this.languages)
            : t("categories.no_parent");
        },
      },
      {
        key: "products",
        label: t("categories.products"),
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
  #treeColumns(matchIds: ReadonlySet<string>): DataTableColumn<CategorySummary>[] {
    return this.#columns(matchIds).filter((column) => column.key !== "parent");
  }
  #reportingCell(product: Product) {
    const category = this.categories.find((item) => item.id === product.primaryCategoryId);
    return category ? this.#lozenge(category) : t("categories.none");
  }
  #otherCategoriesCell(product: Product) {
    const others = product.categoryIds
      .filter((id) => id !== product.primaryCategoryId)
      .map((id) => this.categories.find((category) => category.id === id))
      .filter((category): category is CategorySummary => category !== undefined);
    return others.length
      ? others.map((category) => this.#lozenge(category))
      : html`<span part="muted" aria-hidden="true">—</span>`;
  }
  #nameSortValue(product: Product): string {
    return this.#text(product.descriptions);
  }
  #reportingSortValue(product: Product): string {
    const category = this.categories.find((item) => item.id === product.primaryCategoryId);
    return category ? this.#text(category.name) : "";
  }
  /** The products modal's member list — Edit reopens the full membership picker; Remove
   * pre-fills it with this category taken out, so a cleared reporting category is a deliberate
   * (still-confirmed) choice rather than an immediate write. */
  #memberColumns(): DataTableColumn<Product>[] {
    return [
      {
        key: "name",
        label: t("categories.name"),
        cell: (product) => this.#text(product.descriptions),
        sortValue: (product) => this.#nameSortValue(product),
      },
      {
        key: "primary",
        label: t("editor.reporting_category"),
        cell: (product) => this.#reportingCell(product),
        sortValue: (product) => this.#reportingSortValue(product),
      },
      {
        key: "other",
        label: t("categories.other_categories"),
        cell: (product) => this.#otherCategoriesCell(product),
      },
      {
        key: "actions",
        label: t("categories.actions"),
        cell: (product) =>
          html`<wt-row-actions
            label=${`${t("categories.actions")}: ${this.#text(product.descriptions)}`}
            ><wt-button align="start" variant="ghost" @click=${() => this.#assign(product)}
              >${t("action.edit")}</wt-button
            ><wt-button
              align="start"
              data-test="remove-membership"
              variant="ghost"
              @click=${() => this.#assign(product, true)}
              >${t("categories.remove_from")}</wt-button
            ></wt-row-actions
          >`,
      },
    ];
  }
  /** The add-products view lists products NOT already in the category, with a leading checkbox
   * column instead of row actions — one bulk `addProductsToCategory` call replaces adding products
   * one at a time through the membership picker. */
  #addColumns(): DataTableColumn<Product>[] {
    return [
      {
        key: "pick",
        label: "",
        cell: (product) =>
          html`<input
            type="checkbox"
            aria-label=${`${t("categories.add_products")}: ${this.#text(product.descriptions)}`}
            data-test=${`pick-${product.id}`}
            .checked=${this.picked.has(product.id)}
            @change=${(event: Event) =>
              this.#togglePick(product.id, (event.target as HTMLInputElement).checked)}
          />`,
      },
      {
        key: "name",
        label: t("categories.name"),
        cell: (product) => this.#text(product.descriptions),
        sortValue: (product) => this.#nameSortValue(product),
      },
      {
        key: "primary",
        label: t("editor.reporting_category"),
        cell: (product) => this.#reportingCell(product),
        sortValue: (product) => this.#reportingSortValue(product),
      },
      {
        key: "other",
        label: t("categories.other_categories"),
        cell: (product) => this.#otherCategoriesCell(product),
      },
    ];
  }
  /** Categories whose own (translated) name matches the filter — the tree-mode ancestor walk
   * below extends this into the full set of rows the table receives. */
  #matches(): CategorySummary[] {
    const term = this.search.toLocaleLowerCase();
    return this.categories.filter((category) =>
      this.#text(category.name).toLocaleLowerCase().includes(term),
    );
  }
  /** The delete confirmation's preview: a spinner until `#loadDependants` resolves, then the
   * consequence list the brief calls for — sections with nothing in them are omitted entirely,
   * and the "this cannot be undone" intro only appears when there is something to lose. A failed
   * fetch says so instead, because silence here would read as "nothing to lose". */
  #renderDependants() {
    if (this.dependantsError)
      return html`<p class="error" data-test="dependants-error" role="alert">
        ${t("categories.delete_preview_error")}
      </p>`;
    const dependants = this.dependants;
    if (!dependants) return html`<wt-spinner></wt-spinner>`;
    const sections: TemplateResult[] = [];
    if (dependants.products.length > 0) {
      sections.push(
        html`<p>
            ${t("categories.delete_products").replace("{count}", String(dependants.products.length))}
          </p>
          <ul>
            ${dependants.products.map(
              (product) =>
                html`<li>
                  <a href=${`/manage/catalogue/product/${encodeURIComponent(product.id)}`}
                    >${this.#text(product.name)}</a
                  >${
                    product.reporting
                      ? html` <span class="danger">${t("categories.delete_reporting")}</span>`
                      : nothing
                  }
                </li>`,
            )}
          </ul>`,
      );
    }
    if (dependants.children.length > 0) {
      const parent = this.categories.find((category) => category.id === dependants.parentId);
      const heading = (
        dependants.parentId
          ? t("categories.delete_children_under").replace(
              "{parent}",
              parent ? this.#text(parent.name) : "",
            )
          : t("categories.delete_children_top")
      ).replace("{count}", String(dependants.children.length));
      sections.push(
        html`<p>${heading}</p>
          <ul>
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
    if (dependants.routes.length > 0) {
      sections.push(
        html`<p>
            ${t("categories.delete_routes").replace("{count}", String(dependants.routes.length))}
          </p>
          <ul>
            ${dependants.routes.map(
              (route) =>
                html`<li>
                  <a href="/manage/venue-operations/view/routing"
                    >${route.station ?? t("categories.no_preparation")} ·
                    ${route.zone ?? t("categories.route_all_zones")}</a
                  >
                </li>`,
            )}
          </ul>`,
      );
    }
    return sections.length === 0
      ? nothing
      : html`<p>${t("categories.delete_intro")}</p>
          ${sections}`;
  }
  override render() {
    const selected = this.categories.find((category) => category.id === this.selected);
    const matches = this.#matches();
    const matchIds = new Set(matches.map((category) => category.id));
    let rows: CategorySummary[];
    if (this.mode === "flat") {
      rows = matches;
    } else {
      // Tree mode must keep every matching row's ancestor chain too, or wt-data-table (which only
      // nests within the rows it is given) would render a match as a false top-level row.
      const included = new Set(matchIds);
      for (const category of matches) {
        const visited = new Set<string>();
        let current: CategorySummary | undefined = category;
        while (current?.parentId && !visited.has(current.parentId)) {
          visited.add(current.parentId);
          included.add(current.parentId);
          current = this.categories.find((item) => item.id === current!.parentId);
        }
      }
      rows = this.categories.filter((category) => included.has(category.id));
    }
    const filter = this.productSearch.toLocaleLowerCase();
    const members = this.products.filter(
      (product) =>
        product.categoryIds.includes(this.selected ?? "") &&
        this.#text(product.descriptions).toLocaleLowerCase().includes(filter),
    );
    const addRows = this.products.filter(
      (product) =>
        !product.categoryIds.includes(this.selected ?? "") &&
        this.#text(product.descriptions).toLocaleLowerCase().includes(filter),
    );
    const allVisiblePicked =
      addRows.length > 0 && addRows.every((product) => this.picked.has(product.id));
    return html`<div class="heading">
        <h1>${t("nav.categories")}</h1>
        <wt-button
          round
          variant="primary"
          data-test="create-category"
          aria-label=${t("categories.create")}
          @click=${() => this.#edit(null)}
          ><wt-icon name="plus"></wt-icon
        ></wt-button>
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
      <div class="filters">
        <wt-input
          name="category-search"
          label=${t("categories.search")}
          .value=${this.search}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.search = event.detail.value;
          }}
        ></wt-input>
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
      </div>
      <wt-data-table
        aria-label=${t("nav.categories")}
        .rows=${rows}
        .columns=${this.mode === "tree" ? this.#treeColumns(matchIds) : this.#columns(matchIds)}
        .rowKey=${(category: CategorySummary) => category.id}
        .rowParent=${this.mode === "tree" ? this.#rowParent : undefined}
        collapseLabel=${t("categories.collapse")}
        expandLabel=${t("categories.expand")}
        .emptyMessage=${t("categories.empty")}
      ></wt-data-table>
      <wt-modal
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
            ? html`<div class="filters">
                  <wt-input
                    name="add-category-product-search"
                    label=${t("categories.search_products")}
                    .value=${this.productSearch}
                    @wt-change=${(event: CustomEvent<{ value: string }>) => {
                      event.stopPropagation();
                      this.productSearch = event.detail.value;
                    }}
                  ></wt-input>
                  <label
                    ><input
                      type="checkbox"
                      data-test="select-all-visible"
                      .checked=${allVisiblePicked}
                      @change=${(event: Event) =>
                        this.#toggleAllPicked(addRows, (event.target as HTMLInputElement).checked)}
                    />${t("categories.select_all_visible")}</label
                  >
                </div>
                <wt-data-table
                  data-test="category-add-products"
                  aria-label=${t("categories.add_products")}
                  .rows=${addRows}
                  .columns=${this.#addColumns()}
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
                <wt-input
                  name="category-product-search"
                  label=${t("categories.search_products")}
                  .value=${this.productSearch}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => {
                    event.stopPropagation();
                    this.productSearch = event.detail.value;
                  }}
                ></wt-input>
                <wt-data-table
                  data-test="category-products"
                  aria-label=${t("categories.products_modal")}
                  .rows=${members}
                  .columns=${this.#memberColumns()}
                  .rowKey=${(product: Product) => product.id}
                  .emptyMessage=${t("categories.no_products")}
                ></wt-data-table>`
        }
      </wt-modal>
      <dashboard-category-form
        .open=${this.editorOpen}
        .busy=${this.busy}
        .locales=${this.languages.languages}
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
        .open=${this.deleting !== null}
        heading=${t("categories.delete_confirm")}
        @keydown=${(event: KeyboardEvent) => {
          if (this.busy && event.key === "Escape") event.preventDefault();
        }}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (!this.busy) this.#closeDelete();
        }}
      >
        <p>${this.deleting ? this.#text(this.deleting.name) : ""}</p>
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
            ? html`<p>${this.#text(this.memberProduct.descriptions)}</p>
                <dashboard-category-membership-picker
                  .categories=${this.categories}
                  .locales=${this.languages.languages}
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
