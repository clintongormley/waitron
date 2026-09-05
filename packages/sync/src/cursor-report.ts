// The source-side cursor-report writer: cross-node visibility for retention (spec §3.1). A
// subscriber POSTs how far it has applied a source's log; the source records it into its OWN
// sync_cursor as (subscriber=<peer>, origin=self, lane, seq), so pruneSyncLog — which runs where
// sync_log lives — can hold the log at the min across every subscriber's reported cursor. Runs as
// sync_tailer, which already holds INSERT, UPDATE on sync_cursor (0000_sync_outbox.sql:109) — no
// new grant. sync_cursor has no tenant_id and no RLS (0000:95-99), so no withTenant is needed.
import { sql } from "drizzle-orm";
import { type Database } from "@waitron/db";
import type { SyncLane } from "@waitron/sync-enrolment";

export interface RecordSubscriberCursorArgs {
  /** The reporting subscriber's node id — the `subscriber_id` half of the key. */
  subscriberId: string;
  /** The origin this report is against — ALWAYS the source's own node id, stamped by the route
   * (never a peer-supplied value), so a peer cannot write a cursor for an arbitrary origin. */
  originId: string;
  lane: SyncLane;
  /** How far the subscriber has applied this origin's log. */
  lastAppliedSeq: bigint;
}

/**
 * Upserts the reporting subscriber's cursor on the SOURCE. `last_applied_seq` is kept monotonic with
 * `greatest(excluded, existing)` so a reordered/stale report never regresses the source's view, and
 * `updated_at` is bumped on EVERY report (a heartbeat — the source's "last heard from" signal, spec
 * §3.5, which is why no `last_seen_at` column is needed). Values bind as parameters (CLAUDE.md §3).
 */
export async function recordSubscriberCursor(
  db: Database,
  args: RecordSubscriberCursorArgs,
): Promise<void> {
  await db.execute(
    sql`insert into sync_cursor (subscriber_id, origin_id, lane, last_applied_seq, updated_at)
        values (${args.subscriberId}, ${args.originId}::uuid, ${args.lane},
                ${args.lastAppliedSeq.toString()}::bigint, now())
        on conflict (subscriber_id, origin_id, lane) do update
          set last_applied_seq = greatest(excluded.last_applied_seq, sync_cursor.last_applied_seq),
              updated_at = now()`,
  );
}
