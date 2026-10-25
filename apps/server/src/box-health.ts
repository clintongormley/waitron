import { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { devices, incidents, printers, sales, type Database, type Transaction } from "@waitron/db";
import type {
  ClockConfirmationSource,
  ClockStopState,
  ClockWitness,
  FiscalBackend,
  TrustedClock,
} from "@waitron/fiscal";
import { persons } from "@waitron/identity";
import { cardReaders, DEMO_READER_ID } from "@waitron/payments";
import type { StreamView } from "@waitron/stream";
import type { DiskFullState } from "./disk-full-state.js";
import type { DiskUsage } from "./disk-usage.js";
import type { LeftoverSurvey } from "./free-space-now.js";
import type { FreeSpaceState } from "./free-space-watch.js";
import {
  readStaffNoticesInTurns,
  type OwnedStaffNotice,
  type OwnedStaffNoticeSource,
  type StaffNoticeLog,
} from "./staff-notices.js";
import type { AuthorityClockStatus, TimeHealth } from "./time-health.js";
import type { FiscalOutboxState } from "@waitron/fiscal";
import { codeOf } from "@waitron/server-kit";
import { sql } from "drizzle-orm";

/** A clock witness on the Box status page; a device's `label` is null when no device row has its
 * id. */
export type ClockStopWitness = ClockWitness & { label: string | null };

/** The fiscal seat's clock stop as the Box status page shows it: each device witness carries its
 * label, and the covering confirmation names its person. */
export interface ClockStopView extends Omit<
  ClockStopState,
  "agreeing" | "contrary" | "confirmation"
> {
  agreeing: { authority: ClockWitness | null; devices: ClockStopWitness[] };
  contrary: { authority: ClockWitness | null; devices: ClockStopWitness[] };
  confirmation: {
    id: string;
    source: ClockConfirmationSource;
    personName: string | null;
    confirmedAt: string;
  } | null;
}

/** A `clock.records_misdated` alert's incident id and its own params. */
export interface MisdatedOpen {
  incidentId: string;
  confirmationId: string;
  count: number;
  from: string;
  fromOffsetMinutes: number;
  to?: string;
  toOffsetMinutes?: number;
  partial: boolean;
  unconfirmed: boolean;
}

/** The box handled it itself; a person whose row is gone has no name. */
export type MisdatedHandler = { kind: "box" } | { kind: "person"; name: string | null };

export interface MisdatedHandled extends MisdatedOpen {
  handledAt: string;
  handledBy: MisdatedHandler;
  note: string | null;
}

export interface BoxHealth {
  /** The box's clock when the read was made. */
  at: string;
  sales: { lastAt: string | null };
  notices: OwnedStaffNotice[];
  noticesUnavailable: string[];
  /** Whether this box files records with the tax agency. */
  filing: boolean;
  /** Null when the box does not file, the seat has no outbox, or its read failed. */
  outbox: (FiscalOutboxState & { awaitingCertificate: boolean }) | null;
  stream: StreamView;
  clock: { authority: AuthorityClockStatus; sync: TimeHealth };
  printers: { id: string; name: string }[];
  /** Null when the payments module is off: its table does not exist. */
  readers: { id: string; name: string }[] | null;
  /** False on a mirror or fenced node, whose read-only gate refuses a free-space deletion. */
  canFree: boolean;
  disk: DiskUsage & {
    stoppedSince: string | null;
    lowSince: string | null;
    reclaimable: LeftoverSurvey;
  };
  /** Null when payments are not stopped for the clock, or the fiscal seat never stops them. */
  clockStop: ClockStopView | null;
  /** Since the check's opening reading; null when no check waits, or the seat keeps none. */
  clockCheckWaiting: { since: string } | null;
  misdatedOpen: MisdatedOpen[];
  misdatedHandledCount: number;
}

export interface BoxHealthReaders {
  now: () => Date;
  notices: {
    sources: readonly OwnedStaffNoticeSource[];
    clock: Pick<TrustedClock, "now">;
    filing: () => boolean;
    log: StaffNoticeLog;
  };
  stream: () => StreamView;
  /** Absent when the fiscal seat has no outbox. `read` must only select. */
  outbox?: {
    read: (tx: Transaction) => Promise<FiscalOutboxState>;
    awaitingCertificate: () => boolean;
  };
  authorityClock: () => AuthorityClockStatus;
  timeHealth: () => Promise<TimeHealth>;
  disk: Pick<DiskFullState, "since">;
  space: Pick<FreeSpaceState, "current">;
  /** May be cached; its `freeBytes` is replaced by `free()`'s. */
  usage: () => Promise<DiskUsage>;
  /** The venue folder's free space, read on every call. */
  free: () => Promise<number | null>;
  leftovers: () => Promise<LeftoverSurvey>;
  /** Boot's own test of whether the payments migration set is applied. */
  paymentsEnabled: boolean;
  canFree: () => boolean;
  /** Called inside a write-lock turn. Absent, `clockStop` is null. */
  clockStop?: (db: Database) => Promise<ClockStopView | null>;
  /** Called inside a write-lock turn. Absent, `clockCheckWaiting` is null. */
  clockCheckWaiting?: (db: Database) => Promise<{ since: string } | null>;
}

/** The person's display name; null when no person row has the id. */
export async function displayNameOf(tx: Transaction, personId: string): Promise<string | null> {
  const [row] = await tx
    .select({ displayName: persons.displayName })
    .from(persons)
    .where(eq(persons.id, personId));
  return row?.displayName ?? null;
}

/** The seat's raw clock stop at the box's reading; null when the seat has no `clockStopState`. */
export async function readClockStopState(
  tx: Transaction,
  deps: {
    backend: Pick<FiscalBackend, "clockStopState">;
    witnesses: () => readonly ClockWitness[];
    clock: Pick<TrustedClock, "now">;
  },
): Promise<ClockStopState | null> {
  if (deps.backend.clockStopState === undefined) return null;
  // Before the reading: a witness noted after it would be left out as taken after it.
  const witnesses = deps.witnesses();
  const { instant, offsetMinutes } = deps.clock.now();
  return deps.backend.clockStopState(tx, { instant, offsetMinutes }, witnesses);
}

/** Reads the seat's clock stop at the box's reading, with device labels and the covering
 * confirmation's person named. A seat with no `clockStopState` has none. */
export function clockStopReader(deps: {
  backend: Pick<FiscalBackend, "clockStopState">;
  witnesses: () => readonly ClockWitness[];
  clock: Pick<TrustedClock, "now">;
}): (db: Database) => Promise<ClockStopView | null> {
  return async (db) => {
    const state = await readClockStopState(db, deps);
    if (state === null) return null;
    const ids = [...state.agreeing.devices, ...state.contrary.devices].map((witness) => witness.id);
    const labelRows =
      ids.length === 0
        ? []
        : await db
            .select({ id: devices.id, label: devices.label })
            .from(devices)
            .where(inArray(devices.id, ids));
    const labels = new Map(labelRows.map((row) => [row.id, row.label]));
    const labelled = (list: ClockWitness[]): ClockStopWitness[] =>
      list.map((witness) => ({ ...witness, label: labels.get(witness.id) ?? null }));
    let confirmation: ClockStopView["confirmation"] = null;
    if (state.confirmation !== null) {
      const { id, source, personId, confirmedAt } = state.confirmation;
      const personName = personId === null ? null : await displayNameOf(db, personId);
      confirmation = { id, source, personName, confirmedAt };
    }
    return {
      ...state,
      agreeing: { authority: state.agreeing.authority, devices: labelled(state.agreeing.devices) },
      contrary: { authority: state.contrary.authority, devices: labelled(state.contrary.devices) },
      confirmation,
    };
  };
}

/** Reads the check that waits at the box's reading. A seat with no `waitingClockCheck` has none. */
export function clockCheckWaitingReader(deps: {
  backend: Pick<FiscalBackend, "waitingClockCheck">;
  clock: Pick<TrustedClock, "now">;
}): (db: Database) => Promise<{ since: string } | null> {
  return async (db) => {
    if (deps.backend.waitingClockCheck === undefined) return null;
    const { instant, offsetMinutes } = deps.clock.now();
    const waiting = await deps.backend.waitingClockCheck(db, { instant, offsetMinutes });
    return waiting === null ? null : { since: waiting.openedAt };
  };
}

const MISDATED = "clock.records_misdated";

const misdatedParams = (params: Record<string, unknown>) =>
  params as unknown as Omit<MisdatedOpen, "incidentId">;

export const misdatedOpenQuery = (tx: Transaction) =>
  tx
    .select({ id: incidents.id, params: incidents.params })
    .from(incidents)
    .where(and(eq(incidents.code, MISDATED), isNull(incidents.acknowledgedAt)))
    .orderBy(asc(incidents.detectedAt), asc(incidents.id));

/** The open `clock.records_misdated` alerts' params, oldest first. */
export async function readMisdatedOpen(tx: Transaction): Promise<MisdatedOpen[]> {
  const rows = await misdatedOpenQuery(tx);
  return rows.map((row) => ({ incidentId: row.id, ...misdatedParams(row.params) }));
}

/** One `clock.records_misdated` alert's params, open or handled; null when the id names no alert
 * of that code. */
export async function readMisdatedEpisode(
  tx: Transaction,
  incidentId: string,
): Promise<MisdatedOpen | null> {
  const [row] = await tx
    .select({ id: incidents.id, params: incidents.params })
    .from(incidents)
    .where(and(eq(incidents.id, incidentId), eq(incidents.code, MISDATED)));
  return row === undefined ? null : { incidentId: row.id, ...misdatedParams(row.params) };
}

export const misdatedHandledCountQuery = (tx: Transaction) =>
  tx
    .select({ n: count() })
    .from(incidents)
    .where(and(eq(incidents.code, MISDATED), isNotNull(incidents.acknowledgedAt)));

export async function countMisdatedHandled(tx: Transaction): Promise<number> {
  const [row] = await misdatedHandledCountQuery(tx);
  return row!.n;
}

export const misdatedHandledQuery = (tx: Transaction) =>
  tx
    .select({
      id: incidents.id,
      params: incidents.params,
      handledAt: incidents.acknowledgedAt,
      handledBy: incidents.acknowledgedBy,
      note: incidents.acknowledgedNote,
      name: persons.displayName,
    })
    .from(incidents)
    .leftJoin(persons, eq(persons.id, incidents.acknowledgedBy))
    .where(and(eq(incidents.code, MISDATED), isNotNull(incidents.acknowledgedAt)))
    .orderBy(desc(incidents.detectedAt), desc(incidents.id));

/** Handled `clock.records_misdated` alerts, newest first by detection, with who handled them. */
export async function readMisdatedHandled(tx: Transaction): Promise<MisdatedHandled[]> {
  const rows = await misdatedHandledQuery(tx);
  return rows.map((row) => ({
    incidentId: row.id,
    ...misdatedParams(row.params),
    handledAt: row.handledAt!,
    handledBy: row.handledBy === null ? { kind: "box" } : { kind: "person", name: row.name },
    note: row.note,
  }));
}

const OUTBOX_WROTE = new Error("the fiscal outbox read changed rows");

export async function collectBoxHealth(
  db: Database,
  readers: BoxHealthReaders,
): Promise<BoxHealth> {
  const at = readers.now().toISOString();
  // Not `withTransaction`: its closing change-log drain is a write, which a full disk refuses.
  const rows = await db.withWriteLock(async () => {
    const [last] = await db
      .select({ issuedAt: sales.issuedAt })
      .from(sales)
      .orderBy(desc(sales.issuedAt))
      .limit(1);
    const printerRows = await db
      .select({ id: printers.id, name: printers.name })
      .from(printers)
      .where(and(eq(printers.active, true), isNull(printers.deletedAt)))
      .orderBy(asc(printers.name));
    const readerRows = readers.paymentsEnabled
      ? await db
          .select({ id: cardReaders.id, name: cardReaders.name })
          .from(cardReaders)
          .where(
            and(
              eq(cardReaders.active, true),
              isNull(cardReaders.deletedAt),
              ne(cardReaders.id, DEMO_READER_ID),
            ),
          )
          .orderBy(asc(cardReaders.name))
      : null;
    return {
      lastAt: last?.issuedAt ?? null,
      printers: printerRows,
      readers: readerRows,
      misdatedOpen: await readMisdatedOpen(db),
      misdatedHandledCount: await countMisdatedHandled(db),
    };
  });

  const readClockStop = readers.clockStop;
  const clockStop =
    readClockStop === undefined ? null : await db.withWriteLock(() => readClockStop(db));
  const readCheckWaiting = readers.clockCheckWaiting;
  const clockCheckWaiting =
    readCheckWaiting === undefined ? null : await db.withWriteLock(() => readCheckWaiting(db));

  const filing = readers.notices.filing();
  const noticeLog = readers.notices.log;
  const noticeRead = noticeLog.begin();
  const read = await readStaffNoticesInTurns(
    db,
    readers.notices.sources.map(({ owner, source }) => ({
      owner,
      source: { read: (ctx) => source.read({ ...ctx, filing: { enabled: filing } }) },
    })),
    { reading: readers.notices.clock.now(), log: noticeLog.log },
  );

  const noticesUnavailable = [...read.unavailable];
  let outbox: BoxHealth["outbox"] = null;
  const outboxReader = readers.outbox;
  const readsOutbox = filing && outboxReader !== undefined;
  if (readsOutbox) {
    const changes = () => db.all<{ n: number }>(sql`select total_changes() as n`)[0]!.n;
    try {
      // Thrown inside the turn, so whatever a writing read changed goes with it.
      const state = await db.withWriteLock(async () => {
        const before = changes();
        const answer = await outboxReader.read(db);
        if (changes() !== before) throw OUTBOX_WROTE;
        return answer;
      });
      outbox = { ...state, awaitingCertificate: outboxReader.awaitingCertificate() };
    } catch (error) {
      const errorCode = error === OUTBOX_WROTE ? "box_health.outbox_wrote" : codeOf(error);
      noticeLog.log("error", "staff_notice.source_unavailable", {
        owner: "fiscal-outbox",
        errorCode,
      });
      noticesUnavailable.push("fiscal-outbox");
    }
  }
  // An outbox this read did not try stays failing until a read that tries it succeeds.
  noticeRead.settle(readsOutbox ? noticesUnavailable : [...noticesUnavailable, "fiscal-outbox"]);

  const [usage, free, reclaimable, sync] = await Promise.all([
    readers.usage(),
    readers.free(),
    readers.leftovers(),
    readers.timeHealth(),
  ]);

  return {
    at,
    sales: { lastAt: rows.lastAt },
    notices: read.notices,
    noticesUnavailable,
    filing,
    outbox,
    stream: readers.stream(),
    clock: { authority: readers.authorityClock(), sync },
    printers: rows.printers,
    readers: rows.readers,
    canFree: readers.canFree(),
    disk: {
      ...usage,
      freeBytes: free,
      stoppedSince: readers.disk.since()?.toISOString() ?? null,
      lowSince: readers.space.current().lowSince?.toISOString() ?? null,
      reclaimable,
    },
    clockStop,
    clockCheckWaiting,
    misdatedOpen: rows.misdatedOpen,
    misdatedHandledCount: rows.misdatedHandledCount,
  };
}
