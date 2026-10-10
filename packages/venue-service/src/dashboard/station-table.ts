import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-data-table.js";
import type { PrepStation } from "./routing-client.js";
import { t } from "./strings.js";

@customElement("prep-station-table")
export class StationTable extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      wt-data-table::part(station-grip) {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        border: 0;
        border-radius: var(--wt-radius-md);
        background: transparent;
        color: var(--wt-color-text);
        cursor: var(--reorder-drag-cursor, grab);
        touch-action: none;
      }
      wt-data-table::part(disabled) {
        color: var(--wt-color-text-muted);
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
      wt-data-table::part(station-name-actions) {
        display: inline-flex;
        align-items: center;
      }
      wt-data-table::part(station-name-details) {
        min-width: 0;
      }
      wt-data-table::part(station-status),
      wt-data-table::part(service-times) {
        display: block;
        white-space: normal;
      }
      wt-data-table::part(service-times) {
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
  /** Each station's printers and screens. */
  @property({ attribute: false }) outputs?: Readonly<
    Record<string, { printedOn: string | TemplateResult; shownOn: string | TemplateResult }>
  >;

  #name(station: PrepStation) {
    return html`<span part="station-name-content"
      ><span part="station-name-actions">${this.actions[station.id] ?? nothing}</span
      ><span part="station-name-details"
        ><span part=${station.active ? "name" : "disabled"}>${station.name}</span>
        ${station.isDefault ? html`<span part="badge">${t("prep.default")}</span>` : nothing}
        ${this.statusNotes[station.id] ? html`<span part="station-status">${this.statusNotes[station.id]}</span>` : nothing}
        ${station.active && !station.isDefault ? html`<a part="service-times" aria-label=${`${station.name}: ${t("prep.when_gets_orders")}`} href=${`/manage/opening-hours?view=week&station=${encodeURIComponent(station.id)}`}>${t("prep.when_gets_orders")}</a>` : nothing}</span
      ></span
    >`;
  }
  #columns(): DataTableColumn<PrepStation>[] {
    const outputs = this.outputs;
    return [
      { key: "name", label: t("prep.name"), cell: (station) => this.#name(station) },
      ...(outputs
        ? [
            {
              key: "printedOn",
              label: t("prep.printed_on"),
              cell: (station: PrepStation) =>
                html`<span data-test=${`printed-on-${station.id}`}
                  >${outputs[station.id]?.printedOn}</span
                >`,
            },
            {
              key: "shownOn",
              label: t("prep.shown_on"),
              cell: (station: PrepStation) =>
                html`<span part="screens" data-test=${`screens-${station.id}`}
                  >${outputs[station.id]?.shownOn}</span
                >`,
            },
          ]
        : []),
    ];
  }
  override render() {
    const rows = [...this.stations].sort(
      (a, b) =>
        Number(!a.active) - Number(!b.active) ||
        a.displayOrder - b.displayOrder ||
        a.name.localeCompare(b.name),
    );
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
