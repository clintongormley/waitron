import { withTransaction, type Database } from "@waitron/db";
import { and, eq, sql } from "drizzle-orm";
import { attendanceDayWork, processAttendanceDay } from "@waitron/workforce";
import { discoverAttendanceDays, nextAttendanceDay } from "./attendance-discovery.js";
import { readAttendanceFacts, readPlannedAttendanceShifts } from "./attendance-facts.js";
import { realSleep } from "./loop.js";

export type AttendancePassDeps = {
  db: Database;
  nodeId: string;
  locationId: string;
  now: () => Date;
  isPrimary: () => boolean;
};
export type AttendanceLoopDeps = AttendancePassDeps & {
  signal: AbortSignal;
  onError: (error: unknown) => void;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

export async function runAttendancePass(
  deps: AttendancePassDeps,
): Promise<{ processed: boolean; more: boolean }> {
  if (!deps.isPrimary()) return { processed: false, more: false };
  return withTransaction(deps.db, async (tx) => {
    if (!deps.isPrimary()) return { processed: false, more: false };
    const now = deps.now();
    const scope = { locationId: deps.locationId, now };
    const discovery = await discoverAttendanceDays(tx, { ...scope, batchSize: 100 });
    const day = await nextAttendanceDay(tx, scope);
    let appended = false;
    if (day !== null) {
      const result = await processAttendanceDay(tx, {
        day,
        nodeId: deps.nodeId,
        now,
        facts: await readAttendanceFacts(tx, day),
        planned: await readPlannedAttendanceShifts(tx, day),
      });
      // The next bounded scan still needs to consume the new legal clock row.
      appended = result.automaticEntryIds.length > 0;
    }
    const [remaining] = await tx
      .select({ id: attendanceDayWork.id })
      .from(attendanceDayWork)
      .where(
        and(
          eq(attendanceDayWork.locationId, deps.locationId),
          sql`${attendanceDayWork.nextDueAt} <= ${now.toISOString()}`,
          sql`${attendanceDayWork.endAt} <= ${now.toISOString()}`,
          sql`(${attendanceDayWork.dirtyRevision} > ${attendanceDayWork.evaluatedRevision} or json_array_length(${attendanceDayWork.deferredShiftIds}) > 0)`,
        ),
      )
      .limit(1);
    return { processed: day !== null, more: appended || discovery.more || remaining !== undefined };
  });
}

export async function runAttendanceLoop(deps: AttendanceLoopDeps): Promise<void> {
  const sleep = deps.sleep ?? realSleep;
  while (!deps.signal.aborted) {
    let more = true;
    try {
      more = (await runAttendancePass(deps)).more;
    } catch (error) {
      deps.onError(error);
    }
    if (deps.signal.aborted) break;
    try {
      await sleep(more ? 500 : 30_000, deps.signal);
    } catch (error) {
      deps.onError(error);
    }
  }
}
