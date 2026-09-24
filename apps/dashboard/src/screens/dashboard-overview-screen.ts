import { ContentLanguageController } from "@waitron/ui";
import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-card.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { metricStyles, renderMetric } from "../widgets/metric-row.js";
import {
  renderTopSellers,
  topSellersStyles,
  type TopSellersLabels,
} from "../widgets/top-sellers-table.js";
import type { DashboardApi, OverdueOrder, SalesOverview } from "../api/client.js";

/** Clock fallback for hosts that do not provide the shared observed-query cache. */
const OVERDUE_REFRESH_MS = 30_000;

/** Sales and overdue orders have independent snapshots and error states: recovery of one read must
 * not hide a failure in the other. Server values refresh through their own query dependencies. */
@customElement("dashboard-overview-screen")
export class OverviewScreen extends LitElement {
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

  readonly #overviewQuery = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.overviewErrorKey = codeOf(error);
    },
  );
  readonly #overdueQuery = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.overdueErrorKey = codeOf(error);
    },
  );
  @state() private overview: SalesOverview | null = null;
  @state() private overdueOrders: OverdueOrder[] | null = null;
  @state() private overviewErrorKey: string | null = null;
  @state() private overdueErrorKey: string | null = null;

  /** Cleared on disconnect: a leaked interval would keep fetching against a torn-down screen. */
  #overdueTimer?: ReturnType<typeof setInterval>;

  /** A poll tick that finds a fetch still in flight is skipped, so on a slow network requests do not
   * pile up and a stale response cannot land after a newer one. */
  #overdueInFlight = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
    if (this.api.liveData === undefined)
      this.#overdueTimer = setInterval(() => {
        if (this.#overdueInFlight) return;
        void this.#loadOverdue();
      }, OVERDUE_REFRESH_MS);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearInterval(this.#overdueTimer);
    this.#overdueTimer = undefined;
  }

  /** Each fetch owns its own state and error field, so a rejection from one never blocks the other's
   * assignment. */
  async #load(): Promise<void> {
    await Promise.all([this.#loadOverview(), this.#loadOverdue()]);
  }

  async #loadOverview(): Promise<void> {
    try {
      await this.#overviewQuery.watch("getSalesOverview", [], (value) => {
        this.overview = value;
        this.overviewErrorKey = null;
      });
    } catch (error) {
      this.overviewErrorKey = codeOf(error);
    }
  }

  /** Orders can cross an age threshold without a database write, so their query also observes time. */
  async #loadOverdue(): Promise<void> {
    this.#overdueInFlight = true;
    try {
      await this.#overdueQuery.watch("getOverdueOrders", [], ({ orders }) => {
        this.overdueOrders = orders;
        this.overdueErrorKey = null;
      });
    } catch (error) {
      this.overdueErrorKey = codeOf(error);
    } finally {
      this.#overdueInFlight = false;
    }
  }

  override render(): TemplateResult {
    return html`
      <h1>${t("overview.title")}</h1>
      ${
        this.overviewErrorKey
          ? html`<p class="error" role="alert" data-test="error">
              ${codeMessage(this.overviewErrorKey)}
            </p>`
          : nothing
      }
      ${this.overview ? this.#renderOverview(this.overview) : nothing}
      ${
        this.overdueOrders !== null || this.overdueErrorKey !== null
          ? this.#renderOverdue(this.overdueOrders, this.overdueErrorKey)
          : nothing
      }
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

  /**
   * `orders` is rendered in the order the server sent it: the route already sorts worst-first, and
   * re-sorting here could disagree with it on ties. `errorKey` gets its own note, never the calm
   * zero-state, which would read as false reassurance; a last-known list keeps rendering beside it.
   */
  #renderOverdue(orders: OverdueOrder[] | null, errorKey: string | null): TemplateResult {
    return html`
      <wt-card data-test="overdue">
        <h2 slot="header">${t("overview.overdue_title")}</h2>
        ${
          errorKey
            ? html`<p class="error" role="alert" data-test="overdue-error">
                ${codeMessage(errorKey)}
              </p>`
            : nothing
        }
        ${orders === null ? nothing : this.#renderOverdueBody(orders)}
      </wt-card>
    `;
  }

  #renderOverdueBody(orders: OverdueOrder[]): TemplateResult {
    if (orders.length === 0) {
      return html`<p class="muted" data-test="overdue-empty">${t("overview.overdue_none")}</p>`;
    }
    return html`
      <p data-test="overdue-count">${orders.length} ${t("overview.overdue_count")}</p>
      <table data-test="overdue-table">
        <thead>
          <tr>
            <th scope="col">${t("overview.overdue_col_table")}</th>
            <th scope="col">${t("overview.overdue_col_station")}</th>
            <th scope="col" class="num">${t("overview.overdue_col_minutes")}</th>
            <th scope="col">${t("overview.overdue_col_band")}</th>
          </tr>
        </thead>
        <tbody>
          ${orders.map(
            (order, i) => html`
              <tr data-test=${`overdue-row-${i}`}>
                <td>${order.tableLabel ?? "—"}</td>
                <td>${order.stationName}</td>
                <td class="num">${order.ageMinutes}</td>
                <td data-test="overdue-band">${this.#bandLabel(order.band)}</td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    `;
  }

  /** The route returns only `overdue` and `forgotten` orders. */
  #bandLabel(band: OverdueOrder["band"]): string {
    return band === "forgotten" ? t("overview.band_forgotten") : t("overview.band_overdue");
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-overview-screen": OverviewScreen;
  }
}
