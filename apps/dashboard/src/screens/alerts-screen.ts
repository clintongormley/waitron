import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { UrlStateController, baseStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-tabs.js";
import { dashboardPath } from "../navigation.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { alertMessage, hasAlertMessage } from "../i18n/alerts.js";
import { DashboardQueries } from "../api/query-controller.js";
import type { AlertView, DashboardApi } from "../api/client.js";
import {
  areaLabel,
  formatAlertTime,
  goToLabel,
  incidentIdOf,
  severityLabel,
} from "../widgets/alert-format.js";

const VIEWS = ["open", "handled"] as const;
type View = (typeof VIEWS)[number];

/** Open and recently handled alerts. Not in the navigation: the banner bell opens it. */
@customElement("dashboard-alerts-screen")
export class AlertsScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .title {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      /* The table sizes to its content (min-width: max-content), so an uncapped sentence would never
         wrap and push the actions column off the right edge. */
      wt-data-table::part(alert-message) {
        display: block;
        max-width: 60ch;
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) canOpen: (screen: string) => boolean = () => false;

  @state() private view: View = "open";
  @state() private open: AlertView[] = [];
  @state() private handled: AlertView[] = [];
  @state() private visible: boolean | null = null;
  @state() private openLoading = true;
  @state() private handledLoading = true;
  /** Failed reads, one per list, so one list's success never hides the other's failure. Kept apart
   * from `actionError`: a refresh failing after a successful write is a load failure, not a failed
   * save. */
  @state() private openError: string | null = null;
  @state() private handledError: string | null = null;
  @state() private actionError: string | null = null;
  @state() private busyKey: string | null = null;

  // One controller per list: a controller's error callback does not say which query failed.
  readonly #openQueries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.openError = codeOf(error);
      this.openLoading = false;
    },
  );
  readonly #handledQueries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.handledError = codeOf(error);
      this.handledLoading = false;
    },
  );

  readonly #url = new UrlStateController(
    this,
    () => {
      if (this.#url.read("dashboard") !== "alerts") return;
      const view = this.#url.read("view");
      this.view = (VIEWS as readonly string[]).includes(view ?? "") ? (view as View) : "open";
      if (view !== this.view) this.#url.write({ view: this.view }, true);
    },
    dashboardPath,
  );

  override connectedCallback(): void {
    super.connectedCallback();
    this.#load();
  }

  #load(): void {
    void this.#openQueries
      .watch("listAlerts", [], (response) => {
        this.visible = response.visible;
        this.open = response.alerts;
        this.openLoading = false;
        this.openError = null;
      })
      .catch(() => undefined);
    void this.#handledQueries
      .watch("listHandledAlerts", [], (response) => {
        this.handled = response.alerts;
        this.handledLoading = false;
        this.handledError = null;
      })
      .catch(() => undefined);
  }

  async #handle(alert: AlertView, incidentId: string): Promise<void> {
    this.busyKey = alert.key;
    this.actionError = null;
    try {
      await this.api.markIncidentHandled(incidentId);
    } catch (error) {
      this.actionError = codeOf(error);
      return;
    } finally {
      this.busyKey = null;
    }
    // Invalidate rather than re-watch: while another observer (such as the banner bell) holds the same
    // query, its shared entry survives a release un-dirtied, so a re-watch is handed the cached value.
    this.api.liveData.invalidate([{ type: "incidents" }]);
  }

  #goTo(event: MouseEvent, screen: string): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("wt-alert-go-to", { bubbles: true, composed: true, detail: { screen } }),
    );
  }

  #alertCell(alert: AlertView): TemplateResult {
    return html`<span part="alert-message"
      >${alertMessage(alert.code, alert.params)}${
        hasAlertMessage(alert.code) ? nothing : html`<br />${alert.code}`
      }<br />${severityLabel(alert.severity)}</span
    >`;
  }

  #openColumns(): DataTableColumn<AlertView>[] {
    return [
      { key: "alert", label: t("alerts.col_alert"), cell: (a) => this.#alertCell(a) },
      { key: "area", label: t("alerts.col_area"), cell: (a) => areaLabel(a.area) },
      { key: "since", label: t("alerts.col_since"), cell: (a) => formatAlertTime(a.since) },
      {
        key: "actions",
        label: t("alerts.col_actions"),
        cell: (a) => {
          const incidentId = incidentIdOf(a);
          if (incidentId !== null)
            return html`<wt-button
              size="sm"
              variant="secondary"
              data-test="alert-handle"
              ?loading=${this.busyKey === a.key}
              @click=${() => void this.#handle(a, incidentId)}
              >${t("alerts.mark_handled")}</wt-button
            >`;
          if (a.screen !== undefined && this.canOpen(a.screen)) {
            const screen = a.screen;
            return html`<wt-button
              size="sm"
              variant="secondary"
              data-test="alert-go-to"
              @click=${(e: MouseEvent) => this.#goTo(e, screen)}
              >${goToLabel(screen)}</wt-button
            >`;
          }
          return nothing;
        },
      },
    ];
  }

  #handledColumns(): DataTableColumn<AlertView>[] {
    return [
      { key: "alert", label: t("alerts.col_alert"), cell: (a) => this.#alertCell(a) },
      { key: "area", label: t("alerts.col_area"), cell: (a) => areaLabel(a.area) },
      {
        key: "handled",
        label: t("alerts.col_handled"),
        cell: (a) =>
          t("alerts.handled_by")
            .replace("{time}", formatAlertTime(a.handledAt ?? null))
            .replace("{person}", a.handledBy ?? t("alerts.someone")),
      },
    ];
  }

  override render(): TemplateResult {
    const error = html`${
      this.openError === null && this.handledError === null
        ? nothing
        : html`<p role="alert" data-test="alerts-load-error">${t("alerts.load_error")}</p>`
    }${
      this.actionError === null
        ? nothing
        : html`<p role="alert" data-test="alerts-error">${codeMessage(this.actionError)}</p>`
    }`;
    if (this.visible === false)
      return html`<h1 class="title">${t("alerts.title")}</h1>
        <p data-test="alerts-no-access">${t("alerts.no_access")}</p>`;
    return html`<h1 class="title">${t("alerts.title")}</h1>
      ${error}
      <wt-tabs
        label=${t("alerts.title")}
        .value=${this.view}
        .items=${[
          { key: "open", label: t("alerts.tab_open") },
          { key: "handled", label: t("alerts.tab_handled") },
        ]}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          if (event.target !== event.currentTarget) return;
          this.view = event.detail.value as View;
          this.#url.write({ dashboard: "alerts", view: this.view });
        }}
      >
        <div slot="open">
          <wt-data-table
            data-test="open-alerts-table"
            aria-label=${t("alerts.tab_open")}
            .rows=${this.open}
            .columns=${this.#openColumns()}
            .rowKey=${(a: AlertView) => a.key}
            .loading=${this.openLoading}
            .loadingMessage=${t("alerts.loading")}
            .emptyMessage=${t("alerts.none")}
          ></wt-data-table>
        </div>
        <div slot="handled">
          <wt-data-table
            data-test="handled-alerts-table"
            aria-label=${t("alerts.tab_handled")}
            .rows=${this.handled}
            .columns=${this.#handledColumns()}
            .rowKey=${(a: AlertView) => a.key}
            .loading=${this.handledLoading}
            .loadingMessage=${t("alerts.loading")}
            .emptyMessage=${t("alerts.no_handled")}
          ></wt-data-table>
        </div>
      </wt-tabs>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-alerts-screen": AlertsScreen;
  }
}
