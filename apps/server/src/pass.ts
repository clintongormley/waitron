import type { DrainResult } from "@waitron/fiscal";
import type { RunRecord, TickResult } from "@waitron/scheduler";
import { codeOf } from "./error-code.js";
import type { Logger } from "./logger.js";

/** This host's own label for the fiscal drainer. It has no `scheduled_runs` name because it is not
 * a ledger duty — see the scheduler design's amendment for why it cannot be one. */
export const DRAIN_DUTY = "fiscal.drain";
/** The ledger duty name, matching what `reconcilerAsDuty` writes into `scheduled_runs.duty`. */
export const RECONCILE_DUTY = "payments.reconcile.stripe";

/** The canonical duty set this host runs. Consumers that must cover every duty — `health.ts`'s
 * `DUTY_BUDGET_MS` is the reason this exists — key off `Duty` rather than `string`, so adding a
 * duty here without updating them is a compile error, not a silent gap. */
export const ALL_DUTIES = [DRAIN_DUTY, RECONCILE_DUTY] as const;
export type Duty = (typeof ALL_DUTIES)[number];

export interface DutyReport {
  duty: string;
  ok: boolean;
  errorCode?: string;
  nextDueAt: Date | null;
  /**
   * How many tenants this duty abandoned this pass — `DrainResult.skipped.length` for `drain`,
   * `TickResult.skipped.length` for reconcile (their element shapes differ, which is why each is
   * still logged under its own event in `runPass` below; this field only ever carries the count).
   * Undefined for a duty that threw — `attempt`'s catch branch never reaches the body that would
   * compute this, so there is no count to report, not a zero one. `health.ts` treats undefined and
   * zero identically, so the distinction is not load-bearing, only honest about where the number
   * came from.
   *
   * This is C2: a per-tenant skip is a per-tenant FAILURE of the duty, not a partial success, and
   * `attempt` below only ever sets `ok: false` on a THROW — a `drain` or `runDue` call that returns
   * normally with a non-empty `skipped` list still reports `ok: true` here, on purpose (§6/§7: a
   * skipped tenant has no ledger row and no incident, this pass's summary line is what carries it
   * to a reader at all). Before this field existed, `health.ts` had nothing to read but `ok`, so a
   * tenant with due fiscal work and no usable certificate accumulated `pendiente` rows past its
   * art. 16.4 hour while `/health` answered 200 — see `health.ts`'s own comment on `recordPass`
   * (not `isStale`, which is about undeclared duties, not skips) for how this field closes that.
   */
  skipped?: number;
  /** How long this duty took, from `attempt`'s own monotonic reads. Present for a duty that threw
   * too — the elapsed time is real either way, unlike `skipped`/`parked`, which a throw leaves
   * with no honest value. */
  durationMs: number;
  /**
   * How many of `TickResult.ran` this pass ended `outcome: "parked"` — a run that exhausted
   * `maxAttempts` (`@waitron/scheduler`'s `parkOrRetry`), whose `completeRun` wrote
   * `next_attempt_at = null`: terminal, and nothing will claim that (tenant, duty, period) again.
   * This is the IDENTICAL gap `skipped` above closes, one duty over: a `runDue` call that parked
   * every period it touched still returns normally, with an empty `skipped` list (a park is not an
   * infrastructure failure mid-sweep, it is a duty that ran and lost every attempt), so `ok: true`
   * here would otherwise be the whole story. `health.ts`'s `recordPass` reads this the same way it
   * reads `skipped`, for the same reason.
   *
   * Deliberately EXCLUDES `outcome: "failed"` — a failed run still has a `next_attempt_at` and is
   * retried on its own backoff, so counting it here would flip health on an ordinary transient
   * retry rather than a genuine abandonment; see `recordPass`'s own comment for why that
   * distinction matters. Always a number (never omitted) for a duty that returned normally — `0`
   * for `fiscal.drain`, whose `DrainResult` has no run-level terminal outcome at all (a halted
   * fiscal record is a different, already-persisted signal — see this file's own comment on the
   * `drain.complete` line below, and `packages/scheduler/src/duty.ts`'s own doc comment on why
   * `drain` cannot use this ledger). Undefined only when the duty threw, mirroring `skipped`.
   */
  parked?: number;
}

export interface PassReport {
  duties: DutyReport[];
  /** The earliest time either duty says work next appears — the minimum of the NON-NULL answers. */
  nextDueAt: Date | null;
}

export interface PassDeps {
  drain: (now: Date) => Promise<DrainResult>;
  reconcile: (now: Date) => Promise<TickResult>;
  /**
   * A MONOTONIC millisecond clock — `performance.now` in `boot.ts`, injected here so the suite
   * asserts exact durations. Deliberately not the wall-clock `now` this function already receives:
   * an NTP step during a pass would make that produce a negative or absurd duration, in the one
   * field an operator uses to spot a slow one.
   */
  monotonicMs: () => number;
  log: Logger;
}

export async function runPass(deps: PassDeps, now: Date): Promise<PassReport> {
  const startedAt = deps.monotonicMs();
  const duties: DutyReport[] = [];

  // DRAIN FIRST, unconditionally. It is the duty with a legal clock.
  duties.push(
    await attempt(DRAIN_DUTY, now, deps.log, deps.monotonicMs, async () => {
      const result = await deps.drain(now);
      for (const skipped of result.skipped) {
        // A tenant with due fiscal work this pass could not submit for is an unmet legal
        // obligation. It has no ledger row and no incident (`incidents.till_id` is NOT NULL and a
        // drain has no till), so this line is the only place it exists.
        deps.log("warn", "drain.tenant_skipped", skipped);
      }
      deps.log("info", "drain.complete", {
        batchesSent: result.batchesSent,
        recordsSubmitted: result.recordsSubmitted,
        recordsAccepted: result.recordsAccepted,
        recordsHalted: result.recordsHalted,
        incidentsRaised: result.incidentsRaised,
        skipped: result.skipped.length,
        nextDueAt: result.nextDueAt?.toISOString() ?? null,
      });
      // DECISION (pre-merge review, 2026-07-27): `recordsHalted`/`incidentsRaised` do NOT feed
      // `parked` (or any other health-flipping field) the way reconcile's parked runs do below —
      // `parked` stays a fixed `0` for this duty, always. Two reasons, not one:
      //
      //   1. A halted record is not an abandoned unit of work with nowhere else to look. The
      //      moment it happens, `raiseIncident` (packages/fiscal-verifactu/src/drain.ts) has
      //      already written it to the `incidents` table — tenant/till/sale-scoped, its own
      //      structured code and severity, in the SAME transaction as the estado change — a
      //      persisted, queryable trail `TickResult`'s "parked" outcome has no equivalent of (a
      //      park writes `next_attempt_at = null` and nothing else record-shaped at all).
      //   2. It is not necessarily a SYSTEM failure. A rejected record can be a genuine per-invoice
      //      data problem (a malformed field AEAT itself rejects) that says nothing about whether
      //      this host is working. Flipping `/health` on it would conflate "AEAT rejected this one
      //      invoice" with "this process is stuck" — the false-alarm noise `skipped` above is
      //      already careful not to produce for an ordinary per-tenant retry.
      //
      // A tenant provisioned with the WRONG `certKind` (present, naming the other kind — this
      // review's own example) is still visible, just not through `/health`: every batch keeps
      // landing in `recordsHalted`/`incidentsRaised` on this line, pass after pass, with no
      // corresponding drop in what `envios.pendingCount` reports — an operator grepping
      // `drain.complete` (or the `incidents` table directly) for a duty that never stops halting
      // records sees exactly that shape. `apps/server/README.md`'s opening claim about what `200`
      // covers is written to match this, not to claim more than it does.
      return { nextDueAt: result.nextDueAt, skipped: result.skipped.length, parked: 0 };
    }),
  );

  duties.push(
    await attempt(RECONCILE_DUTY, now, deps.log, deps.monotonicMs, async () => {
      const result = await deps.reconcile(now);
      for (const skipped of result.skipped) {
        deps.log("warn", "reconcile.pair_skipped", skipped);
      }
      // A bare count of `result.ran` cannot tell "every run swept clean" apart from "every run was
      // abandoned for good" — both produce the same number. Breaking it down by `RunRecord.outcome`
      // is what makes the log line answer that without a reader having to go correlate individual
      // `reconcile.run_failed`/`reconcile.run_parked` lines just to learn there were any at all.
      const ranByOutcome = { succeeded: 0, failed: 0, parked: 0 };
      for (const record of result.ran) {
        ranByOutcome[record.outcome] += 1;
        logNonSucceededRun(deps.log, record);
      }
      deps.log("info", "reconcile.complete", {
        ran: ranByOutcome,
        deferred: result.deferred,
        beyondHorizon: result.beyondHorizon,
        skipped: result.skipped.length,
        nextDueAt: result.nextDueAt?.toISOString() ?? null,
      });
      return {
        nextDueAt: result.nextDueAt,
        skipped: result.skipped.length,
        parked: ranByOutcome.parked,
      };
    }),
  );

  const nextDueAt = earliest(duties.map((entry) => entry.nextDueAt));
  deps.log("info", "pass.complete", {
    duties: duties.map((entry) => ({
      duty: entry.duty,
      ok: entry.ok,
      durationMs: entry.durationMs,
      ...(entry.errorCode === undefined ? {} : { errorCode: entry.errorCode }),
    })),
    durationMs: Math.round(deps.monotonicMs() - startedAt),
    nextDueAt: nextDueAt?.toISOString() ?? null,
  });
  return { duties, nextDueAt };
}

/**
 * Runs one duty and NEVER rethrows. A duty that fails forever must be visible, not fatal: letting
 * the throw out would end art. 16.4's hourly retry on one transient blip.
 *
 * A failure reports `now` as its next due time. It has no answer of its own — whatever it was going
 * to say died with the throw — and "due immediately" is the honest reading, which the loop's
 * MIN_TICK floor then turns into a prompt retry rather than a hot spin. It also has no `skipped` or
 * `parked` count of its own for the identical reason: both stay `undefined`, not `0` — `0` would
 * claim a clean sweep the throw makes no promise about. `durationMs` is the one field that stays
 * populated on both branches — elapsed monotonic time is real whether or not the body threw.
 */
async function attempt(
  duty: string,
  now: Date,
  log: Logger,
  monotonicMs: () => number,
  body: () => Promise<{ nextDueAt: Date | null; skipped: number; parked: number }>,
): Promise<DutyReport> {
  const startedAt = monotonicMs();
  try {
    const result = await body();
    return {
      duty,
      ok: true,
      nextDueAt: result.nextDueAt,
      skipped: result.skipped,
      parked: result.parked,
      durationMs: Math.round(monotonicMs() - startedAt),
    };
  } catch (error) {
    const errorCode = codeOf(error);
    log("error", "duty.failed", { duty, errorCode });
    return {
      duty,
      ok: false,
      errorCode,
      nextDueAt: now,
      durationMs: Math.round(monotonicMs() - startedAt),
    };
  }
}

/**
 * One line per run that did NOT succeed, carrying its `errorCode` and enough identity to act on —
 * `tenantId`, `duty`, `period` — rather than leaving a reader to correlate `reconcile.complete`'s
 * bare counts back to which (tenant, duty, period) they belong to. Level escalates with what the
 * outcome actually means: `failed` is still retrying on its own backoff (`warn`), `parked` has
 * exhausted `maxAttempts` and nothing will claim it again (`error`) — the identical distinction
 * `DutyReport.parked`'s own doc comment draws for why only `parked` may flip `/health`.
 */
function logNonSucceededRun(log: Logger, record: RunRecord): void {
  if (record.outcome === "succeeded") return;
  log(record.outcome === "parked" ? "error" : "warn", `reconcile.run_${record.outcome}`, {
    tenantId: record.tenantId,
    duty: record.duty,
    period: { from: record.period.from.toISOString(), to: record.period.to.toISOString() },
    errorCode: record.errorCode,
  });
}

function earliest(times: readonly (Date | null)[]): Date | null {
  const known = times.filter((time): time is Date => time !== null);
  if (known.length === 0) return null;
  return new Date(Math.min(...known.map((time) => time.getTime())));
}
