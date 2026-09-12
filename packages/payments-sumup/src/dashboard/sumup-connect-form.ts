import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import { codeMessage, codeOf, type DashboardRequest } from "@waitron/dashboard-kit";
import { t } from "./strings.js";
import { SumUpPaymentsClient, ambiguousMerchants, type AmbiguousMerchant } from "./client.js";

// The AppError code the connect route raises when the API key spans several merchants: the form reads
// the carried `{ merchants }` list and shows a picker rather than surfacing an error.
const MERCHANT_AMBIGUOUS = "payment.provider_merchant_ambiguous";

/**
 * The SumUp CONNECT FORM: an API-key field (required, secret) plus the optional affiliate pair behind a
 * help tooltip. Follows the design-system Forms contract — required markers, a `wt-form-error-summary`,
 * secret fields as password inputs that are NEVER pre-filled, and `wt-form-actions` keeping the primary
 * action bottom-right. On submit it POSTs the connect route through the injected request; on success it
 * shows the returned merchant name for confirmation and calls `onConnected`. When the key covers several
 * merchants (`payment.provider_merchant_ambiguous`) it shows a picker and re-submits with the choice.
 */
@customElement("sumup-connect-form")
export class SumUpConnectForm extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }
      .field {
        display: block;
        margin-bottom: var(--wt-space-4);
      }
      .affiliate-label {
        display: flex;
        align-items: center;
        gap: var(--wt-space-1);
        margin-bottom: var(--wt-space-2);
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      .confirm {
        color: var(--wt-color-success, var(--wt-color-text));
      }
    `,
  ];

  /** The dashboard request primitive the panel injects; every call goes through it. */
  @property({ attribute: false }) request!: DashboardRequest;

  /** Called after a successful connect (the screen refreshes its provider list). */
  @property({ attribute: false }) onConnected: () => void = () => {};

  @state() private apiKey = "";
  @state() private affiliateAppId = "";
  @state() private affiliateKey = "";
  @state() private merchants: AmbiguousMerchant[] | null = null;
  @state() private merchantCode = "";
  @state() private errors: string[] = [];
  @state() private busy = false;
  @state() private connectedName: string | null = null;

  #client(): SumUpPaymentsClient {
    return new SumUpPaymentsClient(this.request);
  }

  #onField(
    event: CustomEvent<{ value: string }>,
    field: "apiKey" | "affiliateAppId" | "affiliateKey",
  ): void {
    event.stopPropagation();
    this[field] = event.detail.value;
  }

  #onMerchant(event: Event): void {
    event.stopPropagation();
    this.merchantCode = (event.target as HTMLSelectElement).value;
  }

  /** Validate the required fields; returns the error message keys to show, or `[]` when valid. */
  #validate(): string[] {
    const errors: string[] = [];
    if (this.apiKey.trim() === "") errors.push("payments.sumup.api_key_required");
    if (this.merchants !== null && this.merchantCode === "")
      errors.push("payments.sumup.merchant_required");
    return errors;
  }

  async #connect(event: Event): Promise<void> {
    event.stopPropagation();
    if (this.busy) return; // single-flight
    const errorKeys = this.#validate();
    if (errorKeys.length > 0) {
      this.errors = errorKeys.map((k) => t(k as Parameters<typeof t>[0]));
      return;
    }
    this.errors = [];
    this.busy = true;
    try {
      const result = await this.#client().connect({
        apiKey: this.apiKey,
        ...(this.affiliateAppId !== "" ? { affiliateAppId: this.affiliateAppId } : {}),
        ...(this.affiliateKey !== "" ? { affiliateKey: this.affiliateKey } : {}),
        ...(this.merchantCode !== "" ? { merchantCode: this.merchantCode } : {}),
      });
      this.connectedName = result.merchantName;
      this.onConnected();
    } catch (error) {
      if (codeOf(error) === MERCHANT_AMBIGUOUS) {
        // The key spans several merchants: switch to the picker, no error banner.
        this.merchants = ambiguousMerchants(error);
        this.errors = [];
      } else {
        this.errors = [codeMessageOrConnect(error)];
      }
    } finally {
      this.busy = false;
    }
  }

  override render(): TemplateResult {
    if (this.connectedName !== null) {
      return html`<p class="confirm" data-test="connected">
        ${t("payments.sumup.connected_as").replace("{name}", this.connectedName)}
      </p>`;
    }
    return html`
      <wt-form-error-summary
        heading=${t("payments.sumup.form_problem")}
        .errors=${this.errors}
      ></wt-form-error-summary>

      <wt-input
        class="field"
        type="password"
        name="apiKey"
        data-test="api-key"
        label=${t("payments.sumup.api_key")}
        required
        .value=${this.apiKey}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(e, "apiKey")}
      ></wt-input>

      <div class="affiliate-label">
        <span>${t("payments.sumup.affiliate_app_id")} / ${t("payments.sumup.affiliate_key")}</span>
        <wt-help-tooltip
          aria-label=${t("payments.sumup.affiliate_help_label")}
          data-test="affiliate-help"
        >
          ${t("payments.sumup.affiliate_help")}
        </wt-help-tooltip>
      </div>
      <wt-input
        class="field"
        type="password"
        name="affiliateAppId"
        data-test="affiliate-app-id"
        label=${t("payments.sumup.affiliate_app_id")}
        .value=${this.affiliateAppId}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(e, "affiliateAppId")}
      ></wt-input>
      <wt-input
        class="field"
        type="password"
        name="affiliateKey"
        data-test="affiliate-key"
        label=${t("payments.sumup.affiliate_key")}
        .value=${this.affiliateKey}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(e, "affiliateKey")}
      ></wt-input>

      ${
        this.merchants !== null
          ? html`<label class="field"
              >${t("payments.sumup.merchant_prompt")}
              <select data-test="merchant" @change=${(e: Event) => this.#onMerchant(e)}>
                <option value="" .selected=${this.merchantCode === ""}></option>
                ${this.merchants.map(
                  (m) =>
                    html`<option value=${m.code} .selected=${m.code === this.merchantCode}>
                      ${m.name}
                    </option>`,
                )}
              </select>
            </label>`
          : nothing
      }

      <wt-form-actions>
        <wt-button
          variant="primary"
          data-test="connect"
          ?loading=${this.busy}
          @click=${(e: Event) => void this.#connect(e)}
          >${t("payments.sumup.connect")}</wt-button
        >
      </wt-form-actions>
    `;
  }
}

/** A rejected connect that is not the merchant-ambiguous case: prefer the SumUp-specific "key not
 * accepted" copy for the rejected-credential code, else the shared code copy. */
function codeMessageOrConnect(error: unknown): string {
  return codeOf(error) === "payment.provider_credential_rejected"
    ? t("payments.sumup.connect_failed")
    : codeMessage(codeOf(error));
}

declare global {
  interface HTMLElementTagNameMap {
    "sumup-connect-form": SumUpConnectForm;
  }
}
