import { sql } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import type {
  StaffNotice,
  StaffNoticeReadContext,
  StaffNoticeSeverity,
  StaffNoticeSource,
} from "@waitron/module";
import { codeOf, type Logger } from "@waitron/server-kit";

export interface OwnedStaffNoticeSource {
  readonly owner: string;
  readonly source: StaffNoticeSource;
}

/** A notice as the reader returns it: identified by `owner` and `key` together. */
export interface OwnedStaffNotice extends StaffNotice {
  readonly owner: string;
}

export interface StaffNoticeReadDeps {
  readonly reading: StaffNoticeReadContext["reading"];
  readonly log: Logger;
}

export interface StaffNoticesRead {
  readonly notices: OwnedStaffNotice[];
  /** Owners with a source that failed, each once, in the order first met. */
  readonly unavailable: string[];
}

const RANK = { error: 0, warning: 1, notice: 2 } as const satisfies Record<
  StaffNoticeSeverity,
  number
>;

export async function readStaffNotices(
  tx: Transaction,
  sources: readonly OwnedStaffNoticeSource[],
  deps: StaffNoticeReadDeps,
): Promise<StaffNoticesRead> {
  // A savepoint per source, so a failed source's own writes go with it. Its answer is read inside
  // it too, so an answer that throws while being read counts as a failed source.
  return collect(sources, deps, ({ owner, source }) =>
    tx.transaction(async () => stamped(await source.read({ tx, reading: deps.reading }), owner)),
  );
}

const SOURCE_WROTE = new Error("a staff notice source changed rows");

/** Asks each source in a write-lock turn of its own, with no change-log drain, so one source's
 * failure — a full disk included — and anything it wrote go with its own turn. A source that
 * changes any row fails. Same order, owners, duplicate rule and log lines as `readStaffNotices`. */
export async function readStaffNoticesInTurns(
  db: Database,
  sources: readonly OwnedStaffNoticeSource[],
  deps: StaffNoticeReadDeps,
): Promise<StaffNoticesRead> {
  const changes = () => db.all<{ n: number }>(sql`select total_changes() as n`)[0]!.n;
  return collect(sources, deps, ({ owner, source }) =>
    db.withWriteLock(async () => {
      const before = changes();
      const found = stamped(await source.read({ tx: db, reading: deps.reading }), owner);
      if (changes() !== before) throw SOURCE_WROTE;
      return found;
    }),
  );
}

function stamped(answer: readonly StaffNotice[], owner: string): OwnedStaffNotice[] {
  // `key` is named so that a null in the answer throws here; the spread keeps later fields.
  return Array.from(answer, (notice): OwnedStaffNotice => ({ ...notice, key: notice.key, owner }));
}

async function collect(
  sources: readonly OwnedStaffNoticeSource[],
  deps: StaffNoticeReadDeps,
  ask: (source: OwnedStaffNoticeSource) => Promise<OwnedStaffNotice[]>,
): Promise<StaffNoticesRead> {
  const notices: OwnedStaffNotice[] = [];
  const unavailable: string[] = [];
  for (const entry of sources) {
    const { owner } = entry;
    try {
      const found = await ask(entry);
      for (const notice of found) {
        if (notices.some((kept) => kept.owner === owner && kept.key === notice.key)) {
          deps.log("error", "staff_notice.duplicate_key", { owner, key: notice.key });
          continue;
        }
        notices.push(notice);
      }
    } catch (error) {
      const errorCode = error === SOURCE_WROTE ? "staff_notice.source_wrote" : codeOf(error);
      deps.log("error", "staff_notice.source_unavailable", { owner, errorCode });
      if (!unavailable.includes(owner)) unavailable.push(owner);
    }
  }
  return { notices: notices.sort((a, b) => RANK[a.severity] - RANK[b.severity]), unavailable };
}

export interface StaffNoticeLog {
  /** Hand this to a reader as its `log`. */
  readonly log: Logger;
  /** After each read, with its `unavailable`: notes each owner that has stopped failing. */
  settle(unavailable: readonly string[]): void;
}

/** Wraps `log` so a source that fails on every read is logged once per spell of failing, and each
 * repeated key once. Other events pass through. */
export function createStaffNoticeLog(log: Logger): StaffNoticeLog {
  const failing = new Set<string>();
  const duplicates = new Set<string>();
  return {
    log(level, event, fields) {
      if (event === "staff_notice.source_unavailable") {
        const owner = String(fields?.owner);
        if (failing.has(owner)) return;
        failing.add(owner);
      } else if (event === "staff_notice.duplicate_key") {
        const id = JSON.stringify([fields?.owner, fields?.key]);
        if (duplicates.has(id)) return;
        duplicates.add(id);
      }
      log(level, event, fields);
    },
    settle(unavailable) {
      for (const owner of failing) {
        if (unavailable.includes(owner)) continue;
        failing.delete(owner);
        log("info", "staff_notice.source_recovered", { owner });
      }
    },
  };
}
