import { createHash } from "node:crypto";
import type { Transaction } from "@waitron/db";
import { holds, readPersonAuthority } from "@waitron/identity";
import { AppError, type Origin } from "@waitron/shared";
import type { DayApproval } from "./attendance-contract.js";
import { appendToChain } from "./chain.js";
import { maySelfApproveAttendance } from "./corrections.js";
import {
  compareEvents,
  compareRecording,
  effectiveClockEntries,
  isClockEntry,
} from "./effective-entries.js";
import type { TimeEntryRecord } from "./projection.js";
import type { ClockEntryKind } from "./record-types.js";
import { isRecordDate } from "./record-dates.js";
import { entryDate } from "./record-period.js";
import { readPeriodEntries } from "./record-reads.js";
import "./errors.js";

interface ShiftTimes {
  date: string;
  times: (TimeEntryRecord & { entryKind: ClockEntryKind })[];
}

function finishedDays(entries: readonly TimeEntryRecord[]): Map<string, ShiftTimes> {
  const finished = new Map<string, ShiftTimes>();
  let shift: ShiftTimes | undefined;
  for (const event of effectiveClockEntries(entries).sort(compareEvents)) {
    if (!isClockEntry(event)) continue;
    if (event.entryKind === "in") {
      shift = { date: entryDate(event), times: [event] };
    } else if (shift !== undefined) {
      shift.times.push(event);
      if (event.entryKind === "out") {
        const day = finished.get(shift.date);
        if (day === undefined) finished.set(shift.date, shift);
        else for (const time of shift.times) day.times.push(time);
        shift = undefined;
      }
    }
  }
  if (shift !== undefined) finished.delete(shift.date);
  return finished;
}

export function approvalsForPerson(entries: readonly TimeEntryRecord[]) {
  const latest = new Map<string, TimeEntryRecord>();
  for (const entry of entries) {
    if (entry.entryKind !== "day_approval") continue;
    const date = entryDate(entry);
    const earlier = latest.get(date);
    if (earlier === undefined || compareRecording(entry, earlier) > 0) latest.set(date, entry);
  }
  return new Map(
    Array.from(finishedDays(entries), ([date, { times }]) => {
      const first = times[0]!;
      const digest = createHash("sha256")
        .update(JSON.stringify([first.personId, date, times.map((time) => time.entryId)]))
        .digest("hex")
        .toUpperCase();
      const status: DayApproval["status"] =
        latest.get(date)?.extension?.approvalDigest === digest ? "approved" : "pending";
      return [date, { first, times, approval: { status, digest } }];
    }),
  );
}

export function dayApprovalsForPerson(
  entries: readonly TimeEntryRecord[],
): Map<string, DayApproval> {
  return new Map(
    Array.from(approvalsForPerson(entries), ([date, { approval }]) => [date, approval]),
  );
}

interface ApprovalActor {
  nodeId: string;
  actorPersonId: string;
  origin: Origin;
  now: Date;
}
export async function approveAttendanceDay(
  tx: Transaction,
  input: ApprovalActor & { personId: string; date: string; digest: string },
): Promise<void> {
  const { personId, date, digest, actorPersonId } = input;
  const selfApproved = personId === actorPersonId;
  const allowed = selfApproved
    ? await maySelfApproveAttendance(tx, actorPersonId)
    : holds(await readPersonAuthority(tx, actorPersonId), "workforce.correct");
  if (!allowed) throw new AppError("attendance.not_permitted", { personId: actorPersonId });

  if (!isRecordDate(date))
    throw new AppError("attendance.invalid", { reason: "record_scope_or_period" });
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const end = next.toISOString().slice(0, 10);
  if (!isRecordDate(end))
    throw new AppError("attendance.invalid", { reason: "record_scope_or_period" });
  const entries = await readPeriodEntries(tx, { personId, period: { start: date, end } });
  const day = approvalsForPerson(entries).get(date);
  if (day === undefined || day.approval.digest !== digest)
    throw new AppError("attendance.state_changed", {});
  await writeAttendanceDayApproval(tx, input, day);
}

export async function writeAttendanceDayApproval(
  tx: Transaction,
  { nodeId, actorPersonId, origin, now }: ApprovalActor,
  day: { first: TimeEntryRecord; approval: DayApproval },
): Promise<void> {
  if (day.approval.status === "approved") return;
  const { personId } = day.first;
  await appendToChain(
    tx,
    { nodeId },
    {
      personId,
      entryKind: "day_approval",
      eventAt: day.first.eventAt,
      eventOffsetMinutes: day.first.offsetMinutes,
      recordedByPersonId: actorPersonId,
      origin,
      extension: {
        selfApproved: personId === actorPersonId,
        authorKind: "manager",
        direction: null,
        missingEntryKind: null,
        respondsToEntryId: null,
        payPeriodClosureId: null,
        approvalDigest: day.approval.digest,
      },
    },
    () => now,
  );
}
