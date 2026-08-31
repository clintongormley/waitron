import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-card.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { metricStyles, renderMetric } from "../widgets/metric-row.js";
import { renderTopSellers, type TopSellersLabels } from "../widgets/top-sellers-table.js";
import type { DashboardApi, OverdueOrder, SalesOverview } from "../api/client.js";

/** How often the overdue-orders tile refetches while this screen is connected (KDS order-timing
 * alerts, design §7.4): this is the ONE dashboard screen that polls — a passive monitoring board, not
 * a push subscriber. 30s balances staleness against load; the ticket ages it reports move in minutes,
 * so sub-30s freshness buys nothing. */
const OVERDUE_REFRESH_MS = 30_000;

/**
 * The management dashboard's BUSINESS-OVERVIEW HOME SCREEN (design §3 — "today at a glance"): the
 * post-login landing for non-staff roles (registered in Task 9). It reads this node's TODAY figures
 * once via `api.getSalesOverview()` and lays them out as `wt-card`s — takings, record counts, open
 * tables, and a top-sellers list. It also surfaces the KDS order-timing alerts' "orders taking too
 * long" count tile + list (design §7.4), fetched alongside the rest on connect and then RE-POLLED
 * every {@link OVERDUE_REFRESH_MS} — the only field on this screen that goes stale between visits, so
 * it is the only one that refetches on a timer rather than only on connect. Otherwise read-only: it
 * authors nothing.
 *
 * Money fields arrive pre-formatted as decimal strings from the server and are rendered verbatim
 * (there is no client-side currency formatter in this app; §Task-7 brief). Top-seller names come from
 * a per-locale `descriptions` map resolved through the shared {@link localizedName} helper.
 *
 * The two data sources have INDEPENDENT error state (fix round 2) — `overviewErrorKey` for
 * `getSalesOverview()` (rendered as the top banner) and `overdueErrorKey` for `getOverdueOrders()`
 * (rendered inline on the overdue tile) — rather than one shared `errorKey`. A shared field was tried
 * first and reverted: `overview` has no retry/poll of its own, so once it failed, the very next
 * successful overdue poll tick (near-certain within ~30s) would clear the ONE shared field and make
 * the banner vanish while the overview cards stayed blank forever with no error indication at all —
 * worse than the stuck-banner bug the shared field was fixing. Splitting the field removes that
 * interaction entirely: neither source's success or failure can touch the other's error state.
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
  @state() private overdueOrders: OverdueOrder[] | null = null;
  @state() private overviewErrorKey: string | null = null;
  @state() private overdueErrorKey: string | null = null;

  /** The ~30s overdue-orders poll (design §7.4), started on connect and cleared on disconnect below —
   * a leaked interval would keep fetching against a torn-down screen. */
  #overdueTimer?: ReturnType<typeof setInterval>;

  /** Single-flight guard for the POLLED refetch only (never the initial `#load()` path): true while a
   * `#loadOverdue()` triggered by the interval is still in flight. On a slow network a 30s tick can
   * otherwise fire before the previous request has resolved, so requests pile up and a stale response
   * can land after a newer one and overwrite it. A tick that finds this true is simply skipped — the
   * next tick will try again once the in-flight request has cleared it. */
  #overdueInFlight = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
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

  /**
   * Load today's overview + the overdue-orders snapshot CONCURRENTLY. Each fetch is fully independent
   * (fix round 1, Important-2): a rejection from one must not prevent the other's successful
   * assignment, so a failure in the newer, less-proven `/reports/overdue-orders` route cannot blank
   * the already-working sales-overview cards (and vice versa). `Promise.all` just waits for both;
   * each method below owns its own state + its own error field, so there is nothing left to
   * coordinate here.
   */
  async #load(): Promise<void> {
    await Promise.all([this.#loadOverview(), this.#loadOverdue()]);
  }

  /** Fetch today's sales overview and store it. Sets/clears ONLY `overviewErrorKey` — never
   * `overdueErrorKey` (fix round 2: the two fields are fully independent, see the class doc). */
  async #loadOverview(): Promise<void> {
    try {
      this.overview = await this.api.getSalesOverview();
      this.overviewErrorKey = null;
    } catch (error) {
      this.overviewErrorKey = codeOf(error);
    }
  }

  /**
   * Fetch the overdue-orders snapshot and store it. Sets/clears ONLY `overdueErrorKey` — never
   * `overviewErrorKey` (fix round 2, see the class doc for why a shared field was wrong). Used both
   * by the initial `#load()` (concurrently with `#loadOverview`) and, alone, by the ~30s poll tick
   * started in `connectedCallback` — a success SELF-HEALS a stale `overdueErrorKey` either way (fix
   * round 1, Important-1: without this, the first failed tick in a multi-hour session left the note
   * permanently stuck, since nothing else ever reset it). This is now safe in BOTH call sites because,
   * unlike round 1's shared `errorKey`, clearing `overdueErrorKey` can never erase a genuine
   * `overviewErrorKey` failure — they are different fields.
   *
   * The sales overview is not re-fetched on the poll tick — it is "today so far", not a live queue,
   * so it does not go stale the way the overdue snapshot does.
   */
  async #loadOverdue(): Promise<void> {
    this.#overdueInFlight = true;
    try {
      const { orders } = await this.api.getOverdueOrders();
      this.overdueOrders = orders;
      this.overdueErrorKey = null;
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
   * The "orders taking too long" tile (design §7.4): a count line ("2 orders overdue") plus a
   * worst-first list (table · station · minutes · band). `orders` is rendered in the order the server
   * sent it — the route already sorts worst-first, so re-sorting here would be redundant and risks
   * disagreeing with the server on ties. A bare walk-up's null `tableLabel` renders the em-dash
   * placeholder `staff-list.ts` already uses for an absent field, not a new i18n string.
   *
   * `errorKey` (fix round 2) renders its own inline note (`overdue-error`), separate from and never
   * conflated with the calm zero-state — "no overdue orders" and "the check failed" are different
   * messages, and showing the former for the latter would read as false reassurance. If a PREVIOUS
   * fetch had already succeeded and a LATER poll tick fails, `orders` still holds that last-known
   * list, so it keeps rendering alongside the note rather than being blanked by a transient refetch
   * failure — only a fetch that has NEVER succeeded (`orders === null`) shows the note alone.
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

  /** The list's band cell — only `overdue`/`forgotten` ever reach this list (the route never returns a
   * fresh/warm order), so those are the only two labels this needs. */
  #bandLabel(band: OverdueOrder["band"]): string {
    return band === "forgotten" ? t("overview.band_forgotten") : t("overview.band_overdue");
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-overview-screen": OverviewScreen;
  }
}
