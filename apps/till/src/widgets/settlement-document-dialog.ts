import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { TillTicketView } from "../screens/till-ticket-view.js";
import { currentLocale, t } from "../i18n/t.js";
import { formatMoney } from "@waitron/shared";
import { trackDialog } from "./track-dialog.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";

@customElement("till-settlement-document-dialog")
export class TillSettlementDocumentDialog extends TillTicketView {
  @state() private choice: "receipt" | "invoice" = "receipt";

  constructor() {
    super();
    this.printDocument = "receipt";
  }

  #close(): void {
    this.dispatchEvent(new CustomEvent("settlement-close", { bubbles: true, composed: true }));
  }

  override render() {
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
        this.result.tender.method === "cash" && this.result.tender.change !== "0.00"
          ? html`<p data-settlement-change>
              ${t("label.change")} ${formatMoney(this.result.tender.change, currentLocale())}
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
              >`
          : this.renderInvoicePrint()
      }
      ${this.renderOriginalDelivery(true)} ${this.renderDrawer()}
      ${
        this.result.invoiceType === "F1" && this.emailOpen && this.canPrintReceipt
          ? html`<till-invoice-email-dialog
              .copy=${this.deliveries?.actions.email?.designation === "duplicate"}
              .busy=${this.deliveryBusy}
              .refusal=${this.emailRefusal}
            ></till-invoice-email-dialog>`
          : nothing
      }
      <wt-form-actions slot="footer">
        <wt-button
          data-settlement-none
          slot="cancel"
          variant="secondary"
          @click=${() => this.#close()}
          >${t("settlement.none")}</wt-button
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
