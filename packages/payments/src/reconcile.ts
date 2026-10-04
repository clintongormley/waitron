import { AppError, compareDecimal, decimal, isAppError, jobOrigin } from "@waitron/shared";
import type { Decimal, Origin, SaleId } from "@waitron/shared";
import { withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { PaymentState } from "./provider.js";
import type { OrphanRemediation } from "./errors.js";
import type { ReconcilableRow } from "./store.js";
import { existingReferences, listReconcilable, markReconcileRemediated } from "./store.js";

/** Half-open `[from, to)`. */
export interface ReconcilePeriod {
  from: Date;
  to: Date;
}

/**
 * One settlement the processor says actually cleared.
 *
 * `references` is a list because our `external_ref` holds whichever identifier the inbound path
 * carried — for a hosted payment, the hosted session id — while settlement data keys by the
 * payment/charge id. The adapter supplies every processor identifier that could match a local
 * `external_ref`.
 */
export interface SettlementRecord {
  references: string[];
  amount: Decimal;
  settledAt: Date;
  /** Our own identifiers, when the processor carried them back. Present = a settlement with no
   * local row can still be attributed to a till and raise an incident; absent = report-only. */
  hint?: { workingOrderId: string; paymentRef: string };
}

/**
 * The processor's settlement report for a window.
 *
 * An implementer MUST return only the settlements belonging to this taxpayer's settlement identity:
 * every returned settlement with no local row lands in `missingLocal`.
 */
export interface SettlementReportSource {
  fetch(window: ReconcilePeriod): Promise<SettlementRecord[]>;
}

/** Reverse one payment in full at the processor. Throws when the payment cannot be addressed at the
 * processor. */
export type ReversalFn = (paymentRef: string) => Promise<void>;

/**
 * Raise an incident, deduplicated per open `(source, device, code, sale)`, reporting whether it
 * actually inserted. Typed structurally rather than imported so this package keeps `@waitron/core`
 * a DEV dependency; `recordIncidentOnce` is assignable to it verbatim.
 */
export type IncidentSink = (
  tx: Transaction,
  input: {
    origin: Origin;
    saleId?: SaleId;
    error: AppError;
    severity: "warning" | "error";
    detectedAt: Date;
  },
) => Promise<boolean>;

/** One disagreement between our books and the processor's. `paymentRef` is null only for a
 * `missingLocal` — there is no local row to name. Amounts are exact decimal strings, as read. */
export interface PaymentMismatch {
  paymentRef: string | null;
  references: string[];
  localState: PaymentState | null;
  localAmount: string | null;
  settledAmount: string | null;
  workingOrderId: string | null;
}

export interface PaymentReconcileResult {
  period: ReconcilePeriod;
  /** LOCAL rows examined, not report entries. */
  checked: number;
  unsettled: PaymentMismatch[];
  lostSettlement: PaymentMismatch[];
  orphan: PaymentMismatch[];
  missingLocal: PaymentMismatch[];
  drift: PaymentMismatch[];
  incidentsRaised: number;
  /** Orphans actually reversed this sweep. */
  remediated: number;
  /**
   * Orphans this sweep claimed and then could not reverse, with each reason. No later sweep
   * retries a claimed orphan's reversal (its marker is permanent), and the
   * `payment.reconcile_remediation_failed` incident can be swallowed by an earlier still-open one on
   * the same `(source, device, code, sale_id)` key — so a failure not recorded here can be lost for
   * good.
   */
  remediationFailures: { paymentRef: string; reason: string }[];
}

/** One implementer per settlement identity (per `provider` id), never one per capture mechanism. */
export interface PaymentReconciler {
  readonly provider: string;
  reconcile(period: ReconcilePeriod, now: Date): Promise<PaymentReconcileResult>;
}

/** The four classes a LOCAL row can fall into. `missingLocal` is not here: it has no local row. */
export type MismatchClass = "unsettled" | "lostSettlement" | "orphan" | "drift";

/**
 * `settled` is non-null exactly where the class guarantees a matched settlement: never for
 * `unsettled`, always for `lostSettlement` and `drift`, either for `orphan`.
 */
export type ClassifiedRow =
  | { klass: "unsettled"; row: ReconcilableRow; settled: null }
  | { klass: "lostSettlement"; row: ReconcilableRow; settled: SettlementRecord }
  | { klass: "orphan"; row: ReconcilableRow; settled: SettlementRecord | null }
  | { klass: "drift"; row: ReconcilableRow; settled: SettlementRecord };

export interface Classification {
  checked: number;
  rows: ClassifiedRow[];
  /** Settlements matched by no local row — CANDIDATE `missingLocal`s, pending the targeted
   * existence check the caller runs against the whole table. */
  unmatched: SettlementRecord[];
}

/**
 * Classify one sweep's local rows against the processor's report. Pure: no I/O, no clock of its
 * own, no transaction.
 *
 * The classes are INDEPENDENT predicates, not a switch: an orphan whose settlement has not appeared
 * yet can be both `orphan` and `unsettled`, and the result lists it under both.
 */
export function classify(
  rows: ReconcilableRow[],
  records: SettlementRecord[],
  now: Date,
  settlementLagMs: number,
): Classification {
  const index = new Map<string, SettlementRecord>();
  for (const record of records) {
    for (const reference of record.references) index.set(reference, record);
  }
  const matched = new Set<SettlementRecord>();
  const out: ClassifiedRow[] = [];
  const toleranceCutoff = now.getTime() - settlementLagMs;

  for (const row of rows) {
    const settled = row.externalRef === null ? undefined : index.get(row.externalRef);
    if (settled !== undefined) matched.add(settled);

    if (row.state === "initiated") {
      // A minted-but-unpaid hosted payment is ordinary at any age — the abandonment path
      // resolves it. Only the processor saying it PAID makes it a mismatch.
      if (settled !== undefined) out.push({ klass: "lostSettlement", row, settled });
      continue;
    }

    if (row.saleId === null && row.workingOrderStatus !== "open") {
      out.push({ klass: "orphan", row, settled: settled ?? null });
    }
    if (settled === undefined) {
      if (Date.parse(row.auditedAt) < toleranceCutoff) {
        out.push({ klass: "unsettled", row, settled: null });
      }
    } else if (compareDecimal(decimal(row.amount), settled.amount) !== 0) {
      out.push({ klass: "drift", row, settled });
    }
  }

  return {
    checked: rows.length,
    rows: out,
    unmatched: records.filter((record) => !matched.has(record)),
  };
}

/** Long enough for a card processor's ordinary clearing delay, short enough that a lost settlement
 * surfaces the same week. */
export const DEFAULT_SETTLEMENT_LAG_MS = 7 * 24 * 60 * 60 * 1000;

export interface ReconcileDeps {
  db: Database;
  provider: string;
  report: SettlementReportSource;
  reverse: ReversalFn;
  incidents: IncidentSink;
  settlementLagMs: number;
}

const CODE = {
  unsettled: "payment.reconcile_unsettled",
  lostSettlement: "payment.reconcile_lost_settlement",
  orphan: "payment.reconcile_orphan",
  drift: "payment.reconcile_drift",
  missingLocal: "payment.reconcile_missing_local",
  remediationFailed: "payment.reconcile_remediation_failed",
} as const;

/** `unsettled` is a warning — money that has not cleared YET, past its tolerance but not yet proven
 * lost. The rest are errors: each is money we cannot account for. */
const SEVERITY = {
  unsettled: "warning",
  lostSettlement: "error",
  orphan: "error",
  drift: "error",
} as const;

/**
 * Audit one period's payments against the processor's settlement report, raise one incident per
 * class, and reverse the orphans that pass every gate.
 *
 * T1 reads, the report fetch runs outside every transaction, T2 writes incidents and markers, and
 * the reversals run outside every transaction (each is a network call). The report is fetched even
 * when T1 read nothing: zero local rows against a non-empty report is the silent-data-loss case.
 * The remediation marker is stamped BEFORE the reversal, so a crash between the processor refunding
 * and us recording it leaves an under-remediated orphan, never a double refund.
 */
export async function reconcilePayments(
  deps: ReconcileDeps,
  period: ReconcilePeriod,
  now: Date,
): Promise<PaymentReconcileResult> {
  // T1 — our rows for the period.
  const rows = await withTransaction(deps.db, (tx) => listReconcilable(tx, deps.provider, period));

  // Widened by the settlement lag: a payment captured at the end of the period settles days after.
  const records = await deps.report.fetch({
    from: period.from,
    to: new Date(period.to.getTime() + deps.settlementLagMs),
  });

  const classified = classify(rows, records, now, deps.settlementLagMs);
  const result: PaymentReconcileResult = {
    period,
    checked: classified.checked,
    unsettled: [],
    lostSettlement: [],
    orphan: [],
    missingLocal: [],
    drift: [],
    incidentsRaised: 0,
    remediated: 0,
    remediationFailures: [],
  };
  for (const entry of classified.rows) result[entry.klass].push(mismatchOf(entry));

  // A drifting orphan is two independent entries over one row; this set joins them.
  const driftedRefs = new Set(
    classified.rows.filter((e) => e.klass === "drift").map((e) => e.row.paymentRef),
  );

  // T2 — resolve the missingLocal candidates, raise every incident, and claim the orphans this
  // sweep will reverse.
  const remediable: ReconcilableRow[] = [];
  await withTransaction(deps.db, async (tx) => {
    const allReferences = new Set<string>();
    for (const record of classified.unmatched) {
      for (const reference of record.references) allReferences.add(reference);
    }
    const existing = await existingReferences(tx, deps.provider, [...allReferences]);

    const missing: SettlementRecord[] = [];
    for (const record of classified.unmatched) {
      if (record.references.some((reference) => existing.has(reference))) continue;
      missing.push(record);
      result.missingLocal.push(missingLocalMismatch(record));
    }

    // Gate ORDER decides which reason a row tripping several gates reports.
    //   - `workingOrderNotAbandoned`: on a `settled` working order a sale exists, so the orphan may
    //     be a lost associate-back and refunding would hand back money owed against a live invoice.
    //   - `stateNotCaptured`: a `settled` payment has no reversal path, so claiming it would stamp a
    //     permanent marker for a reversal that must fail. Keep this gate until it has one.
    //   - `alreadyClaimed`: an earlier sweep, or a concurrent one that won the race, owns the
    //     reversal. It precedes the drift gate because that reversal has already happened or already
    //     failed for good, so settling the drift cannot unblock it.
    //   - `amountDrifted`: the reversal sends no amount, so the processor would refund its figure
    //     while we record ours. Sending our amount is no fix: where the processor's charge is the
    //     smaller, the refund is refused after the permanent marker is stamped.
    const remediation = new Map<string, OrphanRemediation>();
    for (const entry of classified.rows) {
      if (entry.klass !== "orphan") continue;
      const ref = entry.row.paymentRef;
      if (entry.row.workingOrderStatus !== "abandoned") {
        remediation.set(ref, "workingOrderNotAbandoned");
        continue;
      }
      if (entry.row.state !== "captured") {
        remediation.set(ref, "stateNotCaptured");
        continue;
      }
      if (entry.row.reconcileRemediatedAt !== null) {
        remediation.set(ref, "alreadyClaimed");
        continue;
      }
      if (driftedRefs.has(ref)) {
        remediation.set(ref, "amountDrifted");
        continue;
      }
      const claimed = await markReconcileRemediated(tx, {
        provider: deps.provider,
        paymentRef: ref,
        at: now,
      });
      // A lost race is the same fact as an earlier sweep's marker — another sweep owns the reversal
      // — so it reports the same reason.
      remediation.set(ref, claimed ? "claimed" : "alreadyClaimed");
      if (claimed) remediable.push(entry.row);
    }

    result.incidentsRaised += await raiseRowIncidents(tx, deps, classified, remediation, now);
    result.incidentsRaised += await raiseMissingLocal(tx, deps, missing, now);
  });

  // One failure does not abort the pass. See `PaymentReconcileResult.remediationFailures` for why
  // failures go on the result as well as into an incident.
  const failures: RemediationFailure[] = [];
  for (const row of remediable) {
    const reason = await remediate(deps, row);
    if (reason === null) result.remediated += 1;
    else {
      failures.push({ row, reason });
      result.remediationFailures.push({ paymentRef: row.paymentRef, reason });
    }
  }
  if (failures.length > 0) {
    result.incidentsRaised += await raiseRemediationFailures(deps, failures, now);
  }
  return result;
}

/** The payment check's alerts: they name no device, so one open alert of a code stands for every
 * payment it covers. */
const PAYMENT_CHECK = jobOrigin("payment_check");

/** One aggregate incident per class, returning how many were really inserted. Aggregate because
 * the open-incident dedup keys on `(source, device, code, sale_id)` and these rows share the payment
 * check's source and a null sale_id, so per-payment incidents would collapse into one. */
async function raiseRowIncidents(
  tx: Transaction,
  deps: ReconcileDeps,
  classified: Classification,
  remediation: Map<string, OrphanRemediation>,
  now: Date,
): Promise<number> {
  const groups = new Map<MismatchClass, ClassifiedRow[]>();
  for (const entry of classified.rows) {
    const group = groups.get(entry.klass);
    if (group === undefined) groups.set(entry.klass, [entry]);
    else group.push(entry);
  }

  let raised = 0;
  for (const group of groups.values()) {
    const first = group[0]!;
    const inserted = await deps.incidents(tx, {
      origin: PAYMENT_CHECK,
      error: incidentFor(first.klass, group, remediation),
      severity: SEVERITY[first.klass],
      detectedAt: now,
    });
    if (inserted) raised += 1;
  }
  return raised;
}

/** Params are structured data, never prose: the display layer localises from the code. */
function incidentFor(
  klass: MismatchClass,
  group: ClassifiedRow[],
  remediation: Map<string, OrphanRemediation>,
): AppError {
  const count = group.length;
  if (klass === "unsettled") {
    return new AppError(CODE.unsettled, {
      count,
      payments: group.map(({ row }) => ({
        paymentRef: row.paymentRef,
        amount: row.amount,
        // Non-null: `listReconcilable` selects non-initiated rows by a `settled_at` range.
        settledAt: new Date(row.settledAt!).toISOString(),
      })),
    });
  }
  if (klass === "lostSettlement") {
    return new AppError(CODE.lostSettlement, {
      count,
      payments: group.map(({ row }) => ({
        paymentRef: row.paymentRef,
        amount: row.amount,
        workingOrderId: row.workingOrderId,
      })),
    });
  }
  if (klass === "orphan") {
    return new AppError(CODE.orphan, {
      count,
      payments: group.map(({ row }) => ({
        paymentRef: row.paymentRef,
        amount: row.amount,
        workingOrderId: row.workingOrderId,
        workingOrderStatus: row.workingOrderStatus,
        // The claim loop sets an entry for every orphan.
        remediation: remediation.get(row.paymentRef)!,
      })),
    });
  }
  // `raiseRowIncidents` groups by class, so every entry here is a `drift` one.
  const driftGroup = group as Extract<ClassifiedRow, { klass: "drift" }>[];
  return new AppError(CODE.drift, {
    count,
    payments: driftGroup.map(({ row, settled }) => ({
      paymentRef: row.paymentRef,
      captured: row.amount,
      settled: settled.amount,
    })),
  });
}

/** One aggregate incident for the settlements the processor attributed to us with a hint. One
 * with no hint is reported in the result and raises no incident: it carries no link to a
 * Waitron order. */
async function raiseMissingLocal(
  tx: Transaction,
  deps: ReconcileDeps,
  missing: SettlementRecord[],
  now: Date,
): Promise<number> {
  const hinted = missing.flatMap((record) =>
    record.hint === undefined ? [] : [{ record, paymentRef: record.hint.paymentRef }],
  );
  if (hinted.length === 0) return 0;
  const inserted = await deps.incidents(tx, {
    origin: PAYMENT_CHECK,
    error: new AppError(CODE.missingLocal, {
      count: hinted.length,
      settlements: hinted.map(({ record, paymentRef }) => ({
        references: record.references,
        amount: record.amount,
        settledAt: record.settledAt.toISOString(),
        paymentRef,
      })),
    }),
    severity: "error",
    detectedAt: now,
  });
  return inserted ? 1 : 0;
}

function mismatchOf(entry: ClassifiedRow): PaymentMismatch {
  return {
    paymentRef: entry.row.paymentRef,
    references: entry.row.externalRef === null ? [] : [entry.row.externalRef],
    localState: entry.row.state,
    localAmount: entry.row.amount,
    settledAmount: entry.settled === null ? null : entry.settled.amount,
    workingOrderId: entry.row.workingOrderId,
  };
}

function missingLocalMismatch(record: SettlementRecord): PaymentMismatch {
  return {
    paymentRef: null,
    references: record.references,
    localState: null,
    localAmount: null,
    settledAmount: record.amount,
    workingOrderId: record.hint?.workingOrderId ?? null,
  };
}

/** Returns `null` when the money went back, else the refusal's `AppError` code or `"unknown"`. Never
 * retried: the marker was stamped in T2. */
async function remediate(deps: ReconcileDeps, row: ReconcilableRow): Promise<string | null> {
  try {
    await deps.reverse(row.paymentRef);
    return null;
  } catch (error) {
    return isAppError(error) ? error.code : "unknown";
  }
}

interface RemediationFailure {
  row: ReconcilableRow;
  reason: string;
}

/** One aggregate incident, in its own transaction: the reversals ran after T2 committed. */
async function raiseRemediationFailures(
  deps: ReconcileDeps,
  failures: RemediationFailure[],
  now: Date,
): Promise<number> {
  const inserted = await withTransaction(deps.db, (tx) =>
    deps.incidents(tx, {
      origin: PAYMENT_CHECK,
      error: new AppError(CODE.remediationFailed, {
        count: failures.length,
        payments: failures.map(({ row, reason }) => ({
          paymentRef: row.paymentRef,
          amount: row.amount,
          reason,
        })),
      }),
      severity: "error",
      detectedAt: now,
    }),
  );
  return inserted ? 1 : 0;
}
