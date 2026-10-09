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
      wt-data-table::part(today) {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        align-items: flex-start;
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
      wt-data-table::part(badge) {
        color: var(--wt-color-text-muted);
        margin-inline-start: var(--wt-space-2);
      }
    `,
  ];
  @property({ attribute: false }) today: Readonly<Record<string, string | TemplateResult>> = {};
  @property({ attribute: false }) actions: Readonly<Record<string, TemplateResult>> = {};
  @property({ attribute: false }) stations: readonly PrepStation[] = [];
  /** Each station's printers and screens, or none at all for a person who may not read them. */
  @property({ attribute: false }) outputs?: Readonly<
    Record<string, { printedOn: string | TemplateResult; shownOn: string | TemplateResult }>
  >;

  #name(station: PrepStation) {
    return html`${this.actions[station.id] ?? nothing}<span
        part=${station.active ? "name" : "disabled"}
        >${station.name}</span
      >
      ${station.isDefault ? html`<span part="badge">${t("prep.default")}</span>` : nothing}
      ${station.active ? nothing : html`<span part="badge">${t("prep.health.disabled")}</span>`}`;
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
      {
        key: "today",
        label: t("prep.today_column"),
        cell: (station) => this.today[station.id] ?? "",
      },
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
