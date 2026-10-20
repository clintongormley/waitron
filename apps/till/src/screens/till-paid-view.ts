import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { compareDecimal, decimal, formatMoney } from "@waitron/shared";
import type { BillPaymentView, OriginalReceiptPrint } from "../api/client.js";
import type { StringKey } from "../i18n/strings.js";
import { currentLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import "@waitron/ui/src/components/wt-button.js";

const STATES: Record<BillPaymentView["state"], StringKey> = {
  received: "bill_pay.state_received",
  pending: "bill_pay.state_pending",
  failed: "bill_pay.state_failed",
  declined: "bill_pay.state_declined",
};

/** The bill paid in full: what was paid, whether a ticket went out, and Cerrar mesa. It only shows
 * and asks; the app owns every request. */
@customElement("till-paid-view")
export class TillPaidView extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
        padding: var(--wt-space-4);
      }
      article {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
        max-width: var(--wt-form-max-width);
        margin: 0 auto;
      }
      .banner {
        padding: var(--wt-space-4);
        text-align: center;
        background: var(--wt-color-surface-raised);
        border: 1px solid var(--wt-color-success);
        border-radius: var(--wt-radius-md);
      }
      h2 {
        margin: 0;
        font-size: var(--wt-font-size-xl);
      }
      .tick {
        color: var(--wt-color-success);
      }
      .banner p {
        margin: var(--wt-space-2) 0 0;
      }
      ol {
        margin: 0;
        padding: 0;
        list-style: none;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }
      li {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2) var(--wt-space-4);
        padding: var(--wt-space-3) var(--wt-space-4);
      }
      li + li {
        border-top: 1px solid var(--wt-color-border);
      }
      li p,
      .ticket p {
        margin: 0;
      }
      .muted {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .state {
        padding: 0 var(--wt-space-3);
        border: 1px solid var(--wt-color-success);
        border-radius: var(--wt-radius-full);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }
      .state.unsettled {
        border-color: var(--wt-color-border);
      }
      .ticket {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2) var(--wt-space-4);
        padding: var(--wt-space-3) var(--wt-space-4);
        background: var(--wt-color-surface);
        border: 2px solid var(--wt-color-primary);
        border-radius: var(--wt-radius-md);
      }
      .ticket-text {
        min-width: 0;
        flex: 1 1 12em;
      }
      .status {
        font-weight: var(--wt-font-weight-bold);
      }
      .actions {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }
      .actions wt-button {
        width: 100%;
      }
    `,
  ];

  @property() tableName = "";
  @property() total = "0";
  @property({ attribute: false }) payments: BillPaymentView[] = [];
  /** Null while the receipt's print status is being read. */
  @property({ attribute: false }) receipt: OriginalReceiptPrint | null = null;
  @property({ type: Boolean }) receiptReadFailed = false;
  @property({ type: Boolean }) originalAvailable = false;
  /** Whether this device may request receipt print jobs (the profile's `print-receipt`). */
  @property({ type: Boolean }) canPrint = false;
  /** A ticket request is out: it holds the ticket's actions, never Cerrar mesa or Volver. */
  @property({ type: Boolean }) busy = false;

  #emit(name: string): void {
    this.dispatchEvent(new CustomEvent(name, { detail: {}, bubbles: true, composed: true }));
  }

  #money(amount: string): string {
    return formatMoney(amount, currentLocale());
  }

  #nonZero(amount: string | null): amount is string {
    return amount !== null && compareDecimal(decimal(amount), decimal("0")) !== 0;
  }

  #payment(payment: BillPaymentView, n: number): TemplateResult {
    const method = t(payment.method === "cash" ? "tender.cash" : "tender.card");
    const facts = [this.#money(payment.applied)];
    if (this.#nonZero(payment.tip)) facts.push(`${t("bill_pay.tip")} ${this.#money(payment.tip)}`);
    if (this.#nonZero(payment.change))
      facts.push(`${t("label.change")} ${this.#money(payment.change)}`);
    return html`<li data-paid-payment=${payment.id}>
      <div>
        <p>
          ${t("bill_pay.payment")
            .replace("{n}", String(n))
            .replace("{method}", () => method)}
        </p>
        <p class="muted">${facts.join(" · ")}</p>
      </div>
      <span class="state ${payment.state === "received" ? "" : "unsettled"}"
        >${t(STATES[payment.state])}</span
      >
    </li>`;
  }

  #status(): string {
    if (this.receiptReadFailed) return t("invoice.print_status_failed");
    const receipt = this.receipt;
    if (receipt === null) return t("invoice.print_checking");
    if (receipt.status === "not_queued") return t("paid.ticket_not_printed");
    if (receipt.status === "failed") return t("paid.ticket_failed");
    return t("paid.ticket_sent");
  }

  #ticketAction(): TemplateResult | typeof nothing {
    if (!this.canPrint) return nothing;
    if (this.originalAvailable)
      return html`<wt-button
        variant="secondary"
        data-test="print-receipt"
        ?disabled=${this.busy}
        @click=${() => this.#emit("print-receipt")}
        >${t("action.print_receipt")}</wt-button
      >`;
    if (this.receipt?.status === "failed" && this.receipt.canRetry)
      return html`<wt-button
        variant="secondary"
        data-test="retry-receipt"
        ?disabled=${this.busy}
        @click=${() => this.#emit("retry-receipt")}
        >${t("invoice.retry_original")}</wt-button
      >`;
    return html`<wt-button
      variant="secondary"
      data-test="reprint"
      ?disabled=${this.busy}
      @click=${() => this.#emit("reprint")}
      >${t("action.reprint")}</wt-button
    >`;
  }

  override render() {
    const count = this.payments.length;
    const summary = (count > 1 ? t("paid.summary") : t("paid.summary_one"))
      .replace("{amount}", () => this.#money(this.total))
      .replace("{n}", String(count));
    return html`<article>
      <section class="banner">
        <h2>
          <span class="tick" aria-hidden="true">✓</span>
          <span data-paid-title>${t("paid.title").replace("{table}", () => this.tableName)}</span>
        </h2>
        <p data-paid-summary>${summary}</p>
      </section>
      ${
        count === 0
          ? nothing
          : html`<ol data-paid-payments aria-label=${t("bill_pay.payments")}>
              ${this.payments.map((payment, index) => this.#payment(payment, index + 1))}
            </ol>`
      }
      <section class="ticket" data-paid-ticket>
        <div class="ticket-text" role="status">
          <p class="status" data-paid-ticket-status>${this.#status()}</p>
          <p class="muted" data-paid-ticket-kind>${t("paid.simplified")}</p>
          ${
            !this.receiptReadFailed && this.receipt?.status === "not_queued"
              ? html`<p class="muted" data-paid-ticket-hint>${t("paid.ticket_reprint_hint")}</p>`
              : nothing
          }
        </div>
        ${
          this.receiptReadFailed
            ? html`<wt-button
                variant="secondary"
                data-test="refresh-receipt"
                ?disabled=${this.busy}
                @click=${() => this.#emit("refresh-receipt")}
                >${t("invoice.check_print")}</wt-button
              >`
            : nothing
        }
        ${this.#ticketAction()}
      </section>
      <div class="actions">
        <wt-button
          variant="primary"
          size="lg"
          data-test="finish-table"
          @click=${() => this.#emit("finish-table")}
          >${t("table.finish")}</wt-button
        >
        <wt-button
          variant="secondary"
          size="lg"
          data-test="back-to-table"
          @click=${() => this.#emit("back-to-table")}
          >${t("paid.back")}</wt-button
        >
      </div>
    </article>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-paid-view": TillPaidView;
  }
}
