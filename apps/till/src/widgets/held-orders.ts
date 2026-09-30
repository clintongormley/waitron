import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, renderFloorChips } from "@waitron/ui";
import { formatMoney } from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";
import { trackDialog } from "./track-dialog.js";
import {
  moveBillScope,
  partyScope,
  seatedRead,
  tableTarget,
  tableTargetStyles,
  type SeatedRead,
} from "./table-targets.js";
import { paidInPart } from "../state/bill-state.js";
import { signalChipStyles, signalChips } from "./signal-chips.js";
import "./bill-choice-dialog.js";
import type { BillChoiceDetail } from "./bill-choice-dialog.js";
import type { HeldOrderSummary, TableState } from "../api/client.js";

export interface MoveHeldOrderDetail {
  orderId: string;
  tableId: string;
  /** Who the picker showed at the table, which the move sends as read there. */
  seated: SeatedRead;
  bills: BillChoiceDetail["bills"];
}

/**
 * Lists every open order in the venue, so an order parked on one register is retrieved on another.
 * A counter order can be moved to a table: a picker lists the floor's `tables`, and a table another
 * party holds first asks what happens to the bills. A pure view: the app owns the list and the floor,
 * and turns the `retrieve-order`, `discard-order`, `move-held-order-open` and `move-held-order`
 * events into API calls.
 */
@customElement("till-held-orders")
export class TillHeldOrders extends LitElement {
  static override styles = [
    baseStyles,
    tableTargetStyles,
    signalChipStyles,
    css`
      :host {
        display: block;
      }

      .title {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
      }

      .empty {
        margin: 0;
        padding: var(--wt-space-4);
        color: var(--wt-color-text-muted);
        text-align: center;
      }

      .order {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        padding: var(--wt-space-2) 0;
        border-bottom: 1px solid var(--wt-color-border);
      }

      .summary {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        gap: var(--wt-space-1);
        min-width: 0;
      }

      .controls {
        display: flex;
        flex: 0 1 auto;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--wt-space-2);
        margin-inline-start: auto;
      }

      .number {
        font-weight: var(--wt-font-weight-bold);
      }

      .label {
        color: var(--wt-color-text);
      }

      .meta {
        color: var(--wt-color-text-muted);
        font-variant-numeric: tabular-nums;
      }

      .signals {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }

      .action-options {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }

      .picker-empty {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property({ attribute: false }) orders: HeldOrderSummary[] = [];
  /** The floor, which the app reads again when a picker opens. */
  @property({ attribute: false }) tables: TableState[] = [];

  @state() private moving: HeldOrderSummary | null = null;
  /** A table another party holds, waiting for the bill choice. */
  @state() private choosing: TableState | null = null;

  #emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #openPicker(order: HeldOrderSummary): void {
    this.moving = order;
    this.choosing = null;
    this.#emit("move-held-order-open", undefined);
  }

  #closePicker(): void {
    this.moving = null;
    this.choosing = null;
  }

  #pick(table: TableState): void {
    if (table.party !== null) {
      this.choosing = table;
      return;
    }
    this.#send(table, "merge");
  }

  #send(table: TableState, bills: BillChoiceDetail["bills"]): void {
    const order = this.moving;
    if (order === null) return;
    this.#closePicker();
    this.#emit("move-held-order", {
      orderId: order.id,
      tableId: table.id,
      seated: seatedRead(table),
      bills,
    } satisfies MoveHeldOrderDetail);
  }

  #scope(order: HeldOrderSummary): string {
    return `#${order.orderNumber}${order.label ? ` ${order.label}` : ""}`;
  }

  #meta(order: HeldOrderSummary): string {
    const parts = [`${order.itemCount}`, formatMoney(order.total, currentLocale())];
    if (paidInPart(order))
      parts.push(
        t("table.bill_to_pay").replace("{amount}", () =>
          formatMoney(order.outstanding, currentLocale()),
        ),
      );
    return parts.join(" · ");
  }

  #signals(order: HeldOrderSummary): TemplateResult | typeof nothing {
    const chips = signalChips(order.signals);
    return chips.length === 0
      ? nothing
      : html`<span class="signals">${renderFloorChips(chips)}</span>`;
  }

  #row(order: HeldOrderSummary): TemplateResult {
    const scope = this.#scope(order);
    return html`
      <div class="order">
        <div class="summary">
          <span class="number">#${order.orderNumber}</span>
          ${order.label ? html`<span class="label">${order.label}</span>` : nothing}
          <span class="meta">${this.#meta(order)}</span>
          ${this.#signals(order)}
        </div>
        <div class="controls">
          <wt-button
            class="retrieve"
            variant="primary"
            aria-label=${`${t("held.retrieve")} ${scope}`}
            @click=${() => this.#emit("retrieve-order", { id: order.id })}
          >
            ${t("held.retrieve")}
          </wt-button>
          ${
            order.partyId === null
              ? html`<wt-button
                  class="move"
                  variant="secondary"
                  aria-label=${`${t("held.move_to_table")} ${scope}`}
                  @click=${() => this.#openPicker(order)}
                >
                  ${t("held.move_to_table")}
                </wt-button>`
              : nothing
          }
          <wt-button
            class="discard"
            variant="danger"
            aria-label=${`${t("held.discard")} ${scope}`}
            @click=${() => this.#emit("discard-order", { id: order.id })}
          >
            ${t("held.discard")}
          </wt-button>
        </div>
      </div>
    `;
  }

  #picker(order: HeldOrderSummary): TemplateResult {
    return html`<wt-dialog
      ${trackDialog()}
      data-table-picker
      .open=${true}
      .heading=${t("table.move_bill_heading").replace("{bill}", () => this.#scope(order))}
      @wt-close=${() => this.#closePicker()}
    >
      ${
        this.tables.length === 0
          ? html`<p class="picker-empty">${t("held.no_tables")}</p>`
          : html`<div class="action-options">
              ${this.tables.map((table) =>
                tableTarget(table, undefined, (picked) => this.#pick(picked)),
              )}
            </div>`
      }
      <wt-button
        slot="footer"
        data-picker-cancel
        variant="ghost"
        @click=${() => this.#closePicker()}
      >
        ${t("action.cancel")}
      </wt-button>
    </wt-dialog>`;
  }

  #billChoice(order: HeldOrderSummary, table: TableState): TemplateResult {
    return html`<till-bill-choice-dialog
      .scope=${moveBillScope(this.#scope(order), partyScope(table.party!, this.tables))}
      .question=${t("table.bill_move_question")}
      @bill-choice-confirm=${(event: CustomEvent<BillChoiceDetail>) => {
        event.stopPropagation();
        this.#send(table, event.detail.bills);
      }}
      @bill-choice-cancel=${(event: Event) => {
        event.stopPropagation();
        this.choosing = null;
      }}
    ></till-bill-choice-dialog>`;
  }

  override render() {
    const moving = this.moving;
    return html`
      <h2 class="title">${t("held.title")}</h2>
      ${
        this.orders.length === 0
          ? html`<p class="empty">${t("held.empty")}</p>`
          : this.orders.map((order) => this.#row(order))
      }
      ${
        moving === null
          ? nothing
          : this.choosing === null
            ? this.#picker(moving)
            : this.#billChoice(moving, this.choosing)
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-held-orders": TillHeldOrders;
  }
}
