import "./errors.js";
import { getTableColumns, sql } from "drizzle-orm";
import { foldForUniqueness, type Database, type Transaction } from "@waitron/db";
import type { ModuleHandoverContribution, ReturnRefusal } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { computeEntryHash } from "./chain-hash.js";
import { workforceHoldings, workforceLacking } from "./handover-holdings.js";
import { verifiableEntry, type ChainedTimeEntry } from "./chain.js";
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
  /** The next entry cannot fit a batch alone; the main box refuses this batch, so it never counts
   * the return complete. */
  tooLarge?: true;
}

export const WORKFORCE_RETURN_MAX_BYTES = 200 * 1024;
/** The largest row the routes can write measured 4,010 bytes (handover-return.test.ts), so 51 fit. */
export const WORKFORCE_RETURN_ROW_CAP = 51;

const COLUMNS = Object.entries(getTableColumns(timeEntries));
const ENTRY_COLUMNS = new Set(COLUMNS.map(([, column]) => column.name));

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
 * The sender's own working-time chain, whole, in batches. No batch when it has no entries. An entry
 * that cannot fit a batch alone ends the list with a `tooLarge` batch in its place.
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
    if (!current.add(entry)) {
      batches.push({ entries: [], staff: [], devices: [], tooLarge: true });
      return batches;
    }
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

const invalid = (reason: string): ReturnRefusal<"attendance.return_entry_invalid"> => ({
  refusal: "attendance.return_entry_invalid",
  params: { reason },
});

/** Refuses a batch not in the shape, or past the limits, {@link readWorkforceReturn} sends. */
export function readWorkforceBatch(raw: ReturnBatchValue): WorkforceReturnBatch {
  const refuse = (reason: string) => {
    throw new AppError("attendance.return_entry_invalid", { reason });
  };
  if (!isRecord(raw)) return refuse("malformed batch");
  const { entries, staff, devices, tooLarge, ...rest } = raw;
  if (
    Object.keys(rest).length > 0 ||
    (tooLarge !== undefined && tooLarge !== true) ||
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
    refuse("malformed batch");
  if (tooLarge) refuse("entry too large to return");
  if (
    (entries as unknown[]).length > WORKFORCE_RETURN_ROW_CAP ||
    byteSize(raw) > WORKFORCE_RETURN_MAX_BYTES
  )
    refuse("batch exceeds bounds");
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

/** The row as drizzle reads it back from the database, which is how `readChain` reads it. */
function asStored(row: ReturnRow): ChainedTimeEntry {
  return Object.fromEntries(
    COLUMNS.map(([key, column]) => {
      const value = row[column.name]!;
      return [key, value === null ? null : column.mapFromDriverValue(value)];
    }),
  ) as ChainedTimeEntry;
}

const sameRow = (a: ReturnRow, b: ReturnRow) =>
  [...ENTRY_COLUMNS].every((key) => a[key] === b[key]);

/** Why `entry` cannot be stored next, "held" when it is already held as sent, or null. */
function checkEntry(
  tx: Transaction,
  sourceNodeId: string,
  entry: ReturnRow,
): ReturnRefusal | "held" | null {
  if ([...ENTRY_COLUMNS].some((key) => !(key in entry))) return invalid("malformed batch");
  if (entry.node_id !== sourceNodeId) return invalid("entry from another box");
  const clash: ReturnRefusal = { refusal: "attendance.return_entry_clash" };
  const own = held(tx, "time_entries", entry.id);
  if (own) return sameRow(own, entry) ? "held" : clash;
  const position = Number(entry.sequence_no);
  const atPosition = (at: number) =>
    tx.all<ReturnRow>(sql`select * from time_entries
      where node_id = ${sourceNodeId} and sequence_no = ${at}`)[0];
  if (atPosition(position)) return clash;
  const previous = position > 1 ? atPosition(position - 1) : undefined;
  const continues =
    position === 1
      ? entry.is_first_entry === 1 && entry.prev_entry_hash === null
      : entry.is_first_entry === 0 &&
        previous !== undefined &&
        previous.entry_hash === entry.prev_entry_hash;
  if (!continues) return invalid("chain does not continue");
  if (computeEntryHash(verifiableEntry(asStored(entry))) !== entry.entry_hash)
    return invalid("hash mismatch");
  const pointsAtHeld = (table: string, key: string) =>
    entry[key] === null || held(tx, table, entry[key]!) !== undefined;
  if (!pointsAtHeld("pay_period_closures", "pay_period_closure_id"))
    return invalid("missing pay-period closure");
  if (
    !pointsAtHeld("time_entries", "corrects_entry_id") ||
    !pointsAtHeld("time_entries", "responds_to_entry_id")
  )
    return invalid("missing earlier entry");
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
): Promise<true | ReturnRefusal> {
  if (batch.entries.length > 0 && !held(tx, "nodes", sourceNodeId))
    return invalid("unknown source box");
  for (const entry of batch.entries) {
    const check = checkEntry(tx, sourceNodeId, entry);
    if (check === "held") continue;
    if (check) return check;
    const names = missingNames(tx, batch, entry);
    if (!names) return invalid("missing staff or device name");
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
  holdings: workforceHoldings,
  lacking: workforceLacking,
};
