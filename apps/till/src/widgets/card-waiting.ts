import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-spinner.js";
import { formatMoney } from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";
import { payNotice, type PayNotice } from "./pay-equipment.js";

/** A card payment a pay sheet sent to a reader: the reader, the amount, and when. The phone's
 * reader may change meanwhile; this one does not. */
export interface SentCard {
  readerName: string;
  amount: string;
  at: number;
}

export function sentCard(reader: { name: string }, amount: string): SentCard {
  return { readerName: reader.name, amount, at: Date.now() };
}

/** What a pay sheet shows in place of its body while `sent` is at the reader: the panel, and
 * under it a tap's notice, which has nowhere else to show while the sheet is open. */
export function cardWaitingView(sent: SentCard, notice: PayNotice | null): TemplateResult {
  return html`<till-card-waiting
      .amount=${formatMoney(sent.amount, currentLocale())}
      .reader=${sent.readerName}
      .since=${sent.at}
    ></till-card-waiting
    >${payNotice(notice)}`;
}

/** `m:ss` for a count of whole seconds. */
function elapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * What a handheld's pay sheet shows while a card is at the reader: the card, `amount` on `reader`,
 * and how long it has waited since `since`. Its clock redraws only this element, every second
 * while it is in the page.
 */
@customElement("till-card-waiting")
export class TillCardWaiting extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .panel {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--wt-space-2);
        padding: var(--wt-space-5) var(--wt-space-3);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface-sunken);
        text-align: center;
        overflow-wrap: anywhere;
      }

      wt-spinner {
        width: var(--wt-space-6);
        height: var(--wt-space-6);
        color: var(--wt-color-primary);
      }

      .lead {
        font-size: var(--wt-font-size-xl);
        font-weight: var(--wt-font-weight-bold);
      }

      .on {
        font-size: var(--wt-font-size-lg);
      }

      .on b {
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];

  /** The amount sent, already formatted. */
  @property() amount = "";
  /** The name of the reader the payment was sent to. */
  @property() reader = "";
  /** When the payment was sent, in epoch milliseconds. */
  @property({ type: Number }) since = 0;

  #clock?: ReturnType<typeof setInterval>;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#clock = setInterval(() => this.requestUpdate(), 1000);
  }

  override disconnectedCallback(): void {
    clearInterval(this.#clock);
    this.#clock = undefined;
    super.disconnectedCallback();
  }

  #on(): TemplateResult[] {
    return t("bill_pay.waiting_on")
      .split(/(\{amount\}|\{reader\})/)
      .map((part) =>
        part === "{amount}"
          ? html`<b>${this.amount}</b>`
          : part === "{reader}"
            ? html`<b>${this.reader}</b>`
            : html`${part}`,
      );
  }

  override render() {
    const seconds = Math.max(0, Math.floor((Date.now() - this.since) / 1000));
    return html`<div class="panel" data-pay-waiting>
      <wt-spinner decorative></wt-spinner>
      <div role="status">
        <p class="lead" data-pay-collecting>${t("card.collecting")}</p>
        <p class="on" data-pay-waiting-on>${this.#on()}</p>
      </div>
      <p data-pay-waiting-since>
        ${t("bill_pay.waiting_since").replace("{time}", () => elapsed(seconds))}
      </p>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-card-waiting": TillCardWaiting;
  }
}
