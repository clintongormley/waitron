import { css, html, nothing } from "lit";
import type { LocalDate } from "../hours-types.js";
import { addDays } from "../hours-rules.js";
import { format, formatWeekTitleParts } from "./hours-view.js";
import { t } from "./strings.js";

export const calendarSelectionStyles = css`
  .calendar-selection {
    position: sticky;
    inset-block-end: 0;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--wt-space-2);
    margin-block-start: var(--wt-space-2);
    padding: var(--wt-space-3);
    border: var(--wt-field-line-width) solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    background: var(--wt-color-surface-raised);
    box-shadow: var(--wt-shadow-1);
  }
  .calendar-selection .summary {
    flex: 1 1 auto;
    overflow-wrap: anywhere;
  }
`;

export function calendarSelection(options: {
  dates: readonly LocalDate[];
  clear: () => void;
  open: () => void;
}) {
  const { dates, clear, open } = options;
  if (dates.length < 2) return nothing;
  const runs: [LocalDate, LocalDate][] = [];
  for (const date of dates) {
    const last = runs.at(-1);
    if (last && addDays(last[1], 1) === date) last[1] = date;
    else runs.push([date, date]);
  }
  const summary = runs
    .map(([from, to]) =>
      formatWeekTitleParts(from, to)
        .map(({ text }) => text)
        .join(""),
    )
    .join(" · ");
  return html`<div
    class="calendar-selection"
    data-test="selection-bar"
    role="region"
    aria-label=${t("calendar.selection")}
  >
    <span class="summary" aria-live="polite"
      >${format("calendar.selection_count", { count: String(dates.length) })} · ${summary}</span
    >
    <wt-button variant="secondary" data-test="clear-selection" @click=${clear}
      >${t("calendar.clear_selection")}</wt-button
    >
    <wt-button variant="primary" data-test="open-selection" @click=${open}
      >${t("day.make_special")}</wt-button
    >
  </div>`;
}
