import { LitElement, css, html } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { trackDialog } from "./track-dialog.js";
import {
  baseStyles,
  focusFirstInvalid,
  submitOnEnter,
  draftScopeFor,
  saveActionState,
} from "@waitron/ui";
import type { WtDialog, DraftScope, LeaveCoordinator, LeaveReason } from "@waitron/ui";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import { isValidEmail } from "@waitron/shared";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";

export interface InvoiceEmailSendDetail {
  recipient: string;
}

/** Why the last send was refused: its code, if it answered one, and the field the code names. */
export interface InvoiceEmailRefusal {
  code?: string;
  field?: string;
}

/** Asks for the customer's address to email a full invoice to; the owner sends it. */
@customElement("till-invoice-email-dialog")
export class TillInvoiceEmailDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .fields {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
        width: var(--wt-form-max-width);
        max-width: 100%;
      }
    `,
  ];

  /** The invoice was already delivered, so this sends a copy. */
  @property({ type: Boolean }) copy = false;
  /** A send is out: it cannot be abandoned, so the form holds its field, Cancel and closing. */
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) refusal?: InvoiceEmailRefusal;

  /** The refusal typed over since; the owner's `refusal` is left as given. */
  @state() private dismissedRefusal?: InvoiceEmailRefusal;
  @state() private value = "";
  @state() private attempted = false;
  @state() private active = true;
  #scope?: DraftScope<string>;
  #leave?: LeaveCoordinator;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override willUpdate(): void {
    if (!this.isConnected || !this.active || this.#scope) return;
    const { coordinator, scope } = draftScopeFor<string>(this, {
      id: this,
      current: () => this.value,
      snapshot: (value) => value,
      equal: (a, b) => a.trim() === b.trim(),
      restore: (value) => (this.value = value),
    });
    this.#leave = coordinator;
    this.#scope = scope;
    scope.commit("");
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  override async firstUpdated(): Promise<void> {
    await this.renderRoot.querySelector<WtDialog>("wt-dialog")!.updateComplete;
    this.renderRoot.querySelector<HTMLElement>("wt-input")!.focus();
  }

  #invalid(): boolean {
    return !isValidEmail(this.value);
  }

  #refusal(): InvoiceEmailRefusal | undefined {
    return this.refusal === this.dismissedRefusal ? undefined : this.refusal;
  }

  #fieldError(): string {
    return (this.attempted && this.#invalid()) || this.#refusal()?.field === "recipient"
      ? t("invoice.email_invalid")
      : "";
  }

  #bottomMessage(fieldError: string): string {
    if (fieldError !== "") return t("form.fix_fields");
    const refusal = this.#refusal();
    if (refusal === undefined) return "";
    return refusal.code === undefined ? t("invoice.delivery_error") : codeMessage(refusal.code);
  }

  #onInput(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (!this.isConnected || !this.active) return;
    this.value = event.detail.value;
    this.#scope?.changed();
    if (this.#refusal()?.field !== undefined) this.dismissedRefusal = this.refusal;
  }

  async #send(): Promise<void> {
    if (!this.isConnected || !this.active || this.busy) return;
    if (saveActionState(this.#scope).unchanged) return;
    this.attempted = true;
    if (this.#invalid()) {
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    this.dispatchEvent(
      new CustomEvent<InvoiceEmailSendDetail>("invoice-email-send", {
        detail: { recipient: this.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #cancel(): void {
    if (!this.isConnected || !this.active || this.busy) return;
    if (this.#leave) {
      void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel");
      return;
    }
    this.#reportClose();
  }

  #closed(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || !this.isConnected || !this.active) return;
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#reportClose();
  }

  #reportClose(): void {
    this.dispatchEvent(new CustomEvent("invoice-email-cancel", { bubbles: true, composed: true }));
  }

  override render() {
    const error = this.#fieldError();
    const sendAction = saveActionState(this.#scope);
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.active}
      .dismissible=${!this.busy}
      .beforeClose=${this.#leave ? this.#beforeClose : undefined}
      .heading=${t(this.copy ? "invoice.email_copy" : "invoice.email_send")}
      @wt-close=${(event: Event) => this.#closed(event)}
    >
      <div class="fields">
        <wt-input
          name="email"
          type="email"
          required
          autocomplete="off"
          .label=${t("invoice.email")}
          .value=${live(this.value)}
          .error=${error}
          ?disabled=${this.busy}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#onInput(event)}
          @keydown=${(event: KeyboardEvent) =>
            submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-email-send]"))}
        ></wt-input>
        <wt-form-actions .error=${this.#bottomMessage(error)}>
          <wt-button
            slot="cancel"
            data-email-cancel
            variant="secondary"
            ?disabled=${this.busy}
            @click=${() => this.#cancel()}
          >
            ${t("action.cancel")}
          </wt-button>
          <wt-button
            data-email-send
            variant=${sendAction.variant}
            ?loading=${this.busy}
            ?disabled=${sendAction.unchanged || this.busy || (this.attempted && this.#invalid())}
            @click=${() => void this.#send()}
          >
            ${t("action.send")}
          </wt-button>
        </wt-form-actions>
      </div>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-invoice-email-dialog": TillInvoiceEmailDialog;
  }
}
