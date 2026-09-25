import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles, currentContentLanguages, disabledStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { byLabel, categoryPath, categoryWithDescendants } from "./category-form.js";
import type { CategorySummary } from "../api/client.js";
import { currentLocale, t } from "../i18n/t.js";

export interface AddableProduct {
  id: string;
  /** The staff name. */
  name: string;
  /** The main reporting category, or null for Uncategorised. */
  categoryId: string | null;
}

/**
 * Picks several products to add to one section. Membership of this section or of the menu around
 * it is only marked, never refused: a product may sit in several sections. A host may put its own
 * Cancel in the `cancel` slot, which lands beside the confirm action.
 */
@customElement("dashboard-section-add-products")
export class SectionAddProducts extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }
      .filters {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--wt-space-3);
        margin-bottom: var(--wt-space-3);
      }
      .field {
        display: grid;
        gap: var(--wt-space-1);
      }
      /* Matches wt-input's own label, so a select beside one reads as the same kind of field. */
      .field-label {
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      select {
        min-height: var(--wt-tap-min);
      }
      select:disabled {
        ${disabledStyles}
      }
      .search {
        flex: 1;
        min-width: 0;
      }
      fieldset {
        margin: 0;
        padding: 0;
        border: 0;
        min-width: 0;
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      ul {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      li {
        border-bottom: 1px solid var(--wt-color-border);
      }
      /* The whole row is the tap target for its checkbox, never the checkbox stretched past its
         own box. */
      label.pick {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        padding-block: var(--wt-space-1);
        cursor: pointer;
      }
      input[type="checkbox"] {
        margin: 0;
        accent-color: var(--wt-color-primary);
      }
      .name {
        flex: 1;
        overflow-wrap: anywhere;
      }
      .mark {
        padding: 0 var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .notice,
      .count {
        margin: var(--wt-space-2) 0;
        color: var(--wt-color-text-muted);
      }
      .error {
        margin: var(--wt-space-2) 0 0;
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];

  @property({ attribute: false }) products: AddableProduct[] = [];
  /** The reporting-category tree, each category naming its one parent. */
  @property({ attribute: false }) categories: CategorySummary[] = [];
  @property({ attribute: false }) inSection: string[] = [];
  /** Null outside a menu, where there is no menu to mark. */
  @property({ attribute: false }) onMenu: string[] | null = null;
  @property({ type: Boolean }) busy = false;
  @state() private categoryId = "";
  @state() private search = "";
  @state() private selected: ReadonlySet<string> = new Set();
  @state() private error = false;
  #sorted: AddableProduct[] = [];
  #options: { id: string; path: string }[] = [];
  #optionsLanguage = "";
  /** Null when no category is chosen. */
  #within: ReadonlySet<string> | null = null;

  override willUpdate(changed: PropertyValues): void {
    if (changed.has("products"))
      this.#sorted = [...this.products].sort((a, b) => byLabel(a.name, b.name));
    // A category deleted under the filter would otherwise hide every product behind a dropdown
    // that has fallen back to "All categories".
    if (
      changed.has("categories") &&
      !this.categories.some((category) => category.id === this.categoryId)
    )
      this.categoryId = "";
    const language = currentLocale();
    const config = currentContentLanguages();
    // The paths are resolved in the display and content languages, which can change without the
    // categories changing.
    const optionsLanguage = JSON.stringify([language, config]);
    if (changed.has("categories") || optionsLanguage !== this.#optionsLanguage) {
      this.#optionsLanguage = optionsLanguage;
      this.#options = this.categories
        .map((category) => ({
          id: category.id,
          path: categoryPath(category, this.categories, language, config),
        }))
        .sort((a, b) => byLabel(a.path, b.path));
    }
    if (changed.has("categories") || changed.has("categoryId"))
      this.#within = this.categoryId
        ? categoryWithDescendants(this.categoryId, this.categories)
        : null;
  }

  #chosen(): string[] {
    return this.#sorted.filter((product) => this.selected.has(product.id)).map(({ id }) => id);
  }

  #visible(): AddableProduct[] {
    const within = this.#within;
    const needle = this.search.trim().toLocaleLowerCase();
    return this.#sorted.filter(
      (product) =>
        (within === null || (product.categoryId !== null && within.has(product.categoryId))) &&
        product.name.toLocaleLowerCase().includes(needle),
    );
  }

  #toggle(event: Event, productId: string): void {
    event.stopPropagation();
    const selected = new Set(this.selected);
    if (!selected.delete(productId)) selected.add(productId);
    this.selected = selected;
    this.error = false;
  }

  #confirm(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    const productIds = this.#chosen();
    if (productIds.length === 0) {
      this.error = true;
      return;
    }
    this.dispatchEvent(
      new CustomEvent("wt-add-products", {
        detail: { productIds },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #item(product: AddableProduct, inSection: Set<string>, onMenu: Set<string>) {
    return html`<li data-product=${product.id}>
      <label class="pick">
        <input
          type="checkbox"
          name="product"
          value=${product.id}
          .checked=${this.selected.has(product.id)}
          .disabled=${this.busy}
          @change=${(event: Event) => this.#toggle(event, product.id)}
        />
        <span class="name">${product.name}</span>
        ${
          inSection.has(product.id)
            ? html`<span class="mark">${t("add_products.in_section")}</span>`
            : nothing
        }
        ${
          onMenu.has(product.id)
            ? html`<span class="mark">${t("add_products.on_menu")}</span>`
            : nothing
        }
      </label>
    </li>`;
  }

  #list() {
    if (this.products.length === 0)
      return html`<p class="notice" data-test="empty">${t("add_products.empty")}</p>`;
    const visible = this.#visible();
    if (visible.length === 0)
      return html`<p class="notice" data-test="no-matches">${t("add_products.no_matches")}</p>`;
    const inSection = new Set(this.inSection);
    const onMenu = new Set(this.onMenu ?? []);
    return html`<ul>
      ${repeat(
        visible,
        (product) => product.id,
        (product) => this.#item(product, inSection, onMenu),
      )}
    </ul>`;
  }

  override render() {
    const count = this.#chosen().length;
    return html`<div class="filters">
        <label class="field">
          <span class="field-label">${t("add_products.category")}</span>
          <select
            name="category"
            .disabled=${this.busy}
            @change=${(event: Event) => {
              event.stopPropagation();
              this.categoryId = (event.target as HTMLSelectElement).value;
            }}
          >
            <option value="" .selected=${this.categoryId === ""}>
              ${t("add_products.all_categories")}
            </option>
            ${this.#options.map(
              (option) =>
                html`<option value=${option.id} .selected=${option.id === this.categoryId}>
                  ${option.path}
                </option>`,
            )}
          </select>
        </label>
        <wt-input
          class="search"
          name="search"
          label=${t("add_products.search")}
          .value=${this.search}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.search = event.detail.value;
          }}
        ></wt-input>
      </div>
      <fieldset aria-describedby=${this.error ? "add-products-error" : nothing}>
        <legend class="visually-hidden">${t("add_products.list")}</legend>
        ${this.#list()}
      </fieldset>
      ${
        this.error
          ? html`<p class="error" id="add-products-error" data-test="error">
              ${t("add_products.none_chosen")}
            </p>`
          : nothing
      }
      <p class="count" data-test="count" role="status">
        ${t("add_products.selected").replace("{count}", String(count))}
      </p>
      <wt-form-actions>
        <slot name="cancel" slot="cancel"></slot>
        <wt-button
          variant="primary"
          data-test="add"
          .disabled=${this.busy}
          @click=${(event: Event) => this.#confirm(event)}
          >${t("add_products.confirm")}</wt-button
        >
      </wt-form-actions>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-section-add-products": SectionAddProducts;
  }
}
