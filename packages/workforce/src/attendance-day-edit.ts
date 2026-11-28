import type { AttendanceChange, AttendanceDayView } from "./attendance-contract.js";
import { effectiveClockEntries, originalEntry } from "./effective-entries.js";
import { projectWorkSessions } from "./projection.js";

export { effectiveClockEntries, originalEntry, projectWorkSessions };

export function dayEditorRows(view: AttendanceDayView, requested: AttendanceChange[]) {
  const retimes = new Map(
    requested.flatMap((change) =>
      "entryId" in change.target ? [[change.target.entryId, change] as const] : [],
    ),
  );
  return [
    ...view.record.entries
      .filter((row) => row.effective)
      .sort((a, b) => a.entry.eventAt.localeCompare(b.entry.eventAt))
      .map(
        ({ entry }) =>
          retimes.get(entry.entryId) ?? {
            target: { entryId: entry.entryId },
            at: entry.eventAt,
            offsetMinutes: entry.offsetMinutes,
          },
      ),
    ...requested.filter((change) => "missingKind" in change.target),
  ];
}

export function previewDayMinutes(view: AttendanceDayView, changes: AttendanceChange[]): number {
  const entries = view.record.entries.map(({ entry }) => entry);
  const byId = new Map(entries.map((entry) => [entry.entryId, entry]));
  const effective = new Map(effectiveClockEntries(entries).map((entry) => [entry.entryId, entry]));
  const candidate = changes.flatMap<(typeof entries)[number]>(
    ({ target, at, offsetMinutes }, sequenceNo) => {
      if ("missingKind" in target)
        return [
          {
            personId: view.personId,
            entryId: `added-${sequenceNo}`,
            entryKind: target.missingKind,
            nodeId: "",
            sequenceNo,
            recordedAt: at,
            eventAt: at,
            offsetMinutes,
          },
        ];
      const entry = effective.get(target.entryId);
      return entry
        ? [
            {
              ...entry,
              correctsEntryId: null,
              eventAt: at,
              offsetMinutes,
              extension: originalEntry(entry, byId).extension ?? null,
            },
          ]
        : [];
    },
  );
  return projectWorkSessions(candidate, view.paidBreakPolicy)
    .filter((session) => session.workDate === view.date)
    .reduce((total, session) => total + session.workedMinutes, 0);
}
