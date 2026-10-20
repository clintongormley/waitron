import { orderLabel } from "./order-label.js";
import { orderPreview, orderPreviewStyles } from "./order-preview.js";
import { LitElement, css, html, nothing, type TemplateResult, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, inNumberOrder, renderFloorChips } from "@waitron/ui";
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
import { outOfServiceJoined, seatsGuests, shownName } from "../state/floor-today.js";
import { signalChipStyles, signalChips } from "./signal-chips.js";
import "./bill-choice-dialog.js";
import { orderNumber, orderNumberStyles } from "./order-number.js";
import type { BillChoiceDetail } from "./bill-choice-dialog.js";
import type { FloorZone, HeldOrderSummary, TableState } from "../api/client.js";

export interface MoveHeldOrderDetail {
  orderId: string;
  tableId: string;
  /** Who the picker showed at the table, which the move sends as read there. */
  seated: SeatedRead;
  bills: BillChoiceDetail["bills"];
  prompt?: object;
}

export interface HeldRelocationOpenDetail {
  orderId: string;
  table: TableState;
  prompt: object;
  ready: () => void;
}

@customElement("till-held-orders")
export class TillHeldOrders extends LitElement {
  static override styles = [
    baseStyles,
    orderPreviewStyles,
    tableTargetStyles,
    signalChipStyles,
    orderNumberStyles,
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
  @property({ attribute: false }) zones: FloorZone[] = [];

  @state() private moving: HeldOrderSummary | null = null;
  /** A table another party holds, waiting for the bill choice. */
  @state() private choosing: TableState | null = null;

  focusMove(orderId: string): void {
    const button = [...this.renderRoot.querySelectorAll<HTMLElement>(".move")].find(
      (candidate) => candidate.dataset.orderId === orderId,
    );
    button?.shadowRoot?.querySelector<HTMLButtonElement>("button")?.focus();
  }

  @state() private expanded = new Set<string>();

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("orders")) {
      const ids = new Set(this.orders.map((order) => order.id));
      this.expanded = new Set([...this.expanded].filter((id) => ids.has(id)));
    }
  }

  #togglePreview(event: Event, id: string): void {
    if (
      event
        .composedPath()
        .some((target) => target instanceof Element && target.classList.contains("controls"))
    )
      return;
    const next = new Set(this.expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expanded = next;
  }

  #emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #relocationPrompt: object | null = null;

  #openPicker(order: HeldOrderSummary): void {
    this.#relocationPrompt = null;
    this.moving = order;
    this.choosing = null;
    this.#emit("move-held-order-open", undefined);
  }

  #closePicker(): void {
    this.#relocationPrompt = null;
    this.moving = null;
    this.choosing = null;
  }

  #pick(table: TableState): void {
    const order = this.moving;
    if (order === null) return;
    const prompt = {};
    this.#relocationPrompt = prompt;
    const ready = () => {
      if (!this.isConnected || this.moving !== order || this.#relocationPrompt !== prompt) return;
      if (table.party !== null) this.choosing = table;
      else this.#send(table, "merge");
    };
    const event = new CustomEvent<HeldRelocationOpenDetail>("held-relocation-open", {
      detail: { orderId: order.id, table, prompt, ready },
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    if (this.dispatchEvent(event)) {
      this.#relocationPrompt = null;
      if (table.party !== null) this.choosing = table;
      else this.#send(table, "merge");
    }
  }

  #send(table: TableState, bills: BillChoiceDetail["bills"]): void {
    const order = this.moving;
    if (order === null) return;
    const prompt = this.#relocationPrompt;
    this.#closePicker();
    this.#emit("move-held-order", {
      orderId: order.id,
      tableId: table.id,
      seated: seatedRead(table),
      bills,
      ...(prompt === null ? {} : { prompt }),
    } satisfies MoveHeldOrderDetail);
  }

  #scope(order: HeldOrderSummary): string {
    const label = orderLabel(order);
    return `#${order.orderNumber}${label ? ` ${label}` : ""}`;
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
    const label = orderLabel(order);
    return html`
      <div class="order" @click=${(event: Event) => this.#togglePreview(event, order.id)}>
        <button
          type="button"
          class="summary"
          aria-expanded=${String(this.expanded.has(order.id))}
          aria-controls=${`preview-${order.id}`}
        >
          <span class="number">${orderNumber(order.orderNumber, order.formerNumbers)}</span>
          ${label ? html`<span class="label">${label}</span>` : nothing}
          <span class="meta">${this.#meta(order)}</span>
          ${this.#signals(order)}
        </button>
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
                  data-order-id=${order.id}
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
        <div
          class="order-preview"
          id=${`preview-${order.id}`}
          ?hidden=${!this.expanded.has(order.id)}
        >
          ${this.expanded.has(order.id) ? orderPreview(order.items) : nothing}
        </div>
      </div>
    `;
  }

  #picker(order: HeldOrderSummary): TemplateResult {
    const tables = this.tables.filter(
      (table) =>
        !outOfServiceJoined(table) &&
        (table.party !== null || seatsGuests(this.zones.find((zone) => zone.id === table.zoneId))),
    );
    return html`<wt-dialog
      ${trackDialog()}
      data-table-picker
      .open=${true}
      .heading=${t("table.move_bill_heading").replace("{bill}", () => this.#scope(order))}
      @wt-close=${() => this.#closePicker()}
    >
      ${
        tables.length === 0
          ? html`<p class="picker-empty">${t("held.no_tables")}</p>`
          : html`<div class="action-options">
              ${tables
                .sort((a, b) => inNumberOrder(shownName(a), shownName(b)))
                .map((table) => tableTarget(table, undefined, (picked) => this.#pick(picked)))}
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
        this.#relocationPrompt = null;
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
