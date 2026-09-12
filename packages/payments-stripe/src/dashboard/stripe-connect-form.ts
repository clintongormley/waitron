import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import { codeMessage, codeOf, type DashboardRequest } from "@waitron/dashboard-kit";
import { t } from "./strings.js";
import { StripePaymentsClient } from "./client.js";

type Field = "secretKey" | "webhookSecret" | "successUrl" | "cancelUrl";

/**
 * The Stripe CONNECT FORM: the secret key + webhook signing secret (both secret, password inputs, never
 * pre-filled) and the hosted-checkout return URLs. Follows the design-system Forms contract — required
 * marker on the secret key, a `wt-form-error-summary`, and `wt-form-actions` keeping the primary action
 * bottom-right. On submit it POSTs the connect route through the injected request; on success it shows
 * the returned merchant name and calls `onConnected`.
 */
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
  @state() private errors: string[] = [];
  @state() private busy = false;
  @state() private connectedName: string | null = null;

  #onField(event: CustomEvent<{ value: string }>, field: Field): void {
    event.stopPropagation();
    this[field] = event.detail.value;
  }

  async #connect(event: Event): Promise<void> {
    event.stopPropagation();
    if (this.busy) return; // single-flight
    if (this.secretKey.trim() === "") {
      this.errors = [t("payments.stripe.secret_key_required")];
      return;
    }
    this.errors = [];
    this.busy = true;
    try {
      const result = await new StripePaymentsClient(this.request).connect({
        secretKey: this.secretKey,
        webhookSecret: this.webhookSecret,
        successUrl: this.successUrl,
        cancelUrl: this.cancelUrl,
      });
      this.connectedName = result.merchantName;
      this.onConnected();
    } catch (error) {
      this.errors = [
        codeOf(error) === "payment.provider_credential_rejected"
          ? t("payments.stripe.connect_failed")
          : codeMessage(codeOf(error)),
      ];
    } finally {
      this.busy = false;
    }
  }

  override render(): TemplateResult {
    if (this.connectedName !== null) {
      return html`<p class="confirm" data-test="connected">
        ${t("payments.stripe.connected_as").replace("{name}", this.connectedName)}
      </p>`;
    }
    return html`
      <wt-form-error-summary
        heading=${t("payments.stripe.form_problem")}
        .errors=${this.errors}
      ></wt-form-error-summary>
      <wt-input
        class="field"
        type="password"
        name="secretKey"
        data-test="secret-key"
        label=${t("payments.stripe.secret_key")}
        required
        .value=${this.secretKey}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(e, "secretKey")}
      ></wt-input>
      <wt-input
        class="field"
        type="password"
        name="webhookSecret"
        data-test="webhook-secret"
        label=${t("payments.stripe.webhook_secret")}
        .value=${this.webhookSecret}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(e, "webhookSecret")}
      ></wt-input>
      <wt-input
        class="field"
        name="successUrl"
        data-test="success-url"
        label=${t("payments.stripe.success_url")}
        .value=${this.successUrl}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(e, "successUrl")}
      ></wt-input>
      <wt-input
        class="field"
        name="cancelUrl"
        data-test="cancel-url"
        label=${t("payments.stripe.cancel_url")}
        .value=${this.cancelUrl}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(e, "cancelUrl")}
      ></wt-input>
      <wt-form-actions>
        <wt-button
          variant="primary"
          data-test="connect"
          ?loading=${this.busy}
          @click=${(e: Event) => void this.#connect(e)}
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
