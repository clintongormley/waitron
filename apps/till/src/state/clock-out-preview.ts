import { localCalendarDate, timeZoneOffsetMinutes } from "@waitron/shared";
import type { AttendanceDayView } from "@waitron/workforce/attendance-contract";
import { projectWorkSessions, type TimeEntryRecord } from "@waitron/workforce/projection";
import type { TillClockState } from "../api/attendance-api.js";

export function clockOutDate(state: TillClockState): string | null {
  const start = state.shiftStart;
  return start === null ? null : localCalendarDate(new Date(start.eventAt), start.offsetMinutes);
}

export function clockOutPreview(view: AttendanceDayView, state: TillClockState, now: Date) {
  if (
    view.personId !== state.personId ||
    view.date !== clockOutDate(state) ||
    state.state === "out"
  )
    return null;
  const entries = [
    ...view.record.entries.map(({ entry }) => entry),
    ...(view.clockOutPreviewEntries ?? []),
  ];
  const eventAt = now.toISOString();
  const recordedAt = new Date(
    entries.reduce((latest, entry) => Math.max(latest, Date.parse(entry.recordedAt) + 1), +now),
  ).toISOString();
  const proposed: TimeEntryRecord = {
    entryId: "preview-out",
    personId: state.personId,
    nodeId: "preview",
    entryKind: "out",
    eventAt,
    recordedAt,
    offsetMinutes: timeZoneOffsetMinutes(view.timeZone, now),
    sequenceNo: 1,
  };
  if (state.state === "on_break")
    entries.push({
      ...proposed,
      entryId: "preview-break-end",
      entryKind: "break_end",
      sequenceNo: 0,
    });
  const sessions = projectWorkSessions([...entries, proposed], view.paidBreakPolicy);
  if (sessions.at(-1)?.endedAt !== eventAt || sessions.at(-1)?.workDate !== view.date) return null;
  return sessions.filter((session) => session.workDate === view.date);
}
