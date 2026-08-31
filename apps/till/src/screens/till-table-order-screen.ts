import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { MONEY_SCALE, type Decimal, grossOf, sumDecimals, toScale } from "@waitron/shared";
import { formatMoney } from "../i18n/format.js";
import { t } from "../i18n/t.js";
import { selectStyles } from "../select-styles.js";
import { type DietPredicate, hasDietData, visibleProducts } from "../menu-filter.js";
import { productName } from "../widgets/product-name.js";
import { trimQuantity } from "../widgets/dish-format.js";
import { WorkingOrderStore, type OrderLine } from "../state/working-order.js";
import { toWireOption } from "../state/order-line.js";
import { StoreChangeController } from "../state/store-controller.js";
// Side-effect imports register the reused widgets this screen composes — the round-scoped product
// picker + basket, and the tab-pay tender — exactly as `till-counter-screen` registers its widgets.
// The screen names them only as tags below, so the reuse (not a fork) is what lives here.
import "../widgets/product-grid.js";
import "../widgets/basket.js";
import "../widgets/tender-pay.js";
// The multi-menu switcher shown above the round grid — renders nothing for a single-menu location.
import "../widgets/menu-switcher.js";
// The menu DIET filter above the round grid (dietary-classification, Task 7) — narrows the tiles to a
// dietary lens via `filterProductsByDiet`. Rendered only when some product carries a published diet.
import "../widgets/diet-filter.js";
import type {
  RoundLine,
  TabLine,
  TableServiceStatus,
  TableState,
  TabTransfer,
  TillCourse,
  TillMenu,
  TillProduct,
} from "../api/client.js";
import type { ConfirmPaymentDetail } from "../widgets/tender-pay.js";
import type { FireControlMode } from "../widgets/station-queue.js";

// The Estado picker's option type is the shape `GET /api/statuses` returns (`{ id, label, color }`),
// defined once in the API client and re-exported here so the screen's `.statuses` element type — and
// the existing test/app imports of `TableServiceStatus` from this module — stay stable.
export type { TableServiceStatus };

/**
 * A read-only store whose total + line count are the tab's LOCKED figures, computed ONCE from the tab
 * lines and NEVER re-priced. It is fed to the embedded `tender-pay` so the operator's change is
 * computed against the exact total the server will file from the stored locks (design H2: a tab does
 * not re-price — the add-time `unit_price_gross` is authoritative, never a catalogue recompute). It
 * overrides ONLY the two getters `tender-pay` reads, so the base's `priceBasket` path (the re-price
 * hazard) is never reached — the whole point of not loading tab lines into a normal store.
 */
class TabPayStore extends WorkingOrderStore {
  readonly #total: Decimal;
  readonly #count: number;
  constructor(total: Decimal, count: number) {
    super();
    this.#total = total;
    this.#count = count;
  }
  override get total(): Decimal {
    return this.#total;
  }
  override get lineCount(): number {
    return this.#count;
  }
}

/**
 * The TILL table-ordering screen (FP-1, design §5b): one open table's tab. Three regions —
 *
 *  - a full-width **product grid** (reused `till-product-grid`) whose taps accumulate the CURRENT
 *    round into a round-scoped `WorkingOrderStore`, shown by a reused `till-basket` in a bottom bar;
 *    **Enviar ronda** emits `send-round` with the picked `{ productId, quantity }` lines and clears the
 *    round (the round bar is the current round ONLY, never the whole tab);
 *  - a right-edge **drawer**, its handle badged with the count of lines still to serve, listing
 *    **Pendiente de servir** (each a `Servido` tick → `serve-line`), **Servido**, the tab **total**
 *    (summed from the LOCKED add-time prices — never a catalogue recompute), **Cobrar** (the reused
 *    `till-tender-pay`, whose terminal tender the screen re-emits as `pay-tab`), **Estado** (a status
 *    picker → `set-status`) and **Acciones de mesa** — an in-drawer move/join/merge/transfer flow
 *    (TS-3/TS-4) whose target pick dispatches `move-tab`/`join-table`/`merge-tabs`/`transfer-lines`
 *    upward for the app to persist (Split is a disabled placeholder, TS-5 out of scope).
 *
 * FISCAL FIREWALL (H2). The screen owns NO fiscal path. Rounds, served ticks and status are pre-fiscal
 * signals the app turns into `addTabRound`/`markLineServed`/`setTableStatus`. Pay is the one
 * fiscally-adjacent spot and is handled entirely by REUSE: the embedded `tender-pay` computes change
 * against the {@link TabPayStore} (the LOCKED tab total), and the screen catches its `confirm-payment`
 * and re-emits it as `pay-tab` — so the app settles the whole tab through the EXISTING `recordSale`
 * verb (which files the tab's stored locked lines and ignores the sent basket), never a new fiscal
 * verb and never a re-price. The Hold/`park-order` a `tender-pay` also offers is meaningless for an
 * already-persisted tab, so the screen SWALLOWS it rather than misrouting it to the counter's basket.
 *
 * COPY. Every user-facing label goes through `t()` (`table.*`, plus `label.total`), rendered in the
 * active locale — English by default ("Send round", "To serve", "Served", "Charge", "Status",
 * "Table actions"), Spanish for a Spanish venue ("Enviar ronda", "Pendiente de servir", "Servido",
 * "Cobrar", "Estado", "Acciones de mesa"). Lit + `@waitron/ui` `baseStyles` + theme tokens only — no
 * hardcoded chrome (the status swatch is DATA colour, like the floor screen's badge).
 *
 * DISCONNECT SAFETY: every handler only writes reactive state or dispatches upward — Lit never paints a
 * detached element — so no `isConnected` guard is needed (the sibling screens' reasoning).
 */
@customElement("till-table-order-screen")
export class TillTableOrderScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }

      .screen {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
        min-height: 100%;
        padding: var(--wt-space-4);
      }

      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
      }

      .title {
        margin: 0;
        font-size: var(--wt-font-size-xl);
        font-weight: var(--wt-font-weight-bold);
      }

      .head-actions {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
      }

      .badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: var(--wt-space-5);
        margin-left: var(--wt-space-2);
        padding: 0 var(--wt-space-2);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }

      .layout {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: var(--wt-space-4);
      }

      .grid-region {
        flex: 1 1 20rem;
        min-width: 0;
      }

      .drawer {
        flex: 0 0 22rem;
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }

      .drawer h2 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }

      .drawer ul {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }

      .line {
        display: grid;
        grid-template-columns: 1fr auto auto auto;
        align-items: center;
        gap: var(--wt-space-3);
        padding: var(--wt-space-2) 0;
        border-bottom: 1px solid var(--wt-color-border);
      }

      .served-line {
        grid-template-columns: 1fr auto auto;
        color: var(--wt-color-text-muted);
      }

      .qty {
        color: var(--wt-color-text-muted);
      }

      .line-total {
        font-variant-numeric: tabular-nums;
      }

      .empty {
        margin: 0;
        color: var(--wt-color-text-muted);
      }

      .total-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--wt-space-3);
        padding-top: var(--wt-space-2);
        border-top: 1px solid var(--wt-color-border);
      }

      .total-row .label {
        color: var(--wt-color-text-muted);
        font-weight: var(--wt-font-weight-bold);
      }

      .total-row .amount {
        font-size: var(--wt-font-size-xl);
        font-weight: var(--wt-font-weight-bold);
        font-variant-numeric: tabular-nums;
      }

      .status-options {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }

      .action-options {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }

      .transfer-line[aria-pressed="true"] {
        font-weight: var(--wt-font-weight-bold);
      }

      .dot {
        display: inline-block;
        width: var(--wt-space-2);
        height: var(--wt-space-2);
        margin-right: var(--wt-space-1);
        border-radius: 50%;
      }

      .round-courses {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        padding-top: var(--wt-space-3);
        border-top: 1px solid var(--wt-color-border);
      }

      .round-course {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
      }

      .round-course-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .fire-options {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }

      .round-bar {
        display: flex;
        align-items: flex-end;
        gap: var(--wt-space-3);
        padding-top: var(--wt-space-3);
        border-top: 1px solid var(--wt-color-border);
      }

      .round-bar till-basket {
        flex: 1 1 auto;
        min-width: 0;
      }

      .round-bar .send-round {
        flex: 0 0 auto;
      }
    `,
  ];

  /** The open tab's lines (locked add-time prices + per-line served marker). The APP owns them —
   * loaded via `getTabLines` and reloaded after each round/serve — and threads them in; the drawer,
   * total and badge render from these, never a re-price. */
  @property({ attribute: false }) lines: TabLine[] = [];
  /** ALL sellable products across the location's accessible menus. The round grid shows only the SELECTED
   * menu's (via {@link filterProductsByMenu}); a tab line's name is resolved against the FULL set
   * ({@link #nameFor}), because a tab may span several menus and every line must still render its name
   * whatever menu is shown. */
  @property({ attribute: false }) products: TillProduct[] = [];
  /** The location's accessible menus, handed to the menu switcher above the round grid. With one menu (or
   * none) the switcher renders nothing, so a single-menu location looks exactly as before. */
  @property({ attribute: false }) menus: TillMenu[] = [];
  /** The menu (catalogue) the round grid currently shows — narrows the grid via {@link filterProductsByMenu}
   * and marks the active switcher option. Owned by the app; a switcher pick bubbles up as `menu-selected`. */
  @property() selectedMenuId = "";
  /** The table service statuses the Estado picker offers (the app derives + threads them). */
  @property({ attribute: false }) statuses: TableServiceStatus[] = [];
  /** The venue's ACTIVE kitchen courses (KDS-2 §5b), from `GET /api/till` — the per-line course picker's
   * options (in `displayOrder`) and the id→name source for the waiter-fire actions. */
  @property({ attribute: false }) courses: TillCourse[] = [];
  /** Who owns the per-course fire — the `fire_control` venue setting (KDS-2 §2c), threaded from the app.
   * `waiter` surfaces the tab's per-held-course "Fire <course>" actions; `kitchen` hides them (the
   * station display owns the fire then). */
  @property() fireControl: FireControlMode = "waiter";
  /** The tab's working-order id (the app owns the writes; this rides along for reference/parity with
   * the FP-D placeholder it replaces). */
  @property() orderId?: string;
  /** A tab settlement is in flight (the app's `submitting`), threaded to the embedded pay widget so it
   * disables its confirm affordance — the visible half of the app's single-flight fiscal guard. */
  @property({ type: Boolean }) busy = false;
  /** Whether this face may SETTLE the tab. Both the counter/fixed till and the handheld pay, so this
   * DEFAULTS to `true` and the app leaves it unset — the embedded pay section renders with BOTH the cash
   * and manual-card tenders (the handheld screen threads no `cardProvider`, so Card stays the manual
   * datáfono path). A caller that passes `false` (a future non-settling face) hides the pay section
   * entirely. UI honesty only: the server firewall (`/api/sales` node-keyed sale) is the real guarantee —
   * it permits a handheld cash or manual-card tender and fences only the INTEGRATED reader (`/api/pay`).
   * The tab total stays visible either way. */
  @property({ type: Boolean }) canSettle = true;
  /** The live-floor occupancy read-model (FP-1), threaded from the app — the SAME `getTablesState` rows
   * the floor screen renders. The move/join/merge/transfer action flow (TS-3/TS-4) reads it for its
   * target lists: FREE tables to move/join onto, and OTHER open tabs to merge/transfer with. Empty until
   * the app supplies it; an empty list simply yields the picker's "no targets" empty-state. */
  @property({ attribute: false }) tables: TableState[] = [];

  /** Whether the pull-out tab drawer is open (its handle toggles it). */
  @state() private drawerOpen = false;

  /**
   * The active menu DIET filter (dietary-classification, Task 7), or `null` for none — a view-only lens
   * that narrows the round grid to vegan / vegetarian / no-meat / no-fish via {@link filterProductsByDiet}.
   * Owned locally (like {@link drawerOpen}, unlike the app-owned {@link selectedMenuId}): the diet lens
   * touches ONLY which tiles are visible, never the tab or the round. The diet-filter widget's
   * `diet-filter-selected` toggles it.
   */
  @state() private selectedDiet: DietPredicate | null = null;

  /** Which step of the in-drawer table-action flow (TS-3/TS-4) is showing — `closed` is the resting
   * state (only the "Table actions" trigger visible). The trigger opens the `menu`; a verb pick moves to
   * the target `pick` step (free tables for move/join, other open tabs for merge/transfer — the two are
   * told apart by {@link actionVerb}); a transfer then advances to `transfer-lines` to choose which lines
   * to move. */
  @state() private actionStep: "closed" | "menu" | "pick" | "transfer-lines" = "closed";
  /** The verb the operator picked in the action menu — decides which target list the picker shows and
   * which event a target pick dispatches. `null` while the flow is closed or on the menu. */
  @state() private actionVerb: "move" | "join" | "merge" | "transfer" | null = null;
  /** The destination tab's working-order id for an in-flight transfer, captured when the operator picks
   * it in the `pick` step; the `transfer-lines` step dispatches `transfer-lines` against it. `null`
   * otherwise. */
  @state() private transferToTabId: string | null = null;
  /** The lines selected for a transfer, by `lineNo` (v1 moves whole lines only, so no per-line quantity
   * is stored). A NEW Set is assigned on every mutation so Lit re-renders (a Set is not deeply reactive). */
  @state() private transferLineNos = new Set<number>();

  /** The CURRENT round the product grid rings into and the round basket shows — its own store, distinct
   * from the tab (which is server-side). Cleared by {@link #sendRound}. */
  readonly #roundStore = new WorkingOrderStore();
  /** Per-round-line course OVERRIDES the waiter picked (KDS-2 §5b), keyed by the round line's stable
   * object identity — a `WorkingOrderStore` line object is pushed once and kept by reference until the
   * round clears, so a `WeakMap` survives re-renders and reorders and auto-drops its entries when the
   * round is sent (the line objects become unreachable). A line ABSENT here takes its product's default
   * course server-side (`<override> ?? product.course_id`); the picker offers no explicit "no course"
   * option, so a value here is always a real course id, never null. */
  #roundCourses = new WeakMap<OrderLine, string>();
  /** The pay store fed to `tender-pay` — rebuilt from {@link lines} on every change (see {@link willUpdate}). */
  #payStore?: TabPayStore;
  /** Per-line locked gross, keyed by `lineNo`, memoised from {@link lines} in the SAME
   * {@link willUpdate} guard that rebuilds {@link #payStore} — so a render triggered by the unrelated
   * `#roundStore` subscription (a product tap while building a round) reuses these instead of
   * recomputing `unitPriceGross × quantity` for every pending + served line. `lineNo` is unique per tab,
   * so it is a safe key; the map is fully populated for the current {@link lines} before any render. */
  #lineGrossByLineNo = new Map<number, Decimal>();

  constructor() {
    super();
    // Re-render on any round change (add/remove/clear) so the round basket and the Enviar-ronda
    // disabled state track the store; the controller owns the subscription lifecycle.
    new StoreChangeController(this, () => this.#roundStore);
  }

  override willUpdate(changed: PropertyValues<this>): void {
    // The per-line locked grosses and the tab total the pay widget settles against are both memoised
    // once per lines change — never a catalogue recompute (H2). Built on the first update too, before
    // the first render reads them. The gross map is filled BEFORE `#tabTotal` sums it below.
    if (changed.has("lines") || this.#payStore === undefined) {
      this.#lineGrossByLineNo = new Map(
        this.lines.map((line) => [line.lineNo, grossOf(line.unitPriceGross, line.quantity)]),
      );
      this.#payStore = new TabPayStore(this.#tabTotal(), this.lines.length);
    }
    // A tab switch (the app re-points `orderId` at a different working order) must not carry a half-open
    // action flow across — its target lists and captured transfer destination belong to the OLD tab. Reset
    // to the trigger. Guarded on a real change (not the first update, where the old value is undefined and
    // there is nothing open to reset).
    if (changed.has("orderId") && changed.get("orderId") !== undefined) {
      this.#closeActions();
    }
  }

  /** The line's LOCKED gross (`unitPriceGross × quantity` at money scale, via the shared `grossOf`
   * primitive), read from the {@link #lineGrossByLineNo} memo built in {@link willUpdate} — the SAME
   * arithmetic the server files with, so a drawer row can never round differently from the tab total or
   * the filed ticket. */
  #lineGross(line: TabLine): Decimal {
    return this.#lineGrossByLineNo.get(line.lineNo)!;
  }

  /** The tab's gross total — Σ of the locked line grosses, at money scale (`0.00` for an empty tab). */
  #tabTotal(): Decimal {
    return toScale(sumDecimals(this.lines.map((line) => this.#lineGross(line))), MONEY_SCALE);
  }

  /** The lines still to serve (`served_at IS NULL`) — the badge count and the Pendiente section. */
  #pending(): TabLine[] {
    return this.lines.filter((line) => line.servedAt === null);
  }

  /** The lines already served — the Servido section (no tick; the marker is set). */
  #served(): TabLine[] {
    return this.lines.filter((line) => line.servedAt !== null);
  }

  /** A line's display name from the catalogue, falling back to the raw id for a product deactivated
   * since it was added (mirrors the retrieve path's productId-only philosophy). */
  #nameFor(productId: string): string {
    const product = this.products.find((candidate) => candidate.id === productId);
    return product ? productName(product) : productId;
  }

  /** Trim a numeric(_,3) quantity's trailing zeros for display ("2.000" → "2", "0.320" → "0.32") —
   * the shared {@link trimQuantity} the kitchen queue uses too. */
  #displayQty(quantity: string): string {
    return trimQuantity(quantity);
  }

  /** Emit the current round's picked lines — each with its course OVERRIDE when the waiter picked one
   * (KDS-2 §5b) and its selected modifiers when the picker chose any (ordering modifiers, Task 9) — and
   * clear the round bar for the next round. An unoverridden line OMITS `courseId`, so the server applies
   * the product's default course (`<override> ?? product.course_id`); a plain line OMITS `options` (never
   * `[]`), which the server reads as no modifiers. `options` carry only the `optionGroupItemId`s — the
   * server re-resolves each option's price, VAT and name authoritatively. */
  #sendRound(): void {
    const lines = this.#roundStore.lines.map((line) => {
      const roundLine: RoundLine = { productId: line.product.id, quantity: line.quantity };
      const courseId = this.#roundCourses.get(line);
      if (courseId !== undefined) {
        roundLine.courseId = courseId;
      }
      if (line.options !== undefined && line.options.length > 0) {
        roundLine.options = line.options.map(toWireOption);
      }
      return roundLine;
    });
    this.dispatchEvent(
      new CustomEvent("send-round", { detail: { lines }, bubbles: true, composed: true }),
    );
    this.#roundStore.clear();
  }

  /** A round line's PRE-SELECTED course id: the waiter's override if any, else the product's default
   * course, else `""` (the "use the product default" placeholder — never a "no course" option). */
  #selectedCourseId(line: OrderLine): string {
    return this.#roundCourses.get(line) ?? line.product.courseId ?? "";
  }

  /** Record a per-line course pick. `""` (the default placeholder) clears any override so the line falls
   * back to the product default server-side; any other value is an explicit override. `requestUpdate`
   * because {@link #roundCourses} is a `WeakMap`, not a reactive property — the picker must re-render to
   * reflect the new selection (and a store-triggered re-render reads the same map). */
  #pickCourse(line: OrderLine, courseId: string): void {
    if (courseId === "") this.#roundCourses.delete(line);
    else this.#roundCourses.set(line, courseId);
    this.requestUpdate();
  }

  /** The tab's HELD courses (KDS-2 §5b), in `displayOrder` — each course that has at least one line whose
   * kitchen item is still held (`firedAt === null`) and that is still an ACTIVE venue course (so it has a
   * name and can be fired). A null-course line fires immediately, so it is never held; a course
   * deactivated since it was rung drops off (firing it would be `course.not_found`, Task 4's accepted
   * edge). The waiter-fire section renders one "Fire <course>" action per entry. */
  #heldCourses(): TillCourse[] {
    const heldIds = new Set(
      this.lines
        .filter((line) => line.firedAt === null && line.courseId !== null)
        .map((line) => line.courseId),
    );
    return this.courses.filter((course) => heldIds.has(course.id));
  }

  /** Announce a waiter fire of one held course (KDS-2 §5b) — the app releases it via `fireCourse` and
   * reloads the tab. Carries the tab's order id + the course id, the SAME `{ orderId, courseId }` shape
   * the station display's kitchen-fire uses. */
  #fire(courseId: string): void {
    this.dispatchEvent(
      new CustomEvent("fire-course", {
        detail: { orderId: this.orderId, courseId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Announce that one pending line went out (the app marks it served, then reloads the tab). */
  #serve(lineNo: number): void {
    this.dispatchEvent(
      new CustomEvent("serve-line", { detail: { lineNo }, bubbles: true, composed: true }),
    );
  }

  #toggleDrawer(): void {
    this.drawerOpen = !this.drawerOpen;
  }

  /** Announce a status pick (a status id, or `null` to clear) — the app keys it by TABLE id. */
  #pickStatus(statusId: string | null): void {
    this.dispatchEvent(
      new CustomEvent("set-status", { detail: { statusId }, bubbles: true, composed: true }),
    );
  }

  /** Return to the live floor (the app reloads occupancy so a just-paid table shows free). */
  #back(): void {
    this.dispatchEvent(new CustomEvent("back-to-floor", { bubbles: true, composed: true }));
  }

  /** Apply the diet-filter widget's pick (`diet-filter-selected`) — a predicate or `null` (cleared). */
  #pickDiet(predicate: DietPredicate | null): void {
    this.selectedDiet = predicate;
  }

  /** The tiles the round grid shows: the selected menu's products ({@link filterProductsByMenu}), then
   *  narrowed to the active diet lens ({@link filterProductsByDiet}) when one is set. A tab line's name
   *  still resolves against the FULL set ({@link #nameFor}), so a filtered grid never blanks a line. */
  #gridProducts(): TillProduct[] {
    return visibleProducts(this.products, this.selectedMenuId, this.selectedDiet);
  }

  /** Whether to show the diet filter at all — only when some product carries a published diet, so a
   *  venue with no dietary data adds no filter chrome above the round grid. */
  #hasDietData(): boolean {
    return hasDietData(this.products);
  }

  /**
   * Re-emit the embedded `tender-pay`'s terminal tender as `pay-tab` so the APP settles the tab through
   * the EXISTING `recordSale` path (design H2). `stopPropagation` keeps the inner `confirm-payment` from
   * reaching the app's counter `#onConfirmPayment`, which would `#syncIfDirty` → re-price the tab's
   * locked lines. The detail (the cash/card tender) rides through verbatim.
   */
  #onTenderConfirm(event: Event): void {
    event.stopPropagation();
    const detail = (event as CustomEvent<ConfirmPaymentDetail>).detail;
    this.dispatchEvent(new CustomEvent("pay-tab", { detail, bubbles: true, composed: true }));
  }

  /** Swallow a Hold/`park-order` from the embedded pay widget: a persisted tab cannot be parked, so this
   * meaningless affordance must never reach the app's counter `#onParkOrder`. */
  #onTenderPark(event: Event): void {
    event.stopPropagation();
  }

  override render() {
    const pending = this.#pending();
    return html`
      <section
        class="screen"
        data-order-id=${this.orderId ?? nothing}
        aria-label=${t("table.title")}
      >
        <header class="head">
          <h1 class="title">${t("table.title")}</h1>
          <div class="head-actions">
            <wt-button
              class="drawer-handle"
              data-open-drawer
              variant="secondary"
              aria-label=${t("table.open_drawer")}
              @click=${() => this.#toggleDrawer()}
            >
              ${t("table.open_drawer")}
              ${
                pending.length > 0
                  ? html`<span class="badge" data-pending-badge>${pending.length}</span>`
                  : nothing
              }
            </wt-button>
            <wt-button class="back" data-back variant="secondary" @click=${() => this.#back()}>
              ${t("table.back")}
            </wt-button>
          </div>
        </header>
        <div class="layout">
          <div class="grid-region">
            <till-menu-switcher
              class="menu-switcher"
              .menus=${this.menus}
              .selectedId=${this.selectedMenuId}
            ></till-menu-switcher>
            ${
              this.#hasDietData()
                ? html`<till-diet-filter
                    class="diet-filter"
                    .selected=${this.selectedDiet}
                    @diet-filter-selected=${(e: CustomEvent<{ predicate: DietPredicate | null }>) =>
                      this.#pickDiet(e.detail.predicate)}
                  ></till-diet-filter>`
                : nothing
            }
            <till-product-grid
              .products=${this.#gridProducts()}
              .store=${this.#roundStore}
            ></till-product-grid>
          </div>
          ${this.drawerOpen ? this.#drawer(pending) : nothing}
        </div>
        ${this.#roundCoursesSection()}
        <div class="round-bar">
          <till-basket .store=${this.#roundStore}></till-basket>
          <wt-button
            class="send-round"
            data-send-round
            variant="primary"
            size="lg"
            ?disabled=${this.#roundStore.lineCount === 0}
            @click=${() => this.#sendRound()}
          >
            ${t("table.send_round")}
          </wt-button>
        </div>
      </section>
    `;
  }

  /** The round bar's per-line COURSE PICKER (KDS-2 §5b): one select per current-round line, defaulting to
   * the product's course, overridable to any active venue course. Rendered only when a round is being
   * built AND the venue has courses to pick — with none, there is nothing to choose and the strip stays
   * hidden. The `""` placeholder means "use the product default", not "no course" (no such option). */
  #roundCoursesSection(): TemplateResult | typeof nothing {
    const lines = this.#roundStore.lines;
    if (lines.length === 0 || this.courses.length === 0) return nothing;
    return html`<div class="round-courses" data-round-courses>
      ${lines.map((line, index) => this.#roundCourseRow(line, index))}
    </div>`;
  }

  #roundCourseRow(line: OrderLine, index: number): TemplateResult {
    const name = productName(line.product);
    const selected = this.#selectedCourseId(line);
    return html`<label class="round-course">
      <span class="round-course-name">${name} ×${this.#displayQty(line.quantity)}</span>
      <select
        data-round-course=${index}
        aria-label=${`${t("table.course_label")} · ${name}`}
        @change=${(event: Event) =>
          this.#pickCourse(line, (event.target as HTMLSelectElement).value)}
      >
        <option value="" .selected=${selected === ""}>${t("table.course_default")}</option>
        ${this.courses.map(
          (course) =>
            html`<option value=${course.id} .selected=${selected === course.id}>
              ${course.name}
            </option>`,
        )}
      </select>
    </label>`;
  }

  #drawer(pending: TabLine[]): TemplateResult {
    return html`
      <aside class="drawer" data-drawer aria-label=${t("table.open_drawer")}>
        ${this.#fireSection()} ${this.#pendingSection(pending)} ${this.#servedSection()}
        <div class="total-row">
          <span class="label">${t("label.total")}</span>
          <span class="amount" data-tab-total>${formatMoney(this.#payStore!.total)}</span>
        </div>
        ${
          this.canSettle
            ? html`<section
                class="pay"
                @confirm-payment=${(event: Event) => this.#onTenderConfirm(event)}
                @park-order=${(event: Event) => this.#onTenderPark(event)}
              >
                <h2>${t("table.pay_title")}</h2>
                <till-tender-pay .store=${this.#payStore} .busy=${this.busy}></till-tender-pay>
              </section>`
            : nothing
        }
        ${this.#statusSection()} ${this.#actionSection()}
      </aside>
    `;
  }

  #pendingSection(pending: TabLine[]): TemplateResult {
    return html`<section class="pending">
      <h2>${t("table.pending_title")}</h2>
      ${
        pending.length === 0
          ? html`<p class="empty">${t("table.none_pending")}</p>`
          : html`<ul>
              ${pending.map((line) => this.#pendingLine(line))}
            </ul>`
      }
    </section>`;
  }

  #pendingLine(line: TabLine): TemplateResult {
    const name = this.#nameFor(line.productId);
    return html`<li class="line pending-line">
      <span class="name">${name}</span>
      <span class="qty">${this.#displayQty(line.quantity)}</span>
      <span class="line-total">${formatMoney(this.#lineGross(line))}</span>
      <wt-button
        class="serve"
        size="sm"
        variant="primary"
        data-serve=${line.lineNo}
        aria-label=${`${t("table.serve")} ${name}`}
        @click=${() => this.#serve(line.lineNo)}
      >
        <span aria-hidden="true">✓</span>
      </wt-button>
    </li>`;
  }

  #servedSection(): TemplateResult {
    const served = this.#served();
    return html`<section class="served">
      <h2>${t("table.served_title")}</h2>
      ${
        served.length === 0
          ? html`<p class="empty">${t("table.none_served")}</p>`
          : html`<ul>
              ${served.map(
                (line) =>
                  html`<li class="line served-line">
                    <span class="name">${this.#nameFor(line.productId)}</span>
                    <span class="qty">${this.#displayQty(line.quantity)}</span>
                    <span class="line-total">${formatMoney(this.#lineGross(line))}</span>
                  </li>`,
              )}
            </ul>`
      }
    </section>`;
  }

  /** The waiter-fire section (KDS-2 §5b): under `fire_control = 'waiter'`, one "Fire <course>" action per
   * HELD course of the tab (in `displayOrder`). Hidden entirely under `kitchen` (the station display owns
   * the fire then) and when nothing is held. */
  #fireSection(): TemplateResult | typeof nothing {
    if (this.fireControl !== "waiter") return nothing;
    const held = this.#heldCourses();
    if (held.length === 0) return nothing;
    return html`<section class="fire" data-fire-section>
      <h2>${t("table.fire_title")}</h2>
      <div class="fire-options">
        ${held.map(
          (course) =>
            html`<wt-button
              class="fire-course"
              data-fire-course=${course.id}
              variant="primary"
              size="sm"
              @click=${() => this.#fire(course.id)}
            >
              ${t("table.fire_course")} ${course.name}
            </wt-button>`,
        )}
      </div>
    </section>`;
  }

  #statusSection(): TemplateResult {
    return html`<section class="status">
      <h2>${t("table.status_title")}</h2>
      <div class="status-options">
        ${this.statuses.map(
          (status) =>
            html`<wt-button
              class="status-option"
              data-status=${status.id}
              variant="secondary"
              @click=${() => this.#pickStatus(status.id)}
            >
              <span class="dot" style="background: ${status.color}" aria-hidden="true"></span>
              ${status.label}
            </wt-button>`,
        )}
        <wt-button
          class="status-clear"
          data-status-clear
          variant="secondary"
          @click=${() => this.#pickStatus(null)}
        >
          ${t("table.status_clear")}
        </wt-button>
      </div>
    </section>`;
  }

  // ── Table actions (TS-3/TS-4): move / join / merge / transfer ─────────────────────────────────────

  /** The FREE tables a move/join can target — the read-model rows in the `free` state. */
  #freeTables(): TableState[] {
    return this.tables.filter((table) => table.state === "free");
  }

  /** The OTHER open tabs a merge/transfer can target — every row with an open tab whose working-order id
   * is present and is NOT this tab's own (a tab cannot merge/transfer with itself). Deduplicated BY TAB:
   * a joined tab spans several `dining_tables` rows all pointing at one `tabId`, and the picker chooses a
   * BILL, not a table — so it shows one entry per tab (the first covering row's label). */
  #otherTabs(): TableState[] {
    const seen = new Set<string>();
    return this.tables.filter((table) => {
      if (!table.hasOpenTab || table.tabId == null || table.tabId === this.orderId) return false;
      if (seen.has(table.tabId)) return false;
      seen.add(table.tabId);
      return true;
    });
  }

  /** Reset the whole action flow to its resting state (only the trigger visible). */
  #closeActions(): void {
    this.actionStep = "closed";
    this.actionVerb = null;
    this.transferToTabId = null;
    this.transferLineNos = new Set();
  }

  /** Emit one composed, bubbling CustomEvent — the same event shape as this screen's other dispatch sites
   * (`send-round`, `serve-line`, `set-status`, …), factored here because the action flow has several. */
  #dispatch(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  /** The action-menu verb pick: all four verbs advance to the single `pick` step, which shows free tables
   * (move/join) or other open tabs (merge/transfer) per {@link actionVerb}. */
  #chooseVerb(verb: "move" | "join" | "merge" | "transfer"): void {
    this.actionVerb = verb;
    this.actionStep = "pick";
  }

  /** A target pick in the picker. Move/join/merge dispatch immediately and close; transfer captures the
   * destination tab and advances to the line-picker step (nothing is dispatched until the lines are chosen). */
  #pickTarget(table: TableState): void {
    switch (this.actionVerb) {
      case "move":
        this.#dispatch("move-tab", { toTableId: table.id });
        this.#closeActions();
        break;
      case "join":
        this.#dispatch("join-table", { tableId: table.id });
        this.#closeActions();
        break;
      case "merge":
        this.#dispatch("merge-tabs", { fromTabId: table.tabId, freeSourceTable: true });
        this.#closeActions();
        break;
      case "transfer":
        this.transferToTabId = table.tabId ?? null;
        this.actionStep = "transfer-lines";
        break;
    }
  }

  /** Toggle a whole line into/out of the transfer selection (v1 moves whole lines only). A NEW Set is
   * assigned so Lit re-renders. */
  #toggleTransferLine(line: TabLine): void {
    const next = new Set(this.transferLineNos);
    if (next.has(line.lineNo)) next.delete(line.lineNo);
    else next.add(line.lineNo);
    this.transferLineNos = next;
  }

  /** Build the `transfers` list from the selected lines and dispatch `transfer-lines`, then close. v1 moves
   * whole lines only, so every entry is `{ lineNo }` with no `quantity`; when a partial-quantity stepper is
   * added, reintroduce the split (a `quantity` < the line's) there. No-op with nothing selected or no
   * destination captured. */
  #confirmTransfer(): void {
    if (this.transferToTabId === null || this.transferLineNos.size === 0) return;
    const transfers: TabTransfer[] = this.lines
      .filter((line) => this.transferLineNos.has(line.lineNo))
      .map((line) => ({ lineNo: line.lineNo }));
    this.#dispatch("transfer-lines", { toTabId: this.transferToTabId, transfers });
    this.#closeActions();
  }

  /** The Back control: from the menu it closes the flow; from the picker it returns to the menu; from the
   * transfer line-picker it returns to the picker. */
  #actionBack(): void {
    switch (this.actionStep) {
      case "menu":
        this.#closeActions();
        break;
      case "pick":
        this.actionStep = "menu";
        this.actionVerb = null;
        break;
      case "transfer-lines":
        this.transferToTabId = null;
        this.transferLineNos = new Set();
        this.actionStep = "pick";
        break;
    }
  }

  /** The in-drawer action flow (TS-3/TS-4). Renders the trigger when resting, else the active step. */
  #actionSection(): TemplateResult {
    switch (this.actionStep) {
      case "closed":
        return html`<wt-button
          class="move-split"
          data-move-split
          variant="secondary"
          @click=${() => (this.actionStep = "menu")}
        >
          ${t("table.actions_title")}
        </wt-button>`;
      case "menu":
        return this.#actionMenu();
      case "pick":
        return this.#targetPicker();
      case "transfer-lines":
        return this.#transferLinesStep();
    }
  }

  #actionMenu(): TemplateResult {
    const verb = (
      name: "move" | "join" | "merge" | "transfer",
      key:
        "table.action_move" | "table.action_join" | "table.action_merge" | "table.action_transfer",
    ) =>
      html`<wt-button
        class="action"
        data-action=${name}
        variant="secondary"
        @click=${() => this.#chooseVerb(name)}
      >
        ${t(key)}
      </wt-button>`;
    return html`<section class="actions" data-action-menu>
      <h2>${t("table.actions_title")}</h2>
      <div class="action-options">
        ${verb("move", "table.action_move")} ${verb("join", "table.action_join")}
        ${verb("merge", "table.action_merge")} ${verb("transfer", "table.action_transfer")}
        <wt-button class="action" data-action="split" variant="secondary" ?disabled=${true}>
          ${t("table.action_split")}
        </wt-button>
      </div>
      ${this.#backButton()}
    </section>`;
  }

  #targetPicker(): TemplateResult {
    const forTables = this.actionVerb === "move" || this.actionVerb === "join";
    const targets = forTables ? this.#freeTables() : this.#otherTabs();
    const emptyKey = forTables ? "table.no_free_tables" : "table.no_other_tabs";
    return html`<section class="actions" data-target-picker>
      <h2>${t("table.actions_title")}</h2>
      ${
        targets.length === 0
          ? html`<p class="empty">${t(emptyKey)}</p>`
          : html`<div class="action-options">
              ${targets.map(
                (table) =>
                  html`<wt-button
                    class="target"
                    data-target=${forTables ? table.id : table.tabId!}
                    variant="secondary"
                    @click=${() => this.#pickTarget(table)}
                  >
                    ${table.label}
                  </wt-button>`,
              )}
            </div>`
      }
      ${this.#backButton()}
    </section>`;
  }

  #transferLinesStep(): TemplateResult {
    const canConfirm = this.transferToTabId !== null && this.transferLineNos.size > 0;
    return html`<section class="actions" data-transfer-lines>
      <h2>${t("table.transfer_pick_lines")}</h2>
      ${
        this.lines.length === 0
          ? html`<p class="empty">${t("table.transfer_no_lines")}</p>`
          : html`<div class="action-options">
              ${this.lines.map((line) => this.#transferLineRow(line))}
            </div>`
      }
      <wt-button
        class="transfer-confirm"
        data-transfer-confirm
        variant="primary"
        ?disabled=${!canConfirm}
        @click=${() => this.#confirmTransfer()}
      >
        ${t("table.transfer_confirm")}
      </wt-button>
      ${this.#backButton()}
    </section>`;
  }

  #transferLineRow(line: TabLine): TemplateResult {
    const name = this.#nameFor(line.productId);
    const selected = this.transferLineNos.has(line.lineNo);
    return html`<wt-button
      class="transfer-line ${selected ? "selected" : ""}"
      data-transfer-line=${line.lineNo}
      variant="secondary"
      aria-pressed=${selected}
      @click=${() => this.#toggleTransferLine(line)}
    >
      <span aria-hidden="true">${selected ? "☑" : "☐"}</span> ${name}
      <span class="qty">${this.#displayQty(line.quantity)}</span>
    </wt-button>`;
  }

  #backButton(): TemplateResult {
    return html`<wt-button
      class="action-back"
      data-action-back
      variant="secondary"
      @click=${() => this.#actionBack()}
    >
      ${this.actionStep === "menu" ? t("action.cancel") : t("action.back")}
    </wt-button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-table-order-screen": TillTableOrderScreen;
  }
}
