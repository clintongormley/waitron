import { ContentLanguageController, TickingClock, baseStyles } from "@waitron/ui";
import { LitElement, type TemplateResult, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { PHONE_WIDTH } from "../widgets/language-chooser-styles.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import {
  kitchenScreenNoticeText,
  lostSlotLine,
  unavailableStyles,
} from "../kitchen-screen-notice.js";
import "../widgets/stale-since.js";
import "../widgets/pass-board.js";
import "../widgets/kitchen-columns-dialog.js";
import { passColumnNames } from "../widgets/pass-board.js";
import type { PassMode } from "../state/pass-view.js";
import {
  type ColumnKey,
  type ColumnScope,
  type ColumnState,
  PASS_COLUMNS,
  toggleColumnCollapsed,
} from "../state/kitchen-columns.js";
import { KitchenColumnLayouts } from "../state/kitchen-column-layouts.js";
import type {
  DevicePassBoard,
  PassBoard,
  PassCard,
  PassReleaseAsk,
  TillApi,
} from "../api/client.js";

type BoardId = "all" | "pass" | "monitor";

const emptyBoard = (): PassBoard => ({
  held: [],
  toFire: [],
  inProgress: [],
  ready: [],
  overview: [],
});

/** A narrowing took every station, or every zone, the screen had: it shows nothing but its lines. */
function nothingLeft(screen: Pick<DevicePassBoard, "stations" | "zones">): boolean {
  const allTaken = (slots: readonly { available: boolean }[] | null) =>
    slots !== null && slots.length > 0 && !slots.some((slot) => slot.available);
  return allTaken(screen.stations) || allTaken(screen.zones);
}

/** Stations in station order, then zones in zone order, as the server sends them. */
function lostLines(screen: Pick<DevicePassBoard, "stations" | "zones">): string[] {
  return [
    ...screen.stations
      .filter((slot) => !slot.available)
      .map((slot) => lostSlotLine("station", slot.name)),
    ...(screen.zones ?? [])
      .filter((slot) => !slot.available)
      .map((slot) => lostSlotLine("zone", slot.name)),
  ];
}

function cardLabel(card: PassCard): string {
  const numbers = card.orders.map((order) => `#${order.orderNumber}`).join(" · ");
  const table = card.orders[0]?.tableLabel;
  return table ? `${numbers} ${table}` : numbers;
}

const REFRESH_MS = 15_000;
const READ_LIMIT_MS = 25_000;

const MODES: Record<BoardId, PassMode> = { all: "all_stations", pass: "pass", monitor: "monitor" };
const SCOPES: Record<BoardId, ColumnScope["screen"]> = {
  all: "all_stations",
  pass: "pass",
  monitor: "pass_monitor",
};

interface ColumnsWindow {
  boardId: BoardId;
  opener: HTMLElement;
}

/**
 * The pass on the pass board. At a till it shows the device's pass screen when the device chose one,
 * else All stations; a kitchen display (`deviceMode`) shows its own pass screen, and a pass monitor
 * (`monitor`) its monitor.
 */
@customElement("till-pass-screen")
export class TillPassScreen extends LitElement {
  constructor() {
    super();
    new ContentLanguageController(this);
  }

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

      @media ${unsafeCSS(PHONE_WIDTH)} {
        .screen {
          padding-inline: 0;
        }
      }

      .stale {
        margin: 0;
      }

      .error {
        margin: 0;
        padding: var(--wt-space-2) var(--wt-space-3);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-danger);
        color: var(--wt-color-on-danger);
        font-weight: var(--wt-font-weight-bold);
      }

      /* The station screen's warning banner, so a wall monitor's stale read stands out across the room. */
      .stale[data-stale],
      .table-changed {
        margin: 0;
        padding: var(--wt-space-2) var(--wt-space-3);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-warning);
        color: var(--wt-color-on-warning);
        font-weight: var(--wt-font-weight-bold);
      }

      .empty {
        margin: 0;
        padding: var(--wt-space-4);
        color: var(--wt-color-text-muted);
        text-align: center;
      }

      .title {
        margin: 0;
        font-size: var(--wt-font-size-xl);
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];

  @property({ attribute: false }) api!: TillApi;
  @property({ attribute: false }) operatorSession = 0;
  /** Injectable clock for age classification; unset falls back to the {@link #clock}'s ticked time. */
  @property({ attribute: false }) now?: number;
  @property({ attribute: false }) reducedMotion?: boolean;
  /** Mounted inside a card host, which supplies the header. */
  @property({ type: Boolean }) embedded = false;
  @property({ attribute: false }) backKey: "expo.back" | "action.back" = "expo.back";
  @property({ type: Boolean }) deviceMode = false;
  @property({ type: Boolean }) monitor = false;
  @property({ type: Boolean }) runsPass = false;
  /** A kitchen display's title. */
  @property({ attribute: false }) deviceName?: string;
  /** With {@link serverOrigin}, the Columns layout's scope. */
  @property({ attribute: false }) deviceId?: string;
  @property({ attribute: false }) serverOrigin?: string;
  @property({ attribute: false }) initialBoard?: DevicePassBoard;

  @state() private board: PassBoard = emptyBoard();
  @state() private selected: BoardId | null = null;
  /** A narrowing took the device's pass screen or pass monitor itself. */
  @state() private passGone = false;
  @state() private goneScreen: "pass" | "pass_monitor" = "pass";
  @state() private lostLines: string[] = [];
  @state() private nothingLeft = false;
  @state() private columnsWindow: ColumnsWindow | null = null;
  /**
   * The choice sent on the board shown, until the send is refused, a board read begun after its
   * acceptance answers, or that follow-up read ends; the window shows it, disabled.
   */
  @state() private otherStationsSending?: boolean | null;
  /**
   * Moves on with each choice sent and each change of board. An older send's answer frees no newer
   * choice, its success is not taken as the newest answer, and its failure is not acted on.
   */
  #otherStationsSend = 0;
  /**
   * The send the server accepted; a board read begun after it ends its sending when it answers,
   * unless a newer send is out.
   */
  #acceptedSend = 0;
  /** A refusal of that choice, shown in the window until the next choice or a change of board. */
  @state() private otherStationsError?: string;
  /** A read of the device's choice has answered; until one does, All stations shows. */
  #choiceRead = false;
  #choiceRequest = 0;
  #appliedChoice = 0;
  @state() private stale = false;
  #lastGoodAt = new Date();
  #refreshTimer?: ReturnType<typeof setInterval>;
  readonly #refreshReads = new Set<AbortController>();
  #request = 0;
  #appliedRequest = 0;
  /** Card keys with a Fire out. */
  @state() private sending: ReadonlySet<string> = new Set();
  /** A Fire out or unanswered, by card key; an unanswered one is resent unchanged (B3 D48). */
  readonly #asks = new Map<string, PassReleaseAsk>();
  @state() private leverError?: { code: string; card: string };
  /** A failed reprint stays until the next reprint press; no read clears it. */
  @state() private reprintErrorCode?: string;
  /** The refresh sentence, with the table a Ready refusal names; Fire's names none. */
  @state() private tableChanged: { table?: string } | null = null;
  #tableChangedNext: { table?: string } | null = null;
  readonly #layouts = new KitchenColumnLayouts(PASS_COLUMNS);
  /** Unset until a read of the board shown answers; the window offers no choice until then. */
  #display?: DevicePassBoard["display"];
  /** A choice the server accepted, shown until a read begun after it answers. */
  #acceptedChoice?: boolean | null;

  /** The last board read's choice of showing other stations' dishes. */
  get display(): DevicePassBoard["display"] | undefined {
    return this.#display;
  }

  /** Re-renders the idle display so an item's band can climb between refreshes, with no refetch. */
  readonly #clock = new TickingClock(this);

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.monitor || this.deviceMode) {
      this.selected = this.monitor ? "monitor" : "pass";
      const board = this.initialBoard;
      if (board) this.#adoptBoard(board);
      else void this.#reload(undefined, true);
    } else if (this.embedded) void this.#reload();
    else void this.#loadChoice();
    this.#refreshTimer = setInterval(() => void this.#refresh(), REFRESH_MS);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearInterval(this.#refreshTimer);
    for (const read of this.#refreshReads) read.abort();
    this.#refreshReads.clear();
  }

  /**
   * At a till the device's choice is read before each refresh's board read, so the board follows a
   * change made while the screen is open. Until a read answers, All stations shows; after that a
   * failed read keeps what the last one said.
   */
  async #loadChoice(signal?: AbortSignal): Promise<void> {
    const request = ++this.#choiceRequest;
    let pass;
    let read = true;
    try {
      const { kitchenScreens } = await this.api.getDeviceIdentity({ signal });
      pass = kitchenScreens.find(
        (screen) => screen.kind === "pass" || screen.kind === "pass_monitor",
      );
    } catch {
      read = false;
    }
    if (!this.isConnected || request < this.#appliedChoice) return;
    this.#appliedChoice = request;
    if (read || !this.#choiceRead) {
      this.#choiceRead = read;
      this.passGone = pass?.available === false;
      this.goneScreen = pass?.kind === "pass_monitor" ? "pass_monitor" : "pass";
      const next = this.passGone
        ? null
        : pass === undefined
          ? "all"
          : pass.kind === "pass"
            ? "pass"
            : "monitor";
      if (next !== this.selected) {
        this.board = emptyBoard();
        this.lostLines = [];
        this.nothingLeft = false;
        this.columnsWindow = null;
        this.#display = undefined;
        this.#acceptedChoice = undefined;
        this.otherStationsSending = undefined;
        this.#otherStationsSend++;
        this.otherStationsError = undefined;
      }
      this.selected = next;
    }
    await this.#reload(signal);
  }

  async #refresh(): Promise<void> {
    await this.#bounded((signal) =>
      this.#followsChoice() ? this.#loadChoice(signal) : this.#reload(signal, true),
    );
  }

  async #bounded(run: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const read = new AbortController();
    const limit = setTimeout(() => read.abort(), READ_LIMIT_MS);
    this.#refreshReads.add(read);
    try {
      await run(read.signal);
    } finally {
      clearTimeout(limit);
      this.#refreshReads.delete(read);
    }
  }

  /** A till's own Pass screen, which shows what its device chose. */
  #followsChoice(): boolean {
    return !this.embedded && !this.#onDevice();
  }

  /**
   * A kitchen display's own read (`probe`: on connect and each refresh) refused
   * `device.unauthorized` emits `device-unauthorized`, so the app re-boots to what the device's
   * identity now says, as a station screen's does. Any other failure keeps the last-known board.
   */
  async #reload(signal?: AbortSignal, probe = false): Promise<void> {
    const boardId = this.#boardId();
    if (boardId === null) {
      this.#tableChangedNext = null;
      return;
    }
    const request = ++this.#request;
    try {
      const result: DevicePassBoard =
        boardId === "all"
          ? {
              ...(await this.api.getExpoBoard({ signal })),
              stations: [],
              zones: null,
              display: { showNonPassStations: true, nonPassStationsOverride: null },
            }
          : boardId === "pass"
            ? await this.api.getDevicePassBoard({ signal })
            : await this.api.getDevicePassMonitorBoard({ signal });
      if (request < this.#appliedRequest || !this.#isCurrent(boardId)) return;
      this.#appliedRequest = request;
      this.#adoptBoard(result);
      this.stale = false;
      this.#lastGoodAt = new Date();
      this.tableChanged = this.#tableChangedNext;
      this.#tableChangedNext = null;
    } catch (error) {
      if (
        probe &&
        this.#onDevice() &&
        (error as { code?: string } | null)?.code === "device.unauthorized"
      ) {
        this.dispatchEvent(
          new CustomEvent("device-unauthorized", { bubbles: true, composed: true }),
        );
      } else if (request > this.#appliedRequest && this.#isCurrent(boardId)) this.stale = true;
    }
  }

  #adoptBoard(read: DevicePassBoard): void {
    this.board = read.board;
    this.#display = read.display;
    this.#acceptedChoice = undefined;
    if (this.#acceptedSend === this.#otherStationsSend) this.otherStationsSending = undefined;
    this.lostLines = lostLines(read);
    this.nothingLeft = nothingLeft(read);
    for (const key of this.#asks.keys()) if (!this.sending.has(key)) this.#dropAskIfChanged(key);
  }

  /** A kept ask survives only while the board still offers its card under the same context. */
  #dropAskIfChanged(key: string): void {
    const card = this.board.toFire.find((offered) => offered.key === key);
    if (card?.releaseContext !== this.#asks.get(key)?.expectedContext) this.#asks.delete(key);
  }

  async #fire(boardId: BoardId, key: string): Promise<void> {
    if (boardId !== "pass" || !this.runsPass || this.sending.has(key)) return;
    const card = this.board.toFire.find((offered) => offered.key === key);
    let ask = this.#asks.get(key);
    if (ask === undefined) {
      if (card?.releaseContext == null || card.releaseTicketItemIds.length === 0) return;
      ask = {
        submissionId: crypto.randomUUID(),
        target: card.target,
        ticketItemIds: card.releaseTicketItemIds,
        expectedContext: card.releaseContext,
      };
      this.#asks.set(key, ask);
    }
    this.tableChanged = null;
    this.#tableChangedNext = null;
    this.leverError = undefined;
    this.sending = new Set([...this.sending, key]);
    let reload = true;
    let rechoose = false;
    try {
      await this.api.releaseDevicePass(ask);
      this.#asks.delete(key);
    } catch (error) {
      const { code, status } = (error ?? {}) as { code?: string; status?: unknown };
      if (typeof status !== "number") {
        reload = false;
        this.#dropAskIfChanged(key);
        if (this.#isCurrent(boardId)) this.stale = true;
      } else {
        this.#asks.delete(key);
        if (this.#switched(error)) reload = false;
        else if (this.#isCurrent(boardId)) {
          rechoose = code === "device.unauthorized" && this.#followsChoice();
          if (code === "ticket.pass_context_changed" || code === "party.not_open" || rechoose)
            this.#tableChangedNext = {};
          else this.#leverRefused(card, error);
        }
      }
    } finally {
      const sending = new Set(this.sending);
      sending.delete(key);
      this.sending = sending;
    }
    if (reload && this.#isCurrent(boardId)) await (rechoose ? this.#loadChoice() : this.#reload());
  }

  async #groupReady(boardId: BoardId, key: string): Promise<void> {
    const card = this.board.inProgress.find((offered) => offered.key === key);
    if (card?.target.kind !== "group" || card.party === undefined) return;
    const { partyId, groupId } = card.target;
    const command = {
      submissionId: crypto.randomUUID(),
      expectedPartyRevision: card.party.revision,
    };
    this.tableChanged = null;
    this.#tableChangedNext = null;
    this.leverError = undefined;
    try {
      await (this.#onDevice()
        ? this.api.bumpDeviceGroupReady(partyId, groupId, command)
        : this.api.bumpGroupReady(partyId, groupId, command));
    } catch (error) {
      if (this.#switched(error)) return;
      if (this.#isCurrent(boardId)) {
        if ((error as { code?: string } | null)?.code === "party.out_of_date") {
          const first = card.orders[0];
          this.#tableChangedNext = { table: first?.tableLabel ?? `#${first?.orderNumber ?? ""}` };
        } else this.#leverRefused(card, error);
      }
    }
    if (this.#isCurrent(boardId)) await this.#reload();
  }

  /** Unlike a group Ready press, a course Ready press leaves the refresh sentence. */
  async #courseReady(
    boardId: BoardId,
    key: string,
    orderId: string,
    courseId: string,
  ): Promise<void> {
    const card = this.board.inProgress.find((offered) => offered.key === key);
    this.leverError = undefined;
    try {
      await (this.#onDevice()
        ? this.api.bumpDeviceCourseReady(orderId, courseId)
        : this.api.bumpCourseReady(orderId, courseId));
    } catch (error) {
      if (this.#switched(error)) return;
      if (this.#isCurrent(boardId)) this.#leverRefused(card, error);
    }
    if (this.#isCurrent(boardId)) await this.#reload();
  }

  /**
   * The device's own choice of showing other stations' dishes on the board it shows. A refusal
   * meaning the board itself has gone follows Fire's (D74, D92); any other keeps the previous choice.
   */
  async #chooseOtherStations(boardId: BoardId, value: boolean | null): Promise<void> {
    if (boardId === "all" || this.otherStationsSending !== undefined) return;
    this.otherStationsError = undefined;
    this.otherStationsSending = value;
    const send = ++this.#otherStationsSend;
    let reload: "board" | "choice" | null = "board";
    try {
      await this.api.setDeviceKitchenScreenDisplay(
        boardId === "pass" ? "pass" : "pass_monitor",
        value,
      );
      if (send === this.#otherStationsSend && this.#isCurrent(boardId)) {
        this.#acceptedChoice = value;
        this.#acceptedSend = send;
        // Counts as an answer newer than any board read already out, so none of those can undo it.
        this.#appliedRequest = ++this.#request;
      }
    } catch (error) {
      reload = null;
      if (send === this.#otherStationsSend) {
        const code = (error as { code?: string } | null)?.code ?? "server.internal";
        if (this.#switched(error)) this.columnsWindow = null;
        else if (code === "device.unauthorized" && this.#followsChoice()) {
          this.columnsWindow = null;
          this.#tableChangedNext = {};
          reload = "choice";
        } else this.otherStationsError = code;
      }
    }
    if (reload === "board" && this.#isCurrent(boardId))
      await this.#bounded((signal) => this.#reload(signal));
    if (send === this.#otherStationsSend) this.otherStationsSending = undefined;
    if (reload === "choice" && this.#isCurrent(boardId)) await this.#loadChoice();
  }

  #leverRefused(card: PassCard | undefined, error: unknown): void {
    this.leverError = {
      code: (error as { code?: string } | null)?.code ?? "server.internal",
      card: card === undefined ? "" : cardLabel(card),
    };
  }

  async #reprint(boardId: BoardId, orderId: string): Promise<void> {
    this.reprintErrorCode = undefined;
    try {
      await this.api.reprintOrder(orderId);
    } catch (error) {
      if (this.#isCurrent(boardId))
        this.reprintErrorCode = (error as { code?: string } | null)?.code ?? "server.internal";
    }
  }

  /**
   * On a kitchen display, a press refused because the device no longer has this screen asks the app
   * to re-read the device's choice now. A release names a lost pass screen `device.unauthorized`, a
   * lever `kitchen_screen.not_allowed`.
   */
  #switched(error: unknown): boolean {
    const code = (error as { code?: string } | null)?.code;
    if (
      !this.#onDevice() ||
      !this.isConnected ||
      (code !== "device.unauthorized" && code !== "kitchen_screen.not_allowed")
    )
      return false;
    this.dispatchEvent(
      new CustomEvent("kitchen-screen-changed", {
        detail: { from: this.monitor ? "pass_monitor" : "pass" },
        bubbles: true,
        composed: true,
      }),
    );
    return true;
  }

  #boardId(): BoardId | null {
    return this.embedded && !this.deviceMode && !this.monitor ? "all" : this.selected;
  }

  #isCurrent(boardId: BoardId): boolean {
    return this.isConnected && this.#boardId() === boardId;
  }

  #onDevice(): boolean {
    return this.deviceMode || this.monitor;
  }

  #shows(): boolean {
    return !this.passGone && !this.nothingLeft;
  }

  /** Never a fresh `Date.now()`, so every render in one tick sees the identical `now`. */
  #clockNow(): number {
    return this.now ?? this.#clock.now;
  }

  #columnScope(boardId: BoardId): ColumnScope | null {
    if (!this.deviceId || !this.serverOrigin) return null;
    return { venueId: this.serverOrigin, deviceId: this.deviceId, screen: SCOPES[boardId] };
  }

  #columnsFor(boardId: BoardId): ColumnState {
    return this.#layouts.get(this.#columnScope(boardId), boardId);
  }

  #keepColumns(boardId: BoardId, layout: ColumnState): void {
    this.#layouts.keep(this.#columnScope(boardId), boardId, layout);
    this.requestUpdate();
  }

  #back(): void {
    this.dispatchEvent(new CustomEvent("back-to-counter", { bubbles: true, composed: true }));
  }

  #title(): string {
    return this.#onDevice() ? (this.deviceName ?? "") : t("expo.title");
  }

  #lead(slot?: "lead"): TemplateResult | typeof nothing {
    if (this.#onDevice())
      return html`<h1 class="title" slot=${slot ?? nothing}>${this.deviceName ?? ""}</h1>`;
    if (this.embedded) return nothing;
    return html`<h1 class="title" slot=${slot ?? nothing}>${t("expo.title")}</h1>
      <wt-button
        class="back"
        slot=${slot ?? nothing}
        data-back
        variant="secondary"
        @click=${() => this.#back()}
      >
        ${t(this.backKey)}
      </wt-button>`;
  }

  #unavailable(slot?: "status"): TemplateResult[] {
    const lines = this.passGone
      ? [kitchenScreenNoticeText({ kind: "unavailable", screen: this.goneScreen })]
      : this.lostLines;
    return lines.map(
      (line) =>
        html`<p class="unavailable" role="status" data-unavailable slot=${slot ?? nothing}>
          ${line}
        </p>`,
    );
  }

  #empty(boardId: BoardId): TemplateResult | typeof nothing {
    const { held, toFire, inProgress, ready } = this.board;
    if (held.length + toFire.length + inProgress.length + ready.length > 0) return nothing;
    return html`<p class="empty" slot="status" data-empty>
      ${t(boardId === "pass" ? "expo.watcher_empty" : "expo.empty")}
    </p>`;
  }

  override render() {
    const boardId = this.#boardId();
    return html`<section class="screen" aria-label=${t("expo.title")}>
        ${
          boardId === null || !this.#shows()
            ? html`${this.#lead()}${this.#unavailable()}`
            : this.#board(boardId)
        }
      </section>
      ${
        this.columnsWindow === null || boardId === null
          ? nothing
          : this.#renderColumnsWindow(boardId, this.columnsWindow)
      }`;
  }

  #board(boardId: BoardId): TemplateResult {
    return html`<till-pass-board
      .board=${this.board}
      .mode=${MODES[boardId]}
      .runsPass=${this.runsPass}
      .columns=${this.#columnsFor(boardId)}
      .now=${this.#clockNow()}
      .sending=${this.sending}
      .showReprint=${!this.#onDevice()}
      .reducedMotion=${this.reducedMotion}
      @pass-fire=${(event: Event) => {
        event.stopPropagation();
        void this.#fire(boardId, (event as CustomEvent<{ key: string }>).detail.key);
      }}
      @pass-group-ready=${(event: Event) => {
        event.stopPropagation();
        void this.#groupReady(boardId, (event as CustomEvent<{ key: string }>).detail.key);
      }}
      @pass-course-ready=${(event: Event) => {
        event.stopPropagation();
        const { key, orderId, courseId } = (
          event as CustomEvent<{ key: string; orderId: string; courseId: string }>
        ).detail;
        void this.#courseReady(boardId, key, orderId, courseId);
      }}
      @pass-reprint=${(event: Event) => {
        event.stopPropagation();
        void this.#reprint(boardId, (event as CustomEvent<{ orderId: string }>).detail.orderId);
      }}
      @toggle-column=${(event: Event) => {
        event.stopPropagation();
        const { key } = (event as CustomEvent<{ key: ColumnKey }>).detail;
        this.#keepColumns(boardId, toggleColumnCollapsed(this.#columnsFor(boardId), key));
      }}
      @open-columns=${(event: Event) => {
        event.stopPropagation();
        const { opener } = (event as CustomEvent<{ opener: HTMLElement }>).detail;
        this.columnsWindow = { boardId, opener };
      }}
      >${this.#lead("lead")}${this.#unavailable("status")}
      <p class="stale" role="status" slot="status" ?data-stale=${this.stale}>
        ${this.stale ? html`<till-stale-since .since=${this.#lastGoodAt}></till-stale-since>` : nothing}
      </p>
      ${
        this.reprintErrorCode
          ? html`<p class="error" role="alert" slot="status" data-reprint-error>
              ${codeMessage(this.reprintErrorCode)}
            </p>`
          : nothing
      }
      ${
        this.leverError
          ? html`<p class="error" role="alert" slot="status" data-lever-error>
              ${this.leverError.card}: ${codeMessage(this.leverError.code)}
            </p>`
          : nothing
      }
      ${
        this.tableChanged
          ? html`<p class="table-changed" role="status" slot="status" data-table-changed>
              ${
                this.tableChanged.table === undefined
                  ? nothing
                  : t("station.table_changed_named").replace(
                      "{table}",
                      () => this.tableChanged!.table!,
                    )
              }
              ${t("station.table_changed")}
            </p>`
          : nothing
      }${this.#empty(boardId)}</till-pass-board
    >`;
  }

  #renderColumnsWindow(boardId: BoardId, open: ColumnsWindow): TemplateResult | typeof nothing {
    if (open.boardId !== boardId) return nothing;
    return html`<till-kitchen-columns-dialog
      .layout=${this.#columnsFor(boardId)}
      .names=${passColumnNames()}
      .boardName=${this.#title()}
      .opener=${open.opener}
      .otherStations=${
        boardId === "all" || !this.#shows() || this.#display === undefined
          ? null
          : {
              value:
                this.otherStationsSending !== undefined
                  ? this.otherStationsSending
                  : this.#acceptedChoice !== undefined
                    ? this.#acceptedChoice
                    : this.#display.nonPassStationsOverride,
              sending: this.otherStationsSending !== undefined,
              errorCode: this.otherStationsError,
            }
      }
      @other-stations-choose=${(event: Event) => {
        event.stopPropagation();
        const { value } = (event as CustomEvent<{ value: boolean | null }>).detail;
        void this.#chooseOtherStations(boardId, value);
      }}
      @column-move=${(event: Event) => {
        event.stopPropagation();
        this.#layouts.applyMove(this.#columnScope(boardId), boardId, event);
        this.requestUpdate();
      }}
      @column-show=${(event: Event) => {
        event.stopPropagation();
        this.#layouts.applyShow(this.#columnScope(boardId), boardId, event);
        this.requestUpdate();
      }}
      @close=${(event: Event) => {
        event.stopPropagation();
        if (this.columnsWindow === open) this.columnsWindow = null;
      }}
    ></till-kitchen-columns-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-pass-screen": TillPassScreen;
  }
}
