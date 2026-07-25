import {
  AppError,
  compareDecimal,
  decimal,
  isAppError,
  tillId as brandTillId,
} from "@waitron/shared";
import type { Decimal, SaleId, TenantId, TillId } from "@waitron/shared";
import { withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { PaymentState } from "./provider.js";
import type { ReconcilableRow } from "./store.js";
import {
  existingReferences,
  listReconcilable,
  markReconcileRemediated,
  tillsForWorkingOrders,
} from "./store.js";

/** Half-open `[from, to)`. A daily sweep is yesterday; a monthly one is the 1st to the 1st. */
export interface ReconcilePeriod {
  from: Date;
  to: Date;
}

/**
 * One settlement the processor says actually cleared.
 *
 * `references` is a LIST, and that is load-bearing rather than defensive: our `external_ref` holds
 * whichever identifier the inbound path carried, and for a hosted payment that is the hosted
 * session id, while settlement data keys by the payment/charge id and never by the session. A
 * single-keyed record would leave every hosted payment reading as `unsettled` for ever and every
 * hosted settlement reading as `missingLocal` — wrong for exactly the mode this audit exists to
 * protect. The adapter therefore supplies every processor identifier that could match a local
 * `external_ref`, resolved from the processor's own data, so matching works even when our inbound
 * notification never arrived.
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
 * The processor's settlement report for a window — the vendor half of the audit. The neutral seam
 * never names any vendor concept.
 *
 * An implementer MUST return only the settlements belonging to `tenantId`'s settlement identity.
 * The tenant is an ARGUMENT rather than something the source binds at construction because a
 * `ReconcileDeps` is built once and swept across many tenants, while a processor account may well be
 * shared between them (provisioning is not decided yet). A source that could not see the tenant
 * would return the whole account's settlements, and every OTHER tenant's settlement would then fail
 * this tenant's targeted existence check and land in `missingLocal` — filling the sweep's
 * authoritative result with money that is not this tenant's, on every run.
 */
export interface SettlementReportSource {
  fetch(tenantId: TenantId, window: ReconcilePeriod): Promise<SettlementRecord[]>;
}

/** Reverse one payment in full at the processor — the orphan self-heal. The adapter chooses how.
 * Throws when the payment cannot be addressed at the processor. */
export type ReversalFn = (paymentRef: string) => Promise<void>;

/**
 * Raise an incident, deduplicated per open `(tenant, till, code, sale)`, reporting whether it
 * actually inserted. Typed structurally rather than imported so this package keeps `@waitron/core`
 * a DEV dependency; `recordIncidentOnce` is assignable to it verbatim.
 */
export type IncidentSink = (
  tx: Transaction,
  input: {
    tenantId: TenantId;
    tillId: TillId;
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

/** The outcome of one sweep. A tenant with nothing to check answers all-empty / zeros. */
export interface PaymentReconcileResult {
  period: ReconcilePeriod;
  /** LOCAL rows examined — not report entries, so a tenant with no local rows and a non-empty
   * report answers `checked: 0` alongside a non-empty `missingLocal`. */
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
   * Orphans this sweep CLAIMED and then could not reverse, with the structured reason each failed
   * for. Present because the result is the audit's authoritative record and this is the one finding
   * that is otherwise unrecoverable: the five mismatch classes are re-detected from scratch by every
   * later sweep, but a claimed orphan carries a permanent `reconcile_remediated_at` marker, so a
   * failure dropped here is dropped for good. The `payment.reconcile_remediation_failed` incident
   * alone cannot carry it — the open-incident dedup keys on `(tenant, till, code, sale_id)`, so a
   * still-open incident from an earlier sweep silently swallows this sweep's new failures.
   */
  remediationFailures: { paymentRef: string; reason: string }[];
}

/**
 * The audit seam: one implementer per SETTLEMENT IDENTITY (per `provider` id), never one per
 * capture mechanism. A vendor whose synchronous and hosted adapters share a `provider` id is
 * audited by ONE reconciler covering all of them. Manual mode implements nothing — its audit is
 * external. `now` is passed in, exactly as `forward(now)` takes it: the in-flight tolerance and
 * every `detectedAt` need a clock, and an injected one is what makes the boundary testable.
 */
export interface PaymentReconciler {
  readonly provider: string;
  reconcile(
    tenantId: TenantId,
    period: ReconcilePeriod,
    now: Date,
  ): Promise<PaymentReconcileResult>;
}

/** The four classes a LOCAL row can fall into. `missingLocal` is not here: it has no local row. */
export type MismatchClass = "unsettled" | "lostSettlement" | "orphan" | "drift";

/**
 * A discriminated union rather than one flat shape: `settled` is null-or-not depending on WHICH
 * class a row fell into, and this says exactly which — `unsettled` never has a match (that is what
 * makes it unsettled), `lostSettlement` and `drift` are only ever raised WITH a matched settlement,
 * and only `orphan` is genuinely either. That means a `drift` row's `settled` is `SettlementRecord`
 * at the type level, not `SettlementRecord | null` — so a consumer that only handles `drift` (like
 * `incidentFor`) can read `settled.amount` directly, with no impossible null case to fabricate a
 * fallback for.
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
 * own, no transaction — every input is an argument, which is what lets the money-critical rules be
 * tested exhaustively without a database.
 *
 * The classes are INDEPENDENT predicates, not a switch: an orphan whose settlement has not appeared
 * yet is genuinely both `orphan` and `unsettled`, and the result says so rather than picking a
 * winner (fiscal's three classes are mutually exclusive; these are not).
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

    // Money we believe we hold. The orphan rule is local-only: it never consults the report.
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

/** Seven days: long enough for the ordinary clearing delay of a card processor, short enough that a
 * genuinely lost settlement surfaces the same week. A vendor property, so it is a dependency rather
 * than a constant the sweep hard-codes. */
export const DEFAULT_SETTLEMENT_LAG_MS = 7 * 24 * 60 * 60 * 1000;

export interface ReconcileDeps {
  db: Database;
  /** The settlement identity being audited — one `provider` id, however many capture mechanisms
   * write it. */
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
 * The reconciliation sweep: audit one tenant's payments for one period against what the processor's
 * settlement report says actually cleared, classify every disagreement, raise an idempotent
 * incident per (till, class), and auto-reverse the one orphan shape that is unambiguously safe.
 *
 * T1/T2, like `forward` and the fiscal sweep: a short read transaction, then the report fetch
 * OUTSIDE every transaction, then a short write transaction for incidents and markers, then the
 * reversals — also outside every transaction, because each is a network call.
 *
 * Two deliberate divergences from the fiscal sweep:
 *
 *   - the report is fetched even when T1 read NOTHING. Fiscal skips its network call on an empty
 *     period because a record it never wrote cannot exist; here, zero local rows plus a non-empty
 *     report IS the silent-data-loss case (every inbound settlement missed), so skipping would
 *     blind the sweep to exactly what it exists for;
 *   - the remediation marker is stamped BEFORE the reversal, not after. There is no persisted
 *     per-reversal idempotency key yet, so a crash between "the processor refunded" and "we
 *     recorded it" would let the next sweep refund again. Stamping first makes the failure mode an
 *     UNDER-remediated orphan carrying an open incident, never a double refund.
 */
export async function reconcilePayments(
  deps: ReconcileDeps,
  tenantId: TenantId,
  period: ReconcilePeriod,
  now: Date,
): Promise<PaymentReconcileResult> {
  // T1 — our rows for the period. No network call inside it.
  const rows = await withTenant(deps.db, tenantId, (tx) =>
    listReconcilable(tx, tenantId, deps.provider, period),
  );

  // Network — outside every transaction, over a window widened by the settlement lag, because a
  // payment captured at the end of the period settles days after it.
  const records = await deps.report.fetch(tenantId, {
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

  // T2 — resolve the missingLocal candidates, raise every incident, and claim the orphans this
  // sweep will reverse. One short write transaction.
  const remediable: ReconcilableRow[] = [];
  await withTenant(deps.db, tenantId, async (tx) => {
    // One batched existence check for the WHOLE sweep's unmatched settlements, not one per
    // settlement: T2 is a write transaction, so N round trips here would lengthen lock contention
    // with the concurrent sweeps this feature explicitly supports, and a tenant with zero local
    // rows against a large report (the exact silent-data-loss case this sweep exists to catch)
    // is precisely the shape that would make that N largest. See `existingReferences` for why the
    // check itself stays unbounded by period and by state.
    const allReferences = new Set<string>();
    for (const record of classified.unmatched) {
      for (const reference of record.references) allReferences.add(reference);
    }
    const existing = await existingReferences(tx, tenantId, deps.provider, [...allReferences]);

    const missing: SettlementRecord[] = [];
    for (const record of classified.unmatched) {
      if (record.references.some((reference) => existing.has(reference))) continue;
      missing.push(record);
      result.missingLocal.push(missingLocalMismatch(record));
    }

    // Claim the orphans this sweep will reverse. Three gates, each narrowing to money that can
    // actually be handed back:
    //
    //   - ABANDONED working order only. On a `settled` one a sale exists, so the orphan may be a
    //     lost associate-back and refunding would take back money the customer owes against a live
    //     invoice (see the design's orphan section).
    //   - state `captured` only. This gate is not a preference: the local state machine has NO path
    //     out of `settled`, and the reversal pre-check accepts `captured` for a void and
    //     `captured`/`partially_refunded` for a refund — `settled` is in neither set. A `settled`
    //     orphan claimed here would stamp the marker, fail its reversal, and, because the marker is
    //     permanent by design, never be retried by any later sweep: the customer's money kept for
    //     good, on every occurrence. It is reported and incident-raised instead, exactly like a
    //     `settled`-working-order orphan. DO NOT drop this gate to "cover more orphans" until
    //     `settled` has a reversal path.
    //   - not already claimed by an earlier sweep.
    //
    // A row that ALSO classified `drift` is still claimed, and reversed at OUR amount (`ReversalFn`
    // takes none). Skipping it would leave money unreturned in the one case where returning it is
    // otherwise unambiguous; the separate `drift` incident carries both figures for the human who
    // settles the difference.
    for (const entry of classified.rows) {
      if (entry.klass !== "orphan") continue;
      if (entry.row.workingOrderStatus !== "abandoned") continue;
      if (entry.row.state !== "captured") continue;
      if (entry.row.reconcileRemediatedAt !== null) continue;
      const claimed = await markReconcileRemediated(tx, {
        tenantId,
        provider: deps.provider,
        paymentRef: entry.row.paymentRef,
        at: now,
      });
      if (claimed) remediable.push(entry.row);
    }
    const claimedRefs = new Set(remediable.map((row) => row.paymentRef));

    result.incidentsRaised += await raiseRowIncidents(
      tx,
      deps,
      tenantId,
      classified,
      claimedRefs,
      now,
    );
    result.incidentsRaised += await raiseMissingLocal(tx, deps, tenantId, missing, now);
  });

  // Reversals — outside every transaction. See the marker-ordering note above. One failure does
  // not abort the pass: every remaining orphan still gets its turn. Every failure is recorded on
  // the RESULT as well as aggregated into an incident, because the incident can be swallowed by an
  // earlier sweep's still-open one and a claimed orphan is never re-examined (see
  // `PaymentReconcileResult.remediationFailures`).
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
    result.incidentsRaised += await raiseRemediationFailures(deps, tenantId, failures, now);
  }
  return result;
}

/** Raises one AGGREGATE incident per (till, class) over the classified rows, returning how many
 * were really inserted (`recordIncidentOnce` reports its own de-duplication, so a re-detected
 * still-open condition is not counted twice). Aggregate rather than one incident per payment: the
 * open-incident dedup index keys on `(tenant, till, code, sale_id)` and these rows frequently share
 * a null sale_id, so N same-key incidents would silently collapse into whichever won the race. */
async function raiseRowIncidents(
  tx: Transaction,
  deps: ReconcileDeps,
  tenantId: TenantId,
  classified: Classification,
  claimedRefs: Set<string>,
  now: Date,
): Promise<number> {
  const groups = new Map<string, ClassifiedRow[]>();
  for (const entry of classified.rows) {
    const key = `${entry.row.tillId}|${entry.klass}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [entry]);
    else group.push(entry);
  }

  let raised = 0;
  for (const group of groups.values()) {
    const first = group[0]!;
    const inserted = await deps.incidents(tx, {
      tenantId,
      tillId: brandTillId(first.row.tillId),
      error: incidentFor(first.klass, group, claimedRefs),
      severity: SEVERITY[first.klass],
      detectedAt: now,
    });
    if (inserted) raised += 1;
  }
  return raised;
}

/** Builds one class's aggregate incident. Params are structured data — a list plus its count —
 * never prose: the display layer localises from the code. `group` is homogeneous by construction
 * (`raiseRowIncidents` groups by `` `${tillId}|${klass}` ``), so the `drift` branch casts to that
 * narrower member of the `ClassifiedRow` union instead of null-checking a case classify() never
 * produces. */
function incidentFor(
  klass: MismatchClass,
  group: ClassifiedRow[],
  claimedRefs: Set<string>,
): AppError {
  const count = group.length;
  if (klass === "unsettled") {
    return new AppError(CODE.unsettled, {
      count,
      payments: group.map(({ row }) => ({
        paymentRef: row.paymentRef,
        amount: row.amount,
        // Never null here: classify() reaches "unsettled" only for a captured/settled row
        // (initiated rows `continue` earlier), and both states always stamp settled_at at insert
        // time — normalised to ISO-8601, unlike the raw `mode: "string"` Postgres format.
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
        remediating: claimedRefs.has(row.paymentRef),
      })),
    });
  }
  // klass === "drift": classify() only ever pushes a "drift" row alongside its matched settlement
  // (see its `else if` arm), so every entry here really does carry one — the cast makes that
  // invariant explicit instead of fabricating a `captured === settled` fallback for a case that
  // cannot occur.
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

/** Raises the aggregate `missingLocal` incident for the settlements the processor attributed back to
 * one of our working orders. An unattributed settlement has no till, so it cannot be an incident at
 * all — it is reported in the result and left to the caller.
 *
 * Resolves every hinted settlement's till in ONE batched query (`tillsForWorkingOrders`), not one
 * per settlement — the same reasoning as `existingReferences`'s batching above: this runs inside T2,
 * a write transaction, so N round trips here would lengthen lock contention with the concurrent
 * sweeps this feature explicitly supports (see `reconcile.concurrency.test.ts`), and a large report
 * with many hinted settlements is precisely the shape that makes that N largest. A hint whose working
 * order does not resolve is still skipped (absent from the map), exactly as the unbatched lookup's
 * `undefined` return skipped it. */
async function raiseMissingLocal(
  tx: Transaction,
  deps: ReconcileDeps,
  tenantId: TenantId,
  missing: SettlementRecord[],
  now: Date,
): Promise<number> {
  const hintedIds = new Set<string>();
  for (const record of missing) {
    if (record.hint !== undefined) hintedIds.add(record.hint.workingOrderId);
  }
  const tills = await tillsForWorkingOrders(tx, tenantId, [...hintedIds]);

  const byTill = new Map<string, { record: SettlementRecord; paymentRef: string }[]>();
  for (const record of missing) {
    if (record.hint === undefined) continue;
    const tillId = tills.get(record.hint.workingOrderId);
    if (tillId === undefined) continue;
    const group = byTill.get(tillId);
    const item = { record, paymentRef: record.hint.paymentRef };
    if (group === undefined) byTill.set(tillId, [item]);
    else group.push(item);
  }

  let raised = 0;
  for (const [tillId, group] of byTill) {
    const inserted = await deps.incidents(tx, {
      tenantId,
      tillId: brandTillId(tillId),
      error: new AppError(CODE.missingLocal, {
        count: group.length,
        settlements: group.map(({ record, paymentRef }) => ({
          references: record.references,
          amount: record.amount,
          settledAt: record.settledAt.toISOString(),
          paymentRef,
        })),
      }),
      severity: "error",
      detectedAt: now,
    });
    if (inserted) raised += 1;
  }
  return raised;
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

/**
 * Reverse one claimed orphan at the processor, outside every transaction (it is a network call).
 * Returns `null` when the money went back, or a structured failure reason when it did not — the
 * refused payment's `AppError` code, or the literal `"unknown"` for a non-`AppError` failure.
 *
 * A refusal is not fatal to the sweep and is never retried: the marker was already stamped in T2.
 * This function raises no incident itself — the caller aggregates every failure from this sweep
 * into one incident per till (see `raiseRemediationFailures`), for the same reason
 * `raiseRowIncidents` aggregates: these payments have a null `sale_id` by definition, so incidents
 * raised one per payment would race for a single open-incident dedup slot and silently collapse. A
 * payment the adapter cannot address at all (a hosted payment, whose stored reference is not the
 * one the reversal path needs) lands here too, by design — visible, bounded, and fixed for free
 * when that reference gap closes.
 */
async function remediate(deps: ReconcileDeps, row: ReconcilableRow): Promise<string | null> {
  try {
    await deps.reverse(row.paymentRef);
    return null;
  } catch (error) {
    return isAppError(error) ? error.code : "unknown";
  }
}

/** One orphan whose reversal this sweep attempted and the processor refused. */
interface RemediationFailure {
  row: ReconcilableRow;
  reason: string;
}

/** Raises one AGGREGATE `remediation_failed` incident per till over this sweep's failed reversals —
 * mirrors `raiseRowIncidents`/`raiseMissingLocal`. Opens its own short transaction: the reversals
 * that produced these failures already ran outside every transaction, so this is the first and only
 * transaction the failure path needs. Returns how many incidents were really inserted. */
async function raiseRemediationFailures(
  deps: ReconcileDeps,
  tenantId: TenantId,
  failures: RemediationFailure[],
  now: Date,
): Promise<number> {
  const byTill = new Map<string, RemediationFailure[]>();
  for (const failure of failures) {
    const group = byTill.get(failure.row.tillId);
    if (group === undefined) byTill.set(failure.row.tillId, [failure]);
    else group.push(failure);
  }

  let raised = 0;
  await withTenant(deps.db, tenantId, async (tx) => {
    for (const [tillId, group] of byTill) {
      const inserted = await deps.incidents(tx, {
        tenantId,
        tillId: brandTillId(tillId),
        error: new AppError(CODE.remediationFailed, {
          count: group.length,
          payments: group.map(({ row, reason }) => ({
            paymentRef: row.paymentRef,
            amount: row.amount,
            reason,
          })),
        }),
        severity: "error",
        detectedAt: now,
      });
      if (inserted) raised += 1;
    }
  });
  return raised;
}
