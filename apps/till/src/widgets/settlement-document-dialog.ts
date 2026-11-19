import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { TillTicketView } from "../screens/till-ticket-view.js";
import { currentLocale, t } from "../i18n/t.js";
import { formatMoney } from "@waitron/shared";
import { receiptLabelsFor } from "@waitron/country-packs";
import { trackDialog } from "./track-dialog.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";

@customElement("till-settlement-document-dialog")
export class TillSettlementDocumentDialog extends TillTicketView {
  @property({ attribute: false }) cashChange: string | null = null;

  @state() private choice: "receipt" | "invoice" = "receipt";

  constructor() {
    super();
    this.printDocument = "receipt";
  }

  #closingState(): "prints" | "switched-off" | "no-printer" | "not-allowed" | null {
    if (this.receiptDesignation() !== "original") return null;
    if (!this.canPrintReceipt) return "not-allowed";
    if (this.receiptEquipment === undefined) return null;
    const { resolved: printer, choices } = this.receiptEquipment;
    if (printer == null) return choices.length === 0 ? null : "no-printer";
    return printer.available ? "prints" : "switched-off";
  }

  protected override renderReceiptPrinterNote(designation: "original" | "duplicate") {
    return designation === "original" && this.#closingState() !== null
      ? nothing
      : super.renderReceiptPrinterNote(designation);
  }

  protected override closingQueuesOriginal(): boolean {
    const state = this.#closingState();
    return state === "prints" || state === "switched-off";
  }

  #closingLine() {
    const state = this.#closingState();
    if (state === null) return nothing;
    const email = this.emailAction() !== null;
    const text =
      state === "not-allowed"
        ? t("settlement.closing_not_allowed")
        : state === "no-printer"
          ? t(email ? "settlement.closing_no_printer" : "settlement.closing_no_printer_no_email")
          : state === "switched-off"
            ? t("settlement.closing_switched_off").replace(
                "{printer}",
                () => this.receiptEquipment!.resolved!.name,
              )
            : t(email ? "settlement.closing_prints" : "settlement.closing_prints_no_email");
    return html`<p data-settlement-closing=${state}>${text}</p>`;
  }

  #close(): void {
    this.dispatchEvent(new CustomEvent("settlement-close", { bubbles: true, composed: true }));
  }

  override render() {
    const labels = receiptLabelsFor(this.result.locale ?? this.invoiceLocale);
    const receipt = this.choice === "receipt" || this.result.invoiceType !== "F1";
    const designation = this.receiptDesignation();
    const printer = this.receiptEquipment?.resolved;
    return html`<wt-dialog
      ${trackDialog()}
      open
      .heading=${t("settlement.document")}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#close();
      }}
    >
      ${
        this.simulated
          ? html`<p class="simulation-notice" data-test="simulation-notice">
              ${labels.practice}
              ${this.simulatedCardPayment ? html`<br />${labels.noRealCharge}` : nothing}
            </p>`
          : nothing
      }
      ${
        this.cashChange !== null && this.cashChange !== "0.00"
          ? html`<p data-settlement-change>
              ${t("label.change")} ${formatMoney(this.cashChange, currentLocale())}
            </p>`
          : nothing
      }
      <wt-button
        data-settlement-choice="receipt"
        aria-pressed=${this.choice === "receipt"}
        variant=${this.choice === "receipt" ? "primary" : "secondary"}
        @click=${() => {
          this.choice = "receipt";
          this.printDocument = "receipt";
          this.readInvoicePrinters();
        }}
        >${t("document.receipt")}</wt-button
      >
      <wt-button
        data-settlement-choice="invoice"
        aria-pressed=${this.choice === "invoice"}
        variant=${this.choice === "invoice" ? "primary" : "secondary"}
        @click=${() => {
          this.choice = "invoice";
          this.printDocument = this.result.invoiceType === "F1" ? "invoice" : "receipt";
          this.readInvoicePrinters();
        }}
        >${t("settlement.full_invoice")}</wt-button
      >
      ${
        this.choice === "invoice" && this.result.invoiceType !== "F1"
          ? html`<p>${t("settlement.replacement_unavailable")}</p>`
          : nothing
      }
      ${
        this.choice === "invoice" && this.result.recipient
          ? html`<p>
              ${this.result.recipient.legalName}<br />${this.result.recipient.taxId}<br />${this.result.recipient.address}
            </p>`
          : nothing
      }
      ${this.renderInvoicePrinter()}
      ${
        receipt
          ? designation === null || !this.canPrintReceipt
            ? nothing
            : html`<wt-button
                  data-test=${designation === "original" ? "print-receipt" : "reprint"}
                  variant="primary"
                  ?disabled=${!printer?.available || this.invoicePrinterLoading || this.invoicePrinterBlocked || this.originalReceiptBusy || this.deliveryBusy}
                  @click=${() => this.dispatchEvent(new CustomEvent(designation === "original" ? "print-receipt" : "reprint", { bubbles: true, composed: true }))}
                  >${t(designation === "original" ? "invoice.print_on" : "invoice.print_on_copy").replace("{printer}", () => printer?.name ?? t("equipment.none"))}</wt-button
                >${this.renderReceiptPrinterNote(designation)}`
          : this.renderInvoicePrint()
      }
      ${this.renderOriginalDelivery(true)} ${this.renderDrawer()}
      ${
        this.emailOpen && this.canPrintReceipt
          ? html`<till-invoice-email-dialog
              .copy=${this.deliveries?.actions.email?.designation === "duplicate"}
              .busy=${this.deliveryBusy}
              .refusal=${this.emailRefusal}
            ></till-invoice-email-dialog>`
          : nothing
      }
      ${this.#closingLine()}
      <wt-form-actions slot="footer">
        <wt-button
          data-settlement-done
          slot="cancel"
          variant="secondary"
          @click=${() => this.#close()}
          >${t("settlement.done")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-settlement-document-dialog": TillSettlementDocumentDialog;
  }
}
