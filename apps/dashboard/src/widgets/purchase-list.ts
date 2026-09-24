import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-button.js";
import { t } from "../i18n/t.js";
import { regimeName } from "../i18n/domain.js";
import type { PurchaseInvoice } from "../api/client.js";

/**
 * DELETE IS A TWO-STEP CONFIRM. A factura recibida is re-keyable (not an immutable fiscal record), so a
 * heavyweight dialog is disproportionate — but an accidental single click still costs a full re-entry.
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

  @property({ attribute: false }) invoices: PurchaseInvoice[] = [];

  @state() private armedDeleteId: string | null = null;

  readonly #onOutsidePointerDown = (event: Event): void => {
    if (this.armedDeleteId === null) return;
    const armed = this.renderRoot.querySelector(`[data-test="delete-${this.armedDeleteId}"]`);
    if (armed !== null && event.composedPath().includes(armed)) return;
    this.armedDeleteId = null;
  };

  /** A new/replaced invoices list (a screen refresh) disarms — the armed row may no longer exist. */
  override willUpdate(changed: PropertyValues): void {
    if (changed.has("invoices")) this.armedDeleteId = null;
  }

  override updated(changed: PropertyValues): void {
    if (!changed.has("armedDeleteId")) return;
    if (this.armedDeleteId !== null) {
      document.addEventListener("pointerdown", this.#onOutsidePointerDown, true);
    } else {
      document.removeEventListener("pointerdown", this.#onOutsidePointerDown, true);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("pointerdown", this.#onOutsidePointerDown, true);
  }

  #emit(name: "edit-purchase" | "delete-purchase", id: string): void {
    this.dispatchEvent(
      new CustomEvent<{ id: string }>(name, { detail: { id }, bubbles: true, composed: true }),
    );
  }

  #onEdit(event: Event, id: string): void {
    event.stopPropagation();
    this.armedDeleteId = null;
    this.#emit("edit-purchase", id);
  }

  #onDelete(event: Event, id: string): void {
    event.stopPropagation();
    if (this.armedDeleteId === id) {
      this.armedDeleteId = null;
      this.#emit("delete-purchase", id);
      return;
    }
    this.armedDeleteId = id;
  }

  override render() {
    const editLabel = t("action.edit");
    const deleteLabel = t("purchase.delete");
    const confirmLabel = t("purchase.delete_confirm");
    return html`
      <div class="list">
        ${this.invoices.map((inv) => {
          const armed = this.armedDeleteId === inv.id;
          return html`
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
                    @click=${(e: Event) => this.#onEdit(e, inv.id)}
                    >${editLabel}</wt-button
                  >
                  <wt-button
                    variant="danger"
                    data-test=${`delete-${inv.id}`}
                    data-armed=${armed ? "true" : nothing}
                    aria-label=${`${armed ? confirmLabel : deleteLabel} ${inv.supplierInvoiceNumber}`}
                    @click=${(e: Event) => this.#onDelete(e, inv.id)}
                    >${armed ? confirmLabel : deleteLabel}</wt-button
                  >
                </div>
              </div>
            </wt-card>
          `;
        })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-purchase-list": PurchaseList;
  }
}
