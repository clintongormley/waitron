import type { SingletonRole } from "@waitron/db";
import { FISCAL_SUBMISSION_QUEUED, type DrainResult } from "@waitron/fiscal";
import type { TickResult } from "@waitron/payments";
import { codeOf } from "@waitron/server-kit";
import type { DutyTimings } from "./config.js";
import { logDegradedDuties, recordDuty, type HealthState } from "./health.js";
import type { JobDefinition, JobPassResult } from "./job-runner.js";
import type { Logger } from "./logger.js";
import {
  DRAIN_DUTY,
  RECONCILE_DUTY,
  drainReport,
  reconcileReport,
  type AwaitingCertStatus,
  type Duty,
} from "./pass.js";

interface DutyDeps {
  getRole: () => SingletonRole;
  health: HealthState;
  timings: Pick<DutyTimings, "minTickMs" | "maxTickMs">;
  monotonicMs: () => number;
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
  { health, log, monotonicMs }: DutyDeps,
  duty: Duty,
  at: Date,
  body: () => Promise<{ nextDueAt: Date | null; skipped: number; parked: number }>,
): Promise<JobPassResult> {
  const startedAt = monotonicMs();
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
          errorCode,
          nextDueAt: at,
          durationMs: Math.round(monotonicMs() - startedAt),
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
      ...result,
      durationMs: Math.round(monotonicMs() - startedAt),
    },
    at,
  );
  logDegradedDuties(log, [record]);
  return { nextDueAt: result.nextDueAt, degraded: record.degraded };
}
