import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { UrlStateController, baseStyles } from "@waitron/ui";
import { tillPath } from "../navigation.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import "../widgets/station-queue.js";
import type { BumpMode, FireControlMode } from "../widgets/station-queue.js";
import type {
  DeviceStation,
  Station,
  StationQueueGroup,
  TicketState,
  TillApi,
} from "../api/client.js";

/**
 * The one item state a per-line advance to `to` legitimately STARTS from. A DEVICE has only a per-line
 * advance verb, so a whole-ticket bump expands to one advance per FIRED item at this state — never an
 * invalid skip such as a queued item jumped straight to `ready`.
 */
const ADVANCE_FROM: Record<Exclude<TicketState, "queued">, TicketState> = {
  preparing: "queued",
  ready: "preparing",
};

/**
 * The TILL station-display screen: one station's queue. It fetches its own data and handles the queue
 * widget's events itself, STOPPING them so the app (which handles the counter's own default-station
 * widget) never double-fires them. A failed state change is SWALLOWED and the reload reconciles the
 * queue to server truth.
 */
@customElement("till-station-screen")
export class TillStationScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .screen {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
        padding: var(--wt-space-4);
      }

      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
      }

      .title {
        margin: 0;
        font-size: var(--wt-font-size-xl);
        font-weight: var(--wt-font-weight-bold);
      }

      /* The board/rail view-toggle cluster: a SIBLING of the header (never inside it), so it survives
         when the standalone header is dropped in an embedded card host (SP-B2.2) — the toggle is station
         BODY function, not shell chrome. Back lives in the header instead. Mirrors the floor screen's
         .actions extraction. */
      .actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
      }

      /* The station picker — a tab per station (mirrors the floor screen's zone tabs). */
      .picker {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }

      .empty {
        margin: 0;
        padding: var(--wt-space-4);
        color: var(--wt-color-text-muted);
        text-align: center;
      }

      /* The reprint error banner — the same danger-on-surface pairing the app + lock screen use (a11y-safe
         in both themes), never behind muted text. */
      .error {
        margin: 0;
        padding: var(--wt-space-2) var(--wt-space-3);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-danger);
        color: var(--wt-color-on-danger);
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];

  @property({ attribute: false }) api!: TillApi;
  @property() bumpMode: BumpMode = "line";
  @property() fireControl: FireControlMode = "waiter";
  /**
   * An always-on ENROLLED display: no login, one bound station, no picker and no Back-to-counter. A 401
   * on its probe emits `device-unauthorized` so the app re-boots through the front door.
   */
  @property() deviceMode = false;
  /** The station the app already probed at cold boot, adopted ONCE so the mount does not read it again. */
  @property({ attribute: false }) initialDeviceStation?: DeviceStation;
  /** Mounted inside a card host, which supplies the header; the view toggle stays. */
  @property({ type: Boolean }) embedded = false;

  @state() private stations: Station[] = [];
  @state() private activeStationId?: string;
  @state() private groups: StationQueueGroup[] = [];
  @state() private view: "kanban" | "rail" = "kanban";
  /**
   * UNLIKE the advance/collect/fire levers, a failed reprint is not swallowed: it changes no order state,
   * so a reload reconciles nothing and a silent failure would leave the operator no feedback.
   */
  @state() private reprintErrorCode?: string;
  #initialConsumed = false;

  #queueRequest = 0;
  // Preserve the requested ID until the station list can validate it.
  #stationsLoaded = false;
  readonly #url = new UrlStateController(
    this,
    () => {
      if (this.#stationsLoaded && this.#ownsStationPath()) void this.#restoreStation();
    },
    tillPath,
  );

  #ownsStationPath(): boolean {
    return (
      this.isConnected &&
      !this.embedded &&
      !this.deviceMode &&
      this.#url.read("till-view") === "station"
    );
  }

  async #restoreStation(): Promise<void> {
    const requested = this.#ownsStationPath() ? this.#url.read("till-station") : null;
    const active =
      this.stations.find((station) => station.id === requested) ??
      this.stations.find((station) => station.isDefault) ??
      this.stations[0];
    if (active === undefined) {
      if (this.#ownsStationPath()) this.#url.write({ "till-station": null }, true);
      return;
    }
    await this.#selectStation(active.id, true);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.deviceMode) {
      void this.#loadDevice();
    } else {
      void this.#load();
    }
  }

  async #load(): Promise<void> {
    try {
      this.stations = await this.api.listStations();
      this.#stationsLoaded = true;
    } catch {
      this.stations = [];
      return;
    }
    if (!this.isConnected) return;
    await this.#restoreStation();
  }

  /**
   * Any failure other than `device.unauthorized` is transient: keep the last-known queue rather than
   * tearing the kiosk down for a blip.
   */
  async #loadDevice(): Promise<void> {
    // A one-shot, so a later re-connect fetches and never reuses a stale initial.
    if (this.initialDeviceStation !== undefined && !this.#initialConsumed) {
      this.#initialConsumed = true;
      const { station } = this.initialDeviceStation;
      this.activeStationId = station.id;
      this.groups = station.queue;
      return;
    }
    try {
      const { station } = await this.api.getDeviceStation();
      this.activeStationId = station.id;
      this.groups = station.queue;
    } catch (error) {
      if ((error as { code?: string }).code === "device.unauthorized") {
        this.dispatchEvent(
          new CustomEvent("device-unauthorized", { bubbles: true, composed: true }),
        );
      }
    }
  }

  /** Ignores operator responses superseded by a later request. */
  async #reload(): Promise<void> {
    if (this.deviceMode) {
      try {
        const { station } = await this.api.getDeviceStation();
        this.activeStationId = station.id;
        this.groups = station.queue;
      } catch {
        // Non-fatal — leave the last-known queue.
      }
      return;
    }
    if (this.activeStationId === undefined) return;
    const request = ++this.#queueRequest;
    try {
      const groups = await this.api.getStationQueue(this.activeStationId);
      if (this.isConnected && request === this.#queueRequest) this.groups = groups;
    } catch {
      // Non-fatal — leave the last-known queue; the next reload reconciles.
    }
  }

  async #selectStation(id: string, replace = false): Promise<void> {
    if (this.deviceMode) return;
    if (this.activeStationId !== id) this.groups = [];
    this.activeStationId = id;
    if (this.#ownsStationPath()) this.#url.write({ "till-station": id }, replace);
    await this.#reload();
  }

  #toggleView(): void {
    this.view = this.view === "kanban" ? "rail" : "kanban";
  }

  #back(): void {
    this.dispatchEvent(new CustomEvent("back-to-counter", { bubbles: true, composed: true }));
  }

  async #advance(call: () => Promise<void>): Promise<void> {
    try {
      await call();
    } catch {
      // Non-fatal — the reload reconciles the queue to server truth.
    }
    await this.#reload();
  }

  async #onAdvanceTicketItem(event: Event): Promise<void> {
    event.stopPropagation();
    const { itemId, to } = (
      event as CustomEvent<{ itemId: string; to: Exclude<TicketState, "queued"> }>
    ).detail;
    await this.#advance(() =>
      this.deviceMode ? this.api.deviceAdvance(itemId, to) : this.api.advanceTicketItem(itemId, to),
    );
  }

  async #onAdvanceTicket(event: Event): Promise<void> {
    event.stopPropagation();
    const { orderId, stationId, to } = (
      event as CustomEvent<{
        orderId: string;
        stationId: string;
        to: Exclude<TicketState, "queued">;
      }>
    ).detail;
    await this.#advance(() =>
      this.deviceMode
        ? this.#deviceAdvanceTicket(orderId, to)
        : this.api.advanceTicket(orderId, stationId, to),
    );
  }

  async #deviceAdvanceTicket(orderId: string, to: Exclude<TicketState, "queued">): Promise<void> {
    const group = this.groups.find((candidate) => candidate.orderId === orderId);
    if (group === undefined) return;
    for (const item of group.items) {
      if (item.firedAt !== null && item.state === ADVANCE_FROM[to]) {
        await this.api.deviceAdvance(item.id, to);
      }
    }
  }

  async #onMarkCollected(event: Event): Promise<void> {
    event.stopPropagation();
    // A device holds no session for this verb; the advance-only widget hides the button, and this guards
    // a stray composed event.
    if (this.deviceMode) return;
    const { orderId } = (event as CustomEvent<{ orderId: string }>).detail;
    await this.#advance(() => this.api.markCollected(orderId));
  }

  async #onFireCourse(event: Event): Promise<void> {
    event.stopPropagation();
    // Same device-mode guard as #onMarkCollected.
    if (this.deviceMode) return;
    const { orderId, courseId } = (event as CustomEvent<{ orderId: string; courseId: string }>)
      .detail;
    await this.#advance(() => this.api.fireCourse(orderId, courseId));
  }

  async #onReprintOrder(event: Event): Promise<void> {
    event.stopPropagation();
    if (this.deviceMode) return;
    const { orderId } = (event as CustomEvent<{ orderId: string }>).detail;
    this.reprintErrorCode = undefined;
    try {
      await this.api.reprintOrder(orderId);
    } catch (error) {
      this.reprintErrorCode = (error as { code?: string }).code ?? "server.internal";
    }
  }

  override render() {
    return this.deviceMode ? this.#renderDevice() : this.#renderOperator();
  }

  #renderOperator(): TemplateResult {
    return this.#renderQueueSurface({
      showBack: true,
      body: this.stations.length === 0 ? this.#noStations() : this.#body(),
    });
  }

  #renderDevice(): TemplateResult {
    return this.#renderQueueSurface({ showBack: false, body: this.#queue(true) });
  }

  #renderQueueSurface(opts: { showBack: boolean; body: TemplateResult }): TemplateResult {
    return html`
      <section
        class="screen"
        aria-label=${t("station.title")}
        @advance-ticket-item=${(event: Event) => void this.#onAdvanceTicketItem(event)}
        @advance-ticket=${(event: Event) => void this.#onAdvanceTicket(event)}
        @mark-collected=${(event: Event) => void this.#onMarkCollected(event)}
        @fire-course=${(event: Event) => void this.#onFireCourse(event)}
        @reprint-order=${(event: Event) => void this.#onReprintOrder(event)}
      >
        ${
          this.embedded
            ? nothing
            : html`<header class="head">
                <h1 class="title">${t("station.title")}</h1>
                ${
                  opts.showBack
                    ? html`<wt-button
                        class="back"
                        data-back
                        variant="secondary"
                        @click=${() => this.#back()}
                      >
                        ${t("station.back")}
                      </wt-button>`
                    : nothing
                }
              </header>`
        }
        <div class="actions">
          <wt-button
            class="view-toggle"
            data-view-toggle
            variant="secondary"
            @click=${() => this.#toggleView()}
          >
            ${this.view === "kanban" ? t("station.view_rail") : t("station.view_kanban")}
          </wt-button>
        </div>
        ${
          this.reprintErrorCode
            ? html`<p class="error" role="alert">${codeMessage(this.reprintErrorCode)}</p>`
            : nothing
        }
        ${opts.body}
      </section>
    `;
  }

  #noStations(): TemplateResult {
    return html`<p class="empty">${t("station.no_stations")}</p>`;
  }

  #body(): TemplateResult {
    return html`
      <nav class="picker" aria-label=${t("station.pick")}>
        ${this.stations.map((station) => this.#pick(station))}
      </nav>
      ${this.#queue(false)}
    `;
  }

  /** Reprint shows in OPERATOR mode only: the reprint route is session-guarded and a device holds no
   * session. */
  #queue(advanceOnly: boolean): TemplateResult {
    return html`<till-station-queue
      .groups=${this.groups}
      .view=${this.view}
      .bumpMode=${this.bumpMode}
      .fireControl=${this.fireControl}
      .stationId=${this.activeStationId}
      .advanceOnly=${advanceOnly}
      .showReprint=${!advanceOnly}
    ></till-station-queue>`;
  }

  #pick(station: Station): TemplateResult {
    const active = station.id === this.activeStationId;
    return html`<wt-button
      class=${active ? "pick active" : "pick"}
      data-station=${station.id}
      variant=${active ? "primary" : "secondary"}
      aria-pressed=${active ? "true" : "false"}
      @click=${() => void this.#selectStation(station.id)}
    >
      ${station.name}
    </wt-button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-station-screen": TillStationScreen;
  }
}
