import { Hono } from "hono";
import { DEFAULT_MAX_TICK_MS } from "./config.js";
import { ALL_DUTIES, DRAIN_DUTY, RECONCILE_DUTY, type Duty, type PassReport } from "./pass.js";
import type { Logger } from "./logger.js";

const HOUR_MS = 60 * 60 * 1000;
/**
 * Deliberate margin over `DEFAULT_MAX_TICK_MS`, drain's own budget below. THE INVARIANT: a duty's
 * staleness budget must exceed the longest sleep the loop can actually take, or an idle host with
 * nothing due flips 503 once per cycle BY CONSTRUCTION — not because anything is broken, but
 * because `loop.ts`'s `sleepMsFor(null, …)` returns `maxTickMs` verbatim when no duty has work, and
 * the pass that follows lands right at that ceiling. Before this constant existed, drain's budget
 * (`HOUR_MS`) and `DEFAULT_MAX_TICK_MS` (also one hour) were two independently-chosen literals that
 * happened to be equal — this margin, and importing `DEFAULT_MAX_TICK_MS` rather than
 * re-declaring it, is what stops them silently re-colliding the next time either changes.
 */
const DRAIN_STALE_SLACK_MS = 15 * 60 * 1000;

/**
 * How long each duty may go without a success before this host calls itself unhealthy.
 *
 * `fiscal.drain`'s budget is art. 16.4's cadence — one hour — PLUS `DRAIN_STALE_SLACK_MS` above:
 * the invariant this constant exists to satisfy. Reconcile's is a daily period plus slack: a sweep
 * that ran 25 hours ago has not yet missed anything, and a 26-hour bound catches a genuinely
 * stopped sweep without alarming on a long tick — already comfortably clear of `MAX_TICK`, so it
 * needed no equivalent fix.
 *
 * Keyed by `Duty`, not `string`: a duty added to `pass.ts`'s `ALL_DUTIES` without a budget here is
 * a compile error, and a budget left behind for a retired duty is one too. `pnpm typecheck` is the
 * enforcement — no test can drift out of sync with the map the way a hand-maintained literal can.
 *
 * This bounds against `DEFAULT_MAX_TICK_MS`, not a running instance's actual `WAITRON_MAX_TICK_MS`:
 * this map is a compile-time constant with no access to a booted config. An operator raising
 * `WAITRON_MAX_TICK_MS` at or above `DEFAULT_MAX_TICK_MS + DRAIN_STALE_SLACK_MS` does not silently
 * reintroduce the flap this margin exists to avoid — `boot.ts` (~line 86) enforces the invariant
 * directly against the RUNTIME value and refuses to start: `server.config_invalid` with
 * `reason: "at_or_above_drain_budget"`. Worth stating plainly rather than leaving a reader to
 * assume this map alone is the whole guard.
 */
export const DUTY_BUDGET_MS: Readonly<Record<Duty, number>> = {
  [DRAIN_DUTY]: DEFAULT_MAX_TICK_MS + DRAIN_STALE_SLACK_MS,
  [RECONCILE_DUTY]: 26 * HOUR_MS,
};

export interface DutyHealth {
  lastOkAt: Date | null;
  consecutiveFailures: number;
  /** The `skipped` count from this duty's most recently RECORDED pass — 0 for a clean sweep or a
   * duty that threw before it could count anything, otherwise `DutyReport.skipped` verbatim. Kept
   * so `/health`'s body can show WHY a duty reads unhealthy without an operator going to the logs
   * for it — spec §9: "a `503` is what turns up-but-stuck into a signal an uptime check can see." */
  skipped: number;
  /** The `parked` count from this duty's most recently RECORDED pass — mirrors `skipped` exactly
   * (see `DutyReport.parked`'s own doc comment, pass.ts): 0 for a clean sweep, a duty that threw
   * before it could count anything, or `fiscal.drain` (which has no run-level terminal outcome at
   * all — pass.ts's own comment on its `drain.complete` line), otherwise `DutyReport.parked`
   * verbatim. */
  parked: number;
}

export interface HealthState {
  startedAt: Date;
  lastPassAt: Date | null;
  duties: Record<string, DutyHealth>;
}

/**
 * Every duty starts with `lastOkAt: null`, which reads as stale — so a host that has booted and not
 * yet passed reports 503. That is deliberate: a process that has never submitted is not healthy
 * merely because it is young, and a supervisor that treats "up" as "working" would never learn.
 */
export function createHealthState(startedAt: Date): HealthState {
  const duties: Record<string, DutyHealth> = {};
  for (const duty of ALL_DUTIES) {
    duties[duty] = { lastOkAt: null, consecutiveFailures: 0, skipped: 0, parked: 0 };
  }
  return { startedAt, lastPassAt: null, duties };
}

/** What `recordPass` just recorded for one duty, returned so a caller can log it at a level the
 * FRESH failure count supports. `pass.ts` cannot do this itself: it emits its lines before
 * `recordPass` runs, so the count it could see is always the previous pass's. */
export interface DutyRecord {
  duty: string;
  consecutiveFailures: number;
  skipped: number;
  parked: number;
  stale: boolean;
  lastOkAt: Date | null;
  /**
   * `ok: false`, OR `ok: true` with `skipped > 0` or `parked > 0` — computed HERE and returned
   * rather than re-derived at the logging site, because it is already the condition deciding
   * whether `lastOkAt` advances below. One expression, so the log line and the `/health` verdict
   * cannot disagree about what "degraded" means.
   */
  degraded: boolean;
}

/**
 * C2: a per-tenant skip is treated as the duty FAILING this pass, even though `DutyReport.ok` is
 * `true` for it — `attempt` (pass.ts) only ever sets `ok: false` on a THROW, so a `drain` or
 * `runDue` call that returned normally with tenants in its `skipped` list still reports `ok: true`.
 * Before this function read `entry.skipped`, that meant `lastOkAt` refreshed and
 * `consecutiveFailures` reset on a pass that left a tenant's fiscal obligation unsubmitted — the
 * exact "up-but-stuck reads as healthy" gap spec §6 calls "the one place the absence of
 * configuration is itself the finding", closed here by NOT treating `ok: true, skipped > 0` as a
 * success.
 *
 * A pre-merge review found the IDENTICAL gap one duty over, on the money path: `runDue`
 * (`@waitron/scheduler`) parks a reconcile run after `maxAttempts`, which writes
 * `next_attempt_at = null` and never claims that (tenant, duty, period) again — terminal, exactly
 * like a skipped pair, but recorded in `TickResult.ran` rather than `.skipped`, with `ok: true`
 * for the identical reason (a park is not an infrastructure failure mid-sweep; the duty ran and
 * lost every attempt). `duty.parked` is read the same way `duty.skipped` is, for the same reason —
 * `ok: true, parked > 0` must not read as a success either, or a permanently abandoned
 * settlement-audit period would refresh `lastOkAt` forever.
 *
 * `duty.parked` deliberately does NOT fold in `outcome: "failed"` runs (`DutyReport.parked`'s own
 * doc comment excludes them for the same reason) — those still have a `next_attempt_at` and are
 * retried on their own backoff, so flipping health on one would make an ordinary transient retry
 * produce the same 503 as a genuine, permanent abandonment: exactly the false-alarm noise that
 * would make the one real signal here easy to ignore.
 *
 * The consequence, stated rather than left for a reader to wonder about: if tenant A's work
 * submits fine this pass and tenant B's is skipped (or a reconcile period of B's is parked), the
 * WHOLE duty reads not-ok — including for A, who was served. That is correct, not an oversight:
 * the host is failing its obligation for B, `/health` models one boolean per DUTY (spec §9's
 * shape), and per-tenant health is not something this endpoint represents at all. A 503 here means
 * "at least one tenant's fiscal submission is not being met" (or, for reconcile, "at least one
 * settlement-audit period has been permanently abandoned"), never "nothing is happening."
 *
 * Returns one `DutyRecord` per entry in `report.duties` — what this call just recorded for it,
 * including the SAME `degraded` this function used to decide whether `lastOkAt` advances above.
 * This is what lets `logDegradedDuties` log at a level the fresh failure count supports: `pass.ts`
 * emits its own lines before this function ever runs, so the count it could read would always be
 * the previous pass's, never this one's (see this module's own header comment, and spec §9).
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
 * One line per degraded duty, at a level derived from STALENESS rather than from the
 * consecutive-failure count — an amendment to spec §9, which named the count.
 *
 * A count threshold means a different amount of elapsed time at a different retry cadence: three
 * consecutive failures is fifteen minutes at a five-minute skip retry and three hours at an hourly
 * one, so "three" would silently mean two different things depending on `WAITRON_SKIP_RETRY_MS`.
 * `stale` is time-based and is ALREADY the criterion `/health` returns 503 on, so deriving the
 * level from it makes an `error` line and a 503 the same condition by construction instead of two
 * thresholds that can disagree about whether this host is in trouble. The count still ships in the
 * payload; it just does not decide anything.
 *
 * Consequence, stated rather than left to be discovered: a duty that fails on the FIRST pass after
 * boot logs `error`, because `lastOkAt === null` reads as stale. That is the same instant
 * `/health` starts answering 503 for it — the two agree, which is the point.
 *
 * No `errorCode`: `duty.failed` (pass.ts) already carries the throw's code at the moment it
 * happened, and a skip-only degradation has no duty-level code to report at all.
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

/**
 * `state.duties` is keyed by plain `string` because a runtime `PassReport` can legitimately name a
 * duty `Duty` doesn't know about — that is the case `isStale`'s "no budget → stale" branch exists
 * for. This is the one place that crosses back from that open string universe into the closed,
 * compile-checked `DUTY_BUDGET_MS` map, so the cast is deliberate: `undefined` is the correct and
 * expected result for a name outside `Duty`, not a defect in the lookup.
 */
function budgetFor(name: string): number | undefined {
  return (DUTY_BUDGET_MS as Readonly<Record<string, number>>)[name];
}

function isStale(duty: DutyHealth, budgetMs: number | undefined, now: Date): boolean {
  // A duty with no declared budget is stale on principle, not exempt: this route exists to be
  // fail-VISIBLE, and a duty that arrives here without an entry in DUTY_BUDGET_MS is exactly the
  // "nobody told this endpoint about it" case that must not read as healthy. It stays stale until
  // someone declares a budget for it — the loud failure that announces the omission.
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
    },
  };
}

/** The ONLY route this cycle: no metrics, no readiness/liveness split, no auth, no webhook. The
 * webhook cycle attaches to this app rather than creating a second one. */
export function healthApp(state: HealthState, now: () => Date): Hono {
  const app = new Hono();
  app.get("/health", (c) => {
    const snapshot = healthSnapshot(state, now());
    return c.json(snapshot.body, snapshot.ok ? 200 : 503);
  });
  return app;
}
