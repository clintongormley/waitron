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
import { describeSetting, placeName } from "./price-source.js";
import type { Setting } from "../api/client.js";
import type { Decimal } from "@waitron/shared";
import { isProductPrice } from "@waitron/catalogue/src/modifier-limits.js";
import { stringToCents } from "@waitron/shared";
import type {
  CategorySummary,
  SectionDetails,
  MenuPriceRow,
  MenuStructureNode,
  MenuVariant,
  Product,
} from "../api/client.js";
import { t } from "../i18n/t.js";
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
  before: Span | null;
  catalogue: Span;
  charged: Span | null;
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
  before: readonly string[],
  catalogue: readonly string[],
  charged: readonly string[],
  menuApplies: boolean,
): LinePrices => ({
  before: span(before),
  catalogue: span(catalogue)!,
  charged: span(charged),
  menuApplies,
});

const spanText = ({ low, high, lowCents, highCents }: Span): string =>
  lowCents === highCents
    ? priceText(low)
    : t("menu_prices.range").replace("{low}", priceText(low)).replace("{high}", priceText(high));

const muted = (content: unknown) => html`<span part="muted">${content}</span>`;

/**
 * One menu's prices, a row per product the menu reaches with its Active variants under it, and the
 * window that edits one product's prices on the menu: its own and each variant's. The host performs
 * the writes, opening and closing the window through `editing` and reporting a refusal through
 * `refusal`.
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
        align-items: center;
        gap: var(--wt-space-1);
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
  /** The products with their variants, for each variant's name and own price. */
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
    const lines: Line[] = [];
    const prices = new Map<Line, LinePrices>();
    for (const item of this.rows) {
      const product: Line = { item, variant: null };
      const variants: Line[] = item.variants
        .filter((variant) => variant.active)
        .map((variant) => ({ item, variant }));
      const read = (line: Line) => {
        const setting = this.#priceSetting(line);
        const before = this.#before(setting);
        return {
          before: before.state === "decided" ? before.value : null,
          charged: setting.state === "decided" ? setting.value : null,
          applies:
            setting.state === "decided" &&
            (setting.source.kind === "own" ||
              (setting.source.kind === "parent" && item.override !== null)),
        };
      };
      const values = (variants.length ? variants : [product]).map(read);
      const before = values.every((value) => value.before !== null)
        ? values.map((value) => value.before!)
        : [];
      const charged = values.every((value) => value.charged !== null)
        ? values.map((value) => value.charged!)
        : [];
      prices.set(
        product,
        priced(
          before,
          (variants.length ? variants : [product]).map((line) =>
            line.variant
              ? (this.#variants.get(line.variant.variantId)?.unitPrice ?? item.productPrice)
              : item.productPrice,
          ),
          charged,
          values.some((value) => value.applies),
        ),
      );
      lines.push(product);
      for (const line of variants) {
        const value = read(line);
        prices.set(
          line,
          priced(
            value.before === null ? [] : [value.before],
            [this.#variants.get(line.variant!.variantId)?.unitPrice ?? item.productPrice],
            value.charged === null ? [] : [value.charged],
            value.applies,
          ),
        );
        lines.push(line);
      }
    }
    this.#lines = lines;
    this.#prices = prices;
  }

  #isClash(line: Line): boolean {
    return (
      this.#priceSetting(line).state === "clash" ||
      (line.variant === null && line.item.combined.variants.some((v) => v.price.state === "clash"))
    );
  }

  #tip(line: Line, key: "before" | "menu" | "charged", content: unknown) {
    const settings =
      line.variant === null &&
      line.item.variants.length &&
      (key !== "menu" || line.item.override === null)
        ? line.item.variants.map((variant) => ({
            variant,
            setting: this.#priceSetting({ item: line.item, variant }),
          }))
        : [{ variant: line.variant, setting: this.#priceSetting(line) }];
    const explanation = settings
      .map(({ variant, setting }) => {
        const described = key === "before" ? this.#before(setting) : setting;
        const words = describeSetting(described, { product: line.item.name }, t);
        return line.variant === null && variant
          ? `${this.#variantName(variant.variantId)}: ${described.state === "decided" ? priceText(described.value) : t("menu_prices.clash")}. ${words}`
          : words;
      })
      .join(" ");
    const name = line.variant
      ? `${line.item.name} — ${this.#variantName(line.variant.variantId)}`
      : line.item.name;
    return html`<span part="price-cell"
      >${content}<wt-help-tooltip aria-label=${t(`menu_prices.tip_${key}`).replace("{name}", name)}
        >${explanation}</wt-help-tooltip
      ></span
    >`;
  }

  #resolve(line: Line, grossPrice: string): void {
    if (this.busy) return;
    const { item, variant } = line;
    this.#emit("wt-offer-save", {
      menuItemId: item.menuItemId,
      name: item.name,
      item: variant ? null : { grossPrice },
      variants: variant
        ? item.variants.map(({ variantId, price }) => ({
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

  #chargedHere(line: Line) {
    const { catalogue, charged, menuApplies } = this.#prices.get(line)!;
    if (this.#isClash(line) || charged === null)
      return html`<span part="clash">${t("menu_prices.clash")}</span>`;
    const text = spanText(charged);
    if (!menuApplies)
      return muted(
        html`${text}<span part="visually-hidden"> ${t("menu_prices.price_inherited")}</span>`,
      );
    if (catalogue === null) return text;
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
    const prices = (line: Line) => this.#prices.get(line)!;
    const menuPrice = ({ item, variant }: Line) => (variant ? variant.price : item.override);
    /** Whether a product sets a menu price on any of its variants. */
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
        return typeof value === "string"
          ? priceSearchText(priceText(value), [value])
          : priceSearchText(spanText(value), [value.low, value.high]);
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
        ...price("product-price", t("menu_prices.product_price"), (line) => prices(line).before),
        cell: (line) =>
          this.#tip(
            line,
            "before",
            prices(line).before
              ? spanText(prices(line).before!)
              : html`<span part="clash">${t("menu_prices.clash")}</span>`,
          ),
      },
      {
        ...price("menu-price", t("menu_prices.menu_price"), menuPrice),
        cell: (line) => {
          const set = menuPrice(line);
          return this.#tip(
            line,
            "menu",
            set !== null
              ? priceText(set)
              : variantPriced(line)
                ? t("menu_prices.variant_overrides")
                : muted(t("menu_prices.no_override")),
          );
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
          return this.#tip(
            line,
            "charged",
            this.#isClash(line) || charged === null
              ? html`<span part="clash">${t("menu_prices.clash")}</span>`
              : spanText(charged),
          );
        },
      },
      {
        ...price(
          "price-on-menu",
          t("menu_prices.price_on_menu"),
          (line) => prices(line).charged,
          "hidden",
        ),
        cell: (line) => this.#tip(line, "charged", this.#chargedHere(line)),
      },
      {
        key: "from",
        label: t("menu_prices.from"),
        choosable: "shown",
        cell: (line) => {
          if (this.#isClash(line)) return html`<span part="clash">${t("menu_prices.clash")}</span>`;
          const setting = this.#priceSetting(line);
          if (setting.state === "clash") return t("menu_prices.clash");
          const source =
            setting.source.kind === "parent" && line.item.combined.price.state === "decided"
              ? line.item.combined.price.source
              : setting.source;
          return source.kind === "menu"
            ? source.menuName
            : t(
                source.kind === "own" || (source.kind === "parent" && line.item.override !== null)
                  ? "menu_prices.this_menu"
                  : "menu_prices.product",
              );
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
        viewKey="waitron.menus.prices"
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
