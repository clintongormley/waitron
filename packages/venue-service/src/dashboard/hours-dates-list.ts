import { css, html } from "lit";
import { visuallyHiddenStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import type { DateHoursCell, HoursModel, HoursModelSubject, SpecialDate } from "../hours-types.js";
import { addDays } from "../hours-rules.js";
import { dateValue, format, formatDate, keyOf, storedCells } from "./hours-view.js";
import { t } from "./strings.js";

type Key = Parameters<typeof t>[0];
type ReturnTo = () => HTMLElement | null;

interface ListRow {
  special: SpecialDate;
  cells: DateHoursCell[];
}

/** What the list needs from the page: its model and the editors it opens. */
export interface DatesListHost {
  model: HoursModel;
  readOnly: boolean;
  /** The columns shown, inactive ones only when asked for. */
  subjects: HoursModelSubject[];
  menuTrigger(event: Event): ReturnTo;
  edit(special: SpecialDate, returnTo: ReturnTo): void;
}

export const datesListStyles = css`
  a,
  wt-data-table::part(calendar-link) {
    color: var(--wt-color-primary-text);
  }

  wt-data-table::part(inherited),
  wt-data-table::part(colour-name) {
    color: var(--wt-color-text-muted);
  }
  wt-data-table::part(colour-name) {
    font-size: var(--wt-font-size-sm);
  }
  wt-data-table::part(colour-swatch) {
    display: inline-block;
    width: var(--wt-space-3);
    height: var(--wt-space-3);
    margin-inline: var(--wt-space-1);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-sm);
    vertical-align: middle;
  }
  wt-data-table::part(colour-red) {
    background: var(--wt-color-palette-red);
  }
  wt-data-table::part(colour-amber) {
    background: var(--wt-color-palette-amber);
  }
  wt-data-table::part(colour-grey) {
    background: var(--wt-color-palette-grey);
  }
  wt-data-table::part(colour-blue) {
    background: var(--wt-color-palette-blue);
  }
  wt-data-table::part(colour-green) {
    background: var(--wt-color-palette-green);
  }
  wt-data-table::part(colour-purple) {
    background: var(--wt-color-palette-purple);
  }
  wt-data-table::part(visually-hidden) {
    ${visuallyHiddenStyles}
  }
`;

function dateCell(host: DatesListHost, row: ListRow, subject: HoursModelSubject) {
  const { text, inherited } = dateValue(
    host.model,
    subject,
    row.special.date,
    row.special,
    row.cells,
  );
  if (!inherited) return text;
  return html`<span part="inherited"
    ><span part="visually-hidden">${t("hours.inherited_prefix")}</span>${text}</span
  >`;
}

function rowActions(host: DatesListHost, { special }: ListRow) {
  const action = (test: string, label: Key, run: (returnTo: ReturnTo) => void) =>
    html`<wt-button
      variant="secondary"
      data-test=${test}
      @click=${(event: Event) => run(host.menuTrigger(event))}
      >${t(label)}</wt-button
    >`;
  return html`<wt-row-actions label=${format("hours.row_actions", { name: special.name })}>
    ${action("edit-date", "hours.edit", (returnTo) => host.edit(special, returnTo))}
    <a part="calendar-link" data-test="duplicate-date" href="/manage/opening-hours/view/calendar"
      >${t("hours.duplicate")}</a
    >
    <a part="calendar-link" data-test="delete-date" href="/manage/opening-hours/view/calendar"
      >${t("hours.delete")}</a
    >
  </wt-row-actions>`;
}

export function renderDatesList(host: DatesListHost) {
  const actions: DataTableColumn<ListRow> = {
    key: "actions",
    label: t("hours.actions"),
    pinned: "end",
    cell: (row) => rowActions(host, row),
  };
  const columns: DataTableColumn<ListRow>[] = [
    { key: "date", label: t("hours.date"), cell: (row) => formatDate(row.special.date) },
    {
      key: "name",
      label: t("hours.name"),
      cell: (row) =>
        html`${row.special.name} <span part=${`colour-swatch colour-${row.special.colour}`}></span
          ><span part="colour-name">${t(`hours.colour.${row.special.colour}` as Key)}</span>`,
    },
    ...host.subjects.map((subject) => ({
      key: keyOf(subject),
      label: subject.active ? subject.name : `${subject.name} ${t("hours.inactive")}`,
      group: t("hours.stations"),
      cell: (row: ListRow) => dateCell(host, row, subject),
    })),
    ...(host.readOnly ? [] : [actions]),
  ];
  const from = host.model.civilDate === null ? null : addDays(host.model.civilDate, -1);
  const rows: ListRow[] = host.model.specialDates
    .filter((special) => !special.repeats && (from === null || special.date >= from))
    .map((special) => ({ special, cells: storedCells(host.model, special.id) }));
  return html`<p class="toolbar">
      <a data-test="calendar-link" href="/manage/opening-hours/view/calendar"
        >${t("hours.named_days_calendar")}</a
      >
    </p>
    <p class="note" data-test="repeating-days-note">${t("hours.repeating_days_week")}</p>
    <wt-data-table
      data-test="special-dates"
      aria-label=${t("hours.tab.named_days")}
      .columns=${columns}
      .rows=${rows}
      .rowKey=${(row: ListRow) => row.special.id}
      .emptyMessage=${t("hours.no_dates")}
    ></wt-data-table>`;
}
