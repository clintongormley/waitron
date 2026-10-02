import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, focusFirstInvalid } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import { codeMessage, codeOf, type DashboardRequest } from "@waitron/dashboard-kit";
import { t } from "./strings.js";
import { SumUpPaymentsClient, ambiguousMerchants, type AmbiguousMerchant } from "./client.js";

// The AppError code the connect route raises when the API key spans several merchants: the form reads
// the carried `{ merchants }` list and shows a picker rather than surfacing an error.
const MERCHANT_AMBIGUOUS = "payment.provider_merchant_ambiguous";

/**
 * The SumUp CONNECT FORM. Secret fields are password inputs that are NEVER pre-filled. When the key
 * covers several merchants (`payment.provider_merchant_ambiguous`) it shows a picker and re-submits
 * with the choice.
 */
@customElement("sumup-connect-form")
export class SumUpConnectForm extends LitElement {
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
      .merchant-prompt {
        margin: 0 0 var(--wt-space-2);
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
  @state() private attempted = false;
  /** A refusal that names no field, shown above Connect until the next press. */
  @state() private refusal = "";
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

  #onMerchant(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.merchantCode = event.detail.value;
  }

  #fieldErrors(): { apiKey: string; merchant: string } {
    const apiKeyMissing = this.attempted && this.apiKey.trim() === "";
    const merchantMissing = this.attempted && this.merchants !== null && this.merchantCode === "";
    return {
      apiKey: apiKeyMissing ? t("payments.sumup.api_key_required") : "",
      merchant: merchantMissing ? t("payments.sumup.merchant_required") : "",
    };
  }

  #blocked(): boolean {
    const errors = this.#fieldErrors();
    return errors.apiKey !== "" || errors.merchant !== "";
  }

  async #focusFirstInvalid(): Promise<void> {
    await this.updateComplete;
    await focusFirstInvalid(this.shadowRoot!);
  }

  async #connect(event: Event): Promise<void> {
    event.stopPropagation();
    if (this.busy) return; // single-flight
    this.attempted = true;
    this.refusal = "";
    if (this.#blocked()) {
      await this.#focusFirstInvalid();
      return;
    }
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
        // The key spans several merchants: switch to the picker, not yet marked as missing.
        this.merchants = ambiguousMerchants(error);
        this.attempted = false;
      } else if (codeOf(error) === "payment.provider_credential_rejected") {
        this.refusal = t("payments.sumup.connect_failed");
      } else {
        this.refusal = codeMessage(codeOf(error));
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
    const errors = this.#fieldErrors();
    const blocked = this.#blocked();
    return html`
      <wt-input
        class="field"
        type="password"
        name="apiKey"
        data-test="api-key"
        label=${t("payments.sumup.api_key")}
        required
        error=${errors.apiKey}
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
          ? html`<div class="field">
              <p class="merchant-prompt" data-test="merchant-prompt">
                ${t("payments.sumup.merchant_prompt")}
              </p>
              <wt-combobox
                data-test="merchant"
                name="merchantCode"
                required
                label=${t("payments.sumup.merchant")}
                search="auto"
                searchPlaceholder=${t("payments.sumup.combobox_search")}
                noResultsLabel=${t("payments.sumup.combobox_no_results")}
                .options=${this.merchants.map((m) => ({ value: m.code, label: m.name }))}
                error=${errors.merchant}
                @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onMerchant(e)}
              ></wt-combobox>
            </div>`
          : nothing
      }

      <wt-form-actions
        .error=${[this.refusal, blocked ? t("payments.sumup.fix_fields") : ""]
          .filter(Boolean)
          .join(" ")}
      >
        <wt-button
          variant="primary"
          data-test="connect"
          ?loading=${this.busy}
          ?disabled=${blocked}
          @click=${(e: Event) => void this.#connect(e)}
          >${t("payments.sumup.connect")}</wt-button
        >
      </wt-form-actions>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sumup-connect-form": SumUpConnectForm;
  }
}
