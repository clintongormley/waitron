/** Half-open `[from, to)`. */
export interface RunPeriod {
  from: Date;
  to: Date;
}

export interface DutyOutcome {
  /** Stored verbatim in `scheduled_runs.summary`. Structured data only — never prose, and never a
   * `Date` (serialise to ISO first). */
  summary: Record<string, unknown>;
  /**
   * Set when this run left something unresolved that a LATER sweep of the SAME period could
   * resolve. The runner enqueues a fresh generation of this period due at that time, and never
   * learns why — which is what keeps it duty-neutral.
   *
   * Without this, nothing would ever re-derive a successfully-swept period: it has no gap.
   */
  resweepAfter?: Date;
}

/**
 * One recurring duty over calendar periods. Typed structurally and injected, so no non-test file in
 * this package imports `@waitron/payments` or `@waitron/fiscal`.
 *
 * `drain` must not become a `PeriodDuty`: `parked` is terminal, so once `maxAttempts` attempts are
 * spent nothing retries it, and its hourly retry is a legal duty. Why there is no second duty kind
 * for `nextDueAt`-shaped duties (`drain`, `forward`):
 * `2026-07-25-recurring-work-scheduler-design.md` §3's amendment.
 */
export interface PeriodDuty {
  /** Stable ledger key, e.g. "payments.reconcile.stripe". It is an identifier: changing it orphans
   * that duty's history and restarts derivation from the most recent complete period. */
  readonly name: string;
  readonly cadence: "daily";
  run(period: RunPeriod, now: Date): Promise<DutyOutcome>;
}
