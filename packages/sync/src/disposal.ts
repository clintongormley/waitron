// The producer-side disposal guard (parent design §5.1; rejoin §6 step 3). A returned/fenced node
// proves LOCALLY whether its own-origin sync_log tail has fully drained onto the CARRIER (the current
// serving-primary): its own latest seq per lane versus the carrier's reported sync_cursor for that
// lane. A non-empty tail on ANY lane means "not safely disposable". `seq` is a single global identity,
// but each lane's cursor advances only over its own tables (tablesForLane), so "drained" is answered
// per lane and ANDed. Runs the way the box-status lag reader does: a sync_tailer member INSIDE
// withTenant(tenantId), so the sync_log_tenant_isolation RLS policy scopes the own-origin max to this
// venue; sync_cursor carries no RLS. Reads only (no write), so it composes with the fenced read-only
// posture. Values bind as parameters (CLAUDE.md §3); `in ${tables}` is drizzle's array-expansion shape
// (source.ts), never `= any(...)`.
import { sql } from "drizzle-orm";
import { type Database, type Transaction } from "@waitron/db";
import { SYNC_LANES, tablesForLane } from "./registry.js";

export interface DrainProgress {
  /** True iff the carrier has applied this node's entire own-origin tail on EVERY lane. A node that
   * has produced no own-origin rows is trivially drained. */
  drained: boolean;
  /** This node's own-origin high-water seq across all lanes; `null` iff it has captured nothing. */
  ownTailSeq: bigint | null;
  /** The carrier's applied position — the MIN, across lanes that carry own-origin rows, of its
   * reported cursor (a lane with own rows but no cursor counts as 0). The binding constraint; `null`
   * iff `ownTailSeq` is `null` (nothing to drain). */
  carrierAppliedSeq: bigint | null;
}

export interface DrainProgressArgs {
  /** This node's own origin id (config.till.nodeId) — the `origin_id = self` tail it must ship. */
  selfNodeId: string;
  /** The carrier's node id — the `subscriber_id` half of the cursor it reports as it drains. */
  carrierNodeId: string;
}

export async function readDrainProgress(
  db: Database | Transaction,
  args: DrainProgressArgs,
): Promise<DrainProgress> {
  let ownTailSeq: bigint | null = null;
  let carrierAppliedSeq: bigint | null = null;
  let drained = true;
  for (const lane of SYNC_LANES) {
    const tables = tablesForLane(lane);
    // This lane's own-origin high-water AND the carrier's reported cursor for it, as two scalar
    // subqueries in ONE round-trip per lane. `max(seq)` always yields one row (max_seq null when there
    // are no matching rows); the cursor subquery is null when the carrier has drained nothing on this
    // lane. `tablesForLane` is total and non-empty for every SYNC_LANES entry, so `in ${tables}` is
    // emitted unconditionally — no `length === 0` arm to guard (unlike readSyncLogSince, whose `tables`
    // is a caller-supplied allowlist that may legitimately be empty).
    const laneRes = await db.execute<{
      max_seq: string | null;
      last_applied_seq: string | null;
    }>(sql`
      select
        (select max(seq)::text from sync_log
           where origin_id = ${args.selfNodeId}::uuid and table_name in ${tables}) as max_seq,
        (select last_applied_seq::text from sync_cursor
           where subscriber_id = ${args.carrierNodeId} and origin_id = ${args.selfNodeId}::uuid
             and lane = ${lane}) as last_applied_seq
    `);
    const ownMaxRaw = laneRes.rows[0]?.max_seq ?? null;
    if (ownMaxRaw === null) continue; // no own rows on this lane — nothing to drain here
    const laneOwnMax = BigInt(ownMaxRaw);
    // The carrier's reported cursor for (subscriber=carrier, origin=self, lane); absent → 0 (the
    // carrier has drained nothing on this lane), which fails the drained test below.
    const curRaw = laneRes.rows[0]?.last_applied_seq ?? undefined;
    const laneCarrier = curRaw === undefined ? 0n : BigInt(curRaw);
    if (laneCarrier < laneOwnMax) drained = false;
    ownTailSeq = ownTailSeq === null || laneOwnMax > ownTailSeq ? laneOwnMax : ownTailSeq;
    carrierAppliedSeq =
      carrierAppliedSeq === null || laneCarrier < carrierAppliedSeq
        ? laneCarrier
        : carrierAppliedSeq;
  }
  return { drained, ownTailSeq, carrierAppliedSeq };
}
