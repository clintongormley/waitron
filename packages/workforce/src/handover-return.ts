import "./errors.js";
import { getTableColumns, sql } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import type { ModuleHandoverContribution } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { timeEntries } from "./schema/time-entries.js";

/** What a module's return seat is handed as one batch. */
export type ReturnBatchValue = Parameters<
  NonNullable<ModuleHandoverContribution["returnRecords"]>["receive"]
>[2];

/** A `time_entries` row as stored, keyed by column name. */
export type ReturnRow = Record<string, string | number | null>;

export interface WorkforceReturnBatch {
  entries: ReturnRow[];
  staff: { id: string; displayName: string }[];
  devices: { id: string; label: string }[];
}

export const WORKFORCE_RETURN_MAX_BYTES = 200 * 1024;
/** The largest row the routes can write measured 4,010 bytes (handover-return.test.ts), so 51 fit. */
export const WORKFORCE_RETURN_ROW_CAP = 51;

const ENTRY_COLUMNS = new Set(Object.values(getTableColumns(timeEntries)).map((c) => c.name));

function staffIds(row: ReturnRow) {
  return [row.person_id, row.recorded_by_person_id, row.correction_actor_id];
}

const byteSize = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

const EMPTY_BATCH_BYTES = byteSize({ entries: [], staff: [], devices: [] });

class BatchBuilder {
  entries: ReturnRow[] = [];
  private named = new Set<unknown>();
  private size = EMPTY_BATCH_BYTES;

  constructor(
    private staff: Map<unknown, WorkforceReturnBatch["staff"][number]>,
    private devices: Map<unknown, WorkforceReturnBatch["devices"][number]>,
  ) {}

  private newNames(entry: ReturnRow) {
    return [
      ...staffIds(entry).flatMap((id) => (this.staff.has(id) ? [this.staff.get(id)!] : [])),
      ...(this.devices.has(entry.captured_by_device_id)
        ? [this.devices.get(entry.captured_by_device_id)!]
        : []),
    ].filter((row, i, rows) => !this.named.has(row) && rows.indexOf(row) === i);
  }

  /** False, adding nothing, when the entry would take the batch past either limit. */
  add(entry: ReturnRow): boolean {
    const names = this.newNames(entry);
    // Each row counts a comma after it, so the sum is never below the batch's encoded size.
    const size = [entry, ...names].reduce((sum, row) => sum + byteSize(row) + 1, this.size);
    if (this.entries.length >= WORKFORCE_RETURN_ROW_CAP || size > WORKFORCE_RETURN_MAX_BYTES)
      return false;
    this.entries.push(entry);
    for (const row of names) this.named.add(row);
    this.size = size;
    return true;
  }

  batch(): WorkforceReturnBatch {
    const named = <T>(rows: Iterable<T>) => [...rows].filter((row) => this.named.has(row));
    return {
      entries: this.entries,
      staff: named(this.staff.values()),
      devices: named(this.devices.values()),
    };
  }
}

/**
 * The sender's own working-time chain, whole, in batches. No batch when it has no entries, and none
 * at all when one entry cannot fit a batch alone: the return then goes ahead without working hours.
 */
export async function readWorkforceReturn(
  db: Database | Transaction,
  sourceNodeId: string,
): Promise<WorkforceReturnBatch[]> {
  const entries = db.all<ReturnRow>(sql`
    select * from time_entries where node_id = ${sourceNodeId} order by sequence_no`);
  const staff = new Map(
    db
      .all<{ id: string; displayName: string }>(
        sql`select id, display_name as displayName from persons where id in (
          select person_id from time_entries where node_id = ${sourceNodeId}
          union select recorded_by_person_id from time_entries where node_id = ${sourceNodeId}
          union select correction_actor_id from time_entries where node_id = ${sourceNodeId}
        ) order by id`,
      )
      .map((row) => [row.id, row]),
  );
  const devices = new Map(
    db
      .all<{ id: string; label: string }>(
        sql`select id, label from devices where id in (
          select captured_by_device_id from time_entries where node_id = ${sourceNodeId}
        ) order by id`,
      )
      .map((row) => [row.id, row]),
  );
  const batches: WorkforceReturnBatch[] = [];
  let current = new BatchBuilder(staff, devices);
  for (const entry of entries) {
    if (current.add(entry)) continue;
    if (current.entries.length > 0) batches.push(current.batch());
    current = new BatchBuilder(staff, devices);
    if (!current.add(entry)) return [];
  }
  if (current.entries.length > 0) batches.push(current.batch());
  return batches;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function hasKeys(row: unknown, keys: readonly string[]): boolean {
  return (
    isRecord(row) &&
    Object.keys(row).length === keys.length &&
    keys.every((key) => typeof row[key] === "string")
  );
}

/** Refuses, with `attendance.invalid`, a batch not in the shape {@link readWorkforceReturn} sends. */
export function readWorkforceBatch(raw: ReturnBatchValue): WorkforceReturnBatch {
  const refuse = () => {
    throw new AppError("attendance.invalid", { reason: "malformed_return_batch" });
  };
  if (!isRecord(raw) || Object.keys(raw).length !== 3) refuse();
  const { entries, staff, devices } = raw as Record<string, unknown>;
  if (
    !Array.isArray(entries) ||
    !Array.isArray(staff) ||
    !Array.isArray(devices) ||
    entries.some(
      (row) =>
        !isRecord(row) ||
        Object.entries(row).some(
          ([key, value]) =>
            !ENTRY_COLUMNS.has(key) ||
            (value !== null && typeof value !== "string" && typeof value !== "number"),
        ),
    ) ||
    staff.some((row) => !hasKeys(row, ["id", "displayName"])) ||
    devices.some((row) => !hasKeys(row, ["id", "label"]))
  )
    refuse();
  return raw as unknown as WorkforceReturnBatch;
}
