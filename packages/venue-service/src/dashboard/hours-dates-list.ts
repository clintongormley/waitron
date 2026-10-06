// The Hours page's special-dates list, drawn in the page's own shadow root.
import { css, html, nothing } from "lit";
import { visuallyHiddenStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import type { DateHoursCell, HoursModel, HoursModelSubject, SpecialDate } from "../hours-types.js";
import { format } from "./hours-cell-editor.js";
import { dateValue, formatDate, keyOf, storedCells } from "./hours-view.js";
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
  /** The shadow root the list is drawn in, where its buttons are found to return focus to. */
  root: ParentNode;
  menuTrigger(event: Event): ReturnTo;
  add(returnTo: ReturnTo, closeWholeVenue: boolean): void;
  edit(special: SpecialDate, returnTo: ReturnTo): void;
  duplicate(special: SpecialDate, returnTo: ReturnTo): void;
  remove(special: SpecialDate, returnTo: ReturnTo): void;
}

export const datesListStyles = css`
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
    ${action("duplicate-date", "hours.duplicate", (returnTo) => host.duplicate(special, returnTo))}
    ${action("delete-date", "hours.delete", (returnTo) => host.remove(special, returnTo))}
  </wt-row-actions>`;
}

/** Every current and future special date, one row each, with the week's columns. */
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
      group: t(subject.kind === "department" ? "hours.departments" : "hours.stations"),
      cell: (row: ListRow) => dateCell(host, row, subject),
    })),
    ...(host.readOnly ? [] : [actions]),
  ];
  const rows: ListRow[] = host.model.specialDates.map((special) => ({
    special,
    cells: storedCells(host.model, special.id),
  }));
  const trigger = (test: string) => () =>
    host.root.querySelector<HTMLElement>(`[data-test="${test}"]`);
  return html`${
      host.readOnly
        ? nothing
        : html`<div class="toolbar">
            <div>
              <wt-button
                variant="primary"
                data-test="add-date"
                @click=${() => host.add(trigger("add-date"), false)}
                >${t("hours.add_date")}</wt-button
              >
              <wt-button
                variant="secondary"
                data-test="close-venue"
                @click=${() => host.add(trigger("close-venue"), true)}
                >${t("hours.close_venue")}</wt-button
              >
            </div>
          </div>`
    }
    <wt-data-table
      data-test="special-dates"
      aria-label=${t("hours.tab.dates")}
      .columns=${columns}
      .rows=${rows}
      .rowKey=${(row: ListRow) => row.special.id}
      .emptyMessage=${t("hours.no_dates")}
    ></wt-data-table>`;
}
