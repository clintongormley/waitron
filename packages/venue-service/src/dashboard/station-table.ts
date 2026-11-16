import { t as tableText } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-data-table.js";
import type { PrepStation } from "./routing-client.js";
import { activeStationsInOrder } from "./station-show.js";
import { t } from "./strings.js";
import { STATION_COLOUR_TOKENS } from "./station-colour-styles.js";

@customElement("prep-station-table")
export class StationTable extends LitElement {
  static override styles = [
    baseStyles,
    unsafeCSS(
      Object.entries(STATION_COLOUR_TOKENS)
        .map(
          ([colour, { dot }]) =>
            `wt-data-table::part(station-colour-${colour}) { background: ${dot}; }`,
        )
        .join("\n"),
    ),
    css`
      :host {
        display: block;
        min-width: 0;
      }
      wt-data-table::part(table-head) {
        --wt-space-3: var(--wt-space-1);
      }
      wt-data-table::part(station-cell) {
        padding-inline: var(--wt-space-1);
      }
      wt-data-table::part(screens) {
        display: grid;
        gap: var(--wt-space-2);
        max-width: calc(var(--wt-tap-min) * 5);
        white-space: normal;
      }
      wt-data-table::part(station-name-content) {
        display: grid;
        grid-template-columns: max-content minmax(min-content, 1fr);
        align-items: center;
      }
      wt-data-table::part(station-name-details) {
        min-width: 0;
      }
      wt-data-table::part(station-colour) {
        display: inline-block;
        inline-size: var(--wt-space-4);
        block-size: var(--wt-space-4);
        margin-inline-end: var(--wt-space-2);
        border-radius: var(--wt-radius-sm);
        vertical-align: middle;
      }
      wt-data-table::part(station-status) {
        display: block;
        white-space: normal;
      }
      wt-data-table::part(devices-link) {
        color: var(--wt-color-primary-text);
      }
    `,
  ];
  @property({ attribute: false }) statusNotes: Readonly<Record<string, string | TemplateResult>> =
    {};
  @property({ attribute: false }) actions: Readonly<Record<string, TemplateResult>> = {};
  @property({ attribute: false }) stations: readonly PrepStation[] = [];
  @property({ type: Boolean }) disabled = false;
  @property({ attribute: false }) outputs: Readonly<
    Record<string, { printedOn: string | TemplateResult; shownOn: string | TemplateResult }>
  > = {};

  #name(station: PrepStation) {
    return html`<span part="station-name-content"
      ><span
        part=${`station-colour station-colour-${station.colour}`}
        data-station-colour=${station.colour}
        aria-hidden="true"
      ></span
      ><span part="station-name-details"
        ><span part="name">${station.name}</span>
        ${this.statusNotes[station.id] ? html`<span part="station-status">${this.statusNotes[station.id]}</span>` : nothing}
      </span></span
    >`;
  }
  #columns(): DataTableColumn<PrepStation>[] {
    const outputs = this.outputs;
    return [
      { key: "name", label: t("prep.name"), cell: (station) => this.#name(station) },
      {
        key: "printedOn",
        choosable: "shown",
        label: t("prep.printed_on"),
        cell: (station) =>
          html`<span data-test=${`printed-on-${station.id}`}
            >${outputs[station.id]?.printedOn}</span
          >`,
      },
      {
        key: "shownOn",
        choosable: "shown",
        label: t("prep.shown_on"),
        cell: (station) =>
          html`<span part="screens" data-test=${`screens-${station.id}`}
            >${outputs[station.id]?.shownOn}</span
          >`,
      },
      {
        key: "waitsForPass",
        choosable: "shown",
        label: t("prep.waits_for_pass"),
        help: { text: t("prep.waits_for_pass_hint"), label: t("prep.waits_for_pass") },
        cell: (station) =>
          html`<span data-test=${`waits-for-pass-${station.id}`}
            >${station.waitsForPass ? t("venue.yes") : t("venue.no")}</span
          >`,
      },
      {
        key: "actions",
        label: t("prep.actions"),
        pinned: "end",
        cell: (station) => this.actions[station.id] ?? nothing,
      },
    ];
  }
  override render() {
    const rows = activeStationsInOrder(this.stations);
    return html`<wt-data-table
      wrap-to-fit
      aria-label=${t("prep.title")}
      viewKey="waitron.prep-stations.table"
      customiseColumnsLabel=${tableText("table.customise_columns")}
      customiseLabel=${tableText("table.customise")}
      restoreColumnsLabel=${tableText("table.restore_columns")}
      doneLabel=${tableText("table.done")}
      moveColumnLabel=${tableText("table.move_column")}
      showColumnLabel=${tableText("table.show_column")}
      hideColumnLabel=${tableText("table.hide_column")}
      alwaysShownColumnLabel=${tableText("table.column_always_shown")}
      lastShownColumnLabel=${tableText("table.column_last_shown")}
      columnPositionLabel=${tableText("table.column_position")}
      data-test="station-table"
      .columns=${this.#columns()}
      .rows=${rows}
      .rowKey=${(station: PrepStation) => station.id}
      .rowCellParts=${() => "station-cell"}
      .rowClickLabel=${(station: PrepStation) => `${t("prep.edit_station")}: ${station.name}`}
      .rowClick=${
        this.disabled
          ? undefined
          : (station: PrepStation) =>
              this.dispatchEvent(
                new CustomEvent("station-edit", {
                  detail: { station },
                  bubbles: true,
                  composed: true,
                }),
              )
      }
      emptyMessage=${t("prep.stations_empty")}
    ></wt-data-table>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "prep-station-table": StationTable;
  }
}
