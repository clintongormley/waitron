import { recoveryLink, recoveryRefusalText } from "./recovery-refusal.js";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
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
import type { StringKey } from "../i18n/strings.js";
import { REASON_MAX, type DialogRefusal } from "../state/bill-payment.js";
import type { MealEndUnservedDish } from "../api/client.js";
import { servableDishes, serveListed, unservedDishText } from "./dish-format.js";

/** `cancel` credits the receipt and cancels the bill; `split` also puts its dishes on a new bill. */
export type CancelCreditMode = "cancel" | "split";

/** A cancelled bill: the number of the credit note issued, or null when no number was read.
 * `creditedElsewhere` is a split that found the bill already credited and no new bill. */
export interface CancelCreditDone {
  corrective: string | null;
  creditedElsewhere?: boolean;
}

/** A refusal; `bill.unserved_dishes` carries the dishes it lists. */
export interface CancelCreditRefusal extends DialogRefusal {
  dishes?: readonly MealEndUnservedDish[];
}

const REFUSALS: Record<string, StringKey> = {
  network: "cancel_credit.unconfirmed",
  approvers: "cancel_credit.approvers_failed",
  "bill.payments_received": "cancel_credit.refused_payments",
  "order.payment_in_flight": "cancel_credit.refused_payment_in_flight",
  "authorization.not_permitted": "cancel_credit.refused_not_permitted",
};

const TEXT = {
  cancel: {
    title: "cancel_credit.title",
    scope: "cancel_credit.scope",
    scopeUnnumbered: "cancel_credit.scope_unnumbered",
    confirm: "cancel_credit.confirm",
    done: "cancel_credit.done",
    doneUnnumbered: "cancel_credit.done_unnumbered",
    refusals: REFUSALS,
  },
  split: {
    title: "split.title",
    scope: "split.scope",
    scopeUnnumbered: "split.scope_unnumbered",
    confirm: "split.confirm",
    done: "split.done",
    doneUnnumbered: "split.done_unnumbered",
    refusals: {
      ...REFUSALS,
      network: "split.unconfirmed",
      "bill.payments_received": "split.refused_payments",
      "order.payment_in_flight": "split.refused_payment_in_flight",
      "bill.left_unpaid": "split.refused_left_unpaid",
      "bill.not_at_table": "split.refused_not_at_table",
      "bill.not_issued": "split.refused_not_issued",
      "bill.unserved_dishes": "split.unserved",
    },
  },
} satisfies Record<
  CancelCreditMode,
  Record<
    "title" | "scope" | "scopeUnnumbered" | "confirm" | "done" | "doneUnnumbered",
    StringKey
  > & { refusals: Record<string, StringKey> }
>;

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
  @property({ attribute: false }) canMarkServed = false;
  @property({ attribute: false }) invoiceNumber: string | null = null;
  @property({ attribute: false }) amount = "0.00";
  @property({ attribute: false }) refusal: CancelCreditRefusal | null = null;
  @property({ attribute: false }) done: CancelCreditDone | null = null;
  @property({ type: Boolean }) busy = false;

  @state() private reason = "";
  @state() private attempted = false;
  @state() private shownRefusal: CancelCreditRefusal | null = null;

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
    const refusals: Record<string, StringKey> = TEXT[this.mode].refusals;
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
    const text = TEXT[this.mode];
    return this.invoiceNumber === null
      ? t(text.scopeUnnumbered).replace("{amount}", () => amount)
      : t(text.scope)
          .replace("{invoice}", () => this.invoiceNumber!)
          .replace("{amount}", () => amount);
  }

  #doneText(done: CancelCreditDone): string {
    const [numbered, unnumbered]: [StringKey, StringKey] = done.creditedElsewhere
      ? ["split.credited_elsewhere", "split.credited_elsewhere_unnumbered"]
      : [TEXT[this.mode].done, TEXT[this.mode].doneUnnumbered];
    return done.corrective === null
      ? t(unnumbered)
      : t(numbered).replace("{number}", () => done.corrective!);
  }

  #doneBody(done: CancelCreditDone) {
    return html`<div class="body">
      <p role="status" data-cancel-credit-done>${this.#doneText(done)}</p>
      <wt-form-actions
        >${recoveryLink(this.shownRefusal)}
        <wt-button variant="primary" data-cancel-credit-finished @click=${() => this.#cancel()}>
          ${t("cancel_credit.done_action")}
        </wt-button>
      </wt-form-actions>
    </div>`;
  }

  #unservedShown(): readonly MealEndUnservedDish[] | null {
    const refusal = this.shownRefusal;
    return refusal?.code === "bill.unserved_dishes" ? (refusal.dishes ?? null) : null;
  }

  #unservedBody(dishes: readonly MealEndUnservedDish[]) {
    const servable = servableDishes(dishes, this.canMarkServed);
    const notice = !this.canMarkServed
      ? t("split.unserved_no_mark")
      : servable.length === dishes.length
        ? t("split.unserved")
        : t("split.unserved_held");
    return html`<div class="unserved" role="alert" data-split-unserved>
      <span>${notice}</span>
      <span>${t("meal_end.unserved_heading")}</span>
      <ul>
        ${dishes.map((dish) => {
          const name = unservedDishText(dish);
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

  #markServed(dishes: readonly MealEndUnservedDish[]): void {
    if (!this.isConnected || !this.active || this.busy || this.done !== null) return;
    this.#emit("split-mark-served", { items: serveListed(dishes) });
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
    const unserved = this.#unservedShown();
    return html`<div class="body">
      <p data-cancel-credit-scope>${this.#scopeText()}</p>
      ${this.mode === "split" ? nothing : this.#reasonField(fieldError)}
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
          ${t(TEXT[this.mode].confirm)}
        </wt-button>
      </wt-form-actions>
    </div>`;
  }

  override render() {
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.active}
      .beforeClose=${this.#scope ? this.#beforeClose : undefined}
      .heading=${t(TEXT[this.mode].title)}
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
