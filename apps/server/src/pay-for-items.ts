import { and, eq } from "drizzle-orm";
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
  compareDecimal,
  decimal,
  decimalToThousandths,
  divideDecimal,
  multiplyDecimal,
  sumDecimals,
  thousandthsToDecimal,
  type Decimal,
} from "@waitron/shared";
import { guardPathParty, moveDishes, refuseClosedBill, type BillCommand } from "./bill-actions.js";
import { readBillAdvances } from "./bill-advances.js";
import {
  invalid,
  money,
  previewAllocation,
  ZERO,
  type AllocationPreview,
  type BillFunds,
} from "./bill-allocation.js";
import { readBillEditState } from "./bill-editing.js";
import {
  afterCardCharged,
  beginReaderBillPayment,
  collectBegunReaderPayment,
  diskFullBeforePayment,
  issueIfFullyPaid,
  refuseCoveredWhileAdvanceCorrectionOpen,
  takeBillPaymentIn,
  type BillPaymentDeps,
  type BillPaymentRequest,
  type BillPaymentResult,
  type ReaderBillPaymentDeps,
  type ReaderPaymentHold,
} from "./bill-payments.js";
import { withSettledSlip } from "./payment-slip-print.js";
import type { BillEditExpected } from "./order-drafts.js";
import { fingerprint } from "./parties.js";
import type { TillSaleResult } from "./till-sale.js";
import { requireEconomicWrite, type TradingAdmission } from "./trading-admission.js";
import type { DeviceRequestConfig, OriginConfig } from "./trading-context.js";
import {
  assertDistinctTransferLines,
  checkLinePart,
  splitLinesWithinOrder,
  storedOrderTotal,
  type PartLine,
  type SplitRow,
  type TillSaleDeps,
} from "./working-order.js";
import "./errors.js";

/** A dish chosen to pay for: the whole line, or `quantity` of it. */
export interface ItemPick {
  lineId: string;
  quantity?: string;
}

interface PickedLine {
  id: string;
  lineNo: number;
  /** The dish's line total and its extras', in cents; a set menu's adds its dishes' and theirs. */
  familyCents: number;
  /** The part of the line chosen, when less than all of it. */
  part?: { quantity: string; ofQuantity: number };
}

async function readPicks(
  tx: Transaction,
  billId: string,
  picks: readonly ItemPick[],
): Promise<{ picked: PickedLine[]; everyDish: boolean }> {
  const rows = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      parentLineId: workingOrderLines.parentLineId,
      setMenuLineId: workingOrderLines.setMenuLineId,
      name: workingOrderLines.name,
      quantity: workingOrderLines.quantity,
      lineTotal: workingOrderLines.lineTotal,
      unitPriceGross: workingOrderLines.unitPriceGross,
      priceQuantity: workingOrderLines.priceQuantity,
      unitPrecision: workingOrderLines.unitPrecision,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const extrasCents = new Map<string, number>();
  const extrasOf = new Map<string, PartLine[]>();
  const asPart = (row: (typeof rows)[number]): PartLine => ({
    lineNo: row.lineNo,
    quantity: thousandthsToDecimal(row.quantity),
    unitPriceGross: centsToDecimal(row.unitPriceGross),
    priceQuantity: thousandthsToDecimal(row.priceQuantity),
    unitPrecision: row.unitPrecision,
  });
  for (const row of rows) {
    if (row.parentLineId === null) continue;
    extrasCents.set(row.parentLineId, (extrasCents.get(row.parentLineId) ?? 0) + row.lineTotal);
    extrasOf.set(row.parentLineId, [...(extrasOf.get(row.parentLineId) ?? []), asPart(row)]);
  }
  const ownCents = (id: string) => byId.get(id)!.lineTotal + (extrasCents.get(id) ?? 0);
  // A set menu's dishes move with it (`resolveMoveLines`), so they are priced with it.
  const dishesCents = new Map<string, number>();
  for (const row of rows) {
    if (row.setMenuLineId === null || row.parentLineId !== null) continue;
    dishesCents.set(
      row.setMenuLineId,
      (dishesCents.get(row.setMenuLineId) ?? 0) + ownCents(row.id),
    );
  }
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
  const picked = chosen.map(({ row, quantity }): PickedLine => {
    const familyCents = ownCents(row.id) + (dishesCents.get(row.id) ?? 0);
    // Refused here as the split would refuse it, so a preview never prices a part it cannot cut.
    return quantity === undefined ||
      checkLinePart(billId, asPart(row), quantity, extrasOf.get(row.id) ?? [], {
        splitExtras: true,
      }) === null
      ? { id: row.id, lineNo: row.lineNo, familyCents }
      : {
          id: row.id,
          lineNo: row.lineNo,
          familyCents,
          part: { quantity, ofQuantity: row.quantity },
        };
  });
  // A set menu's dish chosen with its set menu is already in the set menu's price; chosen without
  // it, the new bill has no set menu to place it in, as the move would find.
  const ids = new Set(picked.map((line) => line.id));
  const priced = picked.map((line) => {
    const row = byId.get(line.id)!;
    if (row.setMenuLineId === null) return line;
    if (!ids.has(row.setMenuLineId))
      throw new AppError("set_menu.no_place_on_target", { dishName: row.name });
    return { ...line, familyCents: 0 };
  });
  // A dish leaves whole when chosen whole or brought along by a set menu chosen whole; a part
  // always leaves the rest behind.
  const whole = new Set(picked.filter((line) => line.part === undefined).map((line) => line.id));
  const everyDish = rows.every(
    (row) =>
      row.parentLineId !== null ||
      whole.has(row.id) ||
      (row.setMenuLineId !== null && whole.has(row.setMenuLineId)),
  );
  return { picked: priced, everyDish };
}

function pickedThousandths(quantity: string): number | null {
  try {
    return decimalToThousandths(decimal(quantity));
  } catch {
    return null;
  }
}

function priceOf(picked: readonly PickedLine[]): Decimal {
  return sumDecimals(
    picked.map(({ familyCents, part }) =>
      part === undefined
        ? centsToDecimal(familyCents)
        : divideDecimal(
            multiplyDecimal(centsToDecimal(familyCents), decimal(part.quantity)),
            thousandthsToDecimal(part.ofQuantity),
            2,
          ),
    ),
  );
}

/** What the chosen items come to: each line's total and its extras', pro rata for a part. */
export async function priceItemPicks(
  tx: Transaction,
  fromBillId: string,
  picks: readonly ItemPick[],
): Promise<Decimal> {
  return priceOf((await readPicks(tx, fromBillId, picks)).picked);
}

/** Refuse (D4) a bill the move left owing less than its advances credit, read as it was left. */
async function refuseBelowAdvances(tx: Transaction, billId: string): Promise<void> {
  const advances = await readBillAdvances(tx, [billId]);
  const credited = sumDecimals((advances.credits.get(billId) ?? []).map((credit) => credit.gross));
  if (compareDecimal(await storedOrderTotal(tx, billId), credited) < 0)
    throw new AppError("bill.below_advances", {
      workingOrderId: billId,
      advances: money(credited),
    });
}

/**
 * Move the chosen items, part of a line included, from an open bill to a new bill of its party (a
 * new counter order when it has none) that names the bill they came from, and issue the source
 * when what is left of it is paid, unless `holdSourceInvoice`: a card reader's payment can still
 * charge nothing and put the items back, so its source is issued once that payment is received
 * (`completeBillPayment`). The source may be left holding more than it owes; the kitchen is not
 * told, as the items stay where they are served.
 */
export async function moveItemsToNewBill(
  tx: Transaction,
  cfg: OriginConfig,
  fromBillId: string,
  picks: readonly ItemPick[],
  command: BillCommand & { expectedEdits: BillEditExpected[]; admission: TradingAdmission },
  sale: { deps: TillSaleDeps; cfg: DeviceRequestConfig },
  options: { holdSourceInvoice?: boolean } = {},
): Promise<{ billId: string; invoice?: TillSaleResult }> {
  if (picks.length === 0) throw new AppError("sale.empty_basket", {});
  // `moveDishes` runs these too; here they come before the split, so a stale or closed bill gets
  // its own refusal.
  await requireEconomicWrite(tx, cfg, command.admission);
  const path = await guardPathParty(tx, fromBillId, command, { bump: false });
  refuseClosedBill(fromBillId, path.status);
  const { picked, everyDish } = await readPicks(tx, fromBillId, picks);
  // D7, before the move: `moveDishes` would ask its merge-invoice question of a move that empties
  // the bill.
  if (everyDish) throw new AppError("bill.all_items_chosen", { workingOrderId: fromBillId });
  const parts = picked.flatMap((line) =>
    line.part === undefined ? [] : [{ lineNo: line.lineNo, quantity: line.part.quantity }],
  );
  const split: ReadonlyMap<string, SplitRow> =
    parts.length === 0
      ? new Map()
      : await splitLinesWithinOrder(tx, cfg, fromBillId, parts, { splitExtras: true });
  const lineIds = picked.map((line) =>
    line.part === undefined ? line.id : split.get(line.id)!.id,
  );
  const { billId } = await moveDishes(tx, cfg, fromBillId, null, lineIds, command, {
    sourceMayBeOverpaid: true,
    tellKitchen: false,
  });
  await tx
    .update(workingOrders)
    .set({ itemsPaidFrom: fromBillId })
    .where(eq(workingOrders.id, billId));
  await refuseBelowAdvances(tx, fromBillId);
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

/** The bill an earlier request with this submission id paid for items of `fromBillId` on (D6). */
async function earlierItemsBill(
  tx: Transaction,
  fromBillId: string,
  submissionId: string,
): Promise<string | undefined> {
  const [row] = await tx
    .select({ billId: billPayments.workingOrderId })
    .from(billPayments)
    .innerJoin(workingOrders, eq(workingOrders.id, billPayments.workingOrderId))
    .where(
      and(eq(workingOrders.itemsPaidFrom, fromBillId), eq(billPayments.submissionId, submissionId)),
    );
  return row?.billId;
}

/**
 * Pay for the chosen items on a bill of their own: in one transaction they move to a new bill
 * ({@link moveItemsToNewBill}) and the payment covers it whole. Cash and a hand-keyed card issue its
 * ticket in that transaction; a reader card is collected after it commits, and one that charges
 * nothing puts the items back (`failBillPayment`). A resend of the same submission answers as the
 * first did.
 */
export async function payForItems(
  deps: BillPaymentDeps | ReaderBillPaymentDeps,
  cfg: DeviceRequestConfig,
  fromBillId: string,
  req: PayForItemsRequest,
  operator: { personId: string; sessionId: string },
): Promise<{ billId: string; payment: BillPaymentResult }> {
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
  });
  /** The bill an earlier request paid on, else the new bill the items move to, and its edit state. */
  const billFor = async (tx: Transaction, holdSourceInvoice: boolean) => {
    const earlier = await earlierItemsBill(tx, fromBillId, req.submissionId);
    if (earlier !== undefined) return { billId: earlier, request: payment(null) };
    const { billId } = await moveItemsToNewBill(
      tx,
      cfg,
      fromBillId,
      req.picks,
      {
        operatorId: operator.personId,
        ...(req.partyId === undefined ? {} : { partyId: req.partyId }),
        ...(req.expectedPartyRevision === undefined
          ? {}
          : { expectedPartyRevision: req.expectedPartyRevision }),
        expectedEdits: req.expectedEdits,
        admission: deps.admission,
      },
      { deps, cfg },
      { holdSourceInvoice },
    );
    return { billId, request: payment(await readBillEditState(tx, billId)) };
  };
  const pending = diskFullBeforePayment(deps);
  const preRead = pending !== false && (await pending);
  if ("provider" in deps && req.entry === "reader") {
    const hold: ReaderPaymentHold = { release: () => {}, capturedReplay: false };
    let billId = fromBillId;
    try {
      const begun = await withSettledSlip((slip) =>
        withIssuanceTransaction(
          deps.db,
          async (tx) => {
            const bill = await billFor(tx, true);
            billId = bill.billId;
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
      if (begun.kind === "replay") return { billId, payment: begun.result };
      return { billId, payment: await collectBegunReaderPayment(deps, cfg, begun) };
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
      const { billId, request } = await billFor(tx, false);
      return {
        billId,
        payment: await takeBillPaymentIn(tx, deps, cfg, billId, request, operator, {
          preRead,
          print,
        }),
      };
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
 * {@link priceItemPicks} reads it, allocated as a whole payment of a bill of that total.
 */
export async function previewPayForItems(
  db: Database,
  fromBillId: string,
  ask: PayForItemsAsk,
): Promise<{ total: string; applied: string; tip: string; change: string | null }> {
  if (ask.method === "cash" ? ask.tendered === undefined : ask.tendered !== undefined)
    throw invalid("tendered");
  return withTransaction(db, async (tx) => {
    const [bill] = await tx
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, fromBillId));
    if (bill === undefined) throw new AppError("tab.not_open", { tabId: fromBillId });
    refuseClosedBill(fromBillId, bill.status);
    if (ask.picks.length === 0) throw new AppError("sale.empty_basket", {});
    const total = await priceItemPicks(tx, fromBillId, ask.picks);
    const funds: BillFunds = {
      workingOrderId: fromBillId,
      total,
      received: ZERO,
      reserved: ZERO,
      hasPending: false,
    };
    const addedTip = decimal(ask.addedTip ?? "0.00");
    const { doc } = await readPaymentsSettings(tx);
    // Only an items payment is offered a choice, so a share is always allocated.
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
    ) as Extract<AllocationPreview, { kind: "allocated" }>;
    return {
      total: money(total),
      applied: money(preview.applied),
      tip: money(preview.tip),
      change: preview.change === null ? null : money(preview.change),
    };
  });
}
