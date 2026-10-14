import type { Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { businessDayAt, businessDayBounds } from "@waitron/shared";
import { timeEntries } from "@waitron/workforce";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";

export type TillClockStatus = "out" | "working" | "on_break";

export interface TillClockState {
  personId: string;
  locationId: string;
  businessDay: string;
  state: TillClockStatus;
  activeLocationId: string | null;
  lastEntryId: string | null;
  firstClockIn: boolean;
}

type LiveKind = "in" | "out" | "break_start" | "break_end";
const stateAfter: Record<LiveKind, TillClockStatus> = {
  in: "working",
  out: "out",
  break_start: "on_break",
  break_end: "working",
};

// Live admission excludes targeted retimes; the hours projection applies those separately.
const liveEntry = sql`(${timeEntries.entryKind} in ('in','out','break_start','break_end')
  or (${timeEntries.entryKind} = 'correction' and ${timeEntries.correctionStatus} = 'approved'
    and ${timeEntries.correctsEntryId} is null and ${timeEntries.missingEntryKind} is not null))`;
const liveKind = sql<LiveKind>`case when ${timeEntries.entryKind} = 'correction'
  then ${timeEntries.missingEntryKind} else ${timeEntries.entryKind} end`;

export async function readTillClockState(
  tx: Transaction,
  scope: { personId: string; locationId: string },
  at: Date,
): Promise<TillClockState> {
  const clock = await readLocationClock(tx, scope.locationId);
  const businessDay = businessDayAt(clock, at);
  const bounds = businessDayBounds(clock, businessDay);
  const [latest] = await tx
    .select({
      id: timeEntries.id,
      locationId: timeEntries.locationId,
      kind: liveKind,
    })
    .from(timeEntries)
    .where(and(eq(timeEntries.personId, scope.personId), liveEntry))
    .orderBy(
      desc(timeEntries.eventAt),
      desc(timeEntries.recordedAt),
      desc(timeEntries.nodeId),
      desc(timeEntries.sequenceNo),
      desc(timeEntries.id),
    )
    .limit(1);
  const [clockedIn] = await tx
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.personId, scope.personId),
        eq(timeEntries.locationId, scope.locationId),
        liveEntry,
        sql`${liveKind} = 'in'`,
        gte(timeEntries.eventAt, bounds.startAt),
        lt(timeEntries.eventAt, bounds.endAt),
      ),
    )
    .limit(1);
  const state = latest === undefined ? "out" : stateAfter[latest.kind];
  return {
    personId: scope.personId,
    locationId: scope.locationId,
    businessDay,
    state,
    activeLocationId: state === "out" ? null : latest!.locationId,
    lastEntryId: latest?.id ?? null,
    firstClockIn: clockedIn === undefined,
  };
}
