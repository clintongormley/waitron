import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { devices, printers, sales, type Database, type Transaction } from "@waitron/db";
import type { ClockStopState, ClockWitness, FiscalBackend, TrustedClock } from "@waitron/fiscal";
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

/** The fiscal seat's clock stop as the Box status page shows it: the restart names its person, and
 * each device witness carries its label. */
export interface ClockStopView extends Omit<ClockStopState, "restart" | "proof" | "contrary"> {
  restart: { personName: string | null; restartedAt: string; clockAt: string } | null;
  proof: { authority: ClockWitness | null; devices: ClockStopWitness[] };
  contrary: { authority: ClockWitness | null; devices: ClockStopWitness[] };
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

/** Reads the seat's clock stop at the box's reading, with device labels and the restart's person
 * named. A seat with no `clockStopState` has none. */
export function clockStopReader(deps: {
  backend: Pick<FiscalBackend, "clockStopState">;
  witnesses: () => readonly ClockWitness[];
  clock: Pick<TrustedClock, "now">;
}): (db: Database) => Promise<ClockStopView | null> {
  return async (db) => {
    const state = await readClockStopState(db, deps);
    if (state === null) return null;
    const ids = [...state.proof.devices, ...state.contrary.devices].map((witness) => witness.id);
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
    let restart: ClockStopView["restart"] = null;
    if (state.restart !== null) {
      const { personId, restartedAt, clockAt } = state.restart;
      restart = { personName: await displayNameOf(db, personId), restartedAt, clockAt };
    }
    return {
      ...state,
      restart,
      proof: { authority: state.proof.authority, devices: labelled(state.proof.devices) },
      contrary: { authority: state.contrary.authority, devices: labelled(state.contrary.devices) },
    };
  };
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
    return { lastAt: last?.issuedAt ?? null, printers: printerRows, readers: readerRows };
  });

  const readClockStop = readers.clockStop;
  const clockStop =
    readClockStop === undefined ? null : await db.withWriteLock(() => readClockStop(db));

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
  };
}
