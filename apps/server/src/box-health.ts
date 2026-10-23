import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import { printers, sales, type Database } from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
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
import type { Transaction } from "@waitron/db";
import { codeOf } from "@waitron/server-kit";
import { sql } from "drizzle-orm";

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
  noticeRead.settle(read.unavailable);

  const noticesUnavailable = [...read.unavailable];
  let outbox: BoxHealth["outbox"] = null;
  const outboxReader = readers.outbox;
  if (filing && outboxReader !== undefined) {
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
      noticeLog.log("error", "box_health.outbox_failed", { errorCode });
      noticesUnavailable.push("fiscal-outbox");
    }
  }

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
  };
}
