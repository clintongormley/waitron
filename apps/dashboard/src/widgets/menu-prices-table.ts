import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import { baseStyles, focusFirstInvalid, submitOnEnter, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-price-input.js";
import { describeSetting, placeName } from "./price-source.js";
import {
  productInherited,
  sizeClash,
  variantInherited,
  withoutOwn,
  type Inherited,
  type ParentPrice,
} from "./menu-price-inheritance.js";
import type { Setting } from "../api/client.js";
import type { Decimal } from "@waitron/shared";
import { isProductPrice } from "@waitron/catalogue/src/modifier-limits.js";
import { stringToCents } from "@waitron/shared";
import type {
  CategorySummary,
  SectionDetails,
  MenuPriceRow,
  MenuPriceVariant,
  MenuStructureNode,
  MenuVariant,
  Product,
} from "../api/client.js";
import { currentLocale, t } from "../i18n/t.js";
import { byLabel, categoryAncestors, categoryPath } from "./category-form.js";
import { priceField, priceSearchText, priceText, type FieldContext } from "./form-fields.js";

/** What saving one product's prices on the menu asks the host to write. `item` is null when the
 * menu's price is unchanged, and `variants` is null when no variant changed, which includes a
 * product with no Active variants. */
export interface OfferSave {
  menuItemId: string;
  /** The product's staff name, for a refusal reported away from the window. */
  name: string;
  item: { grossPrice?: string | null } | null;
  variants: MenuVariant[] | null;
}

interface Draft {
  grossPrice: string;
  variants: { variantId: string; price: string }[];
}

const blankToNull = (text: string): string | null => (text.trim() === "" ? null : text.trim());

/** By amount, so "2.5" typed over a stored "2.50" is no change. */
const samePrice = (a: string | null, b: string | null): boolean =>
  a === null || b === null ? a === b : stringToCents(a) === stringToCents(b);

/** Only a refusal naming the menu price is shown beside a field; any other goes to the bottom
 * message. */
const refusedField = (field: string): string => (field === "grossPrice" ? field : "_form");

/** A table row: a product the menu reaches, or one of its sizes, Active or not, drawn under it. */
interface Line {
  item: MenuPriceRow;
  variant: MenuPriceVariant | null;
}

type Span = { low: string; high: string };

const oneAmount = ({ low, high }: Span): boolean => stringToCents(low) === stringToCents(high);

const spanText = (span: Span): string =>
  oneAmount(span)
    ? priceText(span.low)
    : t("menu_prices.range")
        .replace("{low}", priceText(span.low))
        .replace("{high}", priceText(span.high));

/** The amounts as typed into a price field, which draws no sign. */
const spanAmounts = (span: Span): string =>
  oneAmount(span)
    ? span.low
    : t("menu_prices.range").replace("{low}", span.low).replace("{high}", span.high);

/**
 * One menu's price overrides: a row per product the menu reaches, Active or not, with its sizes
 * under it, each showing its Active state and a field for the price this menu sets for it; and the
 * window that edits one product's prices on the menu. The host performs the writes, opening and
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
      wt-data-table::part(price-cell) {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: var(--wt-space-1);
      }
      /* Wide enough that a range placeholder shows whole rather than clipped into one price. Its
         positioned box holds the field's hidden hint, which otherwise escapes the table's scroller
         and widens the page. */
      wt-data-table::part(override-field) {
        position: relative;
        --wt-price-field-width: var(--wt-price-range-field-width);
      }
      wt-data-table::part(status-link) {
        display: inline-flex;
        align-items: center;
        min-height: var(--wt-tap-min);
        color: var(--wt-color-primary);
      }
      wt-data-table::part(status-note) {
        font-size: var(--wt-font-size-sm);
      }
      wt-data-table::part(clash) {
        color: var(--wt-color-danger);
        font-weight: var(--wt-font-weight-bold);
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
  @property({ attribute: false }) nodes: MenuStructureNode[] = [];
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) failed = false;
  @property({ attribute: false }) sections: SectionDetails[] = [];
  @property({ attribute: false }) categories: CategorySummary[] = [];
  /** The products with their variants, for each variant's name. */
  @property({ attribute: false }) products: Product[] = [];
  @property() menuName = "";
  @property({ attribute: false }) editing: string | null = null;
  @property({ type: Boolean }) busy = false;
  /** The host's last save, refused: the field the refusal names, and what to say. */
  @property({ attribute: false }) refusal: { field: string; message: string } | null = null;

  @state() private draft: Draft | null = null;
  /** The host's refusal, less any field the operator has changed since. */
  @state() private refused: Record<string, string> = {};
  @state() private attempted = false;

  #sectionNames: ReadonlyMap<string, string> = new Map();
  /** Each row's sections, every placement's together, for the section filter. */
  #reached: ReadonlyMap<MenuPriceRow, string[]> = new Map();
  #categoryPaths: ReadonlyMap<string, string> = new Map();
  /** Each category with the categories above it, so a filter on a category keeps those inside it. */
  #categoryChains: ReadonlyMap<string, string[]> = new Map();
  #variants: ReadonlyMap<string, Product["variants"][number]> = new Map();
  #lines: Line[] = [];
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
      this.refused = this.refusal
        ? { [refusedField(this.refusal.field)]: this.refusal.message }
        : {};
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("refusal") && this.#fieldKeys(this.refused).length > 0)
      void this.#focusInvalid();
  }

  #focusInvalid(): Promise<HTMLElement | null> {
    return focusFirstInvalid(this.shadowRoot!.querySelector("wt-modal")!);
  }

  #readCategories(): void {
    this.#categoryPaths = new Map(
      this.categories.map((category) => [category.id, categoryPath(category, this.categories)]),
    );
    this.#categoryChains = new Map(
      this.categories.map((category) => [
        category.id,
        categoryAncestors(category, this.categories).map(({ id }) => id),
      ]),
    );
  }

  #priceSetting({ item, variant }: Line): Setting<Decimal> {
    return variant
      ? item.combined.variants.find((v) => v.variantId === variant.variantId)!.price
      : item.combined.price;
  }

  #before(setting: Setting<Decimal>): Setting<Decimal> {
    return setting.state === "decided" ? (setting.otherwise ?? setting) : setting;
  }

  #readLines(): void {
    this.#lines = this.rows.flatMap((item) => [
      { item, variant: null },
      ...item.variants.map((variant) => ({ item, variant })),
    ]);
  }

  #active({ item, variant }: Line): boolean {
    return item.active && (variant?.active ?? true);
  }

  /** The price this menu stores for the row, or null. */
  #stored({ item, variant }: Line): string | null {
    return variant ? variant.price : item.override;
  }

  /** Whether this menu stores a price for the row, or, on a product, for any of its sizes. */
  #overridden(line: Line): boolean {
    return (
      this.#stored(line) !== null ||
      (line.variant === null && line.item.variants.some(({ price }) => price !== null))
    );
  }

  /** The product's price as its field reads now, which a size following it inherits; undefined
   * while the field holds no draft, which is always until the row edits in place. */
  #parentPrice(): ParentPrice {
    return undefined;
  }

  /** What the row charges with its field left blank. */
  #inherited(line: Line): Inherited {
    return line.variant
      ? variantInherited(line.item, line.variant.variantId, this.#parentPrice())
      : productInherited(line.item);
  }

  /** What the row charges: its stored price, else what it inherits. */
  #shown(line: Line): Inherited {
    const stored = this.#stored(line);
    return stored === null ? this.#inherited(line) : { state: "price", low: stored, high: stored };
  }

  /** "size" for a product row whose own price is decided but an Active size's is not; "own" for a
   * row whose own price, or what it inherits, is undecided. */
  #clash(line: Line): "size" | "own" | null {
    if (line.variant === null && sizeClash(line.item)) return "size";
    return this.#priceSetting(line).state === "clash" || this.#inherited(line).state === "clash"
      ? "own"
      : null;
  }

  #lineName({ item, variant }: Line): string {
    return variant ? `${item.name} — ${this.#variantName(variant.variantId)}` : item.name;
  }

  /** Where the price a blank field would take comes from; a product with sizes explains each of
   * its Active sizes. */
  #tip(line: Line) {
    const { item, variant } = line;
    const names = { product: item.name };
    const sizes = variant === null ? item.variants.filter((size) => size.active) : [];
    let explanation: string;
    if (variant) {
      const under = withoutOwn(this.#priceSetting(line));
      explanation = describeSetting(under, names, t);
      if (under.state === "decided" && under.source.kind === "parent")
        explanation += ` ${describeSetting(withoutOwn(item.combined.price), names, t)}`;
    } else if (sizes.length === 0)
      explanation = describeSetting(withoutOwn(item.combined.price), names, t);
    else
      explanation = sizes
        .map((size) => {
          const setting = this.#priceSetting({ item, variant: size });
          const price =
            setting.state === "decided" ? priceText(setting.value) : t("menu_prices.clash");
          return `${this.#variantName(size.variantId)}: ${price}. ${describeSetting(setting, names, t)}`;
        })
        .join(" ");
    return html`<wt-help-tooltip
      aria-label=${t("menu_prices.tip_inherited").replace("{name}", this.#lineName(line))}
      >${explanation}</wt-help-tooltip
    >`;
  }

  #status(line: Line) {
    const active = this.#active(line);
    const id = line.variant?.variantId ?? line.item.productId;
    const word = t(active ? "product.active_badge" : "product.inactive_badge");
    const viaParent = line.variant !== null && line.variant.active && !line.item.active;
    return html`<a
        part="status-link"
        data-active=${active ? "true" : "false"}
        href=${`/manage/catalogue/product/${encodeURIComponent(id)}`}
        aria-label=${`${word}: ${t("menu_prices.open_product").replace("{name}", this.#lineName(line))}`}
        @click=${(event: MouseEvent) => this.#openProduct(event, id)}
        >${word}</a
      >${
        viaParent
          ? html` <span part="muted status-note">${t("menu_prices.status_parent_inactive")}</span>`
          : nothing
      }`;
  }

  /** A product opens in the dashboard's own catalogue screen; a held modifier key keeps the
   * browser's own handling, such as opening a new tab. */
  #openProduct(event: MouseEvent, productId: string): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    this.#emit("wt-edit-product", { productId });
  }

  #overrideCell(line: Line) {
    const { item, variant } = line;
    const clash = this.#clash(line);
    const inherited = this.#inherited(line);
    let placeholder: string;
    let hint: string;
    if (clash === "size") {
      placeholder = "—";
      hint = t("menu_prices.size_clash");
    } else if (inherited.state === "clash" || clash === "own") {
      placeholder = t("menu_prices.clash_placeholder");
      hint = t("menu_prices.override_help_clash");
    } else {
      placeholder = spanAmounts(inherited);
      hint = oneAmount(inherited)
        ? t("menu_prices.override_help").replace("{price}", priceText(inherited.low))
        : t("menu_prices.override_help_range").replace("{range}", spanText(inherited));
    }
    const sizesSetOne =
      variant === null &&
      item.override === null &&
      item.variants.some(({ price }) => price !== null);
    return html`<span part="price-cell"
      ><wt-price-input
        part="override-field"
        name="price-override"
        data-row=${variant ? `${item.menuItemId}:${variant.variantId}` : item.menuItemId}
        hide-label
        fixed-unit
        locale=${currentLocale()}
        label=${t("menu_prices.override_label").replace("{name}", this.#lineName(line))}
        .value=${this.#stored(line) ?? ""}
        placeholder=${placeholder}
        hint=${hint}
      ></wt-price-input
      >${this.#tip(line)}${
        clash === null
          ? nothing
          : html`<span part="clash"
              >${t(clash === "size" ? "menu_prices.size_clash" : "menu_prices.clash")}</span
            >`
      }${
        sizesSetOne
          ? html`<span part="note muted">${t("menu_prices.variant_overrides")}</span>`
          : nothing
      }</span
    >`;
  }

  #resolve(line: Line, grossPrice: string): void {
    if (this.busy) return;
    const { item, variant } = line;
    this.#emit("wt-offer-save", {
      menuItemId: item.menuItemId,
      name: item.name,
      item: variant ? null : { grossPrice },
      // The whole-list save refuses an Inactive size it is sent and keeps the row of one left out.
      variants: variant
        ? item.variants
            .filter((size) => size.active || size.variantId === variant.variantId)
            .map(({ variantId, price }) => ({
              variantId,
              price: variantId === variant.variantId ? grossPrice : price,
            }))
        : item.variants.length
          ? null
          : [],
    } satisfies OfferSave);
  }

  #resolveActions(line: Line) {
    const price = this.#priceSetting(line);
    if (price.state !== "clash") return nothing;
    return html`<wt-row-actions
      part="resolve"
      align="end"
      label=${`${t("menu_prices.resolve")} ${line.item.name}${line.variant ? ` — ${this.#variantName(line.variant.variantId)}` : ""}`}
    >
      ${price.candidates.map((candidate) =>
        "value" in candidate
          ? html`<wt-button
              variant="secondary"
              .disabled=${this.busy}
              @click=${(event: Event) => {
                event.stopPropagation();
                (event.currentTarget as HTMLElement)
                  .closest<HTMLElementTagNameMap["wt-row-actions"]>("wt-row-actions")!
                  .hide();
                this.#resolve(line, candidate.value);
              }}
              >${t("menu_prices.use_candidate").replace("{price}", priceText(candidate.value)).replace("{place}", placeName(candidate.place, t))}</wt-button
            >`
          : nothing,
      )}<wt-button
        variant="secondary"
        .disabled=${this.busy}
        @click=${(event: Event) => {
          event.stopPropagation();
          (event.currentTarget as HTMLElement)
            .closest<HTMLElementTagNameMap["wt-row-actions"]>("wt-row-actions")!
            .hide();
          this.#emit("wt-offer-edit", { menuItemId: line.item.menuItemId });
        }}
        >${t("menu_prices.set_price")}</wt-button
      >
    </wt-row-actions>`;
  }

  #variantName(variantId: string): string {
    return this.#variants.get(variantId)?.name ?? t("members.missing");
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
    this.refused = {};
    this.attempted = false;
    this.draft = {
      grossPrice: row.override ?? "",
      variants: row.variants
        .filter((variant) => variant.active)
        .map(({ variantId, price }) => ({ variantId, price: price ?? "" })),
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
        key: "status",
        label: t("product.status"),
        choosable: "shown",
        sortValue: (line) => (this.#active(line) ? 0 : 1),
        searchValue: (line) =>
          t(this.#active(line) ? "product.active_badge" : "product.inactive_badge"),
        cell: (line) => this.#status(line),
      },
      {
        key: "override",
        label: t("menu_prices.override_column"),
        align: "end",
        // A range sorts by its low end.
        sortValue: (line) => {
          const shown = this.#shown(line);
          return shown.state === "price" ? stringToCents(shown.low) : null;
        },
        searchValue: (line) => {
          const shown = this.#shown(line);
          return shown.state === "price"
            ? priceSearchText(spanText(shown), [shown.low, shown.high])
            : "";
        },
        cell: (line) => this.#overrideCell(line),
        filter: {
          label: t("menu_prices.price_filter"),
          allLabel: t("menu_prices.all_prices"),
          value: (line) => (this.#overridden(line) ? "overridden" : "product"),
          options: [{ value: "overridden", label: t("menu_prices.overridden_only") }],
        },
      },
      {
        key: "actions",
        label: t("menu_prices.resolve"),
        pinned: "end",
        cell: (line) => this.#resolveActions(line),
      },
    ];
  }

  #edit(change: (draft: Draft) => Draft, clears: string): void {
    this.draft = change(this.draft!);
    if (clears in this.refused)
      this.refused = Object.fromEntries(
        Object.entries(this.refused).filter(([field]) => field !== clears),
      );
  }

  #validate(draft: Draft): Record<string, string> {
    const errors: Record<string, string> = {};
    const grossPrice = blankToNull(draft.grossPrice);
    if (grossPrice !== null && !isProductPrice(grossPrice))
      errors.grossPrice = t("editor.price_invalid");
    draft.variants.forEach(({ price }, index) => {
      const own = blankToNull(price);
      if (own !== null && !isProductPrice(own))
        errors[`variants.${index}.price`] = t("editor.price_invalid");
    });
    return errors;
  }

  /** The keys of `errors` a field of the window shows. */
  #fieldKeys(errors: Record<string, string>): string[] {
    const shown = new Set([
      "grossPrice",
      ...(this.draft?.variants ?? []).map((_, index) => `variants.${index}.price`),
    ]);
    return Object.keys(errors).filter((key) => errors[key] && shown.has(key));
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
    this.attempted = true;
    this.refused = {};
    if (Object.keys(this.#validate(draft)).length) {
      void this.updateComplete.then(() => this.#focusInvalid());
      return;
    }
    const grossPrice = blankToNull(draft.grossPrice);
    const row = this.#opened!;
    const variants = draft.variants.map(({ variantId, price }) => ({
      variantId,
      price: blankToNull(price),
    }));
    // The draft's variants were built from the opened row's Active ones, one for one and in order.
    const seeded = row.variants.filter((variant) => variant.active);
    const variantsChanged = variants.some(({ price }, at) => !samePrice(price, seeded[at]!.price));
    this.#emit("wt-offer-save", {
      menuItemId: this.editing!,
      name: row.name,
      item: samePrice(grossPrice, row.override) ? null : { grossPrice },
      variants: variantsChanged ? variants : null,
    } satisfies OfferSave);
  }

  #cancel(event: Event): void {
    event.stopPropagation();
    if (!this.busy) this.#emit("wt-offer-cancel", {});
  }

  #renderForm(row: MenuPriceRow, draft: Draft, errors: Record<string, string>) {
    const context: FieldContext = {
      busy: this.busy,
      locales: [],
      error: (key) => errors[key] ?? "",
    };
    const inheritedPrice = this.#before(row.combined.price);
    const productPrice = inheritedPrice.state === "decided" ? inheritedPrice.value : "";
    return html`<div
      class="fields"
      @keydown=${(event: KeyboardEvent) =>
        submitOnEnter(
          event,
          this.shadowRoot!.querySelector<HTMLElement>('[data-test="offer-save"]'),
        )}
    >
      ${priceField(
        context,
        "grossPrice",
        t("menu_prices.override"),
        draft.grossPrice,
        (value) => this.#edit((current) => ({ ...current, grossPrice: value }), "grossPrice"),
        false,
        productPrice,
        t("menu_prices.override_help").replace("{price}", priceText(productPrice)),
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
      ${
        draft.variants.length
          ? html`<h3>${t("menu_prices.variants")}</h3>
              <p class="help">${t("menu_prices.variants_help")}</p>
              ${draft.variants.map((variant, index) => {
                const known = this.#variants.get(variant.variantId);
                return html`<fieldset>
                  <legend>${known?.name ?? t("members.missing")}</legend>
                  ${priceField(
                    context,
                    `variants.${index}.price`,
                    t("menu_prices.override"),
                    variant.price,
                    (price) => this.#editVariant(index, { price }, `variants.${index}.price`),
                    false,
                    (() => {
                      const before = this.#before(
                        row.combined.variants.find((v) => v.variantId === variant.variantId)!.price,
                      );
                      return before.state === "decided"
                        ? before.source.kind === "parent"
                          ? isProductPrice(draft.grossPrice.trim())
                            ? draft.grossPrice.trim()
                            : productPrice
                          : before.value
                        : "";
                    })(),
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
    const invalid = form && this.attempted ? this.#validate(form.draft) : {};
    const errors = form ? { ...this.refused, ...invalid } : {};
    const fieldKeys = new Set(this.#fieldKeys(errors));
    const bottom = [
      ...Object.entries(errors)
        .filter(([key, message]) => message && !fieldKeys.has(key))
        .map(([, message]) => message),
      ...(fieldKeys.size > 0 ? [t("form.fix_fields")] : []),
    ].join(" ");
    return html`<wt-modal
      size="standard"
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
      ${form ? this.#renderForm(form.row, form.draft, errors) : nothing}
      <wt-form-actions slot="footer" .error=${bottom}
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
          .disabled=${this.busy || Object.keys(invalid).length > 0}
          @click=${(event: Event) => this.#save(event)}
          >${t("action.save")}</wt-button
        ></wt-form-actions
      >
    </wt-modal>`;
  }

  #summary() {
    const own = new Set<string>();
    const included = new Map<string, { name: string; products: Set<string> }>();
    const collect = (nodes: readonly MenuStructureNode[], products: Set<string>): void => {
      for (const node of nodes) {
        if (node.ref.kind === "product") products.add(node.ref.productId);
        else collect(node.children ?? [], products);
      }
    };
    const walk = (nodes: readonly MenuStructureNode[]): void => {
      for (const node of nodes) {
        if (node.ref.kind === "product") own.add(node.ref.productId);
        else if (node.includedMenuId) {
          let menu = included.get(node.includedMenuId);
          if (!menu) {
            menu = { name: node.internalName ?? t("members.missing"), products: new Set() };
            included.set(node.includedMenuId, menu);
          }
          collect(node.children ?? [], menu.products);
        } else walk(node.children ?? []);
      }
    };
    walk(this.nodes);
    const priced = (row: MenuPriceRow) =>
      row.override !== null || row.variants.some((variant) => variant.price !== null);
    return html`<div data-test="price-summary">
      ${[...included.values()].map((menu) => {
        const rows = this.rows.filter((row) => menu.products.has(row.productId));
        const prices = rows.filter(priced).length;
        return html`<p>
          ${t("menu_prices.summary_included")
            .replace("{prices}", String(prices))
            .replace("{priceItems}", t(prices === 1 ? "menu_prices.item" : "menu_prices.items"))
            .replace("{menu}", menu.name)}
        </p>`;
      })}
      <p>
        ${t("menu_prices.summary_own").replace("{prices}", String(this.rows.filter((row) => own.has(row.productId) && priced(row)).length))}
      </p>
    </div>`;
  }

  override render() {
    return html`${this.#summary()}<wt-data-table
        noMatchesMessage=${tableNoMatches()}
        filterSearchPlaceholder=${t("categories.combobox_search")}
        filterNoResultsLabel=${t("categories.combobox_no_results")}
        aria-label=${t("menu_prices.label").replace("{menu}", this.menuName)}
        viewKey="waitron.menus.price-overrides"
        searchable
        searchLabel=${t("menu_prices.search")}
        customiseColumnsLabel=${t("table.customise_columns")}
        customiseLabel=${t("table.customise")}
        restoreColumnsLabel=${t("table.restore_columns")}
        doneLabel=${t("table.done")}
        moveColumnLabel=${t("table.move_column")}
        showColumnLabel=${t("table.show_column")}
        hideColumnLabel=${t("table.hide_column")}
        alwaysShownColumnLabel=${t("table.column_always_shown")}
        lastShownColumnLabel=${t("table.column_last_shown")}
        columnPositionLabel=${t("table.column_position")}
        filtersLabel=${t("table.filters")}
        filteredColumnLabel=${t("table.filtered_column")}
        filtersClearAllLabel=${t("table.filters_clear_all")}
        filtersCloseLabel=${t("table.filters_close")}
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
      ></wt-data-table>
      ${this.#renderModal()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-menu-prices-table": MenuPricesTable;
  }
}
