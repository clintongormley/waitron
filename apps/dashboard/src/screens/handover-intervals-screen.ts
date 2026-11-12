import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { guideHref } from "../help-guide.js";
import type { DashboardApi, HandoverInterval, ReturnedInvoiceRecord } from "../api/client.js";

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
      .returned-invoices {
        margin-top: var(--wt-space-5);
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

  @state() private invoiceRows: ReturnedInvoiceRecord[] = [];
  @state() private invoiceLoading = true;
  @state() private invoiceError: string | null = null;
  @state() private invoiceOffset = 0;
  @state() private invoiceNext: number | null = null;
  @state() private invoiceZone = "";

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
    void this.#loadInvoices(0);
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
  async #loadInvoices(offset: number): Promise<void> {
    this.invoiceLoading = true;
    this.invoiceError = null;
    try {
      const result = await this.api.listReturnedInvoices(offset);
      this.invoiceRows = result.records;
      this.invoiceOffset = offset;
      this.invoiceNext = result.nextOffset;
      this.invoiceZone = result.timeZone;
    } catch (error) {
      this.invoiceError = codeOf(error);
    } finally {
      this.invoiceLoading = false;
    }
  }
  #invoiceColumns(): DataTableColumn<ReturnedInvoiceRecord>[] {
    return [
      {
        key: "source",
        label: t("handover_intervals.source"),
        cell: (row) => html`<span part="value">${row.sourceName}<br />${row.sourceNodeId}</span>`,
      },
      {
        key: "chain",
        label: t("returned_invoices.chain"),
        cell: (row) =>
          html`<span part="value"
            >${row.installation}<br />${row.generationId}<br />${fill("returned_invoices.position", { sequence: row.sequence })}</span
          >`,
      },
      {
        key: "invoice",
        label: t("returned_invoices.invoice"),
        cell: (row) =>
          html`<span part="value"
            >${row.invoiceNumber}<br />${row.issueDate}<br />${row.kind === "cancellation" ? t("returned_invoices.cancellation") : row.kind}</span
          >`,
      },
      {
        key: "record",
        label: t("returned_invoices.record"),
        cell: (row) =>
          html`<span part="value"
            >${row.recordId}<br />${fill("returned_invoices.sale", { id: row.saleId })}${row.correctsRecordId ? html`<br />${fill("returned_invoices.corrects", { id: row.correctsRecordId })}` : ""}</span
          >`,
      },
      ...(["taxable", "gross", "tax"] as const).map((key) => ({
        key,
        label: t(`returned_invoices.${key}`),
        cell: (row: ReturnedInvoiceRecord) => row[key] ?? t("returned_invoices.not_recorded"),
      })),
      {
        key: "receivedAt",
        label: t("returned_invoices.received"),
        cell: (row) => this.#time(row.receivedAt, this.invoiceZone),
      },
    ];
  }
  #time(value: number | string | null, timeZone = this.timeZone): string {
    if (value === null) return t("handover_intervals.unknown");
    return new Intl.DateTimeFormat(currentLocale(), {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
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
        key: "receipt",
        label: t("handover_intervals.receipt"),
        cell: (row) =>
          html`<span part="value"
            >${t(row.inventoryReceived ? "handover_intervals.received" : "handover_intervals.not_received")}</span
          >`,
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
      ></wt-data-table>
      <section class="returned-invoices">
        <h2 id="returned-invoices-title">${t("returned_invoices.title")}</h2>
        <p>${t("returned_invoices.tracking")}</p>
        <p>
          ${this.invoiceZone ? fill("handover_intervals.zone", { zone: this.invoiceZone }) : ""}
        </p>
        <div class="controls">
          <wt-button
            data-invoices="refresh"
            .disabled=${this.invoiceLoading}
            @click=${() => void this.#loadInvoices(0)}
            >${t("returned_invoices.refresh")}</wt-button
          >
          <wt-button
            data-invoices="previous"
            .disabled=${this.invoiceLoading || this.invoiceOffset === 0}
            @click=${() => void this.#loadInvoices(Math.max(0, this.invoiceOffset - 100))}
            >${t("returned_invoices.previous")}</wt-button
          >
          <wt-button
            data-invoices="next"
            .disabled=${this.invoiceLoading || this.invoiceNext === null}
            @click=${() => void this.#loadInvoices(this.invoiceNext!)}
            >${t("returned_invoices.next")}</wt-button
          >
        </div>
        <wt-data-table
          aria-label=${t("returned_invoices.title")}
          .rows=${this.invoiceRows}
          .columns=${this.#invoiceColumns()}
          .rowKey=${(row: ReturnedInvoiceRecord) => row.recordId}
          .loading=${this.invoiceLoading}
          .loadingMessage=${t("returned_invoices.loading")}
          .emptyMessage=${this.invoiceError === null ? t("returned_invoices.empty") : ""}
          .errorMessage=${this.invoiceError === null ? "" : codeMessage(this.invoiceError)}
        ></wt-data-table>
      </section>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-handover-intervals-screen": HandoverIntervalsScreen;
  }
}
