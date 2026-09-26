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
import { stringToCents } from "@waitron/shared";
import type {
  CategorySummary,
  LibrarySection,
  MenuPriceRow,
  MenuVariant,
  Product,
} from "../api/client.js";
import { currentLocale, t } from "../i18n/t.js";
import { byLabel, categoryAncestors, categoryPath } from "./category-form.js";
import { switchField, textField, type FieldContext } from "./form-fields.js";

/** What saving one product's settings on the menu asks the host to write. `item` is null when the
 * menu's price and switch are unchanged, and `variants` is null when no variant changed, which
 * includes a product with no Active variants. */
export interface OfferSave {
  menuItemId: string;
  /** The product's staff name, for a refusal reported away from the window. */
  name: string;
  item: { grossPrice: string | null; active: boolean } | null;
  variants: MenuVariant[] | null;
}

interface Draft {
  grossPrice: string;
  active: boolean;
  variants: { variantId: string; price: string; offered: boolean }[];
}

const blankToNull = (text: string): string | null => (text.trim() === "" ? null : text.trim());

/** By amount, so "2.5" typed over a stored "2.50" is no change. */
const samePrice = (a: string | null, b: string | null): boolean =>
  a === null || b === null ? a === b : stringToCents(a) === stringToCents(b);

/** Only a refusal naming the menu price is shown beside a field; any other goes to the summary. */
const refusedField = (field: string): string => (field === "grossPrice" ? field : "_form");

/** A table row: a product the menu reaches, or one of its Active variants, drawn under it. */
interface Line {
  item: MenuPriceRow;
  variant: MenuVariant | null;
}

/** The lowest and highest of some prices, each as written and as an amount. */
interface Span {
  low: string;
  high: string;
  lowCents: number;
  highCents: number;
}

interface LinePrices {
  /** The catalogue's price, independent of this menu; for a product sold as its variants, the
   * range over every one of them. */
  catalogue: Span;
  /** What this menu charges; for a product sold as its variants, the range over the offered ones,
   * and null when none is. */
  charged: Span | null;
  /** Whether a price this menu sets is what is charged; for a product sold as its variants,
   * whether it is for at least one offered variant. */
  menuApplies: boolean;
}

function span(prices: readonly string[]): Span | null {
  if (prices.length === 0) return null;
  const amounts = prices.map((price) => ({ price, cents: stringToCents(price) }));
  const low = amounts.reduce((least, next) => (next.cents < least.cents ? next : least));
  const high = amounts.reduce((most, next) => (next.cents > most.cents ? next : most));
  return { low: low.price, high: high.price, lowCents: low.cents, highCents: high.cents };
}

const priced = (
  catalogue: readonly string[],
  charged: readonly string[],
  menuApplies: boolean,
): LinePrices => ({ catalogue: span(catalogue)!, charged: span(charged), menuApplies });

const spanText = ({ low, high, lowCents, highCents }: Span): string =>
  lowCents === highCents
    ? low
    : t("menu_prices.range").replace("{low}", low).replace("{high}", high);

const muted = (content: unknown) => html`<span part="muted">${content}</span>`;

/**
 * One menu's prices, a row per product the menu reaches with its Active variants under it, and the
 * window that edits one product's settings on the menu: its price there, the menu's own switch, and
 * each variant's price and whether it is offered. The host performs the writes, opening and
 * closing the window through `editing` and reporting a refusal through `refusal`.
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
      /* A product's name sits inside a padded button, so a variant's needs padding of its own to
         sit visibly further in. */
      wt-data-table::part(variant-name) {
        display: inline-block;
        padding-inline-start: var(--wt-space-4);
        overflow-wrap: anywhere;
      }
      wt-data-table::part(placement) {
        display: block;
        overflow-wrap: anywhere;
      }
      wt-data-table::part(note),
      wt-data-table::part(muted) {
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(visually-hidden) {
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
  /** Each row's sections, every placement's together, for the section filter. */
  #reached: ReadonlyMap<MenuPriceRow, string[]> = new Map();
  #categoryPaths: ReadonlyMap<string, string> = new Map();
  /** Each category with the categories above it, so a filter on a category keeps those inside it. */
  #categoryChains: ReadonlyMap<string, string[]> = new Map();
  #variants: ReadonlyMap<string, Product["variants"][number]> = new Map();
  #lines: Line[] = [];
  #prices: ReadonlyMap<Line, LinePrices> = new Map();
  #columns: DataTableColumn<Line>[] = [];
  /** The row as the window opened with it. A save compares the draft with this, not with the row
   * the live read keeps replacing, so a change someone else made meanwhile is not written back. */
  #opened: MenuPriceRow | null = null;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("sections"))
      this.#sectionNames = new Map(this.sections.map(({ id, internalName }) => [id, internalName]));
    if (changed.has("categories")) this.#readCategories();
    if (changed.has("rows"))
      this.#reached = new Map(this.rows.map((row) => [row, row.placements.flat()]));
    if (changed.has("products"))
      this.#variants = new Map(
        this.products.flatMap(({ variants }) => variants.map((variant) => [variant.id, variant])),
      );
    if (changed.has("rows") || changed.has("products")) this.#readLines();
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
    this.#categoryChains = new Map(
      this.categories.map((category) => [
        category.id,
        categoryAncestors(category, this.categories).map(({ id }) => id),
      ]),
    );
  }

  #readLines(): void {
    const lines: Line[] = [];
    const prices = new Map<Line, LinePrices>();
    for (const item of this.rows) {
      const variants = item.variants.map((variant) => {
        const own = this.#variants.get(variant.variantId)?.unitPrice ?? null;
        return {
          line: { item, variant },
          offered: variant.offered,
          catalogue: own ?? item.productPrice,
          // The server's chain, `resolveOfferPrice`.
          charged: variant.price ?? own ?? item.effectivePrice,
          menuApplies: variant.price !== null || (own === null && item.override !== null),
        };
      });
      const offered = variants.filter((variant) => variant.offered);
      const product = { item, variant: null };
      prices.set(
        product,
        variants.length
          ? priced(
              variants.map(({ catalogue }) => catalogue),
              offered.map(({ charged }) => charged),
              offered.some(({ menuApplies }) => menuApplies),
            )
          : priced([item.productPrice], [item.effectivePrice], item.override !== null),
      );
      lines.push(product);
      for (const { line, catalogue, charged, menuApplies } of variants) {
        prices.set(line, priced([catalogue], [charged], menuApplies));
        lines.push(line);
      }
    }
    this.#lines = lines;
    this.#prices = prices;
  }

  #variantName(variantId: string): string {
    return this.#variants.get(variantId)?.name ?? t("members.missing");
  }

  /** The price charged beside the catalogue's, as #541 agreed for the menu offers list: struck
   * through when a menu price changes it, muted when no menu price applies. */
  #chargedHere(line: Line) {
    const { catalogue, charged, menuApplies } = this.#prices.get(line)!;
    if (charged === null) return muted(t("menu_prices.no_variant_offered"));
    const text = spanText(charged);
    if (!menuApplies)
      return muted(
        html`${text}<span part="visually-hidden"> ${t("menu_prices.price_inherited")}</span>`,
      );
    if (catalogue.lowCents === charged.lowCents && catalogue.highCents === charged.highCents)
      return text;
    return html`<span part="visually-hidden">${t("menu_prices.price_was")} </span
      ><s>${spanText(catalogue)}</s> ${text}`;
  }

  /** Starts the draft from the stored settings once per opening, when the row is there to read. */
  #seed(): void {
    if (this.editing === null) {
      this.#opened = null;
      this.draft = null;
      return;
    }
    if (this.#opened?.menuItemId === this.editing) return;
    const row = this.#row();
    if (row === undefined) return;
    this.#opened = row;
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

  #buildColumns(): DataTableColumn<Line>[] {
    const reached = new Set([...this.#reached.values()].flat());
    const sectionOptions = [...reached]
      .map((id) => ({ value: id, label: this.#sectionNames.get(id) ?? t("members.missing") }))
      .sort((a, b) => byLabel(a.label, b.label));
    const categoryOptions = [...this.#categoryPaths]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => byLabel(a.label, b.label));
    const prices = (line: Line) => this.#prices.get(line)!;
    const menuPrice = ({ item, variant }: Line) => (variant ? variant.price : item.override);
    /** Whether a product sets a menu price on any of its variants, offered or not. */
    const variantPriced = ({ item, variant }: Line) =>
      variant === null && item.variants.some(({ price }) => price !== null);
    const price = (
      key: string,
      label: string,
      read: (line: Line) => Span | string | null,
      choosable: "shown" | "hidden" = "shown",
    ) => ({
      key,
      label,
      align: "end" as const,
      choosable,
      // A range sorts by its low end.
      sortValue: (line: Line) => {
        const value = read(line);
        if (value === null) return null;
        return typeof value === "string" ? stringToCents(value) : value.lowCents;
      },
      searchValue: (line: Line) => {
        const value = read(line);
        if (value === null) return "";
        return typeof value === "string" ? value : `${value.low} ${value.high}`;
      },
    });
    return [
      {
        key: "name",
        label: t("menu_prices.product"),
        sortValue: ({ item, variant }) =>
          variant ? this.#variantName(variant.variantId) : item.name,
        searchValue: ({ item, variant }) =>
          variant ? `${this.#variantName(variant.variantId)} ${item.name}` : item.name,
        cell: ({ item, variant }) =>
          variant
            ? html`<span part="variant-name">${this.#variantName(variant.variantId)}</span>`
            : html`<wt-button
                  variant="ghost"
                  part="name"
                  data-test=${`edit-${item.menuItemId}`}
                  .disabled=${this.busy}
                  @click=${(event: Event) => {
                    event.stopPropagation();
                    if (!this.busy) this.#emit("wt-offer-edit", { menuItemId: item.menuItemId });
                  }}
                  >${item.name}</wt-button
                >
                ${
                  item.variants.length
                    ? html`<span part="note">${t("menu_prices.has_variants")}</span>`
                    : nothing
                }`,
      },
      {
        key: "placements",
        label: t("menu_prices.placements"),
        choosable: "shown",
        sortValue: ({ item }) => this.#placementName(item.placements[0] ?? []),
        cell: ({ item, variant }) =>
          variant
            ? nothing
            : item.placements.map(
                (path) => html`<span part="placement">${this.#placementName(path)}</span> `,
              ),
        filter: {
          label: t("menu_prices.section_filter"),
          allLabel: t("menu_prices.all_sections"),
          value: ({ item }) => this.#reached.get(item)!,
          options: sectionOptions,
        },
      },
      {
        key: "category",
        label: t("editor.main_category"),
        choosable: "shown",
        sortValue: ({ item }) => this.#categoryName(item),
        cell: ({ item, variant }) => (variant ? nothing : this.#categoryName(item)),
        filter: {
          label: t("menu_prices.category_filter"),
          allLabel: t("menu_prices.all_categories"),
          value: ({ item }) =>
            item.categoryId === null ? [] : (this.#categoryChains.get(item.categoryId) ?? []),
          options: categoryOptions,
        },
      },
      {
        ...price("product-price", t("menu_prices.product_price"), (line) => prices(line).catalogue),
        cell: (line) => spanText(prices(line).catalogue),
      },
      {
        ...price("menu-price", t("menu_prices.menu_price"), menuPrice),
        cell: (line) => {
          const set = menuPrice(line);
          if (set !== null) return set;
          return variantPriced(line)
            ? t("menu_prices.variant_overrides")
            : muted(t("menu_prices.no_override"));
        },
        filter: {
          label: t("menu_prices.price_filter"),
          allLabel: t("menu_prices.all_prices"),
          value: (line) =>
            menuPrice(line) !== null || variantPriced(line) ? "overridden" : "product",
          options: [{ value: "overridden", label: t("menu_prices.overridden_only") }],
        },
      },
      {
        ...price(
          "effective-price",
          t("menu_prices.effective_price"),
          (line) => prices(line).charged,
        ),
        cell: (line) => {
          const charged = prices(line).charged;
          return charged ? spanText(charged) : muted(t("menu_prices.no_variant_offered"));
        },
      },
      {
        ...price(
          "price-on-menu",
          t("menu_prices.price_on_menu"),
          (line) => prices(line).charged,
          "hidden",
        ),
        cell: (line) => this.#chargedHere(line),
      },
      {
        key: "active",
        label: t("menu_prices.on_menu"),
        choosable: "shown",
        sortValue: ({ item, variant }) => ((variant ? variant.offered : item.active) ? 0 : 1),
        cell: ({ item, variant }) => {
          if (variant)
            return variant.offered ? t("menu_prices.offered") : muted(t("menu_prices.not_offered"));
          return item.active ? t("menu_prices.sold_here") : muted(t("menu_prices.switched_off"));
        },
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

  #save(event: Event): void {
    event.stopPropagation();
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
    const row = this.#opened!;
    // The draft's variants were built from the opened row's, one for one and in its order.
    const variantsChanged = variants.some(({ price, offered }, at) => {
      const was = row.variants[at]!;
      return was.offered !== offered || !samePrice(price, was.price);
    });
    this.#emit("wt-offer-save", {
      menuItemId: this.editing!,
      name: row.name,
      item:
        samePrice(grossPrice, row.override) && draft.active === row.active
          ? null
          : { grossPrice, active: draft.active },
      variants: variantsChanged ? variants : null,
    } satisfies OfferSave);
  }

  #cancel(event: Event): void {
    event.stopPropagation();
    if (!this.busy) this.#emit("wt-offer-cancel", {});
  }

  #renderForm(row: MenuPriceRow, draft: Draft) {
    const context: FieldContext = {
      busy: this.busy,
      locales: [],
      error: (key) => this.errors[key] ?? "",
    };
    const productPrice = row.productPrice;
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
        if (this.editing !== null) this.#cancel(event);
      }}
    >
      ${form ? this.#renderForm(form.row, form.draft) : nothing}
      <wt-form-actions slot="footer"
        ><wt-button
          slot="cancel"
          variant="secondary"
          data-test="offer-cancel"
          .disabled=${this.busy}
          @click=${(event: Event) => this.#cancel(event)}
          >${t("action.cancel")}</wt-button
        ><wt-button
          variant="primary"
          data-test="offer-save"
          .loading=${this.busy}
          .disabled=${this.busy}
          @click=${(event: Event) => this.#save(event)}
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
        columnsLabel=${t("menu_prices.columns")}
        .rows=${this.#lines}
        .columns=${this.#columns}
        .rowKey=${({ item, variant }: Line) =>
          variant ? `${item.menuItemId}:${variant.variantId}` : item.menuItemId}
        .rowParent=${({ item, variant }: Line) => (variant ? item.menuItemId : null)}
        initiallyCollapsed
        .rowToggleLabel=${({ item }: Line, expanded: boolean) =>
          t(expanded ? "menu_prices.collapse" : "menu_prices.expand").replace("{name}", item.name)}
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
