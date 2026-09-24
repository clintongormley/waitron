import { and, asc, eq, gte, inArray, lt, notInArray, or, sql } from "drizzle-orm";
import { isUniqueViolation, nowIso, type Transaction } from "@waitron/db";
import { TERMINAL, type LedgerSnapshot } from "./derive.js";
import type { RunPeriod } from "./duty.js";
import { scheduledRuns, type RunState } from "./schema/scheduled-runs.js";

/** A row this runner now owns. Returned only by a claim that actually won. `startedAt` is what
 * `completeRun`'s ownership fence keys on — carried here so the caller never has to re-read it. */
export interface ClaimedRun {
  id: string;
  periodFrom: string;
  periodTo: string;
  generation: number;
  attempts: number;
  startedAt: string;
}

const CLAIMED = {
  id: scheduledRuns.id,
  periodFrom: scheduledRuns.periodFrom,
  periodTo: scheduledRuns.periodTo,
  generation: scheduledRuns.generation,
  attempts: scheduledRuns.attempts,
  // Never null here: every statement that selects via CLAIMED sets started_at in the same
  // statement. The COLUMN is nullable, so selecting it plainly would infer `string | null`.
  startedAt: sql<string>`${scheduledRuns.startedAt}`,
} as const;

/** Everything derivation needs about one duty; `LedgerSnapshot` says why the row read spans two
 * ranges and the below-horizon count is aggregated in SQL. */
export async function readSnapshot(
  tx: Transaction,
  params: { duty: string; horizonStart: Date },
): Promise<LedgerSnapshot> {
  const horizon = params.horizonStart.toISOString();
  const scope = eq(scheduledRuns.duty, params.duty);

  const rows = await tx
    .select({
      id: scheduledRuns.id,
      periodFrom: scheduledRuns.periodFrom,
      periodTo: scheduledRuns.periodTo,
      generation: scheduledRuns.generation,
      state: scheduledRuns.state,
      attempts: scheduledRuns.attempts,
      nextAttemptAt: scheduledRuns.nextAttemptAt,
      startedAt: scheduledRuns.startedAt,
    })
    .from(scheduledRuns)
    .where(
      and(
        scope,
        // Copied: `notInArray`'s column overload refuses a readonly array, unlike `inArray`'s.
        or(gte(scheduledRuns.periodFrom, horizon), notInArray(scheduledRuns.state, [...TERMINAL])),
      ),
    )
    .orderBy(asc(scheduledRuns.periodFrom));

  const [bounds] = await tx
    .select({
      // NULL when the duty has never run.
      earliest: sql<string | null>`min(${scheduledRuns.periodFrom})`,
      below: sql<number>`count(distinct ${scheduledRuns.periodFrom}) filter (where ${scheduledRuns.periodFrom} < ${horizon})`,
    })
    .from(scheduledRuns)
    .where(scope);

  return {
    // No cast: a cast here would silently absorb a dropped or renamed column.
    rows,
    earliestPeriodFrom: bounds?.earliest ?? null,
    recordedBelowHorizon: Number(bounds?.below ?? 0),
  };
}

/**
 * Claim a gap by INSERTING its row. The insert IS the lock: two runners deriving the same gap
 * collide on `scheduled_runs_key`, and exactly one gets a row back. No read-then-write, so there
 * is no window between checking and claiming.
 */
export async function claimGap(
  tx: Transaction,
  params: { duty: string; period: RunPeriod; now: Date },
): Promise<ClaimedRun | null> {
  const [row] = await tx
    .insert(scheduledRuns)
    .values({
      duty: params.duty,
      periodFrom: params.period.from.toISOString(),
      periodTo: params.period.to.toISOString(),
      generation: 0,
      state: "running",
      attempts: 1,
      startedAt: params.now.toISOString(),
    })
    .onConflictDoNothing()
    .returning(CLAIMED);
  return row ?? null;
}

/**
 * Claim an existing `pending` or `failed` row: retry and re-sweep share ONE statement.
 * Single-statement conditional UPDATE, returning-checked: exactly one concurrent runner wins.
 */
export async function claimRow(
  tx: Transaction,
  params: { id: string; now: Date },
): Promise<ClaimedRun | null> {
  const now = params.now.toISOString();
  const [row] = await tx
    .update(scheduledRuns)
    .set({
      state: "running",
      attempts: sql`${scheduledRuns.attempts} + 1`,
      startedAt: now,
      // Cleared, not carried: the column means "when this row becomes claimable", and a running
      // row is not.
      nextAttemptAt: null,
      updatedAt: nowIso(),
    })
    .where(
      and(
        eq(scheduledRuns.id, params.id),
        inArray(scheduledRuns.state, ["pending", "failed"]),
        // Inclusive: a row due at exactly `now` is claimable. `lt()` would silently defer it by a
        // whole tick, and `derive` uses `<=` — the two must agree or the runner derives work it
        // then refuses to claim.
        sql`${scheduledRuns.nextAttemptAt} <= ${now}`,
      ),
    )
    .returning(CLAIMED);
  return row ?? null;
}

/**
 * Reclaim a `running` row stranded by a crashed process. Without this a crash locks that period
 * for ever, and no gap reveals it because the row exists.
 */
export async function reclaimStale(
  tx: Transaction,
  params: { id: string; now: Date; staleAfterMs: number },
): Promise<ClaimedRun | null> {
  const now = params.now.toISOString();
  const cutoff = new Date(params.now.getTime() - params.staleAfterMs).toISOString();
  const [row] = await tx
    .update(scheduledRuns)
    .set({
      attempts: sql`${scheduledRuns.attempts} + 1`,
      startedAt: now,
      updatedAt: nowIso(),
    })
    .where(
      and(
        eq(scheduledRuns.id, params.id),
        eq(scheduledRuns.state, "running"),
        lt(scheduledRuns.startedAt, cutoff),
      ),
    )
    .returning(CLAIMED);
  return row ?? null;
}

/**
 * Record the outcome of a claimed run — but only for the SAME attempt that claimed it. Fenced on
 * `state = 'running' AND started_at = <the claim's own startedAt>`, not just `id`: a reclaim cannot
 * tell a dead process from a merely hung one. A claims (`started_at` = T1) and hangs past
 * `staleAfterMs`; B reclaims (`started_at` = T2); A wakes and completes with T1. Without the fence,
 * A's outcome would land on the row B is still executing.
 *
 * Returns whether THIS call's outcome won the fence.
 */
export async function completeRun(
  tx: Transaction,
  params: {
    id: string;
    startedAt: string;
    state: Extract<RunState, "succeeded" | "failed" | "parked">;
    summary: Record<string, unknown> | null;
    errorCode: string | null;
    nextAttemptAt: Date | null;
    now: Date;
  },
): Promise<boolean> {
  const [row] = await tx
    .update(scheduledRuns)
    .set({
      state: params.state,
      summary: params.summary,
      errorCode: params.errorCode,
      nextAttemptAt: params.nextAttemptAt?.toISOString() ?? null,
      finishedAt: params.now.toISOString(),
      updatedAt: nowIso(),
    })
    .where(
      and(
        eq(scheduledRuns.id, params.id),
        eq(scheduledRuns.state, "running"),
        eq(scheduledRuns.startedAt, params.startedAt),
      ),
    )
    .returning({ id: scheduledRuns.id });
  return row !== undefined;
}

/**
 * Enqueue the next generation of one period, due at `dueAt`.
 *
 * Guarded and idempotent. A successor is inserted only when that (duty, period_from) has
 * NO row at any generation in a non-terminal state — anything outside derivation's own `TERMINAL`
 * list, so a `failed` row awaiting its own retry blocks it too. The caller runs this in the SAME
 * transaction as `completeRun`, so the guard sees the run that is finishing as already terminal.
 * The chain stays LINEAR — one unresolved finding cannot fan out into an exponential number of
 * rows. A unique violation on `scheduled_runs_key` is read as "already enqueued".
 *
 * Returns whether it inserted.
 */
export async function enqueueSuccessor(
  tx: Transaction,
  params: { duty: string; period: RunPeriod; dueAt: Date },
): Promise<boolean> {
  const periodFrom = params.period.from.toISOString();
  const scope = and(eq(scheduledRuns.duty, params.duty), eq(scheduledRuns.periodFrom, periodFrom));

  const [state] = await tx
    .select({
      // The SAME `TERMINAL` list `readSnapshot` and `derive` key on, not restated as literal SQL
      // that a new terminal state would leave behind.
      unfinished: sql<number>`count(*) filter (where ${notInArray(scheduledRuns.state, [...TERMINAL])})`,
      highest: sql<number>`coalesce(max(${scheduledRuns.generation}), -1)`,
    })
    .from(scheduledRuns)
    .where(scope);

  if (state === undefined || Number(state.unfinished) > 0) return false;

  try {
    // The adapter's nested `tx.transaction` is a savepoint. Its body is one insert, which SQLite
    // backs out by itself when refused, leaving the transaction usable, so today it changes nothing
    // (`bench/sqlite-failover/README.md` → "What S5 measures, and the savepoint it does not need").
    await tx.transaction(async (attempt) => {
      await attempt.insert(scheduledRuns).values({
        duty: params.duty,
        periodFrom,
        periodTo: params.period.to.toISOString(),
        generation: Number(state.highest) + 1,
        state: "pending",
        attempts: 0,
        nextAttemptAt: params.dueAt.toISOString(),
      });
    });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}
