import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";
import { lsnGte } from "./names.js";

// The publisher-side drain readers (read on the node being drained). RAW facts only — the drained
// COMPARISON is the caller's, against a fence LSN (Ruling C2), never against pg_current_wal_lsn(),
// which decays after the carrier disables its subscription (probe E). A non-superuser reads these
// catalogs unmasked (probe B), so no extra grant is needed. Every read binds its parameter.

/** One replication slot's drain facts. `currentWalLsn` always reads (even when the slot is absent);
 * `confirmedFlushLsn`/`walStatus`/`retainedBytes` are the slot's, null when there is no slot. */
export interface SlotDrain {
  exists: boolean;
  active: boolean;
  walStatus: string | null;
  confirmedFlushLsn: string | null;
  currentWalLsn: string;
  retainedBytes: bigint | null;
}

/** Read one slot's drain facts. When the slot row is absent a SECOND query fills `currentWalLsn`
 * (there is no slot to read it off), and everything slot-specific reads empty. */
export async function readSlotDrain(db: Database, slotName: string): Promise<SlotDrain> {
  const rows = await db.execute<{
    active: boolean;
    wal_status: string | null;
    confirmed_flush_lsn: string | null;
    current_wal_lsn: string;
    retained_bytes: string | null;
  }>(sql`
    select
      active,
      wal_status,
      confirmed_flush_lsn::text as confirmed_flush_lsn,
      pg_current_wal_lsn()::text as current_wal_lsn,
      pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)::bigint as retained_bytes
    from pg_replication_slots
    where slot_name = ${slotName}
  `);
  const row = rows.rows[0];
  if (row === undefined) {
    const wal = await db.execute<{ current_wal_lsn: string }>(
      sql`select pg_current_wal_lsn()::text as current_wal_lsn`,
    );
    return {
      exists: false,
      active: false,
      walStatus: null,
      confirmedFlushLsn: null,
      currentWalLsn: wal.rows[0]?.current_wal_lsn ?? "",
      retainedBytes: null,
    };
  }
  return {
    exists: true,
    active: row.active,
    walStatus: row.wal_status,
    confirmedFlushLsn: row.confirmed_flush_lsn,
    currentWalLsn: row.current_wal_lsn,
    retainedBytes: row.retained_bytes === null ? null : BigInt(row.retained_bytes),
  };
}

/** The fence-LSN watermark half of the drain guard (Ruling C2): the tail has reached the carrier when
 * the slot exists and its `confirmed_flush_lsn` has passed the fence LSN the fenced box recorded. The
 * `!active` half (the carrier disabled only after it read drained) lives in the caller. A slot that
 * has never flushed (`confirmedFlushLsn === null`) is not drained. */
export function isDrained(d: SlotDrain, fenceLsn: string): boolean {
  return d.exists && d.confirmedFlushLsn !== null && lsnGte(d.confirmedFlushLsn, fenceLsn);
}

/** A slot summary for the box-status read and orphaned-slot reclamation. */
export interface SlotSummary {
  slotName: string;
  active: boolean;
  walStatus: string | null;
  retainedBytes: bigint | null;
}

/** Every replication slot on this node, for box-status and the operator's orphaned-slot sweep. */
export async function listSlots(db: Database): Promise<SlotSummary[]> {
  const rows = await db.execute<{
    slot_name: string;
    active: boolean;
    wal_status: string | null;
    retained_bytes: string | null;
  }>(sql`
    select
      slot_name,
      active,
      wal_status,
      pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)::bigint as retained_bytes
    from pg_replication_slots
    order by slot_name
  `);
  return rows.rows.map((row) => ({
    slotName: row.slot_name,
    active: row.active,
    walStatus: row.wal_status,
    retainedBytes: row.retained_bytes === null ? null : BigInt(row.retained_bytes),
  }));
}
