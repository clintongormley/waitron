import type { Transaction } from "@waitron/db";
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
  const notices: OwnedStaffNotice[] = [];
  const unavailable: string[] = [];
  for (const { owner, source } of sources) {
    try {
      // A savepoint per source, so a failed source's own writes go with it. Its answer is read
      // inside it too, so an answer that throws while being read counts as a failed source.
      const found = await tx.transaction(async () =>
        Array.from(
          await source.read({ tx, reading: deps.reading }),
          // `key` is named so that a null in the answer throws here; the spread keeps later fields.
          (notice): OwnedStaffNotice => ({ ...notice, key: notice.key, owner }),
        ),
      );
      for (const notice of found) {
        if (notices.some((kept) => kept.owner === owner && kept.key === notice.key)) {
          deps.log("error", "staff_notice.duplicate_key", { owner, key: notice.key });
          continue;
        }
        notices.push(notice);
      }
    } catch (error) {
      deps.log("error", "staff_notice.source_unavailable", { owner, errorCode: codeOf(error) });
      if (!unavailable.includes(owner)) unavailable.push(owner);
    }
  }
  return { notices: notices.sort((a, b) => RANK[a.severity] - RANK[b.severity]), unavailable };
}
