import type { DrainResult } from "@waitron/fiscal";
import type { RunRecord, TickResult } from "@waitron/scheduler";
import { codeOf } from "@waitron/server-kit";
import type { Logger } from "./logger.js";

/** This host's own label for the fiscal drainer. It has no `scheduled_runs` name because it is not
 * a ledger duty (`packages/scheduler/src/duty.ts` says why). */
export const DRAIN_DUTY = "fiscal.drain";
/** The ledger duty name, matching what `reconcilerAsDuty` writes into `scheduled_runs.duty`. */
export const RECONCILE_DUTY = "payments.reconcile.stripe";

/** Consumers that must cover every duty (`health.ts`'s `DUTY_BUDGET_MS`) key off `Duty`, so adding a
 * duty here without updating them is a compile error. */
export const ALL_DUTIES = [DRAIN_DUTY, RECONCILE_DUTY] as const;
export type Duty = (typeof ALL_DUTIES)[number];

export interface DutyReport {
  duty: string;
  ok: boolean;
  errorCode?: string;
  nextDueAt: Date | null;
  /**
   * How much due work this duty abandoned this pass (its result's `skipped.length`); undefined when
   * the duty threw. A skip is a failure of the duty, yet `ok` is false only on a throw, so `/health`
   * reads this count (`recordPass`, health.ts) to see it.
   */
  skipped?: number;
  /** How long this duty took, by the monotonic clock; present when the duty threw too. */
  durationMs: number;
  /**
   * How many runs this pass ended `outcome: "parked"`: they exhausted `maxAttempts`, and nothing will
   * claim that (duty, period) again. A `runDue` that parked every run still returns normally, so
   * `recordPass` reads this as it reads `skipped`. `failed` is excluded because a failed run retries
   * on its own backoff. Always `0` for `fiscal.drain`; undefined when the duty threw.
   */
  parked?: number;
}

export interface PassReport {
  duties: DutyReport[];
  /** The earliest time either duty says work next appears — the minimum of the NON-NULL answers. */
  nextDueAt: Date | null;
}

/**
 * The drain reads one credential, `fiscal.aeat` (`packages/fiscal-verifactu/src/aeat-transport.ts`),
 * so a `credentials.missing` skip from it is always a missing AEAT signing certificate.
 */
const AWAITING_CERT_ERROR = "credentials.missing";

/**
 * True while the last drain pass that had work skipped it for a missing `fiscal.aeat` credential.
 * `runPass` writes it; box-status reads it. Shared by reference so a flip is seen with no restart.
 */
export interface AwaitingCertStatus {
  current: boolean;
}

export interface PassDeps {
  drain: (now: Date) => Promise<DrainResult>;
  reconcile: (now: Date) => Promise<TickResult>;
  /** Set from `DrainResult.skipped`: the drain reports a missing cert as a skip, not a throw. */
  awaitingCert: AwaitingCertStatus;
  /**
   * A MONOTONIC millisecond clock, not the wall-clock `now`: a clock step during a pass would make
   * that produce a negative or absurd duration.
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
      let sawMissingCert = false;
      for (const skipped of result.skipped) {
        // Due fiscal work this pass could not submit is an unmet legal obligation with no ledger row
        // and no incident (`incidents.till_id` is NOT NULL and a drain has no till), so this line is
        // the only place it exists.
        deps.log("warn", "drain.tenant_skipped", skipped);
        if (skipped.errorCode === AWAITING_CERT_ERROR) sawMissingCert = true;
      }
      // A no-work pass read no cert, so it leaves the flag unchanged; clearing it there would log
      // `fiscal.certificate_available` when nothing arrived.
      if (result.tenantsWithWork > 0) {
        noteAwaitingCert(deps, sawMissingCert);
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
      // DECISION: `recordsHalted`/`incidentsRaised` do NOT feed `parked` or any other field that
      // flips `/health`; `parked` is always `0` for this duty. A halted record is already written to
      // the `incidents` table (`raiseIncident`, packages/fiscal-verifactu/src/drain.ts), where the
      // dashboard's alerts show it to anyone holding `fiscal.view`; and a record AEAT rejects can be
      // one invoice's data problem, not a sign that this process is stuck.
      return { nextDueAt: result.nextDueAt, skipped: result.skipped.length, parked: 0 };
    }),
  );

  duties.push(
    await attempt(RECONCILE_DUTY, now, deps.log, deps.monotonicMs, async () => {
      const result = await deps.reconcile(now);
      for (const skipped of result.skipped) {
        deps.log("warn", "reconcile.pair_skipped", skipped);
      }
      // A bare count of `result.ran` cannot tell a clean sweep from runs abandoned for good.
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
 * Runs one duty and NEVER rethrows: letting the throw out would end art. 16.4's hourly retry on one
 * transient blip.
 *
 * A failure reports `now` as its next due time, which the loop's minimum tick turns into a prompt
 * retry rather than a hot spin. Its `skipped` and `parked` stay undefined, not `0`, which would
 * claim a clean sweep.
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

/** Records whether this pass is awaiting the fiscal certificate, logging only on a transition. */
function noteAwaitingCert(deps: PassDeps, awaiting: boolean): void {
  if (awaiting === deps.awaitingCert.current) return;
  deps.awaitingCert.current = awaiting;
  if (awaiting) {
    deps.log("warn", "fiscal.awaiting_certificate", {});
  } else {
    deps.log("info", "fiscal.certificate_available", {});
  }
}

/**
 * One line per run that did not succeed: `warn` for `failed`, which still retries on its own backoff,
 * and `error` for `parked`, which nothing will claim again.
 */
function logNonSucceededRun(log: Logger, record: RunRecord): void {
  if (record.outcome === "succeeded") return;
  log(record.outcome === "parked" ? "error" : "warn", `reconcile.run_${record.outcome}`, {
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
