import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, focusFirstInvalid, leaveCoordinatorFor } from "@waitron/ui";
import type { DraftScope } from "@waitron/ui";
import { keyed } from "lit/directives/keyed.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { codeMessage, codeOf, type DashboardRequest } from "@waitron/dashboard-kit";
import { t } from "./strings.js";
import { StripePaymentsClient, type StripeConnectPayload } from "./client.js";

type Field = "secretKey" | "webhookSecret" | "successUrl" | "cancelUrl";

@customElement("stripe-connect-form")
export class StripeConnectForm extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .field {
        display: block;
        margin-bottom: var(--wt-space-4);
      }
      .confirm {
        color: var(--wt-color-success, var(--wt-color-text));
      }
    `,
  ];

  @property({ attribute: false }) request!: DashboardRequest;
  @property({ attribute: false }) onConnected: () => void = () => {};

  @state() private secretKey = "";
  @state() private webhookSecret = "";
  @state() private successUrl = "";
  @state() private cancelUrl = "";
  @state() private attempted = false;
  /** A refusal that names no field, shown above Connect until the next press. */
  @state() private refusal = "";
  @state() private busy = false;
  @state() private connectedName: string | null = null;

  #opening = {};
  #scope?: DraftScope<StripeConnectPayload>;

  #value(): StripeConnectPayload {
    return {
      secretKey: this.secretKey,
      webhookSecret: this.webhookSecret,
      successUrl: this.successUrl,
      cancelUrl: this.cancelUrl,
    };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#opening = {};
    this.#scope = leaveCoordinatorFor(this)?.register<StripeConnectPayload>({
      id: this,
      parent: (this.getRootNode() as ShadowRoot).host,
      current: () => this.#value(),
      snapshot: (value) => ({ ...value }),
      equal: (a, b) =>
        this.busy ||
        (a.secretKey === b.secretKey &&
          a.webhookSecret === b.webhookSecret &&
          a.successUrl === b.successUrl &&
          a.cancelUrl === b.cancelUrl),
      restore: (value) => {
        this.secretKey = value.secretKey;
        this.webhookSecret = value.webhookSecret;
        this.successUrl = value.successUrl;
        this.cancelUrl = value.cancelUrl;
      },
    });
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.#opening = {};
    this.#scope?.dispose();
    this.#scope = undefined;
    this.secretKey = "";
    this.webhookSecret = "";
    this.successUrl = "";
    this.cancelUrl = "";
    this.attempted = false;
    this.refusal = "";
    this.busy = false;
    this.connectedName = null;

    super.disconnectedCallback();
  }

  #onField(event: CustomEvent<{ value: string }>, field: Field, opening: object): void {
    event.stopPropagation();
    if (!this.isConnected || opening !== this.#opening) return;
    this[field] = event.detail.value;
    this.#scope?.changed();
  }

  #secretKeyError(): string {
    const missing = this.attempted && this.secretKey.trim() === "";
    return missing ? t("payments.stripe.secret_key_required") : "";
  }

  async #focusFirstInvalid(): Promise<void> {
    await this.updateComplete;
    await focusFirstInvalid(this.shadowRoot!);
  }

  async #connect(event: Event, opening: object): Promise<void> {
    event.stopPropagation();
    if (this.busy || !this.isConnected || opening !== this.#opening) return;
    const scope = this.#scope;
    const submitted = this.#value();
    this.attempted = true;
    this.refusal = "";
    if (this.#secretKeyError() !== "") {
      await this.#focusFirstInvalid();
      return;
    }
    this.busy = true;
    scope?.changed();
    try {
      const result = await new StripePaymentsClient(this.request).connect({
        secretKey: submitted.secretKey,
        webhookSecret: submitted.webhookSecret,
        successUrl: submitted.successUrl,
        cancelUrl: submitted.cancelUrl,
      });
      if (!this.isConnected || opening !== this.#opening) return;
      this.busy = false;
      scope?.commit(submitted);
      if (scope?.isDirty()) return;
      scope?.dispose();
      this.#scope = undefined;
      this.secretKey = "";
      this.webhookSecret = "";
      this.successUrl = "";
      this.cancelUrl = "";
      this.connectedName = result.merchantName;
      this.onConnected();
    } catch (error) {
      if (!this.isConnected || opening !== this.#opening) return;
      this.refusal =
        codeOf(error) === "payment.provider_credential_rejected"
          ? t("payments.stripe.connect_failed")
          : codeMessage(codeOf(error));
    } finally {
      if (opening === this.#opening) {
        this.busy = false;
        scope?.changed();
      }
    }
  }

  override render(): TemplateResult {
    return html`${keyed(this.#opening, this.#renderForm())}`;
  }

  #renderForm(): TemplateResult {
    const opening = this.#opening;
    if (this.connectedName !== null) {
      return html`<p class="confirm" data-test="connected">
        ${t("payments.stripe.connected_as").replace("{name}", this.connectedName)}
      </p>`;
    }
    const secretKeyError = this.#secretKeyError();
    const blocked = secretKeyError !== "";
    return html`
      <wt-input
        class="field"
        type="password"
        name="secretKey"
        data-test="secret-key"
        label=${t("payments.stripe.secret_key")}
        required
        error=${secretKeyError}
        .value=${this.secretKey}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(e, "secretKey", opening)}
      ></wt-input>
      <wt-input
        class="field"
        type="password"
        name="webhookSecret"
        data-test="webhook-secret"
        label=${t("payments.stripe.webhook_secret")}
        .value=${this.webhookSecret}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(e, "webhookSecret", opening)}
      ></wt-input>
      <wt-input
        class="field"
        name="successUrl"
        data-test="success-url"
        label=${t("payments.stripe.success_url")}
        .value=${this.successUrl}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(e, "successUrl", opening)}
      ></wt-input>
      <wt-input
        class="field"
        name="cancelUrl"
        data-test="cancel-url"
        label=${t("payments.stripe.cancel_url")}
        .value=${this.cancelUrl}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(e, "cancelUrl", opening)}
      ></wt-input>
      <wt-form-actions
        .error=${[this.refusal, blocked ? t("payments.stripe.fix_fields") : ""]
          .filter(Boolean)
          .join(" ")}
      >
        <wt-button
          variant="primary"
          data-test="connect"
          ?loading=${this.busy}
          ?disabled=${blocked}
          @click=${(e: Event) => void this.#connect(e, opening)}
          >${t("payments.stripe.connect")}</wt-button
        >
      </wt-form-actions>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "stripe-connect-form": StripeConnectForm;
  }
}
