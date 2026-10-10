import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-toast.js";
import type { WtToast } from "@waitron/ui/src/components/wt-toast.js";
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
import { isProductPrice } from "@waitron/catalogue/src/modifier-limits.js";
import { clashesOf } from "@waitron/catalogue/src/menu-combine.js";
import { stringToCents } from "@waitron/shared";
import type {
  CategorySummary,
  SectionDetails,
  MenuPriceRow,
  MenuPriceVariant,
  Product,
} from "../api/client.js";
import { currentLocale, t } from "../i18n/t.js";
import { leftToBrowser } from "../navigation.js";
import { byLabel, categoryAncestors, categoryPath, PATH_SEPARATOR } from "./category-form.js";
import { priceText } from "./form-fields.js";
import { placeName } from "./price-source.js";

/** One field's value to write. `previous` is the value it replaces in the order writes are made,
 * which Undo writes back. */
export interface PriceSave {
  key: string;
  menuItemId: string;
  variantId: string | null;
  /** The product's staff name, or "<product> — <variant>", for a message away from the field. */
  name: string;
  price: string | null;
  previous: string | null;
  undo?: boolean;
}

/** What the floating outcome message says. */
export type PriceOutcome =
  { kind: "saved"; save: PriceSave } | { kind: "refused"; save: PriceSave; reason: string };

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
  t(expanded ? "menu_prices.collapse" : "menu_prices.expand").replace("{name}", item.name);
const keepsVariantOrder = ({ variant }: Line): boolean => variant === null;

/** The row as a published menu holds it: Inactive variants left out. */
const activeOffer = (item: MenuPriceRow): MenuPriceRow["combined"] => {
  const active = new Set(item.variants.filter((v) => v.active).map((v) => v.variantId));
  return {
    ...item.combined,
    variants: item.combined.variants.filter(({ variantId }) => active.has(variantId)),
  };
};

/** Whether a clash in the product's own price, as its field reads now, stops publishing: it has
 * no Active variant, or an Active variant charges that clashing price. */
const ownPriceSold = (item: MenuPriceRow, parent: ParentPrice = undefined): boolean =>
  item.variants.every((v) => !v.active) || followsClash(item, parent);

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
            ? t("menu_prices.source_candidate")
                .replace("{price}", priceText(candidate.value))
                .replace("{place}", () => place)
            : t("menu_prices.candidate_undecided").replace("{place}", () => place);
        })
        .join(", ");

const pricesSentence = (setting: Setting<Decimal>): string =>
  t("menu_prices.clash_prices").replace("{candidates}", () => candidatesText(setting));

type Span = { low: string; high: string };

const oneAmount = ({ low, high }: Span): boolean => stringToCents(low) === stringToCents(high);

const spanText = (span: Span, format: (amount: string) => string = priceText): string =>
  oneAmount(span)
    ? format(span.low)
    : t("menu_prices.range")
        .replace("{low}", format(span.low))
        .replace("{high}", format(span.high));

/** As typed into a price field, which draws no sign. */
const placeholderOf = (span: Span): string => spanText(span, (amount) => amount);

/**
 * One menu's price overrides: a row per Active product the menu reaches, with its Active variants
 * under it, each showing whether it is Available and a field for the price this menu sets for it.
 * A field asks for its own save on Enter or on leaving it, through `wt-price-save`; the host
 * performs the writes and says which are out (`saving`), which were refused for the price typed
 * (`refusals`) and the outcome of the last save (`outcome`), which floats over the page: a save for
 * 5 s, with its Undo; a refusal until it is closed or another outcome replaces it, as it may be
 * said nowhere else.
 */
@customElement("dashboard-menu-prices-table")
export class MenuPricesTable extends LitElement {
  static override styles = [
    baseStyles,
    css`
      /* A field's width counts its padding, --wt-space-3 on each side, as well as its text. */
      :host {
        display: block;
        container-type: inline-size;
        --range-field-width: calc(var(--range-text-width, 0px) + 2 * var(--wt-space-3));
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
      /* Wide enough that a range placeholder shows whole rather than clipped into one price: the
         widest range the table shows is measured, in the placeholder's own font, into
         --range-text-width. Phone width sizes it below. Its positioned box holds the field's hidden
         hint, which otherwise escapes the table's scroller and widens the page. Its end margin
         clears the outcome message floating at the bottom, whose height is measured into
         --outcome-height because a long sentence wraps it. */
      wt-data-table::part(override-field) {
        position: relative;
        --wt-price-field-width: max(var(--wt-price-range-field-width), var(--range-field-width));
        scroll-margin-block-end: max(
          var(--wt-tap-min) + 2 * var(--wt-space-2),
          var(--outcome-height, 0px) + var(--wt-space-3)
        );
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
      /* Above wt-data-table's sticky header (3). */
      wt-toast {
        position: fixed;
        inset-block-end: var(--wt-space-3);
        inset-inline-end: var(--wt-space-3);
        z-index: 4;
        max-width: calc(100% - 2 * var(--wt-space-3));
      }
      /* Room for the open message after the table, so the page can scroll the last row clear of it. */
      wt-toast[open] + .outcome-room {
        block-size: calc(var(--outcome-height, 0px) + var(--wt-space-3));
      }
      /* The table is never narrower than its cells' unwrapped text, so at phone width a name, and
         the note under it, is capped at the room the price column and the pinned row-menu column
         leave beside the cell's padding and the tree's toggle. The row-menu column is as wide as
         its heading in the current language, so its width is measured into --actions-width. While
         no field shows a range, the price field gives up width first, down to the base field's. A
         variant's name is indented one tree step further. */
      @container (max-width: 30rem) {
        wt-data-table {
          --name-and-field-room: calc(
            100cqi - var(--actions-width, var(--wt-tap-min)) - 4 *
              var(--wt-space-3) - var(--tree-arrow-width) - var(--wt-space-4)
          );
          --name-floor: var(--wt-tap-min);
          --narrow-price-field-width: clamp(
            var(--wt-price-field-width),
            var(--name-and-field-room) - var(--wt-tap-min) - var(--wt-space-6),
            var(--wt-price-range-field-width)
          );
          --name-room: calc(var(--name-and-field-room) - var(--narrow-price-field-width));
        }
        /* While a field shows a range, the names give up width first, down to --wt-space-6 or to
           the width the column's heading, measured into --name-heading-width, holds them at anyway.
           The pinned cell may cover part of the price cell's end padding. The field is never
           narrower than the range it shows: where the row then does not fit, the table scrolls
           sideways under the pinned cell. */
        wt-data-table.ranges {
          --name-floor: max(
            var(--wt-space-6),
            var(--name-heading-width, 0px) - var(--tree-arrow-width)
          );
          --narrow-price-field-width: max(
            var(--range-field-width),
            clamp(
              var(--wt-price-field-width),
              var(--name-and-field-room) + var(--wt-space-2) - var(--name-floor),
              var(--wt-price-range-field-width)
            )
          );
        }
        wt-data-table::part(override-field) {
          --wt-price-field-width: var(--narrow-price-field-width);
        }
        wt-data-table::part(name-box) {
          display: block;
          max-inline-size: max(var(--name-floor), var(--name-room));
        }
        wt-data-table::part(variant-name) {
          padding-inline-start: var(--wt-space-3);
          max-inline-size: calc(max(var(--name-floor), var(--name-room)) - var(--wt-space-2));
        }
      }
      @media (max-width: 48rem) {
        wt-toast {
          inset-inline: var(--wt-space-2);
          max-width: none;
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
  /** Whether the table's price filter is on Clashes, read from the table once it has drawn, since
   * it restores a remembered choice itself. */
  @state() private filterOnClashes = true;
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
  #lineOf: ReadonlyMap<string, Line> = new Map();
  #columns: DataTableColumn<Line>[] = [];
  /** Per product, what it charges with its field blank and where each Active variant's price comes
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

  #readClashes(): void {
    const clashing = new Map<string, "variant" | "own">();
    let count = 0;
    for (const item of this.rows) {
      if (!item.active) continue;
      count += clashesOf(activeOffer(item)).length;
      const own =
        item.override === null &&
        ownPriceSold(item) &&
        (item.combined.price.state === "clash" ||
          this.#productInheritance.get(item)!.inherited.state === "clash");
      const product = variantClash(item) ? "variant" : own ? "own" : null;
      if (product !== null) clashing.set(item.menuItemId, product);
      for (const { variantId, price, active } of item.variants) {
        if (!active || price !== null) continue;
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

  /** Watched, not only measured on each outcome, so a narrower window that wraps the message onto
   * another row still keeps a field clear of it. */
  readonly #outcomeSize = new ResizeObserver(() => this.#fitOutcome());
  /** The table resizes when the window does and when a redraw changes its columns' words. Measured
   * a frame later, never inside the observer's callback, which the names' new widths would
   * re-trigger. */
  readonly #tableSize = new ResizeObserver(() => {
    cancelAnimationFrame(this.#actionsFrame);
    this.#actionsFrame = requestAnimationFrame(() => this.#fitActions());
  });
  #actionsFrame = 0;
  #outcomeFitted: Promise<void> = Promise.resolve();

  #toast(): WtToast {
    return this.renderRoot.querySelector("wt-toast")!;
  }

  #fitActions(): void {
    const head = this.#table()?.shadowRoot?.querySelector("thead");
    this.#measureInto("--actions-width", head?.querySelector('th[data-pinned="end"]'));
    this.#measureInto("--name-heading-width", head?.querySelector('[part="tree-heading"]'));
    this.#fitRanges();
  }

  /** The ranges the fields show now, as their placeholders read; set on each draw. */
  #ranges: string[] = [];
  /** The ranges --range-text-width was last measured for, joined. */
  #measuredRanges = "";
  #canvas: CanvasRenderingContext2D | null = null;

  /** Measured in a field's own placeholder font, as fonts differ between machines; a field not
   * holding a price is chosen, whose placeholder is not drawn bold. */
  #fitRanges(): void {
    if (this.#ranges.length === 0) {
      this.#measuredRanges = "";
      this.style.removeProperty("--range-text-width");
      return;
    }
    const fields = this.#table()?.shadowRoot;
    const input = (
      fields?.querySelector("wt-price-input:not([overriding])") ??
      fields?.querySelector("wt-price-input")
    )?.shadowRoot?.querySelector("input");
    if (!input) return;
    this.#measuredRanges = this.#ranges.join("\n");
    const style = getComputedStyle(input, "::placeholder");
    const context = (this.#canvas ??= document.createElement("canvas").getContext("2d")!);
    context.font = style.font;
    context.letterSpacing = style.letterSpacing;
    const widest = Math.max(...this.#ranges.map((range) => context.measureText(range).width));
    // A pixel to spare, as a box's reported width (`clientWidth`) is rounded to a whole pixel.
    const width = `${Math.ceil(widest) + 1}px`;
    if (this.style.getPropertyValue("--range-text-width") !== width)
      this.style.setProperty("--range-text-width", width);
  }

  #measureInto(property: string, node: Element | null | undefined): void {
    const width = node ? `${node.getBoundingClientRect().width}px` : "";
    if (this.style.getPropertyValue(property) === width) return;
    if (width === "") this.style.removeProperty(property);
    else this.style.setProperty(property, width);
  }

  #fitOutcome(): void {
    this.style.setProperty("--outcome-height", `${this.#toast().getBoundingClientRect().height}px`);
  }

  /** Shown anew for each outcome, so an equal sentence still restarts its countdown, and measured
   * once it and its Undo have drawn, which decides whether the message wraps. */
  async #showOutcome(): Promise<void> {
    const toast = this.#toast();
    if (this.outcome !== null) toast.show();
    await toast.updateComplete;
    await this.renderRoot.querySelector<LitElement>('[data-test="price-undo"]')?.updateComplete;
    this.#fitOutcome();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this.hasUpdated) return;
    this.#outcomeSize.observe(this.#toast());
    this.#tableSize.observe(this.#table()!);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#outcomeSize.disconnect();
    this.#tableSize.disconnect();
  }

  protected override firstUpdated(): void {
    this.#outcomeSize.observe(this.#toast());
    this.#tableSize.observe(this.#table()!);
  }

  /** Resolves once the outcome message's new height is measured too. */
  protected override async getUpdateComplete(): Promise<boolean> {
    const done = await super.getUpdateComplete();
    await this.#outcomeFitted;
    return done;
  }

  protected override updated(changed: PropertyValues): void {
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
        if (reshaped) this.#fitActions();
        else if (this.#ranges.join("\n") !== this.#measuredRanges) this.#fitRanges();
      });
    if (changed.has("outcome")) this.#outcomeFitted = this.#showOutcome();
    // The cells read these, and the table redraws only when its own properties change.
    if (
      ["invalid", "hiddenRefusals", "saving", "refusals"].some((name) => changed.has(name)) ||
      (changed.has("drafts") &&
        this.#draftsRedraw(changed.get("drafts") as MenuPricesTable["drafts"]))
    )
      this.#table()?.requestUpdate();
    if (changed.has("refusals")) {
      const before = (changed.get("refusals") ?? {}) as MenuPricesTable["refusals"];
      const key = Object.keys(this.refusals).find((key) => before[key] !== this.refusals[key]);
      if (key !== undefined) void this.#focusField(key);
    }
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
   * field, or to the search box when the search leaves none. */
  async #showClashes(): Promise<void> {
    const table = this.#table()!;
    table.chooseFilter("override", ["clash"]);
    await table.updateComplete;
    const root = table.shadowRoot!;
    (
      root.querySelector<HTMLElement>("wt-price-input[data-row]") ??
      root.querySelector<HTMLElement>('input[name="search"]')!
    ).focus();
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
    return variant ? variantSetting(item, variant.variantId) : item.combined.price;
  }

  #readLines(): void {
    this.#lines = this.rows.flatMap((item) => [
      { item, variant: null },
      ...item.variants.map((variant) => ({ item, variant })),
    ]);
    this.#lineOf = new Map(this.#lines.map((line) => [keyOf(line), line]));
  }

  #active({ item, variant }: Line): boolean {
    return item.active && (variant?.active ?? true);
  }

  /** The price this menu stores for the row, or null. */
  #stored({ item, variant }: Line): string | null {
    return variant ? variant.price : item.override;
  }

  /** Whether this menu stores a price for the row, or, on a product, for any of its variants. */
  #overridden(line: Line): boolean {
    return this.#stored(line) !== null || (line.variant === null && pricesAVariant(line.item));
  }

  /** What depends on the row's product's field, worked out again only once that field reads
   * another price. */
  #withParent(line: Line) {
    const parent = parentPriceOf(this.drafts.get(line.item.menuItemId));
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

  /** An Active row's mark, its product's field as it reads now: "variant" on a product row by
   * `variantClash`; "own" on a row whose field holds no price and whose own price, or what it
   * inherits, clashes, on a product row only while `ownPriceSold`. */
  #clash(line: Line): "variant" | "own" | null {
    if (!this.#active(line)) return null;
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
            .filter(({ active }) => active)
            .map(({ variantId }) => ({ variantId, setting: variantSetting(item, variantId) }))
            .filter(({ setting }) => setting.level === "variant")
        : this.#productInheritance.get(item)!.variants;
    return [
      t("menu_prices.variant_clash_lead"),
      ...variants
        .filter(({ setting }) => setting.state === "clash")
        .map(({ variantId, setting }) =>
          t("menu_prices.variant_clash")
            .replace("{variant}", () => this.#variantName(variantId))
            .replace("{candidates}", () => candidatesText(setting)),
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
        href=${`/manage/catalogue/product/${encodeURIComponent(id)}`}
        @click=${(event: MouseEvent) => this.#openProduct(event, id)}
        >${t("product.edit")}</a
      ></wt-row-actions
    >`;
  }

  /** A product opens in the dashboard's own catalogue screen; a held modifier key keeps the
   * browser's own handling, such as opening a new tab. */
  #openProduct(event: MouseEvent, productId: string): void {
    if (leftToBrowser(event)) return;
    event.preventDefault();
    this.#emit("wt-edit-product", { productId });
  }

  /** Whether the row inherits a range and either has no stored price or has had it cleared, so
   * typing into an unpriced field does not narrow it under the cursor. */
  #showsRange(line: Line): boolean {
    const inherited = this.#inherited(line);
    return (
      (this.#stored(line) === null || this.drafts.get(keyOf(line)) === "") &&
      this.#clash(line) === null &&
      inherited.state !== "clash" &&
      !oneAmount(inherited)
    );
  }

  #overrideCell(line: Line) {
    const { item, variant } = line;
    const key = keyOf(line);
    const clash = this.#clash(line);
    const sentence = clash === null ? "" : this.#clashSentence(line, clash);
    const inherited = this.#inherited(line);
    let placeholder: string;
    let hint: string;
    if (clash === "variant") {
      placeholder = "—";
      hint = sentence;
    } else if (inherited.state === "clash" || clash === "own") {
      placeholder = t("menu_prices.clash_placeholder");
      hint = clash === "own" ? sentence : t("menu_prices.override_help_clash");
    } else {
      placeholder = placeholderOf(inherited);
      hint = oneAmount(inherited)
        ? t("menu_prices.override_help").replace("{price}", priceText(inherited.low))
        : t("menu_prices.override_help_range").replace("{range}", spanText(inherited));
    }
    const variantsSetOne = variant === null && item.override === null && pricesAVariant(item);
    const labelKey =
      this.#stored(line) !== null ? "menu_prices.override_label_set" : "menu_prices.override_label";
    return html`<span part="price-cell"
      ><wt-price-input
        part="override-field"
        name="price-override"
        data-row=${key}
        hide-label
        fixed-unit
        locale=${currentLocale()}
        label=${t(labelKey).replace("{name}", this.#lineName(line))}
        ?overriding=${this.#holds(line, this.drafts.get(key))}
        .value=${live(this.drafts.get(key) ?? this.#stored(line) ?? "")}
        .error=${this.#error(key)}
        placeholder=${placeholder}
        hint=${hint}
        @wt-change=${(event: CustomEvent<{ value: string }>) => this.#type(event, key)}
        @keydown=${(event: KeyboardEvent) => this.#onKeydown(event, line)}
        @focusout=${() => this.#commit(line, "leave")}
      ></wt-price-input
      >${
        clash !== null || variantsSetOne
          ? html`<span part="price-notes"
              >${
                clash === null
                  ? nothing
                  : html`<span part="clash" aria-hidden="true">${sentence}</span>`
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

  #error(key: string): string {
    if (this.invalid.has(key)) return t("editor.price_invalid");
    return this.hiddenRefusals.has(key) ? "" : (this.refusals[key] ?? "");
  }

  /** Whether the field's last save was refused, under it or in the outcome message alone. */
  #refused(key: string): boolean {
    return (
      key in this.refusals || (this.outcome?.kind === "refused" && this.outcome.save.key === key)
    );
  }

  #type(event: CustomEvent<{ value: string }>, key: string): void {
    event.stopPropagation();
    const text = event.detail.value;
    this.drafts = new Map(this.drafts).set(key, text);
    if (!this.hiddenRefusals.has(key)) this.hiddenRefusals = new Set([...this.hiddenRefusals, key]);
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
    this.#ranges = [
      ...new Set(
        this.#lines.flatMap((line) => {
          const inherited = this.#inherited(line);
          return this.#showsRange(line) && inherited.state === "price"
            ? [placeholderOf(inherited)]
            : [];
        }),
      ),
    ];
    return html`${this.#clashMessage()}<wt-data-table
        class=${this.#ranges.length > 0 ? "ranges" : ""}
        @wt-filter-change=${() => this.#readFilter()}
        noMatchesMessage=${tableNoMatches()}
        filterSearchPlaceholder=${t("categories.combobox_search")}
        filterNoResultsLabel=${t("categories.combobox_no_results")}
        aria-label=${t("menu_prices.label").replace("{menu}", this.menuName)}
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
      <wt-toast
        data-test="price-outcome"
        close-label=${t("action.close")}
        tone="info"
        .open=${this.outcome !== null}
        .message=${this.#outcomeText()}
        .duration=${this.outcome?.kind === "saved" ? 5000 : 0}
        @wt-close=${this.#onOutcomeClose}
        >${this.#undoButton()}</wt-toast
      >
      <div class="outcome-room"></div>`;
  }

  /** A closed message says nothing any longer, so the host is asked to clear the outcome. */
  readonly #onOutcomeClose = (event: Event): void => {
    event.stopPropagation();
    this.#emit("wt-price-outcome-close", {});
  };

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
      slot="action"
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
