import { css, html } from "lit";
import type { AttendanceChange, CorrectionItem } from "@waitron/dashboard-modules";
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

export { dayEditorRows, previewDayMinutes } from "@waitron/dashboard-modules";
