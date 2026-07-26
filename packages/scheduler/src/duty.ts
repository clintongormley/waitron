import type { TenantId } from "@waitron/shared";

/** Half-open `[from, to)`. Structurally identical to payments' `ReconcilePeriod`, deliberately:
 * a `PaymentReconciler` must adapt to a `PeriodDuty` without either package importing the other. */
export interface RunPeriod {
  from: Date;
  to: Date;
}

/** What a duty hands back. */
export interface DutyOutcome {
  /** Stored verbatim in `scheduled_runs.summary`. Structured data only — never prose, and never a
   * `Date` (serialise to ISO first): this is the duty's durable record. */
  summary: Record<string, unknown>;
  /**
   * Set when this run left something unresolved that a LATER sweep of the SAME period could
   * resolve. The runner enqueues a fresh generation of this period due at that time, and never
   * learns why — which is what keeps it duty-neutral.
   *
   * Without this, nothing would ever re-derive a successfully-swept period: it has no gap. This
   * is what makes a gated drift orphan self-healing rather than merely re-reported.
   */
  resweepAfter?: Date;
}

/**
 * One recurring duty over calendar periods. Typed structurally and injected, so this package never
 * imports `@waitron/payments` or `@waitron/fiscal` — the same reason payments' `IncidentSink` is
 * structural rather than an import of `@waitron/core`.
 *
 * `now` is a parameter, exactly as `drain(now)` / `forward(now)` / `reconcile(…, now)` take it: an
 * injected clock is what makes the boundary testable.
 *
 * There is deliberately no second duty kind for `nextDueAt`-shaped duties (`drain`, `forward`).
 * See the design's §3: an interface with no caller and no meaningful fake is dead surface. Adding
 * one is a new source of due work in `derive` plus a migration, not a rewrite.
 */
export interface PeriodDuty {
  /** Stable ledger key, e.g. "payments.reconcile.stripe". It is an identifier: changing it orphans
   * that duty's history and restarts derivation from the most recent complete period. */
  readonly name: string;
  readonly cadence: "daily";
  run(tenantId: TenantId, period: RunPeriod, now: Date): Promise<DutyOutcome>;
}
