import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles, draftScopeFor, saveActionState, type DraftScope } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { byLabel, categoryPath, categoryWithDescendants } from "./category-form.js";
import { searchBy } from "@waitron/shared";
import type { CategorySummary } from "../api/client.js";
import { t } from "../i18n/t.js";

export interface AddableProduct {
  id: string;
  /** The staff name. */
  name: string;
  /** The main reporting category, or null when it has none. */
  categoryId: string | null;
}

/**
 * Picks several products to add to one section. A product the section already holds is not
 * offered; one elsewhere on the menu around it is only marked, since a product may sit in several
 * sections. A host may put its own Cancel in the `cancel` slot, which lands beside the confirm
 * action.
 */
@customElement("dashboard-section-add-products")
export class SectionAddProducts extends LitElement {
  static override styles = [
    baseStyles,
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
      /* A fixed basis, so choosing a category does not move the search field beside it. */
      .category {
        flex: 0 1 calc(var(--wt-space-6) * 6);
        min-width: 0;
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
      li,
      .head {
        border-bottom: 1px solid var(--wt-color-border);
      }
      .head {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
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
  /** Every product the section does not already hold, by name. */
  #offered: AddableProduct[] = [];
  #options: { id: string; path: string }[] = [];
  /** Null when no category is chosen. */
  #within: ReadonlySet<string> | null = null;
  #scope?: DraftScope<string[]>;

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }

  commitSaved(productIds: readonly string[]): void {
    this.#scope?.commit([...productIds].sort());
  }

  override willUpdate(changed: PropertyValues): void {
    if (this.isConnected && !this.#scope) {
      this.#scope = draftScopeFor<string[]>(this, {
        id: this,
        current: () => [...this.selected].sort(),
        snapshot: (value) => [...value],
        equal: (a, b) => a.length === b.length && a.every((id, index) => id === b[index]),
        restore: (value) => {
          this.selected = new Set(value);
        },
      }).scope;
    }
    if (changed.has("products") || changed.has("inSection")) {
      const held = new Set(this.inSection);
      this.#offered = this.products
        .filter((product) => !held.has(product.id))
        .sort((a, b) => byLabel(a.name, b.name));
    }
    // A category deleted under the filter would otherwise hide every product behind a dropdown
    // that has fallen back to "All categories".
    if (
      changed.has("categories") &&
      !this.categories.some((category) => category.id === this.categoryId)
    )
      this.categoryId = "";
    if (changed.has("categories")) {
      this.#options = this.categories
        .map((category) => ({ id: category.id, path: categoryPath(category, this.categories) }))
        .sort((a, b) => byLabel(a.path, b.path));
    }
    if (changed.has("categories") || changed.has("categoryId"))
      this.#within = this.categoryId
        ? categoryWithDescendants(this.categoryId, this.categories)
        : null;
  }

  #chosen(): string[] {
    return this.#offered.filter((product) => this.selected.has(product.id)).map(({ id }) => id);
  }

  #visible(): AddableProduct[] {
    const within = this.#within;
    const offered = this.#offered.filter(
      (product) =>
        within === null || (product.categoryId !== null && within.has(product.categoryId)),
    );
    return searchBy(this.search, offered, (product) => product.name);
  }

  #toggle(event: Event, productId: string): void {
    event.stopPropagation();
    const selected = new Set(this.selected);
    if (!selected.delete(productId)) selected.add(productId);
    this.selected = selected;
    this.#scope?.changed();
    this.error = false;
  }

  #toggleListed(event: Event, listed: AddableProduct[]): void {
    event.stopPropagation();
    const selected = new Set(this.selected);
    if (listed.every(({ id }) => selected.has(id)))
      for (const { id } of listed) selected.delete(id);
    else for (const { id } of listed) selected.add(id);
    this.selected = selected;
    this.#scope?.changed();
    this.error = false;
  }

  #confirm(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    if (saveActionState(this.#scope).unchanged) return;
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

  #item(product: AddableProduct, onMenu: Set<string>) {
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
          onMenu.has(product.id)
            ? html`<span class="mark">${t("add_products.on_menu")}</span>`
            : nothing
        }
      </label>
    </li>`;
  }

  #header(listed: AddableProduct[]) {
    const chosen = listed.filter(({ id }) => this.selected.has(id)).length;
    const all = listed.length > 0 && chosen === listed.length;
    return html`<div class="head">
      <label class="pick">
        <input
          type="checkbox"
          name="select-listed"
          data-test="select-listed"
          aria-label=${t("add_products.select_listed_label")}
          .checked=${all}
          .indeterminate=${chosen > 0 && !all}
          .disabled=${this.busy || listed.length === 0}
          @change=${(event: Event) => this.#toggleListed(event, listed)}
        />
        <span class="name">${t("add_products.select_listed")}</span>
      </label>
    </div>`;
  }

  #list() {
    if (this.products.length === 0)
      return html`<p class="notice" data-test="empty">${t("add_products.empty")}</p>`;
    if (this.#offered.length === 0)
      return html`<p class="notice" data-test="all-in-section">
        ${t("add_products.all_in_section")}
      </p>`;
    const visible = this.#visible();
    if (visible.length === 0)
      return html`${this.#header(visible)}
        <p class="notice" data-test="no-matches">${t("add_products.no_matches")}</p>`;
    const onMenu = new Set(this.onMenu ?? []);
    return html`${this.#header(visible)}
      <ul>
        ${repeat(
          visible,
          (product) => product.id,
          (product) => this.#item(product, onMenu),
        )}
      </ul>`;
  }

  override render() {
    const count = this.#chosen().length;
    const addAction = saveActionState(this.#scope);
    return html`<div class="filters">
        <wt-combobox
          class="category"
          name="category"
          label=${t("add_products.category")}
          search="auto"
          placeholder=${t("add_products.all_categories")}
          searchPlaceholder=${t("categories.combobox_search")}
          noResultsLabel=${t("categories.combobox_no_results")}
          .options=${[
            { value: "", label: t("add_products.all_categories") },
            ...this.#options.map((option) => ({ value: option.id, label: option.path })),
          ]}
          .value=${this.categoryId}
          .disabled=${this.busy}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.categoryId = event.detail.value;
          }}
        ></wt-combobox>
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
          variant=${addAction.variant}
          data-test="add"
          .disabled=${addAction.unchanged || this.busy}
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
