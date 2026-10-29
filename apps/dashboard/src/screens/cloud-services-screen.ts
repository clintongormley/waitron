import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { QueryController } from "@waitron/dashboard-kit";
import { centsToDecimal, formatMoney } from "@waitron/shared";
import type { CloudBilling, CloudConnectionStatus, DashboardApi } from "../api/client.js";
import { dashboardQuery } from "../api/live-queries.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { lastIncludedDay } from "./cloud-billing-day.js";

/** Billing is read only where the server answers it: a live connection, on the primary. */
const readsBilling = (s: CloudConnectionStatus | undefined) =>
  s?.state === "complete" && s.isPrimary && s.installation?.state !== "revoked";
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
      h2 {
        font-size: var(--wt-font-size-md);
        margin: var(--wt-space-5) 0 0;
      }
      wt-card {
        max-width: calc(var(--wt-space-6) * 18);
      }
      p,
      dl {
        margin-block: var(--wt-space-4);
      }
      dt {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-normal);
      }
      dd {
        margin: 0 0 var(--wt-space-3);
        overflow-wrap: anywhere;
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
      }
      .code {
        font-size: var(--wt-font-size-xl);
        font-weight: var(--wt-font-weight-bold);
      }
      .error {
        color: var(--wt-color-danger);
      }
      a {
        color: var(--wt-color-primary-text);
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
  @state() private confirmingStop = false;
  #generation = 0;
  #clock: ReturnType<typeof setTimeout> | undefined;
  /** The status read's own failure, kept apart from `error` so its recovery never clears an action's. */
  @state() private readError: string | undefined;
  /** Counts applied action results, so a read that started before one cannot replace it. */
  #actionResults = 0;
  readonly #queries = new QueryController(
    this,
    () => this.api.liveData,
    (error) => {
      this.readError = codeOf(error);
    },
  );
  /** Undefined until the first answer, and again after a failure, so no old value stays shown. */
  @state() private billing: CloudBilling | undefined;
  @state() private billingUnavailable = false;
  #billingWatched = false;
  // Its own controller, so a billing failure never becomes the status read's `readError`.
  readonly #billingQueries = new QueryController(
    this,
    () => this.api.liveData,
    () => {
      this.billing = undefined;
      this.billingUnavailable = true;
    },
  );
  override connectedCallback() {
    super.connectedCallback();
    this.busy = false;
    this.confirmingStop = false;
    const generation = this.#generation;
    const query = dashboardQuery(this.api, "getCloudStatus", []);
    void this.#queries
      .watch(
        "getCloudStatus",
        {
          ...query,
          key: `${query.key}:action-stamped`,
          read: async () => {
            const actionResults = this.#actionResults;
            return { actionResults, status: await query.read() };
          },
        },
        ({ actionResults, status }) => {
          this.readError = undefined;
          if (this.busy || actionResults !== this.#actionResults) return;
          this.status = status;
          if (status.installation?.state === "revoked") this.confirmingStop = false;
        },
      )
      // Only the opening read takes focus: a background read fails again on every retry.
      .catch(() => this.#focusError(generation));
  }
  override disconnectedCallback() {
    clearTimeout(this.#clock);
    this.#generation++;
    this.#stopBilling();
    super.disconnectedCallback();
  }
  protected override willUpdate() {
    // Watched once while billing applies: `watch` would replace the slot and read again.
    if (readsBilling(this.status) === this.#billingWatched) return;
    if (this.#billingWatched) {
      this.#stopBilling();
      return;
    }
    this.#billingWatched = true;
    void this.#billingQueries
      .watch("getCloudBilling", dashboardQuery(this.api, "getCloudBilling", []), (billing) => {
        this.billing = billing;
        this.billingUnavailable = false;
      })
      .catch(() => undefined);
  }
  #stopBilling() {
    this.#billingQueries.release("getCloudBilling");
    this.#billingWatched = false;
    this.billing = undefined;
    this.billingUnavailable = false;
  }
  protected override updated() {
    clearTimeout(this.#clock);
    if (this.isConnected && this.status?.state === "complete")
      this.#clock = setTimeout(() => this.requestUpdate(), 1000);
  }
  async #run(request: () => Promise<CloudConnectionStatus>) {
    if (this.busy) return;
    this.busy = true;
    this.error = undefined;
    this.readError = undefined;
    const generation = this.#generation;
    try {
      const result = await request();
      if (generation === this.#generation) {
        this.#actionResults++;
        this.status = result;
        if (result.installation?.state === "revoked") this.confirmingStop = false;
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
        if (this.error) await this.#focusError(generation);
      }
    }
  }
  async #focusError(generation: number) {
    await this.updateComplete;
    if (generation === this.#generation)
      this.shadowRoot?.querySelector<HTMLElement>("[data-test=cloud-error]")?.focus();
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
  #billing(s: CloudConnectionStatus) {
    const answer = this.billing;
    const locale = currentLocale();
    const level = (value: string) =>
      t(`cloud.billing_level_${value}` as "cloud.billing_level_hosted");
    const facts = answer?.billing;
    const prices = answer?.prices;
    const money = (cents: number) => formatMoney(String(centsToDecimal(cents)), locale);
    const vat =
      prices?.status === "published"
        ? new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(
            prices.vatRateBasisPoints / 10000,
          )
        : "";
    return html`<section data-test="cloud-billing" aria-labelledby="cloud-billing-heading">
      <h2 id="cloud-billing-heading">${t("cloud.billing")}</h2>
      ${
        this.billingUnavailable || facts?.status === "unavailable"
          ? html`<p>${t("cloud.billing_unavailable")}</p>`
          : facts?.status === "ready"
            ? html`<dl>
                <dt>${t("cloud.billing_plan")}</dt>
                <dd>${level(facts.level)}</dd>
                <dt>${t("cloud.billing_status")}</dt>
                <dd>${t(`cloud.billing_state_${facts.state}`)}</dd>
                ${
                  facts.period
                    ? html`<dt>
                          ${t(facts.period.kind === "trial" ? "cloud.billing_last_trial" : "cloud.billing_last_paid")}
                        </dt>
                        <dd>
                          ${lastIncludedDay(facts.period.until, locale)}${
                            facts.period.level === facts.level
                              ? ""
                              : ` (${level(facts.period.level)})`
                          }
                        </dd>`
                    : nothing
                }
              </dl>`
            : nothing
      }
      ${
        prices?.status === "published"
          ? html`<dl>
              <dt>${level("registered")}</dt>
              <dd>${t("cloud.billing_free")}</dd>
              <dt>${level("connected")}</dt>
              <dd>
                ${fill("cloud.billing_monthly", { price: money(prices.connectedMonthlyCents), vat })}
              </dd>
              <dt>${level("hosted")}</dt>
              <dd>
                ${fill("cloud.billing_daily", { price: money(prices.hostedMonthlyCents), vat })}
              </dd>
            </dl>`
          : prices?.status === "unavailable" && !this.billingUnavailable
            ? html`<p>${t("cloud.billing_prices_unpublished")}</p>`
            : nothing
      }
      ${
        s.accountUrl
          ? html`<a
              id="cloud-account"
              href=${s.accountUrl}
              target="_blank"
              rel="noopener noreferrer"
              >${t("cloud.account")}</a
            >`
          : nothing
      }
    </section>`;
  }
  #installation(s: CloudConnectionStatus) {
    const installation = s.installation;
    const date = (value: string | null | undefined) =>
      value
        ? html`<time datetime=${value}>${new Date(value).toLocaleString(currentLocale())}</time>`
        : t("cloud.never_contacted");
    const names = {
      remote_access: "cloud.remote",
      continuous_backup: "cloud.continuous",
      retained_snapshots: "cloud.snapshots",
      content_translation: "cloud.translation",
    } as const;
    const services = installation?.services.length
      ? installation.services
      : (["remote_access", "continuous_backup", "retained_snapshots"] as const).map((service) => ({
          service,
          state: "unconfigured" as const,
          health: "unknown" as const,
          observedAt: null,
        }));
    return html`<p role="status">${t(`cloud.access_${installation?.state ?? "pending"}`)}</p>
      <dl>
        <dt>${t("cloud.last_contact")}</dt>
        <dd>${date(installation?.lastContactAt)}</dd>
        <dt>${t("cloud.access_expires")}</dt>
        <dd>${date(installation?.leaseExpiresAt)}</dd>
        ${services.map(
          (service) =>
            html`<dt>${t(names[service.service])}</dt>
              <dd>
                ${t(`cloud.state_${service.state}`)} ·
                ${t(`cloud.health_${installation?.state === "revoked" || !service.observedAt || Date.parse(service.observedAt) <= Date.now() - 300000 ? "unknown" : service.health}`)}
              </dd>`,
        )}
      </dl>
      ${
        installation?.state === "revoked"
          ? nothing
          : html`
              ${
                s.isPrimary
                  ? html`<wt-button
                      id="refresh"
                      .disabled=${this.busy}
                      @click=${() => {
                        void this.#run(() => this.api.refreshCloudConnection());
                      }}
                      >${t("cloud.refresh")}</wt-button
                    >`
                  : nothing
              }
              ${
                this.confirmingStop
                  ? html`<div role="group" aria-label=${t("cloud.stop")}>
                      <p>${t("cloud.stop_help")}</p>
                      <wt-form-actions>
                        <wt-button
                          id="cancel-stop"
                          .disabled=${this.busy}
                          @click=${() => {
                            this.confirmingStop = false;
                          }}
                          >${t("cloud.cancel_stop")}</wt-button
                        >
                        <wt-button
                          id="confirm-stop"
                          .disabled=${this.busy}
                          @click=${() => {
                            void this.#run(() => this.api.revokeCloudConnection());
                          }}
                          >${t("cloud.confirm_stop")}</wt-button
                        >
                      </wt-form-actions>
                    </div>`
                  : html`<wt-button
                      id="stop-access"
                      .disabled=${this.busy}
                      @click=${() => {
                        this.confirmingStop = true;
                      }}
                      >${t("cloud.stop")}</wt-button
                    >`
              }
            `
      }`;
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
    const error = this.error || this.readError || s?.replacementError;
    return html`<h1>${t("nav.cloud")}</h1>
      <wt-card>
        ${
          error
            ? html`<p class="error" role="alert" tabindex="-1" data-test="cloud-error">
                ${codeMessage(error)}
              </p>`
            : nothing
        }
        ${
          !s
            ? html`<p role="status">${t("cloud.loading")}</p>
                ${button("retry", t("cloud.retry"), () => this.api.getCloudStatus())}`
            : !s.configured
              ? html`<p>${t("cloud.not_configured")}</p>`
              : html` ${!s.isPrimary ? html`<p>${t("cloud.not_primary")}</p>` : nothing}
                ${
                  s.state === "not_connected"
                    ? s.replacementError
                      ? nothing
                      : s.replacement || s.replacementPending || s.replacementEligible
                        ? html`<p>${t("cloud.replacement_intro")}</p>
                            ${
                              s.replacement
                                ? html`
                                    <p role="status">
                                      ${t(s.replacement.state === "complete" ? "cloud.replacement_approved" : "cloud.replacement_waiting")}
                                    </p>
                                    <dl>
                                      <dt>${t("cloud.replacement_old")}</dt>
                                      <dd>${s.replacement.oldInstallationId}</dd>
                                      <dt>${t("cloud.organisation")}</dt>
                                      <dd>${s.replacement.organisationName}</dd>
                                      <dt>${t("cloud.business")}</dt>
                                      <dd>${s.replacement.legalBusinessName}</dd>
                                    </dl>
                                    <p>${t("cloud.replacement_warning")}</p>
                                    ${
                                      s.replacement.state === "awaiting_owner" &&
                                      s.replacementApproval
                                        ? html`
                                            <p>${t("cloud.replacement_code")}</p>
                                            <p class="code">${s.replacementApproval.code}</p>
                                            <a
                                              id="replacement-open-cloud"
                                              href=${s.replacementApproval.openCloudUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              >${t("cloud.open")}</a
                                            >
                                          `
                                        : nothing
                                    }
                                    ${s.isPrimary ? button("check-reconnection", t("cloud.replacement_check"), () => this.api.checkCloudReplacement()) : nothing}
                                  `
                                : s.replacementPending
                                  ? html`<p role="status">${t("cloud.replacement_pending")}</p>
                                      ${
                                        s.replacementApproval
                                          ? html`
                                              <p>${t("cloud.replacement_code")}</p>
                                              <p class="code">${s.replacementApproval.code}</p>
                                              <a
                                                id="replacement-open-cloud"
                                                href=${s.replacementApproval.openCloudUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                >${t("cloud.open")}</a
                                              >
                                            `
                                          : nothing
                                      }
                                      ${s.isPrimary ? button("check-reconnection", t("cloud.replacement_check"), () => this.api.checkCloudReplacement()) : nothing}`
                                  : s.isPrimary
                                    ? button(
                                        "request-reconnection",
                                        t("cloud.replacement_request"),
                                        () => this.api.prepareCloudReplacement(),
                                      )
                                    : nothing
                            }`
                        : html`<p>${t("cloud.intro")}</p>
                            ${s.isPrimary ? button("connect", t("cloud.connect"), () => this.api.startCloudConnection()) : nothing}
                            ${
                              s.signupUrl
                                ? html`<a
                                    id="cloud-signup"
                                    href=${s.signupUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    >${t("cloud.signup")}</a
                                  >`
                                : nothing
                            }`
                    : s.state === "complete"
                      ? html`<p role="status">${t("cloud.connected")}</p>
                          <p>${s.legalBusinessName}</p>
                          ${this.#installation(s)} ${readsBilling(s) ? this.#billing(s) : nothing}`
                      : html`
                          ${
                            s.state === "awaiting_cloud"
                              ? html`<p>${t("cloud.code")}</p>
                                  <p class="code">${s.code}</p>
                                  ${s.expiresAt ? html`<p>${t("cloud.expires")}: <time datetime=${s.expiresAt}>${new Date(s.expiresAt).toLocaleString(currentLocale())}</time></p>` : nothing}
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
