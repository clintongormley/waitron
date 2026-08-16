import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
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
 * The purchases screen owns the list (`DashboardApi.listPurchaseInvoices`) and hands it down as
 * `invoices`; the two controls emit composed, bubbling events carrying only the `id`, which the screen
 * turns into an edit or delete flow. The regime renders through the i18n layer at the render edge
 * (`regimeName`) — the raw token is never shown; `data-regime` keeps the raw token for tests.
 *
 * DELETE IS A TWO-STEP CONFIRM. A factura recibida is re-keyable (not an immutable fiscal record), so a
 * heavyweight dialog is disproportionate — but an accidental single click still costs a full re-entry.
 * So the first click on a row's Delete ARMS that row (its label + `aria-label` flip to the confirm
 * prompt); a second click on the same control emits `delete-purchase`. Only one row is armed at a time
 * (`armedDeleteId`), so arming another row disarms the first, and clicking Edit, clicking anywhere else
 * (a document `pointerdown` outside the armed control), or a list refresh all disarm. The widget holds
 * only this transient arm state; it still never talks to the API.
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

  /** The id of the row whose Delete control is ARMED (awaiting a confirming second click), or null.
   * Single-valued, so arming one row disarms any other by construction. */
  @state() private armedDeleteId: string | null = null;

  /** A `pointerdown` anywhere whose composed path does NOT include the armed Delete control disarms it
   * (click-away). Bound once; installed only while a row is armed (see `updated`). The arming click's own
   * path includes the control, so arming never self-disarms. */
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

  /** Install the click-away listener only while a row is armed, and tear it down when disarmed. */
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

  /** Dispatch the semantic event bubbles+composed so it crosses this widget's shadow boundary to the
   * screen (the house pattern — `product-list` does the same). */
  #emit(name: "edit-purchase" | "delete-purchase", id: string): void {
    this.dispatchEvent(
      new CustomEvent<{ id: string }>(name, { detail: { id }, bubbles: true, composed: true }),
    );
  }

  /** Edit `id`. `stopPropagation` keeps the button's own composed `click` inside this shadow boundary;
   * an edit also disarms any armed delete (interacting elsewhere is a click-away). */
  #onEdit(event: Event, id: string): void {
    event.stopPropagation();
    this.armedDeleteId = null;
    this.#emit("edit-purchase", id);
  }

  /** The two-step delete: the first click arms `id`, a second click on the armed row confirms and emits
   * `delete-purchase`. `stopPropagation` keeps the button's composed `click` inside the shadow boundary. */
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
    const editLabel = t("action.edit"); // locale-invariant across rows — resolve once per render
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
