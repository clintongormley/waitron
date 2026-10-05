import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-price-input.js";
import { describeSetting, placeName } from "./price-source.js";
import {
  productInherited,
  sizeClash,
  sizeSetting,
  sizesInheritedFrom,
  variantInherited,
  variantInheritedFrom,
  withoutOwn,
  type Inherited,
  type InheritedFrom,
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
  Product,
} from "../api/client.js";
import { currentLocale, t } from "../i18n/t.js";
import { leftToBrowser } from "../navigation.js";
import { byLabel, categoryAncestors, categoryPath } from "./category-form.js";
import { priceSearchText, priceText } from "./form-fields.js";

/** One field's value to write. `previous` is the value it replaces in the order writes are made,
 * which Undo writes back. */
export interface PriceSave {
  key: string;
  menuItemId: string;
  variantId: string | null;
  /** The product's staff name, or "<product> — <size>", for a message away from the field. */
  name: string;
  price: string | null;
  previous: string | null;
  undo?: boolean;
}

/** What the status line says. */
export type PriceOutcome =
  { kind: "saved"; save: PriceSave } | { kind: "refused"; save: PriceSave; reason: string };

const blankToNull = (text: string): string | null => (text.trim() === "" ? null : text.trim());

/** By amount, so "2.5" typed over a stored "2.50" is no change. */
const samePrice = (a: string | null, b: string | null): boolean =>
  a === null || b === null ? a === b : stringToCents(a) === stringToCents(b);

/** A table row: a product the menu reaches, or one of its sizes, Active or not, drawn under it. */
interface Line {
  item: MenuPriceRow;
  variant: MenuPriceVariant | null;
}

/** The row's key in the table, and the key of its field's saves and refusals. */
const keyOf = ({ item, variant }: Line): string =>
  variant ? `${item.menuItemId}:${variant.variantId}` : item.menuItemId;

/** Whether this menu stores a price for any of the product's sizes. */
const pricesASize = (item: MenuPriceRow): boolean =>
  item.variants.some(({ price }) => price !== null);

type Span = { low: string; high: string };

const oneAmount = ({ low, high }: Span): boolean => stringToCents(low) === stringToCents(high);

const spanText = (span: Span, format: (amount: string) => string = priceText): string =>
  oneAmount(span)
    ? format(span.low)
    : t("menu_prices.range")
        .replace("{low}", format(span.low))
        .replace("{high}", format(span.high));

/**
 * One menu's price overrides: a row per product the menu reaches, Active or not, with its sizes
 * under it, each showing its Active state and a field for the price this menu sets for it. A field
 * asks for its own save on Enter or on leaving it, through `wt-price-save`; the host performs the
 * writes and says which are out (`saving`), which were refused for the price typed (`refusals`) and
 * what the status line says (`outcome`).
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
      }
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
        display: inline-grid;
        grid-template-columns: auto auto;
        align-items: center;
        gap: var(--wt-space-1);
      }
      /* Contained, so a note wraps inside the field and its "?" rather than widening the column. */
      wt-data-table::part(price-notes) {
        grid-column: 1 / -1;
        contain: inline-size;
        text-align: end;
      }
      wt-data-table::part(saving),
      wt-data-table::part(clash),
      wt-data-table::part(price-note) {
        display: block;
      }
      wt-data-table::part(price-note) {
        font-size: var(--wt-font-size-sm);
      }
      /* Wide enough that a range placeholder shows whole rather than clipped into one price. Its
         positioned box holds the field's hidden hint, which otherwise escapes the table's scroller
         and widens the page. Its end margin is the status line's height, which is sticky at the
         bottom and would otherwise cover a field scrolled into view under it. */
      wt-data-table::part(override-field) {
        position: relative;
        --wt-price-field-width: var(--wt-price-range-field-width);
        scroll-margin-block-end: calc(var(--wt-tap-min) + 2 * var(--wt-space-2));
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
      wt-data-table::part(note) {
        display: block;
        padding-inline: var(--wt-space-4);
        font-size: var(--wt-font-size-sm);
      }
      /* Above wt-data-table's pinned column, which is layered at 2. */
      .outcome {
        position: sticky;
        bottom: 0;
        z-index: 3;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        padding-block: var(--wt-space-2);
        background: var(--wt-color-bg);
      }
      .outcome p {
        margin: 0;
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
  /** Row keys with a save queued or out. */
  @property({ attribute: false }) saving: ReadonlySet<string> = new Set();
  /** Row key to message, for refusals that name the price typed. */
  @property({ attribute: false }) refusals: Readonly<Record<string, string>> = {};
  @property({ attribute: false }) outcome: PriceOutcome | null = null;

  /** Text typed into a field and not yet settled: unsent, sent and waiting, or refused. */
  @state() private drafts: ReadonlyMap<string, string> = new Map();
  /** Fields showing their own check's message. */
  @state() private invalid: ReadonlySet<string> = new Set();
  /** Refusals hidden since their field changed. */
  @state() private hiddenRefusals: ReadonlySet<string> = new Set();
  /** Fields whose last Enter or leaving failed their own check, so each change checks them again. */
  readonly #checking = new Set<string>();
  /** The text each field last sent, so a second commit of it sends nothing. */
  readonly #sent = new Map<string, string>();

  #sectionNames: ReadonlyMap<string, string> = new Map();
  /** Each row's sections, every placement's together, for the section filter. */
  #reached: ReadonlyMap<MenuPriceRow, string[]> = new Map();
  #categoryPaths: ReadonlyMap<string, string> = new Map();
  /** Each category with the categories above it, so a filter on a category keeps those inside it. */
  #categoryChains: ReadonlyMap<string, string[]> = new Map();
  #variants: ReadonlyMap<string, Product["variants"][number]> = new Map();
  #lines: Line[] = [];
  #columns: DataTableColumn<Line>[] = [];

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
    if (changed.has("sections") || changed.has("categories") || changed.has("rows"))
      this.#columns = this.#buildColumns();
    if (changed.has("refusals")) {
      const before = changed.get("refusals") ?? {};
      // A refusal sent anew shows again under a field changed since the last one.
      this.hiddenRefusals = new Set(
        [...this.hiddenRefusals].filter((key) => before[key] === this.refusals[key]),
      );
    }
    if (changed.has("outcome") && this.outcome?.kind === "refused") {
      const refused = this.outcome.save.key;
      this.hiddenRefusals = new Set([...this.hiddenRefusals].filter((key) => key !== refused));
    }
    if (changed.has("saving")) this.#settle(changed.get("saving") ?? new Set());
    if (changed.has("refusals") || changed.has("outcome"))
      this.#unrefuse(
        changed.has("refusals") ? (changed.get("refusals") ?? {}) : this.refusals,
        changed.has("outcome") ? (changed.get("outcome") ?? null) : this.outcome,
      );
  }

  /** A refused price nothing says was refused any longer would read as stored and be sent again
   * on leaving, so its field goes back to the stored price, unless it was changed since. */
  #unrefuse(refusals: MenuPricesTable["refusals"], outcome: PriceOutcome | null): void {
    const before = Object.keys(refusals);
    if (outcome?.kind === "refused") before.push(outcome.save.key);
    for (const key of before) {
      if (this.#refused(key) || this.saving.has(key) || !this.drafts.has(key)) continue;
      if (this.drafts.get(key) !== this.#sent.get(key)) continue;
      this.#forget(key);
      this.hiddenRefusals = new Set([...this.hiddenRefusals].filter((hidden) => hidden !== key));
    }
  }

  /** A save answered without a refusal leaves its field to the re-read that followed it, unless
   * the field was changed again meanwhile. */
  #settle(before: ReadonlySet<string>): void {
    const drafts = new Map(this.drafts);
    for (const key of before) {
      if (this.saving.has(key) || this.#refused(key)) continue;
      if (drafts.get(key) !== this.#sent.get(key)) continue;
      drafts.delete(key);
      this.#sent.delete(key);
    }
    if (drafts.size !== this.drafts.size) this.drafts = drafts;
  }

  protected override updated(changed: PropertyValues): void {
    // The cells read these, and the table redraws only when its own properties change.
    if (
      ["drafts", "invalid", "hiddenRefusals", "saving", "refusals"].some((name) =>
        changed.has(name),
      )
    )
      this.#table()?.requestUpdate();
    if (changed.has("refusals")) {
      const before = (changed.get("refusals") ?? {}) as MenuPricesTable["refusals"];
      const key = Object.keys(this.refusals).find((key) => before[key] !== this.refusals[key]);
      if (key !== undefined) void this.#focusField(key);
    }
  }

  #table(): HTMLElementTagNameMap["wt-data-table"] | null {
    return this.shadowRoot?.querySelector("wt-data-table") ?? null;
  }

  /** Null for a size under a collapsed product, whose row is not drawn. */
  #field(key: string): HTMLElementTagNameMap["wt-price-input"] | null {
    return (
      this.#table()?.shadowRoot?.querySelector<HTMLElementTagNameMap["wt-price-input"]>(
        `wt-price-input[data-row="${CSS.escape(key)}"]`,
      ) ?? null
    );
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
    this.#categoryChains = new Map(
      this.categories.map((category) => [
        category.id,
        categoryAncestors(category, this.categories).map(({ id }) => id),
      ]),
    );
  }

  #priceSetting({ item, variant }: Line): Setting<Decimal> {
    return variant ? sizeSetting(item, variant.variantId) : item.combined.price;
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
    return this.#stored(line) !== null || (line.variant === null && pricesASize(line.item));
  }

  /** The product's price as its field reads now, which a size following it inherits. */
  #parentPrice(item: MenuPriceRow): ParentPrice {
    const text = this.drafts.get(item.menuItemId)?.trim();
    if (text === undefined) return undefined;
    if (text === "") return null;
    return isProductPrice(text) ? text : undefined;
  }

  /** What the row charges with its field left blank. */
  #inherited(line: Line): Inherited {
    return line.variant
      ? variantInherited(line.item, line.variant.variantId, this.#parentPrice(line.item))
      : productInherited(line.item);
  }

  /** What the row charges: its stored price, else what it inherits. */
  #shown(line: Line): Inherited {
    const stored = this.#stored(line);
    return stored === null ? this.#inherited(line) : { state: "price", low: stored, high: stored };
  }

  /** "size" for a product row whose own price is decided but an Active size's is not; "own" for a
   * row whose own price, or what it inherits, is undecided and whose field holds no price. */
  #clash(line: Line): "size" | "own" | null {
    if (line.variant === null && sizeClash(line.item, this.#parentPrice(line.item))) return "size";
    if (this.#held(line)) return null;
    return this.#priceSetting(line).state === "clash" || this.#inherited(line).state === "clash"
      ? "own"
      : null;
  }

  /** Whether the row's field holds a price, typed or stored. */
  #held(line: Line): boolean {
    const text = this.drafts.get(keyOf(line))?.trim();
    return text === undefined ? this.#stored(line) !== null : text !== "" && isProductPrice(text);
  }

  #lineName({ item, variant }: Line): string {
    return variant ? `${item.name} — ${this.#variantName(variant.variantId)}` : item.name;
  }

  /** Where the price a blank field would take comes from, read from the same settings as its
   * placeholder; a product with sizes explains each of its Active sizes. */
  #tip(line: Line) {
    const { item, variant } = line;
    const names = { product: item.name };
    const explain = ({ setting, follows }: InheritedFrom) =>
      follows
        ? `${t("menu_prices.source_parent").replace("{name}", item.name)}. ${describeSetting(setting, names, t)}`
        : describeSetting(setting, names, t);
    let explanation: string;
    if (variant)
      explanation = explain(variantInheritedFrom(item, variant.variantId, this.#parentPrice(item)));
    else {
      const sizes = sizesInheritedFrom(item);
      explanation =
        sizes.length === 0
          ? describeSetting(withoutOwn(item.combined.price), names, t)
          : sizes
              .map((size) => {
                const price =
                  size.setting.state === "decided"
                    ? priceText(size.setting.value)
                    : t("menu_prices.clash");
                return `${this.#variantName(size.variantId)}: ${price}. ${explain(size)}`;
              })
              .join(" ");
    }
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
    if (leftToBrowser(event)) return;
    event.preventDefault();
    this.#emit("wt-edit-product", { productId });
  }

  #overrideCell(line: Line) {
    const { item, variant } = line;
    const key = keyOf(line);
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
      // As typed into a price field, which draws no sign.
      placeholder = spanText(inherited, (amount) => amount);
      hint = oneAmount(inherited)
        ? t("menu_prices.override_help").replace("{price}", priceText(inherited.low))
        : t("menu_prices.override_help_range").replace("{range}", spanText(inherited));
    }
    const sizesSetOne = variant === null && item.override === null && pricesASize(item);
    return html`<span part="price-cell"
      ><wt-price-input
        part="override-field"
        name="price-override"
        data-row=${key}
        hide-label
        fixed-unit
        locale=${currentLocale()}
        label=${t("menu_prices.override_label").replace("{name}", this.#lineName(line))}
        .value=${this.drafts.get(key) ?? this.#stored(line) ?? ""}
        .error=${this.#error(key)}
        placeholder=${placeholder}
        hint=${hint}
        @wt-change=${(event: CustomEvent<{ value: string }>) => this.#type(event, key)}
        @keydown=${(event: KeyboardEvent) => this.#onKeydown(event, line)}
        @focusout=${() => this.#commit(line, "leave")}
      ></wt-price-input
      >${this.#tip(line)}${
        this.saving.has(key) || clash !== null || sizesSetOne
          ? html`<span part="price-notes"
              >${
                this.saving.has(key)
                  ? html`<span part="muted saving">${t("menu_prices.saving")}</span>`
                  : nothing
              }${
                clash === null
                  ? nothing
                  : html`<span part="clash"
                      >${t(clash === "size" ? "menu_prices.size_clash" : "menu_prices.clash")}</span
                    >`
              }${
                sizesSetOne
                  ? html`<span part="muted price-note">${t("menu_prices.variant_overrides")}</span>`
                  : nothing
              }</span
            >`
          : nothing
      }</span
    >`;
  }

  #error(key: string): string {
    if (this.invalid.has(key)) return t("editor.price_invalid");
    return this.hiddenRefusals.has(key) ? "" : (this.refusals[key] ?? "");
  }

  /** Whether the field's last save was refused, under it or in the status line alone. */
  #refused(key: string): boolean {
    return (
      key in this.refusals || (this.outcome?.kind === "refused" && this.outcome.save.key === key)
    );
  }

  #type(event: CustomEvent<{ value: string }>, key: string): void {
    event.stopPropagation();
    const text = event.detail.value;
    this.drafts = new Map(this.drafts).set(key, text);
    this.hiddenRefusals = new Set([...this.hiddenRefusals, key]);
    if (this.#checking.has(key)) this.#mark(key, !this.#valid(text));
  }

  #valid(text: string): boolean {
    const price = blankToNull(text);
    return price === null || isProductPrice(price);
  }

  #mark(key: string, invalid: boolean): void {
    if (this.invalid.has(key) === invalid) return;
    const next = new Set(this.invalid);
    if (invalid) next.add(key);
    else next.delete(key);
    this.invalid = next;
  }

  #onKeydown(event: KeyboardEvent, line: Line): void {
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Enter") this.#commit(line, "enter");
    else this.#restore(keyOf(line));
  }

  #commit(line: Line, via: "enter" | "leave"): void {
    const key = keyOf(line);
    const text = this.drafts.get(key);
    if (text === undefined) return;
    // A refused price is sent again only on Enter, or once the field has changed.
    if (via === "leave" && this.#refused(key) && !this.hiddenRefusals.has(key)) return;
    if (!this.#valid(text)) {
      this.#checking.add(key);
      this.#mark(key, true);
      return;
    }
    this.#checking.delete(key);
    this.#mark(key, false);
    const price = blankToNull(text);
    const waiting = this.saving.has(key);
    const baseline = waiting ? blankToNull(this.#sent.get(key) ?? "") : this.#stored(line);
    if (samePrice(price, baseline)) {
      if (!waiting) this.#forget(key);
      return;
    }
    this.#send(line, text);
  }

  #send(line: Line, text: string): void {
    const key = keyOf(line);
    const sent = this.saving.has(key) ? this.#sent.get(key) : undefined;
    const previous = sent === undefined ? this.#stored(line) : blankToNull(sent);
    this.#sent.set(key, text);
    this.#emit("wt-price-save", {
      key,
      menuItemId: line.item.menuItemId,
      variantId: line.variant?.variantId ?? null,
      name: this.#lineName(line),
      price: blankToNull(text),
      previous,
    } satisfies PriceSave);
  }

  /** Writes back the price the saved one replaced, shown in its field while it is out. */
  #undo(save: PriceSave): void {
    const text = save.previous ?? "";
    this.drafts = new Map(this.drafts).set(save.key, text);
    this.hiddenRefusals = new Set([...this.hiddenRefusals, save.key]);
    this.#checking.delete(save.key);
    this.#mark(save.key, false);
    this.#sent.set(save.key, text);
    this.#emit("wt-price-save", {
      ...save,
      price: save.previous,
      previous: save.price,
      undo: true,
    } satisfies PriceSave);
  }

  /** Escape: back to the stored price, or, while a save is out, to the text it sent. */
  #restore(key: string): void {
    const sent = this.saving.has(key) ? this.#sent.get(key) : undefined;
    if (sent === undefined) this.#forget(key);
    else {
      this.drafts = new Map(this.drafts).set(key, sent);
      this.#checking.delete(key);
      this.#mark(key, false);
    }
    this.hiddenRefusals = new Set([...this.hiddenRefusals, key]);
  }

  #forget(key: string): void {
    const drafts = new Map(this.drafts);
    drafts.delete(key);
    this.drafts = drafts;
    this.#checking.delete(key);
    this.#mark(key, false);
    this.#sent.delete(key);
  }

  /** A candidate chosen in Resolve is sent as if typed into the row's field. */
  #resolve(line: Line, price: string): void {
    const key = keyOf(line);
    this.drafts = new Map(this.drafts).set(key, price);
    this.hiddenRefusals = new Set([...this.hiddenRefusals, key]);
    this.#checking.delete(key);
    this.#mark(key, false);
    this.#send(line, price);
  }

  #resolveActions(line: Line) {
    const price = this.#priceSetting(line);
    if (price.state !== "clash") return nothing;
    return html`<wt-row-actions
      part="resolve"
      align="end"
      label=${`${t("menu_prices.resolve")} ${this.#lineName(line)}`}
    >
      ${price.candidates.map((candidate) =>
        "value" in candidate
          ? html`<wt-button
              variant="secondary"
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
        @click=${(event: Event) => {
          event.stopPropagation();
          (event.currentTarget as HTMLElement)
            .closest<HTMLElementTagNameMap["wt-row-actions"]>("wt-row-actions")!
            .hide();
          this.#field(keyOf(line))?.focus();
        }}
        >${t("menu_prices.set_price")}</wt-button
      >
    </wt-row-actions>`;
  }

  #variantName(variantId: string): string {
    return this.#variants.get(variantId)?.name ?? t("members.missing");
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
            : html`<span part="name">${item.name}</span> ${
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
    const priced = (item: MenuPriceRow) => this.#overridden({ item, variant: null });
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
        .rowKey=${keyOf}
        .rowParent=${({ item, variant }: Line) => (variant ? item.menuItemId : null)}
        initiallyCollapsed
        .rowToggleLabel=${({ item }: Line, expanded: boolean) =>
          t(expanded ? "menu_prices.collapse" : "menu_prices.expand").replace("{name}", item.name)}
        .loading=${this.loading}
        loadingMessage=${t("menu_prices.loading")}
        errorMessage=${this.failed ? t("menu_prices.error") : ""}
        emptyMessage=${t("menu_prices.empty")}
      ></wt-data-table>
      <div class="outcome">
        <p role="status" data-test="price-outcome">${this.#outcomeText()}</p>
        ${this.#undoButton()}
      </div>`;
  }

  #outcomeText(): string {
    const outcome = this.outcome;
    if (outcome === null) return "";
    const { name, price } = outcome.save;
    if (outcome.kind === "refused")
      return t("menus.change_not_saved")
        .replace("{name}", name)
        .replace("{reason}", outcome.reason);
    return price === null
      ? t("menu_prices.cleared").replace("{name}", name)
      : t("menu_prices.saved").replace("{name}", name).replace("{price}", priceText(price));
  }

  #undoButton() {
    const outcome = this.outcome;
    if (outcome?.kind !== "saved" || outcome.save.undo) return nothing;
    // Pressing it keeps focus where it is: a field left would save what it holds, and that new
    // save takes this Undo away before the click lands. Undo writes over its own field's text.
    return html`<wt-button
      variant="secondary"
      data-test="price-undo"
      @mousedown=${(event: Event) => event.preventDefault()}
      @click=${(event: Event) => {
        event.stopPropagation();
        this.#undo(outcome.save);
      }}
      >${t("menu_prices.undo")}</wt-button
    >`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-menu-prices-table": MenuPricesTable;
  }
}
