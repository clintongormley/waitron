import { css, html } from "lit";
import {
  effectiveClockEntries,
  originalEntry,
  projectWorkSessions,
  type AttendanceChange,
  type AttendanceDayView,
  type CorrectionItem,
} from "@waitron/dashboard-modules";
import { hoursDate } from "../hours-format.js";
import { fill } from "../i18n/t.js";
import { wallClock } from "../date-utils.js";

export const attendanceDisputeStyles = css`
  .dispute-comparison {
    display: flex;
    flex-wrap: wrap;
    gap: var(--wt-space-2) var(--wt-space-4);
  }
  .dispute-comparison blockquote {
    flex-basis: 100%;
    margin: 0;
    color: var(--wt-color-text-muted);
  }
`;

export function renderDisputeComparison(item: CorrectionItem, date: string) {
  const list = (changes: AttendanceChange[]) =>
    changes
      .map(({ at, offsetMinutes }) => {
        const clock = wallClock(at, offsetMinutes);
        return clock.date === date ? clock.time : `${hoursDate(clock.date)}, ${clock.time}`;
      })
      .join(" · ");
  const reply = item.history
    .filter(
      (entry) =>
        item.responseEntryIds.includes(entry.entryId) && entry.correctionStatus === "disputed",
    )
    .at(-1);
  return html`<div class="dispute-comparison" data-dispute-comparison>
    <p>${fill("attendance.manager_proposed_times", { times: list(item.changes) })}</p>
    ${item.workerVersion?.changes.length ? html`<p>${fill("attendance.worker_version_times", { times: list(item.workerVersion.changes) })}</p>` : ""}
    ${reply?.correctionReason ? html`<blockquote>${reply.correctionReason}</blockquote>` : ""}
  </div>`;
}

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
