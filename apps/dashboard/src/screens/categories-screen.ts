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
        margin-block: var(--wt-space-3);
      }
      .error {
        color: var(--wt-color-danger);
      }
      .thumbnail {
        width: var(--wt-tap-min);
        height: var(--wt-tap-min);
        object-fit: cover;
        border-radius: var(--wt-radius-sm);
      }
      .name {
        overflow-wrap: anywhere;
        text-align: start;
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
      const linked = new URL(location.href).searchParams.get("category");
      if (
        this.selected === null &&
        linked &&
        this.categories.some((category) => category.id === linked)
      )
        this.selected = linked;
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
  #columns(): DataTableColumn<CategorySummary>[] {
    return [
      {
        key: "image",
        label: t("image.label"),
        cell: (category) =>
          category.image
            ? html`<img
                class="thumbnail"
                src=${`/media/${encodeURIComponent(category.image)}`}
                alt=${this.#text(category.name)}
              />`
            : nothing,
      },
      {
        key: "name",
        label: t("categories.name"),
        cell: (category) =>
          html`<wt-button
            class="name"
            variant="ghost"
            data-category=${category.id}
            @click=${() => {
              this.selected = category.id;
              this.productSearch = "";
            }}
            >${this.#text(category.name)}</wt-button
          >`,
      },
      {
        key: "parent",
        label: t("categories.parent"),
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
  #productColumns(): DataTableColumn<Product>[] {
    return [
      {
        key: "name",
        label: t("categories.name"),
        cell: (product) => this.#text(product.descriptions),
      },
      {
        key: "primary",
        label: t("categories.primary"),
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
  override render() {
    const selected = this.categories.find((category) => category.id === this.selected);
    const filtered = this.categories.filter((category) =>
      categoryPath(category, this.categories, currentLocale(), this.languages)
        .toLocaleLowerCase()
        .includes(this.search.toLocaleLowerCase()),
    );
    const members = this.products.filter(
      (product) =>
        product.categoryIds.includes(this.selected ?? "") &&
        this.#text(product.descriptions)
          .toLocaleLowerCase()
          .includes(this.productSearch.toLocaleLowerCase()),
    );
    return html`<div class="heading">
        <h1>${t("nav.categories")}</h1>
        <wt-row-actions label=${t("categories.actions")}
          ><wt-button
            align="start"
            data-test="create-category"
            variant="ghost"
            @click=${() => this.#edit(null)}
            >${t("categories.create")}</wt-button
          ></wt-row-actions
        >
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
      <wt-input
        class="filters"
        name="category-search"
        label=${t("categories.search")}
        .value=${this.search}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.search = event.detail.value;
        }}
      ></wt-input>
      <wt-data-table
        .rows=${filtered}
        .columns=${this.#columns()}
        .rowKey=${(category: CategorySummary) => category.id}
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
