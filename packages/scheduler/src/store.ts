import { and, asc, eq, gte, inArray, lt, notInArray, or, sql, type AnyColumn } from "drizzle-orm";
import { isUniqueViolation, type Transaction } from "@waitron/db";
import type { TenantId } from "@waitron/shared";
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

/**
 * Renders a `timestamp with time zone` column as ISO-8601 text, e.g. `2026-07-24T01:00:00+01:00`,
 * instead of Postgres's native `2026-07-24 01:00:00+01` (space-separated, no `T`). Plain column
 * selection hands back that native rendering — `LedgerRow`'s and `ClaimedRun`'s own doc comments
 * promise ISO strings, and `to_json(col) #>> '{}'` is what makes that literally true rather than a
 * claim callers have to trust. `new Date(...)` parses either rendering correctly, so nothing
 * downstream depended on the native form; this only fixes what the TYPE says the value looks like.
 */
function isoText(column: AnyColumn) {
  return sql<string>`to_json(${column}) #>> '{}'`;
}

/** As `isoText`, for a column (or aggregate expression) that can genuinely be SQL NULL —
 * `to_json(NULL) #>> '{}'` renders NULL, not the string `"null"`, so the nullability is real. */
function isoTextOrNull(column: AnyColumn) {
  return sql<string | null>`to_json(${column}) #>> '{}'`;
}

const CLAIMED = {
  id: scheduledRuns.id,
  periodFrom: isoText(scheduledRuns.periodFrom),
  periodTo: isoText(scheduledRuns.periodTo),
  generation: scheduledRuns.generation,
  attempts: scheduledRuns.attempts,
  // Never null here: every statement that selects via CLAIMED sets started_at in the same
  // statement (claimGap on insert, claimRow/reclaimStale on update).
  startedAt: isoText(scheduledRuns.startedAt),
} as const;

/**
 * Everything derivation needs about one (tenant, duty).
 *
 * The row read spans two ranges deliberately (see `LedgerSnapshot`): at-or-above the horizon start,
 * OR non-terminal at any age, so a re-sweep chain older than the horizon stays claimable. The
 * below-horizon MISSING-day count would be an unbounded read, so it is aggregated in SQL instead.
 *
 * The explicit tenant predicate scopes the read to the requested tenant.
 */
export async function readSnapshot(
  tx: Transaction,
  params: { tenantId: TenantId; duty: string; horizonStart: Date },
): Promise<LedgerSnapshot> {
  const horizon = params.horizonStart.toISOString();
  const scope = and(
    eq(scheduledRuns.tenantId, params.tenantId),
    eq(scheduledRuns.duty, params.duty),
  );

  const rows = await tx
    .select({
      id: scheduledRuns.id,
      periodFrom: isoText(scheduledRuns.periodFrom),
      periodTo: isoText(scheduledRuns.periodTo),
      generation: scheduledRuns.generation,
      state: scheduledRuns.state,
      attempts: scheduledRuns.attempts,
      nextAttemptAt: isoTextOrNull(scheduledRuns.nextAttemptAt),
      startedAt: isoTextOrNull(scheduledRuns.startedAt),
    })
    .from(scheduledRuns)
    .where(
      and(
        scope,
        // `notInArray`'s column overload takes a mutable array, unlike `inArray`'s — no
        // `ReadonlyArray` overload exists for it in drizzle-orm 0.45. `TERMINAL` stays `readonly`
        // (it is derivation's own invariant list, shared rather than duplicated per Resolution 3),
        // so it is copied here rather than widened at its declaration.
        or(gte(scheduledRuns.periodFrom, horizon), notInArray(scheduledRuns.state, [...TERMINAL])),
      ),
    )
    .orderBy(asc(scheduledRuns.periodFrom));

  const [bounds] = await tx
    .select({
      // `min()` over zero rows is SQL NULL — the "duty has never run" case — and `to_json` renders
      // that as NULL too (not the string "null"), so `?? null` below is a real fallback, not dead
      // code papering over a lie.
      earliest: sql<string | null>`to_json(min(${scheduledRuns.periodFrom})) #>> '{}'`,
      below: sql<number>`count(distinct ${scheduledRuns.periodFrom}) filter (where ${scheduledRuns.periodFrom} < ${horizon})`,
    })
    .from(scheduledRuns)
    .where(scope);

  return {
    // No cast: the `select({...})` above already produces exactly `LedgerRow`, and a cast at this
    // boundary would silently absorb a dropped or renamed column — the one place derivation's
    // purity depends on the read being complete. If this ever stops compiling, that is the read
    // and the type having parted company, which is information worth failing on.
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
  params: { tenantId: TenantId; duty: string; period: RunPeriod; now: Date },
): Promise<ClaimedRun | null> {
  const [row] = await tx
    .insert(scheduledRuns)
    .values({
      tenantId: params.tenantId,
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
 * Claim an existing `pending` or `failed` row. Retry and re-sweep differ only in which state the
 * row arrived in, so they share ONE statement rather than one being a widening of the other.
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
      // row is not. Leaving the claimed row's old backoff in place would falsify the invariant its
      // own schema comment states ("Null unless `pending` or `failed`") and hand a stale time to
      // anything reading the column directly — an operational query today, and a `nextDueAt`-shaped
      // duty kind's derivation tomorrow. `derive` is unaffected either way: it dispatches on
      // `running` before it ever reads `next_attempt_at`. `claimGap` inserts null, and
      // `reclaimStale` only ever touches rows that are already `running`, so this is the one write
      // that could leave a stale value.
      nextAttemptAt: null,
      updatedAt: sql`now()`,
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
 * Reclaim a `running` row stranded by a crashed process. Its own statement, NOT `claimRow`'s:
 * that one matches `pending`/`failed`, and a stranded row is `running`. Without this a crash locks
 * that period for ever, and no gap reveals it because the row exists.
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
      updatedAt: sql`now()`,
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
 * `state = 'running' AND started_at = <the claim's own startedAt>`, not just `id`: `reclaimStale`
 * exists precisely because a `running` row can be stranded, and a reclaim cannot tell a dead
 * process from a merely hung one apart. Sequence this guards against: A claims (`started_at` =
 * T1); A hangs past `staleAfterMs`; B reclaims (bumps `attempts`, sets `started_at` = T2, `state`
 * stays `running`); A wakes up and calls `completeRun` with its own (now stale) T1. Without the
 * fence, A's outcome would land on the row B is still executing, and `summary` — the duty's own
 * durable result, e.g. payments reconcile's `remediationFailures` — would belong to the wrong
 * attempt.
 *
 * Returns whether THIS call's outcome actually won the fence, so a losing completion is
 * observable — matching the returning-checked contract every other write in this file uses —
 * rather than silently discarded.
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
      updatedAt: sql`now()`,
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
 * Guarded and idempotent. A successor is inserted only when that (tenant, duty, period_from) has
 * NO row at any generation in a non-terminal state — anything outside derivation's own `TERMINAL`
 * list, so a `failed` row awaiting its own retry blocks it too. The caller runs this in the SAME
 * transaction as `completeRun`, so the guard sees the run that is finishing as already terminal.
 *
 * Two racing enqueues collide on `scheduled_runs_key`; the loser treats the violation as "already
 * enqueued". The chain stays LINEAR — one unresolved finding cannot fan out into an exponential
 * number of rows.
 *
 * Returns whether it inserted.
 */
export async function enqueueSuccessor(
  tx: Transaction,
  params: { tenantId: TenantId; duty: string; period: RunPeriod; dueAt: Date },
): Promise<boolean> {
  const periodFrom = params.period.from.toISOString();
  const scope = and(
    eq(scheduledRuns.tenantId, params.tenantId),
    eq(scheduledRuns.duty, params.duty),
    eq(scheduledRuns.periodFrom, periodFrom),
  );

  const [state] = await tx
    .select({
      // The SAME `TERMINAL` list `readSnapshot` and `derive` key on, embedded as a drizzle
      // predicate rather than restated as literal SQL. Add a terminal state one day and a
      // hardcoded `not in ('succeeded', 'parked')` here would still read a live row as finished
      // and insert a successor alongside it, breaking the linear-chain invariant the whole
      // re-sweep design turns on — with derivation and the snapshot read having already moved on.
      unfinished: sql<number>`count(*) filter (where ${notInArray(scheduledRuns.state, [...TERMINAL])})`,
      highest: sql<number>`coalesce(max(${scheduledRuns.generation}), -1)`,
    })
    .from(scheduledRuns)
    .where(scope);

  if (state === undefined || Number(state.unfinished) > 0) return false;

  try {
    await tx.insert(scheduledRuns).values({
      tenantId: params.tenantId,
      duty: params.duty,
      periodFrom,
      periodTo: params.period.to.toISOString(),
      generation: Number(state.highest) + 1,
      state: "pending",
      attempts: 0,
      nextAttemptAt: params.dueAt.toISOString(),
    });
    return true;
  } catch (error) {
    // A concurrent enqueue computed the same generation and got there first. Same fact, not an
    // error: the successor exists.
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}
