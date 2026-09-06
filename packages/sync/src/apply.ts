// Applies a peer's captured rows to the local mirror in seq order, idempotently. The worker uses
// app_user for enrolled-table writes and cursor updates; withTenant supplies each write transaction.
import { sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { pgErrorCode, readDeploymentEnvironment, withTenant, type Database } from "@waitron/db";
import { type EnrolledTable, type SyncLane } from "@waitron/sync-enrolment";
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
   * rows read, skipped against, and advanced. Optional, defaulting to `"ordered"` (the baseline column
   * default and the wire's ordered-clamp), so an ordered-lane caller need not name it. */
  lane?: SyncLane;
  /** The assembled module enrolment set, injected by the composition root (spec §2e): every enrolled
   * table's apply metadata, from which the per-set dispatch map is built once (memoised on the array
   * reference — see {@link dispatchFor}). A row naming a table absent from this set is a hard
   * `sync.table_not_enrolled`. `@waitron/sync` no longer owns this data (SP-2a inversion). */
  enrolments: readonly EnrolledTable[];
  /** The current serving-primary node id the config-conflict gate keys on (membership Slice 7). On the
   * CARRIER draining a returned node's tail, a config-class row (an enrolled table with
   * `configClass: true`) whose `originId` is NOT this id is REJECTED by primary-wins — recorded to
   * `sync_config_conflicts`, not applied (spec §7). FAIL-SAFE: when `undefined` (this node is not a
   * carrier / has no known serving-primary) the gate is INERT — every row applies as it does today, so
   * normal config down-flow is never broken by the gate (R-S7-2). */
  servingPrimaryId?: string;
  /** The SOURCE's per-module applied versions from /hello. Absent for a pre-SP-2b peer → the version
   * gate is disabled (behaviour-preserving, spec §4). Otherwise the gate compares it per module against
   * {@link ApplyBatchOptions.subscriberModuleVersions} (resolving each row's module via
   * {@link ApplyBatchOptions.moduleByTable}) and parks a row whose module the source migrated ahead of
   * this subscriber — see {@link ApplyBatchResult.versionParked}. */
  sourceModuleVersions?: Record<string, number>;
  /** THIS subscriber's own per-module applied versions (boot snapshot), the lower side of the gate's
   * per-module comparison against {@link ApplyBatchOptions.sourceModuleVersions}. */
  subscriberModuleVersions: Record<string, number>;
  /** table → owning module, used to resolve a row's module in the gate (spec §5). A row naming a table
   * absent from this map is not version-parked (it falls through to the enrolment check). */
  moduleByTable: ReadonlyMap<string, string>;
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
  /** Config-class rows overridden by primary-wins this batch (membership Slice 7): a config-class row
   * whose origin was not the serving-primary — recorded to `sync_config_conflicts` and settled (the
   * cursor advances past it, never re-parked), NOT applied. Counted at the single settle site, the same
   * way `applied`/`deferred` are, so it never double-counts a re-delivery (a seq at/below the cursor is
   * skipped before the gate, so it is neither re-applied nor re-recorded). Always 0 when the gate is
   * inert (`servingPrimaryId` undefined). */
  rejected: number;
  /** Rows parked because the SOURCE's schema version for the row's module is ahead of THIS
   * subscriber's — held below the cursor, redelivered after this node reboots and migrates (SP-2b).
   * Distinct from `deferred` (23503 FK-park): a version-park is NOT self-healing within a batch (the
   * subscriber's migrated version only changes on reboot), so it never enters the retry pass. Each
   * parked seq is counted once. */
  versionParked: number;
}

/** The reject gate's per-batch context, threaded into {@link tryApplyRow} so both the main pass and the
 * retry pass share one gate site. `servingPrimaryId` undefined ⇒ inert; `lane` is recorded on a
 * rejected row (which lane it arrived on). */
interface GateContext {
  servingPrimaryId: string | undefined;
  lane: SyncLane;
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
 * Per-row commits can leave applied rows above an unadvanced cursor when a later row throws.
 * Redelivery can therefore repeat already-committed writes. The tenders, working-order transition
 * and open-parent business triggers skip app.sync_apply writes so they do not reject a replay before
 * its idempotency check; redelivery.gate.test.ts exercises these cases through app_user.
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

  // The per-table apply plumbing for THIS injected enrolment set, built once (memoised on the array
  // reference), then threaded into every tryApplyRow call — it is no longer a module-level constant now
  // that the enrolment data is injected rather than owned here (SP-2a inversion).
  const DISPATCH = dispatchFor(opts.enrolments);

  // 2. Ascending seq is the apply order. `seq` values are distinct integers (a Postgres identity
  //    column), so the sign of their exact bigint difference is a total order; `Number` preserves
  //    that sign (never collapsing a non-zero difference to 0), giving a branchless comparator.
  const ordered = [...rows].sort((a, b) => Number(a.seq - b.seq));

  // 3. The per-(subscriber, origin) cursor for THIS lane, read once. A row whose seq <= its origin's
  //    cursor was applied by a prior batch of the same lane — the Group-C monotonicity skip. The lane
  //    defaults to "ordered" (the baseline column default and the wire's ordered-clamp), so an ordered
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
  let rejected = 0;
  let versionParked = 0;
  const parked: SyncLogRow[] = [];
  const gate: GateContext = { servingPrimaryId: opts.servingPrimaryId, lane };

  // The version-park predicate (SP-2b, spec §4). A row whose owning module the SOURCE migrated ahead of
  // THIS subscriber is parked BEFORE the apply attempt: `jsonb_populate_record` silently drops a JSON key
  // with no matching column, so applying such a row into the older table would lose the newer column —
  // silent cross-node corruption. Parking holds it below the cursor until this node reboots and migrates.
  //  - source map absent (a pre-SP-2b peer served no `moduleVersions`) → gate DISABLED, behaviour-
  //    preserving (spec §4 "robustness at the edges", mirrors the older-peer `membership` tolerance);
  //  - an unknown table (not in `moduleByTable`) → false, so it falls through to the existing
  //    `sync.table_not_enrolled` throw in `tryApplyRow` rather than being masked as a park;
  //  - otherwise `(source[M] ?? 0) > (subscriber[M] ?? 0)` — a missing per-module version counts as 0,
  //    NOT "skip the check" (spec §4): the subscriber being at 0 while the source is ahead still parks.
  const isVersionAhead = (row: SyncLogRow): boolean => {
    if (opts.sourceModuleVersions === undefined) return false;
    const mod = opts.moduleByTable.get(row.table);
    if (mod === undefined) return false;
    return (opts.sourceModuleVersions[mod] ?? 0) > (opts.subscriberModuleVersions[mod] ?? 0);
  };

  // Records a row's outcome against its origin's progress. Returns true if the row is now settled
  // (so a parked row can be removed from the retry queue), false if it is (still) parked. The single
  // place `applied`/`deferred`/`rejected` are counted, so both passes share one counting site.
  const settleOrPark = (row: SyncLogRow, outcome: number | "deferred" | "rejected"): boolean => {
    const b = bucket(row.originId);
    if (outcome === "deferred") {
      if (!b.deferred.has(row.seq)) deferred += 1; // count a row the first time it is parked only
      b.deferred.add(row.seq);
      return false;
    }
    // "rejected": a config-class row primary-wins overrode (already recorded to sync_config_conflicts
    // by tryApplyRow). It is settled — NOT counted as applied, the cursor advances past it (never
    // re-parked/re-delivered, so the drain is not blocked, spec §7) — and counted in `rejected`.
    if (outcome === "rejected") rejected += 1;
    else if (outcome > 0) applied += 1;
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
    // Version gate (SP-2b) — AFTER the already-applied cursor-skip (never re-park a settled row) and
    // BEFORE the apply attempt (so it precedes the config-conflict gate inside tryApplyRow: a
    // version-ahead row must never be recorded/rejected under a schema this node has not yet migrated
    // to). A version-ahead row is parked into the SAME `deferred` set the 23503 defer uses, so the
    // cursor-hold + redelivery machinery holds the lane cursor below it for free. It is NOT pushed to
    // `parked`: the retry pass cannot change a version verdict within one batch (spec §3) — the
    // subscriber's migrated version only moves on reboot.
    if (isVersionAhead(row)) {
      const b = bucket(row.originId);
      if (!b.deferred.has(row.seq)) versionParked += 1; // per-origin dedup, matching settleOrPark
      b.deferred.add(row.seq); // hold the cursor below it (reuse the machinery)
      continue;
    }
    const outcome = await tryApplyRow(subscriberDb, row, DISPATCH, gate);
    if (!settleOrPark(row, outcome)) parked.push(row);
  }

  // Retry pass — a parked child whose parent arrived later in this batch now lands.
  let madeProgress = parked.length > 0;
  while (parked.length > 0 && madeProgress) {
    madeProgress = false;
    for (let i = parked.length - 1; i >= 0; i -= 1) {
      const outcome = await tryApplyRow(subscriberDb, parked[i]!, DISPATCH, gate);
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

  return { applied, deferred, rejected, versionParked };
}

/** A `$1`-bearing statement split into the text before and after the single payload bind. */
interface StatementParts {
  head: string;
  tail: string;
}

/**
 * One enrolled table's apply plumbing, precomputed ONCE per injected enrolment set. `applyParts` is
 * the insert/update statement already split at the `$1` payload marker with the affected-row RETURNING
 * folded into its tail, so the per-row hot path is a Map lookup and a string interleave rather than a
 * rebuild. That matters for the watermark form, whose statement walks the enrolled column list
 * (apply-sql.ts) — wasteful to recompute for every row of a batch.
 */
interface Dispatch {
  entry: EnrolledTable;
  applyParts: StatementParts;
}

/**
 * Splits a statement at its single `$1` payload marker and folds in the affected-row `returning 1 as
 * applied`, so a no-op leaves `.rows` empty and a real change returns one row. The `row_image` then
 * binds as that one `$1` (cast `::jsonb`); every identifier around it comes from the injected
 * enrolment set (apply-sql.ts), never runtime-derived, so the CLAUDE.md §3 escaping question does not
 * arise.
 */
function splitStatement(statement: string): StatementParts {
  const marker = statement.indexOf("$1");
  return {
    head: statement.slice(0, marker),
    tail: `${statement.slice(marker + 2)} returning 1 as applied`,
  };
}

// The dispatch table for one injected enrolment set, built once and memoised on the array reference
// (a WeakMap keyed by the set), so a stable set — boot assembles it once — builds its 22-entry map a
// single time across every batch, exactly the "build once" property the old module-level constant had.
// A different array reference (a test fixture) gets its own map. The delete statement is NOT
// precomputed — deleteStatementFor is a cheap pure-string helper, and only DELETE-capable rows ever
// delete (Group C's working_orders/working_order_lines and Group E's webauthn_credentials) — so it is
// built per delete row in applyOneRow.
const DISPATCH_CACHE = new WeakMap<readonly EnrolledTable[], ReadonlyMap<string, Dispatch>>();

function dispatchFor(enrolments: readonly EnrolledTable[]): ReadonlyMap<string, Dispatch> {
  let d = DISPATCH_CACHE.get(enrolments);
  if (d === undefined) {
    d = new Map(
      enrolments.map((entry) => [
        entry.table,
        { entry, applyParts: splitStatement(applyStatementFor(entry)) },
      ]),
    );
    DISPATCH_CACHE.set(enrolments, d);
  }
  return d;
}

/**
 * Applies one row, returning the affected-row count, or the sentinel `"deferred"` when the write
 * raised `23503 foreign_key_violation`. Other errors, including permission and check violations,
 * propagate because retrying after a later row does not resolve them. A row naming a table the injected enrolment set does not carry has no apply statement,
 * so that is a hard `sync.table_not_enrolled` rather than a silent skip.
 */
async function tryApplyRow(
  db: Database,
  row: SyncLogRow,
  dispatchMap: ReadonlyMap<string, Dispatch>,
  gate: GateContext,
): Promise<number | "deferred" | "rejected"> {
  const dispatch = dispatchMap.get(row.table);
  if (dispatch === undefined) throw new AppError("sync.table_not_enrolled", { table: row.table });
  // Config-conflict gate (membership Slice 7, spec §7), read off the injected enrolment set's dispatch
  // entry (`configClass`), before the apply so both passes reach it once. On the CARRIER draining a
  // returned node's tail, a config-class row whose origin is NOT the current serving-primary is
  // overridden by primary-wins: recorded, then settled-as-rejected (not applied). Inert when
  // servingPrimaryId is undefined (fail-safe — normal config down-flow, R-S7-2).
  if (
    dispatch.entry.configClass &&
    gate.servingPrimaryId !== undefined &&
    row.originId !== gate.servingPrimaryId
  ) {
    await recordConfigConflict(db, row, gate.lane);
    // KNOWN RESIDUAL (bounded, fail-safe — documented, not fixed; membership Slice 7 whole-branch review).
    // Dependent-runtime-row stall: a non-config runtime child (e.g. a sale_line / ticket_item) that
    // FK-references a CONFIG row the returned node created ONLY during the fence window will `23503`-park
    // once primary-wins rejects that config parent here — the parent never lands, so the child never lands,
    // stalling THAT origin's drain. This is fail-safe by design: the stalled origin never reports
    // `drained:true`, so retire/evict REFUSES (`node.retire_not_drained`) — no unsafe eviction — and the
    // runtime child is NEVER dropped (dropping fiscal-adjacent data would be strictly worse than stalling).
    // Resolution is the deferred interactive-merge / ops path (spec §7/§9) or wipe-and-restore (R3).
    return "rejected";
  }
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
 * Runs the row's apply (or delete) statement inside an echo-guarded transaction and
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
 * below). Each `(subscriber, origin)` can carry a cursor per lane; reading both would collapse them
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
 * a cursor never moves backward. The apply connection inherits app_user's cursor grants.
 */
async function advanceCursor(
  db: Database,
  subscriberId: string,
  originId: string,
  lane: SyncLane,
  seq: bigint,
): Promise<void> {
  await db.execute(
    // The ON CONFLICT arbiter is the primary key (subscriber_id, origin_id, lane); the INSERT now carries
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

/**
 * Records a config-class row that primary-wins overrode (membership Slice 7, spec §7) into the
 * whole-DB `sync_config_conflicts` ops table — an append-only surface the box-status read exposes for
 * review. Raw-SQL, matching {@link advanceCursor}: every value binds as a parameter, so the CLAUDE.md
 * §3 escaping question does not arise. `rowImage` is the source's verbatim `row_image::text`, bound as
 * `$1::jsonb` exactly as {@link applyOneRow} does (never JSON.parse'd — a numeric's scale is preserved).
 * The rejected row's tenant lives inside the jsonb image. NEVER log or throw the row bytes: they
 * carry business data (errors.ts's "NO PARAM CARRIES ROW CONTENT" rule); they exist only inside this one jsonb column.
 */
async function recordConfigConflict(db: Database, row: SyncLogRow, lane: SyncLane): Promise<void> {
  await db.execute(
    sql`insert into sync_config_conflicts (table_name, origin_id, lane, row_image)
        values (${row.table}, ${row.originId}::uuid, ${lane}, ${row.rowImage}::jsonb)`,
  );
}
