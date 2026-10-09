import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { UrlStateController, baseStyles } from "@waitron/ui";
import { tillPath } from "../navigation.js";
import { clockTime, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import {
  kitchenScreenNoticeText,
  lostSlotLine,
  unavailableStyles,
} from "../kitchen-screen-notice.js";
import "../widgets/stale-since.js";
import "../widgets/station-queue.js";
import "../widgets/station-today.js";
import type {
  BumpMode,
  FireControlMode,
  FireKitchenGroupDetail,
  MergedQueueGroup,
} from "../widgets/station-queue.js";
import type {
  DeviceStationScreen,
  KitchenNotice,
  ResolvedKitchenScreen,
  ScreenSlot,
  Station,
  StationQueueGroup,
  StationPrinterDown,
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

/** How often the screen re-reads its queue and notices (plan decision D11). */
const REFRESH_MS = 15_000;

/**
 * How long a refresh read may stay out before it is cancelled: longer than {@link REFRESH_MS}, so a
 * slow server's answer still lands, and due well before the tick after next.
 */
const READ_LIMIT_MS = 25_000;

const viewKey = (deviceId: string): string => `waitron.stationScreenView.${deviceId}`;

type DeviceStation = DeviceStationScreen["stations"][number];
type WorkedStation = Extract<DeviceStation, { queue: StationQueueGroup[] }>;

/** A station whose queue the display works: available, or switched off on its own page. */
const worked = (station: DeviceStation): station is WorkedStation =>
  station.available || station.switchedOff;

/** Whether a station's section draws its queue: available, or switched off with work still waiting
 *  there (owner 2026-10-09). */
const drawsQueue = (station: DeviceStation): station is WorkedStation =>
  station.available ||
  (worked(station) && (station.queue.length > 0 || station.notices.length > 0));

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
    unavailableStyles,
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

      /* A sibling of the header, never inside it, so the view toggle and the out-of-date banner survive
         when an embedded card host drops the header. */
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

      .stale {
        margin: 0;
      }

      .table-changed,
      .printer-down {
        margin: 0;
      }

      .stale[data-stale],
      .table-changed,
      .printer-down {
        flex-basis: 100%;
        padding: var(--wt-space-2) var(--wt-space-3);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-warning);
        color: var(--wt-color-on-warning);
        font-weight: var(--wt-font-weight-bold);
      }

      .device-station,
      .station-controls {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }

      .station-name {
        margin: 0;
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }

      .choose-again {
        margin: 0;
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
   * An always-on ENROLLED display: no login, its kitchen screen's stations, no picker and no
   * Back-to-counter. A 401 on its probe emits `device-unauthorized` so the app re-boots through the
   * front door.
   */
  @property() deviceMode = false;
  /** The screen the app already probed at cold boot, adopted ONCE so the mount does not read it again. */
  @property({ attribute: false }) initialDeviceStation?: DeviceStationScreen;
  /** Keys the remembered stacked-or-merged choice, so each kitchen display keeps its own. */
  @property({ attribute: false }) deviceId?: string;
  /** Mounted inside a card host, which supplies the header; the view toggle and the out-of-date banner stay. */
  @property({ type: Boolean }) embedded = false;

  @state() private stations: Station[] = [];
  /** The device's chosen stations a narrowing took away, shown above the picker. */
  @state() private lostStations: ScreenSlot[] = [];
  /** A narrowing took the device's station screen itself. */
  @state() private stationScreenGone = false;
  /** A read of the device's choice has answered; until one does, every station shows. */
  #choiceRead = false;
  #choiceRequest = 0;
  #appliedChoice = 0;
  /** The stations the device chose, or null when it shows every station. */
  #chosenIds: ReadonlySet<string> | null = null;
  /** Every station, chosen or not, so a closed station names where its dishes go. */
  @state() private allStations: Station[] = [];
  @state() private activeStationId?: string;
  @state() private groups: StationQueueGroup[] = [];
  @state() private printersDown: StationPrinterDown[] = [];
  @state() private notices: KitchenNotice[] = [];
  @state() private deviceStations: DeviceStationScreen["stations"] = [];
  @state() private view: "kanban" | "rail" = "kanban";
  @state() private merged = false;
  /**
   * UNLIKE the advance/collect/fire levers, a failed reprint is not swallowed: it changes no order state,
   * so a reload reconciles nothing and a silent failure would leave the operator no feedback.
   */
  @state() private reprintErrorCode?: string;
  @state() private acknowledgeFailed = false;
  @state() private stale = false;
  /** The card whose group command was refused because its party changed since the queue was read:
   * shown by the next successful read, and gone at the one after. */
  @state() private tableChanged: string | null = null;
  #tableChangedNext: string | null = null;
  #lastGoodAt = new Date();
  #initialConsumed = false;
  #refreshTimer?: ReturnType<typeof setInterval>;
  readonly #refreshReads = new Set<AbortController>();
  /**
   * Notices this screen has acknowledged, filtered out of every answer until one arrives without them:
   * a read that set out before the acknowledgement landed still lists the notice.
   */
  readonly #acknowledged = new Set<string>();

  /** Numbers every queue read; an answer is used only when its read set out after the one on screen. */
  #queueRequest = 0;
  #appliedRequest = 0;
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
      this.activeStationId = undefined;
      if (this.#ownsStationPath()) this.#url.write({ "till-station": null }, true);
      return;
    }
    await this.#selectStation(active.id, true);
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("deviceId")) this.merged = this.#rememberedMerged();
  }

  /** The read is wrapped because localStorage can throw in a private window. */
  #rememberedMerged(): boolean {
    if (this.deviceId === undefined) return false;
    try {
      return localStorage.getItem(viewKey(this.deviceId)) === "merged";
    } catch {
      return false;
    }
  }

  #toggleMerged(): void {
    this.merged = !this.merged;
    if (this.deviceId === undefined) return;
    try {
      localStorage.setItem(viewKey(this.deviceId), this.merged ? "merged" : "stacked");
    } catch {
      // no storage → the choice lasts until the next load
    }
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.deviceMode) {
      void this.#loadDevice();
    } else {
      void this.#load();
    }
    this.#refreshTimer = setInterval(() => void this.#refresh(), REFRESH_MS);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearInterval(this.#refreshTimer);
    for (const read of this.#refreshReads) read.abort();
    this.#refreshReads.clear();
  }

  /**
   * Every tick reads afresh, even when the previous tick's read has not answered, so one read that
   * never answers cannot freeze the display; that read is cancelled at {@link READ_LIMIT_MS}, which
   * counts as a failed refresh.
   */
  async #refresh(): Promise<void> {
    const read = new AbortController();
    const limit = setTimeout(() => read.abort(), READ_LIMIT_MS);
    this.#refreshReads.add(read);
    try {
      if (this.deviceMode) await this.#loadDevice(read.signal);
      else await this.#load(read.signal);
    } finally {
      clearTimeout(limit);
      this.#refreshReads.delete(read);
    }
  }

  #isNewest(request: number): boolean {
    if (request <= this.#appliedRequest) return false;
    this.#appliedRequest = request;
    return true;
  }

  #readSucceeded(): void {
    this.#lastGoodAt = new Date();
    this.stale = false;
    this.tableChanged = this.#tableChangedNext;
    this.#tableChangedNext = null;
  }

  /** A failure of a read older than the answer on screen says nothing about that answer. */
  #readFailed(request: number): void {
    if (request > this.#appliedRequest) this.stale = true;
  }

  #adoptNotices(notices: KitchenNotice[]): void {
    this.#forgetUnlisted(notices);
    this.notices = this.#unacknowledged(notices);
  }

  #forgetUnlisted(notices: KitchenNotice[]): void {
    const listed = new Set(notices.map((notice) => notice.id));
    for (const id of this.#acknowledged) if (!listed.has(id)) this.#acknowledged.delete(id);
  }

  #unacknowledged(notices: KitchenNotice[]): KitchenNotice[] {
    return notices.filter((notice) => !this.#acknowledged.has(notice.id));
  }

  /**
   * The picker lists the device's chosen stations, or every station when it has no choice; a choice
   * a narrowing emptied lists none. Run again at each refresh, keeping the open station when it is
   * still listed. Once a read has answered, a failed one keeps what it said.
   */
  async #load(signal?: AbortSignal): Promise<void> {
    const request = ++this.#choiceRequest;
    const choice = this.#readStationChoice(signal);
    try {
      const listed = await this.api.listStations({ signal });
      const screen = await choice;
      if (request < this.#appliedChoice) return;
      this.#appliedChoice = request;
      if (screen !== null || !this.#choiceRead) {
        this.#choiceRead = screen !== null;
        const slots = screen?.stations ?? [];
        this.#chosenIds = screen
          ? new Set(slots.filter((slot) => slot.available).map((slot) => slot.id))
          : null;
        this.lostStations = slots.filter((slot) => !slot.available);
        this.stationScreenGone = screen?.available === false;
      }
      const chosen = this.#chosenIds;
      this.allStations = listed;
      this.stations = chosen === null ? listed : listed.filter((station) => chosen.has(station.id));
      this.#stationsLoaded = true;
    } catch {
      if (request > this.#appliedChoice) this.stale = true;
      return;
    }
    if (!this.isConnected) return;
    if (this.stations.some((station) => station.id === this.activeStationId))
      await this.#reload(signal);
    else await this.#restoreStation();
  }

  /** The device's station screen; undefined when it has none, null when the read failed. */
  async #readStationChoice(
    signal: AbortSignal | undefined,
  ): Promise<ResolvedKitchenScreen | undefined | null> {
    try {
      const { kitchenScreens } = await this.api.getDeviceIdentity({ signal });
      return kitchenScreens.find((screen) => screen.kind === "station");
    } catch {
      return null;
    }
  }

  /**
   * Any failure other than `device.unauthorized` is transient: keep the last-known queue rather than
   * tearing the kiosk down for a blip.
   */
  async #loadDevice(signal?: AbortSignal): Promise<void> {
    // A one-shot, so a later re-connect fetches and never reuses a stale initial.
    if (this.initialDeviceStation !== undefined && !this.#initialConsumed) {
      this.#initialConsumed = true;
      this.#adoptDeviceStation(this.initialDeviceStation);
      return;
    }
    const request = ++this.#queueRequest;
    try {
      const answer = await this.#readDeviceStation(signal);
      if (this.#isNewest(request)) this.#adoptDeviceStation(answer);
    } catch (error) {
      if ((error as { code?: string }).code === "device.unauthorized") {
        this.dispatchEvent(
          new CustomEvent("device-unauthorized", { bubbles: true, composed: true }),
        );
      } else {
        this.#readFailed(request);
      }
    }
  }

  #readDeviceStation(signal: AbortSignal | undefined): Promise<DeviceStationScreen> {
    return signal === undefined
      ? this.api.getDeviceStationScreen()
      : this.api.getDeviceStationScreen({ signal });
  }

  #adoptDeviceStation({ stations }: DeviceStationScreen): void {
    this.#forgetUnlisted(stations.flatMap((station) => (worked(station) ? station.notices : [])));
    this.deviceStations = stations.map((station) =>
      worked(station)
        ? {
            ...station,
            printersDown: station.printersDown ?? [],
            notices: this.#unacknowledged(station.notices),
          }
        : station,
    );
    this.#readSucceeded();
  }

  async #reload(signal?: AbortSignal, refreshStations = false): Promise<void> {
    if (this.deviceMode) {
      const request = ++this.#queueRequest;
      try {
        const answer = await this.#readDeviceStation(signal);
        if (this.#isNewest(request)) this.#adoptDeviceStation(answer);
      } catch {
        this.#readFailed(request);
      }
      return;
    }
    if (this.activeStationId === undefined) return;
    const request = ++this.#queueRequest;
    try {
      const [{ items, notices, printersDown }, stations] = await Promise.all([
        signal === undefined
          ? this.api.getStationQueue(this.activeStationId)
          : this.api.getStationQueue(this.activeStationId, { signal }),
        refreshStations ? this.api.listStations({ signal }) : Promise.resolve(this.allStations),
      ]);
      if (this.isConnected && this.#isNewest(request)) {
        const chosen = this.#chosenIds;
        this.allStations = stations;
        this.stations =
          chosen === null ? stations : stations.filter((station) => chosen.has(station.id));
        this.groups = items;
        this.printersDown = printersDown ?? [];
        this.#adoptNotices(notices);
        this.#readSucceeded();
      }
    } catch {
      this.#readFailed(request);
    }
  }

  async #selectStation(id: string, replace = false): Promise<void> {
    // No queue read happens before the first pick (`#reload` returns while no station is picked),
    // so there is nothing to reset and the clock keeps the creation time.
    if (this.activeStationId !== undefined && this.activeStationId !== id) {
      this.groups = [];
      this.notices = [];
      this.printersDown = [];
      // Reads still out are for the station being left.
      this.#appliedRequest = this.#queueRequest;
      this.#lastGoodAt = new Date();
      this.stale = false;
    }
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
        ? this.#deviceAdvanceTicket(orderId, stationId, to)
        : this.api.advanceTicket(orderId, stationId, to),
    );
  }

  async #deviceAdvanceTicket(
    orderId: string,
    stationId: string,
    to: Exclude<TicketState, "queued">,
  ): Promise<void> {
    const station = this.deviceStations.find((candidate) => candidate.id === stationId);
    if (station === undefined || !worked(station)) return;
    const group = station.queue.find((candidate) => candidate.orderId === orderId);
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

  /** Refused `party.out_of_date`, the queue is read again and the cook decides; nothing is resent. */
  async #onFireKitchenGroup(event: Event): Promise<void> {
    event.stopPropagation();
    if (this.deviceMode) return;
    const { partyId, groupId, expectedPartyRevision } = (
      event as CustomEvent<FireKitchenGroupDetail>
    ).detail;
    const card = this.#cardOfGroup(partyId, groupId);
    this.tableChanged = null;
    this.#tableChangedNext = null;
    try {
      await this.api.fireGroup(partyId, groupId, {
        submissionId: crypto.randomUUID(),
        expectedPartyRevision,
      });
    } catch (error) {
      if ((error as { code?: string }).code === "party.out_of_date") this.#tableChangedNext = card;
    }
    await this.#reload();
  }

  #tableChangedMessage(card: string): string {
    const changed =
      card === ""
        ? t("station.table_changed_unnamed")
        : t("station.table_changed_named").replace("{table}", () => card);
    return `${changed} ${t("station.table_changed")}`;
  }

  /** What the card holding the group is called on screen: its label, else its order number. */
  #cardOfGroup(partyId: string, groupId: string): string {
    const card =
      this.groups.find(
        (group) =>
          group.party?.id === partyId && group.items.some((item) => item.group?.id === groupId),
      ) ?? this.groups.find((group) => group.party?.id === partyId);
    return card === undefined ? "" : (card.label ?? `#${card.orderNumber}`);
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

  /** `kitchen_notice.not_found` means another screen at this station acknowledged it first: the
   * notice is gone either way, so the row goes rather than an error showing. */
  async #onAcknowledgeNotice(event: Event): Promise<void> {
    event.stopPropagation();
    const { noticeId } = (event as CustomEvent<{ noticeId: string }>).detail;
    this.acknowledgeFailed = false;
    try {
      await (this.deviceMode
        ? this.api.deviceAcknowledgeKitchenNotice(noticeId)
        : this.api.acknowledgeKitchenNotice(noticeId));
    } catch (error) {
      if ((error as { code?: string }).code !== "kitchen_notice.not_found") {
        this.acknowledgeFailed = true;
        return;
      }
    }
    this.#acknowledged.add(noticeId);
    this.notices = this.notices.filter((notice) => notice.id !== noticeId);
    this.deviceStations = this.deviceStations.map((station) =>
      worked(station) ? { ...station, notices: this.#unacknowledged(station.notices) } : station,
    );
  }

  override render() {
    return this.deviceMode ? this.#renderDevice() : this.#renderOperator();
  }

  #renderOperator(): TemplateResult {
    return this.#renderQueueSurface({
      showBack: true,
      body: html`${
        this.stationScreenGone
          ? html`<p class="unavailable" role="status" data-unavailable>
              ${kitchenScreenNoticeText({ kind: "unavailable", screen: "station" })}
            </p>`
          : nothing
      }
      ${this.lostStations.map((station) => this.#unavailable(station.name))}
      ${
        this.stations.length > 0
          ? this.#body()
          : this.stationScreenGone || this.lostStations.length > 0
            ? nothing
            : this.#noStations()
      }`,
    });
  }

  #renderDevice(): TemplateResult {
    const [only] = this.deviceStations;
    const several = this.deviceStations.length > 1;
    if (this.deviceStations.length > 0 && !this.deviceStations.some(drawsQueue))
      return this.#renderQueueSurface({
        showBack: false,
        showViews: false,
        body: html`${this.deviceStations.map((station) => this.#unavailable(station.name))}
          <p class="choose-again" data-choose-again>${t("kitchen_screen.choose_again")}</p>`,
      });
    const body =
      this.deviceStations.length === 1 && only?.available === true
        ? html`${this.#today(only)}${this.#queue(true, only)}`
        : several && this.merged
          ? this.#mergedBody()
          : html`${this.deviceStations.map((station) => this.#deviceSection(station))}`;
    return this.#renderQueueSurface({ showBack: false, showMerge: several, body });
  }

  #mergedBody(): TemplateResult {
    const available = this.deviceStations.filter(
      (station): station is WorkedStation & { available: true } => station.available,
    );
    const drawn = this.deviceStations.filter(drawsQueue);
    // A stable sort, so two orders queued at the same moment keep their stations' order.
    const queue: MergedQueueGroup[] = drawn
      .flatMap((station) => station.queue.map((group) => ({ ...group, stationId: station.id })))
      .sort((a, b) => Date.parse(a.queuedAt) - Date.parse(b.queuedAt));
    return html`${available.map(
        (station) =>
          html`<section
            class="station-controls"
            data-station-controls=${station.id}
            aria-label=${station.name}
          >
            <h2 class="station-name">${station.name}</h2>
            ${this.#today(station)}
          </section>`,
      )}
      ${this.deviceStations.map((station) =>
        station.available
          ? this.#printersDown(station.printersDown, station.name)
          : html`${this.#unavailable(station.name)}${
              drawsQueue(station) ? this.#printersDown(station.printersDown, station.name) : nothing
            }`,
      )}
      <till-station-queue
        .groups=${queue}
        .notices=${drawn.flatMap((station) => station.notices)}
        .stationNames=${new Map(drawn.map((station) => [station.id, station.name]))}
        .view=${this.view}
        .bumpMode=${this.bumpMode}
        .fireControl=${this.fireControl}
        .advanceOnly=${true}
      ></till-station-queue>`;
  }

  /** The station's state today, and closing or reopening it for today. */
  #today(station: WorkedStation): TemplateResult {
    const { today } = station;
    return html`<till-station-today
      .api=${this.api}
      .deviceMode=${true}
      .station=${{
        id: station.id,
        name: station.name,
        active: today.why !== "switched_off",
        isDefault: today.isDefault,
        open: today.open,
        byHand: today.byHand,
        sendsTo: today.sendsTo?.id ?? null,
        why: today.why,
      }}
      .stations=${today.sendsTo ? [today.sendsTo] : []}
      @station-today-changed=${(event: Event) => {
        event.stopPropagation();
        void this.#reload();
      }}
    ></till-station-today>`;
  }

  #unavailable(name: string): TemplateResult {
    return html`<p class="unavailable" role="status" data-station-unavailable>
      ${lostSlotLine("station", name)}
    </p>`;
  }

  #deviceSection(station: DeviceStation): TemplateResult {
    return html`<section
      class="device-station"
      data-device-station=${station.id}
      aria-label=${station.name}
    >
      ${
        station.available
          ? html`<h2 class="station-name">${station.name}</h2>
              ${this.#today(station)} ${this.#queue(true, station)}`
          : drawsQueue(station)
            ? html`${this.#unavailable(station.name)} ${this.#today(station)}
              ${this.#queue(true, station)}`
            : this.#unavailable(station.name)
      }
    </section>`;
  }

  #renderQueueSurface(opts: {
    showBack: boolean;
    showViews?: boolean;
    showMerge?: boolean;
    body: TemplateResult;
  }): TemplateResult {
    return html`
      <section
        class="screen"
        aria-label=${t("station.title")}
        @advance-ticket-item=${(event: Event) => void this.#onAdvanceTicketItem(event)}
        @advance-ticket=${(event: Event) => void this.#onAdvanceTicket(event)}
        @mark-collected=${(event: Event) => void this.#onMarkCollected(event)}
        @fire-course=${(event: Event) => void this.#onFireCourse(event)}
        @fire-kitchen-group=${(event: Event) => void this.#onFireKitchenGroup(event)}
        @reprint-order=${(event: Event) => void this.#onReprintOrder(event)}
        @acknowledge-notice=${(event: Event) => void this.#onAcknowledgeNotice(event)}
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
          ${
            opts.showViews === false
              ? nothing
              : html`<wt-button
                  class="view-toggle"
                  data-view-toggle
                  variant="secondary"
                  @click=${() => this.#toggleView()}
                >
                  ${this.view === "kanban" ? t("station.view_rail") : t("station.view_kanban")}
                </wt-button>`
          }
          ${
            opts.showMerge === true
              ? html`<wt-button
                  class="merge-toggle"
                  data-merge-toggle
                  variant="secondary"
                  @click=${() => this.#toggleMerged()}
                >
                  ${this.merged ? t("station.view_stacked") : t("station.view_merged")}
                </wt-button>`
              : nothing
          }
          <p class="stale" role="status" ?data-stale=${this.stale}>
            ${
              this.stale
                ? html`<till-stale-since .since=${this.#lastGoodAt}></till-stale-since>`
                : nothing
            }
          </p>
          ${
            this.tableChanged === null
              ? nothing
              : html`<p class="table-changed" role="status" data-table-changed>
                  ${this.#tableChangedMessage(this.tableChanged)}
                </p>`
          }
        </div>
        ${
          this.reprintErrorCode
            ? html`<p class="error" role="alert">${codeMessage(this.reprintErrorCode)}</p>`
            : nothing
        }
        ${
          this.acknowledgeFailed
            ? html`<p class="error" role="alert">${t("station.acknowledge_error")}</p>`
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
      <till-station-today
        .api=${this.api}
        .station=${this.stations.find((station) => station.id === this.activeStationId)}
        .stations=${this.allStations}
        @station-today-changed=${(event: Event) => {
          event.stopPropagation();
          void this.#reload(undefined, true);
        }}
      ></till-station-today>
      ${this.#queue(false, {
        id: this.activeStationId,
        queue: this.groups,
        notices: this.notices,
        printersDown: this.printersDown,
      })}
    `;
  }

  /** Reprint shows in OPERATOR mode only: the reprint route is session-guarded and a device holds no
   * session. */
  #queue(
    advanceOnly: boolean,
    station: {
      id: string | undefined;
      queue: StationQueueGroup[];
      notices: KitchenNotice[];
      printersDown: StationPrinterDown[];
    },
  ): TemplateResult {
    return html` ${this.#printersDown(station.printersDown)}
      <till-station-queue
        .groups=${station.queue}
        .notices=${station.notices}
        .view=${this.view}
        .bumpMode=${this.bumpMode}
        .fireControl=${this.fireControl}
        .stationId=${station.id}
        .advanceOnly=${advanceOnly}
        .showReprint=${!advanceOnly}
      ></till-station-queue>`;
  }

  /** In the merged view each line names its station, since the queue below mixes them. */
  #printersDown(printers: StationPrinterDown[], station?: string): TemplateResult[] {
    return printers.map((printer) => {
      const line = t("station.printer_down")
        .replace("{name}", () => printer.printerName)
        .replace("{time}", () => clockTime(Date.parse(printer.since)));
      return html`<p class="printer-down" role="status" data-printer-down>
        ${station === undefined ? line : `${station}: ${line}`}
      </p>`;
    });
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
      ${
        station.open
          ? station.name
          : t("station_today.picker_closed").replace("{station}", () => station.name)
      }
    </wt-button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-station-screen": TillStationScreen;
  }
}
