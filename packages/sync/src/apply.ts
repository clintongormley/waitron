// The commercial-lane apply loop: it takes a peer's captured sync_log rows and writes each one into
// the local mirror as the ordinary, non-superuser app role under `withTenant`, idempotently and in
// `seq` order. This is the application-level apply the FORCE-RLS + non-BYPASSRLS model forces
// (native logical apply is categorically refused — 2026-08-02-replication-force-rls-prototype-findings.md),
// productionised from the container gates (2026-08-06-sync-container-gates-findings.md GATES 2/3/4/8).
//
// The apply worker connects as a LOGIN role that is a member of BOTH `app_user` (INSERT/UPDATE/DELETE
// on the enrolled tables) AND `sync_tailer` (SELECT/INSERT/UPDATE on `sync_cursor`). That membership
// is the sanctioned path — `app_user` is NEVER widened to reach `sync_cursor` (spec §7; CLAUDE.md §3
// "never widen a grant"). Because the role is non-superuser and non-BYPASSRLS, the FORCE-RLS
// `WITH CHECK` on every enrolled table genuinely fences each write to its own tenant.

import { sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { pgErrorCode, readDeploymentEnvironment, withTenant, type Database } from "@waitron/db";
import { ENROLLED, type EnrolledTable, type SyncLane } from "./registry.js";
import { applyStatementFor, deleteStatementFor } from "./apply-sql.js";
// Side-effect import: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable
// from a file that throws `sync.*` codes (packages/shared/src/errors.ts reachability rule).
import "./errors.js";

/**
 * One captured row as it crosses the wire: the `sync_log` tuple a subscriber reads from a source and
 * hands to {@link applyBatch}. `seq` is the source's monotonic sequence (a `bigint`, so it never
 * loses precision the way a JS number would past 2^53); `rowImage` is the verbatim `to_jsonb(row)`
 * the capture trigger wrote (spec §3.3). `txid` is the source transaction the row committed in — it
 * is carried for the future fast-lane/atomic-group slice and is NOT consulted here (see the apply
 * model below).
 */
export interface SyncLogRow {
  seq: bigint;
  originId: string;
  table: string;
  op: "insert" | "update" | "delete";
  tenantId: string;
  /** The verbatim `row_image::text` the capture trigger wrote (spec §3.3), carried as raw `jsonb`
   * TEXT — a STRING, never a parsed object — so a numeric (1.50) is never JS-collapsed to 1.5 on the
   * way through (design §4b). Bound as `$1::jsonb`; JS never JSON.parses it. */
  rowImage: string;
  txid?: string;
}

export interface ApplyBatchOptions {
  /** The stable identity of this mirror as a subscriber — half of the `sync_cursor` key. */
  subscriberId: string;
  /** What environment the caller believes it is running as (from its own config, e.g. `WAITRON_ENV`).
   * Cross-checked against the DB stamp; see the handshake in {@link applyBatch}. */
  localEnvironment: string;
  /** The environment the source peer advertised. Refused if it differs from the local stamp. */
  sourceEnvironment: string;
  /** Which replication lane this batch belongs to — selects the `(subscriber, origin, lane)` cursor
   * rows read, skipped against, and advanced. Optional, defaulting to `"ordered"` (the 0002 column
   * default and the wire's ordered-clamp), so an ordered-lane caller need not name it. */
  lane?: SyncLane;
}

export interface ApplyBatchResult {
  /** Rows whose apply statement actually changed the mirror (a real insert/update/delete). A no-op
   * re-delivery — `ON CONFLICT DO NOTHING`, the watermark `WHERE` guard, a delete of an absent row,
   * or a seq-cursor skip — is NOT counted, so a first delivery (1) and a re-delivery (0) of the same
   * row differ visibly in this number (CLAUDE.md §1). */
  applied: number;
  /** Rows parked at least once on a `23503 foreign_key_violation` — the belt-and-suspenders defer.
   * A parked row that later lands (its parent arrived in the same batch) still counts here. */
  deferred: number;
}

interface OriginProgress {
  /** Seqs that are settled this batch (applied, a no-op, or skipped as already-applied). */
  settled: bigint[];
  /** Seqs still parked on a `23503` — the cursor must not advance past the lowest of these. */
  deferred: Set<bigint>;
}

/**
 * Applies a batch of a peer's captured rows into the local mirror.
 *
 * Behaviour (spec §3; gates 2/3/4/8):
 *  1. **Environment handshake FIRST, before any row applies** (gate 8). The authoritative local
 *     environment is the DB stamp (`deployment.environment`, singleton id=1), read once. The
 *     `localEnvironment` opt is the caller's own belief; it must agree with the stamp, or a
 *     misconfigured caller is refused before anything crosses. A `sourceEnvironment` that differs
 *     from the stamp throws `sync.peer_environment_mismatch` and applies nothing, so a preproduction
 *     stream can never seed a production mirror (the unrecoverable burn in CLAUDE.md §5).
 *  2. Rows are applied in ascending `seq` — a topological order of the FK graph for one origin
 *     (spec §3.6, gate 4). Each row is applied in its OWN `withTenant(subscriberDb, row.tenantId)`
 *     transaction that first sets `app.sync_apply='on'` (the echo guard, spec §3.4) — see the
 *     per-row-transaction note below.
 *  3. Idempotency: an insert-only re-delivery is `ON CONFLICT DO NOTHING`; a watermark table's older
 *     image is the `WHERE excluded.<wm> > <t>.<wm>` no-op; a Group-C row whose `seq <=
 *     last_applied_seq` is skipped by the cursor and a delete of an absent row is a 0-row no-op
 *     (spec §3.2).
 *  4. A `23503 foreign_key_violation` parks the row and it is retried after the rest of the batch
 *     has landed the parent (spec §3.6). No grant is widened and no constraint dropped to make a row
 *     land (CLAUDE.md §3); a parent that never arrives leaves the row parked and the cursor held
 *     below it for a later batch to redeliver (at-least-once).
 *
 * **Per-row transactions, not (origin, txid) groups.** The plan offers grouping contiguous
 * `(originId, txid)` rows into one transaction OR "simply process ascending seq"; this takes the
 * latter. A group transaction cannot host the `23503` defer — a foreign-key violation aborts the
 * whole Postgres transaction, so a parked row could not be retried inside the group it poisoned —
 * and for the single ordered lane every row is independently idempotent and seq-ordered, so
 * source-transaction atomicity buys nothing here (spec §1 defers the fast lane and its atomic
 * groups). The mirror is a failover target that is eventually consistent, not read live mid-sync.
 *
 * **Known constraint for the transport/redelivery slice (not yet built), flagged by the 2026-08-11
 * finish-branch review.** Per-row commit + the cursor held below a gap means a batch that throws a
 * NON-`23503` error mid-way leaves the rows it already committed above the (un-advanced) cursor. When
 * the transport layer later redelivers the below-cursor range at least once, those committed rows are
 * re-applied — and an insert-only re-apply is a clean `ON CONFLICT DO NOTHING` no-op ONLY if no
 * BEFORE trigger rejects it first. Several enrolled tables carry business-rule BEFORE triggers that
 * fire on the apply path and are NOT gated on `app.sync_apply` (`tenders_reject_post_settlement`
 * 0012_sale_settlement.sql:150, `working_orders_enforce_transition` 0004_working_orders.sql:96,
 * `working_order_lines_require_open_parent` 0004:122), so re-applying e.g. a `tenders` row after its
 * `sale_settlements` row has committed raises `WT002` and can wedge the stream. This slice ships only
 * `applyBatch` (a single batch, no redelivery), so it cannot occur here — but the transport slice MUST
 * resolve it: gate those business triggers on `app.sync_apply IS DISTINCT FROM 'on'` so the mirror
 * applies a source's already-validated write verbatim (spec §3.3) rather than re-validating it, or
 * make redelivery finer-grained than the whole below-cursor range.
 */
export async function applyBatch(
  subscriberDb: Database,
  rows: readonly SyncLogRow[],
  opts: ApplyBatchOptions,
): Promise<ApplyBatchResult> {
  // 1. Handshake — the DB stamp is authoritative (gate 8). Every guard precedes the first apply.
  const stamped = await readDeploymentEnvironment(subscriberDb);
  if (stamped === null) {
    throw new Error(
      "applyBatch: the subscriber database carries no deployment.environment stamp; a mirror must " +
        "be environment-stamped before it can accept a peer's rows (CLAUDE.md §5).",
    );
  }
  if (opts.localEnvironment !== stamped) {
    throw new Error(
      `applyBatch: localEnvironment "${opts.localEnvironment}" disagrees with the stamped ` +
        `deployment.environment "${stamped}"; refusing to apply under a contradicted local environment.`,
    );
  }
  if (opts.sourceEnvironment !== stamped) {
    throw new AppError("sync.peer_environment_mismatch", {
      local: stamped,
      peer: opts.sourceEnvironment,
    });
  }

  // 2. Ascending seq is the apply order. `seq` values are distinct integers (a Postgres identity
  //    column), so the sign of their exact bigint difference is a total order; `Number` preserves
  //    that sign (never collapsing a non-zero difference to 0), giving a branchless comparator.
  const ordered = [...rows].sort((a, b) => Number(a.seq - b.seq));

  // 3. The per-(subscriber, origin) cursor for THIS lane, read once. A row whose seq <= its origin's
  //    cursor was applied by a prior batch of the same lane — the Group-C monotonicity skip. The lane
  //    defaults to "ordered" (the 0002 column default and the wire's ordered-clamp), so an ordered
  //    caller need not name it; a fast pull passes lane:"fast" and reads/skips/advances the fast
  //    cursor rows only, disjoint from the ordered lane's (spec §4e).
  const lane: SyncLane = opts.lane ?? "ordered";
  const cursorAtStart = await readCursors(subscriberDb, opts.subscriberId, lane);
  const progress = new Map<string, OriginProgress>();
  const bucket = (originId: string): OriginProgress => {
    let b = progress.get(originId);
    if (b === undefined) {
      b = { settled: [], deferred: new Set() };
      progress.set(originId, b);
    }
    return b;
  };

  let applied = 0;
  let deferred = 0;
  const parked: SyncLogRow[] = [];

  // Records a row's outcome against its origin's progress. Returns true if the row is now settled
  // (so a parked row can be removed from the retry queue), false if it is (still) parked. The single
  // place `applied`/`deferred` are counted, so both passes share one counting site.
  const settleOrPark = (row: SyncLogRow, outcome: number | "deferred"): boolean => {
    const b = bucket(row.originId);
    if (outcome === "deferred") {
      if (!b.deferred.has(row.seq)) deferred += 1; // count a row the first time it is parked only
      b.deferred.add(row.seq);
      return false;
    }
    if (outcome > 0) applied += 1;
    b.deferred.delete(row.seq);
    b.settled.push(row.seq);
    return true;
  };

  // Main pass — seq ascending.
  for (const row of ordered) {
    const cur = cursorAtStart.get(row.originId) ?? 0n;
    if (row.seq <= cur) {
      // Already applied in a prior batch: an idempotent no-op, never re-run (spec §3.2/§3.3).
      bucket(row.originId).settled.push(row.seq);
      continue;
    }
    const outcome = await tryApplyRow(subscriberDb, row);
    if (!settleOrPark(row, outcome)) parked.push(row);
  }

  // Retry pass — a parked child whose parent arrived later in this batch now lands.
  let madeProgress = parked.length > 0;
  while (parked.length > 0 && madeProgress) {
    madeProgress = false;
    for (let i = parked.length - 1; i >= 0; i -= 1) {
      const outcome = await tryApplyRow(subscriberDb, parked[i]!);
      if (settleOrPark(parked[i]!, outcome)) {
        parked.splice(i, 1);
        madeProgress = true;
      }
    }
  }

  // 4. Advance each origin's cursor across seqs settled below EVERY still-parked seq — holding the
  //    cursor below any gap so a later batch redelivers the parked row (at-least-once) — and never
  //    below where it started (monotonic). `every` over an empty deferred set is vacuously true, so
  //    with nothing parked the whole settled set is eligible.
  for (const [originId, b] of progress) {
    const start = cursorAtStart.get(originId) ?? 0n;
    const eligible = b.settled.filter((s) => [...b.deferred].every((d) => s < d));
    const high = eligible.reduce((m, s) => (s > m ? s : m), start);
    if (high > start) await advanceCursor(subscriberDb, opts.subscriberId, originId, lane, high);
  }

  return { applied, deferred };
}

/** A `$1`-bearing statement split into the text before and after the single payload bind. */
interface StatementParts {
  head: string;
  tail: string;
}

/**
 * One enrolled table's apply plumbing, precomputed ONCE at module load. `applyParts` is the
 * insert/update statement already split at the `$1` payload marker with the affected-row RETURNING
 * folded into its tail, so the per-row hot path is a Map lookup and a string interleave rather than a
 * rebuild. That matters for the watermark form, whose statement re-derives the column list from the
 * Drizzle schema (apply-sql.ts) — wasteful to recompute for every row of a batch.
 */
interface Dispatch {
  entry: EnrolledTable;
  applyParts: StatementParts;
}

/**
 * Splits a statement at its single `$1` payload marker and folds in the affected-row `returning 1 as
 * applied`, so a no-op leaves `.rows` empty and a real change returns one row. The `row_image` then
 * binds as that one `$1` (cast `::jsonb`); every identifier around it is a literal from the fixed
 * registry (apply-sql.ts), never runtime-derived, so the CLAUDE.md §3 escaping question does not arise.
 */
function splitStatement(statement: string): StatementParts {
  const marker = statement.indexOf("$1");
  return {
    head: statement.slice(0, marker),
    tail: `${statement.slice(marker + 2)} returning 1 as applied`,
  };
}

// The dispatch table, built once from ENROLLED: 19 entries cover every row of any batch. The delete
// statement is NOT precomputed — deleteStatementFor is a cheap pure-string helper with no column
// derivation, and only DELETE-capable rows ever delete (Group C's working_orders/working_order_lines
// and Group E's webauthn_credentials) — so it is built per delete row in applyOneRow.
const DISPATCH: ReadonlyMap<string, Dispatch> = new Map(
  ENROLLED.map((entry) => [
    entry.table,
    { entry, applyParts: splitStatement(applyStatementFor(entry)) },
  ]),
);

/**
 * Applies one row, returning the affected-row count, or the sentinel `"deferred"` when the write
 * raised `23503 foreign_key_violation` (the only error parked; anything else — a cross-tenant
 * `WITH CHECK` 42501, a check violation — propagates, since it is not an ordering problem a later
 * seq can fix). A row naming a table the registry does not carry has no apply statement, so that is
 * a hard `sync.table_not_enrolled` rather than a silent skip.
 */
async function tryApplyRow(db: Database, row: SyncLogRow): Promise<number | "deferred"> {
  const dispatch = DISPATCH.get(row.table);
  if (dispatch === undefined) throw new AppError("sync.table_not_enrolled", { table: row.table });
  try {
    return await applyOneRow(db, row, dispatch);
  } catch (error) {
    // pgErrorCode reads the SQLSTATE off drizzle's DrizzleQueryError wrapper (.cause.code) — the
    // repo's one canonical reader, reused rather than re-copied (packages/db/src/testing/errors.ts).
    if (pgErrorCode(error) === "23503") return "deferred";
    throw error;
  }
}

/**
 * Runs the row's apply (or delete) statement inside a tenant-scoped, echo-guarded transaction and
 * returns how many rows it changed. The insert/update statement is the precomputed `applyParts`; a
 * delete builds its cheap statement per row (only Group C deletes, no column derivation). The shared
 * `Database.execute` result type exposes `.rows` but NOT pg's `.rowCount` (packages/db/src/client.ts,
 * so both drivers share one type), so the folded-in `returning 1` makes a no-op an empty `.rows` and
 * a real change one row.
 */
async function applyOneRow(db: Database, row: SyncLogRow, dispatch: Dispatch): Promise<number> {
  const parts =
    row.op === "delete" ? splitStatement(deleteStatementFor(dispatch.entry)) : dispatch.applyParts;
  return withTenant(db, row.tenantId, async (tx) => {
    // Echo guard, same transaction as the write: the capture triggers skip a write made under
    // app.sync_apply='on' (spec §3.4), so applying a peer's row does not re-enter our own sync_log.
    await tx.execute(sql`select set_config('app.sync_apply', 'on', true)`);
    // rowImage is the source's raw row_image::text; bind it as the single text param cast `$1::jsonb`.
    // Never JSON.stringify (would double-encode) and never JSON.parse (would collapse a numeric).
    const result = await tx.execute(
      sql`${sql.raw(parts.head)}${row.rowImage}::jsonb${sql.raw(parts.tail)}`,
    );
    return result.rows.length;
  });
}

/**
 * Reads this subscriber's per-origin cursors FOR ONE LANE into a map (missing origins default to 0
 * below). The `and lane = ${lane}` filter is load-bearing (Task 1 Minor review): with the 0002 lane
 * split each `(subscriber, origin)` has up to two cursor rows, and reading both would collapse them
 * to whichever sorts last into the `origin_id`-keyed map — a fast advance would then drag the ordered
 * lane's seq (or vice-versa), the silent data loss spec §4e exists to prevent. `lane` binds as a
 * param (never string-concatenated, CLAUDE.md §3).
 */
async function readCursors(
  db: Database,
  subscriberId: string,
  lane: SyncLane,
): Promise<Map<string, bigint>> {
  const result = await db.execute<{ origin_id: string; last_applied_seq: string }>(
    sql`select origin_id::text as origin_id, last_applied_seq::text as last_applied_seq
        from sync_cursor where subscriber_id = ${subscriberId} and lane = ${lane}`,
  );
  const cursors = new Map<string, bigint>();
  // bigint columns come back as strings from node-postgres (a JS number would lose precision), so
  // parse via BigInt rather than Number.
  for (const r of result.rows) cursors.set(r.origin_id, BigInt(r.last_applied_seq));
  return cursors;
}

/**
 * Upserts this subscriber's cursor for one origin to `seq`. The `WHERE excluded.last_applied_seq >
 * sync_cursor.last_applied_seq` guard makes the write monotonic even against a concurrent advance —
 * a cursor never moves backward. Written by the `sync_tailer` grants the apply role holds through
 * membership (spec §7), never a widened `app_user`.
 */
async function advanceCursor(
  db: Database,
  subscriberId: string,
  originId: string,
  lane: SyncLane,
  seq: bigint,
): Promise<void> {
  await db.execute(
    // The ON CONFLICT arbiter is the 0002 PK (subscriber_id, origin_id, lane); the INSERT now carries
    // the REAL lane, so a fast-lane advance writes lane='fast' (its own cursor row) rather than the
    // 'ordered' default, and the conflict resolves on that lane's row only (spec §4e). `lane` binds as
    // a param (never string-concatenated, CLAUDE.md §3).
    sql`insert into sync_cursor (subscriber_id, origin_id, lane, last_applied_seq)
        values (${subscriberId}, ${originId}::uuid, ${lane}, ${seq.toString()}::bigint)
        on conflict (subscriber_id, origin_id, lane) do update
          set last_applied_seq = excluded.last_applied_seq, updated_at = now()
          where excluded.last_applied_seq > sync_cursor.last_applied_seq`,
  );
}
