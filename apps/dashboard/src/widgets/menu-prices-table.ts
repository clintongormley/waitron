import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import {
  baseStyles,
  belongsToComposition,
  draftScopeFor,
  FormFeedback,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  formatDecimalInput,
  visuallyHiddenStyles,
  type DataTableColumn,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-price-input.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import {
  followsClash,
  productInherited,
  variantClash,
  variantSetting,
  variantsInheritedFrom,
  variantInherited,
  variantInheritedFrom,
  withoutOwn,
  type Inherited,
  type InheritedFrom,
  type ParentPrice,
} from "./menu-price-inheritance.js";
import type { Setting } from "../api/client.js";
import type { Decimal } from "@waitron/shared";
import { isProductPrice } from "@waitron/menu/src/modifier-limits.js";
import { clashesOf } from "@waitron/menu/src/menu-combine.js";
import { currencySymbol, stringToCents } from "@waitron/shared";
import type { SectionDetails, MenuPriceRow, MenuPriceVariant, Product } from "../api/client.js";
import type { CategorySummary } from "../api/catalog-api.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { leftToBrowser } from "../navigation.js";
import { byLabel, categoryAncestors, categoryPath, PATH_SEPARATOR } from "./category-form.js";
import { priceText } from "./form-fields.js";
import { placeName } from "./price-source.js";

export interface PriceSave {
  key: string;
  menuItemId: string;
  variantId: string | null;
  name: string;
  price: string | null;
}

export interface PriceSaveResult {
  saved: ReadonlySet<string>;
  refused: Record<string, { reason: string; namesField: boolean }>;
}

const blankToNull = (text: string): string | null => (text.trim() === "" ? null : text.trim());

/** A product field's text as the price its variants follow: undefined while untouched or holding text
 * that is not a price, null once emptied, else the price typed. */
const parentPriceOf = (draft: string | undefined): ParentPrice => {
  const text = draft?.trim();
  if (text === undefined) return undefined;
  if (text === "") return null;
  return isProductPrice(text) ? text : undefined;
};

/** By amount, so "2.5" typed over a stored "2.50" is no change. */
const samePrice = (a: string | null, b: string | null): boolean =>
  a === null || b === null ? a === b : stringToCents(a) === stringToCents(b);

/** What changes the table's rows or columns, after which the row menu's column is measured again;
 * otherwise only a resize of the table measures it. */
const RESHAPES = ["rows", "products", "sections", "categories", "loading", "failed"];

/** A table row: an Active product the menu reaches, or one of its Active variants, drawn under it. */
interface Line {
  item: MenuPriceRow;
  variant: MenuPriceVariant | null;
}

/** The row's key in the table, and the key of its field's saves and refusals. */
const keyOf = ({ item, variant }: Line): string =>
  variant ? `${item.menuItemId}:${variant.variantId}` : item.menuItemId;

// Not written inline where the table is drawn: a new function there each time the widget draws
// would redraw the whole table with it.
const parentKey = ({ item, variant }: Line): string | null => (variant ? item.menuItemId : null);
const toggleLabel = ({ item }: Line, expanded: boolean): string =>
  fill(expanded ? "menu_prices.collapse" : "menu_prices.expand", { name: item.name });
const keepsVariantOrder = ({ variant }: Line): boolean => variant === null;

/** Whether a clash in the product's own price, as its field reads now, stops publishing: it has
 * no variant, or a variant charges that clashing price. */
const ownPriceSold = (item: MenuPriceRow, parent: ParentPrice = undefined): boolean =>
  item.variants.length === 0 || followsClash(item, parent);

/** A product with variants charges what they charge, so only its variants' rows have a field. */
const hasField = ({ item, variant }: Line): boolean =>
  variant !== null || item.variants.length === 0;

/** Whether this menu stores a price for any of the product's variants. */
const pricesAVariant = (item: MenuPriceRow): boolean =>
  item.variants.some(({ price }) => price !== null);

const candidatesText = (setting: Setting<Decimal>): string =>
  setting.state !== "clash"
    ? ""
    : setting.candidates
        .map((candidate) => {
          const place = placeName(candidate.place, t);
          return "value" in candidate
            ? fill("menu_prices.source_candidate", { price: priceText(candidate.value), place })
            : fill("menu_prices.candidate_undecided", { place });
        })
        .join(", ");

const pricesSentence = (setting: Setting<Decimal>): string =>
  fill("menu_prices.clash_prices", { candidates: candidatesText(setting) });

type Span = { low: string; high: string };

const oneAmount = ({ low, high }: Span): boolean => stringToCents(low) === stringToCents(high);

const spanText = (span: Span): string =>
  oneAmount(span)
    ? priceText(span.low)
    : t("menu_prices.range")
        .replace("{low}", priceText(span.low))
        .replace("{high}", priceText(span.high));

@customElement("dashboard-menu-prices-table")
export class MenuPricesTable extends LitElement {
  static override styles = [
    baseStyles,
    css`
      /* --field-width is a drawn price field's width, measured. */
      :host {
        display: block;
        container-type: inline-size;
        --shown-price-width: var(--field-width, var(--wt-price-field-width));
      }
      .error {
        margin-block: 0;
        color: var(--wt-color-danger);
      }
      .clash-line {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        column-gap: var(--wt-space-3);
        margin-block-end: var(--wt-space-3);
      }
      wt-data-table::part(name-box) {
        display: contents;
      }
      wt-data-table::part(name) {
        overflow-wrap: anywhere;
      }
      wt-data-table::part(variant-name) {
        display: inline-block;
        padding-inline-start: var(--wt-space-4);
        overflow-wrap: anywhere;
      }
      wt-data-table::part(visually-hidden) {
        ${visuallyHiddenStyles}
      }
      wt-data-table::part(placement) {
        display: block;
        overflow-wrap: anywhere;
      }
      wt-data-table::part(price-cell) {
        display: inline-grid;
        gap: var(--wt-space-1);
      }
      /* Contained, so a note wraps inside the field's width rather than widening the column. */
      wt-data-table::part(price-notes) {
        contain: inline-size;
      }
      wt-data-table::part(clash),
      wt-data-table::part(price-note) {
        display: block;
      }
      wt-data-table::part(price-note) {
        font-size: var(--wt-font-size-sm);
      }
      /* Its positioned box holds the field's hidden hint, which otherwise escapes the table's
         scroller and widens the page. */
      wt-data-table::part(override-field) {
        position: relative;
      }
      /* As wide as a field, so its notes wrap as a field's do and it never widens the column. */
      wt-data-table::part(derived-cell) {
        grid-template-columns: var(--shown-price-width);
      }
      /* Its words start, or in a language that writes the sign after the amount end, where a
         field's sign does, so they line up with the fields' prices. They may reach into the cell's
         padding on the other side, and wrap between words past that. */
      wt-data-table::part(derived-price) {
        justify-self: start;
        box-sizing: border-box;
        inline-size: max-content;
        min-inline-size: 100%;
        max-inline-size: calc(100% + var(--wt-space-3));
        padding-inline-start: var(--wt-space-3);
      }
      wt-data-table::part(derived-price sign-after) {
        justify-self: end;
        padding-inline: 0 var(--wt-space-3);
        text-align: end;
      }
      wt-data-table::part(clash) {
        color: var(--wt-color-danger);
        font-weight: var(--wt-font-weight-bold);
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
      /* Keep the sticky column headers below the Save bar. */
      wt-data-table {
        isolation: isolate;
      }
      /* The table is never narrower than its cells' unwrapped text, so at phone width a name, and
         the note under it, is capped at the room the price column and the pinned row-menu column
         leave beside the cell's padding and the tree's toggle. The row-menu column is as wide as
         its heading in the current language, so its width is measured into --actions-width. A
         variant's name is indented one tree step further. */
      @container (max-width: 30rem) {
        wt-data-table {
          --name-room: calc(
            100cqi - var(--actions-width, var(--wt-tap-min)) - var(--shown-price-width) - 4 *
              var(--wt-space-3) - var(--tree-arrow-width) - var(--wt-space-4)
          );
        }
        wt-data-table::part(name-box) {
          display: block;
          max-inline-size: max(var(--wt-tap-min), var(--name-room));
        }
        wt-data-table::part(variant-name) {
          padding-inline-start: var(--wt-space-3);
          max-inline-size: calc(max(var(--wt-tap-min), var(--name-room)) - var(--wt-space-2));
        }
      }
    `,
  ];

  @property({ attribute: false }) rows: MenuPriceRow[] = [];
  @property() clashesFor = "";
  #appliedClashesFor = "";
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) failed = false;
  @property({ attribute: false }) sections: SectionDetails[] = [];
  @property({ attribute: false }) categories: CategorySummary[] = [];
  /** The products with their variants, for each variant's name. */
  @property({ attribute: false }) products: Product[] = [];
  @property() menuName = "";
  @property({ attribute: false }) savePrices?: (
    saves: readonly PriceSave[],
  ) => Promise<PriceSaveResult>;
  @property({ attribute: false }) refreshPrices?: () => Promise<void>;

  @state() private drafts: ReadonlyMap<string, string> = new Map();
  @state() private saving = false;
  @state() private refusals: PriceSaveResult["refused"] = {};
  @state() private hiddenErrors: ReadonlySet<string> = new Set();
  /** The table restores its own remembered filter. */
  @state() private filterOnClashes = true;
  readonly #feedback = new FormFeedback(this);
  #scope?: DraftScope<boolean>;
  // Keep confirmed prices on screen until the next read supplies their rows.
  readonly #saved = new Map<string, string | null>();

  #sectionNames: ReadonlyMap<string, string> = new Map();
  /** Each row's sections, every placement's together, for the section filter. */
  #reached: ReadonlyMap<MenuPriceRow, string[]> = new Map();
  #categoryPaths: ReadonlyMap<string, string> = new Map();
  #categoryLabels: ReadonlyMap<string, string> = new Map();
  /** Each category with the categories above it, so a filter on a category keeps those inside it. */
  #categoryChains: ReadonlyMap<string, string[]> = new Map();
  #variants: ReadonlyMap<string, Product["variants"][number]> = new Map();
  #lines: Line[] = [];
  #lineOf: ReadonlyMap<string, Line> = new Map();
  #columns: DataTableColumn<Line>[] = [];
  /** Per product, what it charges with its field blank and where each variant's price comes
   * from, neither of which typing changes. */
  #productInheritance: ReadonlyMap<
    MenuPriceRow,
    { inherited: Inherited; variants: ReturnType<typeof variantsInheritedFrom> }
  > = new Map();
  /** Each row that clashes as this menu stores it, drafts aside, so a row under the Clashes filter
   * stays while a price is typed into it. */
  #clashing: ReadonlyMap<string, "variant" | "own"> = new Map();
  /** Clashing prices, as the publish check counts them. */
  #clashCount = 0;
  /** Whether the price filter starts on Clashes, decided on the first loaded update of each load;
   * undefined until then. Dropped for the rest of a load once it has no clash, so a clash that
   * comes back does not move the filter. */
  #startOnClashes: boolean | undefined = undefined;
  /** Per row key, what depends on its product's field, with the reading of that field it was
   * worked out for. */
  readonly #underParent = new Map<
    string,
    {
      parent: ParentPrice;
      from?: InheritedFrom;
      inherited?: Inherited;
      variantClash?: boolean;
      ownSold?: boolean;
    }
  >();

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!this.clashesFor) this.#appliedClashesFor = "";
    if (changed.has("sections"))
      this.#sectionNames = new Map(this.sections.map(({ id, internalName }) => [id, internalName]));
    if (changed.has("categories")) this.#readCategories();
    if (changed.has("rows")) {
      this.#saved.clear();
      this.#reached = new Map(this.rows.map((row) => [row, row.placements.flat()]));
      this.#productInheritance = new Map(
        this.rows.map((row) => [
          row,
          { inherited: productInherited(row), variants: variantsInheritedFrom(row) },
        ]),
      );
      this.#underParent.clear();
      this.#readClashes();
    }
    if (changed.has("products"))
      this.#variants = new Map(
        this.products.flatMap(({ variants }) => variants.map((variant) => [variant.id, variant])),
      );
    if (changed.has("rows") || changed.has("products")) this.#readLines();
    const startedOnClashes = this.#startOnClashes;
    this.#decideStart();
    if (
      changed.has("sections") ||
      changed.has("categories") ||
      changed.has("rows") ||
      this.#startOnClashes !== startedOnClashes
    )
      this.#columns = this.#buildColumns();
  }

  #readClashes(): void {
    const clashing = new Map<string, "variant" | "own">();
    let count = 0;
    for (const item of this.rows) {
      count += clashesOf(item.combined).length;
      const own =
        item.override === null &&
        ownPriceSold(item) &&
        (item.combined.price.state === "clash" ||
          this.#productInheritance.get(item)!.inherited.state === "clash");
      const product = variantClash(item) ? "variant" : own ? "own" : null;
      if (product !== null) clashing.set(item.menuItemId, product);
      for (const { variantId, price } of item.variants) {
        if (price !== null) continue;
        if (variantInherited(item, variantId, undefined).state !== "clash") continue;
        clashing.set(`${item.menuItemId}:${variantId}`, "own");
      }
    }
    this.#clashing = clashing;
    this.#clashCount = count;
  }

  #decideStart(): void {
    if (this.loading || this.failed) this.#startOnClashes = undefined;
    else if (this.#startOnClashes !== false) this.#startOnClashes = this.#clashing.size > 0;
  }

  /** The table resizes when the window does and when a redraw changes its columns' words, and the
   * measured field when it draws its sign. Measured a frame later, never inside the observer's
   * callback, which the names' new widths would re-trigger. */
  readonly #tableSize = new ResizeObserver(() => {
    cancelAnimationFrame(this.#actionsFrame);
    this.#actionsFrame = requestAnimationFrame(() => this.#fitColumns());
  });
  #actionsFrame = 0;
  #measuredField: Element | null = null;

  /** A field's width counts its sign's, measured inside it, so it is read from a drawn field. */
  #fitColumns(): void {
    const root = this.#table()?.shadowRoot;
    this.#measureInto("--actions-width", root?.querySelector('thead th[data-pinned="end"]'));
    const field = root?.querySelector("wt-price-input") ?? null;
    if (field !== this.#measuredField) {
      if (this.#measuredField !== null) this.#tableSize.unobserve(this.#measuredField);
      if (field !== null) this.#tableSize.observe(field);
      this.#measuredField = field;
    }
    this.#measureInto("--field-width", field);
  }

  #measureInto(property: string, node: Element | null | undefined): void {
    const width = node ? `${node.getBoundingClientRect().width}px` : "";
    if (this.style.getPropertyValue(property) === width) return;
    if (width === "") this.style.removeProperty(property);
    else this.style.setProperty(property, width);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#scope = draftScopeFor(this, {
      id: this,
      // The submitted batch is already being sent and cannot be discarded on leave.
      current: () => !this.saving && this.#changes().length > 0,
      snapshot: (dirty) => dirty,
      equal: (before, after) => before === after,
      restore: () => this.#cancel(),
    }).scope;
    if (this.hasUpdated) this.#tableSize.observe(this.#table()!);
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#tableSize.disconnect();
    this.#measuredField = null;
    super.disconnectedCallback();
  }

  protected override firstUpdated(): void {
    this.#tableSize.observe(this.#table()!);
  }

  #unsent = false;

  protected override updated(changed: PropertyValues): void {
    const unsent = this.saving || this.#changes().length > 0;
    if (unsent !== this.#unsent) {
      this.#unsent = unsent;
      this.dispatchEvent(
        new CustomEvent("price-draft-change", { detail: unsent, bubbles: true, composed: true }),
      );
    }
    const table = this.#table();
    const reshaped = RESHAPES.some((name) => changed.has(name));
    // Only the update carrying loaded rows may consume a navigation request.
    const clashesFor = !this.loading && !this.failed ? this.clashesFor : "";
    const rows = this.rows;
    if (table !== null)
      void table.updateComplete.then(() => {
        if (
          clashesFor &&
          clashesFor === this.clashesFor &&
          rows === this.rows &&
          clashesFor !== this.#appliedClashesFor
        ) {
          this.#appliedClashesFor = clashesFor;
          table.chooseFilter("override", ["clash"]);
        }
        this.#readFilter();
        if (reshaped) {
          this.#fitColumns();
          if (this.drafts.size > 0) void this.#readHiddenErrors();
        }
      });
    // Cells read widget state, while the table renders them on its own update.
    if (
      changed.has("saving") ||
      changed.has("refusals") ||
      (changed.has("drafts") &&
        this.#draftsRedraw(changed.get("drafts") as MenuPricesTable["drafts"]))
    )
      table?.requestUpdate();
    if (changed.has("rows")) this.#scope?.changed();
  }

  #draftsRedraw(before: MenuPricesTable["drafts"]): boolean {
    for (const key of new Set([...before.keys(), ...this.drafts.keys()])) {
      const was = before.get(key);
      const now = this.drafts.get(key);
      const line = this.#lineOf.get(key);
      if (was === now || line === undefined) continue;
      const field = this.#field(key);
      if (field !== null && field.value !== (now ?? this.#stored(line) ?? "")) return true;
      if (this.#holds(line, was) !== this.#holds(line, now)) return true;
      if (field !== null && field.error !== this.#error(key)) return true;
      if (
        line.item.variants.length > 0 &&
        line.variant === null &&
        parentPriceOf(was) !== parentPriceOf(now)
      )
        return true;
    }
    return false;
  }

  #readFilter(): void {
    const onClashes = this.#table()?.filterValues("override").includes("clash") ?? true;
    if (onClashes !== this.filterOnClashes) this.filterOnClashes = onClashes;
  }

  #table(): HTMLElementTagNameMap["wt-data-table"] | null {
    return this.shadowRoot?.querySelector("wt-data-table") ?? null;
  }

  /** Null for a variant under a collapsed product, whose row is not drawn. */
  #field(key: string): HTMLElementTagNameMap["wt-price-input"] | null {
    return (
      this.#table()?.shadowRoot?.querySelector<HTMLElementTagNameMap["wt-price-input"]>(
        `wt-price-input[data-row="${CSS.escape(key)}"]`,
      ) ?? null
    );
  }

  /** The button goes once the filter is on Clashes, so focus moves to the first clashing row's
   * field, opening its product's variants when they are closed, or to the search box when the
   * search leaves none. */
  async #showClashes(): Promise<void> {
    const table = this.#table()!;
    table.chooseFilter("override", ["clash"]);
    await table.updateComplete;
    const first = table
      .shownKeys()
      .find((key) => this.#clashing.has(key) && hasField(this.#lineOf.get(key)!));
    if (first !== undefined) await this.#focusField(first);
    else table.shadowRoot!.querySelector<HTMLElement>('input[name="search"]')!.focus();
  }

  async #focusField(key: string): Promise<void> {
    const table = this.#table();
    await table?.updateComplete;
    await table?.revealRow(key);
    const field = this.#field(key);
    await field?.updateComplete;
    field?.focus();
  }

  #readCategories(): void {
    this.#categoryPaths = new Map(
      this.categories.map((category) => [category.id, categoryPath(category, this.categories)]),
    );
    this.#categoryLabels = new Map(
      this.categories.map((category) => {
        const chain = categoryAncestors(category, this.categories).reverse();
        if (chain[0]?.parentId === null) chain.shift();
        return [category.id, chain.map(({ name }) => name).join(PATH_SEPARATOR)];
      }),
    );
    this.#categoryChains = new Map(
      this.categories.map((category) => [
        category.id,
        categoryAncestors(category, this.categories).map(({ id }) => id),
      ]),
    );
  }

  #priceSetting({ item, variant }: Line): Setting<Decimal> {
    return variant ? variantSetting(item, variant.variantId) : item.combined.price;
  }

  #readLines(): void {
    this.#lines = this.rows.flatMap((item) => [
      { item, variant: null },
      ...item.variants.map((variant) => ({ item, variant })),
    ]);
    this.#lineOf = new Map(this.#lines.map((line) => [keyOf(line), line]));
  }

  /** The price this menu stores for the row, or null. */
  #stored({ item, variant }: Line): string | null {
    const key = keyOf({ item, variant });
    return this.#saved.has(key) ? this.#saved.get(key)! : variant ? variant.price : item.override;
  }

  /** Whether this menu stores a price for the row, or, on a product, for any of its variants. */
  #overridden(line: Line): boolean {
    return this.#stored(line) !== null || (line.variant === null && pricesAVariant(line.item));
  }

  /** What depends on the row's product's field, worked out again only once that field reads
   * another price. */
  #withParent(line: Line) {
    const keyOfProduct = line.item.menuItemId;
    const saved = this.#saved.get(keyOfProduct);
    const staged = parentPriceOf(this.drafts.get(keyOfProduct));
    const parent = staged === undefined ? saved : staged;
    const key = keyOf(line);
    const known = this.#underParent.get(key);
    if (known !== undefined && known.parent === parent) return known;
    const { item, variant } = line;
    const worked = variant
      ? {
          parent,
          from: variantInheritedFrom(item, variant.variantId, parent),
          inherited: variantInherited(item, variant.variantId, parent),
        }
      : { parent, variantClash: variantClash(item, parent), ownSold: ownPriceSold(item, parent) };
    this.#underParent.set(key, worked);
    return worked;
  }

  /** What the row charges with its field left blank. */
  #inherited(line: Line): Inherited {
    return line.variant
      ? this.#withParent(line).inherited!
      : this.#productInheritance.get(line.item)!.inherited;
  }

  /** What the row charges: its stored price, else what it inherits. */
  #shown(line: Line): Inherited {
    const stored = this.#stored(line);
    return stored === null ? this.#inherited(line) : { state: "price", low: stored, high: stored };
  }

  /** A row's mark, its product's field as it reads now: "variant" on a product row by
   * `variantClash`; "own" on a row whose field holds no price and whose own price, or what it
   * inherits, clashes, on a product row only while `ownPriceSold`. */
  #clash(line: Line): "variant" | "own" | null {
    if (line.variant === null && this.#withParent(line).variantClash) return "variant";
    if (this.#holds(line, this.drafts.get(keyOf(line)))) return null;
    if (line.variant === null && !this.#withParent(line).ownSold) return null;
    return (line.variant === null && this.#priceSetting(line).state === "clash") ||
      this.#inherited(line).state === "clash"
      ? "own"
      : null;
  }

  #clashSentence(line: Line, clash: "variant" | "own"): string {
    const { item, variant } = line;
    if (variant) return pricesSentence(this.#withParent(line).from!.setting);
    const own = withoutOwn(item.combined.price);
    if (clash === "own" && own.state === "clash") return pricesSentence(own);
    const variants =
      clash === "variant"
        ? item.variants
            .map(({ variantId }) => ({ variantId, setting: variantSetting(item, variantId) }))
            .filter(({ setting }) => setting.level === "variant")
        : this.#productInheritance.get(item)!.variants;
    return [
      t("menu_prices.variant_clash_lead"),
      ...variants
        .filter(({ setting }) => setting.state === "clash")
        .map(({ variantId, setting }) =>
          fill("menu_prices.variant_clash", {
            variant: this.#variantName(variantId),
            candidates: candidatesText(setting),
          }),
        ),
    ].join(" ");
  }

  /** Whether the row's field holds a price, typed (`draft`) or stored. */
  #holds(line: Line, draft: string | undefined): boolean {
    const text = draft?.trim();
    return text === undefined ? this.#stored(line) !== null : text !== "" && isProductPrice(text);
  }

  #lineName({ item, variant }: Line): string {
    return variant ? `${item.name} — ${this.#variantName(variant.variantId)}` : item.name;
  }

  #availableCell({ item, variant }: Line) {
    const available = variant ? variant.available : item.available;
    return html`<span part="available" data-test="available"
      >${t(available ? "menus.available_yes" : "menus.available_no")}</span
    >`;
  }

  #actionsCell(line: Line) {
    const id = line.variant?.variantId ?? line.item.productId;
    return html`<wt-row-actions
      align="end"
      data-test=${`actions-${keyOf(line)}`}
      label=${`${t("members.actions")}: ${this.#lineName(line)}`}
      ><a
        data-test=${`edit-product-${keyOf(line)}`}
        href=${`/products/product/${encodeURIComponent(id)}`}
        @click=${(event: MouseEvent) => this.#openProduct(event, id)}
        ><wt-icon name="menu-edit" size="lg"></wt-icon>${t("product.edit")}</a
      ></wt-row-actions
    >`;
  }

  /** A product opens in the dashboard's own menu screen; a held modifier key keeps the
   * browser's own handling, such as opening a new tab. */
  #openProduct(event: MouseEvent, productId: string): void {
    if (leftToBrowser(event)) return;
    event.preventDefault();
    this.#emit("wt-edit-product", { productId });
  }

  /** A product with variants charges what its variants charge (owner decision, menu editor
   * redesign §3), so its row shows that price or range as text and offers no field. Its clash
   * sentence is not hidden from a screen reader, since no field carries it as a hint. */
  #derivedCell(line: Line) {
    const { item } = line;
    const clash = this.#clash(line);
    const inherited = this.#inherited(line);
    const variantsSetOne = pricesAVariant(item);
    const sign = currencySymbol(currentLocale()).side === "after" ? " sign-after" : "";
    return html`<span part="price-cell derived-cell"
      ><span part=${`derived-price${sign}`}
        >${clash === null && inherited.state === "price" ? spanText(inherited) : "—"}</span
      >${
        clash !== null || variantsSetOne
          ? html`<span part="price-notes"
              >${
                clash === null
                  ? nothing
                  : html`<span part="clash">${this.#clashSentence(line, clash)}</span>`
              }${
                variantsSetOne
                  ? html`<span part="muted price-note">${t("menu_prices.variant_overrides")}</span>`
                  : nothing
              }</span
            >`
          : nothing
      }</span
    >`;
  }

  #overrideCell(line: Line) {
    if (!hasField(line)) return this.#derivedCell(line);
    const key = keyOf(line);
    const clash = this.#clash(line);
    const sentence = clash === null ? "" : this.#clashSentence(line, clash);
    const inherited = this.#inherited(line);
    let placeholder: string;
    let hint: string;
    if (inherited.state === "clash" || clash === "own") {
      placeholder = t("menu_prices.clash_placeholder");
      hint = clash === "own" ? sentence : t("menu_prices.override_help_clash");
    } else {
      // A field's row, a variant or a product without variants, inherits one price, not a range.
      placeholder = formatDecimalInput(inherited.low, currentLocale());
      hint = t("menu_prices.override_help").replace("{price}", priceText(inherited.low));
    }
    const labelKey =
      this.#stored(line) !== null ? "menu_prices.override_label_set" : "menu_prices.override_label";
    return html`<span part="price-cell"
      ><wt-price-input
        part="override-field"
        name="price-override"
        data-row=${key}
        hide-label
        fixed-unit
        ?readonly=${this.saving}
        locale=${currentLocale()}
        label=${fill(labelKey, { name: this.#lineName(line) })}
        ?overriding=${this.#holds(line, this.drafts.get(key))}
        .value=${live(this.drafts.get(key) ?? this.#stored(line) ?? "")}
        .error=${this.#error(key)}
        placeholder=${placeholder}
        hint=${hint}
        @wt-change=${(event: CustomEvent<{ value: string }>) => this.#type(event, key)}
        @keydown=${(event: KeyboardEvent) => this.#onKeydown(event, line)}
      ></wt-price-input
      >${
        clash === null
          ? nothing
          : html`<span part="price-notes"
              ><span part="clash" aria-hidden="true">${sentence}</span></span
            >`
      }</span
    >`;
  }

  #invalid(key: string): boolean {
    const price = blankToNull(this.drafts.get(key) ?? "");
    return this.#feedback.attempted && price !== null && !isProductPrice(price);
  }

  #error(key: string): string {
    if (this.#invalid(key)) return t("editor.price_invalid");
    const refusal = this.refusals[key];
    return refusal?.namesField && this.#feedback.shows(key) ? refusal.reason : "";
  }

  #type(event: CustomEvent<{ value: string }>, key: string): void {
    event.stopPropagation();
    if (this.saving) return;
    this.drafts = new Map(this.drafts).set(key, event.detail.value);
    if (this.refusals[key]?.namesField) this.#feedback.dismiss(key);
    this.#scope?.changed();
    void this.#readHiddenErrors();
  }

  #onKeydown(event: KeyboardEvent, line: Line): void {
    if (this.saving) return;
    if (event.key === "Escape" && !belongsToComposition(event)) {
      event.preventDefault();
      event.stopPropagation();
      const key = keyOf(line);
      const drafts = new Map(this.drafts);
      drafts.delete(key);
      this.drafts = drafts;
      if (this.refusals[key]?.namesField) this.#feedback.dismiss(key);
      this.#scope?.changed();
      void this.#readHiddenErrors();
    } else submitOnEnter(event, this.renderRoot.querySelector('[data-test="prices-save"]'));
  }

  #changes(): PriceSave[] {
    const saves: PriceSave[] = [];
    for (const [key, text] of this.drafts) {
      const line = this.#lineOf.get(key);
      const price = blankToNull(text);
      if (
        line !== undefined &&
        ((price !== null && !isProductPrice(price)) || !samePrice(price, this.#stored(line)))
      )
        saves.push({
          key,
          menuItemId: line.item.menuItemId,
          variantId: line.variant?.variantId ?? null,
          name: this.#lineName(line),
          price,
        });
    }
    return saves;
  }

  #cancel(): void {
    this.drafts = new Map();
    this.refusals = {};
    this.#feedback.reset();
    this.#scope?.changed();
  }

  async #save(): Promise<void> {
    if (this.saving || this.loading || !this.savePrices || saveActionState(this.#scope).unchanged)
      return;
    const saves = this.#changes();
    this.#feedback.press();
    this.refusals = {};
    const invalid = saves.filter(({ key }) => this.#invalid(key));
    if (invalid.length > 0) {
      this.requestUpdate();
      this.#table()?.requestUpdate();
      await this.#focusError(invalid.map(({ key }) => key));
      return;
    }
    this.saving = true;
    const { saved, refused } = await this.savePrices(saves);
    if (!this.isConnected) return;
    const drafts = new Map(this.drafts);
    for (const { key, price } of saves) {
      if (!saved.has(key)) continue;
      drafts.delete(key);
      this.#saved.set(key, price);
    }
    this.drafts = drafts;
    this.saving = false;
    this.refusals = refused;
    if (Object.keys(refused).length === 0) this.#feedback.reset();
    else this.#feedback.newRefusal();
    this.#scope?.commit(false);
    const fieldRefusals = saves.map(({ key }) => key).filter((key) => refused[key]?.namesField);
    if (fieldRefusals.length > 0) await this.#focusError(fieldRefusals);
    if (saved.size > 0 && this.isConnected) await this.refreshPrices?.();
  }

  async #focusError(keys: readonly string[]): Promise<void> {
    await this.updateComplete;
    for (const key of keys) {
      await this.#focusField(key);
      if (this.#field(key) !== null) break;
    }
    await this.#readHiddenErrors();
  }

  async #readHiddenErrors(): Promise<void> {
    const table = this.#table();
    if (table === null) return;
    await table.updateComplete;
    const hidden = new Set(
      this.#changes()
        .map(({ key }) => key)
        .filter((key) => this.#error(key) && !this.#field(key)),
    );
    if (
      hidden.size !== this.hiddenErrors.size ||
      [...hidden].some((key) => !this.hiddenErrors.has(key))
    )
      this.hiddenErrors = hidden;
  }

  #formMessage(saves: readonly PriceSave[]): string {
    const errors: Record<string, string> = {};
    const fields = new Set<string>();
    for (const { key, name } of saves) {
      const fieldError = this.#error(key);
      const refusal = this.refusals[key];
      if (fieldError && !this.hiddenErrors.has(key)) fields.add(key);
      else if (fieldError || (refusal && this.#feedback.shows(key)))
        errors[key] = fill("menus.change_not_saved", {
          name,
          reason: fieldError || refusal!.reason,
        });
    }
    return this.#feedback.message(errors, fields, t("form.fix_fields"));
  }

  #variantName(variantId: string): string {
    return this.#variants.get(variantId)?.name ?? t("members.missing");
  }

  #placementName(path: readonly string[]): string {
    if (path.length === 0) return t("menu_prices.top_level");
    return path
      .map((id) => this.#sectionNames.get(id) ?? t("members.missing"))
      .join(PATH_SEPARATOR);
  }

  #categoryName(row: MenuPriceRow): string {
    if (row.categoryId === null) return t("categories.none");
    return this.#categoryLabels.get(row.categoryId) ?? t("editor.missing_choice");
  }

  #emit(name: string, detail: object): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  #buildColumns(): DataTableColumn<Line>[] {
    const reached = new Set([...this.#reached.values()].flat());
    const sectionOptions = [...reached]
      .map((id) => ({ value: id, label: this.#sectionNames.get(id) ?? t("members.missing") }))
      .sort((a, b) => byLabel(a.label, b.label));
    const offeredCategories = new Set(
      this.rows.flatMap(({ categoryId }) =>
        categoryId === null ? [] : (this.#categoryChains.get(categoryId) ?? []),
      ),
    );
    const categoryOptions = [...this.#categoryPaths]
      .filter(([value]) => offeredCategories.has(value))
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
            ? html`<span part="visually-hidden">${item.name} </span
                ><span part="variant-name">${this.#variantName(variant.variantId)}</span>`
            : html`<span part="name-box"
                ><span part="name">${item.name}</span> ${
                  item.variants.length
                    ? html`<span part="note">${t("menu_prices.has_variants")}</span>`
                    : nothing
                }</span
              >`,
      },
      {
        key: "override",
        label: t("menu_prices.override_column"),
        // A range sorts by its low end.
        sortValue: (line) => {
          const shown = this.#shown(line);
          return shown.state === "price" ? stringToCents(shown.low) : null;
        },
        cell: (line) => this.#overrideCell(line),
        filter: {
          label: t("menu_prices.price_filter"),
          allLabel: t("menu_prices.all_prices"),
          value: (line) => [
            this.#overridden(line) ? "overridden" : "not_overridden",
            ...(this.#clashing.has(keyOf(line)) ? ["clash"] : []),
          ],
          options: [
            { value: "overridden", label: t("menu_prices.overridden_only") },
            { value: "not_overridden", label: t("menu_prices.not_overridden") },
            ...(this.#clashing.size > 0
              ? [{ value: "clash", label: t("menu_prices.clashes_only") }]
              : []),
          ],
          // Never absent: the table forgets a chosen All prices on a column with no `initial`.
          initial: this.#startOnClashes ? "clash" : "",
        },
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
          multiple: {
            countLabel: (count) => t("menu_prices.section_count").replace("{count}", String(count)),
          },
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
          multiple: {
            countLabel: (count) =>
              t("menu_prices.category_count").replace("{count}", String(count)),
          },
          value: ({ item }) =>
            item.categoryId === null ? [] : (this.#categoryChains.get(item.categoryId) ?? []),
          options: categoryOptions,
        },
      },
      {
        key: "available",
        label: t("editor.available"),
        choosable: "shown",
        sortValue: (line) => ((line.variant ?? line.item).available ? 0 : 1),
        cell: (line) => this.#availableCell(line),
      },
      {
        key: "actions",
        label: t("members.actions"),
        align: "end",
        pinned: "end",
        cell: (line) => this.#actionsCell(line),
      },
    ];
  }

  #clashMessage() {
    const count = this.#clashCount;
    if (this.loading || this.failed || count === 0) return nothing;
    const words =
      count === 1
        ? t("menu_prices.clash_message_one")
        : t("menu_prices.clash_message").replace("{count}", String(count));
    // Clashes is offered only while a row is marked, which the publish count does not decide.
    const offer = this.#clashing.size > 0 && !this.filterOnClashes;
    return html`<div class="clash-line">
      <p class="error" role="status" data-test="clash-message">${words}</p>
      ${
        offer
          ? html`<wt-button
              variant="ghost"
              data-test="show-clashes"
              @click=${() => void this.#showClashes()}
              >${t("menu_prices.show_clashes")}</wt-button
            >`
          : nothing
      }
    </div>`;
  }

  override render() {
    const changes = this.#changes();
    const action = saveActionState(this.#scope);
    return html`${this.#clashMessage()}<wt-data-table
        @wt-filter-change=${() => {
          this.#readFilter();
          void this.#readHiddenErrors();
        }}
        @input=${() => void this.#readHiddenErrors()}
        @wt-expand-change=${() => void this.#readHiddenErrors()}
        noMatchesMessage=${tableNoMatches()}
        filterSearchPlaceholder=${t("categories.combobox_search")}
        filterNoResultsLabel=${t("categories.combobox_no_results")}
        aria-label=${fill("menu_prices.label", { menu: this.menuName })}
        viewKey="waitron.menus.menu-prices.table"
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
        .rowKey=${keyOf}
        .rowParent=${parentKey}
        .rowKeepsChildOrder=${keepsVariantOrder}
        initiallyCollapsed
        .rowToggleLabel=${toggleLabel}
        .loading=${this.loading}
        loadingMessage=${t("menu_prices.loading")}
        errorMessage=${this.failed ? t("menu_prices.error") : ""}
        emptyMessage=${t("menu_prices.empty")}
      ></wt-data-table>
      <wt-form-actions .error=${this.#formMessage(changes)}>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="prices-cancel"
          ?disabled=${this.saving || action.unchanged}
          @click=${() => this.#cancel()}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          variant=${this.saving ? "primary" : action.variant}
          data-test="prices-save"
          ?disabled=${action.unchanged || this.saving || this.loading || changes.some(({ key }) => this.#invalid(key))}
          @click=${() => void this.#save()}
          >${t("action.save")}</wt-button
        >
      </wt-form-actions>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-menu-prices-table": MenuPricesTable;
  }
}
