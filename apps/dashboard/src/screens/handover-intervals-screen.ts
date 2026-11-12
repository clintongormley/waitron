import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { guideHref } from "../help-guide.js";
import type { DashboardApi, HandoverInterval } from "../api/client.js";

@customElement("dashboard-handover-intervals-screen")
export class HandoverIntervalsScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      h2 {
        font-size: var(--wt-font-size-lg);
        margin: 0 0 var(--wt-space-4);
      }
      p {
        margin: 0 0 var(--wt-space-3);
      }
      a {
        color: var(--wt-color-primary-text);
      }
      .controls {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        margin-bottom: var(--wt-space-4);
      }
      wt-data-table::part(value) {
        white-space: normal;
        overflow-wrap: anywhere;
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @state() private rows: HandoverInterval[] = [];
  @state() private timeZone = "";
  @state() private loading = true;
  @state() private error: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }
  async #load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const result = await this.api.listHandoverIntervals();
      this.rows = result.intervals;
      this.timeZone = result.timeZone;
    } catch (error) {
      this.error = codeOf(error);
    } finally {
      this.loading = false;
    }
  }
  #time(value: number | string | null): string {
    if (value === null) return t("handover_intervals.unknown");
    return new Intl.DateTimeFormat(currentLocale(), {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: this.timeZone,
    }).format(new Date(value));
  }
  #columns(): DataTableColumn<HandoverInterval>[] {
    return [
      {
        key: "source",
        label: t("handover_intervals.source"),
        cell: (row) => html`<span part="value">${row.sourceName}</span>`,
      },
      {
        key: "destination",
        label: t("handover_intervals.destination"),
        cell: (row) => html`<span part="value">${row.destinationName}</span>`,
      },
      {
        key: "copy",
        label: t("handover_intervals.copy"),
        cell: (row) => this.#time(row.lastChangeAtMs),
      },
      {
        key: "declared",
        label: t("handover_intervals.declared"),
        cell: (row) => this.#time(row.declaredAtMs),
      },
      {
        key: "activated",
        label: t("handover_intervals.activated"),
        cell: (row) => this.#time(row.activatedAt),
      },
      {
        key: "reason",
        label: t("handover_intervals.reason"),
        cell: (row) => html`<span part="value">${row.reason}</span>`,
      },
    ];
  }
  override render() {
    return html` <h2>${t("handover_intervals.title")}</h2>
      <p>${t("handover_intervals.unconfirmed")}</p>
      <p>${this.timeZone ? fill("handover_intervals.zone", { zone: this.timeZone }) : ""}</p>
      <div class="controls">
        <wt-button .disabled=${this.loading} @click=${() => void this.#load()}
          >${t("handover_intervals.refresh")}</wt-button
        >
        <a href=${guideHref("servers.reconciliation")} target="_blank" rel="noopener"
          >${t("handover_intervals.guide")}</a
        >
      </div>
      <wt-data-table
        aria-label=${t("handover_intervals.title")}
        .rows=${this.rows}
        .columns=${this.#columns()}
        .rowKey=${(row: HandoverInterval) => row.operationId}
        .loading=${this.loading}
        .loadingMessage=${t("handover_intervals.loading")}
        .emptyMessage=${this.error === null ? t("handover_intervals.empty") : ""}
        .errorMessage=${this.error === null ? "" : codeMessage(this.error)}
      ></wt-data-table>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-handover-intervals-screen": HandoverIntervalsScreen;
  }
}
