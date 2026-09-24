import { ContentLanguageController } from "@waitron/ui";
import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { metricStyles, renderMetric } from "../widgets/metric-row.js";
import {
  renderTopSellers,
  topSellersStyles,
  type TopSellersLabels,
} from "../widgets/top-sellers-table.js";
import type {
  CashUpDto,
  DailyCloseDto,
  DashboardApi,
  SalesPeriodDto,
  VatSummaryDto,
} from "../api/client.js";
import { today } from "../date-utils.js";

/**
 * A single day (`from === to`) shows the full daily close; a range shows a period roll-up of VAT and
 * top sellers only, because per-till cash-up does not roll up across days. A `from > to` range is left
 * for the server to reject.
 */
@customElement("dashboard-sales-screen")
export class SalesScreen extends LitElement {
  constructor() {
    super();
    new ContentLanguageController(this);
  }

  static override styles = [
    baseStyles,
    metricStyles,
    topSellersStyles,
    css`
      :host {
        display: block;
      }
      h1 {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      h2 {
        margin: var(--wt-space-4) 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text-muted);
      }
      .pickers {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-4);
        margin-bottom: var(--wt-space-4);
      }
      .picker {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        color: var(--wt-color-text);
      }
      input[type="date"] {
        font: inherit;
        padding: var(--wt-space-2);
        border-radius: var(--wt-radius-md);
        border: 1px solid var(--wt-color-border);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        color: var(--wt-color-text);
      }
      th,
      td {
        background: var(--wt-color-surface);
        border: 1px solid var(--wt-color-border);
        padding: var(--wt-space-2);
        text-align: left;
      }
      th.num,
      td.num {
        text-align: right;
      }
      .counts {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-4);
      }
      .metric {
        display: flex;
        gap: var(--wt-space-2);
        color: var(--wt-color-text);
      }
      .muted {
        color: var(--wt-color-text-muted);
        margin-top: var(--wt-space-3);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.errorKey = codeOf(error);
    },
  );

  @state() private from = today();
  @state() private to = today();
  @state() private close: DailyCloseDto | null = null;
  @state() private period: SalesPeriodDto | null = null;
  @state() private errorKey: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /** BOTH branches' state is cleared before the request, so a rejection can never leave a stale close
   * or period rendering beside the error banner. */
  async #load(): Promise<void> {
    this.errorKey = null;
    this.close = null;
    this.period = null;
    try {
      if (this.from === this.to) {
        this.#queries.release("getSalesPeriod");
        await this.#queries.watch("getDailyClose", [this.from], (value) => {
          this.close = value;
        });
      } else {
        this.#queries.release("getDailyClose");
        await this.#queries.watch("getSalesPeriod", [this.from, this.to], (value) => {
          this.period = value;
        });
      }
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  #onDateChange(field: "from" | "to", event: Event): void {
    event.stopPropagation();
    const value = (event.target as HTMLInputElement).value;
    // A cleared <input type=date> (value "") builds an Invalid Date → NaN; ignore it rather than
    // reloading with a bogus window.
    if (Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return;
    this[field] = value;
    void this.#load();
  }

  override render(): TemplateResult {
    return html`
      <h1>${t("sales.title")}</h1>
      <div class="pickers">
        <label class="picker"
          >${t("sales.from")}
          <input
            type="date"
            data-test="from-picker"
            .value=${this.from}
            @change=${(e: Event) => this.#onDateChange("from", e)}
          />
        </label>
        <label class="picker"
          >${t("sales.to")}
          <input
            type="date"
            data-test="to-picker"
            .value=${this.to}
            @change=${(e: Event) => this.#onDateChange("to", e)}
          />
        </label>
      </div>
      ${
        this.errorKey
          ? html`<p class="error" role="alert" data-test="error">${codeMessage(this.errorKey)}</p>`
          : nothing
      }
      ${this.close ? this.#renderClose(this.close) : nothing}
      ${this.period ? this.#renderPeriod(this.period) : nothing}
    `;
  }

  #renderClose(close: DailyCloseDto): TemplateResult {
    return html`
      <div data-test="daily-close">
        ${this.#renderTender(close.cash)} ${this.#renderVat(close.vat)}
        <h2>${t("sales.counts_title")}</h2>
        <div class="counts" data-test="counts">
          ${renderMetric(t("sales.sales"), String(close.counts.sales), "count-sales")}
          ${renderMetric(t("sales.corrections"), String(close.counts.corrections), "count-corrections")}
          ${renderMetric(t("sales.voids"), String(close.counts.voids), "count-voids")}
        </div>
        <h2>${t("sales.top_sellers_title")}</h2>
        ${renderTopSellers(close.topSellers, this.#topSellerLabels())}
      </div>
    `;
  }

  #renderPeriod(period: SalesPeriodDto): TemplateResult {
    return html`
      <div data-test="period">
        ${this.#renderVat(period.vat)}
        <h2>${t("sales.top_sellers_title")}</h2>
        ${renderTopSellers(period.topSellers, this.#topSellerLabels())}
        <p class="muted" data-test="period-note">${t("sales.period_note")}</p>
      </div>
    `;
  }

  #renderTender(cash: CashUpDto): TemplateResult {
    return html`
      <h2>${t("sales.tender_title")}</h2>
      <table data-test="tender-table">
        <thead>
          <tr>
            <th scope="col">${t("sales.till")}</th>
            <th scope="col">${t("sales.method")}</th>
            <th scope="col" class="num">${t("sales.amount")}</th>
            <th scope="col" class="num">${t("sales.tip")}</th>
          </tr>
        </thead>
        <tbody>
          ${cash.byTill.map((till) =>
            till.byMethod.map(
              (line) =>
                html`<tr data-test=${`tender-row-${till.tillId}-${line.method}`}>
                  <th scope="row">${till.tillId}</th>
                  <td>${line.method}</td>
                  <td class="num">${line.amount}</td>
                  <td class="num">${line.tip}</td>
                </tr>`,
            ),
          )}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colspan="2">${t("sales.tender_total")}</th>
            <td class="num" data-test="tender-total">${cash.tenderTotal}</td>
            <td class="num" data-test="tip-total">${cash.tipTotal}</td>
          </tr>
        </tfoot>
      </table>
    `;
  }

  #renderVat(vat: VatSummaryDto): TemplateResult {
    return html`
      <h2>${t("sales.vat_title")}</h2>
      <table data-test="vat-table">
        <thead>
          <tr>
            <th scope="col">${t("sales.rate")}</th>
            <th scope="col" class="num">${t("sales.base")}</th>
            <th scope="col" class="num">${t("sales.tax")}</th>
          </tr>
        </thead>
        <tbody>
          ${vat.byRate.map(
            (row) =>
              html`<tr data-test=${`vat-row-${row.rate}`}>
                <th scope="row">${row.rate}</th>
                <td class="num">${row.base}</td>
                <td class="num">${row.tax}</td>
              </tr>`,
          )}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">${t("sales.base_total")}</th>
            <td class="num" data-test="vat-base-total">${vat.baseTotal}</td>
            <td class="num" data-test="vat-tax-total">${vat.taxTotal}</td>
          </tr>
          <tr>
            <th scope="row" colspan="2">${t("sales.gross_total")}</th>
            <td class="num" data-test="vat-gross-total">${vat.grossTotal}</td>
          </tr>
        </tfoot>
      </table>
    `;
  }

  /** This screen's `sales.*` labels for the shared top-sellers table (the namespace is deliberately
   * not shared with the overview's `overview.*` keys). */
  #topSellerLabels(): TopSellersLabels {
    return {
      title: t("sales.top_sellers_title"),
      quantity: t("sales.quantity"),
      total: t("sales.total"),
      empty: t("sales.empty_sellers"),
      emptyTest: "empty",
    };
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-sales-screen": SalesScreen;
  }
}
