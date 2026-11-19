import type { SingletonRole } from "@waitron/db";
import { FISCAL_SUBMISSION_QUEUED, type DrainResult } from "@waitron/fiscal";
import type { RunRecord, TickResult } from "@waitron/payments";
import { codeOf } from "@waitron/server-kit";
import type { DutyTimings } from "./config.js";
import { logDegradedDuties, recordDuty, type HealthState } from "./health.js";
import type { JobDefinition, JobPassResult } from "./job-runner.js";
import type { Logger } from "./logger.js";
import { DRAIN_DUTY, RECONCILE_DUTY, type AwaitingCertStatus, type Duty } from "./pass.js";

interface DutyDeps {
  getRole: () => SingletonRole;
  health: HealthState;
  timings: Pick<DutyTimings, "minTickMs" | "maxTickMs">;
  log: Logger;
}

function schedule({ minTickMs, maxTickMs }: DutyDeps["timings"]) {
  return {
    minSleepMs: minTickMs,
    maxSleepMs: maxTickMs,
    backoff: { firstMs: minTickMs, maxMs: minTickMs },
  };
}

export function drainJob(
  deps: DutyDeps & {
    drain: (now: Date, signal: AbortSignal) => Promise<DrainResult>;
    awaitingCert: AwaitingCertStatus;
  },
): JobDefinition {
  return {
    name: DRAIN_DUTY,
    applies: () => true,
    wakeOn: [FISCAL_SUBMISSION_QUEUED],
    ...schedule(deps.timings),
    async pass({ now, signal }) {
      try {
        if (deps.getRole() !== "primary") return { nextDueAt: null };
        return await runDuty(deps, DRAIN_DUTY, now, async () =>
          drainReport(await deps.drain(now, signal), deps),
        );
      } finally {
        // The drain is also the heartbeat for a secondary. A late payment check owns only its duty.
        deps.health.lastPassAt = now;
      }
    },
  };
}

export function reconcileJob(
  deps: DutyDeps & { reconcile: (now: Date) => Promise<TickResult> },
): JobDefinition {
  return {
    name: RECONCILE_DUTY,
    applies: () => deps.getRole() === "primary",
    ...schedule(deps.timings),
    pass: ({ now }) =>
      runDuty(deps, RECONCILE_DUTY, now, async () =>
        reconcileReport(await deps.reconcile(now), deps.log),
      ),
  };
}

async function runDuty(
  { health, log }: DutyDeps,
  duty: Duty,
  at: Date,
  body: () => Promise<{ nextDueAt: Date | null; skipped: number; parked: number }>,
): Promise<JobPassResult> {
  let result: Awaited<ReturnType<typeof body>>;
  try {
    result = await body();
  } catch (error) {
    const errorCode = codeOf(error);
    log("error", "duty.failed", { duty, errorCode });
    logDegradedDuties(log, [
      recordDuty(
        health,
        {
          duty,
          ok: false,
        },
        at,
      ),
    ]);
    throw error;
  }
  const record = recordDuty(
    health,
    {
      duty,
      ok: true,
      skipped: result.skipped,
      parked: result.parked,
    },
    at,
  );
  logDegradedDuties(log, [record]);
  return { nextDueAt: result.nextDueAt, degraded: record.degraded };
}

const AWAITING_CERT_ERROR = "credentials.missing";

function drainReport(result: DrainResult, deps: { awaitingCert: AwaitingCertStatus; log: Logger }) {
  let sawMissingCert = false;
  for (const skipped of result.skipped) {
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
  // Skips drive health. Filing cases and alerts surface individual record refusals.
  return { nextDueAt: result.nextDueAt, skipped: result.skipped.length, parked: 0 };
}

function reconcileReport(result: TickResult, log: Logger) {
  for (const skipped of result.skipped) {
    log("warn", "reconcile.pair_skipped", skipped);
  }
  // A bare count of `result.ran` cannot tell a clean sweep from runs abandoned for good.
  const ranByOutcome = { succeeded: 0, failed: 0, parked: 0 };
  for (const record of result.ran) {
    ranByOutcome[record.outcome] += 1;
    logNonSucceededRun(log, record);
  }
  log("info", "reconcile.complete", {
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
}

/** Records whether this pass is awaiting the fiscal certificate, logging only on a transition. */
function noteAwaitingCert(
  deps: { awaitingCert: AwaitingCertStatus; log: Logger },
  awaiting: boolean,
): void {
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
 * and `error` for `parked`, which has spent its attempts.
 */
function logNonSucceededRun(log: Logger, record: RunRecord): void {
  if (record.outcome === "succeeded") return;
  log(record.outcome === "parked" ? "error" : "warn", `reconcile.run_${record.outcome}`, {
    duty: record.duty,
    period: { from: record.period.from.toISOString(), to: record.period.to.toISOString() },
    errorCode: record.errorCode,
  });
}
