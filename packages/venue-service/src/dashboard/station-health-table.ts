import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-modal.js";
import type {
  PrepStation,
  StationHealth,
  StationHealthItem,
  StationHealthSnapshot,
} from "./routing-client.js";
import { t } from "./strings.js";

type Population = "waiting" | "preparing" | "ready" | "warm" | "overdue" | "forgotten" | "oldest";

@customElement("prep-station-health-table")
export class StationHealthTable extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      wt-data-table::part(number) {
        border: 0;
        background: transparent;
        color: var(--wt-color-primary-text);
        font: inherit;
        cursor: pointer;
        text-decoration: underline;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
      }
      wt-data-table::part(warm) {
        color: var(--wt-color-warning);
      }
      wt-data-table::part(overdue),
      wt-data-table::part(forgotten) {
        color: var(--wt-color-danger);
      }
      wt-data-table::part(forgotten) {
        font-weight: var(--wt-font-weight-bold);
      }
      wt-data-table::part(disabled) {
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(problem) {
        color: var(--wt-color-danger);
        margin-block: var(--wt-space-1);
      }
      wt-data-table::part(badge) {
        color: var(--wt-color-text-muted);
        margin-inline-start: var(--wt-space-2);
      }
    `,
  ];
  @property({ attribute: false }) snapshot?: StationHealthSnapshot;
  @property({ attribute: false }) today: Readonly<Record<string, string>> = {};
  @property({ attribute: false }) stations: readonly PrepStation[] = [];
  @state() private selection?: { stationId: string; population: Population };

  #label(population: Population) {
    return t(`prep.health.${population}`);
  }
  #number(row: StationHealth, population: Population, value: number | null) {
    if (value === null)
      return population === "oldest" ? t("prep.none") : t("prep.health.no_screen");
    return html`<button
      type="button"
      part=${`number ${population}`}
      data-test=${`${population}-${row.id}`}
      aria-label=${`${row.name}: ${this.#label(population)} ${value}${population === "oldest" ? ` ${t("prep.health.minutes")}` : ""}`}
      @click=${() => {
        this.selection = { stationId: row.id, population };
      }}
    >
      ${value}${population === "oldest" ? ` ${t("prep.health.minutes")}` : ""}
    </button>`;
  }
  #items(row: StationHealth, population: Population): StationHealthItem[] {
    return row.items
      .filter((item) => {
        if (population === "oldest") return true;
        if (population === "waiting") return !row.hasScreen || item.state === "queued";
        if (population === "preparing" || population === "ready") return item.state === population;
        return item.band === population;
      })
      .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt) || a.orderNumber - b.orderNumber);
  }
  #name(row: StationHealth) {
    const station = this.stations.find((station) => station.id === row.id);
    const printers =
      this.snapshot?.outputsDown.printersDown.filter((problem) => problem.stationId === row.id) ??
      [];
    const screens =
      this.snapshot?.outputsDown.screensDark.filter((problem) => problem.stationId === row.id) ??
      [];
    return html`<span part=${station?.active === false ? "disabled" : "name"}>${row.name}</span>
      ${station?.isDefault ? html`<span part="badge">${t("prep.default")}</span>` : nothing}
      ${station?.active === false ? html`<span part="badge">${t("prep.health.disabled")}</span>` : nothing}
      ${printers.map((problem) => html`<p part="problem">${t("prep.printer_down").replace("{printer}", problem.printerName).replace("{time}", this.#time(problem.since))}</p>`)}
      ${screens.map((problem) => html`<p part="problem">${problem.lastSeenAt ? t("prep.screen_dark").replace("{time}", this.#time(problem.lastSeenAt)) : t("prep.screen_never")}</p>`)}`;
  }
  #time(value: string) {
    return new Date(value).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  #columns(): DataTableColumn<StationHealth>[] {
    return [
      { key: "name", label: t("prep.name"), cell: (row) => this.#name(row) },
      { key: "today", label: t("prep.today_column"), cell: (row) => this.today[row.id] ?? "" },
      ...(["waiting", "preparing", "ready"] as const).map((population) => ({
        key: population,
        label: this.#label(population),
        cell: (row: StationHealth) => this.#number(row, population, row[population]),
      })),
      {
        key: "late",
        label: t("prep.health.late"),
        cell: (row) =>
          html` ${(["warm", "overdue", "forgotten"] as const).map((band) => this.#number(row, band, row.late[band]))}`,
      },
      {
        key: "oldest",
        label: this.#label("oldest"),
        cell: (row) => this.#number(row, "oldest", row.oldestMinutes),
      },
    ];
  }
  #details() {
    const selection = this.selection;
    const row = this.snapshot?.stations.find((station) => station.id === selection?.stationId);
    if (!selection || !row) return nothing;
    const columns: DataTableColumn<StationHealthItem>[] = [
      { key: "name", label: t("prep.health.dish"), cell: (item) => item.name },
      {
        key: "quantity",
        label: t("prep.health.remaining"),
        cell: (item) => item.remainingQuantity,
      },
      {
        key: "order",
        label: t("prep.health.order"),
        cell: (item) => `${item.orderNumber}${item.label ? ` · ${item.label}` : ""}`,
      },
      { key: "tables", label: t("prep.health.tables"), cell: (item) => item.tableNames.join(", ") },
      { key: "sent", label: t("prep.health.sent"), cell: (item) => this.#time(item.queuedAt) },
      {
        key: "state",
        label: t("prep.health.state"),
        cell: (item) => this.#label(item.state === "queued" ? "waiting" : item.state),
      },
    ];
    return html`<wt-modal
      open
      heading=${`${row.name} · ${this.#label(selection.population)}`}
      @wt-close=${() => {
        this.selection = undefined;
      }}
    >
      <wt-data-table
        aria-label=${`${row.name} · ${this.#label(selection.population)}`}
        data-test="health-details"
        .columns=${columns}
        .rows=${this.#items(row, selection.population)}
        .rowKey=${(item: StationHealthItem) => item.id}
        emptyMessage=${t("prep.health.empty")}
      ></wt-data-table>
    </wt-modal>`;
  }
  override render() {
    if (!this.snapshot) return html`<p role="status">${t("prep.health.loading")}</p>`;
    const metadata = new Map(this.stations.map((station) => [station.id, station]));
    const rows = [...(this.snapshot?.stations ?? [])].sort((a, b) => {
      const left = metadata.get(a.id),
        right = metadata.get(b.id);
      return (
        Number(left?.active === false) - Number(right?.active === false) ||
        (left?.displayOrder ?? 0) - (right?.displayOrder ?? 0) ||
        a.name.localeCompare(b.name)
      );
    });
    return html`<wt-data-table
        aria-label=${t("prep.title")}
        data-test="health-summary"
        .columns=${this.#columns()}
        .rows=${rows}
        .rowKey=${(row: StationHealth) => row.id}
        emptyMessage=${t("prep.health.empty")}
      ></wt-data-table
      >${this.#details()}`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "prep-station-health-table": StationHealthTable;
  }
}
