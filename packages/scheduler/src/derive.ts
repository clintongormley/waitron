import type { RunPeriod } from "./duty.js";
import type { RunState } from "./schema/scheduled-runs.js";

/** A UTC day is a constant width — no DST. That constancy is why the cadence tiles UTC days. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Floor an instant to midnight UTC. */
export function utcDayStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/** The half-open day beginning at `start`. */
export function dayPeriod(start: Date): RunPeriod {
  return { from: start, to: new Date(start.getTime() + DAY_MS) };
}

/**
 * The oldest day the horizon admits: the start of the catch-up window.
 *
 * Exported because TWO places need exactly this instant and they must not be two copies of the
 * expression. `run.ts` passes it to `readSnapshot`, which decides WHICH ROWS derivation gets to
 * see; `derive` below uses it to decide WHICH DAYS count as gaps. Let those drift and derivation
 * reasons about a window it did not read — gaps invented for days whose rows were never fetched,
 * or rows fetched for days no gap loop visits.
 */
export function horizonStartFor(now: Date, horizonDays: number): Date {
  return new Date(utcDayStart(now).getTime() - horizonDays * DAY_MS);
}

/**
 * The latest day whose period has fully elapsed at `now` — the newest period eligible to run.
 *
 * Eligibility is `period_to <= now` and nothing more: there is no settle-grace, because a
 * freshly-closed day cannot produce a false finding. `unsettled` escalates only past the
 * settlement lag; `drift` needs a MATCHED settlement, so one the processor has not posted yet
 * yields nothing rather than a false alarm; `orphan` is local-only; and an unmatched settlement
 * gets a targeted all-time existence check before it can be `missingLocal`.
 */
export function mostRecentCompleteDay(now: Date): Date {
  return new Date(utcDayStart(now).getTime() - DAY_MS);
}

/** The subset of a ledger row derivation reads. Timestamps are ISO-8601 strings — normalised at
 * the read boundary (`store.ts`'s `isoText`/`isoTextOrNull`, via `to_json(col) #>> '{}'`), NOT
 * Postgres's native `timestamptz` rendering (`"2026-07-24 01:00:00+01"`: space-separated, no `T`,
 * and it shifts with the session's `TimeZone`). `new Date(...)` below tolerates either form, but
 * the type says ISO string, so the store makes that true rather than merely convenient. */
export interface LedgerRow {
  id: string;
  periodFrom: string;
  periodTo: string;
  generation: number;
  state: RunState;
  attempts: number;
  nextAttemptAt: string | null;
  startedAt: string | null;
}

/**
 * Everything derivation needs about one (tenant, duty), read in one place so the derivation itself
 * stays pure.
 *
 * `rows` deliberately spans TWO ranges: every row at or above the horizon start (gap derivation
 * needs to know which recent days are already recorded) plus every NON-TERMINAL row at any age (a
 * re-sweep chain older than the horizon must stay claimable). Counting missing days BELOW the
 * horizon would be an unbounded read, so it arrives pre-aggregated as `recordedBelowHorizon`.
 */
export interface LedgerSnapshot {
  rows: LedgerRow[];
  /** `min(period_from)` over ALL rows, or null when the duty has never run. */
  earliestPeriodFrom: string | null;
  /** How many distinct periods below the horizon start have a row. */
  recordedBelowHorizon: number;
}

export interface DeriveConfig {
  horizonDays: number;
  maxPeriodsPerTick: number;
  staleAfterMs: number;
}

/** One unit of due work, tagged by how it was found — which decides which claim statement runs. */
export type DueWork =
  | { kind: "gap"; period: RunPeriod }
  | { kind: "claimable"; row: LedgerRow }
  | { kind: "stale"; row: LedgerRow };

export interface Derivation {
  /** Oldest-first, already capped at `maxPeriodsPerTick`. */
  due: DueWork[];
  /** Due work this tick will not run because of the cap. */
  deferred: number;
  /** Never-swept days dropped permanently by the horizon. */
  beyondHorizon: number;
  /** Earliest FUTURE time work appears, as of the SNAPSHOT this derivation read — necessarily
   * before any duty ran. `runDue` folds in the backoff and re-sweep times its own runs then write,
   * and overrides the whole thing with `now` when work is available immediately (the per-tick cap
   * deferred some, or a (tenant, duty) was skipped). */
  nextDueAt: Date;
}

/** The two states derivation and the store both treat as final. Exported (rather than declared a
 * second time in `store.ts`) so the two agree on what "terminal" means by construction, not by
 * two lists staying in sync by convention. */
export const TERMINAL: readonly RunState[] = ["succeeded", "parked"];

/** Defaults for the whole runner, in one place so a host overrides one without restating the rest. */
export const DEFAULTS = {
  horizonDays: 30,
  maxPeriodsPerTick: 7,
  maxAttempts: 3,
  backoffBaseMs: 15 * 60 * 1000,
  staleAfterMs: 60 * 60 * 1000,
  /**
   * How long after a SKIPPED (tenant, duty) pair `runDue` reports work is due again.
   *
   * Bounded below by not spinning: a skip used to report `now`, which a host sleeping on
   * `nextDueAt` turns into its MIN_TICK floor — 5 seconds, forever, for a pair whose failure only
   * a human can fix. Bounded above by the cadence of the duty being retried: five minutes is
   * twelve attempts inside an hour, so a genuinely transient skip costs minutes of that budget
   * rather than all of it.
   *
   * Lives here rather than in the host because `DEFAULTS` is spread as a COMPLETE `SchedulerDeps`
   * by four test call sites and `apps/server`'s own `pass.rls.test.ts`; a required field withheld
   * from it would make this table silently incomplete.
   */
  skipRetryMs: 5 * 60 * 1000,
} as const;

export function derive(snapshot: LedgerSnapshot, now: Date, config: DeriveConfig): Derivation {
  const newest = mostRecentCompleteDay(now);
  const horizonStart = horizonStartFor(now, config.horizonDays);
  const floor =
    snapshot.earliestPeriodFrom === null ? newest : new Date(snapshot.earliestPeriodFrom);
  const start = new Date(Math.max(floor.getTime(), horizonStart.getTime()));

  const recorded = new Set(snapshot.rows.map((r) => new Date(r.periodFrom).getTime()));
  const gaps: DueWork[] = [];
  for (let t = start.getTime(); t <= newest.getTime(); t += DAY_MS) {
    if (!recorded.has(t)) gaps.push({ kind: "gap", period: dayPeriod(new Date(t)) });
  }

  const nowMs = now.getTime();
  const claimable: DueWork[] = [];
  const stale: DueWork[] = [];
  let earliestFuture = Number.POSITIVE_INFINITY;
  for (const r of snapshot.rows) {
    if (r.state === "running") {
      // startedAt is never null on a `running` row — both claim statements set it — but a null
      // here would mean "stranded with no clock", which must not silently become reclaimable.
      if (r.startedAt !== null && Date.parse(r.startedAt) < nowMs - config.staleAfterMs) {
        stale.push({ kind: "stale", row: r });
      }
      continue;
    }
    if (TERMINAL.includes(r.state) || r.nextAttemptAt === null) continue;
    const due = Date.parse(r.nextAttemptAt);
    if (due <= nowMs) claimable.push({ kind: "claimable", row: r });
    else earliestFuture = Math.min(earliestFuture, due);
  }

  const all = [...gaps, ...claimable, ...stale].sort(
    (a, b) => periodStart(a).getTime() - periodStart(b).getTime(),
  );

  // The next gap appears when today's period closes.
  const nextBoundary = utcDayStart(now).getTime() + DAY_MS;

  let beyondHorizon = 0;
  if (floor.getTime() < horizonStart.getTime()) {
    const daysBelow = Math.round((horizonStart.getTime() - floor.getTime()) / DAY_MS);
    beyondHorizon = daysBelow - snapshot.recordedBelowHorizon;
  }

  return {
    due: all.slice(0, config.maxPeriodsPerTick),
    deferred: Math.max(0, all.length - config.maxPeriodsPerTick),
    beyondHorizon,
    nextDueAt: new Date(Math.min(earliestFuture, nextBoundary)),
  };
}

function periodStart(work: DueWork): Date {
  return work.kind === "gap" ? work.period.from : new Date(work.row.periodFrom);
}
