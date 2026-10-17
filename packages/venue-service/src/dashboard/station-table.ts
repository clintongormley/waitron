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
      wt-data-table::part(screens) {
        display: grid;
        gap: var(--wt-space-2);
        max-width: calc(var(--wt-tap-min) * 5);
        white-space: normal;
      }
      wt-data-table::part(station-name-content) {
        display: grid;
        grid-template-columns: max-content minmax(0, 1fr);
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
      wt-data-table::part(station-status),
      wt-data-table::part(service-times) {
        display: block;
        white-space: normal;
      }
      wt-data-table::part(service-times),
      wt-data-table::part(devices-link) {
        color: var(--wt-color-primary-text);
      }
      wt-data-table::part(badge) {
        color: var(--wt-color-text-muted);
        margin-inline-start: var(--wt-space-2);
      }
    `,
  ];
  @property({ attribute: false }) statusNotes: Readonly<Record<string, string | TemplateResult>> =
    {};
  @property({ attribute: false }) actions: Readonly<Record<string, TemplateResult>> = {};
  @property({ attribute: false }) stations: readonly PrepStation[] = [];
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
        ${station.isDefault ? html`<span part="badge">${t("prep.default")}</span>` : nothing}
        ${this.statusNotes[station.id] ? html`<span part="station-status">${this.statusNotes[station.id]}</span>` : nothing}
        ${!station.isDefault ? html`<a part="service-times" aria-label=${`${station.name}: ${t("prep.when_gets_orders")}`} href=${`/manage/prep-stations/view/times/station/${encodeURIComponent(station.id)}`}>${t("prep.when_gets_orders")}</a>` : nothing}</span
      ></span
    >`;
  }
  #columns(): DataTableColumn<PrepStation>[] {
    const outputs = this.outputs;
    return [
      { key: "name", label: t("prep.name"), cell: (station) => this.#name(station) },
      {
        key: "printedOn",
        label: t("prep.printed_on"),
        cell: (station) =>
          html`<span data-test=${`printed-on-${station.id}`}
            >${outputs[station.id]?.printedOn}</span
          >`,
      },
      {
        key: "shownOn",
        label: t("prep.shown_on"),
        cell: (station) =>
          html`<span part="screens" data-test=${`screens-${station.id}`}
            >${outputs[station.id]?.shownOn}</span
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
      aria-label=${t("prep.title")}
      data-test="station-table"
      .columns=${this.#columns()}
      .rows=${rows}
      .rowKey=${(station: PrepStation) => station.id}
      emptyMessage=${t("prep.stations_empty")}
    ></wt-data-table>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "prep-station-table": StationTable;
  }
}
