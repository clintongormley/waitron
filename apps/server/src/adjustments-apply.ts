import { and, eq, inArray, sql } from "drizzle-orm";
import {
  adjustmentLines,
  approves,
  evaluateCancel,
  evaluateComp,
  floorAllowance,
  findAdjustmentReason,
  isPercentBp,
  percentReduction,
  policySnapshotOf,
  readAdjustmentSettings,
  readReasonStanding,
  recordAdjustment,
  spreadBillDiscount,
  standingOff,
  type AdjustmentAction,
  type AdjustmentReason,
  type AdjustmentSplit,
  type AdjustmentStage,
  type AdjustmentVerdict,
  type DishPrice,
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
  QUANTITY_SCALE,
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
import type { TradingContext } from "./trading-context.js";
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
  readLockedLines,
  readOrderRevision,
  refusePaymentInFlight,
  removeFromLine,
  removePortions,
  splitLinesWithinOrder,
  type SplitRow,
  type StoredOrderLine,
  type VoidTarget,
} from "./working-order.js";
import { firedQuantity, type TicketState } from "./kitchen-print.js";
import { readPortionBindings, readWholePortionLines } from "./order-portions.js";
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
  /** Every portion line of one till row, `lineId` among them (plan D31). */
  lineIds?: string[];
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
  /** The waiter's answer; true marks every void notice of the family started. */
  preparationStarted?: boolean;
  /** What a cancel row records as started; unlike `preparationStarted`, it touches no notice. */
  recordedPreparationStarted?: boolean;
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
  note: string | null;
  courseId: string | null;
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
  /** On a row, the dish portions a cancel takes whole. */
  removedPortions: Row[] | null;
  carve: Carve | null;
  /** The prices the action sets, on the line, or on a row's stand-in lines (plan D32). */
  changes: Change[];
  /** What is written: `changes`, or on a row, each of its portions' share of them. */
  writes: Change[];
  /** On a row, every line of each stand-in line the action prices, taken or not: each gets its list
   * price, as today's whole line does before part of it is carved off (plan D32). */
  stamped: string[];
  /** On a row, the split today's second price would have recorded (plan D33). */
  rowSplits: AdjustmentSplit[];
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
      note: workingOrderLines.note,
      courseId: workingOrderLines.courseId,
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

/**
 * A whole-bill discount over the rows the bill files (plan D29): bound portions grouped as
 * {@link readLockedLines} groups them for filing, each group spread as one line at its first member's
 * line number, then the group's rows handed to its portions in ordinal order, the higher price first.
 * A bill holding no bound portion is spread line by line.
 */
async function spreadOverFiledRows(
  tx: Transaction,
  orderId: string,
  subjects: readonly Subject[],
  discount: Decimal,
): Promise<Change[]> {
  const bindings = await readPortionBindings(
    tx,
    subjects.map(({ row }) => row.id),
  );
  if (bindings.size === 0) return spread(subjects, discount);
  const subjectOf = new Map(subjects.map((subject) => [subject.row.id, subject]));
  const groups = (await readLockedLines(tx, orderId)).map(({ identity }) =>
    (identity.lineIds ?? [identity.id]).map((id) => subjectOf.get(id)!),
  );
  const results = spreadBillDiscount(
    groups.map((members) => {
      const { row, exact } = members[0]!;
      const quantity = members.reduce((sum, member) => sum + member.quantity, 0);
      return {
        lineId: row.id,
        addedOrder: row.lineNo,
        gross: gross(row, quantity),
        quantity: thousandthsToDecimal(quantity),
        priceQuantity: thousandthsToDecimal(row.priceQuantity),
        grossUnit: centsToDecimal(row.unit),
        exact,
      };
    }),
    discount,
  );
  const ordinal = (subject: Subject) => bindings.get(subject.row.id)?.ordinal ?? 0;
  return groups.flatMap((members) =>
    handOut(
      [...members].sort((a, b) => ordinal(a) - ordinal(b)),
      results.get(members[0]!.row.id)!.rows,
    ).filter(({ reduction }) => compareDecimal(reduction, ZERO) !== 0),
  );
}

/** One line's priced rows handed to the lines standing for it, in the order given, each taking
 * its own quantity from the rows that are left, the higher price first. */
function handOut(
  members: readonly Pick<Subject, "row" | "quantity" | "carved">[],
  priced: readonly PricedRow[],
): Change[] {
  const pieces = priced.map((piece) => ({ ...piece, left: decimalToThousandths(piece.quantity) }));
  return members.map(({ row, quantity, carved }) => {
    const rows: PricedRow[] = [];
    const cuts: Decimal[] = [];
    for (let need = quantity; need > 0;) {
      const piece = pieces.find((candidate) => candidate.left > 0)!;
      const take = Math.min(need, piece.left);
      piece.left -= take;
      need -= take;
      rows.push({ quantity: thousandthsToDecimal(take), unitGross: piece.unitGross });
      cuts.push(
        subtractDecimal(gross(row, take), gross(row, take, decimalToCents(piece.unitGross))),
      );
    }
    return { row, carved, rows, reduction: sumDecimals(cuts) };
  });
}

/**
 * The dish lines a part of a row takes (plan D32): the last `covered` portions by line number not
 * already cancelled, so the row's first portion, which the record names, stays while any of the row
 * does. Else `adjustment.quantity_invalid`, as more than today's line holds is.
 */
async function takenPortions(
  tx: Transaction,
  orderId: string,
  dish: Row,
  members: readonly Row[],
  covered: number,
): Promise<Set<string>> {
  const cancelled = await readLineCancellations(
    tx,
    members.map(({ id }) => id),
  );
  const active = members.filter(({ id }) => (cancelled.get(id) ?? 0) === 0);
  const count = covered / 1000;
  if (count > active.length) {
    throw new AppError("adjustment.quantity_invalid", {
      workingOrderId: orderId,
      lineNo: dish.lineNo,
      quantity: thousandthsToDecimal(covered),
    });
  }
  return new Set(active.slice(active.length - count).map(({ id }) => id));
}

/** A row of identical portions as one stand-in line (plan D32), and what it stands for. */
interface StandIn {
  /** The stand-in dish: the first portion's id, prices and line number, the members' quantity. */
  dish: Row;
  /** What the request acts on: the stand-in dish, or one of its stand-in extras (plan D34). */
  line: Row;
  /** The bill's rows with the members and their extras replaced by the stand-in lines. */
  view: Row[];
  /** Every member's dish and extras lines. */
  lines: Row[];
  /** Each stand-in line's id, and the lines it stands for, in line order. */
  membersOf: Map<string, Row[]>;
}

const STAGE_RANK: Record<AdjustmentStage, number> = { unsent: 0, held: 1, fired: 2, served: 3 };

/** Object keys sorted, so stored descriptions in a different key order compare equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** What a filed group shows, its quantity, cohort and position left out; a list price equal to the
 * price reads as none, as filing drops it. */
function groupFields({ identity, locked }: StoredOrderLine): unknown {
  const { id, lineIds, portionIds, listUnitGross, ...kept } = identity;
  void id;
  void lineIds;
  void portionIds;
  return {
    ...kept,
    listUnitGross:
      listUnitGross !== null && compareDecimal(listUnitGross, decimal(locked.grossUnitPrice)) !== 0
        ? listUnitGross
        : null,
    locked: { ...locked, quantity: null, parentLineNo: null },
  };
}

/** The filed group holding dish line `lineId`, compared without its cohort: its fields and each of
 * its extras' fields and quantity per dish. */
function cohortFreeKey(groups: readonly StoredOrderLine[], lineId: string): string {
  const at = groups.findIndex(
    (group) => group.locked.parentLineNo == null && (group.identity.lineIds ?? []).includes(lineId),
  );
  const dish = groups[at]!;
  const extras = groups
    .filter((group) => group.locked.parentLineNo === at + 1)
    .map((extra) =>
      canonical([
        groupFields(extra),
        divideDecimal(
          decimal(extra.locked.quantity),
          decimal(dish.locked.quantity),
          QUANTITY_SCALE,
        ),
      ]),
    )
    .sort();
  return canonical([groupFields(dish), extras]);
}

/**
 * The till row `ask.lineIds` names as one stand-in line, else `management.request_invalid` on
 * `lineIds`: each member a dish line of this bill bound to a whole, unmeasured portion, every one
 * of them in one filed group but for the cohort, with one note and one course (plan D31) — or one
 * extra of each such dish, the same extra on every one (D34). The stand-in's extras are the
 * members' extras, one per extra, each at the first member's extra's line number; its served
 * quantity is the members' sum and its kitchen facts the furthest member's (D32).
 */
async function standInRow(
  tx: Transaction,
  orderId: string,
  ask: Pick<AdjustmentAsk, "lineId" | "lineIds" | "action">,
  rows: readonly Row[],
): Promise<StandIn> {
  const ids = ask.lineIds!;
  // Every refusal here is a fault in Waitron: the till names only the rows it grouped.
  if (ids.length < 2 || new Set(ids).size !== ids.length || !ids.includes(ask.lineId!)) {
    throw invalid("lineIds");
  }
  const named = ids.map((id) => rows.find((row) => row.id === id));
  if (named.some((one) => one === undefined)) throw invalid("lineIds");
  const extrasRow = named[0]!.parentLineId !== null;
  // An extra is cancelled on its own only from its own line.
  if (extrasRow && ask.action === "cancel") throw invalid("lineIds");
  if (named.some((one) => (one!.parentLineId !== null) !== extrasRow)) throw invalid("lineIds");
  const dishIds = extrasRow ? named.map((one) => one!.parentLineId!) : ids;
  if (new Set(dishIds).size !== dishIds.length) throw invalid("lineIds");
  const members = dishIds.map((id) => rows.find((row) => row.id === id)!);
  const whole = await readWholePortionLines(tx, dishIds);
  if (dishIds.some((id) => !whole.has(id))) throw invalid("lineIds");
  const groups = await readLockedLines(tx, orderId);
  if (new Set(dishIds.map((id) => cohortFreeKey(groups, id))).size !== 1) {
    throw invalid("lineIds");
  }
  // Filing groups dishes whatever their note or course; the till's row does not.
  if (new Set(members.map((member) => canonical([member.note, member.courseId]))).size !== 1) {
    throw invalid("lineIds");
  }

  const dishes = members.sort((a, b) => a.lineNo - b.lineNo);
  const extraOrder = (row: Row) => canonical([row.name, row.variantName, row.unit, row.quantity]);
  const families = dishes.map((dish) => ({
    dish,
    extras: rows
      .filter((row) => row.parentLineId === dish.id)
      .sort((a, b) => (extraOrder(a) < extraOrder(b) ? -1 : extraOrder(a) > extraOrder(b) ? 1 : 0)),
  }));
  const sum = (lines: readonly Row[], of: (row: Row) => number) =>
    lines.reduce((total, row) => total + of(row), 0);
  const furthest = dishes.reduce((far, dish) =>
    STAGE_RANK[stageOf(dish)] > STAGE_RANK[stageOf(far)] ? dish : far,
  );
  const first = families[0]!;
  const dish: Row = {
    ...first.dish,
    quantity: sum(dishes, (row) => row.quantity),
    servedQuantity: sum(dishes, (row) => row.servedQuantity),
    firedQuantity: sum(dishes, (row) => row.firedQuantity),
    groupId: furthest.groupId,
    groupState: furthest.groupState,
    sentAt: furthest.sentAt,
    ticketItemId: furthest.ticketItemId,
    ticketFiredAt: furthest.ticketFiredAt,
    ticketMadeHere: furthest.ticketMadeHere,
    stationId: furthest.stationId,
    ticketState: furthest.ticketState,
  };
  const membersOf = new Map<string, Row[]>([[dish.id, dishes]]);
  const extras = first.extras.map((extra, i) => {
    const standing = families.map((family) => family.extras[i]!);
    membersOf.set(extra.id, standing);
    return { ...extra, quantity: sum(standing, (row) => row.quantity) };
  });
  const lines = families.flatMap((family) => [family.dish, ...family.extras]);
  const replaced = new Set(lines.map((row) => row.id));
  let line = dish;
  if (extrasRow) {
    const asked = new Set(ids);
    const extra = extras.find(({ id }) => {
      const standing = membersOf.get(id)!;
      return standing.length === asked.size && standing.every((one) => asked.has(one.id));
    });
    if (extra === undefined) throw invalid("lineIds");
    line = extra;
  }
  return {
    dish,
    line,
    view: [...rows.filter((row) => !replaced.has(row.id)), dish, ...extras].sort(
      (a, b) => a.lineNo - b.lineNo,
    ),
    lines,
    membersOf,
  };
}

/** The dish lines, in line order, of the till row a cancel's `lineIds` names, `lineId` among them;
 * refused as {@link standInRow} refuses a row the till could not have drawn. */
export async function cancelRowMembers(
  tx: Transaction,
  orderId: string,
  lineId: string,
  lineIds: readonly string[],
): Promise<string[]> {
  const row = await standInRow(
    tx,
    orderId,
    { lineId, lineIds: [...lineIds], action: "cancel" },
    await readRows(tx, orderId),
  );
  return row.membersOf.get(row.dish.id)!.map(({ id }) => id);
}

/**
 * The dish lines `lineIds` names, gathered into the rows the till would draw them as, each row in
 * line order and the rows in the order of their first line in `lineIds`: whole portions in one filed
 * group, its cohort included, with the same note and course; any other line alone. For a Discard,
 * which names no rows (plan D31's one exception).
 */
export async function rowsAmong(
  tx: Transaction,
  orderId: string,
  lineIds: readonly string[],
): Promise<string[][]> {
  const rows = await readRows(tx, orderId);
  const whole = await readWholePortionLines(tx, lineIds);
  const groups = await readLockedLines(tx, orderId);
  const keyOf = (id: string) => {
    if (!whole.has(id)) return id;
    const row = rows.find((one) => one.id === id)!;
    const group = groups.findIndex(({ identity }) => (identity.lineIds ?? []).includes(id));
    return canonical([group, row.note, row.courseId]);
  };
  const byKey = new Map<string, Row[]>();
  for (const id of lineIds) {
    const key = keyOf(id);
    byKey.set(key, [...(byKey.get(key) ?? []), rows.find((one) => one.id === id)!]);
  }
  return [...byKey.values()].map((row) =>
    row.sort((a, b) => a.lineNo - b.lineNo).map(({ id }) => id),
  );
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
  let removedPortions: Row[] | null = null;
  let carve: Carve | null = null;
  let changes: Change[] = [];
  let writes: Change[] | null = null;
  let stamped: string[] = [];
  const rowSplits: AdjustmentSplit[] = [];
  let row: StandIn | null = null;
  let view: readonly Row[] = rows;
  let compedExtras: string[] = [];
  let reduction: Decimal;
  let nominal: Decimal;
  let before: Decimal;
  if (ask.lineId === null) {
    if (ask.action === "cancel" || ask.action === "comp") throw invalid("lineId");
    if (ask.quantity !== undefined) throw invalid("quantity");
    const families = new Set(rows.flatMap((row) => row.parentLineId ?? []));
    before = sumDecimals(rows.map((row) => gross(row, row.quantity)));
    changes = await spreadOverFiledRows(
      tx,
      orderId,
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
    if (ask.lineIds !== undefined) {
      row = await standInRow(tx, orderId, ask, rows);
      ({ line, view } = row);
    }
    const target = line;
    // An extra has no extras of its own, so it is a family of one.
    const family = [target, ...view.filter((other) => other.parentLineId === target.id)];
    covered = coveredQuantity(orderId, target, ask.quantity);
    const partial = covered < target.quantity;
    const weighed = (target.unitPrecision ?? 0) > 0;
    if (ask.action === "cancel") {
      if (ask.percentBp !== undefined) throw invalid("percentBp");
      if (ask.amount !== undefined) throw invalid("amount");
      if (row === null) {
        const cancelled = await readLineCancellations(tx, [target.id]);
        if (covered > serviceQuantities(target.quantity, 0, cancelled.get(target.id) ?? 0).active)
          throw new AppError("adjustment.quantity_invalid", {
            workingOrderId: orderId,
            lineNo: target.lineNo,
            quantity: ask.quantity ?? thousandthsToDecimal(covered),
          });
        removed = partial ? covered : null;
      } else {
        const members = row.membersOf.get(target.id)!;
        const taken = await takenPortions(tx, orderId, target, members, covered);
        removedPortions = members.filter((one) => taken.has(one.id));
      }
      const left = familyAt(family, target.quantity - covered);
      reduction = sumDecimals(
        family.map((row) =>
          subtractDecimal(gross(row, row.quantity), gross(row, left.get(row.id)!)),
        ),
      );
      nominal = sumDecimals(family.map((row) => listValue(row, row.quantity - left.get(row.id)!)));
      before = reduction;
      await refusePaidLines(
        tx,
        orderId,
        removedPortions === null
          ? [{ id: target.id, lineNo: target.lineNo, keeps: target.quantity - covered }]
          : removedPortions.map((one) => ({ id: one.id, lineNo: one.lineNo, keeps: 0 })),
      );
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
      const standingFor = (one: Row) => (row === null ? [one] : row.membersOf.get(one.id)!);
      const covering = family.flatMap(standingFor);
      if (ask.action === "comp" && !partial) {
        compedExtras = family
          .slice(1)
          .flatMap(standingFor)
          .map((one) => one.id);
      }
      if (row !== null) {
        const { membersOf } = row;
        const taken = partial
          ? await takenPortions(tx, orderId, target, membersOf.get(target.id)!, covered)
          : null;
        const takenOf = (standIn: Row) =>
          membersOf
            .get(standIn.id)!
            .filter((member) => taken === null || taken.has(member.parentLineId ?? member.id));
        // Today the part is carved off the line and each of its extras (plan D33).
        if (taken !== null) {
          for (const standIn of family) {
            rowSplits.push({ from: standingFor(standIn)[0]!.id, to: takenOf(standIn)[0]!.id });
          }
        }
        stamped = changes.flatMap((change) => standingFor(change.row).map((one) => one.id));
        writes = changes.flatMap((change) => {
          const portions = handOut(
            takenOf(change.row).map((member) => ({
              row: member,
              quantity: member.quantity,
              carved: false,
            })),
            change.rows,
          );
          // Today the line's second price is split off it (plan D33).
          const lower = change.rows[1];
          if (lower !== undefined) {
            rowSplits.push({
              from: portions[0]!.row.id,
              to: portions.find(
                (portion) => compareDecimal(portion.rows[0]!.unitGross, lower.unitGross) === 0,
              )!.row.id,
            });
          }
          return portions;
        });
      }
      reduction = sumDecimals(changes.map((change) => change.reduction));
      nominal = sumDecimals(subjects.map(({ row, quantity }) => listValue(row, quantity)));
      await refusePaidLines(
        tx,
        orderId,
        covering.map((one) => ({ id: one.id, lineNo: one.lineNo, keeps: 0 })),
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
  const stage = line === null ? null : stageOf(dishOf(line, view));
  const verdict =
    ask.action === "cancel"
      ? evaluateCancel(reason, { actorRole, note: ask.note, stage: stage! })
      : await judgeComp(tx, reason, {
          orderId,
          action: ask.action,
          rows,
          writes: writes ?? changes,
          carve,
          reduction,
          before,
          actorRole,
          note: ask.note,
        });
  if (verdict.kind === "refused") throw new AppError(verdict.code, {});
  const parents = new Set(
    [
      ...(ask.action === "cancel" ? [line!] : changes.map((change) => change.row)),
      ...(row?.lines ?? []),
    ].map((one) => one.parentLineId ?? one.id),
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
    removedPortions,
    carve,
    changes,
    writes: writes ?? changes,
    stamped,
    rowSplits,
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

/** A comp action's verdict (design §3.2); a reason's per-dish limit is a price floor (plan D36), and
 * past the bill's limit the approver must be allowed both it and the reason (plan D37). */
async function judgeComp(
  tx: Transaction,
  reason: AdjustmentReason,
  ask: {
    orderId: string;
    action: CompAction;
    /** Every line of the bill, as {@link readRows} reads it. */
    rows: readonly Row[];
    /** What this request writes, on the bill's own lines. */
    writes: readonly Change[];
    carve: Carve | null;
    reduction: Decimal;
    /** What the request's subject cost before it. */
    before: Decimal;
    actorRole: PersonRoleValue;
    note: string | null;
  },
): Promise<AdjustmentVerdict> {
  const { orderId, rows } = ask;
  const standingOnBill = standingOff(
    await readReasonStanding(tx, { workingOrderId: orderId, reasonId: reason.id }),
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
    takesAll: compareDecimal(ask.reduction, ask.before) === 0,
    standingOnBill,
    dishes: dishPrices(ask.writes, rows, ask.carve),
    billComped,
    billLimit: { maxAmount: maxBillComp, approverRoles: billApproverRoles },
  });
}

/**
 * Each dish `writes` names, as the floor reads it (plan D36 readings 3 to 5): a dish without extras
 * once for each price its change leaves it at; a dish with extras once, its lines summed at the
 * quantity of it the request covers. A portion of a row the request takes nothing off is named too;
 * {@link standInRow} admits only portions of one price, so it is below its floor only when one the
 * request reduces is too.
 */
function dishPrices(
  writes: readonly Change[],
  rows: readonly Row[],
  carve: Carve | null,
): DishPrice[] {
  const byDish = new Map<string, Change[]>();
  for (const change of writes) {
    const dishId = change.row.parentLineId ?? change.row.id;
    byDish.set(dishId, [...(byDish.get(dishId) ?? []), change]);
  }
  const quantityOf = (change: Change) =>
    change.rows.reduce((sum, priced) => sum + decimalToThousandths(priced.quantity), 0);
  const allowanceOf = (lines: { row: Row; quantity: number }[]) =>
    floorAllowance(
      lines.map(({ row, quantity }) => ({
        quantity: thousandthsToDecimal(quantity),
        priceQuantity: thousandthsToDecimal(row.priceQuantity),
      })),
    );
  const dishes: DishPrice[] = [];
  for (const [dishId, changed] of byDish) {
    const dish = rows.find((row) => row.id === dishId)!;
    const family = [dish, ...rows.filter((row) => row.parentLineId === dishId)];
    const onDish = changed.find((change) => change.row.id === dishId);
    if (family.length === 1) {
      for (const priced of onDish!.rows) {
        const quantity = decimalToThousandths(priced.quantity);
        dishes.push({
          list: listValue(dish, quantity),
          after: gross(dish, quantity, decimalToCents(priced.unitGross)),
          allowance: allowanceOf([{ row: dish, quantity }]),
        });
      }
      continue;
    }
    // A dish at €0.00 keeps no change of its own here, though part of it was carved with its extras.
    const covered =
      onDish !== undefined
        ? quantityOf(onDish)
        : changed.some((change) => change.carved)
          ? carve!.quantity
          : dish.quantity;
    const at = familyAt(family, covered);
    const lines = family.map((row) => {
      const change = changed.find((one) => one.row.id === row.id);
      const quantity = change === undefined ? at.get(row.id)! : quantityOf(change);
      const after =
        change === undefined
          ? gross(row, quantity)
          : sumDecimals(
              change.rows.map((priced) =>
                gross(row, decimalToThousandths(priced.quantity), decimalToCents(priced.unitGross)),
              ),
            );
      return { row, quantity, list: listValue(row, quantity), after };
    });
    dishes.push({
      list: sumDecimals(lines.map(({ list }) => list)),
      after: sumDecimals(lines.map(({ after }) => after)),
      allowance: allowanceOf(lines),
    });
  }
  return dishes;
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
 * a carved dish before its extras, and what each change took off each line it lowered.
 */
async function reprice(
  tx: Transaction,
  cfg: TradingContext,
  orderId: string,
  carve: Carve | null,
  changes: readonly Change[],
  stamped: readonly string[],
): Promise<{ splits: AdjustmentSplit[]; taken: LineReduction[] }> {
  const touched = [...new Set([...changes.map(({ row }) => row.id), ...stamped])];
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
  const taken: LineReduction[] = [];
  for (const { id, change } of subjects) {
    const [first, lower] = change.rows;
    await setPrice(tx, id, first!, change.row.priceQuantity);
    const second = seconds.get(id);
    let firstReduction = change.reduction;
    if (second !== undefined) {
      splits.push({ from: id, to: second.id });
      await setPrice(tx, second.id, lower!, change.row.priceQuantity);
      const quantity = decimalToThousandths(lower!.quantity);
      const reduction = subtractDecimal(
        gross(change.row, quantity),
        gross(change.row, quantity, decimalToCents(lower!.unitGross)),
      );
      firstReduction = subtractDecimal(change.reduction, reduction);
      taken.push({ lineId: second.id, reduction, quantity });
    }
    taken.push({
      lineId: id,
      reduction: firstReduction,
      quantity: decimalToThousandths(first!.quantity),
    });
  }
  return {
    splits,
    taken: taken.filter(({ reduction }) => compareDecimal(reduction, ZERO) !== 0),
  };
}

/** What a comp or a discount took off one line, `quantity` of it then (plan D37). */
interface LineReduction {
  lineId: string;
  reduction: Decimal;
  quantity: number;
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
  cfg: TradingContext,
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
      let taken: LineReduction[] = [];
      if (plan.removedPortions !== null) {
        await removePortions(
          tx,
          cfg,
          args.orderId,
          plan.removedPortions.map(voidTargetOf),
          args.operatorId,
          activity,
          args.preparationStarted,
        );
      } else if (args.action === "cancel") {
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
        const repriced = await reprice(
          tx,
          cfg,
          args.orderId,
          plan.carve,
          plan.writes,
          plan.stamped,
        );
        splits = [...repriced.splits, ...plan.rowSplits];
        taken = repriced.taken;
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
        preparationStarted: args.recordedPreparationStarted ?? null,
      });
      if (taken.length > 0) {
        await tx.insert(adjustmentLines).values(
          taken.map(({ lineId, reduction, quantity }) => ({
            adjustmentId: id,
            lineId,
            reduction: decimalToCents(reduction),
            quantity,
          })),
        );
      }
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
