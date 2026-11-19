import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, pageTitleStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-dialog.js";
import { QueryController } from "@waitron/dashboard-kit";
import { centsToDecimal, formatMoney } from "@waitron/shared";
import type {
  CloudOwnerRecoveryRequest,
  CloudBilling,
  CloudEmergency,
  CloudEmergencyCode,
  CloudEmergencyPerson,
  CloudConnectionStatus,
  DashboardApi,
} from "../api/client.js";
import { dashboardQuery } from "../api/live-queries.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { lastIncludedDay } from "./cloud-billing-day.js";

function priceDisplay(prices: CloudBilling["prices"] | undefined) {
  const locale = currentLocale();
  const money = (cents: number) => formatMoney(String(centsToDecimal(cents)), locale);
  const vat =
    prices?.status === "published"
      ? new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(
          prices.vatRateBasisPoints / 10000,
        )
      : "";
  return { money, vat };
}

/** Billing is read only where the server answers it: a live connection, on the primary. */
const readsBilling = (s: CloudConnectionStatus | undefined) =>
  s?.state === "complete" && s.isPrimary && s.installation?.state !== "revoked";
@customElement("dashboard-cloud-services-screen")
export class CloudServicesScreen extends LitElement {
  static override styles = [
    baseStyles,
    pageTitleStyles,
    css`
      :host {
        display: block;
      }
      h1 {
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
      .muted {
        color: var(--wt-color-text-muted);
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
  @property({ attribute: false }) canManageEmergency = false;
  @state() private emergencyPeople: CloudEmergencyPerson[] | undefined;
  @state() private peopleError: string | undefined;
  readonly #peopleQueries = new QueryController(
    this,
    () => this.api.liveData,
    (error) => {
      this.emergencyPeople = undefined;
      this.peopleError = codeOf(error);
      if (this.peopleError === "authorization.not_permitted") this.#clearCode();
    },
  );
  @state() private revealedCode: CloudEmergencyCode | undefined;
  @state() private codeBusy = false;
  @state() private codeError: string | undefined;
  #codeGeneration = 0;
  #clearCode() {
    this.#codeGeneration++;
    this.revealedCode = undefined;
    this.codeBusy = false;
    this.codeError = undefined;
  }
  async #revealCode() {
    if (this.codeBusy) return;
    const generation = ++this.#codeGeneration;
    this.codeBusy = true;
    this.codeError = undefined;
    try {
      const answer = await this.api.revealCloudEmergencyCode();
      if (generation === this.#codeGeneration) this.revealedCode = answer;
    } catch (error) {
      if (generation === this.#codeGeneration)
        this.codeError =
          codeOf(error) === "cloud.unavailable"
            ? t("cloud.emergency_code_unavailable")
            : codeMessage(
                codeOf(error),
                undefined,
                (error as { params?: { reason?: unknown; seconds?: unknown } }).params,
              );
    } finally {
      if (generation === this.#codeGeneration) this.codeBusy = false;
    }
  }
  @state() private recoveryRequests?: CloudOwnerRecoveryRequest[];
  @state() private recoveryChoice?: {
    action: "approve" | "refuse";
    request: CloudOwnerRecoveryRequest;
  };
  @state() private recoveryBusy = false;
  @state() private recoveryReadError?: string;
  @state() private recoveryActionError?: string;
  @state() private recoveryNotice?: "cloud.recovery_approved" | "cloud.recovery_refused";
  #recoveryGeneration = 0;
  #recoveryKey = "";
  #recoveryBinding() {
    const s = this.status,
      r = s?.registration;
    return this.isConnected && readsBilling(s) && !s?.isRemote && r
      ? JSON.stringify([
          s.requestId,
          s.environment,
          r.organisationId,
          r.legalBusinessId,
          r.venueId,
          r.installationId,
        ])
      : "";
  }
  #clearRecovery() {
    this.#recoveryGeneration++;
    this.recoveryRequests = undefined;
    this.recoveryChoice = undefined;
    this.recoveryBusy = false;
    this.recoveryReadError = this.recoveryActionError = this.recoveryNotice = undefined;
  }
  async #loadRecovery() {
    const key = this.#recoveryBinding();
    if (!key || this.recoveryBusy) return;
    const generation = ++this.#recoveryGeneration;
    this.recoveryBusy = true;
    this.recoveryReadError = undefined;
    this.recoveryRequests = undefined;
    try {
      const { requests } = await this.api.readCloudOwnerRecovery();
      if (generation !== this.#recoveryGeneration || key !== this.#recoveryBinding()) return;
      const r = this.status!.registration!;
      if (
        requests.some(
          (v) =>
            v.organisationId !== r.organisationId ||
            v.legalBusinessId !== r.legalBusinessId ||
            v.venueId !== r.venueId ||
            v.installationId !== r.installationId ||
            v.environment !== this.status!.environment,
        )
      ) {
        this.recoveryReadError = "cloud.binding_conflict";
        return;
      }
      this.recoveryRequests = requests;
    } catch (error) {
      if (generation === this.#recoveryGeneration) this.recoveryReadError = codeOf(error);
    } finally {
      if (generation === this.#recoveryGeneration) this.recoveryBusy = false;
    }
  }
  async #decideRecovery() {
    const choice = this.recoveryChoice,
      key = this.#recoveryBinding();
    if (!choice || !key || this.recoveryBusy) return;
    const generation = ++this.#recoveryGeneration;
    this.recoveryBusy = true;
    this.recoveryActionError = this.recoveryNotice = undefined;
    let saved = false;
    try {
      await this.api.decideCloudOwnerRecovery(choice.action, choice.request);
      if (generation !== this.#recoveryGeneration || key !== this.#recoveryBinding()) return;
      this.recoveryChoice = undefined;
      this.recoveryNotice =
        choice.action === "approve" ? "cloud.recovery_approved" : "cloud.recovery_refused";
      saved = true;
    } catch (error) {
      if (generation === this.#recoveryGeneration) {
        this.recoveryActionError = codeOf(error);
        if (this.recoveryActionError === "cloud.request_unavailable") {
          this.recoveryChoice = undefined;
          this.recoveryRequests = this.recoveryRequests?.filter(
            (r) => r.requestId !== choice.request.requestId,
          );
          if (!this.recoveryRequests?.length) this.recoveryRequests = undefined;
        }
      }
    } finally {
      if (generation === this.#recoveryGeneration) this.recoveryBusy = false;
    }
    if (saved) void this.#loadRecovery();
  }
  #recoveryIdentity(r: CloudOwnerRecoveryRequest) {
    return html`<dl>
      <dt>${t("cloud.recovery_account")}</dt>
      <dd>${r.email}<br />${r.accountId}</dd>
      <dt>${t("cloud.organisation")}</dt>
      <dd>${this.status?.organisationName}<br />${r.organisationId}</dd>
      <dt>${t("cloud.business")}</dt>
      <dd>${this.status?.legalBusinessName}<br />${r.legalBusinessId}</dd>
      <dt>${t("cloud.recovery_venue")}</dt>
      <dd>${r.venueId}</dd>
      <dt>${t("cloud.recovery_expires")}</dt>
      <dd>
        <time datetime=${r.expiresAt}
          >${new Date(r.expiresAt).toLocaleString(currentLocale())}</time
        >
      </dd>
    </dl>`;
  }
  #recoveryPanel(s: CloudConnectionStatus) {
    const failures = [...new Set([this.recoveryActionError, this.recoveryReadError])].filter(
      (v): v is string => v !== undefined,
    );
    const choice = this.recoveryChoice;
    const error = html`${failures.map(
      (failure) =>
        html`<p class="error" role="alert">
          ${failure === "cloud.request_unavailable" ? t("cloud.recovery_changed") : codeMessage(failure)}
        </p>`,
    )}
    ${failures.includes("cloud.owner_recovery_admin_required") ? html`<wt-button id="recovery-sign-in" @click=${() => this.dispatchEvent(new CustomEvent("admin-sign-in", { bubbles: true, composed: true }))}>${t("cloud.recovery_sign_in")}</wt-button>` : nothing}`;
    return html`<section>
      <h2>${t("cloud.recovery_title")}</h2>
      <p>${t(s.isRemote ? "cloud.recovery_local" : "cloud.recovery_help")}</p>
      ${
        s.isRemote
          ? nothing
          : html` <wt-button
                id="recovery-load"
                variant="primary"
                .disabled=${this.recoveryBusy}
                @click=${() => {
                  this.recoveryNotice = undefined;
                  void this.#loadRecovery();
                }}
                >${t("cloud.recovery_load")}</wt-button
              >
              ${this.recoveryNotice ? html`<p role="status">${t(this.recoveryNotice)}</p>` : nothing}
              ${choice ? nothing : error}
              ${this.recoveryRequests?.length === 0 ? html`<p>${t("cloud.recovery_empty")}</p>` : nothing}
              ${this.recoveryRequests?.map(
                (r) =>
                  html`<div style="--wt-form-actions-in-place: true">
                    ${this.#recoveryIdentity(r)}
                    <wt-form-actions
                      ><wt-button
                        id=${`recovery-refuse-${r.requestId}`}
                        aria-label=${`${t("cloud.recovery_refuse")}: ${r.email}`}
                        variant="danger"
                        .disabled=${this.recoveryBusy}
                        @click=${() => {
                          this.recoveryActionError = undefined;
                          this.recoveryChoice = { action: "refuse", request: r };
                        }}
                        >${t("cloud.recovery_refuse")}</wt-button
                      >
                      <wt-button
                        id=${`recovery-approve-${r.requestId}`}
                        aria-label=${`${t("cloud.recovery_approve")}: ${r.email}`}
                        variant="primary"
                        .disabled=${this.recoveryBusy}
                        @click=${() => {
                          this.recoveryActionError = undefined;
                          this.recoveryChoice = { action: "approve", request: r };
                        }}
                        >${t("cloud.recovery_approve")}</wt-button
                      ></wt-form-actions
                    >
                  </div>`,
              )}
              <wt-dialog
                id="recovery-dialog"
                .open=${!!choice}
                .dismissible=${!this.recoveryBusy}
                heading=${t(choice?.action === "refuse" ? "cloud.recovery_refuse" : "cloud.recovery_approve")}
                @wt-close=${(e: Event) => {
                  e.stopPropagation();
                  this.recoveryChoice = undefined;
                }}
              >
                ${
                  choice
                    ? html`${this.#recoveryIdentity(choice.request)}
                        <p>
                          ${t(choice.action === "approve" ? "cloud.recovery_approve_help" : "cloud.recovery_refuse_help")}
                        </p>
                        ${error}`
                    : nothing
                }
                <wt-button
                  slot="footer"
                  id="recovery-cancel"
                  .disabled=${this.recoveryBusy}
                  @click=${() => {
                    this.recoveryChoice = undefined;
                  }}
                  >${t("cloud.recovery_cancel")}</wt-button
                >
                <wt-button
                  slot="footer"
                  id="recovery-confirm"
                  variant=${choice?.action === "refuse" ? "danger" : "primary"}
                  .disabled=${this.recoveryBusy}
                  @click=${() => void this.#decideRecovery()}
                  >${t(choice?.action === "refuse" ? "cloud.recovery_refuse" : "cloud.recovery_approve")}</wt-button
                >
              </wt-dialog>`
      }
    </section>`;
  }
  @state() private status: CloudConnectionStatus | undefined;
  @state() private busy = false;
  @state() private error: string | undefined;
  @state() private requestUnavailable = false;
  @state() private confirmingStop = false;
  @state() private confirmingRemoteOff = false;
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
  @state() private emergency: CloudEmergency | undefined;
  @state() private emergencyUnavailable = false;
  #emergencyKey: string | undefined;
  readonly #emergencyQueries = new QueryController(
    this,
    () => this.api.liveData,
    () => {
      this.emergency = undefined;
      this.emergencyUnavailable = true;
    },
  );
  #stopEmergency() {
    this.#clearCode();
    this.emergencyPeople = undefined;
    this.peopleError = undefined;
    this.#peopleQueries.release("getCloudEmergencyPeople");
    this.#emergencyQueries.release("getCloudEmergency");
    this.#emergencyKey = undefined;
    this.emergency = undefined;
    this.emergencyUnavailable = false;
  }
  #watchEmergency() {
    if (!this.isConnected) return;
    const key =
      readsBilling(this.status) && this.status?.registration
        ? JSON.stringify([this.status?.registration, this.canManageEmergency])
        : undefined;
    if (key === this.#emergencyKey) return;
    this.#stopEmergency();
    if (key === undefined) return;
    this.#emergencyKey = key;
    if (this.canManageEmergency)
      void this.#peopleQueries
        .watch(
          "getCloudEmergencyPeople",
          dashboardQuery(this.api, "getCloudEmergencyPeople", []),
          (value) => {
            if (key === this.#emergencyKey) {
              this.emergencyPeople = value;
              this.peopleError = undefined;
            }
          },
        )
        .catch(() => undefined);
    const query = dashboardQuery(this.api, "getCloudEmergency", []);
    void this.#emergencyQueries
      .watch("getCloudEmergency", { ...query, key: `${query.key}:${key}` }, (value) => {
        if (key !== this.#emergencyKey) return;
        this.emergency = value;
        this.emergencyUnavailable = false;
      })
      .catch(() => undefined);
  }
  override connectedCallback() {
    super.connectedCallback();
    this.busy = false;
    this.confirmingStop = false;
    this.confirmingRemoteOff = false;
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
    this.#clearRecovery();
    this.#recoveryKey = "";
    clearTimeout(this.#clock);
    this.#generation++;
    this.#stopBilling();
    this.#stopEmergency();
    super.disconnectedCallback();
  }
  protected override willUpdate() {
    const key = this.#recoveryBinding();
    if (key !== this.#recoveryKey) {
      this.#clearRecovery();
      this.#recoveryKey = key;
    }
    this.#watchEmergency();
    // Watched once while billing applies: `watch` would replace the slot and read again. A
    // detached screen's last update must not start a watch nobody releases.
    if (!this.isConnected || readsBilling(this.status) === this.#billingWatched) return;
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
  async #run(request: () => Promise<CloudConnectionStatus>, readAfterFailure = false) {
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
        if (readAfterFailure) {
          const status = await this.api.getCloudStatus().catch(() => undefined);
          if (status && generation === this.#generation) {
            this.#actionResults++;
            this.status = status;
          }
        }
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
  #emergency(s: CloudConnectionStatus) {
    const answer = this.emergency,
      facts = answer?.emergency,
      prices = answer?.prices;
    const { money, vat } = priceDisplay(prices);
    const time = (value: string) =>
      html`<time datetime=${value}>${new Date(value).toLocaleString(currentLocale())}</time>`;
    return html`<section data-test="cloud-emergency" aria-labelledby="cloud-emergency-heading">
      <h2 id="cloud-emergency-heading">${t("cloud.emergency")}</h2>
      ${this.emergencyUnavailable || facts?.status === "unavailable" ? html`<p>${t("cloud.emergency_unavailable")}</p>` : nothing}
      ${answer?.stale ? html`<p>${t("cloud.emergency_stale")}</p>` : nothing}
      ${
        facts?.status === "ready"
          ? html` <p>
                ${facts.open ? t("cloud.emergency_open") : t(`cloud.emergency_${facts.closedReason!}`)}
              </p>
              ${facts.address ? html`<p><a href=${facts.address} target="_blank" rel="noopener noreferrer">${facts.address}</a></p>` : nothing}
              <dl>
                <dt>${t("cloud.emergency_checked")}</dt>
                <dd>${time(answer!.asOf)}</dd>
                ${
                  facts.codeIssuedAt
                    ? html`<dt>${t("cloud.emergency_issued")}</dt>
                        <dd>${time(facts.codeIssuedAt)}</dd>`
                    : nothing
                }
              </dl>`
          : nothing
      }
      ${prices?.status === "published" ? html`<p>${fill("cloud.emergency_daily", { amount: money(Number((BigInt(prices.hostedMonthlyCents) + 15n) / 30n)), vat })}</p>` : prices?.status === "unavailable" ? html`<p>${t("cloud.billing_prices_unpublished")}</p>` : nothing}
      ${
        this.canManageEmergency && this.peopleError !== "authorization.not_permitted"
          ? html`
              ${this.peopleError ? html`<p>${t("cloud.emergency_people_unavailable")}</p>` : nothing}
              ${
                this.emergencyPeople
                  ? html`<p>
                        ${t("cloud.emergency_people")}:
                        ${
                          this.emergencyPeople
                            .filter((p) => p.hasAuthenticator)
                            .map((p) => p.displayName)
                            .join(", ") || t("cloud.emergency_nobody")
                        }
                      </p>
                      <p class="muted" data-test="emergency-needs-authenticator">
                        ${t("cloud.emergency_needs_authenticator")}:
                        ${
                          this.emergencyPeople
                            .filter((p) => !p.hasAuthenticator)
                            .map((p) => p.displayName)
                            .join(", ") || t("cloud.emergency_nobody")
                        }
                      </p>`
                  : nothing
              }
              ${
                this.revealedCode
                  ? html`<div data-test="emergency-code">
                        <p class="code">${this.revealedCode.code}</p>
                        <p>
                          <a
                            href=${this.revealedCode.address}
                            target="_blank"
                            rel="noopener noreferrer"
                            >${this.revealedCode.address}</a
                          >
                        </p>
                        <p>
                          ${t("cloud.emergency_issued")}: ${time(this.revealedCode.codeIssuedAt)}
                        </p>
                      </div>
                      <wt-button id="hide-emergency-code" @click=${() => this.#clearCode()}
                        >${t("cloud.emergency_hide_code")}</wt-button
                      >`
                  : html`<wt-button
                      id="show-emergency-code"
                      variant="primary"
                      ?disabled=${this.codeBusy}
                      .loading=${this.codeBusy}
                      @click=${() => void this.#revealCode()}
                      >${t("cloud.emergency_show_code")}</wt-button
                    >`
              }
              ${this.codeError ? html`<p role="alert" class="error">${this.codeError}</p>` : nothing}
            `
          : html`<p>${t("cloud.emergency_permission")}</p>
              <wt-button
                @click=${() => this.dispatchEvent(new CustomEvent("admin-sign-in", { bubbles: true, composed: true }))}
                >${t("cloud.emergency_sign_in")}</wt-button
              >`
      }
      <a href="/backup?recovery-pack=make">${t("cloud.emergency_print_pack")}</a>
      ${s.accountUrl ? html`<a href=${s.accountUrl} target="_blank" rel="noopener noreferrer">${t("cloud.account")}</a>` : nothing}
    </section>`;
  }
  #billing(s: CloudConnectionStatus) {
    const answer = this.billing;
    const locale = currentLocale();
    const level = (value: string) =>
      t(`cloud.billing_level_${value}` as "cloud.billing_level_hosted");
    const facts = answer?.billing;
    const prices = answer?.prices;
    const { money, vat } = priceDisplay(prices);
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
                ${
                  service.service === "remote_access" && s.remoteAccessEnabled === false
                    ? t("cloud.remote_off")
                    : html`${t(`cloud.state_${service.state}`)} ·
                      ${t(`cloud.health_${installation?.state === "revoked" || !service.observedAt || Date.parse(service.observedAt) <= Date.now() - 300000 ? "unknown" : service.health}`)}`
                }
              </dd>`,
        )}
      </dl>
      ${
        typeof s.remoteAccessEnabled === "boolean" && installation?.state !== "revoked"
          ? html`<section aria-labelledby="remote-access-heading">
              <h2 id="remote-access-heading">${t("cloud.remote_local")}</h2>
              <p data-test="remote-access-status" role="status">
                ${
                  s.remoteAccessPlanRequired && this.error !== "cloud.tunnel_plan_required"
                    ? codeMessage("cloud.tunnel_plan_required")
                    : t(s.remoteAccessEnabled ? "cloud.remote_on" : "cloud.remote_off")
                }
              </p>
              <p>${t("cloud.remote_help")}</p>
              ${
                s.isPrimary
                  ? html`<wt-button
                      id="remote-access"
                      variant="primary"
                      .disabled=${this.busy}
                      @click=${() => {
                        if (s.isRemote && s.remoteAccessEnabled) this.confirmingRemoteOff = true;
                        else
                          void this.#run(
                            () => this.api.setCloudRemoteAccess(!s.remoteAccessEnabled),
                            true,
                          );
                      }}
                      >${t(s.remoteAccessEnabled ? "cloud.remote_turn_off" : "cloud.remote_turn_on")}</wt-button
                    >`
                  : nothing
              }
              <wt-dialog
                id="remote-off-dialog"
                .open=${this.confirmingRemoteOff}
                heading=${t("cloud.remote_turn_off")}
                @wt-close=${(event: Event) => {
                  event.stopPropagation();
                  this.confirmingRemoteOff = false;
                }}
              >
                <p>${t("cloud.remote_help")}</p>
                <wt-button
                  slot="footer"
                  id="remote-off-stop"
                  @click=${() => {
                    this.confirmingRemoteOff = false;
                  }}
                  >${t("cloud.remote_stop")}</wt-button
                >
                <wt-button
                  slot="footer"
                  id="remote-off-confirm"
                  variant="primary"
                  @click=${() => {
                    this.confirmingRemoteOff = false;
                    void this.#run(() => this.api.setCloudRemoteAccess(false), true);
                  }}
                  >${t("cloud.remote_turn_off")}</wt-button
                >
              </wt-dialog>
            </section>`
          : nothing
      }
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
            ? html`${error ? nothing : html`<p role="status">${t("cloud.loading")}</p>`}
              ${button("retry", t("cloud.retry"), () => this.api.getCloudStatus())}`
            : !s.configured
              ? html`<p>${t("cloud.not_configured")}</p>`
              : html` ${!s.isPrimary ? html`<p>${t("cloud.not_primary")}</p>` : nothing}
                ${
                  s.state === "not_connected"
                    ? s.replacementError
                      ? s.replacementError === "cloud.replacement_state_invalid" && s.isPrimary
                        ? button("reissue-reconnection", t("cloud.replacement_reissue"), () =>
                            this.api.reissueCloudReplacement(),
                          )
                        : nothing
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
                          ${this.#installation(s)}
                          ${readsBilling(s) ? html`${this.#recoveryPanel(s)}${this.#billing(s)}${this.#emergency(s)}` : nothing}`
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
