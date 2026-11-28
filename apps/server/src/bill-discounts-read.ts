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

export function targetOf(row: PendingDiscount): PendingBillDiscount["target"] {
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
 * invoice all read them. A fixed amount holds only if its rows, those sharing its
 * `given_together` (one till row, and the parts a split left it on), together take what they
 * were given, off the prices they are spread over or off the invoice; otherwise every row of it
 * is `cut_down`. Each share takes only what its own part's
 * whole-cent prices allow (plan D10), and a split copies no share of nothing, so a split can
 * leave a weighed line taking less than it took whole. An amount is not `cut_down` when its
 * shares would take all of it off the prices they are spread over and only the invoice's filed
 * rows take less (then, if the invoice would lose nothing, no line changes), nor when the filed
 * rows take all of it. What each takes is `workOutBillDiscounts`'
 * figure, unchanged.
 */
export function workOutHeldBill(bill: HeldBill): WorkedBill {
  const { input, held } = bill;
  const worked = workOutBillDiscounts(input.lines, input.discounts);
  for (const group of givenTogether(bill, worked.discounts)) {
    const rows = group.map(({ id }) => held.get(id)!);
    const given = rows.reduce((sum, { amount }) => sum + (amount ?? 0), 0);
    const short =
      rows.every(({ action }) => action === "discount_amount") &&
      group.every(({ holds }) => holds === "yes") &&
      group.reduce((sum, { takes }) => sum + takes, 0) < given &&
      group.reduce((sum, { takes, spreadTakes }) => sum + (spreadTakes ?? takes), 0) < given;
    if (short) for (const one of group) one.holds = "cut_down";
  }
  return worked;
}

/** `worked`, the rows of each discount given as one till row together (`given_together`), in the
 * order each one's first row is worked out. */
export function givenTogether(
  bill: HeldBill,
  worked: readonly WorkedBillDiscount[],
): WorkedBillDiscount[][] {
  const groups = new Map<string, WorkedBillDiscount[]>();
  for (const one of worked) {
    const key = bill.held.get(one.id)!.givenTogether;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [one]);
    else group.push(one);
  }
  return [...groups.values()];
}

function workedOf(bill: HeldBill | undefined): WorkedBill {
  return bill === undefined ? { discounts: [], takes: 0 } : workOutHeldBill(bill);
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
  return new Map([...new Set(billIds)].map((billId) => [billId, workedOf(bills.get(billId))]));
}

/** One bill's held discounts, gathered and worked out once, for the shown total, the check before
 * payment and the invoice write to share while nothing writes the bill's lines or held discounts
 * between them. `bill` is absent when it holds none. */
export interface BillDiscounts {
  bill: HeldBill | undefined;
  worked: WorkedBill;
}

/** `billId`'s {@link BillDiscounts}. */
export async function readHeldBillDiscounts(
  tx: Transaction,
  billId: string,
): Promise<BillDiscounts> {
  const bill = (await gatherHeldBills(tx, [billId])).get(billId);
  return { bill, worked: workedOf(bill) };
}
