import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-button.js";
import { t } from "../i18n/t.js";
import { regimeName } from "../i18n/domain.js";
import type { PurchaseInvoice } from "../api/client.js";

/**
 * The management dashboard's PURCHASE LIST: one `wt-card` row per received supplier invoice (factura
 * recibida) showing the supplier name, the supplier's invoice number, the received date (which drives
 * the deduction period), the gross total and a localised regime badge. Per row: an Edit control that
 * emits `edit-purchase { id }` and a Delete control that emits `delete-purchase { id }`.
 *
 * It is a PURE DISPLAY widget — it holds no state and never talks to the API (like `product-list`). The
 * purchases screen owns the list (`DashboardApi.listPurchaseInvoices`) and hands it down as `invoices`;
 * the two controls emit composed, bubbling events carrying only the `id`, which the screen turns into an
 * edit or delete flow. The regime renders through the i18n layer at the render edge
 * (`regimeName`) — the raw token is never shown; `data-regime` keeps the raw token for tests.
 */
@customElement("dashboard-purchase-list")
export class PurchaseList extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .list {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }
      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
      }
      .details {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        min-width: 0;
      }
      .supplier {
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text);
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 0 var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-sm);
      }
      .controls {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
      }
    `,
  ];

  /** The invoices to list, straight from `DashboardApi.listPurchaseInvoices`. The screen owns and
   * refreshes it; defaults to empty so the widget renders safely before the screen assigns the list. */
  @property({ attribute: false }) invoices: PurchaseInvoice[] = [];

  /** Ask the screen to edit/delete `id`. `stopPropagation` keeps the button's own composed `click`
   * inside this widget's shadow boundary; the semantic event is dispatched bubbles+composed so it
   * crosses to the screen (the house pattern — `product-list` stops its composed events the same way). */
  #emit(event: Event, name: "edit-purchase" | "delete-purchase", id: string): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<{ id: string }>(name, { detail: { id }, bubbles: true, composed: true }),
    );
  }

  override render() {
    const editLabel = t("action.edit"); // locale-invariant across rows — resolve once per render
    const deleteLabel = t("purchase.delete");
    return html`
      <div class="list">
        ${this.invoices.map(
          (inv) => html`
            <wt-card data-test="row">
              <div class="row">
                <div class="details">
                  <span class="supplier">${inv.supplierName}</span>
                  <span class="meta">
                    <span class="number">${inv.supplierInvoiceNumber}</span>
                    <span class="received">${inv.receivedOn}</span>
                    <span class="total">${inv.total}</span>
                    <span class="badge" data-test="regime" data-regime=${inv.regime}
                      >${regimeName(inv.regime)}</span
                    >
                  </span>
                </div>
                <div class="controls">
                  <wt-button
                    variant="ghost"
                    data-test=${`edit-${inv.id}`}
                    aria-label=${`${editLabel} ${inv.supplierInvoiceNumber}`}
                    @click=${(e: Event) => this.#emit(e, "edit-purchase", inv.id)}
                    >${editLabel}</wt-button
                  >
                  <wt-button
                    variant="danger"
                    data-test=${`delete-${inv.id}`}
                    aria-label=${`${deleteLabel} ${inv.supplierInvoiceNumber}`}
                    @click=${(e: Event) => this.#emit(e, "delete-purchase", inv.id)}
                    >${deleteLabel}</wt-button
                  >
                </div>
              </div>
            </wt-card>
          `,
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-purchase-list": PurchaseList;
  }
}
