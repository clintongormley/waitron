import { compareBackupTables } from "@waitron/db";
import type { BackupQuery, BackupValue } from "@waitron/store";
import { computeCloseEntryHash } from "./daily-close-hash.js";
import type { DailyCloseSnapshot } from "./close-types.js";

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function snapshot(value: BackupValue | undefined): DailyCloseSnapshot | null {
  if (typeof value !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (!object(parsed) || !Object.hasOwn(parsed, "close")) return null;
  const cash = parsed.cashReconciliation;
  if (
    !object(cash) ||
    typeof cash.nodeVariance !== "string" ||
    !Array.isArray(cash.byDevice) ||
    !cash.byDevice.every((entry: unknown) => object(entry) && typeof entry.deviceId === "string")
  )
    return null;
  // Hashing treats close content and device amounts as their captured JSON, without repricing.
  return parsed as unknown as DailyCloseSnapshot;
}

function sequence(value: BackupValue | undefined): number {
  const number = typeof value === "bigint" ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number) && number >= 0 ? number : -1;
}

async function walk(query: BackupQuery): Promise<boolean> {
  const tables = [];
  for await (const row of query.rows(
    "select name from sqlite_schema where type = 'table' and name in ('daily_closes', 'daily_close_chain')",
  ))
    tables.push(row.name);
  if (tables.length === 0) return true;
  if (tables.length !== 2) return false;

  for await (const node of query.rows(
    "select node_id from daily_closes union select node_id from daily_close_chain order by node_id",
  )) {
    if (typeof node.node_id !== "string") return false;
    let count = 0;
    let previous = "";
    for await (const row of query.rows(
      "select * from daily_closes where node_id = ? order by sequence_no",
      [node.node_id],
    )) {
      count++;
      const frozen = snapshot(row.snapshot);
      if (
        sequence(row.sequence_no) !== count ||
        row.prev_entry_hash !== previous ||
        typeof row.business_day !== "string" ||
        typeof row.closed_by !== "string" ||
        typeof row.closed_at !== "string" ||
        !Number.isFinite(Date.parse(row.closed_at)) ||
        frozen === null
      )
        return false;
      const hash = computeCloseEntryHash(
        {
          nodeId: node.node_id,
          sequenceNo: count,
          businessDay: row.business_day,
          closedAt: row.closed_at,
          closedBy: row.closed_by,
          snapshot: frozen,
        },
        previous,
      );
      if (hash !== row.entry_hash) return false;
      previous = hash;
    }
    let heads = 0;
    for await (const head of query.rows(
      "select sequence_no, last_entry_hash from daily_close_chain where node_id = ?",
      [node.node_id],
    )) {
      heads++;
      if (sequence(head.sequence_no) !== count || head.last_entry_hash !== previous) return false;
    }
    if (heads !== 1) return false;
  }
  return true;
}

export async function verifyBackupCloseHistory(
  before: BackupQuery,
  after: BackupQuery,
): Promise<boolean> {
  return (
    (await walk(before)) &&
    (await walk(after)) &&
    (await compareBackupTables({
      before,
      after,
      policies: ["daily_closes", "daily_close_chain"].map((table) => ({
        table,
        immutable: true,
        addedColumns: {},
      })),
    }))
  );
}
