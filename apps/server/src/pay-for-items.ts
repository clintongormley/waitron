import { and, count, eq, isNull } from "drizzle-orm";
import { workingOrderLines, workingOrders, type Transaction } from "@waitron/db";
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
import { money } from "./bill-allocation.js";
import { issueIfFullyPaid } from "./bill-payments.js";
import type { BillEditExpected } from "./order-drafts.js";
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
  // A set menu's dish chosen with its set menu is already in the set menu's price.
  const ids = new Set(picked.map((line) => line.id));
  return picked.map((line) => {
    const menu = byId.get(line.id)!.setMenuLineId;
    return menu !== null && ids.has(menu) ? { ...line, familyCents: 0 } : line;
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
