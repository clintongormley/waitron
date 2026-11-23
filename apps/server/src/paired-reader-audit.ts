import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import {
  diningTables,
  parties,
  statementChunks,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import {
  cardReaders,
  payments,
  type BackupPaymentMatch,
  type BackupPaymentUnmatched,
  type PaymentReconcileResult,
} from "@waitron/payments";
import { paymentRefunds } from "@waitron/payments/src/schema/payment-refunds.js";
import { centsToDecimal, partyTablesName } from "@waitron/shared";
import { pairedAuditRuns } from "./backup-audit-day.js";
import { readPartyTables } from "./orders-list.js";

const findings = {
  drift: "drift",
  orphan: "orphan",
  unsettled: "unsettled",
  lostSettlement: "lost_settlement",
} as const;

type Finding = (typeof findings)[keyof typeof findings];
type Status =
  | Finding
  | "matched"
  | "not_checked"
  | "resolved"
  | "refunded_before_check"
  | "partly_refunded_before_check"
  | "refunded_at_sumup"
  | "missing_local";
type StandaloneCharge = Extract<BackupPaymentUnmatched, { kind: "charge" }>;
type ComparisonRow = Omit<StandaloneCharge, "kind" | "reason"> & {
  paymentRef: string;
  readerName: string;
  billNumber: number | null;
  orderNumber: number;
  tableName: string | null;
  statuses: Status[];
};

export interface PairedAuditRun {
  periodFrom: string;
  periodTo: string;
  generation: number;
  startedAt: string | null;
  finishedAt: string | null;
  summary: Partial<
    Pick<
      PaymentReconcileResult,
      "chargeAudit" | "unlinkedCharges" | "missingLocal" | keyof typeof findings
    >
  > | null;
}

export async function readPairedReaderAudit(
  tx: Transaction,
  bounds: { startAt: string; endAt: string },
  candidates: readonly PairedAuditRun[],
  standalone: {
    backupMatches: (BackupPaymentMatch | BackupPaymentUnmatched)[];
    backupUnmatched: (BackupPaymentMatch | BackupPaymentUnmatched)[];
  },
) {
  const { startAt, endAt } = bounds;
  const { runs, complete } = pairedAuditRuns(bounds, candidates);
  const charges = runs
    .flatMap(({ summary }) => summary?.chargeAudit?.missingLocal ?? [])
    .filter(({ settledAt }) => settledAt >= startAt && settledAt < endAt);
  const sumup = eq(payments.provider, "sumup");
  const readPayments = () =>
    tx
      .select({
        payment: payments,
        readerName: cardReaders.name,
        billNumber: workingOrders.billNumber,
        orderNumber: workingOrders.orderNumber,
        partyId: workingOrders.partyId,
        tableNames: parties.tableNames,
        deliveryLabel: workingOrders.deliveryTableLabel,
        liveDeliveryLabel: diningTables.label,
      })
      .from(payments)
      .innerJoin(cardReaders, eq(cardReaders.id, payments.readerId))
      .innerJoin(workingOrders, eq(workingOrders.id, payments.workingOrderId))
      .leftJoin(parties, eq(parties.id, workingOrders.partyId))
      .leftJoin(diningTables, eq(diningTables.id, workingOrders.deliveryTableId));
  const { createdAt, settledAt } = payments;
  const local = [
    ...(await readPayments().where(and(sumup, gte(settledAt, startAt), lt(settledAt, endAt)))),
    ...(await readPayments().where(
      and(sumup, isNull(settledAt), gte(createdAt, startAt), lt(createdAt, endAt)),
    )),
  ];
  const pairedRefs = new Map(local.map((row) => [row.payment.paymentRef, row]));
  const linkedRefs = new Set(
    charges.flatMap(({ hintedPaymentRef }) =>
      hintedPaymentRef !== null && !pairedRefs.has(hintedPaymentRef) ? [hintedPaymentRef] : [],
    ),
  );
  for (const refs of statementChunks(payments, [...linkedRefs])) {
    const linked = await readPayments().where(and(sumup, inArray(payments.paymentRef, refs)));
    for (const row of linked) pairedRefs.set(row.payment.paymentRef, row);
  }
  const liveTables = new Map<string, string[]>();
  const liveParties = new Set(
    [...pairedRefs.values()].flatMap(({ partyId, tableNames }) =>
      tableNames === null ? (partyId ?? []) : [],
    ),
  );
  for (const ids of statementChunks(parties, [...liveParties]))
    for (const [id, names] of await readPartyTables(tx, ids)) liveTables.set(id, names);
  const identity = (row: (typeof local)[number]) => ({
    readerName: row.readerName,
    billNumber: row.billNumber,
    orderNumber: row.orderNumber,
    tableName:
      row.partyId === null
        ? (row.liveDeliveryLabel ?? row.deliveryLabel)
        : partyTablesName(row.tableNames ?? liveTables.get(row.partyId) ?? []) || null,
  });

  const refunds = new Map<string, { amount: number; createdAt: string }[]>();
  for (const ids of statementChunks(
    paymentRefunds,
    local.map(({ payment }) => payment.id),
  )) {
    const refunded = await tx
      .select()
      .from(paymentRefunds)
      .where(and(eq(paymentRefunds.state, "succeeded"), inArray(paymentRefunds.paymentId, ids)));
    for (const refund of refunded) {
      const previous = refunds.get(refund.paymentId) ?? [];
      previous.push(refund);
      refunds.set(refund.paymentId, previous);
    }
  }

  const matchesIn = (evidence: readonly PairedAuditRun[]) =>
    new Map(
      evidence.flatMap(({ summary }) =>
        (summary?.chargeAudit?.matches ?? []).map(
          (match) => [match.paymentRef, match.providerRefunded] as const,
        ),
      ),
    );
  const matches = matchesIn(runs);
  const byGeneration = candidates.toSorted((a, b) => a.generation - b.generation);
  const priorMatches = matchesIn(byGeneration);
  const firstCheckAt = new Map<string, string>();
  for (const run of byGeneration) {
    const checkedAt = run.startedAt ?? run.finishedAt;
    if (checkedAt !== null && !firstCheckAt.has(run.periodFrom))
      firstCheckAt.set(run.periodFrom, checkedAt);
  }
  const problems = new Map<string, Set<Finding>>();
  for (const { summary } of runs) {
    for (const kind of Object.keys(findings) as (keyof typeof findings)[]) {
      for (const finding of summary?.[kind] ?? []) {
        if (
          finding.paymentRef === null ||
          (kind === "lostSettlement" && finding.settledAmount === null)
        )
          continue;
        const statuses = problems.get(finding.paymentRef) ?? new Set<Finding>();
        statuses.add(findings[kind]);
        problems.set(finding.paymentRef, statuses);
      }
    }
  }

  const rows: ComparisonRow[] = [];
  for (const item of local) {
    const row = item.payment;
    const at = row.settledAt ?? row.createdAt;
    const flags = [...(problems.get(row.paymentRef) ?? [])];
    if (
      !["captured", "refunded", "partially_refunded"].includes(row.state) &&
      !flags.includes("lost_settlement")
    )
      continue;
    const window = runs.find((run) => at >= run.periodFrom && at < run.periodTo);
    const checkedAt = window?.startedAt ?? window?.finishedAt;
    const localRefunds = refunds.get(row.id) ?? [];
    const beforeCheck = localRefunds.some(
      (refund) => checkedAt != null && refund.createdAt <= checkedAt,
    );
    const refunded = localRefunds.reduce((total, refund) => total + refund.amount, 0) >= row.amount;
    let statuses: Status[] = flags;
    if (row.holdOutcome !== null) statuses = ["resolved"];
    else if (flags.length === 0) {
      // A refund drops the capture from later checks, so retain any earlier match.
      const providerRefunded =
        matches.get(row.paymentRef) ?? (beforeCheck ? priorMatches.get(row.paymentRef) : undefined);
      let status: Status = "matched";
      if (providerRefunded === undefined) {
        const firstCheckedAt = window && firstCheckAt.get(window.periodFrom);
        const refundedBeforeFirstCheck = localRefunds
          .filter(({ createdAt }) => firstCheckedAt !== undefined && createdAt <= firstCheckedAt)
          .reduce((total, refund) => total + refund.amount, 0);
        status = "not_checked";
        if (refundedBeforeFirstCheck >= row.amount) status = "refunded_before_check";
        else if (refundedBeforeFirstCheck > 0) status = "partly_refunded_before_check";
      } else if (providerRefunded && !refunded) status = "refunded_at_sumup";
      statuses = [status];
    }
    rows.push({
      paymentRef: row.paymentRef,
      ...identity(item),
      references: row.externalRef === null ? [] : [row.externalRef],
      settledAt: at,
      amount: centsToDecimal(row.amount),
      statuses,
    });
  }

  const pairedCharges = new Set<string>();
  const standaloneSeen = new Set(
    [...standalone.backupMatches, ...standalone.backupUnmatched].flatMap((row) => row.references),
  );
  const extraStandalone: StandaloneCharge[] = [];
  for (const { hintedPaymentRef, ...charge } of charges) {
    const pairedPayment = hintedPaymentRef === null ? undefined : pairedRefs.get(hintedPaymentRef);
    const seen = pairedPayment === undefined ? standaloneSeen : pairedCharges;
    const duplicate = charge.references.some((ref) => seen.has(ref));
    for (const ref of charge.references) seen.add(ref);
    if (duplicate) continue;
    if (pairedPayment === undefined)
      extraStandalone.push({ ...charge, kind: "charge", reason: "unmatched" });
    else
      rows.push({
        ...charge,
        paymentRef: pairedPayment.payment.paymentRef,
        ...identity(pairedPayment),
        statuses: ["missing_local"],
      });
  }
  const isProblem = ({ statuses }: ComparisonRow) =>
    statuses.every(
      (status) =>
        status !== "matched" && status !== "refunded_before_check" && status !== "resolved",
    );

  return {
    backupUnmatched: [
      ...standalone.backupUnmatched.filter(
        (row) => !row.references.some((ref) => pairedCharges.has(ref)),
      ),
      ...extraStandalone,
    ],
    pairedAudit: {
      complete: complete && !rows.some((row) => row.statuses.includes("not_checked")),
      matched: rows.filter((row) => row.statuses.includes("matched")).length,
      toCheck: rows.filter(isProblem).length,
      rows: rows.sort((a, b) => b.settledAt.localeCompare(a.settledAt)),
    },
  };
}
