import { and, eq, gte, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { statementChunks, type Transaction } from "@waitron/db";
import {
  payments,
  type BackupPaymentMatch,
  type BackupPaymentUnmatched,
  type PaymentReconcileResult,
} from "@waitron/payments";
import { paymentRefunds } from "@waitron/payments/src/schema/payment-refunds.js";
import { centsToDecimal } from "@waitron/shared";
import { pairedAuditRuns } from "./backup-audit-day.js";

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
  | "refunded_at_sumup"
  | "missing_local";
type StandaloneCharge = Extract<BackupPaymentUnmatched, { kind: "charge" }>;
type ComparisonRow = {
  paymentRef: string | null;
  references: string[];
  settledAt: string;
  amount: string;
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
  const inside = (at: string) => at >= startAt && at < endAt;
  const { runs, complete } = pairedAuditRuns(bounds, candidates);
  const charges = runs.flatMap(
    ({ summary }) =>
      summary?.chargeAudit?.missingLocal.filter((row) => inside(row.settledAt)) ?? [],
  );
  const paired = and(eq(payments.provider, "sumup"), isNotNull(payments.readerId));
  const readPayments = () => tx.select().from(payments);
  const local = await readPayments().where(
    and(
      paired,
      or(
        and(gte(payments.settledAt, startAt), lt(payments.settledAt, endAt)),
        and(
          isNull(payments.settledAt),
          gte(payments.createdAt, startAt),
          lt(payments.createdAt, endAt),
        ),
      ),
    ),
  );
  const pairedRefs = new Set(local.map((row) => row.paymentRef));
  const linkedRefs = [
    ...new Set(
      charges.flatMap((row) =>
        row.hintedPaymentRef === null || pairedRefs.has(row.hintedPaymentRef)
          ? []
          : [row.hintedPaymentRef],
      ),
    ),
  ];
  for (const refs of statementChunks(payments, linkedRefs)) {
    const linked = await readPayments().where(and(paired, inArray(payments.paymentRef, refs)));
    for (const row of linked) pairedRefs.add(row.paymentRef);
  }

  const refunds = new Map<string, { amount: number; createdAt: string }[]>();
  for (const ids of statementChunks(
    paymentRefunds,
    local.map((row) => row.id),
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

  const matches = new Map<string, boolean>();
  const problems = new Map<string, Set<Finding>>();
  for (const { summary } of runs) {
    for (const match of summary?.chargeAudit?.matches ?? [])
      matches.set(match.paymentRef, match.providerRefunded);
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
  for (const row of local) {
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
    const beforeCheck =
      localRefunds
        .filter((refund) => checkedAt != null && refund.createdAt <= checkedAt)
        .reduce((total, refund) => total + refund.amount, 0) >= row.amount;
    const refunded = localRefunds.reduce((total, refund) => total + refund.amount, 0) >= row.amount;
    let statuses: Status[] = flags;
    if (row.holdOutcome !== null) statuses = ["resolved"];
    else if (beforeCheck) statuses = ["refunded_before_check"];
    else if (flags.length === 0) {
      const providerRefunded = matches.get(row.paymentRef);
      statuses = [
        providerRefunded === undefined
          ? "not_checked"
          : providerRefunded && !refunded
            ? "refunded_at_sumup"
            : "matched",
      ];
    }
    rows.push({
      paymentRef: row.paymentRef,
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
    if (hintedPaymentRef !== null && pairedRefs.has(hintedPaymentRef)) {
      const duplicate = charge.references.some((ref) => pairedCharges.has(ref));
      for (const ref of charge.references) pairedCharges.add(ref);
      if (!duplicate)
        rows.push({ ...charge, paymentRef: hintedPaymentRef, statuses: ["missing_local"] });
    } else {
      if (!charge.references.some((ref) => standaloneSeen.has(ref)))
        extraStandalone.push({ ...charge, kind: "charge", reason: "unmatched" });
      for (const ref of charge.references) standaloneSeen.add(ref);
    }
  }
  const isProblem = ({ statuses }: ComparisonRow) =>
    !statuses.some(
      (status) =>
        status === "matched" || status === "refunded_before_check" || status === "resolved",
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
