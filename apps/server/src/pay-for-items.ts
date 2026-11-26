import { and, eq, inArray, or, sql } from "drizzle-orm";
import { endingRestores, type Ending } from "@waitron/adjustments";
import { withIssuanceTransaction } from "@waitron/core";
import {
  billPayments,
  withTransaction,
  workingOrderLines,
  workingOrders,
  type Database,
  type Transaction,
} from "@waitron/db";
import { findPaymentByBillPayment, readPaymentsSettings } from "@waitron/payments";
import {
  AppError,
  centsToDecimal,
  decimal,
  decimalToCents,
  decimalToThousandths,
  thousandthsToDecimal,
  type Decimal,
} from "@waitron/shared";
import {
  guardBillParty,
  guardPathParty,
  moveDishes,
  refuseClosedBill,
  type BillCommand,
} from "./bill-actions.js";
import { refuseBelowAdvances } from "./bill-advances.js";
import { invalid, money, previewAllocation, ZERO, type BillFunds } from "./bill-allocation.js";
import { readBillEditState, requireBillEditors } from "./bill-editing.js";
import {
  afterCardCharged,
  beginReaderBillPayment,
  collectBegunReaderPayment,
  diskFullBeforePayment,
  getBillBalance,
  issueIfFullyPaid,
  readBillBalance,
  refuseCoveredWhileAdvanceCorrectionOpen,
  takeBillPaymentIn,
  type BillBalance,
  type BillPaymentDeps,
  type BillPaymentRequest,
  type BillPaymentResult,
  type ReaderBillPaymentDeps,
  type ReaderPaymentHold,
} from "./bill-payments.js";
import { assertProfileAction, type DeviceBinding } from "./device-session.js";
import { outsideCardDetails } from "./outside-card.js";
import { withSettledSlip } from "./payment-slip-print.js";
import type { BillEditExpected } from "./order-drafts.js";
import { grossLineTotal } from "./order-line-quantities.js";
import { fingerprint } from "./parties.js";
import { lastReopenedBill } from "./reopened-bills.js";
import { sentCounterOrderWithoutReceipt, withSentOrderOpen } from "./sent-order-open.js";
import { setMenuDiscountsLeftBy } from "./set-menu-discount-ending.js";
import { refuseMovingFrozenDishes } from "./set-menu-moves.js";
import { totalLeftBehind, totalOnOwnBill, type TakenRows } from "./set-menu-regroup.js";
import { refuseReopen, reopenToSplitIn } from "./split-after-print.js";
import type { TillSaleResult } from "./till-sale.js";
import { requireEconomicWrite, type TradingAdmission } from "./trading-admission.js";
import type { DeviceRequestConfig, OriginConfig } from "./trading-context.js";
import {
  assertDistinctTransferLines,
  checkLinePart,
  splitLinesWithinOrder,
  type PartLine,
  type SplitRow,
} from "./working-order-transfer.js";
import { storedOrderTotal } from "./stored-order-lines.js";
import { type TillSaleDeps } from "./working-order-context.js";
import "./errors.js";

/** A dish chosen to pay for: the whole line, or `quantity` of it. */
export interface ItemPick {
  lineId: string;
  quantity?: string;
}

interface PickedLine {
  id: string;
  lineNo: number;
  /** The quantity chosen, when less than all of the line. */
  part?: string;
}

async function readPicks(
  tx: Transaction,
  billId: string,
  picks: readonly ItemPick[],
): Promise<{ picked: PickedLine[]; taken: TakenRows; ending: Ending | undefined }> {
  const rows = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      parentLineId: workingOrderLines.parentLineId,
      setMenuRole: workingOrderLines.setMenuRole,
      setMenuLineId: workingOrderLines.setMenuLineId,
      quantity: workingOrderLines.quantity,
      unitPriceGross: workingOrderLines.unitPriceGross,
      priceQuantity: workingOrderLines.priceQuantity,
      unitPrecision: workingOrderLines.unitPrecision,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId));
  type Row = (typeof rows)[number];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const extrasOf = new Map<string, Row[]>();
  const dishesOf = new Map<string, Row[]>();
  for (const row of rows) {
    if (row.parentLineId !== null)
      extrasOf.set(row.parentLineId, [...(extrasOf.get(row.parentLineId) ?? []), row]);
    else if (row.setMenuLineId !== null)
      dishesOf.set(row.setMenuLineId, [...(dishesOf.get(row.setMenuLineId) ?? []), row]);
  }
  const asPart = (row: Row): PartLine & { id: string } => ({
    id: row.id,
    lineNo: row.lineNo,
    quantity: thousandthsToDecimal(row.quantity),
    unitPriceGross: centsToDecimal(row.unitPriceGross),
    priceQuantity: thousandthsToDecimal(row.priceQuantity),
    unitPrecision: row.unitPrecision,
  });
  const chosen = picks.map((pick) => {
    const row = byId.get(pick.lineId);
    if (row === undefined)
      throw new AppError("tab.line_not_found", { tabId: billId, lineId: pick.lineId });
    if (row.parentLineId !== null)
      throw new AppError("tab.transfer_modifier_line", { tabId: billId, lineNo: row.lineNo });
    return { row, quantity: pick.quantity };
  });
  assertDistinctTransferLines(
    billId,
    chosen.map(({ row }) => row),
  );
  const resized = new Map<string, { quantity: number; lineTotal: number }>();
  const resize = (line: PartLine & { id: string }, quantity: Decimal) =>
    resized.set(line.id, {
      quantity: decimalToThousandths(quantity),
      lineTotal: decimalToCents(grossLineTotal(line.unitPriceGross, quantity, line.priceQuantity)),
    });
  const picked = chosen.map(({ row, quantity }): PickedLine => {
    const line = asPart(row);
    // Refused here as the split would refuse it, so a preview never prices a part it cannot cut.
    const extras =
      quantity === undefined
        ? null
        : checkLinePart(billId, line, quantity, (extrasOf.get(row.id) ?? []).map(asPart), {
            splitExtras: true,
          });
    if (quantity === undefined || extras === null) return { id: row.id, lineNo: row.lineNo };
    resize(line, decimal(quantity));
    for (const extra of extras) resize(extra.row, extra.moved);
    return { id: row.id, lineNo: row.lineNo, part: quantity };
  });
  const ids = new Set(picked.map((line) => line.id));
  // As the move works them out (`resolveMoveLines`, `moveOrderLines`), writing nothing (D50, D51).
  const left = await setMenuDiscountsLeftBy(
    tx,
    billId,
    picked.flatMap((line) => (line.part === undefined ? [line.id] : [])),
  );
  for (const { setMenuLineId } of left.whole) ids.add(setMenuLineId);
  const adjustmentIds = left.broken.map(({ adjustmentId }) => adjustmentId);
  const ending: Ending | undefined =
    adjustmentIds.length === 0
      ? undefined
      : {
          adjustmentIds,
          restores: await endingRestores(tx, { workingOrderId: billId, adjustmentIds }),
        };
  // Refused here as the move would refuse it, so a preview does not price a set-menu dish that
  // leaves only with its set menu.
  await refuseMovingFrozenDishes(
    tx,
    chosen.flatMap(({ row }) =>
      row.setMenuRole === "dish" && (row.setMenuLineId === null || !ids.has(row.setMenuLineId))
        ? [row.id]
        : [],
    ),
    ending,
  );
  const taken = new Set<string>();
  for (const id of ids) {
    // A set menu's dishes move with it (`resolveMoveLines`).
    for (const dishId of [id, ...(dishesOf.get(id) ?? []).map((dish) => dish.id)]) {
      taken.add(dishId);
      for (const extra of extrasOf.get(dishId) ?? []) taken.add(extra.id);
    }
  }
  // A dish leaves whole when chosen whole or brought along by a set menu chosen whole; a part
  // always leaves the rest behind. A set menu counts as leaving when its every dish does: the move
  // takes one a comp or discount reduced along (D51), and the regrouping deletes any other.
  const whole = new Set(picked.filter((line) => line.part === undefined).map((line) => line.id));
  const everyDish = rows.every(
    (row) =>
      row.parentLineId !== null ||
      whole.has(row.id) ||
      (row.setMenuLineId !== null && whole.has(row.setMenuLineId)) ||
      dishesOf.has(row.id),
  );
  // D7, before the move: `moveDishes` would ask its merge-invoice question of a move that empties
  // the bill.
  if (everyDish) throw new AppError("bill.all_items_chosen", { workingOrderId: billId });
  return { picked, taken: { ids: taken, resized }, ending };
}

function pickedThousandths(quantity: string): number | null {
  try {
    return decimalToThousandths(decimal(quantity));
  } catch {
    return null;
  }
}

/** What the chosen items come to on a bill of their own, its set menus worked out. */
export async function priceItemPicks(
  tx: Transaction,
  fromBillId: string,
  picks: readonly ItemPick[],
): Promise<Decimal> {
  const { taken, ending } = await readPicks(tx, fromBillId, picks);
  // Refused here as the move would refuse it, before a hand-keyed card is charged on its machine.
  await refuseBelowAdvances(tx, fromBillId, async () =>
    centsToDecimal(await totalLeftBehind(tx, fromBillId, taken, ending)),
  );
  return centsToDecimal(await totalOnOwnBill(tx, fromBillId, taken, ending));
}

/**
 * Move the chosen items, part of a line included, from an open bill or a sent Counter order with no
 * receipt ({@link withSentOrderOpen}) to a new bill of its party (a new counter order when it has
 * none) that names the bill they came from, and issue the source when what is left of it is paid,
 * unless `holdSourceInvoice`: a card reader's payment can still charge nothing and put the items
 * back, so its source is issued once that payment is received (`completeBillPayment`). The source
 * may be left holding more than it owes; the kitchen is not told, as the items stay where they are
 * served, and the kitchen screen lists every order not yet collected, so the new bill takes the
 * source's hand-over. `sentOrder` is whether the source is a sent Counter order with no receipt,
 * when the caller has read it in this transaction.
 */
export async function moveItemsToNewBill(
  tx: Transaction,
  cfg: OriginConfig,
  fromBillId: string,
  picks: readonly ItemPick[],
  command: BillCommand & { expectedEdits: BillEditExpected[]; admission: TradingAdmission },
  sale: { deps: TillSaleDeps; cfg: DeviceRequestConfig },
  options: { holdSourceInvoice?: boolean; sentOrder?: boolean } = {},
): Promise<{ billId: string; invoice?: TillSaleResult }> {
  if (picks.length === 0) throw new AppError("sale.empty_basket", {});
  // `moveDishes` runs these too; here they come before the split, so a stale or closed bill gets
  // its own refusal.
  await requireEconomicWrite(tx, cfg, command.admission);
  const { billId } = await withSentOrderOpen(
    tx,
    fromBillId,
    async () => {
      const path = await guardPathParty(tx, fromBillId, command, { bump: false });
      refuseClosedBill(fromBillId, path.status);
      const { picked } = await readPicks(tx, fromBillId, picks);
      const parts = picked.flatMap((line) =>
        line.part === undefined ? [] : [{ lineNo: line.lineNo, quantity: line.part }],
      );
      const split: ReadonlyMap<string, SplitRow> =
        parts.length === 0
          ? new Map()
          : await splitLinesWithinOrder(tx, cfg, fromBillId, parts, { splitExtras: true });
      const lineIds = picked.map((line) =>
        line.part === undefined ? line.id : split.get(line.id)!.id,
      );
      return moveDishes(tx, cfg, fromBillId, null, lineIds, command, {
        sourceMayBeOverpaid: true,
        tellKitchen: false,
        paidAlone: true,
      });
    },
    options.sentOrder,
  );
  const ofSource = (
    column: typeof workingOrders.receiptLocale | typeof workingOrders.collectedAt,
  ) =>
    sql`(${tx.select({ value: column }).from(workingOrders).where(eq(workingOrders.id, fromBillId))})`;
  await tx
    .update(workingOrders)
    .set({
      itemsPaidFrom: fromBillId,
      receiptLocale: ofSource(workingOrders.receiptLocale),
      collectedAt: ofSource(workingOrders.collectedAt),
    })
    .where(eq(workingOrders.id, billId));
  await refuseBelowAdvances(tx, fromBillId, () => storedOrderTotal(tx, fromBillId));
  if (options.holdSourceInvoice === true) {
    // Another action on the source can still issue it while the card is collected; a declined card
    // then leaves the items on their own bill (`putItemsBack`), which keeps the money consistent.
    await refuseCoveredWhileAdvanceCorrectionOpen(tx, fromBillId);
    return { billId };
  }
  const invoice = await issueIfFullyPaid(tx, sale.deps, sale.cfg, fromBillId, command.operatorId);
  return { billId, ...(invoice === null ? {} : { invoice }) };
}

/** What Pay for items is asked: the items, the move's party read, and the payment the till showed. */
export interface PayForItemsRequest {
  submissionId: string;
  picks: ItemPick[];
  expectedPartyRevision?: number;
  partyId?: string;
  expectedEdits: BillEditExpected[];
  method: "cash" | "card";
  applied: string;
  tip: string;
  tendered?: string;
  addedTip?: string;
  entry?: "reader";
  /** A reader card only, passed to the provider's `collect`. */
  simulationOutcome?: "captured" | "declined" | "attempting";
  /** A hand-keyed card only: its terminal operation number and which machine took it. */
  externalRef?: string;
  externalProvider?: "connected_account" | "other";
  externalMachine?: string;
}

/** The request as its retry fingerprint reads it: amounts at the money scale, an absent added tip
 * as none, the picks in line order. */
function retryPrintOf(req: PayForItemsRequest): string {
  const scaled = (value: string | undefined) =>
    value === undefined ? undefined : money(decimal(value));
  return fingerprint({
    itemPayment: {
      ...req,
      submissionId: undefined,
      picks: req.picks
        .map(({ lineId, quantity }) => ({
          lineId,
          quantity: quantity === undefined ? undefined : pickedThousandths(quantity),
        }))
        .sort((a, b) => a.lineId.localeCompare(b.lineId)),
      applied: scaled(req.applied),
      tip: scaled(req.tip),
      tendered: scaled(req.tendered),
      addedTip: scaled(req.addedTip ?? "0"),
    },
  });
}

/**
 * The bill an earlier request with this submission id paid for items of `fromBillId` on (D6), or,
 * when `fromBillId` was a printed bill, of the bill reopened from it (PR4-D7); and the table's bill
 * those items came from, as it is now: the last bill reopened from that one, if it was printed and
 * reopened again since.
 */
async function earlierItemsBill(
  tx: Transaction,
  fromBillId: string,
  submissionId: string,
): Promise<{ billId: string; sourceId: string } | undefined> {
  const reopened = tx
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .where(eq(workingOrders.reopenedFrom, fromBillId));
  const [row] = await tx
    .select({ billId: billPayments.workingOrderId, sourceId: workingOrders.itemsPaidFrom })
    .from(billPayments)
    .innerJoin(workingOrders, eq(workingOrders.id, billPayments.workingOrderId))
    .where(
      and(
        or(
          eq(workingOrders.itemsPaidFrom, fromBillId),
          inArray(workingOrders.itemsPaidFrom, reopened),
        ),
        eq(billPayments.submissionId, submissionId),
      ),
    );
  return row === undefined
    ? undefined
    : { billId: row.billId, sourceId: await lastReopenedBill(tx, row.sourceId!) };
}

/** The bill the items move from, and the move's party read and picks, as the till sent them. */
interface ItemsSource {
  fromBillId: string;
  picks: readonly ItemPick[];
  party: { partyId?: string; expectedPartyRevision?: number };
  expectedEdits: BillEditExpected[];
}

/**
 * A printed bill reopened (PR4-D7), its party read and edit state checked first against
 * what the till read: the items then move from the reopened bill, each pick naming its line's copy,
 * under the party's revision and the edit state as the reopen left them. Any other bill is answered
 * as sent. Runs in the item payment's issuance transaction, as the reopen files a credit note.
 */
async function reopenIfPrinted(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  sent: ItemsSource,
  operator: { personId: string; sessionId: string },
  device: DeviceBinding | null,
): Promise<ItemsSource & { sentOrder: boolean }> {
  const [bill] = await tx
    .select({ status: workingOrders.status, partyId: workingOrders.partyId })
    .from(workingOrders)
    .where(eq(workingOrders.id, sent.fromBillId));
  if (bill?.status !== "placed") return { ...sent, sentOrder: false };
  if (await sentCounterOrderWithoutReceipt(tx, sent.fromBillId, bill))
    return { ...sent, sentOrder: true };
  assertProfileAction(device, "take-orders");
  await guardBillParty(tx, bill, { operatorId: operator.personId, ...sent.party }, { bump: false });
  await requireBillEditors(tx, [sent.fromBillId], operator.personId, sent.expectedEdits);
  const { billId, party, lineCopies } = await reopenToSplitIn(
    tx,
    deps,
    cfg,
    sent.fromBillId,
    operator,
    bill,
  );
  const picks = sent.picks.map((pick) => {
    const copy = lineCopies.get(pick.lineId);
    if (copy === undefined)
      throw new AppError("tab.line_not_found", { tabId: sent.fromBillId, lineId: pick.lineId });
    return { ...pick, lineId: copy };
  });
  return {
    fromBillId: billId,
    picks,
    party: { partyId: party.id, expectedPartyRevision: party.revision },
    expectedEdits: [await readBillEditState(tx, billId)],
    sentOrder: false,
  };
}

/**
 * Pay for the chosen items on a bill of their own: in one transaction they move to a new bill
 * ({@link moveItemsToNewBill}) and the payment covers it whole. Cash and a hand-keyed card issue its
 * ticket in that transaction; a reader card is collected after it commits, and one that charges
 * nothing puts the items back (`failBillPayment`). A resend of the same submission answers as the
 * first did. On a printed bill the device's profile must allow `take-orders`, and the bill is reopened
 * first, in the same transaction ({@link reopenIfPrinted}).
 */
export async function payForItems(
  deps: BillPaymentDeps | ReaderBillPaymentDeps,
  cfg: DeviceRequestConfig,
  fromBillId: string,
  req: PayForItemsRequest,
  operator: { personId: string; sessionId: string },
  device: DeviceBinding | null,
): Promise<{ billId: string; payment: BillPaymentResult; sourceBalance: BillBalance }> {
  if (req.entry === "reader" && !("provider" in deps)) throw invalid("entry");
  if (req.method === "cash" ? req.tendered === undefined : req.tendered !== undefined)
    throw invalid("tendered");
  const print = retryPrintOf(req);
  const payment = (expectedEdit: BillEditExpected | null): BillPaymentRequest => ({
    submissionId: req.submissionId,
    kind: "share",
    shareOf: 1,
    method: req.method,
    applied: req.applied,
    tip: req.tip,
    expectedEdit,
    ...(req.method === "cash"
      ? { tendered: req.tendered! }
      : { entry: req.entry === "reader" ? ("reader" as const) : ("manual" as const) }),
    ...(req.addedTip === undefined ? {} : { addedTip: req.addedTip }),
    ...(req.simulationOutcome === undefined ? {} : { simulationOutcome: req.simulationOutcome }),
    ...(req.externalRef === undefined ? {} : { externalRef: req.externalRef }),
    ...outsideCardDetails(req),
  });
  /** The bill an earlier request paid on, else the new bill the items move to, and its edit state;
   * and the bill the items came from, on a replay as {@link earlierItemsBill} answers it, never
   * `fromBillId`, which on a printed bill names the abandoned bill (PR4-D10). */
  const billFor = async (tx: Transaction, holdSourceInvoice: boolean) => {
    const earlier = await earlierItemsBill(tx, fromBillId, req.submissionId);
    if (earlier !== undefined) return { ...earlier, request: payment(null) };
    const source = await reopenIfPrinted(
      tx,
      deps,
      cfg,
      {
        fromBillId,
        picks: req.picks,
        party: {
          ...(req.partyId === undefined ? {} : { partyId: req.partyId }),
          ...(req.expectedPartyRevision === undefined
            ? {}
            : { expectedPartyRevision: req.expectedPartyRevision }),
        },
        expectedEdits: req.expectedEdits,
      },
      operator,
      device,
    );
    const { billId } = await moveItemsToNewBill(
      tx,
      cfg,
      source.fromBillId,
      source.picks,
      {
        operatorId: operator.personId,
        ...source.party,
        expectedEdits: source.expectedEdits,
        admission: deps.admission,
      },
      { deps, cfg },
      { holdSourceInvoice, sentOrder: source.sentOrder },
    );
    return {
      billId,
      sourceId: source.fromBillId,
      request: payment(await readBillEditState(tx, billId)),
    };
  };
  const pending = diskFullBeforePayment(deps);
  const preRead = pending !== false && (await pending);
  if ("provider" in deps && req.entry === "reader") {
    const hold: ReaderPaymentHold = { release: () => {}, capturedReplay: false };
    let billId = fromBillId;
    let sourceId = fromBillId;
    try {
      const begun = await withSettledSlip((slip) =>
        withIssuanceTransaction(
          deps.db,
          async (tx) => {
            const bill = await billFor(tx, true);
            billId = bill.billId;
            sourceId = bill.sourceId;
            const started = await beginReaderBillPayment(
              tx,
              deps,
              cfg,
              billId,
              bill.request,
              operator,
              { preRead, print: slip, hold, fingerprint: print },
            );
            return started.kind === "replay"
              ? {
                  ...started,
                  result: await asFirstAnswered(tx, started.result as BillPaymentResult),
                }
              : started;
          },
          deps.log,
        ),
      );
      const paid =
        begun.kind === "replay" ? begun.result : await collectBegunReaderPayment(deps, cfg, begun);
      return { billId, payment: paid, sourceBalance: await getBillBalance(deps, sourceId) };
    } catch (error) {
      if (!hold.capturedReplay) throw error;
      return afterCardCharged(deps, billId, () => Promise.reject(error));
    } finally {
      hold.release();
    }
  }
  return withIssuanceTransaction(
    deps.db,
    async (tx) => {
      const { billId, sourceId, request } = await billFor(tx, false);
      const paid = await takeBillPaymentIn(tx, deps, cfg, billId, request, operator, {
        preRead,
        print,
      });
      return { billId, payment: paid, sourceBalance: await readBillBalance(tx, sourceId) };
    },
    deps.log,
  );
}

/**
 * A replayed reader payment, a failed one answered `declined` when its provider recorded the card
 * failed or refunded, as `collectBegunReaderPayment` words that outcome. Begun with no basket, so a
 * replay answers the payment, never a settled counter order.
 */
async function asFirstAnswered(
  tx: Transaction,
  result: BillPaymentResult,
): Promise<BillPaymentResult> {
  if (result.outcome !== "failed") return result;
  const provided = await findPaymentByBillPayment(tx, result.payment.id);
  return provided?.state === "failed" || provided?.state === "refunded"
    ? { ...result, outcome: "declined" }
    : result;
}

/** What a preview of Pay for items is asked. */
export interface PayForItemsAsk {
  picks: ItemPick[];
  method: "cash" | "card";
  tendered?: string;
  addedTip?: string;
}

/**
 * What paying for the chosen items would take, writing nothing: their price as
 * {@link priceItemPicks} reads it, allocated as a whole payment of a bill of that total. A printed
 * bill is priced by its own dishes, which a reopen would copy, after Reopen bill's refusals.
 */
export async function previewPayForItems(
  deps: { db: Database; admission: TradingAdmission },
  cfg: DeviceRequestConfig,
  fromBillId: string,
  ask: PayForItemsAsk,
  device: DeviceBinding | null,
): Promise<{ total: string; applied: string; tip: string; change: string | null }> {
  if (ask.method === "cash" ? ask.tendered === undefined : ask.tendered !== undefined)
    throw invalid("tendered");
  return withTransaction(deps.db, async (tx) => {
    const [bill] = await tx
      .select({ status: workingOrders.status, partyId: workingOrders.partyId })
      .from(workingOrders)
      .where(eq(workingOrders.id, fromBillId));
    if (bill === undefined) throw new AppError("tab.not_open", { tabId: fromBillId });
    if (bill.status === "placed") {
      if (!(await sentCounterOrderWithoutReceipt(tx, fromBillId, bill))) {
        assertProfileAction(device, "take-orders");
        await refuseReopen(tx, deps, cfg, fromBillId, bill);
      }
    } else refuseClosedBill(fromBillId, bill.status);
    if (ask.picks.length === 0) throw new AppError("sale.empty_basket", {});
    const total = await priceItemPicks(tx, fromBillId, ask.picks);
    const funds: BillFunds = {
      workingOrderId: fromBillId,
      total,
      received: ZERO,
      reserved: ZERO,
    };
    const addedTip = decimal(ask.addedTip ?? "0.00");
    const { doc } = await readPaymentsSettings(tx);
    const preview = previewAllocation(
      funds,
      {
        kind: "share",
        shareOf: 1,
        payment:
          ask.method === "cash"
            ? { method: "cash", tendered: decimal(ask.tendered!), addedTip }
            : { method: "card", addedTip },
      },
      { tipsEnabled: doc.tipsEnabled },
    );
    return {
      total: money(total),
      applied: money(preview.applied),
      tip: money(preview.tip),
      change: preview.change === null ? null : money(preview.change),
    };
  });
}
