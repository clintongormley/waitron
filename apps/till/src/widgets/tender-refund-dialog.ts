import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { compareDecimal, decimal, formatMoney } from "@waitron/shared";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  type WtDialog,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { trackDialog } from "./track-dialog.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { RefundableTender, TenderRefundView } from "../api/tender-refund-types.js";
import {
  tenderRefundAmount,
  type SavedTenderRefund,
  type TenderRefundAsk,
} from "../state/tender-refund.js";
import { REASON_MAX, moneyPlus, type DialogRefusal } from "../state/bill-payment.js";

type Draft = {
  tenderId: string;
  appliedAmount: string;
  tipAmount: string;
  reason: string;
  cashConfirmed: boolean;
  manualConfirmed: boolean;
};
type Field = "appliedAmount" | "tipAmount" | "reason" | "confirmation";
const blank = (): Draft => ({
  tenderId: "",
  appliedAmount: "",
  tipAmount: "",
  reason: "",
  cashConfirmed: false,
  manualConfirmed: false,
});
const supported = (row: RefundableTender) => row.method === "cash" || row.method === "card";
const available = (row: RefundableTender) =>
  supported(row) &&
  row.pendingRefundId === null &&
  compareDecimal(moneyPlus(row.appliedRemaining, row.tipRemaining), decimal("0")) > 0;

@customElement("till-tender-refund-dialog")
export class TillTenderRefundDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .body {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
      }
      p {
        overflow-wrap: anywhere;
        margin: 0;
      }
      fieldset {
        margin: 0;
        padding: 0;
        border: none;
        min-width: 0;
      }
      legend {
        font-weight: var(--wt-font-weight-bold);
        margin-bottom: var(--wt-space-2);
      }
      .option {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
      }
      .option input {
        flex: none;
        accent-color: var(--wt-color-primary);
      }
      .error {
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
      }
      .muted {
        color: var(--wt-color-text-muted);
      }
    `,
  ];
  @property({ attribute: false }) tenders: RefundableTender[] = [];
  @property() invoiceNumber = "";
  @property({ attribute: false }) attempt: SavedTenderRefund | null = null;
  @property({ attribute: false }) result: TenderRefundView | null = null;
  @property({ attribute: false }) refusal: DialogRefusal | null = null;
  @property({ type: Boolean }) busy = false;
  @state() private draft: Draft = blank();
  @state() private active = true;
  @state() private attempted = false;
  @state() private sending = false;
  @state() private shownRefusal: DialogRefusal | null = null;
  #initialized = false;
  #baseline?: Draft;
  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;
  readonly #beforeClose = async (reason: LeaveReason) =>
    !this.#busy() &&
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
  #locked(): boolean {
    return this.attempt !== null || this.result !== null;
  }
  #busy(): boolean {
    return this.busy || this.sending;
  }
  #selected(): RefundableTender | undefined {
    return this.tenders.find((row) => row.tenderId === this.draft.tenderId && available(row));
  }
  #choice(row: RefundableTender): Draft {
    return {
      ...blank(),
      tenderId: row.tenderId,
      appliedAmount: row.appliedRemaining,
      tipAmount: row.tipRemaining,
      reason: this.draft.reason,
    };
  }
  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("refusal")) {
      this.shownRefusal = this.refusal;
      this.sending = false;
    }
    if (changed.has("busy") && !this.busy) this.sending = false;
    if (!this.#initialized) {
      const eligible = this.tenders.filter(available);
      this.draft = eligible.length === 1 ? this.#choice(eligible[0]!) : blank();
      this.#initialized = true;
      this.#baseline = { ...this.draft };
    }
    if (changed.has("attempt") && this.attempt !== null) {
      this.draft = {
        tenderId: this.attempt.request.tenderId,
        appliedAmount: this.attempt.request.appliedAmount,
        tipAmount: this.attempt.request.tipAmount,
        reason: this.attempt.request.reason,
        cashConfirmed: this.attempt.request.cashConfirmed === true,
        manualConfirmed: this.attempt.request.manualConfirmed === true,
      };
      this.#baseline = { ...this.draft };
      this.#scope?.commit(this.#baseline);
      this.sending = false;
    }
    if (!this.isConnected || !this.active || this.#scope) return;
    const { scope, coordinator } = draftScopeFor<Draft>(this, {
      id: this,
      current: () => this.draft,
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => JSON.stringify(this.#comparable(a)) === JSON.stringify(this.#comparable(b)),
      restore: (value) => {
        this.draft = { ...value };
      },
    });
    this.#scope = scope;
    this.#leave = coordinator;
    scope.commit(this.#baseline!);
  }
  #comparable(value: Draft): Draft {
    return {
      ...value,
      appliedAmount: tenderRefundAmount(value.appliedAmount) ?? value.appliedAmount,
      tipAmount: tenderRefundAmount(value.tipAmount) ?? value.tipAmount,
      reason: value.reason.trim(),
    };
  }
  #set(change: Partial<Draft>): void {
    if (!this.isConnected || !this.active || this.#busy() || this.#locked()) return;
    this.draft = { ...this.draft, ...change };
    this.#scope?.changed();
    const field = this.#refusalField();
    if (
      field !== null &&
      (field in change ||
        (field === "confirmation" && ("cashConfirmed" in change || "manualConfirmed" in change)))
    )
      this.shownRefusal = null;
  }
  #money(value: string): string {
    return formatMoney(value, currentLocale());
  }
  #errors(): Map<Field, string> {
    const errors = new Map<Field, string>();
    const row = this.#selected();
    if (!row) return errors;
    const applied = tenderRefundAmount(this.draft.appliedAmount),
      tip = tenderRefundAmount(this.draft.tipAmount);
    const invalid = (limit: string) =>
      t("tender_refund.amount_invalid").replace("{amount}", () => this.#money(limit));
    if (applied === null || compareDecimal(decimal(applied), decimal(row.appliedRemaining)) > 0)
      errors.set("appliedAmount", invalid(row.appliedRemaining));
    if (tip === null || compareDecimal(decimal(tip), decimal(row.tipRemaining)) > 0)
      errors.set("tipAmount", invalid(row.tipRemaining));
    if (applied !== null && tip !== null) {
      if (compareDecimal(moneyPlus(applied, tip), decimal("0")) <= 0)
        errors.set("appliedAmount", invalid(row.appliedRemaining));
      if (
        compareDecimal(decimal(tip), decimal("0")) > 0 &&
        compareDecimal(decimal(applied), decimal(row.appliedRemaining)) !== 0
      )
        errors.set("tipAmount", t("tender_refund.tip_requires_all"));
    }
    if (this.draft.reason.trim() === "") errors.set("reason", t("bill_refund.reason_invalid"));
    else if (this.draft.reason.length > REASON_MAX)
      errors.set("reason", t("bill_refund.reason_long"));
    if (
      (row.method === "cash" && !this.draft.cashConfirmed) ||
      (row.manual && !this.draft.manualConfirmed)
    )
      errors.set("confirmation", t("tender_refund.confirm_required"));
    return errors;
  }
  #refusalField(): Field | null {
    if (this.shownRefusal?.code === "tender.refund_exceeds_payment") return "appliedAmount";
    const field = this.shownRefusal?.field;
    if (this.shownRefusal?.code !== "management.request_invalid") return null;
    if (field === "appliedAmount" || field === "tipAmount" || field === "reason") return field;
    return field === "cashConfirmed" || field === "manualConfirmed" ? "confirmation" : null;
  }
  #refusalText(): string {
    if (this.shownRefusal === null) return "";
    if (this.shownRefusal.code === "network") return t("tender_refund.pending");
    if (this.shownRefusal.code === "storage") return t("tender_refund.storage");
    return codeMessage(this.shownRefusal.code);
  }
  #emit(type: string, detail: unknown = {}): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
  async #submit(): Promise<void> {
    if (!this.isConnected || !this.active || this.#busy() || this.#locked() || !this.#selected())
      return;
    this.attempted = true;
    this.shownRefusal = null;
    if (this.#errors().size > 0) {
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    this.sending = true;
    const ask: TenderRefundAsk = this.#comparable(this.draft);
    this.#emit("tender-refund-submit", ask);
  }
  #recoverable(): boolean {
    return this.result?.state === "pending" || (this.result === null && this.attempt !== null);
  }
  #recover(type: string): void {
    if (!this.isConnected || !this.active || this.#busy() || !this.#recoverable()) return;
    this.sending = true;
    this.#emit(type);
  }
  #cancel(): void {
    if (!this.isConnected || !this.active || this.#busy()) return;
    void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel");
  }
  #closed(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || !this.isConnected || !this.active) return;
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#emit("tender-refund-close");
  }
  closeSaved(): void {
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.closeAfter("saved");
  }
  #cancelButton() {
    return html`<wt-button
      slot="cancel"
      variant="secondary"
      data-close
      .disabled=${this.#busy()}
      @click=${() => this.#cancel()}
      >${t("action.cancel")}</wt-button
    >`;
  }
  #input(name: "appliedAmount" | "tipAmount" | "reason", label: string, error: string) {
    return html`<wt-input
      name=${name}
      autocomplete="off"
      .label=${label}
      .value=${live(this.draft[name])}
      .required=${true}
      .disabled=${this.#busy() || this.#locked()}
      .error=${error}
      .decimalLocale=${name === "reason" ? "" : currentLocale()}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.#set({ [name]: event.detail.value });
      }}
      @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-submit]"))}
    ></wt-input>`;
  }
  #confirm(row: RefundableTender, error: string) {
    if (row.method !== "cash" && !row.manual) return nothing;
    const name = row.method === "cash" ? "cashConfirmed" : "manualConfirmed";
    return html`${row.manual ? html`<p data-manual-instruction>${t("tender_refund.manual_instruction")}</p>` : nothing}
      <wt-switch
        name=${name}
        .label=${`${t(name === "cashConfirmed" ? "tender_refund.cash_confirm" : "tender_refund.manual_confirm")} *`}
        .description=${error}
        .checked=${this.draft[name]}
        .disabled=${this.#busy() || this.#locked()}
        @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
          event.stopPropagation();
          this.#set({ [name]: event.detail.checked });
        }}
      ></wt-switch
      >${error ? html`<p class="error" data-confirm-error role="alert">${error}</p>` : nothing}`;
  }
  #body() {
    const own = this.attempted && !this.#locked() ? this.#errors() : new Map<Field, string>();
    const errors = new Map(own);
    const refused = this.#refusalField();
    if (refused !== null) errors.set(refused, this.#refusalText());
    const message = [
      errors.size > 0 ? t("form.fix_fields") : "",
      refused === null ? this.#refusalText() : "",
    ]
      .filter(Boolean)
      .join(" ");
    const selected = this.#selected();
    const eligible = this.tenders.filter(available);
    const pending = this.tenders.filter((row) => supported(row) && row.pendingRefundId !== null);
    const locked = this.#locked();
    const recoverable = this.#recoverable();
    return html`${
        !locked
          ? html`<fieldset ?disabled=${this.#busy()}>
              <legend>${t("tender_refund.choose")}</legend>
              ${eligible.map(
                (row) =>
                  html`<label class="option"
                    ><input
                      type="radio"
                      name="tender"
                      .value=${row.tenderId}
                      .checked=${row.tenderId === this.draft.tenderId}
                      @change=${(event: Event) => {
                        event.stopPropagation();
                        if (available(row)) this.#set(this.#choice(row));
                      }}
                    />
                    <span
                      >${t(row.method === "cash" ? "tender.cash" : "tender.card")}${row.last4 ? ` · ${row.last4}` : ""}
                      · ${this.#money(moneyPlus(row.appliedRemaining, row.tipRemaining))}</span
                    ></label
                  >`,
              )}
              ${pending.map(
                (row) =>
                  html`<wt-button
                    variant="secondary"
                    data-inspect
                    .disabled=${this.#busy()}
                    @click=${() => {
                      if (
                        this.isConnected &&
                        this.active &&
                        !this.#busy() &&
                        !this.#locked() &&
                        this.tenders.some(
                          (current) =>
                            current.tenderId === row.tenderId &&
                            current.pendingRefundId === row.pendingRefundId,
                        )
                      ) {
                        this.sending = true;
                        this.#emit("tender-refund-inspect", { refundId: row.pendingRefundId });
                      }
                    }}
                    >${t("tender_refund.pending_payment")}${row.last4 ? ` · ${row.last4}` : ""}</wt-button
                  >`,
              )}
              ${eligible.length === 0 && pending.length === 0 ? html`<p class="muted">${t("tender_refund.unavailable")}</p>` : nothing}
            </fieldset>`
          : nothing
      }
      ${
        this.result
          ? html`<p data-outcome role="status">${t(`tender_refund.${this.result.state}`)}</p>
              <p>${this.#money(moneyPlus(this.result.appliedAmount, this.result.tipAmount))}</p>`
          : selected || this.attempt
            ? html`
                ${this.#input("appliedAmount", t("tender_refund.applied"), errors.get("appliedAmount") ?? "")}
                ${this.#input("tipAmount", t("tender_refund.tip"), errors.get("tipAmount") ?? "")}
                ${this.#input("reason", t("bill_refund.reason"), errors.get("reason") ?? "")}
                ${selected ? this.#confirm(selected, errors.get("confirmation") ?? "") : nothing}
              `
            : nothing
      }
      ${!this.result && (selected || this.attempt) && tenderRefundAmount(this.draft.appliedAmount) !== null && tenderRefundAmount(this.draft.tipAmount) !== null ? html`<p data-total>${t("tender_refund.total")} · ${this.#money(moneyPlus(tenderRefundAmount(this.draft.appliedAmount)!, tenderRefundAmount(this.draft.tipAmount)!))}</p>` : nothing}
      ${recoverable && !this.result ? html`<p data-outcome role="status">${t("tender_refund.pending")}</p>` : nothing}
      <wt-form-actions .error=${message}
        >${this.#cancelButton()}
        ${
          recoverable
            ? html`<wt-button
                  slot="secondary"
                  variant="secondary"
                  data-status
                  .disabled=${this.#busy()}
                  @click=${() => this.#recover("tender-refund-status")}
                  >${t("tender_refund.status")}</wt-button
                >
                <wt-button
                  variant="primary"
                  data-retry
                  .loading=${this.#busy()}
                  .disabled=${this.#busy()}
                  @click=${() => this.#recover("tender-refund-retry")}
                  >${t("tender_refund.retry")}</wt-button
                >`
            : !locked
              ? html`<wt-button
                  .variant=${selected ? "primary" : "secondary"}
                  data-submit
                  .loading=${this.#busy()}
                  .disabled=${this.#busy() || !selected || own.size > 0}
                  @click=${() => void this.#submit()}
                  >${t("bill_pay.refund")}</wt-button
                >`
              : nothing
        }
      </wt-form-actions>`;
  }
  override render() {
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.active}
      .heading=${t("tender_refund.title")}
      .dismissible=${!this.#busy()}
      .beforeClose=${this.#scope ? this.#beforeClose : undefined}
      @wt-close=${(event: Event) => this.#closed(event)}
    >
      <div class="body">
        <p>${this.invoiceNumber}</p>
        <p class="muted" data-invoice-unchanged>${t("tender_refund.invoice_unchanged")}</p>
        ${this.#body()}
      </div>
    </wt-dialog>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "till-tender-refund-dialog": TillTenderRefundDialog;
  }
}
