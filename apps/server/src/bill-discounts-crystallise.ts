import { inArray } from "drizzle-orm";
import {
  adjustmentLines,
  coveredBySetMenu,
  deletePendingDiscounts,
  lineGross,
  recordAdjustment,
  type BillDiscountRow,
  type PendingBillDiscount,
  type PendingDiscount,
  type WorkedBillDiscount,
} from "@waitron/adjustments";
import {
  insertInChunks,
  recordActivity,
  workingOrderLines,
  type AdjustmentSplit,
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
import { gatherHeldBills, workOutHeldBill, type HeldBill } from "./bill-discounts-read.js";
import type { TradingContext } from "./trading-context.js";
import { bumpRevision } from "./working-order-edit-state.js";
import "./errors.js";

type NotHolding = ErrorParams["adjustment.no_longer_applies"]["discounts"][number];

/** What each of `worked` that does not hold was given on, as the refusal names it. */
function notHolding(bill: HeldBill, worked: readonly WorkedBillDiscount[]): NotHolding[] {
  return worked.flatMap(({ id, holds }): NotHolding[] => {
    if (holds === "yes") return [];
    const row = bill.held.get(id)!;
    const line = bill.input.lines.find(({ id: lineId }) => lineId === row.lineId);
    const on: NotHolding["on"] =
      line !== undefined
        ? {
            kind: line.parentLineId === null ? "dish" : "extra",
            targetName: staffPresentationName(bill.names.get(line.id)!),
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

/**
 * Refuses `adjustment.no_longer_applies` when any discount held on `billId` would be written
 * other than as given (spec 6.6), naming each; writes nothing.
 */
export async function refuseDiscountsNotHolding(tx: Transaction, billId: string): Promise<void> {
  const bill = (await gatherHeldBills(tx, [billId])).get(billId);
  if (bill === undefined) return;
  const discounts = notHolding(bill, workOutHeldBill(bill).discounts);
  if (discounts.length > 0) {
    throw new AppError("adjustment.no_longer_applies", { workingOrderId: billId, discounts });
  }
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

/** What one discount's writing left to record: the parts it covered as it found them, the rows it
 * split off, what it took off each line, and what the lines' own totals fell by in cents. */
interface Written {
  covered: Row[];
  splits: AdjustmentSplit[];
  lines: LineTaken[];
  fell: number;
}

/** Writes `worked`'s figures into the parts it moved, leaving `parts` as the bill now stands. */
async function writeWorked(
  tx: Transaction,
  cfg: TradingContext,
  billId: string,
  parts: Parts,
  discount: PendingBillDiscount,
  worked: WorkedBillDiscount,
): Promise<Written> {
  const covered = coveredRows(discount, parts).map((row) => ({ ...row }));
  const changed = partChanges(worked, parts);
  // Split parts numbered in the order the working-out numbered them.
  changed.sort((a, b) => (a.split?.lineNo ?? 0) - (b.split?.lineNo ?? 0));
  const { splits, taken } =
    changed.length === 0
      ? { splits: [], taken: [] }
      : await reprice(
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
  const own = taken.map((one) => ({ ...one, reduction: decimalToCents(one.reduction) }));
  const lines = fitted(own, worked.takes, () => ({
    lineId: changed[0]!.change.row.id,
    quantity: changed[0]!.priced.quantity,
  }));
  return { covered, splits, lines, fell: own.reduce((sum, { reduction }) => sum + reduction, 0) };
}

/** One discount given as one row of the till (`given_together`), though a split left it on
 * several lines: the held row of its first part, the line that part is on and its dish, the
 * quantity of every part's line, and what writing each part left to record. */
interface Given {
  held: PendingDiscount;
  line: Row | null;
  dish: Row | null;
  quantity: number;
  written: Written[];
}

/**
 * Records `given` once over every line and part its parts covered (plan D5). On a bill whose
 * filed rows round apart from its lines, what the discount takes off the invoice differs from what
 * the lines' own totals fell by, so the record's after amount is what the lines it covered cost
 * now, never below nothing, and its before amount that plus what it took off.
 */
async function recordGiven(tx: Transaction, billId: string, given: Given): Promise<void> {
  const { held, line, dish, quantity } = given;
  const covered = given.written.flatMap((one) => one.covered);
  const after =
    decimalToCents(sumDecimals(covered.map((row) => lineGross(row, row.quantity)))) -
    given.written.reduce((sum, { fell }) => sum + fell, 0);
  const lines = given.written.flatMap((one) => one.lines);
  const takes = lines.reduce((sum, { reduction }) => sum + reduction, 0);
  const id = await recordAdjustment(tx, {
    workingOrderId: billId,
    line:
      line === null
        ? null
        : {
            id: line.id,
            name: staffPresentationName(line),
            quantity: thousandthsToDecimal(quantity),
            listUnitPriceGross: centsToDecimal(line.list ?? line.unit),
            creditedTo: line.creditedTo,
            stage: stageOf(dish!),
          },
    splits: given.written.flatMap(({ splits }) => splits),
    quantity: line === null ? null : thousandthsToDecimal(quantity),
    reason: { id: held.reasonId, name: held.reasonName, policy: held.policySnapshot },
    action: held.action,
    percentBp: held.percentBp,
    beforeAmount: centsToDecimal(after + takes),
    afterAmount: centsToDecimal(after),
    reduction: centsToDecimal(takes),
    nominalValue: sumDecimals(covered.map((row) => listValue(row, row.quantity))),
    requestedBy: held.requestedBy,
    approvedBy: held.approvedBy,
    note: held.note,
  });
  if (lines.length > 0) {
    await insertInChunks(
      tx,
      adjustmentLines,
      lines.map((one) => ({ adjustmentId: id, ...one })),
    );
  }
}

type LineTaken = { lineId: string; reduction: number; quantity: number };

/**
 * `taken`, each line's own fall in cents, made to sum to `takes`, what the filed rows lose: the
 * cents a filed row's rounding adds go to the first line, or to `first`, the first part the
 * discount moved, when no line's own total fell; the cents it saves come off the lines in order,
 * none below nothing.
 */
function fitted(
  taken: readonly LineTaken[],
  takes: number,
  first: () => Omit<LineTaken, "reduction">,
): LineTaken[] {
  const lines = taken.map((one) => ({ ...one }));
  let left = takes - lines.reduce((sum, { reduction }) => sum + reduction, 0);
  if (left > 0) {
    if (lines.length === 0) lines.push({ ...first(), reduction: 0 });
    lines[0]!.reduction += left;
  }
  for (const one of lines) {
    if (left >= 0) break;
    const off = Math.min(one.reduction, -left);
    one.reduction -= off;
    left += off;
  }
  return lines.filter(({ reduction }) => reduction !== 0);
}

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
  const bill = (await gatherHeldBills(tx, [billId])).get(billId);
  if (bill === undefined) return;
  const { input } = bill;
  const worked = workOutHeldBill(bill).discounts;
  const standing = notHolding(bill, worked);
  if (options.asked && standing.length > 0) {
    throw new AppError("adjustment.no_longer_applies", {
      workingOrderId: billId,
      discounts: standing,
    });
  }
  const ids = input.discounts.map(({ id }) => id);
  // Before any price changes, so a split made while writing copies no pending row to its part.
  await deletePendingDiscounts(tx, ids);
  const rows = await readRows(tx, billId);
  const lineOf = new Map(rows.map((row) => [row.id, row]));
  const parts: Parts = {
    rowOf: new Map(rows.map((row) => [row.id, { ...row }])),
    partsOf: new Map(rows.map(({ id }) => [id, [id]])),
  };
  // Recorded before the next discount writes, so a split it makes carries the record's lines.
  let open: Given | null = null;
  for (const one of worked) {
    const discount = input.discounts.find(({ id }) => id === one.id)!;
    const held = bill.held.get(one.id)!;
    if (one.holds !== "set_menu_gone") {
      const line = discount.target.kind === "bill" ? null : lineOf.get(discount.target.lineId!)!;
      if (open !== null && open.held.givenTogether !== held.givenTogether) {
        await recordGiven(tx, billId, open);
        open = null;
      }
      const written = await writeWorked(tx, cfg, billId, parts, discount, one);
      if (open !== null) {
        open.written.push(written);
        open.quantity += line?.quantity ?? 0;
      } else {
        const dish = line?.parentLineId == null ? line : lineOf.get(line.parentLineId)!;
        open = { held, line, dish, quantity: line?.quantity ?? 0, written: [written] };
      }
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
  if (open !== null) await recordGiven(tx, billId, open);
  await bumpRevision(tx, [billId]);
}
