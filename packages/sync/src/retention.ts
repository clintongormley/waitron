// Bounded sync_log retention, per-subscriber lag, explicit eviction, and the scheduled retention
// sweep, for the commercial-lane outbox.
//
// app_user reads and prunes the database's log and cursors.
//
// Retention alone is deliberately NOT enough to release the log past a truly-dead subscriber:
// pruneSyncLog holds the log at the slowest subscriber's cursor, alive or down. Declaring a
// subscriber dead and DELETEing its sync_cursor row is `evictSubscriber` below — an EXPLICIT operator
// action, NEVER automatic (spec §3.4, an inherited owner decision): "slow" and "dead" are
// indistinguishable from the log, so a human independently confirms the node is gone before invoking
// it.
//
// This file now provides four things: the bounded prune (pruneSyncLog), the per-subscriber lag signal
// (lagFor), the explicit eviction verb (evictSubscriber), and the scheduled loop boot runs
// (runRetentionSweep) — which each tick prunes and alarms a subscriber past a lag threshold, but
// NEVER evicts and NEVER filters the prune by `alive`. The alarm INFORMS a manual eviction; it never
// triggers one.

import { sql } from "drizzle-orm";
import { type Database, type Transaction } from "@waitron/db";

export interface PruneResult {
  /** How many `sync_log` rows the prune deleted (0 when nothing is eligible or there are no
   * subscribers). A first prune of a backlog and a re-prune of the same drained state differ visibly
   * in this number (CLAUDE.md §1). */
  pruned: number;
  /** The lowest per-origin retention boundary: `min(last_applied_seq)` across ALL `sync_cursor` rows.
   * Every `sync_log` row at or below its origin's own min was deleted; this reports the smallest such
   * min across origins (for the single-origin case it IS that origin's min). `0n` when there are no
   * subscribers. */
  highWater: bigint;
}

export interface SubscriberLag {
  /** The subscriber half of the `sync_cursor` key. */
  subscriberId: string;
  /** The origin half — which producing node this lag is measured against. */
  originId: string;
  /** `origin max(seq) − last_applied_seq`: how many of this origin's captured rows the subscriber has
   * not yet applied. A threshold over this is the `sync.stream_stalled` signal (design §9); whether
   * to alarm or evict is §12 ops-policy, out of scope here — this only reports the number. `bigint`,
   * not `number`: a far-behind subscriber can push this past 2^53−1, and narrowing to a JS `number`
   * there loses precision — so it stays a `bigint` (matching `PruneResult.highWater`) until a
   * threshold/UI edge narrows it under a safe bound. */
  lag: bigint;
  /** The `sync_cursor.alive` flag. Metadata for alarm reporting only — it is NOT a filter on the
   * prune. A down-but-present subscriber (`alive=false`) still HOLDS the log at its cursor; the min
   * pruneSyncLog takes is across ALL rows, alive or not (findings GATE 7 — filtering the min to alive
   * subscribers IS the data-loss bug). */
  alive: boolean;
}

/**
 * Deletes every `sync_log` row that every subscriber of its origin has already applied, holding the
 * log at the slowest subscriber's cursor so a down subscriber loses nothing (findings GATE 7).
 *
 * The boundary is per origin: for each origin, `min(last_applied_seq)` across ALL its `sync_cursor`
 * rows (alive or down), and rows with `seq <= that min` are deleted. An origin nobody subscribes to
 * matches no cursor group and is never pruned; an origin whose subscribers are all caught up drains
 * fully. Runs through app_user's SELECT and DELETE grants.
 *
 * **No subscribers → no prune.** With an empty `sync_cursor` the min is undefined: nothing has
 * confirmed a single row, so deleting anything would be data loss. That case short-circuits to
 * `{ pruned: 0, highWater: 0n }` and never runs the DELETE (the per-origin join would also match
 * nothing, but the guard states the decision explicitly).
 */
export async function pruneSyncLog(db: Database): Promise<PruneResult> {
  // The lowest boundary across all origins is the global min last_applied_seq (min of the per-origin
  // mins). `min()` over an empty table returns one row whose value is NULL — the no-subscribers case.
  const hw = await db.execute<{ min_all: string | null }>(
    sql`select min(last_applied_seq)::text as min_all from sync_cursor`,
  );
  const minAll = hw.rows[0]!.min_all;
  if (minAll === null) return { pruned: 0, highWater: 0n };

  // Per-origin prune: each origin's rows are held only by that origin's own subscribers, so an origin
  // still needed by a laggard is not released because a DIFFERENT origin caught up. `.execute` exposes
  // `.rows` but not pg's `.rowCount` (packages/db/src/client.ts), so `returning seq` makes the deleted
  // count readable off `.rows.length`.
  const deleted = await db.execute(
    sql`delete from sync_log sl
        using (
          select origin_id, min(last_applied_seq) as min_seq
          from sync_cursor
          group by origin_id
        ) c
        where sl.origin_id = c.origin_id and sl.seq <= c.min_seq
        returning sl.seq`,
  );
  return { pruned: deleted.rows.length, highWater: BigInt(minAll) };
}

/**
 * Reports each `(subscriber, origin)` pair's lag — `origin max(seq) − last_applied_seq` — plus its
 * `alive` flag, worst-lagging first. A drained/empty origin (no `sync_log` rows) reads lag 0 via the
 * LEFT JOIN's `coalesce`, never negative. Reporting only — no threshold, no throw (§12 ops-policy).
 *
 * app_user reads the database's log and cursors. Accepts a Transaction as well as a Database so
 * callers can compose this read with their transaction; both expose execute.
 */
export async function lagFor(db: Database | Transaction): Promise<SubscriberLag[]> {
  const result = await db.execute<{
    subscriber_id: string;
    origin_id: string;
    lag: string;
    alive: boolean;
  }>(sql`
    select
      c.subscriber_id,
      c.origin_id::text as origin_id,
      (coalesce(m.max_seq, c.last_applied_seq) - c.last_applied_seq)::text as lag,
      c.alive
    from sync_cursor c
    left join (
      select origin_id, max(seq) as max_seq
      from sync_log
      group by origin_id
    ) m on m.origin_id = c.origin_id
    order by (coalesce(m.max_seq, c.last_applied_seq) - c.last_applied_seq) desc, c.subscriber_id
  `);
  return result.rows.map((row) => ({
    subscriberId: row.subscriber_id,
    originId: row.origin_id,
    // Read as text and kept as a `bigint` (matching `PruneResult.highWater`) — never narrowed to a
    // JS `number` here: `origin max(seq) − last_applied_seq` can exceed 2^53−1 for a subscriber
    // astronomically far behind, and `Number()` would silently lose precision at that point. The SQL
    // ORDER BY sorts on the bigint expression, so worst-first ordering is unaffected.
    lag: BigInt(row.lag),
    alive: row.alive,
  }));
}

/**
 * Releases a genuinely-dead subscriber by DELETEing all its `sync_cursor` rows (every origin, every
 * lane), so `pruneSyncLog`'s per-origin `min(last_applied_seq)` no longer includes it and the next
 * sweep advances the log past its position. Uses app_user's DELETE grant on sync_cursor.
 *
 * EXPLICIT, NEVER AUTOMATIC (spec §3.4, an inherited owner decision): "slow" and "dead" are
 * indistinguishable from the log, so an operator invokes this only after independently confirming
 * the node is gone — auto-evicting a slow-but-alive node is silent, unrecoverable data loss. Nothing
 * in this package calls it on a timer; `runRetentionSweep` never does. `.execute` exposes `.rows`
 * not pg's `.rowCount` (client.ts), so `returning subscriber_id` makes the count readable.
 */
export async function evictSubscriber(
  db: Database,
  subscriberId: string,
): Promise<{ deleted: number }> {
  const deleted = await db.execute(
    sql`delete from sync_cursor where subscriber_id = ${subscriberId} returning subscriber_id`,
  );
  return { deleted: deleted.rows.length };
}

export interface RetentionSweepDeps {
  /** A LOGIN pool inheriting app_user for log and cursor access. */
  db: Database;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
  /** Idle interval between prunes (WAITRON_SYNC_RETENTION_TICK_MS). */
  tickMs: number;
  log: (level: "info" | "warn" | "error", code: string, params?: Record<string, unknown>) => void;
  /** Optional: emit the retention-variant sync.stream_stalled for any subscriber whose lag exceeds
   * this many rows — the operator signal that INFORMS a manual eviction (never triggers one). */
  lagAlarmRows?: number;
  /** Injectable for the loop test; default the real pruneSyncLog / lagFor. */
  prune?: (db: Database) => Promise<PruneResult>;
  lag?: (db: Database) => Promise<SubscriberLag[]>;
}

/**
 * The scheduled retention sweep boot starts (spec §3.2). Each tick prunes the log to the min across
 * every subscriber's (reported) cursor, then reports lag and alarms a stalled subscriber past the
 * threshold. It NEVER evicts and NEVER filters the prune by `alive` — eviction is an explicit
 * operator action (spec §3.4). Abort-checked before each prune and each sleep so close() stops it
 * promptly. Errors are logged and swallowed so a transient DB fault does not kill the sweep.
 */
export async function runRetentionSweep(deps: RetentionSweepDeps): Promise<void> {
  const prune = deps.prune ?? pruneSyncLog;
  const lag = deps.lag ?? lagFor;
  while (!deps.signal.aborted) {
    try {
      const result = await prune(deps.db);
      deps.log("info", "sync.retention_swept", {
        pruned: result.pruned,
        highWater: result.highWater.toString(),
      });
      if (deps.lagAlarmRows !== undefined) {
        const threshold = BigInt(deps.lagAlarmRows);
        for (const s of await lag(deps.db)) {
          if (s.lag > threshold) {
            deps.log("error", "sync.stream_stalled", {
              subscriberId: s.subscriberId,
              originId: s.originId,
              lag: s.lag.toString(), // stringified to preserve precision (a far-behind lag can exceed 2^53−1) and to stay consistent with highWater above (retention.ts lag doc)
            });
          }
        }
      }
    } catch {
      deps.log("warn", "sync.retention_failed", {});
    }
    if (deps.signal.aborted) break;
    await deps.sleep(deps.tickMs, deps.signal);
  }
}
