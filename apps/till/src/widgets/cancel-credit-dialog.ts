import { recoveryLink, recoveryRefusalText } from "./recovery-refusal.js";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { compareDecimal, decimal, formatMoney } from "@waitron/shared";
import { baseStyles, focusFirstInvalid, submitOnEnter, leaveCoordinatorFor } from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason, WtDialog } from "@waitron/ui";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import { trackDialog } from "./track-dialog.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import { REASON_MAX, type DialogRefusal } from "../state/bill-payment.js";
import type { MealEndUnservedDish } from "../api/client.js";
import { quantityText, trimQuantity } from "./dish-format.js";

/** `cancel` credits the ticket and cancels the bill; `split` also puts its dishes on a new bill. */
export type CancelCreditMode = "cancel" | "split";

/** A cancelled bill: the number of the credit note issued, or null when no number was read. */
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

const SPLIT_REFUSALS: Record<string, StringKey> = {
  ...REFUSALS,
  network: "split.unconfirmed",
  "bill.payments_received": "split.refused_payments",
  "order.payment_in_flight": "split.refused_payment_in_flight",
};

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

      .unserved {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-danger);
        border-radius: var(--wt-radius-md);
      }

      .unserved ul {
        margin: 0;
        padding-inline-start: var(--wt-space-4);
      }

      .unserved wt-button {
        align-self: flex-start;
      }
    `,
  ];

  @property({ attribute: false }) mode: CancelCreditMode = "cancel";
  /** The dishes a split's `bill.unserved_dishes` refusal listed. */
  @property({ attribute: false }) unserved: MealEndUnservedDish[] | null = null;
  @property({ attribute: false }) canMarkServed = false;
  @property({ attribute: false }) invoiceNumber: string | null = null;
  @property({ attribute: false }) amount = "0.00";
  @property({ attribute: false }) refusal: DialogRefusal | null = null;
  @property({ attribute: false }) done: CancelCreditDone | null = null;
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
    if (this.done !== null) {
      this.showResult(this.done);
      return;
    }
    if (!this.active || this.#scope || this.mode === "split") return;
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

  showResult(done: CancelCreditDone): void {
    this.done = done;
    this.#scope?.commit(this.reason);
    this.#scope?.dispose();
    this.#scope = undefined;
  }

  #ownError(): string | null {
    if (this.mode === "split") return null;
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
    const recovery = recoveryRefusalText(refusal);
    if (recovery !== null) return recovery;
    const refusals = this.mode === "split" ? SPLIT_REFUSALS : REFUSALS;
    return Object.hasOwn(refusals, refusal.code)
      ? t(refusals[refusal.code]!)
      : codeMessage(refusal.code);
  }

  #bottomMessage(fieldError: string | null): string {
    const parts: string[] = [];
    if (fieldError !== null) parts.push(t("form.fix_fields"));
    if (this.shownRefusal !== null && !this.#refusalOnReason() && this.#unservedShown() === null)
      parts.push(this.#refusalText(this.shownRefusal));
    return parts.join(" ");
  }

  #emit(type: string, detail: unknown = {}): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  async #continue(): Promise<void> {
    if (!this.isConnected || !this.active || this.busy || this.done !== null) return;
    this.attempted = true;
    this.shownRefusal = null;
    if (this.#ownError() !== null) {
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    this.#emit("cancel-credit-continue", { reason: this.reason.trim() });
  }

  #onInput(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (!this.isConnected || !this.active || this.busy || this.done !== null) return;
    this.reason = event.detail.value;
    this.#scope?.changed();
    if (this.#refusalOnReason()) this.shownRefusal = null;
  }

  #cancel(): void {
    if (!this.isConnected || !this.active || this.busy) return;
    if (this.#scope) {
      void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("navigation");
      return;
    }
    this.#closed();
  }

  #closed(event?: Event): void {
    event?.stopPropagation();
    if (event && event.target !== event.currentTarget) return;
    if (!this.isConnected || !this.active) return;
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#emit("cancel-credit-close");
  }

  #scopeText(): string {
    const amount = formatMoney(this.amount, currentLocale());
    const split = this.mode === "split";
    return this.invoiceNumber === null
      ? t(split ? "split.scope_unnumbered" : "cancel_credit.scope_unnumbered").replace(
          "{amount}",
          () => amount,
        )
      : t(split ? "split.scope" : "cancel_credit.scope")
          .replace("{invoice}", () => this.invoiceNumber!)
          .replace("{amount}", () => amount);
  }

  #doneBody(done: CancelCreditDone) {
    return html`<div class="body">
      <p role="status" data-cancel-credit-done>
        ${
          done.creditNote === null
            ? t(this.mode === "split" ? "split.done_unnumbered" : "cancel_credit.done_unnumbered")
            : t(this.mode === "split" ? "split.done" : "cancel_credit.done").replace(
                "{number}",
                () => done.creditNote!,
              )
        }
      </p>
      <wt-form-actions
        >${recoveryLink(this.shownRefusal)}
        <wt-button variant="primary" data-cancel-credit-finished @click=${() => this.#cancel()}>
          ${t("cancel_credit.done_action")}
        </wt-button>
      </wt-form-actions>
    </div>`;
  }

  #unservedShown(): MealEndUnservedDish[] | null {
    return this.shownRefusal?.code === "bill.unserved_dishes" ? this.unserved : null;
  }

  /** Mark served refuses a dish still held in its group (`group.line_held`), so it is not offered. */
  #unservedBody(dishes: MealEndUnservedDish[]) {
    const servable = this.canMarkServed ? dishes.filter((dish) => dish.released) : [];
    const notice = !this.canMarkServed
      ? t("split.unserved_no_mark")
      : servable.length === dishes.length
        ? codeMessage("bill.unserved_dishes")
        : t("split.unserved_held");
    return html`<div class="unserved" role="alert" data-split-unserved>
      <span>${notice}</span>
      <span>${t("meal_end.unserved_heading")}</span>
      <ul>
        ${dishes.map((dish) => {
          const name =
            compareDecimal(decimal(dish.quantity), decimal("1")) === 0
              ? dish.dishName
              : `${quantityText(dish.quantity)} × ${dish.dishName}`;
          return html`<li data-unserved-dish>
            ${dish.released ? name : t("split.unserved_dish_held").replace("{dish}", () => name)}
          </li>`;
        })}
      </ul>
      ${
        servable.length === 0
          ? nothing
          : html`<wt-button
              size="sm"
              data-split-mark-served
              .disabled=${this.busy}
              @click=${() => this.#markServed(servable)}
            >
              ${t("meal_end.mark_served")}
            </wt-button>`
      }
    </div>`;
  }

  #markServed(dishes: MealEndUnservedDish[]): void {
    if (!this.isConnected || !this.active || this.busy || this.done !== null) return;
    this.#emit("split-mark-served", {
      items: dishes.map((dish) => ({ lineId: dish.lineId, quantity: trimQuantity(dish.quantity) })),
    });
  }

  #reasonField(fieldError: string | null) {
    return html`<wt-input
      name="reason"
      autocomplete="off"
      .disabled=${this.busy}
      .label=${t("cancel_credit.reason")}
      .value=${live(this.reason)}
      .required=${true}
      .error=${fieldError ?? ""}
      @wt-change=${(event: CustomEvent<{ value: string }>) => this.#onInput(event)}
      @keydown=${(event: KeyboardEvent) =>
        submitOnEnter(
          event,
          this.shadowRoot!.querySelector<HTMLElement>("[data-cancel-credit-confirm]"),
        )}
    ></wt-input>`;
  }

  #formBody() {
    const own = this.attempted ? this.#ownError() : null;
    const fieldError = this.#reasonError(own);
    const split = this.mode === "split";
    const unserved = this.#unservedShown();
    return html`<div class="body">
      <p data-cancel-credit-scope>${this.#scopeText()}</p>
      ${split ? nothing : this.#reasonField(fieldError)}
      ${unserved === null ? nothing : this.#unservedBody(unserved)}
      <p class="muted" data-cancel-credit-next>${t("cancel_credit.approval_next")}</p>
      <wt-form-actions .error=${this.#bottomMessage(fieldError)}
        >${recoveryLink(this.shownRefusal)}
        <wt-button
          slot="cancel"
          variant="secondary"
          data-cancel-credit-close
          .disabled=${this.busy}
          @click=${() => this.#cancel()}
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
          ${t(split ? "split.confirm" : "cancel_credit.confirm")}
        </wt-button>
      </wt-form-actions>
    </div>`;
  }

  override render() {
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.active}
      .beforeClose=${this.#scope ? this.#beforeClose : undefined}
      .heading=${t(this.mode === "split" ? "split.title" : "cancel_credit.title")}
      .dismissible=${!this.busy}
      @wt-close=${(event: Event) => this.#closed(event)}
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
