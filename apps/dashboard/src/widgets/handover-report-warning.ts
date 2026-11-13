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
  @state() private status: "unconfirmed" | "empty" | "unavailable" = "empty";
  @state() private loading = false;
  @state() private hasEmergencyHandover = false;
  @state() private hasReturnedInvoices = false;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("api")) {
      void this.#load();
    }
  }
  async #load(): Promise<void> {
    this.loading = true;
    try {
      const result = await this.api.getHandoverWarning();
      this.hasEmergencyHandover = result.hasEmergencyHandover;
      this.hasReturnedInvoices = result.hasReturnedInvoices;
      this.status =
        result.hasEmergencyHandover || result.hasReturnedInvoices ? "unconfirmed" : "empty";
    } catch {
      this.status = "unavailable";
    } finally {
      this.loading = false;
    }
  }
  override render() {
    return html`<div role="status">
      ${
        this.status === "empty"
          ? nothing
          : html`<div class="notice">
              ${
                this.status === "unavailable"
                  ? html`<span>${t("handover_warning.unavailable")}</span>`
                  : html`${this.hasEmergencyHandover ? html`<span>${t("handover_warning.unconfirmed")}</span>` : nothing}
                    ${this.hasReturnedInvoices ? html`<span>${t("handover_warning.returned")}</span>` : nothing}`
              }
              ${this.status === "unconfirmed" ? html`<a href="/manage/handover-intervals">${t("handover_warning.check")}</a>` : nothing}
              <wt-button .disabled=${this.loading} @click=${() => void this.#load()}
                >${t("handover_warning.refresh")}</wt-button
              >
            </div>`
      }
    </div>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-handover-report-warning": HandoverReportWarning;
  }
}
