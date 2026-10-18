import { DraftStore, type RetainedDraftCandidate } from "../state/draft-sync.js";
import { groupName, groupNumberText } from "../widgets/group-name.js";
import { asServedAllergens, asServedDiet } from "../state/as-served.js";
import {
  nutritionIcons,
  nutritionIconStyles,
  nutritionDietLabels,
} from "../widgets/nutrition-icons.js";
import type { BillEditExpected, LineNutrition } from "../api/client.js";
import "../widgets/order-kitchen-note.js";
import type { SaveKitchenNoteDetail } from "../widgets/order-kitchen-note.js";
import { servicePeriod, servicePeriodStyles } from "../widgets/service-period.js";
import type { MenuState, TillApi } from "../api/client.js";
import { optionAnswers } from "../widgets/option-snapshot.js";
import {
  ContentLanguageController,
  Gestures,
  inNumberOrder,
  leaveCoordinatorFor,
} from "@waitron/ui";
import { pointerElementsAt, scrollAncestors } from "@waitron/ui/src/reorder-table.js";
import type { TillBasket } from "../widgets/basket.js";
import type { DraftScope, LeaveCoordinator, LeaveReason, WtDialog } from "@waitron/ui";
import {
  LitElement,
  type PropertyValues,
  type TemplateResult,
  css,
  html,
  nothing,
  unsafeCSS,
} from "lit";
import { PHONE_WIDTH } from "../widgets/language-chooser-styles.js";
import { customElement, property, state } from "lit/decorators.js";
import { trackDialog } from "../widgets/track-dialog.js";
import { keyed } from "lit/directives/keyed.js";
import { live } from "lit/directives/live.js";
import { repeat } from "lit/directives/repeat.js";
import { type ComboboxOption, baseStyles, focusFirstInvalid, renderFloorChips } from "@waitron/ui";
import "../widgets/fired-ago.js";
import "../widgets/sent-orders.js";
import type { SentLineInfo, SentReorderDetail } from "../widgets/sent-orders.js";
import { sentPanel, type SentSlice } from "../state/sent-panel.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import {
  addDecimal,
  compareDecimal,
  decimal,
  formatMoney,
  multiplyDecimal,
  subtractDecimal,
  perDishOptionQuantity,
  type Decimal,
} from "@waitron/shared";
import { clockTime, countText, currentLocale, named, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
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
import {
  offeredListsOf,
  toWireLineExtras,
  toWireModifiers,
  toWireProductIdentity,
} from "../state/order-line.js";
import "../widgets/basket.js";
import "../widgets/menu-browser.js";
import "../widgets/tender-pay.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "../widgets/menu-switcher.js";
import "../widgets/diet-filter.js";
import "../widgets/modifier-picker.js";
import "../widgets/bill-choice-dialog.js";
import {
  moveBillScope,
  partyScope,
  partyTablesLabel,
  seatedRead,
  tablesLabel,
  tableTarget,
  tableTargetStyles,
  type SeatedRead,
} from "../widgets/table-targets.js";
import { billName, owing, paidInPart, shownBills } from "../state/bill-state.js";
import { receiptLanguageLabel, shownReceiptLanguage } from "../widgets/receipt-language.js";
import {
  LINE_ADJUSTMENTS,
  billGross,
  isStarted,
  lineAdjustTarget,
  listedGross,
  moreThanOneWholeUnit,
  tabLineGross,
} from "../state/adjust-target.js";
import { lineTotal, priceWasStyles } from "../widgets/price-was.js";
import "../widgets/party-name-dialog.js";
import "../widgets/party-guests-dialog.js";
import "../widgets/split-guests-dialog.js";
import "../widgets/table-status.js";
import type { BillChoiceDetail } from "../widgets/bill-choice-dialog.js";
import type { PartyNameDetail } from "../widgets/party-name-dialog.js";
import type { PartyGuestsDetail } from "../widgets/party-guests-dialog.js";
import type { SplitGuestsDetail } from "../widgets/split-guests-dialog.js";
import type { ModifierConfirmDetail } from "../widgets/modifier-picker.js";
import type {
  BillBalance,
  CurrentOrderGroup,
  CurrentOrderRow,
  CurrentOrders,
  FloorZone,
  GroupLine,
  OrderGroup,
  OrderLinePatch,
  SaleLine,
  Station,
  DeadEndAnswer,
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
import type { ConfirmPaymentDetail, RetainedTender } from "../widgets/tender-pay.js";
import type { FireControlMode } from "../widgets/station-queue.js";
import { heldGroupIds, inHeldGroup, sendsAlone } from "../state/held-groups.js";
import { itemCount, type DraftEntry, type DraftGroup } from "../state/draft-groups.js";
import { segmentedOptionStyles } from "../widgets/segmented-control-styles.js";
import type { Place } from "../state/draft-place.js";
import {
  draftLayout,
  fireGroups,
  sendAllGroups,
  type LayoutGroup,
  type SubmitGroup,
} from "../state/draft-layout.js";
import { signalChipStyles, signalChips } from "../widgets/signal-chips.js";
import { billRequestOf } from "../state/table-signals.js";
import { defaultReceiptGuests } from "../state/receipt-guests.js";
import {
  outOfServiceJoined,
  seatsGuests,
  shownName as tableShownName,
} from "../state/floor-today.js";
import type { AdjustKind, AdjustTarget } from "../widgets/adjustment-dialog.js";
import type { PayLine, PayWay } from "../widgets/bill-pay-dialog.js";
import "../widgets/dead-ends-section.js";
import { PAY_WAYS, paidQuantities, payLines } from "../state/bill-payment.js";

export type { TableServiceStatus };

/** The screen's own width, in CSS pixels, from which browsing and the draft show side by side.
 * Narrower, the draft opens on its own Review view. */
export const DRAFT_SIDE_BY_SIDE_MIN_WIDTH = 720;

/** Group `lineIndexes` refer to `sent`, which may be only part of `store.lines`. */
export interface SubmitDraftDetail {
  /** Fresh offers only; recalled rows are identified by `sent` and the saved draft. */
  lines: GroupLine[];
  groups: (DraftGroup & Pick<SubmitGroup, "joinGroupId" | "afterGroupId">)[];
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

export interface SplitDraftSourceDetail {
  store: WorkingOrderStore;
  line: OrderLine;
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

/** The table actions that name a table: Move guests, Join a table and Move this bill. */
type TableVerb = "move" | "join" | "move-bill";
type ActionVerb = TableVerb | "merge" | "transfer" | "split";

interface ActionDraft {
  tableId: string | null;
  toBillId: string | null;
  lines: Set<number>;
  quantities: Map<number, string>;
}

/** Move this bill's choice: to a table, with who the picker showed seated there, or to the counter. */
export interface MoveBillDetail {
  to: { tableId: string; seated: SeatedRead } | { counter: true };
  bills: BillChoiceDetail["bills"];
  prompt?: object;
}

export interface TableRelocationOpenDetail {
  verb: TableVerb;
  table: TableState | null;
  prompt: object;
  ready: () => void;
}

export interface SplitTableDetail {
  tableId: string;
  billId: string | null;
  guests: SplitGuestsDetail;
  prompt?: object;
}

/** The app's answer to a split whose count for one side the server refused: what was sent, and
 * why, shown under that side's field. */
export interface SplitRefusal {
  tableId: string;
  billId: string | null;
  staying: string;
  leaving: string;
  field: "staying" | "leaving";
  message: string;
  prompt?: object;
}

/** A held row whose Move to… is open, on whichever bill of the party it sits. */
interface MovePending {
  expectedEdits: BillEditExpected[] | null;
  lineId: string;
  name: string;
  quantity: string;
  group: OrderGroup;
}

/** What a group's row offers while its group is held: Move always, Split only for `splits`. */
interface HeldRow {
  billId: string | undefined;
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
        .replace("{n}", () => groupNumberText(group))
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
  expectedEdits: BillEditExpected[] | null;
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

export interface AdjustDetail {
  combined?: true;
  kind: AdjustKind;
  target: AdjustTarget;
  /** Opened by the app's Cancel offer, so the message saying why stays on screen. */
  offered?: true;
  /** Pressed in the counter's basket, on the stored order it holds, rather than on the table's
   * open bill. */
  counter?: true;
}

/** `bill-pay`: Pay items, Contribute or Split equally pressed on the bill on screen, with its dishes;
 * `amount` starts a contribution at what the bill still owes. */
export interface BillPayDetail {
  way: PayWay;
  lines: PayLine[];
  amount?: string;
}

/** `change-line`: one sent line's edit, from the copy of the order read at `revision`. */
export interface ChangeLineDetail {
  expectedEdit: BillEditExpected | null;
  lineNo: number;
  /** The line's staff name, for a message about the change shown once another order is open. */
  lineName: string;
  patch: OrderLinePatch;
  revision: number;
  /** The complete edited dish for a station check after a routing refusal. */
  saleLine?: SaleLine;
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

@customElement("till-table-order-screen")
export class TillTableOrderScreen extends LitElement {
  static override styles = [
    priceWasStyles,
    css`
      .modifier-answer,
      .line-note {
        display: block;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
    `,
    baseStyles,
    nutritionIconStyles,
    servicePeriodStyles,
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

      @media ${unsafeCSS(PHONE_WIDTH)} {
        .screen {
          padding-inline: 0;
        }
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
        flex-wrap: wrap;
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

      /* A tab line's course: a dropdown on a held line, a muted read-only label on a fired one. Capped
         so a long course name never crowds out the line total. */
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

      .bill-adjust {
        display: flex;
        justify-content: flex-end;
      }

      .bill-choices,
      .bill-pay-ways {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        margin-top: var(--wt-space-2);
      }

      .line-paid {
        display: block;
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
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

      .sent-fallback {
        border: var(--wt-field-line-width) solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        padding: var(--wt-space-3);
        margin-bottom: var(--wt-space-3);
      }

      .sent-fallback ul {
        list-style: none;
        padding: 0;
        margin: 0;
      }

      .sent-fallback li ul {
        padding-inline-start: var(--wt-space-3);
      }

      .sent-fallback-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: var(--wt-space-3);
        padding-block: var(--wt-space-2);
      }

      .sent-fallback-name {
        min-width: 0;
        overflow-wrap: anywhere;
      }

      .sent-fallback-price {
        flex: 0 0 auto;
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

      .bill-invoice {
        display: block;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .bill-state {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .bill-actions,
      .bill-request,
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

      .finish-refusal-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--wt-space-2);
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

      /* The muted grey fails contrast on the picked line's primary fill. */
      .transfer-line[aria-pressed="true"] .qty {
        color: inherit;
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

      .draft-group {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }

      .draft-group-name {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        margin: 0;
        font-size: var(--wt-font-size-md);
      }

      .draft-select,
      [data-draft-drag-heading] {
        touch-action: none;
        user-select: none;
      }

      [data-draft-dragging] {
        outline: 2px solid var(--wt-color-primary);
        outline-offset: 2px;
      }

      .draft-drop-gap {
        min-height: var(--wt-space-3);
      }

      [data-draft-drag-active] .draft-drop-gap {
        border-block-end: 2px dashed var(--wt-color-primary);
      }

      .draft-group-select {
        flex: 1;
        min-width: 0;
        text-align: start;
        min-height: var(--wt-tap-min);
        overflow-wrap: anywhere;
      }

      .draft-section-name {
        margin: 0;
        padding: var(--wt-space-2);
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-normal);
      }

      /* Native buttons, not wt-buttons: wt-button does not pass aria-pressed to its inner button. */
      .draft-select,
      .transfer-line {
        min-width: var(--wt-tap-min);
        text-align: start;
      }

      .draft-line-name {
        overflow-wrap: anywhere;
      }

      .draft-family-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
        min-height: var(--wt-tap-min);
        text-align: start;
        overflow-wrap: anywhere;
      }

      .draft-unit-chevron {
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        align-self: stretch;
        border: 0;
        border-inline-start: 1px solid var(--wt-color-border);
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        font: inherit;
        font-size: var(--wt-font-size-xl);
        cursor: pointer;
      }

      .draft-unit-chevron:disabled {
        color: var(--wt-color-text-muted);
        cursor: default;
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

      .round-bar {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }

      .draft-routing-warning {
        display: flex;
        align-items: baseline;
        gap: var(--wt-space-2);
      }
      .draft-routing-warning > span {
        color: var(--wt-color-warning);
      }
      .draft-routing-warning till-dead-ends-section {
        flex: 1;
        min-width: 0;
      }
      .draft-line-tools {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: var(--wt-space-2);
        padding-bottom: var(--wt-space-2);
        min-width: 0;
        max-width: 100%;
      }

      [data-flag-warning] {
        color: var(--wt-color-warning);
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
    signalChipStyles,
  ];

  /** The APP owns and reloads them; the drawer, total and badge render from these, never a re-price. */
  @property({ attribute: false }) lines: TabLine[] = [];
  /** ALL sellable products across the zone's menus: a tab may span several menus, and every line must
   * still render its name whatever menu is shown. */
  @property({ attribute: false }) products: TillProduct[] = [];
  @property({ attribute: false }) menus: TillZoneMenu[] = [];
  @property({ attribute: false }) service: MenuState["service"] | null = {
    open: true,
    zoneOpen: true,
    periodName: null,
    periodOccurrenceKey: null,
    zoneKeepOpen: null,
    keepOpen: null,
  };
  @property({ attribute: false }) api?: TillApi;
  @property() zoneId = "";
  @property({ type: Boolean }) orderingAllowed = true;
  @property({ attribute: false }) productSelectable?: (product: TillProduct) => boolean;
  @property() departmentName = "";
  @property() zoneName = "";
  /** Owned by the app; a switcher pick bubbles up as `menu-selected`. */
  @property() selectedMenuId = "";
  @property({ type: Boolean }) menuSelectionRequired = false;
  @property({ attribute: false }) statuses: TableServiceStatus[] = [];
  /** The venue's ACTIVE kitchen courses, in `displayOrder`. */
  @property({ attribute: false }) courses: TillCourse[] = [];
  @property({ attribute: false }) stations: Station[] = [];
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
  @property({ type: Number }) serviceVisit = 0;
  @property() fireControl: FireControlMode = "waiter";
  @property() orderId?: string;
  @property() kitchenNote: string | null = null;
  @property({ type: Number }) kitchenNoteRevision = 0;
  /** The visible half of the app's single-flight fiscal guard. */
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) loading = false;
  @property({ attribute: false }) paymentConfirmation?: RetainedTender;
  /** `false` hides the pay section. */
  @property({ type: Boolean }) canSettle = true;
  /** See the tender card's `takesCash`. */
  @property({ type: Boolean }) takesCash = true;
  /** Mounted inside a card host, which supplies the header; the drawer handle and its badge stay. */
  @property({ type: Boolean }) embedded = false;
  /** The move and join target lists read this; merge and transfer offer {@link bills}. */
  @property({ attribute: false }) tables: TableState[] = [];
  /** The floor's zones, whose service mode decides whether a free table there may take guests. */
  @property({ attribute: false }) zones: FloorZone[] = [];
  /** The party seated at this table, or null for a tab that belongs to none. */
  @property({ attribute: false }) party: TableParty | null = null;
  /** Every bill of {@link party}, merged parties' included. */
  @property({ attribute: false }) bills: PartyBill[] = [];
  /** The receipt languages staff may choose for a bill; the choice shows only when there are several. */
  @property({ attribute: false }) receiptLanguages: string[] = [];
  @property({ type: Boolean }) fullInvoices = false;
  /** The payments of the bill on screen, when it holds any; a balance of another bill is ignored. */
  @property({ attribute: false }) billBalance: BillBalance | null = null;
  /** Finish table was refused because a bill is unpaid. */
  @property({ type: Boolean }) finishRefused = false;
  /** The app's answer to a name the server refused: the name sent, and why, shown beside the field. */
  @property({ attribute: false }) nameRefusal: { name: string; message: string } | null = null;
  /** The app's answer to a guest count the server refused: the count sent, and why. */
  @property({ attribute: false }) guestsRefusal: { value: string; message: string } | null = null;
  @property({ attribute: false }) splitRefusal: SplitRefusal | null = null;
  /** A handheld form factor, whose menu browser shows the menu's handheld display. */
  @property({ type: Boolean }) handheld = false;
  /** The visible half of the app's guard against a second group command while one runs. */
  @property({ type: Boolean }) groupCommandBusy = false;

  @state() private sentLinePending: {
    info: SentLineInfo;
    api: TillApi | undefined;
    partyId: string | null;
    billId: string | undefined;
    visit: number;
  } | null = null;
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
  @property({ attribute: false }) billEdit: BillEditExpected | null = null;
  @property({ attribute: false }) routingRevision: number | null = null;
  @property({ attribute: false }) billEdits: readonly BillEditExpected[] = [];
  /** The venue's setting. When off, the server refuses to change or recall a sent line that has a
   * ticket item, so those lines offer Cancel instead. */
  @property({ attribute: false }) editSentLines = true;
  /** Set by the app when a change was refused because the kitchen had started the line: that line's
   * Cancel opens. */
  @property({ attribute: false }) cancelOffer: number | null = null;

  /** The held group whose Fire waits for confirmation. */
  @state() private fireGroupPending: OrderGroup | null = null;
  #fireAuthority?: {
    api: TillApi | undefined;
    partyId: string | null;
    billId: string | undefined;
    visit: number;
  };
  /** The held line whose Move to… picker is open, with the group it is in. */
  @state() private movePending: MovePending | null = null;
  /** A row whose Mark served, or its undo, asks how many; `count` is what is chosen so far. */
  @state() private servePending: { row: CurrentOrderRow; undo: boolean; count: Decimal } | null =
    null;

  #serveAuthority?: {
    api: TillApi | undefined;
    partyId: string | null;
    billId: string | undefined;
    visit: number;
  };

  readonly #serveId = {};
  #serveScope?: DraftScope<Decimal>;
  #serveBaseline?: Decimal;
  #serveLeave?: LeaveCoordinator;
  #serveOpening = 0;
  readonly #beforeServeClose = async (reason: LeaveReason): Promise<boolean> => {
    const opening = this.#serveOpening;
    const outcome = await this.#serveLeave!.request({
      scopes: [this.#serveId],
      reason,
      proceed() {},
    });
    return outcome === "proceeded" && opening === this.#serveOpening;
  };

  #watchServe(): void {
    if (this.servePending === null) {
      this.#serveScope?.dispose();
      this.#serveScope = undefined;
      this.#serveBaseline = undefined;
      return;
    }
    if (this.#serveScope) return;
    this.#serveLeave = leaveCoordinatorFor(this);
    if (!this.#serveLeave) return;
    this.#serveBaseline ??= this.servePending.count;
    this.#serveScope = this.#serveLeave.register<Decimal>({
      id: this.#serveId,
      parent: this,
      current: () => this.servePending!.count,
      snapshot: (value) => value,
      equal: (a, b) => compareDecimal(a, b) === 0,
      restore: (count) => {
        if (this.servePending) this.servePending = { ...this.servePending, count };
      },
    });
    this.#serveScope.commit(this.#serveBaseline);
  }

  #closeServe(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || !this.isConnected || !this.servePending) return;
    this.servePending = null;
    this.#watchServe();
  }

  #dismissServe(): void {
    if (!this.isConnected || !this.servePending) return;
    if (this.#serveScope) {
      void this.renderRoot.querySelector<WtDialog>("[data-serve-dialog]")!.requestClose("cancel");
    } else {
      this.servePending = null;
    }
  }

  /** The line open in the Change editor. */
  @state() private changeLine: TabLine | null = null;
  /** Built once when the editor opens, not per render: the picker seeds from these once. */
  #changeProduct?: TillProduct;
  #changeSelection?: LineSelection;
  #changeRevision = 0;
  #changeExpectedEdit: BillEditExpected | null = null;

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
  @state() private billChoice: { verb: TableVerb; table: TableState; prompt?: object } | null =
    null;
  #relocationPrompt: object | null = null;
  /** The party-name dialog, while open: the name it starts from and a refusal beside the field. */
  @state() private naming: { value: string; refusal: string } | null = null;
  @state() private counting: { value: string; refusal: string } | null = null;
  /** Split a table's choice, while its guests window is open. */
  @state() private splitGuests: {
    tableId: string;
    billId: string | null;
    staying: string;
    leaving: string;
    refusal: { field: "staying" | "leaving"; message: string } | null;
    prompt?: object;
  } | null = null;
  @state() private transferToBillId: string | null = null;
  /** A NEW Set is assigned on every mutation so Lit re-renders (a Set is not deeply reactive). */
  @state() private transferLineNos = new Set<number>();
  /** Kept separate from the whole-line transfer picker so quantity choices cannot change that flow. */
  @state() private splitQuantities = new Map<number, string>();
  @state() private splitAttempted = false;

  readonly #actionId = {};
  #actionScope?: DraftScope<ActionDraft>;
  #actionBaseline?: ActionDraft;
  #actionLeave?: LeaveCoordinator;
  #actionOpening = 0;

  #actionControlCurrent(event: Event): boolean {
    const control = event.currentTarget as HTMLElement;
    return (
      this.isConnected &&
      !this.busy &&
      control.isConnected &&
      control.getRootNode() === this.renderRoot
    );
  }

  #actionPayload(): ActionDraft {
    return {
      tableId: this.splitTableId,
      toBillId: this.transferToBillId,
      lines: new Set(this.transferLineNos),
      quantities: new Map(this.splitQuantities),
    };
  }

  #watchActions(): void {
    if (
      this.actionVerb !== "split" &&
      this.actionVerb !== "transfer" &&
      this.actionStep !== "split-table" &&
      this.actionStep !== "split-table-bill"
    ) {
      this.#retireActions();
      return;
    }
    if (this.#actionScope) return;
    this.#actionLeave = leaveCoordinatorFor(this);
    if (!this.#actionLeave) return;
    this.#actionBaseline ??= this.#actionPayload();
    this.#actionScope = this.#actionLeave.register<ActionDraft>({
      id: this.#actionId,
      parent: this,
      current: () => this.#actionPayload(),
      snapshot: (value) => ({
        ...value,
        lines: new Set(value.lines),
        quantities: new Map(value.quantities),
      }),
      equal: (a, b) =>
        a.tableId === b.tableId &&
        a.toBillId === b.toBillId &&
        a.lines.size === b.lines.size &&
        [...a.lines].every((line) => b.lines.has(line)) &&
        a.quantities.size === b.quantities.size &&
        [...a.quantities].every(([line, quantity]) => b.quantities.get(line) === quantity),
      restore: (value) => {
        this.splitTableId = value.tableId;
        this.transferToBillId = value.toBillId;
        this.transferLineNos = new Set(value.lines);
        this.splitQuantities = new Map(value.quantities);
        this.splitAttempted = false;
      },
    });
    this.#actionScope.commit(this.#actionBaseline);
  }

  #retireActions(): void {
    this.#actionOpening++;
    this.#actionScope?.dispose();
    this.#actionScope = undefined;
    this.#actionBaseline = undefined;
    this.#actionLeave = undefined;
  }

  /** The party's draft for the signed-in person, owned by the app; null until the app has read it and
   * the party's groups. Unset, the screen keeps a draft of its own. */
  @property({ attribute: false }) draftStore?: WorkingOrderStore | null;

  readonly #ownDraft = new WorkingOrderStore();

  @property({ attribute: false }) otherDrafts: readonly OtherDraft[] = [];
  @property({ attribute: false }) retainedDraft: RetainedDraftCandidate | null = null;
  @property({ type: Boolean }) candidateReviewAllowed = false;
  @property({ type: Boolean }) candidateReviewBusy = false;
  /** Moved on by the app each time a take-over it was asked for has answered, or failed. */
  @property({ attribute: false }) takeOversAnswered = 0;
  /** The draft whose take-over has just answered, until its dialog has closed. */
  #takeOverAnswered?: string;
  /** The draft whose take-over is being asked about. */
  @state() private takeOverPending: OtherDraft | null = null;
  /** {@link takeOversAnswered} when a take-over was sent; unset while none is out. */
  @state() private takeOverSent: number | null = null;

  get #draftStore(): WorkingOrderStore | null {
    const store = this.draftStore === undefined ? this.#ownDraft : this.draftStore;
    if (store !== null)
      store.canSelectProduct = (product) =>
        this.orderingAllowed &&
        this.productSelectable?.(product) !== false &&
        this.menus.some((menu) => menu.id === product.catalogueId && menu.orderable);
    return store;
  }

  /** The draft this screen re-renders on. */
  #watchedDraft?: { store: WorkingOrderStore | null; stop: () => void };

  #watchDraft(): void {
    const store = this.#draftStore;
    if (this.#watchedDraft !== undefined && this.#watchedDraft.store === store) return;
    this.#watchedDraft?.stop();
    this.#draftEpoch++;
    this.#endDraftDrag();
    this.#cancelAutomaticRouting();
    this.#routingChecked = undefined;
    this.#selected = new WeakSet();
    this.#routingRows = new WeakMap();
    this.draftMoveStore = null;
    if (store === null) {
      this.#watchedDraft = { store, stop: () => {} };
      return;
    }
    this.#noteDraftStart(store);
    this.#watchedDraft = {
      store,
      stop: store.subscribe(() => {
        this.#draftEpoch++;
        this.#endDraftDrag();
        this.#cancelAutomaticRouting();
        if (store.sending) this.draftMoveStore = null;
        if (store.editsLocked) {
          this.draftMoveStore = null;
          this.#selected = new WeakSet();
          this.#closeChange();
        }
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
    } else {
      this.#draftOf(store);
    }
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("pointerdown", this.#pressDraft, true);
    this.addEventListener("click", this.#draftClick, true);
    this.addEventListener("keydown", this.#draftKey, true);
    this.#draftGestures = new Gestures(this, {
      holdStart: () => {
        if (this.#draftPressCurrent()) {
          this.#suppressDraftClick = true;
          this.draftDragging = true;
        }
      },
      holdDrop: ({ x, y }) => this.#dropDraft(x, y),
      longPress: () => this.#openHeldDraftLine(),
      pan: ({ dy }) => this.#panDraft(dy),
      cancel: () => this.#endDraftDrag(),
    });
    this.requestUpdate();
    this.#watchDraft();
    this.#measure(this.getBoundingClientRect().width);
    if (this.hasUpdated) this.#observeWidth();
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
    this.removeEventListener("pointerdown", this.#pressDraft, true);
    this.removeEventListener("click", this.#draftClick, true);
    this.removeEventListener("keydown", this.#draftKey, true);
    this.#draftGestures?.disconnect();
    this.#draftGestures = undefined;
    this.#endDraftDrag();
    super.disconnectedCallback();
    this.#serveScope?.dispose();
    this.#serveScope = undefined;
    this.#serveLeave = undefined;
    this.#actionOpening++;
    this.#actionScope?.dispose();
    this.#actionScope = undefined;
    this.#actionLeave = undefined;
    this.#cancelAutomaticRouting();
    this.#routingChecked = undefined;
    this.#watchedDraft?.stop();
    this.#watchedDraft = undefined;
    this.#resizing?.disconnect();
    this.#resizing = undefined;
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
  #draftGestures?: Gestures;
  #draftEpoch = 0;
  @state() private draftDragging = false;
  #suppressDraftClick = false;
  #draftPress?: {
    store: WorkingOrderStore;
    lines: readonly OrderLine[];
    chosen: readonly OrderLine[];
    generation: number;
    control: HTMLElement;
    group: LayoutGroup | undefined;
    api: TillApi | undefined;
    scope: string;
    groups: string;
  };

  #draftDragScope(): string {
    return JSON.stringify([this.orderId, this.party?.id, this.serviceVisit]);
  }

  #draftDragGroups(): string {
    return JSON.stringify([
      this.currentOrders?.revision,
      this.groups.map(({ id, state, position }) => [id, state, position]),
    ]);
  }

  readonly #pressDraft = (event: PointerEvent): void => {
    this.#endDraftDrag();
    this.#suppressDraftClick = false;
    if (event.button !== 0) return;
    const store = this.#draftStore;
    if (store === null) return;
    const path = event.composedPath();
    if (path.some((node) => node instanceof HTMLElement && node.localName === "wt-row-actions"))
      return;
    const control = path.find(
      (node): node is HTMLElement =>
        node instanceof HTMLElement &&
        (node.hasAttribute("data-draft-select") || node.hasAttribute("data-draft-drag-heading")),
    );
    if (control === undefined) return;
    const group = this.#draftLayout(store).find(
      (group) => group.key === control.dataset.draftDragHeading,
    );
    const line = store.lines[Number(control.dataset.draftSelect)];
    const chosen =
      group === undefined
        ? line === undefined
          ? []
          : this.#selected.has(line)
            ? store.lines.filter((candidate) => this.#selected.has(candidate))
            : [line]
        : group.sections.flatMap(({ indexes }) => indexes.map((index) => store.lines[index]!));
    if (chosen.length === 0) return;
    this.#draftPress = {
      store,
      lines: [...store.lines],
      chosen,
      generation: store.loadGeneration,
      control,
      group,
      api: this.api,
      scope: this.#draftDragScope(),
      groups: this.#draftDragGroups(),
    };
  };

  #canDragDraft(store: WorkingOrderStore): boolean {
    return (
      this.isConnected &&
      store === this.#draftStore &&
      !store.editsLocked &&
      !store.sending &&
      !this.busy &&
      !this.groupCommandBusy &&
      !this.currentOrdersUnread &&
      this.orderingAllowed
    );
  }

  #draftPressCurrent(): boolean {
    const press = this.#draftPress;
    return (
      press !== undefined &&
      this.#canDragDraft(press.store) &&
      press.api === this.api &&
      press.scope === this.#draftDragScope() &&
      press.groups === this.#draftDragGroups() &&
      press.generation === press.store.loadGeneration &&
      press.lines.length === press.store.lines.length &&
      press.lines.every((line, index) => line === press.store.lines[index])
    );
  }

  readonly #draftClick = (event: MouseEvent): void => {
    if (!this.#suppressDraftClick) return;
    if (
      event
        .composedPath()
        .some(
          (node) =>
            node instanceof HTMLElement &&
            (node.hasAttribute("data-draft-select") ||
              node.hasAttribute("data-draft-group-select")),
        )
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  readonly #draftKey = (event: KeyboardEvent): void => {
    this.#suppressDraftClick = false;
    if (event.key === "Escape") this.#endDraftDrag();
  };

  #endDraftDrag(): void {
    this.#draftPress = undefined;
    this.draftDragging = false;
  }

  #panDraft(dy: number): void {
    const press = this.#draftPress;
    if (press === undefined) return;
    this.#suppressDraftClick = true;
    for (const target of [...scrollAncestors(press.control).slice(1), document.scrollingElement]) {
      if (!(target instanceof HTMLElement)) continue;
      if (
        target !== document.scrollingElement &&
        !/auto|scroll/.test(getComputedStyle(target).overflowY)
      )
        continue;
      const before = target.scrollTop;
      target.scrollTop -= dy;
      if (target.scrollTop !== before) break;
    }
  }

  #openHeldDraftLine(): void {
    const press = this.#draftPress;
    if (press !== undefined && press.group === undefined && this.#draftPressCurrent()) {
      const index = Number(press.control.dataset.draftSelect);
      const basket = [...this.renderRoot.querySelectorAll<TillBasket>("till-basket")].find(
        (basket) => basket.lineIndexes?.includes(index),
      );
      basket?.shadowRoot?.querySelector<HTMLElement>(`[data-line-detail="${index}"]`)?.click();
    }
    this.#endDraftDrag();
  }

  #dropDraft(x: number, y: number): void {
    const press = this.#draftPress;
    if (press === undefined || !this.draftDragging || !this.#draftPressCurrent()) {
      this.#endDraftDrag();
      return;
    }
    const path = pointerElementsAt(x, y);
    if (!path.includes(this)) {
      this.#endDraftDrag();
      return;
    }
    const gap = path.find((node) => node.hasAttribute("data-draft-gap")) as HTMLElement | undefined;
    const target = path.find((node) => node.hasAttribute("data-draft-group")) as
      HTMLElement | undefined;
    const held = path.find((node) => node.hasAttribute("data-held-group")) as
      HTMLElement | undefined;
    const layout = this.#draftLayout(press.store);
    const group = layout.find((group) => group.key === target?.dataset.draftGroup);
    const indexes = press.chosen.map((line) => press.store.lines.indexOf(line));
    if (press.group !== undefined) {
      const slots = layout.filter((group) => group.kind === "new");
      const from = slots.findIndex((group) => group.key === press.group!.key);
      let to = slots.findIndex((entry) => entry.key === group?.key);
      if (to >= 0 && target !== undefined) {
        const rect = target.querySelector("h3")!.getBoundingClientRect();
        if (y >= rect.y + rect.height / 2) to++;
      } else if (gap !== undefined) {
        to =
          gap.dataset.draftGap === "end"
            ? slots.length
            : slots.findIndex((entry) => entry.key === gap.dataset.draftGap);
      }
      if (to >= 0 && from >= 0) {
        to -= from < to ? 1 : 0;
        if (slots[to] !== undefined) press.store.moveSlot(press.group.slot!, slots[to]!.slot!);
      }
    } else if (gap !== undefined) {
      const next =
        gap.dataset.draftGap === "end"
          ? layout.length
          : layout.findIndex((group) => group.key === gap.dataset.draftGap);
      const previous = layout[next - 1];
      const first = layout[next];
      const sourcePlace =
        previous === undefined
          ? undefined
          : press.store.lines[previous.sections[0]!.indexes[0]!]!.place;
      const afterGroupId =
        previous?.kind === "join"
          ? previous.groupId!
          : sourcePlace?.kind === "new"
            ? sourcePlace.afterGroupId
            : undefined;
      const slot =
        previous?.kind === "new"
          ? previous.slot! + 1
          : previous?.kind === "join"
            ? Math.max(0, ...layout.map((group) => group.slot ?? 0)) + 1
            : first?.kind === "new"
              ? first.slot!
              : 1;
      if (next >= 0)
        press.store.setLinePlaces(
          indexes,
          {
            kind: "new",
            slot,
            ...(afterGroupId === undefined ? {} : { afterGroupId }),
          },
          { from: slot },
        );
    } else if (group !== undefined && !group.invalidTarget) {
      const place = press.store.lines[group.sections[0]!.indexes[0]!]!.place ?? { kind: "fire" };
      press.store.setLinePlaces(indexes, place);
    } else if (
      held !== undefined &&
      this.groups.some((group) => group.id === held.dataset.heldGroup && group.state === "held")
    ) {
      press.store.setLinePlaces(indexes, { kind: "join", groupId: held.dataset.heldGroup! });
    }
    this.#endDraftDrag();
  }
  #routingRows = new WeakMap<
    OrderLine,
    { row: DeadEndAnswer["deadEnds"][number]; stations: DeadEndAnswer["stations"] }
  >();
  @state() private draftMoveStore: WorkingOrderStore | null = null;
  /** Flagged lines the person chose to keep, which no longer ask Remove or Keep. */
  #kept = new WeakSet<OrderLine>();
  #routingTimer?: ReturnType<typeof setTimeout>;
  #routingChecked?: string;
  #automaticRouting?: {
    checkId: number;
    store: WorkingOrderStore;
    sent: readonly OrderLine[];
    key: string;
    api: TillApi | undefined;
  };

  #routingKey(): string | undefined {
    const edit = this.billEdit;
    if (
      this.routingRevision === null ||
      edit === null ||
      edit.billId !== this.orderId ||
      edit.draftId === null ||
      edit.draftRevision !== this.routingRevision
    )
      return undefined;
    return JSON.stringify([edit.billId, edit.editorVersion, edit.draftId, edit.draftRevision]);
  }

  #cancelAutomaticRouting(): void {
    clearTimeout(this.#routingTimer);
    this.#routingTimer = undefined;
    this.#automaticRouting = undefined;
  }

  #automaticRoutingCurrent(): boolean {
    const check = this.#automaticRouting;
    return (
      check !== undefined &&
      this.isConnected &&
      check.store === this.#draftStore &&
      check.key === this.#routingKey() &&
      check.api === this.api &&
      !check.store.sending &&
      !check.store.editsLocked &&
      !this.groupCommandBusy &&
      check.sent.length === check.store.lines.length &&
      check.sent.every((line, index) => line === check.store.lines[index])
    );
  }

  #watchAutomaticRouting(): void {
    const store = this.#draftStore;
    const key = this.#routingKey();
    if (
      !this.isConnected ||
      store === null ||
      store.lineCount === 0 ||
      key === undefined ||
      store.sending ||
      store.editsLocked ||
      this.groupCommandBusy
    ) {
      this.#cancelAutomaticRouting();
      return;
    }
    if (this.#routingChecked === key || this.#automaticRouting?.key === key) return;
    this.#cancelAutomaticRouting();
    const check = { checkId: ++this.#checkId, store, sent: [...store.lines], key, api: this.api };
    this.#automaticRouting = check;
    this.#routingTimer = setTimeout(() => {
      this.#routingTimer = undefined;
      if (!this.#automaticRoutingCurrent()) return;
      this.#routingChecked = key;
      this.dispatchEvent(
        new CustomEvent("check-dead-ends", {
          detail: { sent: check.sent, checkId: check.checkId, automatic: true },
          bubbles: true,
          composed: true,
          cancelable: true,
        }),
      );
    }, 400);
  }

  #checkId = 0;
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
  #lineByNo = new Map<number, TabLine>();
  #dishesWithExtras = new Set<number>();

  constructor() {
    super();
    new ContentLanguageController(this);
  }

  #kitchenNoteVisit = 0;

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("draftStore")) this.#kitchenNoteVisit++;
    if (this.sentLinePending !== null && this.#sentLine() === undefined)
      this.sentLinePending = null;
    this.#watchDraft();
    if (this.takeOverSent !== null && this.takeOversAnswered !== this.takeOverSent) {
      this.#takeOverAnswered = this.takeOverPending?.id;
      this.takeOverSent = null;
      this.takeOverPending = null;
    }
    // The gross map is filled BEFORE the total is summed from it below.
    if (changed.has("lines") || this.#payStore === undefined) {
      this.#lineGrossByLineNo = new Map(
        this.lines.map((line) => [line.lineNo, tabLineGross(line)]),
      );
      this.#payStore = new TabPayStore(
        billGross(this.lines, (line) => this.#lineGross(line)),
        this.lines.length,
      );
      this.#lineById = new Map(this.lines.map((line) => [line.id, line]));
      this.#lineByNo = new Map(this.lines.map((line) => [line.lineNo, line]));
      this.#dishesWithExtras = new Set(this.lines.flatMap((line) => line.parentLineNo ?? []));
    }
    // A tab switch must not carry a half-open action flow across: its targets belong to the OLD tab.
    if (changed.has("orderId") && changed.get("orderId") !== undefined) {
      this.#closeActions();
      this.#closeChange();
      this.fireGroupPending = null;
      this.movePending = null;
      this.servePending = null;
      this.reviewing = false;
      this.#browsingScroll = undefined;
    }
    this.#watchServe();
    this.#watchActions();
    if (changed.has("busy") && this.busy) this.#actionScope?.changed();
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
    if (changed.has("nameRefusal") && this.nameRefusal !== null) {
      this.naming = { value: this.nameRefusal.name, refusal: this.nameRefusal.message };
    }
    if (changed.has("guestsRefusal") && this.guestsRefusal !== null) {
      this.counting = { value: this.guestsRefusal.value, refusal: this.guestsRefusal.message };
    }
    if (changed.has("splitRefusal") && this.splitRefusal !== null) {
      const { tableId, billId, staying, leaving, field, message, prompt } = this.splitRefusal;
      this.splitGuests = { tableId, billId, staying, leaving, refusal: { field, message }, prompt };
    }
    // The app re-points this screen at whichever party holds the table, so a window opened for the
    // old party would otherwise save to the new one. A screen drawn afresh counts its first party as
    // a switch, which keeps a refusal the app still holds from reopening its window.
    const partySwitched = changed.has("party") && changed.get("party")?.id !== this.party?.id;
    if (partySwitched) {
      this.naming = null;
      this.counting = null;
    }
    if (
      this.splitGuests !== null &&
      (partySwitched || !this.party?.tableIds.includes(this.splitGuests.tableId))
    ) {
      this.splitGuests = null;
    }
    if (changed.has("cancelOffer") && this.cancelOffer !== null) {
      const offered = this.lines.find(
        (line) => line.lineNo === this.cancelOffer && !this.#isChild(line),
      );
      this.#offeredCancel = offered;
      this.#offerTaken = true;
    }
  }

  /** The app clears its offer on this event, so a screen mounted later (a handheld's Order tab coming
   * back) does not open it again. Taken even when the line is gone, for the same reason. */
  override updated(): void {
    this.#watchAutomaticRouting();
    if (!this.#offerTaken) return;
    this.#offerTaken = false;
    const offered = this.#offeredCancel;
    this.#offeredCancel = undefined;
    if (offered !== undefined) this.#adjust("cancel", this.#lineTarget(offered), { offered: true });
    this.dispatchEvent(
      new CustomEvent("cancel-offer-taken", { detail: {}, bubbles: true, composed: true }),
    );
  }

  #offerTaken = false;
  #offeredCancel: TabLine | undefined;

  #lineGross(line: TabLine): Decimal {
    return this.#lineGrossByLineNo.get(line.lineNo)!;
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
      quantity: line.quantity,
      wholeUnits: countsWholeUnits(line),
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

  refreshDraftRouting(store: WorkingOrderStore, sent: readonly OrderLine[]): void {
    if (
      !this.isConnected ||
      store !== this.#draftStore ||
      sent.some((line) => !store.lines.includes(line))
    )
      return;
    this.#cancelAutomaticRouting();
    this.#routingChecked = undefined;
    this.requestUpdate();
  }

  currentDeadEndsCheck(checkId: number): boolean {
    return this.#automaticRouting?.checkId === checkId && this.#automaticRoutingCurrent();
  }

  answerDeadEnds(sent: readonly OrderLine[], answer?: DeadEndAnswer, checkId?: number): void {
    if (checkId !== undefined && !this.currentDeadEndsCheck(checkId)) return;
    const automatic = this.#automaticRouting;
    if (automatic !== undefined && automatic.checkId === checkId) {
      if (answer === undefined) return;
      const rows = answer.deadEnds.flatMap((row) => {
        const line = sent[Number(row.key)];
        return line === undefined ? [] : [[line, row] as const];
      });
      for (const line of sent) this.#routingRows.delete(line);
      for (const [line, row] of rows) {
        if (
          line.makeAt !== undefined &&
          !answer.stations.some((station) => station.id === line.makeAt)
        )
          automatic.store.setLineMakeAt(automatic.store.lines.indexOf(line), undefined);
        this.#routingRows.set(line, { row, stations: answer.stations });
      }
      this.requestUpdate();
      return;
    }
  }

  #coursePicker(
    attrs: { lineCourse?: number; roundCourse?: number },
    lineName: string,
    selected: string,
    empty: string,
    onPick: (courseId: string) => void,
    retainedCourse?: TillCourse,
  ): TemplateResult {
    const options: ComboboxOption[] = [
      { value: "", label: empty },
      ...this.courses.map((course) => ({ value: course.id, label: course.name })),
    ];
    return html`<wt-combobox
      class=${attrs.lineCourse === undefined ? nothing : "line-course"}
      data-line-course=${attrs.lineCourse ?? nothing}
      data-round-course=${attrs.roundCourse ?? nothing}
      name="course"
      label=${`${t("table.course_label")} · ${lineName}`}
      hide-label
      search="auto"
      searchPlaceholder=${t("form.combobox_search")}
      noResultsLabel=${t("form.combobox_no_results")}
      placeholder=${retainedCourse?.id === selected && !this.courses.some((course) => course.id === selected) ? retainedCourse.name : empty}
      .options=${options}
      .value=${live(selected)}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        onPick(event.detail.value);
      }}
    ></wt-combobox>`;
  }

  #makeAtPicker(
    store: WorkingOrderStore,
    line: OrderLine,
    index: number,
    name: string,
  ): TemplateResult {
    const rules = "__make_at_rules__";
    const options: ComboboxOption[] = [
      { value: rules, label: t("move_station.rules") },
      ...this.stations.map((station) => ({
        value: station.id,
        label: station.open
          ? station.name
          : t("dead_end.station_closed").replace("{station}", () => station.name),
      })),
    ];
    return html`<wt-combobox
      data-make-at=${index}
      name="make-at"
      label=${`${t("move_station.make_at")} · ${name}`}
      ?disabled=${!this.#canEditDraftLine(store, line)}
      search="never"
      .options=${options}
      .value=${this.stations.some((station) => station.id === line.makeAt) ? line.makeAt! : rules}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        if (!this.#canEditDraftLine(store, line)) return;
        store.setLineMakeAt(
          store.lines.indexOf(line),
          event.detail.value === rules ? undefined : event.detail.value,
        );
      }}
    ></wt-combobox>`;
  }

  #setLineCourse(lineNo: number, courseId: string | null): void {
    this.dispatchEvent(
      new CustomEvent("set-line-course", {
        detail: {
          lineNo,
          courseId,
          expectedEdit: this.billEdit === null ? null : { ...this.billEdit },
        },
        bubbles: true,
        composed: true,
      }),
    );
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
    if (this.#isChild(line) || isStarted(line) || this.#lockedBySetting(line)) return false;
    if (line.state !== null && line.sentAt === null && !inHeldGroup(line, this.#heldGroupIds!))
      return false;
    return this.#liveProduct(line) !== undefined;
  }

  #canRecall(line: TabLine): boolean {
    const served = (row: CurrentOrderRow) =>
      row.lineId === line.id && compareDecimal(decimal(row.servedQuantity), decimal("0")) > 0;
    if (
      this.currentOrders?.ungrouped.some(served) ||
      this.currentOrders?.groups.some((group) => group.rows.some(served))
    )
      return false;
    return (
      this.editSentLines &&
      !this.#isChild(line) &&
      line.servedAt === null &&
      !isStarted(line) &&
      (this.#shownBill === undefined || this.#shownBill.status === "open") &&
      !this.lines.some((extra) => extra.parentLineNo === line.lineNo && isStarted(extra)) &&
      (line.sentAt !== null || inHeldGroup(line, this.#heldGroupIds!))
    );
  }

  /** Every sent line with a ticket item, a fired one, and every dish in a held group, a no-route one
   * included: whatever else a line offers, cancelling it always has a button. A held line outside a
   * group keeps Send alone. An extra without its own ticket item follows its dish. */
  #canCancel(line: TabLine): boolean {
    if (this.#isChild(line) && line.state === null) {
      const dish = this.#lineByNo.get(line.parentLineNo!);
      return dish !== undefined && this.#canCancel(dish);
    }
    if (inHeldGroup(line, this.#heldGroupIds!)) return true;
    const queued = line.state === "queued" && (line.firedAt !== null || line.sentAt !== null);
    return isStarted(line) || queued;
  }

  /** An extras row offers only Cancel, Give away and Discount, which take it on its own. */
  #lineActions(line: TabLine): TemplateResult | typeof nothing {
    const name = this.#adjustName(line);
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
          .disabled=${this.busy || this.groupCommandBusy || this.#draftStore?.sending || this.#draftStore?.editsLocked}
          aria-label=${label("table.recall_line")}
          @click=${() => this.#recallLine(line.lineNo)}
        >
          ${t("table.recall_line")}
        </wt-button>`,
      );
    if (line.movable && this.orderId !== undefined)
      actions.push(
        this.#moveStationButton(line.lineNo, {
          workingOrderId: this.orderId,
          lineId: line.id,
          name,
          stationId: line.stationId,
        }),
      );
    if (this.#canCancel(line))
      actions.push(
        html`<wt-button
          class="line-cancel"
          size="sm"
          variant="danger"
          data-cancel-line=${line.lineNo}
          aria-label=${label("table.cancel_line")}
          @click=${() => this.#adjust("cancel", this.#lineTarget(line))}
        >
          ${t("table.cancel_line")}
        </wt-button>`,
      );
    actions.push(...this.#adjustActions(line));
    return actions.length === 0 ? nothing : html`<span class="line-actions">${actions}</span>`;
  }

  /** A bill with no party is adjusted from the counter's basket, not from this screen. */
  #adjustable(): boolean {
    return (
      this.party !== null && (this.#shownBill === undefined || this.#shownBill.status === "open")
    );
  }

  /** Give away and Discount on a dish, which cover its extras, and on an extra alone. */
  #adjustActions(line: TabLine): TemplateResult[] {
    if (!this.#adjustable()) return [];
    const name = this.#adjustName(line);
    return LINE_ADJUSTMENTS.map(
      ({ kind, label }) =>
        html`<wt-button
          class="line-adjust"
          size="sm"
          variant="secondary"
          data-comp-line=${kind === "comp" ? line.lineNo : nothing}
          data-discount-line=${kind === "discount" ? line.lineNo : nothing}
          aria-label=${`${t(label)} · ${name}`}
          @click=${() => this.#adjust(kind, this.#lineTarget(line))}
        >
          ${t(label)}
        </wt-button>`,
    );
  }

  #lineTarget(line: TabLine): AdjustTarget {
    return lineAdjustTarget(line, this.lines, this.#adjustName(line), (row) =>
      this.#lineGross(row),
    );
  }

  /** A dish's name, and an extra's with its dish's, so two extras of one name can be told apart. */
  #adjustName(line: TabLine): string {
    const dish = this.#isChild(line) ? this.#lineByNo.get(line.parentLineNo!) : undefined;
    return dish === undefined
      ? this.#nameForLine(line)
      : t("table.extra_of")
          .replace("{extra}", () => this.#nameForLine(line))
          .replace("{dish}", () => this.#nameForLine(dish));
  }

  #adjust(kind: AdjustKind, target: AdjustTarget, also: { offered?: true } = {}): void {
    const detail: AdjustDetail = { kind, target, ...also };
    this.dispatchEvent(new CustomEvent("adjust", { detail, bubbles: true, composed: true }));
  }

  /** Discount on the bill on screen, named as the bills list names it. */
  #billAdjust(): TemplateResult | typeof nothing {
    if (!this.#adjustable() || this.lines.length === 0) return nothing;
    const index = this.#shownBills().findIndex((bill) => bill.workingOrderId === this.orderId);
    const name = index === -1 ? t("adjust.whole_bill") : this.#billName(index);
    return html`<div class="bill-adjust">
      <wt-button
        size="sm"
        variant="secondary"
        data-discount-bill
        @click=${() =>
          this.#adjust("discount", {
            lineId: null,
            name,
            quantity: null,
            total: this.#payStore!.total,
            unitTotal: null,
          })}
      >
        ${t("table.discount_bill")}
      </wt-button>
    </div>`;
  }

  #lineTotal(line: TabLine): TemplateResult {
    return lineTotal(listedGross(line), this.#lineGross(line));
  }

  #sendLine(lineNo: number): void {
    this.dispatchEvent(
      new CustomEvent("send-lines", {
        detail: {
          lineNos: [lineNo],
          expectedEdit: this.billEdit === null ? null : { ...this.billEdit },
        },
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

  #moveStationButton(
    lineNo: number,
    detail: { workingOrderId: string; lineId: string; name: string; stationId: string | null },
  ): TemplateResult {
    return html`<wt-button
      size="sm"
      variant="secondary"
      data-move-station=${lineNo}
      aria-label=${`${t("table.move_station")} · ${detail.name}`}
      @click=${() => this.dispatchEvent(new CustomEvent("move-station", { detail, bubbles: true, composed: true }))}
      >${t("table.move_station")}</wt-button
    >`;
  }

  #openChange(line: TabLine): void {
    const live = this.#liveProduct(line)!;
    const offered = offeredListsOf(live);
    const sendsExtras = offered.some((entry) => entry.kind === "extras");
    const extras: SelectedExtra[] = [];
    for (const child of this.lines.filter((row) => row.parentLineNo === line.lineNo)) {
      const held = {
        productId: child.productId,
        listId: child.listId,
        name: this.#nameForLine(child),
        price: child.unitPriceGross,
        quantity: perDishOptionQuantity(
          child.quantity,
          multiplyDecimal(decimal(line.quantity), decimal(child.priceQuantity ?? "1")),
        ),
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
    this.#changeExpectedEdit = this.billEdit === null ? null : { ...this.billEdit };
    this.changeLine = line;
  }

  #closeChange(): void {
    this.changeLine = null;
    this.#changeProduct = undefined;
    this.#changeSelection = undefined;
    this.#changeExpectedEdit = null;
  }

  /** `options` and `extras` go only when the till offers the dish a list of that kind
   * (`offeredListsOf`): either, sent, replaces the line's whole set, so an absent one keeps what the
   * line holds. `options` goes only when the answers differ from those the editor opened with: the
   * editor holds no answer to a list the dish no longer offers, so sending an unchanged set would
   * drop that answer. */
  #confirmChange(detail: ModifierConfirmDetail): void {
    const line = this.changeLine!;
    const offered = offeredListsOf(this.#changeProduct!);
    const opened = this.#changeSelection!.options ?? [];
    const expectedEdit = this.#changeExpectedEdit;
    this.#closeChange();
    const patch: OrderLinePatch = { note: detail.note ?? null };
    const options = detail.options ?? [];
    if (offered.some((entry) => entry.kind === "options") && !sameOptionSelections(options, opened))
      patch.options = options;
    if (offered.some((entry) => entry.kind === "extras"))
      patch.extras = toWireModifiers({ extras: detail.extras }).extras ?? [];
    const change: ChangeLineDetail = {
      expectedEdit,
      lineNo: line.lineNo,
      lineName: this.#nameForLine(line),
      patch,
      revision: this.#changeRevision,
      saleLine: {
        menuItemId: line.menuItemId ?? undefined,
        ...(line.parentProductId === null || line.productId === null
          ? {}
          : { variantId: line.productId }),
        quantity: patch.quantity ?? line.quantity,
        options: detail.options ?? [],
        extras: toWireModifiers({ extras: detail.extras }).extras ?? [],
        ...(detail.note ? { note: detail.note } : {}),
      },
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

  #courseName(courseId: string | null, retainedCourse?: TillCourse): string {
    if (courseId === null) return t("table.course_none");
    return (
      this.courses.find((course) => course.id === courseId)?.name ??
      (retainedCourse?.id === courseId ? retainedCourse.name : courseId)
    );
  }

  #courseValue(value: string): string | null {
    return value === "" ? null : value;
  }

  /** A FIRED line shows its course READ-ONLY: the server refuses to move it (`ticket.already_fired`). A
   * CHILD extras row has no course of its own, so it has no picker. */
  #lineCourse(line: TabLine): TemplateResult | typeof nothing {
    if (
      (this.courses.length === 0 &&
        (line.course === undefined || line.course.id !== line.courseId)) ||
      this.#isChild(line)
    )
      return nothing;
    if (line.firedAt !== null) {
      return html`<span class="line-course" data-line-course-static=${line.lineNo}
        >${this.#courseName(line.courseId, line.course)}</span
      >`;
    }
    return this.#coursePicker(
      { lineCourse: line.lineNo },
      this.#nameForLine(line),
      line.courseId ?? "",
      t("table.course_none"),
      (courseId) => this.#setLineCourse(line.lineNo, this.#courseValue(courseId)),
      line.course,
    );
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
  readonly #searchProducts = memoVisibleProducts();
  readonly #unfilteredProducts = memoVisibleProducts();
  readonly #unfilteredSearchProducts = memoVisibleProducts();

  #hasDietData(): boolean {
    return hasDietData(this.products);
  }

  /** The browser gets the products through the diet lens; a tab line's name still resolves against
   * the FULL set ({@link #nameFor}), so a filtered grid never blanks a line. */
  #menuBrowser(store: WorkingOrderStore): TemplateResult {
    store.canSelectProduct = (product) =>
      this.orderingAllowed &&
      this.productSelectable?.(product) !== false &&
      this.menus.some((menu) => menu.id === product.catalogueId && menu.orderable);
    const menu = this.menuSelectionRequired
      ? this.menus.find((menu) => menu.id === this.selectedMenuId && menu.orderable)
      : shownMenu(this.menus, this.selectedMenuId);
    if (this.menuSelectionRequired && menu === undefined) return html``;
    return html`<till-menu-browser
      class="round-control"
      ?inert=${store.sending || store.editsLocked || !this.orderingAllowed}
      .menu=${menu}
      .products=${this.#browserProducts(this.products, menu?.id ?? "", this.selectedDiet)}
      .unfilteredProducts=${this.#unfilteredProducts(this.products, menu?.id ?? "", null)}
      .menus=${this.menus}
      .servedProducts=${this.#searchProducts(
        this.products.filter((product) =>
          this.menus.some((menu) => menu.id === product.catalogueId && menu.orderable),
        ),
        "",
        this.selectedDiet,
      )}
      .unfilteredServedProducts=${this.#unfilteredSearchProducts(
        this.products.filter((product) =>
          this.menus.some((menu) => menu.id === product.catalogueId && menu.orderable),
        ),
        "",
        null,
      )}
      .store=${store}
      .handheld=${this.handheld}
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

  /** One probe across both views, because {@link #observeWidth} watches the element it first finds. */
  override render() {
    return html`<div class="width-probe"></div>
      ${this.loading ? this.#loadingScreen() : this.#orderScreen()}`;
  }

  #orderScreen(): TemplateResult {
    const pending = this.#pending();
    const draft = this.#draftStore;
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
          <till-table-status .tables=${this.tables} .party=${this.party}></till-table-status>
          <wt-button
            class="drawer-handle"
            data-open-drawer
            variant="secondary"
            @click=${() => this.#toggleDrawer()}
          >
            ${t("table.open_drawer")}
            ${
              pending.length > 0
                ? html`<span class="badge" data-pending-badge>${pending.length}</span>`
                : nothing
            }
          </wt-button>
          ${this.#floorBackButton()}
        </div>
        ${this.#printProblem()}
        <till-order-kitchen-note
          .scopeKey=${this.party === null ? `order:${this.orderId ?? draft?.id ?? ""}` : `party:${this.party.id}`}
          .note=${this.party === null ? (draft?.kitchenNote ?? null) : this.kitchenNote}
          .revision=${this.party === null ? (draft?.kitchenNoteRevision ?? 0) : this.kitchenNoteRevision}
          .visit=${this.#kitchenNoteVisit}
          .busy=${this.busy}
          @save-kitchen-note=${(event: CustomEvent<SaveKitchenNoteDetail>) => {
            if (this.party !== null || draft === null) return;
            event.stopPropagation();
            draft.kitchenNote = event.detail.note;
          }}
        ></till-order-kitchen-note>
        <div class="layout">
          ${draft === null ? this.#sentOrders() : this.#ordering(draft)}
          ${this.drawerOpen ? this.#drawer(pending) : nothing}
        </div>
        ${this.#sentLineDialog()} ${this.#fireGroupDialog()} ${this.#moveDialog()}
        ${this.#serveDialog()} ${this.#changeEditor()} ${this.#takeOverDialog()}
        ${this.#billChoiceDialog()} ${this.#nameDialog()} ${this.#guestsDialog()}
        ${this.#splitGuestsDialog()}
      </section>
    `;
  }

  #loadingScreen(): TemplateResult {
    return html`
      <section
        class="screen"
        data-order-id=${this.orderId ?? nothing}
        aria-label=${t("table.title")}
        aria-busy="true"
      >
        ${
          this.embedded
            ? nothing
            : html`<header class="head">
                <h1 class="title">${t("table.title")}</h1>
              </header>`
        }
        <div class="head-actions">${this.#floorBackButton()}</div>
        <p role="status" data-loading>${t("table.loading")}</p>
      </section>
    `;
  }

  #floorBackButton(): TemplateResult | typeof nothing {
    return this.embedded
      ? nothing
      : html`<wt-button class="back" data-back variant="secondary" @click=${() => this.#back()}>
          ${t("table.back")}
        </wt-button>`;
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
        ${this.#sentOrders()}
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
        ${this.#roundControl(draft)} ${this.#otherDraftPanels(draft)} ${this.#retainedDraftPanel()}
      </section>
    </div>`;
  }

  #sentOrders(): TemplateResult {
    const billId = this.orderId ?? "";
    const scope = JSON.stringify([this.serviceVisit, this.party?.id ?? null]);
    const api = this.api;
    const bills = shownBills(this.bills);
    return html`<div data-sent-orders>
      ${
        this.currentOrdersUnread
          ? html`<p role="status" data-sent-unread>${t("table.current_orders_unread")}</p>`
          : nothing
      }
      ${this.currentOrders === null ? this.#sentFallback() : nothing}
      <till-sent-orders
        .scope=${scope}
        .billId=${billId}
        .snapshot=${this.currentOrders === null ? null : { scope, billId, current: this.currentOrders }}
        .billLabels=${new Map(bills.map((bill, index) => [bill.workingOrderId, billName(this.party?.displayName ?? "", index)]))}
        .busy=${this.busy || this.groupCommandBusy}
        .now=${this.now}
        @reorder-held=${(event: CustomEvent<SentReorderDetail>) => {
          event.stopPropagation();
          const { expected, heldGroupIds } = event.detail;
          const held = this.groups
            .filter((group) => group.state === "held")
            .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
            .map((group) => group.id);
          if (
            !this.isConnected ||
            this.busy ||
            this.groupCommandBusy ||
            this.currentOrdersUnread ||
            this.api !== api ||
            this.orderId !== billId ||
            JSON.stringify([this.serviceVisit, this.party?.id ?? null]) !== expected.scope ||
            this.currentOrders?.revision !== expected.revision ||
            held.length !== expected.ids.length ||
            held.some((id, index) => id !== expected.ids[index])
          )
            return;
          this.#dispatch("reorder-groups", { heldGroupIds } satisfies ReorderGroupsDetail);
        }}
        @sent-line-info=${(event: CustomEvent<SentLineInfo>) => {
          event.stopPropagation();
          if (!this.isConnected || this.busy || this.groupCommandBusy) return;
          this.sentLinePending = {
            info: event.detail,
            api: this.api,
            partyId: this.party?.id ?? null,
            billId: this.orderId,
            visit: this.serviceVisit,
          };
        }}
        @fire-group=${(event: CustomEvent<FireGroupDetail>) => {
          event.stopPropagation();
          if (this.busy || this.groupCommandBusy) return;
          const group = this.#heldInOrder.find((group) => group.id === event.detail.groupId);
          if (group !== undefined) this.#requestFireGroup(group);
        }}
      ></till-sent-orders>
    </div>`;
  }

  #sentFallback(): TemplateResult | typeof nothing {
    const recalled = new Set(
      [
        ...(this.#draftStore?.lines ?? []),
        ...this.otherDrafts.flatMap((draft) => draft.lines),
      ].flatMap((line) => (line.source === undefined ? [] : [line.source.line.id])),
    );
    const dishes = this.lines.filter((line) => !this.#isChild(line) && !recalled.has(line.id));
    if (dishes.length === 0) return nothing;
    // Bill lines lack partial serving quantities, so this fallback offers no actions.
    return html`<section class="sent-fallback" data-sent-fallback>
      <h2>${t("table.sent_title")}</h2>
      <ul>
        ${dishes.map(
          (dish) =>
            html`<li data-sent-fallback-line=${dish.id}>
              ${this.#sentFallbackLine(dish)}
              <ul>
                ${this.lines.filter((line) => line.parentLineNo === dish.lineNo).map((extra) => html`<li data-sent-fallback-extra=${extra.id}>${this.#sentFallbackLine(extra)}</li>`)}
              </ul>
            </li>`,
        )}
      </ul>
    </section>`;
  }

  #sentFallbackLine(line: TabLine): TemplateResult {
    return html`<div class="sent-fallback-row">
      <span class="sent-fallback-name"
        >${this.#nameForLine(line)}${this.#nutrition(line)} ×${this.#displayQty(line.quantity)}
        ${optionAnswers(line.optionSnapshots, { reads: "staff" }).map((answer) => html`<span class="modifier-answer">${answer}</span>`)}${this.#lineNote(line)}
      </span>
      <span class="sent-fallback-price" data-sent-fallback-price>${this.#lineTotal(line)}</span>
    </div>`;
  }

  #sentLine(): SentSlice | undefined {
    const pending = this.sentLinePending;
    if (
      pending === null ||
      this.currentOrders === null ||
      this.currentOrdersUnread ||
      pending.api !== this.api ||
      pending.partyId !== (this.party?.id ?? null) ||
      pending.billId !== this.orderId ||
      pending.visit !== this.serviceVisit
    )
      return;
    const model = sentPanel(this.currentOrders, this.orderId ?? "", this.now ?? Date.now());
    return [...model.served, ...model.fired, ...model.held.flatMap((group) => group.rows)].find(
      (slice) =>
        slice.row.lineId === pending.info.lineId &&
        slice.kind === pending.info.kind &&
        slice.row.workingOrderId === pending.info.workingOrderId,
    );
  }

  #serveFromSentLine(pending: typeof this.sentLinePending, undo: boolean): void {
    if (
      pending === null ||
      pending !== this.sentLinePending ||
      !this.isConnected ||
      this.busy ||
      this.groupCommandBusy
    )
      return;
    const slice = this.#sentLine();
    if (
      slice === undefined ||
      slice.kind !== (undo ? "served" : "fired") ||
      (!undo && !slice.row.released) ||
      (undo && !this.#sentBillOpen(slice.row))
    )
      return;
    this.sentLinePending = null;
    this.renderRoot.querySelector<WtDialog>("[data-sent-line-dialog]")!.closeAfter("saved");
    this.#requestServe(slice.row, undo);
  }

  #sentBillOpen(row: CurrentOrderRow): boolean {
    const bill = this.bills.find((bill) => bill.workingOrderId === row.workingOrderId);
    return row.billStatus === "open" && (bill === undefined || bill.status === "open");
  }

  #sentOrderLine(slice: SentSlice): TabLine | undefined {
    if (
      slice.kind === "cancelled_charged" ||
      !this.#sentBillOpen(slice.row) ||
      this.#draftStore?.editsLocked ||
      this.#draftStore?.sending
    )
      return;
    return this.lines.find(
      (line) =>
        line.id === slice.row.lineId &&
        line.lineNo === slice.row.lineNo &&
        line.parentLineNo == null,
    );
  }

  #canRecallSent(slice: SentSlice): boolean {
    const line = this.#sentOrderLine(slice);
    return (
      line !== undefined &&
      this.#canRecall(line) &&
      (slice.row.kitchen === null || slice.row.kitchen.state === "queued")
    );
  }

  #canMoveSent(slice: SentSlice): boolean {
    const store = this.#draftStore;
    const locked = store instanceof DraftStore ? store.compositionLocked : store?.editsLocked;
    const line = this.lines.find((line) => line.id === slice.row.lineId);
    const bill = this.bills.find((bill) => bill.workingOrderId === slice.row.workingOrderId);
    return (
      slice.kind !== "cancelled_charged" &&
      (slice.row.billStatus === "open" || slice.row.billStatus === "placed") &&
      (bill === undefined || bill.status === "open" || bill.status === "placed") &&
      !locked &&
      !store?.sending &&
      (line === undefined ||
        (line.lineNo === slice.row.lineNo &&
          line.parentLineNo == null &&
          line.movable &&
          !isStarted(line))) &&
      slice.row.kitchen?.movable === true &&
      slice.row.kitchen.state === "queued"
    );
  }

  #canFireSent(slice: SentSlice): boolean {
    if (slice.kind !== "held") return false;
    const group = this.currentOrders?.groups.find((group) =>
      group.rows.some((row) => row.lineId === slice.row.lineId),
    );
    return (
      group !== undefined && this.groups.find((known) => known.id === group.id)?.state !== "fired"
    );
  }

  #canVoidSent(slice: SentSlice): boolean {
    const store = this.#draftStore;
    const locked = store instanceof DraftStore ? store.compositionLocked : store?.editsLocked;
    const bill = this.bills.find((bill) => bill.workingOrderId === slice.row.workingOrderId);
    return (
      slice.kind !== "cancelled_charged" &&
      slice.row.billStatus !== "abandoned" &&
      bill?.status !== "abandoned" &&
      !locked &&
      !this.#draftStore?.sending
    );
  }

  #actOnSentLine(
    pending: typeof this.sentLinePending,
    action: "fire" | "recall" | "station" | "void" | "comp",
  ): void {
    if (
      pending === null ||
      pending !== this.sentLinePending ||
      !this.isConnected ||
      this.busy ||
      this.groupCommandBusy
    )
      return;
    const slice = this.#sentLine();
    if (
      slice === undefined ||
      (action === "fire" && !this.#canFireSent(slice)) ||
      (action === "recall" && !this.#canRecallSent(slice)) ||
      (action === "station" && !this.#canMoveSent(slice)) ||
      (action === "void" && !this.#canVoidSent(slice)) ||
      (action === "comp" && this.#sentOrderLine(slice) === undefined)
    )
      return;
    this.sentLinePending = null;
    this.renderRoot.querySelector<WtDialog>("[data-sent-line-dialog]")!.closeAfter("saved");
    if (action === "fire") this.#dispatch("fire-held-line", { lineId: slice.row.lineId });
    else if (action === "recall") this.#recallLine(slice.row.lineNo);
    else if (action === "comp") {
      const line = this.#sentOrderLine(slice)!;
      const target = lineAdjustTarget(line, this.lines, this.#adjustName(line));
      target.extras = this.lines
        .filter(
          (row) =>
            row.parentLineNo === line.lineNo && compareDecimal(tabLineGross(row), decimal("0")) > 0,
        )
        .map((row) => lineAdjustTarget(row, this.lines, this.#adjustName(row)));
      this.#dispatch("adjust", { kind: "comp", combined: true, target });
    } else if (action === "void") this.#dispatch("cancel-item", { lineId: slice.row.lineId });
    else
      this.#dispatch("move-station", {
        workingOrderId: slice.row.workingOrderId,
        lineId: slice.row.lineId,
        name: slice.row.name,
        stationId: slice.row.kitchen!.stationId,
      });
  }

  #sentLineMore(slice: SentSlice | undefined): TemplateResult | typeof nothing {
    if (slice === undefined) return nothing;
    const fire = this.#canFireSent(slice);
    const recall = this.#canRecallSent(slice);
    const station = this.#canMoveSent(slice);
    const unserve = slice.kind === "served" && this.#sentBillOpen(slice.row);
    const comp = this.#sentOrderLine(slice) !== undefined;
    const canVoid = this.#canVoidSent(slice);
    if (!fire && !recall && !station && !unserve && !canVoid && !comp) return nothing;
    const pending = this.sentLinePending;
    const disabled = this.busy || this.groupCommandBusy;
    return html`<wt-row-actions label=${t("shell.more")}>
      ${fire ? html`<wt-button variant=${disabled ? "secondary" : "primary"} data-sent-line-fire ?disabled=${disabled} @click=${() => this.#actOnSentLine(pending, "fire")}>${t("table.destination_fire_now")}</wt-button>` : nothing}
      ${recall ? html`<wt-button variant="secondary" data-sent-line-recall ?disabled=${disabled} @click=${() => this.#actOnSentLine(pending, "recall")}>${t("table.recall_line")}</wt-button>` : nothing}
      ${station ? html`<wt-button variant="secondary" data-sent-line-station ?disabled=${disabled} @click=${() => this.#actOnSentLine(pending, "station")}>${t("table.move_station")}</wt-button>` : nothing}
      ${comp ? html`<wt-button variant="secondary" data-sent-line-comp ?disabled=${disabled} @click=${() => this.#actOnSentLine(pending, "comp")}>${t("comp.title")}</wt-button>` : nothing}
      ${canVoid ? html`<wt-button variant=${disabled ? "secondary" : "danger"} data-sent-line-void ?disabled=${disabled} @click=${() => this.#actOnSentLine(pending, "void")}>${t("table.void_line")}</wt-button>` : nothing}
      ${unserve ? html`<wt-button variant="secondary" data-sent-line-unserve aria-label=${`${t("table.unserve")} · ${slice.row.name}`} ?disabled=${disabled} @click=${() => this.#serveFromSentLine(pending, true)}>${t("table.unserve")}</wt-button>` : nothing}
    </wt-row-actions>`;
  }

  #sentLineDialog(): TemplateResult {
    const pending = this.sentLinePending;
    const slice = this.#sentLine();
    const row = slice?.row;
    const disabled = this.busy || this.groupCommandBusy;
    const group =
      row === undefined
        ? undefined
        : this.currentOrders?.groups.find((group) =>
            group.rows.some(
              (member) =>
                member.lineId === row.lineId && member.workingOrderId === row.workingOrderId,
            ),
          );
    const partlyServed =
      row !== undefined &&
      row.servedAt === null &&
      compareDecimal(decimal(row.servedQuantity), decimal("0")) > 0;
    const extraTotal =
      row?.extras.reduce((sum, extra) => addDecimal(sum, decimal(extra.netAmount)), decimal("0")) ??
      decimal("0");
    const station = this.stations.find((station) => station.id === row?.kitchen?.stationId);
    const status =
      slice?.kind === "cancelled_charged"
        ? t("table.cancelled_charged")
        : slice?.kind === "held"
          ? t("table.group_held")
          : row === undefined
            ? nothing
            : this.#rowState(row);
    return html`<wt-dialog
      ${trackDialog()}
      data-sent-line-dialog
      .open=${row !== undefined}
      .heading=${t("table.sent_info")}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget && !(event.currentTarget as WtDialog).open)
          this.sentLinePending = null;
      }}
    >
      ${
        row === undefined
          ? nothing
          : html`
              <p class="move-dish">
                ${row.name}${this.#nutrition(row)} ×${this.#displayQty(row.quantity)}
              </p>
              <div class="total-row">
                <span>${row.name}</span
                ><span class="amount" data-sent-line-amount
                  >${formatMoney(subtractDecimal(decimal(row.netAmount), extraTotal), currentLocale())}</span
                >
              </div>
              ${row.extras.map((extra) => html`<div class="total-row" data-sent-extra=${extra.lineId}><span>${extra.name} ×${this.#displayQty(extra.quantity)}</span><span class="amount">${this.#money(extra.netAmount)}</span></div>`)}
              ${row.note === null ? nothing : html`<p>${t("line.note.label")}: ${row.note}</p>`}
              <p data-sent-line-status>
                ${station === undefined ? nothing : html`${station.name} · `}${status}
              </p>
              ${group === undefined ? nothing : html`<p data-sent-line-origin>${this.#sentOf(group)}</p>`}
              ${partlyServed ? html`<p data-sent-line-served>${this.#servedOf(row)}</p>` : nothing}
              <div class="total-row">
                <span>${t("label.total")}</span
                ><span class="amount">${this.#money(row.netAmount)}</span>
              </div>
            `
      }
      <div slot="footer" class="cancel-actions">
        <wt-button
          variant="secondary"
          data-sent-line-close
          @click=${() => {
            this.sentLinePending = null;
          }}
          >${t("table.submitted_close")}</wt-button
        >
        ${slice?.kind === "fired" && slice.row.released ? html`<wt-button data-sent-line-serve aria-label=${`${t("table.serve")} · ${slice.row.name}`} variant=${disabled ? "secondary" : "primary"} ?disabled=${disabled} @click=${() => this.#serveFromSentLine(pending, false)}>${t("table.serve")}</wt-button>` : nothing}
        ${this.#sentLineMore(slice)}
      </div>
    </wt-dialog>`;
  }

  #retainedDraftPanel(): TemplateResult | typeof nothing {
    const candidate = this.retainedDraft;
    if (candidate === null) return nothing;
    return html`<section
      class="other-draft"
      data-draft-candidate
      aria-labelledby="draft-candidate-title"
    >
      <h3 class="other-draft-title" id="draft-candidate-title">${t("unsaved.message")}</h3>
      <ul class="other-draft-lines">
        ${candidate.lines.map((line) => html`<li class="other-draft-line" data-candidate-line>${this.#lineSummary(line, "other-draft-name")}</li>`)}
      </ul>
      <wt-button
        variant="secondary"
        data-candidate-discard
        ?disabled=${this.candidateReviewBusy}
        @click=${() => this.#dispatch("resolve-draft-candidate", { candidate, apply: false })}
        >${t("unsaved.discard")}</wt-button
      >
      <wt-button
        variant=${this.candidateReviewAllowed ? "primary" : "secondary"}
        data-candidate-apply
        ?disabled=${!this.candidateReviewAllowed || this.candidateReviewBusy}
        @click=${() => this.#dispatch("resolve-draft-candidate", { candidate, apply: true })}
        >${t("basket_refresh.confirm")}</wt-button
      >
    </section>`;
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
        ?disabled=${by === 1 && store.canSelectProduct?.(line.product) === false}
        aria-label=${`${t(key)} ${text} · ${name}`}
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
    return html`<span class=${nameClass}
        >${name}${this.#nutrition(line)} ×${this.#displayQty(line.quantity)}</span
      >
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
    if (this.service === null) return html`<div class="grid-region"></div>`;
    if (this.service.zoneOpen === false)
      return html`<div class="grid-region">
        ${servicePeriod(this.service, this.departmentName, this.api, this.zoneId, this.zoneName)}
      </div>`;
    if (this.service?.open === false)
      return html`<div class="grid-region">
        ${servicePeriod(this.service, this.departmentName, this.api, this.zoneId)}
      </div>`;
    if (!this.menus.some((menu) => menu.orderable))
      return html`<div class="grid-region">
        ${servicePeriod(this.service, this.departmentName, this.api, this.zoneId)}
        <p role="status" data-last-orders-ended>${t("menu.last_orders_ended")}</p>
      </div>`;
    return html`<div class="grid-region">
      ${servicePeriod(this.service, this.departmentName, this.api, this.zoneId)}
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

  #roundControl(draft: WorkingOrderStore): TemplateResult {
    return html`${
        draft.sending
          ? html`<p class="round-sending" role="status" data-round-sending>
              ${
                this.takeOverSent !== null
                  ? t("table.taking_over")
                  : draft.busyAction === "split"
                    ? t("table.split_group_line")
                    : draft.busyAction === "cancel"
                      ? t("adjust.cancel_title")
                      : draft.busyAction === "recall"
                        ? t("table.recall_line")
                        : t("table.round_sending")
              }
            </p>`
          : nothing
      }
      <div class="round-control" data-round-controls ?inert=${draft.sending}>
        <div class="round-bar">
          ${keyed(
            this.orderId,
            draft.lineCount === 0
              ? html`<till-basket .hideKitchenNote=${true} .store=${draft}></till-basket>`
              : this.#draftSections(draft),
          )}
          ${this.#draftBar(draft)} ${this.#draftMoveDialog(draft)}
          <wt-button
            data-discard-draft
            variant="secondary"
            ?disabled=${draft.lineCount === 0 || draft.sending || draft.editsLocked || this.groupCommandBusy}
            @click=${() => this.dispatchEvent(new CustomEvent("discard-draft", { bubbles: true, composed: true }))}
            >${t("held.discard")}</wt-button
          >
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

  #draftLayout(store: WorkingOrderStore): LayoutGroup[] {
    return draftLayout({
      lines: store.lines,
      courses: this.courses,
      groups: this.groups,
      locale: currentLocale(),
      nextDisplayNumber: Math.max(0, ...this.groups.map((group) => group.displayNumber)) + 1,
    });
  }

  #draftGroupName(group: LayoutGroup): string {
    const target =
      group.kind === "join" ? this.groups.find((held) => held.id === group.groupId) : undefined;
    const number =
      target === undefined ? String(group.displayNumber ?? "?") : groupNumberText(target);
    const name =
      group.kind === "fire"
        ? t("table.destination_fire_now")
        : t(group.kind === "join" ? "table.draft_joins_group" : "table.group_n").replace(
            "{n}",
            () => number,
          );
    return [name, ...group.courseNames].join(" · ");
  }

  #draftGroupMenu(store: WorkingOrderStore, group: LayoutGroup) {
    const slots = this.#draftLayout(store).filter((group) => group.kind === "new");
    const index = slots.findIndex((slot) => slot.key === group.key);
    if (index < 0 || slots.length < 2 || store.editsLocked) return nothing;
    const epoch = this.#draftEpoch;
    const scope = this.#draftDragScope();
    const groups = this.#draftDragGroups();
    const api = this.api;
    const move = (by: number) => {
      if (
        !this.#canDragDraft(store) ||
        epoch !== this.#draftEpoch ||
        scope !== this.#draftDragScope() ||
        groups !== this.#draftDragGroups() ||
        api !== this.api
      )
        return;
      const target = slots[index + by];
      if (target !== undefined) store.moveSlot(group.slot!, target.slot!);
    };
    return keyed(
      JSON.stringify([epoch, scope, groups]),
      html`<wt-row-actions
        data-draft-group-more=${group.key}
        label=${`${t("shell.more")} · ${this.#draftGroupName(group)}`}
        align="end"
      >
        ${
          index === 0
            ? nothing
            : html`<wt-button
                data-draft-earlier
                variant="secondary"
                ?disabled=${!this.#canDragDraft(store)}
                @click=${() => move(-1)}
                >${t("table.group_earlier")}</wt-button
              >`
        }
        ${
          index === slots.length - 1
            ? nothing
            : html`<wt-button
                data-draft-later
                variant="secondary"
                ?disabled=${!this.#canDragDraft(store)}
                @click=${() => move(1)}
                >${t("table.group_later")}</wt-button
              >`
        }
      </wt-row-actions>`,
    );
  }

  #draftSections(store: WorkingOrderStore): TemplateResult {
    return html`<div
      class="draft-sections"
      data-draft-sections
      ?data-draft-drag-active=${this.draftDragging}
    >
      ${repeat(
        this.#draftLayout(store),
        (group) => group.key,
        (group) => {
          const indexes = group.sections.flatMap((section) => section.indexes);
          const selected = indexes.filter((index) =>
            this.#selected.has(store.lines[index]!),
          ).length;
          const checked = selected === 0 ? "false" : selected === indexes.length ? "true" : "mixed";
          const name = this.#draftGroupName(group);
          return html`${group.kind === "fire" ? nothing : html`<div class="draft-drop-gap" data-draft-gap=${group.key} aria-hidden="true"></div>`}
            <section class="draft-group" data-draft-group=${group.key} aria-label=${name}>
              <h3
                class="draft-group-name"
                data-draft-group-name
                data-draft-drag-heading=${group.kind === "new" ? group.key : nothing}
                ?data-draft-dragging=${this.draftDragging && this.#draftPress?.group?.key === group.key}
              >
                ${
                  store.editsLocked
                    ? name
                    : html`<button
                        type="button"
                        class="option draft-group-select"
                        role="checkbox"
                        data-draft-group-select=${group.key}
                        aria-checked=${checked}
                        ?disabled=${store.sending || this.groupCommandBusy}
                        @click=${() => {
                          if (store.editsLocked || store.sending || this.groupCommandBusy) return;
                          for (const index of indexes) {
                            const line = store.lines[index]!;
                            if (checked === "true") this.#selected.delete(line);
                            else this.#selected.add(line);
                          }
                          this.requestUpdate();
                        }}
                      >
                        <span aria-hidden="true"
                          >${checked === "true" ? "☑" : checked === "mixed" ? "▣" : "☐"}</span
                        >
                        ${name}
                      </button>`
                }
                ${this.#draftGroupMenu(store, group)}
              </h3>
              ${repeat(
                group.sections,
                (section) => section.course?.id ?? "",
                (section) =>
                  html`<section
                    class="draft-section"
                    data-draft-section=${section.course?.id ?? ""}
                  >
                    ${
                      section.heading && section.course !== null
                        ? html`<h4 class="draft-section-name">${section.course.name}</h4>`
                        : nothing
                    }
                    <till-basket
                      .hideKitchenNote=${true}
                      .lineDetails=${true}
                      .draftParent=${this}
                      .courses=${this.courses}
                      .orderInFlight=${this.groupCommandBusy}
                      stacked
                      .store=${store}
                      .lineIndexes=${section.indexes}
                    >
                      ${section.indexes.map((index) => this.#draftLine(store, store.lines[index]!, index))}
                    </till-basket>
                  </section>`,
              )}
            </section>`;
        },
      )}
      <div class="draft-drop-gap" data-draft-gap="end" aria-hidden="true"></div>
    </div>`;
  }

  #draftLine(store: WorkingOrderStore, line: OrderLine, index: number): TemplateResult {
    const name = lineProductName(line.product);
    const selected = this.#selected.has(line);
    const family = store.splitFamily(line);
    const splits =
      soldByTheUnit(line.product) &&
      Number.isInteger(Number(line.quantity)) &&
      Number(line.quantity) > 1;
    const isFlagged = flagged(line);
    if (!isFlagged) this.#kept.delete(line);
    const tools = [
      ...(this.stations.length > 1 ? [this.#makeAtPicker(store, line, index, name)] : []),
      ...(isFlagged && line.source === undefined ? [this.#flagChoice(store, line, index)] : []),
      this.#draftRoutingWarning(store, line, index, true),
    ];
    if (store.editsLocked)
      return html`<span slot=${`lead-${index}`} class="draft-line-name"
        >${name}${this.#nutrition(line)} ×${this.#displayQty(line.quantity)}</span
      >`;
    return html`${
        family?.[0] === line
          ? html`<button
              type="button"
              slot=${`before-${index}`}
              class="option draft-family-header"
              data-fold-draft-family
              aria-expanded="true"
              ?disabled=${store.sending || this.groupCommandBusy}
              @click=${() => this.#foldDraftFamily(store, line)}
            >
              <span
                >${name}
                ×${this.#displayQty(family.reduce((total, member) => addDecimal(total, decimal(member.quantity)), decimal("0")))}</span
              >
              <span aria-hidden="true">⌃</span>
            </button>`
          : nothing
      }
      <button
        slot=${`lead-${index}`}
        type="button"
        class="option draft-select"
        data-draft-select=${index}
        ?data-draft-dragging=${this.draftDragging && this.#draftPress?.group === undefined && this.#draftPress?.chosen.includes(line)}
        aria-pressed=${selected}
        ?disabled=${store.editsLocked || store.sending}
        @click=${() => {
          if (!store.editsLocked && !store.sending) this.#toggleSelected(line);
        }}
      >
        <span aria-hidden="true">${selected ? "☑" : "☐"}</span>
        <span class="draft-line-name"
          >${name}${this.#nutrition(line)} ×${this.#displayQty(line.quantity)}</span
        >
      </button>
      ${
        splits
          ? html`<button
              type="button"
              slot=${`end-${index}`}
              class="draft-unit-chevron"
              data-split-draft-line=${index}
              aria-label=${`${t("table.split_group_line")} · ${name}`}
              ?disabled=${store.sending || store.editsLocked || this.groupCommandBusy}
              @click=${() => this.#splitDraftLine(store, line)}
            >
              <span aria-hidden="true">›</span>
            </button>`
          : nothing
      }
      ${
        tools.length === 0
          ? nothing
          : html`<div slot=${`detail-${index}`} class="draft-line-tools" data-draft-line-details>
              ${tools}
            </div>`
      }
      ${isFlagged && line.source === undefined ? html`<span slot=${`after-${index}`} data-flag-warning aria-hidden="true">⚠</span>` : nothing}
      ${this.#draftRoutingWarning(store, line, index)}`;
  }

  #draftRoutingWarning(
    store: WorkingOrderStore,
    line: OrderLine,
    index: number,
    detail = false,
  ): TemplateResult | typeof nothing {
    const routing = this.#routingRows.get(line);
    if (routing === undefined || line.makeAt !== undefined) return nothing;
    if (!detail)
      return html`<div
        slot=${`after-${index}`}
        class="draft-routing-warning"
        data-draft-routing-warning
      >
        <span aria-hidden="true">⚠</span>
        ${t(routing.row.why === "closed" ? "dead_end.closed" : "dead_end.disabled").replace("{station}", () => routing.row.stationName)}
      </div>`;
    const current = () =>
      this.isConnected &&
      store === this.#draftStore &&
      this.#routingRows.get(line) === routing &&
      store.lines.includes(line) &&
      !store.editsLocked &&
      !store.sending &&
      !this.groupCommandBusy;
    return html`<div class="draft-routing-detail" data-draft-routing-detail>
      <span aria-hidden="true">⚠</span>
      <till-dead-ends-section
        .answer=${{ sends: true, deadEnds: [{ ...routing.row, key: String(index), quantity: line.quantity }], stations: routing.stations }}
        .allowRemove=${true}
        ?inert=${store.sending || store.editsLocked || this.groupCommandBusy}
        @make-at=${(event: CustomEvent<{ key: string; stationId: string }>) => {
          event.stopPropagation();
          if (
            !current() ||
            !routing.stations.some((station) => station.id === event.detail.stationId)
          )
            return;
          store.setLineMakeAt(store.lines.indexOf(line), event.detail.stationId);
          this.#routingRows.delete(line);
          this.requestUpdate();
        }}
        @remove=${(event: Event) => {
          event.stopPropagation();
          if (!current()) return;
          store.removeLine(store.lines.indexOf(line));
          this.requestUpdate();
        }}
      ></till-dead-ends-section>
    </div>`;
  }

  #splitDraftLine(store: WorkingOrderStore, line: OrderLine): void {
    const index = store.lines.indexOf(line);
    if (
      !this.isConnected ||
      store !== this.#draftStore ||
      index < 0 ||
      store.sending ||
      store.editsLocked ||
      this.groupCommandBusy ||
      !soldByTheUnit(line.product) ||
      !Number.isInteger(Number(line.quantity)) ||
      Number(line.quantity) <= 1
    )
      return;
    if (line.source === undefined) store.splitLine(index);
    else this.#dispatch("split-draft-source", { store, line } satisfies SplitDraftSourceDetail);
  }

  #foldDraftFamily(store: WorkingOrderStore, line: OrderLine): void {
    if (
      !this.isConnected ||
      store !== this.#draftStore ||
      store.sending ||
      store.editsLocked ||
      this.groupCommandBusy
    )
      return;
    const family = store.splitFamily(line);
    if (family === undefined) return;
    const selected = family.every((member) => this.#selected.has(member));
    store.foldSplitFamily(line);
    if (
      store.lines.includes(family[0]!) &&
      family.slice(1).every((member) => !store.lines.includes(member))
    ) {
      for (const member of family) this.#selected.delete(member);
      if (selected) this.#selected.add(family[0]!);
      this.requestUpdate();
    }
  }

  #flagChoice(store: WorkingOrderStore, line: OrderLine, index: number): TemplateResult {
    if (this.#kept.has(line))
      return html`<span class="flag-kept" data-flag-kept tabindex="-1"
        >${t("table.flag_kept")}</span
      >`;
    const name = shownName(line.product);
    const busy = !this.#canEditDraftLine(store, line);
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

  #canEditDraftLine(store: WorkingOrderStore, line: OrderLine): boolean {
    return (
      this.isConnected &&
      store === this.#draftStore &&
      store.lines.includes(line) &&
      !store.sending &&
      !store.editsLocked &&
      !this.groupCommandBusy &&
      this.takeOverSent === null &&
      this.orderingAllowed
    );
  }

  /** The line's row goes with it, so focus goes to the order's heading. */
  async #removeFlagged(store: WorkingOrderStore, line: OrderLine): Promise<void> {
    if (!this.#canEditDraftLine(store, line)) return;
    store.removeLine(store.lines.indexOf(line));
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLElement>("#draft-title")?.focus();
  }

  /** The replaced choice keeps focus inside the line window. */
  async #keepFlagged(store: WorkingOrderStore, line: OrderLine): Promise<void> {
    if (!this.#canEditDraftLine(store, line)) return;
    this.#kept.add(line);
    this.requestUpdate();
    await this.updateComplete;
    this.renderRoot
      .querySelector<HTMLElement>(`[slot="detail-${store.lines.indexOf(line)}"] [data-flag-kept]`)
      ?.focus();
  }

  #draftSendable(line: OrderLine): boolean {
    return (
      (line.source !== undefined || !flagged(line)) &&
      (this.#routingRows.get(line) === undefined || line.makeAt !== undefined)
    );
  }

  #submitArrangement(store: WorkingOrderStore, selectedOnly: boolean): void {
    if (
      !this.isConnected ||
      store !== this.#draftStore ||
      store.sending ||
      store.editsLocked ||
      this.groupCommandBusy ||
      !this.orderingAllowed
    )
      return;
    const lines = this.#draftLayout(store).flatMap((group) =>
      group.sections.flatMap((section) => section.indexes.map((index) => store.lines[index]!)),
    );
    const sendable = (index: number) => this.#draftSendable(lines[index]!);
    const groups = selectedOnly
      ? fireGroups(lines, this.#selectedIndexes(lines), sendable)
      : sendAllGroups(lines, this.groups, sendable);
    const indexes = groups.flatMap((group) => group.indexes);
    if (indexes.length === 0) return;
    const sent = indexes.map((index) => lines[index]!);
    const positions = new Map(indexes.map((index, position) => [index, position]));
    const detail: SubmitDraftDetail = {
      lines: sent.flatMap((line) =>
        line.source !== undefined
          ? []
          : [
              {
                ...toWireProductIdentity(line.product),
                quantity: line.quantity,
                ...toWireLineExtras(line),
                ...toWireModifiers(line),
                ...(line.courseId === undefined ? {} : { courseId: line.courseId }),
              },
            ],
      ),
      groups: groups.map(({ indexes, ...group }) => ({
        ...group,
        lineIndexes: indexes.map((index) => positions.get(index)!),
      })),
      store,
      sent,
      draft: this.#draftOf(store),
    };
    this.#dispatch("submit-draft", detail);
  }

  #draftBar(store: WorkingOrderStore): TemplateResult {
    const busy =
      store.sending || store.editsLocked || this.groupCommandBusy || !this.orderingAllowed;
    const sendable = store.lines.filter((line) => this.#draftSendable(line));
    const button = (selectedOnly: boolean, key: StringKey, name: string) => {
      const disabled = busy || !sendable.some((line) => !selectedOnly || this.#selected.has(line));
      return html`<wt-button
        class="draft-action"
        data-draft-action=${name}
        variant=${disabled ? "secondary" : "primary"}
        size="lg"
        ?disabled=${disabled}
        @click=${() => this.#submitArrangement(store, selectedOnly)}
        >${t(key)}</wt-button
      >`;
    };
    return html`<div class="draft-bar">
      ${this.#draftMoveButton(store)}
      <div class="draft-actions" role="group" aria-label=${t("table.draft_actions")}>
        ${button(true, "table.group_fire", "fire-selected")}
        ${button(false, "table.draft_send_all", "send-all")}
      </div>
    </div>`;
  }

  #draftMoveButton(store: WorkingOrderStore): TemplateResult {
    const disabled =
      store.editsLocked ||
      store.sending ||
      this.groupCommandBusy ||
      !store.lines.some((line) => this.#selected.has(line));
    return html`<wt-button
      data-draft-move
      variant=${disabled ? "secondary" : "primary"}
      ?disabled=${disabled}
      @click=${() => {
        if (!disabled) this.draftMoveStore = store;
      }}
      >${t("table.move_line")}</wt-button
    >`;
  }

  #moveDraftSelection(store: WorkingOrderStore, target: Place | "new"): void {
    if (
      store !== this.#draftStore ||
      store !== this.draftMoveStore ||
      store.editsLocked ||
      store.sending ||
      this.groupCommandBusy
    )
      return;
    const indexes = [...this.#selectedIndexes(store.lines)];
    if (indexes.length === 0) return;
    if (target === "new") {
      const layout = this.#draftLayout(store);
      const newlyHeld = layout.filter((group) => group.kind === "new");
      const anchorOf = (group: LayoutGroup): string | undefined => {
        const index = group.sections[0]!.indexes[0]!;
        const place = store.lines[index]!.place;
        return place?.kind === "new" ? place.afterGroupId : undefined;
      };
      const heldIds = new Set(this.#heldInOrder.map((group) => group.id));
      const inFiringOrder = [
        ...layout.filter((group) => group.kind === "fire"),
        ...this.#heldInOrder.flatMap((held) => [
          ...layout.filter((group) => group.groupId === held.id),
          ...newlyHeld.filter((group) => anchorOf(group) === held.id),
        ]),
        ...newlyHeld.filter((group) => !heldIds.has(anchorOf(group) ?? "")),
        ...layout.filter((group) => group.kind === "join" && !heldIds.has(group.groupId!)),
      ];
      const chosen = new Set(indexes);
      const source = inFiringOrder
        .reverse()
        .find((group) =>
          group.sections.some((section) => section.indexes.some((index) => chosen.has(index))),
        );
      if (source === undefined) return;
      const afterGroupId = source.kind === "join" ? source.groupId! : anchorOf(source);
      const slot =
        source.kind === "new"
          ? source.slot! + 1
          : source.kind === "fire"
            ? 1
            : (newlyHeld.find((group) => anchorOf(group) === afterGroupId)?.slot ??
              Math.max(0, ...newlyHeld.map((group) => group.slot!)) + 1);
      store.setLinePlaces(
        indexes,
        {
          kind: "new",
          slot,
          ...(afterGroupId === undefined ? {} : { afterGroupId }),
        },
        { from: slot },
      );
    } else {
      if (target.kind === "join" && !this.#heldGroupIds?.has(target.groupId)) return;
      if (
        target.kind === "new" &&
        !store.lines.some(
          ({ place }) =>
            place?.kind === "new" &&
            place.slot === target.slot &&
            place.afterGroupId === target.afterGroupId,
        )
      )
        return;
      store.setLinePlaces(indexes, target);
    }
    this.draftMoveStore = null;
  }

  #draftMoveDialog(store: WorkingOrderStore): TemplateResult {
    const layout = this.#draftLayout(store);
    const option = (key: string, label: string, place: Place | "new") =>
      html`<wt-button
        variant="secondary"
        data-draft-move-to=${key}
        @click=${() => this.#moveDraftSelection(store, place)}
        >${label}</wt-button
      >`;
    return html`<wt-dialog
      ${trackDialog()}
      data-draft-move-dialog
      .heading=${t("table.move_line")}
      .open=${this.draftMoveStore === store && !store.editsLocked && !store.sending}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) this.draftMoveStore = null;
      }}
    >
      <div class="action-options">
        ${option("fire", t("table.destination_fire_now"), { kind: "fire" })}
        ${layout
          .filter((group) => group.kind === "new")
          .map((group) => {
            const place = store.lines[group.sections[0]!.indexes[0]!]!.place!;
            return option(group.key, this.#draftGroupName(group), place);
          })}
        ${this.#heldInOrder.map((group) =>
          option(
            `join:${group.id}`,
            t("table.draft_joins_group").replace("{n}", groupNumberText(group)),
            { kind: "join", groupId: group.id },
          ),
        )}
        ${option("new", `+ ${t("table.move_new_group")}`, "new")}
      </div>
      <wt-button
        slot="footer"
        variant="secondary"
        @click=${() => {
          this.draftMoveStore = null;
        }}
        >${t("action.back")}</wt-button
      >
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
        ${this.#billAdjust()} ${this.canSettle && this.#chargeable() ? this.#paySection() : nothing}
        ${this.#billsSection()} ${this.#statusSection()} ${this.#actionSection()}
      </aside>
    `;
  }

  #chargeable(): boolean {
    const shown = this.#shownBill;
    return this.paymentConfirmation !== undefined || shown === undefined || owing(shown);
  }

  #paySection(): TemplateResult {
    const shown = this.#shownBill;
    const partlyPaid =
      this.paymentConfirmation === undefined && shown !== undefined && paidInPart(shown)
        ? shown
        : undefined;
    if (partlyPaid === undefined)
      return html`<section
        class="pay"
        @confirm-payment=${(event: Event) => this.#onTenderConfirm(event)}
        @park-order=${(event: Event) => this.#onTenderPark(event)}
      >
        <h2>${t("table.pay_title")}</h2>
        <till-tender-pay
          .store=${this.#payStore}
          .busy=${this.busy}
          .takesCash=${this.takesCash}
          .fullInvoices=${this.fullInvoices}
          .asksGuests=${shown?.invoiceType !== "F1"}
          .receiptGuests=${defaultReceiptGuests(this.party)}
          .confirmation=${this.paymentConfirmation}
        ></till-tender-pay>
        ${this.paymentConfirmation === undefined ? html`${this.#billChoices(shown)} ${this.#payWays()}` : nothing}
      </section>`;
    const received = this.#balanceShown()?.received;
    return html`<section class="pay" data-bill-payments>
      <h2>${t("table.pay_title")}</h2>
      <p class="amount">
        ${t("table.bill_to_pay").replace("{amount}", () => this.#money(partlyPaid.outstanding))}
      </p>
      ${
        received === undefined
          ? nothing
          : html`<p data-bill-received>${t("bill_pay.received")}: ${this.#money(received)}</p>`
      }
      <wt-button
        variant="primary"
        data-pay-rest
        .disabled=${this.busy}
        @click=${() => this.#payPart("contribution", partlyPaid.outstanding)}
      >
        ${t("bill.pay_with_bill_payments")}
      </wt-button>
      ${this.#billChoices(shown)} ${this.#payWays()}
    </section>`;
  }

  /** Full invoice while full invoices are on, and the receipt's language when several are offered, for a
   * bill still owing. */
  #billChoices(bill: PartyBill | undefined): TemplateResult | typeof nothing {
    if (bill === undefined || !owing(bill)) return nothing;
    if (!this.fullInvoices && this.receiptLanguages.length < 2) return nothing;
    const target = { workingOrderId: bill.workingOrderId, revision: bill.revision };
    return html`<div class="bill-choices">
      ${
        this.fullInvoices
          ? html`<wt-button
              variant="secondary"
              size="sm"
              data-choose-bill-invoice
              .disabled=${this.busy}
              @click=${() => this.#dispatch("choose-bill-invoice", target)}
              >${t("invoice.full")}</wt-button
            >`
          : nothing
      }${
        this.receiptLanguages.length < 2
          ? nothing
          : html`<wt-button
              variant="secondary"
              size="sm"
              data-choose-bill-language
              .disabled=${this.busy}
              @click=${() => this.#dispatch("choose-bill-receipt-language", target)}
              >${receiptLanguageLabel(
                shownReceiptLanguage(bill.receiptLanguage, this.receiptLanguages),
              )}</wt-button
            >`
      }
    </div>`;
  }

  /** The balance read, when it is the bill on screen's. */
  #balanceShown(): BillBalance | null {
    const balance = this.billBalance;
    return balance !== null && balance.workingOrderId === this.orderId ? balance : null;
  }

  #payWays(): TemplateResult {
    return html`<div class="bill-pay-ways">
      ${PAY_WAYS.map(
        ({ way, label }) =>
          html`<wt-button
            variant="secondary"
            size="sm"
            data-open-bill-pay=${way}
            .disabled=${this.busy}
            @click=${() => this.#payPart(way)}
          >
            ${t(label)}
          </wt-button>`,
      )}
    </div>`;
  }

  #payPart(way: PayWay, amount?: string): void {
    const detail: BillPayDetail = {
      way,
      lines: payLines(this.lines, (line) => this.#nameForLine(line)),
      ...(amount === undefined ? {} : { amount }),
    };
    this.#dispatch("bill-pay", detail);
  }

  /** What is paid of the line numbered `lineNo` on the bill on screen, when any is. */
  #paidMark(lineNo: number, quantity: string): TemplateResult | typeof nothing {
    const balance = this.#balanceShown();
    const paid = balance === null ? undefined : paidQuantities(balance).get(lineNo);
    if (paid === undefined || compareDecimal(decimal(paid), decimal("0")) <= 0) return nothing;
    const whole = compareDecimal(decimal(paid), decimal(quantity)) >= 0;
    return html`<span class="line-paid" data-line-paid
      >${
        whole
          ? t("bill_pay.paid")
          : t("bill_pay.paid_part")
              .replace("{paid}", () => this.#displayQty(paid))
              .replace("{quantity}", () => this.#displayQty(quantity))
      }</span
    >`;
  }

  #shownBills(): PartyBill[] {
    return shownBills(this.bills);
  }

  #billName(index: number): string {
    return billName(this.party?.displayName ?? "", index);
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
              <div class="finish-refusal-actions">
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
                        </wt-button>
                        <wt-button
                          size="sm"
                          variant="secondary"
                          data-record-departure
                          @click=${() => this.#dispatch("record-unpaid-departure", {})}
                        >
                          ${t("departure.record")}
                        </wt-button>`
                }
              </div>
            </div>`
          : nothing
      }
      ${this.#billRequest(this.party)}
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

  /** Whether the party has asked for the bill is read from the floor, which carries it. */
  #billRequest(party: TableParty): TemplateResult {
    const request = billRequestOf(this.tables, party.id);
    const scope = (key: "table.request_bill" | "table.cancel_bill_request") =>
      t(key).replace("{party}", () => party.displayName);
    return html`<div class="bill-request">
      ${
        request !== undefined
          ? html`${renderFloorChips(signalChips([request]))}
              <wt-button
                variant="secondary"
                data-cancel-bill-request
                .disabled=${this.groupCommandBusy}
                @click=${() => this.#dispatch("request-bill", { requested: false })}
              >
                ${scope("table.cancel_bill_request")}
              </wt-button>`
          : html`<wt-button
              variant="secondary"
              data-request-bill
              .disabled=${this.groupCommandBusy}
              @click=${() => this.#dispatch("request-bill", { requested: true })}
            >
              ${scope("table.request_bill")}
            </wt-button>`
      }
    </div>`;
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
        ><span class="bill-name">${this.#billName(index)}</span> ${
          bill.invoiceType === "F1" && bill.recipient !== null
            ? html`<span class="bill-invoice" data-invoice-choice
                >${t("invoice.full")} · ${bill.recipient.legalName} · ${bill.recipient.taxId}</span
              >`
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
        ${
          bill.status === "placed" && bill.receiptAvailable && !bill.hasPayments
            ? html`<wt-button
                size="sm"
                variant="secondary"
                data-cancel-credit
                @click=${() =>
                  this.#dispatch("cancel-credit-bill", { workingOrderId: bill.workingOrderId })}
              >
                ${t("cancel_credit.action")}
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

  #nutrition(line: OrderLine | { nutrition?: LineNutrition }) {
    if ("product" in line) {
      const served = asServedAllergens(line);
      return nutritionIcons(
        served.pending ? null : served.allergens,
        nutritionDietLabels(asServedDiet(line), line.product.dietaryDeclarations),
      );
    }
    return nutritionIcons(
      line.nutrition?.allergens,
      nutritionDietLabels(undefined, line.nutrition?.dietaryDeclarations),
    );
  }

  #pendingLine(line: TabLine): TemplateResult {
    const name = this.#nameForLine(line);
    return html`<li class="line pending-line${this.#isChild(line) ? " child-line" : ""}">
      <span class="name"
        >${name}${this.#nutrition(line)}${optionAnswers(line.optionSnapshots, { reads: "staff" }).map((answer) => html`<span class="modifier-answer">${answer}</span>`)}${this.#lineNote(line)}${this.#paidMark(line.lineNo, line.quantity)}</span
      >
      <span class="qty">${this.#displayQty(line.quantity)}</span>
      ${this.#lineTotal(line)} ${this.#lineCourse(line)} ${this.#lineActions(line)}
    </li>`;
  }

  /** A served dish can still be given away or discounted. */
  #servedActions(line: TabLine): TemplateResult | typeof nothing {
    const actions = this.#adjustActions(line);
    return actions.length === 0 ? nothing : html`<span class="line-actions">${actions}</span>`;
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
                      >${this.#nameForLine(line)}${this.#nutrition(line)}${optionAnswers(line.optionSnapshots, { reads: "staff" }).map((answer) => html`<span class="modifier-answer">${answer}</span>`)}${this.#lineNote(line)}${this.#paidMark(line.lineNo, line.quantity)}</span
                    >
                    <span class="qty">${this.#displayQty(line.quantity)}</span>
                    ${this.#lineTotal(line)} ${this.#lineCourse(line)} ${this.#servedActions(line)}
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
    const name = groupName(group);
    const label = (key: StringKey) => `${t(key)} · ${name}`;
    const place = held.indexOf(group);
    const shown = this.currentOrders?.groups.find((candidate) => candidate.id === group.id);
    const current = this.currentOrders === null ? null : (shown?.rows ?? []);
    const fires = this.fireControl === "waiter";
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
                      @click=${() => this.#requestFireGroup(group)}
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

  /** A row of Current orders. `held` is its group while that group is held, when the row offers Move
   * and Split; otherwise it says what is known of it and, once released, offers Mark served. */
  #currentRow(row: CurrentOrderRow, held: OrderGroup | null): TemplateResult {
    const state = held === null ? this.#rowState(row) : nothing;
    const served = decimal(row.servedQuantity);
    const partly = compareDecimal(served, decimal("0")) > 0 && row.servedAt === null;
    return html`<li class="group-line current-row" data-group-line=${row.lineId}>
      <span class="row-what">
        <span class="group-line-name"
          >${row.name}${this.#nutrition(row)} ×${this.#displayQty(row.quantity)}</span
        >
        ${row.extras.map(
          (extra) =>
            html`<span class="row-extra">${extra.name} ×${this.#displayQty(extra.quantity)}</span>`,
        )}
        ${
          row.note === null
            ? nothing
            : html`<span class="line-note">${t("line.note.label")}: ${row.note}</span>`
        }
        ${row.workingOrderId === this.orderId ? this.#paidMark(row.lineNo, row.quantity) : nothing}
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
          ? html`${this.#serveActions(row)}${
              row.kitchen?.movable && !this.#pending().some((line) => line.id === row.lineId)
                ? this.#moveStationButton(row.lineNo, {
                    workingOrderId: row.workingOrderId,
                    lineId: row.lineId,
                    name: row.name,
                    stationId: row.kitchen.stationId,
                  })
                : nothing
            }`
          : !this.#billOpen(row.workingOrderId)
            ? nothing
            : this.#heldRowActions(
                {
                  billId: row.workingOrderId,
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
    return decimal(
      trimQuantity(
        undo
          ? served
          : subtractDecimal(
              subtractDecimal(decimal(row.quantity), decimal(row.cancelledQuantity ?? "0")),
              served,
            ),
      ),
    );
  }

  /** More than one whole unit asks how many; anything else, a weighed dish included, goes whole. */
  #requestServe(row: CurrentOrderRow, undo: boolean): void {
    if (!this.isConnected || this.busy || this.groupCommandBusy || this.currentOrdersUnread) return;
    if (undo && !this.#sentBillOpen(row)) return;
    this.#serveAuthority = {
      api: this.api,
      partyId: this.party?.id ?? null,
      billId: this.orderId,
      visit: this.serviceVisit,
    };
    const most = this.#mostToServe(row, undo);
    if (row.unitPrecision === 0 && compareDecimal(most, decimal("1")) > 0) {
      this.#serveOpening++;
      this.#serveScope?.dispose();
      this.#serveScope = undefined;
      this.#serveBaseline = most;
      this.servePending = { row, undo, count: most };
      this.#watchServe();
      const dialog = this.renderRoot.querySelector<WtDialog>("[data-serve-dialog]");
      if (dialog) dialog.open = true;
      return;
    }
    this.#sendServe(row, undo, most);
  }

  #sendServe(row: CurrentOrderRow, undo: boolean, quantity: Decimal): void {
    const authority = this.#serveAuthority;
    this.#serveAuthority = undefined;
    if (
      authority === undefined ||
      !this.isConnected ||
      this.busy ||
      this.groupCommandBusy ||
      this.currentOrdersUnread
    )
      return;
    if (
      authority.api !== this.api ||
      authority.partyId !== (this.party?.id ?? null) ||
      authority.billId !== this.orderId ||
      authority.visit !== this.serviceVisit
    )
      return;
    const current =
      this.currentOrders === null
        ? undefined
        : [
            ...this.currentOrders.ungrouped,
            ...this.currentOrders.groups.flatMap((group) => group.rows),
          ].find(
            (candidate) =>
              candidate.lineId === row.lineId && candidate.workingOrderId === row.workingOrderId,
          );
    if (
      current === undefined ||
      (undo && !this.#sentBillOpen(current)) ||
      (!undo && !current.released) ||
      compareDecimal(quantity, decimal("0")) <= 0 ||
      compareDecimal(quantity, this.#mostToServe(current, undo)) > 0
    )
      return;
    this.#dispatch(undo ? "unserve-lines" : "serve-lines", {
      items: [{ lineId: row.lineId, quantity: trimQuantity(quantity) }],
    } satisfies ServeLinesDetail);
  }

  #stepServe(delta: -1 | 1): void {
    const pending = this.servePending;
    if (!this.isConnected || pending === null) return;
    const count =
      delta === -1
        ? subtractDecimal(pending.count, decimal("1"))
        : addDecimal(pending.count, decimal("1"));
    this.servePending = { ...pending, count };
    this.#serveScope?.changed();
  }

  #confirmServe(): void {
    const pending = this.servePending;
    if (!this.isConnected || pending === null) return;
    this.servePending = null;
    this.#watchServe();
    this.renderRoot.querySelector<WtDialog>("[data-serve-dialog]")!.closeAfter("saved");
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
      .beforeClose=${this.#serveScope ? this.#beforeServeClose : undefined}
      @wt-close=${(event: Event) => this.#closeServe(event)}
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
        <wt-button variant="secondary" data-serve-dismiss @click=${() => this.#dismissServe()}>
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
      <span class="group-line-name"
        >${name}${this.#nutrition(line)} ×${this.#displayQty(line.quantity)}</span
      >
      ${this.#paidMark(line.lineNo, line.quantity)}
      ${
        group === null
          ? nothing
          : this.#heldRowActions(
              {
                billId: this.orderId,
                lineId: line.id,
                name,
                quantity: line.quantity,
                splits: moreThanOneWholeUnit(line) && !this.#dishesWithExtras.has(line.lineNo),
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
            expectedEdits: this.#moveLineEdits(row.billId),
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

  #moveLineEdits(billId: string | undefined): BillEditExpected[] | null {
    const edit =
      this.billEdits.find((edit) => edit.billId === billId) ??
      (this.billEdit?.billId === billId ? this.billEdit : null);
    return edit == null ? null : [{ ...edit }];
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
      expectedEdits: pending.expectedEdits,
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

  #requestFireGroup(group: OrderGroup): void {
    if (!this.isConnected || this.busy || this.groupCommandBusy) return;
    this.#fireAuthority = {
      api: this.api,
      partyId: this.party?.id ?? null,
      billId: this.orderId,
      visit: this.serviceVisit,
    };
    this.fireGroupPending = group;
  }

  #confirmFireGroup(): void {
    const group = this.fireGroupPending;
    const authority = this.#fireAuthority;
    this.fireGroupPending = null;
    this.#fireAuthority = undefined;
    if (
      group === null ||
      authority === undefined ||
      !this.isConnected ||
      this.busy ||
      this.groupCommandBusy
    )
      return;
    if (
      authority.api !== this.api ||
      authority.partyId !== (this.party?.id ?? null) ||
      authority.billId !== this.orderId ||
      authority.visit !== this.serviceVisit
    )
      return;
    if (!this.groups.some((current) => current.id === group.id && current.state === "held")) return;
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

  #tableTargets(): TableState[] {
    const own = new Set(this.party?.tableIds ?? []);
    const keepOwn = this.actionVerb === "move" && own.size > 1;
    const sourceZoneId = this.#partyZoneId();
    const zoneId = this.actionVerb === "join" ? sourceZoneId : null;
    const takesOrders =
      this.actionVerb === "move" ||
      (this.actionVerb === "move-bill" &&
        (this.#shownBill === undefined || this.#shownBill.status === "open"));
    const tables = this.tables
      .filter((table) => !outOfServiceJoined(table))
      .filter((table) => zoneId === null || table.zoneId === zoneId)
      .filter(
        (table) =>
          !takesOrders ||
          table.zoneId === sourceZoneId ||
          !this.zones.find((zone) => zone.id === table.zoneId)?.closed,
      )
      .filter(
        (table) =>
          table.party !== null || seatsGuests(this.zones.find((zone) => zone.id === table.zoneId)),
      )
      .sort((a, b) => inNumberOrder(tableShownName(a), tableShownName(b)));
    const owned = keepOwn ? tables.filter((table) => own.has(table.id)) : [];
    return [...owned, ...tables.filter((table) => !own.has(table.id))];
  }

  /** The zone of the first of the party's tables this screen knows with one; null when none. */
  #partyZoneId(): string | null {
    for (const id of this.party?.tableIds ?? []) {
      const zoneId = this.tables.find((table) => table.id === id)?.zoneId;
      if (zoneId != null) return zoneId;
    }
    return null;
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
    this.#relocationPrompt = null;
    this.#retireActions();
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
    this.#relocationPrompt = null;
    this.actionVerb = verb;
    if (verb === "split") {
      this.splitQuantities = new Map();
      this.splitAttempted = false;
    }
    this.actionStep = verb === "split" ? "split-lines" : "pick";
    this.#watchActions();
  }

  #prepareRelocation(
    verb: TableVerb,
    table: TableState | null,
    proceed: (prompt: object) => void,
  ): void {
    const prompt = {};
    this.#relocationPrompt = prompt;
    const ready = () => {
      if (!this.isConnected || this.#relocationPrompt !== prompt || this.actionVerb !== verb)
        return;
      proceed(prompt);
    };
    const opening = new CustomEvent<TableRelocationOpenDetail>("table-relocation-open", {
      detail: { verb, table, prompt, ready },
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    if (this.dispatchEvent(opening)) ready();
  }

  #pickTable(table: TableState): void {
    const verb: TableVerb =
      this.actionVerb === "move" || this.actionVerb === "move-bill" ? this.actionVerb : "join";
    this.#prepareRelocation(verb, table, (prompt) => {
      const other = table.party !== null && table.party.id !== this.party?.id;
      if (other) this.billChoice = { verb, table, prompt };
      else this.#sendTableAction(verb, table, "merge", prompt);
    });
  }

  #sendTableAction(
    verb: TableVerb,
    table: TableState,
    bills: BillChoiceDetail["bills"],
    prompt?: object,
  ): void {
    const tableId = table.id;
    const observation = prompt === undefined ? {} : { prompt };
    if (verb === "move")
      this.#dispatch("move-guests", { toTableId: tableId, bills, ...observation });
    else if (verb === "move-bill")
      this.#dispatch("move-bill", {
        to: { tableId, seated: seatedRead(table) },
        bills,
        ...observation,
      } satisfies MoveBillDetail);
    else this.#dispatch("join-tables", { tableId, bills, ...observation });
    this.#closeActions();
  }

  #moveBillToCounter(): void {
    this.#prepareRelocation("move-bill", null, (prompt) => {
      this.#dispatch("move-bill", {
        to: { counter: true },
        bills: "merge",
        prompt,
      } satisfies MoveBillDetail);
      this.#closeActions();
    });
  }

  #onBillChoice(event: Event): void {
    event.stopPropagation();
    const choice = this.billChoice;
    if (choice === null) return;
    const { bills } = (event as CustomEvent<BillChoiceDetail>).detail;
    this.#sendTableAction(choice.verb, choice.table, bills, choice.prompt);
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
      .savedValue=${party.name ?? ""}
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

  #openCounting(): void {
    this.#closeActions();
    this.counting = { value: this.#savedGuests(), refusal: "" };
  }

  #savedGuests(): string {
    const count = this.party?.guestCount ?? null;
    return count === null ? "" : String(count);
  }

  #guestsDialog(): TemplateResult | typeof nothing {
    const counting = this.counting;
    const party = this.party;
    if (counting === null || party === null) return nothing;
    return html`<till-party-guests-dialog
      .tables=${partyTablesLabel(party, this.tables)}
      .value=${counting.value}
      .savedValue=${this.#savedGuests()}
      .refusal=${counting.refusal}
      @party-guests-confirm=${(event: Event) => {
        event.stopPropagation();
        this.counting = null;
        this.#dispatch("guests-party", {
          guestCount: (event as CustomEvent<PartyGuestsDetail>).detail.guestCount,
        });
      }}
      @party-guests-cancel=${(event: Event) => {
        event.stopPropagation();
        this.counting = null;
      }}
    ></till-party-guests-dialog>`;
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
                  name: tableShownName(row),
                  pick: () => {
                    this.splitTableId = id;
                    this.actionStep = "split-table-bill";
                    this.#actionScope?.changed();
                  },
                },
              ];
        });
    return html`<section class="actions" data-split-table>
      <h2>
        ${
          choosingBill
            ? t("table.split_table_bill_heading")
                .replace("{table}", () => tableShownName(table))
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
              @click=${(event: Event) => {
                if (this.#actionControlCurrent(event)) target.pick();
              }}
            >
              ${target.name}
            </wt-button>`,
        )}
      </div>
      ${this.#backButton()}
    </section>`;
  }

  #splitTable(tableId: string, billId: string | null): void {
    this.#closeActions();
    const prompt = {};
    this.#dispatch("split-table-open", { tableId, billId, prompt });
    this.splitGuests = {
      tableId,
      billId,
      staying: this.#savedGuests(),
      leaving: "",
      refusal: null,
      prompt,
    };
  }

  #splitGuestsDialog(): TemplateResult | typeof nothing {
    const splitting = this.splitGuests;
    const party = this.party;
    if (splitting === null || party === null) return nothing;
    const leaving = this.tables.find((row) => row.id === splitting.tableId);
    return html`<till-split-guests-dialog
      .stayingLabel=${tablesLabel(
        party.tableIds.filter((id) => id !== splitting.tableId),
        this.tables,
      )}
      .leavingLabel=${leaving === undefined ? "" : tableShownName(leaving)}
      .staying=${splitting.staying}
      .savedStaying=${this.#savedGuests()}
      .leaving=${splitting.leaving}
      .stayingRefusal=${splitting.refusal?.field === "staying" ? splitting.refusal.message : ""}
      .leavingRefusal=${splitting.refusal?.field === "leaving" ? splitting.refusal.message : ""}
      @split-guests-confirm=${(event: Event) => {
        event.stopPropagation();
        this.splitGuests = null;
        this.#dispatch("split-table", {
          tableId: splitting.tableId,
          billId: splitting.billId,
          guests: (event as CustomEvent<SplitGuestsDetail>).detail,
          ...(splitting.prompt === undefined ? {} : { prompt: splitting.prompt }),
        } satisfies SplitTableDetail);
      }}
      @split-guests-cancel=${(event: Event) => {
        event.stopPropagation();
        this.splitGuests = null;
      }}
    ></till-split-guests-dialog>`;
  }

  #pickBill(bill: PartyBill): void {
    if (this.actionVerb === "merge") {
      this.#dispatch("merge-bills", { fromBillId: bill.workingOrderId });
      this.#closeActions();
    } else {
      this.transferToBillId = bill.workingOrderId;
      this.actionStep = "transfer-lines";
      this.#actionScope?.changed();
    }
  }

  #toggleTransferLine(line: TabLine, event: Event): void {
    if (!this.#actionControlCurrent(event)) return;
    const next = new Set(this.transferLineNos);
    if (next.has(line.lineNo)) next.delete(line.lineNo);
    else next.add(line.lineNo);
    this.transferLineNos = next;
    this.#actionScope?.changed();
  }

  /** Moves whole lines only, so every entry is `{ lineNo }` with no `quantity`. */
  #confirmTransfer(event: Event): void {
    if (!this.#actionControlCurrent(event)) return;
    if (this.transferToBillId === null || this.transferLineNos.size === 0) return;
    const transfers: TabTransfer[] = this.lines
      .filter((line) => this.transferLineNos.has(line.lineNo))
      .map((line) => ({ lineNo: line.lineNo }));
    this.#retireActions();
    this.#dispatch("transfer-lines", { toBillId: this.transferToBillId, transfers });
    this.#closeActions();
  }

  #toggleSplitLine(line: TabLine, event: Event): void {
    if (!this.#actionControlCurrent(event)) return;
    const next = new Map(this.splitQuantities);
    if (next.has(line.lineNo)) next.delete(line.lineNo);
    else next.set(line.lineNo, this.#displayQty(line.quantity));
    this.splitQuantities = next;
    this.#actionScope?.changed();
  }

  #setSplitQuantity(lineNo: number, quantity: string): void {
    const next = new Map(this.splitQuantities);
    next.set(lineNo, quantity);
    this.splitQuantities = next;
    this.#actionScope?.changed();
  }

  #stepSplitQuantity(line: TabLine, delta: -1 | 1, event: Event): void {
    if (!this.#actionControlCurrent(event)) return;
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
  async #confirmSplit(event: Event): Promise<void> {
    if (!this.#actionControlCurrent(event)) return;
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
    this.#retireActions();
    this.#dispatch("split-lines", { transfers });
    this.#closeActions();
  }

  #actionBack(event: Event): void {
    if (!this.#actionControlCurrent(event)) return;
    if (!this.#actionScope) {
      this.#actionBackNow();
      return;
    }
    const opening = this.#actionOpening;
    const step = this.actionStep;
    void this.#actionLeave!.request({
      scopes: [this.#actionId],
      reason: "cancel",
      proceed: () => {
        if (
          !this.isConnected ||
          this.busy ||
          opening !== this.#actionOpening ||
          step !== this.actionStep
        )
          return;
        this.#actionBackNow();
        this.#actionScope?.changed();
        this.#watchActions();
      },
    });
  }

  #actionBackNow(): void {
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
      html`<wt-button
        class="action"
        data-action=${name}
        variant="secondary"
        @click=${(event: Event) => {
          if (this.#actionControlCurrent(event)) choose();
        }}
      >
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
                this.#watchActions();
              })
            : nothing
        }
        ${party === null ? nothing : action("name", "table.action_name", () => this.#openNaming())}
        ${party === null ? nothing : action("guests", "table.action_guests", () => this.#openCounting())}
        ${this.#movable() ? verb("move-bill", "table.action_move_bill") : nothing}
        ${verb("merge", "table.action_merge_bills")} ${verb("transfer", "table.action_transfer")}
        <wt-button
          class="action"
          data-action="split"
          variant="secondary"
          @click=${(event: Event) => {
            if (this.#actionControlCurrent(event)) this.#chooseVerb("split");
          }}
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
                    @click=${(event: Event) => {
                      if (this.#actionControlCurrent(event)) target.pick();
                    }}
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
        variant=${canConfirm ? "primary" : "secondary"}
        ?disabled=${!canConfirm}
        @click=${(event: Event) => this.#confirmTransfer(event)}
      >
        ${t("table.transfer_confirm")}
      </wt-button>
      ${this.#backButton()}
    </section>`;
  }

  #transferLineRow(line: TabLine): TemplateResult {
    const name = this.#nameForLine(line);
    const selected = this.transferLineNos.has(line.lineNo);
    return html`<button
      type="button"
      class="option transfer-line"
      data-transfer-line=${line.lineNo}
      aria-pressed=${selected}
      @click=${(event: Event) => this.#toggleTransferLine(line, event)}
    >
      <span aria-hidden="true">${selected ? "☑" : "☐"}</span> ${name}
      <span class="qty">${this.#displayQty(line.quantity)}</span>
    </button>`;
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
          variant=${this.splitQuantities.size === 0 ? "secondary" : "primary"}
          ?disabled=${this.splitQuantities.size === 0 || errors.length > 0}
          @click=${(event: Event) => void this.#confirmSplit(event)}
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
      <button
        type="button"
        class="option transfer-line"
        data-split-line=${line.lineNo}
        aria-pressed=${selected}
        @click=${(event: Event) => this.#toggleSplitLine(line, event)}
      >
        <span aria-hidden="true">${selected ? "☑" : "☐"}</span> ${name}
        <span class="qty">${this.#displayQty(line.quantity)}</span>
      </button>
      ${
        selected
          ? this.#splitPrecision(line) === 0
            ? this.#splitEachQuantity(line, name, quantity)
            : html`<wt-input
                class="split-quantity"
                data-split-quantity=${line.lineNo}
                name=${`split-quantity-${line.lineNo}`}
                decimal-locale=${currentLocale()}
                required
                .label=${t("table.split_quantity")}
                .value=${quantity}
                .error=${error}
                @wt-change=${(event: Event) => {
                  event.stopPropagation();
                  if (!this.#actionControlCurrent(event)) return;
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
        @click=${(event: Event) => this.#stepSplitQuantity(line, -1, event)}
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
        @click=${(event: Event) => this.#stepSplitQuantity(line, 1, event)}
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
      @click=${(event: Event) => this.#actionBack(event)}
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
