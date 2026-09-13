import { LocaleChangeController } from "../state/locale-controller.js";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, selectStyles, setContentLanguages, type DataTableColumn } from "@waitron/ui";
import { resolveEnabledContentText, type ContentLanguages } from "@waitron/shared";
import { DashboardQueries } from "../api/query-controller.js";
import type {
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
      .error {
        color: var(--wt-color-danger);
      }
      .thumbnail,
      .thumbnail-placeholder {
        width: var(--wt-tap-min);
        height: var(--wt-tap-min);
        flex: none;
      }
      .thumbnail {
        object-fit: cover;
        border-radius: var(--wt-radius-sm);
      }
      .name-cell {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-2);
      }
      .swatch {
        width: var(--wt-space-4);
        height: var(--wt-space-4);
        flex: none;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
      }
      .swatch.none {
        background: transparent;
      }
      .name {
        overflow-wrap: anywhere;
        text-align: start;
      }
      /* Marks a tree-mode ancestor kept only to show a matching descendant's path — see the
         filtering block in render(). wt-button's part="button" is what a consumer can style from
         outside its shadow root (see "Page composition" in design-system.md). */
      wt-button.name[data-muted]::part(button) {
        color: var(--wt-color-text-muted);
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
  @state() private editorOpen = false;
  @state() private edited: CategorySummary | null = null;
  @state() private deleting: CategorySummary | null = null;
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
    const code = codeOf(error);
    if (code === "category.in_use") {
      const params = (error as { params?: Record<string, unknown> }).params ?? {};
      return t("categories.in_use").replace(/\{(children|products|routes)\}/g, (_, key: string) =>
        String(params[key] ?? "?"),
      );
    }
    return codeMessage(code);
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
  async #delete(): Promise<void> {
    if (!this.deleting || this.busy) return;
    this.busy = true;
    this.saveError = "";
    try {
      await this.api.deleteCategory(this.deleting.id);
      if (this.selected === this.deleting.id) this.selected = null;
      this.deleting = null;
    } catch (error) {
      this.saveError = this.#error(error);
      return;
    } finally {
      this.busy = false;
    }
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
  #swatch(color: string | null) {
    return color
      ? html`<span class="swatch" style=${`background:${color}`} aria-hidden="true"></span>`
      : html`<span class="swatch none" aria-hidden="true"></span>`;
  }
  #nameCell(category: CategorySummary, matchIds: ReadonlySet<string>) {
    // In tree mode a row can be present only to keep a matching descendant's ancestor chain
    // visible (see the filtering block in render()); mute those so the match itself stands out.
    const muted = this.mode === "tree" && !matchIds.has(category.id);
    return html`<span class="name-cell">
      ${
        category.image
          ? html`<img
              class="thumbnail"
              src=${`/media/${encodeURIComponent(category.image)}`}
              alt=""
            />`
          : html`<span class="thumbnail-placeholder" aria-hidden="true"></span>`
      }
      ${this.#swatch(category.color)}
      <wt-button
        class="name"
        variant="ghost"
        data-category=${category.id}
        ?data-muted=${muted}
        @click=${() => {
          this.selected = category.id;
          this.productSearch = "";
        }}
        >${this.#text(category.name)}</wt-button
      >
    </span>`;
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
            ><wt-button
              align="start"
              variant="ghost"
              @click=${() => {
                this.saveError = "";
                this.deleting = category;
              }}
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
  #productColumns(): DataTableColumn<Product>[] {
    return [
      {
        key: "name",
        label: t("categories.name"),
        cell: (product) => this.#text(product.descriptions),
      },
      {
        key: "primary",
        label: t("editor.reporting_category"),
        cell: (product) =>
          this.categories.find((category) => category.id === product.primaryCategoryId)
            ? this.#text(
                this.categories.find((category) => category.id === product.primaryCategoryId)!.name,
              )
            : "",
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
              >${t("categories.remove")}</wt-button
            ></wt-row-actions
          >`,
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
    const members = this.products.filter(
      (product) =>
        product.categoryIds.includes(this.selected ?? "") &&
        this.#text(product.descriptions)
          .toLocaleLowerCase()
          .includes(this.productSearch.toLocaleLowerCase()),
    );
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
        .rows=${rows}
        .columns=${this.mode === "tree" ? this.#treeColumns(matchIds) : this.#columns(matchIds)}
        .rowKey=${(category: CategorySummary) => category.id}
        .rowParent=${this.mode === "tree" ? this.#rowParent : undefined}
        collapseLabel=${t("categories.collapse")}
        expandLabel=${t("categories.expand")}
        .emptyMessage=${t("categories.empty")}
      ></wt-data-table>
      ${
        selected
          ? html`<div class="heading">
                <h2>${this.#text(selected.name)} · ${t("categories.products")}</h2>
                <wt-button
                  data-test="add-product"
                  variant="secondary"
                  @click=${() => {
                    this.memberProduct = null;
                    this.membershipOpen = true;
                    this.saveError = "";
                  }}
                  >${t("categories.add")}</wt-button
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
                .rows=${members}
                .columns=${this.#productColumns()}
                .rowKey=${(product: Product) => product.id}
                .emptyMessage=${t("categories.no_products")}
              ></wt-data-table>`
          : nothing
      }
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
          if (!this.busy) this.deleting = null;
        }}
      >
        <p>${this.deleting ? this.#text(this.deleting.name) : ""}</p>
        ${this.saveError ? html`<p role="alert">${this.saveError}</p>` : nothing}
        <wt-form-actions slot="footer"
          ><wt-button
            slot="cancel"
            variant="secondary"
            .disabled=${this.busy}
            @click=${() => {
              this.deleting = null;
            }}
            >${t("action.cancel")}</wt-button
          ><wt-button variant="danger" .disabled=${this.busy} @click=${() => void this.#delete()}
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
            : html`<wt-input
                  name="add-category-product-search"
                  label=${t("categories.search_products")}
                  .value=${this.productSearch}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => {
                    event.stopPropagation();
                    this.productSearch = event.detail.value;
                  }}
                ></wt-input
                ><label
                  >${t("categories.add")}<select
                    name="category-product"
                    @change=${(event: Event) => {
                      event.stopPropagation();
                      const product = this.products.find(
                        (product) => product.id === (event.target as HTMLSelectElement).value,
                      );
                      if (product) this.#assign(product);
                    }}
                  >
                    <option value="">${t("categories.add")}</option>
                    ${this.products.filter((product) => !product.categoryIds.includes(this.selected ?? "") && this.#text(product.descriptions).toLocaleLowerCase().includes(this.productSearch.toLocaleLowerCase())).map((product) => html`<option value=${product.id}>${this.#text(product.descriptions)}</option>`)}
                  </select></label
                >`
        }
        ${
          !this.memberProduct
            ? html`<wt-form-actions slot="footer"
                ><wt-button
                  slot="cancel"
                  variant="secondary"
                  @click=${() => {
                    this.membershipOpen = false;
                  }}
                  >${t("action.cancel")}</wt-button
                ></wt-form-actions
              >`
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
