import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-button.js";
import type { CategoryInput, CategorySummary, DashboardApi, Product } from "../api/client.js";
import type { ModifierListChoice } from "./product-editor-model.js";
import { categoryAncestors, categoryPath, categoryRefusalErrors } from "./category-form.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { currentLocale, t } from "../i18n/t.js";
import "./product-list.js";
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
  @property({ attribute: false }) categories: CategorySummary[] = [];
  @property({ attribute: false }) extraLists: ModifierListChoice[] = [];
  @property({ attribute: false }) optionLists: ModifierListChoice[] = [];
  @property({ attribute: false }) folderId: string | null = null;
  @property() view: "folders" | "all" = "folders";
  @state() private search = "";
  @state() private folderForm: { value: CategorySummary | null } | null = null;
  @state() private formBusy = false;
  @state() private formErrors: Record<string, string> = {};

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
        ${crumbs.map((crumb, index) => (index === crumbs.length - 1 ? html`<li><span aria-current="location">${crumb.name}</span></li>` : html`<li><wt-button variant="ghost" data-test=${`crumb-${index}`} @click=${() => this.#emit("open-folder", { folderId: crumb.id })}>${crumb.name}</wt-button><span class="sep" aria-hidden="true">›</span></li>`))}
      </ol>
    </nav>`;
  }
  override render() {
    const visible = this.#visible();
    return html`${this.view === "folders" && !this.search.trim() ? this.#breadcrumb() : nothing}
      <div class="toolbar">
        <div class="views">
          <wt-button
            data-test="view-folders"
            variant="secondary"
            aria-pressed=${String(this.view === "folders")}
            @click=${() => this.#emit("view-change", { view: "folders" })}
            >${t("folders.view_folders")}</wt-button
          >
          <wt-button
            data-test="view-all"
            variant="secondary"
            aria-pressed=${String(this.view === "all")}
            @click=${() => this.#emit("view-change", { view: "all" })}
            >${t("folders.view_all")}</wt-button
          >
        </div>
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
        <wt-button data-test="new-folder" @click=${() => this.#openForm(null)}
          >${t("folders.new")}</wt-button
        >
      </div>
      <dashboard-product-list
        .folders=${visible.folders}
        .products=${visible.products}
        .showPath=${visible.showPath}
        .categories=${this.categories}
        .extraLists=${this.extraLists}
        .optionLists=${this.optionLists}
        @open-folder=${(event: CustomEvent<{ folderId: string }>) => {
          event.stopPropagation();
          this.#emit("open-folder", event.detail);
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
      ></dashboard-category-form>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-catalogue-browser": CatalogueBrowser;
  }
}
