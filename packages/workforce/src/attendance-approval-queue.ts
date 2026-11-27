import type { Transaction } from "@waitron/db";
import { holds, readPersonAuthority } from "@waitron/identity";
import { AppError, type Origin } from "@waitron/shared";
import type { AttendanceDayApprovalTarget, AttendanceManagerQueue } from "./attendance-contract.js";
import { projectCorrectionItems } from "./attendance-responses.js";
import { maySelfApproveAttendance } from "./corrections.js";
import { approvalsForPerson, writeAttendanceDayApproval } from "./day-approvals.js";
import { entryDate } from "./record-period.js";
import { recordRoot } from "./record-projection.js";
import { readRecordedEntries } from "./record-reads.js";
import { attendanceAnswers } from "./schema/attendance-responses.js";
import "./errors.js";

async function readManagerQueue(tx: Transaction) {
  const entries = await readRecordedEntries(tx, {});
  const commands = await tx.select().from(attendanceAnswers);
  const items = projectCorrectionItems(entries, commands).filter(
    (item) =>
      item.status === "waiting-manager" ||
      item.status === "waiting-worker" ||
      item.status === "disputed",
  );
  const pendingByPerson = Map.groupBy(items, (item) => item.personId);
  const byId = new Map(entries.map((entry) => [entry.entryId, entry]));
  const days = new Map(
    Array.from(
      Map.groupBy(entries, (entry) => entry.personId),
      ([personId, own]) => {
        const openChanges = pendingByPerson.get(personId)?.flatMap((item) => item.history) ?? [];
        const days = approvalsForPerson(own);
        if (openChanges.length === 0) return [personId, days];
        const dateByRoot = new Map<string, string>();
        for (const [date, { times }] of days) {
          for (const time of times) dateByRoot.set(recordRoot(time, byId).entryId, date);
        }
        const workDays = [...days];
        for (const entry of openChanges) {
          const linkedDate = dateByRoot.get(recordRoot(entry, byId).entryId);
          // A missing time can fall inside an overnight shift without being linked to an entry.
          const enclosingDate =
            linkedDate ??
            workDays.find(
              ([, { times }]) =>
                entry.eventAt >= times[0]!.eventAt && entry.eventAt <= times.at(-1)!.eventAt,
            )?.[0];
          days.delete(enclosingDate ?? entryDate(entry));
        }
        return [personId, days];
      },
    ),
  );
  return { items, days };
}

export async function readAttendanceManagerQueue(tx: Transaction): Promise<AttendanceManagerQueue> {
  const { items, days } = await readManagerQueue(tx);
  const finishedDays: AttendanceManagerQueue["finishedDays"] = [];
  for (const [personId, own] of days) {
    for (const [date, { approval, times }] of own) {
      if (approval.status === "approved") continue;
      finishedDays.push({
        personId,
        date,
        digest: approval.digest,
        times: times.map((time) => ({
          kind: time.entryKind,
          at: time.eventAt,
          offsetMinutes: time.offsetMinutes,
          automatic: time.extension?.authorKind === "automatic",
        })),
      });
    }
  }
  finishedDays.sort((a, b) => b.date.localeCompare(a.date) || a.personId.localeCompare(b.personId));
  return { items, finishedDays };
}

export async function approveAttendanceDays(
  tx: Transaction,
  input: {
    days: AttendanceDayApprovalTarget[];
    actorPersonId: string;
    nodeId: string;
    now: Date;
    origin: Origin;
  },
): Promise<void> {
  const { actorPersonId } = input;
  const allowed = holds(await readPersonAuthority(tx, actorPersonId), "workforce.correct");
  const includesOwnDay = input.days.some(({ personId }) => personId === actorPersonId);
  if (!allowed || (includesOwnDay && !(await maySelfApproveAttendance(tx, actorPersonId))))
    throw new AppError("attendance.not_permitted", { personId: actorPersonId });

  const { days } = await readManagerQueue(tx);
  const seen = new Set<string>();
  const confirmed = input.days.map(({ personId, date, digest }) => {
    const key = `${personId}/${date}`;
    if (seen.has(key))
      throw new AppError("attendance.invalid", { reason: "duplicate_approval_day" });
    seen.add(key);
    const day = days.get(personId)?.get(date);
    if (day?.approval.digest !== digest) throw new AppError("attendance.state_changed", {});
    return day;
  });
  for (const day of confirmed) await writeAttendanceDayApproval(tx, input, day);
}
