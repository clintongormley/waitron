import "./modifier-picker.js";
import "./order-kitchen-note.js";
import type { SaveKitchenNoteDetail } from "./order-kitchen-note.js";
import type { ModifierConfirmDetail, StagedRemoval } from "./modifier-picker.js";
import type { ProductAllergens } from "@waitron/catalogue/src/allergens.js";
import { ContentLanguageController, formatDecimalInput, Gestures } from "@waitron/ui";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import {
  type Decimal,
  decimal,
  formatMoney,
  grossOf,
  multiplyDecimal,
  perDishOptionQuantity,
} from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";
import { nutritionIcons, nutritionIconStyles, nutritionDietLabels } from "./nutrition-icons.js";
import { optionAnswers } from "./option-snapshot.js";
import { deriveOptionSelections, sameOptionSelections } from "../state/held-options.js";
import { deriveExtraSelections } from "../state/held-extras.js";
import { dishGross, extraGross, offeredListsOf, quantityLabel } from "../state/order-line.js";
import { asServedAllergens, asServedDiet } from "../state/as-served.js";
import { dietBadgeStyles, extraNutrition } from "./diet-badges.js";
import { lineExtrasEditorStyles, renderLineExtrasEditor } from "./line-extras-editor.js";
import { StoreChangeController } from "../state/store-controller.js";
import type {
  LineSelection,
  OrderLine,
  SelectedExtra,
  WorkingOrderStore,
} from "../state/working-order.js";
import type { BlockReason } from "../state/menu-refresh.js";
import type { StringKey } from "../i18n/strings.js";
import { lineProductName, productUnit } from "./product-name.js";
import { lineTotal, priceWasStyles } from "./price-was.js";
import {
  LINE_ADJUSTMENTS,
  adjustableListing,
  billGross,
  lineAdjustTarget,
  storedListing,
} from "../state/adjust-target.js";
import type { AdjustKind, AdjustTarget } from "./adjustment-dialog.js";
import type { AdjustDetail } from "../screens/till-table-order-screen.js";
import type { Station, TabLine, TillCourse, TillProduct } from "../api/client.js";

const QTY_BADGE = "×";

function pickQuantityBadge(quantity: number): string {
  return quantity > 1 ? ` ${QTY_BADGE}${quantity}` : "";
}

function notOfferedMarker() {
  return html` <span class="not-offered">${t("basket.not_offered")}</span>`;
}

const BLOCKED_WORDS: Record<BlockReason, StringKey> = {
  period_ended: "basket.blocked.period_ended",
  removed: "basket.blocked.removed",
  variant_removed: "basket.blocked.removed",
  not_sold_separately: "basket.blocked.not_sold_separately",
  unavailable: "basket.blocked.unavailable",
  extra_removed: "basket.blocked.extra",
  extra_unavailable: "basket.blocked.extra",
  unit_changed: "basket.blocked.unit",
};

/** A line a menu change stops being paid until it is removed or replaced (D9). */
function blockedMarker(reason: BlockReason) {
  return html` <span class="not-offered">${t(BLOCKED_WORDS[reason])}</span>`;
}

/** A stored order's lines as the server listed them, and the revision they were read at. */
export interface StoredLines {
  orderId: string;
  revision: number;
  lines: readonly TabLine[];
}

/**
 * The running order. It holds no basket state of its own, so it can never disagree with the store the
 * pay flow reads.
 */
@customElement("till-basket")
export class TillBasket extends LitElement {
  static override styles = [
    baseStyles,
    nutritionIconStyles,
    dietBadgeStyles,
    lineExtrasEditorStyles,
    priceWasStyles,
    css`
      :host {
        display: block;
        container-type: inline-size;
      }

      .entry {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
      }

      .entry-body {
        min-width: 0;
      }

      .entry-end {
        display: flex;
      }

      .line-actions,
      .bill-adjust {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--wt-space-2);
        padding: var(--wt-space-1) 0 var(--wt-space-2);
      }

      .empty {
        margin: 0;
        padding: var(--wt-space-4);
        color: var(--wt-color-text-muted);
        text-align: center;
      }

      .line {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
        padding: var(--wt-space-2) 0;
        border-bottom: 1px solid var(--wt-color-border);
      }

      .line .name {
        flex: 1;
        min-width: min(100%, calc(var(--wt-tap-min) * 3));
        overflow-wrap: anywhere;
      }

      /* The name, or what is slotted in its place, on a row of its own above the line's controls,
         which wrap rather than run past the basket's edge when they do not fit on one row. */
      :host([stacked]) .line {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      :host([stacked]) .line .name {
        flex-basis: 100%;
      }

      :host([stacked]) .line .qty {
        margin-inline-end: auto;
      }

      :host([line-details]) .order-lines {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto max-content auto auto auto;
        column-gap: var(--wt-space-2);
      }
      :host([line-details]) .order-lines > slot {
        grid-column: 1 / -1;
      }
      :host([line-details]) .entry,
      :host([line-details]) .entry-body,
      :host([line-details]) .line,
      :host([line-details]) .option {
        display: grid;
        grid-template-columns: subgrid;
        column-gap: var(--wt-space-2);
      }
      :host([line-details]) .entry {
        grid-column: 1 / -1;
      }
      :host([line-details]) .entry-body {
        grid-column: 1 / 6;
      }
      :host([line-details]) .entry-end {
        grid-column: 6;
        grid-row: 1;
      }
      :host([line-details]) .entry-body > * {
        grid-column: 1 / -1;
      }
      :host([line-details]) .line .name {
        grid-column: 1;
        min-width: 0;
      }
      :host([line-details]) .line .qty {
        grid-column: 2;
        margin-inline-end: 0;
      }
      :host([line-details]) .line-total,
      :host([line-details]) .option-total {
        grid-column: 3;
        text-align: end;
      }
      :host([line-details]) [data-line-detail] {
        grid-column: 4;
      }
      :host([line-details]) .remove,
      :host([line-details]) .remove-gap,
      :host([line-details]) [data-remove-extra] {
        grid-column: 5;
      }
      :host([line-details]) .option .name {
        grid-column: 1;
        min-width: 0;
      }
      :host([line-details]) .option .qty {
        grid-column: 2;
      }
      :host([line-details][stacked]) .line .name {
        grid-column: 1 / -1;
      }
      :host([line-details][stacked]) .line .qty {
        grid-column: 1 / 3;
        justify-self: start;
      }
      :host([line-details][stacked]) .option .name {
        grid-column: 1 / -1;
      }
      :host([line-details][stacked]) .option .qty {
        grid-column: 1 / 3;
      }
      @container (width < 360px) {
        :host([line-details]) .order-lines {
          grid-template-columns: minmax(0, 1fr) auto max-content;
        }
        :host([line-details]) .entry-body {
          grid-column: 1 / -1;
        }
        :host([line-details]) .entry-end {
          grid-column: 1 / -1;
          grid-row: auto;
        }
        :host([line-details]) .line .name,
        :host([line-details]) .option .name {
          grid-column: 1 / -1;
        }
        :host([line-details]) .line .qty,
        :host([line-details]) .option .qty {
          grid-column: 1 / 3;
        }
        :host([line-details]) [data-line-detail] {
          grid-column: 2;
        }
        :host([line-details]) .remove,
        :host([line-details]) .remove-gap,
        :host([line-details]) [data-remove-extra] {
          grid-column: 3;
        }
      }

      .line-after {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--wt-space-2);
      }

      /* The per-line note editor (order-line customisation) — an inline expander opened by the line's
         Note button, indented under the dish like its option/allergen/diet sub-rows. */
      .line-extras-editor {
        padding: var(--wt-space-2) 0 var(--wt-space-3);
        padding-left: var(--wt-space-4);
      }

      /* The at-a-glance read-out of a line's SET note (order-line customisation) — indented under the
         dish like the allergen/diet rows, a label plus the value. */
      .line-extras {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--wt-space-1) var(--wt-space-2);
        padding: var(--wt-space-1) 0 var(--wt-space-2);
        padding-left: var(--wt-space-4);
        font-size: var(--wt-font-size-sm, 0.85em);
        color: var(--wt-color-text-muted);
      }

      .line-extras-label {
        font-weight: 600;
      }

      .qty {
        color: var(--wt-color-text-muted);
      }

      /* Dish-line quantity stepper: -/N/+ for a whole, non-hardware unit; other units stay static. */
      .stepper {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-2);
      }

      .count {
        min-width: 1.5ch;
        text-align: center;
        font-variant-numeric: tabular-nums;
      }

      .line-total {
        font-variant-numeric: tabular-nums;
      }

      /* Unseen copies of the − and × a dish the kitchen has does not offer, so its count, total and
         Note line up with the rows that keep them whatever width the font gives those buttons. */
      .step-gap,
      .remove-gap {
        visibility: hidden;
      }

      /* The price before an adjustment stands above the price now, so the column stays narrow. */
      .line-total .list-total,
      .option-total .list-total {
        display: block;
      }

      /* A pick, and a frozen options answer — indented beneath its dish, name left and any price
         right, with no quantity column and no remove control (a child is not independently
         deletable; removing the dish removes it). */
      .option {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: var(--wt-space-3);
        padding: var(--wt-space-1) 0;
        padding-left: var(--wt-space-4);
        color: var(--wt-color-text-muted);
      }

      .option .name {
        overflow-wrap: anywhere;
      }

      .option-total {
        font-variant-numeric: tabular-nums;
      }

      .not-offered {
        display: inline-block;
        overflow-wrap: normal;
        padding: 0 var(--wt-space-2);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-warning);
        color: var(--wt-color-on-warning);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }

      .allergen-chip {
        display: inline-block;
        padding: 0 var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-full, 999px);
      }

      /* A selected extra's OWN allergens/diet (nutrition redesign, pass 1), indented under its option
         row, its own list beside the dish's own rows below — never a fold. The chip/badge look comes from
         the shared .allergen-chip and dietBadgeStyles; only the indent + spacing is basket-specific. */
      .extra-nutrition {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-1) var(--wt-space-2);
        padding: 0 0 var(--wt-space-1);
        padding-left: var(--wt-space-4);
        font-size: var(--wt-font-size-sm, 0.85em);
        color: var(--wt-color-text-muted);
      }

      .extra-allergens,
      .extra-diet {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-1) var(--wt-space-2);
      }
    `,
  ];

  /** The order this basket shows and mutates. Set before the widget connects (its lifecycle subscribes). */
  @property({ attribute: false }) store!: WorkingOrderStore;

  /**
   * The lines shown, by their place in {@link store}; unset shows every line. Each shown line has three
   * slots named by that place: `lead-<n>` replaces the line's name, and `after-<n>` sits under the
   * line's row; `end-<n>` spans the row and its details at the trailing edge.
   */
  @property({ attribute: false }) lineIndexes?: readonly number[];

  @property({ type: Boolean, reflect: true }) stacked = false;
  @property({ type: Boolean, reflect: true, attribute: "line-details" }) lineDetails = false;
  @property({ type: Boolean }) readOnly = false;
  @property({ type: Boolean }) allowPickRemoval = false;
  @property({ attribute: false }) draftParent?: object;
  @property({ attribute: false }) courses: readonly TillCourse[] = [];

  /** The stored order the basket holds, as the server last listed it; null when not known. While it
   * is known, a dish the kitchen has shows no × and no `−`, and the adjustments are offered only
   * while the basket is exactly what the listing lists. */
  @property({ attribute: false }) storedLines: StoredLines | null = null;
  @property({ attribute: false }) stationMoveLines: StoredLines | null = null;

  /** A pay, place or hold of the basket's order is out, so no adjustment is offered. */
  @property({ type: Boolean }) orderInFlight = false;

  /** Built when {@link storedLines} changes, not searched for line by line on every render. */
  #listedById = new Map<string, TabLine>();
  #listedExtras = new Map<number, TabLine[]>();
  #listedTotal: Decimal = decimal("0");
  @property({ attribute: false }) makeAtStations: Station[] = [];

  /** The line whose note editor is open, by the line itself rather than its place: other lines move
   * under it (a remove elsewhere, another basket showing the same order), and a note, which can
   * carry allergy information, must never reattach to the line that slid into its place. */
  @state() private editingLine: OrderLine | null = null;

  /** Assigned only through {@link #openModifierPicker} / {@link #closeModifierPicker}, which keep
   * {@link #modifierSelection} in step with it. */
  @state() private modifierLine: OrderLine | null = null;

  /**
   * Built once when the picker opens, not per render: Lit's default `hasChanged` is an identity check,
   * so a fresh literal in `render()` would re-render the dialog on every basket render.
   */
  #modifierSelection: LineSelection | null = null;
  #modifierProduct?: TillProduct;
  #modifierCourse?: string;
  #modifierRemoval?: StagedRemoval;

  /** Detects a whole-basket swap: `clear` mints a fresh id and `loadFrom` adopts the retrieved order's,
   * while an in-basket add / remove / edit keeps it. */
  #lastStoreId?: string;
  #gestures?: Gestures;
  #pressedLine: OrderLine | null = null;
  readonly #clearPress = () => {
    this.#pressedLine = null;
  };

  openLineDetails(line: OrderLine): void {
    if (!this.isConnected || !this.store.lines.includes(line)) return;
    this.#openModifierPicker(line);
  }

  #lineReadOnly(line: OrderLine): boolean {
    const listed = this.#listed(line, storedListing(this.store, this.storedLines));
    return (
      this.readOnly ||
      this.store.editsLocked ||
      (listed !== undefined && (listed.sentAt !== null || listed.firedAt !== null))
    );
  }

  #lineStationMove(line: OrderLine) {
    if (!this.lineDetails || !this.store.lines.includes(line)) return null;
    const listing = adjustableListing(this.store, this.stationMoveLines, this.orderInFlight);
    const listed = listing?.lines.find((row) => row.id === line.workingOrderLineId);
    return listing !== null &&
      listed !== undefined &&
      (listed.parentLineNo ?? null) === null &&
      listed.movable &&
      (listed.sentAt !== null || listed.firedAt !== null)
      ? {
          workingOrderId: listing.orderId,
          lineId: listed.id,
          name: this.#lineName(line),
          stationId: listed.stationId,
          counter: true as const,
        }
      : null;
  }

  #lineStationAction(line: OrderLine) {
    const move = this.#lineStationMove(line);
    if (move === null) return nothing;
    return html`<wt-button
      variant="secondary"
      data-move-station=${this.store.lines.indexOf(line)}
      aria-label=${`${t("table.move_station")} · ${move.name}`}
      @click=${() => {
        const current = this.#lineStationMove(line);
        if (current === null) return;
        this.#closeModifierPicker();
        this.dispatchEvent(
          new CustomEvent("move-station", { detail: current, bubbles: true, composed: true }),
        );
      }}
      >${t("table.move_station")}</wt-button
    >`;
  }

  #openModifierPicker(line: OrderLine): void {
    if (this.store.sending || (!this.lineDetails && this.store.editsLocked) || this.orderInFlight)
      return;
    this.#modifierCourse =
      this.lineDetails &&
      (this.courses.length > 0 || (line.course !== undefined && line.course.id === line.courseId))
        ? (line.courseId ?? line.product.courseId ?? "")
        : undefined;
    this.modifierLine = line;
    this.#modifierProduct = line.product;
    if (line.source === undefined) {
      this.#modifierSelection = {
        extras: line.extras ?? [],
        options: line.options ?? [],
        optionSnapshots: line.optionSnapshots,
        ...(this.lineDetails ? { note: line.note ?? "" } : {}),
      };
      return;
    }
    const offered = offeredListsOf(line.product);
    this.#modifierProduct = {
      ...line.product,
      offeredModifiers: offered.map((list) =>
        list.kind === "options"
          ? list
          : {
              ...list,
              items: list.items.map((item) => {
                const stored = this.#recordedExtra(line, list.id, item.productId);
                return stored === undefined
                  ? item
                  : {
                      ...item,
                      name: stored.name ?? item.name,
                      price: stored.unitPriceGross,
                    };
              }),
            },
      ),
    };
    const held = line.source.extras.map((extra) => ({
      productId: extra.productId,
      listId: extra.listId,
      name: extra.name ?? "",
      price: extra.unitPriceGross,
      quantity: perDishOptionQuantity(
        extra.quantity,
        multiplyDecimal(decimal(line.source!.line.quantity), decimal(extra.priceQuantity ?? "1")),
      ),
    }));
    const derived = held.flatMap((extra) => {
      const [kept] = deriveExtraSelections(offered, [extra]).extras;
      return kept !== undefined
        ? [kept]
        : offered.some((list) => list.kind === "extras")
          ? [{ ...extra, listId: extra.listId ?? "", productId: extra.productId ?? "" }]
          : [];
    });
    this.#modifierSelection = {
      optionSnapshots: line.optionSnapshots,
      ...(this.lineDetails ? { note: line.note ?? "" } : {}),
      extras: line.sourceSelection?.extras ?? derived,
      options:
        line.sourceSelection?.options ??
        deriveOptionSelections(offered, line.optionSnapshots).options,
    };
  }

  #closeModifierPicker(): void {
    this.modifierLine = null;
    this.#modifierSelection = null;
    this.#modifierProduct = undefined;
    this.#modifierCourse = undefined;
    this.#modifierRemoval = undefined;
  }

  #stageRemoval(line: OrderLine, removal: StagedRemoval): void {
    if (this.#lineReadOnly(line) || this.store.sending || this.orderInFlight) return;
    this.openLineDetails(line);
    if (this.modifierLine === line) this.#modifierRemoval = removal;
  }

  #recordedExtra(line: OrderLine, listId: string, productId: string): TabLine | undefined {
    return line.source?.extras.find(
      (extra) =>
        extra.listId?.toLowerCase() === listId.toLowerCase() &&
        extra.productId?.toLowerCase() === productId.toLowerCase(),
    );
  }

  #confirmModifiers(detail: ModifierConfirmDetail): boolean {
    const line = this.modifierLine;
    if (
      line === null ||
      !this.isConnected ||
      this.store.sending ||
      this.store.editsLocked ||
      this.orderInFlight ||
      this.#lineReadOnly(line)
    )
      return false;
    const index = this.store.lines.indexOf(line);
    if (index < 0) return false;
    const courseChanged =
      this.lineDetails && detail.courseId !== undefined && detail.courseId !== this.#modifierCourse;
    if (
      courseChanged &&
      detail.courseId !== "" &&
      !this.courses.some((course) => course.id === detail.courseId)
    )
      return false;
    const finish = (selection: LineSelection) => {
      if (!this.lineDetails) {
        if (line.source === undefined) this.store.setLineModifiers(index, selection);
        else this.store.patchRecalledLineModifiers(index, selection);
        this.#closeModifierPicker();
        return true;
      }
      const applied = this.store.setLineDetails(index, {
        quantity: detail.quantity ?? line.quantity,
        note: detail.note ?? "",
        selection,
        ...(courseChanged
          ? {
              course: {
                id: detail.courseId || undefined,
                value: this.courses.find((course) => course.id === detail.courseId),
              },
            }
          : {}),
      });
      if (applied) this.#closeModifierPicker();
      return applied;
    };
    if (line.source === undefined) {
      return finish(detail);
    }
    const offered = offeredListsOf(line.product);
    const selection: LineSelection = {};
    if (
      offered.some((list) => list.kind === "options") &&
      !sameOptionSelections(detail.options ?? [], this.#modifierSelection!.options ?? [])
    ) {
      selection.options = detail.options ?? [];
      selection.optionSnapshots = detail.optionSnapshots ?? [];
    }
    const extrasKey = (picks: SelectedExtra[]) =>
      JSON.stringify(
        picks
          .map(({ listId, productId, quantity }) => JSON.stringify([listId, productId, quantity]))
          .sort(),
      );
    if (
      offered.some((list) => list.kind === "extras") &&
      extrasKey(detail.extras ?? []) !== extrasKey(this.#modifierSelection!.extras ?? [])
    )
      selection.extras = (detail.extras ?? []).map((pick) => {
        const stored = this.#recordedExtra(line, pick.listId, pick.productId);
        return stored === undefined
          ? pick
          : { ...pick, name: stored.name ?? pick.name, price: stored.unitPriceGross };
      });
    return finish(selection);
  }

  constructor() {
    super();
    new ContentLanguageController(this);
    new StoreChangeController(
      this,
      () => this.store,
      "changed",
      () => this.#onStoreChanged(),
    );
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("pointerdown", this.#clearPress, true);
    this.#gestures = new Gestures(this, {
      longPress: () => {
        if (this.#pressedLine !== null) this.openLineDetails(this.#pressedLine);
      },
    });
    // Without this the first `"changed"` would read the unchanged id as a swap and close an open editor.
    this.#lastStoreId = this.store.id;
  }

  override disconnectedCallback(): void {
    this.removeEventListener("pointerdown", this.#clearPress, true);
    this.#gestures?.disconnect();
    this.#gestures = undefined;
    this.#pressedLine = null;
    super.disconnectedCallback();
  }

  #onStoreChanged(): void {
    if (this.lineDetails && this.store.editsLocked) {
      this.editingLine = null;
      this.#closeModifierPicker();
    }
    if (this.store.id !== this.#lastStoreId) {
      this.#lastStoreId = this.store.id;
      this.editingLine = null;
      this.#closeModifierPicker();
    }
    if (this.modifierLine !== null && !this.store.lines.includes(this.modifierLine))
      this.#closeModifierPicker();
    this.requestUpdate();
  }

  #lineName(line: OrderLine): string {
    return lineProductName(line.product);
  }

  #answers(line: OrderLine): string[] {
    return optionAnswers(line.optionSnapshots, { reads: "staff" });
  }

  /**
   * A pick's own allergens and diet, read live from the dish's offer rather than frozen onto the line.
   * `undefined` when no offered list names the product, so the row claims no empty declaration.
   */
  #extraOwnNutrition(
    line: OrderLine,
    productId: string,
  ):
    | {
        addAllergens: ProductAllergens | null;
        suitableFor: readonly string[];
      }
    | undefined {
    const item = (line.product.offeredModifiers ?? [])
      .flatMap((entry) => (entry.kind === "extras" ? entry.items : []))
      .find((candidate) => candidate.productId === productId);
    return item === undefined
      ? undefined
      : { addAllergens: item.addAllergens, suitableFor: item.suitableFor };
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("storedLines")) return;
    const rows = this.storedLines?.lines ?? [];
    this.#listedById = new Map(rows.map((row) => [row.id, row]));
    this.#listedExtras = new Map();
    for (const row of rows) {
      const parent = row.parentLineNo;
      if (parent === null || parent === undefined) continue;
      const siblings = this.#listedExtras.get(parent);
      if (siblings === undefined) this.#listedExtras.set(parent, [row]);
      else siblings.push(row);
    }
    this.#listedTotal = billGross(rows);
  }

  @property({ type: Boolean }) revealAdded = false;
  #revealedAddition?: { store: WorkingOrderStore; addition: number };
  override updated(): void {
    if (!this.revealAdded) return;
    const store = this.store;
    if (
      this.#revealedAddition?.store === store &&
      this.#revealedAddition.addition === store.lastAddition
    )
      return;
    this.#revealedAddition = { store, addition: store.lastAddition };
    const line = store.lastAdded;
    if (line === undefined) return;
    const generation = store.loadGeneration;
    requestAnimationFrame(() => {
      if (
        !this.isConnected ||
        this.store !== store ||
        store.loadGeneration !== generation ||
        store.lastAdded !== line
      )
        return;
      const index = store.lines.indexOf(line);
      const row = this.renderRoot
        .querySelector<HTMLElement>(`[data-line-detail="${index}"]`)
        ?.closest<HTMLElement>(".entry");
      if (row?.checkVisibility())
        row.scrollIntoView({
          block: "nearest",
          inline: "nearest",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        });
    });
  }

  @property({ type: Boolean }) hideKitchenNote = false;

  #kitchenHeading() {
    if (this.hideKitchenNote) return nothing;
    const store = this.store;
    return html`<till-order-kitchen-note
      .scopeKey=${store.kitchenNoteScopeKey}
      .note=${store.kitchenNote}
      .revision=${store.kitchenNoteRevision}
      .visit=${store.loadGeneration}
      .busy=${store.sending || store.editsLocked || this.orderInFlight}
      @save-kitchen-note=${(event: CustomEvent<SaveKitchenNoteDetail>) => {
        if (store.persisted) return;
        event.stopPropagation();
        const detail = event.detail;
        if (detail.scopeKey === store.kitchenNoteScopeKey && detail.visit === store.loadGeneration)
          store.kitchenNote = detail.note;
      }}
    ></till-order-kitchen-note>`;
  }

  override render() {
    const lines = this.store.lines;
    if (lines.length === 0) {
      return html`${this.#kitchenHeading()}
        <p class="empty">${t("basket.empty")}</p>`;
    }
    // The owner of `lineIndexes` hears of a change after this basket does, so a place the store no
    // longer has is skipped until it catches up.
    const shown = (this.lineIndexes ?? lines.map((_line, index) => index)).flatMap((index) => {
      const line = lines[index];
      return line === undefined ? [] : [[line, index] as const];
    });
    const listing = storedListing(this.store, this.storedLines);
    const adjustable = this.readOnly
      ? null
      : adjustableListing(this.store, listing, this.orderInFlight);
    return html`
      ${this.#kitchenHeading()}
      <div class="order-lines">
        ${shown.map(([line, index]) => {
          const listed = this.#listed(line, listing);
          const sent = listed !== undefined && (listed.sentAt !== null || listed.firedAt !== null);
          return html`
            <slot name=${`before-${index}`}></slot>
            <div class="entry">
              <div class="entry-body">
                <div
                  class="line"
                  @pointerdown=${(event: PointerEvent) => {
                    this.#pressedLine =
                      this.lineDetails &&
                      !event
                        .composedPath()
                        .some(
                          (node) =>
                            node instanceof Element &&
                            node.matches("wt-button, button, input, wt-input"),
                        )
                        ? line
                        : null;
                  }}
                  @dblclick=${(event: MouseEvent) => {
                    if (
                      this.lineDetails &&
                      !event
                        .composedPath()
                        .some(
                          (node) =>
                            node instanceof Element &&
                            node.matches(
                              "wt-button, button:not([data-draft-select]), input, wt-input",
                            ),
                        )
                    )
                      this.openLineDetails(line);
                  }}
                >
                  <span class="name" part="name"
                    ><slot name=${`lead-${index}`}>${this.#lineName(line)}</slot
                    >${this.#nutrition(line)}${
                      line.notOffered ? notOfferedMarker() : nothing
                    }${line.blocked === undefined ? nothing : blockedMarker(line.blocked)}${
                      line.unavailableOnServer === true &&
                      line.blocked === undefined &&
                      line.notOffered === undefined
                        ? html` <span class="not-offered">${t("basket.blocked.server")}</span>`
                        : nothing
                    }</span
                  >
                  ${this.#quantityCell(line, index, sent)} ${this.#dishTotal(line, listed)}
                  ${
                    this.lineDetails
                      ? html`<wt-button
                          variant="ghost"
                          size="md"
                          data-line-detail=${index}
                          aria-label=${`${t("modifier.edit")} · ${this.#lineName(line)}`}
                          ?disabled=${this.store.sending || this.store.editsLocked || this.orderInFlight}
                          @click=${() => this.openLineDetails(line)}
                          ><span aria-hidden="true">ⓘ</span></wt-button
                        >`
                      : html`<wt-button
                          class="note-toggle"
                          variant="ghost"
                          size="md"
                          data-test=${`line-note-button-${index}`}
                          aria-expanded=${this.editingLine === line}
                          aria-label=${`${t("line.note.button")} ${this.#lineName(line)}`}
                          @click=${() => this.#toggleEditor(line)}
                        >
                          ${t("line.note.button")}
                        </wt-button>`
                  }
                  ${
                    sent || this.readOnly || this.store.editsLocked
                      ? html`<wt-button class="remove-gap" variant="ghost" size="md" inert
                          ><span aria-hidden="true">×</span></wt-button
                        >`
                      : html`<wt-button
                          class="remove"
                          variant="ghost"
                          size="md"
                          aria-label=${`${t("action.remove")} ${this.#lineName(line)}`}
                          @click=${() => {
                            if (!this.#lineReadOnly(line) && !this.orderInFlight)
                              this.store.removeLine(index);
                          }}
                        >
                          <span aria-hidden="true">×</span>
                        </wt-button>`
                  }
                </div>
                ${
                  !this.lineDetails && !sent && this.makeAtStations.length > 1
                    ? html`<div class="line-actions">
                        <wt-button
                          size="sm"
                          variant="ghost"
                          data-make-at=${index}
                          @click=${() => this.dispatchEvent(new CustomEvent("open-make-at", { detail: index, bubbles: true, composed: true }))}
                          >${this.#makeAtLabel(line)}</wt-button
                        >
                      </div>`
                    : nothing
                }
                ${
                  // Each row's actions sit straight under it, so a dish's are not read as its extra's.
                  adjustable !== null && listed !== undefined
                    ? this.#lineActions(line, index, listed, sent, adjustable)
                    : nothing
                }
                ${
                  // Offered lists alone, NOT `needsModifierPicker`: `setLineModifiers` replaces a line's
                  // answers and never its product, so a dish whose only question is its variant gets no
                  // Edit button rather than a dialog whose save would carry nothing. The MIXED case —
                  // variants AND an offered list — still re-asks the variant and discards it; open in
                  // `docs/backlog.md`.
                  !this.lineDetails && offeredListsOf(line.product).length > 0
                    ? html`<wt-button
                        class="edit-modifiers"
                        size="sm"
                        variant="ghost"
                        @click=${() => this.#openModifierPicker(line)}
                        >${t("modifier.edit")}</wt-button
                      >`
                    : nothing
                }
                ${this.#extrasRow(line, index)} ${this.#extrasEditor(line)}
                ${(line.extras ?? []).map(
                  // No remove control: a pick goes only with its dish. Its own allergens and diet sit
                  // beside the dish's rows, never folded into them.
                  (extra, i) => {
                    const own = this.#extraOwnNutrition(line, extra.productId);
                    const listedExtra = this.#listedExtra(listed, extra);
                    return html`
                      <div class="option">
                        <span class="name"
                          >${extra.name}${this.lineDetails ? nothing : pickQuantityBadge(extra.quantity)}</span
                        >
                        ${this.lineDetails ? html`<span class="qty">${formatDecimalInput(multiplyDecimal(decimal(line.quantity), decimal(String(extra.quantity))), currentLocale())}</span>` : nothing}
                        ${this.#extraTotal(line, extra, listedExtra)}
                        ${
                          this.lineDetails && this.allowPickRemoval && !this.#lineReadOnly(line)
                            ? html`<wt-button
                                data-remove-extra=${`${extra.listId}/${extra.productId}`}
                                variant="ghost"
                                aria-label=${`${t("action.remove")} ${extra.name}`}
                                @click=${() => this.#stageRemoval(line, { listId: extra.listId, productId: extra.productId })}
                                >×</wt-button
                              >`
                            : nothing
                        }
                      </div>
                      ${own ? extraNutrition(own, `option-allergens-${index}-${i}`, `option-diet-${index}-${i}`) : nothing}
                      ${
                        adjustable !== null && listedExtra !== undefined
                          ? this.#extraActions(
                              line,
                              extra,
                              `${index}-${i}`,
                              listedExtra,
                              sent,
                              adjustable,
                            )
                          : nothing
                      }
                    `;
                  },
                )}
                ${(line.notOfferedExtras ?? []).map(
                  (extra) => html`
                    <div class="option">
                      <span class="name"
                        >${extra.name}${pickQuantityBadge(extra.quantity)}${notOfferedMarker()}</span
                      >
                      <span class="option-total"
                        >${formatMoney(extraGross(line, extra), currentLocale())}</span
                      >
                    </div>
                  `,
                )}
                ${this.#answers(line).map((answer) => html`<div class="option modifier-answer"><span class="name">${answer}</span></div>`)}
                <div class="line-after"><slot name=${`after-${index}`}></slot></div>
              </div>
              <slot class="entry-end" name=${`end-${index}`}></slot>
            </div>
          `;
        })}
      </div>
      ${adjustable === null ? nothing : this.#billAdjust()}
      ${
        this.modifierLine && this.#modifierSelection
          ? html`<till-modifier-picker
              .draftParent=${this.draftParent}
              .product=${this.#modifierProduct}
              .lineDetails=${this.lineDetails}
              .withNote=${this.lineDetails}
              .readOnly=${this.lineDetails && this.#lineReadOnly(this.modifierLine)}
              .nutrition=${
                this.lineDetails
                  ? {
                      allergens: this.modifierLine.product.allergens,
                      dietaryDeclarations: nutritionDietLabels(
                        asServedDiet(this.modifierLine),
                        this.modifierLine.product.dietaryDeclarations,
                      ),
                    }
                  : null
              }
              .initialCourse=${this.#modifierCourse}
              .coursePlaceholder=${
                this.modifierLine.course !== undefined &&
                this.modifierLine.course.id === this.#modifierCourse &&
                !this.courses.some((course) => course.id === this.#modifierCourse)
                  ? this.modifierLine.course!.name
                  : t("table.course_default")
              }
              .courseChoices=${[
                { value: "", label: t("table.course_default") },
                ...this.courses.map((course) => ({ value: course.id, label: course.name })),
              ]}
              .disabled=${this.store.sending || this.store.editsLocked || this.orderInFlight}
              .quantity=${this.modifierLine.quantity}
              .showTotal=${this.modifierLine.source === undefined}
              .initialSelections=${this.#modifierSelection}
              .stagedRemoval=${this.#modifierRemoval}
              @wt-modifier-confirm=${(event: CustomEvent<ModifierConfirmDetail>) => {
                event.stopPropagation();
                if (!this.#confirmModifiers(event.detail)) event.preventDefault();
              }}
              @wt-modifier-cancel=${(event: Event) => {
                event.stopPropagation();
                this.#closeModifierPicker();
              }}
              ><div slot="line-details">
                <slot name=${`detail-${this.store.lines.indexOf(this.modifierLine)}`}></slot>
                ${this.#lineStationAction(this.modifierLine)}
              </div>
              ></till-modifier-picker
            >`
          : nothing
      }
    `;
  }

  #toggleEditor(line: OrderLine): void {
    this.editingLine = this.editingLine === line ? null : line;
  }

  #makeAtLabel(line: OrderLine): string {
    const station = this.makeAtStations.find((candidate) => candidate.id === line.makeAt);
    return station === undefined
      ? `${t("move_station.make_at")}…`
      : `${t("move_station.make_at")}: ${station.name}`;
  }

  #extrasRow(line: OrderLine, index: number) {
    if (line.note === undefined) return nothing;
    return html`
      <div class="line-extras" data-test=${`line-extras-${index}`}>
        ${
          this.lineDetails
            ? html`<wt-button
                  class="line-extras-note"
                  variant="ghost"
                  @click=${() => this.openLineDetails(line)}
                  >${line.note}</wt-button
                >
                ${
                  !this.#lineReadOnly(line)
                    ? html`<wt-button
                        data-remove-note
                        variant="ghost"
                        aria-label=${`${t("action.remove")} ${t("line.note.label")}`}
                        @click=${() => this.#stageRemoval(line, "note")}
                        >×</wt-button
                      >`
                    : nothing
                } `
            : html`<span class="line-extras-note"
                ><span class="line-extras-label">${t("line.note.label")}:</span> ${line.note}</span
              >`
        }
      </div>
    `;
  }

  #extrasEditor(line: OrderLine) {
    if (this.editingLine !== line) return nothing;
    return html`
      <div class="line-extras-editor">
        ${renderLineExtrasEditor({
          note: line.note ?? "",
          onNoteChange: (note) =>
            this.store.setLineExtras(this.store.lines.indexOf(line), { note }),
        })}
      </div>
    `;
  }

  /** `−` is disabled at 1: removing a line is the × control's job, never the stepper's. A dish the
   * kitchen has has no `−`: less of it leaves only through Cancel. */
  #quantityCell(line: OrderLine, index: number, sent: boolean) {
    if (this.readOnly) return html`<span class="qty">${quantityLabel(line)}</span>`;
    const unit = productUnit(line.product);
    if (unit.hardwareUnit !== null || unit.precision > 0) {
      return html`<span class="qty">${quantityLabel(line)}</span>`;
    }
    const count = Number(line.quantity);
    const name = this.#lineName(line);
    return html`
      <span class="qty stepper">
        ${
          sent
            ? html`<wt-button class="step-gap" variant="ghost" size="sm" inert
                ><span aria-hidden="true">−</span></wt-button
              >`
            : html`<wt-button
                class="step step-dec"
                variant="ghost"
                size="sm"
                aria-label=${`${t("basket.decrease")} ${name}`}
                ?disabled=${count <= 1 || this.store.editsLocked || this.orderInFlight}
                @click=${() => this.store.setLineQuantity(index, String(count - 1))}
              >
                <span aria-hidden="true">−</span>
              </wt-button>`
        }
        <span class="count">${line.quantity}</span>
        <wt-button
          class="step step-inc"
          ?disabled=${this.store.editsLocked || this.orderInFlight || this.store.canSelectProduct?.(line.product) === false}
          variant="ghost"
          size="sm"
          aria-label=${`${t("basket.increase")} ${name}`}
          @click=${() => this.store.setLineQuantity(index, String(count + 1))}
        >
          <span aria-hidden="true">+</span>
        </wt-button>
      </span>
    `;
  }

  /** The dish as listed, by the stored line it came from. */
  #listed(line: OrderLine, listing: StoredLines | null): TabLine | undefined {
    const id = line.workingOrderLineId;
    if (id === undefined || listing === null) return undefined;
    return this.#listedById.get(id);
  }

  /** An extras pick as listed: the dish's child row of the same product from the same list. */
  #listedExtra(dish: TabLine | undefined, extra: SelectedExtra): TabLine | undefined {
    if (dish === undefined) return undefined;
    return this.#listedExtras
      .get(dish.lineNo)
      ?.find((row) => row.productId === extra.productId && row.listId === extra.listId);
  }

  /** The dish's total, and before it the total at its listed price when an adjustment changed it. */
  #dishTotal(line: OrderLine, listed: TabLine | undefined) {
    const now = dishGross(line);
    const unit = listed?.listUnitPriceGross;
    return lineTotal(unit === undefined ? now : grossOf(unit, line.quantity), now);
  }

  #extraTotal(line: OrderLine, extra: SelectedExtra, listed: TabLine | undefined) {
    const now = extraGross(line, extra);
    const unit = listed?.listUnitPriceGross;
    const before =
      unit === undefined ? now : extraGross(line, { price: unit, quantity: extra.quantity });
    return lineTotal(before, now, "option-total");
  }

  /** Cancel on a dish the kitchen has, and Give away and Discount on every dish, which cover its
   * extras. */
  #lineActions(
    line: OrderLine,
    index: number,
    listed: TabLine,
    sent: boolean,
    listing: StoredLines,
  ) {
    const name = this.#lineName(line);
    return this.#adjustActions(
      "line",
      String(index),
      name,
      () => lineAdjustTarget(listed, listing.lines, name),
      sent,
      !this.lineDetails && sent && listed.movable
        ? { workingOrderId: listing.orderId, lineId: listed.id, name, stationId: listed.stationId }
        : null,
    );
  }

  /** The same, on an extra alone, whole: Cancel while its dish is with the kitchen. */
  #extraActions(
    line: OrderLine,
    extra: SelectedExtra,
    place: string,
    listedExtra: TabLine,
    sent: boolean,
    listing: StoredLines,
  ) {
    const name = t("table.extra_of")
      .replace("{extra}", () => extra.name)
      .replace("{dish}", () => this.#lineName(line));
    return this.#adjustActions(
      "extra",
      place,
      name,
      () => lineAdjustTarget(listedExtra, listing.lines, name),
      sent,
    );
  }

  #adjustActions(
    row: "line" | "extra",
    place: string,
    name: string,
    target: () => AdjustTarget,
    sent: boolean,
    move: {
      workingOrderId: string;
      lineId: string;
      name: string;
      stationId: string | null;
    } | null = null,
  ) {
    return html`<div class="line-actions">
      ${
        move === null
          ? nothing
          : html`<wt-button
              size="sm"
              variant="secondary"
              data-move-station=${place}
              aria-label=${`${t("table.move_station")} · ${name}`}
              @click=${() => this.dispatchEvent(new CustomEvent("move-station", { detail: { ...move, counter: true }, bubbles: true, composed: true }))}
              >${t("table.move_station")}</wt-button
            >`
      }
      ${
        sent
          ? html`<wt-button
              class="line-cancel"
              size="sm"
              variant="danger"
              data-cancel-line=${row === "line" ? place : nothing}
              data-cancel-extra=${row === "extra" ? place : nothing}
              aria-label=${`${t("table.cancel_line")} · ${name}`}
              @click=${() => this.#adjust("cancel", target())}
            >
              ${t("table.cancel_line")}
            </wt-button>`
          : nothing
      }
      ${LINE_ADJUSTMENTS.map(
        ({ kind, label }) =>
          html`<wt-button
            class="line-adjust"
            size="sm"
            variant="secondary"
            data-comp-line=${row === "line" && kind === "comp" ? place : nothing}
            data-discount-line=${row === "line" && kind === "discount" ? place : nothing}
            data-comp-extra=${row === "extra" && kind === "comp" ? place : nothing}
            data-discount-extra=${row === "extra" && kind === "discount" ? place : nothing}
            aria-label=${`${t(label)} · ${name}`}
            @click=${() => this.#adjust(kind, target())}
          >
            ${t(label)}
          </wt-button>`,
      )}
    </div>`;
  }

  #billAdjust() {
    const total = this.#listedTotal;
    return html`<div class="bill-adjust">
      <wt-button
        size="sm"
        variant="secondary"
        data-discount-bill
        @click=${() =>
          this.#adjust("discount", {
            lineId: null,
            name: t("adjust.whole_bill"),
            quantity: null,
            total,
            unitTotal: null,
          })}
      >
        ${t("table.discount_bill")}
      </wt-button>
    </div>`;
  }

  #adjust(kind: AdjustKind, target: AdjustTarget): void {
    const detail: AdjustDetail = { kind, target, counter: true };
    this.dispatchEvent(new CustomEvent("adjust", { detail, bubbles: true, composed: true }));
  }

  #nutrition(line: OrderLine) {
    const served = asServedAllergens(line);
    return nutritionIcons(
      served.pending ? null : served.allergens,
      nutritionDietLabels(asServedDiet(line), line.product.dietaryDeclarations),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-basket": TillBasket;
  }
}
