import { asc, eq, gte, inArray, or } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  activityLog,
  billPayments,
  drawerEntries,
  liveBackupQuery,
  persons,
  tableExists,
  workingOrderLines,
  workingOrders,
  type Database,
} from "@waitron/db";
import { payments } from "@waitron/payments";
import { paymentRefunds } from "@waitron/payments/src/schema/payment-refunds.js";
import { timeEntries } from "@waitron/workforce";
import {
  centsToDecimal,
  staffPresentationName,
  thousandthsToDecimal,
  type Decimal,
} from "@waitron/shared";
import { latestChangeAtMsFromMaxima } from "./handover-emergency-check.js";
import type { HeardCopy } from "./old-box-holdings.js";

// Text order is time order here only while every writer of these columns stores `toISOString()`'s spelling.

/** Where the old box's "since" tabs start listing rows, and which rule chose it. */
export type SinceRule =
  { kind: "copy"; fromMs: number } | { kind: "own"; fromMs: number } | { kind: "all" };

const COPY_MARGIN_MS = 10 * 60_000;
const OWN_SPAN_MS = 7 * 24 * 60 * 60_000;

const isDate = (ms: number) => !Number.isNaN(new Date(ms).getTime());

/** Whether a copy time from the main box is a whole millisecond whose cutoff is still a date. */
export function usableCopyTime(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    isDate(value as number) &&
    isDate((value as number) - COPY_MARGIN_MS)
  );
}

/** Reads only, with the database handle. A copy time that is not usable counts as not heard. */
export async function sinceRule(db: Database, heard: HeardCopy | null): Promise<SinceRule> {
  const copy =
    heard === null || heard.lastChangeAtMs === null || usableCopyTime(heard.lastChangeAtMs)
      ? heard
      : null;
  if (copy !== null)
    return copy.lastChangeAtMs === null
      ? { kind: "all" }
      : { kind: "copy", fromMs: copy.lastChangeAtMs - COPY_MARGIN_MS };
  const own = await latestChangeAtMsFromMaxima(liveBackupQuery(db));
  return own === null ? { kind: "all" } : { kind: "own", fromMs: own - OWN_SPAN_MS };
}

export interface ActivityRow {
  at: string;
  kind: string;
  personName: string | null;
  subjectKind: string;
  subjectId: string;
}

/** `activity_log` from the rule's start, oldest first; reads only, with the database handle. */
export async function readActivitySince(db: Database, rule: SinceRule): Promise<ActivityRow[]> {
  const rows = await db
    .select({
      at: activityLog.at,
      kind: activityLog.kind,
      personName: persons.displayName,
      subjectKind: activityLog.subjectKind,
      subjectId: activityLog.subjectId,
    })
    .from(activityLog)
    .leftJoin(persons, eq(persons.id, activityLog.personId))
    .where(rule.kind === "all" ? undefined : gte(activityLog.at, new Date(rule.fromMs)))
    .orderBy(asc(activityLog.at), asc(activityLog.id));
  return rows.map((row) => ({ ...row, at: row.at.toISOString() }));
}

export interface TimeEntryRow {
  personName: string | null;
  entryKind: string;
  eventAt: string;
  recordedAt: string;
  correctsEntryId: string | null;
  correctionStatus: string | null;
  correctionReason: string | null;
  id: string;
}

/** `time_entries` recorded from the rule's start, oldest first; reads only, with the database handle. */
export async function readTimeEntriesSince(db: Database, rule: SinceRule): Promise<TimeEntryRow[]> {
  return db
    .select({
      personName: persons.displayName,
      entryKind: timeEntries.entryKind,
      eventAt: timeEntries.eventAt,
      recordedAt: timeEntries.recordedAt,
      correctsEntryId: timeEntries.correctsEntryId,
      correctionStatus: timeEntries.correctionStatus,
      correctionReason: timeEntries.correctionReason,
      id: timeEntries.id,
    })
    .from(timeEntries)
    .leftJoin(persons, eq(persons.id, timeEntries.personId))
    .where(
      rule.kind === "all"
        ? undefined
        : gte(timeEntries.recordedAt, new Date(rule.fromMs).toISOString()),
    )
    .orderBy(asc(timeEntries.recordedAt), asc(timeEntries.sequenceNo));
}

export interface OrderRow {
  orderNumber: number;
  label: string | null;
  status: string;
  openedAt: string;
  settledAt: string | null;
  collectedAt: string | null;
  /** Null on the one row of an order with no lines, and so are the line's other fields. */
  lineNo: number | null;
  item: string | null;
  quantity: Decimal | null;
  unitPrice: Decimal | null;
  lineTotal: Decimal | null;
  sentAt: string | null;
  servedAt: string | null;
}

/**
 * Every line of each order opened, settled or collected from the rule's start, or with a line sent
 * or served from it (the times the emergency switch's latest-change read takes); reads only.
 */
export async function readOrdersSince(db: Database, rule: SinceRule): Promise<OrderRow[]> {
  const from = rule.kind === "all" ? null : new Date(rule.fromMs).toISOString();
  const rows = await db
    .select({
      orderNumber: workingOrders.orderNumber,
      label: workingOrders.label,
      status: workingOrders.status,
      openedAt: workingOrders.openedAt,
      settledAt: workingOrders.settledAt,
      collectedAt: workingOrders.collectedAt,
      lineNo: workingOrderLines.lineNo,
      name: workingOrderLines.name,
      variantName: workingOrderLines.variantName,
      quantity: workingOrderLines.quantity,
      unitPriceGross: workingOrderLines.unitPriceGross,
      lineTotal: workingOrderLines.lineTotal,
      sentAt: workingOrderLines.sentAt,
      servedAt: workingOrderLines.servedAt,
    })
    .from(workingOrders)
    .leftJoin(workingOrderLines, eq(workingOrderLines.workingOrderId, workingOrders.id))
    .where(
      from === null
        ? undefined
        : or(
            gte(workingOrders.openedAt, from),
            gte(workingOrders.settledAt, from),
            gte(workingOrders.collectedAt, from),
            inArray(
              workingOrders.id,
              db
                .select({ id: workingOrderLines.workingOrderId })
                .from(workingOrderLines)
                .where(
                  or(gte(workingOrderLines.sentAt, from), gte(workingOrderLines.servedAt, from)),
                ),
            ),
          ),
    )
    .orderBy(asc(workingOrders.orderNumber), asc(workingOrders.id), asc(workingOrderLines.lineNo));
  return rows.map(({ name, variantName, quantity, unitPriceGross, lineTotal, ...row }) => ({
    ...row,
    item: name === null ? null : staffPresentationName({ name, variantName }),
    quantity: quantity === null ? null : thousandthsToDecimal(quantity),
    unitPrice: unitPriceGross === null ? null : centsToDecimal(unitPriceGross),
    lineTotal: lineTotal === null ? null : centsToDecimal(lineTotal),
  }));
}

/** One payment fact; which fields are set depends on its kind. */
export type PaymentRow = {
  recordedAt: string;
  /** A payment's latest stored outcome or change; null on a row that never changes. */
  changedAt: string | null;
  amount: Decimal;
  orderNumber: number | null;
  id: string;
} & (
  | {
      kind: "part";
      tip: Decimal;
      method: string;
      state: string;
      personName: string | null;
    }
  | {
      kind: "card";
      state: string;
      provider: string;
      reference: string;
      partPaymentId: string | null;
    }
  | {
      kind: "refund";
      state: string;
      provider: string;
      /** The refunded card payment's reference. */
      reference: string;
      refundReference: string | null;
      personName: string | null;
    }
  | {
      kind: "drawer";
      drawerKind: string;
      partPaymentId: string | null;
      personName: string | null;
    }
);

const latest = (...times: (string | null)[]): string | null =>
  times.reduce<string | null>(
    (max, t) => (t !== null && (max === null || t > max) ? t : max),
    null,
  );

/**
 * Part payments, card payments and their refunds (when the payments module's tables exist) and
 * cash drawer entries recorded from the rule's start, with each earlier part or card payment whose
 * outcome or state changed from then; oldest first by the time that listed it. Reads only.
 */
export async function readPaymentsSince(db: Database, rule: SinceRule): Promise<PaymentRow[]> {
  const from = rule.kind === "all" ? null : new Date(rule.fromMs).toISOString();
  const since = (...columns: SQLiteColumn[]) =>
    from === null ? undefined : or(...columns.map((column) => gte(column, from)));
  const parts = await db
    .select({
      recordedAt: billPayments.createdAt,
      receivedAt: billPayments.receivedAt,
      failedAt: billPayments.failedAt,
      applied: billPayments.applied,
      tip: billPayments.tip,
      method: billPayments.method,
      state: billPayments.state,
      orderNumber: workingOrders.orderNumber,
      personName: persons.displayName,
      id: billPayments.id,
    })
    .from(billPayments)
    .innerJoin(workingOrders, eq(workingOrders.id, billPayments.workingOrderId))
    .leftJoin(persons, eq(persons.id, billPayments.requestedBy))
    .where(since(billPayments.createdAt, billPayments.receivedAt, billPayments.failedAt));
  const withCards = await tableExists(db, "payments");
  const cards = withCards
    ? await db
        .select({
          recordedAt: payments.createdAt,
          updatedAt: payments.updatedAt,
          settledAt: payments.settledAt,
          resolvedAt: payments.resolvedAt,
          heldAt: payments.heldAt,
          holdDecidedAt: payments.holdDecidedAt,
          amount: payments.amount,
          state: payments.state,
          orderNumber: workingOrders.orderNumber,
          provider: payments.provider,
          reference: payments.paymentRef,
          partPaymentId: payments.billPaymentId,
          id: payments.id,
        })
        .from(payments)
        .innerJoin(workingOrders, eq(workingOrders.id, payments.workingOrderId))
        // Not every change stamps updated_at: a resolution and a hold write only their own times.
        .where(
          since(
            payments.createdAt,
            payments.updatedAt,
            payments.settledAt,
            payments.resolvedAt,
            payments.heldAt,
            payments.holdDecidedAt,
          ),
        )
    : [];
  const refunds = withCards
    ? await db
        .select({
          recordedAt: paymentRefunds.createdAt,
          amount: paymentRefunds.amount,
          state: paymentRefunds.state,
          orderNumber: workingOrders.orderNumber,
          provider: payments.provider,
          reference: payments.paymentRef,
          refundReference: paymentRefunds.providerRefundRef,
          personName: persons.displayName,
          id: paymentRefunds.id,
        })
        .from(paymentRefunds)
        .innerJoin(payments, eq(payments.id, paymentRefunds.paymentId))
        .innerJoin(workingOrders, eq(workingOrders.id, payments.workingOrderId))
        .leftJoin(persons, eq(persons.id, paymentRefunds.authorizedBy))
        .where(since(paymentRefunds.createdAt))
    : [];
  const drawer = await db
    .select({
      recordedAt: drawerEntries.recordedAt,
      amount: drawerEntries.amount,
      drawerKind: drawerEntries.kind,
      orderNumber: workingOrders.orderNumber,
      partPaymentId: drawerEntries.billPaymentId,
      personName: persons.displayName,
      id: drawerEntries.id,
    })
    .from(drawerEntries)
    .leftJoin(billPayments, eq(billPayments.id, drawerEntries.billPaymentId))
    .leftJoin(workingOrders, eq(workingOrders.id, billPayments.workingOrderId))
    .leftJoin(persons, eq(persons.id, drawerEntries.personId))
    .where(since(drawerEntries.recordedAt));
  const facts: PaymentRow[] = [
    ...parts.map(({ applied, tip, receivedAt, failedAt, ...row }) => ({
      ...row,
      kind: "part" as const,
      changedAt: latest(receivedAt, failedAt),
      amount: centsToDecimal(applied),
      tip: centsToDecimal(tip),
    })),
    ...cards.map(({ amount, updatedAt, settledAt, resolvedAt, heldAt, holdDecidedAt, ...row }) => ({
      ...row,
      kind: "card" as const,
      changedAt: latest(updatedAt, settledAt, resolvedAt, heldAt, holdDecidedAt),
      amount: centsToDecimal(amount),
    })),
    ...refunds.map(({ amount, ...row }) => ({
      ...row,
      kind: "refund" as const,
      changedAt: null,
      amount: centsToDecimal(-amount),
    })),
    ...drawer.map(({ amount, ...row }) => ({
      ...row,
      kind: "drawer" as const,
      changedAt: null,
      amount: centsToDecimal(amount),
    })),
  ];
  // An earlier payment is listed at the change that brought it in.
  const listedAt = (fact: PaymentRow) =>
    from === null || fact.recordedAt >= from ? fact.recordedAt : fact.changedAt!;
  const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return facts.sort(
    (a, b) =>
      order(listedAt(a), listedAt(b)) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      order(a.id, b.id),
  );
}

const KIND_ORDER = { part: 0, card: 1, refund: 2, drawer: 3 } as const;
