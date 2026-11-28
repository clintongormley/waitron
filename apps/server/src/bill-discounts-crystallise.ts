import { eq, inArray } from "drizzle-orm";
import {
  adjustmentLines,
  coveredBySetMenu,
  deletePendingDiscounts,
  lineGross,
  recordAdjustment,
  workOutBillDiscounts,
  type BillDiscountRow,
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

/** The bill's rows as crystallising leaves them, each under the id the working-out gives its
 * part: a line's own id for the line, or the id of a part split off it. */
interface Parts {
  rowOf: Map<string, Row>;
  partsOf: Map<string, string[]>;
}

/** The rows `discount` covers as its working-out spreads it, every part of each: a dish with its
 * extras, a set menu's row with the dishes it covers that are charged, or every row. */
function coveredRows(discount: PendingBillDiscount, parts: Parts): Row[] {
  const { target } = discount;
  const rows = [...parts.rowOf.values()];
  if (target.kind === "bill") return rows;
  const lineId = target.lineId!;
  const own = parts.partsOf.get(lineId)!.map((id) => parts.rowOf.get(id)!);
  if (target.kind === "set_menu") return [...own, ...coveredBySetMenu(lineId, rows)];
  const extras =
    discount.origin === "given" ? rows.filter((row) => row.parentLineId === lineId) : [];
  return [...own, ...extras];
}

/** A change to one part, with the part `worked` split off it. */
interface PartChange {
  lineId: string;
  change: Change;
  priced: BillDiscountRow;
  split: BillDiscountRow | null;
}

/** What `worked` changes of each part: its new price and quantity, and the part split off it,
 * each split part paired with the part whose quantity fell by as much. */
function partChanges(worked: WorkedBillDiscount, parts: Parts): PartChange[] {
  return worked.lines.flatMap(({ lineId, rows: after }) => {
    const known = parts.partsOf.get(lineId)!;
    const afterOf = new Map(after.map((row) => [row.id, row]));
    if (known.some((id) => !afterOf.has(id))) throw new Error(`line ${lineId} lost a part`);
    const fell = new Map(
      known.map((id) => [id, parts.rowOf.get(id)!.quantity - afterOf.get(id)!.quantity]),
    );
    const splitOf = new Map<string, BillDiscountRow>();
    for (const split of after
      .filter(({ id }) => !known.includes(id))
      .sort((a, b) => a.lineNo - b.lineNo)) {
      const from = known.find((id) => !splitOf.has(id) && fell.get(id) === split.quantity);
      if (from === undefined) throw new Error(`part ${split.id} was split off no part of its line`);
      splitOf.set(from, split);
    }
    return known.flatMap((id): PartChange[] => {
      const row = parts.rowOf.get(id)!;
      const priced = afterOf.get(id)!;
      const split = splitOf.get(id) ?? null;
      if (split === null && fell.get(id) !== 0)
        throw new Error(`part ${id} lost what no part took`);
      if (split === null && priced.unit === row.unit) return [];
      return [
        {
          lineId,
          change: {
            row,
            carved: false,
            rows: [priced, ...(split === null ? [] : [split])].map(({ quantity, unit }) => ({
              quantity: thousandthsToDecimal(quantity),
              unitGross: centsToDecimal(unit),
            })),
            reduction: centsToDecimal(row.lineTotal - priced.total - (split?.total ?? 0)),
          },
          priced,
          split,
        },
      ];
    });
  });
}

/** Writes `worked`'s figures into the parts it moved and records it once over every part it
 * covers; answers nothing, having left `parts` as the bill now stands. */
async function writeWorked(
  tx: Transaction,
  cfg: TradingContext,
  billId: string,
  parts: Parts,
  given: { discount: PendingBillDiscount; held: HeldDiscount; line: Row | null; dish: Row | null },
  worked: WorkedBillDiscount,
): Promise<void> {
  const { discount, held, line, dish } = given;
  const covered = coveredRows(discount, parts).map((row) => ({ ...row }));
  const changed = partChanges(worked, parts);
  // Split parts numbered in the order the working-out numbered them.
  changed.sort((a, b) => (a.split?.lineNo ?? 0) - (b.split?.lineNo ?? 0));
  const { splits, taken } = await reprice(
    tx,
    cfg,
    billId,
    null,
    changed.map(({ change }) => change),
    [],
  );
  const splitIds = splits.map(({ to }) => to);
  const numbered = new Map(
    splitIds.length === 0
      ? []
      : (
          await tx
            .select({ id: workingOrderLines.id, lineNo: workingOrderLines.lineNo })
            .from(workingOrderLines)
            .where(inArray(workingOrderLines.id, splitIds))
        ).map(({ id, lineNo }) => [id, lineNo]),
  );
  for (const { lineId, priced, split } of changed) {
    const row = parts.rowOf.get(priced.id)!;
    row.list ??= row.unit;
    if (split !== null) {
      const id = splits.find(({ from }) => from === row.id)!.to;
      parts.rowOf.set(split.id, {
        ...row,
        id,
        lineNo: numbered.get(id)!,
        quantity: split.quantity,
        unit: split.unit,
        lineTotal: split.total,
      });
      parts.partsOf.get(lineId)!.push(split.id);
    }
    Object.assign(row, { quantity: priced.quantity, unit: priced.unit, lineTotal: priced.total });
  }
  const before = sumDecimals(covered.map((row) => lineGross(row, row.quantity)));
  const reduction = sumDecimals(taken.map((one) => one.reduction));
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
    reason: { id: held.reasonId, name: held.reasonName, policy: held.policySnapshot },
    action: held.action,
    percentBp: held.percentBp,
    beforeAmount: before,
    afterAmount: centsToDecimal(decimalToCents(before) - decimalToCents(reduction)),
    reduction,
    nominalValue: sumDecimals(covered.map((row) => listValue(row, row.quantity))),
    requestedBy: held.requestedBy,
    approvedBy: held.approvedBy,
    note: held.note,
  });
  if (taken.length > 0) {
    await insertInChunks(
      tx,
      adjustmentLines,
      taken.map((one) => ({
        adjustmentId: id,
        lineId: one.lineId,
        reduction: decimalToCents(one.reduction),
        quantity: one.quantity,
      })),
    );
  }
}

type HeldDiscount = typeof billDiscounts.$inferSelect;

/**
 * Writes every discount held on `billId` into its lines and records it, and deletes the bill's
 * pending rows (plan A1621 D5): the bill's discounts are worked out once, as its shown total works
 * them out, and each is written with exactly those figures, one record over every line and part it
 * covers. `asked`: a discount that no longer holds refuses `adjustment.no_longer_applies` before
 * anything is written. Otherwise it is written as it stands, with a `discount.written_as_it_stood`
 * activity entry (D20).
 */
export async function crystalliseBillDiscounts(
  tx: Transaction,
  cfg: TradingContext,
  billId: string,
  options: { asked: boolean },
): Promise<void> {
  const input = (await gatherBillDiscountInputs(tx, [billId])).get(billId);
  if (input === undefined) return;
  const { discounts: worked } = workOutBillDiscounts(input.lines, input.discounts);
  const standing = await notHolding(tx, worked);
  if (options.asked && standing.length > 0) {
    throw new AppError("adjustment.no_longer_applies", {
      workingOrderId: billId,
      discounts: standing,
    });
  }
  const ids = input.discounts.map(({ id }) => id);
  const heldOf = new Map(
    (await tx.select().from(billDiscounts).where(inArray(billDiscounts.id, ids))).map((row) => [
      row.id,
      row,
    ]),
  );
  // Before any price changes, so a split made while writing copies no pending row to its part.
  await deletePendingDiscounts(tx, ids);
  const rows = await readRows(tx, billId);
  const lineOf = new Map(rows.map((row) => [row.id, row]));
  const parts: Parts = {
    rowOf: new Map(rows.map((row) => [row.id, { ...row }])),
    partsOf: new Map(rows.map(({ id }) => [id, [id]])),
  };
  for (const one of worked) {
    const discount = input.discounts.find(({ id }) => id === one.id)!;
    const held = heldOf.get(one.id)!;
    if (one.lines.length > 0) {
      const line = discount.target.kind === "bill" ? null : lineOf.get(discount.target.lineId!)!;
      const dish = line?.parentLineId == null ? line : lineOf.get(line.parentLineId)!;
      await writeWorked(tx, cfg, billId, parts, { discount, held, line, dish }, one);
    }
    const stood = standing.find(({ discountId }) => discountId === one.id);
    if (stood !== undefined) {
      await recordActivity(tx, {
        kind: "discount.written_as_it_stood",
        subjectId: billId,
        personId: held.requestedBy,
        data: {
          discountId: one.id,
          why: stood.why,
          takes: centsToDecimal(one.takes),
          on: stood.on,
          action: stood.action,
          percentBp: stood.percentBp,
          amount: stood.amount,
          reasonId: held.reasonId,
          reasonName: held.reasonName,
          requestedBy: held.requestedBy,
          approvedBy: held.approvedBy,
        },
      });
    }
  }
  await bumpRevision(tx, [billId]);
}
