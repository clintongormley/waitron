import { and, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import { workingOrderLines, workingOrders, type Transaction } from "@waitron/db";
import { persons } from "@waitron/identity";
import { validatedRangeWindow } from "@waitron/reporting";
import {
  addDecimal,
  centsToDecimal,
  compareDecimal,
  decimal,
  divideDecimal,
  multiplyDecimal,
  rawCentsToDecimal,
  thousandthsToDecimal,
  type Decimal,
} from "@waitron/shared";
import { ADJUSTMENT_ACTIONS, type AdjustmentAction } from "./policy.js";
import { adjustments, type AdjustmentStage } from "./schema/adjustments.js";

/** An inclusive range of the venue's business days, and the clock that places them. */
export interface AdjustmentReportInput {
  fromBusinessDay: string;
  toBusinessDay: string;
  timeZone: string;
  dayCutover: string;
}

/** How far the adjusted item had got; a discount on the whole bill has no stage of its own. */
export const ADJUSTMENT_STAGE_GROUPS = [
  "beforeFiring",
  "afterFiring",
  "afterServing",
  "billDiscount",
] as const;

export type AdjustmentStageGroup = (typeof ADJUSTMENT_STAGE_GROUPS)[number];

export interface AdjustmentTally {
  count: number;
  /** What the bills actually lost. */
  reduction: Decimal;
  /** The list value of the items cancellations took off; comps and discounts add nothing. */
  cancelledNominalValue: Decimal;
}

export interface ReasonTally extends AdjustmentTally {
  reasonId: string;
  /** The name the reason's most recent row in the range recorded. */
  reasonName: string;
}

export interface AdjustmentTotals extends AdjustmentTally {
  byAction: Record<AdjustmentAction, AdjustmentTally>;
  byStage: Record<AdjustmentStageGroup, AdjustmentTally>;
  /** Largest reduction first. */
  byReason: ReasonTally[];
}

export interface PersonRef {
  personId: string;
  /** Null when the directory holds no such person. */
  name: string | null;
}

/**
 * One person's row: the adjustments they requested (never a guest's), measured against the sales
 * credited to them at their prices before any adjustment (plan D21).
 */
export interface PersonAdjustments extends AdjustmentTotals, PersonRef {
  sales: Decimal;
  /** The reduction as a percentage of `sales`, to one place; null when there are no sales. */
  ratePercent: Decimal | null;
  /** Who approved this person's requests, and how many each. */
  approvers: (PersonRef & { count: number })[];
  /** Requests by someone else, or by a guest, that this person approved. */
  approvalsGiven: number;
}

export interface AdjustmentReport {
  fromBusinessDay: string;
  toBusinessDay: string;
  /** Everyone's, the guests' included; `sales` includes lines credited to nobody. */
  overall: AdjustmentTotals & { sales: Decimal; ratePercent: Decimal | null };
  /** By name. */
  people: PersonAdjustments[];
  guests: AdjustmentTotals;
}

/** One adjustment as the drill-down lists it, with the reason and the line as they were. */
export interface AdjustmentEntry {
  id: string;
  createdAt: string;
  action: AdjustmentAction;
  stage: AdjustmentStage | null;
  reasonId: string;
  reasonName: string;
  note: string | null;
  lineName: string | null;
  /** How much of the line was adjusted; null on a discount on the whole bill. */
  quantity: Decimal | null;
  percentBp: number | null;
  beforeAmount: Decimal;
  afterAmount: Decimal;
  reduction: Decimal;
  nominalValue: Decimal;
  requestedBy: PersonRef;
  approvedBy: PersonRef | null;
  creditedTo: PersonRef | null;
  byGuest: boolean;
  workingOrderId: string;
  orderNumber: number;
}

/** Everyone's requests, or one person's (never a guest's), or the guests' alone. */
export type AdjustmentRequester = { personId: string } | "guests";

const ZERO = decimal("0.00");
const HUNDRED = decimal("100");

const STAGE_GROUP: Record<AdjustmentStage, AdjustmentStageGroup> = {
  unsent: "beforeFiring",
  held: "beforeFiring",
  fired: "afterFiring",
  served: "afterServing",
};

function validated(input: AdjustmentReportInput): SQL {
  return validatedRangeWindow(input)(sql`${workingOrders.openedAt}`);
}

function emptyTally(): AdjustmentTally {
  return { count: 0, reduction: ZERO, cancelledNominalValue: ZERO };
}

/** What the totals read of one adjustment. */
interface Tallied {
  action: AdjustmentAction;
  stage: AdjustmentStage | null;
  reasonId: string;
  reduction: Decimal;
  nominalValue: Decimal;
}

function add(tally: AdjustmentTally, row: Tallied): void {
  tally.count += 1;
  tally.reduction = addDecimal(tally.reduction, row.reduction);
  if (row.action === "cancel") {
    tally.cancelledNominalValue = addDecimal(tally.cancelledNominalValue, row.nominalValue);
  }
}

/** Totals while they are being summed: reasons keyed by id, named at the end. */
interface Accumulator extends AdjustmentTally {
  byAction: Record<AdjustmentAction, AdjustmentTally>;
  byStage: Record<AdjustmentStageGroup, AdjustmentTally>;
  byReason: Map<string, AdjustmentTally>;
}

function accumulator(): Accumulator {
  return {
    ...emptyTally(),
    byAction: Object.fromEntries(
      ADJUSTMENT_ACTIONS.map((action) => [action, emptyTally()]),
    ) as Record<AdjustmentAction, AdjustmentTally>,
    byStage: Object.fromEntries(
      ADJUSTMENT_STAGE_GROUPS.map((group) => [group, emptyTally()]),
    ) as Record<AdjustmentStageGroup, AdjustmentTally>,
    byReason: new Map(),
  };
}

function tallyRow(into: Accumulator, row: Tallied): void {
  add(into, row);
  add(into.byAction[row.action], row);
  add(into.byStage[row.stage === null ? "billDiscount" : STAGE_GROUP[row.stage]], row);
  let reason = into.byReason.get(row.reasonId);
  if (reason === undefined) {
    reason = emptyTally();
    into.byReason.set(row.reasonId, reason);
  }
  add(reason, row);
}

function totalsOf(acc: Accumulator, reasonNames: Map<string, string>): AdjustmentTotals {
  const byReason = [...acc.byReason].map(([reasonId, tally]) => ({
    reasonId,
    reasonName: reasonNames.get(reasonId)!,
    ...tally,
  }));
  byReason.sort(
    (a, b) =>
      compareDecimal(b.reduction, a.reduction) ||
      a.reasonName.localeCompare(b.reasonName) ||
      a.reasonId.localeCompare(b.reasonId),
  );
  return {
    count: acc.count,
    reduction: acc.reduction,
    cancelledNominalValue: acc.cancelledNominalValue,
    byAction: acc.byAction,
    byStage: acc.byStage,
    byReason,
  };
}

function rateOf(reduction: Decimal, sales: Decimal): Decimal | null {
  if (compareDecimal(sales, ZERO) <= 0) return null;
  return divideDecimal(multiplyDecimal(reduction, HUNDRED), sales, 1);
}

/**
 * What the report reads of each adjustment on the bills opened in the range, in no order, with
 * the name its reason's most recent row in the range recorded.
 */
async function readReportRows(tx: Transaction, window: SQL) {
  const rows = await tx
    .select({
      action: adjustments.action,
      stage: adjustments.stage,
      reasonId: adjustments.reasonId,
      newestReasonName: sql<string>`first_value(${adjustments.reasonName}) over (
        partition by ${adjustments.reasonId}
        order by ${adjustments.createdAt} desc, ${adjustments.id} desc)`,
      reduction: adjustments.reduction,
      nominalValue: adjustments.nominalValue,
      requestedBy: adjustments.requestedBy,
      approvedBy: adjustments.approvedBy,
      creditedTo: adjustments.creditedTo,
      byGuest: adjustments.byGuest,
    })
    .from(adjustments)
    .innerJoin(workingOrders, eq(workingOrders.id, adjustments.workingOrderId))
    .where(window);
  return rows.map((row) => ({
    ...row,
    reduction: centsToDecimal(row.reduction),
    nominalValue: centsToDecimal(row.nominalValue),
  }));
}

/** The adjustments on bills opened in the range, newest first, converted at the row. */
async function readRows(tx: Transaction, window: SQL, filter?: SQL) {
  const rows = await tx
    .select({
      id: adjustments.id,
      createdAt: adjustments.createdAt,
      action: adjustments.action,
      stage: adjustments.stage,
      reasonId: adjustments.reasonId,
      reasonName: adjustments.reasonName,
      note: adjustments.note,
      lineName: adjustments.lineName,
      quantity: adjustments.quantity,
      percentBp: adjustments.percentBp,
      beforeAmount: adjustments.beforeAmount,
      afterAmount: adjustments.afterAmount,
      reduction: adjustments.reduction,
      nominalValue: adjustments.nominalValue,
      requestedBy: adjustments.requestedBy,
      approvedBy: adjustments.approvedBy,
      creditedTo: adjustments.creditedTo,
      byGuest: adjustments.byGuest,
      workingOrderId: adjustments.workingOrderId,
      orderNumber: workingOrders.orderNumber,
    })
    .from(adjustments)
    .innerJoin(workingOrders, eq(workingOrders.id, adjustments.workingOrderId))
    .where(filter === undefined ? window : and(window, filter))
    .orderBy(desc(adjustments.createdAt), desc(adjustments.id));
  return rows.map((row) => ({
    ...row,
    quantity: row.quantity === null ? null : thousandthsToDecimal(row.quantity),
    beforeAmount: centsToDecimal(row.beforeAmount),
    afterAmount: centsToDecimal(row.afterAmount),
    reduction: centsToDecimal(row.reduction),
    nominalValue: centsToDecimal(row.nominalValue),
  }));
}

async function namesOf(tx: Transaction, ids: Set<string>): Promise<Map<string, string>> {
  if (ids.size === 0) return new Map();
  const rows = await tx
    .select({ id: persons.id, name: persons.displayName })
    .from(persons)
    .where(inArray(persons.id, [...ids]));
  return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * The sales credited to each person (null: to nobody) on the bills opened in the range, abandoned
 * bills aside (their lines were never sold): each line at its first price times its quantity,
 * rounded to the cent half away from zero as `grossOf` rounds a line total, then summed. A price
 * is whole cents and a quantity whole thousandths, so their product is in thousandths of a cent;
 * integer division truncates toward zero, hence the sign-dependent half.
 */
async function readCreditedSales(
  tx: Transaction,
  window: SQL,
): Promise<{ creditedTo: string | null; sales: Decimal }[]> {
  const value = sql`coalesce(${workingOrderLines.listUnitPriceGross}, ${workingOrderLines.unitPriceGross}) * ${workingOrderLines.quantity}`;
  const rows = await tx
    .select({
      creditedTo: workingOrderLines.creditedTo,
      cents: sql<string>`cast(sum(case when ${value} >= 0 then (${value} + 500) / 1000
        else -((500 - ${value}) / 1000) end) as text)`,
    })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .where(and(window, ne(workingOrders.status, "abandoned")))
    .groupBy(workingOrderLines.creditedTo);
  return rows.map((row) => ({ creditedTo: row.creditedTo, sales: rawCentsToDecimal(row.cents) }));
}

interface PersonAccumulator extends Accumulator {
  sales: Decimal;
  approvers: Map<string, number>;
  approvalsGiven: number;
}

/**
 * The adjustments on the bills opened in the range, overall, per requesting person and for guests,
 * with each person's rate against the sales credited to them (plan D21): the lines credited to
 * them at their prices before any adjustment, and the list value of each cancellation whose line
 * was credited to them, since a cancelled line has left the bill. Who issued the invoice plays no
 * part, and neither do invoices or their voids.
 */
export async function computeAdjustmentReport(
  tx: Transaction,
  input: AdjustmentReportInput,
): Promise<AdjustmentReport> {
  const window = validated(input);
  const rows = await readReportRows(tx, window);
  const credited = await readCreditedSales(tx, window);

  const people = new Map<string, PersonAccumulator>();
  const personAcc = (personId: string): PersonAccumulator => {
    let acc = people.get(personId);
    if (acc === undefined) {
      acc = { ...accumulator(), sales: ZERO, approvers: new Map(), approvalsGiven: 0 };
      people.set(personId, acc);
    }
    return acc;
  };
  const overall = accumulator();
  const guests = accumulator();
  let overallSales = ZERO;
  const credit = (personId: string | null, value: Decimal) => {
    overallSales = addDecimal(overallSales, value);
    if (personId === null) return;
    const acc = personAcc(personId);
    acc.sales = addDecimal(acc.sales, value);
  };

  for (const { creditedTo, sales } of credited) credit(creditedTo, sales);
  const reasonNames = new Map<string, string>();
  for (const row of rows) {
    reasonNames.set(row.reasonId, row.newestReasonName);
    tallyRow(overall, row);
    if (row.action === "cancel") credit(row.creditedTo, row.nominalValue);
    if (row.byGuest) {
      tallyRow(guests, row);
    } else {
      const requester = personAcc(row.requestedBy);
      tallyRow(requester, row);
      if (row.approvedBy !== null) {
        requester.approvers.set(row.approvedBy, (requester.approvers.get(row.approvedBy) ?? 0) + 1);
      }
    }
    if (row.approvedBy !== null && (row.byGuest || row.approvedBy !== row.requestedBy)) {
      personAcc(row.approvedBy).approvalsGiven += 1;
    }
  }

  const names = await namesOf(tx, new Set(people.keys()));
  const ref = (personId: string): PersonRef => ({ personId, name: names.get(personId) ?? null });
  const personRows = [...people].map(([personId, acc]) => ({
    ...ref(personId),
    ...totalsOf(acc, reasonNames),
    sales: acc.sales,
    ratePercent: rateOf(acc.reduction, acc.sales),
    // A stable sort, so approvers with the same count stay in name order.
    approvers: byName(
      [...acc.approvers].map(([approverId, count]) => ({ ...ref(approverId), count })),
    ).sort((a, b) => b.count - a.count),
    approvalsGiven: acc.approvalsGiven,
  }));

  return {
    fromBusinessDay: input.fromBusinessDay,
    toBusinessDay: input.toBusinessDay,
    overall: {
      ...totalsOf(overall, reasonNames),
      sales: overallSales,
      ratePercent: rateOf(overall.reduction, overallSales),
    },
    people: byName(personRows),
    guests: totalsOf(guests, reasonNames),
  };
}

/** By name, then by id, with the people the directory no longer holds last. */
function byName<T extends PersonRef>(rows: T[]): T[] {
  const byId = (a: T, b: T) => a.personId.localeCompare(b.personId);
  const known = rows.filter((row) => row.name !== null);
  known.sort((a, b) => a.name!.localeCompare(b.name!) || byId(a, b));
  return [...known, ...rows.filter((row) => row.name === null).sort(byId)];
}

/**
 * The individual adjustments on the bills opened in the range, newest first: everyone's, one
 * person's own requests, or the guests'.
 */
export async function listAdjustmentEntries(
  tx: Transaction,
  input: AdjustmentReportInput & { requester?: AdjustmentRequester },
): Promise<AdjustmentEntry[]> {
  const window = validated(input);
  const { requester } = input;
  const filter =
    requester === undefined
      ? undefined
      : requester === "guests"
        ? eq(adjustments.byGuest, true)
        : and(eq(adjustments.requestedBy, requester.personId), eq(adjustments.byGuest, false));
  const rows = await readRows(tx, window, filter);
  const ids = new Set<string>();
  for (const row of rows) {
    ids.add(row.requestedBy);
    if (row.approvedBy !== null) ids.add(row.approvedBy);
    if (row.creditedTo !== null) ids.add(row.creditedTo);
  }
  const names = await namesOf(tx, ids);
  const ref = (personId: string): PersonRef => ({ personId, name: names.get(personId) ?? null });
  return rows.map((row) => ({
    ...row,
    requestedBy: ref(row.requestedBy),
    approvedBy: row.approvedBy === null ? null : ref(row.approvedBy),
    creditedTo: row.creditedTo === null ? null : ref(row.creditedTo),
  }));
}
