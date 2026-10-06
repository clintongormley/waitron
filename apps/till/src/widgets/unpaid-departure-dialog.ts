import { LitElement, css, html, type PropertyValues } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { formatMoney } from "@waitron/shared";
import { baseStyles, focusFirstInvalid, submitOnEnter, leaveCoordinatorFor } from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason, WtDialog } from "@waitron/ui";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import { trackDialog } from "./track-dialog.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { REASON_MAX, moneyPlus, type DialogRefusal } from "../state/bill-payment.js";

/** One bill the departure leaves unpaid, named as the table screen names it. */
export interface DepartingBill {
  workingOrderId: string;
  name: string;
  /** An invoiced bill's amount due, otherwise its outstanding. */
  outstanding: string;
}

@customElement("till-unpaid-departure-dialog")
export class TillUnpaidDepartureDialog extends LitElement {
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

      .summary {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        margin: 0;
      }

      .summary div {
        display: flex;
        justify-content: space-between;
        gap: var(--wt-space-4);
        min-width: 0;
      }

      .summary dt {
        overflow-wrap: anywhere;
      }

      .summary dd {
        margin: 0;
        white-space: nowrap;
      }

      .summary .total {
        padding-top: var(--wt-space-1);
        border-top: 1px solid var(--wt-color-border);
        font-weight: var(--wt-font-weight-bold);
      }

      .muted {
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property({ attribute: false }) bills: DepartingBill[] = [];
  @property({ attribute: false }) refusal: DialogRefusal | null = null;
  @property({ type: Boolean }) busy = false;

  @state() private reason = "";
  @state() private attempted = false;
  @state() private shownRefusal: DialogRefusal | null = null;

  @state() private active = true;
  #scope?: DraftScope<string>;
  #leave?: LeaveCoordinator;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("refusal")) this.shownRefusal = this.refusal;
    if (!this.active || this.#scope) return;
    this.#leave = leaveCoordinatorFor(this);
    this.#scope = this.#leave?.register<string>({
      id: this,
      current: () => this.reason,
      snapshot: (value) => value,
      equal: (a, b) => a.trim() === b.trim(),
      restore: (value) => (this.reason = value),
    });
    this.#scope?.commit("");
  }

  #money(amount: string): string {
    return formatMoney(amount, currentLocale());
  }

  #total(): string {
    return this.bills.reduce((sum, bill) => moneyPlus(sum, bill.outstanding), "0.00");
  }

  #ownError(): string | null {
    const reason = this.reason.trim();
    if (reason === "") return t("departure.reason_invalid");
    if (reason.length > REASON_MAX) return t("departure.reason_long");
    return null;
  }

  #refusalOnReason(): boolean {
    const refusal = this.shownRefusal;
    return refusal?.code === "management.request_invalid" && refusal.field === "reason";
  }

  #refusalText(refusal: DialogRefusal): string {
    if (refusal.code === "network") return t("departure.unconfirmed");
    if (refusal.code === "approvers") return t("departure.approvers_failed");
    return codeMessage(refusal.code);
  }

  #reasonError(own: string | null): string | null {
    if (own !== null) return own;
    return this.#refusalOnReason() ? this.#refusalText(this.shownRefusal!) : null;
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
    if (!this.isConnected || !this.active || this.busy) return;
    this.attempted = true;
    this.shownRefusal = null;
    if (this.#ownError() !== null) {
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    this.#emit("unpaid-departure-continue", { reason: this.reason.trim() });
  }

  #onInput(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (!this.isConnected || !this.active || this.busy) return;
    this.reason = event.detail.value;
    this.#scope?.changed();
    if (this.#refusalOnReason()) this.shownRefusal = null;
  }

  #cancel(): void {
    if (!this.isConnected || !this.active || this.busy) return;
    if (this.#scope) {
      void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel");
      return;
    }
    this.#emit("unpaid-departure-close");
  }

  #closed(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || !this.isConnected || !this.active) return;
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#emit("unpaid-departure-close");
  }

  override render() {
    const own = this.attempted ? this.#ownError() : null;
    const fieldError = this.#reasonError(own);
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.active}
      .beforeClose=${this.#scope ? this.#beforeClose : undefined}
      .heading=${t("departure.title")}
      .dismissible=${!this.busy}
      @wt-close=${(event: Event) => this.#closed(event)}
    >
      <div class="body">
        <dl class="summary">
          ${this.bills.map(
            (bill) =>
              html`<div data-departure-bill=${bill.workingOrderId}>
                <dt>${bill.name}</dt>
                <dd>${this.#money(bill.outstanding)}</dd>
              </div>`,
          )}
          <div class="total" data-departure-total>
            <dt>${t("departure.left_unpaid")}</dt>
            <dd>${this.#money(this.#total())}</dd>
          </div>
        </dl>
        <p data-departure-scope>${t("departure.scope")}</p>
        <wt-input
          name="reason"
          autocomplete="off"
          .disabled=${this.busy}
          .label=${t("departure.reason")}
          .value=${live(this.reason)}
          .required=${true}
          .error=${fieldError ?? ""}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#onInput(event)}
          @keydown=${(event: KeyboardEvent) =>
            submitOnEnter(
              event,
              this.shadowRoot!.querySelector<HTMLElement>("[data-departure-confirm]"),
            )}
        ></wt-input>
        <p class="muted" data-departure-next>${t("departure.approval_next")}</p>
        <wt-form-actions .error=${this.#bottomMessage(fieldError)}>
          <wt-button
            slot="cancel"
            variant="secondary"
            data-departure-close
            .disabled=${this.busy}
            @click=${() => this.#cancel()}
          >
            ${t("action.cancel")}
          </wt-button>
          <wt-button
            variant="primary"
            data-departure-confirm
            .loading=${this.busy}
            .disabled=${this.busy || own !== null}
            @click=${() => void this.#continue()}
          >
            ${t("departure.confirm").replace("{amount}", () => this.#money(this.#total()))}
          </wt-button>
        </wt-form-actions>
      </div>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-unpaid-departure-dialog": TillUnpaidDepartureDialog;
  }
}
