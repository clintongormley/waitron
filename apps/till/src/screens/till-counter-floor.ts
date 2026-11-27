import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, TickingClock } from "@waitron/ui";
import type { TillLiveConnection } from "../api/live-connection.js";
import type { FloorZone, TableState } from "../api/floor-api.js";
import type { CounterWaitingOrder, HeldOrderSummary } from "../api/orders-api.js";
import { t } from "../i18n/t.js";
import { liveGate } from "../state/live-gate.js";
import "../widgets/counter-waiting.js";
import "../widgets/held-orders.js";

function readyToHandOver({ status, canHandOver, counts }: CounterWaitingOrder): boolean {
  return (
    status === "settled" &&
    canHandOver &&
    counts.ordered > 0 &&
    counts.waiting === 0 &&
    counts.held === 0 &&
    counts.unsent === 0
  );
}

@customElement("till-counter-floor")
export class TillCounterFloor extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        max-inline-size: 700px;
        margin-inline: auto;
      }
      h2 {
        margin: 0;
        padding: var(--wt-space-3) var(--wt-space-4) calc(var(--wt-space-3) / 2);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        letter-spacing: var(--wt-letter-spacing-caps);
        text-transform: uppercase;
      }
      .new-order {
        padding: var(--wt-space-3);
      }
      .new-order wt-button {
        display: block;
      }
      .new-order wt-button::part(button) {
        min-block-size: calc(var(--wt-tap-min) + var(--wt-space-4));
      }
    `,
  ];

  @property({ attribute: false }) live?: TillLiveConnection;
  @property({ attribute: false }) refresh?: () => void;
  @property({ type: String }) zoneId = "";
  @property({ attribute: false }) waiting: CounterWaitingOrder[] = [];
  @property({ attribute: false }) parked: HeldOrderSummary[] = [];
  @property({ attribute: false }) tables: TableState[] = [];
  @property({ attribute: false }) zones: FloorZone[] = [];
  @property({ type: Boolean }) canEditKitchenNote = false;
  @property({ type: Boolean }) canMoveStation = false;

  readonly #clock = new TickingClock(this, 15_000);
  #watch?: { stop(): void };

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.#watch?.stop();
    this.#watch = undefined;
    super.disconnectedCallback();
  }

  override updated(changed: PropertyValues<this>): void {
    if (!this.isConnected || (this.#watch !== undefined && !changed.has("live"))) return;
    this.#watch?.stop();
    const run = () => this.refresh?.();
    this.#watch = liveGate(this.live, {
      types: [
        "working_orders",
        "working_order_lines",
        "ticket_items",
        "line_service_cancellations",
        "order_groups",
        "order_drafts",
        "order_draft_lines",
        "bill_payments",
      ],
      intervalMs: 15_000,
      quietWhileConnected: true,
      run,
    });
    if (!this.live?.up) run();
  }

  #rows(orders: CounterWaitingOrder[], ready = false) {
    return html`<till-counter-waiting
      floor
      ?ready=${ready}
      .orders=${orders}
      .now=${this.#clock.now}
      .canEditKitchenNote=${this.canEditKitchenNote}
      .canMoveStation=${this.canMoveStation}
    ></till-counter-waiting>`;
  }

  override render() {
    const current = this.waiting.filter(({ zoneId }) => zoneId === this.zoneId);
    const ready = current.filter(readyToHandOver);
    const open = current.filter((order) => !readyToHandOver(order));
    const parked = this.parked.filter(
      ({ zoneId, partyId }) => zoneId === this.zoneId && partyId === null,
    );
    const openCount = open.length + parked.length;
    return html`
      ${
        ready.length === 0
          ? nothing
          : html`<h2>${t("counter.floor_ready")}</h2>
              ${this.#rows(ready, true)}`
      }
      <div class="new-order">
        <wt-button
          variant="primary"
          size="lg"
          @click=${() => this.dispatchEvent(new Event("counter-new-order", { bubbles: true, composed: true }))}
          >${t("counter.floor_new")}</wt-button
        >
      </div>
      ${
        openCount === 0
          ? nothing
          : html`<h2>${t("counter.floor_open")} · ${openCount}</h2>
              ${this.#rows(open)}
              ${
                parked.length === 0
                  ? nothing
                  : html`<till-held-orders
                      floor
                      .orders=${parked}
                      .tables=${this.tables}
                      .zones=${this.zones}
                    ></till-held-orders>`
              }`
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-counter-floor": TillCounterFloor;
  }
}
