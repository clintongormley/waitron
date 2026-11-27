import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, TickingClock } from "@waitron/ui";
import type { TillLiveConnection } from "../api/live-connection.js";
import type { FloorZone, TableState } from "../api/floor-api.js";
import type { CounterWaitingOrder, HeldOrderSummary } from "../api/orders-api.js";
import { t } from "../i18n/t.js";
import { listedTables } from "../state/floor-map.js";
import { liveGate } from "../state/live-gate.js";
import type { NamedOrderZone } from "../widgets/order-label.js";
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
  @property({ attribute: false }) counterZoneIds: readonly string[] = [];
  @property({ attribute: false }) floorZoneIds: readonly string[] = [];
  @property({ attribute: false }) orderZones: readonly NamedOrderZone[] = [];
  @property({ attribute: false }) waiting: CounterWaitingOrder[] = [];
  @property({ attribute: false }) parked: HeldOrderSummary[] = [];
  @property({ attribute: false }) tables: TableState[] = [];
  @property({ type: Boolean }) tablesAnswered = false;
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
        "party_tables",
        "dining_tables",
      ],
      intervalMs: 15_000,
      quietWhileConnected: true,
      run,
    });
    if (!this.live?.up) run();
  }

  #rows(orders: CounterWaitingOrder[], kind: "ready" | "open" | "other" = "open") {
    return html`<till-counter-waiting
      floor
      ?ready=${kind === "ready"}
      .outsideZones=${kind === "other" ? this.orderZones : undefined}
      .orders=${orders}
      .now=${this.#clock.now}
      .canEditKitchenNote=${this.canEditKitchenNote}
      .canMoveStation=${this.canMoveStation}
    ></till-counter-waiting>`;
  }

  #heldRows(orders: HeldOrderSummary[], outside = false) {
    return orders.length === 0
      ? nothing
      : html`<till-held-orders
          floor
          .orders=${orders}
          .outsideZones=${outside ? this.orderZones : undefined}
          .tables=${this.tables}
          .zones=${this.zones}
        ></till-held-orders>`;
  }

  override render() {
    const current = this.waiting.filter(({ zoneId }) => zoneId === this.zoneId);
    const ready = current.filter(readyToHandOver);
    const open = current.filter((order) => !readyToHandOver(order));
    const held = this.parked.filter(({ zoneId }) => zoneId === this.zoneId);
    const seated = held.filter(({ partyId }) => partyId !== null);
    const parked = held.filter(({ partyId }) => partyId === null);
    const mappedParties = new Set(
      listedTables(this.tables).flatMap(({ zoneId, party }) =>
        zoneId !== null && this.floorZoneIds.includes(zoneId) && party !== null ? [party.id] : [],
      ),
    );
    const shownCounter = (zoneId: string | null) =>
      zoneId !== null && this.counterZoneIds.includes(zoneId);
    const otherWaiting = this.waiting.filter(({ zoneId }) => !shownCounter(zoneId));
    const otherParked = this.parked.filter(
      ({ zoneId, partyId }) =>
        !shownCounter(zoneId) &&
        (partyId === null || !mappedParties.has(partyId)) &&
        (this.tablesAnswered || zoneId === null || !this.floorZoneIds.includes(zoneId)),
    );
    const openCount = open.length + held.length;
    const otherCount = otherWaiting.length + otherParked.length;
    return html`
      ${
        ready.length === 0
          ? nothing
          : html`<h2>${t("counter.floor_ready")}</h2>
              ${this.#rows(ready, "ready")}`
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
              ${this.#heldRows(seated)}${this.#rows(open)}${this.#heldRows(parked)}`
      }
      ${
        otherCount === 0
          ? nothing
          : html`<section data-other-orders>
              <h2>${t("counter.floor_other")} · ${otherCount}</h2>
              ${this.#rows(otherWaiting, "other")}${this.#heldRows(otherParked, true)}
            </section>`
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-counter-floor": TillCounterFloor;
  }
}
