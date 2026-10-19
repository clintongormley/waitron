import { and, eq, inArray, sql } from "drizzle-orm";
import {
  approves,
  evaluateCancel,
  evaluateComp,
  findAdjustmentReason,
  isPercentBp,
  percentReduction,
  policySnapshotOf,
  readAdjustmentSettings,
  readReasonItemShares,
  readReasonTotals,
  recordAdjustment,
  shareBp,
  spreadBillDiscount,
  type AdjustmentAction,
  type AdjustmentReason,
  type AdjustmentSplit,
  type AdjustmentStage,
  type AdjustmentVerdict,
  type Approval,
  type CompAction,
  type PricedRow,
  type SpreadLine,
} from "@waitron/adjustments";
import { staffPresentationName } from "@waitron/catalogue";
import {
  nowIso,
  orderDrafts,
  orderDraftLines,
  orderDraftRecalledLines,
  orderGroups,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  persons,
  verifyPersonCredential,
  verifyThrottledCredential,
  type PersonRoleValue,
  type PinAttempts,
  type SecretCheck,
} from "@waitron/identity";
import {
  AppError,
  isUuid,
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  decimalToThousandths,
  divideDecimal,
  MONEY_SCALE,
  multiplyDecimal,
  subtractDecimal,
  sumDecimals,
  thousandthsToDecimal,
  toScale,
  type Decimal,
} from "@waitron/shared";
import { invalid, money } from "./bill-allocation.js";
import { assertBillInvariant, refusePaidLines } from "./bill-payments.js";
import { runServiceCommand } from "./parties.js";
import {
  requireOrderBillEditor,
  parseBillEditExpected,
  readBillEditState,
  closeBillDraft,
} from "./bill-editing.js";
import type { BillEditExpected } from "./order-drafts.js";
import { refuseRecalledWrite } from "./draft-source.js";
import type { TillConfig } from "./till-config.js";
import {
  assertTabOpen,
  bumpRevision,
  captureOrderEdit,
  extraQuantityFor,
  isReleased,
  keptExtrasOf,
  partyAfterEdit,
  quantityOfLine,
  type OrderAttendance,
  readOrderRevision,
  refusePaymentInFlight,
  removeFromLine,
  splitLinesWithinOrder,
  type SplitRow,
  type VoidTarget,
} from "./working-order.js";
import { firedQuantity, type TicketState } from "./kitchen-print.js";
import { readLineCancellations, serviceQuantities } from "./line-service-state.js";
import "./errors.js";

/** What an adjustment asks, as a preview and an apply share it. */
export interface AdjustmentAsk {
  expectedEdit: BillEditExpected | null;
  sourceDraftId?: string;
  orderId: string;
  /** The bill's revision as the caller read it (plan D19). */
  expectedRevision: number;
  /** The dish, or the extra, the action names; null for a discount on the whole bill. */
  lineId: string | null;
  reasonId: string;
  action: AdjustmentAction;
  /** How much of the line; absent for all of it. An extra is taken only whole. */
  quantity?: string;
  percentBp?: number;
  amount?: Decimal;
  note: string | null;
  operatorId: string;
}

export interface AdjustmentArgs extends AdjustmentAsk {
  submissionId: string;
  preparationStarted?: boolean;
  /**
   * Someone the plan's approval admits ({@link approves}). `checked` is `checkPin`'s result on this
   * person and PIN, taken before the transaction opened.
   */
  approver?: { personId: string; pin: string; checked?: SecretCheck };
}

/** What an adjustment would do, answered before it is confirmed (plan D4, D15). */
export interface AdjustmentPreview {
  /** What the bill actually loses, which can differ from what a discount asked for. */
  reduction: string;
  nominalValue: string;
  /** Whose PIN it needs, or null when the operator may apply it alone. */
  needsApproval: WireApproval | null;
  /** Each line the action changes: what it loses, and the rows the changed part becomes. */
  lines: {
    lineId: string;
    lineNo: number;
    reduction: string;
    rows: { quantity: string; unitGross: string }[];
  }[];
}

/** {@link Approval} on the wire: the limit as money is written. */
export type WireApproval =
  | { by: "reason"; roles: PersonRoleValue[] }
  | { by: "bill_limit"; roles: PersonRoleValue[]; limit: string }
  | { by: "refund" };

/** A row of the bill as an adjustment reads it: quantities in thousandths, money in cents. */
interface Row {
  id: string;
  lineNo: number;
  parentLineId: string | null;
  name: string;
  variantName: string | null;
  quantity: number;
  priceQuantity: number;
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
  ticketMadeHere: boolean | null;
  stationId: string | null;
  ticketState: TicketState | null;
  firedQuantity: number;
}

/** New prices for one row, or for the part of it split off with the part of its dish covered when
 * `carved`; a second row in `rows` is split off that one in turn. */
interface Change {
  row: Row;
  carved: boolean;
  rows: PricedRow[];
  reduction: Decimal;
}

/** The part of a dish a comp or a discount covers, split off with its extras before the prices
 * change. */
interface Carve {
  lineNo: number;
  quantity: number;
}

interface Plan {
  recalledDraftId: string | null;
  reason: AdjustmentReason;
  reasonName: string;
  /** The dish or the extra the action names; null on a bill-level discount. */
  line: Row | null;
  /** The part of the line covered, in thousandths; null on a bill-level discount. */
  covered: number | null;
  /** A cancel's quantity taken off the dish, null for all of it. */
  removed: number | null;
  carve: Carve | null;
  changes: Change[];
  /** On a whole comp of a dish, its extras rows, all priced at zero by it. */
  compedExtras: string[];
  reduction: Decimal;
  nominal: Decimal;
  before: Decimal;
  stage: AdjustmentStage | null;
  approval: Approval | null;
}

const ZERO = decimal("0");

function gross(row: Row, quantity: number, unitCents = row.unit): Decimal {
  return divideDecimal(
    multiplyDecimal(centsToDecimal(unitCents), thousandthsToDecimal(quantity)),
    thousandthsToDecimal(row.priceQuantity),
    MONEY_SCALE,
  );
}

/** A row's value before any adjustment (plan D21), for `quantity` of it. */
function listValue(row: Row, quantity: number): Decimal {
  return gross(row, quantity, row.list ?? row.unit);
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
      priceQuantity: workingOrderLines.priceQuantity,
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
      ticketMadeHere: ticketItems.madeHere,
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

/**
 * The quantity, in thousandths, each row of a dish's family (the dish first, then its extras) holds
 * when the dish holds `dishQuantity`: an extra follows its dish, as {@link removeFromLine} and
 * {@link splitLinesWithinOrder} store it.
 */
function familyAt(family: readonly Row[], dishQuantity: number): Map<string, number> {
  const [dish, ...children] = family;
  const quantity = thousandthsToDecimal(dishQuantity);
  const kept = keptExtrasOf(
    children.map((row) => ({
      id: row.id,
      quantity: row.quantity,
      priceQuantity: row.priceQuantity,
      unitPriceGross: row.unit,
    })),
    dish!.quantity,
  );
  return new Map([
    [dish!.id, dishQuantity],
    ...kept.map(
      ({ child, perDish }) =>
        [
          child.id,
          decimalToThousandths(extraQuantityFor(perDish, quantity, child.priceQuantity)),
        ] as const,
    ),
  ]);
}

/** The line as `removeFromLine` takes it, from the row the plan read. */
function voidTargetOf(line: Row): VoidTarget {
  return {
    id: line.id,
    parentLineId: line.parentLineId,
    groupId: line.groupId,
    quantity: line.quantity,
    unitPrecision: line.unitPrecision,
    unitPriceGross: line.unit,
    ticketItemId: line.ticketItemId,
    firedAt: line.ticketFiredAt,
    stationId: line.stationId,
    state: line.ticketState,
    firedQuantity: line.firedQuantity,
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

/**
 * The part of the line covered, in thousandths, else `adjustment.quantity_invalid`: an extra is
 * covered only whole, because its quantity follows its dish.
 */
function coveredQuantity(orderId: string, line: Row, quantity: string | undefined): number {
  if (quantity === undefined) return line.quantity;
  const refused = () =>
    new AppError("adjustment.quantity_invalid", {
      workingOrderId: orderId,
      lineNo: line.lineNo,
      quantity,
    });
  const covered = quantityOfLine(quantity, line, refused);
  if (line.parentLineId !== null && covered < line.quantity) throw refused();
  return covered;
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

/** A row an adjustment prices, `quantity` of it, split off with the part of its dish covered when
 * `carved`; `exact` as {@link SpreadLine} takes it. */
interface Subject {
  row: Row;
  quantity: number;
  carved: boolean;
  exact: boolean;
}

/** Spread `discount` over `subjects` (plan D4, D15) and keep the rows whose price moves. */
function spread(subjects: readonly Subject[], discount: Decimal): Change[] {
  const lines: SpreadLine[] = subjects.map(({ row, quantity, exact }) => ({
    lineId: row.id,
    addedOrder: row.lineNo,
    gross: gross(row, quantity),
    quantity: thousandthsToDecimal(quantity),
    priceQuantity: thousandthsToDecimal(row.priceQuantity),
    grossUnit: centsToDecimal(row.unit),
    exact,
  }));
  const results = spreadBillDiscount(lines, discount);
  return subjects.flatMap(({ row, carved }) => {
    const result = results.get(row.id)!;
    if (compareDecimal(result.reduction, ZERO) === 0) return [];
    return [{ row, carved, rows: result.rows, reduction: result.reduction }];
  });
}

/** A comp's rows (plan D4): each one not already free is priced at exactly zero, never at a price
 * whose total merely rounds to nothing. */
function zeroed(subjects: readonly Subject[]): Change[] {
  return subjects
    .filter(({ row }) => row.unit !== 0)
    .map(({ row, quantity, carved }) => ({
      row,
      carved,
      rows: [{ quantity: thousandthsToDecimal(quantity), unitGross: ZERO }],
      reduction: gross(row, quantity),
    }));
}

/**
 * Everything an adjustment decides before it writes, reading only: the refusals of the bill, the
 * line, the amount, the paid lines and the reason's policy, and the rows it would change. A dish is
 * taken with its extras; part of one splits its extras in proportion, the part covered taking the
 * part of each. An extra is taken on its own, and only whole.
 */
export async function planAdjustment(
  tx: Transaction,
  ask: AdjustmentAsk,
  venueLocale: string,
): Promise<Plan> {
  const { orderId } = ask;
  // An open bill, a table's or a counter order.
  const revision = await assertTabOpen(tx, orderId);
  if (revision !== ask.expectedRevision) {
    throw new AppError("working_order.out_of_date", { workingOrderId: orderId, revision });
  }
  await refusePaymentInFlight(tx, [orderId]);
  await requireOrderBillEditor(tx, orderId, ask);
  const sourceDraftId = sourceDraftIdOf(ask.sourceDraftId);
  if (sourceDraftId !== undefined) {
    const edit = await readBillEditState(tx, orderId);
    if (edit.draftId !== sourceDraftId)
      throw new AppError("draft.out_of_date", {
        billId: orderId,
        draftId: edit.draftId,
        revision: edit.draftRevision,
        edit,
      });
  }
  const reason = await findAdjustmentReason(tx, ask.reasonId);
  const rows = await readRows(tx, orderId);

  let line: Row | null = null;
  let covered: number | null = null;
  let removed: number | null = null;
  let carve: Carve | null = null;
  let changes: Change[] = [];
  let compedExtras: string[] = [];
  let reduction: Decimal;
  let nominal: Decimal;
  let before: Decimal;
  if (ask.lineId === null) {
    if (ask.action === "cancel" || ask.action === "comp") throw invalid("lineId");
    if (ask.quantity !== undefined) throw invalid("quantity");
    const families = new Set(rows.flatMap((row) => row.parentLineId ?? []));
    before = sumDecimals(rows.map((row) => gross(row, row.quantity)));
    changes = spread(
      rows.map((row) => ({
        row,
        quantity: row.quantity,
        carved: false,
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
    line = rows.find((row) => row.id === ask.lineId) ?? null;
    if (line === null)
      throw new AppError("tab.line_not_found", { tabId: orderId, lineId: ask.lineId });
    const target = line;
    // An extra has no extras of its own, so it is a family of one.
    const family = [target, ...rows.filter((row) => row.parentLineId === target.id)];
    covered = coveredQuantity(orderId, target, ask.quantity);
    const partial = covered < target.quantity;
    const weighed = (target.unitPrecision ?? 0) > 0;
    if (ask.action === "cancel") {
      if (ask.percentBp !== undefined) throw invalid("percentBp");
      if (ask.amount !== undefined) throw invalid("amount");
      const cancelled = await readLineCancellations(tx, [target.id]);
      if (covered > serviceQuantities(target.quantity, 0, cancelled.get(target.id) ?? 0).active)
        throw new AppError("adjustment.quantity_invalid", {
          workingOrderId: orderId,
          lineNo: target.lineNo,
          quantity: ask.quantity ?? thousandthsToDecimal(covered),
        });
      removed = partial ? covered : null;
      const left = familyAt(family, target.quantity - covered);
      reduction = sumDecimals(
        family.map((row) =>
          subtractDecimal(gross(row, row.quantity), gross(row, left.get(row.id)!)),
        ),
      );
      nominal = sumDecimals(family.map((row) => listValue(row, row.quantity - left.get(row.id)!)));
      before = reduction;
      await refusePaidLines(tx, orderId, [
        { id: target.id, lineNo: target.lineNo, keeps: target.quantity - covered },
      ]);
    } else {
      // Part of a weighed line, carved off, can round to totals whose sum is not the line's: 0.005 kg
      // at €1.00/kg is €0.01, while 0.002 kg and 0.003 kg are €0.00 each.
      // Refused even when exactly representable: the owner's decision of 2026-09-30,
      // docs/backlog/till.md, Decisions and deliberate limits, "Part of a weighed line stays refused".
      if (partial && weighed) {
        throw new AppError("adjustment.weighed_partial", {
          workingOrderId: orderId,
          lineNo: target.lineNo,
        });
      }
      let subjects: Subject[];
      if (partial) {
        carve = { lineNo: target.lineNo, quantity: covered };
        const carved = familyAt(family, covered);
        const kept = familyAt(family, target.quantity - covered);
        // An extra that is not a whole count a dish would split into parts that do not add up to it,
        // whatever part is asked: no part of such a dish can be taken, only the whole.
        if (family.some((row) => carved.get(row.id)! + kept.get(row.id)! !== row.quantity)) {
          throw new AppError("adjustment.quantity_invalid", {
            workingOrderId: orderId,
            lineNo: target.lineNo,
            quantity: ask.quantity!,
          });
        }
        subjects = family.map((row) => ({
          row,
          quantity: carved.get(row.id)!,
          carved: true,
          exact: family.length === 1,
        }));
      } else {
        subjects = family.map((row) => ({
          row,
          quantity: row.quantity,
          carved: false,
          exact: family.length === 1 && target.parentLineId === null && !weighed,
        }));
      }
      before = sumDecimals(subjects.map(({ row, quantity }) => gross(row, quantity)));
      const discount = requestedDiscount(ask, before);
      changes = ask.action === "comp" ? zeroed(subjects) : spread(subjects, discount);
      if (ask.action === "comp" && !partial) compedExtras = family.slice(1).map((row) => row.id);
      reduction = sumDecimals(changes.map((change) => change.reduction));
      nominal = sumDecimals(subjects.map(({ row, quantity }) => listValue(row, quantity)));
      await refusePaidLines(
        tx,
        orderId,
        family.map((row) => ({ id: row.id, lineNo: row.lineNo, keeps: 0 })),
      );
    }
  }

  if (ask.action !== "cancel" && compareDecimal(reduction, ZERO) === 0) {
    throw new AppError("adjustment.no_reduction", { workingOrderId: orderId });
  }
  const [actor] = await tx
    .select({ role: persons.role, locale: persons.locale })
    .from(persons)
    .where(eq(persons.id, ask.operatorId));
  if (actor === undefined) throw new AppError("person.not_found", { personId: ask.operatorId });
  const actorRole = actor.role as PersonRoleValue;
  const stage = line === null ? null : stageOf(dishOf(line, rows));
  const verdict =
    ask.action === "cancel"
      ? evaluateCancel(reason, { actorRole, note: ask.note, stage: stage! })
      : await judgeComp(tx, reason, {
          orderId,
          action: ask.action,
          line,
          rows,
          changes,
          reduction,
          nominal,
          actorRole,
          note: ask.note,
        });
  if (verdict.kind === "refused") throw new AppError(verdict.code, {});
  const parents = new Set(
    (ask.action === "cancel" ? [line!] : changes.map((change) => change.row)).map(
      (row) => row.parentLineId ?? row.id,
    ),
  );
  let recalledDraftId: string | null = null;
  if (parents.size > 0) {
    const scope = and(
      eq(workingOrderLines.workingOrderId, orderId),
      inArray(workingOrderLines.id, [...parents]),
    )!;
    if (sourceDraftId === undefined) await refuseRecalledWrite(tx, scope);
    else {
      const reservations = await tx
        .select({ draftId: orderDraftRecalledLines.draftId })
        .from(orderDraftRecalledLines)
        .innerJoin(
          workingOrderLines,
          eq(workingOrderLines.id, orderDraftRecalledLines.sourceLineId),
        )
        .where(scope);
      if (reservations.some((row) => row.draftId !== sourceDraftId))
        await refuseRecalledWrite(tx, scope);
      if (reservations.length > 0) recalledDraftId = sourceDraftId;
    }
  }
  return {
    recalledDraftId,
    reason,
    reasonName: reasonNameIn(reason, actor.locale, venueLocale),
    line,
    covered,
    removed,
    carve,
    changes,
    compedExtras,
    reduction,
    nominal,
    before,
    stage,
    approval: verdict.kind === "needs_approval" ? verdict.approval : null,
  };
}

/** The line's dish: the line itself, or the dish an extra belongs to, whose stage it shares. */
function dishOf(line: Row, rows: readonly Row[]): Row {
  return line.parentLineId === null ? line : rows.find((row) => row.id === line.parentLineId)!;
}

/**
 * A comp action's verdict (design §3.2). The reason's share of an item is what it took before
 * ({@link readReasonItemShares}: the item's own, and once what it took off the whole bill) plus
 * what this request takes, each at `ceil(reduction × 10000 ÷ list value)`: on a line, the request's
 * reduction over its list value; on the whole bill, each changed row's over that row's. A
 * percentage taken off a dish was spread over its extras too, so an extra also counts its dish's
 * share, and a dish the largest any of its extras took on its own.
 */
async function judgeComp(
  tx: Transaction,
  reason: AdjustmentReason,
  ask: {
    orderId: string;
    action: CompAction;
    line: Row | null;
    rows: readonly Row[];
    changes: readonly Change[];
    reduction: Decimal;
    nominal: Decimal;
    actorRole: PersonRoleValue;
    note: string | null;
  },
): Promise<AdjustmentVerdict> {
  const { orderId, line, rows } = ask;
  const { priorReductionOnBill } = await readReasonTotals(tx, {
    workingOrderId: orderId,
    reasonId: reason.id,
  });
  const subjects: { row: Row; reduction: Decimal; nominal: Decimal }[] =
    line === null
      ? ask.changes.map(({ row, reduction }) => ({
          row,
          reduction,
          nominal: listValue(row, row.quantity),
        }))
      : [{ row: line, reduction: ask.reduction, nominal: ask.nominal }];
  const relatedOf = (row: Row) =>
    row.parentLineId === null
      ? rows.filter((other) => other.parentLineId === row.id).map((other) => other.id)
      : [row.parentLineId];
  const { lines: shares, bill: billShare } = await readReasonItemShares(tx, {
    workingOrderId: orderId,
    reasonId: reason.id,
    lineIds: [...new Set(subjects.flatMap(({ row }) => [row.id, ...relatedOf(row)]))],
  });
  const itemShareBp = Math.max(
    0,
    ...subjects.map(
      ({ row, reduction, nominal }) =>
        shares.get(row.id)! +
        Math.max(0, ...relatedOf(row).map((id) => shares.get(id)!)) +
        billShare +
        shareBp(decimalToCents(reduction), decimalToCents(nominal)),
    ),
  );
  const billComped = sumDecimals(
    rows.map((row) => {
      const off = subtractDecimal(listValue(row, row.quantity), gross(row, row.quantity));
      return compareDecimal(off, ZERO) > 0 ? off : ZERO;
    }),
  );
  const { maxBillComp, billApproverRoles } = await readAdjustmentSettings(tx);
  return evaluateComp(reason, {
    action: ask.action,
    reduction: ask.reduction,
    actorRole: ask.actorRole,
    note: ask.note,
    priorReductionOnBill,
    itemShareBp,
    billComped,
    billLimit: { maxAmount: maxBillComp, approverRoles: billApproverRoles },
  });
}

/** What the adjustment would do, writing nothing: the same plan {@link applyAdjustment} writes. */
export async function previewAdjustment(
  tx: Transaction,
  ask: AdjustmentAsk,
  venueLocale: string,
): Promise<AdjustmentPreview> {
  const plan = await planAdjustment(tx, ask, venueLocale);
  const lines =
    ask.action === "cancel"
      ? [
          {
            lineId: plan.line!.id,
            lineNo: plan.line!.lineNo,
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
    needsApproval: plan.approval === null ? null : wireApproval(plan.approval),
    lines,
  };
}

function wireApproval(approval: Approval): WireApproval {
  return approval.by === "bill_limit" ? { ...approval, limit: money(approval.limit) } : approval;
}

/** The approver, verified by PIN, when the plan needs one (plan D6). */
async function approvedBy(
  tx: Transaction,
  approval: Approval | null,
  approver: AdjustmentArgs["approver"],
  attempts: PinAttempts | undefined,
): Promise<string | null> {
  if (approval === null) return null;
  const refused = () => new AppError("adjustment.approval_required", { approval: approval.by });
  if (approver === undefined) throw refused();
  const { personId, pin, checked } = approver;
  const { role } = await (attempts === undefined
    ? verifyPersonCredential(tx, personId, pin, checked)
    : verifyThrottledCredential(tx, personId, pin, attempts, checked));
  if (!approves(approval, role)) throw refused();
  return approver.personId;
}

async function setPrice(
  tx: Transaction,
  lineId: string,
  row: PricedRow,
  priceQuantity: number,
): Promise<void> {
  await tx
    .update(workingOrderLines)
    .set({
      unitPriceGross: decimalToCents(row.unitGross),
      lineTotal: decimalToCents(
        divideDecimal(
          multiplyDecimal(row.unitGross, row.quantity),
          thousandthsToDecimal(priceQuantity),
          MONEY_SCALE,
        ),
      ),
    })
    .where(eq(workingOrderLines.id, lineId));
}

/**
 * Writes the plan's new prices, first splitting the part `carve` covers off its dish, with its
 * extras, when a change is to that part; answers each row it split off, with the row it came from,
 * a carved dish before its extras.
 */
async function reprice(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  carve: Carve | null,
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
  const carved = changes.some((change) => change.carved)
    ? await splitLinesWithinOrder(
        tx,
        cfg,
        orderId,
        [{ lineNo: carve!.lineNo, quantity: thousandthsToDecimal(carve!.quantity) }],
        { splitExtras: true },
      )
    : new Map<string, SplitRow>();
  const splits: AdjustmentSplit[] = [...carved].map(([from, to]) => ({ from, to: to.id }));
  const subjects = changes.map((change) => {
    const { id, lineNo } = change.carved ? carved.get(change.row.id)! : change.row;
    return { id, lineNo, change };
  });
  const twoRows = subjects.filter(({ change }) => change.rows.length === 2);
  const seconds =
    twoRows.length === 0
      ? new Map<string, SplitRow>()
      : await splitLinesWithinOrder(
          tx,
          cfg,
          orderId,
          twoRows.map(({ lineNo, change }) => ({ lineNo, quantity: change.rows[1]!.quantity })),
        );
  for (const { id, change } of subjects) {
    await setPrice(tx, id, change.rows[0]!, change.row.priceQuantity);
    const second = seconds.get(id);
    if (second !== undefined) {
      splits.push({ from: id, to: second.id });
      await setPrice(tx, second.id, change.rows[1]!, change.row.priceQuantity);
    }
  }
  return splits;
}

/**
 * Apply a cancellation, comp or discount to an open bill, a table's or a counter order, at most once
 * per submission id on the bill (plan D8): a cancel removes the part ({@link removeFromLine}),
 * telling the kitchen about a dish it had, or about the dish a cancelled extra came off; a comp or a
 * discount lowers the prices by plan D4 and D15, and tells the kitchen nothing. It moves the bill's revision on, and its party's when it has one, and records one
 * adjustment. The PIN never enters the recorded command. `venueLocale` is the venue's display
 * language, which names the reason for an operator with no language of their own. `attempts`, when
 * given, puts the approver's PIN under that wrong-PIN limit; it is kept apart from `args` because
 * `args` is recorded.
 */
export async function applyAdjustment(
  tx: Transaction,
  cfg: TillConfig,
  args: AdjustmentArgs,
  venueLocale: string,
  attempts?: PinAttempts,
  attendance?: OrderAttendance,
): Promise<{ adjustmentIds: string[]; revision: number }> {
  const { submissionId, approver, ...command } = args;
  const expectedEdit =
    args.expectedEdit == null ? args.expectedEdit : parseBillEditExpected(args.expectedEdit);
  const sourceDraftId = sourceDraftIdOf(args.sourceDraftId);
  return runServiceCommand(
    tx,
    { kind: "bill", workingOrderId: args.orderId },
    submissionId,
    "adjustment.apply",
    { ...command, expectedEdit, sourceDraftId, approverId: approver?.personId },
    async () => {
      const plan = await planAdjustment(tx, args, venueLocale);
      const approved = await approvedBy(tx, plan.approval, approver, attempts);
      const activity =
        attendance === undefined
          ? undefined
          : { recorder: attendance.recorder, at: attendance.clock.now().instant.toISOString() };
      let splits: AdjustmentSplit[] = [];
      if (args.action === "cancel") {
        await removeFromLine(
          tx,
          cfg,
          args.orderId,
          voidTargetOf(plan.line!),
          plan.removed,
          args.operatorId,
          activity,
          args.preparationStarted,
        );
      } else {
        splits = await reprice(tx, cfg, args.orderId, plan.carve, plan.changes);
        await bumpRevision(tx, [args.orderId]);
        await assertBillInvariant(tx, [args.orderId]);
        await partyAfterEdit(tx, args.orderId, [], args.operatorId, activity);
      }
      if (plan.recalledDraftId !== null) {
        const [fresh] = await tx
          .select({ id: orderDraftLines.id })
          .from(orderDraftLines)
          .where(eq(orderDraftLines.draftId, plan.recalledDraftId))
          .limit(1);
        const [source] = await tx
          .select({ id: orderDraftRecalledLines.id })
          .from(orderDraftRecalledLines)
          .where(eq(orderDraftRecalledLines.draftId, plan.recalledDraftId))
          .limit(1);
        if (fresh === undefined && source === undefined)
          await closeBillDraft(
            tx,
            args.orderId,
            args.operatorId,
            await readBillEditState(tx, args.orderId),
            "discarded",
          );
        else
          await tx
            .update(orderDrafts)
            .set({ revision: sql`${orderDrafts.revision} + 1`, updatedAt: nowIso() })
            .where(eq(orderDrafts.id, plan.recalledDraftId));
      }
      const { line } = plan;
      const id = await recordAdjustment(tx, {
        workingOrderId: args.orderId,
        line:
          line === null
            ? null
            : {
                id: line.id,
                name: staffPresentationName(line),
                quantity: thousandthsToDecimal(line.quantity),
                listUnitPriceGross: centsToDecimal(line.list ?? line.unit),
                creditedTo: line.creditedTo,
                stage: plan.stage!,
              },
        splits,
        compedExtras: plan.compedExtras,
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
      const revision = await readOrderRevision(tx, args.orderId);
      if (attendance !== undefined) {
        const [order] = await tx
          .select({ locationId: workingOrders.locationId })
          .from(workingOrders)
          .where(eq(workingOrders.id, args.orderId));
        await captureOrderEdit(
          tx,
          attendance,
          args.orderId,
          args.operatorId,
          order!.locationId,
          revision,
          "adjustment",
          activity?.at,
        );
      }
      return { adjustmentIds: [id], revision };
    },
    cfg.madeHereSink,
  );
}

function sourceDraftIdOf(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !isUuid(value)) throw invalid("sourceDraftId");
  return value.toLowerCase();
}
