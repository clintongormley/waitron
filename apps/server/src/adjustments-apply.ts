import { eq, inArray, sql } from "drizzle-orm";
import {
  evaluateAdjustment,
  findAdjustmentReason,
  isPercentBp,
  percentReduction,
  policySnapshotOf,
  readReasonTotals,
  recordAdjustment,
  spreadBillDiscount,
  type AdjustmentAction,
  type AdjustmentReason,
  type AdjustmentSplit,
  type AdjustmentStage,
  type PricedRow,
  type SpreadLine,
} from "@waitron/adjustments";
import { staffPresentationName } from "@waitron/catalogue";
import { orderGroups, ticketItems, workingOrderLines } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  persons,
  roleAtLeast,
  verifyPersonCredential,
  type PersonRoleValue,
} from "@waitron/identity";
import {
  AppError,
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  grossOf,
  MONEY_SCALE,
  subtractDecimal,
  sumDecimals,
  thousandthsToDecimal,
  toScale,
  type Decimal,
} from "@waitron/shared";
import { invalid, money } from "./bill-allocation.js";
import { assertBillInvariant, refusePaidLines } from "./bill-payments.js";
import { runServiceCommand } from "./parties.js";
import type { TillConfig } from "./till-config.js";
import {
  assertPartyBillOpen,
  bumpRevision,
  isReleased,
  partyAfterEdit,
  quantityOfLine,
  readOrderRevision,
  refusePaymentInFlight,
  removeFromLine,
  splitLinesWithinOrder,
  type VoidTarget,
} from "./working-order.js";
import { firedQuantity, type TicketState } from "./kitchen-print.js";
import "./errors.js";

/** What an adjustment asks, as a preview and an apply share it. */
export interface AdjustmentAsk {
  orderId: string;
  /** The bill's revision as the caller read it (plan D19). */
  expectedRevision: number;
  /** The dish the action names; null for a discount on the whole bill. */
  lineId: string | null;
  reasonId: string;
  action: AdjustmentAction;
  /** How much of the dish; absent for all of it. */
  quantity?: string;
  percentBp?: number;
  amount?: Decimal;
  note: string | null;
  operatorId: string;
}

export interface AdjustmentArgs extends AdjustmentAsk {
  submissionId: string;
  /** Someone at or above the reason's approver role, when the operator is below its apply role. */
  approver?: { personId: string; pin: string };
}

/** What an adjustment would do, answered before it is confirmed (plan D4, D15). */
export interface AdjustmentPreview {
  /** What the bill actually loses, which can differ from what a discount asked for. */
  reduction: string;
  nominalValue: string;
  /** The role that must approve, or null when the operator may apply it alone. */
  needsApproval: PersonRoleValue | null;
  /** Each line the action changes: what it loses, and the rows the changed part becomes. */
  lines: {
    lineId: string;
    lineNo: number;
    reduction: string;
    rows: { quantity: string; unitGross: string }[];
  }[];
}

/** A row of the bill as an adjustment reads it: quantities in thousandths, money in cents. */
interface Row {
  id: string;
  lineNo: number;
  parentLineId: string | null;
  name: string;
  variantName: string | null;
  quantity: number;
  unit: number;
  list: number | null;
  unitPrecision: number | null;
  groupId: string | null;
  groupState: "held" | "fired" | "removed" | null;
  creditedTo: string | null;
  servedQuantity: number;
  sentAt: string | null;
  ticketItemId: string | null;
  ticketFiredAt: string | null;
  stationId: string | null;
  ticketState: TicketState | null;
  firedQuantity: number;
}

/** New prices for one row: `carve` thousandths are first split off it into the row they apply
 * to, and a second row in `rows` is split off that one in turn. */
interface Change {
  row: Row;
  carve: number | null;
  rows: PricedRow[];
  reduction: Decimal;
}

interface Plan {
  reason: AdjustmentReason;
  reasonName: string;
  dish: Row | null;
  /** The part of the dish covered, in thousandths; null on a bill-level discount. */
  covered: number | null;
  /** A cancel's quantity taken off the dish, null for all of it. */
  removed: number | null;
  changes: Change[];
  reduction: Decimal;
  nominal: Decimal;
  before: Decimal;
  stage: AdjustmentStage | null;
  approverRole: PersonRoleValue | null;
}

const ZERO = decimal("0");

function gross(unitCents: number, quantity: number): Decimal {
  return grossOf(centsToDecimal(unitCents), thousandthsToDecimal(quantity));
}

/** A row's value before any adjustment (plan D21), for `quantity` of it. */
function listValue(row: Row, quantity: number): Decimal {
  return gross(row.list ?? row.unit, quantity);
}

async function readRows(tx: Transaction, orderId: string): Promise<Row[]> {
  return tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      parentLineId: workingOrderLines.parentLineId,
      name: workingOrderLines.name,
      variantName: workingOrderLines.variantName,
      quantity: workingOrderLines.quantity,
      unit: workingOrderLines.unitPriceGross,
      list: workingOrderLines.listUnitPriceGross,
      unitPrecision: workingOrderLines.unitPrecision,
      groupId: workingOrderLines.groupId,
      groupState: orderGroups.state,
      creditedTo: workingOrderLines.creditedTo,
      servedQuantity: workingOrderLines.servedQuantity,
      sentAt: workingOrderLines.sentAt,
      ticketItemId: ticketItems.id,
      ticketFiredAt: ticketItems.firedAt,
      stationId: ticketItems.stationId,
      ticketState: ticketItems.state,
      firedQuantity,
    })
    .from(workingOrderLines)
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(eq(workingOrderLines.workingOrderId, orderId))
    .orderBy(workingOrderLines.lineNo);
}

/** The dish as `removeFromLine` takes it, from the row the plan read. */
function voidTargetOf(dish: Row): VoidTarget {
  return {
    id: dish.id,
    parentLineId: dish.parentLineId,
    groupId: dish.groupId,
    quantity: dish.quantity,
    unitPrecision: dish.unitPrecision,
    unitPriceGross: dish.unit,
    ticketItemId: dish.ticketItemId,
    firedAt: dish.ticketFiredAt,
    stationId: dish.stationId,
    state: dish.ticketState,
    firedQuantity: dish.firedQuantity,
  };
}

/** How far the dish had got (ruling R8). */
function stageOf(dish: Row): AdjustmentStage {
  if (dish.servedQuantity > 0) return "served";
  if (isReleased(dish)) return "fired";
  return dish.groupState === "held" ? "held" : "unsent";
}

/**
 * The reason's name in the operator's language, else in the venue's display language (what the
 * till screen shows an operator with no language of their own), else the reason's own name.
 */
export function reasonNameIn(
  reason: AdjustmentReason,
  operatorLocale: string | null,
  venueLocale: string,
): string {
  const language = (operatorLocale ?? venueLocale).split("-")[0]!.toLowerCase();
  const name = reason.names[language];
  return name === undefined ? reason.name : name;
}

/** The part of the dish covered, in thousandths, else `adjustment.quantity_invalid`. */
function coveredQuantity(orderId: string, dish: Row, quantity: string | undefined): number {
  if (quantity === undefined) return dish.quantity;
  return quantityOfLine(
    quantity,
    dish,
    () =>
      new AppError("adjustment.quantity_invalid", {
        workingOrderId: orderId,
        lineNo: dish.lineNo,
        quantity,
      }),
  );
}

/** The discount a percentage or an amount asks for off `base`, checked against the action. */
function requestedDiscount(ask: AdjustmentAsk, base: Decimal): Decimal {
  if (ask.action === "discount_percent") {
    if (ask.amount !== undefined) throw invalid("amount");
    const bp = ask.percentBp;
    if (!isPercentBp(bp)) throw invalid("percentBp");
    return percentReduction(base, bp);
  }
  if (ask.percentBp !== undefined) throw invalid("percentBp");
  if (ask.action === "discount_amount") {
    const amount = ask.amount;
    if (
      amount === undefined ||
      compareDecimal(amount, ZERO) <= 0 ||
      compareDecimal(toScale(amount, MONEY_SCALE), amount) !== 0
    ) {
      throw invalid("amount");
    }
    return amount;
  }
  if (ask.amount !== undefined) throw invalid("amount");
  return base;
}

/** Spread `discount` over `subjects` (plan D4, D15) and keep the rows whose price moves. */
function spread(
  subjects: readonly { row: Row; quantity: number; carve: number | null; exact: boolean }[],
  discount: Decimal,
): Change[] {
  const lines: SpreadLine[] = subjects.map(({ row, quantity, exact }) => ({
    lineId: row.id,
    addedOrder: row.lineNo,
    gross: gross(row.unit, quantity),
    quantity: thousandthsToDecimal(quantity),
    grossUnit: centsToDecimal(row.unit),
    exact,
  }));
  const results = spreadBillDiscount(lines, discount);
  return subjects.flatMap(({ row, carve }) => {
    const result = results.get(row.id)!;
    if (compareDecimal(result.reduction, ZERO) === 0) return [];
    return [{ row, carve, rows: result.rows, reduction: result.reduction }];
  });
}

/** A comp's rows (plan D4): each one not already free is priced at exactly zero, never at a price
 * whose total merely rounds to nothing. */
function zeroed(
  subjects: readonly { row: Row; quantity: number; carve: number | null }[],
): Change[] {
  return subjects
    .filter(({ row }) => row.unit !== 0)
    .map(({ row, quantity, carve }) => ({
      row,
      carve,
      rows: [{ quantity: thousandthsToDecimal(quantity), unitGross: ZERO }],
      reduction: gross(row.unit, quantity),
    }));
}

/**
 * Everything an adjustment decides before it writes, reading only: the refusals of the bill, the
 * line, the amount, the paid lines and the reason's policy, and the rows it would change.
 */
async function planAdjustment(
  tx: Transaction,
  cfg: TillConfig,
  ask: AdjustmentAsk,
  venueLocale: string,
): Promise<Plan> {
  const { orderId } = ask;
  // The table screen is the only surface (ruling R1): an open bill of a party, as a void needs.
  const revision = await assertPartyBillOpen(tx, cfg, orderId);
  if (revision !== ask.expectedRevision) {
    throw new AppError("working_order.out_of_date", { workingOrderId: orderId, revision });
  }
  await refusePaymentInFlight(tx, [orderId]);
  const reason = await findAdjustmentReason(tx, ask.reasonId);
  const rows = await readRows(tx, orderId);

  let dish: Row | null = null;
  let covered: number | null = null;
  let removed: number | null = null;
  let changes: Change[] = [];
  let reduction: Decimal;
  let nominal: Decimal;
  let before: Decimal;
  if (ask.lineId === null) {
    if (ask.action === "cancel" || ask.action === "comp") throw invalid("lineId");
    if (ask.quantity !== undefined) throw invalid("quantity");
    const families = new Set(rows.flatMap((row) => row.parentLineId ?? []));
    before = sumDecimals(rows.map((row) => gross(row.unit, row.quantity)));
    changes = spread(
      rows.map((row) => ({
        row,
        quantity: row.quantity,
        carve: null,
        exact: row.parentLineId === null && !families.has(row.id) && (row.unitPrecision ?? 0) === 0,
      })),
      requestedDiscount(ask, before),
    );
    reduction = sumDecimals(changes.map((change) => change.reduction));
    nominal = sumDecimals(rows.map((row) => listValue(row, row.quantity)));
    await refusePaidLines(
      tx,
      orderId,
      changes.map(({ row }) => ({ id: row.id, lineNo: row.lineNo, keeps: 0 })),
    );
  } else {
    dish = rows.find((row) => row.id === ask.lineId) ?? null;
    if (dish === null)
      throw new AppError("tab.line_not_found", { tabId: orderId, lineId: ask.lineId });
    if (dish.parentLineId !== null) {
      throw new AppError("adjustment.line_not_adjustable", {
        workingOrderId: orderId,
        lineNo: dish.lineNo,
      });
    }
    const family = [dish, ...rows.filter((row) => row.parentLineId === dish!.id)];
    covered = coveredQuantity(orderId, dish, ask.quantity);
    const partial = covered < dish.quantity;
    if (partial && family.length > 1) {
      throw new AppError("adjustment.partial_with_extras", {
        workingOrderId: orderId,
        lineNo: dish.lineNo,
      });
    }
    const weighed = (dish.unitPrecision ?? 0) > 0;
    if (ask.action === "cancel") {
      if (ask.percentBp !== undefined) throw invalid("percentBp");
      if (ask.amount !== undefined) throw invalid("amount");
      removed = partial ? covered : null;
      reduction = partial
        ? subtractDecimal(
            gross(dish.unit, dish.quantity),
            gross(dish.unit, dish.quantity - covered),
          )
        : sumDecimals(family.map((row) => gross(row.unit, row.quantity)));
      nominal = partial
        ? listValue(dish, covered)
        : sumDecimals(family.map((row) => listValue(row, row.quantity)));
      before = reduction;
      await refusePaidLines(tx, orderId, [
        { id: dish.id, lineNo: dish.lineNo, keeps: dish.quantity - covered },
      ]);
    } else {
      // Part of a weighed line, carved off, can round to totals whose sum is not the line's: 0.005 kg
      // at €1.00/kg is €0.01, while 0.002 kg and 0.003 kg are €0.00 each.
      if (partial && weighed) {
        throw new AppError("adjustment.quantity_invalid", {
          workingOrderId: orderId,
          lineNo: dish.lineNo,
          quantity: ask.quantity!,
        });
      }
      const subjects = partial
        ? [{ row: dish, quantity: covered, carve: covered, exact: true }]
        : family.map((row) => ({
            row,
            quantity: row.quantity,
            carve: null,
            exact: family.length === 1 && !weighed,
          }));
      before = sumDecimals(subjects.map(({ row, quantity }) => gross(row.unit, quantity)));
      const discount = requestedDiscount(ask, before);
      changes = ask.action === "comp" ? zeroed(subjects) : spread(subjects, discount);
      reduction = sumDecimals(changes.map((change) => change.reduction));
      nominal = sumDecimals(subjects.map(({ row, quantity }) => listValue(row, quantity)));
      await refusePaidLines(
        tx,
        orderId,
        family.map((row) => ({ id: row.id, lineNo: row.lineNo, keeps: 0 })),
      );
    }
  }

  const [actor] = await tx
    .select({ role: persons.role, locale: persons.locale })
    .from(persons)
    .where(eq(persons.id, ask.operatorId));
  if (actor === undefined) throw new AppError("person.not_found", { personId: ask.operatorId });
  const priors = await readReasonTotals(tx, {
    workingOrderId: orderId,
    reasonId: reason.id,
    lineId: ask.lineId,
  });
  const verdict = evaluateAdjustment(reason, {
    action: ask.action,
    reduction,
    percentBp: ask.action === "discount_percent" ? ask.percentBp! : null,
    actorRole: actor.role as PersonRoleValue,
    note: ask.note,
    ...priors,
  });
  if (verdict.kind === "refused") throw new AppError(verdict.code, {});
  return {
    reason,
    reasonName: reasonNameIn(reason, actor.locale, venueLocale),
    dish,
    covered,
    removed,
    changes,
    reduction,
    nominal,
    before,
    stage: dish === null ? null : stageOf(dish),
    approverRole: verdict.kind === "needs_approval" ? verdict.approverRole : null,
  };
}

/** What the adjustment would do, writing nothing: the same plan {@link applyAdjustment} writes. */
export async function previewAdjustment(
  tx: Transaction,
  cfg: TillConfig,
  ask: AdjustmentAsk,
  venueLocale: string,
): Promise<AdjustmentPreview> {
  const plan = await planAdjustment(tx, cfg, ask, venueLocale);
  const lines =
    ask.action === "cancel"
      ? [
          {
            lineId: plan.dish!.id,
            lineNo: plan.dish!.lineNo,
            reduction: money(plan.reduction),
            rows: [],
          },
        ]
      : plan.changes.map((change) => ({
          lineId: change.row.id,
          lineNo: change.row.lineNo,
          reduction: money(change.reduction),
          rows: change.rows.map((row) => ({
            quantity: row.quantity,
            unitGross: money(row.unitGross),
          })),
        }));
  return {
    reduction: money(plan.reduction),
    nominalValue: money(plan.nominal),
    needsApproval: plan.approverRole,
    lines,
  };
}

/** The approver, verified by PIN, when the plan needs one (plan D6). */
async function approvedBy(
  tx: Transaction,
  approverRole: PersonRoleValue | null,
  approver: AdjustmentArgs["approver"],
): Promise<string | null> {
  if (approverRole === null) return null;
  const refused = () => new AppError("adjustment.approval_required", { approverRole });
  if (approver === undefined) throw refused();
  const { role } = await verifyPersonCredential(tx, approver.personId, approver.pin);
  if (!roleAtLeast(role, approverRole)) throw refused();
  return approver.personId;
}

async function setPrice(tx: Transaction, lineId: string, row: PricedRow): Promise<void> {
  await tx
    .update(workingOrderLines)
    .set({
      unitPriceGross: decimalToCents(row.unitGross),
      lineTotal: decimalToCents(grossOf(row.unitGross, row.quantity)),
    })
    .where(eq(workingOrderLines.id, lineId));
}

async function lineNoOf(tx: Transaction, lineId: string): Promise<number> {
  const [row] = await tx
    .select({ lineNo: workingOrderLines.lineNo })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.id, lineId));
  return row!.lineNo;
}

/** Writes the plan's new prices; answers each row it split off, with the row it came from. */
async function reprice(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  changes: readonly Change[],
): Promise<AdjustmentSplit[]> {
  const touched = changes.map(({ row }) => row.id);
  // Before any split, so a split row copies the price its line had (plan D21).
  await tx
    .update(workingOrderLines)
    .set({
      listUnitPriceGross: sql`coalesce(${workingOrderLines.listUnitPriceGross}, ${workingOrderLines.unitPriceGross})`,
    })
    .where(inArray(workingOrderLines.id, touched));
  const splits: AdjustmentSplit[] = [];
  const subjects: { id: string; lineNo: number; change: Change }[] = [];
  for (const change of changes) {
    if (change.carve === null) {
      subjects.push({ id: change.row.id, lineNo: change.row.lineNo, change });
      continue;
    }
    const split = await splitLinesWithinOrder(tx, cfg, orderId, [
      { lineNo: change.row.lineNo, quantity: thousandthsToDecimal(change.carve) },
    ]);
    const id = split.get(change.row.id)!;
    splits.push({ from: change.row.id, to: id });
    subjects.push({ id, lineNo: await lineNoOf(tx, id), change });
  }
  const twoRows = subjects.filter(({ change }) => change.rows.length === 2);
  const seconds =
    twoRows.length === 0
      ? new Map<string, string>()
      : await splitLinesWithinOrder(
          tx,
          cfg,
          orderId,
          twoRows.map(({ lineNo, change }) => ({ lineNo, quantity: change.rows[1]!.quantity })),
        );
  for (const { id, change } of subjects) {
    await setPrice(tx, id, change.rows[0]!);
    const second = seconds.get(id);
    if (second !== undefined) {
      splits.push({ from: id, to: second });
      await setPrice(tx, second, change.rows[1]!);
    }
  }
  return splits;
}

/**
 * Apply a cancellation, comp or discount to an open bill of a party, at most once per submission id
 * on the bill (plan D8): a cancel removes the part as a void does, telling the kitchen; a comp or a
 * discount lowers the prices by plan D4 and D15, and tells the kitchen nothing. It moves the bill's
 * revision and the party's on, and records one adjustment. The PIN never enters the recorded
 * command. `venueLocale` is the venue's display language, which names the reason for an operator
 * with no language of their own.
 */
export async function applyAdjustment(
  tx: Transaction,
  cfg: TillConfig,
  args: AdjustmentArgs,
  venueLocale: string,
): Promise<{ adjustmentIds: string[]; revision: number }> {
  const { submissionId, approver, ...command } = args;
  return runServiceCommand(
    tx,
    { kind: "bill", workingOrderId: args.orderId },
    submissionId,
    "adjustment.apply",
    { ...command, approverId: approver?.personId },
    async () => {
      const plan = await planAdjustment(tx, cfg, args, venueLocale);
      const approved = await approvedBy(tx, plan.approverRole, approver);
      let splits: AdjustmentSplit[] = [];
      if (args.action === "cancel") {
        await removeFromLine(
          tx,
          cfg,
          args.orderId,
          voidTargetOf(plan.dish!),
          plan.removed,
          args.operatorId,
        );
      } else {
        splits = await reprice(tx, cfg, args.orderId, plan.changes);
        await bumpRevision(tx, [args.orderId]);
        await assertBillInvariant(tx, [args.orderId]);
        await partyAfterEdit(tx, args.orderId, [], args.operatorId);
      }
      const { dish } = plan;
      const id = await recordAdjustment(tx, {
        workingOrderId: args.orderId,
        line:
          dish === null
            ? null
            : {
                id: dish.id,
                name: staffPresentationName(dish),
                quantity: thousandthsToDecimal(dish.quantity),
                listUnitPriceGross: centsToDecimal(dish.list ?? dish.unit),
                creditedTo: dish.creditedTo,
                stage: plan.stage!,
              },
        splits,
        quantity: plan.covered === null ? null : thousandthsToDecimal(plan.covered),
        reason: {
          id: plan.reason.id,
          name: plan.reasonName,
          policy: policySnapshotOf(plan.reason),
        },
        action: args.action,
        percentBp: args.action === "discount_percent" ? args.percentBp! : null,
        beforeAmount: plan.before,
        afterAmount: subtractDecimal(plan.before, plan.reduction),
        reduction: plan.reduction,
        nominalValue: plan.nominal,
        requestedBy: args.operatorId,
        approvedBy: approved,
        note: args.note,
      });
      return { adjustmentIds: [id], revision: await readOrderRevision(tx, args.orderId) };
    },
  );
}
