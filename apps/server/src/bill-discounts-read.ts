import { asc, inArray, sql } from "drizzle-orm";
import {
  readPendingDiscounts,
  workOutBillDiscounts,
  type BillDiscountLine,
  type PendingBillDiscount,
  type PendingDiscount,
  type WorkedBill,
  type WorkedBillDiscount,
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

/** A bill's {@link BillDiscountInput}, the held rows its discounts were read from by id, and the
 * name and variant of each of its lines by id. */
export interface HeldBill {
  input: BillDiscountInput;
  held: Map<string, PendingDiscount>;
  names: Map<string, { name: string; variantName: string | null }>;
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
 * Each of `billIds` that holds a discount, once and in the order it first appears, with its lines,
 * its discounts and what {@link HeldBill} keeps beside them. A bill holding none is left out,
 * having cost the one read of every bill's discounts.
 */
export async function gatherHeldBills(
  tx: Transaction,
  billIds: readonly string[],
): Promise<Map<string, HeldBill>> {
  const bills = new Map<string, HeldBill>();
  for (const row of await readPendingDiscounts(tx, billIds)) {
    let bill = bills.get(row.billId);
    if (bill === undefined) {
      bill = { input: { lines: [], discounts: [] }, held: new Map(), names: new Map() };
      bills.set(row.billId, bill);
    }
    bill.held.set(row.id, row);
    bill.input.discounts.push({
      id: row.id,
      target: targetOf(row),
      action: row.action,
      percentBp: row.percentBp,
      amount: row.amount,
      origin: row.origin,
      position: row.position,
    });
  }
  if (bills.size === 0) return bills;
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
        sql`(select value from json_each(${JSON.stringify([...bills.keys()])}))`,
      ),
    )
    .orderBy(asc(workingOrderLines.workingOrderId), asc(workingOrderLines.lineNo));
  if (rows.length === 0) return bills;
  const stored = toStoredLines(rows);
  const cohortOf = new Map(rows.map((row) => [row.id, row.cohortId]));
  rows.forEach((row, at) => {
    const fields = filedFields(stored[at]!);
    const dishCohort = row.parentLineId === null ? null : cohortOf.get(row.parentLineId);
    const bill = bills.get(row.workingOrderId)!;
    bill.names.set(row.id, { name: row.name, variantName: row.variantName });
    bill.input.lines.push({
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
  return bills;
}

/** {@link gatherHeldBills}' inputs alone. */
export async function gatherBillDiscountInputs(
  tx: Transaction,
  billIds: readonly string[],
): Promise<Map<string, BillDiscountInput>> {
  const bills = await gatherHeldBills(tx, billIds);
  return new Map([...bills].map(([billId, { input }]) => [billId, input]));
}

/**
 * `bill`'s discounts worked out once, as the shown total, the check before payment and the
 * invoice all read them. A fixed amount given as one row of the till, in rows sharing
 * `given_together` once a split left it on several lines, holds only if its rows together take
 * what they were given: each row's share takes only what its own part's prices allow (plan D10),
 * so a split weighed line can lose a cent it took whole, and then every row of it is `cut_down`.
 * What each takes is `workOutBillDiscounts`' figure, unchanged.
 */
export function workOutHeldBill({ input, held }: HeldBill): WorkedBill {
  const worked = workOutBillDiscounts(input.lines, input.discounts);
  const groups = new Map<string, WorkedBillDiscount[]>();
  for (const one of worked.discounts) {
    const key = held.get(one.id)!.givenTogether;
    groups.set(key, [...(groups.get(key) ?? []), one]);
  }
  for (const group of groups.values()) {
    const rows = group.map(({ id }) => held.get(id)!);
    const short =
      group.length > 1 &&
      rows.every(({ action }) => action === "discount_amount") &&
      group.every(({ holds }) => holds === "yes") &&
      group.reduce((sum, { takes }) => sum + takes, 0) <
        rows.reduce((sum, { amount }) => sum + amount!, 0);
    if (short) for (const one of group) one.holds = "cut_down";
  }
  return worked;
}

/**
 * What each of `billIds`' held discounts takes off now and whether it still holds, and what they
 * take together, as {@link workOutHeldBill} works them out; a bill holding none takes nothing.
 */
export async function readBillDiscounts(
  tx: Transaction,
  billIds: readonly string[],
): Promise<Map<string, WorkedBill>> {
  const bills = await gatherHeldBills(tx, billIds);
  return new Map(
    [...new Set(billIds)].map((billId) => {
      const bill = bills.get(billId);
      return [billId, bill === undefined ? { discounts: [], takes: 0 } : workOutHeldBill(bill)];
    }),
  );
}
