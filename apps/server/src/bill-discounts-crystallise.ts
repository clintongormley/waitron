import { eq, inArray } from "drizzle-orm";
import {
  adjustmentLines,
  coveredBySetMenu,
  deletePendingDiscounts,
  lineGross,
  recordAdjustment,
  workOutBillDiscounts,
  type PendingBillDiscount,
  type WorkedBillDiscount,
} from "@waitron/adjustments";
import {
  billDiscounts,
  insertInChunks,
  recordActivity,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import { staffPresentationName } from "@waitron/menu";
import {
  AppError,
  centsToDecimal,
  decimalToCents,
  sumDecimals,
  thousandthsToDecimal,
  type ErrorParams,
} from "@waitron/shared";
import { listValue, readRows, stageOf, type Row } from "./adjustment-rows.js";
import { reprice, type Change } from "./adjustment-reprice.js";
import { gatherBillDiscountInputs } from "./bill-discounts-read.js";
import type { TradingContext } from "./trading-context.js";
import { bumpRevision } from "./working-order-edit-state.js";
import "./errors.js";

type NotHolding = ErrorParams["adjustment.no_longer_applies"]["discounts"][number];

/** What each of `worked` that does not hold was given on, as the refusal names it. */
async function notHolding(
  tx: Transaction,
  worked: readonly WorkedBillDiscount[],
): Promise<NotHolding[]> {
  const ids = worked.filter(({ holds }) => holds !== "yes").map(({ id }) => id);
  if (ids.length === 0) return [];
  const rows = await tx
    .select({
      id: billDiscounts.id,
      action: billDiscounts.action,
      percentBp: billDiscounts.percentBp,
      amount: billDiscounts.amount,
      setMenuName: billDiscounts.setMenuName,
      lineName: workingOrderLines.name,
      variantName: workingOrderLines.variantName,
      parentLineId: workingOrderLines.parentLineId,
    })
    .from(billDiscounts)
    .leftJoin(workingOrderLines, eq(workingOrderLines.id, billDiscounts.lineId))
    .where(inArray(billDiscounts.id, ids));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return worked.flatMap(({ id, holds }): NotHolding[] => {
    if (holds === "yes") return [];
    const row = byId.get(id)!;
    const on: NotHolding["on"] =
      row.lineName !== null
        ? {
            kind: row.parentLineId === null ? "dish" : "extra",
            targetName: staffPresentationName({ name: row.lineName, variantName: row.variantName }),
          }
        : row.setMenuName !== null
          ? { kind: "set_menu", targetName: row.setMenuName }
          : { kind: "bill", targetName: null };
    return [
      {
        discountId: id,
        why: holds,
        on,
        action: row.action,
        percentBp: row.percentBp,
        amount: row.amount === null ? null : centsToDecimal(row.amount),
      },
    ];
  });
}

async function refuseIfAny(
  tx: Transaction,
  billId: string,
  worked: readonly WorkedBillDiscount[],
): Promise<void> {
  const discounts = await notHolding(tx, worked);
  if (discounts.length > 0) {
    throw new AppError("adjustment.no_longer_applies", { workingOrderId: billId, discounts });
  }
}

/**
 * Refuses `adjustment.no_longer_applies` when any discount held on `billId` would be written
 * other than as given (spec 6.6), naming each; writes nothing.
 */
export async function refuseDiscountsNotHolding(tx: Transaction, billId: string): Promise<void> {
  const input = (await gatherBillDiscountInputs(tx, [billId])).get(billId);
  if (input !== undefined)
    await refuseIfAny(tx, billId, workOutBillDiscounts(input.lines, input.discounts).discounts);
}

/** The rows `discount` covers, as the working-out spreads it: a dish with its extras, a set menu's
 * row with the dishes it covers, or every row. */
function coveredRows(discount: PendingBillDiscount, rows: readonly Row[]): Row[] {
  const { target } = discount;
  if (target.kind === "bill") return [...rows];
  const line = rows.find(({ id }) => id === target.lineId);
  if (line === undefined) return [];
  if (target.kind === "set_menu") return [line, ...coveredBySetMenu(line.id, rows)];
  const extras =
    discount.origin === "given" ? rows.filter((row) => row.parentLineId === line.id) : [];
  return [line, ...extras];
}

/** Writes `worked`, the first discount in order on the bill as it stands, and deletes its row. */
async function writeOne(
  tx: Transaction,
  cfg: TradingContext,
  billId: string,
  discount: PendingBillDiscount,
  worked: WorkedBillDiscount,
): Promise<void> {
  const [held] = await tx.select().from(billDiscounts).where(eq(billDiscounts.id, discount.id));
  // Before the prices change, so a split of the line does not copy this discount to its part.
  await deletePendingDiscounts(tx, [discount.id]);
  if (worked.lines.length === 0) return;
  const rows = await readRows(tx, billId);
  const rowOf = new Map(rows.map((row) => [row.id, row]));
  const changes: Change[] = worked.lines.map(({ lineId, rows: priced }) => {
    const row = rowOf.get(lineId)!;
    if (priced.length > 2) throw new Error(`line ${lineId} was left at more than two prices`);
    return {
      row,
      carved: false,
      rows: priced.map(({ quantity, unit }) => ({
        quantity: thousandthsToDecimal(quantity),
        unitGross: centsToDecimal(unit),
      })),
      reduction: centsToDecimal(row.lineTotal - priced.reduce((sum, { total }) => sum + total, 0)),
    };
  });
  const { splits, taken } = await reprice(tx, cfg, billId, null, changes, []);
  await bumpRevision(tx, [billId]);
  const covered = coveredRows(discount, rows);
  const before = sumDecimals(covered.map((row) => lineGross(row, row.quantity)));
  const reduction = sumDecimals(taken.map((line) => line.reduction));
  const line = discount.target.kind === "bill" ? null : covered[0]!;
  const dish = line?.parentLineId == null ? line : rowOf.get(line.parentLineId)!;
  const id = await recordAdjustment(tx, {
    workingOrderId: billId,
    line:
      line === null
        ? null
        : {
            id: line.id,
            name: staffPresentationName(line),
            quantity: thousandthsToDecimal(line.quantity),
            listUnitPriceGross: centsToDecimal(line.list ?? line.unit),
            creditedTo: line.creditedTo,
            stage: stageOf(dish!),
          },
    splits,
    quantity: line === null ? null : thousandthsToDecimal(line.quantity),
    reason: { id: held!.reasonId, name: held!.reasonName, policy: held!.policySnapshot },
    action: held!.action,
    percentBp: held!.percentBp,
    beforeAmount: before,
    afterAmount: centsToDecimal(decimalToCents(before) - decimalToCents(reduction)),
    reduction,
    nominalValue: sumDecimals(covered.map((row) => listValue(row, row.quantity))),
    requestedBy: held!.requestedBy,
    approvedBy: held!.approvedBy,
    note: held!.note,
  });
  await insertInChunks(
    tx,
    adjustmentLines,
    taken.map((line) => ({
      adjustmentId: id,
      lineId: line.lineId,
      reduction: decimalToCents(line.reduction),
      quantity: line.quantity,
    })),
  );
}

/**
 * Writes every discount held on `billId` into its lines and records it (plan A1621 D5), one at a
 * time in spec 7.2's order, each worked out on the bill as the ones before it left it, and deletes
 * its pending row. `asked`: a discount that no longer holds refuses `adjustment.no_longer_applies`
 * before anything is written. Otherwise it is written as it stands, with a
 * `discount.written_as_it_stood` activity entry (D20).
 */
export async function crystalliseBillDiscounts(
  tx: Transaction,
  cfg: TradingContext,
  billId: string,
  options: { asked: boolean },
): Promise<void> {
  let checked = false;
  for (;;) {
    const input = (await gatherBillDiscountInputs(tx, [billId])).get(billId);
    if (input === undefined) return;
    // Spec 7.2's order, as the bill's shown total works it out.
    const { discounts } = workOutBillDiscounts(input.lines, input.discounts);
    if (options.asked && !checked) await refuseIfAny(tx, billId, discounts);
    checked = true;
    const worked = discounts[0]!;
    await writeOne(
      tx,
      cfg,
      billId,
      input.discounts.find(({ id }) => id === worked.id)!,
      worked,
    );
    if (worked.holds !== "yes") {
      await recordActivity(tx, {
        kind: "discount.written_as_it_stood",
        subjectId: billId,
        personId: null,
        data: { discountId: worked.id, why: worked.holds, takes: centsToDecimal(worked.takes) },
      });
    }
  }
}
