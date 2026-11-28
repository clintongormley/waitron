import { inArray } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { DayApproval } from "./attendance-contract.js";
import { projectCorrectionItems } from "./attendance-responses.js";
import { dayApprovalsForPerson } from "./day-approvals.js";
import { groupByPerson, type Period, type TimeEntryRecord } from "./projection.js";
import { entryDate } from "./record-period.js";
import { readRecordedEntriesForPeople } from "./record-reads.js";
import type { TimeRecord } from "./record-types.js";
import { attendanceAnswers } from "./schema/attendance-responses.js";

export interface RecordDayStatus {
  personId: string;
  date: string;
  status: DayApproval["status"] | "disputed";
}

export async function readRecordDayStatuses(
  tx: Transaction,
  record: TimeRecord,
  context: TimeEntryRecord[],
  period: Period,
): Promise<RecordDayStatus[]> {
  const entriesByPerson = groupByPerson(record.entries.map(({ entry }) => entry));
  const days = new Map<string, RecordDayStatus>();
  const remember = (personId: string, date: string, status: RecordDayStatus["status"]) =>
    days.set(`${personId}/${date}`, { personId, date, status });
  for (const [personId, sessions] of groupByPerson(record.sessions)) {
    const approvals = dayApprovalsForPerson(entriesByPerson.get(personId) ?? []);
    for (const { workDate } of sessions)
      remember(personId, workDate, approvals.get(workDate)?.status ?? "pending");
  }
  const disputedPeople = [
    ...new Set(
      context
        .filter((entry) => entry.correctionStatus === "disputed")
        .map((entry) => entry.personId),
    ),
  ];
  if (disputedPeople.length > 0) {
    // A dispute can refer to a shift that started before the entries read for this export.
    const history = groupByPerson(await readRecordedEntriesForPeople(tx, disputedPeople));
    const commands = groupByPerson(
      await tx
        .select()
        .from(attendanceAnswers)
        .where(inArray(attendanceAnswers.personId, disputedPeople)),
    );
    for (const [personId, entries] of history) {
      for (const item of projectCorrectionItems(entries, commands.get(personId) ?? [])) {
        if (item.status !== "disputed") continue;
        const first = item.changes[0]!;
        const date =
          item.date ?? entryDate({ eventAt: first.at, offsetMinutes: first.offsetMinutes });
        if (date >= period.start && date < period.end) remember(personId, date, "disputed");
      }
    }
  }
  return [...days.values()].sort(
    (a, b) => a.personId.localeCompare(b.personId) || a.date.localeCompare(b.date),
  );
}
