import { actionChoiceStyles } from "@waitron/ui/src/components/wt-row-actions.js";
import { repeat } from "lit/directives/repeat.js";
import { counterFloorRowStyles } from "./counter-floor-row-styles.js";
import { orderLabel, outsideOrderLocation, type NamedOrderZone } from "./order-label.js";
import { orderPreview, orderPreviewStyles } from "./order-preview.js";
import { LitElement, css, html, nothing, type TemplateResult, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, inNumberOrder, renderFloorChips } from "@waitron/ui";
import { formatMoney } from "@waitron/shared";
import { countText, currentLocale, t } from "../i18n/t.js";
import { trackDialog } from "./track-dialog.js";
import { seatedRead, tableTarget, tableTargetStyles, type SeatedRead } from "./table-targets.js";
import { amountToPay, billName, paidInPart } from "../state/bill-state.js";
import { seatsGuests, shownName } from "../state/floor-today.js";
import { signalChipStyles, signalChips } from "./signal-chips.js";
import { orderNumber, orderNumberStyles } from "./order-number.js";
import { orderCountStyles, orderCounts } from "./order-counts.js";
import { helpAnchorStyles, helpBadge } from "./help-badge.js";
import type { HeldOrderSummary } from "../api/orders-api.js";
import type { FloorZone, TableState } from "../api/floor-api.js";

export interface MoveHeldOrderDetail {
  orderId: string;
  tableId: string;
  /** Who the picker showed at the table, which the move sends as read there. */
  seated: SeatedRead;
  prompt?: object;
}

export interface HeldRelocationOpenDetail {
  orderId: string;
  table: TableState;
  prompt: object;
  ready: () => void;
}

/** A table bill is named by its place in the table screen's bill wording ({@link billName}). */
function heldLabel(order: HeldOrderSummary): string | null {
  if (order.partyId === null) return orderLabel(order);
  return order.tableLabel === undefined ? order.billName : billName(order.tableLabel, order);
}

@customElement("till-held-orders")
export class TillHeldOrders extends LitElement {
  static override styles = [
    baseStyles,
    orderPreviewStyles,
    tableTargetStyles,
    signalChipStyles,
    orderNumberStyles,
    orderCountStyles,
    helpAnchorStyles,
    counterFloorRowStyles,
    actionChoiceStyles,
    css`
      :host {
        display: block;
      }

      .title-anchor {
        width: fit-content;
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

      :host([floor]) .order.parked {
        display: grid;
        cursor: pointer;
        grid-template-columns: minmax(0, 1fr) auto auto;
        gap: var(--wt-space-2);
        padding-inline-end: var(--wt-space-4);
      }

      :host([floor]) .parked .summary {
        grid-template-columns: minmax(0, 1fr);
        padding-inline-end: 0;
      }

      :host([floor]) .order.parked .meta {
        grid-column: 3;
        grid-row: 1;
      }

      .picker-empty {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) floor = false;
  @property({ attribute: false }) orders: HeldOrderSummary[] = [];
  @property({ attribute: false }) outsideZones?: readonly NamedOrderZone[];
  /** The floor, which the app reads again when a picker opens. */
  @property({ attribute: false }) tables: TableState[] = [];
  @property({ attribute: false }) zones: FloorZone[] = [];

  @state() private moving: HeldOrderSummary | null = null;

  focusMove(orderId: string): void {
    const button = [...this.renderRoot.querySelectorAll<HTMLElement>(".move")].find(
      (candidate) => candidate.dataset.orderId === orderId,
    );
    if (button?.matches("wt-row-actions")) button.focus();
    else button?.shadowRoot?.querySelector<HTMLButtonElement>("button")?.focus();
  }

  chooseMoveTableAgain(orderId: string): void {
    const order = this.orders.find(({ id }) => id === orderId);
    if (this.isConnected && this.moving === null && order?.partyId === null)
      this.#openPicker(order);
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
    this.#emit("move-held-order-open", undefined);
  }

  #closePicker(): void {
    this.#relocationPrompt = null;
    this.moving = null;
  }

  #pick(table: TableState): void {
    const order = this.moving;
    if (order === null) return;
    const prompt = {};
    this.#relocationPrompt = prompt;
    const ready = () => {
      if (!this.isConnected || this.moving !== order || this.#relocationPrompt !== prompt) return;
      this.#send(table);
    };
    const event = new CustomEvent<HeldRelocationOpenDetail>("held-relocation-open", {
      detail: { orderId: order.id, table, prompt, ready },
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    if (this.dispatchEvent(event)) {
      this.#relocationPrompt = null;
      this.#send(table);
    }
  }

  #send(table: TableState): void {
    const order = this.moving;
    if (order === null) return;
    const prompt = this.#relocationPrompt;
    this.#closePicker();
    this.#emit("move-held-order", {
      orderId: order.id,
      tableId: table.id,
      seated: seatedRead(table),
      ...(prompt === null ? {} : { prompt }),
    } satisfies MoveHeldOrderDetail);
  }

  #scope(order: HeldOrderSummary): string {
    const label = heldLabel(order);
    return `#${order.orderNumber}${label ? ` ${label}` : ""}`;
  }

  #meta(order: HeldOrderSummary): string {
    const parts = [formatMoney(order.total, currentLocale())];
    if (paidInPart(order))
      parts.push(
        t("table.bill_to_pay").replace("{amount}", () =>
          formatMoney(amountToPay(order.outstanding), currentLocale()),
        ),
      );
    return parts.join(" · ");
  }

  #signals(order: HeldOrderSummary): TemplateResult | typeof nothing {
    const chips = signalChips(order.signals.filter((signal) => signal.kind !== "ready"));
    return chips.length === 0
      ? nothing
      : html`<span class="signals">${renderFloorChips(chips)}</span>`;
  }

  #floorState({ partyId, counts }: HeldOrderSummary): string {
    const items = countText(counts.ordered, "order_counts.items", "order_counts.items_one");
    if (partyId === null) return `${items} · ${t("counter.floor_parked")}`;
    if (counts.unsent > 0)
      return `${items} · ${countText(counts.unsent, "order_counts.unsent", "order_counts.unsent_one")}`;
    return counts.ordered > 0 ? `${items} · ${t("table.sent_title")}` : items;
  }

  #row(order: HeldOrderSummary): TemplateResult {
    const scope = this.#scope(order);
    const label = heldLabel(order);
    const parked = this.floor && order.partyId === null;
    const expanded = this.expanded.has(order.id);
    const actions = this.#actions(order, scope);
    return html`
      <div
        class=${parked ? "order parked" : "order"}
        @click=${(event: Event) => {
          if (
            parked &&
            !event
              .composedPath()
              .some((target) => target instanceof Element && target.matches("wt-row-actions.move"))
          )
            this.#emit("retrieve-order", { id: order.id });
          else if (!this.floor) this.#togglePreview(event, order.id);
        }}
      >
        <button
          type="button"
          class="summary"
          aria-expanded=${parked ? nothing : String(expanded)}
          aria-controls=${parked ? nothing : `preview-${order.id}`}
          aria-describedby=${parked ? `amount-${order.id}` : nothing}
          @click=${(event: Event) => {
            if (this.floor && !parked) this.#togglePreview(event, order.id);
          }}
        >
          <span class="number"
            >${orderNumber(order.orderNumber, order.formerNumbers)}${this.floor && label ? ` · ${label}` : nothing}${outsideOrderLocation(order, this.outsideZones)}</span
          >
          ${!this.floor && label ? html`<span class="label">${label}</span>` : nothing}
          ${parked ? nothing : html`<span class="meta">${this.#meta(order)}</span>`}
          ${
            this.floor
              ? html`<span class="state">${this.#floorState(order)}</span>`
              : html`${orderCounts(order.counts)} ${this.#signals(order)}`
          }
        </button>
        ${
          parked
            ? html`${this.#parkedActions(order, scope)}<span class="meta" id=${`amount-${order.id}`}
                  >${this.#meta(order)}</span
                >`
            : this.floor
              ? nothing
              : actions
        }
        <div class="order-preview" id=${`preview-${order.id}`} ?hidden=${!expanded}>
          ${expanded ? html`${orderPreview(order.items)}${this.floor ? actions : nothing}` : nothing}
        </div>
      </div>
    `;
  }

  #actions(order: HeldOrderSummary, scope: string): TemplateResult {
    return html`
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
    `;
  }

  #parkedActions(order: HeldOrderSummary, scope: string): TemplateResult {
    return html`<wt-row-actions
      class="move"
      data-order-id=${order.id}
      label=${`${t("table.bill_actions")} ${scope}`}
      align="end"
    >
      <div role="menu">
        <button
          type="button"
          role="menuitem"
          data-row-choice
          @click=${() => this.#openPicker(order)}
        >
          ${t("held.move_to_table")}
        </button>
        <button
          type="button"
          role="menuitem"
          data-row-choice
          @click=${() => this.#emit("discard-order", { id: order.id })}
        >
          ${t("held.discard")}
        </button>
      </div>
    </wt-row-actions>`;
  }

  #picker(order: HeldOrderSummary): TemplateResult {
    // The server refuses an open order a closed area other than its own.
    const tables = this.tables.filter((table) => {
      const zone = this.zones.find((zone) => zone.id === table.zoneId);
      if (zone?.closed === true && zone.id !== order.zoneId) return false;
      return table.party !== null || seatsGuests(zone);
    });
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

  override render() {
    const moving = this.moving;
    return html`
      ${
        this.floor
          ? nothing
          : html`<div class="title-anchor help-anchor">
              <h2 class="title">${t("held.title")}</h2>
              ${helpBadge("help.counter.parked_orders", t("held.title"))}
            </div>`
      }
      ${
        this.orders.length === 0
          ? html`<p class="empty">${t("held.empty")}</p>`
          : repeat(
              this.orders,
              (order) => order.id,
              (order) => this.#row(order),
            )
      }
      ${moving === null ? nothing : this.#picker(moving)}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-held-orders": TillHeldOrders;
  }
}
