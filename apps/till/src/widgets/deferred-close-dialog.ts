import { helpAnchorStyles, helpBadge } from "./help-badge.js";
import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { formatMoney } from "@waitron/shared";
import { baseStyles, type WtDialog } from "@waitron/ui";
import "@waitron/ui/src/components/wt-form-actions.js";
import { trackDialog } from "./track-dialog.js";
import { currentLocale, t } from "../i18n/t.js";

/** What the window shows of the bill it closes. */
export interface DeferredCloseBill {
  label: string;
  total: string;
  /** The full invoice's customer; null for a simplified invoice. */
  customer: { legalName: string; taxId: string } | null;
  /** The bill already has an invoice number, so closing issues none. */
  issued: boolean;
}

/**
 * Asks before a whole bill is closed as a deferred payment. It only asks: `deferred-close-confirm`
 * and `deferred-close-cancel` go to the app, which answers with {@link busy} and {@link refusal}.
 * The app cancels a `deferred-close-confirm` only when it refuses at once for unsent dishes, before
 * going busy, so the next one goes; any later answer re-arms Confirm through `busy` or `refusal`.
 */
@customElement("till-deferred-close-dialog")
export class TillDeferredCloseDialog extends LitElement {
  static override styles = [
    baseStyles,
    helpAnchorStyles,
    css`
      .body {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
      }

      p {
        margin: 0;
      }

      .summary {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        margin: 0;
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }

      .summary dt {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .summary dd {
        margin: 0;
        overflow-wrap: anywhere;
      }

      .total {
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) bill: DeferredCloseBill | null = null;
  @property({ type: Boolean }) busy = false;
  /** Why the last close was refused, shown above the buttons; empty for none. */
  @property() refusal = "";

  /** A confirm has been sent and not yet answered: the app's `busy` may not have arrived yet. */
  #sent = false;

  override willUpdate(changed: PropertyValues<this>): void {
    const answered = changed.has("busy") && !this.busy && changed.get("busy") === true;
    if (answered || changed.has("refusal") || (changed.has("open") && this.open))
      this.#sent = false;
  }

  /** False when a listener cancelled the event. */
  #emit(type: string, cancelable = false): boolean {
    return this.dispatchEvent(
      new CustomEvent(type, { detail: {}, bubbles: true, composed: true, cancelable }),
    );
  }

  #confirm(): void {
    if (!this.open || this.busy || this.#sent || this.bill === null) return;
    this.#sent = true;
    if (!this.#emit("deferred-close-confirm", true)) this.#sent = false;
  }

  #close(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || this.busy) return;
    this.#emit("deferred-close-cancel");
  }

  #requestClose(): void {
    if (this.busy) return;
    void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("navigation");
  }

  override render() {
    const bill = this.bill;
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.open && bill !== null}
      .heading=${t("deferred_close.title")}
      .dismissible=${!this.busy}
      @wt-close=${(event: Event) => this.#close(event)}
    >
      <div class="body">
        ${
          bill === null
            ? ""
            : html`<dl class="summary" data-deferred-close-summary>
                <dt>${t("deferred_close.bill")}</dt>
                <dd>${bill.label}</dd>
                <dt>${t("deferred_close.invoice")}</dt>
                <dd>
                  ${
                    bill.customer === null
                      ? t("deferred_close.simplified")
                      : `${t("invoice.full")}: ${bill.customer.legalName} · ${bill.customer.taxId}`
                  }
                </dd>
                <dt>${t("label.total")}</dt>
                <dd class="total" data-deferred-close-total>
                  ${formatMoney(bill.total, currentLocale())}
                </dd>
              </dl>`
        }
        <p class="help-anchor">
          <span data-deferred-close-sentence>${t("deferred_close.final")}</span>${helpBadge(
            "help.deferred_close",
            t("deferred_close.title"),
            {
              guide: "table-service.deferred-payment",
            },
          )}
        </p>
      </div>
      <wt-form-actions slot="footer" .error=${this.refusal}>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-deferred-close-cancel
          .disabled=${this.busy}
          @click=${() => this.#requestClose()}
        >
          ${t("action.cancel")}
        </wt-button>
        <wt-button
          variant="primary"
          data-deferred-close-confirm
          .loading=${this.busy}
          .disabled=${this.busy}
          @click=${() => this.#confirm()}
        >
          ${t(bill?.issued === true ? "deferred_close.close" : "deferred_close.issue_and_close")}
        </wt-button>
      </wt-form-actions>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-deferred-close-dialog": TillDeferredCloseDialog;
  }
}
