import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";

// The subscriber-side status readers (read on the node that HOLDS the subscription). The subscription
// OWNER reads `pg_subscription`'s non-conninfo columns and the two stat views unmasked (probe B and a
// measured `has_column_privilege` — `subconninfo` is the only masked column), so the migrator that
// created the subscription reads its own status with no extra grant. Every read binds its parameter.

/** One subscription's health, joined across the catalog, the apply-worker stat and the error stats,
 * plus the tablesync progress (`srsubstate = 'r'` is a table that finished its initial copy). An
 * absent subscription reads `exists:false` with zeroed counts and no tables. */
export interface SubscriptionStatus {
  name: string;
  exists: boolean;
  enabled: boolean;
  publications: string[];
  workerUp: boolean;
  receivedLsn: string | null;
  latestEndLsn: string | null;
  applyErrorCount: number;
  syncErrorCount: number;
  tablesTotal: number;
  tablesReady: number;
}

export async function readSubscriptionStatus(
  db: Database,
  name: string,
): Promise<SubscriptionStatus> {
  const rows = await db.execute<{
    subname: string;
    enabled: boolean;
    publications: string[];
    worker_up: boolean;
    received_lsn: string | null;
    latest_end_lsn: string | null;
    apply_error_count: string;
    sync_error_count: string;
    tables_total: number;
    tables_ready: number;
  }>(sql`
    select
      s.subname,
      s.subenabled as enabled,
      s.subpublications as publications,
      st.pid is not null as worker_up,
      st.received_lsn::text as received_lsn,
      st.latest_end_lsn::text as latest_end_lsn,
      coalesce(ss.apply_error_count, 0)::bigint as apply_error_count,
      coalesce(ss.sync_error_count, 0)::bigint as sync_error_count,
      (select count(*) from pg_subscription_rel r where r.srsubid = s.oid)::int as tables_total,
      (select count(*) from pg_subscription_rel r where r.srsubid = s.oid and r.srsubstate = 'r')::int as tables_ready
    from pg_subscription s
    left join pg_stat_subscription st on st.subid = s.oid and st.worker_type = 'apply'
    left join pg_stat_subscription_stats ss on ss.subid = s.oid
    where s.subname = ${name}
  `);
  const row = rows.rows[0];
  if (row === undefined) {
    return {
      name,
      exists: false,
      enabled: false,
      publications: [],
      workerUp: false,
      receivedLsn: null,
      latestEndLsn: null,
      applyErrorCount: 0,
      syncErrorCount: 0,
      tablesTotal: 0,
      tablesReady: 0,
    };
  }
  return {
    name: row.subname,
    exists: true,
    enabled: row.enabled,
    publications: row.publications,
    workerUp: row.worker_up,
    receivedLsn: row.received_lsn,
    latestEndLsn: row.latest_end_lsn,
    applyErrorCount: Number(row.apply_error_count),
    syncErrorCount: Number(row.sync_error_count),
    tablesTotal: row.tables_total,
    tablesReady: row.tables_ready,
  };
}

/** Every subscription this node holds, name/enabled/publications only — the box-status list. */
export async function listSubscriptions(
  db: Database,
): Promise<{ name: string; enabled: boolean; publications: string[] }[]> {
  const rows = await db.execute<{ subname: string; enabled: boolean; publications: string[] }>(sql`
    select subname, subenabled as enabled, subpublications as publications
    from pg_subscription
    order by subname
  `);
  return rows.rows.map((row) => ({
    name: row.subname,
    enabled: row.enabled,
    publications: row.publications,
  }));
}
