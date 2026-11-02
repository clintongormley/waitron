import { ContentLanguageController, TickingClock, baseStyles } from "@waitron/ui";
import { LitElement, type TemplateResult, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { PHONE_WIDTH } from "../widgets/language-chooser-styles.js";
import { t } from "../i18n/t.js";
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
  moveColumn,
  readColumnState,
  saveColumnState,
  setColumnVisible,
  toggleColumnCollapsed,
} from "../state/kitchen-columns.js";
import type { DevicePassBoard, PassBoard, TillApi } from "../api/client.js";

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
  /** Each board's layout, read from storage once and never again on a refresh. */
  readonly #columns = new Map<string, ColumnState>();

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
      }
      this.selected = next;
    }
    await this.#reload(signal);
  }

  async #refresh(): Promise<void> {
    const read = new AbortController();
    const limit = setTimeout(() => read.abort(), READ_LIMIT_MS);
    this.#refreshReads.add(read);
    try {
      await (this.#followsChoice()
        ? this.#loadChoice(read.signal)
        : this.#reload(read.signal, true));
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
    if (boardId === null) return;
    const request = ++this.#request;
    try {
      const result: DevicePassBoard =
        boardId === "all"
          ? { ...(await this.api.getExpoBoard({ signal })), stations: [], zones: null }
          : boardId === "pass"
            ? await this.api.getDevicePassBoard({ signal })
            : await this.api.getDevicePassMonitorBoard({ signal });
      if (request < this.#appliedRequest || !this.#isCurrent(boardId)) return;
      this.#appliedRequest = request;
      this.#adoptBoard(result);
      this.stale = false;
      this.#lastGoodAt = new Date();
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
    this.lostLines = lostLines(read);
    this.nothingLeft = nothingLeft(read);
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

  /** The getter itself throws where the browser refuses storage altogether. */
  #deviceStorage(): Storage | null {
    try {
      return localStorage;
    } catch {
      return null;
    }
  }

  #columnScope(boardId: BoardId): ColumnScope | null {
    if (!this.deviceId || !this.serverOrigin) return null;
    return { venueId: this.serverOrigin, deviceId: this.deviceId, screen: SCOPES[boardId] };
  }

  #columnsFor(boardId: BoardId): ColumnState {
    const scope = this.#columnScope(boardId);
    const key = scope === null ? `memory|${boardId}` : JSON.stringify(scope);
    let layout = this.#columns.get(key);
    if (layout === undefined) {
      const storage = scope === null ? null : this.#deviceStorage();
      layout =
        scope !== null && storage !== null
          ? readColumnState(storage, scope, PASS_COLUMNS)
          : PASS_COLUMNS;
      this.#columns.set(key, layout);
    }
    return layout;
  }

  /** A refused store leaves the layout in memory. */
  #keepColumns(boardId: BoardId, layout: ColumnState): void {
    const scope = this.#columnScope(boardId);
    this.#columns.set(scope === null ? `memory|${boardId}` : JSON.stringify(scope), layout);
    const storage = scope === null ? null : this.#deviceStorage();
    if (scope !== null && storage !== null) saveColumnState(storage, scope, layout);
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
        ${t("expo.back")}
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
      .reducedMotion=${this.reducedMotion}
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
      </p></till-pass-board
    >`;
  }

  #renderColumnsWindow(boardId: BoardId, open: ColumnsWindow): TemplateResult | typeof nothing {
    if (open.boardId !== boardId) return nothing;
    return html`<till-kitchen-columns-dialog
      .layout=${this.#columnsFor(boardId)}
      .names=${passColumnNames()}
      .boardName=${this.#title()}
      .opener=${open.opener}
      @column-move=${(event: Event) => {
        event.stopPropagation();
        const { key, direction } = (
          event as CustomEvent<{ key: ColumnKey; direction: "up" | "down" }>
        ).detail;
        this.#keepColumns(boardId, moveColumn(this.#columnsFor(boardId), key, direction));
      }}
      @column-show=${(event: Event) => {
        event.stopPropagation();
        const { key, visible } = (event as CustomEvent<{ key: ColumnKey; visible: boolean }>)
          .detail;
        this.#keepColumns(boardId, setColumnVisible(this.#columnsFor(boardId), key, visible));
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
