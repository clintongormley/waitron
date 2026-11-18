import { outsideCardSummary } from "../widgets/outside-card.js";
import { equipmentTakeover } from "../widgets/equipment-dialog.js";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { live } from "lit/directives/live.js";
import { styleMap } from "lit/directives/style-map.js";
import { ChangeObserver, baseStyles, mediaAddress, subscribeMediaServer } from "@waitron/ui";
import {
  resolveSnapshotText,
  type ReceiptIndent,
  type ReceiptTableRow,
  type TaxTableRow,
} from "@waitron/shared";
import { codeMessage } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import { t } from "../i18n/t.js";
import { qrSvg } from "../qr.js";
import "../widgets/invoice-email-dialog.js";
import "@waitron/ui/src/components/wt-combobox.js";
import type { InvoiceEmailRefusal } from "../widgets/invoice-email-dialog.js";
import {
  a4HoldCodes,
  type EquipmentItem,
  type InvoiceDeliveryAttempt,
  type InvoiceDeliveryStatus,
  type OriginalReceiptPrint,
  type RoleEquipment,
  type TillSaleResult,
} from "../api/client.js";

export interface TicketIssuer {
  venueName: string;
  nif: string;
}

export function lineName(descriptions: Record<string, string>, locale: string): string {
  return resolveSnapshotText(descriptions, locale, locale);
}

const itemColumns = ["units", "item", "price", "amount"] as const;
const taxColumns = ["rate", "base", "tax", "total"] as const;

function receiptTable<Row>(
  keys: readonly (keyof Row)[],
  rowHeading: keyof Row,
  header: Row | undefined,
  rows: readonly Row[],
  indent: (row: Row) => number = () => 0,
) {
  return html`<table class="receipt-table">
    ${
      header
        ? html`<thead>
            <tr>
              ${keys.map((key) => html`<th scope="col" ?data-label=${key === rowHeading}>${header[key]}</th>`)}
            </tr>
          </thead>`
        : nothing
    }
    <tbody>
      ${rows.map(
        (row) =>
          html`<tr>
            ${keys.map((key) =>
              key === rowHeading
                ? html`<th scope="row" style=${styleMap(indentation(indent(row)))}>${row[key]}</th>`
                : html`<td>${row[key]}</td>`,
            )}
          </tr>`,
      )}
    </tbody>
  </table>`;
}

function indentation(indent: ReceiptIndent) {
  const width = typeof indent === "number" ? indent : indent.after.length;
  return {
    "--receipt-indent": `min(${width}ch, 25%)`,
    textIndent: typeof indent === "number" ? null : "calc(-1 * var(--receipt-indent))",
  };
}

function renderReceipt(result: TillSaleResult, language: string) {
  if (result.receiptPreview === undefined) return nothing;
  let alignment: "left" | "center" = "left";
  let itemHeader: ReceiptTableRow | undefined;
  const logo = result.receiptTrim?.logo;
  const lines = result.receiptPreview.map((element): TemplateResult | typeof nothing => {
    switch (element.kind) {
      case "align":
        alignment = element.alignment;
        return nothing;
      case "rule":
        return html`<hr />`;
      case "logo":
        return logo
          ? html`<img
              class="logo"
              src=${mediaAddress(result.receiptTrim.logoUrl ?? `/media/${encodeURIComponent(logo)}`)}
              alt=""
            />`
          : nothing;
      case "qr":
        return html`<div class="qr" data-align=${alignment}>
          ${unsafeHTML(qrSvg(element.text))}
        </div>`;
      case "text":
        return html`<p
          class="receipt-line"
          data-align=${alignment}
          ?data-bold=${element.style?.bold}
          ?data-double=${element.style?.double}
          style=${styleMap(indentation(element.indent))}
        >
          <span>${element.text.trimStart()}</span>
        </p>`;
      case "amount":
        return html`<p
          class="receipt-line receipt-amount"
          data-align=${alignment}
          ?data-bold=${element.style?.bold}
          ?data-double=${element.style?.double}
        >
          <span style=${styleMap(indentation(element.indent))}>${element.caption.trimStart()}</span>
          <span>${element.amount}</span>
        </p>`;
      case "table":
        itemHeader = element.table.header ?? itemHeader;
        return receiptTable<ReceiptTableRow>(
          element.table.withRate ? [...itemColumns, "rate"] : itemColumns,
          "item",
          itemHeader,
          element.table.rows,
          (row) => row.itemIndent ?? 0,
        );
      case "taxTable":
        return receiptTable<TaxTableRow>(taxColumns, "rate", element.header, element.rows);
    }
  });
  return html`<article class="ticket" lang=${language}>${lines}</article>`;
}

function printLabel(
  print: NonNullable<InvoiceDeliveryStatus["actions"]["print"]>,
  againOnA4: boolean,
): string {
  const printer = print.printers[0]!;
  const copy = print.designation === "duplicate";
  return t(
    againOnA4 ? "invoice.send_on_again" : copy ? "invoice.print_on_copy" : "invoice.print_on",
  ).replace("{printer}", () => printer.name);
}

/** The current attempt in words; a receipt attempt is worded by the original's print status. */
function deliveryWords(attempt: InvoiceDeliveryAttempt): string | undefined {
  if (attempt.medium === "receipt") return undefined;
  const hold = attempt.printerHold;
  switch (attempt.status) {
    case "queued":
      return t(
        attempt.medium === "a4" ? "invoice.delivery_waiting_office" : "invoice.delivery_sending",
      );
    case "sending":
      if (hold === null) return t("invoice.delivery_sending");
      // A code this till has no words for must not leave `{reason}` on screen.
      return (a4HoldCodes as readonly string[]).includes(hold)
        ? t("invoice.delivery_held").replace("{reason}", () =>
            t(`invoice.delivery_hold_${hold}` as StringKey),
          )
        : t("invoice.delivery_held_no_reason");
    case "sent":
      return t(
        attempt.medium === "a4" ? "invoice.delivery_sent_a4" : "invoice.delivery_sent_email",
      );
    case "failed":
      return t("invoice.delivery_failed");
    case "unknown":
      return t(hold === null ? "invoice.delivery_unknown" : "invoice.delivery_unknown_held");
  }
}

/** Invoice facts use the filed locale; only operator actions use the UI locale. */
@customElement("till-ticket-view")
export class TillTicketView extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .ticket {
        max-width: var(--wt-till-ticket-column-width);
        margin: 0 auto var(--wt-space-4);
        padding: var(--wt-space-4);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        box-shadow: var(--wt-shadow-1);
        font-variant-numeric: tabular-nums;
        overflow-wrap: anywhere;
      }

      .receipt-line {
        margin: var(--wt-space-1) 0;
      }

      .receipt-line span {
        white-space: pre-wrap;
      }

      [data-align="center"] {
        text-align: center;
      }

      .receipt-line[data-bold] {
        font-weight: var(--wt-font-weight-bold);
      }

      .receipt-line[data-double] {
        font-size: var(--wt-font-size-lg);
      }

      .receipt-amount {
        display: grid;
        grid-template-columns: minmax(0, 1fr) fit-content(55%);
        gap: var(--wt-space-2);
      }

      .receipt-amount span:last-child {
        text-align: end;
      }

      .receipt-line,
      .receipt-amount span:first-child {
        padding-inline-start: var(--receipt-indent, 0);
      }

      .receipt-table {
        inline-size: 100%;
        border-collapse: collapse;
        font-size: var(--wt-font-size-sm);
      }

      .receipt-table :is(td, th) {
        padding-block: var(--wt-space-1);
        text-align: end;
        vertical-align: top;
      }

      .receipt-table :is(td, th) + :is(td, th) {
        padding-inline-start: var(--wt-space-1);
      }

      .receipt-table :is([data-label], [scope="row"]) {
        text-align: start;
      }

      .receipt-table tbody th {
        padding-inline-start: var(--receipt-indent, 0);
        font-weight: inherit;
      }

      .receipt-table td + th {
        padding-inline-start: calc(var(--wt-space-1) + var(--receipt-indent, 0));
      }

      .ticket hr {
        margin-block: var(--wt-space-2);
        border: 0;
        border-block-start: 1px solid var(--wt-color-border);
      }

      .simulation-notice {
        margin: 0 0 var(--wt-space-3);
        padding: var(--wt-space-2);
        border: 2px solid var(--wt-color-danger);
        border-radius: var(--wt-radius-md);
        font-weight: var(--wt-font-weight-bold);
        text-align: center;
      }

      .logo {
        display: block;
        max-width: 100%;
        max-height: calc(var(--wt-tap-min) * 2);
        margin: 0 auto var(--wt-space-2);
        object-fit: contain;
      }

      .qr {
        margin-block: var(--wt-space-2);
      }

      .qr svg {
        width: min(100%, var(--wt-till-receipt-qr-size));
        height: var(--wt-till-receipt-qr-size);
      }

      .new-sale {
        display: block;
        max-width: var(--wt-till-ticket-column-width);
        margin: 0 auto;
      }

      /* The receipt-hardware actions (reprint the paper, kick the drawer) — a row above New sale, each
         a full-width secondary button on the same 22rem column as the ticket + New sale. */
      .receipt-actions {
        display: flex;
        gap: var(--wt-space-3);
        max-width: var(--wt-till-ticket-column-width);
        margin: 0 auto var(--wt-space-3);
      }

      .original-delivery {
        max-width: var(--wt-modal-compact-width);
        box-sizing: border-box;
        margin: 0 auto var(--wt-space-3);
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-warning);
        border-radius: var(--wt-radius-md);
        color: var(--wt-color-text);
        overflow-wrap: anywhere;
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }

      .original-delivery p {
        flex-basis: 100%;
        margin: 0;
      }

      section.invoice-printer {
        max-width: var(--wt-modal-compact-width);
        margin: 0 auto var(--wt-space-3);
      }

      .invoice-printer {
        flex-basis: 100%;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: var(--wt-space-2);
      }

      .receipt-actions wt-button {
        flex: 1;
      }
    `,
  ];

  /** Set before the element connects. */
  @property({ attribute: false }) result!: TillSaleResult;
  /** The receipt language for a result that names none. NEVER the operator-UI `currentLocale()`. */
  @property() invoiceLocale = "es-ES";
  /** Used by the settlement document dialog. */
  @property({ type: Boolean }) simulated = false;
  @property({ type: Boolean }) simulatedCardPayment = false;
  @property({ type: Boolean }) historical = false;
  @property({ type: Boolean }) historicalDelivery = false;
  @property({ type: Boolean }) receiptCopiesOnly = false;
  @property({ type: Boolean }) refundable = false;
  /** True only while the issuance-time original action remains available on this completion screen. */
  @property({ type: Boolean }) originalReceiptAvailable = false;
  @property({ attribute: false }) originalReceiptPrint?: OriginalReceiptPrint;
  @property({ type: Boolean }) originalReceiptBusy = false;
  @property({ type: Boolean }) originalReceiptReadFailed = false;
  /** Whether this caller may request receipt and payment-slip print jobs. */
  @property({ type: Boolean }) canPrintReceipt = true;
  /** Whether this device may expose the manual no-sale cash-drawer action. */
  @property({ type: Boolean }) canOpenDrawer = true;
  /** A full invoice's delivery status; undefined until read. */
  @property({ attribute: false }) deliveries?: InvoiceDeliveryStatus | null;
  @property({ type: Boolean }) deliveriesReadFailed = false;
  /** True while a delivery request is out. */
  @property({ type: Boolean }) deliveryBusy = false;
  /** Why the last delivery request failed: its code, if it answered one. */
  @property({ attribute: false }) deliveryRefusal?: { code?: string };
  /** Whether the app has the email address form open. */
  @property({ type: Boolean }) emailOpen = false;
  @property({ attribute: false }) emailRefusal?: InvoiceEmailRefusal;
  @property({ type: Boolean }) invoicePrintersEnabled = false;
  @property({ attribute: false }) invoiceEquipment?: RoleEquipment;
  @property({ attribute: false }) invoicePrinterValue?: string;
  @property({ type: Boolean }) invoicePrinterLoading = false;
  @property({ type: Boolean }) invoicePrinterReadFailed = false;
  @property({ type: Boolean }) invoicePrinterBlocked = false;
  @property() invoicePrinterError = "";
  @state() private invoicePrinterOpen = false;
  @property({ attribute: false }) receiptEquipment?: RoleEquipment;
  @state() private documentPrinterOpen = false;
  @state() protected printDocument: "receipt" | "invoice" | null = null;
  @state() private takingPrinter: EquipmentItem | null = null;

  constructor() {
    super();
    new ChangeObserver(this, subscribeMediaServer);
  }

  #documentChoice(document: "receipt" | "invoice"): void {
    this.printDocument = document;
    this.invoicePrinterOpen = true;
    this.readInvoicePrinters();
  }

  protected receiptDesignation(): "original" | "duplicate" | null {
    if (this.result.invoiceType !== "F1") {
      const attempt = this.deliveries?.current?.status;
      if (attempt === "queued" || attempt === "sending") return null;
      if (this.deliveries?.originalCompleted) return "duplicate";
      if (this.historical && !this.historicalDelivery) return "duplicate";
      if (this.originalReceiptReadFailed) return null;
      const status = this.originalReceiptPrint?.status;
      if (status !== undefined)
        return status === "not_queued"
          ? "original"
          : status === "done" || this.historical
            ? "duplicate"
            : null;
      return this.historical ? null : this.originalReceiptAvailable ? "original" : "duplicate";
    }
    const status = this.originalReceiptPrint?.status;
    const attempt = this.deliveries?.current?.status;
    if (
      status === "queued" ||
      status === "printing" ||
      attempt === "queued" ||
      attempt === "sending"
    )
      return null;
    if (status === "done" || this.deliveries?.originalCompleted) return "duplicate";
    return status === "not_queued" && !this.receiptCopiesOnly ? "original" : null;
  }

  #renderDocumentPrinter() {
    if (!this.invoicePrintersEnabled || !this.canPrintReceipt) return nothing;
    const receipt = this.printDocument === "receipt";
    const designation = this.receiptDesignation();
    const destination = this.receiptEquipment?.resolved;
    return html`<section class="invoice-printer" aria-label=${t("document.print")}>
      <wt-button
        data-test="document-print-toggle"
        variant="secondary"
        aria-expanded=${this.documentPrinterOpen}
        @click=${() => {
          this.documentPrinterOpen = !this.documentPrinterOpen;
          if (this.documentPrinterOpen) {
            this.printDocument = null;
            if (this.result.invoiceType !== "F1") this.#documentChoice("receipt");
          }
        }}
        >${t("document.print")}</wt-button
      >
      ${
        this.documentPrinterOpen
          ? html`
              ${
                this.printDocument === null
                  ? html`
                      ${
                        !this.receiptCopiesOnly || designation === "duplicate"
                          ? html`<wt-button
                              data-test="document-receipt"
                              variant="secondary"
                              @click=${() => this.#documentChoice("receipt")}
                              >${t("document.receipt")}</wt-button
                            >`
                          : nothing
                      }
                      ${this.result.invoiceType === "F1" ? html`<wt-button data-test="document-invoice" variant="secondary" @click=${() => this.#documentChoice("invoice")}>${t("document.invoice")}</wt-button>` : nothing}
                    `
                  : html`
                      ${this.renderInvoicePrinter()}
                      ${
                        receipt
                          ? designation === null
                            ? nothing
                            : html`
                                <wt-button
                                  data-test=${designation === "original" ? "print-receipt" : "reprint"}
                                  variant="secondary"
                                  ?disabled=${!destination?.available || this.invoicePrinterLoading || this.invoicePrinterBlocked || this.originalReceiptBusy || this.deliveryBusy}
                                  @click=${() => (designation === "original" ? this.#printReceipt() : this.#reprint())}
                                  >${t(designation === "original" ? "invoice.print_on" : "invoice.print_on_copy").replace("{printer}", () => destination?.name ?? t("equipment.none"))}</wt-button
                                >
                              `
                          : this.renderInvoicePrint()
                      }
                    `
              }
              <wt-button
                data-test="document-back"
                variant="secondary"
                @click=${() => {
                  if (this.printDocument !== null && this.result.invoiceType === "F1")
                    this.printDocument = null;
                  else this.documentPrinterOpen = false;
                }}
                >${t("action.back")}</wt-button
              >
            `
          : nothing
      }
    </section>`;
  }

  protected renderInvoicePrint() {
    const status = this.deliveries;
    const print = this.canPrintReceipt ? status?.actions.print : null;
    return print
      ? html`<wt-button
          variant="secondary"
          data-test="print-invoice"
          ?disabled=${this.deliveryBusy || this.originalReceiptBusy || this.invoicePrinterBlocked}
          @click=${() => this.dispatchEvent(new CustomEvent("print-invoice", { bubbles: true, composed: true }))}
          >${printLabel(print, status?.actions.retryOriginal?.medium === "a4" && status.originalPrinterId === print.printers[0]?.id)}</wt-button
        >`
      : nothing;
  }

  protected readInvoicePrinters(): void {
    this.dispatchEvent(
      new CustomEvent("invoice-printer-open", {
        detail: { role: this.printDocument ?? "invoice" },
        bubbles: true,
        composed: true,
      }),
    );
  }

  protected renderInvoicePrinter() {
    if (!this.invoicePrintersEnabled || !this.canPrintReceipt) return nothing;
    const receipt = this.printDocument === "receipt";
    const role = receipt ? this.receiptEquipment : this.invoiceEquipment;
    const printer =
      role?.choices.find((item) => item.id === role.resolved?.id) ??
      role?.chosen ??
      role?.default ??
      (!receipt ? this.deliveries?.actions.print?.printers[0] : undefined);
    const paper =
      printer?.kind === "a4" ? "A4" : printer?.kind === "receipt" ? t("invoice.receipt_paper") : "";
    return html`<div class="invoice-printer">
      <wt-button
        data-test="invoice-printer-toggle"
        variant="secondary"
        aria-expanded=${this.invoicePrinterOpen}
        @click=${() => {
          this.invoicePrinterOpen = !this.invoicePrinterOpen;
          if (this.invoicePrinterOpen) this.readInvoicePrinters();
        }}
        >${t(receipt ? "equipment.receipt" : "equipment.invoice")}:
        ${role?.resolved?.name ?? (!receipt ? this.deliveries?.actions.print?.printers[0]?.name : undefined) ?? t("equipment.none")}${paper ? ` · ${paper}` : ""}</wt-button
      >
      ${
        this.invoicePrinterOpen
          ? html`
              ${this.invoicePrinterLoading ? html`<p>${t("login.loading")}</p>` : nothing}
              ${
                this.invoicePrinterReadFailed
                  ? html`<p>
                      ${t(receipt ? "document.printer_read_failed" : "invoice.printer_read_failed")}
                    </p>`
                  : role
                    ? html`<wt-combobox
                          name=${receipt ? "receiptPrinterId" : "invoicePrinterId"}
                          label=${t(receipt ? "equipment.receipt" : "equipment.invoice")}
                          search="auto"
                          placeholder=${t("equipment.use_default").replace("{name}", () => role.default?.name ?? t("equipment.none"))}
                          searchPlaceholder=${t("form.combobox_search")}
                          noResultsLabel=${t("form.combobox_no_results")}
                          .value=${live(this.invoicePrinterValue ?? (role.selection === "default" ? "" : (role.chosenId ?? "")))}
                          .options=${[
                            {
                              value: "",
                              label: t("equipment.use_default").replace(
                                "{name}",
                                () => role.default?.name ?? t("equipment.none"),
                              ),
                            },
                            ...role.choices.map((item) => ({
                              value: item.id,
                              label: `${item.name} · ${item.kind === "a4" ? "A4" : t("invoice.receipt_paper")}`,
                            })),
                          ]}
                          .error=${this.invoicePrinterError}
                          .invalid=${this.invoicePrinterError !== ""}
                          ?disabled=${this.invoicePrinterLoading}
                          @wt-change=${(event: CustomEvent<{ value: string }>) => {
                            event.stopPropagation();
                            const value = event.detail.value;
                            const item = role.choices.find((choice) => choice.id === value);
                            const send = (takeOver?: boolean) =>
                              this.dispatchEvent(
                                new CustomEvent("equipment-change", {
                                  detail: {
                                    role: receipt ? "receipt" : "invoice",
                                    selection: value === "" ? "default" : { id: value },
                                    via: "list",
                                    ...(takeOver === undefined ? {} : { takeOver }),
                                  },
                                  bubbles: true,
                                  composed: true,
                                }),
                              );
                            if (receipt && item?.heldBy) this.takingPrinter = item;
                            else send();
                          }}
                        ></wt-combobox>
                        ${role.choices.length === 0 ? html`<p>${t(receipt ? "document.no_printers" : "invoice.no_printers")}</p>` : nothing}`
                    : nothing
              }
              <wt-button
                data-test="invoice-printer-read-retry"
                variant="secondary"
                ?disabled=${this.invoicePrinterLoading}
                @click=${() => this.readInvoicePrinters()}
                >${t("hours.refresh")}</wt-button
              >
            `
          : nothing
      }
      ${
        this.invoicePrinterError
          ? html`<p role="alert">${this.invoicePrinterError}</p>
              <wt-button
                data-test="invoice-printer-save-retry"
                variant="secondary"
                @click=${() => this.dispatchEvent(new CustomEvent("invoice-printer-retry", { bubbles: true, composed: true }))}
                >${t("find_page.retry")}</wt-button
              >`
          : nothing
      }
      ${
        this.takingPrinter === null
          ? nothing
          : equipmentTakeover(
              this.takingPrinter,
              () => {
                const item = this.takingPrinter!;
                this.takingPrinter = null;
                this.dispatchEvent(
                  new CustomEvent("equipment-change", {
                    detail: {
                      role: "receipt",
                      selection: { id: item.id },
                      via: "list",
                      takeOver: true,
                    },
                    bubbles: true,
                    composed: true,
                  }),
                );
              },
              () => {
                this.takingPrinter = null;
              },
            )
      }
    </div>`;
  }

  #newSale(): void {
    this.dispatchEvent(new CustomEvent("new-sale", { bubbles: true, composed: true }));
  }

  /** `till-app` owns the call: the filed `result` carries no working-order id. */
  #reprint(): void {
    this.dispatchEvent(new CustomEvent("reprint", { bubbles: true, composed: true }));
  }

  #printReceipt(): void {
    this.dispatchEvent(new CustomEvent("print-receipt", { bubbles: true, composed: true }));
  }

  #printPaymentSlip(): void {
    this.dispatchEvent(new CustomEvent("payment-slip", { bubbles: true, composed: true }));
  }

  /** A no-sale drawer kick; `till-app` owns the call. */
  #openDrawer(): void {
    this.dispatchEvent(new CustomEvent("open-drawer", { bubbles: true, composed: true }));
  }

  protected renderDrawer() {
    return !this.historical && this.canOpenDrawer
      ? html`<wt-button
          class="open-drawer"
          variant="secondary"
          size="lg"
          data-test="open-drawer"
          @click=${() => this.#openDrawer()}
        >
          ${t("action.open_drawer")}
        </wt-button>`
      : nothing;
  }

  #retainedReceiptPrinterName(): string | undefined {
    return this.originalReceiptPrint?.status === "not_queued"
      ? undefined
      : this.originalReceiptPrint?.printerName;
  }

  protected renderDelivery() {
    const status = this.deliveries;
    const words = status?.current ? deliveryWords(status.current) : undefined;
    const busy = this.deliveryBusy || this.originalReceiptBusy;
    const instead = this.canPrintReceipt ? status?.actions.receiptInstead : null;
    const retainedPrinter = this.#retainedReceiptPrinterName();
    const insteadPrinter =
      retainedPrinter ?? this.receiptEquipment?.resolved?.name ?? t("equipment.none");
    const email = this.canPrintReceipt ? status?.actions.email : null;
    const emailAgainId =
      this.canPrintReceipt && status?.actions.retryOriginal?.medium === "email"
        ? status.current?.id
        : null;
    return html`
      ${words === undefined ? nothing : html`<p role="status" data-test="delivery-status">${words}</p>`}
      ${
        this.deliveriesReadFailed
          ? html`<p role="status" data-test="delivery-read-failed">
              ${t("invoice.delivery_read_failed")}
            </p>`
          : nothing
      }
      ${
        this.deliveryRefusal
          ? html`<p role="alert" data-test="delivery-refused">
              ${this.deliveryRefusal.code === undefined ? t("invoice.delivery_error") : codeMessage(this.deliveryRefusal.code)}
            </p>`
          : nothing
      }
      ${this.invoicePrintersEnabled ? nothing : this.renderInvoicePrint()}
      ${
        emailAgainId
          ? html`<wt-button
              variant="secondary"
              data-test="email-again"
              ?disabled=${busy}
              @click=${() =>
                this.dispatchEvent(
                  new CustomEvent("retry-email", {
                    detail: { deliveryId: emailAgainId },
                    bubbles: true,
                    composed: true,
                  }),
                )}
              >${t("invoice.email_again")}</wt-button
            >`
          : nothing
      }
      ${
        email
          ? html`<wt-button
              variant="secondary"
              data-test="email-invoice"
              ?disabled=${busy}
              @click=${() => this.dispatchEvent(new CustomEvent("email-invoice", { bubbles: true, composed: true }))}
              >${t(emailAgainId ? "invoice.email_other" : email.designation === "duplicate" ? "invoice.email_copy" : "invoice.email_send")}</wt-button
            >`
          : nothing
      }
      ${
        instead
          ? html`<wt-button
              variant="secondary"
              data-test="receipt-instead"
              ?disabled=${busy}
              @click=${() =>
                this.dispatchEvent(
                  new CustomEvent("receipt-instead", {
                    detail: { deliveryId: instead.deliveryId },
                    bubbles: true,
                    composed: true,
                  }),
                )}
              >${
                this.receiptCopiesOnly
                  ? t("invoice.receipt_instead_on").replace("{printer}", () => insteadPrinter)
                  : t("invoice.receipt_instead")
              }</wt-button
            >`
          : nothing
      }
    `;
  }

  protected renderReceiptRetry(failedButSuperseded: boolean) {
    const receiptBusy = this.originalReceiptBusy || this.deliveryBusy;
    const printerName = this.#retainedReceiptPrinterName();
    return this.canPrintReceipt &&
      this.originalReceiptPrint?.status === "failed" &&
      this.originalReceiptPrint.canRetry &&
      !this.originalReceiptPrint.printerWithdrawn &&
      !failedButSuperseded
      ? html`<wt-button
          variant="secondary"
          data-test="retry-receipt"
          size="lg"
          ?disabled=${receiptBusy}
          @click=${() => this.dispatchEvent(new CustomEvent("retry-receipt", { bubbles: true, composed: true }))}
          >${
            printerName === undefined
              ? t("invoice.retry_original")
              : t("invoice.retry_original_on").replace("{printer}", () => printerName)
          }</wt-button
        >`
      : nothing;
  }

  protected renderOriginalDelivery(includeRetry = false) {
    const attempt = this.deliveries?.current;
    const notQueued = this.originalReceiptPrint?.status === "not_queued";
    const failedReceipt = this.originalReceiptPrint?.status === "failed";
    const failedButDelivered = failedReceipt && this.deliveries?.originalCompleted === true;
    // The server refuses to resend the receipt original beside any active delivery or once an original
    // completed; only an A4 or email one replaces the receipt's own failure line.
    const failedButSuperseded =
      failedButDelivered ||
      (failedReceipt &&
        attempt != null &&
        attempt.medium !== "receipt" &&
        (attempt.status === "queued" || attempt.status === "sending"));
    const receiptBusy = this.originalReceiptBusy || this.deliveryBusy;
    return html`
      ${
        (this.result.invoiceType === "F1" && (!this.historical || this.historicalDelivery)) ||
        (this.result.invoiceType !== "F1" &&
          (includeRetry || this.historicalDelivery) &&
          (this.deliveries != null ||
            this.deliveriesReadFailed ||
            this.originalReceiptReadFailed ||
            (this.originalReceiptPrint !== undefined && !notQueued)))
          ? html`<section class="original-delivery" data-test="original-delivery">
              ${
                this.result.invoiceType === "F1"
                  ? html`<p role="status">
                      <strong
                        >${t(this.originalReceiptPrint?.status !== "not_queued" && this.originalReceiptPrint?.handover ? "invoice.handover_confirmed" : (notQueued && this.deliveries?.originalCompleted) || failedButDelivered ? "invoice.delivered" : "invoice.not_delivered")}</strong
                      >
                    </p>`
                  : nothing
              }
              ${
                // An A4 or email attempt says where the invoice is; "not sent to a printer", or a
                // receipt failure that no longer matters, would contradict it.
                !this.originalReceiptReadFailed &&
                ((notQueued && attempt != null && attempt.medium !== "receipt") ||
                  failedButSuperseded)
                  ? nothing
                  : html`<p>
                      ${this.originalReceiptReadFailed ? t("invoice.print_status_failed") : this.originalReceiptPrint === undefined ? t("invoice.print_checking") : this.originalReceiptPrint.status === "failed" && this.originalReceiptPrint.failureCode === "printer.deleted" ? codeMessage("printer.deleted") : t(this.originalReceiptPrint.status === "failed" && this.originalReceiptPrint.printerWithdrawn ? "invoice.print_failed_withdrawn" : this.originalReceiptPrint.status === "failed" && !this.originalReceiptPrint.canRetry ? "invoice.print_auto_retry" : this.originalReceiptPrint.status === "done" && this.originalReceiptPrint.handover ? "invoice.print_completed" : `invoice.print_${this.originalReceiptPrint.status}`)}
                    </p>`
              }
              ${this.renderDelivery()}
              ${
                this.result.invoiceType === "F1" &&
                this.originalReceiptPrint?.status === "done" &&
                !this.originalReceiptPrint.handover
                  ? html`<wt-button
                      variant="primary"
                      data-test="confirm-handover"
                      ?disabled=${receiptBusy}
                      @click=${() => this.dispatchEvent(new CustomEvent("confirm-handover", { bubbles: true, composed: true }))}
                      >${t("invoice.confirm_handover")}</wt-button
                    >`
                  : nothing
              }
              <wt-button
                variant="secondary"
                data-test="refresh-receipt"
                ?disabled=${receiptBusy}
                @click=${() => this.dispatchEvent(new CustomEvent("refresh-receipt", { bubbles: true, composed: true }))}
                >${t("invoice.check_print")}</wt-button
              >
              ${includeRetry ? this.renderReceiptRetry(failedButSuperseded) : nothing}
            </section>`
          : nothing
      }
    `;
  }

  override render() {
    const r = this.result;
    const attempt = this.deliveries?.current;
    const notQueued = this.originalReceiptPrint?.status === "not_queued";
    const failedReceipt = this.originalReceiptPrint?.status === "failed";
    const failedButDelivered = failedReceipt && this.deliveries?.originalCompleted === true;
    // The server refuses to resend the receipt original beside any active delivery or once an original
    // completed; only an A4 or email one replaces the receipt's own failure line.
    const failedButSuperseded =
      failedButDelivered ||
      (failedReceipt &&
        attempt != null &&
        attempt.medium !== "receipt" &&
        (attempt.status === "queued" || attempt.status === "sending"));
    const receiptBusy = this.originalReceiptBusy || this.deliveryBusy;
    return html`
      ${renderReceipt(r, r.locale ?? this.invoiceLocale)}
      <section data-outside-payment-facts>
        ${
          r.payments?.length
            ? r.payments.map((payment, index) =>
                payment.method === "card" && (payment.externalProvider || payment.externalMachine)
                  ? html`<div data-outside-payment-fact>
                      <p>
                        ${t("bill_pay.payment")
                          .replace("{n}", String(index + 1))
                          .replace("{method}", t("tender.card"))}
                        ${payment.reference === null ? nothing : html` · ${t("tender.operation_number")} ${payment.reference}`}
                      </p>
                      ${outsideCardSummary(payment)}
                    </div>`
                  : nothing,
              )
            : outsideCardSummary(r.tender.method === "card" ? r.tender : {})
        }
      </section>

      ${this.renderOriginalDelivery()}
      ${
        this.emailOpen && this.canPrintReceipt
          ? html`<till-invoice-email-dialog
              .copy=${this.deliveries?.actions.email?.designation === "duplicate"}
              .busy=${this.deliveryBusy}
              .refusal=${this.emailRefusal}
            ></till-invoice-email-dialog>`
          : nothing
      }
      ${this.#renderDocumentPrinter()}
      <div class="receipt-actions">
        ${
          this.historical && this.refundable
            ? html`<wt-button
                  data-tender-refund
                  variant="secondary"
                  @click=${() => this.dispatchEvent(new CustomEvent("tender-refund-open", { bubbles: true, composed: true }))}
                  >${t("tender_refund.title")}</wt-button
                >
                <wt-button
                  data-invoice-correction
                  variant="secondary"
                  @click=${() => this.dispatchEvent(new CustomEvent("invoice-correction-open", { bubbles: true, composed: true }))}
                  >${t("invoice_correction.title")}</wt-button
                >`
            : nothing
        }
        ${
          this.canPrintReceipt
            ? this.invoicePrintersEnabled
              ? this.renderReceiptRetry(failedButSuperseded)
              : this.historical && !this.historicalDelivery
                ? html`<wt-button
                    variant="secondary"
                    data-test="reprint"
                    @click=${() => this.#reprint()}
                    >${t("action.reprint")}</wt-button
                  >`
                : (
                      r.invoiceType === "F1"
                        ? // The server refuses a receipt original beside an active or completed delivery.
                          notQueued &&
                          !this.deliveries?.originalCompleted &&
                          attempt?.status !== "queued" &&
                          attempt?.status !== "sending"
                        : this.originalReceiptAvailable
                    )
                  ? html`<wt-button
                      class="print-receipt"
                      variant="secondary"
                      size="lg"
                      data-test="print-receipt"
                      ?disabled=${receiptBusy}
                      @click=${() => this.#printReceipt()}
                    >
                      ${t(r.invoiceType === "F1" ? "invoice.print_original" : "action.print_receipt")}
                    </wt-button>`
                  : r.invoiceType === "F1" &&
                      this.originalReceiptPrint?.status === "failed" &&
                      this.originalReceiptPrint.canRetry &&
                      !this.originalReceiptPrint.printerWithdrawn &&
                      !failedButSuperseded
                    ? html`<wt-button
                        variant="secondary"
                        size="lg"
                        data-test="retry-receipt"
                        ?disabled=${receiptBusy}
                        @click=${() => this.dispatchEvent(new CustomEvent("retry-receipt", { bubbles: true, composed: true }))}
                        >${t("invoice.retry_original")}</wt-button
                      >`
                    : r.invoiceType !== "F1" || this.originalReceiptPrint?.status === "done"
                      ? html`<wt-button
                          class="reprint"
                          variant="secondary"
                          size="lg"
                          data-test="reprint"
                          @click=${() => this.#reprint()}
                        >
                          ${t("action.reprint")}
                        </wt-button>`
                      : nothing
            : nothing
        }
        ${
          !this.historical &&
          this.canPrintReceipt &&
          (r.payments?.some((payment) => payment.method === "card" && payment.reference === null) ??
            r.tender.method === "card")
            ? html`<wt-button
                class="payment-slip"
                variant="secondary"
                size="lg"
                data-test="payment-slip"
                @click=${() => this.#printPaymentSlip()}
              >
                ${t("action.payment_slip")}
              </wt-button>`
            : nothing
        }
        ${this.renderDrawer()}
      </div>

      ${
        this.historical
          ? html`<wt-button
              variant="secondary"
              data-back-to-find-bill
              @click=${() => this.dispatchEvent(new CustomEvent("back-to-find-bill", { bubbles: true, composed: true }))}
              >${t("find_bill.back")}</wt-button
            >`
          : html`<wt-button
              class="new-sale"
              variant="primary"
              size="lg"
              @click=${() => this.#newSale()}
            >
              ${t("action.new_sale")}
            </wt-button>`
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-ticket-view": TillTicketView;
  }
}
