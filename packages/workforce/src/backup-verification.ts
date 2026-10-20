import { compareBackupTables } from "@waitron/db";
import type { BackupVerificationContribution } from "@waitron/module";
import type { BackupQuery, BackupRow, BackupValue } from "@waitron/store";
import { SOURCES, type Source } from "@waitron/shared";
import { WORKFORCE_CLASSIFICATION } from "./classification.js";
import { verifyChain, type VerifiableEntry } from "./chain-hash.js";
import { verifyPayPeriodClosures } from "./pay-period-chain.js";
import type { PayPeriodClosure, RecordExtension } from "./record-types.js";

const immutableTables = ["time_entries", "pay_period_closures", "workforce_chains"];
export const WORKFORCE_BACKUP_VERIFICATION: BackupVerificationContribution = {
  version: 1,
  publicEvidenceDigest: null,
  data: {
    kind: "custom",
    tables: WORKFORCE_CLASSIFICATION.map((c) => c.table),
    immutableTables,
    checks: ["data", "chain", "head", "history"],
  },
  secrets: [],
  entries: [],
  effects: [],
  zeroSchema: "absent_tables_and_entries",
  targetOnly: "empty_after_migration",
  async verifyRestoredData(context) {
    const equal = await compareBackupTables({
      before: context.before,
      after: context.after,
      policies: WORKFORCE_CLASSIFICATION.map(({ table }) => ({
        table,
        immutable: immutableTables.includes(table),
        addedColumns: {},
      })),
    });
    const checks = { data: equal, chain: true, head: true, history: true };
    for (const query of [context.before, context.after]) {
      const time = await checkTime(query);
      checks.chain = time.chain && checks.chain;
      checks.head = time.head && checks.head;
      checks.history = (await checkClosures(query)) && checks.history;
    }
    return {
      status: Object.values(checks).every(Boolean) ? "passed" : "invalid",
      checks: (Object.keys(checks) as (keyof typeof checks)[]).map((code) => ({
        code,
        status: checks[code] ? "passed" : "invalid",
      })),
    };
  },
};

async function first(query: BackupQuery, statement: string, values: readonly BackupValue[] = []) {
  for await (const row of query.rows(statement, values)) return row;
  return undefined;
}
async function has(query: BackupQuery, table: string): Promise<boolean> {
  return (
    (await first(query, "select name from sqlite_schema where type='table' and name=?", [
      table,
    ])) !== undefined
  );
}
class InvalidEvidence extends Error {}
function text(row: BackupRow, field: string): string {
  const value = row[field];
  if (typeof value !== "string") throw new InvalidEvidence();
  return value;
}
function nullable(row: BackupRow, field: string): string | null {
  return row[field] === null ? null : text(row, field);
}
function integer(row: BackupRow, field: string): number {
  const value = row[field];
  if (
    typeof value !== "bigint" ||
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(Number.MIN_SAFE_INTEGER)
  )
    throw new InvalidEvidence();
  return Number(value);
}
function flag(row: BackupRow, field: string): boolean {
  if (row[field] !== 0n && row[field] !== 1n) throw new InvalidEvidence();
  return row[field] === 1n;
}
function instant(row: BackupRow, field: string): string {
  const value = text(row, field);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) throw new InvalidEvidence();
  return value;
}
function entry(row: BackupRow): VerifiableEntry {
  const selfApproved = flag(row, "self_approved");
  const authorKind = nullable(row, "author_kind");
  const direction = nullable(row, "correction_direction");
  const missingEntryKind = nullable(row, "missing_entry_kind");
  const respondsToEntryId = nullable(row, "responds_to_entry_id");
  const payPeriodClosureId = nullable(row, "pay_period_closure_id");
  const source = text(row, "captured_by_source");
  if (!(SOURCES as readonly string[]).includes(source)) throw new InvalidEvidence();
  const extension: RecordExtension | null =
    !selfApproved &&
    [authorKind, direction, missingEntryKind, respondsToEntryId, payPeriodClosureId].every(
      (v) => v === null,
    )
      ? null
      : {
          selfApproved,
          authorKind: authorKind as RecordExtension["authorKind"],
          direction: direction as RecordExtension["direction"],
          missingEntryKind: missingEntryKind as RecordExtension["missingEntryKind"],
          respondsToEntryId,
          payPeriodClosureId,
        };
  return {
    sequenceNo: integer(row, "sequence_no"),
    personId: text(row, "person_id"),
    locationId: text(row, "location_id"),
    nodeId: text(row, "node_id"),
    entryKind: text(row, "entry_kind"),
    eventAt: instant(row, "event_at"),
    recordedAt: instant(row, "recorded_at"),
    eventOffsetMinutes: integer(row, "event_offset_minutes"),
    recordedByPersonId: nullable(row, "recorded_by_person_id"),
    capturedBySource: source as Source,
    capturedByDeviceId: nullable(row, "captured_by_device_id"),
    correctsEntryId: nullable(row, "corrects_entry_id"),
    correctionReason: nullable(row, "correction_reason"),
    correctionStatus: nullable(row, "correction_status"),
    correctionActorId: nullable(row, "correction_actor_id"),
    prevEntryHash: nullable(row, "prev_entry_hash"),
    entryHash: text(row, "entry_hash"),
    isFirstEntry: flag(row, "is_first_entry"),
    extension,
  };
}
function scope(row: BackupRow): string {
  return JSON.stringify([text(row, "node_id"), text(row, "location_id")]);
}
async function checkTime(query: BackupQuery): Promise<{ chain: boolean; head: boolean }> {
  const groups = new Map<string, { entries: VerifiableEntry[]; last: BackupRow }>();
  let chain = true;
  let head = true;
  if (await has(query, "time_entries")) {
    for await (const row of query.rows(
      "select * from time_entries order by node_id, location_id, sequence_no",
    )) {
      try {
        const key = scope(row);
        const group = groups.get(key) ?? { entries: [], last: row };
        group.entries.push(entry(row));
        group.last = row;
        groups.set(key, group);
      } catch (error) {
        if (!(error instanceof InvalidEvidence)) throw error;
        chain = false;
      }
    }
  }
  for (const group of groups.values()) if (!verifyChain(group.entries).ok) chain = false;
  const seen = new Set<string>();
  if (await has(query, "workforce_chains")) {
    for await (const row of query.rows("select * from workforce_chains")) {
      try {
        const key = scope(row);
        const last = groups.get(key)?.last;
        seen.add(key);
        if (last === undefined) {
          if (
            row.sequence_no !== 0n ||
            row.last_entry_id !== null ||
            row.last_entry_hash !== null ||
            row.last_recorded_at !== null
          )
            head = false;
        } else if (
          row.sequence_no !== last.sequence_no ||
          row.last_entry_id !== last.id ||
          row.last_entry_hash !== last.entry_hash ||
          row.last_recorded_at !== last.recorded_at
        )
          head = false;
      } catch (error) {
        if (!(error instanceof InvalidEvidence)) throw error;
        head = false;
      }
    }
  }
  if ([...groups.keys()].some((key) => !seen.has(key))) head = false;
  return { chain, head };
}
function json(row: BackupRow, field: string): unknown {
  try {
    return JSON.parse(text(row, field)) as unknown;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new InvalidEvidence();
  }
}
async function checkClosures(query: BackupQuery): Promise<boolean> {
  if (!(await has(query, "pay_period_closures"))) return true;
  const groups = new Map<string, PayPeriodClosure[]>();
  let valid = true;
  for await (const row of query.rows("select * from pay_period_closures")) {
    try {
      const key = scope(row);
      const group = groups.get(key) ?? [];
      group.push({
        id: text(row, "id"),
        nodeId: text(row, "node_id"),
        locationId: text(row, "location_id"),
        period: { start: text(row, "period_start"), end: text(row, "period_end") },
        clock: json(row, "clock") as PayPeriodClosure["clock"],
        snapshot: json(row, "snapshot") as PayPeriodClosure["snapshot"],
        scheduledCloseAt: instant(row, "scheduled_close_at"),
        closedAt: instant(row, "closed_at"),
        sequenceNo: integer(row, "sequence_no"),
        prevClosureHash: nullable(row, "prev_closure_hash"),
        closureHash: text(row, "closure_hash"),
      });
      groups.set(key, group);
    } catch (error) {
      if (!(error instanceof InvalidEvidence)) throw error;
      valid = false;
    }
  }
  for (const group of groups.values()) if (!verifyPayPeriodClosures(group).ok) valid = false;
  return valid;
}
