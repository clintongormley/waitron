import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  currentContentLanguages,
  submitOnEnter,
  type DataTableColumn,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-modal.js";
import { isProductPrice } from "@waitron/catalogue/src/modifier-limits.js";
import type {
  CategorySummary,
  LibrarySection,
  MenuPriceRow,
  MenuVariant,
  Product,
} from "../api/client.js";
import { currentLocale, t } from "../i18n/t.js";
import { byLabel, categoryPath } from "./category-form.js";
import { switchField, textField, type FieldContext } from "./form-fields.js";

/** What saving one product's settings on the menu asks the host to write. `variants` is null for a
 * product with no Active variants, which has none to write. */
export interface OfferSave {
  menuItemId: string;
  /** The product's staff name, for a refusal reported away from the window. */
  name: string;
  grossPrice: string | null;
  active: boolean;
  variants: MenuVariant[] | null;
}

interface Draft {
  grossPrice: string;
  active: boolean;
  variants: { variantId: string; price: string; offered: boolean }[];
}

const blankToNull = (text: string): string | null => (text.trim() === "" ? null : text.trim());

/** Only a refusal naming the menu price is shown beside a field; any other goes to the summary. */
const refusedField = (field: string): string => (field === "grossPrice" ? field : "_form");

/**
 * One menu's prices, a row per product the menu reaches, and the window that edits one product's
 * settings on the menu: its price there, the menu's own switch, and each variant's price and
 * whether it is offered. The host performs the writes, opening and closing the window through
 * `editing` and reporting a refusal through `refusal`.
 */
@customElement("dashboard-menu-prices-table")
export class MenuPricesTable extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      wt-data-table::part(name) {
        overflow-wrap: anywhere;
        text-align: start;
      }
      wt-data-table::part(placement) {
        display: block;
        overflow-wrap: anywhere;
      }
      wt-data-table::part(note),
      wt-data-table::part(muted) {
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(note) {
        display: block;
        padding-inline: var(--wt-space-4);
        font-size: var(--wt-font-size-sm);
      }
      .fields {
        display: grid;
        gap: var(--wt-space-3);
        min-width: 0;
      }
      .help {
        margin: 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      fieldset {
        display: grid;
        gap: var(--wt-space-3);
        min-width: 0;
        margin: 0;
        padding: var(--wt-space-3) var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }
      legend {
        padding-inline: var(--wt-space-1);
        font-weight: var(--wt-font-weight-bold);
        overflow-wrap: anywhere;
      }
      h3 {
        margin: var(--wt-space-2) 0 0;
        font-size: var(--wt-font-size-md);
      }
    `,
  ];

  @property({ attribute: false }) rows: MenuPriceRow[] = [];
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) failed = false;
  /** The section library, for each placement's internal names. */
  @property({ attribute: false }) sections: LibrarySection[] = [];
  @property({ attribute: false }) categories: CategorySummary[] = [];
  /** The products with their variants, for each variant's name and own price. */
  @property({ attribute: false }) products: Product[] = [];
  @property() menuName = "";
  @property({ attribute: false }) editing: string | null = null;
  @property({ type: Boolean }) busy = false;
  /** The host's last save, refused: the field the refusal names, and what to say. */
  @property({ attribute: false }) refusal: { field: string; message: string } | null = null;

  @state() private draft: Draft | null = null;
  @state() private errors: Record<string, string> = {};

  #sectionNames: ReadonlyMap<string, string> = new Map();
  #categoryPaths: ReadonlyMap<string, string> = new Map();
  /** Each category with the categories above it, so a filter on a category keeps those inside it. */
  #categoryChains: ReadonlyMap<string, string[]> = new Map();
  #variants: ReadonlyMap<string, Product["variants"][number]> = new Map();
  #columns: DataTableColumn<MenuPriceRow>[] = [];
  #seededFor: string | null = null;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("sections"))
      this.#sectionNames = new Map(this.sections.map(({ id, internalName }) => [id, internalName]));
    if (changed.has("categories")) this.#readCategories();
    if (changed.has("products"))
      this.#variants = new Map(
        this.products.flatMap(({ variants }) => variants.map((variant) => [variant.id, variant])),
      );
    if (
      changed.has("sections") ||
      changed.has("categories") ||
      changed.has("rows") ||
      changed.has("busy")
    )
      this.#columns = this.#buildColumns();
    if (changed.has("editing") || changed.has("rows")) this.#seed();
    if (changed.has("refusal"))
      this.errors = this.refusal
        ? { [refusedField(this.refusal.field)]: this.refusal.message }
        : {};
  }

  #readCategories(): void {
    const language = currentLocale();
    const config = currentContentLanguages();
    this.#categoryPaths = new Map(
      this.categories.map((category) => [
        category.id,
        categoryPath(category, this.categories, language, config),
      ]),
    );
    const parents = new Map(this.categories.map(({ id, parentId }) => [id, parentId]));
    this.#categoryChains = new Map(
      this.categories.map(({ id }) => {
        const chain: string[] = [];
        for (
          let at: string | null | undefined = id;
          at && !chain.includes(at);
          at = parents.get(at)
        )
          chain.push(at);
        return [id, chain];
      }),
    );
  }

  /** Starts the draft from the stored settings once per opening, when the row is there to read. */
  #seed(): void {
    if (this.editing === null) {
      this.#seededFor = null;
      this.draft = null;
      return;
    }
    if (this.#seededFor === this.editing) return;
    const row = this.#row();
    if (row === undefined) return;
    this.#seededFor = this.editing;
    this.errors = {};
    this.draft = {
      grossPrice: row.override ?? "",
      active: row.active,
      variants: row.variants.map(({ variantId, price, offered }) => ({
        variantId,
        price: price ?? "",
        offered,
      })),
    };
  }

  #row(): MenuPriceRow | undefined {
    return this.rows.find(({ menuItemId }) => menuItemId === this.editing);
  }

  #placementName(path: readonly string[]): string {
    if (path.length === 0) return t("menu_prices.top_level");
    return path.map((id) => this.#sectionNames.get(id) ?? t("members.missing")).join(" › ");
  }

  #categoryName(row: MenuPriceRow): string {
    if (row.categoryId === null) return t("categories.uncategorised");
    return this.#categoryPaths.get(row.categoryId) ?? t("editor.missing_choice");
  }

  #emit(name: string, detail: object): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  #buildColumns(): DataTableColumn<MenuPriceRow>[] {
    const reached = new Set(this.rows.flatMap(({ placements }) => placements.flat()));
    const sectionOptions = [...reached]
      .map((id) => ({ value: id, label: this.#sectionNames.get(id) ?? t("members.missing") }))
      .sort((a, b) => byLabel(a.label, b.label));
    const categoryOptions = [...this.#categoryPaths]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => byLabel(a.label, b.label));
    // The table sorts text with numeric collation, which orders the server's two-place decimals
    // as amounts.
    const price = (key: string, label: string, read: (row: MenuPriceRow) => string | null) => ({
      key,
      label,
      align: "end" as const,
      sortValue: read,
    });
    return [
      {
        key: "name",
        label: t("menu_prices.product"),
        sortValue: (row) => row.name,
        searchValue: (row) => row.name,
        cell: (row) =>
          html`<wt-button
              variant="ghost"
              part="name"
              data-test=${`edit-${row.menuItemId}`}
              .disabled=${this.busy}
              @click=${(event: Event) => {
                event.stopPropagation();
                if (!this.busy) this.#emit("wt-offer-edit", { menuItemId: row.menuItemId });
              }}
              >${row.name}</wt-button
            >
            ${
              row.variants.length
                ? html`<span part="note">${t("menu_prices.has_variants")}</span>`
                : nothing
            }`,
      },
      {
        key: "placements",
        label: t("menu_prices.placements"),
        sortValue: (row) => this.#placementName(row.placements[0] ?? []),
        cell: (row) =>
          row.placements.map(
            (path) => html`<span part="placement">${this.#placementName(path)}</span> `,
          ),
        filter: {
          label: t("menu_prices.section_filter"),
          allLabel: t("menu_prices.all_sections"),
          value: (row) => row.placements.flat(),
          options: sectionOptions,
        },
      },
      {
        key: "category",
        label: t("editor.main_category"),
        sortValue: (row) => this.#categoryName(row),
        cell: (row) => this.#categoryName(row),
        filter: {
          label: t("menu_prices.category_filter"),
          allLabel: t("menu_prices.all_categories"),
          value: (row) =>
            row.categoryId === null ? [] : (this.#categoryChains.get(row.categoryId) ?? []),
          options: categoryOptions,
        },
      },
      {
        ...price("product-price", t("menu_prices.product_price"), (row) => row.productPrice),
        cell: (row) => row.productPrice ?? html`<span part="muted">—</span>`,
      },
      {
        ...price("menu-price", t("menu_prices.menu_price"), (row) => row.override),
        cell: (row) =>
          row.override ?? html`<span part="muted">${t("menu_prices.no_override")}</span>`,
        filter: {
          label: t("menu_prices.price_filter"),
          allLabel: t("menu_prices.all_prices"),
          value: (row) => (row.override === null ? "product" : "overridden"),
          options: [{ value: "overridden", label: t("menu_prices.overridden_only") }],
        },
      },
      {
        ...price("effective-price", t("menu_prices.effective_price"), (row) => row.effectivePrice),
        cell: (row) => row.effectivePrice,
      },
      {
        key: "active",
        label: t("menu_prices.on_menu"),
        sortValue: (row) => (row.active ? 0 : 1),
        cell: (row) =>
          row.active
            ? t("menu_prices.sold_here")
            : html`<span part="muted">${t("menu_prices.switched_off")}</span>`,
      },
    ];
  }

  #edit(change: (draft: Draft) => Draft, clears: string): void {
    this.draft = change(this.draft!);
    if (clears in this.errors)
      this.errors = Object.fromEntries(
        Object.entries(this.errors).filter(([field]) => field !== clears),
      );
  }

  #editVariant(index: number, change: Partial<Draft["variants"][number]>, clears: string): void {
    this.#edit(
      (draft) => ({
        ...draft,
        variants: draft.variants.map((variant, at) =>
          at === index ? { ...variant, ...change } : variant,
        ),
      }),
      clears,
    );
  }

  #save(): void {
    const draft = this.draft;
    if (draft === null || this.busy) return;
    const errors: Record<string, string> = {};
    const grossPrice = blankToNull(draft.grossPrice);
    if (grossPrice !== null && !isProductPrice(grossPrice))
      errors.grossPrice = t("editor.price_invalid");
    const variants = draft.variants.map(({ variantId, price, offered }, index) => {
      const own = blankToNull(price);
      if (own !== null && !isProductPrice(own))
        errors[`variants.${index}.price`] = t("editor.price_invalid");
      return { variantId, price: own, offered };
    });
    this.errors = errors;
    if (Object.keys(errors).length) return;
    this.#emit("wt-offer-save", {
      menuItemId: this.editing!,
      name: this.#row()!.name,
      grossPrice,
      active: draft.active,
      variants: variants.length ? variants : null,
    } satisfies OfferSave);
  }

  #cancel(): void {
    if (!this.busy) this.#emit("wt-offer-cancel", {});
  }

  #renderForm(row: MenuPriceRow, draft: Draft) {
    const context: FieldContext = {
      busy: this.busy,
      locales: [],
      error: (key) => this.errors[key] ?? "",
    };
    const productPrice = row.productPrice ?? "";
    const typed = draft.grossPrice.trim();
    // A variant with no price of its own sells at the product's price on this menu
    // (`resolveOfferPrice`), taken from the field while it holds a valid price.
    const productHere = isProductPrice(typed) ? typed : productPrice;
    return html`<div
      class="fields"
      @keydown=${(event: KeyboardEvent) =>
        submitOnEnter(
          event,
          this.shadowRoot!.querySelector<HTMLElement>('[data-test="offer-save"]'),
        )}
    >
      <wt-form-error-summary
        heading=${t("form.error_heading")}
        .errors=${Object.values(this.errors)}
      ></wt-form-error-summary>
      ${textField(
        context,
        "grossPrice",
        t("menu_prices.override"),
        draft.grossPrice,
        (value) => this.#edit((current) => ({ ...current, grossPrice: value }), "grossPrice"),
        false,
        productPrice,
        t("menu_prices.override_help").replace("{price}", productPrice),
      )}
      ${
        draft.grossPrice !== ""
          ? html`<div>
              <wt-button
                variant="secondary"
                data-test="use-product-price"
                .disabled=${this.busy}
                @click=${() =>
                  this.#edit((current) => ({ ...current, grossPrice: "" }), "grossPrice")}
                >${t("menu_prices.use_product_price")}</wt-button
              >
            </div>`
          : nothing
      }
      ${switchField(context, "active", t("menu_prices.active"), draft.active, (active) =>
        this.#edit((current) => ({ ...current, active }), "active"),
      )}
      ${
        draft.variants.length
          ? html`<h3>${t("menu_prices.variants")}</h3>
              <p class="help">${t("menu_prices.variants_help")}</p>
              ${draft.variants.map((variant, index) => {
                const known = this.#variants.get(variant.variantId);
                return html`<fieldset>
                  <legend>${known?.name ?? t("members.missing")}</legend>
                  ${textField(
                    context,
                    `variants.${index}.price`,
                    t("menu_prices.override"),
                    variant.price,
                    (price) => this.#editVariant(index, { price }, `variants.${index}.price`),
                    false,
                    known?.unitPrice ?? productHere,
                  )}
                  ${switchField(
                    context,
                    `variants.${index}.offered`,
                    t("menu_prices.variant_offered"),
                    variant.offered,
                    (offered) => this.#editVariant(index, { offered }, `variants.${index}.offered`),
                  )}
                </fieldset>`;
              })}`
          : nothing
      }
    </div>`;
  }

  #renderModal() {
    const row = this.#row();
    const draft = this.draft;
    const form = row !== undefined && draft !== null ? { row, draft } : null;
    return html`<wt-modal
      .open=${form !== null}
      heading=${
        form
          ? t("menu_prices.edit_heading")
              .replace("{name}", form.row.name)
              .replace("{menu}", this.menuName)
          : ""
      }
      @keydown=${(event: KeyboardEvent) => {
        if (this.busy && event.key === "Escape") event.preventDefault();
      }}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (this.editing !== null) this.#cancel();
      }}
    >
      ${form ? this.#renderForm(form.row, form.draft) : nothing}
      <wt-form-actions slot="footer"
        ><wt-button
          slot="cancel"
          variant="secondary"
          data-test="offer-cancel"
          .disabled=${this.busy}
          @click=${() => this.#cancel()}
          >${t("action.cancel")}</wt-button
        ><wt-button
          variant="primary"
          data-test="offer-save"
          .loading=${this.busy}
          .disabled=${this.busy}
          @click=${() => this.#save()}
          >${t("action.save")}</wt-button
        ></wt-form-actions
      >
    </wt-modal>`;
  }

  override render() {
    return html`<wt-data-table
        aria-label=${t("menu_prices.label").replace("{menu}", this.menuName)}
        viewKey="waitron.menus.prices"
        searchable
        searchLabel=${t("menu_prices.search")}
        .rows=${this.rows}
        .columns=${this.#columns}
        .rowKey=${(row: MenuPriceRow) => row.menuItemId}
        .loading=${this.loading}
        loadingMessage=${t("menu_prices.loading")}
        errorMessage=${this.failed ? t("menu_prices.error") : ""}
        emptyMessage=${t("menu_prices.empty")}
        noMatchesMessage=${t("menu_prices.no_matches")}
      ></wt-data-table>
      ${this.#renderModal()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-menu-prices-table": MenuPricesTable;
  }
}
