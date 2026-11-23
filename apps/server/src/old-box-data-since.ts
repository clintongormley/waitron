import { asc, eq, gte, inArray, or } from "drizzle-orm";
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
import {
  centsToDecimal,
  staffPresentationName,
  thousandthsToDecimal,
  type Decimal,
} from "@waitron/shared";
import { latestChangeAtMs } from "./handover-emergency-check.js";
import type { HeardCopy } from "./old-box-holdings.js";

/** Where the old box's "since" tabs start listing rows, and which rule chose it. */
export type SinceRule =
  { kind: "copy"; fromMs: number } | { kind: "own"; fromMs: number } | { kind: "all" };

// Margins chosen with the watcher and the owner, not measured.
const COPY_MARGIN_MS = 10 * 60_000;
const OWN_SPAN_MS = 7 * 24 * 60 * 60_000;

/** Reads only, with the database handle. */
export async function sinceRule(db: Database, copy: HeardCopy | null): Promise<SinceRule> {
  if (copy !== null)
    return copy.lastChangeAtMs === null
      ? { kind: "all" }
      : { kind: "copy", fromMs: copy.lastChangeAtMs - COPY_MARGIN_MS };
  const own = await latestChangeAtMs(liveBackupQuery(db));
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
      kind: "drawer";
      drawerKind: string;
      partPaymentId: string | null;
      personName: string | null;
    }
);

/**
 * Part payments, card payments (when the payments module's table exists) and cash drawer entries
 * from the rule's start, oldest first; reads only.
 */
export async function readPaymentsSince(db: Database, rule: SinceRule): Promise<PaymentRow[]> {
  const from = rule.kind === "all" ? null : new Date(rule.fromMs).toISOString();
  const parts = await db
    .select({
      recordedAt: billPayments.createdAt,
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
    .where(from === null ? undefined : gte(billPayments.createdAt, from))
    .orderBy(asc(billPayments.createdAt), asc(billPayments.id));
  const cards = (await tableExists(db, "payments"))
    ? await db
        .select({
          recordedAt: payments.createdAt,
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
        .where(from === null ? undefined : gte(payments.createdAt, from))
        .orderBy(asc(payments.createdAt), asc(payments.id))
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
    .where(from === null ? undefined : gte(drawerEntries.recordedAt, from))
    .orderBy(asc(drawerEntries.recordedAt), asc(drawerEntries.id));
  const facts: PaymentRow[] = [
    ...parts.map(({ applied, tip, ...row }) => ({
      ...row,
      kind: "part" as const,
      amount: centsToDecimal(applied),
      tip: centsToDecimal(tip),
    })),
    ...cards.map(({ amount, ...row }) => ({
      ...row,
      kind: "card" as const,
      amount: centsToDecimal(amount),
    })),
    ...drawer.map(({ amount, ...row }) => ({
      ...row,
      kind: "drawer" as const,
      amount: centsToDecimal(amount),
    })),
  ];
  // A stable sort keeps part, card and drawer facts recorded at one instant in that order.
  return facts.sort((a, b) =>
    a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0,
  );
}
