import type { RecipientIdentifierType } from "@waitron/country";
import type { OptionSnapshot, ReceiptPresentation, ReceiptElement, Dining } from "@waitron/shared";
import type { StaffMember } from "./device-session-api.js";
import type { InvoiceEvidence } from "./invoice-evidence.js";
import type {
  ItemPaymentAsk,
  ItemPaymentPreview,
  ItemPaymentRequest,
  ItemPaymentResult,
} from "./item-payment-types.js";
import { KitchenApi } from "./kitchen-api.js";
import type { BillEditExpected } from "./order-types.js";
import type { TillRequest, ReadOptions } from "./till-request.js";

/** One VAT band on a ticket: a rate and its taxable base + tax, as decimal strings. */
export interface VatBreakdownEntry {
  rate: string;
  base: string;
  tax: string;
}
type ApproverRight = "adjustment.approve" | "sale.refund" | "sale.rectify" | "node.manage";
/** The party a bill belongs to, at its revision after a void or line edit on the bill; null for a
 * bill with no party. */
export type BillParty = { id: string; revision: number } | null;

export type AdjustmentAction = "cancel" | "comp" | "discount_percent" | "discount_amount";
/** A person's role, lowest first. */
export type PersonRole = "staff" | "supervisor" | "manager" | "admin";
/** One reason from `GET /api/adjustment-reasons`, named in the operator's language. */
export interface AdjustmentReason {
  id: string;
  name: string;
  kind: "void" | "comp";
  /** The actions the reason may be used for. */
  actions: AdjustmentAction[];
  noteRequired: boolean;
  maxPercentBp: number | null;
  maxAmount: string | null;
  startsFinishTable?: boolean;
}

export type AdjustmentApproval =
  | {
      by: "limit";
      permission: "adjustment.approve";
      limit: { kind: "reason" | "bill"; amount: string | null; percentBp: number | null };
    }
  | { by: "refund"; permission: "sale.refund" };
/** An adjustment of one bill, as a preview and an apply share it. `lineId` names the dish or the
 * extra; null is a discount on the whole bill. `quantity` absent covers the whole line; an extra is
 * taken only whole. */
export interface AdjustmentAsk {
  expectedEdit: BillEditExpected | null;
  /** The bill's revision as the till last read it. */
  expectedRevision: number;
  lineId: string | null;
  /** Every portion line of a row the till shows as one, or that row's lines of one extra product
   * (plan D31, D34); `lineId` among them. */
  lineIds?: string[];
  reasonId: string;
  action: AdjustmentAction;
  quantity?: string;
  percentBp?: number;
  /** A money string, such as "2.50". */
  amount?: string;
  note: string | null;
}
/** An adjustment to apply: made once per person's confirmation, and sent again unchanged only when
 * a request got no answer. `approver` is someone the preview's `needsApproval` admits. */
export interface AdjustmentCommand extends AdjustmentAsk {
  submissionId: string;
  approver?: { personId: string; pin: string };
}
/** What an adjustment would do, read before it is confirmed. `reduction` is what the bill actually
 * loses, which can differ from the discount asked for when a line cannot take its share in whole
 * cents per unit. */
export interface AdjustmentPreview {
  reduction: string;
  nominalValue: string;
  /** Whose PIN it needs, or null when the operator may apply it alone. */
  needsApproval: AdjustmentApproval | null;
  /** The bill's total now and once applied: a set menu worked out again can make the change
   * differ from `reduction`. */
  billTotal: { before: string; after: string };
  lines: {
    lineId: string;
    lineNo: number;
    reduction: string;
    rows: { quantity: string; unitGross: string }[];
  }[];
}
/** A cash tender: the full amount the operator keyed in (the server computes the change). */
export interface CashTender {
  method: "cash";
  amount: string;
}
/**
 * A manual card tender, charged on the standalone bank terminal. `amount` is the sale total (never
 * over-tendered, so no change); `externalRef` is the terminal's optional operation number.
 */
export interface OutsideCardDetails {
  externalProvider?: "connected_account" | "other";
  externalMachine?: string;
}

export interface CardTender extends OutsideCardDetails {
  method: "card";
  amount: string;
  addedTip?: string;
  externalRef?: string;
}
/** A cash or hand-keyed card tender. */
export type Tender = CashTender | CardTender;
/**
 * One line of the FILED composition the receipt identifies (RD 1619/2012 art. 7.1.e): `descriptions`
 * in the invoice locale, the display `quantity`, and the GROSS line total. The receipt renders THESE,
 * never the client basket, so the printed line list cannot diverge from the invoice.
 */
export interface TillSaleLine {
  /** F1 figures read from the filed sale line; unitPrice is per priceQuantity, base is the line total. */
  net?: { unitPrice: string; priceQuantity: string; base: string; rate: string; tax?: string };
  /** The dish's frozen answers to its options lists; absent on a line that answered none and on
   *  every child line. The six names per answer are the server's, copied by value. */
  optionSnapshots?: OptionSnapshot[];
  descriptions: Record<string, string>;
  /** Unit values frozen with the filed line; null for a modifier child. */
  unitName?: Record<string, string> | null;
  unitPrecision?: number | null;
  /** Presentation marker derived from the working line's stored unit identity. */
  soldInEach?: true;
  quantity: string;
  gross: string;
  /** The line's total before a comp or a discount changed it; present only when that differs from
   *  `gross`. */
  listGross?: string;
  /** The comps and discounts shown beneath this row's dish; absent when there are none. */
  adjustments?: ReceiptAdjustment[];
  /** The `lineNo` of this row's PARENT dish when it is a CHILD modifier line, else null/absent.
   *  Presentation only — never hashed, never a fiscal figure. */
  parentLineNo?: number | null;
  /** On a line taking an advance off this invoice: the advance's number and its issue day
   *  (`YYYY-MM-DD`, the venue's zone). */
  advance?: { invoiceNumber: string; issuedOn: string };
}
/** An amount a comp or a discount took off; `amount` is positive, as a decimal string. */
export interface ReceiptAdjustment {
  /** `comp`: a full comp, printed as the discount word with 100%. */
  kind: "comp" | "discount";
  percentBp?: number;
  amount: string;
}
/**
 * How a filed sale was paid, read back from the committed rows: `unpaid` is an invoice issued before
 * collection, `deferred` a bill closed as a deferred payment, `cash` carries the change, and
 * `card` the whole charge (`charged` = total + tip), the `tip` ("0.00" when none) and the operator
 * `reference` (null for an integrated capture).
 */
export type TenderBlock =
  | { method: "unpaid" }
  | { method: "deferred" }
  | { method: "cash"; change: string }
  | {
      method: "card";
      charged: string;
      tip: string;
      reference: string | null;
      externalProvider?: "connected_account" | "other";
      externalMachine?: string;
    };
/** The table's ticket that took a part payment off. */
export interface TakenOffBy {
  saleId: string;
  invoiceNumber: string;
}
/** A part payment's own ticket, as printed: its local issue day is `YYYY-MM-DD`. */
export interface AdvanceTicket {
  invoiceNumber: string;
  issuedOn: string;
  total: string;
  vatBreakdown: VatBreakdownEntry[];
}
/** A ticket as the ticket view reads it. */
export interface TransactionReceipt extends TillSaleResult {
  /** On a part payment's ticket, the table's ticket that took it off; absent on any other ticket
   * and on a corrective. Shown on screen only. */
  takenOffBy?: TakenOffBy;
}
/** The recorded ticket carried by payment answers and receipt reads. */
export interface TillSaleResult extends ReceiptPresentation {
  slipPaymentId?: string;
  slipPrintFailed?: true;
  receiptPreview?: readonly ReceiptElement[];
  simulatedCardPayment?: boolean;
  invoiceEvidence?: InvoiceEvidence;
  issuedOffsetMinutes?: number;
  invoiceType?: "F1" | "F2" | "R4" | "R5";
  /** The day of the sale (`YYYY-MM-DD`) when it is not its issue day: an F1/F2 issued on a later day, or a replacement corrective. */
  saleDay?: string;
  /** On a corrective invoice (R4, R5), the invoice it corrects; `inFull` when it replaces it whole. */
  corrects?: {
    invoiceNumber: string;
    issuedAt: string;
    issuedOffsetMinutes?: number;
    inFull?: true;
  };
  recipient?: {
    taxId: string;
    legalName: string;
    countryCode: string;
    address: string;
    identifierType?: RecipientIdentifierType;
    identifierCountryCode?: string;
  };
  /** Issuer identity stored with the filed invoice; immediate issuance responses may omit it. */
  issuer?: { venueName: string; nif: string; domicile?: string };
  receiptHeader?: { tradingName: string; printTradingName: boolean };
  /** The table/operator label and venue order number printed on every document as its grouping key. */
  orderLabel: string | null;
  orderNumber: number;
  /** The order was taken away; absent when it was eaten here. */
  takeAway?: true;
  invoiceNumber: string;
  issuedAt: string;
  total: string;
  vatBreakdown: VatBreakdownEntry[];
  /** The filed line list. */
  lines: TillSaleLine[];
  /** Discounts on the whole bill, shown after the goods; absent when there are none. */
  billAdjustments?: ReceiptAdjustment[];
  /** The FIRST payment only when the bill was paid in parts; `payments` then lists them all. */
  tender: TenderBlock;
  /** Every bill payment the sale was paid with, or, while it is unpaid, received so far. */
  payments?: BillTenderLine[];
  qr: string;
  /** The fiscal backend's words around the QR; present only beside a non-empty `qr`. */
  qrText?: { caption: string; legend: string };
  /** The language the sale was filed in. */
  locale?: string;
  /** The language the dish names are looked up by; absent reads as {@link locale}. */
  namesLocale?: string;
}
/**
 * One payment of a bill paid in parts, as the invoice lists it. `change` is what the payment handed
 * back when it was taken. A card's `amount` is its charge less what was refunded of it.
 */
export type BillTenderLine = (
  | { method: "cash"; amount: string; tip: string; tendered: string; change: string }
  | ({ method: "card"; amount: string; tip: string; reference: string | null } & OutsideCardDetails)
) & { refunds: BillTenderRefund[] };
/** A completed refund of a bill payment before its invoice, oldest first. */
export interface BillTenderRefund {
  amount: string;
  tip: string;
}
/** What a bill payment asks for, before the operator has seen its allocation. */
export interface BillPaymentAsk {
  expectedEdit: BillEditExpected | null;
  dining?: Dining;
  kind: "contribution" | "share";
  /** `contribution` only. */
  amount?: string;
  /** `share` only: how many people are still to pay. The server works out the share. */
  shareOf?: number;
  method: "cash" | "card";
  /** Cash only: the money handed over. */
  tendered?: string;
  /** Cash: the part of the change left as a tip. Card: what is charged above what is due. */
  addedTip?: string;
}
/**
 * A bill payment as taken: the ask, the `applied` and `tip` the operator was shown, and its retry
 * key. A card is `manual` (charged on a terminal the till does not drive, with its optional operation
 * number) or `reader`.
 */
export interface BillPaymentRequest extends BillPaymentAsk, OutsideCardDetails {
  submissionId: string;
  applied: string;
  tip: string;
  entry?: "manual" | "reader";
  externalRef?: string;
  readerId?: string;
  /** The practice simulator only. */
  simulationOutcome?: "captured" | "declined" | "attempting";
  guestCount?: number | null;
  receiptLanguage?: string;
  /** The payer wants their own receipt for this amount. */
  ownReceipt?: true;
}
/** How one payment splits between the bill, change and tip. */
export interface AllocationPreview {
  kind: "allocated";
  applied: string;
  tip: string;
  /** Cash only. */
  change: string | null;
  /** Card only: what the card is charged. */
  charged: string | null;
  /** Pay for items only: the chosen items' price. */
  total?: string;
}

export interface BillRefundView {
  refusalReason?: "provider_balance_unavailable";
  id: string;
  paymentId: string;
  submissionId: string;
  appliedAmount: string;
  tipAmount: string;
  reason: string;
  state: "pending" | "completed" | "failed";
  createdAt: string;
  completedAt: string | null;
}

export interface BillPaymentView extends OutsideCardDetails {
  externalRef?: string;
  /** It paid an advance, whose own ticket is the sale `saleId`; `left` and `tipLeft` are what
   * that ticket's corrections have not given back. */
  hasTicket?: true;
  saleId?: string;
  ticket?: AdvanceTicket;
  /** The bill's invoice that took the advance off, once issued; never a corrective of it. */
  takenOffBy?: TakenOffBy;
  left?: string;
  tipLeft?: string;
  /** What plain refunds, no leg of a correction, gave back from the advance's ticket; `left`
   * still counts it. */
  givenBack?: string;
  id: string;
  submissionId: string;
  kind: "contribution" | "share";
  shareOf: number | null;
  method: "cash" | "card";
  /** A card's: keyed on a separate terminal (`manual`), or taken at a reader; null for cash. */
  entry: "manual" | "reader" | null;
  applied: string;
  tip: string;
  tendered: string | null;
  /** Cash only: handed back when the payment was taken. */
  change: string | null;
  state: "pending" | "received" | "failed" | "declined";
  createdAt: string;
  receivedAt: string | null;
  refunds: BillRefundView[];
}

export interface BillUnsent {
  billId: string;
}

export interface CaptureWarning {
  requestedAmount: string;
  reportedAmount: string;
}

export interface BillBalance {
  captureWarning?: CaptureWarning;
  workingOrderId: string;
  status: "open" | "placed" | "settled" | "abandoned";
  total: string;
  /** The net applied of the received payments; on a settled bill, less the completed refunds of
   * filed corrections on its payments that paid no advance. */
  received: string;
  /** The applied amount of the pending payments. */
  reserved: string;
  /** The total less received and reserved; zero once the bill is settled or abandoned. */
  outstanding: string;
  /** On an open or placed bill, what received and reserved come to above the total; else zero.
   * Optional only so the many test balances need not name it; absent reads as zero. */
  overpaid?: string;
  /** The net tips of the received payments. */
  tips: string;
  payments: BillPaymentView[];
  /** On an open bill: the bill its chosen items moved to while a card payment of theirs is pending. */
  beingPaidOn?: { billId: string; billNumber: number | null };
}

export type BillReaderStopOutcome = "requested" | "unavailable" | "refused" | "unknown";

export interface BillPaymentResult {
  slipPrintFailed?: true;
  failureReason?: string;
  /** A reader card's own answer is `declined`, `timeout` (still pending) or `network_unavailable`
   * (failed, nothing charged); a resend answers the state it finds. */
  outcome: "received" | "pending" | "failed" | "declined" | "timeout" | "network_unavailable";
  payment: BillPaymentView;
  balance: BillBalance;
  /** Present when the bill is invoiced: by this payment, or, on a resend, since. */
  invoice?: TillSaleResult;
}
/** Money to give back from one bill payment. `override` is a holder of the refund permission;
 * `manualConfirmed` says staff has already refunded a hand-keyed card on its terminal. */
export interface BillRefundRequest {
  submissionId: string;
  appliedAmount: string;
  tipAmount: string;
  reason: string;
  override?: { personId: string; pin: string };
  manualConfirmed?: boolean;
}

export interface BillRefundResult {
  refund: BillRefundView;
  balance: BillBalance;
}
/** `POST /api/parties/:id/unpaid-departure`: one bill left unpaid. */
export interface UnpaidDepartureRequest {
  billId: string;
  expectedEdits: BillEditExpected[];
  expectedPartyRevision: number;
  reason: string;
  override?: { personId: string; pin: string };
}
/** Each bill the departure left unpaid, with the invoice it owes on. */
export interface UnpaidDepartureResult {
  state: "open" | "closed";
  departures: {
    id: string;
    workingOrderId: string;
    saleId: string;
    invoiceNumber: string;
    amount: string;
  }[];
}
/** The till's Pay result, mapped from the bill payment response. */
export type PayOutcome = (
  | { outcome: "captured"; ticket: TillSaleResult }
  | { outcome: "partial"; balance: BillBalance; slipPaymentId?: string }
  | { outcome: "declined"; failureReason?: string }
  | { outcome: "timeout" }
  | { outcome: "network_unavailable" }
) & { captureWarning?: CaptureWarning; slipPrintFailed?: true };

export class PaymentsApi extends KitchenApi {
  readonly #request: TillRequest;
  constructor(request: TillRequest) {
    super(request);
    this.#request = request;
  }
  async printPaymentSlip(orderId: string, paymentId: string): Promise<void> {
    await this.#request(`/api/working-orders/${orderId}/payment-slip`, "POST", { paymentId });
  }
  /** Who may approve a bill refund → `GET /api/refund-authorizers`: the active holders of the refund
   * permission, by id and name. */
  listRefundAuthorizers(options: ReadOptions = {}): Promise<StaffMember[]> {
    return this.#request<StaffMember[]>(
      "/api/refund-authorizers",
      "GET",
      undefined,
      options.signal,
    );
  }
  /** The reasons a cancel, a give-away or a discount can be made under →
   * `GET /api/adjustment-reasons`. */
  listAdjustmentReasons(): Promise<AdjustmentReason[]> {
    return this.#request<AdjustmentReason[]>("/api/adjustment-reasons", "GET");
  }
  /** The active people holding every one of `permission`. */
  listApprovers(
    permission: ApproverRight | readonly ApproverRight[],
    options: ReadOptions = {},
  ): Promise<StaffMember[]> {
    const rights = typeof permission === "string" ? [permission] : permission;
    return this.#request<StaffMember[]>(
      `/api/adjustment-approvers?${rights.map((right) => `permission=${encodeURIComponent(right)}`).join("&")}`,
      "GET",
      undefined,
      options.signal,
    );
  }
  /** What an adjustment would take off the bill, and whether it needs approval, writing nothing →
   * `POST /api/working-orders/:orderId/adjustments/preview`. Refuses as the apply would, and
   * `working_order.out_of_date` when the bill changed since `expectedRevision`. */
  previewAdjustment(orderId: string, ask: AdjustmentAsk): Promise<AdjustmentPreview> {
    return this.#request(`/api/working-orders/${orderId}/adjustments/preview`, "POST", ask);
  }
  /** Cancels, gives away or discounts → `POST /api/working-orders/:orderId/adjustments`. Answers the
   * bill's new revision and its party. A resend with the same submission id is answered as the
   * first was. Refuses, among others, `working_order.out_of_date`, `adjustment.approval_required`
   * (naming `approval`), `pin.invalid` and the `adjustment.*` codes. */
  applyAdjustment(
    orderId: string,
    command: AdjustmentCommand,
    options: ReadOptions = {},
  ): Promise<{
    adjustmentIds: string[];
    revision: number;
    party: BillParty;
    invoice?: TillSaleResult;
  }> {
    return this.#request(
      `/api/working-orders/${orderId}/adjustments`,
      "POST",
      command,
      options.signal,
    );
  }
  /** The bill's total, what it has received and reserved, what it still owes, its payments and
   * the quantity of each line already paid → `GET /api/working-orders/:id/payments`. */
  getBillBalance(billId: string, options: ReadOptions = {}): Promise<BillBalance> {
    return this.#request(
      `/api/working-orders/${billId}/payments`,
      "GET",
      undefined,
      options.signal,
    );
  }
  /** How a payment would split between the bill, change and tip, writing nothing →
   * `POST /api/working-orders/:id/payments/preview`. Refuses as the payment would. */
  previewBillPayment(
    billId: string,
    ask: BillPaymentAsk,
    options: ReadOptions = {},
  ): Promise<AllocationPreview> {
    return this.#request(
      `/api/working-orders/${billId}/payments/preview`,
      "POST",
      ask,
      options.signal,
    );
  }
  /**
   * Takes a payment against the bill → `POST /api/working-orders/:id/payments`. A resend with the
   * same submission id and body is answered as the first was. A reader card's decline is an answer,
   * not a refusal. Refuses, among others, `bill.allocation_changed` (carrying the fresh `preview`),
   * `bill.tip_not_allowed` (carrying `chargeable`), `bill.nothing_outstanding`,
   * `order.payment_in_flight`, `bill.refund_in_progress`, `working_order.not_open` and
   * `submission.id_reused`.
   */
  takeBillPayment(
    billId: string,
    request: BillPaymentRequest,
    options: ReadOptions = {},
  ): Promise<BillPaymentResult> {
    return this.#request(`/api/working-orders/${billId}/payments`, "POST", request, options.signal);
  }
  /** What paying for the chosen items would take, writing nothing →
   * `POST /api/working-orders/:id/item-payments/preview`. Refuses as the payment would. */
  previewItemPayment(
    billId: string,
    ask: ItemPaymentAsk,
    options: ReadOptions = {},
  ): Promise<ItemPaymentPreview> {
    return this.#request(
      `/api/working-orders/${billId}/item-payments/preview`,
      "POST",
      ask,
      options.signal,
    );
  }
  /** Moves the chosen items to a new bill and takes the payment there →
   * `POST /api/working-orders/:id/item-payments`. A reader card's Stop is keyed by this bill's id. */
  payForItems(
    billId: string,
    request: ItemPaymentRequest,
    options: ReadOptions = {},
  ): Promise<ItemPaymentResult> {
    return this.#request(
      `/api/working-orders/${billId}/item-payments`,
      "POST",
      request,
      options.signal,
    );
  }
  /** Keeps what an overpaid bill took above its total, `overpaid` as staff saw it, as a tip →
   * `POST /api/working-orders/:id/overpaid/keep-as-tip`. */
  keepOverpaidAsTip(
    billId: string,
    submissionId: string,
    overpaid: string,
    options: ReadOptions = {},
  ): Promise<BillBalance> {
    return this.#request(
      `/api/working-orders/${billId}/overpaid/keep-as-tip`,
      "POST",
      { submissionId, overpaid },
      options.signal,
    );
  }
  cancelBillReaderPayment(
    billId: string,
    submissionId: string,
    options: ReadOptions = {},
  ): Promise<{ outcome: BillReaderStopOutcome }> {
    return this.#request(
      `/api/working-orders/${billId}/payments/${encodeURIComponent(submissionId)}/cancel`,
      "POST",
      undefined,
      options.signal,
    );
  }
  /** Gives money back from one payment of the bill →
   * `POST /api/working-orders/:id/payments/:paymentId/refunds`. Refuses, among others,
   * `authorization.not_permitted`, `pin.invalid`, `bill.refund_exceeds_payment`,
   * `bill.refund_unsupported` and `bill.manual_refund_pin_required`. */
  refundBillPayment(
    billId: string,
    paymentId: string,
    request: BillRefundRequest,
    options: ReadOptions = {},
  ): Promise<BillRefundResult> {
    return this.#request(
      `/api/working-orders/${billId}/payments/${paymentId}/refunds`,
      "POST",
      request,
      options.signal,
    );
  }
}
