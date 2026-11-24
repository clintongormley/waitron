import { and, count, eq, isNull } from "drizzle-orm";
import { withIssuanceTransaction } from "@waitron/core";
import {
  billPayments,
  withTransaction,
  workingOrderLines,
  workingOrders,
  type Database,
  type Transaction,
} from "@waitron/db";
import { readPaymentsSettings } from "@waitron/payments";
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
import {
  guardPathParty,
  moveDishes,
  refuseClosedBill,
  resolveMoveLines,
  type BillCommand,
} from "./bill-actions.js";
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
  diskFullBeforePayment,
  issueIfFullyPaid,
  takeBillPaymentIn,
  type BillPaymentDeps,
  type BillPaymentRequest,
  type BillPaymentResult,
} from "./bill-payments.js";
import type { BillEditExpected } from "./order-drafts.js";
import { fingerprint } from "./parties.js";
import type { TillSaleResult } from "./till-sale.js";
import { requireEconomicWrite, type TradingAdmission } from "./trading-admission.js";
import type { DeviceRequestConfig, OriginConfig } from "./trading-context.js";
import {
  splitLinesWithinOrder,
  storedOrderTotal,
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
): Promise<PickedLine[]> {
  const rows = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      parentLineId: workingOrderLines.parentLineId,
      setMenuLineId: workingOrderLines.setMenuLineId,
      name: workingOrderLines.name,
      quantity: workingOrderLines.quantity,
      lineTotal: workingOrderLines.lineTotal,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const extrasCents = new Map<string, number>();
  for (const row of rows) {
    if (row.parentLineId === null) continue;
    extrasCents.set(row.parentLineId, (extrasCents.get(row.parentLineId) ?? 0) + row.lineTotal);
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
  const seen = new Set<string>();
  const picked = picks.map((pick): PickedLine => {
    const row = byId.get(pick.lineId);
    if (row === undefined)
      throw new AppError("tab.line_not_found", { tabId: billId, lineId: pick.lineId });
    if (row.parentLineId !== null)
      throw new AppError("tab.transfer_modifier_line", { tabId: billId, lineNo: row.lineNo });
    if (seen.has(row.id))
      throw new AppError("tab.transfer_duplicate_line", { tabId: billId, lineNo: row.lineNo });
    seen.add(row.id);
    const familyCents = ownCents(row.id) + (dishesCents.get(row.id) ?? 0);
    if (pick.quantity === undefined) return { id: row.id, lineNo: row.lineNo, familyCents };
    const quantity = pickedThousandths(pick.quantity);
    if (quantity === null || quantity <= 0 || quantity > row.quantity) {
      throw new AppError("tab.transfer_quantity_invalid", {
        tabId: billId,
        lineNo: row.lineNo,
        quantity: String(pick.quantity),
      });
    }
    return quantity === row.quantity
      ? { id: row.id, lineNo: row.lineNo, familyCents }
      : {
          id: row.id,
          lineNo: row.lineNo,
          familyCents,
          part: { quantity: pick.quantity, ofQuantity: row.quantity },
        };
  });
  // A set menu's dish chosen with its set menu is already in the set menu's price; chosen without
  // it, the new bill has no set menu to place it in, as the move would find.
  const ids = new Set(picked.map((line) => line.id));
  return picked.map((line) => {
    const row = byId.get(line.id)!;
    if (row.setMenuLineId === null) return line;
    if (!ids.has(row.setMenuLineId))
      throw new AppError("set_menu.no_place_on_target", { dishName: row.name });
    return { ...line, familyCents: 0 };
  });
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
  return priceOf(await readPicks(tx, fromBillId, picks));
}

/**
 * Refuse (D7) a move of `lineIds` that would take every dish, a set menu's dishes counted as
 * {@link resolveMoveLines} brings them along. Before the move: `moveDishes` asks its merge-invoice
 * question of a move that empties the bill.
 */
async function refuseEveryDish(
  tx: Transaction,
  billId: string,
  lineIds: readonly string[],
): Promise<void> {
  const { transfers } = await resolveMoveLines(tx, billId, lineIds);
  const [row] = await tx
    .select({ dishes: count() })
    .from(workingOrderLines)
    .where(
      and(eq(workingOrderLines.workingOrderId, billId), isNull(workingOrderLines.parentLineId)),
    );
  if (transfers.length === row!.dishes) throw new AppError("bill.all_items_chosen", {});
}

/** Refuse (D4) a bill the move left owing less than its advances credit, read as it was left. */
async function refuseBelowAdvances(tx: Transaction, billId: string): Promise<void> {
  const advances = await readBillAdvances(tx, [billId]);
  const credited = sumDecimals((advances.credits.get(billId) ?? []).map((credit) => credit.gross));
  if (compareDecimal(await storedOrderTotal(tx, billId), credited) < 0)
    throw new AppError("bill.below_advances", { advances: money(credited) });
}

/**
 * Move the chosen items, part of a line included, from an open bill to a new bill of its party (a
 * new counter order when it has none) that names the bill they came from, and issue the source
 * when what is left of it is paid. The source may be left holding more than it owes; the kitchen
 * is not told, as the items stay where they are served.
 */
export async function moveItemsToNewBill(
  tx: Transaction,
  cfg: OriginConfig,
  fromBillId: string,
  picks: readonly ItemPick[],
  command: BillCommand & { expectedEdits: BillEditExpected[]; admission: TradingAdmission },
  sale: { deps: TillSaleDeps; cfg: DeviceRequestConfig },
): Promise<{ billId: string; invoice?: TillSaleResult }> {
  if (picks.length === 0) throw new AppError("sale.empty_basket", {});
  // `moveDishes` runs these too; here they come before the split, so a stale or closed bill gets
  // its own refusal.
  await requireEconomicWrite(tx, cfg, command.admission);
  const path = await guardPathParty(tx, fromBillId, command, { bump: false });
  refuseClosedBill(fromBillId, path.status);
  const picked = await readPicks(tx, fromBillId, picks);
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
  await refuseEveryDish(tx, fromBillId, lineIds);
  const { billId } = await moveDishes(tx, cfg, fromBillId, null, lineIds, command, {
    sourceMayBeOverpaid: true,
    tellKitchen: false,
  });
  await tx
    .update(workingOrders)
    .set({ itemsPaidFrom: fromBillId })
    .where(eq(workingOrders.id, billId));
  await refuseBelowAdvances(tx, fromBillId);
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
 * Pay for the chosen items, cash or a hand-keyed card, on a bill of their own: in one transaction
 * they move to a new bill ({@link moveItemsToNewBill}) and the payment covers it whole, issuing its
 * ticket. A resend of the same submission answers as the first did.
 */
export async function payForItems(
  deps: BillPaymentDeps,
  cfg: DeviceRequestConfig,
  fromBillId: string,
  req: PayForItemsRequest,
  operator: { personId: string; sessionId: string },
): Promise<{ billId: string; payment: BillPaymentResult }> {
  if (req.entry === "reader") throw invalid("entry");
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
    ...(req.method === "cash" ? { tendered: req.tendered! } : { entry: "manual" as const }),
    ...(req.addedTip === undefined ? {} : { addedTip: req.addedTip }),
  });
  const pending = diskFullBeforePayment(deps);
  const preRead = pending !== false && (await pending);
  return withIssuanceTransaction(
    deps.db,
    async (tx) => {
      const earlier = await earlierItemsBill(tx, fromBillId, req.submissionId);
      if (earlier !== undefined) {
        return {
          billId: earlier,
          payment: await takeBillPaymentIn(tx, deps, cfg, earlier, payment(null), operator, {
            preRead,
            print,
          }),
        };
      }
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
      );
      const expectedEdit = await readBillEditState(tx, billId);
      return {
        billId,
        payment: await takeBillPaymentIn(tx, deps, cfg, billId, payment(expectedEdit), operator, {
          preRead,
          print,
        }),
      };
    },
    deps.log,
  );
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
