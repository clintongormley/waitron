import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { formatMoney } from "@waitron/shared";
import { baseStyles, focusFirstInvalid, submitOnEnter } from "@waitron/ui";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import { trackDialog } from "./track-dialog.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import { REASON_MAX, type DialogRefusal } from "../state/bill-payment.js";

/** A cancelled bill: the number of the credit note issued, or null when it could not be read. */
export interface CancelCreditDone {
  creditNote: string | null;
}

const REFUSALS: Record<string, StringKey> = {
  network: "cancel_credit.unconfirmed",
  approvers: "cancel_credit.approvers_failed",
  "bill.payments_received": "cancel_credit.refused_payments",
  "order.payment_in_flight": "cancel_credit.refused_payment_in_flight",
  "authorization.not_permitted": "cancel_credit.refused_not_permitted",
};

/**
 * Cancels an invoiced bill nothing was paid on: its invoice is credited in full by a credit note
 * and the bill is cancelled. It holds no request of its own: `cancel-credit-continue` carries the
 * reason, which the app sends in the operator's name, or with the PIN of someone who may issue
 * credit notes. `done` turns it into the result.
 */
@customElement("till-cancel-credit-dialog")
export class TillCancelCreditDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .body {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
      }

      p {
        margin: 0;
      }

      .muted {
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property({ attribute: false }) invoiceNumber: string | null = null;
  @property({ attribute: false }) amount = "0.00";
  @property({ attribute: false }) refusal: DialogRefusal | null = null;
  @property({ attribute: false }) done: CancelCreditDone | null = null;
  @property({ type: Boolean }) busy = false;

  @state() private reason = "";
  @state() private attempted = false;
  /** The refusal still shown: it goes when the reason changes, if it named the reason, or at the
   * next request. */
  @state() private shownRefusal: DialogRefusal | null = null;

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("refusal")) this.shownRefusal = this.refusal;
  }

  #ownError(): string | null {
    const reason = this.reason.trim();
    if (reason === "") return t("cancel_credit.reason_invalid");
    if (reason.length > REASON_MAX) return t("cancel_credit.reason_long");
    return null;
  }

  #refusalOnReason(): boolean {
    const refusal = this.shownRefusal;
    return refusal?.code === "working_order.reason_required" || refusal?.field === "reason";
  }

  #reasonError(own: string | null): string | null {
    if (own !== null) return own;
    return this.#refusalOnReason() ? t("cancel_credit.reason_invalid") : null;
  }

  #refusalText(refusal: DialogRefusal): string {
    return Object.hasOwn(REFUSALS, refusal.code)
      ? t(REFUSALS[refusal.code]!)
      : codeMessage(refusal.code);
  }

  #bottomMessage(fieldError: string | null): string {
    const parts: string[] = [];
    if (fieldError !== null) parts.push(t("form.fix_fields"));
    if (this.shownRefusal !== null && !this.#refusalOnReason())
      parts.push(this.#refusalText(this.shownRefusal));
    return parts.join(" ");
  }

  #emit(type: string, detail: unknown = {}): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  async #continue(): Promise<void> {
    this.attempted = true;
    this.shownRefusal = null;
    if (this.#ownError() !== null) {
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    this.#emit("cancel-credit-continue", { reason: this.reason.trim() });
  }

  #scope(): string {
    const amount = formatMoney(this.amount, currentLocale());
    return this.invoiceNumber === null
      ? t("cancel_credit.scope_unnumbered").replace("{amount}", () => amount)
      : t("cancel_credit.scope")
          .replace("{invoice}", () => this.invoiceNumber!)
          .replace("{amount}", () => amount);
  }

  #doneBody(done: CancelCreditDone) {
    return html`<div class="body">
      <p role="status" data-cancel-credit-done>
        ${
          done.creditNote === null
            ? t("cancel_credit.done_unnumbered")
            : t("cancel_credit.done").replace("{number}", () => done.creditNote!)
        }
      </p>
      <wt-form-actions>
        <wt-button
          variant="primary"
          data-cancel-credit-finished
          @click=${() => this.#emit("cancel-credit-close")}
        >
          ${t("cancel_credit.done_action")}
        </wt-button>
      </wt-form-actions>
    </div>`;
  }

  #formBody() {
    const own = this.attempted ? this.#ownError() : null;
    const fieldError = this.#reasonError(own);
    return html`<div class="body">
      <p data-cancel-credit-scope>${this.#scope()}</p>
      <wt-input
        name="reason"
        autocomplete="off"
        .disabled=${this.busy}
        .label=${t("cancel_credit.reason")}
        .value=${this.reason}
        .required=${true}
        .error=${fieldError ?? ""}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.reason = event.detail.value;
          if (this.#refusalOnReason()) this.shownRefusal = null;
        }}
        @keydown=${(event: KeyboardEvent) =>
          submitOnEnter(
            event,
            this.shadowRoot!.querySelector<HTMLElement>("[data-cancel-credit-confirm]"),
          )}
      ></wt-input>
      <p class="muted" data-cancel-credit-next>${t("cancel_credit.approval_next")}</p>
      <wt-form-actions .error=${this.#bottomMessage(fieldError)}>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-cancel-credit-close
          .disabled=${this.busy}
          @click=${() => this.#emit("cancel-credit-close")}
        >
          ${t("cancel_credit.keep")}
        </wt-button>
        <wt-button
          variant="primary"
          data-cancel-credit-confirm
          .loading=${this.busy}
          .disabled=${this.busy || own !== null}
          @click=${() => void this.#continue()}
        >
          ${t("cancel_credit.confirm")}
        </wt-button>
      </wt-form-actions>
    </div>`;
  }

  override render() {
    return html`<wt-dialog
      ${trackDialog()}
      .open=${true}
      .heading=${t("cancel_credit.title")}
      .dismissible=${!this.busy}
      @wt-close=${() => this.#emit("cancel-credit-close")}
    >
      ${this.done === null ? this.#formBody() : this.#doneBody(this.done)}
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-cancel-credit-dialog": TillCancelCreditDialog;
  }
}
