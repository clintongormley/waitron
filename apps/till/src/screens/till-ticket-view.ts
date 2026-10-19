import { optionAnswers } from "../widgets/option-snapshot.js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { baseStyles } from "@waitron/ui";
import {
  addDecimal,
  decimal,
  formatMoney,
  negateDecimal,
  perDishOptionQuantity,
  resolveSnapshotText,
} from "@waitron/shared";
import { FALLBACK_RECEIPT_LOCALE, receiptLabelsFor } from "@waitron/country-packs";
import type { ReceiptLabels } from "@waitron/country";
import { codeMessage } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import { t } from "../i18n/t.js";
import { qrSvg } from "../qr.js";
import "../widgets/invoice-email-dialog.js";
import type { InvoiceEmailRefusal } from "../widgets/invoice-email-dialog.js";
import {
  a4HoldCodes,
  type BillTenderLine,
  type InvoiceDeliveryAttempt,
  type InvoiceDeliveryStatus,
  type OriginalReceiptPrint,
  type ReceiptAdjustment,
  type TillSaleLine,
  type TillSaleResult,
} from "../api/client.js";

/** The receipt issuer's legally-printed identity (RD 1619/2012 art. 7.1.d): venue name + NIF. */
export interface TicketIssuer {
  venueName: string;
  nif: string;
}

/**
 * A filed line's goods name (art. 7.1.e), looked up under the sale's names language.
 *
 * `descriptions` is keyed by the location's receipt languages when the line was added; a line added
 * from an order holds the same text under every key (`defaultLanguageDescriptions`,
 * `packages/catalogue/src/default-language-text.ts`). A later change can leave the keys without the
 * names language, so the lookup falls back to the first stored name. The line's `unitName` is keyed
 * by a content language such as `es`, never a receipt language, which is why the quantity below
 * resolves it through `resolveSnapshotText` instead, as the printed twin
 * (`apps/server/src/receipt-document.ts`) does.
 */
function lineName(descriptions: Record<string, string>, locale: string): string {
  return descriptions[locale] ?? Object.values(descriptions)[0] ?? "";
}

interface LineGroup {
  dish: TillSaleLine;
  options: TillSaleLine[];
}

/**
 * The filed lines arrive dish-then-its-options, so a single forward scan attaching each child to the most
 * recent dish groups them. It recomputes no figure: it only groups the SAME already-filed lines.
 *
 * A LOCAL copy of `apps/server/src/receipt-lines.ts`'s `groupByParent`: importing it would drag server
 * code into the browser bundle. A leading child with no dish yet is treated as its own dish rather than
 * dropped, so no filed line ever vanishes from the on-screen ticket.
 */
function groupByParent(lines: readonly TillSaleLine[]): LineGroup[] {
  const groups: LineGroup[] = [];
  for (const line of lines) {
    const current = groups[groups.length - 1];
    if (line.parentLineNo == null || current === undefined) {
      groups.push({ dish: line, options: [] });
    } else {
      current.options.push(line);
    }
  }
  return groups;
}

/** A row at its list price; what a comp or discount took off is its own line (`adjustmentRow`). */
function lineGross(line: TillSaleLine, locale: string) {
  return html`<span class="line-gross">${formatMoney(line.listGross ?? line.gross, locale)}</span>`;
}

function netFacts(line: TillSaleLine, names: string, format: string, labels: ReceiptLabels) {
  if (line.net === undefined) return nothing;
  const unit = line.unitName == null ? "" : ` ${resolveSnapshotText(line.unitName, names, names)}`;
  return html`<li class="invoice-facts">
    <div class="vat-row">
      <span>${labels.netUnitPrice}</span
      ><span
        >${formatMoney(line.net.unitPrice, format)} /
        ${line.net.priceQuantity.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1")}${unit}</span
      >
    </div>
    <div class="vat-row">
      <span>${labels.base} ${line.net.rate}%</span
      ><span>${formatMoney(line.net.base, format)}</span>
    </div>
    ${
      line.net.tax === undefined
        ? nothing
        : html`<div class="vat-row">
            <span>${labels.vat} ${line.net.rate}%</span
            ><span>${formatMoney(line.net.tax, format)}</span>
          </div>`
    }
  </li>`;
}

const percentFormatters = new Map<string, Intl.NumberFormat>();

/** `Descuento 12,5%` for 1250 basis points, as `apps/server/src/receipt-ticket.ts` prints it. */
function adjustmentLabel(
  adjustment: ReceiptAdjustment,
  locale: string,
  labels: ReceiptLabels,
): string {
  if (adjustment.kind === "comp") return labels.comp;
  if (adjustment.percentBp === undefined) return labels.discount;
  let formatter = percentFormatters.get(locale);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    percentFormatters.set(locale, formatter);
  }
  return `${labels.discount} ${formatter.format(adjustment.percentBp / 100)}%`;
}

function adjustmentRow(
  adjustment: ReceiptAdjustment,
  locale: string,
  labels: ReceiptLabels,
  kind: "adjustment" | "bill-adjustment",
  invoiceType: TillSaleResult["invoiceType"],
) {
  return html`<li class="line ${kind}">
    <span class="line-name"
      >${adjustmentLabel(adjustment, locale, labels)}${invoiceType === "F1" ? ` (${labels.vatIncluded})` : ""}</span
    >
    <span class="line-gross">-${formatMoney(adjustment.amount, locale)}</span>
  </li>`;
}

/** The fecha de expedición (art. 7.1.b). */
function issueDate(iso: string, locale: string, offsetMinutes?: number): string {
  const instant = new Date(iso);
  const date =
    offsetMinutes === undefined ? instant : new Date(instant.getTime() + offsetMinutes * 60_000);
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(offsetMinutes === undefined ? {} : { timeZone: "UTC" }),
  })
    .formatToParts(date)
    .map((part) => (part.type === "hour" ? part.value.padStart(2, "0") : part.value))
    .join("");
}

function tenderRow(label: string, amount: string, locale: string) {
  return html`<div class="tender-row">
    <span>${label}</span>
    <span>${formatMoney(amount, locale)}</span>
  </div>`;
}

/** One payment of a bill paid in parts, as the printed receipt (`apps/server/src/receipt-ticket.ts`)
 * lists it. */
function renderBillPayment(payment: BillTenderLine, locale: string, labels: ReceiptLabels) {
  const given = (refund: { amount: string; tip: string }) =>
    addDecimal(decimal(refund.amount), decimal(refund.tip));
  const paid =
    payment.method === "cash"
      ? html`${tenderRow(labels.cash, payment.tendered, locale)}
        ${payment.change !== "0.00" ? tenderRow(labels.change, payment.change, locale) : nothing}`
      : html`${tenderRow(
          labels.card,
          // A card's amount is net of its refunds, which are listed beneath it: show the original
          // charge.
          payment.refunds.reduce(
            (sum, refund) => addDecimal(sum, given(refund)),
            decimal(payment.amount),
          ),
          locale,
        )}
        ${
          payment.reference !== null
            ? html`<div class="tender-row">
                <span>${labels.reference} ${payment.reference}</span>
              </div>`
            : nothing
        }`;
  return html`
    ${paid} ${payment.tip !== "0.00" ? tenderRow(labels.tip, payment.tip, locale) : nothing}
    ${payment.refunds.map((refund) =>
      tenderRow(labels.refund, negateDecimal(given(refund)), locale),
    )}
  `;
}

/** An allowed operational extra alongside `result.total`. Card-present identity lives on the separate
 * payment slip. */
function renderTender(result: TillSaleResult, locale: string, labels: ReceiptLabels) {
  if (result.payments !== undefined && result.payments.length > 0) {
    return result.payments.map((payment) => renderBillPayment(payment, locale, labels));
  }
  const t = result.tender;
  if (t.method === "unpaid") return nothing;
  if (t.method === "cash") {
    return html`
      <div class="tender-row">
        <span>${labels.cash}</span>
        <span>${formatMoney(addDecimal(decimal(result.total), decimal(t.change)), locale)}</span>
      </div>
      <div class="tender-row">
        <span>${labels.change}</span>
        <span>${formatMoney(t.change, locale)}</span>
      </div>
    `;
  }
  return html`
    <div class="tender-row"><span>${labels.card}</span></div>
    ${
      t.reference !== null
        ? html`<div class="tender-row"><span>${labels.reference} ${t.reference}</span></div>`
        : nothing
    }
    ${
      // String compare: the filed `tip`/`charged` are canonical decimal strings ("0.00"/"0.50") — a
      // `decimal(...)` compare here would test object identity and always be true.
      t.tip !== "0.00"
        ? html`
            <div class="tender-row">
              <span>${labels.tip}</span>
              <span>${formatMoney(t.tip, locale)}</span>
            </div>
            <div class="tender-row">
              <span>${labels.charged}</span>
              <span>${formatMoney(t.charged, locale)}</span>
            </div>
          `
        : nothing
    }
  `;
}

/** An A4 printer keeps its A4 words; a receipt printer is named. */
function printLabel(
  print: NonNullable<InvoiceDeliveryStatus["actions"]["print"]>,
  againOnA4: boolean,
): string {
  const printer = print.printers[0]!;
  const copy = print.designation === "duplicate";
  if (printer.kind === "a4")
    return t(
      againOnA4 ? "invoice.send_a4_again" : copy ? "invoice.print_a4_copy" : "invoice.print_a4",
    );
  return t(copy ? "invoice.print_on_copy" : "invoice.print_on").replace(
    "{printer}",
    () => printer.name,
  );
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
        max-width: 22rem;
        margin: 0 auto var(--wt-space-4);
        padding: var(--wt-space-4);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        box-shadow: var(--wt-shadow-1);
        font-variant-numeric: tabular-nums;
      }

      .issuer {
        margin: 0 0 var(--wt-space-3);
        text-align: center;
        overflow-wrap: anywhere;
      }

      .domicile,
      .recipient p {
        margin: var(--wt-space-1) 0 0;
      }

      .recipient {
        margin: 0 0 var(--wt-space-3);
        overflow-wrap: anywhere;
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

      .venue {
        margin: 0;
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }

      .nif {
        margin: var(--wt-space-1) 0 0;
        color: var(--wt-color-text-muted);
      }

      /* Non-fiscal receipt trim (design §8), rendered AROUND the immutable core — never inside it. */
      .header-subtitle,
      .contact,
      .footer-message {
        margin: var(--wt-space-1) 0 0;
        text-align: center;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .footer-message {
        margin-top: var(--wt-space-2);
      }

      .meta,
      .lines {
        margin: 0 0 var(--wt-space-3);
        padding: 0 0 var(--wt-space-3);
        border-bottom: 1px solid var(--wt-color-border);
      }

      .lines {
        list-style: none;
      }

      .meta-row,
      .line,
      .vat-row,
      .total-row,
      .tender-row {
        display: flex;
        justify-content: space-between;
        gap: var(--wt-space-3);
        padding: var(--wt-space-1) 0;
      }

      .meta-label,
      .vat-label,
      .line-qty,
      .tender-row {
        color: var(--wt-color-text-muted);
      }

      .invoice-facts {
        padding-left: var(--wt-space-4);
        font-size: var(--wt-font-size-sm);
        overflow-wrap: anywhere;
      }

      .invoice-facts .vat-row span:last-child {
        text-align: end;
      }

      .line-name {
        flex: 1;
      }

      /* An option, or an amount taken off a dish, is indented beneath the dish as the printed
         receipt indents it. */
      .line.option,
      .line.adjustment {
        padding-left: var(--wt-space-4);
      }

      .line.option,
      .line.adjustment,
      .line.bill-adjustment {
        color: var(--wt-color-text-muted);
      }

      .total-row {
        margin: var(--wt-space-2) 0;
        padding-top: var(--wt-space-2);
        border-top: 1px solid var(--wt-color-border);
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }

      .tender {
        margin-bottom: var(--wt-space-3);
      }

      .qr-block {
        margin: 0 0 var(--wt-space-3);
        padding: 0 0 var(--wt-space-3);
        border-bottom: 1px solid var(--wt-color-border);
      }

      .qr-caption {
        margin: 0 0 var(--wt-space-1);
        text-align: center;
      }

      .qr {
        display: flex;
        justify-content: center;
        margin: 0 0 var(--wt-space-3);
      }

      .qr svg {
        width: 10rem;
        height: 10rem;
      }

      .legend {
        margin: 0;
        text-align: center;
        font-weight: var(--wt-font-weight-bold);
        letter-spacing: 0.1em;
      }

      .new-sale {
        display: block;
        max-width: 22rem;
        margin: 0 auto;
      }

      /* The receipt-hardware actions (reprint the paper, kick the drawer) — a row above New sale, each
         a full-width secondary button on the same 22rem column as the ticket + New sale. */
      .receipt-actions {
        display: flex;
        gap: var(--wt-space-3);
        max-width: 22rem;
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

      .receipt-actions wt-button {
        flex: 1;
      }
    `,
  ];

  /** Set before the element connects. */
  @property({ attribute: false }) result!: TillSaleResult;
  /** Current boot issuer, used when an immediate ticket response has no filed issuer identity. */
  @property({ attribute: false }) issuer!: TicketIssuer;
  /** The receipt language for a result that names none. NEVER the operator-UI `currentLocale()`. */
  @property() invoiceLocale = "es-ES";
  /** True for Demo and Preparation transactions. This warning is outside the fiscal core below. */
  @property({ type: Boolean }) simulated = false;
  @property({ type: Boolean }) historical = false;
  @property({ type: Boolean }) historicalDelivery = false;
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

  #renderDelivery() {
    const status = this.deliveries;
    const words = status?.current ? deliveryWords(status.current) : undefined;
    const busy = this.deliveryBusy || this.originalReceiptBusy;
    const print = this.canPrintReceipt ? status?.actions.print : null;
    const instead = this.canPrintReceipt ? status?.actions.receiptInstead : null;
    const email = this.canPrintReceipt ? status?.actions.email : null;
    const emailAgainId =
      this.canPrintReceipt && status?.actions.retryOriginal?.medium === "email"
        ? status.current?.id
        : null;
    return html`
      ${words === undefined ? nothing : html`<p data-test="delivery-status">${words}</p>`}
      ${
        this.deliveriesReadFailed
          ? html`<p data-test="delivery-read-failed">${t("invoice.delivery_read_failed")}</p>`
          : nothing
      }
      ${
        this.deliveryRefusal
          ? html`<p data-test="delivery-refused">
              ${this.deliveryRefusal.code === undefined ? t("invoice.delivery_error") : codeMessage(this.deliveryRefusal.code)}
            </p>`
          : nothing
      }
      ${
        print
          ? html`<wt-button
              variant="secondary"
              data-test="print-invoice"
              ?disabled=${busy}
              @click=${() => this.dispatchEvent(new CustomEvent("print-invoice", { bubbles: true, composed: true }))}
              >${printLabel(print, status?.actions.retryOriginal?.medium === "a4")}</wt-button
            >`
          : nothing
      }
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
              >${t("invoice.receipt_instead")}</wt-button
            >`
          : nothing
      }
    `;
  }

  override render() {
    const r = this.result;
    const issuer = r.issuer ?? this.issuer;
    const language = r.locale ?? this.invoiceLocale;
    const names = r.namesLocale ?? language;
    const labels = receiptLabelsFor(language);
    // Browsers ship no number or date formats for some receipt languages (Galician and Basque in
    // Chromium 153 and Chrome 154), and would write those amounts the English way.
    const format =
      Intl.NumberFormat.supportedLocalesOf([language]).length > 0
        ? language
        : FALLBACK_RECEIPT_LOCALE;
    const svg = qrSvg(r.qr);
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
    const orderGroup = `${r.orderLabel === null ? "" : `${r.orderLabel} · `}${labels.order} ${r.orderNumber}`;
    return html`
      <article class="ticket" lang=${language}>
        ${
          this.simulated
            ? html`<p class="simulation-notice" data-test="simulation-notice">
                ${labels.practice.replace(" - ", " — ")}
              </p>`
            : nothing
        }
        ${
          svg
            ? html`<div class="qr-block">
                ${r.qrText ? html`<p class="qr-caption">${r.qrText.caption}</p>` : nothing}
                <div class="qr">${unsafeHTML(svg)}</div>
                ${r.qrText ? html`<p class="legend">${r.qrText.legend}</p>` : nothing}
              </div>`
            : nothing
        }
        <header class="issuer">
          ${r.invoiceType === "F1" ? html`<p class="venue">${labels.fullInvoice}</p>` : nothing}
          ${
            r.receiptTrim?.logo
              ? html`<img
                  class="logo"
                  src=${r.receiptTrim.logoUrl ?? `/media/${encodeURIComponent(r.receiptTrim.logo)}`}
                  alt=""
                />`
              : nothing
          }
          ${
            r.receiptHeader?.printTradingName &&
            r.receiptHeader.tradingName.trim() &&
            r.receiptHeader.tradingName.trim() !== issuer.venueName.trim()
              ? html`<p class="venue">${r.receiptHeader.tradingName.trim()}</p>`
              : nothing
          }
          ${
            r.receiptTrim?.headerSubtitle
              ? html`<p class="header-subtitle">${r.receiptTrim.headerSubtitle}</p>`
              : nothing
          }
          <p class="venue">${issuer.venueName}</p>
          ${
            r.receiptSettings.printAddress
              ? r.venueAddress.map((line) => html`<p class="contact">${line}</p>`)
              : nothing
          }
          ${
            r.receiptTrim?.phone
              ? html`<p class="contact">${labels.phone} ${r.receiptTrim.phone}</p>`
              : nothing
          }
          ${r.receiptTrim?.email ? html`<p class="contact">${r.receiptTrim.email}</p>` : nothing}
          <p class="nif">${labels.nif}: ${issuer.nif}</p>
          ${
            r.invoiceType === "F1" && r.issuer?.domicile
              ? html`<p class="domicile">${r.issuer.domicile}</p>`
              : nothing
          }
        </header>

        <div class="meta">
          <div class="meta-row">
            <span class="meta-label">${labels.invoice}</span>
            <span class="invoice-number">${r.invoiceNumber}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">${labels.date}</span>
            <span
              >${issueDate(r.issuedAt, format, r.invoiceType === "F1" ? r.issuedOffsetMinutes : undefined)}</span
            >
          </div>
          ${
            r.invoiceType === "F1" && r.operationDate !== undefined
              ? html`<div class="meta-row" data-test="operation-date">
                  <span class="meta-label">${labels.operationDate}</span>
                  <span
                    >${new Intl.DateTimeFormat(format, {
                      dateStyle: "medium",
                      timeZone: "UTC",
                    }).format(new Date(`${r.operationDate}T00:00:00Z`))}</span
                  >
                </div>`
              : nothing
          }
          <div class="meta-row order-group">
            <span>${orderGroup}</span>
          </div>
        </div>

        ${
          r.invoiceType === "F1" && r.recipient
            ? html`<section class="recipient">
                <p>${r.recipient.legalName}</p>
                <p>${labels.nif}: ${r.recipient.taxId}</p>
                <p>${r.recipient.address}</p>
              </section>`
            : nothing
        }

        <ul class="lines">
          ${groupByParent(r.lines).map(
            // Each line is the FILED composition the server returned, NOT the mutable client basket, so
            // the goods list can never diverge from the invoice.
            (group) => html`
              <li class="line">
                <span class="line-name">${lineName(group.dish.descriptions, names)}</span>
                <span class="line-qty"
                  >${group.dish.quantity}${
                    group.dish.unitName == null
                      ? ""
                      : ` ${resolveSnapshotText(group.dish.unitName, names, names)}`
                  }</span
                >
                ${r.invoiceType === "F1" && group.dish.net !== undefined ? nothing : lineGross(group.dish, format)}
              </li>
              ${r.invoiceType === "F1" ? netFacts(group.dish, names, format, labels) : nothing}
              ${optionAnswers(group.dish.optionSnapshots, { reads: "customer", locale: names }).map((answer) => html`<li class="line option modifier-answer"><span class="line-name">${answer}</span></li>`)}
              ${group.options.map((option) => {
                let amount: string;
                if (r.invoiceType === "F1") {
                  const unit =
                    option.unitName == null
                      ? ""
                      : ` ${resolveSnapshotText(option.unitName, names, names)}`;
                  amount = ` ${option.quantity}${unit}`;
                } else if (option.unitName == null || option.soldInEach === true) {
                  const perDish = perDishOptionQuantity(option.quantity, group.dish.quantity);
                  amount = perDish > 1 ? ` x${perDish}` : "";
                } else {
                  amount = ` ${option.quantity} ${resolveSnapshotText(option.unitName, names, names)}`;
                }
                return html`
                  <li class="line option">
                    <span class="line-name">${lineName(option.descriptions, names)}${amount}</span>
                    ${r.invoiceType === "F1" && option.net !== undefined ? nothing : lineGross(option, format)}
                  </li>
                  ${r.invoiceType === "F1" ? netFacts(option, names, format, labels) : nothing}
                `;
              })}
              ${[group.dish, ...group.options].flatMap((line) =>
                (line.adjustments ?? []).map((adjustment) =>
                  adjustmentRow(adjustment, format, labels, "adjustment", r.invoiceType),
                ),
              )}
            `,
          )}
          ${(r.billAdjustments ?? []).map((adjustment) =>
            adjustmentRow(adjustment, format, labels, "bill-adjustment", r.invoiceType),
          )}
        </ul>

        <div class="vat">
          ${r.vatBreakdown.map(
            (v) => html`
              <div class="vat-row">
                <span class="vat-label">${labels.base} ${v.rate}%</span>
                <span class="vat-amount">${formatMoney(v.base, format)}</span>
              </div>
              <div class="vat-row">
                <span class="vat-label">${labels.vat} ${v.rate}%</span>
                <span class="vat-amount">${formatMoney(v.tax, format)}</span>
              </div>
            `,
          )}
        </div>

        <div class="total-row">
          <span>${labels.total}</span>
          <span>${formatMoney(r.total, format)}</span>
        </div>

        <div class="tender">${renderTender(r, format, labels)}</div>

        ${
          r.receiptTrim?.footerMessage
            ? html`<p class="footer-message">${r.receiptTrim.footerMessage}</p>`
            : nothing
        }
      </article>

      ${
        r.invoiceType === "F1" && (!this.historical || this.historicalDelivery)
          ? html`<section class="original-delivery" data-test="original-delivery" role="status">
              <p>
                <strong
                  >${t(this.originalReceiptPrint?.status !== "not_queued" && this.originalReceiptPrint?.handover ? "invoice.handover_confirmed" : (notQueued && this.deliveries?.originalCompleted) || failedButDelivered ? "invoice.delivered" : "invoice.not_delivered")}</strong
                >
              </p>
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
              ${this.#renderDelivery()}
              ${
                this.originalReceiptPrint?.status === "done" && !this.originalReceiptPrint.handover
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
            </section>`
          : nothing
      }
      ${
        r.invoiceType === "F1" && this.emailOpen && this.canPrintReceipt
          ? html`<till-invoice-email-dialog
              .copy=${this.deliveries?.actions.email?.designation === "duplicate"}
              .busy=${this.deliveryBusy}
              .refusal=${this.emailRefusal}
            ></till-invoice-email-dialog>`
          : nothing
      }

      <div class="receipt-actions">
        ${
          this.historical && this.refundable
            ? html`<wt-button
                data-tender-refund
                variant="secondary"
                @click=${() => this.dispatchEvent(new CustomEvent("tender-refund-open", { bubbles: true, composed: true }))}
                >${t("tender_refund.title")}</wt-button
              >`
            : nothing
        }
        ${
          this.canPrintReceipt
            ? this.historical && !this.historicalDelivery
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
          !this.historical && this.canPrintReceipt && r.tender.method === "card"
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
        ${
          !this.historical && this.canOpenDrawer
            ? html`<wt-button
                class="open-drawer"
                variant="secondary"
                size="lg"
                data-test="open-drawer"
                @click=${() => this.#openDrawer()}
              >
                ${t("action.open_drawer")}
              </wt-button>`
            : nothing
        }
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
