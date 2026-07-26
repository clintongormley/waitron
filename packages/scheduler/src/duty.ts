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
 * The design's §3 deferred it as dead surface and predicted it would later cost "a new source of
 * due work in `derive` plus a migration". That prediction was wrong, and the two duties turn out
 * not to have the same answer:
 *
 *   - **`drain` cannot use this ledger at all.** It takes NO tenant and enumerates its own across
 *     `envios_tenants_with_work`, while every row here is `tenant_id NOT NULL` under RLS; it
 *     already owns durable schedule state (`envio_flujo.proximo_envio_en`, `envios.
 *     proximo_intento_en`); and `parked` is terminal, so three throws would silently end a LEGAL
 *     hourly retry. What it needs is a caller, which the `apps/*` host is anyway.
 *   - **`forward` is deferred, not ruled out.** None of the above applies to it: it is a
 *     per-tenant object, it owns no durable cadence (just an in-process constant in the adapter),
 *     and its failure is not legally load-bearing. It is waiting on a consumer for the `nextDueAt`
 *     it already returns — i.e. on the host — not on a reason.
 *
 * See `2026-07-25-recurring-work-scheduler-design.md` §3's amendment.
 */
export interface PeriodDuty {
  /** Stable ledger key, e.g. "payments.reconcile.stripe". It is an identifier: changing it orphans
   * that duty's history and restarts derivation from the most recent complete period. */
  readonly name: string;
  readonly cadence: "daily";
  run(tenantId: TenantId, period: RunPeriod, now: Date): Promise<DutyOutcome>;
}
