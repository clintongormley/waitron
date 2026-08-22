import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
// Side-effect import: registers <till-station-queue>, the shared queue renderer this screen wraps with a
// picker + view toggle. The screen names it only as a tag below, so the rendering stays the widget's.
import "../widgets/station-queue.js";
import type { BumpMode } from "../widgets/station-queue.js";
import type { Station, StationQueueGroup, TicketState, TillApi } from "../api/client.js";

/**
 * The TILL station-display screen (KDS-1, design §5a): the kitchen's own view of one station's queue.
 * Kitchen staff reach it with the same PIN → session the counter uses (no device identity yet — §0), pick
 * a STATION from the venue's stations, and see that station's ticket items — grouped by order — through one
 * of two lenses: a KANBAN board (the default) or a TICKET RAIL, flipped by a toggle (the FP-2 map/list
 * pattern). A tap on a line BUMPS it one kitchen step: per-line by default (the source of truth), or the
 * whole ticket when {@link bumpMode} is `ticket` (the venue's convenience setting).
 *
 * UNLIKE the pure-view sibling screens, this one OWNS its `.api` (like `till-lock-screen`): it fetches the
 * station list + the active station's queue itself, and turns the embedded {@link TillStationQueue}'s
 * `advance-ticket-item` / `advance-ticket` events into `advanceTicketItem` / `advanceTicket` calls, then
 * reloads — the SAME event → owner → server shape #63's prep-queue widget used, with the owner being this
 * screen rather than the app. It STOPS those advance events at the screen so the app (which handles the
 * counter's own default-station widget) never double-fires them. A failed advance is SWALLOWED and the
 * reload reconciles the queue to server truth (a race, or a since-advanced line), the degrade-gracefully
 * shape `till-floor-screen` uses for its placement writes.
 *
 * It holds no queue data of its own beyond which station/view is showing; the widget renders from the
 * fetched {@link groups}. Lit + `@waitron/ui` `baseStyles` + theme tokens only (no hardcoded chrome), so it
 * follows the operator's theme like every sibling. Copy is the till's i18n (`station.*`); the shipped
 * default locale is es-ES, so it renders in Spanish. Identifiers stay English; station names are DATA.
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
    `,
  ];

  /** The HTTP face of the till — the screen fetches stations + the active queue and writes advances
   * through it (owned by the screen, threaded from the app, like `till-lock-screen`). */
  @property({ attribute: false }) api!: TillApi;
  /** Per-line (default) vs whole-ticket bump — the `bump_mode` venue setting, threaded from the app and
   * passed straight to the widget. */
  @property() bumpMode: BumpMode = "line";

  /** The venue's active stations (fetched once on connect). */
  @state() private stations: Station[] = [];
  /** The station whose queue is showing — the default station on load, or whichever tab was tapped. */
  @state() private activeStationId?: string;
  /** The active station's queue, grouped by order (reloaded after every advance). */
  @state() private groups: StationQueueGroup[] = [];
  /** The lens: kanban board (default) or ticket rail, flipped by the toggle. */
  @state() private view: "kanban" | "rail" = "kanban";

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /**
   * Fetch the station list once on connect, adopt the DEFAULT station (or the first, if none is flagged)
   * as active, and load its queue. A rejection leaves the screen empty rather than escaping as an
   * unhandled promise; state written after a mid-fetch disconnect is harmless — Lit does not paint a
   * detached element — so no `isConnected` guard is needed (the sibling screens' reasoning).
   */
  async #load(): Promise<void> {
    try {
      this.stations = await this.api.listStations();
    } catch {
      this.stations = [];
      return;
    }
    const active = this.stations.find((s) => s.isDefault) ?? this.stations[0];
    if (active === undefined) return;
    this.activeStationId = active.id;
    await this.#reload();
  }

  /** (Re)load the ACTIVE station's queue. A failed read leaves the last-known queue in place (degrade
   * gracefully — the kitchen display touches no fiscal path); no `isConnected` guard (state-only). */
  async #reload(): Promise<void> {
    if (this.activeStationId === undefined) return;
    try {
      this.groups = await this.api.getStationQueue(this.activeStationId);
    } catch {
      // Non-fatal — leave the last-known queue; the next reload reconciles.
    }
  }

  /** Switch to another station's queue (a picker tap). */
  async #selectStation(id: string): Promise<void> {
    this.activeStationId = id;
    await this.#reload();
  }

  /** Flip the board ⇄ rail lens. */
  #toggleView(): void {
    this.view = this.view === "kanban" ? "rail" : "kanban";
  }

  /** Return to the counter (basket-preserving, handled by the app — mirrors the schedule/floor screens). */
  #back(): void {
    this.dispatchEvent(new CustomEvent("back-to-counter", { bubbles: true, composed: true }));
  }

  /**
   * A per-line bump from the widget (`bump_mode = line`, the source of truth). Handle it HERE and stop it
   * — the app must not also see it (it owns the counter's own default-station widget). Advance, then
   * reload on BOTH paths so a rejected move (a race, a since-advanced line) reconciles to server truth.
   */
  async #onAdvanceTicketItem(event: Event): Promise<void> {
    event.stopPropagation();
    const { itemId, to } = (
      event as CustomEvent<{ itemId: string; to: Exclude<TicketState, "queued"> }>
    ).detail;
    try {
      await this.api.advanceTicketItem(itemId, to);
    } catch {
      // Non-fatal — the reload reconciles the queue to server truth (see the method doc).
    }
    await this.#reload();
  }

  /**
   * A whole-ticket bump from the widget (`bump_mode = ticket`, the convenience). Same handle-here-and-stop
   * + advance-then-reconcile shape as {@link #onAdvanceTicketItem}, over the whole-ticket verb.
   */
  async #onAdvanceTicket(event: Event): Promise<void> {
    event.stopPropagation();
    const { orderId, stationId, to } = (
      event as CustomEvent<{
        orderId: string;
        stationId: string;
        to: Exclude<TicketState, "queued">;
      }>
    ).detail;
    try {
      await this.api.advanceTicket(orderId, stationId, to);
    } catch {
      // Non-fatal — the reload reconciles (see #onAdvanceTicketItem).
    }
    await this.#reload();
  }

  override render() {
    return html`
      <section
        class="screen"
        aria-label=${t("station.title")}
        @advance-ticket-item=${(event: Event) => void this.#onAdvanceTicketItem(event)}
        @advance-ticket=${(event: Event) => void this.#onAdvanceTicket(event)}
      >
        <header class="head">
          <h1 class="title">${t("station.title")}</h1>
          <div class="actions">
            <wt-button
              class="view-toggle"
              data-view-toggle
              variant="secondary"
              @click=${() => this.#toggleView()}
            >
              ${this.view === "kanban" ? t("station.view_rail") : t("station.view_kanban")}
            </wt-button>
            <wt-button class="back" data-back variant="secondary" @click=${() => this.#back()}>
              ${t("station.back")}
            </wt-button>
          </div>
        </header>
        ${this.stations.length === 0 ? this.#noStations() : this.#body()}
      </section>
    `;
  }

  /** The venue has no configured stations — nothing to display or route to. */
  #noStations(): TemplateResult {
    return html`<p class="empty">${t("station.no_stations")}</p>`;
  }

  /** The picker + the active station's queue. */
  #body(): TemplateResult {
    return html`
      <nav class="picker" aria-label=${t("station.pick")}>
        ${this.stations.map((station) => this.#pick(station))}
      </nav>
      <till-station-queue
        .groups=${this.groups}
        .view=${this.view}
        .bumpMode=${this.bumpMode}
        .stationId=${this.activeStationId}
      ></till-station-queue>
    `;
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
