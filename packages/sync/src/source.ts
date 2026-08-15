// The sync_tailer source read for the commercial-lane transport. Runs under the deli tenant context
// (withTenant), so the sync_log_tenant_isolation RLS policy (0000_sync_outbox.sql:48) fences it to
// this tenant's rows even as sync_tailer. Selects row_image::text — Postgres's canonical jsonb TEXT —
// so node-postgres returns a STRING and JS never parses the row's numerics (design §4b). seq is read
// as text and returned as bigint (a JS number would lose precision past 2^53).
import { sql } from "drizzle-orm";
import { type Database, type Transaction } from "@waitron/db";
import type { SyncLogRow } from "./apply.js";

export interface ReadSyncLogArgs {
  /** Restrict to one producing node, or read all origins when omitted. */
  originId?: string;
  /** Exclusive lower bound — rows with `seq > afterSeq`. */
  afterSeq: bigint;
  /** Batch cap. */
  limit: number;
  /** Restrict to these `table_name`s (a lane's tables, from `tablesForLane`); omitted → every table,
   * an empty array → no table (an empty allowlist matches nothing; a lane with no tables syncs
   * nothing). Emitted as `and table_name in ${tables}`, which drizzle expands into a parenthesised
   * placeholder list — `in ($1, $2, …)` — so every value binds as its own parameter and no identifier
   * is interpolated (CLAUDE.md §3). Not `= any(${tables})`: drizzle expands an interpolated JS array
   * into that same `($1, $2)` list, so `any(($1, $2))` fails 42809 — see the receipt in
   * packages/fiscal-verifactu/src/drain.ts:588. */
  tables?: string[];
}

// Runs under the deli tenant context, so it is always handed the `withTenant` transaction (a
// Transaction), never a raw pool — but a `Database` pool also satisfies the `.execute` it needs, so
// both are accepted. (The design sketch said `Database`; the call sites all pass a tx.)
export async function readSyncLogSince(
  sourceDb: Database | Transaction,
  args: ReadSyncLogArgs,
): Promise<SyncLogRow[]> {
  // `in ${array}` is drizzle's array-expansion shape (drain.ts:588); `= any(${array})` would expand
  // the same way to `any(($1, $2))` and fail 42809. An empty allowlist matches no table, expressed
  // as `and false` because an empty interpolated array has no valid `in ()` form either.
  const tablesClause =
    args.tables === undefined
      ? sql``
      : args.tables.length === 0
        ? sql`and false`
        : sql`and table_name in ${args.tables}`;
  const result = await sourceDb.execute<{
    seq: string;
    origin_id: string;
    table_name: string;
    op: SyncLogRow["op"];
    tenant_id: string;
    row_image: string;
    txid: string;
  }>(sql`
    select seq::text as seq, origin_id::text as origin_id, table_name, op,
           tenant_id::text as tenant_id, row_image::text as row_image, txid::text as txid
    from sync_log
    where seq > ${args.afterSeq.toString()}::bigint
      ${args.originId === undefined ? sql`` : sql`and origin_id = ${args.originId}::uuid`}
      ${tablesClause}
    order by seq asc
    limit ${args.limit}
  `);
  return result.rows.map((r) => ({
    seq: BigInt(r.seq),
    originId: r.origin_id,
    table: r.table_name,
    op: r.op,
    tenantId: r.tenant_id,
    rowImage: r.row_image,
    txid: r.txid,
  }));
}
