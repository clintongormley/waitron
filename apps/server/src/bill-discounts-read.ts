import { asc, inArray, sql } from "drizzle-orm";
import {
  readPendingDiscounts,
  workOutBillDiscounts,
  type BillDiscountLine,
  type PendingBillDiscount,
  type PendingDiscount,
  type WorkedBill,
} from "@waitron/adjustments";
import { workingOrderLines, type Transaction } from "@waitron/db";
import { decimal } from "@waitron/shared";
import { canonical } from "./adjustment-rows.js";
import { storedLineColumns, toStoredLines, type StoredOrderLine } from "./stored-order-lines.js";

/** A bill's lines and the discounts it holds, as `workOutBillDiscounts` takes them. */
export interface BillDiscountInput {
  lines: BillDiscountLine[];
  discounts: PendingBillDiscount[];
}

function targetOf(row: PendingDiscount): PendingBillDiscount["target"] {
  if (row.lineId !== null) return { kind: "line", lineId: row.lineId };
  if (row.setMenuId !== null) return { kind: "set_menu", lineId: row.setMenuLineId };
  return { kind: "bill" };
}

/** What `projectPortionSale` compares of a line, but its price, its quantity and its dish, with the
 * list price a discount would stamp (`list ?? price`), so the group is the same before and after
 * any discount. */
function filedFields({ identity, locked }: StoredOrderLine): string {
  return canonical({
    identity: {
      ...identity,
      id: null,
      listUnitGross: identity.listUnitGross ?? decimal(locked.grossUnitPrice),
    },
    locked: { ...locked, grossUnitPrice: null, quantity: null, parentLineNo: null },
  });
}

/**
 * Each of `billIds` that holds a discount, once and in the order it first appears, with its lines
 * and its discounts. A bill holding none is left out, having cost the one read of every bill's
 * discounts.
 */
export async function gatherBillDiscountInputs(
  tx: Transaction,
  billIds: readonly string[],
): Promise<Map<string, BillDiscountInput>> {
  const inputs = new Map<string, BillDiscountInput>();
  for (const row of await readPendingDiscounts(tx, billIds)) {
    let input = inputs.get(row.billId);
    if (input === undefined) {
      input = { lines: [], discounts: [] };
      inputs.set(row.billId, input);
    }
    input.discounts.push({
      id: row.id,
      target: targetOf(row),
      action: row.action,
      percentBp: row.percentBp,
      amount: row.amount,
      origin: row.origin,
      position: row.position,
    });
  }
  if (inputs.size === 0) return inputs;
  const rows = await tx
    .select({
      ...storedLineColumns,
      workingOrderId: workingOrderLines.workingOrderId,
      lineNo: workingOrderLines.lineNo,
      setMenuLineId: workingOrderLines.setMenuLineId,
      lineTotal: workingOrderLines.lineTotal,
      cohortId: workingOrderLines.cohortId,
      ordinal: workingOrderLines.cohortOrdinal,
    })
    .from(workingOrderLines)
    .where(
      inArray(
        workingOrderLines.workingOrderId,
        sql`(select value from json_each(${JSON.stringify([...inputs.keys()])}))`,
      ),
    )
    .orderBy(asc(workingOrderLines.workingOrderId), asc(workingOrderLines.lineNo));
  if (rows.length === 0) return inputs;
  const stored = toStoredLines(rows);
  const cohortOf = new Map(rows.map((row) => [row.id, row.cohortId]));
  rows.forEach((row, at) => {
    const fields = filedFields(stored[at]!);
    const dishCohort = row.parentLineId === null ? null : cohortOf.get(row.parentLineId);
    inputs.get(row.workingOrderId)!.lines.push({
      id: row.id,
      lineNo: row.lineNo,
      parentLineId: row.parentLineId,
      setMenuLineId: row.setMenuLineId,
      quantity: row.quantity,
      priceQuantity: row.priceQuantity,
      unit: row.grossUnitPrice,
      unitPrecision: row.unitPrecision,
      lineTotal: row.lineTotal,
      portion:
        row.cohortId !== null
          ? { group: JSON.stringify([row.cohortId, fields]), ordinal: row.ordinal! }
          : dishCohort != null
            ? { group: fields, ordinal: 0 }
            : null,
    });
  });
  return inputs;
}

/**
 * What each of `billIds`' held discounts takes off now and whether it still holds, and what they
 * take together, as `workOutBillDiscounts` works them out; a bill holding none takes nothing.
 */
export async function readBillDiscounts(
  tx: Transaction,
  billIds: readonly string[],
): Promise<Map<string, WorkedBill>> {
  const inputs = await gatherBillDiscountInputs(tx, billIds);
  return new Map(
    [...new Set(billIds)].map((billId) => {
      const input = inputs.get(billId);
      return [
        billId,
        input === undefined
          ? { discounts: [], takes: 0 }
          : workOutBillDiscounts(input.lines, input.discounts),
      ];
    }),
  );
}
