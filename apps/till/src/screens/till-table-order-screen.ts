import { optionAnswers } from "../widgets/option-snapshot.js";
import { ContentLanguageController } from "@waitron/ui";
import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
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
  perDishOptionQuantity,
  toScale,
  type Decimal,
} from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import { selectStyles } from "../select-styles.js";
import { type DietPredicate, hasDietData, memoVisibleProducts, shownMenu } from "../menu-filter.js";
import { lineProductName, productName } from "../widgets/product-name.js";
import { trimQuantity } from "../widgets/dish-format.js";
import {
  WorkingOrderStore,
  type LineSelection,
  type OrderLine,
  type SelectedExtra,
} from "../state/working-order.js";
import { deriveExtraSelections } from "../state/held-extras.js";
import { deriveOptionSelections, sameOptionSelections } from "../state/held-options.js";
import { toWireLineExtras, toWireModifiers, toWireProductIdentity } from "../state/order-line.js";
import { HANDHELD_COLUMNS, TILL_COLUMNS } from "@waitron/catalogue/src/home-layout-columns.js";
import "../widgets/basket.js";
import "../widgets/menu-browser.js";
import "../widgets/tender-pay.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-input.js";
import "../widgets/menu-switcher.js";
import "../widgets/diet-filter.js";
import "../widgets/modifier-picker.js";
import type { ModifierConfirmDetail } from "../widgets/modifier-picker.js";
import type {
  GroupLine,
  OrderGroup,
  OrderLinePatch,
  TabLine,
  TableServiceStatus,
  TableState,
  TableVisit,
  TabTransfer,
  TillCourse,
  TillProduct,
  TillZoneMenu,
  VisitBill,
} from "../api/client.js";
import type { ConfirmPaymentDetail } from "../widgets/tender-pay.js";
import type { FireControlMode } from "../widgets/station-queue.js";
import {
  groupRound,
  heldGroupIds,
  inHeldGroup,
  sendsAlone,
  type RoundGroup,
} from "../state/round-groups.js";

export type { TableServiceStatus };

/**
 * A round to add to the tab, in `groups` naming its lines by their place in `lines`. The round stays
 * in `round` until the app has the server's answer: it takes out the `sent` lines (the ones `lines`
 * was built from, in order) once the round is added, and a refused round is kept (D9).
 */
export interface SendRoundDetail {
  lines: GroupLine[];
  groups: RoundGroup[];
  round: WorkingOrderStore;
  sent: readonly OrderLine[];
}

/** `change-line`: one sent line's edit, from the copy of the order read at `revision`. */
export interface ChangeLineDetail {
  lineNo: number;
  /** The line's staff name, for a message about the change shown once another order is open. */
  lineName: string;
  patch: OrderLinePatch;
  revision: number;
}

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
      .modifier-answer,
      .line-note {
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
        /* A pending line's first row: name, qty, line-total, #lineCourse (nothing when the venue has no
           courses; its track then collapses) and the serve button. The narrower .served-line overrides
           this below. */
        grid-template-columns: 1fr auto auto auto auto;
        align-items: center;
        gap: var(--wt-space-3);
        padding: var(--wt-space-2) 0;
        border-bottom: 1px solid var(--wt-color-border);
      }

      /* The line's actions take a row of their own: Change, Recall and Cancel together do not fit
         beside the name in the drawer at phone width. */
      .line-actions {
        grid-column: 1 / -1;
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--wt-space-2);
      }

      /* Three buttons do not fit on one line of the dialog at phone width, so they wrap rather than
         squeeze their labels onto two lines each. */
      .cancel-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--wt-space-2);
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

      .bill {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: var(--wt-space-1) var(--wt-space-3);
        padding: var(--wt-space-2) 0;
        border-bottom: 1px solid var(--wt-color-border);
      }

      .bill[aria-current="true"] .bill-name {
        font-weight: var(--wt-font-weight-bold);
      }

      .bill-total {
        font-variant-numeric: tabular-nums;
      }

      .bill-state {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .bill-actions,
      .finish {
        grid-column: 1 / -1;
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--wt-space-2);
      }

      .finish-refusal {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        margin: var(--wt-space-2) 0 0;
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-danger);
        border-radius: var(--wt-radius-md);
      }

      .finish-refusal wt-button {
        align-self: flex-end;
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
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--wt-space-3);
        padding-top: var(--wt-space-3);
        border-top: 1px solid var(--wt-color-border);
      }

      /* A round being sent takes no edit until the answer comes back; the status line says why. */
      .round-control[inert] {
        opacity: var(--wt-opacity-disabled);
      }

      .round-sending {
        margin: 0;
        padding-top: var(--wt-space-3);
        color: var(--wt-color-text-muted);
        font-weight: var(--wt-font-weight-bold);
      }

      /* A round line's name may wrap inside a word, so on a narrow screen the line's controls and its
         remove button stay on screen. */
      .round-bar till-basket::part(name) {
        overflow-wrap: anywhere;
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
  @property({ attribute: false }) menus: TillZoneMenu[] = [];
  /** Owned by the app; a switcher pick bubbles up as `menu-selected`. */
  @property() selectedMenuId = "";
  @property({ attribute: false }) statuses: TableServiceStatus[] = [];
  /** The venue's ACTIVE kitchen courses, in `displayOrder`. */
  @property({ attribute: false }) courses: TillCourse[] = [];
  /** The party's order groups, read with {@link lines}. */
  @property({ attribute: false }) groups: OrderGroup[] = [];
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
  /** The party seated at this table, or null for a tab that belongs to none. */
  @property({ attribute: false }) visit: TableVisit | null = null;
  /** Every bill of {@link visit}, merged parties' included. */
  @property({ attribute: false }) bills: VisitBill[] = [];
  /** Finish table was refused because a bill is unpaid. */
  @property({ type: Boolean }) finishRefused = false;
  /** A handheld form factor, whose menu browser shows fewer columns. */
  @property({ type: Boolean }) handheld = false;

  @state() private drawerOpen = false;

  /** null shows every dish in the selected menu. */
  @property({ attribute: false }) selectedDiet: DietPredicate | null = null;

  /** The revision {@link lines} was read at. */
  @property({ attribute: false }) revision = 0;
  /** The venue's setting. When off, the server refuses to change or recall a sent line that has a
   * ticket item, so those lines offer Cancel instead. */
  @property({ attribute: false }) editSentLines = true;
  /** Set by the app when a change was refused because the kitchen had started the line: that line's
   * Cancel confirm opens. */
  @property({ attribute: false }) cancelOffer: number | null = null;

  /** Cancelling takes a dish off the bill (and bins it once started), so — unlike Send/Recall — the
   * void fires only once confirmed. */
  @state() private cancelLine: TabLine | null = null;

  /** The line open in the Change editor. */
  @state() private changeLine: TabLine | null = null;
  /** Built once when the editor opens, not per render: the picker seeds from these once. */
  #changeProduct?: TillProduct;
  #changeSelection?: LineSelection;
  #changeRevision = 0;

  @state() private actionStep: "closed" | "menu" | "pick" | "transfer-lines" | "split-lines" =
    "closed";
  @state() private actionVerb: "move" | "join" | "merge" | "transfer" | "split" | null = null;
  @state() private transferToTabId: string | null = null;
  /** A NEW Set is assigned on every mutation so Lit re-renders (a Set is not deeply reactive). */
  @state() private transferLineNos = new Set<number>();
  /** Kept separate from the whole-line transfer picker so quantity choices cannot change that flow. */
  @state() private splitQuantities = new Map<number, string>();
  @state() private splitAttempted = false;

  /** One round per order, kept only as long as this screen is: another order shown here starts its
   * own round. */
  readonly #rounds = new Map<string, WorkingOrderStore>();

  get #roundStore(): WorkingOrderStore {
    const key = this.orderId ?? "";
    let round = this.#rounds.get(key);
    if (round === undefined) {
      round = new WorkingOrderStore();
      this.#rounds.set(key, round);
    }
    return round;
  }

  /** The round this screen re-renders on; it follows {@link orderId}. */
  #watchedRound?: { round: WorkingOrderStore; stop: () => void };

  #watchRound(): void {
    const round = this.#roundStore;
    if (this.#watchedRound?.round === round) return;
    this.#watchedRound?.stop();
    this.#watchedRound = { round, stop: round.subscribe(() => this.requestUpdate()) };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#watchRound();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#watchedRound?.stop();
    this.#watchedRound = undefined;
  }
  /**
   * Keyed by the round line's object identity: a store line is kept by reference until the round
   * clears, so a `WeakMap` survives re-renders and drops its entries once the round is sent. A line
   * ABSENT here takes its product's default course server-side.
   */
  #roundCourses = new WeakMap<OrderLine, string>();
  /** Same lifecycle as {@link #roundCourses}. Only ever `true`: {@link #toggleHold} DELETES the entry
   * rather than storing `false`. */
  #roundHolds = new WeakMap<OrderLine, boolean>();
  #payStore?: TabPayStore;
  /** Memoised so a render triggered by a round change does not recompute every line's gross. */
  #lineGrossByLineNo = new Map<number, Decimal>();
  /** Built with {@link products}, so each line's Change lookup is not a scan. */
  #productsByOffer?: Map<string, TillProduct>;
  #productsById = new Map<string, TillProduct>();
  /** Built with {@link groups}, so each line's Send check is not a scan. */
  #heldGroupIds?: ReadonlySet<string>;

  constructor() {
    super();
    new ContentLanguageController(this);
  }

  override willUpdate(changed: PropertyValues<this>): void {
    this.#watchRound();
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
      this.#closeChange();
      this.cancelLine = null;
    }
    if (changed.has("groups") || this.#heldGroupIds === undefined) {
      this.#heldGroupIds = heldGroupIds(this.groups);
    }
    if (changed.has("products") || this.#productsByOffer === undefined) {
      this.#productsByOffer = new Map();
      this.#productsById = new Map();
      for (const product of this.products) {
        if (product.menuItemId !== undefined && !this.#productsByOffer.has(product.menuItemId))
          this.#productsByOffer.set(product.menuItemId, product);
        if (!this.#productsById.has(product.id)) this.#productsById.set(product.id, product);
      }
    }
    if (changed.has("cancelOffer") && this.cancelOffer !== null) {
      const offered = this.lines.find(
        (line) => line.lineNo === this.cancelOffer && !this.#isChild(line),
      );
      if (offered !== undefined) this.cancelLine = offered;
      this.#offerTaken = true;
    }
  }

  /** The app clears its offer on this event, so a screen mounted later (a handheld's Order tab coming
   * back) does not open it again. Taken even when the line is gone, for the same reason. */
  override updated(): void {
    if (!this.#offerTaken) return;
    this.#offerTaken = false;
    this.dispatchEvent(
      new CustomEvent("cancel-offer-taken", { detail: {}, bubbles: true, composed: true }),
    );
  }

  #offerTaken = false;

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
   * answers name lists, products and labels by id alone: the server takes every price, VAT class and
   * name from the published offer. */
  #sendRound(): void {
    const sent = this.#roundStore.lines;
    const lines = sent.map((line) => {
      const roundLine: GroupLine = {
        ...toWireProductIdentity(line.product),
        quantity: line.quantity,
        ...toWireLineExtras(line),
        ...toWireModifiers(line),
      };
      const courseId = this.#roundCourses.get(line);
      if (courseId !== undefined) {
        roundLine.courseId = courseId;
      }
      return roundLine;
    });
    const groups = groupRound(
      sent.map((line) => ({
        courseId: this.#selectedCourseId(line) || null,
        held: this.#isHeld(line),
      })),
      this.courses,
    );
    const detail: SendRoundDetail = { lines, groups, round: this.#roundStore, sent };
    this.dispatchEvent(new CustomEvent("send-round", { detail, bubbles: true, composed: true }));
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

  #isStarted(line: TabLine): boolean {
    return line.state === "preparing" || line.state === "ready";
  }

  /** Sent and still holding a ticket item, with the venue's setting off: the server refuses to change
   * or recall it (`ticket.already_fired`), so it offers Cancel in their place. */
  #lockedBySetting(line: TabLine): boolean {
    return !this.editSentLines && line.sentAt !== null && line.state !== null;
  }

  /** The live product a Change edits against: the offer the line was sold under, else its product (a
   * variant line's parent). */
  #liveProduct(line: TabLine): TillProduct | undefined {
    const byOffer =
      line.menuItemId === null ? undefined : this.#productsByOffer?.get(line.menuItemId);
    const productId = line.parentProductId ?? line.productId;
    return byOffer ?? (productId === null ? undefined : this.#productsById.get(productId));
  }

  /** A no-route line (no ticket item) is changed whatever its `sentAt`; a line with a ticket item only
   * once it was sent, because a held line never sent keeps Send alone. */
  #canChange(line: TabLine): boolean {
    if (this.#isChild(line) || this.#isStarted(line) || this.#lockedBySetting(line)) return false;
    if (line.state !== null && line.sentAt === null) return false;
    return this.#liveProduct(line) !== undefined;
  }

  #canRecall(line: TabLine): boolean {
    return (
      !this.#isChild(line) &&
      line.firedAt !== null &&
      line.state === "queued" &&
      !this.#lockedBySetting(line)
    );
  }

  /** Every sent line with a ticket item, and a fired one: whatever else a line offers, cancelling it
   * always has a button. A held line never sent keeps Send alone. */
  #canCancel(line: TabLine): boolean {
    if (this.#isChild(line)) return false;
    const queued = line.state === "queued" && (line.firedAt !== null || line.sentAt !== null);
    return this.#isStarted(line) || queued;
  }

  /** A CHILD extras row is part of its dish and offers no action of its own. */
  #lineActions(line: TabLine): TemplateResult | typeof nothing {
    const name = this.#nameForLine(line);
    const label = (key: StringKey) => `${t(key)} · ${name}`;
    const actions: TemplateResult[] = [];
    if (sendsAlone(line, this.#heldGroupIds!))
      actions.push(
        html`<wt-button
          class="line-send"
          size="sm"
          variant="primary"
          data-send-line=${line.lineNo}
          aria-label=${label("table.send_line")}
          @click=${() => this.#sendLine(line.lineNo)}
        >
          ${t("table.send_line")}
        </wt-button>`,
      );
    if (this.#canChange(line))
      actions.push(
        html`<wt-button
          class="line-change"
          size="sm"
          variant="secondary"
          data-change-line=${line.lineNo}
          aria-label=${label("table.change_line")}
          @click=${() => this.#openChange(line)}
        >
          ${t("table.change_line")}
        </wt-button>`,
      );
    if (this.#canRecall(line))
      actions.push(
        html`<wt-button
          class="line-recall"
          size="sm"
          variant="secondary"
          data-recall-line=${line.lineNo}
          aria-label=${label("table.recall_line")}
          @click=${() => this.#recallLine(line.lineNo)}
        >
          ${t("table.recall_line")}
        </wt-button>`,
      );
    if (this.#canCancel(line))
      actions.push(
        html`<wt-button
          class="line-cancel"
          size="sm"
          variant="danger"
          data-cancel-line=${line.lineNo}
          aria-label=${label("table.cancel_line")}
          @click=${() => this.#requestCancel(line)}
        >
          ${t("table.cancel_line")}
        </wt-button>`,
      );
    return actions.length === 0 ? nothing : html`<span class="line-actions">${actions}</span>`;
  }

  /** A held group releases its lines whether or not they have a ticket item: a no-route dish in one has
   * none, and may have no Fire course button either. */
  #anyHeld(): boolean {
    const held = this.#heldGroupIds!;
    return this.lines.some((line) => sendsAlone(line, held) || inHeldGroup(line, held));
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

  /** `quantity` absent cancels the whole line. */
  #confirmCancel(quantity?: string): void {
    const line = this.cancelLine;
    if (line === null) return;
    this.cancelLine = null;
    this.dispatchEvent(
      new CustomEvent("void-line", {
        detail:
          quantity === undefined ? { lineNo: line.lineNo } : { lineNo: line.lineNo, quantity },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #dismissCancel(): void {
    this.cancelLine = null;
  }

  /** A line sold by the unit and holding more than one can be cancelled one at a time; a weighed
   * line cancels whole. */
  #cancelsOneAtATime(line: TabLine): boolean {
    return line.unitPrecision === 0 && compareDecimal(decimal(line.quantity), decimal("1")) > 0;
  }

  /** Always present, driven by {@link cancelLine}, so an Escape close flows back through `wt-close` into
   * the state rather than fighting the `.open` binding. */
  #cancelDialog(): TemplateResult {
    const line = this.cancelLine;
    const started = line !== null && this.#isStarted(line);
    const oneAtATime = line !== null && this.#cancelsOneAtATime(line);
    return html`<wt-dialog
      class="cancel-confirm"
      .open=${line !== null}
      .heading=${t("table.cancel_title")}
      @wt-close=${() => this.#dismissCancel()}
    >
      <p class="cancel-body">
        ${started ? t("table.cancel_started") : t("table.cancel_sent")}
        ${
          line !== null
            ? html`<span class="cancel-dish"
                >${this.#nameForLine(line)} ×${this.#displayQty(line.quantity)}</span
              >`
            : nothing
        }
      </p>
      ${
        oneAtATime
          ? html`<p class="cancel-how-many">
              ${t("table.cancel_one_of").replace("{n}", this.#displayQty(line.quantity))}
            </p>`
          : nothing
      }
      <div slot="footer" class="cancel-actions">
        <wt-button
          class="cancel-keep"
          variant="secondary"
          data-cancel-dismiss
          @click=${() => this.#dismissCancel()}
        >
          ${t("table.cancel_keep")}
        </wt-button>
        ${
          oneAtATime
            ? html`<wt-button
                class="cancel-one"
                variant="danger"
                data-cancel-one
                @click=${() => this.#confirmCancel("1")}
              >
                ${t("table.cancel_one")}
              </wt-button>`
            : nothing
        }
        <wt-button
          class="cancel-do"
          variant="danger"
          data-cancel-confirm
          @click=${() => this.#confirmCancel()}
        >
          ${
            oneAtATime
              ? t("table.cancel_all")
              : started
                ? t("table.cancel_confirm")
                : t("table.cancel_do")
          }
        </wt-button>
      </div>
    </wt-dialog>`;
  }

  #openChange(line: TabLine): void {
    const live = this.#liveProduct(line)!;
    const offered = live.offeredModifiers ?? [];
    const sendsExtras = offered.some((entry) => entry.kind === "extras");
    const extras: SelectedExtra[] = [];
    for (const child of this.lines.filter((row) => row.parentLineNo === line.lineNo)) {
      const held = {
        productId: child.productId,
        listId: child.listId,
        name: this.#nameForLine(child),
        price: child.unitPriceGross,
        quantity: perDishOptionQuantity(child.quantity, line.quantity),
      };
      const [kept] = deriveExtraSelections(offered, [held]).extras;
      // A pick no offered list carries still stands on the line. When the edit sends extras it would
      // drop it, so it goes in as a stale pick, which the picker names and keeps Save shut on.
      if (kept !== undefined) extras.push(kept);
      else if (sendsExtras)
        extras.push({ ...held, listId: held.listId ?? "", productId: held.productId ?? "" });
    }
    this.#changeProduct = {
      ...live,
      name: this.#nameForLine(line),
      unitPrice: line.unitPriceGross,
      // An edit cannot move a line to another variant.
      variants: [],
    };
    this.#changeSelection = {
      extras,
      options: deriveOptionSelections(offered, line.optionSnapshots).options,
      ...(line.note === null ? {} : { note: line.note }),
    };
    this.#changeRevision = this.revision;
    this.changeLine = line;
  }

  #closeChange(): void {
    this.changeLine = null;
    this.#changeProduct = undefined;
    this.#changeSelection = undefined;
  }

  /** `options` and `extras` go only when the dish offers a list of that kind: either, sent, replaces the
   * line's whole set, so an absent one keeps what the line holds. `options` goes only when the answers
   * differ from those the editor opened with: the editor holds no answer to a list the dish no longer
   * offers, so sending an unchanged set would drop that answer. */
  #confirmChange(detail: ModifierConfirmDetail): void {
    const line = this.changeLine!;
    const offered = this.#changeProduct!.offeredModifiers ?? [];
    const opened = this.#changeSelection!.options ?? [];
    this.#closeChange();
    const patch: OrderLinePatch = { note: detail.note ?? null };
    const options = detail.options ?? [];
    if (offered.some((entry) => entry.kind === "options") && !sameOptionSelections(options, opened))
      patch.options = options;
    if (offered.some((entry) => entry.kind === "extras"))
      patch.extras = toWireModifiers({ extras: detail.extras }).extras ?? [];
    const change: ChangeLineDetail = {
      lineNo: line.lineNo,
      lineName: this.#nameForLine(line),
      patch,
      revision: this.#changeRevision,
    };
    this.dispatchEvent(
      new CustomEvent("change-line", { detail: change, bubbles: true, composed: true }),
    );
  }

  #changeEditor(): TemplateResult | typeof nothing {
    const line = this.changeLine;
    if (line === null) return nothing;
    return html`<till-modifier-picker
      class="change-editor"
      withNote
      .product=${this.#changeProduct}
      .quantity=${this.#displayQty(line.quantity)}
      .initialSelections=${this.#changeSelection}
      @wt-modifier-confirm=${(event: CustomEvent<ModifierConfirmDetail>) => {
        event.stopPropagation();
        this.#confirmChange(event.detail);
      }}
      @wt-modifier-cancel=${(event: Event) => {
        event.stopPropagation();
        this.#closeChange();
      }}
    ></till-modifier-picker>`;
  }

  /** Falls back to the raw id for a course DEACTIVATED since the line was rung — never blank. */
  #courseName(courseId: string | null): string {
    if (courseId === null) return t("table.course_none");
    return this.courses.find((course) => course.id === courseId)?.name ?? courseId;
  }

  #courseValue(value: string): string | null {
    return value === "" ? null : value;
  }

  /** A FIRED line shows its course READ-ONLY: the server refuses to move it (`ticket.already_fired`). A
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

  readonly #browserProducts = memoVisibleProducts();

  #hasDietData(): boolean {
    return hasDietData(this.products);
  }

  /** Only the shown menu's products reach the browser; a tab line's name still resolves against the
   * FULL set ({@link #nameFor}), so a filtered grid never blanks a line. */
  #menuBrowser(): TemplateResult {
    const menu = shownMenu(this.menus, this.selectedMenuId);
    return html`<till-menu-browser
      class="round-control"
      ?inert=${this.#roundStore.sending}
      .menu=${menu}
      .products=${this.#browserProducts(this.products, menu?.id ?? "", this.selectedDiet)}
      .store=${this.#roundStore}
      .columns=${this.handheld ? HANDHELD_COLUMNS : TILL_COLUMNS}
    ></till-menu-browser>`;
  }

  /** `stopPropagation` keeps the inner `confirm-payment` from reaching the app's counter
   * `#onConfirmPayment`, which would save and pay the counter basket instead of the tab. */
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
            ${keyed(this.orderId, this.#menuBrowser())}
          </div>
          ${this.drawerOpen ? this.#drawer(pending) : nothing}
        </div>
        ${
          this.#roundStore.sending
            ? html`<p class="round-sending" role="status" data-round-sending>
                ${t("table.round_sending")}
              </p>`
            : nothing
        }
        <div class="round-control" data-round-controls ?inert=${this.#roundStore.sending}>
          ${this.#roundCoursesSection()}
          <div class="round-bar">
            ${keyed(this.orderId, html`<till-basket .store=${this.#roundStore}></till-basket>`)}
            <wt-button
              class="send-round"
              data-send-round
              variant="primary"
              size="lg"
              ?disabled=${this.#roundStore.lineCount === 0 || this.#roundStore.sending}
              @click=${() => this.#sendRound()}
            >
              ${t("table.send_round")}
            </wt-button>
          </div>
        </div>
        ${this.#cancelDialog()} ${this.#changeEditor()}
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
          this.canSettle && this.#chargeable()
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
        ${this.#billsSection()} ${this.#statusSection()} ${this.#actionSection()}
      </aside>
    `;
  }

  /** The bill on screen can take a payment unless the party's bills say it is no longer open. */
  #chargeable(): boolean {
    const shown = this.bills.find((bill) => bill.workingOrderId === this.orderId);
    return shown === undefined || shown.status === "open";
  }

  /** Abandoned bills are left out: nobody pays them. */
  #shownBills(): VisitBill[] {
    return this.bills.filter((bill) => bill.status !== "abandoned");
  }

  #money(amount: string): string {
    return formatMoney(decimal(amount), currentLocale());
  }

  #billsSection(): TemplateResult | typeof nothing {
    if (this.visit === null) return nothing;
    const bills = this.#shownBills();
    const unpaid = bills.filter((bill) => bill.status === "open");
    // Another bill first: the one on screen is charged from the section above.
    const firstUnpaid = unpaid.find((bill) => bill.workingOrderId !== this.orderId) ?? unpaid[0];
    return html`<section class="bills" data-bills>
      <h2>${t("table.bills_title")}</h2>
      <ul>
        ${bills.map((bill, index) => this.#billRow(bill, index))}
      </ul>
      <div class="total-row">
        <span class="label">${t("table.still_to_pay")}</span>
        <span class="amount" data-visit-outstanding>${this.#money(this.visit.outstanding)}</span>
      </div>
      ${
        this.finishRefused
          ? html`<div class="finish-refusal" role="alert" data-finish-refusal>
              <span>${codeMessage("visit.bill_outstanding")}</span>
              ${
                firstUnpaid === undefined
                  ? nothing
                  : html`<wt-button
                      size="sm"
                      variant="primary"
                      data-take-payment
                      @click=${() => this.#takePayment(firstUnpaid)}
                    >
                      ${t("table.take_payment")}
                    </wt-button>`
              }
            </div>`
          : nothing
      }
      <div class="finish">
        <wt-button
          variant="secondary"
          data-finish-table
          @click=${() => this.#dispatch("finish-table", {})}
        >
          ${t("table.finish")}
        </wt-button>
      </div>
    </section>`;
  }

  #billRow(bill: VisitBill, index: number): TemplateResult {
    const shown = bill.workingOrderId === this.orderId;
    const paid = bill.status === "settled";
    return html`<li
      class="bill"
      data-bill=${bill.workingOrderId}
      aria-current=${shown ? "true" : nothing}
    >
      <span class="bill-name"
        >${bill.label ?? t("table.bill_n").replace("{n}", String(index + 1))}</span
      >
      <span class="bill-total" data-bill-total>${this.#money(bill.total)}</span>
      <span class="bill-state" data-bill-state
        >${paid ? t("table.bill_paid") : t("table.bill_to_pay").replace("{amount}", () => this.#money(bill.outstanding))}</span
      >
      <span class="bill-actions">
        ${
          paid && bill.receiptAvailable
            ? html`<wt-button
                size="sm"
                variant="secondary"
                data-bill-receipt
                @click=${() => this.#dispatch("reprint-bill", { workingOrderId: bill.workingOrderId })}
              >
                ${t("table.bill_receipt")}
              </wt-button>`
            : nothing
        }
        ${
          bill.status === "open" && !shown
            ? html`<wt-button
                size="sm"
                variant="secondary"
                data-take-payment
                @click=${() => this.#takePayment(bill)}
              >
                ${t("table.take_payment")}
              </wt-button>`
            : nothing
        }
      </span>
    </li>`;
  }

  #takePayment(bill: VisitBill): void {
    this.#dispatch("take-payment", { workingOrderId: bill.workingOrderId });
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

  #lineNote(line: TabLine): TemplateResult | typeof nothing {
    return line.note === null
      ? nothing
      : html`<span class="line-note">${t("line.note.label")}: ${line.note}</span>`;
  }

  #pendingLine(line: TabLine): TemplateResult {
    const name = this.#nameForLine(line);
    return html`<li class="line pending-line${this.#isChild(line) ? " child-line" : ""}">
      <span class="name"
        >${name}${optionAnswers(line.optionSnapshots, { reads: "staff" }).map((answer) => html`<span class="modifier-answer">${answer}</span>`)}${this.#lineNote(line)}</span
      >
      <span class="qty">${this.#displayQty(line.quantity)}</span>
      <span class="line-total">${formatMoney(this.#lineGross(line), currentLocale())}</span>
      ${this.#lineCourse(line)}
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
      ${this.#lineActions(line)}
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
                      >${this.#nameForLine(line)}${optionAnswers(line.optionSnapshots, { reads: "staff" }).map((answer) => html`<span class="modifier-answer">${answer}</span>`)}${this.#lineNote(line)}</span
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
