import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  FormFeedback,
  bottomMessage,
  draftScopeFor,
  saveActionState,
  submitOnEnter,
} from "@waitron/ui";
import type { DraftScope } from "@waitron/ui";
import { keyed } from "lit/directives/keyed.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import {
  codeMessage,
  codeOf,
  type CardProviderPanel,
  type DashboardRequest,
} from "@waitron/dashboard-kit";
import { t } from "./strings.js";
import {
  SumUpPaymentsClient,
  ambiguousMerchants,
  type AmbiguousMerchant,
  type SumUpConnectPayload,
} from "./client.js";

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

  @property({ attribute: false }) actions?: Parameters<
    CardProviderPanel["renderConnectForm"]
  >[0]["actions"];

  @state() private apiKey = "";
  @state() private merchants: AmbiguousMerchant[] | null = null;
  @state() private merchantCode = "";
  readonly #feedback = new FormFeedback(this);
  /** A refusal that names no field, shown above Connect until the next press. */
  @state() private refusal = "";
  @state() private busy = false;
  @state() private connectedName: string | null = null;

  #client(): SumUpPaymentsClient {
    return new SumUpPaymentsClient(this.request);
  }

  #opening = {};
  #scope?: DraftScope<Required<SumUpConnectPayload>>;

  #value(): Required<SumUpConnectPayload> {
    return {
      apiKey: this.apiKey,
      merchantCode: this.merchantCode,
    };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#opening = {};
    this.#scope = draftScopeFor(this, {
      id: this,
      parent: (this.getRootNode() as ShadowRoot).host,
      current: () => this.#value(),
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => this.busy || (a.apiKey === b.apiKey && a.merchantCode === b.merchantCode),
      restore: (value) => {
        this.apiKey = value.apiKey;
        this.merchantCode = value.merchantCode;
      },
    }).scope;
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.#opening = {};
    this.#scope?.dispose();
    this.#scope = undefined;
    this.apiKey = "";
    this.merchantCode = "";
    this.#feedback.reset();
    this.refusal = "";
    this.busy = false;
    this.connectedName = null;
    this.merchants = null;
    super.disconnectedCallback();
  }

  #onField(event: CustomEvent<{ value: string }>, field: "apiKey", opening: object): void {
    event.stopPropagation();
    if (!this.isConnected || opening !== this.#opening) return;
    this[field] = event.detail.value;
    this.#scope?.changed();
  }

  #onMerchant(event: CustomEvent<{ value: string }>, opening: object): void {
    event.stopPropagation();
    if (!this.isConnected || opening !== this.#opening) return;
    this.merchantCode = event.detail.value;
    this.#scope?.changed();
  }

  #fieldErrors(): { apiKey: string; merchant: string } {
    const apiKeyMissing = this.#feedback.attempted && this.apiKey.trim() === "";
    const merchantMissing =
      this.#feedback.attempted && this.merchants !== null && this.merchantCode === "";
    return {
      apiKey: apiKeyMissing ? t("payments.sumup.api_key_required") : "",
      merchant: merchantMissing ? t("payments.sumup.merchant_required") : "",
    };
  }

  #blocked(): boolean {
    const errors = this.#fieldErrors();
    return errors.apiKey !== "" || errors.merchant !== "";
  }

  async #connect(event: Event, opening: object): Promise<void> {
    event.stopPropagation();
    if (
      this.busy ||
      !this.isConnected ||
      opening !== this.#opening ||
      (this.actions && !this.#scope?.isDirty())
    )
      return;
    const scope = this.#scope;
    const submitted = this.#value();
    this.#feedback.press();
    this.refusal = "";
    if (this.#blocked()) {
      await this.#feedback.focus(this.shadowRoot!);
      return;
    }
    this.busy = true;
    this.actions?.onBusy(true);
    scope?.changed();
    try {
      const result = await this.#client().connect({
        apiKey: submitted.apiKey,
        ...(submitted.merchantCode !== "" ? { merchantCode: submitted.merchantCode } : {}),
      });
      if (!this.isConnected || opening !== this.#opening) return;
      this.busy = false;
      this.actions?.onBusy(false);
      scope?.commit(submitted);
      if (scope?.isDirty()) return;
      scope?.dispose();
      this.#scope = undefined;
      this.apiKey = "";
      this.merchantCode = "";
      this.connectedName = result.merchantName;
      this.onConnected();
    } catch (error) {
      if (!this.isConnected || opening !== this.#opening) return;
      if (codeOf(error) === MERCHANT_AMBIGUOUS) {
        // The key spans several merchants: switch to the picker, not yet marked as missing.
        this.merchants = ambiguousMerchants(error);
        this.#feedback.reset();
      } else if (codeOf(error) === "payment.provider_credential_rejected") {
        this.refusal = t("payments.sumup.connect_failed");
      } else {
        this.refusal = codeMessage(codeOf(error));
      }
    } finally {
      if (opening === this.#opening) {
        this.busy = false;
        this.actions?.onBusy(false);
        scope?.changed();
      }
    }
  }

  override render(): TemplateResult {
    return html`${keyed(this.#opening, this.#renderForm())}`;
  }

  #renderForm(): TemplateResult {
    const opening = this.#opening;
    const save = saveActionState(this.#scope);
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
        @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.renderRoot.querySelector("[data-test=connect]"))}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(e, "apiKey", opening)}
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
                .value=${this.merchantCode}
                required
                label=${t("payments.sumup.merchant")}
                search="auto"
                searchPlaceholder=${t("payments.sumup.combobox_search")}
                noResultsLabel=${t("payments.sumup.combobox_no_results")}
                .options=${this.merchants.map((m) => ({ value: m.code, label: m.name }))}
                error=${errors.merchant}
                @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.renderRoot.querySelector("[data-test=connect]"))}
                @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onMerchant(e, opening)}
              ></wt-combobox>
            </div>`
          : nothing
      }

      <wt-form-actions
        .error=${bottomMessage(this.refusal, blocked ? t("payments.sumup.fix_fields") : "")}
      >
        ${this.actions ? html`<wt-button slot="cancel" variant="secondary" ?disabled=${this.busy} @click=${() => this.actions?.onCancel()}>${this.actions.cancelLabel}</wt-button>` : nothing}
        <wt-button
          variant=${this.actions && !this.busy ? save.variant : "primary"}
          data-test="connect"
          ?loading=${this.busy}
          ?disabled=${blocked || (!!this.actions && save.unchanged)}
          @click=${(e: Event) => void this.#connect(e, opening)}
          >${this.actions?.saveLabel ?? t("payments.sumup.connect")}</wt-button
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
