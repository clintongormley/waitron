import { Hono } from "hono";
import { isVenueHolderFresh, readVenueHolderAsync } from "@waitron/db";
import type { StreamView } from "@waitron/stream";
import { DEFAULT_MAX_TICK_MS } from "./config.js";
import { ALL_DUTIES, DRAIN_DUTY, RECONCILE_DUTY, type Duty, type PassReport } from "./pass.js";
import type { Logger } from "./logger.js";

const HOUR_MS = 60 * 60 * 1000;
/**
 * A duty's staleness budget must exceed the longest sleep the loop can take, or an idle host flips
 * 503 once per cycle: with no work due, `sleepMsFor` (`loop.ts`) sleeps exactly `maxTickMs`.
 */
const DRAIN_STALE_SLACK_MS = 15 * 60 * 1000;

/**
 * How long each duty may go without a success before this host calls itself unhealthy. Reconcile's
 * is a daily period plus slack.
 *
 * Keyed by `Duty`, so a duty in `ALL_DUTIES` without a budget here is a compile error.
 *
 * Bounded against `DEFAULT_MAX_TICK_MS`, not the running `WAITRON_MAX_TICK_MS`; `boot.ts` refuses a
 * runtime value at or above drain's budget (`reason: "at_or_above_drain_budget"`).
 */
export const DUTY_BUDGET_MS: Readonly<Record<Duty, number>> = {
  [DRAIN_DUTY]: DEFAULT_MAX_TICK_MS + DRAIN_STALE_SLACK_MS,
  [RECONCILE_DUTY]: 26 * HOUR_MS,
};

export interface DutyHealth {
  lastOkAt: Date | null;
  consecutiveFailures: number;
  /** From the most recently recorded pass; 0 when the duty threw before counting. Shown so
   * `/health` says WHY a duty reads unhealthy. */
  skipped: number;
  /** As `skipped`; always 0 for `fiscal.drain`. */
  parked: number;
}

export interface HealthState {
  startedAt: Date;
  lastPassAt: Date | null;
  duties: Record<string, DutyHealth>;
  /** Reported, never judged: `/health` failing on an external bucket would stall an install or an
   * update on someone else's outage (`deploy/waitron.sh` waits for a healthy container). */
  readStream: () => StreamView;
}

/** A host that has booted and not yet passed reports 503: never having submitted is not healthy. */
export function createHealthState(startedAt: Date): HealthState {
  const duties: Record<string, DutyHealth> = {};
  for (const duty of ALL_DUTIES) {
    duties[duty] = { lastOkAt: null, consecutiveFailures: 0, skipped: 0, parked: 0 };
  }
  return { startedAt, lastPassAt: null, duties, readStream: () => ({ state: "off" }) };
}

/** Returned so a caller can log at a level the FRESH count supports; `pass.ts` logs before
 * `recordPass` runs. */
export interface DutyRecord {
  duty: string;
  consecutiveFailures: number;
  skipped: number;
  parked: number;
  stale: boolean;
  lastOkAt: Date | null;
  /** The expression that decides whether `lastOkAt` advances, so the log and `/health` agree. */
  degraded: boolean;
}

/**
 * A pass with `skipped > 0` or `parked > 0` counts as a FAILURE even though it reports `ok: true`
 * (`ok: false` means only that the duty threw): a skip leaves an obligation unmet, and a parked run
 * is never claimed again. A `failed` run is still retried, so it does not count.
 *
 * `/health` holds one verdict per top-level duty, so one skipped or parked item marks the whole
 * duty degraded.
 */
export function recordPass(state: HealthState, report: PassReport, at: Date): DutyRecord[] {
  state.lastPassAt = at;
  const records: DutyRecord[] = [];
  for (const entry of report.duties) {
    const duty = (state.duties[entry.duty] ??= {
      lastOkAt: null,
      consecutiveFailures: 0,
      skipped: 0,
      parked: 0,
    });
    duty.skipped = entry.skipped ?? 0;
    duty.parked = entry.parked ?? 0;
    const degraded = !(entry.ok && duty.skipped === 0 && duty.parked === 0);
    if (degraded) {
      duty.consecutiveFailures += 1;
    } else {
      duty.lastOkAt = at;
      duty.consecutiveFailures = 0;
    }
    records.push({
      duty: entry.duty,
      consecutiveFailures: duty.consecutiveFailures,
      skipped: duty.skipped,
      parked: duty.parked,
      stale: isStale(duty, budgetFor(entry.duty), at),
      lastOkAt: duty.lastOkAt,
      degraded,
    });
  }
  return records;
}

/**
 * The level comes from STALENESS, not the failure count: a count means a different time at each
 * retry cadence, while `stale` is exactly what `/health` answers 503 on.
 *
 * No `errorCode`: `duty.failed` (`pass.ts`) already carries the throw's code.
 */
export function logDegradedDuties(log: Logger, records: readonly DutyRecord[]): void {
  for (const record of records) {
    if (!record.degraded) continue;
    log(record.stale ? "error" : "warn", "duty.degraded", {
      duty: record.duty,
      consecutiveFailures: record.consecutiveFailures,
      skipped: record.skipped,
      parked: record.parked,
      stale: record.stale,
      lastOkAt: record.lastOkAt?.toISOString() ?? null,
    });
  }
}

/** `undefined` for a duty name outside `Duty`, which a runtime `PassReport` can carry. */
function budgetFor(name: string): number | undefined {
  return (DUTY_BUDGET_MS as Readonly<Record<string, number>>)[name];
}

function isStale(duty: DutyHealth, budgetMs: number | undefined, now: Date): boolean {
  // A duty with no declared budget is stale, not exempt, so the omission is visible.
  if (budgetMs === undefined) return true;
  if (duty.lastOkAt === null) return true;
  return now.getTime() - duty.lastOkAt.getTime() > budgetMs;
}

export function healthSnapshot(
  state: HealthState,
  now: Date,
): { ok: boolean; body: Record<string, unknown> } {
  const duties: Record<string, unknown> = {};
  let ok = state.lastPassAt !== null;
  for (const [name, duty] of Object.entries(state.duties)) {
    const stale = isStale(duty, budgetFor(name), now);
    if (stale) ok = false;
    duties[name] = {
      lastOkAt: duty.lastOkAt?.toISOString() ?? null,
      consecutiveFailures: duty.consecutiveFailures,
      skipped: duty.skipped,
      parked: duty.parked,
      stale,
    };
  }
  return {
    ok,
    body: {
      ok,
      startedAt: state.startedAt.toISOString(),
      lastPassAt: state.lastPassAt?.toISOString() ?? null,
      duties,
      stream: streamHealth(state.readStream()),
    },
  };
}

/** Named field by field: the generation's name carries the node id and term, which stay off this
 * unauthenticated route. */
function streamHealth(view: StreamView): Record<string, unknown> {
  if (!("reason" in view)) return { state: view.state };
  if (!("lagMs" in view))
    return { state: view.state, reason: view.reason, stateSince: view.stateSince };
  return {
    state: view.state,
    reason: view.reason,
    stateSince: view.stateSince,
    bucketProblem: view.bucketProblem,
    lagMs: view.lagMs,
    lastConfirmedUploadAt: view.lastConfirmedUploadAt,
  };
}

/**
 * The holder file beside `venue.lock`, judged by the same parser and bound a refused start uses
 * (`node-entry.ts`), so the two agree. Its pid and host stay off this unauthenticated route. Null
 * when there is no readable file.
 */
async function venueHolderHealth(
  venueDir: string,
  now: Date,
): Promise<Record<string, unknown> | null> {
  const holder = await readVenueHolderAsync(venueDir);
  if (holder === null) return null;
  return {
    kind: holder.kind,
    lockedAt: holder.lockedAt,
    heartbeatAt: holder.heartbeatAt,
    stale: !isVenueHolderFresh(holder, now),
  };
}

/** Unauthenticated. The venue holder is reported beside the duties and does not enter the status
 * code. */
export function healthApp(
  state: HealthState,
  now: () => Date,
  options: { venueDir?: string } = {},
): Hono {
  const app = new Hono();
  app.get("/health", async (c) => {
    const at = now();
    const snapshot = healthSnapshot(state, at);
    const body =
      options.venueDir === undefined
        ? snapshot.body
        : { ...snapshot.body, venueHolder: await venueHolderHealth(options.venueDir, at) };
    return c.json(body, snapshot.ok ? 200 : 503);
  });
  return app;
}
