import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import type { DashboardApi } from "../api/client.js";
import { t } from "../i18n/t.js";

@customElement("dashboard-handover-report-warning")
export class HandoverReportWarning extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .notice {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
        padding: var(--wt-space-3);
        margin-bottom: var(--wt-space-4);
        border: 1px solid var(--wt-color-warning);
        border-radius: var(--wt-radius-md);
        color: var(--wt-color-text);
        background: var(--wt-color-surface);
      }
      a {
        color: var(--wt-color-primary-text);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) canViewReports = false;
  @state() private status: "loading" | "unconfirmed" | "empty" | "unavailable" = "loading";

  protected override willUpdate(changed: PropertyValues<this>): void {
    if ((changed.has("api") || changed.has("canViewReports")) && this.canViewReports) {
      void this.#load();
    }
  }
  async #load(): Promise<void> {
    this.status = "loading";
    try {
      const { intervals } = await this.api.listHandoverIntervals();
      this.status = intervals.length === 0 ? "empty" : "unconfirmed";
    } catch {
      this.status = "unavailable";
    }
  }
  override render() {
    if (!this.canViewReports) {
      return html`<div class="notice" role="status">${t("handover_warning.permission")}</div>`;
    }
    if (this.status === "empty") return nothing;
    return html`<div class="notice" role="status">
      <span>${t(`handover_warning.${this.status}`)}</span>
      ${this.status === "unconfirmed" ? html`<a href="/manage/handover-intervals">${t("handover_warning.check")}</a>` : nothing}
      <wt-button .disabled=${this.status === "loading"} @click=${() => void this.#load()}
        >${t("handover_warning.refresh")}</wt-button
      >
    </div>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-handover-report-warning": HandoverReportWarning;
  }
}
