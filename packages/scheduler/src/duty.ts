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
 * `drain` must not become a `PeriodDuty`: once `maxAttempts` attempts are spent the period parks,
 * and a parked period is tried again only when the duty sets `retryParkedAfterMs`, and only after
 * that delay, while drain's hourly retry is a legal duty. It also keeps its own persisted
 * schedule (`envio_flujo.proximo_envio_en`, and `envios.proximo_intento_en` per record), which a
 * ledger row would duplicate. There is no second duty kind for `nextDueAt`-shaped duties: one was
 * ruled out for `drain` and deferred for `forward`.
 */
export interface PeriodDuty {
  /** Stable ledger key, e.g. "payments.reconcile.stripe". It is an identifier: changing it orphans
   * that duty's history and restarts derivation from the most recent complete period. */
  readonly name: string;
  readonly cadence: "daily";
  /** When set, a run that parks queues the next generation of the same period, due this long
   * after the park. Unset, a parked period is never tried again. */
  readonly retryParkedAfterMs?: number;
  run(period: RunPeriod, now: Date): Promise<DutyOutcome>;
}
