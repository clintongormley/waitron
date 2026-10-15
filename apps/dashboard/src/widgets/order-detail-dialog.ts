import { staffPresentationName } from "@waitron/catalogue/src/product-presentation.js";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, formatDecimalInput } from "@waitron/ui";
import { compareDecimal, decimal, formatMoney, multiplyDecimal, toScale } from "@waitron/shared";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "./invoice-email-dialog.js";
import type { InvoiceEmailDialog } from "./invoice-email-dialog.js";
import { DashboardQueries } from "../api/query-controller.js";
import type {
  DashboardApi,
  OrderDeliveries,
  OrderDeliveryAttempt,
  OrderDetailDto,
  OrderRowDto,
} from "../api/client.js";
import { holdReason } from "../i18n/a4-holds.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";

const money = (value: string) => formatMoney(value, currentLocale());
const quantity = (value: string) =>
  formatDecimalInput(value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""), currentLocale());
const date = (value: string) =>
  new Intl.DateTimeFormat(currentLocale(), { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
const differsFromListPrice = (line: OrderDetailDto["lines"][number]) =>
  line.listUnitPrice !== null &&
  compareDecimal(
    toScale(multiplyDecimal(decimal(line.listUnitPrice), decimal(line.quantity)), 2),
    decimal(line.total),
  ) !== 0;
const PAYMENT_STATES: Record<string, StringKey> = {
  pending: "orders.detail.payment_state_pending",
  received: "orders.detail.payment_state_received",
  failed: "orders.detail.payment_state_failed",
  declined: "orders.detail.payment_state_declined",
};
const REFUND_STATES: Record<string, StringKey> = {
  pending: "orders.detail.refund_state_pending",
  completed: "orders.detail.refund_state_completed",
  failed: "orders.detail.refund_state_failed",
};
const stateLabel = (state: string, names: Record<string, StringKey>) =>
  names[state] === undefined ? state : t(names[state]);

const DELIVERY_REREAD_MS = 5_000;

function deliveryWords(attempt: OrderDeliveryAttempt | null): string {
  if (attempt === null) return t("orders.detail.delivery_none");
  const hold = attempt.printerHold;
  switch (attempt.status) {
    case "queued":
      return t(
        attempt.medium === "a4"
          ? "orders.detail.delivery_waiting_office"
          : attempt.medium === "receipt"
            ? "orders.detail.delivery_waiting_receipt"
            : "orders.detail.delivery_sending",
      );
    case "sending": {
      if (hold === null) return t("orders.detail.delivery_sending");
      const reason = holdReason(hold);
      return reason === undefined
        ? t("orders.detail.delivery_held_no_reason")
        : fill("orders.detail.delivery_held", { reason });
    }
    case "sent":
      return t(`orders.detail.delivery_sent_${attempt.medium}`);
    case "failed":
      return t("orders.detail.delivery_failed");
    case "unknown":
      return t(
        hold === null ? "orders.detail.delivery_unknown" : "orders.detail.delivery_unknown_held",
      );
  }
}

function attemptLine(attempt: OrderDeliveryAttempt): string {
  const parts = [
    date(attempt.requestedAt),
    t(`orders.detail.medium_${attempt.medium}`),
    t(`orders.detail.designation_${attempt.designation}`),
    t(
      attempt.status === "sending" && attempt.printerHold !== null
        ? "orders.detail.outcome_held"
        : `orders.detail.outcome_${attempt.status}`,
    ),
  ];
  if (attempt.personId !== null)
    parts.push(
      fill("orders.detail.requested_by", {
        name: attempt.personName ?? t("orders.staff_unknown"),
      }),
    );
  return parts.join(" · ");
}

/** Newest first, as the server lists attempts. At one time an attempt comes before a download, and
 * each list keeps the order the server sent it in. */
function historyLines(
  history: OrderDeliveryAttempt[],
  downloads: OrderDetailDto["invoicePdfDownloads"],
): string[] {
  return [
    ...history.map((attempt) => ({
      at: Date.parse(attempt.requestedAt),
      line: attemptLine(attempt),
    })),
    ...downloads.map((download) => ({
      at: Date.parse(download.requestedAt),
      line: fill("orders.detail.pdf_line", {
        date: date(download.requestedAt),
        name: download.personName ?? t("orders.staff_unknown"),
      }),
    })),
  ]
    .sort((a, b) => b.at - a.at)
    .map((entry) => entry.line);
}

function emailLabel(status: OrderDeliveries): StringKey {
  if (status.actions.retryOriginal?.medium === "email") return "orders.email_other";
  return status.actions.email?.designation === "duplicate" ? "orders.email_copy" : "orders.email";
}

/** The name `readInvoiceForDownload` gives the file (`apps/server/src/orders-invoice-pdf.ts`). */
function pdfFileName(invoiceNumber: string): string {
  const cut = invoiceNumber.lastIndexOf("/");
  const series = invoiceNumber.slice(0, cut).replace(/[^A-Za-z0-9_.-]/g, "_");
  return `${series}-${invoiceNumber.slice(cut + 1)}.pdf`;
}

function without(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const rest = new Set(ids);
  rest.delete(id);
  return rest;
}

@customElement("dashboard-order-detail-dialog")
export class OrderDetailDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      section {
        margin-block: var(--wt-space-4);
      }
      h3 {
        font-size: var(--wt-font-size-md);
        margin: 0 0 var(--wt-space-2);
      }
      ul {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      li {
        margin-block: var(--wt-space-2);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) orderId: string | null = null;
  @property({ attribute: false }) mayReprint: (row: OrderRowDto) => boolean = () => false;
  /** The session holds `report.export`, which the PDF download and email need. */
  @property({ attribute: false }) mayExport = false;
  @state() private detail: OrderDetailDto | null = null;
  @state() private error: string | null = null;
  @state() private refusal: string | null = null;
  /** The bills whose Download PDF request is still out. */
  @state() private downloadBusy: ReadonlySet<string> = new Set();
  @state() private emailAgainBusy: ReadonlySet<string> = new Set();
  #reread?: ReturnType<typeof setInterval>;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.error = codeMessage(codeOf(error));
    },
    (error) => {
      if (this.error === codeMessage(codeOf(error))) this.error = null;
    },
  );

  override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("orderId")) return;
    this.detail = null;
    this.error = null;
    this.refusal = null;
    this.#emailDialog()?.dismiss();
    this.#syncReread();
    if (this.orderId === null) this.#queries.release("getOrder");
    else
      void this.#queries
        .watch("getOrder", [this.orderId], (detail) => {
          this.detail = detail;
          this.#syncReread();
        })
        .catch(() => undefined);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearInterval(this.#reread);
    this.#reread = undefined;
  }

  #syncReread(): void {
    const status = this.detail?.deliveries?.current?.status;
    if (status !== "queued" && status !== "sending") {
      clearInterval(this.#reread);
      this.#reread = undefined;
      return;
    }
    this.#reread ??= setInterval(() => this.#readDeliveries(), DELIVERY_REREAD_MS);
  }

  #readDeliveries(): void {
    this.api.liveData.invalidate([{ type: "invoice_deliveries" }]);
  }

  #busy(ids: ReadonlySet<string>): boolean {
    return this.orderId !== null && ids.has(this.orderId);
  }

  async #emailAgain(deliveryId: string): Promise<void> {
    const id = this.orderId;
    if (id === null || this.emailAgainBusy.has(id)) return;
    this.emailAgainBusy = new Set(this.emailAgainBusy).add(id);
    this.refusal = null;
    try {
      await this.api.retryOrderEmailDelivery(id, deliveryId, crypto.randomUUID());
    } catch (error) {
      if (this.orderId === id) this.refusal = codeMessage(codeOf(error));
    } finally {
      this.emailAgainBusy = without(this.emailAgainBusy, id);
      this.#readDeliveries();
    }
  }

  #emailDialog(): InvoiceEmailDialog | null {
    return this.renderRoot?.querySelector("dashboard-invoice-email-dialog") ?? null;
  }

  async #downloadPdf(invoiceNumber: string): Promise<void> {
    const id = this.orderId;
    if (id === null || this.downloadBusy.has(id)) return;
    this.downloadBusy = new Set(this.downloadBusy).add(id);
    this.refusal = null;
    try {
      const file = await this.api.downloadOrderInvoicePdf(id);
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = pdfFileName(invoiceNumber);
      link.click();
      URL.revokeObjectURL(url);
      this.api.liveData.invalidate([{ type: "invoice_pdf_downloads" }]);
    } catch (error) {
      if (this.orderId === id) this.refusal = codeMessage(codeOf(error));
    } finally {
      this.downloadBusy = without(this.downloadBusy, id);
    }
  }

  #ask(name: "order-reprint" | "order-invoice-print"): void {
    if (this.orderId === null) return;
    this.dispatchEvent(
      new CustomEvent(name, {
        detail: { id: this.orderId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #renderDeliveries(status: OrderDeliveries, downloads: OrderDetailDto["invoicePdfDownloads"]) {
    return html`<section>
      <h3>${t("orders.detail.delivery")}</h3>
      <p data-test="delivery-status">${deliveryWords(status.current)}</p>
      ${
        status.history.length + downloads.length > 0
          ? html`<ul data-test="delivery-history">
              ${historyLines(status.history, downloads).map((line) => html`<li>${line}</li>`)}
            </ul>`
          : nothing
      }
    </section>`;
  }

  #renderActions(detail: OrderDetailDto) {
    const status = detail.deliveries;
    const invoiceNumber = detail.row.invoiceNumber;
    const delivery = !!status && invoiceNumber !== null;
    const retryId = status?.actions.retryOriginal?.medium === "email" ? status.current?.id : null;
    const buttons = [
      delivery && status.actions.print
        ? html`<wt-button
            variant="secondary"
            data-test="print-invoice"
            @click=${() => this.#ask("order-invoice-print")}
            >${t(
              status.actions.print.designation === "duplicate"
                ? "orders.print_invoice_copy"
                : "orders.print_invoice",
            )}</wt-button
          >`
        : null,
      delivery && this.mayExport && retryId
        ? html`<wt-button
            variant="secondary"
            data-test="email-again"
            ?loading=${this.#busy(this.emailAgainBusy)}
            @click=${() => void this.#emailAgain(retryId)}
            >${t("orders.email_again")}</wt-button
          >`
        : null,
      delivery && this.mayExport && status.actions.email
        ? html`<wt-button
            variant="secondary"
            data-test="email-invoice"
            @click=${() =>
              this.#emailDialog()?.show(
                this.orderId!,
                status.actions.email?.designation === "duplicate",
              )}
            >${t(emailLabel(status))}</wt-button
          >`
        : null,
      delivery && this.mayExport
        ? html`<wt-button
            variant="secondary"
            data-test="download-pdf"
            ?loading=${this.#busy(this.downloadBusy)}
            @click=${() => void this.#downloadPdf(invoiceNumber)}
            >${t("orders.download_pdf")}</wt-button
          >`
        : null,
      this.mayReprint(detail.row)
        ? html`<wt-button variant="secondary" @click=${() => this.#ask("order-reprint")}
            >${t("orders.reprint")}</wt-button
          >`
        : null,
    ].filter((button) => button !== null);
    return buttons.length === 0
      ? nothing
      : html`<wt-form-actions slot="footer">${buttons}</wt-form-actions>`;
  }

  override render() {
    const detail = this.detail;
    return html`<wt-dialog .open=${this.orderId !== null} heading=${t("orders.view")}>
        ${this.error ? html`<p role="alert" data-test="read-failed">${this.error}</p>` : nothing}
        ${
          detail
            ? html`
                <section>
                  <h3>${t("orders.detail.lines")}</h3>
                  <ul>
                    ${detail.lines.map((line) => html`<li>${staffPresentationName(line)} × ${quantity(line.quantity)} — ${money(line.total)}${differsFromListPrice(line) ? html` (${fill("orders.detail.was", { price: money(line.listUnitPrice!) })})` : nothing}${line.creditedTo === null ? nothing : html` · ${fill("orders.detail.served_by", { name: line.creditedTo })}`}</li>`)}
                  </ul>
                </section>
                <section>
                  <h3>${t("orders.detail.invoices")}</h3>
                  <ul>
                    ${detail.invoices.map(
                      (invoice) =>
                        html`<li>
                          ${invoice.kind === "credit_note" ? t("orders.detail.credit_note") : invoice.kind === "substitution" ? t("orders.detail.substitution") : invoice.invoiceType === "F1" ? t("orders.invoice_full") : t("orders.col.invoice")}
                          ${invoice.number} · ${date(invoice.issuedAt)} ·
                          ${money(invoice.total)}${invoice.rungBy === null ? nothing : html` · ${fill("orders.detail.rung_by", { name: invoice.rungBy })}`}${
                            invoice.invoiceType === "F1" && invoice.taxpayerDomicile !== undefined
                              ? html`<div>
                                  ${t("orders.detail.issuer_address")}: ${invoice.taxpayerDomicile}
                                </div>`
                              : nothing
                          }${
                            invoice.recipient === undefined
                              ? nothing
                              : html`<div>
                                    ${t("orders.detail.customer")}: ${invoice.recipient.legalName} ·
                                    ${invoice.recipient.taxId}
                                  </div>
                                  <div>${invoice.recipient.address}</div>`
                          }
                        </li>`,
                    )}
                  </ul>
                </section>
                <section>
                  <h3>${t("orders.detail.payments")}</h3>
                  <ul>
                    ${detail.tenders.map((tender) => html`<li>${tender.method === "cash" ? t("orders.detail.cash") : t("orders.detail.card")} ${money(tender.amount)} · ${fill("orders.detail.tip", { amount: money(tender.tip) })}</li>`)}${detail.payments.map((payment) => html`<li>${payment.method === "cash" ? t("orders.detail.cash") : t("orders.detail.card")} ${money(payment.applied)} · ${stateLabel(payment.state, PAYMENT_STATES)} · ${t("orders.detail.before_invoice")} · ${date(payment.createdAt)}${payment.refunds.map((refund) => html`<div>${fill("orders.detail.refund", { amount: money(refund.applied) })} · ${stateLabel(refund.state, REFUND_STATES)} · ${refund.reason}</div>`)}</li>`)}
                  </ul>
                </section>
                ${
                  detail.party
                    ? html`<section>
                        <h3>${t("orders.detail.party")}</h3>
                        <p>
                          ${detail.party.name ?? t("orders.detail.unnamed_party")}${detail.party.tables.length ? html` · ${detail.party.tables.join(", ")}` : nothing}${detail.party.guestCount === null ? nothing : html` · ${fill("orders.detail.guests", { count: String(detail.party.guestCount) })}`}
                        </p>
                        <p>
                          ${fill("orders.detail.opened_closed", { opened: date(detail.party.openedAt), by: detail.party.openedBy ?? t("orders.staff_unknown"), closed: detail.party.closedAt === null ? "—" : date(detail.party.closedAt) })}${detail.party.closedAt === null ? nothing : fill("orders.detail.closed_by", { name: detail.party.closedBy ?? t("orders.staff_unknown") })}
                        </p>
                      </section>`
                    : nothing
                }
                ${
                  detail.departure
                    ? html`<section>
                        <h3>${t("orders.detail.departure")}</h3>
                        <p>
                          ${fill("orders.detail.departure_line", { date: date(detail.departure.recordedAt), reason: detail.departure.reason, recorder: detail.departure.recordedBy ?? t("orders.staff_unknown"), approver: detail.departure.authorizedBy ?? t("orders.staff_unknown"), amount: money(detail.departure.amount) })}
                        </p>
                      </section>`
                    : nothing
                }
                ${
                  detail.reprints.length > 0
                    ? html`<section>
                        <h3>${t("orders.detail.copies")}</h3>
                        <ul>
                          ${detail.reprints.map((copy) => html`<li>${fill("orders.detail.copy_line", { date: date(copy.requestedAt), name: copy.personName ?? t("orders.staff_unknown"), printer: copy.printerName })}</li>`)}
                        </ul>
                      </section>`
                    : nothing
                }
                ${detail.deliveries ? this.#renderDeliveries(detail.deliveries, detail.invoicePdfDownloads) : nothing}
                ${this.refusal === null ? nothing : html`<p role="alert" data-test="delivery-refused">${this.refusal}</p>`}
                ${this.#renderActions(detail)}
              `
            : nothing
        } </wt-dialog
      >${
        this.mayExport
          ? html`<dashboard-invoice-email-dialog
              .api=${this.api}
              @invoice-email-requested=${() => this.#readDeliveries()}
            ></dashboard-invoice-email-dialog>`
          : nothing
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-order-detail-dialog": OrderDetailDialog;
  }
}
