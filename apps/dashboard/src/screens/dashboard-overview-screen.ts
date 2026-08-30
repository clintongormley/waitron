import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-card.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { metricStyles, renderMetric } from "../widgets/metric-row.js";
import { renderTopSellers, type TopSellersLabels } from "../widgets/top-sellers-table.js";
import type { DashboardApi, SalesOverview } from "../api/client.js";

/**
 * The management dashboard's BUSINESS-OVERVIEW HOME SCREEN (design §3 — "today at a glance"): the
 * post-login landing for non-staff roles (registered in Task 9). It reads this node's TODAY figures
 * once via `api.getSalesOverview()` and lays them out as `wt-card`s — takings, record counts, open
 * tables, and a top-sellers list. Read-only: it authors nothing.
 *
 * Money fields arrive pre-formatted as decimal strings from the server and are rendered verbatim
 * (there is no client-side currency formatter in this app; §Task-7 brief). Top-seller names come from
 * a per-locale `descriptions` map resolved through the shared {@link localizedName} helper. Every
 * async path is `try/catch`ed into the `errorKey` banner (the roster-screen pattern).
 */
@customElement("dashboard-overview-screen")
export class OverviewScreen extends LitElement {
  static override styles = [
    baseStyles,
    metricStyles,
    css`
      :host {
        display: block;
      }
      h1 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      h2 {
        margin: 0;
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text-muted);
      }
      .business-day {
        margin: 0 0 var(--wt-space-4);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
        gap: var(--wt-space-4);
      }
      .metric {
        display: flex;
        justify-content: space-between;
        gap: var(--wt-space-4);
        padding: var(--wt-space-1) 0;
        color: var(--wt-color-text);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        color: var(--wt-color-text);
      }
      th,
      td {
        padding: var(--wt-space-1) var(--wt-space-2);
        text-align: left;
        border-bottom: 1px solid var(--wt-color-border);
      }
      th.num,
      td.num {
        text-align: right;
      }
      .muted {
        color: var(--wt-color-text-muted);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;

  @state() private overview: SalesOverview | null = null;
  @state() private errorKey: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /** Load today's overview into `overview`. A rejection anywhere becomes the error banner. */
  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      this.overview = await this.api.getSalesOverview();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  override render(): TemplateResult {
    return html`
      <h1>${t("overview.title")}</h1>
      ${
        this.errorKey
          ? html`<p class="error" role="alert" data-test="error">${codeMessage(this.errorKey)}</p>`
          : nothing
      }
      ${this.overview ? this.#renderOverview(this.overview) : nothing}
    `;
  }

  #renderOverview(overview: SalesOverview): TemplateResult {
    const { takings, counts, openTables } = overview;
    return html`
      <p class="business-day" data-test="business-day">${overview.businessDay}</p>
      <div class="cards">
        <wt-card data-test="takings">
          <h2 slot="header">${t("overview.takings_title")}</h2>
          ${renderMetric(t("overview.tender_total"), takings.tenderTotal, "tender-total")}
          ${renderMetric(t("overview.tips"), takings.tipTotal, "tip-total")}
          ${renderMetric(t("overview.gross_total"), takings.grossTotal, "gross-total")}
        </wt-card>

        <wt-card data-test="counts">
          <h2 slot="header">${t("overview.counts_title")}</h2>
          ${renderMetric(t("overview.sales"), String(counts.sales), "count-sales")}
          ${renderMetric(t("overview.corrections"), String(counts.corrections), "count-corrections")}
          ${renderMetric(t("overview.voids"), String(counts.voids), "count-voids")}
        </wt-card>

        <wt-card data-test="tables">
          <h2 slot="header">${t("overview.tables_title")}</h2>
          ${renderMetric(
            t("overview.open_tables"),
            `${openTables.open} / ${openTables.total}`,
            "open-tables",
          )}
        </wt-card>

        <wt-card data-test="top-sellers">
          <h2 slot="header">${t("overview.top_sellers_title")}</h2>
          ${renderTopSellers(overview.topSellers, this.#topSellerLabels())}
        </wt-card>
      </div>
    `;
  }

  /** This screen's `overview.*` labels for the shared top-sellers table (the namespace is deliberately
   * not shared with the sales screen's `sales.*` keys). */
  #topSellerLabels(): TopSellersLabels {
    return {
      title: t("overview.top_sellers_title"),
      quantity: t("overview.quantity"),
      total: t("overview.total"),
      empty: t("overview.empty_sellers"),
      emptyTest: "empty",
    };
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-overview-screen": OverviewScreen;
  }
}
