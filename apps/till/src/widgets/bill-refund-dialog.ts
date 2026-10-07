import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { MONEY_SCALE, compareDecimal, decimal, formatMoney, toScale } from "@waitron/shared";
import {
  baseStyles,
  focusFirstInvalid,
  submitOnEnter,
  leaveCoordinatorFor,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  type WtDialog,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import { trackDialog } from "./track-dialog.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { BillPaymentView } from "../api/client.js";
import {
  REASON_MAX,
  moneyPlus,
  refundableOf,
  typedAmount,
  type DialogRefusal,
  type RefundAsk,
} from "../state/bill-payment.js";

type Field = "amount" | "reason";
type RefundDraft = { howMuch: "whole" | "part"; amount: string; reason: string };

/**
 * Gives back one payment of a bill: the whole of what is left of it, its tip included, or part of
 * it without the tip; a payment for particular items only whole. It asks why. It holds no request
 * of its own: `bill-refund-continue` carries the ask, which the app sends in the operator's name,
 * or with a supervisor's or manager's PIN when they may not give refunds.
 * For a card keyed on a separate terminal the app sets {@link terminal} first, and the dialog asks
 * staff to give it back on that terminal and confirm, sending the same ask confirmed, which always
 * takes one PIN.
 */
@customElement("till-bill-refund-dialog")
export class TillBillRefundDialog extends LitElement {
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
      }

      .summary dd {
        margin: 0;
        font-weight: var(--wt-font-weight-bold);
      }

      .choice {
        margin: 0;
        padding: 0;
        border: none;
        min-width: 0;
      }

      .choice legend {
        padding: 0;
        margin-bottom: var(--wt-space-2);
        font-weight: var(--wt-font-weight-bold);
      }

      .options {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }

      .option {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        cursor: pointer;
        overflow-wrap: anywhere;
      }

      .option input {
        flex: none;
        accent-color: var(--wt-color-primary);
      }

      .muted {
        color: var(--wt-color-text-muted);
      }

      .instruction {
        font-weight: var(--wt-font-weight-bold);
        overflow-wrap: anywhere;
      }
    `,
  ];

  /** The payment given back from; the dialog is opened only with one. */
  @property({ attribute: false }) payment!: BillPaymentView;
  /** A card keyed on a separate terminal: staff give it back on that terminal, then confirm. */
  @property({ type: Boolean }) terminal = false;
  @property({ attribute: false }) refusal: DialogRefusal | null = null;
  @property({ type: Boolean }) busy = false;
  /** An amount offered as the part to give back, when this payment can give that part: the
   * dialog opens on it. */
  @property() suggested: string | null = null;

  @state() private howMuch: "whole" | "part" = "whole";
  @state() private typedAmountValue = "";
  @state() private reason = "";
  @state() private attempted = false;
  /** The refusal still shown: it goes when the field it names changes, or at the next request. */
  @state() private shownRefusal: DialogRefusal | null = null;

  @state() private active = true;
  #scope?: DraftScope<RefundDraft>;
  #leave?: LeaveCoordinator;
  #baseline?: RefundDraft;
  #paymentId?: string;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.busy &&
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

  #draft(): RefundDraft {
    return { howMuch: this.howMuch, amount: this.typedAmountValue, reason: this.reason };
  }

  #comparable(value: RefundDraft): string {
    const part = !this.#wholeOnly() && value.howMuch === "part";
    const amount = part ? typedAmount(value.amount) : null;
    return JSON.stringify({
      part,
      amount: part
        ? amount === null
          ? { invalid: value.amount }
          : toScale(decimal(amount), MONEY_SCALE)
        : null,
      reason: value.reason.trim(),
    });
  }

  #cancel(): void {
    if (!this.isConnected || !this.active || this.busy) return;
    if (this.#scope)
      void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel");
    else this.#closed();
  }

  #closed(event?: Event): void {
    event?.stopPropagation();
    if (event && event.target !== event.currentTarget) return;
    if (!this.isConnected || !this.active) return;
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#emit("bill-refund-close");
  }

  closeSaved(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.active = false;
    this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.closeAfter("saved");
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (this.#paymentId !== this.payment.id) {
      this.#scope?.dispose();
      this.#scope = undefined;
      this.#baseline = undefined;
      this.#paymentId = this.payment.id;
      this.howMuch = "whole";
      this.typedAmountValue = "";
      this.reason = "";
      this.active = true;
    }
    if (changed.has("refusal")) this.shownRefusal = this.refusal;
    if (changed.has("suggested") && this.suggested !== null && this.#canGivePart(this.suggested)) {
      this.howMuch = "part";
      this.typedAmountValue = this.suggested;
      this.#scope?.changed();
    }
    if (!this.isConnected || !this.active || this.#scope) return;
    this.#baseline ??= this.#draft();
    this.#leave = leaveCoordinatorFor(this);
    this.#scope = this.#leave?.register<RefundDraft>({
      id: this,
      current: () => this.#draft(),
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => this.#comparable(a) === this.#comparable(b),
      restore: (value) => {
        this.howMuch = value.howMuch;
        this.typedAmountValue = value.amount;
        this.reason = value.reason;
      },
    });
    this.#scope?.commit(this.#baseline);
  }

  /** Whether `amount` is a part this payment can give: above zero, and below what is left of it. */
  #canGivePart(amount: string): boolean {
    return (
      !this.#wholeOnly() &&
      compareDecimal(decimal(amount), decimal("0")) > 0 &&
      compareDecimal(decimal(amount), decimal(this.#left().applied)) < 0
    );
  }

  #money(amount: string): string {
    return formatMoney(amount, currentLocale());
  }

  #left(): { applied: string; tip: string; total: string } {
    const left = refundableOf(this.payment);
    return {
      ...left,
      total: moneyPlus(left.applied, left.tip),
    };
  }

  #wholeOnly(): boolean {
    return this.payment.kind === "items";
  }

  #part(): boolean {
    return !this.#wholeOnly() && this.howMuch === "part";
  }

  /** The part typed, at the money scale, or null when it is not a part this payment can give. */
  #partAmount(): string | null {
    const typed = typedAmount(this.typedAmountValue);
    if (typed === null) return null;
    const amount = decimal(typed);
    if (
      compareDecimal(amount, decimal("0")) <= 0 ||
      compareDecimal(amount, decimal(this.#left().applied)) > 0
    )
      return null;
    return toScale(amount, MONEY_SCALE);
  }

  #ask(): RefundAsk {
    const left = this.#left();
    const reason = this.reason.trim();
    return this.#part()
      ? { appliedAmount: this.#partAmount()!, tipAmount: "0.00", reason }
      : { appliedAmount: left.applied, tipAmount: left.tip, reason };
  }

  #ownErrors(): Map<Field, string> {
    const errors = new Map<Field, string>();
    if (this.#part() && this.#partAmount() === null)
      errors.set(
        "amount",
        t("bill_refund.amount_invalid").replace("{amount}", () =>
          this.#money(this.#left().applied),
        ),
      );
    const reason = this.reason.trim();
    if (reason === "") errors.set("reason", t("bill_refund.reason_invalid"));
    else if (reason.length > REASON_MAX) errors.set("reason", t("bill_refund.reason_long"));
    return errors;
  }

  #refusalField(): Field | null {
    const refusal = this.shownRefusal;
    if (refusal === null) return null;
    const invalid = refusal.code === "management.request_invalid";
    if (invalid && refusal.field === "reason") return "reason";
    // With the whole payment given back there is no amount field to put it under.
    const aboutAmount =
      refusal.code === "bill.refund_exceeds_payment" ||
      (invalid && (refusal.field === "appliedAmount" || refusal.field === "tipAmount"));
    return aboutAmount && this.#part() ? "amount" : null;
  }

  #refusalText(refusal: DialogRefusal): string {
    if (refusal.code === "network") return t("bill_refund.unconfirmed");
    if (refusal.code === "approvers") return t("bill_refund.approvers_failed");
    return codeMessage(refusal.code);
  }

  #fieldErrors(own: ReadonlyMap<Field, string>): Map<Field, string> {
    const errors = new Map(own);
    const field = this.#refusalField();
    if (field !== null) errors.set(field, this.#refusalText(this.shownRefusal!));
    return errors;
  }

  #bottomMessage(errors: ReadonlyMap<Field, string>): string {
    const parts: string[] = [];
    if (errors.size > 0) parts.push(t("form.fix_fields"));
    if (this.shownRefusal !== null && this.#refusalField() === null)
      parts.push(this.#refusalText(this.shownRefusal));
    return parts.join(" ");
  }

  #changed(field: Field): void {
    this.#scope?.changed();
    if (this.#refusalField() === field) this.shownRefusal = null;
  }

  #emit(type: string, detail: unknown = {}): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  async #continue(): Promise<void> {
    if (!this.isConnected || !this.active || this.busy) return;
    this.attempted = true;
    this.shownRefusal = null;
    if (this.#ownErrors().size > 0) {
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    this.#emit("bill-refund-continue", this.#ask());
  }

  #confirmTerminal(): void {
    if (!this.isConnected || !this.active || this.busy) return;
    this.shownRefusal = null;
    this.#emit("bill-refund-continue", {
      ...this.#ask(),
      manualConfirmed: true,
    } satisfies RefundAsk);
  }

  override render() {
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.active}
      .heading=${t("bill_refund.title")}
      .dismissible=${!this.busy}
      .beforeClose=${this.#scope ? this.#beforeClose : undefined}
      @wt-close=${(event: Event) => this.#closed(event)}
    >
      <div class="body">
        ${this.#summary(this.payment)} ${this.terminal ? this.#terminalStep() : this.#form()}
      </div>
    </wt-dialog>`;
  }

  #summary(payment: BillPaymentView): TemplateResult {
    const amount = (value: string) => html`<dd>${this.#money(value)}</dd>`;
    return html`<dl class="summary" data-refund-payment>
      <div>
        <dt>${t("bill_pay.method")}</dt>
        <dd>${t(payment.method === "cash" ? "tender.cash" : "tender.card")}</dd>
      </div>
      <div>
        <dt>${t("bill_pay.applied")}</dt>
        ${amount(payment.applied)}
      </div>
      <div>
        <dt>${t("bill_pay.tip")}</dt>
        ${amount(payment.tip)}
      </div>
    </dl>`;
  }

  #cancelButton(): TemplateResult {
    return html`<wt-button
      slot="cancel"
      variant="secondary"
      data-refund-close
      .disabled=${this.busy}
      @click=${() => this.#cancel()}
    >
      ${t("action.cancel")}
    </wt-button>`;
  }

  #form(): TemplateResult {
    const own = this.attempted ? this.#ownErrors() : new Map<Field, string>();
    const errors = this.#fieldErrors(own);
    const left = this.#left();
    const giving = this.#part() ? this.#partAmount() : left.total;
    return html`${this.#howMuch(left, errors.get("amount"))}
      <wt-input
        name="reason"
        autocomplete="off"
        .disabled=${this.busy}
        .label=${t("bill_refund.reason")}
        .value=${live(this.reason)}
        .required=${true}
        .error=${errors.get("reason") ?? ""}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          if (!this.isConnected || !this.active || this.busy) return;
          this.reason = event.detail.value;
          this.#changed("reason");
        }}
        @keydown=${(event: KeyboardEvent) => this.#enter(event)}
      ></wt-input>
      <p class="muted" data-refund-next>
        ${t(this.payment.entry === "manual" ? "bill_refund.terminal_next" : "bill_refund.approval_next")}
      </p>
      <wt-form-actions .error=${this.#bottomMessage(errors)}>
        ${this.#cancelButton()}
        <wt-button
          variant="primary"
          data-refund-continue
          .loading=${this.busy}
          .disabled=${this.busy || own.size > 0}
          @click=${() => void this.#continue()}
        >
          ${
            giving === null
              ? t("bill_pay.refund")
              : t("bill_refund.continue").replace("{amount}", () => this.#money(giving))
          }
        </wt-button>
      </wt-form-actions>`;
  }

  #enter(event: KeyboardEvent): void {
    submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-refund-continue]"));
  }

  #howMuch(
    left: { applied: string; tip: string; total: string },
    error: string | undefined,
  ): TemplateResult {
    if (this.#wholeOnly())
      return html`<p data-refund-whole-only>
        ${t("bill_refund.whole_only").replace("{amount}", () => this.#money(left.total))}
      </p>`;
    const whole =
      compareDecimal(decimal(left.tip), decimal("0")) > 0
        ? t("bill_refund.whole_tip")
            .replace("{amount}", () => this.#money(left.total))
            .replace("{tip}", () => this.#money(left.tip))
        : t("bill_refund.whole").replace("{amount}", () => this.#money(left.total));
    const option = (value: "whole" | "part", label: string) =>
      html`<label class="option">
        <input
          type="radio"
          name="howMuch"
          .value=${value}
          .checked=${this.howMuch === value}
          @change=${(event: Event) => {
            event.stopPropagation();
            if (!this.isConnected || !this.active || this.busy) return;
            this.howMuch = value;
            this.#scope?.changed();
          }}
        />
        <span>${label}</span>
      </label>`;
    return html`<fieldset class="choice" data-refund-how-much ?disabled=${this.busy}>
        <legend>${t("bill_refund.how_much")}</legend>
        <div class="options">
          ${option("whole", whole)} ${option("part", t("bill_refund.part"))}
        </div>
      </fieldset>
      ${
        this.howMuch === "part"
          ? html`<wt-input
              name="amount"
              decimal-locale=${currentLocale()}
              autocomplete="off"
              .disabled=${this.busy}
              .label=${t("bill_refund.amount")}
              .value=${live(this.typedAmountValue)}
              .required=${true}
              .error=${error ?? ""}
              @wt-change=${(event: CustomEvent<{ value: string }>) => {
                event.stopPropagation();
                if (!this.isConnected || !this.active || this.busy) return;
                this.typedAmountValue = event.detail.value;
                this.#changed("amount");
              }}
              @keydown=${(event: KeyboardEvent) => this.#enter(event)}
            ></wt-input>`
          : nothing
      }`;
  }

  #terminalStep(): TemplateResult {
    const ask = this.#ask();
    const amount = moneyPlus(ask.appliedAmount, ask.tipAmount);
    return html`<p class="instruction" data-refund-terminal>
        ${t("bill_refund.terminal").replace("{amount}", () => this.#money(amount))}
      </p>
      <wt-form-actions .error=${this.#bottomMessage(new Map())}>
        ${this.#cancelButton()}
        <wt-button
          variant="primary"
          data-refund-terminal-done
          .loading=${this.busy}
          .disabled=${this.busy}
          @click=${() => this.#confirmTerminal()}
        >
          ${t("bill_refund.terminal_done")}
        </wt-button>
      </wt-form-actions>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-bill-refund-dialog": TillBillRefundDialog;
  }
}
