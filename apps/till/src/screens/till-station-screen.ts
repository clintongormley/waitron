import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { UrlStateController, submitOnEnter, baseStyles } from "@waitron/ui";
import { tillPath } from "../navigation.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
// Side-effect import: registers <till-station-queue>, the shared queue renderer this screen wraps with a
// picker + view toggle. The screen names it only as a tag below, so the rendering stays the widget's.
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
 * The one item state a per-line advance to `to` legitimately STARTS from — the widget's `NEXT` map
 * (`queued → preparing → ready`) inverted. A DEVICE has only a per-line advance verb ({@link
 * TillApi.deviceAdvance}), so a whole-ticket bump (device mode, `bump_mode = ticket`) expands to one
 * deviceAdvance per FIRED item at this predecessor state — mirroring what a per-line tap on each would
 * do, and so never issuing an invalid skip (a queued item is not jumped straight to `ready`).
 */
const ADVANCE_FROM: Record<Exclude<TicketState, "queued">, TicketState> = {
  preparing: "queued",
  ready: "preparing",
};

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
 * follows the operator's theme like every sibling. Copy is the till's i18n (`station.*`), rendered in
 * the active locale (English by default, es-ES for a Spanish venue). Identifiers stay English; station
 * names are DATA.
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

      /* The device-mode enrol view (§5a): a narrow reading column so the code field + button don't span
         a wide kitchen display. The hint + field + button stack via the .screen column gap above. */
      .enrol {
        max-width: 24rem;
      }

      .enrol-hint {
        margin: 0;
        color: var(--wt-color-text-muted);
      }

      /* The enrol error banner — the same danger-on-surface pairing the app + lock screen use (a11y-safe
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

  /** The HTTP face of the till — the screen fetches stations + the active queue and writes advances
   * through it (owned by the screen, threaded from the app, like `till-lock-screen`). */
  @property({ attribute: false }) api!: TillApi;
  /** Per-line (default) vs whole-ticket bump — the `bump_mode` venue setting, threaded from the app and
   * passed straight to the widget. */
  @property() bumpMode: BumpMode = "line";
  /** Who owns the per-course fire — the `fire_control` venue setting, threaded from the app and passed
   * straight to the widget. `kitchen` surfaces the display's "Empezar curso" action; `waiter` (the
   * default) surfaces none here (the tab screen fires — Task 7). */
  @property() fireControl: FireControlMode = "waiter";
  /**
   * DEVICE MODE (device-identity-1 §5a). Default `false` — the EXISTING session-gated operator path
   * (listStations → picker → `advanceTicketItem`) runs exactly as before. When `true` the screen is an
   * always-on ENROLLED display: it probes `getDeviceStation()` (no login), renders that ONE bound
   * station's queue with NO picker and NO Back-to-counter, and bumps through `deviceAdvance`; a 401
   * (`device.unauthorized`) shows the enrol view instead. Threaded from the app (boot probe, or the lock
   * screen's "set up" affordance).
   */
  @property() deviceMode = false;
  /**
   * The device station the app ALREADY probed at cold boot (device-identity-1 §5a), handed in so the
   * screen does not fetch `GET /api/device/station` a SECOND time on mount (the boot probe and the mount
   * `#loadDevice` were both reading the same authenticated queue — one read per enrolled-display boot is
   * enough). Present only on the cold-boot path (`till-app`'s `#boot` stashes the probe result); absent
   * on a fresh-display / lock-screen "set up" entry, where the probe never ran and `#loadDevice` fetches
   * (a 401 there is the enrol-view case). Adopted ONCE — a later enrol re-probe always fetches the freshly
   * bound station (see {@link #loadDevice}).
   */
  @property({ attribute: false }) initialDeviceStation?: DeviceStation;
  /**
   * Whether this screen is mounted INSIDE a card host (SP-B2.2) rather than as a standalone screen.
   * When embedded, it drops its own `<header class="head">` (the `<h1 class="title">` + the
   * `showBack`-gated Back button) on BOTH the queue surface and the enrol view — the card host supplies
   * that chrome — but KEEPS the board/rail `view-toggle`, which is station BODY function (the kitchen
   * still flips lens from inside a card), rendered in the always-present `.actions` bar. Mirrors the
   * floor screen's `embedded` seam (`till-floor-screen.ts`). Default `false` keeps the standalone screen
   * fully functional — its own header + Back, and the same `view-toggle`. NOTE the standalone DOM is NOT
   * byte-identical to before this seam: the `view-toggle` moved OUT of the header into that sibling
   * `.actions` bar (so it can survive embedding), the same restructure the floor screen carries — every
   * existing station test still passes because none asserted the toggle's container.
   */
  @property({ type: Boolean }) embedded = false;

  /** The venue's active stations (fetched once on connect). Operator path only. */
  @state() private stations: Station[] = [];
  /** The requested or default operator station; device mode uses only its enrolled station. */
  @state() private activeStationId?: string;
  /** The active station's queue, grouped by order (reloaded after every advance). */
  @state() private groups: StationQueueGroup[] = [];
  /** The lens: kanban board (default) or ticket rail, flipped by the toggle. */
  @state() private view: "kanban" | "rail" = "kanban";
  /**
   * Which device-mode sub-view is showing (ignored unless {@link deviceMode}). Default `queue` — an
   * ENROLLED display is the steady state, so it shows the queue chrome (empty until the probe resolves)
   * rather than flashing the enrol view first; a failed/401 probe flips it to `enrol`.
   */
  @state() private deviceView: "queue" | "enrol" = "queue";
  /** The pairing code the operator is typing into the enrol view. */
  @state() private enrolCode = "";
  /** The raw error CODE of a rejected enrol, surfaced via {@link codeMessage} (never the raw code) — or
   * `undefined` for none. Cleared as the operator retypes. */
  @state() private enrolErrorCode?: string;
  /** Reentry guard for enrolment — one in-flight `enrolDevice` at a time (a double-tap is a no-op). */
  @state() private enrolling = false;
  /**
   * The raw error CODE of a rejected reprint (KDS-4 §3d), surfaced via {@link codeMessage} in the operator
   * banner (never the raw code) — or `undefined` for none. UNLIKE the advance/collect/fire levers, a
   * reprint is swallow-and-reloaded by nobody: it changes no order state, so a reload reconciles nothing
   * and a silent failure would leave the operator no feedback that the ticket did not reprint. So it takes
   * the enrol path's shape — try/catch → localised banner — not the degrade-gracefully `#advance` swallow.
   * Only ever set in operator mode ({@link #onReprintOrder} guards device mode), so the banner is
   * operator-only without a separate gate. Cleared on the next reprint attempt.
   */
  @state() private reprintErrorCode?: string;
  /** Whether {@link initialDeviceStation} has been adopted (a one-shot — see {@link #loadDevice}). Not
   * reactive: it gates a fetch, never the render. */
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

  /** Fetch the operator's stations, then validate the latest requested station before loading its queue. */
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
   * DEVICE MODE probe (§5a): read the display's OWN bound station + queue with no login. A 200 renders
   * the queue; a 401 (`device.unauthorized`) — or ANY probe failure — flips to the enrol view, the only
   * actionable state a device without a session has (a transient failure recovers on a page reload,
   * which re-probes). State-only after the await, so no `isConnected` guard (the sibling screens' reasoning).
   */
  async #loadDevice(): Promise<void> {
    // Cold-boot fast path: the app already probed the device station and handed it in as
    // `initialDeviceStation`, so adopt it ONCE and skip the redundant fetch — one authenticated queue
    // read per enrolled-display boot, not two. `#initialConsumed` makes it a one-shot: every LATER call
    // (the enrol re-probe in `#enrol`, or a fresh-display mount that carried no prop) fetches instead, so
    // a freshly enrolled display still reads its newly bound station rather than reusing a stale initial.
    if (this.initialDeviceStation !== undefined && !this.#initialConsumed) {
      this.#initialConsumed = true;
      const { station } = this.initialDeviceStation;
      this.activeStationId = station.id;
      this.groups = station.queue;
      this.deviceView = "queue";
      return;
    }
    try {
      const { station } = await this.api.getDeviceStation();
      this.activeStationId = station.id;
      this.groups = station.queue;
      this.deviceView = "queue";
    } catch {
      this.deviceView = "enrol";
    }
  }

  /** Reload the active queue, ignoring operator responses superseded by a later request. A failed
   * read retains the current queue. Device mode reads through its bound-station probe. */
  async #reload(): Promise<void> {
    if (this.deviceMode) {
      try {
        const { station } = await this.api.getDeviceStation();
        this.activeStationId = station.id;
        this.groups = station.queue;
      } catch {
        // Non-fatal — leave the last-known queue; a mid-session revocation recovers on reload.
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

  /** Switch to another station's queue (a picker tap). */
  async #selectStation(id: string, replace = false): Promise<void> {
    if (this.deviceMode) return;
    if (this.activeStationId !== id) this.groups = [];
    this.activeStationId = id;
    if (this.#ownsStationPath()) this.#url.write({ "till-station": id }, replace);
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
   * Run one advance verb, then reconcile on BOTH paths: a rejected move (a race, a since-advanced line)
   * is SWALLOWED and the reload converges the queue on server truth. Shared by the per-line and
   * whole-ticket handlers — the degrade-gracefully shape the method docs describe.
   */
  async #advance(call: () => Promise<void>): Promise<void> {
    try {
      await call();
    } catch {
      // Non-fatal — the reload reconciles the queue to server truth.
    }
    await this.#reload();
  }

  /**
   * A per-line bump from the widget (`bump_mode = line`, the source of truth). Handle it HERE and stop it
   * — the app must not also see it (it owns the counter's own default-station widget). Advance, then
   * reload on BOTH paths so a rejected move (a race, a since-advanced line) reconciles to server truth. In
   * DEVICE mode the bump goes through the device-scoped `deviceAdvance` (no session) instead.
   */
  async #onAdvanceTicketItem(event: Event): Promise<void> {
    event.stopPropagation();
    const { itemId, to } = (
      event as CustomEvent<{ itemId: string; to: Exclude<TicketState, "queued"> }>
    ).detail;
    await this.#advance(() =>
      this.deviceMode ? this.api.deviceAdvance(itemId, to) : this.api.advanceTicketItem(itemId, to),
    );
  }

  /**
   * A whole-ticket bump from the widget (`bump_mode = ticket`, the convenience). Same handle-here-and-stop
   * + advance-then-reconcile shape as {@link #onAdvanceTicketItem}, over the whole-ticket verb. In DEVICE
   * mode the server has ONLY a per-line device advance, so the whole-ticket bump expands to one
   * `deviceAdvance` per advanceable item ({@link #deviceAdvanceTicket}).
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
    await this.#advance(() =>
      this.deviceMode
        ? this.#deviceAdvanceTicket(orderId, to)
        : this.api.advanceTicket(orderId, stationId, to),
    );
  }

  /**
   * The device-mode expansion of a whole-ticket bump: advance every FIRED item of `orderId` at the bound
   * station whose legitimate next step is `to` (see {@link ADVANCE_FROM}), one `deviceAdvance` each —
   * mirroring what a per-line tap on each would do, so a held course or a wrong-state line is skipped
   * rather than sent an invalid transition. Reads the group off the last-loaded {@link groups}.
   */
  async #deviceAdvanceTicket(orderId: string, to: Exclude<TicketState, "queued">): Promise<void> {
    const group = this.groups.find((candidate) => candidate.orderId === orderId);
    if (group === undefined) return;
    for (const item of group.items) {
      if (item.firedAt !== null && item.state === ADVANCE_FROM[to]) {
        await this.api.deviceAdvance(item.id, to);
      }
    }
  }

  /** Capture the enrol code field's new value and clear any stale error as the operator retypes. */
  #onEnrolCode(event: Event): void {
    event.stopPropagation();
    this.enrolCode = (event as CustomEvent<{ value: string }>).detail.value;
    this.enrolErrorCode = undefined;
  }

  /**
   * Redeem the entered pairing code (§5a): `enrolDevice` sets the trusted device cookie server-side, then
   * a re-probe ({@link #loadDevice}) drops the display straight into its bound queue. The code is sent
   * VERBATIM — the server normalises it, the client does not. A refused code (invalid/expired) stays on
   * the enrol view with the localized reason ({@link enrolErrorCode}, resolved by {@link codeMessage} — never
   * the raw wire code) so the operator can try a fresh one. Reentry-guarded and blank-guarded like the
   * lock screen's PIN submit.
   */
  async #enrol(): Promise<void> {
    if (this.enrolCode === "" || this.enrolling) return;
    this.enrolling = true;
    this.enrolErrorCode = undefined;
    try {
      await this.api.enrolDevice(this.enrolCode);
      this.enrolCode = "";
      await this.#loadDevice();
    } catch (error) {
      this.enrolErrorCode = (error as { code?: string }).code ?? "server.internal";
    } finally {
      this.enrolling = false;
    }
  }

  /**
   * A Mode-P collect from the widget's rail lens (a settled order's handover, KDS-1 §3e). Handle it HERE
   * and stop it — the app owns the counter's own default-station widget, so it must not double-handle this
   * screen's. `markCollected` stamps the order-level `collected_at`; the reload then drops the handed-over
   * order off the display. Same run-then-reconcile shape as the advance handlers ({@link #advance}), so a
   * rejected collect (a race, an already-collected order) is swallowed and the reload converges on truth.
   */
  async #onMarkCollected(event: Event): Promise<void> {
    event.stopPropagation();
    // DEVICE mode has no collect route (advance-only, §3d) — the advance-only widget never renders the
    // button, so this cannot fire from the UI; guard anyway (belt-and-braces), so a stray composed event
    // never reaches the session `markCollected` a device holds no cookie for.
    if (this.deviceMode) return;
    const { orderId } = (event as CustomEvent<{ orderId: string }>).detail;
    await this.#advance(() => this.api.markCollected(orderId));
  }

  /**
   * A kitchen-fire from the widget (`fire_control = 'kitchen'`, KDS-2 §5a) — release a held course.
   * Handle it HERE and stop it (the app owns the counter's own default-station widget, so it must not
   * double-handle this screen's), then `fireCourse` and reload on BOTH paths so a rejected fire (a race,
   * an already-fired or now-unknown course) reconciles to server truth — the same run-then-reconcile
   * shape as the advance/collect handlers ({@link #advance}). The reload drops the released course's
   * greying and makes its lines advanceable.
   */
  async #onFireCourse(event: Event): Promise<void> {
    event.stopPropagation();
    // DEVICE mode has no fire route (advance-only, §3d) — same belt-and-braces guard as
    // {@link #onMarkCollected}: the advance-only widget hides the button, so a stray composed event never
    // reaches the session `fireCourse`.
    if (this.deviceMode) return;
    const { orderId, courseId } = (event as CustomEvent<{ orderId: string; courseId: string }>)
      .detail;
    await this.#advance(() => this.api.fireCourse(orderId, courseId));
  }

  /**
   * A reprint-order from the widget (KDS-4 §3d) — re-send this order's current kitchen tickets. Handle it
   * HERE and stop it (the app owns the counter's own default-station widget, so it must not double-handle
   * this screen's). NOT run through {@link #advance}: reprint changes no order state, so there is nothing to
   * reload/reconcile, and a swallow would hide a failure the operator needs to see (the ticket did not come
   * out). Instead it takes the enrol path's shape — try/catch → a localised {@link reprintErrorCode} banner
   * (via {@link codeMessage}, never the raw wire code). DEVICE mode has no reprint route (session-guarded,
   * the R-K guard): {@link showReprint} is off there so the button never renders, and this guards anyway
   * (belt-and-braces, like {@link #onMarkCollected}/{@link #onFireCourse}) so a stray composed event never
   * reaches the session verb a device holds no cookie for.
   */
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

  /** The SESSION-GATED operator display (KDS-1): the shared queue surface WITH the Back-to-counter
   * control, over the station-picker body (or the no-stations message). */
  #renderOperator(): TemplateResult {
    return this.#renderQueueSurface({
      showBack: true,
      body: this.stations.length === 0 ? this.#noStations() : this.#body(),
    });
  }

  /**
   * The DEVICE-mode display (§5a): the enrol view when this display holds no valid device cookie, else
   * the shared queue surface with NO Back-to-counter and NO picker (a device has one fixed station and
   * never logged in) over an ADVANCE-ONLY queue. The advance/collect/fire listeners are the SAME as the
   * operator path — wired once by the shared surface; the handlers branch on {@link deviceMode} to route
   * through the device-scoped verbs, and {@link #onMarkCollected}/{@link #onFireCourse} keep their
   * device-mode guards as defense-in-depth (§3d).
   */
  #renderDevice(): TemplateResult {
    if (this.deviceView === "enrol") return this.#renderEnrol();
    return this.#renderQueueSurface({ showBack: false, body: this.#queue(true) });
  }

  /**
   * The queue surface SHARED by the operator and device displays: the `<section class="screen">`, the
   * header (title + board/rail view toggle, plus the Back-to-counter control when `showBack`), and the
   * FOUR queue events wired to their handlers — byte-identical on both paths, which is the whole point of
   * the extraction (the two renders repeated it verbatim). The paths differ only in `showBack` and the
   * `body` they pass (the picker/no-stations body vs an advance-only queue). The four `@…` listeners are
   * wired here on BOTH paths deliberately: in device mode the advance-only widget never renders the
   * collect/fire buttons, but the listeners stay bound and the handlers self-guard (belt-and-braces, §3d)
   * so a stray composed event can never reach a session verb a device holds no cookie for.
   */
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

  /** The enrol view (§5a): a labelled pairing-code field → "Set up". On a refused code it shows the
   * localized reason ({@link codeMessage}); on success the display re-probes into its bound queue. */
  #renderEnrol(): TemplateResult {
    return html`
      <section class="screen enrol" aria-label=${t("device.enrol_title")}>
        ${
          this.embedded
            ? nothing
            : html`<header class="head">
                <h1 class="title">${t("device.enrol_title")}</h1>
              </header>`
        }
        <p class="enrol-hint">${t("device.enrol_hint")}</p>
        ${
          this.enrolErrorCode
            ? html`<p class="error" role="alert">${codeMessage(this.enrolErrorCode)}</p>`
            : nothing
        }
        <wt-input
          @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-enrol-submit]"))}
          class="enrol-code"
          data-enrol-code
          .label=${t("device.enrol_code")}
          .value=${this.enrolCode}
          @wt-change=${(event: Event) => this.#onEnrolCode(event)}
        ></wt-input>
        <wt-button
          class="enrol-submit"
          data-enrol-submit
          variant="primary"
          ?disabled=${this.enrolCode === "" || this.enrolling}
          @click=${() => void this.#enrol()}
        >
          ${t("device.enrol_submit")}
        </wt-button>
      </section>
    `;
  }

  /** The venue has no configured stations — nothing to display or route to. */
  #noStations(): TemplateResult {
    return html`<p class="empty">${t("station.no_stations")}</p>`;
  }

  /** The picker + the active station's queue (the operator body). */
  #body(): TemplateResult {
    return html`
      <nav class="picker" aria-label=${t("station.pick")}>
        ${this.stations.map((station) => this.#pick(station))}
      </nav>
      ${this.#queue(false)}
    `;
  }

  /** The active/bound station's queue widget, shared by both paths. `advanceOnly` hides the collect/fire
   * controls (device mode, §3d); the operator path passes `false` and keeps them. `showReprint` is its
   * inverse — the per-order reprint (KDS-4 §3d) shows in OPERATOR mode only (`!advanceOnly`), since the
   * reprint route is session-guarded and a device holds no session (the R-K guard). This is the ONLY
   * caller of the widget in the station screen, so setting `showReprint` here cannot leak reprint into the
   * counter/app widget instances (which never mount through this method). The other props are identical on
   * both paths, so this is the one place they are threaded to the widget. */
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
