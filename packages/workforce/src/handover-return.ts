import "./errors.js";
import { getTableColumns, sql } from "drizzle-orm";
import { foldForUniqueness, type Database, type Transaction } from "@waitron/db";
import type { ModuleHandoverContribution } from "@waitron/module";
import { AppError, type ErrorCode, type Source } from "@waitron/shared";
import { computeEntryHash } from "./chain-hash.js";
import type { RecordExtension } from "./record-types.js";
import { timeEntries } from "./schema/time-entries.js";
import { markAttendanceEntry } from "./staff-activity.js";

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

/** Refuses a batch not in the shape {@link readWorkforceReturn} sends. */
export function readWorkforceBatch(raw: ReturnBatchValue): WorkforceReturnBatch {
  const refuse = () => {
    throw new AppError("attendance.return_entry_invalid", {});
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

async function insertRow(tx: Transaction, table: string, row: ReturnRow) {
  const entries = Object.entries(row);
  await tx.run(sql`insert into ${sql.identifier(table)}
    (${sql.join(
      entries.map(([key]) => sql.identifier(key)),
      sql`, `,
    )})
    values (${sql.join(
      entries.map(([, value]) => sql`${value}`),
      sql`, `,
    )})`);
}

function held(tx: Transaction, table: string, id: ReturnRow[string]): ReturnRow | undefined {
  return tx.all<ReturnRow>(sql`select * from ${sql.identifier(table)} where id = ${id}`)[0];
}

/**
 * The people and device `entry` names that this box lacks, as the batch describes them; undefined
 * when the batch leaves one of them out.
 */
function missingNames(tx: Transaction, batch: WorkforceReturnBatch, entry: ReturnRow) {
  const people = [...new Set(staffIds(entry))]
    .filter((id) => id !== null && !held(tx, "persons", id))
    .map((id) => batch.staff.find((person) => person.id === id));
  const deviceId = entry.captured_by_device_id;
  const devices =
    deviceId === null || held(tx, "devices", deviceId)
      ? []
      : [batch.devices.find((device) => device.id === deviceId)];
  if (people.some((row) => !row?.displayName) || devices.some((row) => !row)) return undefined;
  return { people: people.map((row) => row!), devices: devices.map((row) => row!) };
}

/**
 * A missing person is added as the fiscal return's `restoreStaff` adds one, and a missing device as
 * it adds one (packages/fiscal-verifactu/src/handover-return.ts).
 */
async function restoreNames(
  tx: Transaction,
  names: NonNullable<ReturnType<typeof missingNames>>,
  now: Date,
) {
  for (const { id, displayName } of names.people)
    await insertRow(tx, "persons", {
      id,
      display_name: displayName,
      display_name_folded: foldForUniqueness(displayName),
      status: "suspended",
      created_at: now.toISOString(),
    });
  for (const { id, label } of names.devices) {
    const [profile] = tx.all<ReturnRow>(sql`select id from device_profiles order by id limit 1`);
    await insertRow(tx, "devices", {
      id,
      label,
      device_profile_id: profile!.id!,
      token_hash: "",
      active: 0,
      deleted_at: now.toISOString(),
      enrolled_at: now.toISOString(),
    });
  }
}

const nullableText = (value: ReturnRow[string]) => (value === null ? null : String(value));

/** The row as {@link computeEntryHash} reads it, as `readChain` builds it from a stored row. */
function hashInput(row: ReturnRow) {
  const text = (key: string) => nullableText(row[key]!);
  const extensionFields = [
    "author_kind",
    "correction_direction",
    "missing_entry_kind",
    "responds_to_entry_id",
    "pay_period_closure_id",
  ].map(text);
  const selfApproved = row.self_approved === 1;
  const [authorKind, direction, missingEntryKind, respondsToEntryId, payPeriodClosureId] =
    extensionFields;
  return {
    sequenceNo: Number(row.sequence_no),
    personId: String(row.person_id),
    nodeId: String(row.node_id),
    entryKind: String(row.entry_kind),
    eventAt: String(row.event_at),
    recordedAt: String(row.recorded_at),
    eventOffsetMinutes: Number(row.event_offset_minutes),
    recordedByPersonId: text("recorded_by_person_id"),
    capturedBySource: String(row.captured_by_source) as Source,
    capturedByDeviceId: text("captured_by_device_id"),
    correctsEntryId: text("corrects_entry_id"),
    correctionReason: text("correction_reason"),
    correctionStatus: text("correction_status"),
    correctionActorId: text("correction_actor_id"),
    prevEntryHash: text("prev_entry_hash"),
    extension:
      !selfApproved && extensionFields.every((value) => value === null)
        ? null
        : ({
            selfApproved,
            authorKind,
            direction,
            missingEntryKind,
            respondsToEntryId,
            payPeriodClosureId,
          } as RecordExtension),
  };
}

const sameRow = (a: ReturnRow, b: ReturnRow) =>
  [...ENTRY_COLUMNS].every((key) => a[key] === b[key]);

/** Why `entry` cannot be stored next, or null when it can (or is already held as sent). */
function checkEntry(tx: Transaction, sourceNodeId: string, entry: ReturnRow): ErrorCode | null {
  if (
    [...ENTRY_COLUMNS].some((key) => !(key in entry)) ||
    entry.node_id !== sourceNodeId ||
    !held(tx, "nodes", sourceNodeId)
  )
    return "attendance.return_entry_invalid";
  const own = held(tx, "time_entries", entry.id);
  if (own) return sameRow(own, entry) ? null : "attendance.return_entry_clash";
  const position = Number(entry.sequence_no);
  const atPosition = (at: number) =>
    tx.all<ReturnRow>(sql`select * from time_entries
      where node_id = ${sourceNodeId} and sequence_no = ${at}`)[0];
  if (atPosition(position)) return "attendance.return_entry_clash";
  const previous = position > 1 ? atPosition(position - 1) : undefined;
  const continues =
    position === 1
      ? entry.is_first_entry === 1 && entry.prev_entry_hash === null
      : entry.is_first_entry === 0 &&
        previous !== undefined &&
        previous.entry_hash === entry.prev_entry_hash;
  if (!continues || computeEntryHash(hashInput(entry)) !== entry.entry_hash)
    return "attendance.return_entry_invalid";
  const pointsAtHeld = (table: string, key: string) =>
    entry[key] === null || held(tx, table, entry[key]!) !== undefined;
  if (
    !pointsAtHeld("pay_period_closures", "pay_period_closure_id") ||
    !pointsAtHeld("time_entries", "corrects_entry_id") ||
    !pointsAtHeld("time_entries", "responds_to_entry_id")
  )
    return "attendance.return_entry_invalid";
  return null;
}

/**
 * Stores a returned batch in chain order inside the caller's transaction, skipping rows already
 * held as sent, and re-queues the days each stored row touches as an append does. A refusal is
 * returned, not thrown, so the rows stored before it stay: the main box then holds a whole prefix of
 * the old box's chain, never a broken one.
 */
export async function receiveWorkforceBatch(
  tx: Transaction,
  sourceNodeId: string,
  batch: WorkforceReturnBatch,
  now: Date,
): Promise<true | { refusal: ErrorCode }> {
  for (const entry of batch.entries) {
    const refusal = checkEntry(tx, sourceNodeId, entry);
    if (refusal) return { refusal };
    if (held(tx, "time_entries", entry.id)) continue;
    const names = missingNames(tx, batch, entry);
    if (!names) return { refusal: "attendance.return_entry_invalid" };
    await restoreNames(tx, names, now);
    await insertRow(tx, "time_entries", entry);
    await markAttendanceEntry(tx, {
      id: String(entry.id),
      eventAt: String(entry.event_at),
      correctsEntryId: nullableText(entry.corrects_entry_id!),
      respondsToEntryId: nullableText(entry.responds_to_entry_id!),
    });
  }
  return true;
}

export const WORKFORCE_HANDOVER: ModuleHandoverContribution = {
  returnRecords: {
    read: async (tx, source) =>
      (await readWorkforceReturn(tx, source)) as unknown as ReturnBatchValue[],
    receive: (tx, source, batch, now) =>
      receiveWorkforceBatch(tx, source, readWorkforceBatch(batch), now),
  },
};
