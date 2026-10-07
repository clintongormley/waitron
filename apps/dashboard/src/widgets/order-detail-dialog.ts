import { staffPresentationName } from "@waitron/catalogue/src/product-presentation.js";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { compareDecimal, decimal, formatMoney, multiplyDecimal, toScale } from "@waitron/shared";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import { DashboardQueries } from "../api/query-controller.js";
import type { DashboardApi, OrderDetailDto, OrderRowDto } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { currentLocale, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";

const money = (value: string) => formatMoney(value, currentLocale());
const date = (value: string) =>
  new Intl.DateTimeFormat(currentLocale(), { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
const fill = (template: string, values: Record<string, string>) =>
  Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, () => value),
    template,
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
  @state() private detail: OrderDetailDto | null = null;
  @state() private error: string | null = null;
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
    if (this.orderId === null) this.#queries.release("getOrder");
    else
      void this.#queries
        .watch("getOrder", [this.orderId], (detail) => {
          this.detail = detail;
        })
        .catch(() => undefined);
  }

  #reprint(): void {
    if (this.orderId === null) return;
    this.dispatchEvent(
      new CustomEvent("order-reprint", {
        detail: { id: this.orderId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    const detail = this.detail;
    return html`<wt-dialog .open=${this.orderId !== null} heading=${t("orders.view")}>
      ${this.error ? html`<p role="alert">${this.error}</p>` : nothing}
      ${
        detail
          ? html`
              <section>
                <h3>${t("orders.detail.lines")}</h3>
                <ul>
                  ${detail.lines.map((line) => html`<li>${staffPresentationName(line)} × ${line.quantity} — ${money(line.total)}${differsFromListPrice(line) ? html` (${fill(t("orders.detail.was"), { price: money(line.listUnitPrice!) })})` : nothing}${line.creditedTo === null ? nothing : html` · ${fill(t("orders.detail.served_by"), { name: line.creditedTo })}`}</li>`)}
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
                        ${money(invoice.total)}${invoice.rungBy === null ? nothing : html` · ${fill(t("orders.detail.rung_by"), { name: invoice.rungBy })}`}${
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
                  ${detail.tenders.map((tender) => html`<li>${tender.method === "cash" ? t("orders.detail.cash") : t("orders.detail.card")} ${money(tender.amount)} · ${fill(t("orders.detail.tip"), { amount: money(tender.tip) })}</li>`)}${detail.payments.map((payment) => html`<li>${payment.method === "cash" ? t("orders.detail.cash") : t("orders.detail.card")} ${money(payment.applied)} · ${stateLabel(payment.state, PAYMENT_STATES)} · ${t("orders.detail.before_invoice")} · ${date(payment.createdAt)}${payment.refunds.map((refund) => html`<div>${fill(t("orders.detail.refund"), { amount: money(refund.applied) })} · ${stateLabel(refund.state, REFUND_STATES)} · ${refund.reason}</div>`)}</li>`)}
                </ul>
              </section>
              ${
                detail.party
                  ? html`<section>
                      <h3>${t("orders.detail.party")}</h3>
                      <p>
                        ${detail.party.name ?? t("orders.detail.unnamed_party")}${detail.party.tables.length ? html` · ${detail.party.tables.join(", ")}` : nothing}${detail.party.guestCount === null ? nothing : html` · ${fill(t("orders.detail.guests"), { count: String(detail.party.guestCount) })}`}
                      </p>
                      <p>
                        ${fill(t("orders.detail.opened_closed"), { opened: date(detail.party.openedAt), by: detail.party.openedBy ?? t("orders.staff_unknown"), closed: detail.party.closedAt === null ? "—" : date(detail.party.closedAt) })}${detail.party.closedAt === null ? nothing : fill(t("orders.detail.closed_by"), { name: detail.party.closedBy ?? t("orders.staff_unknown") })}
                      </p>
                    </section>`
                  : nothing
              }
              ${
                detail.departure
                  ? html`<section>
                      <h3>${t("orders.detail.departure")}</h3>
                      <p>
                        ${fill(t("orders.detail.departure_line"), { date: date(detail.departure.recordedAt), reason: detail.departure.reason, recorder: detail.departure.recordedBy ?? t("orders.staff_unknown"), approver: detail.departure.authorizedBy ?? t("orders.staff_unknown"), amount: money(detail.departure.amount) })}
                      </p>
                    </section>`
                  : nothing
              }
              ${
                detail.reprints.length > 0
                  ? html`<section>
                      <h3>${t("orders.detail.copies")}</h3>
                      <ul>
                        ${detail.reprints.map((copy) => html`<li>${fill(t("orders.detail.copy_line"), { date: date(copy.requestedAt), name: copy.personName ?? t("orders.staff_unknown"), printer: copy.printerName })}</li>`)}
                      </ul>
                    </section>`
                  : nothing
              }
              ${this.mayReprint(detail.row) ? html`<wt-button slot="footer" variant="secondary" @click=${() => this.#reprint()}>${t("orders.reprint")}</wt-button>` : nothing}
            `
          : nothing
      }
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-order-detail-dialog": OrderDetailDialog;
  }
}
