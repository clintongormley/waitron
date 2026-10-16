import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { addDecimal, decimal, formatMoney } from "@waitron/shared";
import type { TenderRefundAcknowledgment } from "../api/tender-refund-types.js";
import type { StringKey } from "../i18n/strings.js";
import { currentLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import "@waitron/ui/src/components/wt-button.js";

@customElement("till-refund-acknowledgment")
export class TillRefundAcknowledgment extends LitElement {
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
        max-width: var(--wt-form-max-width);
        padding: var(--wt-space-4);
        background: var(--wt-color-surface);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        overflow-wrap: anywhere;
      }
      h1 {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-xl);
      }
      p {
        margin: var(--wt-space-2) 0;
      }
      dl {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: var(--wt-space-3);
        font-variant-numeric: tabular-nums;
      }
      dt,
      dd {
        margin: 0;
      }
      dd {
        text-align: end;
      }
      .total {
        font-weight: var(--wt-font-weight-bold);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        margin-block: var(--wt-space-4);
      }
    `,
  ];
  @property({ attribute: false }) acknowledgment!: TenderRefundAcknowledgment;
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) canPrint = false;

  #emit(name: string): void {
    this.dispatchEvent(new CustomEvent(name, { detail: {}, bubbles: true, composed: true }));
  }
  override render() {
    const a = this.acknowledgment,
      r = a.refund;
    const completed = r.state === "completed" && r.completedAt !== null;
    const money = (value: string) => formatMoney(value, currentLocale());
    return html`
      ${
        completed
          ? html`<article>
              <h1>${t("refund_ack.title")}</h1>
              <p>${a.issuer.venueName}</p>
              <p>${a.issuer.nif}</p>
              ${a.issuer.domicile ? html`<p>${a.issuer.domicile}</p>` : nothing}
              ${a.customerName ? html`<p>${a.customerName}</p>` : nothing}
              <dl>
                <dt>${t("refund_ack.reference")}</dt>
                <dd>${r.id}</dd>
                <dt>${t("refund_ack.invoice")}</dt>
                <dd>${a.invoiceNumber}</dd>
                <dt>${t("refund_ack.date")}</dt>
                <dd>
                  <time datetime=${r.completedAt!}
                    >${new Date(r.completedAt!).toLocaleString(currentLocale(), { timeZone: "UTC" })}
                    UTC</time
                  >
                </dd>
                <dt>${t("tender_refund.choose")}</dt>
                <dd>${t(`find_page.${a.method}` as StringKey)}${a.last4 ? ` · ${a.last4}` : ""}</dd>
                <dt>${t("refund_ack.applied")}</dt>
                <dd data-applied>${money(r.appliedAmount)}</dd>
                <dt>${t("refund_ack.tip")}</dt>
                <dd data-tip>${money(r.tipAmount)}</dd>
                <dt class="total">${t("refund_ack.total")}</dt>
                <dd class="total" data-total>
                  ${money(addDecimal(decimal(r.appliedAmount), decimal(r.tipAmount)))}
                </dd>
              </dl>
              <p>${t("tender_refund.completed")}</p>
            </article>`
          : html`<p role="status">
              ${t(r.state === "failed" ? "tender_refund.failed" : "tender_refund.pending")}
            </p>`
      }
      <div class="actions">
        ${
          completed && this.canPrint
            ? html`<wt-button
                data-refund-reprint
                variant="secondary"
                ?disabled=${this.busy}
                @click=${() => {
                  if (!this.busy) this.#emit("reprint");
                }}
                >${t("action.reprint")}</wt-button
              >`
            : nothing
        }
        <wt-button
          data-refund-original
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => {
            if (!this.busy) this.#emit("refund-original");
          }}
          >${t("refund_ack.original")}</wt-button
        >
        <wt-button
          data-back-to-find-bill
          variant="secondary"
          @click=${() => this.#emit("back-to-find-bill")}
          >${t("find_bill.back")}</wt-button
        >
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-refund-acknowledgment": TillRefundAcknowledgment;
  }
}
