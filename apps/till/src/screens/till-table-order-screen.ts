import { optionAnswers } from "../widgets/option-snapshot.js";
import { ContentLanguageController } from "@waitron/ui";
import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import {
  addDecimal,
  compareDecimal,
  decimal,
  formatMoney,
  grossOf,
  MONEY_SCALE,
  subtractDecimal,
  sumDecimals,
  toScale,
  type Decimal,
} from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";
import { selectStyles } from "../select-styles.js";
import { type DietPredicate, hasDietData, visibleProducts } from "../menu-filter.js";
import { lineProductName, productName } from "../widgets/product-name.js";
import { trimQuantity } from "../widgets/dish-format.js";
import { WorkingOrderStore, type OrderLine } from "../state/working-order.js";
import { toWireLineExtras, toWireModifiers, toWireProductIdentity } from "../state/order-line.js";
import { StoreChangeController } from "../state/store-controller.js";
import "../widgets/product-grid.js";
import "../widgets/basket.js";
import "../widgets/tender-pay.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-input.js";
import "../widgets/menu-switcher.js";
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

export type { TableServiceStatus };

/**
 * The tab's LOCKED total and line count, fed to the embedded `tender-pay`. A tab never re-prices: the
 * add-time `unit_price_gross` is authoritative, which is why the tab lines are not loaded into a normal
 * store.
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
 * The TILL table-ordering screen: one open table's tab. The round bar holds the CURRENT round only,
 * never the whole tab.
 *
 * FISCAL FIREWALL. The screen owns NO fiscal path: every write is dispatched upward for the app to
 * persist. Pay reuses `tender-pay` against the {@link TabPayStore}, and the screen re-emits its
 * `confirm-payment` as `pay-tab`, so the app settles the whole tab through the existing `recordSale`
 * verb, never a new fiscal verb and never a re-price.
 *
 * Every handler only writes reactive state or dispatches upward, so no `isConnected` guard is needed.
 */
@customElement("till-table-order-screen")
export class TillTableOrderScreen extends LitElement {
  static override styles = [
    css`
      .modifier-answer {
        display: block;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
    `,
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

      /* The pending-round drawer handle (+ its Back sibling): a SIBLING of the header (never inside it),
         so the drawer handle survives when the standalone header is dropped in an embedded card host
         (SP-B2.2) — it is table BODY function, not shell chrome. Back lives here too but is dropped when
         embedded (the card host owns nav). Mirrors the floor and station screens' actions extraction. */
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
        /* Up to SIX direct grid children on a pending line: name, qty, line-total, #lineCourse (a course
           control when a venue has courses configured, else nothing), #lineAction (a Send/Recall/Cancel
           button when the line offers one, else nothing) and the always-present serve button. Any track
           whose child renders nothing collapses to 0 width, so sizing to the max keeps the serve button
           on one row when both optional children render. The narrower .served-line overrides this below. */
        grid-template-columns: 1fr auto auto auto auto auto;
        align-items: center;
        gap: var(--wt-space-3);
        padding: var(--wt-space-2) 0;
        border-bottom: 1px solid var(--wt-color-border);
      }

      .served-line {
        grid-template-columns: 1fr auto auto auto;
        color: var(--wt-color-text-muted);
      }

      /* A CHILD extras row belongs to the dish above it, and a waiter must be able to see that at a
         glance: three of a €12.50 cheese is a pick on a burger, not three portions of cheese. Same
         shape the basket gives a pick (the .option rule in ../widgets/basket.ts) — indented and muted —
         with the smaller type the screen already uses for a line's subordinate text. */
      .child-line {
        padding-left: var(--wt-space-4);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      /* The per-line course control (coursing editing A1): an editable select on a held line, a muted
         read-only label on a fired one. Capped so a long course name never crowds out the line total. */
      .line-course {
        min-width: 0;
        max-width: 8rem;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
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

      .split-line-row {
        display: grid;
        gap: var(--wt-space-2);
      }

      .split-quantity {
        margin-inline-start: var(--wt-space-4);
      }

      .split-stepper {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--wt-space-2);
      }

      .split-count {
        min-width: 3ch;
        text-align: center;
        font-variant-numeric: tabular-nums;
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

      /* The course name + select group; display:contents so its children stay direct flex items of
         .round-course (unchanged layout) while the hold switch sits beside them as a sibling. */
      .round-course-field {
        display: contents;
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

  /** The APP owns and reloads them; the drawer, total and badge render from these, never a re-price. */
  @property({ attribute: false }) lines: TabLine[] = [];
  /** ALL sellable products across the zone's menus: a tab may span several menus, and every line must
   * still render its name whatever menu is shown. */
  @property({ attribute: false }) products: TillProduct[] = [];
  @property({ attribute: false }) menus: TillMenu[] = [];
  /** Owned by the app; a switcher pick bubbles up as `menu-selected`. */
  @property() selectedMenuId = "";
  @property({ attribute: false }) statuses: TableServiceStatus[] = [];
  /** The venue's ACTIVE kitchen courses, in `displayOrder`. */
  @property({ attribute: false }) courses: TillCourse[] = [];
  @property() fireControl: FireControlMode = "waiter";
  @property() orderId?: string;
  /** The visible half of the app's single-flight fiscal guard. */
  @property({ type: Boolean }) busy = false;
  /** `false` hides the pay section. The server accepts a handheld's cash or manual-card tender on
   * `/api/sales` and fences only the integrated reader (`/api/pay`). */
  @property({ type: Boolean }) canSettle = true;
  /** Mounted inside a card host, which supplies the header; the drawer handle and its badge stay. */
  @property({ type: Boolean }) embedded = false;
  /** The target lists of the move/join/merge/transfer flow read this. */
  @property({ attribute: false }) tables: TableState[] = [];

  @state() private drawerOpen = false;

  /** null shows every dish in the selected menu. */
  @property({ attribute: false }) selectedDiet: DietPredicate | null = null;

  /** Cancelling a STARTED dish bins food, so — unlike Send/Recall — the void fires only once confirmed. */
  @state() private cancelLine: TabLine | null = null;

  @state() private actionStep: "closed" | "menu" | "pick" | "transfer-lines" | "split-lines" =
    "closed";
  @state() private actionVerb: "move" | "join" | "merge" | "transfer" | "split" | null = null;
  @state() private transferToTabId: string | null = null;
  /** A NEW Set is assigned on every mutation so Lit re-renders (a Set is not deeply reactive). */
  @state() private transferLineNos = new Set<number>();
  /** Kept separate from the whole-line transfer picker so quantity choices cannot change that flow. */
  @state() private splitQuantities = new Map<number, string>();
  @state() private splitAttempted = false;

  readonly #roundStore = new WorkingOrderStore();
  /**
   * Keyed by the round line's object identity: a store line is kept by reference until the round
   * clears, so a `WeakMap` survives re-renders and drops its entries once the round is sent. A line
   * ABSENT here takes its product's default course server-side.
   */
  #roundCourses = new WeakMap<OrderLine, string>();
  /** Same lifecycle as {@link #roundCourses}. Only ever `true`: {@link #toggleHold} DELETES the entry
   * rather than storing `false`, so a plain line's wire is `hold`-free. */
  #roundHolds = new WeakMap<OrderLine, boolean>();
  #payStore?: TabPayStore;
  /** Memoised so a render triggered by a round change does not recompute every line's gross. */
  #lineGrossByLineNo = new Map<number, Decimal>();

  constructor() {
    super();
    new ContentLanguageController(this);
    new StoreChangeController(this, () => this.#roundStore);
  }

  override willUpdate(changed: PropertyValues<this>): void {
    // The gross map is filled BEFORE `#tabTotal` sums it below.
    if (changed.has("lines") || this.#payStore === undefined) {
      this.#lineGrossByLineNo = new Map(
        this.lines.map((line) => [line.lineNo, grossOf(line.unitPriceGross, line.quantity)]),
      );
      this.#payStore = new TabPayStore(this.#tabTotal(), this.lines.length);
    }
    // A tab switch must not carry a half-open action flow across: its targets belong to the OLD tab.
    if (changed.has("orderId") && changed.get("orderId") !== undefined) {
      this.#closeActions();
    }
  }

  #lineGross(line: TabLine): Decimal {
    return this.#lineGrossByLineNo.get(line.lineNo)!;
  }

  #tabTotal(): Decimal {
    return toScale(sumDecimals(this.lines.map((line) => this.#lineGross(line))), MONEY_SCALE);
  }

  #pending(): TabLine[] {
    return this.lines.filter((line) => line.servedAt === null);
  }

  #served(): TabLine[] {
    return this.lines.filter((line) => line.servedAt !== null);
  }

  /** The STAFF label the server froze onto the line, falling back to the live catalogue, then to the raw
   * id for a product deactivated since the line was added. */
  #nameForLine(line: TabLine): string {
    return line.name ?? this.#nameFor(line.productId);
  }

  /** `productId` cannot tell a child extras row from a dish, because a child carries the PICKED
   * product. */
  #isChild(line: TabLine): boolean {
    return (line.parentLineNo ?? null) !== null;
  }

  #nameFor(productId: string | null): string {
    if (productId === null) return "";
    const product = this.products.find((candidate) => candidate.id === productId);
    return product ? productName(product) : productId;
  }

  #displayQty(quantity: string): string {
    return trimQuantity(quantity);
  }

  /** An unoverridden line OMITS `courseId`, so the server applies the product's default course. The
   * answers name lists, products and labels by id alone: the server re-resolves every price, VAT class
   * and name. */
  #sendRound(): void {
    const lines = this.#roundStore.lines.map((line) => {
      const roundLine: RoundLine = {
        ...toWireProductIdentity(line.product),
        quantity: line.quantity,
        ...toWireLineExtras(line),
        ...toWireModifiers(line),
      };
      const courseId = this.#roundCourses.get(line);
      if (courseId !== undefined) {
        roundLine.courseId = courseId;
      }
      if (this.#roundHolds.get(line) === true) {
        roundLine.hold = true;
      }
      return roundLine;
    });
    this.dispatchEvent(
      new CustomEvent("send-round", { detail: { lines }, bubbles: true, composed: true }),
    );
    this.#roundStore.clear();
  }

  #selectedCourseId(line: OrderLine): string {
    return this.#roundCourses.get(line) ?? line.product.courseId ?? "";
  }

  /** The placeholder's meaning is the CALLER's: "use the product default" for a round line (never sent
   * as a course), "no course" for a tab line (the explicit `null`). */
  #courseOptions(selected: string, placeholder: string): TemplateResult {
    return html`<option value="" .selected=${selected === ""}>${placeholder}</option>
      ${this.courses.map(
        (course) =>
          html`<option value=${course.id} .selected=${selected === course.id}>
            ${course.name}
          </option>`,
      )}`;
  }

  /** `requestUpdate` because {@link #roundCourses} is a `WeakMap`, not a reactive property. */
  #pickCourse(line: OrderLine, courseId: string): void {
    if (courseId === "") this.#roundCourses.delete(line);
    else this.#roundCourses.set(line, courseId);
    this.requestUpdate();
  }

  #isHeld(line: OrderLine): boolean {
    return this.#roundHolds.get(line) === true;
  }

  /** `requestUpdate` because {@link #roundHolds} is a `WeakMap`, not a reactive property. */
  #toggleHold(line: OrderLine, held: boolean): void {
    if (held) this.#roundHolds.set(line, true);
    else this.#roundHolds.delete(line);
    this.requestUpdate();
  }

  /** A course deactivated since it was rung drops off: firing it would be refused `course.not_found`. */
  #heldCourses(): TillCourse[] {
    const heldIds = new Set(
      this.lines
        .filter((line) => line.firedAt === null && line.courseId !== null)
        .map((line) => line.courseId),
    );
    return this.courses.filter((course) => heldIds.has(course.id));
  }

  #fire(courseId: string): void {
    this.dispatchEvent(
      new CustomEvent("fire-course", {
        detail: { orderId: this.orderId, courseId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #serve(lineNo: number): void {
    this.dispatchEvent(
      new CustomEvent("serve-line", { detail: { lineNo }, bubbles: true, composed: true }),
    );
  }

  #setLineCourse(lineNo: number, courseId: string | null): void {
    this.dispatchEvent(
      new CustomEvent("set-line-course", {
        detail: { lineNo, courseId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Shared by the Send button ({@link #lineAction}) and the Send-all gate ({@link #anyHeld}) so the two
   * stay in lockstep. A ticket-item-less parent (`state === null` — a moved/merged line or an
   * openTab-initial line) has nothing to send. The child exclusion is stated in its own right although
   * the server gives a child no ticket item, so `state === null` already refuses it. */
  #isSendable(line: TabLine): boolean {
    return !this.#isChild(line) && line.firedAt === null && line.state !== null;
  }

  /** HELD → Send; FIRED + not started → Recall; FIRED + started → Cancel, behind a confirm because a
   * started dish is binned. A CHILD extras row is part of its dish and offers no action of its own. */
  #lineAction(line: TabLine): TemplateResult | typeof nothing {
    if (this.#isChild(line)) return nothing;
    const name = this.#nameForLine(line);
    if (this.#isSendable(line)) {
      return html`<wt-button
        class="line-send"
        size="sm"
        variant="primary"
        data-send-line=${line.lineNo}
        aria-label=${`${t("table.send_line")} · ${name}`}
        @click=${() => this.#sendLine(line.lineNo)}
      >
        ${t("table.send_line")}
      </wt-button>`;
    }
    if (line.state === "queued") {
      return html`<wt-button
        class="line-recall"
        size="sm"
        variant="secondary"
        data-recall-line=${line.lineNo}
        aria-label=${`${t("table.recall_line")} · ${name}`}
        @click=${() => this.#recallLine(line.lineNo)}
      >
        ${t("table.recall_line")}
      </wt-button>`;
    }
    if (line.state === "preparing" || line.state === "ready") {
      return html`<wt-button
        class="line-cancel"
        size="sm"
        variant="danger"
        data-cancel-line=${line.lineNo}
        aria-label=${`${t("table.cancel_line")} · ${name}`}
        @click=${() => this.#requestCancel(line)}
      >
        ${t("table.cancel_line")}
      </wt-button>`;
    }
    return nothing;
  }

  #anyHeld(): boolean {
    return this.lines.some((line) => this.#isSendable(line));
  }

  #sendLine(lineNo: number): void {
    this.dispatchEvent(
      new CustomEvent("send-lines", {
        detail: { lineNos: [lineNo] },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** An empty `lineNos` is the server's send-all, so the detail carries `[]`, not the held line numbers. */
  #sendAll(): void {
    this.dispatchEvent(
      new CustomEvent("send-lines", { detail: { lineNos: [] }, bubbles: true, composed: true }),
    );
  }

  #recallLine(lineNo: number): void {
    this.dispatchEvent(
      new CustomEvent("recall-lines", {
        detail: { lineNos: [lineNo] },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #requestCancel(line: TabLine): void {
    this.cancelLine = line;
  }

  #confirmCancel(): void {
    const line = this.cancelLine;
    if (line === null) return;
    this.cancelLine = null;
    this.dispatchEvent(
      new CustomEvent("void-line", {
        detail: { lineNo: line.lineNo },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #dismissCancel(): void {
    this.cancelLine = null;
  }

  /** Always present, driven by {@link cancelLine}, so an Escape close flows back through `wt-close` into
   * the state rather than fighting the `.open` binding. */
  #cancelDialog(): TemplateResult {
    const line = this.cancelLine;
    return html`<wt-dialog
      class="cancel-confirm"
      .open=${line !== null}
      .heading=${t("table.cancel_title")}
      @wt-close=${() => this.#dismissCancel()}
    >
      <p class="cancel-body">
        ${t("table.cancel_started")}
        ${
          line !== null
            ? html`<span class="cancel-dish"
                >${this.#nameForLine(line)} ×${this.#displayQty(line.quantity)}</span
              >`
            : nothing
        }
      </p>
      <wt-button
        slot="footer"
        class="cancel-keep"
        variant="secondary"
        data-cancel-dismiss
        @click=${() => this.#dismissCancel()}
      >
        ${t("table.cancel_keep")}
      </wt-button>
      <wt-button
        slot="footer"
        class="cancel-do"
        variant="danger"
        data-cancel-confirm
        @click=${() => this.#confirmCancel()}
      >
        ${t("table.cancel_confirm")}
      </wt-button>
    </wt-dialog>`;
  }

  /** Falls back to the raw id for a course DEACTIVATED since the line was rung — never blank. */
  #courseName(courseId: string | null): string {
    if (courseId === null) return t("table.course_none");
    return this.courses.find((course) => course.id === courseId)?.name ?? courseId;
  }

  #courseValue(value: string): string | null {
    return value === "" ? null : value;
  }

  /** A FIRED line shows its course READ-ONLY: its course is corrected via recall, not moved here. A
   * CHILD extras row has no course of its own, and its null `firedAt` would otherwise paint an editable
   * picker on it. */
  #lineCourse(line: TabLine): TemplateResult | typeof nothing {
    if (this.courses.length === 0 || this.#isChild(line)) return nothing;
    if (line.firedAt !== null) {
      return html`<span class="line-course" data-line-course-static=${line.lineNo}
        >${this.#courseName(line.courseId)}</span
      >`;
    }
    const name = this.#nameForLine(line);
    return html`<select
      class="line-course"
      data-line-course=${line.lineNo}
      aria-label=${`${t("table.course_label")} · ${name}`}
      @change=${(event: Event) =>
        this.#setLineCourse(
          line.lineNo,
          this.#courseValue((event.target as HTMLSelectElement).value),
        )}
    >
      ${this.#courseOptions(line.courseId ?? "", t("table.course_none"))}
    </select>`;
  }

  #toggleDrawer(): void {
    this.drawerOpen = !this.drawerOpen;
  }

  #pickStatus(statusId: string | null): void {
    this.dispatchEvent(
      new CustomEvent("set-status", { detail: { statusId }, bubbles: true, composed: true }),
    );
  }

  #back(): void {
    this.dispatchEvent(new CustomEvent("back-to-floor", { bubbles: true, composed: true }));
  }

  #pickDiet(predicate: DietPredicate | null): void {
    this.selectedDiet = predicate;
  }

  /** A tab line's name still resolves against the FULL set ({@link #nameFor}), so a filtered grid never
   * blanks a line. */
  #gridProducts(): TillProduct[] {
    return visibleProducts(this.products, this.selectedMenuId, this.selectedDiet);
  }

  #hasDietData(): boolean {
    return hasDietData(this.products);
  }

  /** `stopPropagation` keeps the inner `confirm-payment` from reaching the app's counter
   * `#onConfirmPayment`, which would `#syncIfDirty` → re-price the tab's locked lines. */
  #onTenderConfirm(event: Event): void {
    event.stopPropagation();
    const detail = (event as CustomEvent<ConfirmPaymentDetail>).detail;
    this.dispatchEvent(new CustomEvent("pay-tab", { detail, bubbles: true, composed: true }));
  }

  /** A persisted tab cannot be parked, so the pay widget's Hold must never reach the app's counter
   * `#onParkOrder`. */
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
        ${
          this.embedded
            ? nothing
            : html`<header class="head">
                <h1 class="title">${t("table.title")}</h1>
              </header>`
        }
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
          ${
            this.embedded
              ? nothing
              : html`<wt-button
                  class="back"
                  data-back
                  variant="secondary"
                  @click=${() => this.#back()}
                >
                  ${t("table.back")}
                </wt-button>`
          }
        </div>
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
        ${this.#cancelDialog()}
      </section>
    `;
  }

  /** The `""` placeholder means "use the product default", not "no course" (no such option). */
  #roundCoursesSection(): TemplateResult | typeof nothing {
    const lines = this.#roundStore.lines;
    if (lines.length === 0 || this.courses.length === 0) return nothing;
    return html`<div class="round-courses" data-round-courses>
      ${lines.map((line, index) => this.#roundCourseRow(line, index))}
    </div>`;
  }

  #roundCourseRow(line: OrderLine, index: number): TemplateResult {
    const name = lineProductName(line.product);
    const selected = this.#selectedCourseId(line);
    // The hold switch is a SIBLING of the course `<label>`, not nested in it: a `<label>` may wrap only
    // its one control, and the switch carries its own inner label.
    return html`<div class="round-course">
      <label class="round-course-field">
        <span class="round-course-name">${name} ×${this.#displayQty(line.quantity)}</span>
        <select
          data-round-course=${index}
          aria-label=${`${t("table.course_label")} · ${name}`}
          @change=${(event: Event) =>
            this.#pickCourse(line, (event.target as HTMLSelectElement).value)}
        >
          ${this.#courseOptions(selected, t("table.course_default"))}
        </select>
      </label>
      <wt-switch
        class="round-hold"
        data-round-hold=${index}
        .checked=${this.#isHeld(line)}
        .label=${`${t("table.hold_label")} · ${name}`}
        @wt-change=${(event: Event) =>
          this.#toggleHold(line, (event as CustomEvent<{ checked: boolean }>).detail.checked)}
      ></wt-switch>
    </div>`;
  }

  #drawer(pending: TabLine[]): TemplateResult {
    return html`
      <aside class="drawer" data-drawer aria-label=${t("table.open_drawer")}>
        ${this.#fireSection()} ${this.#pendingSection(pending)} ${this.#servedSection()}
        <div class="total-row">
          <span class="label">${t("label.total")}</span>
          <span class="amount" data-tab-total
            >${formatMoney(this.#payStore!.total, currentLocale())}</span
          >
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
        this.#anyHeld()
          ? html`<wt-button
              class="send-all"
              size="sm"
              variant="primary"
              data-send-all
              @click=${() => this.#sendAll()}
            >
              ${t("table.send_all")}
            </wt-button>`
          : nothing
      }
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
    const name = this.#nameForLine(line);
    return html`<li class="line pending-line${this.#isChild(line) ? " child-line" : ""}">
      <span class="name"
        >${name}${optionAnswers(line.optionSnapshots, { reads: "staff" }).map((answer) => html`<span class="modifier-answer">${answer}</span>`)}</span
      >
      <span class="qty">${this.#displayQty(line.quantity)}</span>
      <span class="line-total">${formatMoney(this.#lineGross(line), currentLocale())}</span>
      ${this.#lineCourse(line)}${this.#lineAction(line)}
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
                  html`<li class="line served-line${this.#isChild(line) ? " child-line" : ""}">
                    <span class="name"
                      >${this.#nameForLine(line)}${optionAnswers(line.optionSnapshots, { reads: "staff" }).map((answer) => html`<span class="modifier-answer">${answer}</span>`)}</span
                    >
                    <span class="qty">${this.#displayQty(line.quantity)}</span>
                    <span class="line-total"
                      >${formatMoney(this.#lineGross(line), currentLocale())}</span
                    >
                    ${this.#lineCourse(line)}
                  </li>`,
              )}
            </ul>`
      }
    </section>`;
  }

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

  #freeTables(): TableState[] {
    return this.tables.filter((table) => table.state === "free");
  }

  /** Deduplicated BY TAB: a joined tab spans several table rows pointing at one `tabId`, and the picker
   * chooses a BILL, not a table. */
  #otherTabs(): TableState[] {
    const seen = new Set<string>();
    return this.tables.filter((table) => {
      if (!table.hasOpenTab || table.tabId == null || table.tabId === this.orderId) return false;
      if (seen.has(table.tabId)) return false;
      seen.add(table.tabId);
      return true;
    });
  }

  #closeActions(): void {
    this.actionStep = "closed";
    this.actionVerb = null;
    this.transferToTabId = null;
    this.transferLineNos = new Set();
    this.splitQuantities = new Map();
    this.splitAttempted = false;
  }

  #dispatch(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #chooseVerb(verb: "move" | "join" | "merge" | "transfer" | "split"): void {
    this.actionVerb = verb;
    if (verb === "split") {
      this.splitQuantities = new Map();
      this.splitAttempted = false;
    }
    this.actionStep = verb === "split" ? "split-lines" : "pick";
  }

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

  #toggleTransferLine(line: TabLine): void {
    const next = new Set(this.transferLineNos);
    if (next.has(line.lineNo)) next.delete(line.lineNo);
    else next.add(line.lineNo);
    this.transferLineNos = next;
  }

  /** Moves whole lines only, so every entry is `{ lineNo }` with no `quantity`. */
  #confirmTransfer(): void {
    if (this.transferToTabId === null || this.transferLineNos.size === 0) return;
    const transfers: TabTransfer[] = this.lines
      .filter((line) => this.transferLineNos.has(line.lineNo))
      .map((line) => ({ lineNo: line.lineNo }));
    this.#dispatch("transfer-lines", { toTabId: this.transferToTabId, transfers });
    this.#closeActions();
  }

  #toggleSplitLine(line: TabLine): void {
    const next = new Map(this.splitQuantities);
    if (next.has(line.lineNo)) next.delete(line.lineNo);
    else next.set(line.lineNo, this.#displayQty(line.quantity));
    this.splitQuantities = next;
    this.splitAttempted = false;
  }

  #setSplitQuantity(lineNo: number, quantity: string): void {
    const next = new Map(this.splitQuantities);
    next.set(lineNo, quantity);
    this.splitQuantities = next;
  }

  #stepSplitQuantity(line: TabLine, delta: -1 | 1): void {
    const current = decimal(
      this.splitQuantities.get(line.lineNo) ?? this.#displayQty(line.quantity),
    );
    const next =
      delta === -1 ? subtractDecimal(current, decimal("1")) : addDecimal(current, decimal("1"));
    if (compareDecimal(next, decimal("1")) < 0 || compareDecimal(next, decimal(line.quantity)) > 0)
      return;
    this.#setSplitQuantity(line.lineNo, next);
  }

  #splitPrecision(line: TabLine): number {
    return line.unitPrecision ?? 3;
  }

  #splitQuantityError(line: TabLine): string {
    const value = this.splitQuantities.get(line.lineNo) ?? "";
    const precision = this.#splitPrecision(line);
    const pattern =
      precision === 0 ? /^[1-9]\d*$/ : new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${precision}})?$`);
    if (!pattern.test(value)) {
      return t(
        precision === 0 ? "table.split_quantity_whole_error" : "table.split_quantity_decimal_error",
      );
    }
    try {
      const quantity = decimal(value);
      if (
        compareDecimal(quantity, decimal("0")) <= 0 ||
        compareDecimal(quantity, decimal(line.quantity)) > 0
      ) {
        return t(
          precision === 0
            ? "table.split_quantity_whole_error"
            : "table.split_quantity_decimal_error",
        );
      }
    } catch {
      return t(
        precision === 0 ? "table.split_quantity_whole_error" : "table.split_quantity_decimal_error",
      );
    }
    return "";
  }

  #splitErrors(): string[] {
    return this.lines
      .filter((line) => !this.#isChild(line) && this.splitQuantities.has(line.lineNo))
      .map((line) => this.#splitQuantityError(line))
      .filter((error) => error !== "");
  }

  /** Full quantities omit `quantity`; partial plain dishes carry their exact selected decimal. Modifier
   * children are absent from the picker and move with their whole parent on the server. */
  #confirmSplit(): void {
    if (this.splitQuantities.size === 0) return;
    this.splitAttempted = true;
    if (this.#splitErrors().length > 0) return;
    const transfers: TabTransfer[] = this.lines
      .filter((line) => !this.#isChild(line) && this.splitQuantities.has(line.lineNo))
      .map((line) => {
        const quantity = this.splitQuantities.get(line.lineNo)!;
        return compareDecimal(decimal(quantity), decimal(line.quantity)) === 0
          ? { lineNo: line.lineNo }
          : { lineNo: line.lineNo, quantity };
      });
    if (transfers.length === 0) return;
    this.#dispatch("split-lines", { transfers });
    this.#closeActions();
  }

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
      case "split-lines":
        this.splitQuantities = new Map();
        this.splitAttempted = false;
        this.actionStep = "menu";
        this.actionVerb = null;
        break;
    }
  }

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
      case "split-lines":
        return this.#splitLinesStep();
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
        <wt-button
          class="action"
          data-action="split"
          variant="secondary"
          @click=${() => this.#chooseVerb("split")}
        >
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
    // Dishes only. `carveOffLines` REFUSES a directly named child with `tab.transfer_modifier_line`
    // and cascades a dish's children with the dish instead (`apps/server/src/working-order.ts`), so
    // offering a child row here only buys a refusal.
    const lines = this.lines.filter((line) => !this.#isChild(line));
    return html`<section class="actions" data-transfer-lines>
      <h2>${t("table.transfer_pick_lines")}</h2>
      ${
        lines.length === 0
          ? html`<p class="empty">${t("table.transfer_no_lines")}</p>`
          : html`<div class="action-options">
              ${lines.map((line) => this.#transferLineRow(line))}
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
    const name = this.#nameForLine(line);
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

  #splitLinesStep(): TemplateResult {
    const lines = this.lines.filter((line) => !this.#isChild(line));
    const errors = this.splitAttempted ? this.#splitErrors() : [];
    return html`<section class="actions" data-split-lines>
      <h2>${t("table.split_pick_lines")}</h2>
      <p data-split-help>${t("table.split_options_together")}</p>
      <wt-form-error-summary
        heading=${t("form.error_heading")}
        .errors=${errors}
      ></wt-form-error-summary>
      ${
        lines.length === 0
          ? html`<p class="empty">${t("table.split_no_lines")}</p>`
          : html`<div class="action-options">${lines.map((line) => this.#splitLineRow(line))}</div>`
      }
      <wt-button
        class="transfer-confirm"
        data-split-confirm
        variant="primary"
        ?disabled=${this.splitQuantities.size === 0}
        @click=${() => this.#confirmSplit()}
      >
        ${t("table.split_confirm")}
      </wt-button>
      ${this.#backButton()}
    </section>`;
  }

  #splitLineRow(line: TabLine): TemplateResult {
    const selected = this.splitQuantities.has(line.lineNo);
    const quantity = this.splitQuantities.get(line.lineNo) ?? this.#displayQty(line.quantity);
    const name = this.#nameForLine(line);
    const error = this.splitAttempted && selected ? this.#splitQuantityError(line) : "";
    return html`<div class="split-line-row">
      <wt-button
        class="transfer-line ${selected ? "selected" : ""}"
        data-split-line=${line.lineNo}
        variant="secondary"
        aria-pressed=${selected}
        @click=${() => this.#toggleSplitLine(line)}
      >
        <span aria-hidden="true">${selected ? "☑" : "☐"}</span> ${name}
        <span class="qty">${this.#displayQty(line.quantity)}</span>
      </wt-button>
      ${
        selected
          ? this.#splitPrecision(line) === 0
            ? this.#splitEachQuantity(line, name, quantity)
            : html`<wt-input
                class="split-quantity"
                data-split-quantity=${line.lineNo}
                name=${`split-quantity-${line.lineNo}`}
                required
                .label=${t("table.split_quantity")}
                .value=${quantity}
                .error=${error}
                @wt-change=${(event: Event) => {
                  event.stopPropagation();
                  this.#setSplitQuantity(
                    line.lineNo,
                    (event as CustomEvent<{ value: string }>).detail.value,
                  );
                }}
              ></wt-input>`
          : nothing
      }
    </div>`;
  }

  #splitEachQuantity(line: TabLine, name: string, quantity: string): TemplateResult {
    const current = decimal(quantity);
    return html`<div class="split-quantity split-stepper">
      <span>${t("table.split_quantity")}</span>
      <wt-button
        variant="ghost"
        size="sm"
        data-split-dec=${line.lineNo}
        aria-label=${`${t("basket.decrease")} ${name}`}
        ?disabled=${compareDecimal(current, decimal("1")) <= 0}
        @click=${() => this.#stepSplitQuantity(line, -1)}
      >
        <span aria-hidden="true">−</span>
      </wt-button>
      <span class="split-count" data-split-count=${line.lineNo}>${quantity}</span>
      <wt-button
        variant="ghost"
        size="sm"
        data-split-inc=${line.lineNo}
        aria-label=${`${t("basket.increase")} ${name}`}
        ?disabled=${compareDecimal(current, decimal(line.quantity)) >= 0}
        @click=${() => this.#stepSplitQuantity(line, 1)}
      >
        <span aria-hidden="true">+</span>
      </wt-button>
    </div>`;
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
