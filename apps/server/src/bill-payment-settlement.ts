import { type SettleSaleTender, recordSale, settleSale } from "@waitron/core";
import { type Transaction, workingOrders, appendDrawerEntry, billPayments } from "@waitron/db";
import { payments as providerPayments, findPaymentByBillPayment } from "@waitron/payments";
import { paymentRefunds } from "@waitron/payments/src/schema/payment-refunds.js";
import {
  AppError,
  subtractDecimal,
  compareDecimal,
  type Decimal,
  addDecimal,
  centsToDecimal,
  workingOrderId as brandWorkingOrderId,
  decimal,
  sumDecimals,
  decimalToCents,
  isAppError,
  diskFullIn,
} from "@waitron/shared";
import { inArray, eq, and } from "drizzle-orm";
import { issueAdvance, advanceWithOpenCorrection } from "./bill-advances.js";
import { ZERO, money } from "./bill-allocation.js";
import {
  type PaymentRow,
  type BillFigures,
  readHeld,
  readBillFigures,
  fundsOf,
  readPaymentsAndRefunds,
  advancesPaidBy,
  moneyOf,
  receivedHoldsMoney,
  linkCardBillPayments,
  readPaymentRows,
  billPaymentTotal,
} from "./bill-payment-rows.js";
import type { BillPaymentDeps } from "./bill-payment-types.js";
import { clearBillRequestIfPaid } from "./bill-request.js";
import { readBillUnsent } from "./bill-unsent.js";
import { raiseDishesNotSent } from "./dish-not-sent-alert.js";
import { ORDER_INVOICE_CHOICE, selectOrderInvoice } from "./invoice-selection.js";
import { storePrepayMadeHere } from "./made-here.js";
import { VENUE_SERVICE } from "./modules.js";
import { linkSaleDishes } from "./order-portions.js";
import { bumpPartyRevision } from "./parties.js";
import { receiptLines } from "./receipt-adjustments.js";
import { type GuestCountChoice, saleReceiptFacts } from "./receipt-guests.js";
import { readReceiptIssuer } from "./receipt-issuer.js";
import { readReceiptOrder } from "./receipt-order.js";
import { readBillTenderLines } from "./receipt-payments.js";
import { readReceiptPresentation } from "./receipt-presentation.js";
import {
  type PrinterLookup,
  refreshWaitingOriginals,
  enqueueSaleReceipt,
  resolveDrawerAssignment,
  printerLookup,
} from "./receipt-print.js";
import { storedDeviceOrigin } from "./request-config.js";
import { CARD_TIMING_COLUMNS, cardSaleMoment } from "./sale-day.js";
import { readSaleOperationDescription } from "./sale-operation-description.js";
import { withSentOrderOpen } from "./sent-order-open.js";
import {
  priceStoredOrderForIssuance,
  readInvoiceNumber,
  toVatBreakdown,
} from "./stored-order-lines.js";
import {
  type TillSaleResult,
  settleIssuedOrder,
  readSettledTicket,
  fireDishesAtPayment,
  readTenderBlock,
  receiptQr,
} from "./till-sale.js";
import { requireEconomicWrite } from "./trading-admission.js";
import type { DeviceRequestConfig, TradingContext } from "./trading-context.js";
import type { TillSaleDeps } from "./working-order-context.js";
import { bumpRevision } from "./working-order-edit-state.js";
import { priceOrderInvoice, filedLines } from "./working-order-invoice.js";
import { moveOrderLines } from "./working-order-transfer.js";
import "./errors.js";

/** The latest moment among `received` that dates a payment: a card's {@link cardSaleMoment}, and
 * a cash payment's, or a card's with no settled card row, when its own row was written; undefined
 * for none, which files the issue date alone. The caller passes only payments that still hold
 * money: one given back in full paid for nothing, so its later acceptance would move the sale off
 * the day it happened. */
async function latestAcceptance(
  tx: Transaction,
  received: readonly PaymentRow[],
): Promise<string | undefined> {
  const cards = await tx
    .select({
      billPaymentId: providerPayments.billPaymentId,
      ...CARD_TIMING_COLUMNS,
    })
    .from(providerPayments)
    .where(
      inArray(
        providerPayments.billPaymentId,
        received.map((row) => row.id),
      ),
    );
  return received
    .map((row) => {
      const card = cards.find((candidate) => candidate.billPaymentId === row.id);
      return (card === undefined ? null : cardSaleMoment(card)) ?? row.createdAt;
    })
    .reduce<string | undefined>(
      (latest, at) => (latest === undefined || at > latest ? at : latest),
      undefined,
    );
}
/** A payer's own receipt is not built for a bill set for a full invoice (advances plan, piece 1b). */
export async function refuseFullInvoiceAdvance(
  tx: Transaction,
  workingOrderId: string,
): Promise<void> {
  const [order] = await tx
    .select({ invoiceType: workingOrders.invoiceType })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  if (order?.invoiceType === "F1")
    throw new AppError("advance.full_invoice_unsupported", { workingOrderId });
}
/**
 * Issue `payment`'s advance when it is one: its payer wants their own receipt, the bill has no
 * invoice (neither before it nor from it), and the meal less the bill's advances less the received
 * money of its payments with no advance, this one's included, still leaves something owed. A flagged
 * payment that pays the bill off is part of the rest's invoice, even while that cannot be issued.
 * `figures` are the bill's as they stand, when the caller has read them; it calls this only when
 * no invoice of the bill was issued or settled since. Runs in the payment's transaction, so a
 * refused advance takes the payment back with it.
 */
export async function issueAdvanceIfOwed(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  payment: PaymentRow,
  printers: PrinterLookup,
  figures: BillFigures | undefined,
): Promise<void> {
  if (!payment.ownReceipt || payment.state !== "received" || figures?.issued !== undefined) return;
  const workingOrderId = payment.workingOrderId;
  // Read again: `payment` was written after any figures the caller read.
  const { held, advances } = await readHeld(tx, [workingOrderId], figures?.advances);
  const bill = figures ?? (await readBillFigures(tx, workingOrderId, advances));
  if (bill.issued !== undefined || advances.payments.has(payment.id)) return;
  // Each advance counts by what is left of it, and every other received payment by its money.
  const { received } = fundsOf(workingOrderId, ZERO, held);
  const left = subtractDecimal(bill.meal, received);
  if (compareDecimal(left, ZERO) <= 0) return;
  await issueAdvance(tx, deps, cfg, payment, printers);
}
type IssueOptions = {
  moneyMoved?: boolean;
  closeZero?: boolean;
  /** The bill's figures from earlier in this transaction, with no sale or advance issued or
   * corrected since. */
  figures?: BillFigures;
  /** The bill's priced total, when the caller has priced its current lines in this transaction
   * already and has no `figures`. */
  pricedMeal?: Decimal;
  printers?: PrinterLookup;
  guestCount?: GuestCountChoice;
  datedByLatestAcceptance?: true;
};
/** What {@link issueOrSettleWhenFullyPaid} did: the invoice it issued or settled, and the bill's
 * figures when it knows them. */
interface IssueOutcome {
  invoice: TillSaleResult | null;
  figures?: BillFigures;
}
/** {@link issueOrSettleWhenFullyPaid}, then an issued sale's waiting original lists the bill's payments. */
export async function issueWhenFullyPaid(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  operatorId: string | undefined,
  options: IssueOptions,
): Promise<IssueOutcome> {
  const done = await issueOrSettleWhenFullyPaid(tx, deps, cfg, workingOrderId, operatorId, options);
  await refreshWaitingOriginals(deps.backend, tx, cfg, workingOrderId);
  return done;
}
/** {@link issueIfFullyPaid}, answering also the bill's figures when it knows them. A `null`
 * invoice means it issued and settled nothing. `datedByLatestAcceptance` is for a bill completed
 * after its payments were taken: the moment the last of those still holding money was accepted is
 * handed to {@link issueOrderMoment} as the moment the meal ended. */
async function issueOrSettleWhenFullyPaid(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  operatorId: string | undefined,
  options: IssueOptions,
): Promise<IssueOutcome> {
  await requireEconomicWrite(tx, cfg, deps.admission);
  const notYet = { invoice: null, figures: options.figures };
  const [order] = await tx
    .select({
      status: workingOrders.status,
      partyId: workingOrders.partyId,
      ...ORDER_INVOICE_CHOICE,
    })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  if (order?.status !== "open" && order?.status !== "placed") return notYet;
  const { rows, refunds, advanced } = await readPaymentsAndRefunds(tx, workingOrderId);
  const received = rows.filter((row) => row.state === "received");
  // The rest's invoice is settled by the payments that paid no advance; each advance's money is on
  // its own ticket, and the invoice takes the advance's credit off instead.
  const advances =
    options.figures?.advances ?? (await advancesPaidBy(tx, [workingOrderId], advanced));
  const advancePayments = new Set(advances.payments.keys());
  const credits = advances.credits.get(workingOrderId) ?? [];
  // An advance given back in full through Correct invoice pays nothing of the bill.
  const crediting = credits.some((credit) => compareDecimal(credit.gross, ZERO) > 0);
  const ownReceived = received.filter((row) => !advancePayments.has(row.id));
  if (
    (ownReceived.length === 0 && !crediting && options.closeZero !== true) ||
    rows.some((row) => row.state === "pending")
  )
    return notYet;
  // A card refund still pending leaves the bill's received money unknown.
  if (refunds.some((refund) => refund.state === "pending")) return notYet;
  // A captured reservation must finish even if a restored draft is still open.
  if (options.moneyMoved !== true && (await readBillUnsent(tx, workingOrderId)).length > 0)
    return notYet;
  const held = moneyOf(rows, refunds, advances.payments).filter(
    ({ row }) => !advancePayments.has(row.id),
  );
  const figures =
    options.figures ?? (await readBillFigures(tx, workingOrderId, advances, options.pricedMeal));
  const { issued, due } = figures;
  const zero = compareDecimal(due, ZERO) === 0;
  const advancesPaidAll = zero && issued === undefined && crediting;
  const unpaid = { invoice: null, figures };
  if (zero && options.closeZero !== true && !advancesPaidAll) return unpaid;
  if (compareDecimal(fundsOf(workingOrderId, due, held).received, due) !== 0) return unpaid;
  if (zero && held.some(receivedHoldsMoney)) return unpaid;
  // An advance's open correction could still file a corrective the invoice would not take off.
  // Money already moved cannot be refused: the invoice waits, and closing or discarding that
  // correction issues it if the bill is still paid off (`issueAdvanceBill` in invoice-corrections.ts).
  const correcting =
    credits.length === 0 ? undefined : await advanceWithOpenCorrection(tx, workingOrderId);
  if (correcting !== undefined) {
    if (options.moneyMoved === true) return unpaid;
    throw new AppError("advance.correction_open", { workingOrderId, ...correcting });
  }
  const holding = held.filter(receivedHoldsMoney);
  const tendersOfBill: SettleSaleTender[] = [...holding]
    .sort((a, b) => a.row.receivedAt!.localeCompare(b.row.receivedAt!))
    .map(({ row, netApplied, netTip }) => ({
      method: row.method,
      amount: money(addDecimal(netApplied, netTip)),
      tipAmount: money(netTip),
      cashTendered: row.tendered === null ? null : centsToDecimal(row.tendered),
      settledAt: new Date(row.receivedAt!),
      billPaymentId: row.id,
    }));

  const lastReceipt = ownReceived
    .map((row) => row.receivedAt!)
    .reduce<string | undefined>(
      (latest, at) => (latest === undefined || at > latest ? at : latest),
      undefined,
    );
  if (issued !== undefined) {
    const settledAt = zero ? deps.clock.now().instant : new Date(lastReceipt!);
    await settleIssuedOrder(
      tx,
      { workingOrderId, saleId: issued.saleId },
      tendersOfBill,
      settledAt,
      deps.log,
    );
    await linkCardBillPayments(tx, received, issued.saleId, advancePayments);
    const ticket = await readSettledTicket(deps.backend, tx, cfg, workingOrderId);
    if (!zero) await enqueueSaleReceipt(tx, cfg, ticket, issued.saleId, options.printers);
    return { invoice: ticket, figures };
  }

  // A card already captured cannot be undone by refusing its invoice, so a line whose product has
  // since gone off sale is filed as it stands, as a whole-order card recovery files it.
  const stored = await priceStoredOrderForIssuance(tx, workingOrderId, {
    refuseUnsentUnavailable: options.moneyMoved !== true,
  });
  const invoice = await priceOrderInvoice(
    tx,
    deps.clock,
    deps.backend,
    cfg,
    workingOrderId,
    stored,
    { receiptLocale: order.receiptLocale, credits },
    deps.log,
    options.datedByLatestAcceptance === undefined
      ? undefined
      : await latestAcceptance(
          tx,
          holding.map(({ row }) => row),
        ),
  );
  const { priced, meal, clock, gross, language, operationDate } = invoice;
  // Nothing since the read above writes the order's invoice choice.
  const selected = await selectOrderInvoice(
    tx,
    deps.backend,
    cfg,
    workingOrderId,
    meal.total,
    order,
  );
  const operationDescription = await readSaleOperationDescription(tx, cfg, {
    kind: "order",
    orderId: workingOrderId,
  });
  const { saleId, fiscal } = await recordSale(tx, deps.backend, {
    receipt: await saleReceiptFacts(
      tx,
      workingOrderId,
      selected.sale.counterparty,
      options.guestCount,
    ),
    origin: cfg.origin,
    nodeId: cfg.nodeId,
    ...selected.sale,
    operationDescription,
    workingOrderId: brandWorkingOrderId(workingOrderId),
    ...language,
    total: priced.total,
    lines: filedLines(invoice),
    vatBreakdown: priced.vatBreakdown,
    clock,
    operationDate,
    operatorId,
    settlement: { kind: "deferred" },
  });
  await linkSaleDishes(tx, saleId, stored.identities);
  await settleSale(tx, { saleId, tenders: tendersOfBill });
  await linkCardBillPayments(tx, received, saleId, advancePayments);

  const notSent = await fireDishesAtPayment(tx, cfg, workingOrderId, order.partyId);
  await storePrepayMadeHere(tx, workingOrderId, [...(cfg.madeHereSink ?? [])]);
  const settledAt = zero ? clock.now().instant.toISOString() : lastReceipt!;
  const receiptOrder = await readReceiptOrder(tx, workingOrderId, { atIssuance: true });
  await tx
    .update(workingOrders)
    .set({ label: receiptOrder.orderLabel, status: "settled", settledAt })
    .where(eq(workingOrders.id, workingOrderId));
  await VENUE_SERVICE.withdrawPendingDepartmentTransfers(tx, [workingOrderId]);
  await clearBillRequestIfPaid(tx, workingOrderId, deps.log);
  if (notSent !== null) {
    await raiseDishesNotSent(
      tx,
      cfg,
      saleId,
      workingOrderId,
      notSent,
      deps.clock.now().instant,
      deps.log,
    );
  }

  if (fiscal === undefined) {
    const ticket = await readSettledTicket(deps.backend, tx, cfg, workingOrderId);
    await enqueueSaleReceipt(tx, cfg, ticket, saleId, options.printers);
    return { invoice: ticket, figures };
  }
  const ticket = {
    ...(await readReceiptIssuer(deps.backend, tx, saleId)),
    ...(await readReceiptPresentation(tx, saleId, language.locale, cfg.practiceMode === true)),
    invoiceType: selected.invoiceType,
    ...(selected.recipient === undefined ? {} : { recipient: selected.recipient }),
    ...receiptOrder,
    locale: language.locale,
    namesLocale: language.invoiceLocales[0]!,
    invoiceNumber: await readInvoiceNumber(tx, saleId),
    issuedAt: fiscal.issuedAt.toISOString(),
    total: priced.total,
    vatBreakdown: toVatBreakdown(priced.vatBreakdown),
    ...(await receiptLines(tx, workingOrderId, gross, stored.identities, saleId)),
    tender: await readTenderBlock(tx, saleId, workingOrderId),
    ...(zero ? {} : { payments: await readBillTenderLines(tx, saleId) }),
    ...receiptQr(deps.backend, fiscal.verificationUrl),
  };
  await enqueueSaleReceipt(tx, cfg, ticket, saleId, options.printers);
  return { invoice: ticket, figures };
}

export async function issueIfFullyPaid(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  operatorId?: string,
  options: { moneyMoved?: boolean; closeZero?: boolean; datedByLatestAcceptance?: true } = {},
): Promise<TillSaleResult | null> {
  return (await issueWhenFullyPaid(tx, deps, cfg, workingOrderId, operatorId, options)).invoice;
}
/**
 * {@link issueIfFullyPaid} for a bill whose money has already moved but whose invoice was held
 * back, issued as recovery's completion would have issued it for the bill's latest received
 * payment that paid no advance: under that payment's device and person, dated by the latest
 * acceptance. Under `cfg` and `operatorId` when every received payment paid an advance. An order
 * left unsent on the bill makes it wait: issuing would settle the bill under it, and its send would
 * then be refused; sending or discarding it issues the bill if it is still paid.
 */
export async function issueHeldBill(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  workingOrderId: string,
  operatorId: string,
): Promise<TillSaleResult | null> {
  if ((await readBillUnsent(tx, workingOrderId)).length > 0) return null;
  const { rows, advanced } = await readPaymentRows(tx, [workingOrderId]);
  // Rows come in creation order (createdAt, then rowid), so of two received in the same
  // millisecond the later-created one wins.
  const completing = rows
    .filter((row) => row.state === "received" && !advanced.has(row.id))
    .reduce<PaymentRow | undefined>(
      (latest, row) =>
        latest === undefined || row.receivedAt! >= latest.receivedAt! ? row : latest,
      undefined,
    );
  return issueIfFullyPaid(
    tx,
    deps,
    completing === undefined ? cfg : { ...cfg, origin: storedDeviceOrigin(completing) },
    workingOrderId,
    completing?.requestedBy ?? operatorId,
    { moneyMoved: true, datedByLatestAcceptance: true },
  );
}
/** Who confirmed a payment's or a refund's outcome by hand, and their note. */
export interface Attestation {
  attestedBy: string;
  note: string;
}
/** The columns an attested outcome writes beside its state. */
export function attestationColumns(attestation: Attestation | undefined) {
  return attestation === undefined
    ? {}
    : { attestedBy: attestation.attestedBy, attestationNote: attestation.note };
}
export async function recordBillDrawerPayment(
  tx: Transaction,
  cfg: DeviceRequestConfig,
  payment: PaymentRow,
  printers: PrinterLookup,
): Promise<void> {
  const drawer = await resolveDrawerAssignment(printers);
  if (drawer === undefined) return;
  await appendDrawerEntry(tx, {
    nodeId: cfg.nodeId,
    printerId: drawer.id,
    deviceId: cfg.origin.deviceId,
    personId: payment.requestedBy,
    recordedAt: payment.receivedAt!,
    kind: payment.method === "cash" ? "cash_payment" : "card_payment",
    amount: payment.applied + payment.tip,
    billPaymentId: payment.id,
  });
}
/** Receive a pending card payment at its settlement time, then issue when fully paid.
 * A partial refund requires explicit net amounts: the gross provider charge includes returned money. */
export async function completeBillPayment(
  tx: Transaction,
  deps: BillPaymentDeps,
  cfg: TradingContext,
  billPaymentId: string,
  receivedAt: Date,
  options: {
    attestation?: Attestation;
    guestCount?: GuestCountChoice;
    confirmedNet?: { applied: Decimal; tip: Decimal };
    datedByLatestAcceptance?: true;
  } = {},
): Promise<{ payment: PaymentRow; invoice: TillSaleResult | null; meal?: Decimal }> {
  const { attestation, guestCount, confirmedNet, datedByLatestAcceptance } = options;
  await requireEconomicWrite(tx, cfg, deps.admission);
  const [pending] = await tx
    .select({
      applied: billPayments.applied,
      workingOrderId: billPayments.workingOrderId,
      method: billPayments.method,
    })
    .from(billPayments)
    .where(eq(billPayments.id, billPaymentId));
  const provided = await findPaymentByBillPayment(tx, billPaymentId);
  if (provided?.state === "partially_refunded") {
    const refunds = await tx
      .select()
      .from(paymentRefunds)
      .where(and(eq(paymentRefunds.paymentId, provided.id), eq(paymentRefunds.state, "succeeded")));
    const net = subtractDecimal(
      decimal(provided.amount),
      sumDecimals(refunds.map((r) => centsToDecimal(r.amount))),
    );
    if (
      !confirmedNet ||
      compareDecimal(net, ZERO) <= 0 ||
      compareDecimal(addDecimal(confirmedNet.applied, confirmedNet.tip), net) !== 0
    )
      throw new AppError("bill.attestation_contradicted", {
        id: billPaymentId,
        evidence: "captured",
      });
  } else if (confirmedNet) {
    throw new AppError("bill.attestation_contradicted", {
      id: billPaymentId,
      evidence: "captured",
    });
  }
  const actual = confirmedNet
    ? decimalToCents(addDecimal(confirmedNet.applied, confirmedNet.tip))
    : provided !== undefined && provided.state === "captured"
      ? decimalToCents(decimal(provided.amount))
      : undefined;
  const applied = confirmedNet
    ? decimalToCents(confirmedNet.applied)
    : actual === undefined
      ? undefined
      : Math.min(pending!.applied, actual);
  let remainingAfter: number | undefined;
  if (pending!.method === "card") {
    const { held, advances } = await readHeld(tx, [pending!.workingOrderId]);
    const funds = fundsOf(
      pending!.workingOrderId,
      await billPaymentTotal(tx, pending!.workingOrderId, advances),
      held,
    );
    remainingAfter = decimalToCents(
      subtractDecimal(
        subtractDecimal(funds.total, funds.received),
        centsToDecimal(applied ?? pending!.applied),
      ),
    );
  }
  const [payment] = await tx
    .update(billPayments)
    .set({
      remainingAfter,
      applied,
      tip: actual === undefined ? undefined : actual - applied!,
      state: "received",
      receivedAt: receivedAt.toISOString(),
      ...attestationColumns(attestation),
    })
    .where(eq(billPayments.id, billPaymentId))
    .returning();
  // The invoices are filed under the device that took the payment, whoever completes it.
  const takenAt = { ...cfg, origin: storedDeviceOrigin(payment!) };
  const printers = printerLookup(tx, takenAt.origin);
  await recordBillDrawerPayment(tx, takenAt, payment!, printers);
  const issued = await issueWhenFullyPaid(
    tx,
    deps,
    takenAt,
    payment!.workingOrderId,
    payment!.requestedBy,
    { moneyMoved: true, guestCount, datedByLatestAcceptance, printers },
  );
  // An invoice issued or settled is answered, so with none `figures` still stand.
  if (issued.invoice === null)
    await issueAdvanceIfOwed(tx, deps, takenAt, payment!, printers, issued.figures);
  const items = await itemsPaymentSource(tx, payment!);
  if (items !== null) await issueHeldSource(tx, deps, takenAt, payment!, items.sourceId);
  return { payment: payment!, invoice: issued.invoice, meal: issued.figures?.meal };
}
/**
 * The bill Pay for items moved `payment`'s items from, when `payment` is the one it took: the
 * earliest payment of a bill that names a source, as Pay for items inserts it in the transaction
 * that makes the bill. `alone` when no other payment there is pending or received, so no other
 * money sits on the bill. `null` otherwise.
 */
async function itemsPaymentSource(
  tx: Transaction,
  payment: PaymentRow,
): Promise<{ sourceId: string; alone: boolean } | null> {
  const [bill] = await tx
    .select({ itemsPaidFrom: workingOrders.itemsPaidFrom })
    .from(workingOrders)
    .where(eq(workingOrders.id, payment.workingOrderId));
  const sourceId = bill?.itemsPaidFrom ?? null;
  if (sourceId === null) return null;
  const { rows } = await readPaymentRows(tx, [payment.workingOrderId]);
  if (rows[0]?.id !== payment.id) return null;
  const alone = rows.slice(1).every((row) => row.state !== "pending" && row.state !== "received");
  return { sourceId, alone };
}
/** A card bill payment that charged nothing becomes `failed`, releasing its reservation, and the
 * items it was paying for go back to their bill ({@link putItemsBack}). Its callers have read it
 * pending, as {@link completeBillPayment}'s have. */
export async function failBillPayment(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: TradingContext,
  billPaymentId: string,
  failedAt: Date,
  attestation?: Attestation,
): Promise<PaymentRow> {
  const [payment] = await tx
    .update(billPayments)
    .set({
      state: "failed",
      failedAt: failedAt.toISOString(),
      ...attestationColumns(attestation),
    })
    .where(eq(billPayments.id, billPaymentId))
    .returning();
  await putItemsBack(tx, deps, cfg, payment!);
  return payment!;
}
/**
 * Every line of a Pay for items bill goes back to the bill it came from when the payment Pay for
 * items took there fails ({@link itemsPaymentSource}) and no other money sits on the bill, and the
 * emptied bill is abandoned. Its own savepoint: a refusal leaves the items on their own open bill,
 * to be paid there, and the payment's failure stands. A source no longer open is the same case,
 * except a sent Counter order with no receipt, which {@link withSentOrderOpen} opens for the move
 * back.
 * Pay for items held the source's invoice back for this payment, so where the items stay, the
 * source is issued if its own payments now cover it ({@link issueHeldSource}).
 */
async function putItemsBack(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: TradingContext,
  failed: PaymentRow,
) {
  const items = await itemsPaymentSource(tx, failed);
  if (items === null) return;
  const moved = items.alone && (await movedItemsBack(tx, cfg, failed, items.sourceId));
  if (!moved) await issueHeldSource(tx, deps, cfg, failed, items.sourceId);
}
/**
 * Issues the bill Pay for items held back for `payment` if its own payments now cover it, the same
 * way whether that payment was received or failed: as {@link issueHeldBill}, under the source's own
 * latest payment, whose money its invoice settles, else `payment`'s device and person. With money
 * moved, so an advance's correction opened while the card was collected makes the invoice wait
 * (closing it issues the bill) rather than undo a card already captured.
 */
async function issueHeldSource(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: TradingContext,
  payment: PaymentRow,
  sourceId: string,
): Promise<void> {
  await issueHeldBill(
    tx,
    deps,
    { ...cfg, origin: storedDeviceOrigin(payment) },
    sourceId,
    payment.requestedBy,
  );
}
/** {@link putItemsBack}'s move, true when it moved the items. */
async function movedItemsBack(
  tx: Transaction,
  cfg: TradingContext,
  failed: PaymentRow,
  sourceId: string,
): Promise<boolean> {
  const billId = failed.workingOrderId;
  const [bill] = await tx
    .select({ status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  if (bill!.status !== "open") return false;
  let bodyError: unknown;
  try {
    await tx.transaction(async () => {
      try {
        await withSentOrderOpen(tx, sourceId, async () => {
          await moveOrderLines(tx, cfg, billId, sourceId, undefined, {
            actorId: failed.requestedBy,
          });
          await bumpRevision(tx, [sourceId, billId]);
          await tx
            .update(workingOrders)
            .set({ status: "abandoned" })
            .where(eq(workingOrders.id, billId));
          const [source] = await tx
            .select({ partyId: workingOrders.partyId })
            .from(workingOrders)
            .where(eq(workingOrders.id, sourceId));
          if (source!.partyId !== null) await bumpPartyRevision(tx, source!.partyId);
        });
      } catch (error) {
        bodyError = error;
        throw error;
      }
    });
  } catch (error) {
    // Only a domain refusal whose savepoint rolled back is absorbed; a storage refusal, a full disk
    // included, or a store error that ended the whole transaction escapes.
    if (
      error !== bodyError ||
      !isAppError(error) ||
      error.code.startsWith("storage.") ||
      diskFullIn(error)
    )
      throw error;
    try {
      console.warn("payment.items_put_back_refused", {
        billPaymentId: failed.id,
        workingOrderId: billId,
        itemsPaidFrom: sourceId,
        code: error.code,
      });
    } catch {
      // Reporting must not undo the payment's failure.
    }
    return false;
  }
  return true;
}
