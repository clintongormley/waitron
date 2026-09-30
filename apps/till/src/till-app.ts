import { defaultMenu, type DietPredicate } from "./menu-filter.js";
import { isTillDestination, type TillDestination, tillPath } from "./navigation.js";
import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { UrlStateController, baseStyles, registerIcons } from "@waitron/ui";
import {
  MONEY_SCALE,
  addDecimal,
  decimal,
  formatMoney,
  resolveActiveLocale,
  sumDecimals,
  toScale,
} from "@waitron/shared";
import { countText, currentLocale, named, setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import { diag } from "./diagnostics.js";
import { LocaleChangeController } from "./state/locale-controller.js";
import { TillApi, isNetworkFailure } from "./api/client.js";
import type { ServerRouter } from "./api/server-router.js";
import { WorkingOrderStore } from "./state/working-order.js";
import {
  displayQuantity,
  toWireLineExtras,
  toWireModifiers,
  toWireProductIdentity,
} from "./state/order-line.js";
import { deriveExtraSelections } from "./state/held-extras.js";
import { deriveOptionSelections } from "./state/held-options.js";
import {
  DRAFT_REFUSALS,
  DraftSync,
  asRefusal,
  limited,
  resendUnanswered,
  type DraftRefused,
} from "./state/draft-sync.js";
import { fromDraftLine, rebuildReturned } from "./state/draft-lines.js";
import "./screens/till-lock-screen.js";
import "./screens/till-counter-screen.js";
import "./screens/till-ticket-view.js";
import "./screens/till-schedule-screen.js";
import "./screens/till-floor-screen.js";
import "./screens/till-table-order-screen.js";
import type {
  AdjustDetail,
  ChangeLineDetail,
  Draft,
  FireGroupDetail,
  MoveGroupLineDetail,
  OtherDraft,
  ReorderGroupsDetail,
  ServeGroupDetail,
  ServeLinesDetail,
  SnoozeGroupDetail,
  SplitGroupLineDetail,
  SubmitDraftDetail,
  TakeOverDraftDetail,
  UnsnoozeGroupDetail,
} from "./screens/till-table-order-screen.js";
import type { DraftGroup } from "./state/draft-groups.js";
import "@waitron/ui/src/components/wt-toast.js";
import type { WtToast } from "@waitron/ui/src/components/wt-toast.js";
import "./screens/till-station-screen.js";
import { CROSS_ICON_PATH } from "./widgets/station-queue.js";
import "./screens/till-enrol-screen.js";
import "./screens/till-device-chooser.js";
import "./screens/till-expo-screen.js";
import "./screens/till-allergen-screen.js";
import "./widgets/supervisor-override-dialog.js";
import "./widgets/adjustment-dialog.js";
import {
  refusalField,
  type AdjustKind,
  type AdjustmentChoice,
  type AdjustTarget,
} from "./widgets/adjustment-dialog.js";
import "./widgets/bill-pay-dialog.js";
import type {
  PayLine,
  PayRefusal,
  PayRequest,
  PayTaken,
  PayWay,
  RefundNotice,
} from "./widgets/bill-pay-dialog.js";
import "./widgets/bill-refund-dialog.js";
import type { RefundRefusal } from "./widgets/bill-refund-dialog.js";
import {
  confirmationOf,
  payLines,
  paymentAsk,
  refundOffered,
  refundSubmissionFor,
  submissionFor,
  unansweredAfter,
  type RefundAsk,
  type RefundSubmission,
  type Submission,
} from "./state/bill-payment.js";
import "./widgets/basket-refresh-dialog.js";
import { dialogOpenUnder } from "./widgets/track-dialog.js";
import "./widgets/tab-shell.js";
import "./widgets/card-grid.js";
import type { StringKey } from "./i18n/strings.js";
import type { MoveHeldOrderDetail } from "./widgets/held-orders.js";
import type { SeatedRead } from "./widgets/table-targets.js";
import type { BillPayDetail, MoveBillDetail } from "./screens/till-table-order-screen.js";
import { owing, paidInPart } from "./state/bill-state.js";
import { billRequestOf } from "./state/table-signals.js";
import type { BumpMode, FireControlMode } from "./widgets/station-queue.js";
import type {
  AdjustmentAsk,
  AdjustmentCommand,
  AdjustmentPreview,
  AdjustmentReason,
  AllocationPreview,
  BillBalance,
  BillParty,
  BillPaymentResult,
  BillPaymentView,
  BillRefundResult,
  DeviceStation,
  DraftSubmission,
  FloorZone,
  HeldOrderSummary,
  OrderFlow,
  ServiceZoneSummary,
  PayOutcome,
  GroupCommand,
  CurrentOrders,
  OrderGroup,
  PrintProblem,
  SaleLine,
  Station,
  StationQueueGroup,
  StaffMember,
  SubmittedDraft,
  TabLine,
  TabTransfer,
  TableServiceStatus,
  TableState,
  TableParty,
  TicketState,
  TillActiveReader,
  TillCourse,
  TillInfo,
  MenuState,
  MenuUnavailable,
  TillMenuOffer,
  TillProduct,
  TillSaleResult,
  PartyBill,
  TableActionResult,
  TableActionRevisions,
  BillRevisions,
  MoveBillRevisions,
  MoveBillResult,
  TillZoneMenu,
  ZoneOfferCatalogue,
} from "./api/client.js";
import { menuOfferToTillProduct } from "./api/client.js";
import { kindOfFormFactor } from "./layout.js";
import type { CanvasDef, CapabilityFlag, DeviceKind, ReceiptConfig, TabDef } from "./layout.js";
import { SessionActivity } from "./session-activity.js";
import { MenuStatePoll } from "./state/menu-state-poll.js";
import {
  RemovedLayoutReports,
  withPolledLayouts,
  type RemovedLayout,
} from "./state/home-layout-notices.js";
import {
  type BasketRefresh,
  type BlockReason,
  isStale,
  lineBlock,
  refreshBasket,
  repriceRebuilt,
  withUnavailable,
} from "./state/menu-refresh.js";
import type { ShellAffordance } from "./widgets/tab-shell.js";
import type { OrderLine } from "./state/working-order.js";
import type { StoredLines } from "./widgets/basket.js";
import { adjustableListing } from "./state/adjust-target.js";
import type { LoggedInDetail } from "./screens/till-lock-screen.js";
import type { DevDeviceList } from "./api/client.js";
import { readDevDeviceId, clearDevDeviceId } from "./api/dev-device.js";
import type { TicketIssuer } from "./screens/till-ticket-view.js";
import type {
  CollectCardDetail,
  ConfirmPaymentDetail,
  ParkOrderDetail,
} from "./widgets/tender-pay.js";

import { setContentLanguages } from "@waitron/ui";

export { SUBMIT_RETRY_PAUSE_MS } from "./state/draft-sync.js";

/**
 * `"lock"` (or a boot failure) renders the lock screen; every other value renders the canvas tab shell
 * and names the surface a nav action moved to, not a separately rendered screen.
 */
type Screen =
  "lock" | "counter" | "ticket" | "schedule" | "floor" | "table-order" | "station" | "expo";

/** An overlay over the active canvas tab. Sale context remains local; regular destinations have URLs. */
type Drill = { kind: "table-order" | "ticket" | TillDestination };

/** A handheld's screens, in order; `#onLoggedIn` lands it on `HANDHELD_FACES[1]`. */
const HANDHELD_FACES: Screen[] = ["lock", "floor", "table-order"];

type RefreshList = "held" | "station";

/** How reading an adjusted order again ended. */
type Reread = "read" | "unread" | "gone";

interface RefreshRetry {
  /** What the write that preceded the failed refresh achieved. */
  messageKey: StringKey;
  failures: number;
  secondsLeft: number;
  inFlight: boolean;
}

const REFRESH_RETRY_SECONDS = [5, 10, 30] as const;

// wt-toast draws a `close` icon its consuming app registers.
registerIcons({ close: CROSS_ICON_PATH });

/**
 * How long the till waits on a re-read of the table's offers, a draft read, save or take-over, a
 * submission (from the save before it to its last retry), or a bill request (to its last retry)
 * before cancelling it. It is above the server watchdog's kill bound (`WATCHDOG_KILL_MS` plus
 * `STACK_CAPTURE_MS`, `packages/store/src/venue-liveness.ts`), so a server whose main thread had
 * stopped when the wait began is killed before the till gives up.
 */
const TABLE_REQUEST_LIMIT_MS = 150_000;

/**
 * What a draft's submission leaves to do once the draft is open for edits again. `find-tab`, after a
 * submission that got no answer, moves to the tab the floor now shows for the table the draft was
 * sent from, only while that table still holds the party the screen showed at the submission and the
 * operator is still on it; `landedOn` names the tab the server added the draft to, when it is not the
 * one it was sent to.
 */
type DraftFollowUp = "read-tab" | "find-tab" | "mark-unsellable" | { landedOn: string } | undefined;

/** A draft opened for the order: `sync` is undefined for an order with no party, and `read` false
 * when its read failed. Undefined when the operator session it was opened in has ended. */
type OpenedDraft = { sync: DraftSync | undefined; read: boolean } | undefined;

/**
 * Sale refusals a retry can never clear: the same basket files the same refused record. Every handler
 * whose server call reaches `recordSale` checks them. The settle paths show `sale.refused`, because
 * money may already have been taken; `#onPlaceOrder` takes no tender and shows `place.refused`.
 */
const PERMANENT_SALE_REFUSALS = new Set([
  "fiscal.record_invalid",
  "fiscal.foreign_recipient_unsupported",
]);

/** Table refusals shown in their code's own words. */
const TABLE_REFUSALS = new Set([
  "order.payment_in_flight",
  "table.not_shared",
  "table.not_joined",
  "table.already_in_party",
  "table.inactive",
  "party.main_bill_stays",
  "service_zone.join_mismatch",
  "service_zone.mode_incompatible",
  "group.held_leaves_party",
  "table.needs_clearing",
  "table.not_found",
  "tab.already_open",
  "party.not_open",
  "party.bill_outstanding",
  "bill.presented",
  "bill.paid",
  "bill.other_party",
  "bill.payments_received",
  "bill.line_paid",
  "bill.received_exceeds_total",
  "bill.refund_in_progress",
  "working_order.not_open",
]);

/** Refusals about the money already on a bill: after one, the party's bills and the shown bill's
 * payments are read again, so the screen shows what the bill now holds. */
const BILL_MONEY_REFUSALS = new Set([
  "bill.payments_received",
  "bill.line_paid",
  "bill.received_exceeds_total",
  "bill.refund_in_progress",
  "order.payment_in_flight",
  "working_order.not_open",
]);

function isBillMoneyRefusal(error: unknown): boolean {
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === "string" && BILL_MONEY_REFUSALS.has(code);
}

/** A table refusal as said: a move that would leave the bill owing less than it has received names
 * by how much, with the offer to give that back first. */
function billWriteError(error: unknown, lineChange = false): CounterError {
  const refused = error as { code?: unknown; excess?: unknown } | undefined;
  return refused?.code === "bill.received_exceeds_total" && typeof refused.excess === "string"
    ? { excess: refused.excess, ...(lineChange ? { lineChange: true } : {}) }
    : tableWriteError(error);
}

function isPaymentsReceived(error: unknown): boolean {
  return (error as { code?: string } | undefined)?.code === "bill.payments_received";
}

/** The bill a seated party opens on when it has no main bill: its first unpaid, else its latest. */
function billToOpen(bills: readonly PartyBill[]): string | undefined {
  const unpaid = bills.find(owing);
  return (unpaid ?? bills.at(-1))?.workingOrderId;
}

/** What a move or join sends of who it read at its target table: that party and its revision, null
 * for a table read free, and nothing for a table of the acting party itself. */
function otherPartyRead(
  seated: SeatedRead,
  ownPartyId: string | null,
): Pick<TableActionRevisions, "otherPartyId" | "expectedOtherPartyRevision"> {
  if (seated === null) return { otherPartyId: null };
  if (seated.id === ownPartyId) return {};
  return { otherPartyId: seated.id, expectedOtherPartyRevision: seated.revision };
}

function isPartyOutOfDate(error: unknown): boolean {
  return (error as { code?: string } | undefined)?.code === "party.out_of_date";
}

function tableWriteError(error: unknown): CounterError {
  const code = (error as { code?: string } | undefined)?.code;
  return code !== undefined && TABLE_REFUSALS.has(code) ? { code } : "table.error";
}

/** A refusal of the person's draft save, or with `unsent` of its submission. Taken over, it names
 * who holds the draft now, and says the refused change is lost: the till never sends it again. */
function draftRefusalError({ refused, ownerName }: DraftRefused, unsent = false): CounterError {
  if (refused === "draft.taken_over")
    return unsent ? { takenOver: ownerName ?? "", unsent } : { takenOver: ownerName ?? "" };
  if (refused === "draft.out_of_date") return "table.draft_changed_elsewhere";
  if (refused === "product.not_sold_separately") return { code: refused };
  return DRAFT_REFUSALS.has(refused) || refused === "session.required"
    ? { code: refused }
    : tableWriteError({ code: refused });
}

/** A refused take-over: the drafts have been read again, so each says what changed. */
function takeOverRefusalError(code: string): CounterError {
  if (code === "draft.out_of_date" || code === "draft.taken_over") return "table.take_over_changed";
  if (code === "draft.not_found") return "table.take_over_gone";
  if (code === "draft.already_submitted") return "table.take_over_sent";
  return tableWriteError({ code });
}

/** What another device changed about a party, worked out by comparing the floor before and after.
 * `tables` names the party's tables as they were. */
type PartyChange = { tables: string } & (
  | { kind: "gone" }
  | { kind: "tables"; now: string }
  | { kind: "bills"; outstanding: string }
  | { kind: "bill_request"; requested: boolean }
  | { kind: "other" }
);

function tableLabels(tables: TableState[], ids: readonly string[]): string {
  return ids
    .map((id) => tables.find((table) => table.id === id)?.label)
    .filter((label): label is string => label !== undefined)
    .join(", ");
}

function partyOf(tables: TableState[], partyId: string): TableParty | undefined {
  return tables.find((table) => table.party?.id === partyId)?.party ?? undefined;
}

function describePartyChange(
  was: TableParty,
  before: TableState[],
  after: TableState[],
): PartyChange {
  const is = partyOf(after, was.id);
  const tables = tableLabels(before, was.tableIds);
  if (is === undefined || is.state !== "open") return { tables, kind: "gone" };
  if (was.tableIds.join() !== is.tableIds.join()) {
    return { tables, kind: "tables", now: tableLabels(after, is.tableIds) };
  }
  if (was.billCount !== is.billCount || was.outstanding !== is.outstanding) {
    return { tables, kind: "bills", outstanding: is.outstanding };
  }
  const requested = billRequestOf(after, was.id) !== undefined;
  if (requested !== (billRequestOf(before, was.id) !== undefined)) {
    return { tables, kind: "bill_request", requested };
  }
  return { tables, kind: "other" };
}

function partyChangeDetail(change: PartyChange): string {
  switch (change.kind) {
    case "gone":
      return t("party.changed_gone");
    case "tables":
      return t("party.changed_tables").replace("{tables}", () => change.now);
    case "bills":
      return t("party.changed_bills").replace("{amount}", () =>
        formatMoney(change.outstanding, currentLocale()),
      );
    case "bill_request":
      return t(
        change.requested ? "party.changed_bill_requested" : "party.changed_bill_request_cancelled",
      );
    case "other":
      return t("party.changed_other");
  }
}

function partyChangeMessage(change: PartyChange): string {
  const detail = partyChangeDetail(change);
  return [
    t("party.changed").replace("{table}", () => change.tables),
    detail,
    t("party.try_again"),
  ].join(" ");
}

/** Refusals of a tab-line or group command, shown in their code's own words: each says what the
 * operator can still do. */
const LINE_REFUSALS = new Set([
  "product.unavailable",
  "product.not_sold_separately",
  "ticket.already_started",
  "ticket.already_fired",
  "tab.serve_quantity_invalid",
  "group.not_held",
  "group.not_waiting",
  "group.not_found",
  "group.line_held",
  "submission.id_reused",
]);

function isGroupGone(error: unknown): boolean {
  const code = (error as { code?: string } | undefined)?.code;
  return code === "group.not_held" || code === "group.not_found";
}

function lineWriteError(error: unknown): CounterError {
  const code = (error as { code?: string } | undefined)?.code;
  return code !== undefined && LINE_REFUSALS.has(code) ? { code } : tableWriteError(error);
}

/** Refusals the counter shows in their own words (`codeMessage`): each names what to do next, where
 * the generic "try again" would send the operator round the same refusal. */
const ACTIONABLE_REFUSALS = new Set([
  "order.payment_in_flight",
  "product.unavailable",
  "product.not_sold_separately",
]);

/** Refusals naming a line the table's offers can mark once they are read again. */
const UNSELLABLE_LINE_REFUSALS = new Set(["product.unavailable", "product.not_sold_separately"]);

/** A counter pay, place or hold refusal: its own message when it is actionable, else `fallback`. */
function counterError(error: unknown, fallback: StringKey): CounterError {
  if (isPaymentsReceived(error)) return "bill.pay_with_bill_payments";
  const code = (error as { code?: string } | undefined)?.code;
  return code !== undefined && ACTIONABLE_REFUSALS.has(code) ? { code } : fallback;
}

/** An adjustment dialog: where it was opened, the bill and the revision its lines were read at
 * when it opened, the order visit it opened on (on the counter, the operator session), and the
 * server's last answer. */
interface Adjusting {
  id: number;
  /** The table's open bill, or the stored order in the counter's basket. */
  surface: "table" | "counter";
  orderId: string;
  revision: number;
  visit: number;
  kind: AdjustKind;
  target: AdjustTarget;
  reasons: AdjustmentReason[];
  choice: AdjustmentChoice | null;
  preview: AdjustmentPreview | null;
  refusal: string | null;
  busy: boolean;
  /** The banner that offered this cancel, which goes once the cancel is made. */
  offer: CounterError | undefined;
}

/** The order a bill payment dialog pays: the table's bill on screen, whose `visit` is the order
 * visit, or the counter's stored order in the basket, whose `visit` is the operator session. */
interface PayingOrder {
  surface: "table" | "counter";
  billId: string;
  visit: number;
}

/** The bill payment dialog: the order it pays, and what the server last answered it. */
interface BillPaying extends PayingOrder {
  id: number;
  way: PayWay;
  amount: string;
  lines: PayLine[];
  balance: BillBalance | null;
  asked: PayRequest | null;
  preview: AllocationPreview | null;
  refusal: PayRefusal | null;
  taken: PayTaken | null;
  refunded: RefundNotice | null;
  busy: boolean;
}

/** A refund of one payment, opened from the bill payment dialog `payId`: what was asked, and
 * whether staff are to give a card back on its terminal first. */
interface BillRefunding extends PayingOrder {
  id: number;
  payId: number;
  payment: BillPaymentView;
  /** An amount to offer as the part given back: the excess a refused move named. */
  suggested: string | null;
  terminal: boolean;
  asked: RefundAsk | null;
  refusal: RefundRefusal | null;
  busy: boolean;
}

/** A card the reader did not charge: nothing was recorded on the bill. */
const NOT_CHARGED_OUTCOMES = new Set<BillPaymentResult["outcome"]>([
  "declined",
  "failed",
  "network_unavailable",
]);

/** Refusals of an approver's PIN, which the PIN prompt shows. */
const APPROVER_REFUSALS = new Set([
  "pin.invalid",
  "pin.throttled",
  "person.not_found",
  "person.suspended",
]);

/** Refusals about the reason chosen, after which the reasons are read again. */
const REASON_REFUSALS = new Set([
  "adjustment.action_not_allowed",
  "adjustment.reason_inactive",
  "adjustment_reason.not_found",
]);

/** A change to a line of an order the waiter had started leaving, and how it failed. */
interface LateChange {
  lineName: string;
  /** Absent when the floor no longer lists the table. */
  tableLabel?: string;
  /** The server gave no answer, so the change may have been saved. */
  unanswered: boolean;
  code?: string;
}

function lateChangeMessage(late: LateChange): string {
  // Replacer functions, so a `$` in a name is never read as a replacement pattern.
  const { tableLabel } = late;
  const key = late.unanswered
    ? tableLabel === undefined
      ? "table.change_unconfirmed_no_table"
      : "table.change_unconfirmed"
    : tableLabel === undefined
      ? "table.change_not_saved_no_table"
      : "table.change_not_saved";
  const text = t(key)
    .replace("{line}", () => late.lineName)
    .replace("{table}", () => tableLabel ?? "");
  return text.replace("{reason}", () => codeMessage(late.code ?? "server.internal"));
}

/** A banner's string key, a refusal shown through its code's own message, a save refused because
 * someone took the draft over (naming them), or a change that failed after its order left the
 * screen, with a second message when something else failed since. */
type CounterError =
  | StringKey
  | { code: string }
  | { billPayments: string }
  /** `lineChange`: refused for a change to a line, not a move of items. */
  | { excess: string; lineChange?: true }
  | { takenOver: string; unsent?: true }
  | { partyChanged: PartyChange }
  | { billChanged: BillChange }
  | { lateChange: LateChange; also?: StringKey };

/** What a refusal as out of date found changed when the bill was read again: the dish the
 * adjustment named, gone or changed, or something else on the bill. */
interface BillChange {
  key: "adjust.changed_bill" | "adjust.changed_line" | "adjust.changed_line_gone";
  line: string;
}

/** When a table action was sent: its operator session, and how many table opens had begun. */
interface Sent {
  session: number;
  opens: number;
}

/** A read of the party's bills: the party it was for (null when there was none), the bills (null
 * when the read failed), and its generation, current until a later read starts or
 * {@link #forgetParty} clears the order. */
interface ReadBills {
  read: number;
  partyId: string | null;
  bills: PartyBill[] | null;
}

function errorText(error: CounterError): string | TemplateResult {
  if (typeof error === "string") return t(error);
  if ("code" in error) return codeMessage(error.code);
  if ("takenOver" in error)
    return error.unsent === true
      ? named(
          error.takenOver,
          t("table.draft_taken_over_unsent"),
          t("table.draft_taken_over_unsent_unnamed"),
        )
      : named(
          error.takenOver,
          t("table.draft_taken_over_unsaved"),
          t("table.draft_taken_over_unsaved_unnamed"),
        );
  if ("partyChanged" in error) return partyChangeMessage(error.partyChanged);
  if ("billChanged" in error)
    return t(error.billChanged.key).replace("{line}", () => error.billChanged.line);
  if ("excess" in error) {
    const amount = formatMoney(error.excess, currentLocale());
    return html`<span class="error-part"
        >${t(
          error.lineChange === true
            ? "bill.received_exceeds_total_line_excess"
            : "bill.received_exceeds_total_excess",
        ).replaceAll("{amount}", () => amount)}</span
      ><span class="error-action"
        ><wt-button
          variant="secondary"
          size="sm"
          data-refund-excess
          @click=${(event: Event) =>
            event.currentTarget!.dispatchEvent(
              new CustomEvent("refund-excess", {
                detail: { excess: error.excess },
                bubbles: true,
                composed: true,
              }),
            )}
          >${t("bill.refund_excess").replace("{amount}", () => amount)}</wt-button
        ></span
      >`;
  }
  if ("billPayments" in error)
    return [
      t("table.bill_to_pay").replace("{amount}", () =>
        formatMoney(error.billPayments, currentLocale()),
      ),
      t("bill.pay_with_bill_payments"),
    ].join(". ");
  const late = lateChangeMessage(error.lateChange);
  return error.also === undefined
    ? late
    : html`<span class="error-part">${late}</span><span class="error-part">${t(error.also)}</span>`;
}

/** "Fired: 2 groups. Held: 3 groups.", leaving out a clause with nothing in it. */
function submittedText(tally: { fired: number; held: number; joined: number }): string {
  const count = (n: number, many: StringKey, one: StringKey) =>
    n === 0 ? [] : [countText(n, many, one)];
  return [
    ...count(tally.fired, "table.submitted_fired", "table.submitted_fired_one"),
    ...count(tally.held, "table.submitted_held", "table.submitted_held_one"),
    ...(tally.joined === 0 ? [] : [t("table.submitted_joined")]),
  ].join(" ");
}

/** A request asserting a menu version that is no longer live (D9): nothing was written. */
function isVersionRefusal(error: unknown): boolean {
  return (error as { code?: string } | undefined)?.code === "menu.version_changed";
}

/** Whether a poll names another set of menus, or another version of one, than the till loaded. */
function versionsMoved(loaded: readonly TillZoneMenu[], polled: MenuState["menus"]): boolean {
  return (
    loaded.length !== polled.length ||
    polled.some(
      (menu) => loaded.find((own) => own.id === menu.menuId)?.versionId !== menu.versionId,
    )
  );
}

/** The offers a zone sells now: as loaded, or with the latest poll's unavailable set applied. */
class ZoneOfferIndex {
  #loaded: TillMenuOffer[] = [];
  /** The set last applied, as a sorted key, so an unchanged poll answer rebuilds nothing. */
  #unavailableKey: string | null = null;
  /** The offers with the latest unavailable set applied, kept rather than rebuilt at each read. */
  live: TillMenuOffer[] = [];
  byId = new Map<string, TillMenuOffer>();
  versions = new Map<string, string>();
  /** False after a load that failed, when there is nothing to judge a line against. */
  loaded = false;

  load(catalogue: Pick<ZoneOfferCatalogue, "offers" | "menus">, loaded = true): void {
    this.#loaded = catalogue.offers;
    this.#unavailableKey = null;
    this.#setLive(catalogue.offers);
    this.versions = new Map(catalogue.menus.map((menu) => [menu.id, menu.versionId]));
    this.loaded = loaded;
  }

  /** Whether the set differs from the one last applied; only then is it applied. */
  setUnavailable(unavailable: MenuUnavailable): boolean {
    const key = JSON.stringify([
      [...unavailable.products].sort(),
      [...unavailable.optionLabels].sort(),
      unavailable.extraItems
        .map((item) => `${item.menuItemId} ${item.extraListId} ${item.productId}`)
        .sort(),
    ]);
    if (key === this.#unavailableKey) return false;
    this.#unavailableKey = key;
    this.#setLive(withUnavailable(this.#loaded, unavailable));
    return true;
  }

  #setLive(live: TillMenuOffer[]): void {
    this.live = live;
    this.byId = new Map(live.map((offer) => [offer.id, offer]));
  }

  products(): TillProduct[] {
    return this.live.map((offer) => menuOfferToTillProduct(offer, this.versions.get(offer.menuId)));
  }

  /** Why each line cannot be sold as it stands. A line with no menu version is the server's to price
   * from the live version, so a missing offer marks only a line that came from a versioned one. */
  blocks(lines: readonly OrderLine[]): (BlockReason | undefined)[] {
    return lines.map((line) => {
      if (!this.loaded || line.workingOrderLineId !== undefined) return undefined;
      const offer = this.byId.get(line.product.menuItemId ?? "");
      if (offer === undefined && line.product.menuVersionId === undefined) return undefined;
      return lineBlock(line, offer)?.reason;
    });
  }
}

function isPermanentSaleRefusal(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code !== undefined && PERMANENT_SALE_REFUSALS.has(code);
}

/**
 * Owns the one {@link WorkingOrderStore}, which belongs to the till and survives a change of operator,
 * and the one {@link TillApi}. Screens emit composed events; this element decides what happens next. A
 * rejected sale leaves the basket intact: a till must never lose a sale in progress.
 *
 * Disconnect guards protect shared browser state: post-await locale switches, menu storage writes,
 * and URL updates must not overwrite a replacement app's state. Reactive fields belong to this
 * element; Lit does not paint them after it disconnects.
 */
@customElement("till-app")
export class TillApp extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .app {
        padding-bottom: calc(
          var(--wt-tap-min) + 2 * var(--wt-space-3) + env(safe-area-inset-bottom)
        );
      }

      .error {
        margin: 0 0 var(--wt-space-3);
        padding: var(--wt-space-3);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-danger);
        color: var(--wt-color-on-danger);
        font-weight: var(--wt-font-weight-bold);
        text-align: center;
      }

      .error-part {
        display: block;
      }

      /* Over the page, above the language button: in the flow, its closing would move the floor under a
         waiter's finger. */
      .submitted-toast {
        position: fixed;
        inset-inline: var(--wt-space-3);
        bottom: calc(var(--wt-tap-min) + 2 * var(--wt-space-3) + env(safe-area-inset-bottom));
        z-index: 10;
      }

      .error-action {
        display: block;
        margin-top: var(--wt-space-2);
      }

      .error-part + .error-part {
        margin-top: var(--wt-space-2);
        padding-top: var(--wt-space-2);
        border-top: 1px solid var(--wt-color-on-danger);
      }

      .refresh-message {
        margin: 0;
      }

      .refresh-notice[data-active] {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2) var(--wt-space-3);
        margin: 0 0 var(--wt-space-3);
        padding: var(--wt-space-3);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-warning);
        color: var(--wt-color-on-warning);
      }

      .refresh-notice[data-active] .refresh-message {
        font-weight: var(--wt-font-weight-bold);
      }

      .refresh-countdown {
        flex: 1;
        margin: 0;
      }

      /* The compact waiting-for-promotion banner, muted so it informs without the
         alarm weight of the danger .error banner above. */
      .banner {
        margin: 0 0 var(--wt-space-3);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text-muted);
        text-align: center;
      }

      .mode-indicator {
        margin: 0;
        padding: var(--wt-space-1) var(--wt-space-3);
        border-bottom: 1px solid var(--wt-color-border);
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        text-align: center;
      }
    `,
  ];

  /** The HTTP face of the till. Defaults to a real same-origin client; a test injects a stub. */
  @property({ attribute: false }) api: TillApi = new TillApi();

  /** Set by `main.ts`; undefined in tests that inject none. */
  @property({ attribute: false }) router?: ServerRouter;

  sessionActivity: SessionActivity = new SessionActivity();

  #deviceKind: DeviceKind = "till";

  /** `router` can be set after `connectedCallback`, so both it and `willUpdate` subscribe; a doubled
   * `server-changed` would boot twice. */
  #subscribedRouter?: ServerRouter;

  /**
   * The login session belonged to the server just left, so the operator is dropped locally and boot
   * re-runs against the new one. The working order stays in memory.
   */
  readonly #onServerChanged = (event: Event): void => {
    const { from, to } = (event as CustomEvent<{ from: string; to: string }>).detail;
    // Its own event kind, not `nav`: `#setScreen` below records the nav.
    diag.record("info", "server-switch", { from, to });
    this.operatorPersonId = "";
    this.operatorName = "";
    this.canEdit = false;
    this.#endOperatorSession();
    this.#dropDraft();
    this.errorKey = "server.switched";
    this.#setScreen("lock");
    void this.#boot();
  };

  readonly #onServerState = (): void => this.requestUpdate();

  #subscribeRouter(): void {
    if (this.#subscribedRouter === this.router) return;
    this.#detach();
    this.router?.addEventListener("server-changed", this.#onServerChanged);
    this.router?.addEventListener("state-changed", this.#onServerState);
    this.#subscribedRouter = this.router;
  }

  #detach(): void {
    this.#subscribedRouter?.removeEventListener("server-changed", this.#onServerChanged);
    this.#subscribedRouter?.removeEventListener("state-changed", this.#onServerState);
    this.#subscribedRouter = undefined;
  }

  /** The device profile's idle logout in seconds; `null` disables it. */
  #inactivityTimeoutSeconds: number | null = null;

  readonly #onInteraction = (): void => this.sessionActivity.noteInteraction();

  readonly #onVisibility = (): void => this.sessionActivity.reacquire();

  readonly #onIdle = (): void => void this.#onLogout();

  #configureSessionActivity(): void {
    this.sessionActivity.configure({
      // `operatorPersonId` is not cleared on logout, so `operatorName` is the login signal.
      loggedIn: this.operatorName !== "",
      kind: this.#deviceKind,
      timeoutSeconds: this.#inactivityTimeoutSeconds,
      onIdle: this.#onIdle,
    });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#subscribeRouter();
    // pointerdown/keydown are composed, so they reach this host from inside the screens' shadow roots.
    this.addEventListener("pointerdown", this.#onInteraction);
    this.addEventListener("keydown", this.#onInteraction);
    document.addEventListener("visibilitychange", this.#onVisibility);
    void this.sessionActivity.start();
  }

  override disconnectedCallback(): void {
    this.#menuPoll.stop();
    this.#draftSync?.drop();
    this.#abandonListRefreshes();
    this.#contentLanguageGeneration++;
    clearTimeout(this.#contentLanguageTimer);
    this.#detach();
    this.removeEventListener("pointerdown", this.#onInteraction);
    this.removeEventListener("keydown", this.#onInteraction);
    document.removeEventListener("visibilitychange", this.#onVisibility);
    void this.sessionActivity.stop();
    super.disconnectedCallback();
  }

  /** The one basket the whole flow shares. A stable reference (widgets subscribe to it directly). */
  readonly #store = new WorkingOrderStore();

  /** A stable field, so the shell's `loadLocales` property does not change on every render. */
  readonly #loadLocales = () => this.api.getLocales().then((r) => r.locales);

  /** Recomputed in {@link willUpdate}, so the shell's `affordances` property is not a fresh array on
   * every render. */
  #affordanceList: ShellAffordance[] = [];

  /** The venue's default UI locale, used when no operator's preference applies. */
  #venueLocale = "es-ES";

  /**
   * Set after a full {@link #loadFloorData}, so a repeat floor visit reloads tables only. A flag, not
   * `zones.length > 0`, because a venue with no floor zones leaves that 0. Reset at login and logout.
   */
  #floorLoaded = false;

  constructor() {
    super();
    // Re-renders on a locale switch, so `keyed(currentLocale(), …)` recreates the screens, which read
    // `t()` at render time.
    new LocaleChangeController(this);
    // Subscribed before any widget, so the marks this sets inside the basket's own notification
    // reach every later listener in that same notification.
    this.#store.subscribe(() => this.#evaluateBasket(false));
  }

  @state() private screen: Screen = "lock";
  /** The shell's active tab; undefined only before boot resolves a canvas, or after a boot failure. */
  @state() private activeTabKey?: string;
  /** The drill-in stacked over the shell's active tab, or undefined when the tab body is on top. */
  @state() private drill?: Drill;
  /** An enrolled KDS display: no login, boots straight into its queue. Set only by {@link #boot}. */
  @state() private deviceMode = false;
  /** An enrolled handheld: stays on the lock screen for a PIN login, then lands on the floor. */
  @state() private handheldMode = false;
  /**
   * The device front door {@link #boot} chose, shown ahead of the lock screen and shell: `"chooser"` in
   * dev mode when this tab has adopted no device, `"enrol"` for a browser with no device cookie.
   * `undefined` once enrolled.
   */
  @state() private frontDoor?: "chooser" | "enrol";
  /** Read by {@link #boot} in dev mode, so the chooser need not fetch it again. */
  @state() private devDevices?: DevDeviceList;
  /** Whether this tab has adopted a dev device, which the "Switch device" affordance needs. */
  @state() private devTab = false;
  /** From the boot probe: the lock screen's heading, and the key for the remembered-operator default. */
  @state() private deviceName?: string;
  @state() private deviceId?: string;
  /** Prefetched by the boot probe, so the station screen does not read `GET /api/device/station` again. */
  @state() private initialDeviceStation?: DeviceStation;
  /** The issuer identity printed on the ticket (venue name + NIF), read once from `getTill` on boot. */
  @state() private issuer?: TicketIssuer;
  /** Offers available in the counter's current service zone. Each carries a distinct menu-item ID,
   * even when two menus offer the same product. Table ordering keeps its own zone-specific set. */
  @state() private products: TillProduct[] = [];
  /** Menus available in the counter's current service zone, default first. */
  @state() private menus: TillZoneMenu[] = [];
  @state() private tableProducts: TillProduct[] = [];
  @state() private tableMenus: TillZoneMenu[] = [];
  /** Removed home layouts not yet dismissed. */
  @state() private removedLayouts: RemovedLayout[] = [];
  readonly #removedLayoutReports = new RemovedLayoutReports();
  /** What {@link products} and {@link tableProducts} are built from, so a poll's unavailable set
   * applies without reloading them. */
  readonly #counterOffers = new ZoneOfferIndex();
  readonly #tableOffers = new ZoneOfferIndex();
  /** The zone {@link tableProducts} came from, polled beside the counter's while it is set. */
  #tableZoneId?: string;
  /** The basket-refresh dialog's contents while it is open (D9): the counter's basket or a table's
   * round, and the lines it would re-price. */
  @state() private basketRefresh?: BasketRefresh & {
    store: WorkingOrderStore;
    lines: readonly OrderLine[];
  };
  /** Whether an unsaved basket line keeps Pay shut: it cannot be sold as it stands, or it was priced
   * against a menu version staff have not yet reviewed. */
  @state() private basketHeld = false;
  /** Whether a line was priced against an earlier version and its change was not confirmed. */
  @state() private basketStale = false;
  /** The refresh flow in flight, which a second trigger joins rather than repeats. */
  #basketRefreshing?: Promise<"adopted" | "confirming" | "failed">;
  /** Identify the latest poll-started reload of each zone's offers. Kept apart from the staff
   * actions' counters, so a reload never discards a zone switch's or a table open's answer. */
  #counterRefreshRequest = 0;
  #tableRefreshRequest = 0;
  /** Rounds whose lines carry a mark from a refused send, marked again whenever their table's offers
   * change, so a dish that can be sold again is not left marked. */
  #markedRounds = new Set<WorkingOrderStore>();
  /** The signed-in person's draft on the open order's party. */
  #draftSync?: DraftSync;
  /** Moved on by each sign-in, so a sign-out still saving its draft leaves a later session alone. */
  #signIns = 0;
  /** The draft of an order with no party, which is never saved. */
  #partylessDraft = new WorkingOrderStore();
  /** {@link #draftSync} has been read, so the screen may show it. */
  #draftReady = false;
  /** The draft may hold lines priced against a menu version that is not the live one, and has not
   * been compared with the live version since (D9). */
  #draftRefreshDue = false;
  /** A read of the table's offers made before comparing the draft is out. */
  #draftRereading = false;
  /** The party whose groups {@link tabGroups} holds, once a read of them has finished. */
  #groupsReadFor: string | null = null;
  readonly #menuPoll = new MenuStatePoll({
    read: (zoneId, signal) => this.api.menuState(zoneId, { signal }),
    // A table's zone only while its order is on screen: each read takes a turn of the write lock.
    zones: () =>
      [
        ...new Set([
          this.counterServiceZoneId,
          this.#tableCatalogueActive() ? (this.#tableZoneId ?? "") : "",
        ]),
      ].filter((id) => id !== ""),
    onState: (zoneId, state) => this.#onMenuState(zoneId, state),
  });
  @state() private tableSelectedCatalogueId = "";
  /** Identifies the latest table-selection offer request so a slower prior selection cannot win. */
  #tableOfferRequest = 0;
  /** The {@link #tableOfferRequest} of the latest table open that has made its table the active one. */
  #openClaimed = 0;
  /** Bumped when the waiter goes back to the floor, starts opening a table, selects a tab that hides
   * the order, or logs out, so an answer to a request sent before can tell the order has been left
   * while {@link activeTabId} still names it. Paying the tab does not bump it. */
  #orderVisit = 0;
  /** The {@link #orderVisit} on which the order in {@link activeTabId} was last shown by opening its
   * table or selecting the tab that holds it. */
  #shownOnVisit = 0;
  /** Table opens not yet finished. While one is, an order the waiter came back to does not count as
   * back on screen, because the open may replace it. */
  #tableOpensPending = 0;
  /** Identifies the latest tab-lines read, so an earlier read answering later cannot win. */
  #tabLinesRead = 0;
  /** The same for the party's bills. */
  #partyBillsRead = 0;
  /** Identifies the latest {@link #rereadAmounts}, so once a newer one has started, an older one
   * works out no "Still to pay" from its bills and says nothing. */
  #amountsReread = 0;
  /** The last read of the party's groups failed, so {@link tabGroups} is empty for want of an answer. */
  #groupsUnread = false;
  /** Bumped when the operator's session ends by logout or a server switch, so an answer arriving
   * afterwards can tell that the session it was asked in has ended. */
  #operatorSession = 0;
  @state() private counterServiceZones: ServiceZoneSummary[] = [];
  @state() private counterServiceZoneId = "";
  #counterOfferRequest = 0;
  /** The grid's selected menu, reset to the default at login and changed by the switcher. */
  @state() private selectedCatalogueId = "";
  @state() private selectedDiet: DietPredicate | null = null;
  @state() private operatorName = "";
  /** The schedule screen leaves the operator out of the colleague picker. */
  @state() private operatorPersonId = "";
  @state() private staff: StaffMember[] = [];
  /** Every open working order in the venue, across tills. */
  @state() private heldOrders: HeldOrderSummary[] = [];
  @state() private zones: FloorZone[] = [];
  @state() private tables: TableState[] = [];
  /**
   * From the session's server-computed `canConfigureTill`, never derived from a role here. Hiding the
   * editor is convenience only; the server re-checks `venue.configure`. Reset at logout.
   */
  @state() private canEdit = false;
  /** Every active status, not only those applied to a table, so an unused status can still be picked. */
  @state() private statuses: TableServiceStatus[] = [];
  /** The working-order id of the tab opened from the floor. */
  @state() private activeTabId?: string;
  /** The table id of that tab: `set-status` is keyed by table, not by order. */
  @state() private activeTableId?: string;
  /** The open tab's lines at their locked add-time prices; a tab does not re-price. */
  @state() private tabLines: TabLine[] = [];
  /** The revision {@link tabLines} was read at. */
  @state() private tabRevision = 0;
  /** The order groups of {@link orderParty}, read with {@link tabLines}; empty with no party. */
  @state() private tabGroups: OrderGroup[] = [];
  /** The kitchen tickets of {@link orderParty} that have not printed, read with {@link tabGroups}. */
  @state() private printProblems: PrintProblem[] = [];
  /** {@link orderParty}'s Current orders, read with {@link tabGroups}; null with no party, or when
   * the read failed. */
  @state() private currentOrders: CurrentOrders | null = null;
  /** The last read of {@link currentOrders} failed. */
  @state() private currentOrdersUnread = false;
  /** The bills whose kitchen tickets Reprint sent again since the table was opened. The server
   * reports a problem until the reprint prints, so the next opening of the table is the read that
   * shows a problem still there. */
  @state() private reprintSent: string[] = [];
  #reprinting = false;
  /** Every bill of the party at {@link activeTableId}, read when the table opens and after it changes. */
  @state() private partyBills: PartyBill[] = [];
  /** The party of the order on screen as it was read just before that order's lines and bills: what
   * the screen shows of it, and the revision every command on it sends (D19). A floor read on its own
   * does not move it, so a glance at the floor cannot lend the order view a revision it never showed. */
  @state() private orderParty: TableParty | null = null;
  @state() private groupCommandBusy = false;
  /** Moved on each time a take-over the table screen asked for has answered, or failed. */
  @state() private takeOversAnswered = 0;
  /** Finish table was refused because a bill of the party is unpaid. */
  @state() private finishRefused = false;
  /** A name the server refused for the party, and why, which the table screen shows beside its field. */
  @state() private nameRefusal: { name: string; message: string } | null = null;
  /** The venue's setting for changing sent lines, read with {@link tabLines}. */
  @state() private editSentLines = true;
  /** The line a change refused as started offers to cancel; the table screen opens its Cancel. */
  @state() private cancelOffer: number | null = null;
  /** Defaults to prepay, so an unresolved boot never shows the Place/Collect controls. */
  @state() private orderFlow: OrderFlow = "prepay";
  @state() private onboardingIntent?: TillInfo["onboardingIntent"];
  /** Defaults to `"none"`, so an unresolved boot never shows the integrated-card controls. */
  @state() private cardProvider: TillInfo["cardProvider"] = "none";
  @state() private tipsEnabled = false;
  @state() private activeReaders: TillActiveReader[] = [];
  /** The reader `till-tender-pay` shows before the operator picks one. */
  @state() private defaultReaderId?: string;
  /** Where the current basket sits in an order-then-collect flow; unused under prepay. */
  @state() private stage: "order" | "collect" = "order";
  /** The lines of the stored order last loaded into the basket, as the server lists them; null
   * before any load, or when they could not be read. */
  @state() private counterLines: StoredLines | null = null;
  @state() private stations: Station[] = [];
  /** The default station's queue. Prepay enqueues nothing automatically, so a prepay till never fetches it. */
  @state() private stationQueue: StationQueueGroup[] = [];
  /** Defaults to per-line, which is always correct, until boot answers. */
  @state() private bumpMode: BumpMode = "line";
  /** Defaults to `waiter`, so an unresolved boot never shows the display's fire action. */
  @state() private fireControl: FireControlMode = "waiter";
  @state() private courses: TillCourse[] = [];
  /** The ticket's lines come from this filed result, never the client basket. */
  @state() private result?: TillSaleResult;
  /** The location's issuance behavior; non-auto modes offer the original on the completion screen. */
  @state() private receiptPrintMode: "auto" | "on_request" | "never" = "auto";
  /** Whether the issuance-time original action is still available for the ticket currently shown. */
  @state() private originalReceiptAvailable = false;
  /** The working order that produced the ticket currently shown, a bill split off another included. */
  private ticketWorkingOrderId?: string;
  /**
   * The receipt's language, kept apart from the operator UI locale so a fiscal locale the UI does not
   * support never changes the printed ticket's language.
   */
  @state() private invoiceLocale = "es-ES";
  /**
   * The server resolves a canvas for every boot, so this is `undefined` only after a boot failure, where
   * {@link render} shows the lock screen rather than an empty shell.
   */
  @state() private canvas?: CanvasDef;
  /** The card grid hides a card whose required capability is absent, except `tender-pay`, which also
   * takes cash. */
  @state() private capabilities: CapabilityFlag[] = [];
  /** The non-fiscal receipt trim; `{}` when the server omits it. */
  @state() private receipt: ReceiptConfig = {};
  /** The non-fatal error to show over the counter, or `undefined` for none. */
  @state() private errorKey?: CounterError;
  /** What a complete submission of a draft did, said once the till is back on the floor. */
  @state() private submittedNotice: string | null = null;
  /**
   * Authorizers for an open cash-drawer override; `undefined` means the dialog is closed, and a possibly
   * empty array opens it.
   */
  @state() private overrideAuthorizers?: StaffMember[];
  /** An error code shown inside the open override dialog; cleared before each attempt so a repeat
   * re-shows. */
  @state() private overrideError: string | null = null;
  /** The open cancel, give-away or discount dialog, with what the server last answered it. */
  @state() private adjusting: Adjusting | null = null;
  /** The people who can approve the adjustment being confirmed; set, their PIN prompt is open. */
  @state() private adjustApprovers?: StaffMember[];
  @state() private adjustApproverError: string | null = null;
  /** Each opening of the adjustment dialog, so an answer to a closed one changes nothing. */
  #adjustments = 0;
  /** The payments of the bill on screen, while its party's bills say it holds any. */
  @state() private billBalance: BillBalance | null = null;
  #billBalanceRead = 0;
  /** The open bill payment dialog, with what the server last answered it. */
  @state() private billPaying: BillPaying | null = null;
  #billPays = 0;
  /** The last bill payment sent that no result answered (`unansweredAfter`), which the same
   * confirmation resends under its submission id. */
  #unansweredPayment: Submission | null = null;
  /** The open refund dialog, over the bill payment dialog. */
  @state() private billRefunding: BillRefunding | null = null;
  #billRefunds = 0;
  /** The people who can approve the refund being confirmed; set, their PIN prompt is open. */
  @state() private refundApprovers?: StaffMember[];
  @state() private refundApproverError: string | null = null;
  /** The last refund sent that no result answered, which the same refund resends under its id. */
  #unansweredRefund: RefundSubmission | null = null;
  /** Ends the basket's edit lock taken by the latest {@link #reloadCounterOrder}; a no-op once it
   * has ended, and for a lock taken later. */
  #endReloadLock: () => void = () => {};
  #adjustOpening = false;
  /**
   * The outcome of the last non-captured `collect-card` attempt. Cleared wherever the basket it describes
   * leaves the counter, and deliberately not by `#onDiscardOrder`, which never touches the loaded basket.
   */
  @state() private cardOutcome?: Exclude<PayOutcome, { outcome: "captured" }>["outcome"];
  /**
   * Single-flight guard: two chained fiscal records for one purchase cannot be repaired. Set
   * synchronously before the first await of {@link TillApp.#onConfirmPayment}, so a second
   * `confirm-payment` before the first settles is a no-op; disabling the button is only the visible
   * feedback.
   */
  @state() private submitting = false;
  /** Re-entry guard for {@link TillApp.#onParkOrder}, set before its first await. */
  @state() private parking = false;
  /** Re-entry guard for {@link TillApp.#onPlaceOrder}; also disables Place while in flight. */
  @state() private placing = false;
  /** A list whose refresh failed after a successful write, with its automatic retry's countdown. */
  @state() private refreshRetries: Partial<Record<RefreshList, RefreshRetry>> = {};
  #refreshTimers = new Map<RefreshList, ReturnType<typeof setTimeout>>();
  #refreshGeneration: Record<RefreshList, number> = { held: 0, station: 0 };

  readonly #url = new UrlStateController(this, () => this.#onHistory(), tillPath);

  #requestedTab(): string | undefined {
    const requested = this.#url.read("till-tab");
    return this.canvas?.tabs.find((tab) => tab.key === requested)?.key ?? this.canvas?.tabs[0]?.key;
  }

  #setActiveTab(key: string | undefined, replace = false, retainDestination = false): void {
    this.activeTabKey = key;
    if (key !== undefined)
      this.#url.write(
        {
          "till-tab": key,
          ...(retainDestination ? {} : { "till-view": null, "till-station": null }),
        },
        replace,
      );
  }

  #allowsDestination(destination: TillDestination): boolean {
    return (
      !this.deviceMode && (destination === "allergens" || this.#affordances().includes(destination))
    );
  }

  #restoreDestination(): void {
    const requested = this.#url.read("till-view");
    const destination =
      isTillDestination(requested) && this.#allowsDestination(requested) ? requested : null;
    this.drill = destination === null ? undefined : { kind: destination };
    this.#url.write(
      {
        "till-view": destination,
        "till-station": destination === "station" ? this.#url.read("till-station") : null,
      },
      true,
    );
  }

  readonly #onHistory = (): void => {
    if (!this.#inShell()) return;
    const key = this.#requestedTab();
    if (key !== undefined) this.#onTabSelect(key, true);
  };

  override firstUpdated(): void {
    void this.#boot();
  }

  /** `handheldMode` is set after `canvas` in {@link #boot}, so a change to either recomputes the
   * affordances. */
  override willUpdate(changed: PropertyValues): void {
    if (changed.has("canvas") || changed.has("handheldMode"))
      this.#affordanceList = this.#affordances();
    // `router` may be assigned after `connectedCallback`.
    if (changed.has("router")) this.#subscribeRouter();
    // An answer can move the app off the order while the dialog is open. An apply already out
    // carries on without the dialog; #applyAdjustment says what its answer does then.
    const open = this.adjusting;
    if (open !== null && this.#hasLeftAdjusted(open)) this.#closeAdjust();
  }

  #contentLanguageGeneration = 0;
  #contentLanguageTimer?: ReturnType<typeof setTimeout>;

  async #refreshContentLanguages(generation: number): Promise<void> {
    try {
      const config = await this.api.getContentLanguages();
      if (this.isConnected && generation === this.#contentLanguageGeneration)
        setContentLanguages(config);
    } finally {
      if (this.isConnected && generation === this.#contentLanguageGeneration) {
        this.#contentLanguageTimer = setTimeout(() => {
          void this.#refreshContentLanguages(generation).catch(() => undefined);
        }, 60_000);
      }
    }
  }

  async #boot(): Promise<void> {
    this.#abandonListRefreshes();
    clearTimeout(this.#contentLanguageTimer);
    const contentGeneration = ++this.#contentLanguageGeneration;
    try {
      const [till] = await Promise.all([
        this.api.getTill(),
        this.#refreshContentLanguages(contentGeneration),
      ]);
      // `setLocale` changes module-global state, so it must not run for a torn-down app. The state
      // writes below need no guard: Lit never paints a detached element.
      if (!this.isConnected) return;
      this.router?.setServers(till.servers);
      // Only before any login: a login can complete while `getTill` is in flight, and re-applying the
      // venue default would overwrite the operator's own language.
      if (this.operatorPersonId === "") setLocale(till.locale);
      this.#venueLocale = till.locale;
      // A separate field: the UI default drops UI-unsupported codes, which must never change the
      // printed ticket's language.
      this.invoiceLocale = till.invoiceLocale;
      this.onboardingIntent = till.onboardingIntent;
      this.issuer = { venueName: till.venueName, nif: till.nif };
      this.orderFlow = till.orderFlow;
      this.receiptPrintMode = till.receiptPrintMode ?? "auto";
      this.bumpMode = till.bumpMode;
      this.fireControl = till.fireControl;
      this.courses = till.courses;
      this.cardProvider = till.cardProvider;
      this.tipsEnabled = till.tipsEnabled;
      this.activeReaders = till.activeReaders ?? [];
      this.defaultReaderId = till.defaultReaderId;
      this.receipt = till.receipt ?? {};
      this.canvas = till.canvas;
      this.capabilities = till.capabilities;
      this.#inactivityTimeoutSeconds = till.inactivityTimeoutSeconds ?? null;
      // Validated and retained, but not written to the URL: the front-door surfaces are not `/tabs/*`
      // destinations, so the tab is published only when the shell opens.
      this.activeTabKey = this.#requestedTab();
    } catch {
      // Return before the device probe: a till that could not read its own setup is not a display to
      // route into device mode.
      this.errorKey = "boot.error";
      return;
    }
    // `#boot` re-runs, and the branches below only ever set a mode, so reset first.
    this.handheldMode = false;
    this.deviceMode = false;
    this.#deviceKind = "till";
    this.deviceName = undefined;
    this.deviceId = undefined;
    this.frontDoor = undefined;
    this.devTab = readDevDeviceId() !== null;
    this.#setScreen("lock");
    // The till has no server flag for dev mode: the dev-only `GET /api/dev/devices` answers only there,
    // and its list is also the chooser's data.
    if (!this.devTab) {
      try {
        this.devDevices = await this.api.getDevDevices();
        if (!this.isConnected) return;
        this.frontDoor = "chooser";
        return;
      } catch {
        // Not dev mode, or a transient failure.
      }
    }
    // A KDS boots straight into its station, prefetching the queue; a handheld stays on the lock
    // screen; any other or unknown kind is a normal operator till. A browser with no device cookie
    // answers `device.unauthorized` and gets the join screen, which is not a boot failure.
    try {
      const identity = await this.api.getDeviceIdentity();
      this.deviceName = identity.name;
      this.deviceId = identity.deviceId;
      const kind = kindOfFormFactor(identity.formFactor);
      this.#deviceKind = kind ?? "till";
      if (kind === "handheld") {
        this.handheldMode = true;
      } else if (kind === "kds_station") {
        this.initialDeviceStation = await this.api.getDeviceStation();
        if (!this.isConnected) return;
        this.deviceMode = true;
        this.#setScreen("station");
        this.#onHistory();
      }
    } catch (error) {
      // Only a genuine `device.unauthorized` goes to the join screen. Any other failure is transient,
      // and stranding a sellable till behind an approval it cannot get would block sales, so it falls
      // through to the login screen.
      if ((error as { code?: string }).code === "device.unauthorized") this.frontDoor = "enrol";
    }
    this.#configureSessionActivity();
  }

  async #onLoggedIn(event: Event): Promise<void> {
    const { personId, displayName, canConfigureTill, locale } = (
      event as CustomEvent<LoggedInDetail>
    ).detail;
    setLocale(resolveActiveLocale(locale, this.#venueLocale));
    this.#signIns++;
    // Refresh restores regular destinations only after login; sale context remains local.
    this.drill = undefined;
    this.#floorLoaded = false;
    let offerLoadFailed = false;
    try {
      const catalogue = await this.api.listDefaultZoneOffers();
      const { zones, context } = catalogue;
      this.#loadCounterOffers(catalogue);
      this.counterServiceZones = zones ?? [];
      this.counterServiceZoneId = context.zoneId;
      this.api.setServiceZone(context.zoneId);
      if (zones !== undefined && context.serviceMode !== "table_tab")
        this.orderFlow = context.serviceMode;
    } catch {
      offerLoadFailed = true;
      this.#loadCounterOffers({ offers: [], menus: [] }, false);
      this.counterServiceZones = [];
      this.counterServiceZoneId = "";
    }
    // A fresh login starts on the zone's default menu, regardless of the previous menu preference.
    this.#selectMenu(this.#defaultCatalogueId());
    this.#selectDiet(null);
    this.operatorName = displayName;
    this.operatorPersonId = personId;
    this.#resumeOrderDraft();
    this.canEdit = canConfigureTill;
    this.errorKey = offerLoadFailed ? "service_zone.load_error" : undefined;
    this.#configureSessionActivity();
    if (!offerLoadFailed) this.#reconcileBasket();
    this.#menuPoll.start();
    const landingFace = this.handheldMode ? HANDHELD_FACES[1] : "counter";
    if (landingFace === "floor") await this.#loadFloorData();
    // History may change while login data loads and the lock screen still owns the page.
    this.#setActiveTab(this.#requestedTab(), true, true);
    this.#setScreen(landingFace);
    this.#restoreDestination();
    if (landingFace !== "floor") {
      // Counter-only data: a handheld lands on the floor, which shows neither.
      await this.#refreshHeldOrders();
      await this.#refreshStationQueue();
      // Loaded after the counter is shown, and a failure is swallowed, so the roster never blocks a sale.
      try {
        this.staff = await this.api.listStaff();
      } catch {
        // Non-fatal: the picker keeps the roster it had.
      }
    }
    // A restored floor tab needs its data on first paint. The handheld landing already loads it;
    // avoid repeating that load while still loading a floor tab restored on a counter device.
    if (this.#inShell() && !this.#floorLoaded) {
      const tab = this.#activeTab();
      if (tab !== undefined && this.#tabNeedsFloorData(tab)) await this.#loadFloorData();
    }
  }

  #refreshHeldOrders(): Promise<void> {
    return this.#refreshList("held");
  }

  #refreshStationQueue(): Promise<void> {
    return this.#refreshList("station");
  }

  /**
   * For the refresh behind a write that has already succeeded: its failure is a load failure, so it
   * never reaches the write's own error handling.
   */
  #refreshAfterWrite(list: RefreshList, messageKey: StringKey): Promise<void> {
    return this.#refreshList(list, messageKey);
  }

  /**
   * Only the newest refresh of a list may install the list's rows (`heldOrders` or `stationQueue`) or
   * start, change or end its retry, and {@link TillApp.#abandonListRefreshes} makes every earlier
   * request stale. Without a `messageKey` a failure is also thrown to the caller.
   */
  async #refreshList(list: RefreshList, messageKey?: StringKey): Promise<void> {
    const request = ++this.#refreshGeneration[list];
    let install: () => void;
    try {
      install = await this.#loadList(list);
    } catch (error) {
      if (request === this.#refreshGeneration[list]) this.#onRefreshFailed(list, messageKey);
      if (messageKey === undefined) throw error;
      return;
    }
    if (request !== this.#refreshGeneration[list]) return;
    install();
    this.#endRefreshRetry(list);
  }

  async #loadList(list: RefreshList): Promise<() => void> {
    if (list === "station") return this.#loadStationQueue();
    const rows = await this.api.listWorkingOrders();
    return () => (this.heldOrders = rows);
  }

  async #loadStationQueue(): Promise<() => void> {
    if (this.orderFlow === "prepay") return () => (this.stationQueue = []);
    if (this.stations.length === 0) this.stations = await this.api.listStations();
    const defaultStation = this.stations.find((station) => station.isDefault);
    const queue =
      defaultStation === undefined ? [] : (await this.api.getStationQueue(defaultStation.id)).items;
    return () => (this.stationQueue = queue);
  }

  /**
   * One loop per list. A failure while it counts down at most updates what the message says
   * succeeded. A failure while its attempt is in flight counts as that attempt's failure, whether it
   * is the attempt's own or a newer request's, which supersedes the attempt.
   */
  #onRefreshFailed(list: RefreshList, messageKey: StringKey | undefined): void {
    const pending = this.refreshRetries[list];
    if (pending === undefined) {
      if (messageKey === undefined) return;
      this.#setRefreshRetry(list, {
        messageKey,
        failures: 0,
        secondsLeft: REFRESH_RETRY_SECONDS[0],
        inFlight: false,
      });
    } else if (!pending.inFlight) {
      if (messageKey !== undefined) this.#setRefreshRetry(list, { ...pending, messageKey });
      return;
    } else {
      const failures = pending.failures + 1;
      this.#setRefreshRetry(list, {
        messageKey: messageKey ?? pending.messageKey,
        failures,
        inFlight: false,
        secondsLeft: REFRESH_RETRY_SECONDS[Math.min(failures, REFRESH_RETRY_SECONDS.length - 1)]!,
      });
    }
    this.#armRefreshTick(list);
  }

  #setRefreshRetry(list: RefreshList, retry: RefreshRetry | undefined): void {
    const next = { ...this.refreshRetries };
    if (retry === undefined) delete next[list];
    else next[list] = retry;
    this.refreshRetries = next;
  }

  #armRefreshTick(list: RefreshList): void {
    clearTimeout(this.#refreshTimers.get(list));
    this.#refreshTimers.set(
      list,
      setTimeout(() => this.#onRefreshTick(list), 1000),
    );
  }

  #onRefreshTick(list: RefreshList): void {
    const retry = this.refreshRetries[list];
    if (retry === undefined) return;
    if (retry.secondsLeft > 1) {
      this.#setRefreshRetry(list, { ...retry, secondsLeft: retry.secondsLeft - 1 });
      this.#armRefreshTick(list);
      return;
    }
    void this.#retryRefresh(list);
  }

  /** Called by the countdown and by "Try now"; an attempt already in flight is not doubled. */
  async #retryRefresh(list: RefreshList): Promise<void> {
    const retry = this.refreshRetries[list];
    if (retry === undefined || retry.inFlight) return;
    clearTimeout(this.#refreshTimers.get(list));
    this.#setRefreshRetry(list, { ...retry, inFlight: true });
    await this.#refreshList(list, retry.messageKey);
  }

  #endRefreshRetry(list: RefreshList): void {
    clearTimeout(this.#refreshTimers.get(list));
    this.#refreshTimers.delete(list);
    if (this.refreshRetries[list] !== undefined) this.#setRefreshRetry(list, undefined);
  }

  #abandonListRefreshes(): void {
    this.#refreshGeneration.held++;
    this.#refreshGeneration.station++;
    for (const timer of this.#refreshTimers.values()) clearTimeout(timer);
    this.#refreshTimers.clear();
    this.refreshRetries = {};
  }

  #renderRefreshNotice(list: RefreshList): TemplateResult {
    const retry = this.refreshRetries[list];
    // The status region stays in the page and holds only the message, so the countdown's ticks never
    // change what it announces.
    return html`<div
      class="refresh-notice"
      data-refresh-notice=${list}
      ?data-active=${retry !== undefined}
    >
      <p class="refresh-message" role="status">${retry === undefined ? "" : t(retry.messageKey)}</p>
      ${
        retry === undefined
          ? nothing
          : html`<p class="refresh-countdown">
                ${
                  retry.inFlight
                    ? t("refresh.retrying")
                    : retry.secondsLeft === 1
                      ? t("refresh.retry_in_one")
                      : t("refresh.retry_in").replace("{n}", String(retry.secondsLeft))
                }
              </p>
              <wt-button
                variant="secondary"
                data-refresh-retry
                .loading=${retry.inFlight}
                @click=${() => void this.#retryRefresh(list)}
                >${t("refresh.try_now")}</wt-button
              >`
      }
    </div>`;
  }

  #removedLayoutNotice(): TemplateResult {
    return html`<div class="refresh-notice" data-active data-layout-notice>
      ${this.removedLayouts.map(
        ({ menuName, layoutName }) =>
          html`<p class="refresh-message" role="status">
            ${
              layoutName === undefined
                ? t("home_layout.removed_unnamed").replace("{menu}", () => menuName)
                : t("home_layout.removed").replace("{name}", () => layoutName)
            }
          </p>`,
      )}
      <wt-button variant="secondary" data-layout-dismiss @click=${() => (this.removedLayouts = [])}
        >${t("home_layout.dismiss")}</wt-button
      >
    </div>`;
  }

  #defaultStationId(): string | undefined {
    return this.stations.find((station) => station.isDefault)?.id;
  }

  #defaultCatalogueId(menus: TillZoneMenu[] = this.menus): string {
    return defaultMenu(menus)?.id ?? "";
  }

  /** Menu selection filters the product grid without changing the working order or browser history. */
  #onMenuSelected(event: CustomEvent<{ id: string }>): void {
    if (this.#tableCatalogueActive()) this.#selectTableMenu(event.detail.id);
    else this.#selectMenu(event.detail.id);
  }

  #tableCatalogueActive(): boolean {
    return (
      this.drill?.kind === "table-order" || this.#activeTab()?.key === this.#tableOrderTabKey()
    );
  }

  #selectTableMenu(id: string): void {
    if (!this.isConnected) return;
    if (id !== "" && !this.tableMenus.some((menu) => menu.id === id)) return;
    this.tableSelectedCatalogueId = id;
  }

  #selectDiet(predicate: DietPredicate | null): void {
    if (!this.isConnected) return;
    this.selectedDiet = predicate;
    try {
      if (predicate === null) sessionStorage.removeItem("waitron.dietFilter");
      else sessionStorage.setItem("waitron.dietFilter", predicate);
    } catch {
      // Filtering remains available when browser storage is blocked.
    }
  }

  #selectMenu(id: string): void {
    if (!this.isConnected) return;
    if (id !== "" && !this.menus.some((menu) => menu.id === id)) return;
    this.selectedCatalogueId = id;
    try {
      sessionStorage.setItem("waitron.lastMenu", id);
    } catch {
      // The current selection still works when browser storage is unavailable.
    }
  }

  async #onCounterZoneSelected(event: Event): Promise<void> {
    const { zoneId } = (event as CustomEvent<{ zoneId: string }>).detail;
    if (this.#store.lines.length > 0) {
      this.errorKey = "service_zone.basket_active";
      this.requestUpdate();
      return;
    }
    if (!this.counterServiceZones.some((zone) => zone.id === zoneId)) return;
    const request = ++this.#counterOfferRequest;
    try {
      const catalogue = await this.api.listZoneOffers(zoneId);
      const { menus, defaultMenuId, context } = catalogue;
      if (request !== this.#counterOfferRequest || this.#store.lines.length > 0) return;
      this.#loadCounterOffers(catalogue);
      this.counterServiceZoneId = context.zoneId;
      this.api.setServiceZone(context.zoneId);
      if (context.serviceMode !== "table_tab") this.orderFlow = context.serviceMode;
      this.stage = "order";
      await this.#refreshStationQueue();
      this.#selectMenu(defaultMenuId ?? this.#defaultCatalogueId(menus));
      this.errorKey = undefined;
    } catch {
      if (request === this.#counterOfferRequest) this.errorKey = "service_zone.load_error";
    }
  }

  #loadCounterOffers(catalogue: Pick<ZoneOfferCatalogue, "offers" | "menus">, loaded = true): void {
    this.#counterOffers.load(catalogue, loaded);
    this.#reportRemovedLayouts(this.menus, catalogue.menus);
    this.menus = catalogue.menus;
    this.#showCounterOffers();
  }

  #showCounterOffers(): void {
    this.products = this.#counterOffers.products();
    this.#evaluateBasket();
  }

  /**
   * With `loaded` false (a failed load, or a table with no zone) no remembered round is marked.
   * Offers of another version make the draft's comparison due, whichever read loaded them: a read
   * that overtakes a poll's own read discards the poll's answer.
   */
  #loadTableOffers(
    zoneId: string | undefined,
    catalogue: Pick<ZoneOfferCatalogue, "offers" | "menus">,
    loaded = true,
  ): void {
    const before = this.#tableOffers.versions;
    this.#tableZoneId = zoneId;
    this.#tableOffers.load(catalogue, loaded);
    this.#reportRemovedLayouts(this.tableMenus, catalogue.menus);
    this.tableMenus = catalogue.menus;
    this.tableProducts = this.#tableOffers.products();
    if (!loaded) return;
    const { versions, byId } = this.#tableOffers;
    if (versions.size !== before.size || [...versions].some(([id, v]) => before.get(id) !== v))
      this.#draftRefreshDue = true;
    const sync = this.#draftSync;
    if (sync !== undefined)
      sync.reshow(
        new Map([
          ...repriceRebuilt(sync.store.lines, byId, versions),
          ...rebuildReturned(sync.store.lines, byId, versions),
        ]),
      );
    this.#markRounds(true);
    this.#markDraft(true);
  }

  #reportRemovedLayouts(shown: readonly TillZoneMenu[], next: readonly TillZoneMenu[]): void {
    const found = this.#removedLayoutReports.report(shown, next);
    if (found.length > 0) this.removedLayouts = [...this.removedLayouts, ...found];
  }

  /** A round refused because a dish in it cannot be sold as it stands is marked against the table's
   * offers from now on, and the offers are read again. */
  async #markUnsellable(round: WorkingOrderStore): Promise<void> {
    const zoneId = this.#tableZoneId;
    if (zoneId === undefined) return;
    this.#markedRounds.add(round);
    await this.#reloadTableOffers(zoneId);
  }

  /** Marks each marked round's lines again against the table's offers; with `forget`, a round left
   * with no mark is dropped. */
  #markRounds(forget = false): void {
    for (const round of this.#markedRounds) {
      round.setBlocked(this.#tableOffers.blocks(round.lines));
      if (forget && round.lines.every((line) => line.blocked === undefined))
        this.#markedRounds.delete(round);
    }
  }

  /**
   * Marks each line of the person's draft that cannot be sold as it stands against the table's
   * offers. With `newer`, the offers are fresher than the server's last answer, so a line the offers
   * say can be sold loses the server's flag; the next answer brings it back if the server still
   * disagrees. Nothing is marked while the offers could not be read.
   */
  #markDraft(newer = false, notify = true): void {
    const store = this.#draftSync?.store;
    if (store === undefined || !this.#tableOffers.loaded) return;
    const reasons = this.#tableOffers.blocks(store.lines);
    store.setBlocked(reasons, notify);
    if (newer)
      store.setUnavailableOnServer(
        store.lines.map(
          (line, index) => line.unavailableOnServer === true && reasons[index] !== undefined,
        ),
      );
  }

  /**
   * D9 on the table: the person's draft is compared with the table's live offers, as the counter's
   * basket is, when it is due — offers of another version were loaded, or the server's draft
   * replaced what the screen held. With `reread`, a line rebuilt under a version the till does not
   * hold as live has the offers read once more first, and only a version still not live after that
   * is asked about. Nothing relevant changed: the lines take the live version silently. Otherwise
   * the refresh dialog asks. Either way the adopted lines are saved as any edit is. It waits while
   * a send or take-over holds the draft, a save is out, or any dialog is open; the next poll asks
   * again. Another person's draft is never compared.
   */
  #reconcileDraft(reread = true): void {
    const sync = this.#draftSync;
    if (!this.#draftRefreshDue || sync === undefined || !this.#draftReady) return;
    if (!this.#tableOffers.loaded || sync.store.sending || sync.saving) return;
    if (this.basketRefresh !== undefined || dialogOpenUnder(this.renderRoot)) return;
    const zoneId = this.#tableZoneId;
    if (reread && zoneId !== undefined && this.#rebuiltUnknown(sync.store)) {
      if (this.#draftRereading) return;
      this.#draftRereading = true;
      void this.#reloadTableOffers(zoneId).then((read) => {
        this.#draftRereading = false;
        if (read) this.#reconcileDraft(false);
      });
      return;
    }
    this.#draftRefreshDue = false;
    if (sync.store.lineCount > 0) this.#reconcileBasket(sync.store, this.#tableOffers);
  }

  /** Whether a line rebuilt from the server names a version the till does not hold as live. It may
   * be a version newer than the till's offers (another device of the person's saved it first), which
   * only a fresh read of the offers tells apart from an older one. */
  #rebuiltUnknown(store: WorkingOrderStore): boolean {
    return store.lines.some(
      (line) => line.earlierPriceUnknown === true && isStale(line, this.#tableOffers.versions),
    );
  }

  /** Marks each unsaved basket line that cannot be sold as it stands against the counter's offers,
   * and works out whether Pay is held. */
  #evaluateBasket(notify = true): void {
    const versions = this.#counterOffers.versions;
    this.#store.setBlocked(this.#counterOffers.blocks(this.#store.lines), notify);
    const unsaved = this.#store.lines.filter((line) => line.workingOrderLineId === undefined);
    this.basketStale = unsaved.some(
      (line) => line.blocked === undefined && isStale(line, versions),
    );
    this.basketHeld = unsaved.some((line) => line.blocked !== undefined || isStale(line, versions));
  }

  /**
   * A poll's answer (D11): the unavailable set applies to the loaded offers at once, and so does each
   * menu's home layout on the version the till holds ({@link withPolledLayouts}), on both zones, with
   * a layout the answer says was removed added, once, to the removed-layout notice. On the counter's
   * zone a version other than the one loaded runs the basket refresh — unless a sale, hold or place
   * is in flight or the dialog is already open, when the next poll asks again. On the open table's
   * zone a new version reloads that zone's offers and then compares the person's draft
   * ({@link #reconcileDraft}); a comparison put off earlier is tried again at each poll.
   */
  #onMenuState(zoneId: string, state: MenuState): void {
    if (zoneId === this.counterServiceZoneId) {
      const menus = withPolledLayouts(this.menus, state.menus);
      this.#reportRemovedLayouts(this.menus, menus);
      this.menus = menus;
      if (this.#counterOffers.setUnavailable(state.unavailable)) this.#showCounterOffers();
      const busy = this.submitting || this.parking || this.placing;
      if (versionsMoved(this.menus, state.menus) && !busy && this.basketRefresh === undefined)
        void this.#refreshBasket();
    }
    if (zoneId === this.#tableZoneId) {
      const menus = withPolledLayouts(this.tableMenus, state.menus);
      this.#reportRemovedLayouts(this.tableMenus, menus);
      this.tableMenus = menus;
      if (this.#tableOffers.setUnavailable(state.unavailable)) {
        this.tableProducts = this.#tableOffers.products();
        this.#markRounds();
        this.#markDraft(true);
      }
      if (!versionsMoved(this.tableMenus, state.menus)) this.#reconcileDraft();
      else
        void this.#reloadTableOffers(zoneId).then((read) => {
          if (read) this.#reconcileDraft(false);
        });
    }
  }

  /** Reloads the open table's offers; false when they could not be read or a table open overtook
   * the read. */
  async #reloadTableOffers(zoneId: string): Promise<boolean> {
    const action = this.#tableOfferRequest;
    const request = ++this.#tableRefreshRequest;
    const read = new AbortController();
    const limit = setTimeout(() => read.abort(), TABLE_REQUEST_LIMIT_MS);
    try {
      const catalogue = await this.api.listZoneOffers(zoneId, { signal: read.signal });
      if (
        request !== this.#tableRefreshRequest ||
        action !== this.#tableOfferRequest ||
        zoneId !== this.#tableZoneId
      )
        return false;
      this.#loadTableOffers(zoneId, catalogue);
      if (!catalogue.menus.some((menu) => menu.id === this.tableSelectedCatalogueId))
        this.tableSelectedCatalogueId =
          catalogue.defaultMenuId ?? this.#defaultCatalogueId(catalogue.menus);
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(limit);
    }
  }

  /**
   * The refresh flow (D9), not through {@link #onCounterZoneSelected}, which discards an offers
   * load while the basket has lines: reload the counter zone's offers, then compare the basket.
   */
  #refreshBasket(): Promise<"adopted" | "confirming" | "failed"> {
    this.#basketRefreshing ??= (async () => {
      const zoneId = this.counterServiceZoneId;
      const action = this.#counterOfferRequest;
      const request = ++this.#counterRefreshRequest;
      try {
        const catalogue = await this.api.listZoneOffers(zoneId);
        if (
          request !== this.#counterRefreshRequest ||
          action !== this.#counterOfferRequest ||
          zoneId !== this.counterServiceZoneId
        )
          return "failed";
        this.#loadCounterOffers(catalogue);
      } catch {
        return "failed";
      }
      return this.#reconcileBasket();
    })().finally(() => (this.#basketRefreshing = undefined));
    return this.#basketRefreshing;
  }

  /** Nothing relevant changed: the lines take the live version silently. Otherwise the dialog. */
  #reconcileBasket(
    store: WorkingOrderStore = this.#store,
    offers: ZoneOfferIndex = this.#counterOffers,
  ): "adopted" | "confirming" {
    const outcome = refreshBasket(store.lines, offers.live, offers.versions);
    if (outcome.changed.length === 0 && outcome.blocked.length === 0) {
      if (outcome.adopted.size > 0) store.adoptLines(outcome.adopted);
      return "adopted";
    }
    this.basketRefresh = { ...outcome, store, lines: store.lines };
    return "confirming";
  }

  /** Each adopted line is found by the line it was compared as: a draft's lines can move, or be
   * replaced by the server's, while the dialog is open, and a line no longer there is not adopted. */
  #onBasketRefreshConfirmed(): void {
    const refresh = this.basketRefresh;
    this.basketRefresh = undefined;
    if (refresh === undefined) return;
    const lines = refresh.store.lines;
    const adopted = new Map(
      [...refresh.adopted].flatMap(([index, line]) => {
        const now = lines.indexOf(refresh.lines[index]!);
        return now < 0 ? [] : [[now, line] as const];
      }),
    );
    if (adopted.size > 0) refresh.store.adoptLines(adopted);
    // The counter's basket is marked again on every change; a round is marked here.
    if (refresh.store !== this.#store) this.#markRounds();
  }

  /**
   * A round refused `menu.version_changed` gets the counter basket's treatment (D9): the table's
   * offers are reloaded and the round compared with them. It is never lost: the table screen keeps
   * it until the app takes out the lines the server added.
   */
  async #refreshRound(round: WorkingOrderStore): Promise<"adopted" | "confirming" | "failed"> {
    const zoneId = this.#tableZoneId;
    if (zoneId === undefined || !(await this.#reloadTableOffers(zoneId))) return "failed";
    if (round === this.#draftSync?.store) this.#draftRefreshDue = false;
    const outcome = this.#reconcileBasket(round, this.#tableOffers);
    this.#markedRounds.add(round);
    this.#markRounds(true);
    return outcome;
  }

  /**
   * After a request refused `menu.version_changed`, which wrote nothing. A silent adoption retries it
   * once; a second refusal, or a reload that failed, is said in the refusal's own words.
   */
  #afterVersionRefusal(
    outcome: "adopted" | "confirming" | "failed",
    retried: boolean,
    retry: () => Promise<void>,
  ): Promise<void> | void {
    if (outcome === "confirming") return;
    if (outcome === "adopted" && !retried) return retry();
    this.errorKey = { code: "menu.version_changed" };
  }

  /**
   * Settles the basket (prepay). The ticket's lines come from the server result, so a rejection leaves
   * the basket untouched on the counter.
   */
  async #onConfirmPayment(event: Event, retried = false): Promise<void> {
    // Single-flight (see `submitting`): set before the first await.
    if (this.submitting || this.#refusePaidInPart()) return;
    this.submitting = true;
    const tender = (event as CustomEvent<ConfirmPaymentDetail>).detail;
    // The store's stable working-order id is the pay-idempotency key: a re-tap after a lost response
    // replays against the same row rather than filing a second record.
    const id = this.#store.id;
    const lines = this.#currentSaleLines();
    const label = this.#store.label;
    this.errorKey = undefined;
    let reachedFiscal = false;
    let paidMeanwhile = false;
    let refreshed: "adopted" | "confirming" | "failed" | undefined;
    try {
      // The server pays a retrieved order from its stored lines and ignores `lines`, so an edit made
      // after retrieving must be saved first or it is silently dropped from the charge and the record.
      if (!(await this.#syncIfDirty(id, lines, label))) return;
      reachedFiscal = true;
      this.result = await this.api.recordSale(lines, tender, id);
      this.#showTicket(id);
      // A just-paid retrieved order must drop off the held list.
      await this.#refreshAfterWrite("held", "refresh.held_after_sale");
    } catch (error) {
      // The basket stays intact. `sale.refused` is permanent, and its message covers refunding a manual
      // terminal charge; `sale.unconfirmed` means the fiscal call was reached, so the sale may have
      // filed; anything else is the free-to-retry `sale.error`.
      if (isVersionRefusal(error)) refreshed = await this.#refreshBasket();
      else
        this.errorKey = isPermanentSaleRefusal(error)
          ? "sale.refused"
          : reachedFiscal && isNetworkFailure(error)
            ? "sale.unconfirmed"
            : counterError(error, "sale.error");
      paidMeanwhile = isPaymentsReceived(error);
    } finally {
      this.submitting = false;
    }
    if (paidMeanwhile) await this.#readHeldAfterPaidMeanwhile();
    if (refreshed !== undefined)
      await this.#afterVersionRefusal(refreshed, retried, () =>
        this.#onConfirmPayment(event, true),
      );
  }

  /** Another till took a payment on the basket's order first: the held orders are read again, so
   * its pay card offers to take the rest as a bill payment. A failed read leaves the list. */
  async #readHeldAfterPaidMeanwhile(): Promise<void> {
    await this.#refreshHeldOrders().catch(() => undefined);
  }

  /**
   * Like {@link TillApp.#onConfirmPayment}, sharing its `submitting` guard, but a decline, timeout or
   * `network_unavailable` comes back as data, not a throw: nothing was filed, so it is recorded in
   * {@link cardOutcome} and the basket stays, with no error banner.
   */
  async #onCollectCard(event: Event, retried = false): Promise<void> {
    if (this.submitting || this.#refusePaidInPart()) return;
    this.submitting = true;
    const detail = (event as CustomEvent<CollectCardDetail>).detail;
    const id = this.#store.id;
    const lines = this.#currentSaleLines();
    const label = this.#store.label;
    this.errorKey = undefined;
    this.cardOutcome = undefined;
    let reachedFiscal = false;
    let paidMeanwhile = false;
    let refreshed: "adopted" | "confirming" | "failed" | undefined;
    try {
      if (!(await this.#syncIfDirty(id, lines, label))) return;
      reachedFiscal = true;
      const out: PayOutcome = await this.api.pay({
        id,
        lines,
        ...(detail.tip ? { tip: detail.tip } : {}),
        ...(detail.allowOffline ? { allowOffline: true } : {}),
        ...(detail.simulationOutcome === undefined
          ? {}
          : { simulationOutcome: detail.simulationOutcome }),
        // Omitted, the server uses the paying device's default reader.
        ...(detail.readerId === undefined ? {} : { readerId: detail.readerId }),
      });
      if (out.outcome === "captured") {
        this.result = out.ticket;
        this.#showTicket(id, this.orderFlow !== "invoice_first");
        await this.#refreshAfterWrite("held", "refresh.held_after_sale");
      } else {
        this.cardOutcome = out.outcome;
      }
    } catch (error) {
      // The terminal may already have captured before the fiscal record was refused (`finalizeCapture`,
      // `apps/server/src/till-sale.ts`), which is what `sale.refused`'s refund sentence is for.
      if (isVersionRefusal(error)) refreshed = await this.#refreshBasket();
      else
        this.errorKey = isPermanentSaleRefusal(error)
          ? "sale.refused"
          : reachedFiscal && isNetworkFailure(error)
            ? "sale.unconfirmed"
            : counterError(error, "sale.error");
      paidMeanwhile = isPaymentsReceived(error);
    } finally {
      this.submitting = false;
    }
    if (paidMeanwhile) await this.#readHeldAfterPaidMeanwhile();
    if (refreshed !== undefined)
      await this.#afterVersionRefusal(refreshed, retried, () => this.#onCollectCard(event, true));
  }

  #basketPaidInPartFor?: {
    orders: HeldOrderSummary[];
    id: string | undefined;
    held: HeldOrderSummary | undefined;
  };

  /** The retrieved order in the basket, when the held list says a payment is on it. Worked out
   * again only when the held list or the basket's order changes. */
  #basketPaidInPart(): HeldOrderSummary | undefined {
    const id = this.#store.persisted ? this.#store.id : undefined;
    const known = this.#basketPaidInPartFor;
    if (known?.orders === this.heldOrders && known.id === id) return known.held;
    const held =
      id === undefined
        ? undefined
        : this.heldOrders.find((order) => order.id === id && paidInPart(order));
    this.#basketPaidInPartFor = { orders: this.heldOrders, id, held };
    return held;
  }

  /** The basket's pay controls wait: on a stale line, or on an order the single payment refuses. */
  #payHeld(): boolean {
    return this.basketHeld || this.#basketPaidInPart() !== undefined;
  }

  /** The single payment refuses a bill with a payment on it, so the till says to take the rest as a
   * bill payment instead of sending one. */
  #sayBillPayments(outstanding: string): void {
    this.errorKey = { billPayments: outstanding };
  }

  #refusePaidInPart(): boolean {
    const held = this.#basketPaidInPart();
    if (held !== undefined) this.#sayBillPayments(held.outstanding);
    return held !== undefined;
  }

  /** Never carries a price: the server re-prices. */
  #currentSaleLines(): SaleLine[] {
    return this.#store.lines.map((line) => {
      const saleLine: SaleLine = {
        ...toWireProductIdentity(line.product),
        quantity: line.quantity,
        ...toWireLineExtras(line),
        ...toWireModifiers(line),
      };
      if (line.workingOrderLineId !== undefined) {
        saleLine.workingOrderLineId = line.workingOrderLineId;
      }
      return saleLine;
    });
  }

  /**
   * Saves an edited retrieved order before a pay or place. A fresh basket has no server row, and an
   * unedited one has nothing to save.
   * `working_order.not_open` (already settled or placed) is swallowed so the pay routes replay the filed
   * ticket; `placeOrder` is not idempotent and still refuses. An idempotent `placeOrder` is a recorded
   * backlog follow-up (docs/backlog.md).
   */
  async #syncIfDirty(id: string, lines: SaleLine[], label: string | undefined): Promise<boolean> {
    if (!(this.#store.persisted && this.#store.dirty)) return true;
    try {
      const saved = await this.api.updateWorkingOrder(id, {
        lines,
        label,
        revision: this.#store.revision,
      });
      this.#store.markSaved(saved.revision);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "working_order.out_of_date") {
        await this.#reloadChangedOrder(id);
        return false;
      }
      if (code !== "working_order.not_open") throw error;
    }
    return true;
  }

  /**
   * `placeOrder` needs an existing open row, so a fresh basket is parked first and a retrieved one is
   * saved only if edited (see {@link #syncIfDirty}); re-parking a retrieved order would replay it
   * server-side and drop the edit. On success the SAME order moves to the `"collect"` stage.
   */
  async #onPlaceOrder(retried = false): Promise<void> {
    if (this.placing) return;
    this.placing = true;
    const id = this.#store.id;
    const lines = this.#currentSaleLines();
    const label = this.#store.label;
    this.errorKey = undefined;
    // A network failure after the fiscal call started is `sale.unconfirmed`; before it, nothing was filed.
    let reachedFiscal = false;
    let refreshed: "adopted" | "confirming" | "failed" | undefined;
    try {
      if (this.#store.persisted) {
        if (!(await this.#syncIfDirty(id, lines, label))) return;
      } else {
        await this.api.parkOrder({ id, lines, label });
        this.#store.markPersisted();
      }
      reachedFiscal = true;
      await this.api.placeOrder(id);
      this.stage = "collect";
      await this.#refreshAfterWrite("station", "refresh.station_after_place");
    } catch (error) {
      // `place.refused`, not `sale.refused`: placing takes no tender, so its message says nothing
      // about refunds.
      if (isVersionRefusal(error)) refreshed = await this.#refreshBasket();
      else
        this.errorKey = isPermanentSaleRefusal(error)
          ? "place.refused"
          : reachedFiscal && isNetworkFailure(error)
            ? "sale.unconfirmed"
            : counterError(error, "place.error");
    } finally {
      this.placing = false;
    }
    if (refreshed !== undefined)
      await this.#afterVersionRefusal(refreshed, retried, () => this.#onPlaceOrder(true));
  }

  /**
   * Shares `submitting` with {@link TillApp.#onConfirmPayment}. Collect files the order's placed
   * composition, never the local basket, so an edit made after placing does not reach the receipt.
   */
  async #onCollectOrder(event: Event): Promise<void> {
    if (this.submitting) return;
    this.submitting = true;
    const tender = (event as CustomEvent<ConfirmPaymentDetail>).detail;
    const id = this.#store.id;
    this.errorKey = undefined;
    try {
      this.result = await this.api.collectOrder(id, tender);
      this.#showTicket(id, this.orderFlow !== "invoice_first");
    } catch (error) {
      // No preliminary save, so any network failure may have filed. Collect carries a tender, so a
      // permanent refusal takes `sale.refused`.
      this.errorKey = isPermanentSaleRefusal(error)
        ? "sale.refused"
        : isNetworkFailure(error)
          ? "sale.unconfirmed"
          : "sale.error";
    } finally {
      this.submitting = false;
    }
  }

  /** Refreshes on both paths, so a rejected advance (a race with another till) still corrects the queue. */
  async #onAdvanceTicketItem(event: Event): Promise<void> {
    const { itemId, to } = (
      event as CustomEvent<{ itemId: string; to: Exclude<TicketState, "queued"> }>
    ).detail;
    this.errorKey = undefined;
    try {
      await this.api.advanceTicketItem(itemId, to);
    } catch {
      this.errorKey = "station.advance_error";
    }
    await this.#refreshStationQueue();
  }

  /** Non-fiscal, so no single-flight guard; refreshes on both paths like {@link #onAdvanceTicketItem}. */
  async #onMarkCollected(event: Event): Promise<void> {
    const { orderId } = (event as CustomEvent<{ orderId: string }>).detail;
    this.errorKey = undefined;
    try {
      await this.api.markCollected(orderId);
    } catch {
      this.errorKey = "station.collect_error";
    }
    await this.#refreshStationQueue();
  }

  /** The floor's station summary names the station to open; the station screen reads it from the
   * address when it mounts. */
  #onShowStation(event: Event): void {
    this.errorKey = undefined;
    const stationId = (event as CustomEvent<{ stationId?: string } | undefined>).detail?.stationId;
    if (this.#inShell()) {
      this.#pushDrill({ kind: "station" });
      if (stationId !== undefined && this.drill?.kind === "station")
        this.#url.write({ "till-station": stationId }, true);
    } else this.#setScreen("station");
  }

  /**
   * Re-boots rather than reading the kind from the event: the device cookie is the source of truth, so
   * the device lands exactly where a cold load would. The dev chooser's embedded join screen stops this
   * event and does not reach here.
   */
  async #onEnrolled(): Promise<void> {
    await this.#boot();
  }

  async #onSwitchDevice(): Promise<void> {
    clearDevDeviceId();
    await this.#boot();
  }

  /** A revoked device cookie: re-boot, which routes the device to the join screen. */
  async #onDeviceUnauthorized(): Promise<void> {
    await this.#boot();
  }

  #onShowExpo(): void {
    this.errorKey = undefined;
    if (this.#inShell()) this.#pushDrill({ kind: "expo" });
    else this.#setScreen("expo");
  }

  /**
   * A fresh basket is parked under the store's id; a retrieved one is saved only if edited, never
   * re-parked (see {@link TillApp.#onPlaceOrder}). On success `clear()` re-mints the id, and
   * `cardOutcome` is cleared so a decline never carries over to the next customer.
   */
  async #onParkOrder(event: Event, retried = false): Promise<void> {
    if (this.parking) return;
    this.parking = true;
    const { label } = (event as CustomEvent<ParkOrderDetail>).detail;
    // Read the id and map the lines BEFORE the await: a successful clear() re-mints the id, so the
    // values sent must be captured against the basket as it stands now.
    const id = this.#store.id;
    const lines = this.#currentSaleLines();
    this.errorKey = undefined;
    let refreshed: "adopted" | "confirming" | "failed" | undefined;
    try {
      if (this.#store.persisted) {
        // The Hold field opens blank, so fall back to the stored label rather than wipe it. A typed
        // label is saved only when a line was also edited (docs/backlog.md).
        if (!(await this.#syncIfDirty(id, lines, label ?? this.#store.label))) return;
      } else {
        await this.api.parkOrder({ id, lines, label });
      }
      this.#store.clear();
      this.cardOutcome = undefined;
      await this.#refreshAfterWrite("held", "refresh.held_after_park");
    } catch (error) {
      if (isVersionRefusal(error)) refreshed = await this.#refreshBasket();
      else this.errorKey = counterError(error, "held.park_error");
    } finally {
      this.parking = false;
    }
    if (refreshed !== undefined)
      await this.#afterVersionRefusal(refreshed, retried, () => this.#onParkOrder(event, true));
  }

  /**
   * Loads a parked order under its own id, so a later payment uses the same idempotency key. The held
   * list has no live push, so another till may already have paid or discarded the order: that is a
   * non-fatal `held.stale`, the current basket is untouched, and the list refreshes on both paths.
   * `cardOutcome` is cleared only on success, because only then is the basket replaced.
   */
  async #onRetrieveOrder(event: Event): Promise<void> {
    const { id } = (event as CustomEvent<{ id: string }>).detail;
    this.errorKey = undefined;
    try {
      await this.#loadHeldOrder(id);
      this.#refusePaidInPart();
    } catch {
      // Paid or discarded on another till; the basket is untouched.
      this.errorKey = "held.stale";
    }
    // Runs on both paths: on success the list is re-read; on the stale race the vanished row drops off.
    await this.#refreshHeldOrders();
  }

  /**
   * A save refused `working_order.out_of_date` was made from a copy another till has since changed
   * (spec §10.7 example 2): the order is loaded again as it now stands, and staff are told, so they
   * make their change again on it. An order closed meanwhile reads as a stale retrieve.
   */
  async #reloadChangedOrder(id: string): Promise<void> {
    try {
      await this.#loadHeldOrder(id);
      this.errorKey = "held.changed_elsewhere";
    } catch {
      this.errorKey = "held.stale";
    }
    await this.#refreshHeldOrders();
  }

  /** Replaces the basket with the open order `id` as stored, with its lines as the server lists
   * them; a failed read rejects, basket untouched. Nothing changes when `left` says, once the order
   * is read, that the basket has moved on, and the answer is then undefined; otherwise it is whether
   * the lines were read too. */
  async #loadHeldOrder(
    id: string,
    left?: () => boolean,
    signal?: AbortSignal,
  ): Promise<boolean | undefined> {
    const [order, listed] = await Promise.all([
      signal === undefined
        ? this.api.retrieveWorkingOrder(id)
        : this.api.retrieveWorkingOrder(id, { signal }),
      this.#readStoredLines(id, signal),
    ]);
    if (left?.() === true) return undefined;
    const lines: OrderLine[] = [];
    let droppedAProduct = false;
    let extraNotOffered = false;
    let mustChooseAgain = false;
    // Indexed once rather than scanned per line; the first entry wins under either key.
    const liveByProduct = new Map<string, TillProduct>();
    const liveByMenuItem = new Map<string, TillProduct>();
    for (const candidate of this.products) {
      if (!liveByProduct.has(candidate.id)) liveByProduct.set(candidate.id, candidate);
      if (candidate.menuItemId !== undefined && !liveByMenuItem.has(candidate.menuItemId))
        liveByMenuItem.set(candidate.menuItemId, candidate);
    }
    for (const line of order.lines) {
      // The snapshot keeps the order's names and price; the offered lists come from today's live
      // offer, which is what an edit has to answer against.
      const live =
        line.menuItemId === undefined
          ? line.productId === undefined
            ? undefined
            : liveByProduct.get(line.productId)
          : liveByMenuItem.get(line.menuItemId);
      const stored = line.product;
      const product =
        stored === undefined
          ? live
          : {
              ...stored,
              ...(live === undefined ? {} : { offeredModifiers: live.offeredModifiers }),
            };
      if (product === undefined) {
        // A legacy product-only line no longer resolves; contextual lines carry their own snapshot.
        droppedAProduct = true;
        continue;
      }
      // Each pick goes back to the list it was taken from, if the live offer still has it there.
      const picks = deriveExtraSelections(product.offeredModifiers ?? [], line.extras);
      if (picks.notOffered.length > 0) extraNotOffered = true;
      // A still-offered list that nothing matched must be answered again: the server refuses the
      // edit until it is, and falling back to the list's default would change what the diner asked for.
      const answers = deriveOptionSelections(product.offeredModifiers ?? [], line.optionSnapshots);
      if (answers.unanswered.length > 0) mustChooseAgain = true;
      lines.push({
        product,
        quantity: displayQuantity(product, line.quantity),
        ...(line.workingOrderLineId === undefined
          ? {}
          : { workingOrderLineId: line.workingOrderLineId }),
        ...(live === undefined ? { notOffered: true as const } : {}),
        ...(picks.extras.length === 0 ? {} : { extras: picks.extras }),
        ...(picks.notOffered.length === 0 ? {} : { notOfferedExtras: picks.notOffered }),
        ...(answers.options.length === 0 ? {} : { options: answers.options }),
        ...(line.optionSnapshots === undefined ? {} : { optionSnapshots: line.optionSnapshots }),
        ...(line.note === undefined ? {} : { note: line.note }),
      });
    }
    // One banner, so a DROPPED product is reported first: it has already changed what the basket
    // will bill, where the other two change nothing until the operator edits the order.
    if (droppedAProduct) this.errorKey = "held.product_gone";
    else if (extraNotOffered) this.errorKey = "held.extra_not_offered";
    else if (mustChooseAgain) this.errorKey = "held.options_changed";
    this.#store.loadFrom(order.id, lines, order.label ?? undefined, order.revision);
    this.counterLines = listed;
    this.cardOutcome = undefined;
    return listed !== null;
  }

  /** Null when the lines cannot be read: the basket then offers no adjustment, and keeps its own
   * controls on every line. */
  async #readStoredLines(orderId: string, signal?: AbortSignal): Promise<StoredLines | null> {
    try {
      const { lines, revision } = await this.api.getTabLines(orderId, { signal });
      return { orderId, revision, lines };
    } catch {
      return null;
    }
  }

  /** The stored order `orderId` is no longer the basket's (clearing the basket gives it a new id),
   * or the operator session `session` has ended. */
  #hasLeftCounterOrder(orderId: string, session: number): boolean {
    return this.#store.id !== orderId || session !== this.#operatorSession;
  }

  /** Staff edits are locked while the order is read, so the load cannot replace a staff edit made
   * meanwhile; an answer the basket has moved past (cleared, or loaded again, the same order
   * included) is dropped. `unread` when the order or its lines could not be read, or the answer was
   * dropped; `gone` when the order no longer exists and that has been said. */
  async #reloadCounterOrder(orderId: string, session: number): Promise<Reread> {
    const limit = limited(TABLE_REQUEST_LIMIT_MS);
    const unlock = this.#store.lockEdits();
    this.#endReloadLock = unlock;
    limit.signal.addEventListener("abort", unlock, { once: true });
    let load = this.#store.loadGeneration;
    const movedOn = () => load !== this.#store.loadGeneration || session !== this.#operatorSession;
    let failure: StringKey | undefined;
    try {
      const read = await this.#loadHeldOrder(
        orderId,
        () => limit.signal.aborted || movedOn(),
        limit.signal,
      );
      if (read !== undefined) load = this.#store.loadGeneration;
      if (read !== true) failure = "held.reread_failed";
    } catch (error) {
      const gone = (error as { code?: string } | undefined)?.code === "working_order.not_found";
      failure = gone ? "held.stale" : "held.reread_failed";
    } finally {
      limit.done();
      unlock();
    }
    const said = failure !== undefined && !movedOn();
    if (said) this.errorKey = failure;
    await this.#refreshHeldOrders();
    if (failure === undefined) return "read";
    return said && failure === "held.stale" ? "gone" : "unread";
  }

  /** A discard already made on another till is a non-fatal `held.stale`; the list refreshes on both paths. */
  async #onDiscardOrder(event: Event): Promise<void> {
    const { id } = (event as CustomEvent<{ id: string }>).detail;
    this.errorKey = undefined;
    try {
      await this.api.abandonWorkingOrder(id);
    } catch {
      this.errorKey = "held.stale";
    }
    await this.#refreshHeldOrders();
  }

  /**
   * `ticketWorkingOrderId` is captured by every terminal sale path, including a bill split off
   * another, which the counter store cannot identify.
   */
  async #onReprint(): Promise<void> {
    if (this.ticketWorkingOrderId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.reprint(this.ticketWorkingOrderId);
    } catch {
      this.errorKey = "reprint.error";
    }
  }

  /** Enqueue the issuance-time ORIGINAL. Only a successful enqueue retires the original action; a
   * failed request stays retryable and never silently turns the next attempt into a duplicate. */
  async #onPrintReceipt(): Promise<void> {
    if (this.ticketWorkingOrderId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.printReceipt(this.ticketWorkingOrderId);
      this.originalReceiptAvailable = false;
    } catch {
      this.errorKey = "receipt.error";
    }
  }

  /** Enqueue the separate card payment slip. Presentation failure cannot affect the filed sale. */
  async #onPaymentSlip(): Promise<void> {
    if (this.ticketWorkingOrderId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.printPaymentSlip(this.ticketWorkingOrderId);
    } catch {
      this.errorKey = "payment_slip.error";
    }
  }

  /**
   * Tries the direct open first and holds no policy or role knowledge, so it stays correct if the drawer
   * policy changes mid-shift; `authorization.not_permitted` opens the supervisor override.
   */
  async #onOpenDrawer(): Promise<void> {
    // A handheld carries a pocket float rather than a register. Keep this independent of its profile's
    // print/drawer capabilities so a synthetic event cannot reach the manual drawer route.
    if (this.handheldMode) return;
    this.errorKey = undefined;
    try {
      await this.api.openDrawer();
    } catch (error) {
      if ((error as { code?: string }).code === "authorization.not_permitted") {
        await this.#openOverrideDialog();
      } else {
        this.errorKey =
          (error as { code?: string }).code === "drawer.not_attached"
            ? "drawer.not_attached"
            : "drawer.error";
      }
    }
  }

  /** The picker is the server's list of authorizers; the client holds no policy or role knowledge. */
  async #openOverrideDialog(): Promise<void> {
    try {
      const authorizers = await this.api.listDrawerAuthorizers();
      this.overrideError = null;
      this.overrideAuthorizers = authorizers;
    } catch {
      this.errorKey = "drawer.error";
    }
  }

  /** A wrong or throttled PIN keeps the dialog open for a retry. The PIN is never stored on the app
   * or logged. */
  async #onOverrideConfirm(event: Event): Promise<void> {
    const { personId, pin } = (event as CustomEvent<{ personId: string; pin: string }>).detail;
    this.overrideError = null; // fresh attempt: clear any prior error so a repeat re-shows
    try {
      await this.api.openDrawer({ personId, pin });
      this.#closeOverrideDialog();
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "pin.invalid" || code === "pin.throttled") {
        this.overrideError = code;
      } else {
        this.#closeOverrideDialog();
        this.errorKey = code === "drawer.not_attached" ? "drawer.not_attached" : "drawer.error";
      }
    }
  }

  /** The adjustment dialog and, over it, its approver's PIN prompt, whose events stop here so the
   * drawer's override handlers on the wrapper never see them. */
  #renderAdjusting(): TemplateResult | typeof nothing {
    const open = this.adjusting;
    if (open === null) return nothing;
    return html`<till-adjustment-dialog
        .kind=${open.kind}
        .target=${open.target}
        .reasons=${open.reasons}
        .preview=${open.preview}
        .choice=${open.choice}
        .refusal=${open.refusal}
        .busy=${open.busy}
        @adjust-preview=${(event: Event) => void this.#onAdjustPreview(event)}
        @adjust-confirm=${() => void this.#onAdjustConfirm()}
        @adjust-edit=${() => this.#onAdjustEdit()}
        @adjust-close=${() => this.#closeAdjust()}
      ></till-adjustment-dialog>
      ${
        this.adjustApprovers === undefined
          ? nothing
          : html`<till-supervisor-override-dialog
              data-adjust-approval
              .approverRole=${open.preview?.needsApproval ?? null}
              .authorizers=${this.adjustApprovers}
              .error=${this.adjustApproverError}
              @override-confirm=${(event: Event) => void this.#onAdjustApproverConfirm(event)}
              @override-cancel=${(event: Event) => {
                event.stopPropagation();
                this.#closeApprovers();
              }}
            ></till-supervisor-override-dialog>`
      }`;
  }

  #renderBillPaying(): TemplateResult | typeof nothing {
    const open = this.billPaying;
    if (open === null) return nothing;
    return html`<till-bill-pay-dialog
        .balance=${open.balance}
        .lines=${open.lines}
        .way=${open.way}
        .amount=${open.amount}
        .asked=${open.asked}
        .preview=${open.preview}
        .refusal=${open.refusal}
        .taken=${open.taken}
        .refunded=${open.refunded}
        .busy=${open.busy}
        .tipsEnabled=${this.tipsEnabled}
        .cardReader=${this.handheldMode ? "none" : this.cardProvider}
        .readers=${this.activeReaders}
        .defaultReaderId=${this.defaultReaderId}
        @bill-pay-preview=${(event: Event) => void this.#onBillPayPreview(event)}
        @bill-pay-confirm=${() => void this.#onBillPayConfirm()}
        @bill-pay-edit=${() => this.#onBillPayEdit()}
        @bill-pay-close=${() => this.#closeBillPaying()}
        @bill-refund=${(event: Event) => this.#onBillRefund(event)}
      ></till-bill-pay-dialog>
      ${this.#renderBillRefunding()}`;
  }

  /** The refund dialog and, over it, its approver's PIN prompt, whose events stop here so the
   * drawer's override handlers on the wrapper never see them. */
  #renderBillRefunding(): TemplateResult | typeof nothing {
    const open = this.billRefunding;
    if (open === null) return nothing;
    return html`<till-bill-refund-dialog
        .payment=${open.payment}
        .suggested=${open.suggested}
        .terminal=${open.terminal}
        .refusal=${open.refusal}
        .busy=${open.busy}
        @bill-refund-continue=${(event: Event) => void this.#onRefundContinue(event)}
        @bill-refund-close=${() => this.#closeBillRefunding()}
      ></till-bill-refund-dialog>
      ${
        this.refundApprovers === undefined
          ? nothing
          : html`<till-supervisor-override-dialog
              data-refund-approval
              .authorizers=${this.refundApprovers}
              .error=${this.refundApproverError}
              @override-confirm=${(event: Event) => void this.#onRefundApproverConfirm(event)}
              @override-cancel=${(event: Event) => {
                event.stopPropagation();
                this.#closeRefundApprovers();
              }}
            ></till-supervisor-override-dialog>`
      }`;
  }

  /** Also the cancel handler. */
  #closeOverrideDialog(): void {
    this.overrideAuthorizers = undefined;
    this.overrideError = null;
  }

  /** Clear the completed order and return home, retaining this browser tab's menu preference. */
  #onNewSale(): void {
    this.#store.clear();
    this.ticketWorkingOrderId = undefined;
    this.originalReceiptAvailable = false;
    this.stage = "order";
    this.errorKey = undefined;
    this.cardOutcome = undefined;
    // The home tab is the canvas's first tab (a handheld has no counter tab). After settling a tab the
    // floor is stale, so a floor home refreshes it.
    if (this.#inShell()) {
      const home = this.canvas?.tabs[0];
      this.#setActiveTab(home?.key, true);
      this.#popDrill();
      if (home !== undefined && this.#tabNeedsFloorData(home)) void this.#refreshFloor();
    } else {
      this.#setScreen("counter");
    }
  }

  #onShowSchedule(): void {
    this.errorKey = undefined;
    if (this.#inShell()) this.#pushDrill({ kind: "schedule" });
    else this.#setScreen("schedule");
  }

  #onOpenAllergens(): void {
    this.errorKey = undefined;
    if (this.#inShell()) this.#pushDrill({ kind: "allergens" });
  }

  #onCloseAllergens(): void {
    if (this.#inShell()) this.#popDrill();
  }

  async #onShowFloor(): Promise<void> {
    this.errorKey = undefined;
    await this.#loadFloorData();
    this.#setScreen("floor");
  }

  /**
   * A shell tab reached through `tab-select` must load the floor itself, or the floor-plan card renders
   * with no table to tap. A failed load leaves the last-known floor.
   */
  async #loadFloorData(): Promise<void> {
    try {
      const [tables, zones, statuses] = await Promise.all([
        this.api.getTablesState(),
        this.api.listZones(),
        this.api.listStatuses(),
      ]);
      this.tables = tables;
      this.zones = zones;
      this.statuses = statuses;
      this.#floorLoaded = true;
    } catch {
      // Non-fatal: the last-known floor stays.
    }
  }

  /** Station and expo cards fetch their own data and table-order loads on the open-table drill, so only
   * the floor cards need app-loaded data. */
  #tabNeedsFloorData(tab: TabDef): boolean {
    return tab.cards.some(
      (card) => card.type === "floor-plan" || card.type === "table-layout-editor",
    );
  }

  /** Select a validated canvas tab and load its floor data when needed. Explicit selection closes the
   * overlay; history restores a permitted regular destination over the tab. The first floor visit
   * loads zones and statuses too, while later visits refresh only live occupancy. */
  #onTabSelect(key: string, fromHistory = false): void {
    const tab = this.canvas?.tabs.find((candidate) => candidate.key === key);
    if (tab === undefined) return;
    const wasShowingOrder = this.#tableCatalogueActive();
    this.#setActiveTab(key, fromHistory, fromHistory);
    if (fromHistory) this.#restoreDestination();
    else if (this.drill !== undefined) this.#popDrill();
    const leftOrder = wasShowingOrder && !this.#tableCatalogueActive();
    if (leftOrder) this.#orderVisit++;
    if (!wasShowingOrder && this.#tableCatalogueActive()) this.#shownOnVisit = this.#orderVisit;
    const session = this.#operatorSession;
    const flushed = leftOrder ? this.#flushDraft() : Promise.resolve();
    if (this.#tabNeedsFloorData(tab)) {
      void flushed.then(async () => {
        if (session !== this.#operatorSession) return;
        if (!this.#floorLoaded) return this.#loadFloorData();
        await this.#refreshFloor();
      });
    }
  }

  /** Tables only: a placement write changes neither the zones nor the statuses. A failed read keeps
   * the last-known floor. */
  async #refreshFloor(): Promise<boolean> {
    try {
      this.tables = await this.api.getTablesState();
      return true;
    } catch {
      return false;
    }
  }

  /** A free table seats a party with the guest count given; a seated one resumes its party
   * ({@link billToOpen}). */
  async #onOpenTable(event: Event): Promise<void> {
    const { tableId, seated, guestCount } = (
      event as CustomEvent<{ tableId: string; seated: boolean; guestCount?: number | null }>
    ).detail;
    const offerRequest = ++this.#tableOfferRequest;
    this.#orderVisit++;
    this.#clearErrorKeepingLateChange();
    this.cancelOffer = null;
    this.#tableOpensPending++;
    const session = this.#operatorSession;
    try {
      await this.#flushDraft();
      if (session !== this.#operatorSession) return;
      await this.#openTable(tableId, seated ? undefined : (guestCount ?? null), offerRequest);
    } finally {
      this.#tableOpensPending--;
    }
  }

  /** `guestCount` is `undefined` to resume a seated table, and a count or null to seat a free one. */
  async #openTable(
    tableId: string,
    guestCount: number | null | undefined,
    offerRequest: number,
  ): Promise<void> {
    const session = this.#operatorSession;
    const table = this.tables.find((candidate) => candidate.id === tableId);
    if (table?.zoneId !== null && table?.zoneId !== undefined) {
      try {
        const catalogue = await this.api.listZoneOffers(table.zoneId);
        const { menus, defaultMenuId } = catalogue;
        if (offerRequest !== this.#tableOfferRequest || session !== this.#operatorSession) return;
        this.#loadTableOffers(table.zoneId, catalogue);
        this.tableSelectedCatalogueId = defaultMenuId ?? this.#defaultCatalogueId(menus);
      } catch {
        if (offerRequest !== this.#tableOfferRequest) return;
        this.#loadTableOffers(undefined, { offers: [], menus: [] }, false);
        this.tableSelectedCatalogueId = "";
        // Both are said: a canvas showing the floor and the order together keeps the previous
        // table's order on screen, so the failed open needs saying even beside a late change.
        const late = this.#lateChangeShown();
        this.errorKey =
          late === undefined ? "table.error" : { lateChange: late, also: "table.error" };
        return;
      }
    } else {
      this.#loadTableOffers(undefined, { offers: [], menus: [] }, false);
      this.tableSelectedCatalogueId = "";
    }
    // `set-status` is keyed by table id, so it is remembered alongside the tab's order id.
    this.activeTableId = tableId;
    this.#openClaimed = Math.max(this.#openClaimed, offerRequest);
    this.finishRefused = false;
    this.nameRefusal = null;
    this.reprintSent = [];
    if (guestCount === undefined) {
      this.orderParty = table?.party ?? null;
      const main = this.orderParty?.mainBillId ?? null;
      const billsRead = main === null && this.orderParty !== null;
      this.activeTabId = main ?? undefined;
      if (billsRead) {
        const read = await this.#loadPartyBills();
        if (session !== this.#operatorSession || this.#openClaimed > offerRequest) return;
        this.activeTabId = billToOpen(read.bills ?? []);
      }
      const [, opened] = await Promise.all([
        billsRead ? this.#loadTabLines() : this.#loadLinesAndBills(),
        this.#openDraft(true, session),
      ]);
      if (session !== this.#operatorSession) return;
      this.#showDraft(opened);
    } else {
      try {
        const { tabId, partyId, revision } = await this.api.seatTable(tableId, guestCount);
        // A table opened after this one has made its own table the active one, so this answer
        // would put this table's order beside that table.
        if (session !== this.#operatorSession || this.#openClaimed > offerRequest) return;
        this.activeTableId = tableId;
        this.activeTabId = tabId;
        this.orderParty = {
          id: partyId,
          revision,
          guestCount,
          state: "open",
          name: null,
          displayName: table?.label ?? "",
          mainBillId: tabId,
          outstanding: "0.00",
          billCount: 1,
          tableIds: [tableId],
          unsentDrafts: [],
          reminder: null,
        };
        this.#showDraft(await this.#openDraft(false, session));
      } catch (error) {
        this.errorKey = tableWriteError(error);
        await this.#refreshFloor();
        return;
      }
      await this.#reloadOrder();
      if (session !== this.#operatorSession) return;
    }
    // A canvas that authors a `table-order` card (handheld, tablet) switches to that tab; a till drills
    // in over the floor tab.
    if (this.#inShell()) {
      const orderTabKey = this.#tableOrderTabKey();
      if (orderTabKey !== undefined)
        this.#setActiveTab(orderTabKey); // card mount (handheld/tablet)
      else this.#pushDrill({ kind: "table-order" }); // drill mount (till)
      this.#shownOnVisit = this.#orderVisit;
    } else if (this.screen !== "lock") {
      // A late answer must not unlock a logged-out till.
      this.#setScreen("table-order");
    }
  }

  /** A failed read, or no tab id, leaves an empty tab rather than blocking the operator. */
  async #loadTabLines(): Promise<void> {
    const read = ++this.#tabLinesRead;
    const partyId = this.orderParty?.id ?? null;
    if (this.activeTabId === undefined) {
      this.tabLines = [];
      this.tabGroups = [];
      this.printProblems = [];
      this.currentOrders = null;
      this.currentOrdersUnread = false;
      this.#groupsUnread = false;
      this.#groupsReadFor = partyId;
      return;
    }
    const groups = this.#readGroups();
    const problems = this.#readPrintProblems();
    const orders = this.#readCurrentOrders();
    try {
      const tab = await this.api.getTabLines(this.activeTabId);
      if (read !== this.#tabLinesRead) return;
      this.tabLines = tab.lines;
      this.tabRevision = tab.revision;
      this.editSentLines = tab.editSentLines;
    } catch {
      if (read !== this.#tabLinesRead) return;
      this.tabLines = [];
    }
    const partyGroups = await groups;
    const partyProblems = await problems;
    const partyOrders = await orders;
    if (read !== this.#tabLinesRead) return;
    this.tabGroups = partyGroups ?? [];
    this.#groupsUnread = partyGroups === null;
    this.#groupsReadFor = partyId;
    this.printProblems = partyProblems;
    this.currentOrders = partyOrders;
    this.currentOrdersUnread = partyId !== null && partyOrders === null;
  }

  /** A failed read answers null: the screen then offers nothing to mark served. */
  async #readCurrentOrders(): Promise<CurrentOrders | null> {
    const party = this.orderParty;
    if (party === null) return null;
    try {
      return await this.api.readCurrentOrders(party.id);
    } catch {
      return null;
    }
  }

  /** A failed read shows no problem: the notice is advice, and ordering never waits on it. */
  async #readPrintProblems(): Promise<PrintProblem[]> {
    const party = this.orderParty;
    if (party === null) return [];
    try {
      return (await this.api.listPrintProblems(party.id)).problems;
    } catch {
      return [];
    }
  }

  /** Each bill's kitchen tickets are printed again in turn; the first refusal stops the rest and is
   * said. A press while one runs is ignored. The order is read again either way. */
  async #onReprintKitchenTickets(event: Event): Promise<void> {
    if (this.#reprinting) return;
    this.#reprinting = true;
    const { workingOrderIds } = (event as CustomEvent<{ workingOrderIds: string[] }>).detail;
    const sent: string[] = [];
    this.errorKey = undefined;
    try {
      for (const workingOrderId of workingOrderIds) {
        await this.api.reprintOrder(workingOrderId);
        sent.push(workingOrderId);
      }
    } catch (error) {
      this.errorKey = { code: (error as { code?: string }).code ?? "server.internal" };
    } finally {
      this.#reprinting = false;
    }
    this.reprintSent = [...new Set([...this.reprintSent, ...sent])];
    await this.#loadTabLines();
  }

  /** The groups' revision is not kept: a command sends the revision the party was shown at. A failed
   * read answers null. */
  async #readGroups(): Promise<OrderGroup[] | null> {
    const party = this.orderParty;
    if (party === null) return [];
    try {
      return (await this.api.listGroups(party.id)).groups;
    } catch {
      return null;
    }
  }

  /** A command naming a held group, and a draft's Add to held group, act on the groups the read
   * found, so with the groups unread they send nothing: the refusal is said and the order read again
   * for the next press. */
  async #refuseWithGroupsUnread(): Promise<boolean> {
    if (!this.#groupsUnread) return false;
    this.errorKey = "table.error";
    await this.#loadTabLines();
    return true;
  }

  /** Keeps the revision a command on the party answered with, while the screen still shows that
   * party. A later revision already noted stays: answers can arrive out of order. */
  #notePartyRevision(partyId: string, revision: number): void {
    const party = this.orderParty;
    if (party?.id === partyId && revision > party.revision)
      this.orderParty = { ...party, revision };
  }

  /** After a command that moved the party on, or may have: the floor is read again, and its party
   * taken while the open table still holds that party and the floor's revision is not lower than
   * the one held. A failed read leaves the last floor, which can be older. */
  async #retakePartyFromFloor(): Promise<boolean> {
    const partyId = this.orderParty?.id;
    const read = await this.#refreshFloor();
    const row = this.tables.find((table) => table.id === this.activeTableId);
    const held = this.orderParty;
    if (
      partyId !== undefined &&
      row?.party?.id === partyId &&
      held?.id === partyId &&
      row.party.revision >= held.revision
    )
      this.orderParty = row.party;
    return read;
  }

  /** After a cancel or Change to the order `orderId` that landed, or may have: the floor's party,
   * then the order's lines and bills. When the order is no longer the open one once the floor
   * answers, or a later re-read has started, nothing more is read or said. Otherwise, unless the
   * waiter has left the order since `visit` ({@link #hasLeftOrder}) or a later re-read has started:
   * this re-read's own failed floor or bills read is said, unless another message already is,
   * whether or not another read has refreshed the order since; and with its floor read failed and
   * its bills read still the latest, what the party still owes is taken from those bills when they
   * are the party's, which is the sum the floor would have answered (`readBillsOfParties` in
   * `apps/server/src/parties.ts` feeds both). */
  async #rereadAmounts(orderId: string, visit: number): Promise<void> {
    const reread = ++this.#amountsReread;
    const floorRead = await this.#retakePartyFromFloor();
    if (this.activeTabId !== orderId || reread !== this.#amountsReread) return;
    const [, bills] = await this.#loadLinesAndBills();
    if (this.#hasLeftOrder(orderId, visit) || reread !== this.#amountsReread) return;
    if (
      !floorRead &&
      bills.read === this.#partyBillsRead &&
      bills.bills !== null &&
      this.orderParty?.id === bills.partyId
    ) {
      const outstanding = sumDecimals(bills.bills.map((bill) => decimal(bill.outstanding)));
      this.orderParty = {
        ...this.orderParty,
        outstanding: toScale(outstanding, MONEY_SCALE),
      };
    }
    if ((!floorRead || bills.bills === null) && this.errorKey === undefined)
      this.errorKey = "table.reread_failed";
  }

  /** The order `orderId` is no longer the open one, or {@link #orderVisit} has moved on from `visit`
   * and the waiter has not come back to the order. */
  #hasLeftOrder(orderId: string, visit: number): boolean {
    return this.activeTabId !== orderId || this.#leftSince(visit);
  }

  /** Since `sent`, the order's party ({@link orderParty}) is no longer `partyId`, a table open has
   * begun and one is still under way, or the operator session has ended. A visit to the floor alone
   * is not leaving the party. */
  #hasLeftParty(partyId: string | undefined, sent: Sent): boolean {
    return (
      this.orderParty?.id !== partyId ||
      (sent.opens !== this.#tableOfferRequest && this.#tableOpensPending > 0) ||
      sent.session !== this.#operatorSession
    );
  }

  #sentNow(): Sent {
    return { session: this.#operatorSession, opens: this.#tableOfferRequest };
  }

  #leftSince(visit: number): boolean {
    return (
      this.#orderVisit !== visit &&
      (this.#shownOnVisit !== this.#orderVisit || this.#tableOpensPending > 0)
    );
  }

  /** A void or line edit moves its bill's party on without a revision of its own to send. */
  #noteBillParty(party: BillParty): void {
    if (party !== null) this.#notePartyRevision(party.id, party.revision);
  }

  /** Takes the order's party from the floor just read, before the order's lines and bills are read
   * after it. A floor that does not list the table keeps the party known, and so does one listing
   * the same party at a lower revision, as a floor kept after a failed {@link #refreshFloor} can. */
  #rememberOrderParty(): void {
    const row = this.tables.find((table) => table.id === this.activeTableId);
    const floor = row?.party ?? null;
    const held = this.orderParty;
    const older = floor !== null && floor.id === held?.id && floor.revision < held.revision;
    if (row !== undefined && !older) this.orderParty = floor;
    this.#followPartyDraft();
  }

  /** The draft the open order shows: the person's on its party, whichever of the party's bills is on
   * screen. It waits for the party's own groups, since the screen decides from them whether its first
   * line is a later addition. */
  #tableDraft(): WorkingOrderStore | null {
    if (this.orderParty === null) return this.#partylessDraft;
    const sync = this.#draftSync;
    const party = this.orderParty.id;
    return this.#draftReady && sync?.partyId === party && this.#groupsReadFor === party
      ? sync.store
      : null;
  }

  /** Starts the person's draft on the order's party, read from the server unless `read` is false.
   * The screen shows it only once {@link #showDraft} says so. Nothing is started for a table opened
   * in an operator session that has since ended. */
  async #openDraft(read: boolean, session: number): Promise<OpenedDraft> {
    this.#dropDraft();
    this.#partylessDraft = new WorkingOrderStore();
    if (session !== this.#operatorSession) return undefined;
    const party = this.orderParty;
    if (party === null) return { sync: undefined, read: true };
    const sync: DraftSync = new DraftSync({
      api: this.api,
      partyId: party.id,
      personId: this.operatorPersonId,
      rebuild: (lines) =>
        lines.map((line) =>
          fromDraftLine(line, this.#tableOffers.byId, this.#tableOffers.versions),
        ),
      onReplaced: () => {
        if (sync !== this.#draftSync) return;
        this.#draftRefreshDue = true;
        this.#reconcileDraft();
      },
      onRefused: (code, ownerName) =>
        this.#onDraftRefused(sync, {
          refused: code,
          ...(ownerName === undefined ? {} : { ownerName }),
        }),
      requestLimitMs: TABLE_REQUEST_LIMIT_MS,
    });
    this.#draftSync = sync;
    // Subscribed before any screen, so a line's mark is set before the draft is drawn.
    sync.store.subscribe(() => {
      if (sync === this.#draftSync) this.#markDraft(false, false);
    });
    return { sync, read: read ? await sync.load() : true };
  }

  /** A sign-out leaves the order on the table-order screen, but its draft went with the session: the
   * person signing in gets their own draft on that party. */
  #resumeOrderDraft(): void {
    const session = this.#operatorSession;
    void this.#openDraft(true, session).then((opened) => this.#showDraft(opened));
  }

  /** A draft that could not be read is not shown, so an empty one never stands in for it. A draft
   * another open has since replaced is left alone. */
  #showDraft(opened: OpenedDraft): void {
    if (opened === undefined || opened.sync !== this.#draftSync) return;
    this.#draftReady = opened.read;
    this.requestUpdate();
    if (!opened.read) this.errorKey = "table.draft_read_failed";
    else this.#reconcileDraft();
  }

  #dropDraft(): void {
    this.#draftSync?.drop();
    this.#draftSync = undefined;
    this.#draftReady = false;
    this.requestUpdate();
  }

  /** At a point the person leaves the draft: an edit no save reached is said, unless the operator
   * session has ended by the time the save answers, since the next person may have signed in. */
  async #flushDraft(): Promise<void> {
    if (this.#draftSync === undefined) return;
    const session = this.#operatorSession;
    const saved = await this.#draftSync.flush();
    if (saved === "failed" && session === this.#operatorSession)
      this.errorKey = "table.draft_save_failed";
  }

  /** An order that moved to another party, by a merge or a move, takes that party's draft; the
   * person's edits are saved to the party they were made on first. */
  #followPartyDraft(): void {
    const sync = this.#draftSync;
    if (sync === undefined || sync.partyId === this.orderParty?.id) return;
    const session = this.#operatorSession;
    void this.#flushDraft().then(async () => {
      if (this.#draftSync !== sync) return;
      this.#showDraft(await this.#openDraft(true, session));
    });
  }

  /** A save refused. An edit made after the session ended is lost: nothing can send it now. A line
   * the refusal names is marked once the table's offers are read again. */
  #onDraftRefused(sync: DraftSync, refusal: DraftRefused): void {
    if (sync !== this.#draftSync || refusal.refused === "session.required") return;
    this.errorKey = draftRefusalError(refusal);
    const zoneId = this.#tableZoneId;
    if (refusal.refused === "product.not_sold_separately" && zoneId !== undefined)
      void this.#reloadTableOffers(zoneId);
  }

  /** The other people's drafts on the party of the draft shown, `shown` being what
   * {@link #tableDraft} answered; read-only, built again only when they or the table's offers change. */
  #otherDrafts(shown: WorkingOrderStore | null): readonly OtherDraft[] {
    const sync = this.#draftSync;
    if (sync === undefined || shown !== sync.store) return [];
    const key = { others: sync.others, offers: this.tableProducts };
    const cached = this.#otherDraftViews;
    if (
      cached !== undefined &&
      cached.key.others === key.others &&
      cached.key.offers === key.offers
    )
      return cached.views;
    const views = sync.others.map((other) => ({
      id: other.id,
      revision: other.revision,
      ownerName: other.ownerName,
      takenFromYou: other.takenOverFrom?.personId === sync.personId,
      lines: other.lines.map((line) => fromDraftLine(line, this.#tableOffers.byId)),
    }));
    this.#otherDraftViews = { key, views };
    return views;
  }

  #otherDraftViews?: {
    key: { others: unknown; offers: unknown };
    views: readonly OtherDraft[];
  };

  /** The person's own unsaved edits go first; the answer's draft becomes theirs to change. */
  async #onTakeOverDraft(event: Event): Promise<void> {
    const { draftId, revision } = (event as CustomEvent<TakeOverDraftDetail>).detail;
    const sync = this.#draftSync;
    try {
      if (sync === undefined) {
        this.errorKey = "table.error";
        return;
      }
      this.errorKey = undefined;
      const outcome = await sync.takeOver(draftId, revision);
      if (sync !== this.#draftSync || outcome === "taken") return;
      if (outcome === "unsaved") this.errorKey ??= "table.error";
      else if (outcome === "failed") this.errorKey = "table.error";
      else this.errorKey = takeOverRefusalError(outcome.refused);
    } finally {
      this.takeOversAnswered += 1;
    }
  }

  /** The floor, then the order's party from it, then the order's lines and bills. */
  async #reloadOrder(): Promise<void> {
    await this.#reloadTables();
    this.#rememberOrderParty();
    await this.#loadLinesAndBills();
  }

  async #loadLinesAndBills(): Promise<[void, ReadBills]> {
    return Promise.all([this.#loadTabLines(), this.#loadPartyBills()]);
  }

  /** A failed read leaves the list empty rather than showing another party's bills. A read
   * overtaken by a later one leaves the list alone, and only its generation, compared with
   * {@link #partyBillsRead}, tells a caller so. */
  async #loadPartyBills(): Promise<ReadBills> {
    const read = ++this.#partyBillsRead;
    const party = this.orderParty;
    if (party === null) {
      this.partyBills = [];
      return { read, partyId: null, bills: [] };
    }
    try {
      const bills = await this.api.getPartyBills(party.id);
      if (read === this.#partyBillsRead) {
        this.partyBills = bills;
        void this.#loadBillBalance();
      }
      return { read, partyId: party.id, bills };
    } catch {
      if (read === this.#partyBillsRead) this.partyBills = [];
      return { read, partyId: party.id, bills: null };
    }
  }

  /** The balance of the bill on screen when its party's bills say it holds a payment; none
   * otherwise, or when the read fails. */
  async #loadBillBalance(): Promise<void> {
    const read = ++this.#billBalanceRead;
    const billId = this.activeTabId;
    const bill = this.partyBills.find((row) => row.workingOrderId === billId);
    if (billId === undefined || bill?.hasPayments !== true) {
      this.billBalance = null;
      return;
    }
    try {
      const balance = await this.api.getBillBalance(billId);
      if (read === this.#billBalanceRead) this.billBalance = balance;
    } catch {
      if (read === this.#billBalanceRead) this.billBalance = null;
    }
  }

  /** What a move or join sends of the parties read: the open party's revision, and what the floor
   * showed at the target table — another party and its revision, or null when it read free. */
  #tableActionRevisions(party: TableParty, tableId: string): TableActionRevisions {
    const seated = this.tables.find((table) => table.id === tableId)?.party ?? null;
    return { expectedPartyRevision: party.revision, ...otherPartyRead(seated, party.id) };
  }

  /** The party the open bill was read under, for a bill action. */
  #billRevisions(): BillRevisions {
    const own = this.orderParty;
    return own === null ? {} : { expectedPartyRevision: own.revision, partyId: own.id };
  }

  /**
   * Another device changed a party this screen was acting on. The floor, the order and the bills are
   * read again and the message says what changed; the command is not sent again on its own, because
   * the person has to see the new state and decide. Nothing is said once `live` is false.
   */
  async #onPartyOutOfDate(error: unknown, live: () => boolean = () => true): Promise<void> {
    const named = (error as { partyId?: unknown }).partyId;
    const before = this.tables;
    const shown = this.#tableCatalogueActive() ? this.orderParty : null;
    const was =
      typeof named === "string" && named !== shown?.id
        ? partyOf(before, named)
        : (shown ?? undefined);
    if (this.#tableCatalogueActive()) await this.#reloadOrder();
    else await this.#reloadTables();
    if (!live()) return;
    this.errorKey =
      was === undefined
        ? { code: "party.out_of_date" }
        : { partyChanged: describePartyChange(was, before, this.tables) };
  }

  /** Every command on a party's tables or bills ends here when refused. */
  async #onTableRefusal(error: unknown, live?: () => boolean): Promise<void> {
    if (isPartyOutOfDate(error)) {
      await this.#onPartyOutOfDate(error, live);
      return;
    }
    this.errorKey = tableWriteError(error);
  }

  /** A draft lands on the bill it names, or else the party's main bill, which the screen follows. Once a submission leaves the draft empty, the till goes back to the floor
   * and says what the draft's submissions filed. Once the operator's session ends, the submission
   * sends nothing more, says nothing and does not move the next person's screen. */
  async #onSubmitDraft(event: Event): Promise<void> {
    const { groups, joinGroupId, billId, store, sent, draft } = (
      event as CustomEvent<Partial<SubmitDraftDetail>>
    ).detail;
    const tabId = this.activeTabId;
    const tableId = this.activeTableId;
    const party = this.orderParty;
    if (tabId === undefined || store?.sending === true) return;
    if (party === null) {
      this.errorKey = "table.error";
      return;
    }
    if (joinGroupId !== undefined && (await this.#refuseWithGroupsUnread())) return;
    const sync = this.#draftSync;
    if (sync === undefined || store !== sync.store || groups === undefined || sent === undefined) {
      this.errorKey = "table.error";
      return;
    }
    const partyId = party.id;
    const session = this.#operatorSession;
    const live = () => session === this.#operatorSession;
    // The draft is shut to edits until the answer, so what is sent is what the screen shows.
    store.sending = true;
    let followUp: DraftFollowUp;
    try {
      followUp = await this.#submitDraft(
        tabId,
        party,
        sync,
        { groups, joinGroupId, billId },
        sent,
        live,
        false,
      );
    } finally {
      store.sending = false;
    }
    if (followUp === undefined) return;
    if (followUp === "mark-unsellable") {
      await this.#markUnsellable(store);
      return;
    }
    const onSentTable = () => this.activeTabId === tabId && this.activeTableId === tableId;
    if (followUp !== "find-tab" && draft !== undefined) this.#tally(draft, groups, joinGroupId);
    if (followUp === "find-tab" && onSentTable()) {
      await this.#retakePartyFromFloor();
      if (!live()) return;
      // The server puts a draft only on a bill of its own party, the one named or else the main
      // bill, so the table is followed only while it still holds the party the screen showed when
      // the draft was sent.
      const now = this.tables.find((row) => row.id === tableId)?.party;
      const landed = billId ?? now?.mainBillId ?? null;
      if (landed !== null && now?.id === partyId && onSentTable()) this.#followDraft(tabId, landed);
    } else if (typeof followUp === "object" && this.activeTabId === tabId) {
      await this.#reloadTables();
      if (!live()) return;
      this.#followDraft(tabId, followUp.landedOn);
    }
    await this.#loadTabLines();
    if (this.orderParty !== null) await this.#loadPartyBills();
    if (!live() || store.lineCount > 0 || draft === undefined) return;
    if (followUp === "find-tab" || this.activeTableId !== tableId) return;
    this.submittedNotice = submittedText(draft.tally);
    this.renderRoot.querySelector<WtToast>("wt-toast[data-submitted-toast]")?.show();
    this.#returnToFloor();
  }

  #tally({ tally }: Draft, groups: readonly DraftGroup[], joinGroupId?: string): void {
    for (const group of groups) {
      if (group.release === "fire") tally.fired += 1;
      else if (joinGroupId !== undefined) tally.joined += 1;
      else tally.held += 1;
    }
  }

  /**
   * Saves the draft, then sends the `sent` lines under the ids that save answered. A refused
   * submission stays in the draft. One that got no answer is sent again as it was; if none answers,
   * the draft is read again, because the server may have taken the lines.
   */
  async #submitDraft(
    tabId: string,
    party: TableParty,
    sync: DraftSync,
    submission: { groups: readonly DraftGroup[]; joinGroupId?: string; billId?: string },
    sent: readonly OrderLine[],
    live: () => boolean,
    retried: boolean,
  ): Promise<DraftFollowUp> {
    const { groups, joinGroupId, billId } = submission;
    this.errorKey = undefined;
    // One limit covers the save before the send and the send with its retries.
    const send = limited(TABLE_REQUEST_LIMIT_MS);
    let submitted: SubmittedDraft;
    try {
      const saved = await sync.flush(send.signal);
      if (!live()) return;
      if (saved !== "saved") {
        this.errorKey = saved === "failed" ? "table.error" : draftRefusalError(saved);
        return;
      }
      const positions = sent.map((line) => sync.store.lines.indexOf(line));
      const ids = positions.includes(-1) ? null : sync.lineIds(positions);
      if (ids === null || sync.draftId === null) {
        await sync.load();
        if (!live()) return;
        this.errorKey = "table.draft_recount";
        return;
      }
      const command: DraftSubmission = {
        submissionId: crypto.randomUUID(),
        expectedPartyRevision: party.revision,
        draftRevision: sync.revision,
        groups: groups.map((group) => ({
          release: group.release,
          lineIds: group.lineIndexes.map((index) => ids[index]!),
        })),
        ...(joinGroupId === undefined ? {} : { joinGroupId }),
        ...(billId === undefined ? {} : { billId }),
      };
      const draftId = sync.draftId;
      submitted = await resendUnanswered(
        (signal) => this.api.submitDraft(party.id, draftId, command, { signal }),
        send.signal,
        live,
      );
    } catch (error) {
      if (!live()) return;
      if (isVersionRefusal(error)) {
        const outcome = await this.#refreshRound(sync.store);
        if (!live()) return;
        // The adopted lines are saved under their new versions, and so under new ids: another request.
        if (outcome === "adopted" && !retried)
          return this.#submitDraft(tabId, party, sync, submission, sent, live, true);
        if (outcome !== "confirming") this.errorKey = { code: "menu.version_changed" };
        return;
      }
      if (isNetworkFailure(error)) {
        await sync.load();
        if (!live()) return;
        this.errorKey = "table.round_unconfirmed";
        return "find-tab";
      }
      if (isPartyOutOfDate(error)) {
        await this.#onPartyOutOfDate(error, live);
        return;
      }
      const refusal = asRefusal(error);
      if (refusal !== undefined && DRAFT_REFUSALS.has(refusal.refused)) {
        await sync.load();
        if (!live()) return;
        this.errorKey = draftRefusalError(refusal, true);
        return;
      }
      if (isGroupGone(error)) await this.#loadTabLines();
      if (!live()) return;
      // The server raises this for the bill a submission names (`requireBillOfParty`), or, when it
      // names none, for the party's main bill (`partyMainBill`), which the server chose.
      this.errorKey =
        billId !== undefined && refusal?.refused === "tab.not_open"
          ? { code: "tab.not_open" }
          : lineWriteError(error);
      return refusal !== undefined && UNSELLABLE_LINE_REFUSALS.has(refusal.refused)
        ? "mark-unsellable"
        : undefined;
    } finally {
      send.done();
    }
    this.#notePartyRevision(party.id, submitted.revision);
    if (!live()) return;
    sync.submitted(submitted.draft, sent);
    return submitted.tabId === tabId ? "read-tab" : { landedOn: submitted.tabId };
  }

  /** Moves the screen from the tab a draft was sent to onto the tab it went to, only while the
   * operator is still on the first; the floor has already been read after the send. */
  #followDraft(sentTo: string, landedOn: string): void {
    if (landedOn === sentTo || this.activeTabId !== sentTo) return;
    this.activeTabId = landedOn;
    this.#rememberOrderParty();
  }

  /** A refused send or group command: a party changed elsewhere is read again and described, and never
   * sent again; anything else reads the order and its groups again, since part of it may have gone,
   * and then says what was refused. */
  async #onReleaseRefusal(error: unknown): Promise<void> {
    if (isPartyOutOfDate(error)) {
      await this.#onPartyOutOfDate(error);
      return;
    }
    if (isNetworkFailure(error)) await this.#retakePartyFromFloor();
    await this.#loadTabLines();
    this.errorKey = lineWriteError(error);
  }

  /** A command on the party's held groups, sent with the revision the party was shown at; then the
   * order and its groups are read again. A press while one is running is dropped: it would carry the
   * revision the running one is about to move on. */
  async #onGroupCommand(send: (party: TableParty) => Promise<unknown>): Promise<void> {
    if (this.groupCommandBusy) return;
    this.groupCommandBusy = true;
    try {
      this.errorKey = undefined;
      if (await this.#refuseWithGroupsUnread()) return;
      const party = this.orderParty;
      if (party === null) {
        this.errorKey = "table.error";
        return;
      }
      try {
        await send(party);
      } catch (error) {
        await this.#onReleaseRefusal(error);
        return;
      }
      await this.#loadTabLines();
    } finally {
      this.groupCommandBusy = false;
    }
  }

  /** One request on the party under a submission id of its own, at `revision`. The answer's revision
   * is noted, so a later command carries it, and returned for a next request in the same command. */
  async #partyRequest(
    party: TableParty,
    revision: number,
    request: (command: GroupCommand) => Promise<{ revision: number }>,
  ): Promise<number> {
    const answer = await request({
      submissionId: crypto.randomUUID(),
      expectedPartyRevision: revision,
    });
    this.#notePartyRevision(party.id, answer.revision);
    return answer.revision;
  }

  /** A group command of one request, at the revision the party was shown at. */
  async #onGroupRequest(
    request: (party: TableParty, command: GroupCommand) => Promise<{ revision: number }>,
  ): Promise<void> {
    await this.#onGroupCommand((party) =>
      this.#partyRequest(party, party.revision, (command) => request(party, command)),
    );
  }

  async #onFireGroup(event: Event): Promise<void> {
    const { groupId } = (event as CustomEvent<FireGroupDetail>).detail;
    await this.#onGroupRequest((party, command) => this.api.fireGroup(party.id, groupId, command));
  }

  async #onReorderGroups(event: Event): Promise<void> {
    const { heldGroupIds } = (event as CustomEvent<ReorderGroupsDetail>).detail;
    await this.#onGroupRequest((party, command) =>
      this.api.reorderGroups(party.id, heldGroupIds, command),
    );
  }

  async #onMoveGroupLine(event: Event): Promise<void> {
    const { lineId, quantity, target } = (event as CustomEvent<MoveGroupLineDetail>).detail;
    await this.#onGroupRequest((party, command) =>
      this.api.moveLinesToGroup(party.id, [{ lineId, quantity }], target, command),
    );
  }

  /** One unit at a time moves off the line into a row of its own in the same group, each request at
   * the revision the one before answered, until every row holds one. Each request is a command of its
   * own, so a refusal part-way leaves the rows already split. */
  async #onSplitGroupLine(event: Event): Promise<void> {
    const { lineId, groupId, quantity } = (event as CustomEvent<SplitGroupLineDetail>).detail;
    await this.#onGroupCommand(async (party) => {
      let revision = party.revision;
      for (let units = Number.parseInt(quantity, 10); units > 1; units -= 1) {
        revision = await this.#partyRequest(party, revision, (command) =>
          this.api.moveLinesToGroup(party.id, [{ lineId, quantity: "1" }], { groupId }, command),
        );
      }
    });
  }

  /** Serving, its undo and a reminder's snooze and its clearing are commands on the party whose
   * order is open; with no order open they send nothing. */
  async #onServiceRequest(
    request: (party: TableParty, command: GroupCommand) => Promise<{ revision: number }>,
  ): Promise<void> {
    if (this.activeTabId === undefined) return;
    await this.#onGroupRequest(request);
  }

  /** Records or takes back the party's bill request, then reads the floor, which carries it. A
   * request that got no answer is sent again under its submission id before the floor is read. Once
   * the waiter has left the party ({@link #hasLeftParty}), the answer is neither read nor said. */
  async #onRequestBill(event: Event): Promise<void> {
    const { requested } = (event as CustomEvent<{ requested: boolean }>).detail;
    const party = this.orderParty;
    if (party === null || this.groupCommandBusy) return;
    const sent = this.#sentNow();
    const live = () => sent.session === this.#operatorSession;
    const limit = limited(TABLE_REQUEST_LIMIT_MS);
    this.groupCommandBusy = true;
    this.errorKey = undefined;
    try {
      await this.#partyRequest(party, party.revision, (command) =>
        resendUnanswered(
          (signal) => this.api.requestBill(party.id, { ...command, requested }, { signal }),
          limit.signal,
          live,
        ),
      );
      if (this.#hasLeftParty(party.id, sent)) return;
      await this.#retakePartyFromFloor();
    } catch (error) {
      if (this.#hasLeftParty(party.id, sent)) return;
      if (isNetworkFailure(error)) {
        await this.#retakePartyFromFloor();
        if (this.#hasLeftParty(party.id, sent)) return;
      }
      await this.#onTableRefusal(error, live);
    } finally {
      limit.done();
      this.groupCommandBusy = false;
    }
  }

  async #onServeLines(event: Event): Promise<void> {
    const { items } = (event as CustomEvent<ServeLinesDetail>).detail;
    await this.#onServiceRequest((party, command) => this.api.markServed(party.id, items, command));
  }

  async #onUnserveLines(event: Event): Promise<void> {
    const { items } = (event as CustomEvent<ServeLinesDetail>).detail;
    await this.#onServiceRequest((party, command) =>
      this.api.unmarkServed(party.id, items, command),
    );
  }

  async #onServeGroup(event: Event): Promise<void> {
    const { groupId } = (event as CustomEvent<ServeGroupDetail>).detail;
    await this.#onServiceRequest((party, command) =>
      this.api.markGroupServed(party.id, groupId, command),
    );
  }

  async #onSnoozeGroup(event: Event): Promise<void> {
    const { groupId, minutes } = (event as CustomEvent<SnoozeGroupDetail>).detail;
    await this.#onServiceRequest((party, command) =>
      this.api.snoozeGroup(party.id, groupId, minutes, command),
    );
  }

  async #onUnsnoozeGroup(event: Event): Promise<void> {
    const { groupId } = (event as CustomEvent<UnsnoozeGroupDetail>).detail;
    await this.#onServiceRequest((party, command) =>
      this.api.unsnoozeGroup(party.id, groupId, command),
    );
  }

  /** The reload runs on both paths: after a raced `ticket.already_fired` the line is fired, and
   * re-reading reconciles the picker. */
  async #onSetLineCourse(event: Event): Promise<void> {
    const { lineNo, courseId } = (event as CustomEvent<{ lineNo: number; courseId: string | null }>)
      .detail;
    if (this.activeTabId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.setLineCourse(this.activeTabId, lineNo, courseId);
    } catch (error) {
      this.errorKey = tableWriteError(error);
    }
    await this.#loadTabLines();
  }

  /** Sends held lines outside any held group, such as a recalled one. The reload runs on both paths,
   * as in {@link #onRecallLines}. */
  async #onSendLines(event: Event): Promise<void> {
    const { lineNos } = (event as CustomEvent<{ lineNos: number[] }>).detail;
    const tabId = this.activeTabId;
    if (tabId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.sendLines(tabId, lineNos);
    } catch (error) {
      await this.#onReleaseRefusal(error);
      return;
    }
    await this.#loadTabLines();
  }

  /**
   * The reload runs on both paths: after a raced `ticket.already_started` or `ticket.already_fired`,
   * re-reading drops the line's Recall and Change.
   */
  async #onRecallLines(event: Event): Promise<void> {
    const { lineNos } = (event as CustomEvent<{ lineNos: number[] }>).detail;
    if (this.activeTabId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.recallLines(this.activeTabId, lineNos);
    } catch (error) {
      this.errorKey = lineWriteError(error);
    }
    await this.#loadTabLines();
  }

  /** Cancel, Give away or Discount pressed, or Cancel offered: the reasons are read, then the dialog
   * opens on the bill as the screen last read it. */
  async #onAdjust(event: Event): Promise<void> {
    const { kind, target, offered, counter } = (event as CustomEvent<AdjustDetail>).detail;
    const surface = counter === true ? "counter" : "table";
    const orderId = surface === "counter" ? this.#store.id : this.activeTabId;
    if (orderId === undefined || this.adjusting !== null || this.#adjustOpening) return;
    const session = this.#operatorSession;
    const opened = {
      surface,
      orderId,
      revision: surface === "counter" ? this.#store.revision : this.tabRevision,
      visit: surface === "counter" ? session : this.#orderVisit,
    } as const;
    if (surface === "counter" && !this.#counterStillAdjustable(opened)) return;
    if (offered !== true) this.errorKey = undefined;
    const offer = offered === true ? this.errorKey : undefined;
    this.#adjustOpening = true;
    let reasons: AdjustmentReason[];
    try {
      reasons = await this.api.listAdjustmentReasons();
    } catch {
      if (session === this.#operatorSession) this.errorKey = "adjust.reasons_error";
      return;
    } finally {
      this.#adjustOpening = false;
    }
    if (
      session !== this.#operatorSession ||
      this.#hasLeftAdjusted(opened) ||
      (surface === "counter" && !this.#counterStillAdjustable(opened))
    )
      return;
    this.adjusting = {
      id: ++this.#adjustments,
      ...opened,
      kind,
      target,
      reasons,
      choice: null,
      preview: null,
      refusal: null,
      busy: false,
      offer,
    };
  }

  /** The counter's basket still holds the stored order it held when `open` was opened, at the same
   * revision, and still as the basket requires to offer an adjustment: unchanged, and with no pay,
   * place or hold of it out. */
  #counterStillAdjustable(open: Pick<Adjusting, "orderId" | "revision">): boolean {
    const listing = adjustableListing(
      this.#store,
      this.#basketStoredLines(),
      this.#counterOrderInFlight(),
    );
    return (
      listing !== null && listing.orderId === open.orderId && listing.revision === open.revision
    );
  }

  #hasLeftAdjusted(open: Pick<Adjusting, "surface" | "orderId" | "visit">): boolean {
    return open.surface === "counter"
      ? this.#hasLeftCounterOrder(open.orderId, open.visit)
      : this.#hasLeftOrder(open.orderId, open.visit);
  }

  /** The order the dialog adjusts, read again after an answer: the table's bill with its party and
   * what it owes, or the counter's stored order into the basket. Not `read` when the counter's was
   * not loaded again with its lines; why has been said, unless the basket had moved on. */
  async #rereadAdjusted(open: Adjusting): Promise<Reread> {
    if (open.surface === "counter") return this.#reloadCounterOrder(open.orderId, open.visit);
    await this.#rereadAmounts(open.orderId, open.visit);
    return "read";
  }

  /** The adjusted order's lines as last read; none when the counter's could not be read. */
  #adjustedLines(open: Adjusting): readonly TabLine[] {
    return open.surface === "table" ? this.tabLines : (this.counterLines?.lines ?? []);
  }

  #adjustAsk(open: Adjusting, choice: AdjustmentChoice): AdjustmentAsk {
    return { expectedRevision: open.revision, lineId: open.target.lineId, ...choice };
  }

  /** The dialog as it is now, when it is still the one `id` names. */
  #adjustingNow(id: number): Adjusting | null {
    return this.adjusting?.id === id ? this.adjusting : null;
  }

  async #onAdjustPreview(event: Event): Promise<void> {
    const choice = (event as CustomEvent<AdjustmentChoice>).detail;
    // The dialog's events come only while it is open. A press while a request is out is dropped.
    const open = this.adjusting!;
    if (open.busy) return;
    this.adjusting = { ...open, choice, refusal: null, busy: true };
    try {
      const preview = await this.api.previewAdjustment(open.orderId, this.#adjustAsk(open, choice));
      const now = this.#adjustingNow(open.id);
      if (now !== null) this.adjusting = { ...now, preview, busy: false };
    } catch (error) {
      if (this.#adjustingNow(open.id) !== null) await this.#onAdjustRefused(error, "preview");
    }
  }

  /** Confirmed: applied at once, or first the approver's PIN when the preview asked for it. */
  async #onAdjustConfirm(): Promise<void> {
    const open = this.adjusting!;
    if (open.busy) return;
    const role = open.preview!.needsApproval;
    if (role === null) {
      await this.#applyAdjustment(open);
      return;
    }
    this.adjusting = { ...open, refusal: null, busy: true };
    try {
      const approvers = await this.api.listAdjustmentApprovers(role);
      const now = this.#adjustingNow(open.id);
      if (now === null) return;
      this.adjusting = { ...now, busy: false };
      this.adjustApproverError = null;
      this.adjustApprovers = approvers;
    } catch (error) {
      if (this.#adjustingNow(open.id) !== null) await this.#onAdjustRefused(error, "approvers");
    }
  }

  /** The approver's PIN leaves in the request and is never kept. */
  async #onAdjustApproverConfirm(event: Event): Promise<void> {
    event.stopPropagation();
    const { personId, pin } = (event as CustomEvent<{ personId: string; pin: string }>).detail;
    // The PIN prompt is drawn only over an open dialog.
    const open = this.adjusting!;
    if (open.busy) return;
    this.adjustApproverError = null;
    await this.#applyAdjustment(open, { personId, pin });
  }

  /**
   * A fresh submission id for each confirmation, sent again unchanged only while a request gets no
   * answer (plan D8). Applied, the dialog closes if still open, the party's new revision is noted
   * ({@link #noteBillParty}) and, unless the waiter has left the order, it is read again
   * ({@link #rereadAdjusted}). With no answer at all while the dialog is open, it closes, the order
   * is read again too, and unless the waiter has left the order by then the message says the change
   * may have been made, and when that read failed or its answer was dropped, to hold and retrieve
   * the order to check; an order found gone is said to be gone, and nothing more. Once the dialog
   * is gone, no answer on a table's bill only reads the floor again and takes the party from it
   * ({@link #retakePartyFromFloor}) while the operator session that sent it lasts, and a refusal
   * changes nothing. On the counter nothing is sent once the basket no longer holds the order as
   * the dialog opened on it: the dialog closes and says so.
   */
  async #applyAdjustment(
    open: Adjusting,
    approver?: { personId: string; pin: string },
  ): Promise<void> {
    if (open.surface === "counter" && !this.#counterStillAdjustable(open)) {
      this.#closeAdjust();
      this.errorKey = "adjust.basket_changed";
      return;
    }
    const command: AdjustmentCommand = {
      ...this.#adjustAsk(open, open.choice!),
      submissionId: crypto.randomUUID(),
      ...(approver === undefined ? {} : { approver }),
    };
    this.adjusting = { ...open, refusal: null, busy: true };
    const session = this.#operatorSession;
    const limit = limited(TABLE_REQUEST_LIMIT_MS);
    try {
      const answer = await resendUnanswered(
        (signal) => this.api.applyAdjustment(open.orderId, command, { signal }),
        limit.signal,
        () => session === this.#operatorSession,
      );
      this.#noteBillParty(answer.party);
      if (this.#adjustingNow(open.id) !== null) this.#closeAdjust();
      if (this.errorKey === open.offer) this.errorKey = undefined;
      if (this.#hasLeftAdjusted(open)) return;
      await this.#rereadAdjusted(open);
    } catch (error) {
      if (this.#adjustingNow(open.id) === null) {
        if (
          open.surface === "table" &&
          isNetworkFailure(error) &&
          session === this.#operatorSession
        )
          await this.#retakePartyFromFloor();
        return;
      }
      await this.#onAdjustRefused(error, approver === undefined ? "apply" : "approved");
    } finally {
      limit.done();
    }
  }

  /** A refusal goes where it can be acted on: a PIN's in the PIN prompt, one naming a field under
   * that field, back on the form, and any other beside the dialog's action. */
  async #onAdjustRefused(
    error: unknown,
    stage: "preview" | "approvers" | "apply" | "approved",
  ): Promise<void> {
    const open = this.adjusting!;
    const code = (error as { code?: string } | undefined)?.code;
    if (stage === "approved" && code !== undefined && APPROVER_REFUSALS.has(code)) {
      this.adjustApproverError = code;
      this.adjusting = { ...open, busy: false };
      return;
    }
    this.#closeApprovers();
    if (code === "working_order.out_of_date") {
      await this.#onAdjustOutOfDate(open);
      return;
    }
    if ((stage === "apply" || stage === "approved") && isNetworkFailure(error)) {
      this.#closeAdjust();
      const read = await this.#rereadAdjusted(open);
      if (!this.#hasLeftAdjusted(open) && read !== "gone")
        this.errorKey = read === "read" ? "adjust.unconfirmed" : "adjust.unconfirmed_unread";
      return;
    }
    const refusal = code ?? "server.internal";
    const onField = refusalField(refusal, open.kind, open.target.unitTotal !== null) !== null;
    let reasons = open.reasons;
    if (REASON_REFUSALS.has(refusal)) {
      try {
        reasons = await this.api.listAdjustmentReasons();
      } catch {
        // The reasons already shown stay; the refusal says to choose another.
      }
    }
    const now = this.#adjustingNow(open.id);
    if (now === null) return;
    this.adjusting = {
      ...now,
      reasons,
      refusal,
      busy: false,
      preview: onField ? null : now.preview,
    };
    // The invoice a change would issue refuses a dish sold out before it was sent.
    if (
      (isBillMoneyRefusal(error) || refusal === "product.unavailable") &&
      !this.#hasLeftAdjusted(open)
    )
      await this.#rereadAdjusted(open);
  }

  /**
   * The bill changed on another device since the dialog opened. It closes, the bill is read again,
   * and the message says what changed; nothing is sent again, so the person acts again on what
   * they now see.
   */
  async #onAdjustOutOfDate(open: Adjusting): Promise<void> {
    const lineId = open.target.lineId;
    const before = this.#adjustedLines(open).find((line) => line.id === lineId);
    this.#closeAdjust();
    const read = await this.#rereadAdjusted(open);
    if (this.#hasLeftAdjusted(open) || read !== "read") return;
    const after = this.#adjustedLines(open).find((line) => line.id === lineId);
    const changed =
      before !== undefined &&
      after !== undefined &&
      (before.quantity !== after.quantity ||
        before.unitPriceGross !== after.unitPriceGross ||
        before.listUnitPriceGross !== after.listUnitPriceGross);
    const key =
      lineId === null
        ? "adjust.changed_bill"
        : after === undefined
          ? "adjust.changed_line_gone"
          : changed
            ? "adjust.changed_line"
            : "adjust.changed_bill";
    this.errorKey = { billChanged: { key, line: open.target.name } };
  }

  #onAdjustEdit(): void {
    if (this.adjusting !== null)
      this.adjusting = { ...this.adjusting, preview: null, refusal: null };
  }

  #closeApprovers(): void {
    this.adjustApprovers = undefined;
    this.adjustApproverError = null;
  }

  #closeAdjust(): void {
    this.adjusting = null;
    this.#closeApprovers();
  }

  /**
   * A saved change stores the new revision and reads the order, its bills and what the party owes
   * again whenever that order is still the open one, wherever the waiter is, so the next change is
   * not refused as out of date and an extra's price shows at once. A refusal reads the order again
   * too, and one because the kitchen has started the line offers to cancel it. A change that got
   * no answer also reads the order, its bills and what the party owes again.
   * When the order is no longer the open one, or {@link #orderVisit} says the waiter started leaving
   * it and did not come back to it, a refusal or a change that got no answer changes nothing on
   * screen but the message, which names the line, and its table while the floor lists it, because
   * the waiter may believe a note (an allergy, say) was saved. Paying the tab and a server switch
   * take the order off screen without that counter moving.
   */
  async #onChangeLine(event: Event): Promise<void> {
    const { lineNo, lineName, patch, revision } = (event as CustomEvent<ChangeLineDetail>).detail;
    const orderId = this.activeTabId;
    if (orderId === undefined) return;
    const visit = this.#orderVisit;
    const left = () => this.#hasLeftOrder(orderId, visit);
    const tableId = this.activeTableId;
    this.errorKey = undefined;
    this.cancelOffer = null;
    let outcome: { saved: { revision: number; party: BillParty } } | { error: unknown };
    try {
      outcome = { saved: await this.api.updateOrderLine(orderId, lineNo, patch, revision) };
    } catch (error) {
      outcome = { error };
    }
    if ("saved" in outcome) {
      this.#noteBillParty(outcome.saved.party);
      if (this.activeTabId !== orderId) return;
      this.tabRevision = outcome.saved.revision;
      await this.#rereadAmounts(orderId, visit);
      return;
    }
    const code = (outcome.error as { code?: string } | undefined)?.code;
    if (left()) {
      const tableLabel = this.tables.find((table) => table.id === tableId)?.label;
      this.errorKey = {
        lateChange: {
          lineName,
          unanswered: isNetworkFailure(outcome.error),
          ...(tableLabel === undefined ? {} : { tableLabel }),
          ...(code === undefined ? {} : { code }),
        },
      };
      return;
    }
    this.errorKey =
      code === "working_order.out_of_date"
        ? "held.changed_elsewhere"
        : code === "bill.received_exceeds_total"
          ? billWriteError(outcome.error, true)
          : lineWriteError(outcome.error);
    if (isNetworkFailure(outcome.error)) await this.#rereadAmounts(orderId, visit);
    else if (isBillMoneyRefusal(outcome.error)) await this.#loadLinesAndBills();
    else await this.#loadTabLines();
    if (code === "ticket.already_started" && !left()) this.cancelOffer = lineNo;
  }

  /** Leaving an order clears the banner, except a failed change to a line of an order already left,
   * which has to outlive the switch. */
  #clearErrorKeepingLateChange(): void {
    const late = this.#lateChangeShown();
    this.errorKey = late === undefined ? undefined : { lateChange: late };
  }

  #lateChangeShown(): LateChange | undefined {
    return typeof this.errorKey === "object" && "lateChange" in this.errorKey
      ? this.errorKey.lateChange
      : undefined;
  }

  /** Keyed by {@link activeTableId}, not the tab's order id. */
  async #onSetStatus(event: Event): Promise<void> {
    const { statusId } = (event as CustomEvent<{ statusId: string | null }>).detail;
    if (this.activeTableId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.setTableStatus(this.activeTableId, statusId);
    } catch (error) {
      this.errorKey = tableWriteError(error);
    }
  }

  /** Re-reads occupancy without leaving the screen. Unlike {@link #refreshFloor}, a failed read
   * empties the floor. */
  async #reloadTables(): Promise<void> {
    try {
      this.tables = await this.api.getTablesState();
    } catch {
      this.tables = [];
    }
  }

  /**
   * The guests move off all their tables to the one chosen, which becomes {@link activeTableId}. At a
   * table another party held, they are now that party: the screen follows them to its main bill, or
   * the bill {@link billToOpen} picks, and says so when bills asked to merge stayed apart. Once the
   * floor is read again after the answer, none of this happens if the waiter has left the party
   * ({@link #hasLeftParty}); and nothing is said about bills kept apart, then or later, once the
   * waiter has left the order and either has not come back to it or a table open is under way
   * ({@link #leftSince}).
   */
  async #onMoveGuests(event: Event): Promise<void> {
    const { toTableId, bills } = (
      event as CustomEvent<{ toTableId: string; bills: "merge" | "separate" }>
    ).detail;
    const party = this.orderParty;
    if (party === null) return;
    const sent = this.#sentNow();
    const visit = this.#orderVisit;
    this.errorKey = undefined;
    const revisions = this.#tableActionRevisions(party, toTableId);
    let result: TableActionResult;
    try {
      result = await this.api.moveGuests(party.id, toTableId, bills, revisions);
    } catch (error) {
      await this.#onTableRefusal(error);
      return;
    }
    await this.#reloadTables();
    if (this.#hasLeftParty(party.id, sent)) return;
    this.activeTableId = toTableId;
    this.#rememberOrderParty();
    const followed = this.orderParty?.id;
    if (result.partyId !== party.id) {
      if (result.mainBillId !== null) this.activeTabId = result.mainBillId;
      else {
        const { bills: read } = await this.#loadPartyBills();
        if (this.#hasLeftParty(followed, sent)) return;
        this.activeTabId = billToOpen(read ?? []);
      }
    }
    await this.#loadLinesAndBills();
    if (this.#hasLeftParty(followed, sent) || this.#leftSince(visit)) return;
    this.#sayBillsKeptApart(revisions, bills, result);
  }

  /**
   * The bill on screen moves whole to another table or to the counter, in the zone the counter's
   * orders are made in. The screen stays with this party, on its main bill or {@link billToOpen}'s,
   * and goes back to the floor when the party has no bill left. A failed read of the floor after the
   * move keeps the last floor and the party on screen. Once the waiter has left the bill, the move
   * opens no other bill, does not go back to the floor and says nothing about bills kept apart.
   */
  async #onMoveBill(event: Event): Promise<void> {
    const { to, bills } = (event as CustomEvent<MoveBillDetail>).detail;
    const billId = this.activeTabId;
    const party = this.orderParty;
    if (billId === undefined || party === null) return;
    const visit = this.#orderVisit;
    this.errorKey = undefined;
    const toTable = "tableId" in to;
    const revisions: MoveBillRevisions = {
      ...this.#billRevisions(),
      ...(toTable ? otherPartyRead(to.seated, party.id) : {}),
    };
    let result: MoveBillResult;
    try {
      result = await this.api.moveBill(
        billId,
        toTable
          ? { tableId: to.tableId }
          : { counter: { zoneId: this.counterServiceZoneId || null } },
        bills,
        revisions,
      );
    } catch (error) {
      await this.#onTableRefusal(error);
      return;
    }
    if (!toTable) void this.#refreshAfterWrite("held", "refresh.held_after_move");
    const floorRead = await this.#refreshFloor();
    if (this.#hasLeftOrder(billId, visit)) return;
    if (floorRead) this.#rememberOrderParty();
    const { bills: read } = await this.#loadPartyBills();
    if (this.#hasLeftOrder(billId, visit)) return;
    const next = this.#billAfterMove(billId, read);
    if (next === undefined) this.#leaveTable();
    else this.activeTabId = next;
    this.#sayBillsKeptApart(revisions, bills, result);
    if (next !== undefined) await this.#loadTabLines();
  }

  /** The party's bill to show once `moved` has left it: its main bill while that is still among
   * its bills, else {@link billToOpen}'s; none when the party has no bill left, or its bills could
   * not be read and it has no other main bill. */
  #billAfterMove(moved: string, read: PartyBill[] | null): string | undefined {
    const main = this.orderParty?.mainBillId ?? undefined;
    if (read === null) return main === moved ? undefined : main;
    const left = read.filter((bill) => bill.workingOrderId !== moved);
    if (left.some((bill) => bill.workingOrderId === main)) return main;
    return billToOpen(left);
  }

  /**
   * A counter order, read with no party, moves to a table. The counter stays on screen and says
   * where it went; a basket holding that order is emptied, since it is now the table's bill.
   */
  async #onMoveHeldOrder(event: Event): Promise<void> {
    const { orderId, tableId, seated, bills } = (event as CustomEvent<MoveHeldOrderDetail>).detail;
    const label = this.tables.find((table) => table.id === tableId)?.label ?? "";
    this.errorKey = undefined;
    try {
      await this.api.moveBill(orderId, { tableId }, bills, {
        partyId: null,
        ...otherPartyRead(seated, null),
      });
    } catch (error) {
      await this.#onTableRefusal(error);
      // A failed re-read keeps the list it had; the banner says the refusal.
      await this.#refreshHeldOrders().catch(() => undefined);
      return;
    }
    if (this.#store.id === orderId) {
      this.#store.clear();
      this.cardOutcome = undefined;
    }
    this.submittedNotice = t("counter.moved_to_table").replace("{table}", () => label);
    this.renderRoot.querySelector<WtToast>("wt-toast[data-submitted-toast]")?.show();
    await this.#refreshAfterWrite("held", "refresh.held_after_move");
  }

  /** The chosen table joins the party; a party seated there joins it with all its tables. If the
   * waiter has left the party ({@link #hasLeftParty}) by the time the server answers, nothing is
   * read or said; nothing is said about bills kept apart, then or later, once the waiter has left
   * the order and either has not come back to it or a table open is under way
   * ({@link #leftSince}). */
  async #onJoinTables(event: Event): Promise<void> {
    const { tableId, bills } = (
      event as CustomEvent<{ tableId: string; bills: "merge" | "separate" }>
    ).detail;
    const party = this.orderParty;
    if (party === null) return;
    const sent = this.#sentNow();
    const visit = this.#orderVisit;
    this.errorKey = undefined;
    const revisions = this.#tableActionRevisions(party, tableId);
    let result: TableActionResult;
    try {
      result = await this.api.joinTables(party.id, tableId, bills, revisions);
    } catch (error) {
      await this.#onTableRefusal(error);
      return;
    }
    if (this.#hasLeftParty(party.id, sent)) return;
    await this.#reloadOrder();
    if (this.#hasLeftParty(result.partyId, sent) || this.#leftSince(visit)) return;
    this.#sayBillsKeptApart(revisions, bills, result);
  }

  #sayBillsKeptApart(
    revisions: { otherPartyId?: string | null },
    bills: "merge" | "separate",
    result: { merged: boolean },
  ): void {
    const combined = typeof revisions.otherPartyId === "string";
    if (combined && bills === "merge" && !result.merged)
      this.errorKey = "table.bills_kept_separate";
  }

  /**
   * The table leaves the party with the chosen bill, or none, and a new party starts there. The
   * screen stays with this party: at another of its tables when the open one left, and on its main
   * bill when the bill on screen left with the table. With no main bill, the party's bills are read
   * and {@link billToOpen} picks one, unless the waiter has left the party ({@link #hasLeftParty})
   * by the time they answer.
   */
  async #onSplitTable(event: Event): Promise<void> {
    const { tableId, billId } = (event as CustomEvent<{ tableId: string; billId: string | null }>)
      .detail;
    const party = this.orderParty;
    if (party === null) return;
    const sent = this.#sentNow();
    this.errorKey = undefined;
    try {
      await this.api.splitTable(party.id, tableId, billId, party.revision);
    } catch (error) {
      await this.#onTableRefusal(error);
      return;
    }
    if (this.activeTableId === tableId)
      this.activeTableId = party.tableIds.find((id) => id !== tableId);
    await this.#reloadTables();
    this.#rememberOrderParty();
    if (billId !== null && this.activeTabId === billId) {
      const main = this.orderParty?.mainBillId ?? null;
      if (main !== null) this.activeTabId = main;
      else {
        const { bills: read } = await this.#loadPartyBills();
        if (this.#hasLeftParty(party.id, sent)) return;
        this.activeTabId = billToOpen(read ?? []);
      }
    }
    await this.#loadLinesAndBills();
  }

  /** A refusal of the name itself goes back to the screen's field, unless the waiter has left the
   * party since; any other is said on the banner. */
  async #onNameParty(event: Event): Promise<void> {
    const { name } = (event as CustomEvent<{ name: string | null }>).detail;
    const party = this.orderParty;
    if (party === null) return;
    const visit = this.#orderVisit;
    this.errorKey = undefined;
    this.nameRefusal = null;
    try {
      const named = await this.api.setPartyName(party.id, name, party.revision);
      this.#notePartyRevision(party.id, named.revision);
    } catch (error) {
      const refused = error as { code?: string; field?: string } | undefined;
      if (refused?.code === "management.request_invalid" && refused.field === "name") {
        if (visit === this.#orderVisit && this.orderParty?.id === party.id)
          this.nameRefusal = { name: name ?? "", message: t("table.name_too_long") };
        return;
      }
      await this.#onTableRefusal(error);
      return;
    }
    await this.#reloadOrder();
  }

  /** `service_zone.mode_incompatible`'s own words are about a table; between two bills it means
   * the two are served in different ways. */
  async #onBillPairRefusal(error: unknown): Promise<void> {
    if ((error as { code?: string } | undefined)?.code === "service_zone.mode_incompatible")
      this.errorKey = "table.bills_served_differently";
    else if (isBillMoneyRefusal(error)) await this.#onBillMoneyRefusal(error);
    else await this.#onTableRefusal(error);
  }

  /** A bill action refused for the money on a bill: said, and the party's bills read again. */
  async #onBillMoneyRefusal(error: unknown): Promise<void> {
    this.errorKey = billWriteError(error);
    await this.#loadPartyBills();
  }

  async #onMergeBills(event: Event): Promise<void> {
    const { fromBillId } = (event as CustomEvent<{ fromBillId: string }>).detail;
    if (this.activeTabId === undefined) return;
    this.errorKey = undefined;
    try {
      await this.api.mergeBills(this.activeTabId, fromBillId, this.#billRevisions());
    } catch (error) {
      await this.#onBillPairRefusal(error);
      return;
    }
    await this.#reloadOrder();
  }

  async #onTransferLines(event: Event): Promise<void> {
    const { toBillId, transfers } = (
      event as CustomEvent<{ toBillId: string; transfers: TabTransfer[] }>
    ).detail;
    if (this.activeTabId === undefined || transfers.length === 0) return;
    this.errorKey = undefined;
    try {
      await this.api.transferItems(this.activeTabId, toBillId, transfers, this.#billRevisions());
    } catch (error) {
      await this.#onBillPairRefusal(error);
      return;
    }
    await this.#reloadOrder();
  }

  /** Put the chosen items on a new bill of the party, and show that bill unless the waiter has left
   * the party since ({@link #hasLeftParty}). */
  async #onSplitLines(event: Event): Promise<void> {
    const { transfers } = (event as CustomEvent<{ transfers: TabTransfer[] }>).detail;
    const billId = this.activeTabId;
    const partyId = this.orderParty?.id;
    if (billId === undefined) return;
    const sent = this.#sentNow();
    this.errorKey = undefined;
    try {
      const split = await this.api.splitBill(billId, transfers, this.#billRevisions());
      if (this.#hasLeftParty(partyId, sent)) return;
      this.activeTabId = split.billId;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "tab.transfer_modifier_line") this.errorKey = "table.split_modifier_error";
      else if (code === "tab.split_held_line") this.errorKey = "table.split_held_error";
      else if (isBillMoneyRefusal(error)) await this.#onBillMoneyRefusal(error);
      else await this.#onTableRefusal(error);
      return;
    }
    await this.#reloadOrder();
  }

  /** Finish frees the party's tables, or leaves them to clear. Unless the order's party has changed
   * or the operator session has ended (a logout or a server switch) since, the finished party is
   * closed: the floor comes next, except when the waiter has left the order and either has not come
   * back to it or a table open is under way ({@link #leftSince}); then the screen stays where it is
   * and only the floor is read again. A bill still unpaid is said on the screen, beside the offer to
   * take its payment, unless the waiter has left the party since ({@link #hasLeftParty}). */
  async #onFinishTable(): Promise<void> {
    const party = this.orderParty;
    if (party === null) return;
    const visit = this.#orderVisit;
    const sent = this.#sentNow();
    this.errorKey = undefined;
    this.finishRefused = false;
    try {
      await this.api.finishTable(party.id, party.revision);
    } catch (error) {
      if ((error as { code?: string } | undefined)?.code === "party.bill_outstanding") {
        if (this.#hasLeftParty(party.id, sent)) return;
        this.finishRefused = true;
        await this.#loadPartyBills();
        return;
      }
      await this.#onTableRefusal(error);
      return;
    }
    // Logout and a server switch leave `orderParty` set; a server switch leaves `#orderVisit` too,
    // so without this `#leaveTable` would unlock the till.
    // Unlike #hasLeftParty, an open under way does not drop the answer: an open that fails would
    // leave the finished party on screen.
    if (sent.session !== this.#operatorSession || this.orderParty?.id !== party.id) return;
    if (!this.#leftSince(visit)) {
      this.#leaveTable();
      return;
    }
    this.#forgetParty();
    await this.#refreshFloor();
  }

  /** The finished party's order is closed on every face: a till's drill, or a handheld's order tab. */
  #leaveTable(): void {
    this.#forgetParty();
    this.#returnToFloor();
  }

  /** Clears the open order's bill, table and party without moving the screen. */
  #forgetParty(): void {
    this.activeTabId = undefined;
    this.activeTableId = undefined;
    this.orderParty = null;
    this.#tabLinesRead++;
    this.#partyBillsRead++;
    this.tabLines = [];
    this.tabGroups = [];
    this.printProblems = [];
    this.currentOrders = null;
    this.currentOrdersUnread = false;
    this.reprintSent = [];
    this.#groupsUnread = false;
    this.partyBills = [];
  }

  /** A till's drill goes back to the floor; a card mount selects the canvas's floor tab. */
  #returnToFloor(): void {
    const floorTab = this.canvas?.tabs.find((tab) => this.#tabNeedsFloorData(tab))?.key;
    if (this.drill?.kind === "table-order" || !this.#inShell() || floorTab === undefined) {
      this.#onBackToFloor();
    } else {
      this.#onTabSelect(floorTab);
    }
  }

  /** Charges another bill of the party from the same screen. */
  async #onTakePayment(event: Event): Promise<void> {
    const { workingOrderId } = (event as CustomEvent<{ workingOrderId: string }>).detail;
    this.errorKey = undefined;
    this.finishRefused = false;
    this.activeTabId = workingOrderId;
    await this.#loadTabLines();
  }

  async #onReprintBill(event: Event): Promise<void> {
    const { workingOrderId } = (event as CustomEvent<{ workingOrderId: string }>).detail;
    this.errorKey = undefined;
    try {
      await this.api.reprint(workingOrderId);
    } catch {
      this.errorKey = "reprint.error";
    }
  }

  async #onMarkCleared(event: Event): Promise<void> {
    const { tableId } = (event as CustomEvent<{ tableId: string }>).detail;
    this.errorKey = undefined;
    try {
      await this.api.markTableCleared(tableId);
    } catch (error) {
      this.errorKey = tableWriteError(error);
    }
    await this.#refreshFloor();
  }

  #endOperatorSession(): void {
    this.#endReloadLock();
    this.#menuPoll.stop();
    this.#tableZoneId = undefined;
    this.#markedRounds.clear();
    // The basket stays as it was, as a cancel leaves it; the next sign-in's offers load checks it.
    this.basketRefresh = undefined;
    this.#closeAdjust();
    this.#closeBillPaying();
    this.#operatorSession++;
  }

  /**
   * A presented bill is charged through `collectOrder`; an open one through `recordSale`, which files
   * its stored lines and ignores the basket, so `[]` is sent. Neither runs `#syncIfDirty`, because it
   * saves the counter basket, which is not the tab. Shares `submitting` with {@link #onConfirmPayment}.
   */
  async #onPayTab(event: Event): Promise<void> {
    if (this.submitting || this.activeTabId === undefined) return;
    const id = this.activeTabId;
    const bill = this.partyBills.find((row) => row.workingOrderId === id);
    if (bill !== undefined && paidInPart(bill)) {
      this.#sayBillPayments(bill.outstanding);
      return;
    }
    this.submitting = true;
    const tender = (event as CustomEvent<ConfirmPaymentDetail>).detail;
    const presented = bill?.status === "placed";
    this.errorKey = undefined;
    let paidMeanwhile = false;
    try {
      // The bill's id is the idempotency key on both paths, so a retry replays the first answer.
      this.result = presented
        ? await this.api.collectOrder(id, tender)
        : await this.api.recordSale([], tender, id);
      this.#showTicket(id, bill?.receiptAvailable !== true);
    } catch (error) {
      paidMeanwhile = isPaymentsReceived(error);
      // No preliminary save, so any network failure may have filed.
      this.errorKey = paidMeanwhile
        ? "bill.pay_with_bill_payments"
        : isPermanentSaleRefusal(error)
          ? "sale.refused"
          : isNetworkFailure(error)
            ? "sale.unconfirmed"
            : "sale.error";
    } finally {
      this.submitting = false;
    }
    // Another device took a payment on the bill first: read again, the bill offers to take the rest
    // as a bill payment.
    if (paidMeanwhile && this.activeTabId === id) await this.#loadPartyBills();
  }

  /** Pay items, Contribute or Split equally pressed on the bill on screen: the dialog opens on the
   * balance last read and reads it again. */
  async #onBillPay(event: Event): Promise<void> {
    const { way, lines, amount } = (event as CustomEvent<BillPayDetail>).detail;
    await this.#openBillPaying(way, lines, amount);
  }

  /** "Give back" pressed on a move refused for leaving the bill owing less than it received: the
   * bill payment dialog opens on the bill on screen, and when its payments, read again, have only
   * one that can be given back, the refund of that one opens over it, offering the excess as the
   * part to give back. */
  async #onRefundExcess(event: Event): Promise<void> {
    const { excess } = (event as CustomEvent<{ excess: string }>).detail;
    const open = await this.#openBillPaying("contribution", this.#payLinesOnScreen());
    const now = open === null ? null : this.#billPayingNow(open.id);
    // Only on payments just read: a failed read says so beside the dialog's action instead.
    if (now?.balance == null || now.refusal !== null || this.billRefunding !== null) return;
    const balance = now.balance;
    const offered = balance.payments.filter((payment) => refundOffered(payment, balance.status));
    if (offered.length === 1) this.#openBillRefunding(now, offered[0]!, excess);
  }

  /** The pay card's offer on a counter order a payment is already on: the bill payment dialog opens
   * on it, once an edit made to it in the basket is saved, as a single payment saves it first. */
  async #onCounterBillPay(event: Event): Promise<void> {
    const { amount } = (event as CustomEvent<{ amount: string }>).detail;
    if (this.billPaying !== null || this.#basketPaidInPart() === undefined) return;
    const id = this.#store.id;
    const session = this.#operatorSession;
    try {
      if (!(await this.#syncIfDirty(id, this.#currentSaleLines(), this.#store.label))) return;
    } catch (error) {
      if (!this.#hasLeftCounterOrder(id, session))
        this.errorKey = counterError(error, "sale.error");
      return;
    }
    if (this.#hasLeftCounterOrder(id, session)) return;
    await this.#openBillPaying(
      "contribution",
      payLines(this.counterLines?.lines ?? [], (line) => line.name ?? ""),
      amount,
      { surface: "counter", billId: id, visit: session },
    );
  }

  /** After an answer to a payment or a refund, the order the dialog pays is read again: the table's
   * bill with its party and what it owes, or the counter's order into the basket with the held
   * orders. Nothing is read once the waiter has left the order. */
  async #rereadPayingOrder(open: PayingOrder): Promise<void> {
    if (open.surface === "counter") {
      if (!this.#hasLeftCounterOrder(open.billId, open.visit))
        await this.#reloadCounterOrder(open.billId, open.visit);
    } else if (!this.#hasLeftOrder(open.billId, open.visit)) {
      await this.#rereadAmounts(open.billId, open.visit);
    }
  }

  /** The bill on screen's lines as an item payment offers them, named as staff know them. */
  #payLinesOnScreen(): PayLine[] {
    return payLines(this.tabLines, (line) => line.name ?? "");
  }

  /** The bill payment dialog on the bill on screen, unless one is open already; the balance last
   * read shows at once and is read again. */
  async #openBillPaying(
    way: PayWay,
    lines: PayLine[],
    amount?: string,
    order: PayingOrder | undefined = this.activeTabId === undefined
      ? undefined
      : { surface: "table", billId: this.activeTabId, visit: this.#orderVisit },
  ): Promise<BillPaying | null> {
    if (order === undefined || this.billPaying !== null) return null;
    const { billId } = order;
    const open: BillPaying = {
      id: ++this.#billPays,
      ...order,
      way,
      amount: amount ?? "",
      lines,
      balance: this.billBalance?.workingOrderId === billId ? this.billBalance : null,
      asked: null,
      preview: null,
      refusal: null,
      taken: null,
      refunded: null,
      busy: false,
    };
    this.billPaying = open;
    await this.#rereadBillPaying(open.id, billId);
    return open;
  }

  /** The dialog as it is now, when it is still the one `id` names. */
  #billPayingNow(id: number): BillPaying | null {
    return this.billPaying?.id === id ? this.billPaying : null;
  }

  /** The bill's balance read again into the dialog `id` and the screen. A failed read says so beside
   * the dialog's action unless it already shows a refusal. */
  async #rereadBillPaying(id: number, billId: string): Promise<void> {
    try {
      const balance = await this.api.getBillBalance(billId);
      if (this.activeTabId === billId) this.billBalance = balance;
      const now = this.#billPayingNow(id);
      if (now !== null) this.billPaying = { ...now, balance };
    } catch {
      const now = this.#billPayingNow(id);
      if (now !== null && now.refusal === null)
        this.billPaying = { ...now, refusal: { code: "unread" } };
    }
  }

  async #onBillPayPreview(event: Event): Promise<void> {
    const asked = (event as CustomEvent<PayRequest>).detail;
    // The dialog's events come only while it is open. A press while a request is out is dropped.
    const open = this.billPaying!;
    if (open.busy) return;
    this.billPaying = { ...open, refusal: null, taken: null, refunded: null, busy: true };
    try {
      const preview = await this.api.previewBillPayment(
        open.billId,
        paymentAsk(asked.choice, asked.pay, asked.allocation),
      );
      const now = this.#billPayingNow(open.id);
      if (now !== null) this.billPaying = { ...now, asked, preview, busy: false };
    } catch (error) {
      await this.#onBillPayRefused(open.id, error, asked, "preview");
    }
  }

  /**
   * Takes the payment the dialog showed. Its submission id is fresh for each confirmation, and is
   * the one sent before only while that same confirmation on the same bill got no answer (plan
   * D8); the request is sent again unchanged while it gets none.
   */
  async #onBillPayConfirm(): Promise<void> {
    // Sent only from the confirmation, which shows an allocated preview of what was asked.
    const open = this.billPaying!;
    if (open.busy) return;
    const asked = open.asked!;
    const confirmation = confirmationOf(
      paymentAsk(asked.choice, asked.pay, asked.allocation),
      open.preview as Extract<AllocationPreview, { kind: "allocated" }>,
      asked.card,
    );
    const before = this.#unansweredPayment;
    const submission = submissionFor(open.billId, confirmation, before);
    this.billPaying = { ...open, refusal: null, taken: null, refunded: null, busy: true };
    const session = this.#operatorSession;
    const limit = limited(TABLE_REQUEST_LIMIT_MS);
    // A later operator's send may have replaced the unanswered payment while this one was out.
    const settle = (error?: unknown) => {
      if (this.#unansweredPayment === before)
        this.#unansweredPayment = unansweredAfter(submission, error);
    };
    try {
      const result = await resendUnanswered(
        (signal) => this.api.takeBillPayment(open.billId, submission.request, { signal }),
        limit.signal,
        () => session === this.#operatorSession,
      );
      settle();
      await this.#onBillPaid(open, result);
    } catch (error) {
      settle(error);
      await this.#onBillPayRefused(open.id, error, asked, "take");
    } finally {
      limit.done();
    }
  }

  /**
   * The server's answer to a payment. When it issued the bill's invoice, the dialog closes and the
   * ticket shows. A card the reader did not charge records nothing: the confirmation stays, saying
   * so, to be tried again as a new payment. Otherwise the dialog says the payment was taken, or for
   * a card still at the reader that it is in progress, with the bill's new balance, and the bill is
   * read again. An answer after a logout has closed the dialog changes nothing.
   */
  async #onBillPaid(open: BillPaying, result: BillPaymentResult): Promise<void> {
    const now = this.#billPayingNow(open.id);
    if (now === null) return;
    if (this.activeTabId === open.billId) this.billBalance = result.balance;
    if (NOT_CHARGED_OUTCOMES.has(result.outcome)) {
      this.billPaying = {
        ...now,
        balance: result.balance,
        refusal: { code: result.outcome === "network_unavailable" ? "card_network" : "declined" },
        busy: false,
      };
      return;
    }
    if (result.invoice !== undefined) {
      this.#closeBillPaying();
      this.result = result.invoice;
      this.#showTicket(open.billId);
      // The paid order drops off the held list.
      if (open.surface === "counter")
        await this.#refreshAfterWrite("held", "refresh.held_after_sale");
      return;
    }
    this.billPaying = {
      ...now,
      balance: result.balance,
      asked: null,
      preview: null,
      refusal: null,
      taken:
        result.payment.state === "pending"
          ? { change: null, pending: result.payment.applied }
          : { change: result.payment.change },
      busy: false,
    };
    await this.#rereadPayingOrder(open);
  }

  /**
   * A refusal shows beside the dialog's action, or under the field it names, and the balance is read
   * again. `bill.allocation_changed` reopens the confirmation with the amounts the server now
   * gives, and sends nothing; a payment that got no answer stays on its confirmation, to be taken
   * again under the same submission id. Any other refusal goes back to the form.
   */
  async #onBillPayRefused(
    id: number,
    error: unknown,
    asked: PayRequest,
    stage: "preview" | "take",
  ): Promise<void> {
    const now = this.#billPayingNow(id);
    if (now === null) return;
    const refused = error as {
      code?: unknown;
      field?: unknown;
      preview?: unknown;
      chargeable?: unknown;
    };
    const code = typeof refused.code === "string" ? refused.code : "server.internal";
    if (stage === "take" && isNetworkFailure(error)) {
      this.billPaying = { ...now, refusal: { code: "network" }, busy: false };
    } else if (code === "bill.allocation_changed" && refused.preview !== undefined) {
      this.billPaying = {
        ...now,
        asked,
        preview: refused.preview as AllocationPreview,
        refusal: { code },
        busy: false,
      };
    } else {
      this.billPaying = {
        ...now,
        asked: null,
        preview: null,
        refusal: {
          code,
          ...(typeof refused.field === "string" ? { field: refused.field } : {}),
          ...(typeof refused.chargeable === "string" ? { chargeable: refused.chargeable } : {}),
        },
        busy: false,
      };
    }
    await this.#rereadBillPaying(id, now.billId);
    await this.#rereadPayingOrder(now);
  }

  #onBillPayEdit(): void {
    this.billPaying = { ...this.billPaying!, asked: null, preview: null, refusal: null };
  }

  #closeBillPaying(): void {
    this.billPaying = null;
    this.#closeBillRefunding();
  }

  /** Refund pressed on a payment the dialog lists: the refund dialog opens over it. */
  #onBillRefund(event: Event): void {
    const { paymentId } = (event as CustomEvent<{ paymentId: string }>).detail;
    // The dialog offers Refund only on a payment of the balance it shows, and is under the refund
    // dialog while that is open.
    const open = this.billPaying!;
    this.#openBillRefunding(
      open,
      open.balance!.payments.find((payment) => payment.id === paymentId)!,
      null,
    );
  }

  #openBillRefunding(open: BillPaying, payment: BillPaymentView, suggested: string | null): void {
    this.billRefunding = {
      id: ++this.#billRefunds,
      payId: open.id,
      surface: open.surface,
      billId: open.billId,
      visit: open.visit,
      payment,
      suggested,
      terminal: false,
      asked: null,
      refusal: null,
      busy: false,
    };
  }

  #billRefundingNow(id: number): BillRefunding | null {
    return this.billRefunding?.id === id ? this.billRefunding : null;
  }

  #closeBillRefunding(): void {
    this.billRefunding = null;
    this.#closeRefundApprovers();
  }

  #closeRefundApprovers(): void {
    this.refundApprovers = undefined;
    this.refundApproverError = null;
  }

  /**
   * How much and why, confirmed: the refund is sent in the operator's own name, and only when the
   * server answers that they cannot give refunds are the people who can approve it read and their
   * PIN prompt opened, as the drawer does. A card keyed on a separate terminal is given back there
   * first, and its confirmation always asks for a PIN, which the server needs even from someone
   * allowed to give refunds.
   */
  async #onRefundContinue(event: Event): Promise<void> {
    const asked = (event as CustomEvent<RefundAsk>).detail;
    // The dialog's events come only while it is open. A press while a request is out is dropped.
    const open = this.billRefunding!;
    if (open.busy) return;
    if (open.payment.entry === "manual" && asked.manualConfirmed !== true) {
      this.billRefunding = { ...open, asked, terminal: true, refusal: null };
      return;
    }
    const sending: BillRefunding = { ...open, asked, refusal: null, busy: true };
    this.billRefunding = sending;
    if (asked.manualConfirmed === true) await this.#askRefundApprover(open.id);
    else await this.#sendRefund(sending);
  }

  /** The people who can approve the refund in dialog `id` are read, and their PIN prompt opens. */
  async #askRefundApprover(id: number): Promise<void> {
    try {
      const approvers = await this.api.listRefundAuthorizers();
      const now = this.#billRefundingNow(id);
      if (now === null) return;
      this.billRefunding = { ...now, busy: false };
      this.refundApproverError = null;
      this.refundApprovers = approvers;
    } catch {
      const now = this.#billRefundingNow(id);
      if (now !== null)
        this.billRefunding = { ...now, refusal: { code: "approvers" }, busy: false };
    }
  }

  /** The approver's PIN leaves in the request and is never kept. */
  async #onRefundApproverConfirm(event: Event): Promise<void> {
    event.stopPropagation();
    const override = (event as CustomEvent<{ personId: string; pin: string }>).detail;
    // The PIN prompt is drawn only over an open refund dialog.
    const open = this.billRefunding!;
    if (open.busy) return;
    this.refundApproverError = null;
    this.billRefunding = { ...open, refusal: null, busy: true };
    await this.#sendRefund(open, { personId: override.personId, pin: override.pin });
  }

  /** Sends the refund the dialog asked for, approved by `override` when one is given. */
  async #sendRefund(
    open: BillRefunding,
    override?: { personId: string; pin: string },
  ): Promise<void> {
    const before = this.#unansweredRefund;
    const submission = refundSubmissionFor(open.billId, open.payment.id, open.asked!, before);
    const session = this.#operatorSession;
    const limit = limited(TABLE_REQUEST_LIMIT_MS);
    // A later operator's send may have replaced the unanswered refund while this one was out.
    const settle = (error?: unknown) => {
      if (this.#unansweredRefund === before)
        this.#unansweredRefund = unansweredAfter(submission, error);
    };
    try {
      const result = await resendUnanswered(
        (signal) =>
          this.api.refundBillPayment(
            open.billId,
            open.payment.id,
            override === undefined ? submission.request : { ...submission.request, override },
            { signal },
          ),
        limit.signal,
        () => session === this.#operatorSession,
      );
      settle();
      await this.#onRefunded(open, result);
    } catch (error) {
      settle(error);
      if (
        override === undefined &&
        (error as { code?: unknown }).code === "authorization.not_permitted" &&
        this.#billRefundingNow(open.id) !== null
      )
        await this.#askRefundApprover(open.id);
      else await this.#onRefundRefused(open, error);
    } finally {
      limit.done();
    }
  }

  /** The refund dialog closes; the bill payment dialog says what the refund did and shows the
   * bill's new balance, and the bill is read again. An answer after the operator has logged out
   * changes nothing. */
  async #onRefunded(open: BillRefunding, result: BillRefundResult): Promise<void> {
    if (this.#billRefundingNow(open.id) === null) return;
    this.#closeBillRefunding();
    if (this.activeTabId === open.billId) this.billBalance = result.balance;
    // Whatever closes the payment dialog closes the refund dialog over it (#closeBillPaying).
    const paying = this.#billPayingNow(open.payId)!;
    this.billPaying = {
      ...paying,
      balance: result.balance,
      taken: null,
      refunded: {
        state: result.refund.state,
        amount: toScale(
          addDecimal(decimal(result.refund.appliedAmount), decimal(result.refund.tipAmount)),
          MONEY_SCALE,
        ),
        method: open.payment.method,
        terminal: open.asked!.manualConfirmed === true,
      },
    };
    await this.#rereadPayingOrder(open);
  }

  /**
   * A refusal of the approver's PIN shows in the PIN prompt; one naming a field goes under it, and
   * any other beside the refund's action. The bill is read again after every refusal. A refusal
   * after the operator has logged out changes nothing.
   */
  async #onRefundRefused(open: BillRefunding, error: unknown): Promise<void> {
    const now = this.#billRefundingNow(open.id);
    if (now === null) return;
    const refused = error as { code?: unknown; field?: unknown };
    const code = typeof refused.code === "string" ? refused.code : "server.internal";
    if (APPROVER_REFUSALS.has(code)) {
      this.refundApproverError = code;
      this.billRefunding = { ...now, busy: false };
    } else {
      this.#closeRefundApprovers();
      if (isNetworkFailure(error)) {
        this.billRefunding = { ...now, refusal: { code: "network" }, busy: false };
      } else {
        this.billRefunding = {
          ...now,
          refusal: {
            code,
            ...(typeof refused.field === "string" ? { field: refused.field } : {}),
          },
          busy: false,
        };
      }
    }
    await this.#rereadBillPaying(open.payId, open.billId);
    await this.#rereadPayingOrder(open);
  }

  /**
   * Refuses a screen outside {@link HANDHELD_FACES} for a handheld. Only the no-shell arm of
   * {@link #onBackToCounter} calls it: inside the shell a handheld has no counter tab, and
   * {@link #pushDrill} refuses its station, expo and schedule drill-ins because
   * {@link #affordances} gives it none. The no-shell arms of the other counter-side handlers call
   * {@link #setScreen} unchecked.
   */
  #goToScreen(target: Screen): void {
    if (this.handheldMode && !HANDHELD_FACES.includes(target)) return;
    this.#setScreen(target);
  }

  /** Every face change goes through here, so the diagnostics trail records it. */
  #setScreen(screen: Screen): void {
    diag.record("info", "nav", { screen });
    this.screen = screen;
  }

  /**
   * The else-arms that set `screen` are also reached by an async handler whose answer arrives after
   * logout, and setting `screen` there takes the till off the lock screen, which is why
   * {@link #showTicket} and {@link #onOpenTable} check for `lock` first. {@link #onShowFloor} does
   * not (docs/backlog.md, "Till code that no test can reach").
   */
  #inShell(): boolean {
    return this.canvas !== undefined && this.#shellActive();
  }

  /** Records the same `nav` trail as {@link #setScreen}. */
  #pushDrill(drill: Drill): void {
    if (isTillDestination(drill.kind)) {
      if (!this.#allowsDestination(drill.kind)) return;
      this.#url.write({ "till-view": drill.kind, "till-station": null });
    }
    diag.record("info", "nav", { screen: drill.kind });
    this.drill = drill;
  }

  /** Records the `nav` trail for the tab it returns to. */
  #popDrill(): void {
    if (isTillDestination(this.drill?.kind))
      this.#url.write({ "till-view": null, "till-station": null });
    diag.record("info", "nav", { screen: this.activeTabKey });
    this.drill = undefined;
  }

  #showTicket(workingOrderId: string, invoiceIssuedNow = true): void {
    this.ticketWorkingOrderId = workingOrderId;
    this.originalReceiptAvailable = invoiceIssuedNow && this.receiptPrintMode !== "auto";
    if (this.#inShell()) this.#pushDrill({ kind: "ticket" });
    // A late answer must not unlock a logged-out till.
    else if (this.screen !== "lock") this.#setScreen("ticket");
  }

  /** A handheld's canvas has no counter tab, so inside the shell it shows its first tab instead. */
  #onBackToCounter(): void {
    this.errorKey = undefined;
    if (this.#inShell()) {
      this.#setActiveTab("counter");
      this.#popDrill();
    } else {
      this.#goToScreen("counter");
    }
  }

  /**
   * Inside the shell only a till reaches this: a handheld's order tab is `embedded` and emits no
   * `back-to-floor`.
   */
  #onBackToFloor(): void {
    this.#orderVisit++;
    this.cancelOffer = null;
    const session = this.#operatorSession;
    const flushed = this.#flushDraft();
    if (this.#inShell()) {
      this.#clearErrorKeepingLateChange();
      this.#popDrill();
      void flushed.then(() =>
        session !== this.#operatorSession ? undefined : this.#refreshFloor(),
      );
    } else {
      void flushed.then(() => this.#onShowFloor());
    }
  }

  /** Keeps the basket: it belongs to the till. */
  async #onLogout(): Promise<void> {
    // Lock locally first: a rejecting or hanging `api.logout()` (offline, failover) must never leave
    // the till unlocked. The server logout is best-effort.
    this.operatorName = "";
    this.canEdit = false;
    this.#orderVisit++;
    this.#endOperatorSession();
    // `screen = "lock"` resets neither the drill nor the tab.
    this.drill = undefined;
    this.#setActiveTab(this.canvas?.tabs[0]?.key, true);
    this.#url.write({ "till-zone": null }, true);
    this.#floorLoaded = false;
    this.errorKey = undefined;
    this.#abandonListRefreshes();
    this.#setScreen("lock");
    this.#configureSessionActivity();
    // The server takes the person from the session, so the draft is saved before the session ends.
    const signIns = this.#signIns;
    const sync = this.#draftSync;
    if (sync !== undefined) {
      this.#draftSync = undefined;
      this.#draftReady = false;
      await sync.close();
      sync.drop();
    }
    if (signIns !== this.#signIns) return;
    try {
      await this.api.logout();
    } catch {
      // The device is already locked locally.
    }
    // After the round trip, so guarded: a detached till must not change a live sibling's module-global
    // locale.
    if (!this.isConnected) return;
    setLocale(this.#venueLocale);
  }

  /**
   * Before login, or on a kitchen display, a pick only switches the UI: there is no session to save it
   * to. Logged in, the preference is saved first and the UI switches only after that succeeds.
   */
  async #onLocaleSelected(event: CustomEvent<{ code: string }>): Promise<void> {
    const { code } = event.detail;
    if (this.screen === "lock" || this.deviceMode) {
      setLocale(code);
      return;
    }
    this.errorKey = undefined;
    try {
      await this.api.putLocale(code);
      // The preference is saved; a detached till skips only the local repaint.
      if (!this.isConnected) return;
      setLocale(code);
    } catch {
      this.errorKey = "locale.save_failed";
    }
  }

  /** The front-door screens are handled ahead of this in {@link render}, and guarded here too so the
   * predicate does not depend on render order. */
  #shellActive(): boolean {
    return this.screen !== "lock" && this.frontDoor === undefined;
  }

  /** Falls back to the first tab, so a stale key never leaves the shell without a body. */
  #activeTab(): TabDef | undefined {
    return this.canvas?.tabs.find((tab) => tab.key === this.activeTabKey) ?? this.canvas?.tabs[0];
  }

  #tableOrderTabKey(): string | undefined {
    return this.canvas?.tabs.find((tab) => tab.cards.some((card) => card.type === "table-order"))
      ?.key;
  }

  /**
   * Station, Expo and Schedule surfaces not authored as tabs, offered as buttons. A handheld gets none:
   * it cannot open any of them.
   */
  #affordances(): ShellAffordance[] {
    if (this.handheldMode) return [];
    const tabKeys = new Set(this.canvas?.tabs.map((tab) => tab.key) ?? []);
    return (["station", "expo", "schedule"] as ShellAffordance[]).filter((a) => !tabKeys.has(a));
  }

  #counterOrderInFlight(): boolean {
    return this.submitting || this.placing || this.parking;
  }

  /** A placed order is not open, so it offers no adjustment. */
  #basketStoredLines(): StoredLines | null {
    return this.stage === "order" ? this.counterLines : null;
  }

  #tabBody(tab: TabDef): TemplateResult {
    if (tab.key === "counter") {
      // `embedded`: the shell owns the header.
      return html`<till-counter-screen
        embedded
        .api=${this.api}
        .store=${this.#store}
        .products=${this.products}
        .menus=${this.menus}
        .selectedMenuId=${this.selectedCatalogueId}
        .serviceZones=${this.counterServiceZones}
        .selectedServiceZoneId=${this.counterServiceZoneId}
        .selectedDiet=${this.selectedDiet}
        .heldOrders=${this.heldOrders}
        .tables=${this.tables}
        .stationQueue=${this.stationQueue}
        .defaultStationId=${this.#defaultStationId()}
        .operatorName=${this.operatorName}
        .invoiceLocale=${this.invoiceLocale}
        .orderFlow=${this.orderFlow}
        .stage=${this.stage}
        .busy=${this.submitting || this.placing}
        .payHeld=${this.#payHeld()}
        .payRest=${this.#basketPaidInPart()?.outstanding ?? null}
        .counterTab=${tab}
        .cardProvider=${this.cardProvider}
        .tipsEnabled=${this.tipsEnabled}
        .cardOutcome=${this.cardOutcome}
        .activeReaders=${this.activeReaders}
        .defaultReaderId=${this.defaultReaderId}
        .handheld=${this.handheldMode}
        .storedLines=${this.#basketStoredLines()}
        .orderInFlight=${this.#counterOrderInFlight()}
      ></till-counter-screen>`;
    }
    const tableTab = tab.key === this.#tableOrderTabKey();
    const draft = tableTab ? this.#tableDraft() : undefined;
    return html`<till-card-grid
      .tab=${tab}
      .store=${this.#store}
      .storedLines=${this.#basketStoredLines()}
      .orderInFlight=${this.#counterOrderInFlight()}
      .capabilities=${this.capabilities}
      .canConfigureTill=${this.canEdit}
      .products=${tableTab ? this.tableProducts : this.products}
      .heldOrders=${this.heldOrders}
      .stationQueue=${this.stationQueue}
      .defaultStationId=${this.#defaultStationId()}
      .busy=${this.submitting}
      .payHeld=${this.#payHeld()}
      .payRest=${this.#basketPaidInPart()?.outstanding ?? null}
      .orderFlow=${this.orderFlow}
      .stage=${this.stage}
      .cardProvider=${this.cardProvider}
      .tipsEnabled=${this.tipsEnabled}
      .cardOutcome=${this.cardOutcome}
      .activeReaders=${this.activeReaders}
      .defaultReaderId=${this.defaultReaderId}
      .api=${this.api}
      .fireControl=${this.fireControl}
      .zones=${this.zones}
      .tables=${this.tables}
      .bumpMode=${this.bumpMode}
      .deviceMode=${this.deviceMode}
      .initialDeviceStation=${this.initialDeviceStation}
      .menus=${tableTab ? this.tableMenus : this.menus}
      .selectedMenuId=${tableTab ? this.tableSelectedCatalogueId : this.selectedCatalogueId}
      .selectedDiet=${this.selectedDiet}
      .statuses=${this.statuses}
      .courses=${this.courses}
      .tabLines=${this.tabLines}
      .tabGroups=${this.tabGroups}
      .currentOrders=${this.currentOrders}
      .currentOrdersUnread=${this.currentOrdersUnread}
      .printProblems=${this.printProblems}
      .reprintSent=${this.reprintSent}
      .tabRevision=${this.tabRevision}
      .editSentLines=${this.editSentLines}
      .cancelOffer=${this.cancelOffer}
      .orderId=${this.activeTabId}
      .draftStore=${draft}
      .otherDrafts=${draft === undefined ? [] : this.#otherDrafts(draft)}
      .takeOversAnswered=${this.takeOversAnswered}
      .party=${this.orderParty}
      .partyBills=${this.partyBills}
      .billBalance=${this.billBalance}
      .finishRefused=${this.finishRefused}
      .nameRefusal=${this.nameRefusal}
      .groupCommandBusy=${this.groupCommandBusy}
      .handheld=${this.handheldMode}
      .canOpenStation=${this.#allowsDestination("station")}
    ></till-card-grid>`;
  }

  #activeTabBody(): TemplateResult | typeof nothing {
    const tab = this.#activeTab();
    return tab !== undefined ? this.#tabBody(tab) : nothing;
  }

  /** Drill-ins mount non-embedded, so each keeps its own Back or Close; an `embedded` mount would trap
   * the user with no way out. */
  #drillBody(): TemplateResult | typeof nothing {
    switch (this.drill?.kind) {
      case "table-order": {
        const draft = this.#tableDraft();
        return html`<till-table-order-screen
          slot="drill"
          .lines=${this.tabLines}
          .groups=${this.tabGroups}
          .currentOrders=${this.currentOrders}
          .currentOrdersUnread=${this.currentOrdersUnread}
          .printProblems=${this.printProblems}
          .reprintSent=${this.reprintSent}
          .revision=${this.tabRevision}
          .editSentLines=${this.editSentLines}
          .cancelOffer=${this.cancelOffer}
          .products=${this.tableProducts}
          .menus=${this.tableMenus}
          .selectedMenuId=${this.tableSelectedCatalogueId}
          .selectedDiet=${this.selectedDiet}
          .statuses=${this.statuses}
          .courses=${this.courses}
          .fireControl=${this.fireControl}
          .tables=${this.tables}
          .orderId=${this.activeTabId}
          .draftStore=${draft}
          .otherDrafts=${this.#otherDrafts(draft)}
          .takeOversAnswered=${this.takeOversAnswered}
          .party=${this.orderParty}
          .bills=${this.partyBills}
          .billBalance=${this.billBalance}
          .finishRefused=${this.finishRefused}
          .nameRefusal=${this.nameRefusal}
          .busy=${this.submitting}
          .groupCommandBusy=${this.groupCommandBusy}
          .handheld=${this.handheldMode}
        ></till-table-order-screen>`;
      }
      case "ticket":
        return html`<till-ticket-view
          slot="drill"
          .result=${this.result}
          .issuer=${this.issuer}
          .invoiceLocale=${this.invoiceLocale}
          .receipt=${this.receipt}
          .originalReceiptAvailable=${this.originalReceiptAvailable}
          .canPrintReceipt=${
            this.deviceId === undefined || this.capabilities.includes("print-receipt")
          }
          .canOpenDrawer=${!this.handheldMode}
          .simulated=${this.onboardingIntent === "demo" || this.onboardingIntent === "prepare"}
        ></till-ticket-view>`;
      case "schedule":
        return html`<till-schedule-screen
          slot="drill"
          .api=${this.api}
          .staff=${this.staff}
          .operatorPersonId=${this.operatorPersonId}
        ></till-schedule-screen>`;
      case "station":
        return html`<till-station-screen
          slot="drill"
          .api=${this.api}
          .bumpMode=${this.bumpMode}
          .fireControl=${this.fireControl}
          .deviceMode=${this.deviceMode}
          .initialDeviceStation=${this.initialDeviceStation}
        ></till-station-screen>`;
      case "expo":
        return html`<till-expo-screen
          slot="drill"
          .api=${this.api}
          .fireControl=${this.fireControl}
        ></till-expo-screen>`;
      case "allergens":
        return html`<till-allergen-screen
          slot="drill"
          .products=${this.products}
          .locale=${currentLocale()}
          .invoiceLocale=${this.invoiceLocale}
        ></till-allergen-screen>`;
      case undefined:
        return nothing;
    }
  }

  override render() {
    return html`
      <div
        class="app"
        @logged-in=${(event: Event) => void this.#onLoggedIn(event)}
        @confirm-payment=${(event: Event) => void this.#onConfirmPayment(event)}
        @collect-card=${(event: Event) => void this.#onCollectCard(event)}
        @place-order=${() => void this.#onPlaceOrder()}
        @collect-order=${(event: Event) => void this.#onCollectOrder(event)}
        @advance-ticket-item=${(event: Event) => void this.#onAdvanceTicketItem(event)}
        @mark-collected=${(event: Event) => void this.#onMarkCollected(event)}
        @show-station=${(event: Event) => this.#onShowStation(event)}
        @enrolled=${() => void this.#onEnrolled()}
        @switch-device=${() => void this.#onSwitchDevice()}
        @device-unauthorized=${() => void this.#onDeviceUnauthorized()}
        @show-expo=${() => this.#onShowExpo()}
        @park-order=${(event: Event) => void this.#onParkOrder(event)}
        @retrieve-order=${(event: Event) => void this.#onRetrieveOrder(event)}
        @discard-order=${(event: Event) => void this.#onDiscardOrder(event)}
        @new-sale=${() => this.#onNewSale()}
        @reprint=${() => void this.#onReprint()}
        @print-receipt=${() => void this.#onPrintReceipt()}
        @payment-slip=${() => void this.#onPaymentSlip()}
        @open-drawer=${() => void this.#onOpenDrawer()}
        @override-confirm=${(event: Event) => void this.#onOverrideConfirm(event)}
        @override-cancel=${() => this.#closeOverrideDialog()}
        @show-schedule=${() => this.#onShowSchedule()}
        @show-floor=${() => void this.#onShowFloor()}
        @floor-refresh=${() => void this.#refreshFloor()}
        @open-table=${(event: Event) => void this.#onOpenTable(event)}
        @submit-draft=${(event: Event) => void this.#onSubmitDraft(event)}
        @take-over-draft=${(event: Event) => void this.#onTakeOverDraft(event)}
        @fire-group=${(event: Event) => void this.#onFireGroup(event)}
        @reorder-groups=${(event: Event) => void this.#onReorderGroups(event)}
        @move-group-line=${(event: Event) => void this.#onMoveGroupLine(event)}
        @split-group-line=${(event: Event) => void this.#onSplitGroupLine(event)}
        @serve-lines=${(event: Event) => void this.#onServeLines(event)}
        @unserve-lines=${(event: Event) => void this.#onUnserveLines(event)}
        @serve-group=${(event: Event) => void this.#onServeGroup(event)}
        @snooze-group=${(event: Event) => void this.#onSnoozeGroup(event)}
        @unsnooze-group=${(event: Event) => void this.#onUnsnoozeGroup(event)}
        @set-line-course=${(event: Event) => void this.#onSetLineCourse(event)}
        @send-lines=${(event: Event) => void this.#onSendLines(event)}
        @recall-lines=${(event: Event) => void this.#onRecallLines(event)}
        @adjust=${(event: Event) => void this.#onAdjust(event)}
        @change-line=${(event: Event) => void this.#onChangeLine(event)}
        @cancel-offer-taken=${() => (this.cancelOffer = null)}
        @set-status=${(event: Event) => void this.#onSetStatus(event)}
        @move-guests=${(event: Event) => void this.#onMoveGuests(event)}
        @move-bill=${(event: Event) => void this.#onMoveBill(event)}
        @move-held-order-open=${() => void this.#refreshFloor()}
        @move-held-order=${(event: Event) => void this.#onMoveHeldOrder(event)}
        @join-tables=${(event: Event) => void this.#onJoinTables(event)}
        @split-table=${(event: Event) => void this.#onSplitTable(event)}
        @name-party=${(event: Event) => void this.#onNameParty(event)}
        @merge-bills=${(event: Event) => void this.#onMergeBills(event)}
        @transfer-lines=${(event: Event) => void this.#onTransferLines(event)}
        @split-lines=${(event: Event) => void this.#onSplitLines(event)}
        @finish-table=${() => void this.#onFinishTable()}
        @request-bill=${(event: Event) => void this.#onRequestBill(event)}
        @take-payment=${(event: Event) => void this.#onTakePayment(event)}
        @reprint-bill=${(event: Event) => void this.#onReprintBill(event)}
        @reprint-kitchen-tickets=${(event: Event) => void this.#onReprintKitchenTickets(event)}
        @mark-cleared=${(event: Event) => void this.#onMarkCleared(event)}
        @pay-tab=${(event: Event) => void this.#onPayTab(event)}
        @bill-pay=${(event: Event) => void this.#onBillPay(event)}
        @refund-excess=${(event: Event) => void this.#onRefundExcess(event)}
        @counter-bill-pay=${(event: Event) => void this.#onCounterBillPay(event)}
        @back-to-floor=${() => this.#onBackToFloor()}
        @back-to-counter=${() => this.#onBackToCounter()}
        @open-allergens=${() => this.#onOpenAllergens()}
        @close-allergens=${() => this.#onCloseAllergens()}
        @logout=${() => void this.#onLogout()}
        @locale-selected=${(e: CustomEvent<{ code: string }>) => void this.#onLocaleSelected(e)}
        @diet-filter-selected=${(e: CustomEvent<{ predicate: DietPredicate | null }>) =>
          this.#selectDiet(e.detail.predicate)}
        @counter-zone-selected=${(event: Event) => void this.#onCounterZoneSelected(event)}
        @menu-selected=${(e: CustomEvent<{ id: string }>) => this.#onMenuSelected(e)}
      >
        ${
          this.onboardingIntent === undefined
            ? nothing
            : html`<p class="mode-indicator" data-test="mode-indicator">
                ${t(`mode.${this.onboardingIntent}`)}
              </p>`
        }
        ${
          this.errorKey
            ? html`<p class="error" role="alert">${errorText(this.errorKey)}</p>`
            : nothing
        }
        <wt-toast
          class="submitted-toast"
          data-submitted-toast
          tone="info"
          .open=${this.submittedNotice !== null}
          .message=${this.submittedNotice ?? ""}
          close-label=${t("table.submitted_close")}
          @wt-close=${() => (this.submittedNotice = null)}
        ></wt-toast>
        ${this.#renderRefreshNotice("held")} ${this.#renderRefreshNotice("station")}
        <!-- The waiting-for-promotion banner. On the shell surface (an operator
             mid-shift), the lock-screen's own status line is not visible, so the shell surfaces the same
             server.waiting_promotion copy compactly here while the router reports no server is accepting
             sales. Gated on the shell surface so it never double-renders beside the lock screen's own line. -->
        ${
          this.#inShell() && (this.router?.waiting ?? false)
            ? html`<p class="banner" role="status">${t("server.waiting_promotion")}</p>`
            : nothing
        }
        <!-- The reusable supervisor-override dialog (cash-drawer-authorization §5), present only while an
             override is in flight. It takes the eligible authorizers + the retry error as PROPS and emits
             override-confirm/override-cancel (wired on the app wrapper above) — the app owns the request. -->
        ${
          this.overrideAuthorizers !== undefined
            ? html`<till-supervisor-override-dialog
                .authorizers=${this.overrideAuthorizers}
                .error=${this.overrideError}
              ></till-supervisor-override-dialog>`
            : nothing
        }
        ${this.#renderAdjusting()} ${this.#renderBillPaying()}
        ${
          this.basketRefresh === undefined
            ? nothing
            : html`<till-basket-refresh-dialog
                .changed=${this.basketRefresh.changed}
                .blocked=${this.basketRefresh.blocked}
                .purpose=${this.basketRefresh.store === this.#store ? "pay" : "send"}
                @wt-basket-refresh-confirmed=${() => this.#onBasketRefreshConfirmed()}
                @wt-basket-refresh-cancelled=${() => (this.basketRefresh = undefined)}
              ></till-basket-refresh-dialog>`
        }
        ${
          this.#inShell() && this.basketStale && this.basketRefresh === undefined
            ? html`<div class="refresh-notice" data-active>
                <p class="refresh-message" role="status">${t("basket_refresh.pending")}</p>
                <wt-button
                  variant="secondary"
                  data-menu-review
                  @click=${() => void this.#refreshBasket()}
                  >${t("basket_refresh.review")}</wt-button
                >
              </div>`
            : nothing
        }
        ${this.#inShell() && this.removedLayouts.length > 0 ? this.#removedLayoutNotice() : nothing}
        <!-- The device FRONT DOOR (device-enrolment §3.1), shown ahead of the shell/lock so it takes
             precedence over whatever screen the boot left set. The chooser is the dev-only device picker
             (its enrolled event is handled INSIDE the chooser — a dev-tab adopt, not the app's re-boot);
             the enrol screen is the join screen a fresh production browser shows, whose enrolled event
             (wired above) re-boots into the matching shell. -->
        ${
          this.frontDoor === "chooser"
            ? html`<till-device-chooser
                .api=${this.api}
                .list=${this.devDevices}
              ></till-device-chooser>`
            : this.frontDoor === "enrol"
              ? html`<till-enrol-screen .api=${this.api}></till-enrol-screen>`
              : // Keyed on the locale, so a switch rebuilds the subtree in the new language; the
                // screens hold no locale controller of their own. The lock screen also shows after a
                // boot failure, rather than an empty shell.
                this.#inShell()
                ? keyed(
                    currentLocale(),
                    html`<till-tab-shell
                      .tabs=${this.canvas?.tabs ?? []}
                      .activeTabKey=${this.activeTabKey}
                      .operatorName=${this.operatorName}
                      .affordances=${this.#affordanceList}
                      .kiosk=${this.deviceMode}
                      .loadLocales=${this.#loadLocales}
                      @tab-select=${(e: CustomEvent<{ key: string }>) => {
                        this.#onTabSelect(e.detail.key);
                      }}
                    >
                      ${this.#activeTabBody()}
                      ${this.#drillBody() /* the drill overlay, when one is open */}
                    </till-tab-shell>`,
                  )
                : keyed(
                    currentLocale(),
                    html`<till-lock-screen
                      .api=${this.api}
                      .deviceName=${this.deviceName}
                      .deviceId=${this.deviceId}
                      .devMode=${this.devTab}
                      .serverStatuses=${this.router?.statuses() ?? []}
                      .serverCurrent=${this.router?.current ?? ""}
                      .serverWaiting=${this.router?.waiting ?? false}
                      @check-again=${() => void this.router?.probeNow()}
                    ></till-lock-screen>`,
                  )
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-app": TillApp;
  }
}
