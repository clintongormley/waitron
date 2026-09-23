import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import type { CloudConnectionStatus, DashboardApi } from "../api/client.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
@customElement("dashboard-cloud-services-screen")
export class CloudServicesScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      h1 {
        font-size: var(--wt-font-size-lg);
        margin: 0 0 var(--wt-space-4);
      }
      wt-card {
        max-width: var(--wt-form-max-width, 36rem);
      }
      p,
      dl {
        margin-block: var(--wt-space-4);
      }
      dt {
        font-weight: var(--wt-font-weight-medium);
      }
      dd {
        margin: 0 0 var(--wt-space-3);
        overflow-wrap: anywhere;
      }
      .code {
        font-size: var(--wt-font-size-xl);
        font-weight: var(--wt-font-weight-bold);
      }
      a {
        color: var(--wt-color-primary);
        display: inline-flex;
        align-items: center;
        min-height: var(--wt-tap-min);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @state() private status: CloudConnectionStatus | undefined;
  @state() private busy = false;
  @state() private error: string | undefined;
  @state() private requestUnavailable = false;
  #generation = 0;
  override connectedCallback() {
    super.connectedCallback();
    this.busy = false;
    void this.#run(() => this.api.getCloudStatus());
  }
  override disconnectedCallback() {
    this.#generation++;
    super.disconnectedCallback();
  }
  async #run(request: () => Promise<CloudConnectionStatus>) {
    if (this.busy) return;
    this.busy = true;
    this.error = undefined;
    const generation = this.#generation;
    try {
      const result = await request();
      if (generation === this.#generation) {
        this.status = result;
        this.requestUnavailable = false;
      }
    } catch (error) {
      if (generation === this.#generation) {
        this.error = codeOf(error);
        if (this.error === "cloud.request_unavailable") this.requestUnavailable = true;
      }
    } finally {
      if (generation === this.#generation) {
        this.busy = false;
        await this.updateComplete;
        if (this.error)
          this.shadowRoot?.querySelector<HTMLElement>("wt-form-error-summary")?.focus();
      }
    }
  }
  #complete() {
    const s = this.status;
    if (!s?.requestId || !s.organisationId || !s.legalBusinessId) return;
    void this.#run(() =>
      this.api.completeCloudConnection({
        requestId: s.requestId!,
        organisationId: s.organisationId!,
        legalBusinessId: s.legalBusinessId!,
      }),
    );
  }
  override render() {
    const s = this.status;
    const button = (id: string, label: string, request: () => Promise<CloudConnectionStatus>) =>
      html`<wt-button
        id=${id}
        .disabled=${this.busy}
        @click=${() => {
          void this.#run(request);
        }}
        >${label}</wt-button
      >`;
    return html`<h1>${t("nav.cloud")}</h1>
      <wt-card>
        <wt-form-error-summary
          tabindex="-1"
          .heading=${t("cloud.error_heading")}
          .errors=${this.error ? [codeMessage(this.error)] : []}
        ></wt-form-error-summary>
        ${
          !s
            ? html`<p role="status">${t("cloud.loading")}</p>
                ${button("retry", t("cloud.retry"), () => this.api.getCloudStatus())}`
            : !s.configured
              ? html`<p>${t("cloud.not_configured")}</p>`
              : html` ${!s.isPrimary ? html`<p>${t("cloud.not_primary")}</p>` : nothing}
                ${
                  s.state === "not_connected"
                    ? html`<p>${t("cloud.intro")}</p>
                        ${s.isPrimary ? button("connect", t("cloud.connect"), () => this.api.startCloudConnection()) : nothing}`
                    : s.state === "complete"
                      ? html`<p role="status">${t("cloud.connected")}</p>
                          <p>${s.legalBusinessName}</p>
                          <dl>
                            <dt>${t("cloud.remote")}</dt>
                            <dd>${t("cloud.unconfigured")}</dd>
                            <dt>${t("cloud.backups")}</dt>
                            <dd>${t("cloud.unconfigured")}</dd>
                          </dl>`
                      : html`
                          ${
                            s.state === "awaiting_cloud"
                              ? html`<p>${t("cloud.code")}</p>
                                  <p class="code">${s.code}</p>
                                  ${s.expiresAt ? html`<p>${t("cloud.expires")}: <time datetime=${s.expiresAt}>${new Date(s.expiresAt).toLocaleString()}</time></p>` : nothing}
                                  ${s.openCloudUrl ? html`<a href=${s.openCloudUrl} target="_blank" rel="noopener noreferrer">${t("cloud.open")}</a>` : nothing}`
                              : html`<p>${t("cloud.confirm_help")}</p>
                                  <dl>
                                    <dt>${t("cloud.organisation")}</dt>
                                    <dd>${s.organisationName}</dd>
                                    <dt>${t("cloud.business")}</dt>
                                    <dd>${s.legalBusinessName}</dd>
                                  </dl>`
                          }
                          <wt-form-actions
                            >${button("check", t("cloud.check"), () => this.api.checkCloudConnection())}
                            ${s.state === "awaiting_local" && s.isPrimary ? html`<wt-button id="confirm" variant="primary" .disabled=${this.busy} @click=${() => this.#complete()}>${t("cloud.confirm")}</wt-button>` : nothing}
                          </wt-form-actions>
                          ${s.isPrimary && !s.expiresAt ? button("retry-start", t("cloud.retry_start"), () => this.api.startCloudConnection()) : nothing}
                          ${s.isPrimary && (this.requestUnavailable || (!!s.expiresAt && Date.parse(s.expiresAt) < Date.now())) ? button("restart", t("cloud.restart"), () => this.api.startCloudConnection(true)) : nothing}
                        `
                }`
        }
      </wt-card>`;
  }
}
