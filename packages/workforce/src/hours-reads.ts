import { asc } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { persons } from "@waitron/identity";
import { AppError, businessDayAt, type BusinessDayClock } from "@waitron/shared";
import type {
  HoursDay,
  HoursOpenShift,
  HoursSelection,
  ManagerHours,
  PersonHours,
} from "./attendance-contract.js";
import { readAttendanceInbox } from "./attendance-reads.js";
import { compareEvents, compareRecording, effectiveClockEntries } from "./effective-entries.js";
import { readClosures } from "./pay-period-reads.js";
import { readPayPeriodSettings, resolvePayPeriod } from "./pay-periods.js";
import type { Period, TimeEntryRecord } from "./projection.js";
import { isRecordDate } from "./record-dates.js";
import { projectTimeRecord, recordRoot } from "./record-projection.js";
import { readRecordedEntries, readTimeRecord } from "./record-reads.js";
import "./errors.js";

interface HoursInput {
  locationId: string;
  selection: HoursSelection;
  clock: BusinessDayClock;
  now: Date;
}
const invalid = () => new AppError("attendance.invalid", { reason: "record_scope_or_period" });
function dateString(date: Date): string {
  const value = date.toISOString().slice(0, 10);
  if (!isRecordDate(value)) throw invalid();
  return value;
}
function nextDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return dateString(value);
}
async function windowFor(
  tx: Transaction,
  input: HoursInput,
): Promise<{ period: Period; businessDay: string }> {
  if (
    typeof input.locationId !== "string" ||
    !input.locationId ||
    input.selection === null ||
    typeof input.selection !== "object" ||
    !["week", "month", "pay-period"].includes(input.selection.kind) ||
    (input.selection.date !== undefined && !isRecordDate(input.selection.date))
  )
    throw invalid();
  const businessDay = businessDayAt(input.clock, input.now);
  const date = input.selection.date === undefined ? businessDay : input.selection.date;
  if (!isRecordDate(date)) throw invalid();
  if (input.selection.kind === "pay-period") {
    const saved = await readClosures(tx, {
      locationId: input.locationId,
      period: { start: date, end: nextDate(date) },
    });
    return {
      businessDay,
      period: saved[0]?.period ?? resolvePayPeriod(await readPayPeriodSettings(tx), date),
    };
  }
  const start = new Date(`${date}T00:00:00Z`);
  const end = new Date(start);
  if (input.selection.kind === "week") {
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    end.setTime(start.getTime());
    end.setUTCDate(end.getUTCDate() + 7);
  } else {
    start.setUTCDate(1);
    end.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + 1);
  }
  return { businessDay, period: { start: dateString(start), end: dateString(end) } };
}
function openShiftsFor(entries: TimeEntryRecord[]): HoursOpenShift[] {
  let open: HoursOpenShift | undefined;
  for (const entry of effectiveClockEntries(entries).sort(compareEvents)) {
    switch (entry.entryKind) {
      case "in":
        open = { start: entry, breakStart: null };
        break;
      case "out":
        open = undefined;
        break;
      case "break_start":
        if (open) open.breakStart = entry;
        break;
      case "break_end":
        if (open) open.breakStart = null;
        break;
    }
  }
  return open === undefined ? [] : [open];
}
async function personInWindow(
  tx: Transaction,
  input: HoursInput & { personId: string },
  window: { period: Period; businessDay: string },
): Promise<PersonHours> {
  const { personId, locationId } = input;
  if (typeof personId !== "string" || !personId) throw invalid();
  const { period, businessDay } = window;
  const entries = await readRecordedEntries(tx, { personId, locationId });
  const record = await readTimeRecord(tx, { personId, locationId, period });
  const inbox = await readAttendanceInbox(tx, personId);
  const fullRecord = projectTimeRecord(entries);
  const openShifts = openShiftsFor(entries);
  const pending = {
    prompts: inbox.prompts.filter((p) => p.locationId === locationId),
    items: inbox.items.filter(
      (i) =>
        i.locationId === locationId &&
        ["waiting-manager", "waiting-worker", "disputed"].includes(i.status),
    ),
    automaticEntryIds: fullRecord.entries
      .filter(
        (row) =>
          row.effective &&
          row.author.kind === "automatic" &&
          !row.confirmedByWorker &&
          row.entry.entryKind === "out",
      )
      .map((row) => row.entry.entryId),
  };
  const byId = new Map(entries.map((e) => [e.entryId, e]));
  const extraRoots = new Set(
    [
      ...pending.prompts.flatMap((p) => p.history),
      ...pending.items.flatMap((i) => i.history),
      ...entries.filter((e) => pending.automaticEntryIds.includes(e.entryId)),
      ...openShifts.flatMap((s) => entries.filter((e) => compareEvents(e, s.start) >= 0)),
    ].map((e) => recordRoot(e, byId).entryId),
  );
  const shown = new Set(record.entries.map((e) => e.entry.entryId));
  record.entries.push(
    ...fullRecord.entries.filter(
      (e) => !shown.has(e.entry.entryId) && extraRoots.has(recordRoot(e.entry, byId).entryId),
    ),
  );
  record.entries.sort((a, b) => compareRecording(a.entry, b.entry));
  const days: HoursDay[] = [];
  for (let date = period.start; date < period.end; date = nextDate(date)) {
    const sessions = record.sessions.filter((s) => s.workDate === date);
    days.push({
      date,
      sessions,
      workedMinutes: sessions.reduce((sum, s) => sum + s.workedMinutes, 0),
    });
  }
  const saved = await readClosures(tx, { locationId, period });
  const closures = record.closures.map((view) => {
    const closure = saved.find((row) => row.id === view.closureId)!;
    return {
      closureId: view.closureId,
      period: closure.period,
      clock: closure.clock,
      scheduledCloseAt: closure.scheduledCloseAt,
      closedAt: closure.closedAt,
      closureHash: closure.closureHash,
      frozenWorkedMinutes: view.snapshot.sessions.reduce((sum, s) => sum + s.workedMinutes, 0),
    };
  });
  return {
    personId,
    locationId,
    selection: { ...input.selection },
    period,
    businessDay,
    clock: input.clock,
    asOf: input.now.toISOString(),
    days,
    workedMinutes: days.reduce((sum, d) => sum + d.workedMinutes, 0),
    record,
    openShifts,
    pending,
    closures,
  };
}
export async function readPersonHours(
  tx: Transaction,
  input: HoursInput & { personId: string },
): Promise<PersonHours> {
  return personInWindow(tx, input, await windowFor(tx, input));
}
export async function readManagerHours(tx: Transaction, input: HoursInput): Promise<ManagerHours> {
  const window = await windowFor(tx, input);
  const rows = await tx
    .select({ personId: persons.id, displayName: persons.displayName })
    .from(persons)
    .orderBy(asc(persons.displayName), asc(persons.id));
  const people: ManagerHours["people"] = [];
  for (const row of rows)
    people.push({
      ...row,
      hours: await personInWindow(tx, { ...input, personId: row.personId }, window),
    });
  return {
    locationId: input.locationId,
    selection: { ...input.selection },
    ...window,
    asOf: input.now.toISOString(),
    people,
  };
}
