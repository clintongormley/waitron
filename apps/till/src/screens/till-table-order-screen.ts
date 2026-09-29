import { optionAnswers } from "../widgets/option-snapshot.js";
import { ContentLanguageController } from "@waitron/ui";
import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { trackDialog } from "../widgets/track-dialog.js";
import { keyed } from "lit/directives/keyed.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles, focusFirstInvalid } from "@waitron/ui";
import "../widgets/fired-ago.js";
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
import { clockTime, countText, currentLocale, named, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import { selectStyles } from "../select-styles.js";
import { type DietPredicate, hasDietData, memoVisibleProducts, shownMenu } from "../menu-filter.js";
import { lineProductName, productName, soldByTheUnit } from "../widgets/product-name.js";
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
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "../widgets/menu-switcher.js";
import "../widgets/diet-filter.js";
import "../widgets/modifier-picker.js";
import "../widgets/bill-choice-dialog.js";
import {
  moveBillScope,
  partyScope,
  partyTablesLabel,
  seatedRead,
  tableTarget,
  tableTargetStyles,
  type SeatedRead,
} from "../widgets/table-targets.js";
import { owing, paidInPart } from "../state/bill-state.js";
import { delayUntil, reminderDueAt } from "../state/release-reminder.js";
import "../widgets/party-name-dialog.js";
import type { BillChoiceDetail } from "../widgets/bill-choice-dialog.js";
import type { PartyNameDetail } from "../widgets/party-name-dialog.js";
import type { ModifierConfirmDetail } from "../widgets/modifier-picker.js";
import type {
  CurrentOrderGroup,
  CurrentOrderRow,
  CurrentOrders,
  GroupLine,
  OrderGroup,
  OrderLinePatch,
  PrintProblem,
  TabLine,
  TableServiceStatus,
  TableState,
  TableParty,
  TabTransfer,
  TillCourse,
  TillProduct,
  TillZoneMenu,
  PartyBill,
} from "../api/client.js";
import type { ConfirmPaymentDetail } from "../widgets/tender-pay.js";
import type { FireControlMode } from "../widgets/station-queue.js";
import { heldGroupIds, inHeldGroup, sendsAlone } from "../state/held-groups.js";
import {
  draftPreview,
  draftSections,
  draftSubmission,
  itemCount,
  type DraftAction,
  type DraftEntry,
  type DraftGroup,
  type DraftPreview,
} from "../state/draft-groups.js";
import { segmentedOptionStyles } from "../widgets/segmented-control-styles.js";

export type { TableServiceStatus };

/** The screen's own width, in CSS pixels, from which browsing and the draft show side by side.
 * Narrower, the draft opens on its own Review view. */
export const DRAFT_SIDE_BY_SIDE_MIN_WIDTH = 720;

/**
 * `submit-draft`: the groups a confirmed preview named, each naming its lines by their place in
 * `lines`. The draft stays in `store` until the app has the server's answer: the `sent` lines (the
 * ones `lines` was built from, in order) leave it once they are added, and a refused submission is
 * kept (D9). `joinGroupId` adds the one held group's lines to that existing group. `billId` names
 * the bill the person chose under Send to; it is absent when they chose none, or chose a new bill,
 * and the server then puts the lines on the party's main bill, making one when there is none.
 */
export interface SubmitDraftDetail {
  lines: GroupLine[];
  groups: DraftGroup[];
  joinGroupId?: string;
  billId?: string;
  store: WorkingOrderStore;
  sent: readonly OrderLine[];
  draft: Draft;
}

/** One draft, from its first line until its store is empty again, through its partial submissions.
 * `laterAddition`: the party already had a group when the draft got its first line. `tally`: the
 * groups its submissions have filed so far, which the app counts. */
export interface Draft {
  readonly laterAddition: boolean;
  readonly tally: { fired: number; held: number; joined: number };
}

/** Another person's open draft on the party, shown read-only. `takenFromYou`: its latest take-over
 * was from the signed-in person, so it is headed by who holds it now. */
export interface OtherDraft {
  id: string;
  revision: number;
  ownerName: string;
  takenFromYou: boolean;
  lines: readonly OrderLine[];
}

/** `take-over-draft`: another person's draft, at the revision the screen showed, the person
 * confirmed taking over. */
export interface TakeOverDraftDetail {
  draftId: string;
  revision: number;
}

/** A dish the table's offers no longer hold has no name to show, so it reads as not offered. */
function shownName(product: TillProduct): string {
  return lineProductName(product) || t("basket.not_offered");
}

/** A draft line no action sends: the till's own check, the server's last answer, or a dish the
 * table's offers no longer hold says it cannot be sold now. */
function flagged(line: OrderLine): boolean {
  return (
    line.blocked !== undefined || line.unavailableOnServer === true || line.notOffered === true
  );
}

/** A dish no longer offered has no unit to read, so a whole quantity is counted as whole units. */
function countsWholeUnits(line: OrderLine): boolean {
  return soldByTheUnit(line.product) || (line.notOffered === true && /^\d+$/.test(line.quantity));
}

/** How many lines an action leaves in the draft, naming them when there are only a few. */
function leftOutText(lines: readonly OrderLine[]): string {
  if (lines.length > LEFT_OUT_NAMED)
    return t("table.left_out_unnamed").replace("{n}", String(lines.length));
  const names = lines
    .map((line) => `${shownName(line.product)}\u00a0×${trimQuantity(line.quantity)}`)
    .join(", ");
  return countText(lines.length, "table.left_out", "table.left_out_one").replace(
    "{names}",
    () => names,
  );
}

/** Beyond this many, the left-out message counts the lines without naming them. */
const LEFT_OUT_NAMED = 3;

/** Where a later addition goes: `add-to-held` is offered only while the party has a held group. */
type Destination = "fire-now" | "add-to-held" | "add-as-new";

/** The table actions that name a table: Move guests, Join a table and Move this bill. */
type TableVerb = "move" | "join" | "move-bill";
type ActionVerb = TableVerb | "merge" | "transfer" | "split";

/** Move this bill's choice: to a table, with who the picker showed seated there, or to the counter. */
export interface MoveBillDetail {
  to: { tableId: string; seated: SeatedRead } | { counter: true };
  bills: BillChoiceDetail["bills"];
}

/** An action's preview, and the submission its Confirm sends. `leftOut`: the flagged lines it
 * leaves in the draft. */
interface PendingDraft {
  preview: DraftPreview;
  join?: { group: OrderGroup; index: number };
  detail: SubmitDraftDetail;
  leftOut: readonly OrderLine[];
}

/** A held row whose Move to… is open, on whichever bill of the party it sits. */
interface MovePending {
  lineId: string;
  name: string;
  quantity: string;
  group: OrderGroup;
}

/** What a group's row offers while its group is held: Move always, Split only for `splits`. */
interface HeldRow {
  lineId: string;
  name: string;
  quantity: string;
  splits: boolean;
}

/** The element `node` renders inside: its slot, its parent, or the host of its shadow root. */
function composedParent(node: Element): Element | null {
  const root = node.getRootNode();
  return node.assignedSlot ?? node.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
}

/** A held group as the picker names it: `index` is its place among the party's held groups. */
function heldGroupLabel(group: OrderGroup, index: number): string {
  return index === 0
    ? t("table.held_next").replace("{summary}", () => group.summary)
    : t("table.held_group")
        .replace("{n}", String(group.position))
        .replace("{summary}", () => group.summary);
}

/** `fire-group`: a held group the waiter confirmed firing. */
export interface FireGroupDetail {
  groupId: string;
}

/** `reorder-groups`: every held group of the party, in the order they are to go. */
export interface ReorderGroupsDetail {
  heldGroupIds: string[];
}

/** `move-group-line`: a whole held line into another held group, or a new one at the end. */
export interface MoveGroupLineDetail {
  lineId: string;
  quantity: string;
  target: { groupId: string } | "new";
}

/** `split-group-line`: a held line of `quantity` units, to be made one row per unit in its group. */
export interface SplitGroupLineDetail {
  lineId: string;
  groupId: string;
  quantity: string;
}

/** `serve-lines` and `unserve-lines`: how much of each of the party's rows this press marks served,
 * or takes back. */
export interface ServeLinesDetail {
  items: { lineId: string; quantity: string }[];
}

/** `serve-group`: every row of a fired group, marked served. */
export interface ServeGroupDetail {
  groupId: string;
}

/** `snooze-group`: the waiting group's release reminder, put off by `minutes`. */
export interface SnoozeGroupDetail {
  groupId: string;
  minutes: number;
}

/** `unsnooze-group`: the waiting group's snooze cleared, so its reminder falls due at its own time. */
export interface UnsnoozeGroupDetail {
  groupId: string;
}

/** How far one press of Snooze puts a release reminder off. */
export const SNOOZE_MINUTES = 5;

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
 * The TILL table-ordering screen: one open table's tab. The draft bar holds the CURRENT draft only,
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
    tableTargetStyles,
    css`
      :host {
        display: block;
      }

      .width-probe {
        height: 0;
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

      /* Words first, so the problem never rests on the warning colour. */
      .print-problem {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2) var(--wt-space-3);
        padding: var(--wt-space-2) var(--wt-space-3);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-warning);
        color: var(--wt-color-on-warning);
      }

      .print-problem-text {
        flex: 1 1 auto;
        margin: 0;
        overflow-wrap: anywhere;
      }

      .print-problem-title,
      .print-problem-line {
        display: block;
      }

      .print-problem-title {
        font-weight: var(--wt-font-weight-bold);
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
        /* A line's first row: name, qty, line-total and #lineCourse (nothing when the venue has no
           courses; its track then collapses). */
        grid-template-columns: 1fr auto auto auto;
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

      .bill-main {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .send-to {
        margin: var(--wt-space-3) 0 0;
        padding: 0;
        border: none;
      }

      .send-to legend {
        padding: 0;
        margin-bottom: var(--wt-space-2);
        font-weight: var(--wt-font-weight-bold);
      }

      .send-to-option {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        cursor: pointer;
        overflow-wrap: anywhere;
      }

      .send-to-option input {
        flex: none;
        accent-color: var(--wt-color-primary);
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

      .draft-sections {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
        padding-top: var(--wt-space-3);
        border-top: 1px solid var(--wt-color-border);
      }

      .draft-section {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }

      .draft-section-name {
        margin: 0;
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
      }

      /* A native button, not a wt-button: wt-button does not pass aria-pressed to its inner button. */
      .draft-select {
        min-width: var(--wt-tap-min);
        text-align: start;
      }

      .draft-line-name {
        overflow-wrap: anywhere;
      }

      .draft-bar {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        flex: 0 1 auto;
        min-width: 0;
      }

      .draft-actions,
      .destination {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }

      .group-list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }

      .group {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        padding-bottom: var(--wt-space-3);
        border-bottom: 1px solid var(--wt-color-border);
      }

      .group-head,
      .group-line {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2);
      }

      .group-name {
        font-weight: var(--wt-font-weight-bold);
      }

      .group[data-group-state="fired"] {
        color: var(--wt-color-text-muted);
      }

      .group-state,
      .group-summary {
        margin: 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .group-actions,
      .group-line-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--wt-space-2);
      }

      .group-line-name {
        overflow-wrap: anywhere;
      }

      .group-sent {
        margin-inline-end: auto;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      /* Stays at the trailing edge when it wraps below the name. */
      .group-head .group-state {
        margin-inline-start: auto;
      }

      .ungrouped {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        padding-top: var(--wt-space-3);
      }

      .ungrouped h3 {
        margin: 0;
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
      }

      /* A name is never broken to fit the buttons beside it: they wrap to a line of their own,
         still at the row's end. */
      .row-what {
        flex: 1 1 auto;
        max-width: 100%;
        display: flex;
        flex-direction: column;
      }

      .row-what .group-line-name {
        overflow-wrap: break-word;
      }

      .current-row .group-line-actions {
        margin-inline-start: auto;
      }

      .row-extra,
      .current-row .line-note,
      .row-facts {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .row-facts {
        display: flex;
        flex-wrap: wrap;
        column-gap: var(--wt-space-3);
      }

      /* Words first, so the reminder never rests on the warning colour. */
      .group-reminder {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2);
        margin: 0;
        font-size: var(--wt-font-size-sm);
      }

      .group-reminder > .group-actions {
        margin-inline-start: auto;
      }

      .group-reminder.due {
        padding: var(--wt-space-2) var(--wt-space-3);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-warning);
        color: var(--wt-color-on-warning);
        font-weight: var(--wt-font-weight-bold);
      }

      .round-bar {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }

      .draft-line-tools {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: var(--wt-space-2);
        padding-bottom: var(--wt-space-2);
      }

      .flag-choice {
        display: flex;
        gap: var(--wt-space-2);
      }

      .flag-kept {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .ordering {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
      }

      .ordering.side-by-side {
        flex-direction: row;
        align-items: flex-start;
      }

      .browsing {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
        min-width: 0;
      }

      .side-by-side .browsing {
        flex: 3 1 0;
      }

      .draft-pane {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
        min-width: 0;
      }

      .side-by-side .draft-pane {
        flex: 2 1 0;
        padding-inline-start: var(--wt-space-4);
        border-inline-start: 1px solid var(--wt-color-border);
      }

      .browsing[hidden],
      .draft-pane[hidden] {
        display: none;
      }

      .draft-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
      }

      .draft-title {
        margin: 0;
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }

      /* Kept in view at the bottom while the menu scrolls, clear of the column the till's floating
         language button takes at the bottom right: a tap target and two gaps wide. */
      .bottom-bar {
        position: sticky;
        bottom: 0;
        z-index: 1;
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        padding-block: var(--wt-space-2);
        padding-inline-end: calc(var(--wt-tap-min) + 2 * var(--wt-space-3));
        background: var(--wt-color-bg);
      }

      .last-added {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }

      .last-added-line {
        margin: 0;
        min-width: 0;
        overflow-wrap: anywhere;
      }

      .last-added-name {
        font-weight: var(--wt-font-weight-bold);
      }

      .other-draft {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--wt-space-2);
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }

      .other-draft-title {
        margin: 0;
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
      }

      .other-draft-lines {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        margin: 0;
        padding: 0;
        list-style: none;
        overflow-wrap: anywhere;
      }

      .other-draft-name {
        font-weight: var(--wt-font-weight-bold);
      }

      .last-added-steps {
        display: flex;
        flex: 0 0 auto;
        gap: var(--wt-space-2);
      }

      .review-open {
        align-self: stretch;
      }

      /* A draft being sent takes no edit until the answer comes back; the status line says why. */
      .round-control[inert] {
        opacity: var(--wt-opacity-disabled);
      }

      .round-sending {
        margin: 0;
        padding-top: var(--wt-space-3);
        color: var(--wt-color-text-muted);
        font-weight: var(--wt-font-weight-bold);
      }

      /* A draft line's name may wrap inside a word, so on a narrow screen the line's controls and its
         remove button stay on screen. */
      .round-bar till-basket::part(name) {
        overflow-wrap: anywhere;
      }
    `,
    segmentedOptionStyles,
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
  /** The party's Current orders; null until read, or when the read failed, which leaves the groups
   * showing this bill's rows and nothing to mark served. */
  @property({ attribute: false }) currentOrders: CurrentOrders | null = null;
  /** The read of Current orders failed, which the screen says where the list would be. */
  @property({ type: Boolean }) currentOrdersUnread = false;
  /** The party's kitchen tickets that have not printed; they never hold up ordering. */
  @property({ attribute: false }) printProblems: PrintProblem[] = [];
  /** The bills whose kitchen tickets were sent to print again since the table was opened: their
   * problems say so and offer no second Reprint. */
  @property({ attribute: false }) reprintSent: string[] = [];
  /** Injectable clock for a fired group's age; unset reads the ticking clock. */
  @property({ attribute: false }) now?: number;
  @property() fireControl: FireControlMode = "waiter";
  @property() orderId?: string;
  /** The visible half of the app's single-flight fiscal guard. */
  @property({ type: Boolean }) busy = false;
  /** `false` hides the pay section. The server accepts a handheld's cash or manual-card tender on
   * `/api/sales` and fences only the integrated reader (`/api/pay`). */
  @property({ type: Boolean }) canSettle = true;
  /** Mounted inside a card host, which supplies the header; the drawer handle and its badge stay. */
  @property({ type: Boolean }) embedded = false;
  /** The move and join target lists read this; merge and transfer offer {@link bills}. */
  @property({ attribute: false }) tables: TableState[] = [];
  /** The party seated at this table, or null for a tab that belongs to none. */
  @property({ attribute: false }) party: TableParty | null = null;
  /** Every bill of {@link party}, merged parties' included. */
  @property({ attribute: false }) bills: PartyBill[] = [];
  /** Finish table was refused because a bill is unpaid. */
  @property({ type: Boolean }) finishRefused = false;
  /** The app's answer to a name the server refused: the name sent, and why, shown beside the field. */
  @property({ attribute: false }) nameRefusal: { name: string; message: string } | null = null;
  /** A handheld form factor, whose menu browser shows fewer columns. */
  @property({ type: Boolean }) handheld = false;
  /** The visible half of the app's guard against a second group command while one runs. */
  @property({ type: Boolean }) groupCommandBusy = false;

  @state() private drawerOpen = false;
  /** The screen is at least {@link DRAFT_SIDE_BY_SIDE_MIN_WIDTH} wide. */
  @state() private wide = false;
  /** Below that width, the draft is open on its Review view in place of browsing. */
  @state() private reviewing = false;
  #resizing?: ResizeObserver;
  /** Where browsing was scrolled when Review opened, put back on Back. */
  #browsingScroll?: { scroller: Element; top: number };

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

  /** The held group whose Fire waits for confirmation. */
  @state() private fireGroupPending: OrderGroup | null = null;
  /** The held line whose Move to… picker is open, with the group it is in. */
  @state() private movePending: MovePending | null = null;
  /** A row whose Mark served, or its undo, asks how many; `count` is what is chosen so far. */
  @state() private servePending: { row: CurrentOrderRow; undo: boolean; count: Decimal } | null =
    null;

  /** The line open in the Change editor. */
  @state() private changeLine: TabLine | null = null;
  /** Built once when the editor opens, not per render: the picker seeds from these once. */
  #changeProduct?: TillProduct;
  #changeSelection?: LineSelection;
  #changeRevision = 0;

  @state() private actionStep:
    | "closed"
    | "menu"
    | "pick"
    | "transfer-lines"
    | "split-lines"
    | "split-table"
    | "split-table-bill" = "closed";
  @state() private actionVerb: ActionVerb | null = null;
  /** The table Split a table takes away, once chosen. */
  @state() private splitTableId: string | null = null;
  /** A move or join to a table another party holds, waiting for the bill choice. */
  @state() private billChoice: { verb: TableVerb; table: TableState } | null = null;
  /** The party-name dialog, while open: the name it starts from and a refusal beside the field. */
  @state() private naming: { value: string; refusal: string } | null = null;
  @state() private transferToBillId: string | null = null;
  /** A NEW Set is assigned on every mutation so Lit re-renders (a Set is not deeply reactive). */
  @state() private transferLineNos = new Set<number>();
  /** Kept separate from the whole-line transfer picker so quantity choices cannot change that flow. */
  @state() private splitQuantities = new Map<number, string>();
  @state() private splitAttempted = false;

  /** The party's draft for the signed-in person, owned by the app; null until the app has read it and
   * the party's groups. Unset, the screen keeps a draft of its own. */
  @property({ attribute: false }) draftStore?: WorkingOrderStore | null;

  readonly #ownDraft = new WorkingOrderStore();

  /** The other people's open drafts on the party, oldest first. */
  @property({ attribute: false }) otherDrafts: readonly OtherDraft[] = [];
  /** Moved on by the app each time a take-over it was asked for has answered, or failed. */
  @property({ attribute: false }) takeOversAnswered = 0;
  /** The draft whose take-over has just answered, until its dialog has closed. */
  #takeOverAnswered?: string;
  /** The draft whose take-over is being asked about. */
  @state() private takeOverPending: OtherDraft | null = null;
  /** {@link takeOversAnswered} when a take-over was sent; unset while none is out. */
  @state() private takeOverSent: number | null = null;

  get #draftStore(): WorkingOrderStore | null {
    return this.draftStore === undefined ? this.#ownDraft : this.draftStore;
  }

  /** The draft this screen re-renders on. */
  #watchedDraft?: { store: WorkingOrderStore | null; stop: () => void };
  /** The last draft shown. A later addition's destination belongs to it, so it survives an order
   * that shows no draft for a moment, as while the app follows the party onto its next bill. */
  #shownDraft?: WorkingOrderStore;

  #watchDraft(): void {
    const store = this.#draftStore;
    if (this.#watchedDraft !== undefined && this.#watchedDraft.store === store) return;
    this.#watchedDraft?.stop();
    if (store !== null && store !== this.#shownDraft) {
      if (this.#shownDraft !== undefined) this.#resetDestination();
      this.#shownDraft = store;
    }
    if (store === null) {
      this.#watchedDraft = { store, stop: () => {} };
      return;
    }
    this.#noteDraftStart(store);
    this.#watchedDraft = {
      store,
      stop: store.subscribe(() => {
        this.#noteDraftStart(store);
        this.requestUpdate();
      }),
    };
  }

  readonly #drafts = new WeakMap<WorkingOrderStore, Draft>();

  #draftOf(store: WorkingOrderStore): Draft {
    let draft = this.#drafts.get(store);
    if (draft === undefined) {
      draft = { laterAddition: this.groups.length > 0, tally: { fired: 0, held: 0, joined: 0 } };
      this.#drafts.set(store, draft);
    }
    return draft;
  }

  #noteDraftStart(store: WorkingOrderStore): void {
    if (store.lineCount === 0) {
      this.#drafts.delete(store);
      this.#resetDestination();
    } else {
      this.#draftOf(store);
    }
  }

  #resetDestination(): void {
    this.destination = "fire-now";
    this.joinTarget = null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#watchDraft();
    this.#measure(this.getBoundingClientRect().width);
    if (this.hasUpdated) {
      this.#observeWidth();
      // Its reminder's timer stopped while it was off the page; a time already past fires at once.
      this.#watchReminder();
    }
  }

  override firstUpdated(): void {
    this.#observeWidth();
  }

  /** Watches a line of no height across the screen, not the screen itself: re-rendering for a new
   * width changes the screen's height, which a watch on the screen would report again in the same
   * frame. */
  #observeWidth(): void {
    this.#resizing = new ResizeObserver((entries) => {
      this.#measure(entries.at(-1)!.contentRect.width);
    });
    this.#resizing.observe(this.renderRoot.querySelector(".width-probe")!);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#watchedDraft?.stop();
    this.#watchedDraft = undefined;
    this.#resizing?.disconnect();
    this.#resizing = undefined;
    clearTimeout(this.#reminderTimer);
  }

  /** Side by side has no Review view, so one left open is closed rather than kept for a later
   * narrowing. */
  #measure(width: number): void {
    this.wide = width >= DRAFT_SIDE_BY_SIDE_MIN_WIDTH;
    if (this.wide && this.reviewing) void this.#closeReview();
  }
  /** The draft lines the waiter checked, by the line's object identity, which a store keeps until the
   * line leaves it. */
  #selected = new WeakSet<OrderLine>();
  /** Flagged lines the person chose to keep, which no longer ask Remove or Keep. */
  #kept = new WeakSet<OrderLine>();
  @state() private destination: Destination = "fire-now";
  /** The held group Add to held group joins; the first held group when unset or gone. */
  @state() private joinTarget: string | null = null;
  @state() private pendingDraft: PendingDraft | null = null;
  /** The bill the waiter chose in the open preview, under the name it had then; null sends no
   * bill, so the lines go on the party's main bill as the server finds it when it takes the
   * request. */
  @state() private sendTo: { value: string; label: string } | null = null;
  #payStore?: TabPayStore;
  /** Memoised so a render triggered by a draft change does not recompute every line's gross. */
  #lineGrossByLineNo = new Map<number, Decimal>();
  /** Built with {@link products}, so each line's Change lookup is not a scan. */
  #productsByOffer?: Map<string, TillProduct>;
  #productsById = new Map<string, TillProduct>();
  /** Built with {@link groups}, so each line's Send check is not a scan. */
  #heldGroupIds?: ReadonlySet<string>;
  /** The party's bill on screen, when {@link bills} lists it. */
  #shownBill: PartyBill | undefined;
  /** Built with {@link groups}: every group, and the held ones, in position order. */
  #groupsInOrder: OrderGroup[] = [];
  #heldInOrder: OrderGroup[] = [];
  /** Built with {@link lines}, for the held-groups list. */
  #lineById = new Map<string, TabLine>();
  #dishesWithExtras = new Set<number>();

  constructor() {
    super();
    new ContentLanguageController(this);
  }

  override willUpdate(changed: PropertyValues<this>): void {
    this.#watchDraft();
    if (this.takeOverSent !== null && this.takeOversAnswered !== this.takeOverSent) {
      this.#takeOverAnswered = this.takeOverPending?.id;
      this.takeOverSent = null;
      this.takeOverPending = null;
    }
    // The gross map is filled BEFORE `#tabTotal` sums it below.
    if (changed.has("lines") || this.#payStore === undefined) {
      this.#lineGrossByLineNo = new Map(
        this.lines.map((line) => [line.lineNo, grossOf(line.unitPriceGross, line.quantity)]),
      );
      this.#payStore = new TabPayStore(this.#tabTotal(), this.lines.length);
      this.#lineById = new Map(this.lines.map((line) => [line.id, line]));
      this.#dishesWithExtras = new Set(this.lines.flatMap((line) => line.parentLineNo ?? []));
    }
    // A tab switch must not carry a half-open action flow across: its targets belong to the OLD tab.
    if (changed.has("orderId") && changed.get("orderId") !== undefined) {
      this.#closeActions();
      this.#closeChange();
      this.cancelLine = null;
      this.fireGroupPending = null;
      this.movePending = null;
      this.servePending = null;
      this.pendingDraft = null;
      this.reviewing = false;
      this.#browsingScroll = undefined;
    }
    this.#shownBill = this.bills.find((bill) => bill.workingOrderId === this.orderId);
    if (changed.has("groups") || this.#heldGroupIds === undefined) {
      this.#heldGroupIds = heldGroupIds(this.groups);
      this.#groupsInOrder = [...this.groups].sort((a, b) => a.position - b.position);
      this.#heldInOrder = this.#groupsInOrder.filter((group) => group.state === "held");
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
    this.#reminderDue = reminderDueAt(this.currentOrders?.reminder) <= (this.now ?? Date.now());
    if (changed.has("nameRefusal") && this.nameRefusal !== null) {
      this.naming = { value: this.nameRefusal.name, refusal: this.nameRefusal.message };
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
    this.#watchReminder();
    if (!this.#offerTaken) return;
    this.#offerTaken = false;
    this.dispatchEvent(
      new CustomEvent("cancel-offer-taken", { detail: {}, bubbles: true, composed: true }),
    );
  }

  #offerTaken = false;

  /** Whether the party's release reminder is due, as of this render. */
  #reminderDue = false;
  #reminderTimer?: ReturnType<typeof setTimeout>;

  /** On the screen's own clock, a reminder not yet due is drawn again the moment it falls due. */
  #watchReminder(): void {
    clearTimeout(this.#reminderTimer);
    const dueAt = reminderDueAt(this.currentOrders?.reminder);
    if (this.now !== undefined || this.#reminderDue || dueAt === Number.POSITIVE_INFINITY) return;
    this.#reminderTimer = setTimeout(() => this.requestUpdate(), delayUntil(dueAt));
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

  #draftEntries(lines: readonly OrderLine[]): DraftEntry[] {
    return lines.map((line) => ({
      courseId: this.#selectedCourseId(line) || null,
      quantity: line.quantity,
      wholeUnits: countsWholeUnits(line),
      flagged: flagged(line),
    }));
  }

  #selectedIndexes(lines: readonly OrderLine[]): Set<number> {
    return new Set(lines.flatMap((line, index) => (this.#selected.has(line) ? [index] : [])));
  }

  /** `requestUpdate` because {@link #selected} is a `WeakSet`, not a reactive property. */
  #toggleSelected(line: OrderLine): void {
    if (this.#selected.has(line)) this.#selected.delete(line);
    else this.#selected.add(line);
    this.requestUpdate();
  }

  #isLaterAddition(store: WorkingOrderStore): boolean {
    return this.#drafts.get(store)?.laterAddition === true;
  }

  #effectiveDestination(): Destination {
    return this.destination === "add-to-held" && this.#heldInOrder.length === 0
      ? "fire-now"
      : this.destination;
  }

  #joinGroup(): OrderGroup | undefined {
    const held = this.#heldInOrder;
    return held.find((group) => group.id === this.joinTarget) ?? held[0];
  }

  #laterAction(): DraftAction {
    switch (this.#effectiveDestination()) {
      case "fire-now":
        return { kind: "fire-now" };
      case "add-as-new":
        return { kind: "add-as-new" };
      case "add-to-held":
        return { kind: "add-to-held", groupId: this.#joinGroup()!.id };
    }
  }

  /**
   * The preview is counted from the submission, and Confirm sends the submission kept here, so it is
   * exactly what the preview named. An unoverridden line OMITS
   * `courseId`, so the server applies the product's default course. The answers name lists, products
   * and labels by id alone: the server takes every price, VAT class and name from the published offer.
   */
  #openPreview(store: WorkingOrderStore, action: DraftAction): void {
    const lines = store.lines;
    const entries = this.#draftEntries(lines);
    const selected = this.#selectedIndexes(lines);
    const submission = draftSubmission(action, entries, this.courses, selected);
    const preview = draftPreview(submission, entries);
    const order = submission.groups.flatMap((group) => group.lineIndexes);
    const place = new Map(order.map((index, position) => [index, position]));
    const sent = order.map((index) => lines[index]!);
    const detail: SubmitDraftDetail = {
      lines: sent.map((line) => {
        const wire: GroupLine = {
          ...toWireProductIdentity(line.product),
          quantity: line.quantity,
          ...toWireLineExtras(line),
          ...toWireModifiers(line),
        };
        if (line.courseId !== undefined) wire.courseId = line.courseId;
        return wire;
      }),
      groups: submission.groups.map((group) => ({
        release: group.release,
        lineIndexes: group.lineIndexes.map((index) => place.get(index)!),
      })),
      ...(submission.joinGroupId === undefined ? {} : { joinGroupId: submission.joinGroupId }),
      store,
      sent,
      draft: this.#draftOf(store),
    };
    const held = this.#heldInOrder;
    const index = held.findIndex((group) => group.id === submission.joinGroupId);
    this.sendTo = null;
    this.pendingDraft = {
      preview,
      ...(index < 0 ? {} : { join: { group: held[index]!, index } }),
      detail,
      leftOut: (submission.leftOut ?? []).map((at) => lines[at]!),
    };
  }

  #confirmPreview(): void {
    const pending = this.pendingDraft;
    if (pending === null) return;
    this.pendingDraft = null;
    // Sent by id even when it is the main bill: the server refuses a chosen bill that is no longer
    // open, where sending none would put the order on the party's main bill as it stands then, or
    // on a new one.
    const chosen = this.sendTo;
    this.#dispatch(
      "submit-draft",
      chosen === null ? pending.detail : { ...pending.detail, billId: chosen.value },
    );
  }

  /**
   * Where the open preview can send: the party's open bills, and first a new bill when the party has
   * no open main bill. A chosen bill stays listed and checked after it stops being an open bill of
   * the party, marked as such, because Confirm still sends it. `checked` is the value shown chosen;
   * null when there is only one place to send to.
   */
  #sendToChoices(): {
    choices: { value: string; label: string; main: boolean; closed: boolean }[];
    checked: string;
  } | null {
    const party = this.party;
    if (party === null) return null;
    const chosen = this.sendTo;
    const choices = this.#shownBills().flatMap((bill, index) =>
      bill.partyId === party.id && (bill.status === "open" || bill.workingOrderId === chosen?.value)
        ? [
            {
              value: bill.workingOrderId,
              label: this.#billName(index),
              main: bill.workingOrderId === party.mainBillId,
              closed: bill.status !== "open",
            },
          ]
        : [],
    );
    if (chosen !== null && !choices.some((choice) => choice.value === chosen.value)) {
      choices.push({ ...chosen, main: false, closed: true });
    }
    const openMain = this.#shownBills().find(
      (bill) =>
        bill.workingOrderId === party.mainBillId &&
        bill.partyId === party.id &&
        bill.status === "open",
    );
    if (openMain === undefined) {
      choices.unshift({ value: "", label: t("table.send_to_new"), main: false, closed: false });
    }
    if (choices.length < 2) return null;
    return { choices, checked: chosen?.value ?? openMain?.workingOrderId ?? "" };
  }

  #sendToChoice(): TemplateResult | typeof nothing {
    const offered = this.#sendToChoices();
    if (offered === null) return nothing;
    return html`<fieldset class="send-to" data-send-to>
      <legend>${t("table.send_to")}</legend>
      ${offered.choices.map(
        (choice) =>
          html`<label class="send-to-option">
            <input
              type="radio"
              name="billId"
              .value=${choice.value}
              .checked=${offered.checked === choice.value}
              @change=${(event: Event) => {
                event.stopPropagation();
                this.sendTo =
                  choice.value === "" ? null : { value: choice.value, label: choice.label };
              }}
            />
            <span
              >${choice.label}${
                choice.main
                  ? html` <span class="bill-main">${t("table.bill_main")}</span>`
                  : nothing
              }${choice.closed ? ` ${t("table.send_to_not_open")}` : nothing}</span
            >
          </label>`,
      )}
    </fieldset>`;
  }

  #dismissPreview(): void {
    this.pendingDraft = null;
  }

  #selectedCourseId(line: OrderLine): string {
    return line.courseId ?? line.product.courseId ?? "";
  }

  /** The placeholder's meaning is the CALLER's: "use the product default" for a draft line (never sent
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

  /** The course goes on the line, so the draft saves it. */
  #pickCourse(store: WorkingOrderStore, line: OrderLine, courseId: string): void {
    store.setLineCourse(store.lines.indexOf(line), courseId === "" ? undefined : courseId);
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

  /** A no-route line (no ticket item) is changed whatever its `sentAt`; a line with a ticket item once
   * it was sent, or while its group is held, because a held line outside one keeps Send alone. */
  #canChange(line: TabLine): boolean {
    if (this.#isChild(line) || this.#isStarted(line) || this.#lockedBySetting(line)) return false;
    if (line.state !== null && line.sentAt === null && !inHeldGroup(line, this.#heldGroupIds!))
      return false;
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

  /** Every sent line with a ticket item, a fired one, and every dish in a held group, a no-route one
   * included: whatever else a line offers, cancelling it always has a button. A held line outside a
   * group keeps Send alone. */
  #canCancel(line: TabLine): boolean {
    if (this.#isChild(line)) return false;
    if (inHeldGroup(line, this.#heldGroupIds!)) return true;
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

  #sendLine(lineNo: number): void {
    this.dispatchEvent(
      new CustomEvent("send-lines", {
        detail: { lineNos: [lineNo] },
        bubbles: true,
        composed: true,
      }),
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

  /** Such a line can be cancelled, or split, one unit at a time; a weighed line cannot. */
  #moreThanOneWholeUnit(line: TabLine): boolean {
    return line.unitPrecision === 0 && compareDecimal(decimal(line.quantity), decimal("1")) > 0;
  }

  /** Always present, driven by {@link cancelLine}, so an Escape close flows back through `wt-close` into
   * the state rather than fighting the `.open` binding. */
  #cancelDialog(): TemplateResult {
    const line = this.cancelLine;
    const started = line !== null && this.#isStarted(line);
    const oneAtATime = line !== null && this.#moreThanOneWholeUnit(line);
    return html`<wt-dialog
      ${trackDialog()}
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
  #menuBrowser(store: WorkingOrderStore): TemplateResult {
    const menu = shownMenu(this.menus, this.selectedMenuId);
    return html`<till-menu-browser
      class="round-control"
      ?inert=${store.sending}
      .menu=${menu}
      .products=${this.#browserProducts(this.products, menu?.id ?? "", this.selectedDiet)}
      .store=${store}
      .columns=${this.handheld ? HANDHELD_COLUMNS : TILL_COLUMNS}
      weighs
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
    const draft = this.#draftStore;
    return html`
      <div class="width-probe"></div>
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
        ${this.#printProblem()}
        <div class="layout">
          ${draft === null ? nothing : this.#ordering(draft)}
          ${this.drawerOpen ? this.#drawer(pending) : nothing}
        </div>
        ${this.#previewDialog()} ${this.#cancelDialog()} ${this.#fireGroupDialog()}
        ${this.#moveDialog()} ${this.#serveDialog()} ${this.#changeEditor()}
        ${this.#takeOverDialog()} ${this.#billChoiceDialog()} ${this.#nameDialog()}
      </section>
    `;
  }

  /** Browsing and the draft: side by side when the screen is wide enough, otherwise browsing, with
   * the draft on its own Review view. Browsing is hidden, never removed, while Review is open, so
   * the menu keeps its open section. */
  #ordering(draft: WorkingOrderStore): TemplateResult {
    const separate = !this.wide;
    const reviewing = separate && this.reviewing;
    const entries = this.#draftEntries(draft.lines);
    return html`<div class=${separate ? "ordering" : "ordering side-by-side"}>
      <div class="browsing" data-browsing ?hidden=${reviewing}>
        ${this.#gridRegion(draft)} ${this.#bottomBar(draft, separate, entries)}
      </div>
      <section
        class="draft-pane"
        data-draft-pane
        aria-labelledby="draft-title"
        ?hidden=${separate && !reviewing}
      >
        <div class="draft-head">
          <h2 class="draft-title" id="draft-title" tabindex="-1">${t("table.draft_title")}</h2>
          ${
            separate
              ? html`<wt-button
                  variant="secondary"
                  data-review-back
                  @click=${() => void this.#closeReview()}
                >
                  ${t("action.back")}
                </wt-button>`
              : nothing
          }
        </div>
        ${this.#roundControl(draft, entries)} ${this.#otherDraftPanels(draft)}
      </section>
    </div>`;
  }

  /** Read-only: nothing in a panel changes or sends another person's lines but taking them over. */
  #otherDraftPanels(draft: WorkingOrderStore): TemplateResult[] {
    const busy = draft.sending || this.takeOverSent !== null;
    return this.otherDrafts.map((other, index) => {
      const title = other.takenFromYou
        ? named(other.ownerName, t("table.draft_taken_by"), t("table.draft_taken_by_unnamed"))
        : named(other.ownerName, t("table.others_draft"), t("table.others_draft_unnamed"));
      return html`<section
        class="other-draft"
        data-other-draft=${other.id}
        aria-labelledby=${`other-draft-${index}`}
      >
        <h3 class="other-draft-title" id=${`other-draft-${index}`}>${title}</h3>
        <ul class="other-draft-lines">
          ${other.lines.map(
            (line) =>
              html`<li class="other-draft-line" data-other-draft-line>
                ${this.#lineSummary(line, "other-draft-name")}
              </li>`,
          )}
        </ul>
        <wt-button
          variant="secondary"
          data-take-over=${other.id}
          aria-label=${`${t("table.take_over")} · ${title}`}
          ?disabled=${busy}
          @click=${() => (this.takeOverPending = other)}
        >
          ${t("table.take_over")}
        </wt-button>
      </section>`;
    });
  }

  #takeOverDialog(): TemplateResult {
    const other = this.takeOverPending;
    const name = other?.ownerName ?? "";
    return html`<wt-dialog
      ${trackDialog()}
      class="take-over-dialog"
      data-take-over-dialog
      .open=${other !== null}
      .dismissible=${this.takeOverSent === null}
      .heading=${named(name, t("table.take_over_title"), t("table.take_over_title_unnamed"))}
      @wt-close=${() => void this.#takeOverClosed()}
    >
      <p data-take-over-body>
        ${named(name, t("table.take_over_body"), t("table.take_over_body_unnamed"))}
      </p>
      <div slot="footer" class="cancel-actions">
        <wt-button
          variant="secondary"
          data-take-over-cancel
          ?disabled=${this.takeOverSent !== null}
          @click=${() => (this.takeOverPending = null)}
        >
          ${t("action.cancel")}
        </wt-button>
        <wt-button
          variant="primary"
          data-take-over-confirm
          ?disabled=${this.takeOverSent !== null}
          @click=${() => this.#confirmTakeOver()}
        >
          ${t("table.take_over_confirm")}
        </wt-button>
      </div>
    </wt-dialog>`;
  }

  /** Once answered, focus goes to the draft's Take over when the draft is still there, and
   * otherwise to the person's own order, which now holds it. */
  async #takeOverClosed(): Promise<void> {
    this.takeOverPending = null;
    const taken = this.#takeOverAnswered;
    this.#takeOverAnswered = undefined;
    if (taken === undefined) return;
    await this.updateComplete;
    const still = this.otherDrafts.some((other) => other.id === taken);
    this.renderRoot
      .querySelector<HTMLElement>(still ? `[data-take-over="${taken}"]` : "#draft-title")
      ?.focus();
  }

  /** One request per press: Confirm stays off until the app says this one has answered. */
  #confirmTakeOver(): void {
    const other = this.takeOverPending;
    if (other === null || this.takeOverSent !== null) return;
    this.takeOverSent = this.takeOversAnswered;
    const detail: TakeOverDraftDetail = { draftId: other.id, revision: other.revision };
    this.#dispatch("take-over-draft", detail);
  }

  /** Under browsing: the line the last tap added or grew and, when the draft has its own view, the
   * way to it. */
  #bottomBar(
    draft: WorkingOrderStore,
    separate: boolean,
    entries: readonly DraftEntry[],
  ): TemplateResult | typeof nothing {
    const lastAdded = this.#lastAdded(draft);
    if (lastAdded === nothing && !separate) return nothing;
    return html`<div class="bottom-bar">
      ${lastAdded}
      ${
        separate
          ? html`<wt-button
              class="review-open"
              variant="primary"
              data-review-open
              @click=${() => void this.#openReview()}
            >
              ${t("table.review").replace(
                "{n}",
                String(entries.reduce((sum, entry) => sum + itemCount(entry), 0)),
              )}
            </wt-button>`
          : nothing
      }
    </div>`;
  }

  /** −1 at one takes the line out, so a mis-tap is undone where it was made. */
  #lastAdded(store: WorkingOrderStore): TemplateResult | typeof nothing {
    const line = store.lastAdded;
    if (line === undefined) return nothing;
    const index = store.lines.indexOf(line);
    const name = shownName(line.product);
    const count = Number(line.quantity);
    const step = (by: -1 | 1, key: StringKey, text: string) =>
      html`<wt-button
        variant="secondary"
        data-last-added-step=${by}
        aria-label=${`${t(key)} · ${name}`}
        @click=${() =>
          count + by < 1
            ? store.removeLine(index)
            : store.setLineQuantity(index, String(count + by))}
      >
        ${text}
      </wt-button>`;
    return html`<div
      class="last-added"
      data-last-added
      role="group"
      aria-label=${t("table.last_added")}
      ?inert=${store.sending}
    >
      <p class="last-added-line">${this.#lineSummary(line, "last-added-name")}</p>
      ${
        soldByTheUnit(line.product)
          ? html`<span class="last-added-steps">
              ${step(-1, "basket.decrease", "−1")} ${step(1, "basket.increase", "+1")}
            </span>`
          : nothing
      }
    </div>`;
  }

  /** A line's name and quantity, its staff answers, its extras and its note. A dish or pick the
   * table's offers no longer hold has no name to show, so it reads as not offered. */
  #lineSummary(line: OrderLine, nameClass: string): TemplateResult {
    const name = shownName(line.product);
    return html`<span class=${nameClass}>${name} ×${this.#displayQty(line.quantity)}</span>
      ${optionAnswers(line.optionSnapshots, { reads: "staff" }).map(
        (answer) => html`<span class="modifier-answer">${answer}</span>`,
      )}
      ${(line.extras ?? []).map((extra) => {
        const extraName = extra.name || t("basket.not_offered");
        return html`<span class="modifier-answer"
          >${extra.quantity > 1 ? `${extraName} ×${extra.quantity}` : extraName}</span
        >`;
      })}
      ${
        line.note === undefined
          ? nothing
          : html`<span class="line-note">${t("line.note.label")}: ${line.note}</span>`
      }`;
  }

  /** Focus follows the view: the control pressed is hidden by what it opens. */
  async #openReview(): Promise<void> {
    const scroller = this.#scroller();
    this.#browsingScroll = { scroller, top: scroller.scrollTop };
    this.reviewing = true;
    scroller.scrollTop = 0;
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLElement>("[data-review-back]")?.focus();
  }

  async #closeReview(): Promise<void> {
    const saved = this.#browsingScroll;
    this.#browsingScroll = undefined;
    this.reviewing = false;
    await this.updateComplete;
    if (saved !== undefined) saved.scroller.scrollTop = saved.top;
    this.renderRoot.querySelector<HTMLElement>("[data-review-open]")?.focus();
  }

  /** The nearest ancestor that scrolls, across shadow roots, else the page. */
  #scroller(): Element {
    for (let node = composedParent(this); node !== null; node = composedParent(node)) {
      const { overflowY } = getComputedStyle(node);
      if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight)
        return node;
    }
    return document.scrollingElement ?? document.documentElement;
  }

  #gridRegion(draft: WorkingOrderStore): TemplateResult {
    return html`<div class="grid-region">
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
      ${keyed(this.orderId, this.#menuBrowser(draft))}
    </div>`;
  }

  #roundControl(draft: WorkingOrderStore, entries: readonly DraftEntry[]): TemplateResult {
    return html`${
        draft.sending
          ? html`<p class="round-sending" role="status" data-round-sending>
              ${this.takeOverSent === null ? t("table.round_sending") : t("table.taking_over")}
            </p>`
          : nothing
      }
      <div class="round-control" data-round-controls ?inert=${draft.sending}>
        <div class="round-bar">
          ${keyed(
            this.orderId,
            draft.lineCount === 0
              ? html`<till-basket .store=${draft}></till-basket>`
              : this.#draftSections(draft, entries),
          )}
          ${this.#draftBar(draft)}
        </div>
      </div>`;
  }

  #printProblem(): TemplateResult | typeof nothing {
    if (this.printProblems.length === 0) return nothing;
    const sent = this.printProblems.filter((problem) =>
      this.reprintSent.includes(problem.workingOrderId),
    );
    const waiting = this.printProblems.filter((problem) => !sent.includes(problem));
    const stations = (problems: PrintProblem[]) =>
      [...new Set(problems.map((problem) => problem.stationName))].join(", ");
    const bills = [...new Set(waiting.map((problem) => problem.workingOrderId))];
    return html`<div class="print-problem" role="status" data-print-problem>
      <p class="print-problem-text">
        <span class="print-problem-title">${t("table.print_problem")}</span>
        ${
          waiting.length === 0
            ? nothing
            : html`<span class="print-problem-line">
                ${t("table.print_problem_detail").replace("{stations}", () => stations(waiting))}
              </span>`
        }
        ${
          sent.length === 0
            ? nothing
            : html`<span class="print-problem-line" data-print-problem-sent>
                ${t("table.print_problem_sent").replace("{stations}", () => stations(sent))}
              </span>`
        }
      </p>
      ${
        waiting.length === 0
          ? nothing
          : html`<wt-button
              variant="secondary"
              data-print-problem-reprint
              @click=${() => this.#dispatch("reprint-kitchen-tickets", { workingOrderIds: bills })}
            >
              ${t("table.print_problem_reprint")}
            </wt-button>`
      }
    </div>`;
  }

  /** One section per course present, in the venue's course order. Each line shows once, as the
   * basket shows it (quantity, note, remove, answers), with its selection toggle in place of its
   * name and, under it, its course picker when the venue has courses (whose `""` placeholder means
   * "use the product default", not "no course": no such option) and Split quantity. */
  #draftSections(store: WorkingOrderStore, entries: readonly DraftEntry[]): TemplateResult {
    const lines = store.lines;
    const sections = draftSections(entries, this.courses);
    return html`<div class="draft-sections" data-draft-sections>
      ${repeat(
        sections,
        (section) => section.course?.id ?? "",
        (section) =>
          html`<section
            class="draft-section"
            data-draft-section=${section.course?.id ?? ""}
            aria-label=${section.course?.name ?? nothing}
          >
            ${
              section.course === null
                ? nothing
                : html`<h3 class="draft-section-name">${section.course.name}</h3>`
            }
            <till-basket stacked .store=${store} .lineIndexes=${section.lineIndexes}>
              ${section.lineIndexes.map((index) => this.#draftLine(store, lines[index]!, index))}
            </till-basket>
          </section>`,
      )}
    </div>`;
  }

  /** A draft line's slotted controls in its basket row. */
  #draftLine(store: WorkingOrderStore, line: OrderLine, index: number): TemplateResult {
    const name = lineProductName(line.product);
    const selected = this.#selected.has(line);
    const splits = soldByTheUnit(line.product) && Number(line.quantity) > 1;
    const isFlagged = flagged(line);
    if (!isFlagged) this.#kept.delete(line);
    const tools = [
      ...(this.courses.length === 0
        ? []
        : [
            html`<select
              data-round-course=${index}
              aria-label=${`${t("table.course_label")} · ${name}`}
              @change=${(event: Event) =>
                this.#pickCourse(store, line, (event.target as HTMLSelectElement).value)}
            >
              ${this.#courseOptions(this.#selectedCourseId(line), t("table.course_default"))}
            </select>`,
          ]),
      ...(splits
        ? [
            html`<wt-button
              variant="secondary"
              data-split-draft-line=${index}
              aria-label=${`${t("table.split_group_line")} · ${name}`}
              @click=${() => store.splitLine(index)}
            >
              ${t("table.split_group_line")}
            </wt-button>`,
          ]
        : []),
      ...(isFlagged ? [this.#flagChoice(store, line, index)] : []),
    ];
    return html`<button
        slot=${`lead-${index}`}
        type="button"
        class="option draft-select"
        data-draft-select=${index}
        aria-pressed=${selected}
        @click=${() => this.#toggleSelected(line)}
      >
        <span aria-hidden="true">${selected ? "☑" : "☐"}</span>
        <span class="draft-line-name">${name} ×${this.#displayQty(line.quantity)}</span>
      </button>
      ${
        tools.length === 0
          ? nothing
          : html`<span slot=${`after-${index}`} class="draft-line-tools">${tools}</span>`
      }`;
  }

  /** A line that cannot be sold now asks whether it goes or stays; kept, it says it stays. Its
   * reason shows beside its name, in the basket's words. */
  #flagChoice(store: WorkingOrderStore, line: OrderLine, index: number): TemplateResult {
    if (this.#kept.has(line))
      return html`<span class="flag-kept" data-flag-kept>${t("table.flag_kept")}</span>`;
    const name = shownName(line.product);
    const busy = store.sending || this.takeOverSent !== null;
    return html`<span class="flag-choice" role="group" aria-label=${name}>
      <wt-button
        variant="secondary"
        data-flag-remove=${index}
        aria-label=${`${t("action.remove")} · ${name}`}
        ?disabled=${busy}
        @click=${() => void this.#removeFlagged(store, line)}
      >
        ${t("action.remove")}
      </wt-button>
      <wt-button
        variant="secondary"
        data-flag-keep=${index}
        aria-label=${`${t("table.flag_keep")} · ${name}`}
        ?disabled=${busy}
        @click=${() => void this.#keepFlagged(store, line)}
      >
        ${t("table.flag_keep")}
      </wt-button>
    </span>`;
  }

  /** The line's row goes with it, so focus goes to the order's heading. */
  async #removeFlagged(store: WorkingOrderStore, line: OrderLine): Promise<void> {
    store.removeLine(store.lines.indexOf(line));
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLElement>("#draft-title")?.focus();
  }

  /** The buttons go, so focus goes to the line itself. */
  async #keepFlagged(store: WorkingOrderStore, line: OrderLine): Promise<void> {
    this.#kept.add(line);
    this.requestUpdate();
    await this.updateComplete;
    this.renderRoot
      .querySelector<HTMLElement>(`[data-draft-select="${store.lines.indexOf(line)}"]`)
      ?.focus();
  }

  /** A first-order draft: Send all and Fire all now with nothing checked, Send selected and Fire
   * selected now with a selection. A later addition: its destination, then one Send. Firing now is
   * offered under every `fireControl`: the kitchen and the pass cannot fire a held group of lines
   * with no course. */
  #draftBar(store: WorkingOrderStore): TemplateResult {
    const disabled = store.lineCount === 0 || store.sending;
    const button = (
      action: DraftAction,
      key: StringKey,
      variant: "primary" | "secondary",
      name: string = action.kind,
    ) =>
      html`<wt-button
        class="draft-action"
        data-draft-action=${name}
        variant=${variant}
        size="lg"
        ?disabled=${disabled}
        @click=${() => this.#openPreview(store, action)}
      >
        ${t(key)}
      </wt-button>`;
    if (this.#isLaterAddition(store)) {
      return html`<div class="draft-bar">
        ${this.#destinationChoice()}
        <div class="draft-actions" role="group" aria-label=${t("table.draft_actions")}>
          ${button(this.#laterAction(), "table.draft_submit", "primary", "submit")}
        </div>
      </div>`;
    }
    const anySelected = store.lines.some((line) => this.#selected.has(line));
    return html`<div class="draft-bar">
      <div class="draft-actions" role="group" aria-label=${t("table.draft_actions")}>
        ${
          anySelected
            ? html`${button({ kind: "send-selected" }, "table.draft_send_selected", "secondary")}
              ${button({ kind: "fire-selected" }, "table.draft_fire_selected", "primary")}`
            : html`${button({ kind: "send-all" }, "table.draft_send_all", "secondary")}
              ${button({ kind: "fire-all" }, "table.draft_fire_all", "primary")}`
        }
      </div>
    </div>`;
  }

  #destinationChoice(): TemplateResult {
    const chosen = this.#effectiveDestination();
    const held = this.#heldInOrder;
    const options: [Destination, StringKey][] = [
      ["fire-now", "table.destination_fire_now"],
      ...(held.length === 0
        ? []
        : [["add-to-held", "table.destination_add_to_held"] as [Destination, StringKey]]),
      ["add-as-new", "table.destination_add_as_new"],
    ];
    const joining = this.#joinGroup();
    return html`<div
        class="destination"
        role="group"
        aria-label=${t("table.destination_label")}
        data-destination-choice
      >
        ${options.map(
          ([kind, key]) =>
            html`<button
              type="button"
              class="option"
              data-destination=${kind}
              aria-pressed=${chosen === kind}
              @click=${() => (this.destination = kind)}
            >
              ${t(key)}
            </button>`,
        )}
      </div>
      ${
        chosen === "add-to-held"
          ? html`<div
              class="destination held-picker"
              role="group"
              aria-label=${t("table.held_picker_label")}
              data-held-picker
            >
              ${held.map(
                (group, index) =>
                  html`<button
                    type="button"
                    class="option"
                    data-held-group=${group.id}
                    aria-pressed=${group.id === joining?.id}
                    @click=${() => (this.joinTarget = group.id)}
                  >
                    ${heldGroupLabel(group, index)}
                  </button>`,
              )}
            </div>`
          : nothing
      }`;
  }

  #previewDialog(): TemplateResult {
    const pending = this.pendingDraft;
    const preview = pending?.preview;
    return html`<wt-dialog
      ${trackDialog()}
      class="draft-preview"
      data-draft-preview
      .open=${pending !== null}
      .heading=${t("table.preview_title")}
      @wt-close=${() => this.#dismissPreview()}
    >
      <div class="preview-body" data-preview-body>
        ${
          pending !== null && pending.detail.sent.length === 0
            ? html`<p data-preview-nothing>${t("table.nothing_sent")}</p>`
            : nothing
        }
        ${
          preview === undefined
            ? nothing
            : html`${
                preview.fireItems > 0
                  ? html`<p data-preview-fire>
                      ${countText(preview.fireItems, "table.preview_fire", "table.preview_fire_one")}
                    </p>`
                  : nothing
              }
              ${
                pending!.join !== undefined
                  ? html`<p data-preview-join>
                      ${countText(
                        preview.holdItems,
                        "table.preview_join",
                        "table.preview_join_one",
                      ).replace("{group}", () =>
                        heldGroupLabel(pending!.join!.group, pending!.join!.index),
                      )}
                    </p>`
                  : preview.holdGroups > 0
                    ? html`<p data-preview-hold>
                        ${countText(preview.holdGroups, "table.preview_hold", "table.preview_hold_one")}
                      </p>`
                    : nothing
              }`
        }
        ${
          pending === null || pending.leftOut.length === 0
            ? nothing
            : html`<p data-preview-left-out>${leftOutText(pending.leftOut)}</p>`
        }
        ${pending === null || pending.detail.sent.length === 0 ? nothing : this.#sendToChoice()}
      </div>
      <div slot="footer" class="cancel-actions">
        <wt-button
          class="preview-back"
          variant="secondary"
          data-draft-dismiss
          @click=${() => this.#dismissPreview()}
        >
          ${t("action.back")}
        </wt-button>
        ${
          pending !== null && pending.detail.sent.length === 0
            ? nothing
            : html`<wt-button
                class="preview-confirm"
                variant="primary"
                data-draft-confirm
                @click=${() => this.#confirmPreview()}
              >
                ${t("table.preview_confirm")}
              </wt-button>`
        }
      </div>
    </wt-dialog>`;
  }

  #drawer(pending: TabLine[]): TemplateResult {
    return html`
      <aside class="drawer" data-drawer aria-label=${t("table.open_drawer")}>
        ${this.#groupsSection()} ${this.#pendingSection(pending)} ${this.#servedSection()}
        <div class="total-row">
          <span class="label">${t("label.total")}</span>
          <span class="amount" data-tab-total
            >${formatMoney(this.#payStore!.total, currentLocale())}</span
          >
        </div>
        ${this.canSettle && this.#chargeable() ? this.#paySection() : nothing}
        ${this.#billsSection()} ${this.#statusSection()} ${this.#actionSection()}
      </aside>
    `;
  }

  /** The bill on screen can take a payment unless the party's bills say it is paid or abandoned; a
   * presented bill is collected. */
  #chargeable(): boolean {
    const shown = this.#shownBill;
    return shown === undefined || owing(shown);
  }

  #paySection(): TemplateResult {
    const shown = this.#shownBill;
    const partlyPaid = shown !== undefined && paidInPart(shown) ? shown : undefined;
    return partlyPaid === undefined
      ? html`<section
          class="pay"
          @confirm-payment=${(event: Event) => this.#onTenderConfirm(event)}
          @park-order=${(event: Event) => this.#onTenderPark(event)}
        >
          <h2>${t("table.pay_title")}</h2>
          <till-tender-pay .store=${this.#payStore} .busy=${this.busy}></till-tender-pay>
        </section>`
      : html`<section class="pay" data-bill-payments>
          <h2>${t("table.pay_title")}</h2>
          <p class="amount">
            ${t("table.bill_to_pay").replace("{amount}", () => this.#money(partlyPaid.outstanding))}
          </p>
          <p>${t("bill.pay_with_bill_payments")}</p>
        </section>`;
  }

  /** Abandoned bills are left out: nobody pays them. */
  #shownBills(): PartyBill[] {
    return this.bills.filter((bill) => bill.status !== "abandoned");
  }

  /** A bill's name by its place in {@link #shownBills}, under the party's display name. */
  #billName(index: number): string {
    return t("table.bill_of")
      .replace("{party}", () => this.party?.displayName ?? "")
      .replace("{n}", String(index + 1));
  }

  #money(amount: string): string {
    return formatMoney(decimal(amount), currentLocale());
  }

  #billsSection(): TemplateResult | typeof nothing {
    if (this.party === null) return nothing;
    const bills = this.#shownBills();
    const unpaid = bills.filter(owing);
    // Another bill first: the one on screen is charged from the section above.
    const firstUnpaid = unpaid.find((bill) => bill.workingOrderId !== this.orderId) ?? unpaid[0];
    return html`<section class="bills" data-bills>
      <h2>${t("table.bills_title")}</h2>
      <ul>
        ${bills.map((bill, index) => this.#billRow(bill, index))}
      </ul>
      <div class="total-row">
        <span class="label">${t("table.still_to_pay")}</span>
        <span class="amount" data-party-outstanding>${this.#money(this.party.outstanding)}</span>
      </div>
      ${
        this.finishRefused
          ? html`<div class="finish-refusal" role="alert" data-finish-refusal>
              <span>${codeMessage("party.bill_outstanding")}</span>
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

  #billRow(bill: PartyBill, index: number): TemplateResult {
    const shown = bill.workingOrderId === this.orderId;
    const paid = bill.status === "settled";
    return html`<li
      class="bill"
      data-bill=${bill.workingOrderId}
      aria-current=${shown ? "true" : nothing}
    >
      <span
        ><span class="bill-name">${this.#billName(index)}</span>${
          bill.workingOrderId === this.party?.mainBillId
            ? html` <span class="bill-main" data-bill-main>${t("table.bill_main")}</span>`
            : nothing
        }</span
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
          owing(bill) && !shown
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

  #takePayment(bill: PartyBill): void {
    this.#dispatch("take-payment", { workingOrderId: bill.workingOrderId });
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
      ${this.#lineCourse(line)} ${this.#lineActions(line)}
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

  /**
   * Current orders: every group of the party in position order, then the rows in no group. A held
   * group can be moved among the held ones, have its rows moved or split, and be fired where
   * `fireControl` gives the waiter the release. With {@link currentOrders} read, each group lists the
   * party's rows on every bill, with what is known of each, and released rows can be marked served;
   * without it, a group lists only this bill's lines and the server's summary.
   */
  #groupsSection(): TemplateResult | typeof nothing {
    const ungrouped = this.currentOrders?.ungrouped ?? [];
    if (this.groups.length === 0 && ungrouped.length === 0 && !this.currentOrdersUnread)
      return nothing;
    return html`<section class="groups" data-groups>
      <h2>${t("table.groups_title")}</h2>
      ${
        this.currentOrdersUnread
          ? html`<p class="empty" data-current-orders-unread>
              ${t("table.current_orders_unread")}
            </p>`
          : nothing
      }
      <ol class="group-list">
        ${this.#groupsInOrder.map((group) => this.#groupRow(group))}
      </ol>
      ${
        ungrouped.length === 0
          ? nothing
          : html`<section class="ungrouped" data-ungrouped>
              <h3>${t("table.ungrouped_title")}</h3>
              <ul class="group-lines">
                ${ungrouped.map((row) => this.#currentRow(row, null))}
              </ul>
            </section>`
      }
    </section>`;
  }

  #groupRow(group: OrderGroup): TemplateResult {
    const held = this.#heldInOrder;
    const isHeld = group.state === "held";
    const name = t("table.group_n").replace("{n}", String(group.position));
    const label = (key: StringKey) => `${t(key)} · ${name}`;
    const place = held.indexOf(group);
    const shown = this.currentOrders?.groups.find((candidate) => candidate.id === group.id);
    const current = this.currentOrders === null ? null : (shown?.rows ?? []);
    const reminder = isHeld ? this.#reminderOf(group, shown) : nothing;
    // A due reminder brings its own Fire.
    const fires = this.fireControl === "waiter" && !(reminder !== nothing && this.#reminderDue);
    const servesWhole =
      !isHeld &&
      current !== null &&
      current.every((row) => row.released) &&
      current.some((row) => row.servedAt === null);
    return html`<li class="group" data-group=${group.id} data-group-state=${group.state}>
      <div class="group-head">
        <span class="group-name" data-group-position>${name}</span>
        ${shown === undefined ? nothing : this.#sentOf(shown)}
        <span class="group-state" data-group-kitchen>${this.#groupProgress(group, current)}</span>
      </div>
      ${
        current === null
          ? html`<p class="group-summary" data-group-summary>${group.summary}</p>`
          : nothing
      }
      ${reminder}
      ${
        isHeld
          ? html`<div class="group-actions">
              <wt-button
                variant="secondary"
                data-group-up=${group.id}
                aria-label=${label("table.group_up")}
                ?disabled=${this.groupCommandBusy || place === 0}
                @click=${() => this.#reorderHeld(held, place, place - 1)}
              >
                <span aria-hidden="true">↑</span>
              </wt-button>
              <wt-button
                variant="secondary"
                data-group-down=${group.id}
                aria-label=${label("table.group_down")}
                ?disabled=${this.groupCommandBusy || place === held.length - 1}
                @click=${() => this.#reorderHeld(held, place, place + 1)}
              >
                <span aria-hidden="true">↓</span>
              </wt-button>
              ${
                fires
                  ? html`<wt-button
                      variant="primary"
                      data-group-fire=${group.id}
                      aria-label=${label("table.group_fire")}
                      ?disabled=${this.groupCommandBusy}
                      @click=${() => (this.fireGroupPending = group)}
                    >
                      ${t("table.group_fire")}
                    </wt-button>`
                  : nothing
              }
            </div>`
          : servesWhole
            ? html`<div class="group-actions">
                <wt-button
                  variant="secondary"
                  data-serve-group=${group.id}
                  aria-label=${label("table.serve_group")}
                  ?disabled=${this.groupCommandBusy}
                  @click=${() =>
                    this.#dispatch("serve-group", { groupId: group.id } satisfies ServeGroupDetail)}
                >
                  ${t("table.serve_group")}
                </wt-button>
              </div>`
            : nothing
      }
      <ul class="group-lines">
        ${
          current === null
            ? this.#billLinesOf(group).map((line) => this.#groupLine(line, isHeld ? group : null))
            : current.map((row) => this.#currentRow(row, isHeld ? group : null))
        }
      </ul>
    </li>`;
  }

  #sentOf(group: CurrentOrderGroup): TemplateResult {
    const time = clockTime(Date.parse(group.sentAt));
    const [withName, unnamed] =
      group.state === "held"
        ? (["table.group_held_since", "table.group_held_since_unnamed"] as const)
        : (["table.group_sent", "table.group_sent_unnamed"] as const);
    const at = (key: StringKey) => t(key).replace("{time}", () => time);
    return html`<span class="group-sent" data-group-sent
      >${named(group.sentBy ?? "", at(withName), at(unnamed))}</span
    >`;
  }

  /** This bill's dish lines of `group`, for want of Current orders. */
  #billLinesOf(group: OrderGroup): TabLine[] {
    return group.lineIds.flatMap((id) => {
      const line = this.#lineById.get(id);
      return line === undefined || this.#isChild(line) ? [] : [line];
    });
  }

  /** Only what a person recorded: a group nobody marked ready reads how long ago it was fired, and
   * one reads served only once every row of it was marked served. */
  #groupProgress(group: OrderGroup, rows: CurrentOrderRow[] | null): string | TemplateResult {
    if (group.state === "held") return t("table.group_held");
    if (rows !== null && rows.length > 0 && rows.every((row) => row.servedAt !== null))
      return t("table.row_served");
    if (group.away) return t("table.group_away");
    if (group.ready) return t("table.group_ready");
    if (group.firedAt === null) return t("table.group_fired");
    return html`<till-fired-ago .firedAt=${group.firedAt} .now=${this.now}></till-fired-ago>`;
  }

  /** The held group waiting for release: when it is to be fired, and once that time has come,
   * Snooze and (where the waiter fires) Fire. While it is snoozed, Clear snooze too, due or not.
   * Nothing while it has no time. */
  #reminderOf(
    group: OrderGroup,
    shown: CurrentOrderGroup | undefined,
  ): TemplateResult | typeof nothing {
    const reminder = this.currentOrders?.reminder;
    // A time that cannot be read is no time.
    if (reminder?.groupId !== group.id || reminderDueAt(reminder) === Number.POSITIVE_INFINITY)
      return nothing;
    const name = t("table.group_n").replace("{n}", String(group.position));
    const snoozed = shown?.remindAt;
    const clear =
      snoozed === null || snoozed === undefined
        ? nothing
        : html`<wt-button
            variant="secondary"
            data-reminder-unsnooze
            aria-label=${`${t("table.reminder_clear_snooze")} · ${name}`}
            ?disabled=${this.groupCommandBusy}
            @click=${() =>
              this.#dispatch("unsnooze-group", { groupId: group.id } satisfies UnsnoozeGroupDetail)}
          >
            ${t("table.reminder_clear_snooze")}
          </wt-button>`;
    if (!this.#reminderDue) {
      const time = clockTime(reminderDueAt(reminder));
      return html`<div class="group-reminder" data-group-reminder="waiting">
        <span class="group-reminder-text"
          >${t("table.reminder_at").replace("{time}", () => time)}</span
        >
        ${clear === nothing ? nothing : html`<span class="group-actions">${clear}</span>`}
      </div>`;
    }
    return html`<div class="group-reminder due" data-group-reminder="due">
      <span class="group-reminder-text">${t("table.reminder_due")}</span>
      <span class="group-actions">
        ${clear}
        <wt-button
          variant="secondary"
          data-reminder-snooze
          aria-label=${`${t("table.reminder_snooze").replace("{n}", String(SNOOZE_MINUTES))} · ${name}`}
          ?disabled=${this.groupCommandBusy}
          @click=${() =>
            this.#dispatch("snooze-group", {
              groupId: group.id,
              minutes: SNOOZE_MINUTES,
            } satisfies SnoozeGroupDetail)}
        >
          ${t("table.reminder_snooze").replace("{n}", String(SNOOZE_MINUTES))}
        </wt-button>
        ${
          this.fireControl === "waiter"
            ? html`<wt-button
                variant="primary"
                data-reminder-fire
                aria-label=${`${t("table.group_fire")} · ${name}`}
                ?disabled=${this.groupCommandBusy}
                @click=${() => (this.fireGroupPending = group)}
              >
                ${t("table.group_fire")}
              </wt-button>`
            : nothing
        }
      </span>
    </div>`;
  }

  /** A row of Current orders. `held` is its group while that group is held, when the row offers Move
   * and Split; otherwise it says what is known of it and, once released, offers Mark served. */
  #currentRow(row: CurrentOrderRow, held: OrderGroup | null): TemplateResult {
    const state = held === null ? this.#rowState(row) : nothing;
    const served = decimal(row.servedQuantity);
    const partly = compareDecimal(served, decimal("0")) > 0 && row.servedAt === null;
    return html`<li class="group-line current-row" data-group-line=${row.lineId}>
      <span class="row-what">
        <span class="group-line-name">${row.name} ×${this.#displayQty(row.quantity)}</span>
        ${row.extras.map(
          (extra) =>
            html`<span class="row-extra">${extra.name} ×${this.#displayQty(extra.quantity)}</span>`,
        )}
        ${
          row.note === null
            ? nothing
            : html`<span class="line-note">${t("line.note.label")}: ${row.note}</span>`
        }
        ${
          state === nothing && !partly
            ? nothing
            : html`<span class="row-facts">
                ${state === nothing ? nothing : html`<span data-row-state>${state}</span>`}
                ${partly ? html`<span data-row-served>${this.#servedOf(row)}</span>` : nothing}
              </span>`
        }
      </span>
      ${
        held === null
          ? this.#serveActions(row)
          : !this.#billOpen(row.workingOrderId)
            ? nothing
            : this.#heldRowActions(
                {
                  lineId: row.lineId,
                  name: row.name,
                  quantity: row.quantity,
                  splits:
                    row.unitPrecision === 0 &&
                    compareDecimal(decimal(row.quantity), decimal("1")) > 0 &&
                    row.extras.length === 0,
                },
                held,
              )
      }
    </li>`;
  }

  /** A bill the party's bills name as open, or the bill on screen when they do not name it. Held
   * work moves only between open bills: the server refuses a line on a paid one. */
  #billOpen(workingOrderId: string): boolean {
    const bill = this.bills.find((candidate) => candidate.workingOrderId === workingOrderId);
    return bill === undefined ? workingOrderId === this.orderId : bill.status === "open";
  }

  /** What was recorded of a row, and nothing more: no kitchen item means no kitchen state. */
  #rowState(row: CurrentOrderRow): string | TemplateResult | typeof nothing {
    if (row.servedAt !== null) return t("table.row_served");
    if (!row.released) return t("table.group_held");
    const kitchen = row.kitchen;
    if (kitchen === null || kitchen.firedAt === null) return nothing;
    if (kitchen.awayAt !== null) return t("table.group_away");
    if (kitchen.state === "ready") return t("table.group_ready");
    if (kitchen.state === "preparing") return t("table.row_preparing");
    return html`<till-fired-ago .firedAt=${kitchen.firedAt} .now=${this.now}></till-fired-ago>`;
  }

  #servedOf(row: CurrentOrderRow): string {
    return t("table.row_served_of")
      .replace("{served}", this.#displayQty(row.servedQuantity))
      .replace("{quantity}", this.#displayQty(row.quantity));
  }

  #serveActions(row: CurrentOrderRow): TemplateResult | typeof nothing {
    const serves = row.released && row.servedAt === null;
    const undoes = compareDecimal(decimal(row.servedQuantity), decimal("0")) > 0;
    if (!serves && !undoes) return nothing;
    const label = (key: StringKey) => `${t(key)} · ${row.name}`;
    return html`<span class="group-line-actions">
      ${
        undoes
          ? html`<wt-button
              variant="secondary"
              data-unserve-row=${row.lineId}
              aria-label=${label("table.unserve")}
              ?disabled=${this.groupCommandBusy}
              @click=${() => this.#requestServe(row, true)}
            >
              ${t("table.unserve")}
            </wt-button>`
          : nothing
      }
      ${
        serves
          ? html`<wt-button
              variant="primary"
              data-serve-row=${row.lineId}
              aria-label=${label("table.serve")}
              ?disabled=${this.groupCommandBusy}
              @click=${() => this.#requestServe(row, false)}
            >
              ${t("table.serve")}
            </wt-button>`
          : nothing
      }
    </span>`;
  }

  /** The most a press can mark served (what is left), or take back (what is served). */
  #mostToServe(row: CurrentOrderRow, undo: boolean): Decimal {
    const served = decimal(row.servedQuantity);
    return decimal(trimQuantity(undo ? served : subtractDecimal(decimal(row.quantity), served)));
  }

  /** More than one whole unit asks how many; anything else, a weighed dish included, goes whole. */
  #requestServe(row: CurrentOrderRow, undo: boolean): void {
    const most = this.#mostToServe(row, undo);
    if (row.unitPrecision === 0 && compareDecimal(most, decimal("1")) > 0) {
      this.servePending = { row, undo, count: most };
      return;
    }
    this.#sendServe(row, undo, most);
  }

  #sendServe(row: CurrentOrderRow, undo: boolean, quantity: Decimal): void {
    this.#dispatch(undo ? "unserve-lines" : "serve-lines", {
      items: [{ lineId: row.lineId, quantity: trimQuantity(quantity) }],
    } satisfies ServeLinesDetail);
  }

  #stepServe(delta: -1 | 1): void {
    const pending = this.servePending!;
    const count =
      delta === -1
        ? subtractDecimal(pending.count, decimal("1"))
        : addDecimal(pending.count, decimal("1"));
    this.servePending = { ...pending, count };
  }

  #confirmServe(): void {
    const pending = this.servePending;
    if (pending === null) return;
    this.servePending = null;
    this.#sendServe(pending.row, pending.undo, pending.count);
  }

  /** Always present, driven by {@link servePending}, so an Escape close flows back through
   * `wt-close` into the state. */
  #serveDialog(): TemplateResult {
    const pending = this.servePending;
    const count = pending === null ? 0 : Number.parseInt(pending.count, 10);
    return html`<wt-dialog
      ${trackDialog()}
      class="serve-dialog"
      data-serve-dialog
      .open=${pending !== null}
      .heading=${t(pending?.undo === true ? "table.unserve" : "table.serve")}
      @wt-close=${() => (this.servePending = null)}
    >
      ${
        pending === null
          ? nothing
          : html`<p class="move-dish">
                ${pending.row.name} ×${this.#displayQty(pending.row.quantity)}
              </p>
              ${
                compareDecimal(decimal(pending.row.servedQuantity), decimal("0")) > 0
                  ? html`<p class="serve-so-far">${this.#servedOf(pending.row)}</p>`
                  : nothing
              }
              <div class="split-stepper">
                <span>${t("table.split_quantity")}</span>
                <wt-button
                  variant="ghost"
                  size="sm"
                  data-serve-dec
                  aria-label=${`${t("basket.decrease")} ${pending.row.name}`}
                  ?disabled=${count <= 1}
                  @click=${() => this.#stepServe(-1)}
                >
                  <span aria-hidden="true">−</span>
                </wt-button>
                <span class="split-count" data-serve-count>${count}</span>
                <wt-button
                  variant="ghost"
                  size="sm"
                  data-serve-inc
                  aria-label=${`${t("basket.increase")} ${pending.row.name}`}
                  ?disabled=${
                    compareDecimal(pending.count, this.#mostToServe(pending.row, pending.undo)) >= 0
                  }
                  @click=${() => this.#stepServe(1)}
                >
                  <span aria-hidden="true">+</span>
                </wt-button>
              </div>`
      }
      <div slot="footer" class="cancel-actions">
        <wt-button
          variant="secondary"
          data-serve-dismiss
          @click=${() => (this.servePending = null)}
        >
          ${t("action.back")}
        </wt-button>
        <wt-button variant="primary" data-serve-confirm @click=${() => this.#confirmServe()}>
          ${
            pending?.undo === true
              ? t("table.unserve_n").replace("{n}", String(count))
              : countText(count, "table.serve_n", "table.serve_n_one")
          }
        </wt-button>
      </div>
    </wt-dialog>`;
  }

  /** `group` is null for a fired group's line, which offers nothing. Split quantity is offered on a
   * dish sold by the unit, of more than one, with no extras: the server refuses to split a dish with
   * extras. */
  #groupLine(line: TabLine, group: OrderGroup | null): TemplateResult {
    const name = this.#nameForLine(line);
    return html`<li class="group-line" data-group-line=${line.id}>
      <span class="group-line-name">${name} ×${this.#displayQty(line.quantity)}</span>
      ${
        group === null
          ? nothing
          : this.#heldRowActions(
              {
                lineId: line.id,
                name,
                quantity: line.quantity,
                splits:
                  this.#moreThanOneWholeUnit(line) && !this.#dishesWithExtras.has(line.lineNo),
              },
              group,
            )
      }
    </li>`;
  }

  #heldRowActions(row: HeldRow, group: OrderGroup): TemplateResult {
    const label = (key: StringKey) => `${t(key)} · ${row.name}`;
    return html`<span class="group-line-actions">
      <wt-button
        variant="secondary"
        data-move-line=${row.lineId}
        aria-label=${label("table.move_line")}
        ?disabled=${this.groupCommandBusy}
        @click=${() =>
          (this.movePending = {
            lineId: row.lineId,
            name: row.name,
            quantity: row.quantity,
            group,
          })}
      >
        ${t("table.move_line")}
      </wt-button>
      ${
        row.splits
          ? html`<wt-button
              variant="secondary"
              data-split-group-line=${row.lineId}
              aria-label=${label("table.split_group_line")}
              ?disabled=${this.groupCommandBusy}
              @click=${() =>
                this.#dispatch("split-group-line", {
                  lineId: row.lineId,
                  groupId: group.id,
                  quantity: row.quantity,
                } satisfies SplitGroupLineDetail)}
            >
              ${t("table.split_group_line")}
            </wt-button>`
          : nothing
      }
    </span>`;
  }

  #reorderHeld(held: OrderGroup[], from: number, to: number): void {
    const ids = held.map((group) => group.id);
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    this.#dispatch("reorder-groups", { heldGroupIds: ids } satisfies ReorderGroupsDetail);
  }

  #moveTo(target: MoveGroupLineDetail["target"]): void {
    const pending = this.movePending;
    if (pending === null) return;
    this.movePending = null;
    this.#dispatch("move-group-line", {
      lineId: pending.lineId,
      quantity: pending.quantity,
      target,
    } satisfies MoveGroupLineDetail);
  }

  #moveDialog(): TemplateResult {
    const pending = this.movePending;
    const held = this.#heldInOrder;
    return html`<wt-dialog
      ${trackDialog()}
      class="move-line-dialog"
      data-move-dialog
      .open=${pending !== null}
      .heading=${t("table.move_line")}
      @wt-close=${() => (this.movePending = null)}
    >
      ${
        pending === null
          ? nothing
          : html`<p class="move-dish">${pending.name} ×${this.#displayQty(pending.quantity)}</p>
              <div class="action-options">
                ${held.map((group, index) =>
                  group.id === pending.group.id
                    ? nothing
                    : html`<wt-button
                        variant="secondary"
                        data-move-target=${group.id}
                        @click=${() => this.#moveTo({ groupId: group.id })}
                      >
                        ${heldGroupLabel(group, index)}
                      </wt-button>`,
                )}
                <wt-button
                  variant="secondary"
                  data-move-target="new"
                  @click=${() => this.#moveTo("new")}
                >
                  ${t("table.move_new_group")}
                </wt-button>
              </div>`
      }
      <div slot="footer" class="cancel-actions">
        <wt-button variant="secondary" data-move-dismiss @click=${() => (this.movePending = null)}>
          ${t("action.back")}
        </wt-button>
      </div>
    </wt-dialog>`;
  }

  #confirmFireGroup(): void {
    const group = this.fireGroupPending;
    if (group === null) return;
    this.fireGroupPending = null;
    this.#dispatch("fire-group", { groupId: group.id } satisfies FireGroupDetail);
  }

  #fireGroupDialog(): TemplateResult {
    const group = this.fireGroupPending;
    return html`<wt-dialog
      ${trackDialog()}
      class="fire-group-dialog"
      data-fire-dialog
      .open=${group !== null}
      .heading=${t("table.fire_group_title")}
      @wt-close=${() => (this.fireGroupPending = null)}
    >
      ${
        group === null
          ? nothing
          : html`<p data-fire-summary>
              ${t("table.fire_group_body").replace("{summary}", () => group.summary)}
            </p>`
      }
      <div slot="footer" class="cancel-actions">
        <wt-button
          variant="secondary"
          data-fire-dismiss
          @click=${() => (this.fireGroupPending = null)}
        >
          ${t("action.back")}
        </wt-button>
        <wt-button variant="primary" data-fire-confirm @click=${() => this.#confirmFireGroup()}>
          ${t("table.group_fire")}
        </wt-button>
      </div>
    </wt-dialog>`;
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

  #partyScope(party: TableParty): string {
    return partyScope(party, this.tables);
  }

  /** The bill on screen by {@link #billName}, or undefined when the party's bills do not list it. */
  #shownBillName(): string | undefined {
    const index = this.#shownBills().findIndex((bill) => bill.workingOrderId === this.orderId);
    return index < 0 ? undefined : this.#billName(index);
  }

  /** Every table but the party's own; Move guests also offers the party's own tables while it holds
   * more than one, since moving to one of them leaves the others. */
  #tableTargets(): TableState[] {
    const own = new Set(this.party?.tableIds ?? []);
    const keepOwn = this.actionVerb === "move" && own.size > 1;
    const owned = keepOwn ? this.tables.filter((table) => own.has(table.id)) : [];
    return [...owned, ...this.tables.filter((table) => !own.has(table.id))];
  }

  /** The party's other open bills holding no payment, a pending one included, which merge and
   * transfer offer, each with its name. The server decides whether it takes the chosen one. */
  #otherBills(): { bill: PartyBill; name: string }[] {
    const party = this.party;
    if (party === null) return [];
    return this.#shownBills().flatMap((bill, index) =>
      bill.workingOrderId !== this.orderId &&
      bill.partyId === party.id &&
      bill.status === "open" &&
      !bill.hasPayments
        ? [{ bill, name: this.#billName(index) }]
        : [],
    );
  }

  #closeActions(): void {
    this.actionStep = "closed";
    this.actionVerb = null;
    this.splitTableId = null;
    this.billChoice = null;
    this.transferToBillId = null;
    this.transferLineNos = new Set();
    this.splitQuantities = new Map();
    this.splitAttempted = false;
  }

  #dispatch(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #chooseVerb(verb: ActionVerb): void {
    this.actionVerb = verb;
    if (verb === "split") {
      this.splitQuantities = new Map();
      this.splitAttempted = false;
    }
    this.actionStep = verb === "split" ? "split-lines" : "pick";
  }

  /** A table another party holds asks about the bills first; any other goes at once. */
  #pickTable(table: TableState): void {
    const verb: TableVerb =
      this.actionVerb === "move" || this.actionVerb === "move-bill" ? this.actionVerb : "join";
    const other = table.party !== null && table.party.id !== this.party?.id;
    if (other) {
      this.billChoice = { verb, table };
      return;
    }
    this.#sendTableAction(verb, table, "merge");
  }

  /** `table` as the picker showed it: Move this bill sends who was seated there. */
  #sendTableAction(verb: TableVerb, table: TableState, bills: BillChoiceDetail["bills"]): void {
    const tableId = table.id;
    if (verb === "move") this.#dispatch("move-guests", { toTableId: tableId, bills });
    else if (verb === "move-bill")
      this.#dispatch("move-bill", {
        to: { tableId, seated: seatedRead(table) },
        bills,
      } satisfies MoveBillDetail);
    else this.#dispatch("join-tables", { tableId, bills });
    this.#closeActions();
  }

  #moveBillToCounter(): void {
    this.#dispatch("move-bill", {
      to: { counter: true },
      bills: "merge",
    } satisfies MoveBillDetail);
    this.#closeActions();
  }

  #onBillChoice(event: Event): void {
    event.stopPropagation();
    const choice = this.billChoice;
    if (choice === null) return;
    const { bills } = (event as CustomEvent<BillChoiceDetail>).detail;
    this.#sendTableAction(choice.verb, choice.table, bills);
  }

  #billChoiceDialog(): TemplateResult | typeof nothing {
    const choice = this.billChoice;
    const own = this.party;
    const other = choice?.table.party;
    if (choice === null || own === null || other === null || other === undefined) return nothing;
    const theirs = this.#partyScope(other);
    const ours = this.#partyScope(own);
    const [from, into] = choice.verb === "join" ? [theirs, ours] : [ours, theirs];
    const scope =
      choice.verb === "move-bill"
        ? moveBillScope(this.#shownBillName() ?? "", into)
        : t("table.combine_scope")
            .replace("{from}", () => from)
            .replace("{into}", () => into);
    return html`<till-bill-choice-dialog
      .scope=${scope}
      .question=${choice.verb === "move-bill" ? t("table.bill_move_question") : ""}
      @bill-choice-confirm=${(event: Event) => this.#onBillChoice(event)}
      @bill-choice-cancel=${(event: Event) => {
        event.stopPropagation();
        this.billChoice = null;
      }}
    ></till-bill-choice-dialog>`;
  }

  #openNaming(): void {
    this.#closeActions();
    this.naming = { value: this.party?.name ?? "", refusal: "" };
  }

  #nameDialog(): TemplateResult | typeof nothing {
    const naming = this.naming;
    const party = this.party;
    if (naming === null || party === null) return nothing;
    return html`<till-party-name-dialog
      .tables=${partyTablesLabel(party, this.tables)}
      .value=${naming.value}
      .refusal=${naming.refusal}
      @party-name-confirm=${(event: Event) => {
        event.stopPropagation();
        this.naming = null;
        this.#dispatch("name-party", {
          name: (event as CustomEvent<PartyNameDetail>).detail.name,
        });
      }}
      @party-name-cancel=${(event: Event) => {
        event.stopPropagation();
        this.naming = null;
      }}
    ></till-party-name-dialog>`;
  }

  /** The party's bills Split a table can give the new party: open or presented, not the main one. */
  #splitTableBills(): { bill: PartyBill; name: string }[] {
    const party = this.party;
    if (party === null) return [];
    return this.#shownBills().flatMap((bill, index) =>
      bill.partyId === party.id && bill.workingOrderId !== party.mainBillId && owing(bill)
        ? [{ bill, name: this.#billName(index) }]
        : [],
    );
  }

  #splitTableStep(): TemplateResult {
    const party = this.party!;
    const scope = this.#partyScope(party);
    const table = this.tables.find((row) => row.id === this.splitTableId);
    const choosingBill = this.actionStep === "split-table-bill" && table !== undefined;
    const targets = choosingBill
      ? [
          ...this.#splitTableBills().map(({ bill, name }) => ({
            id: bill.workingOrderId,
            name: `${name} · ${this.#money(bill.total)}`,
            pick: () => this.#splitTable(table.id, bill.workingOrderId),
          })),
          {
            id: "none",
            name: t("table.split_no_bill"),
            pick: () => this.#splitTable(table.id, null),
          },
        ]
      : party.tableIds.flatMap((id) => {
          const row = this.tables.find((candidate) => candidate.id === id);
          return row === undefined
            ? []
            : [
                {
                  id,
                  name: row.label,
                  pick: () => {
                    this.splitTableId = id;
                    this.actionStep = "split-table-bill";
                  },
                },
              ];
        });
    return html`<section class="actions" data-split-table>
      <h2>
        ${
          choosingBill
            ? t("table.split_table_bill_heading")
                .replace("{table}", () => table.label)
                .replace("{party}", () => scope)
            : t("table.split_table_heading").replace("{party}", () => scope)
        }
      </h2>
      <div class="action-options">
        ${targets.map(
          (target) =>
            html`<wt-button
              class="target"
              data-target=${target.id}
              variant="secondary"
              @click=${target.pick}
            >
              ${target.name}
            </wt-button>`,
        )}
      </div>
      ${this.#backButton()}
    </section>`;
  }

  #splitTable(tableId: string, billId: string | null): void {
    this.#dispatch("split-table", { tableId, billId });
    this.#closeActions();
  }

  #pickBill(bill: PartyBill): void {
    if (this.actionVerb === "merge") {
      this.#dispatch("merge-bills", { fromBillId: bill.workingOrderId });
      this.#closeActions();
    } else {
      this.transferToBillId = bill.workingOrderId;
      this.actionStep = "transfer-lines";
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
    if (this.transferToBillId === null || this.transferLineNos.size === 0) return;
    const transfers: TabTransfer[] = this.lines
      .filter((line) => this.transferLineNos.has(line.lineNo))
      .map((line) => ({ lineNo: line.lineNo }));
    this.#dispatch("transfer-lines", { toBillId: this.transferToBillId, transfers });
    this.#closeActions();
  }

  #toggleSplitLine(line: TabLine): void {
    const next = new Map(this.splitQuantities);
    if (next.has(line.lineNo)) next.delete(line.lineNo);
    else next.set(line.lineNo, this.#displayQty(line.quantity));
    this.splitQuantities = next;
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
  async #confirmSplit(): Promise<void> {
    if (this.splitQuantities.size === 0) return;
    this.splitAttempted = true;
    if (this.#splitErrors().length > 0) {
      await this.updateComplete;
      const form = this.shadowRoot!.querySelector("[data-split-lines]");
      if (form !== null) await focusFirstInvalid(form);
      return;
    }
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
        this.transferToBillId = null;
        this.transferLineNos = new Set();
        this.actionStep = "pick";
        break;
      case "split-lines":
        this.splitQuantities = new Map();
        this.splitAttempted = false;
        this.actionStep = "menu";
        this.actionVerb = null;
        break;
      case "split-table":
        this.actionStep = "menu";
        break;
      case "split-table-bill":
        this.splitTableId = null;
        this.actionStep = "split-table";
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
      case "split-table":
      case "split-table-bill":
        return this.#splitTableStep();
    }
  }

  #actionMenu(): TemplateResult {
    const action = (name: string, key: StringKey, choose: () => void) =>
      html`<wt-button class="action" data-action=${name} variant="secondary" @click=${choose}>
        ${t(key)}
      </wt-button>`;
    const verb = (name: Exclude<ActionVerb, "split">, key: StringKey) =>
      action(name, key, () => this.#chooseVerb(name));
    const party = this.party;
    return html`<section class="actions" data-action-menu>
      <h2>${t("table.actions_title")}</h2>
      <div class="action-options">
        ${verb("move", "table.action_move_guests")} ${verb("join", "table.action_join")}
        ${
          party !== null && party.tableIds.length > 1
            ? action("split-table", "table.action_split_table", () => {
                this.actionStep = "split-table";
              })
            : nothing
        }
        ${party === null ? nothing : action("name", "table.action_name", () => this.#openNaming())}
        ${this.#movable() ? verb("move-bill", "table.action_move_bill") : nothing}
        ${verb("merge", "table.action_merge_bills")} ${verb("transfer", "table.action_transfer")}
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

  /** A bill of the party moves whole unless it is paid or abandoned: the server refuses `bill.paid`
   * and `tab.not_open`. */
  #movable(): boolean {
    return this.party !== null && this.#chargeable();
  }

  #targetPicker(): TemplateResult {
    const forTables =
      this.actionVerb === "move" || this.actionVerb === "join" || this.actionVerb === "move-bill";
    if (forTables) return this.#tablePicker();
    const targets = this.#otherBills().map(({ bill, name }) => ({
      id: bill.workingOrderId,
      name: `${name} · ${this.#money(bill.total)}`,
      pick: () => this.#pickBill(bill),
    }));
    const emptyKey = "table.no_other_bills";
    return html`<section class="actions" data-target-picker>
      <h2>
        ${
          this.actionVerb === "merge"
            ? this.#billsHeading("table.merge_into", { bill: this.orderId })
            : this.#billsHeading("table.transfer_from", { bill: this.orderId })
        }
      </h2>
      ${
        targets.length === 0
          ? html`<p class="empty">${t(emptyKey)}</p>`
          : html`<div class="action-options">
              ${targets.map(
                (target) =>
                  html`<wt-button
                    class="target"
                    data-target=${target.id}
                    variant="secondary"
                    @click=${target.pick}
                  >
                    ${target.name}
                  </wt-button>`,
              )}
            </div>`
      }
      ${this.#backButton()}
    </section>`;
  }

  /** Move guests', Join a table's and Move this bill's list: every table it may name, with its
   * condition, and for a bill the counter first. */
  #tablePicker(): TemplateResult {
    const movingBill = this.actionVerb === "move-bill";
    const targets = this.#tableTargets();
    return html`<section class="actions" data-target-picker>
      <h2>${this.#tablePickerHeading()}</h2>
      ${
        targets.length === 0 && !movingBill
          ? html`<p class="empty">${t("table.no_other_tables")}</p>`
          : html`<div class="action-options">
              ${
                movingBill
                  ? html`<wt-button
                      class="target"
                      data-target="counter"
                      variant="secondary"
                      @click=${() => this.#moveBillToCounter()}
                    >
                      <span class="target-label">${t("table.to_counter")}</span>
                    </wt-button>`
                  : nothing
              }
              ${targets.map((table) =>
                tableTarget(table, this.party?.id, (picked) => this.#pickTable(picked)),
              )}
            </div>`
      }
      ${this.#backButton()}
    </section>`;
  }

  #tablePickerHeading(): string {
    const party = this.party;
    if (party === null) return t("table.actions_title");
    if (this.actionVerb === "move-bill") {
      const bill = this.#shownBillName();
      return bill === undefined
        ? t("table.actions_title")
        : t("table.move_bill_heading").replace("{bill}", () => bill);
    }
    const key = this.actionVerb === "move" ? "table.move_guests_heading" : "table.join_heading";
    return t(key).replace("{party}", () => this.#partyScope(party));
  }

  /** `key` with each `{slot}` replaced by the name of the bill it maps to, or the plain heading when
   * one of those bills is not among the party's shown bills. */
  #billsHeading(key: StringKey, bills: Record<string, string | null | undefined>): string {
    const shown = this.#shownBills();
    let heading = t(key);
    for (const [slot, id] of Object.entries(bills)) {
      const index = shown.findIndex((bill) => bill.workingOrderId === id);
      if (index < 0) return t("table.actions_title");
      heading = heading.replace(`{${slot}}`, () => this.#billName(index));
    }
    return heading;
  }

  #transferLinesStep(): TemplateResult {
    const canConfirm = this.transferToBillId !== null && this.transferLineNos.size > 0;
    // Dishes only. `carveOffLines` REFUSES a directly named child with `tab.transfer_modifier_line`
    // and cascades a dish's children with the dish instead (`apps/server/src/working-order.ts`), so
    // offering a child row here only buys a refusal.
    const lines = this.lines.filter((line) => !this.#isChild(line));
    return html`<section class="actions" data-transfer-lines>
      <h2>
        ${this.#billsHeading("table.transfer_from_to", {
          from: this.orderId,
          to: this.transferToBillId,
        })}
      </h2>
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
      ${
        lines.length === 0
          ? html`<p class="empty">${t("table.split_no_lines")}</p>`
          : html`<div class="action-options">${lines.map((line) => this.#splitLineRow(line))}</div>`
      }
      <wt-form-actions .error=${errors.length > 0 ? t("form.fix_fields") : ""}>
        ${this.#backButton("cancel")}
        <wt-button
          class="transfer-confirm"
          data-split-confirm
          variant="primary"
          ?disabled=${this.splitQuantities.size === 0 || errors.length > 0}
          @click=${() => void this.#confirmSplit()}
        >
          ${t("table.split_confirm")}
        </wt-button>
      </wt-form-actions>
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

  #backButton(slot?: string): TemplateResult {
    return html`<wt-button
      slot=${slot ?? nothing}
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
