import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { formatBytes, pickLocale } from "@waitron/dashboard-kit";
import { baseStyles, visuallyHiddenStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-disclosure.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import { DashboardQueries } from "../api/query-controller.js";
import type {
  AlertView,
  BoxHealth,
  ClockMisdatedHandledView,
  ClockMisdatedView,
  DashboardApi,
  FiscalRetryView,
  MisdatedOpenView,
} from "../api/client.js";
import { formatIsoMinute, wallClock } from "../date-utils.js";
import { ALERT_MESSAGES } from "../i18n/alert-messages.js";
import { alertMessage } from "../i18n/alerts.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { goToLabel, wholeTimes, wholeTimesStyles } from "../widgets/alert-format.js";
import { guideHref } from "../help-guide.js";
import "../widgets/misdated-note-dialog.js";
import { boxStatusRows, type PartRow } from "./box-status-rows.js";

/** The least `formatBytes` writes as "1 MB" rather than "0 MB". */
const LEAST_TO_FREE = 500_000;

const MISDATED = "clock.records_misdated";

/** The server's margin for an administrator's device agreeing with the box. */
const AGREE_WITHIN_MS = 60_000;

/** The reasons a refused confirmation names that have their own sentence. */
const CONFIRM_REFUSALS = {
  same_machine: "box_status.clock.admin.refused.same_machine",
  contrary_proof: "box_status.clock.stop.contrary",
  differs: "box_status.clock.admin.differ",
  not_stopped: "box_status.clock.admin.refused.not_stopped",
} as const satisfies Record<string, StringKey>;

interface ClockReading {
  boxAt: number;
  deviceAt: number;
  agrees: boolean;
}

type MisdatedRecordView = ClockMisdatedView["lists"][number]["records"][number];
type HandledEpisode = ClockMisdatedHandledView["episodes"][number];

type ReadName = "getBoxHealth" | "listAlerts";

@customElement("dashboard-box-status-screen")
export class BoxStatusScreen extends LitElement {
  static override styles = [
    baseStyles,
    wholeTimesStyles,
    css`
      :host {
        display: block;
        container-type: inline-size;
        color: var(--wt-color-text);
      }
      .title {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-lg);
      }
      .legend,
      .note {
        margin: 0 0 var(--wt-space-4);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .rows {
        list-style: none;
        margin: 0 0 var(--wt-space-4);
        padding: 0;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) minmax(0, 3fr) auto;
        gap: var(--wt-space-2);
      }
      .rows > li {
        grid-column: 1 / -1;
        display: grid;
        grid-template-columns: subgrid;
        grid-template-areas: "dot name words actions";
        gap: var(--wt-space-3);
        align-items: start;
        padding: var(--wt-space-3);
        background: var(--wt-color-surface);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }
      .dot {
        grid-area: dot;
        display: inline-block;
        width: var(--wt-space-3);
        height: var(--wt-space-3);
        margin-top: var(--wt-space-1);
        border-radius: var(--wt-radius-full);
      }
      .dot.ok {
        background: var(--wt-color-success);
      }
      .dot.attention {
        background: var(--wt-color-warning);
      }
      .dot.stopped {
        background: var(--wt-color-danger);
      }
      .state-words {
        ${visuallyHiddenStyles}
      }
      .name {
        grid-area: name;
        font-weight: var(--wt-font-weight-bold);
      }
      .words {
        grid-area: words;
      }
      .line,
      .detail,
      .alert,
      .aside {
        margin: 0;
      }
      .detail,
      .alert,
      .aside {
        font-size: var(--wt-font-size-sm);
      }
      .detail,
      .aside {
        color: var(--wt-color-text-muted);
      }
      .refusal {
        margin: 0;
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-danger);
      }
      .actions {
        grid-area: actions;
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        align-items: center;
        justify-content: flex-end;
      }
      @container (max-width: 600px) {
        .rows {
          grid-template-columns: auto minmax(0, 1fr);
        }
        .rows > li {
          grid-template-areas:
            "dot name"
            ". words"
            ". actions";
          row-gap: var(--wt-space-1);
        }
        .actions {
          justify-content: flex-start;
          margin-top: var(--wt-space-1);
        }
      }
      .free,
      .retry,
      .clock-check-action {
        position: relative;
        display: flex;
        gap: var(--wt-space-1);
        align-items: center;
      }
      /* Room for the half of its help badge that hangs past its end, help on or off, so the
         badge never covers a Go to after it and turning help on moves nothing. */
      .retry:not(:last-child) {
        margin-inline-end: max(0px, calc(var(--wt-help-badge-target) / 2 - var(--wt-space-2)));
      }
      .other {
        display: flex;
        gap: var(--wt-space-2);
        align-items: center;
        margin: 0 0 var(--wt-space-4);
      }
      .error {
        color: var(--wt-color-danger);
        margin: 0 0 var(--wt-space-4);
      }
      .misdated {
        margin: 0 0 var(--wt-space-4);
      }
      .misdated h2 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
      }
      .clock-check p {
        margin: 0 0 var(--wt-space-2);
      }
      .misdated-entry {
        display: grid;
        gap: var(--wt-space-2);
        margin: 0 0 var(--wt-space-3);
      }
      .misdated-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      .misdated-entry > .error {
        margin: 0;
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) canOpen: (screen: string) => boolean = () => false;
  /** Whether the session may confirm the box's clock from its own device (`person.admin`). */
  @property({ attribute: false }) canConfirmClock = false;

  @state() private health: BoxHealth | null = null;
  /** The bell's own list, as last read; null until it has been read once. */
  @state() private alerts: AlertView[] | null = null;
  @state() private failingReads: ReadonlySet<ReadName> = new Set();
  @state() private retrying = false;
  @state() private retryAnswer: FiscalRetryView | null = null;
  /** The retry press's refusal, drawn on the Tax agency row; no read clears it. */
  @state() private retryError: string | null = null;
  /** After a press the waiting count is stale until the box is read again. */
  @state() private awaitingRetryRead = false;
  /** Whether the latest read left nothing to try again; a press needs it false to start. */
  #nothingLeftToRetry = false;
  /** The free-space press's refusal; no read clears it. */
  @state() private actionError: string | null = null;
  @state() private freeing = false;
  @state() private freedBytes: number | null = null;
  /** After a press the figure on the button is stale until the box is read again. */
  @state() private awaitingFigure = false;
  /** The wrongly dated sales' lists by confirmation; null until read. */
  @state() private misdatedLists: ReadonlyMap<string, MisdatedRecordView[]> | null = null;
  @state() private misdatedFailed = false;
  #watchingMisdated = false;
  /** Whether the Handled lists fold is open; its episodes are read only while it is. */
  @state() private handledOpen = false;
  /** The handled episodes, newest first as the box sends them; null until read. */
  @state() private handledEpisodes: HandledEpisode[] | null = null;
  @state() private handledFailed = false;
  /** Incident ids whose file is being asked for, and the refusal last shown under each entry. */
  @state() private downloading: ReadonlySet<string> = new Set();
  @state() private downloadRefusals: ReadonlyMap<string, string> = new Map();
  /** The entry the note dialog was last opened for; kept while it closes. */
  @state() private noteTarget: { mode: "handle" | "note"; entry: MisdatedOpenView } | null = null;
  @state() private noteOpen = false;
  @state() private clockCheckOpen = false;
  /** The times the open check compares; null while it is asked for, or when it was refused. */
  @state() private clockReading: ClockReading | null = null;
  @state() private confirmingClock = false;
  /** The check's refusal, shown above the dialog's buttons. */
  @state() private clockCheckError = "";
  /** Bumped at every opening, so an answer for a closed check is dropped. */
  #clockCheckRun = 0;
  /** Whether a health read has finished, answered or failed: any read after it is automatic. */
  #healthAnswered = false;

  // One controller per read: a controller's error callback does not say which query failed.
  readonly #healthQueries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.#healthAnswered = true;
      this.#readFailed("getBoxHealth");
    },
  );
  readonly #alertQueries = new DashboardQueries(
    this,
    () => this.api,
    () => this.#readFailed("listAlerts"),
  );
  readonly #misdatedQueries = new DashboardQueries(
    this,
    () => this.api,
    () => (this.misdatedFailed = true),
  );
  readonly #handledQueries = new DashboardQueries(
    this,
    () => this.api,
    () => (this.handledFailed = true),
  );

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#healthQueries
      .watch("getBoxHealth", [], (health) => {
        this.health = health;
        this.awaitingFigure = false;
        this.awaitingRetryRead = false;
        this.#nothingLeftToRetry = this.#nothingToRetry(health);
        this.#followMisdated(health, this.#healthAnswered);
        this.#healthAnswered = true;
        if ((this.retryAnswer?.waiting ?? 0) > 0 && this.#nothingLeftToRetry)
          this.retryAnswer = null;
        this.#readSucceeded("getBoxHealth");
      })
      .catch(() => undefined);
    void this.#alertQueries
      .watch("listAlerts", [], (response) => {
        // The bell shows nothing when the list is not visible.
        this.alerts = response.visible ? response.alerts : [];
        this.#readSucceeded("listAlerts");
      })
      .catch(() => undefined);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#closeHandled();
    this.#watchingMisdated = false;
  }

  #toggleHandled(open: boolean): void {
    if (!open) {
      this.#closeHandled();
      return;
    }
    this.handledOpen = true;
    void this.#handledQueries
      .watch("clockMisdatedHandled", [], (answer) => {
        this.handledEpisodes = answer.episodes;
        this.handledFailed = false;
      })
      .catch(() => undefined);
  }

  #closeHandled(): void {
    this.#handledQueries.release("clockMisdatedHandled");
    this.handledOpen = false;
    this.handledEpisodes = null;
    this.handledFailed = false;
  }

  /** Reads the lists only while an open alert has one; a closing that cannot tell lists none. */
  #followMisdated(health: BoxHealth, passive: boolean): void {
    const wanted = health.misdatedOpen.some((open) => !open.unconfirmed);
    if (wanted === this.#watchingMisdated) return;
    this.#watchingMisdated = wanted;
    if (!wanted) {
      this.#misdatedQueries.release("clockMisdated");
      this.misdatedLists = null;
      this.misdatedFailed = false;
      return;
    }
    void this.#misdatedQueries
      .watch(
        "clockMisdated",
        [],
        (answer) => {
          this.misdatedLists = new Map(
            answer.lists.map((list) => [list.confirmationId, list.records]),
          );
          this.misdatedFailed = false;
        },
        { passive },
      )
      .catch(() => undefined);
  }

  #readFailed(name: ReadName): void {
    this.failingReads = new Set([...this.failingReads, name]);
  }

  #readSucceeded(name: ReadName): void {
    if (!this.failingReads.has(name)) return;
    const failing = new Set(this.failingReads);
    failing.delete(name);
    this.failingReads = failing;
  }

  #canFree(): boolean {
    const health = this.health;
    return (
      health !== null &&
      !this.awaitingFigure &&
      health.canFree &&
      health.disk.reclaimable.bytes >= LEAST_TO_FREE
    );
  }

  async #free(): Promise<void> {
    if (this.freeing || !this.#canFree()) return;
    this.freeing = true;
    this.actionError = null;
    this.freedBytes = null;
    try {
      const freed = await this.api.freeBoxSpace();
      this.freedBytes = freed.freedBytes;
      this.awaitingFigure = true;
      // No change event reaches the box's read, so every open read, the bell's too, is read again.
      this.api.liveData.refresh();
    } catch (error) {
      this.actionError = codeOf(error);
    } finally {
      this.freeing = false;
    }
  }

  #offersClockCheck(health: BoxHealth): boolean {
    return (
      this.canConfirmClock &&
      ((health.clockStop !== null && health.clockStop.proof !== "confirmed") ||
        health.clockCheckWaiting !== null)
    );
  }

  /** Asks the box for its time, with the round trip's half as the reading's uncertainty. */
  async #readBoxTime(): Promise<{ challengeId: string; reading: ClockReading }> {
    const sentAt = Date.now();
    const { challengeId, boxAt } = await this.api.clockChallenge();
    const halfMs = (Date.now() - sentAt) / 2;
    const deviceAt = sentAt + halfMs;
    const box = Date.parse(boxAt);
    // A hint for which buttons to draw only: the server judges the answer again, with the same
    // margin, and refuses `differs`.
    const agrees = Math.abs(deviceAt - box) + halfMs <= AGREE_WITHIN_MS;
    return { challengeId, reading: { boxAt: box, deviceAt, agrees } };
  }

  #clockRefused(error: unknown): void {
    this.clockCheckError = clockRefusal(error);
    this.api.liveData.refresh();
  }

  async #openClockCheck(): Promise<void> {
    const run = ++this.#clockCheckRun;
    this.clockReading = null;
    this.clockCheckError = "";
    this.clockCheckOpen = true;
    try {
      const { reading } = await this.#readBoxTime();
      if (run === this.#clockCheckRun) this.clockReading = reading;
    } catch (error) {
      if (run === this.#clockCheckRun) this.#clockRefused(error);
    }
  }

  async #confirmClock(): Promise<void> {
    if (this.confirmingClock) return;
    this.confirmingClock = true;
    this.clockCheckError = "";
    let fresh: ClockReading | null = null;
    try {
      // A fresh challenge, answered at once: the one the dialog opened with may have expired.
      const { challengeId, reading } = await this.#readBoxTime();
      fresh = reading;
      await this.api.clockConfirm({ challengeId, deviceAt: Date.now() });
      this.clockCheckOpen = false;
      this.api.liveData.refresh();
    } catch (error) {
      if (fresh !== null && refusalReason(error) === "differs") {
        // The verdict under the fresh times says it, so the footer does not say it twice.
        this.clockReading = { ...fresh, agrees: false };
        this.api.liveData.refresh();
      } else {
        // Nothing is left to confirm, so a retry could only be refused again.
        if (refusalReason(error) === "not_stopped") this.clockReading = null;
        this.#clockRefused(error);
      }
    } finally {
      this.confirmingClock = false;
    }
  }

  #closeClockCheck(): void {
    this.#clockCheckRun += 1;
    this.clockCheckOpen = false;
  }

  #clockCheckButton(): TemplateResult {
    return html`<span class="clock-check-action">
      <wt-button
        variant="secondary"
        data-test="clock-check"
        @click=${() => void this.#openClockCheck()}
        >${t("box_status.clock.admin.open")}</wt-button
      ><wt-help-tooltip
        mode="help-mode"
        aria-label=${t("box_status.clock_check_help_label")}
        guide-href=${guideHref("box-status.clock-behind")}
        guide-label=${t("box_status.clock_check_help_guide")}
        >${t("box_status.clock_check_help")}</wt-help-tooltip
      >
    </span>`;
  }

  #renderClockCheckDialog(): TemplateResult | typeof nothing {
    if (!this.canConfirmClock) return nothing;
    const reading = this.clockReading;
    const asking = reading?.agrees === true;
    return html`<wt-dialog
      class="clock-check"
      data-test="clock-check-dialog"
      .open=${this.clockCheckOpen}
      .dismissible=${!this.confirmingClock}
      heading=${t("box_status.clock.admin.open")}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#closeClockCheck();
      }}
    >
      ${
        reading === null
          ? nothing
          : html`<p data-test="clock-check-times">
                ${wholeTimes(
                  fill("box_status.clock.admin.times", {
                    box: atSeconds(reading.boxAt),
                    device: atSeconds(reading.deviceAt),
                  }),
                )}
              </p>
              <p data-test="clock-check-verdict">
                ${t(asking ? "box_status.clock.admin.agree" : "box_status.clock.admin.differ")}
              </p>`
      }
      <wt-form-actions slot="footer" .error=${this.clockCheckError}>
        ${
          asking
            ? html`<wt-button
                  slot="cancel"
                  variant="secondary"
                  data-test="clock-check-cancel"
                  ?disabled=${this.confirmingClock}
                  @click=${() => this.#closeClockCheck()}
                  >${t("action.cancel")}</wt-button
                >
                <wt-button
                  variant="primary"
                  data-test="clock-check-confirm"
                  ?disabled=${this.confirmingClock}
                  ?loading=${this.confirmingClock}
                  @click=${() => void this.#confirmClock()}
                  >${t("action.confirm")}</wt-button
                >`
            : html`<wt-button
                slot="cancel"
                variant="secondary"
                data-test="clock-check-close"
                @click=${() => this.#closeClockCheck()}
                >${t("action.close")}</wt-button
              >`
        }
      </wt-form-actions>
    </wt-dialog>`;
  }

  #goTo(event: MouseEvent, screen: string): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("wt-alert-go-to", { bubbles: true, composed: true, detail: { screen } }),
    );
  }

  #goToButton(screen: string): TemplateResult {
    return html`<wt-button
      size="sm"
      variant="secondary"
      data-test="go-to"
      @click=${(event: MouseEvent) => this.#goTo(event, screen)}
      >${goToLabel(screen)}</wt-button
    >`;
  }

  /** The row's own screen, then its alerts' screens, each once; never this page. */
  #screensOf(row: PartRow): string[] {
    const screens = [row.screen, ...row.alerts.map((alert) => alert.screen ?? null)];
    return [
      ...new Set(
        screens.filter(
          (screen): screen is string =>
            screen !== null && screen !== "box-status" && this.canOpen(screen),
        ),
      ),
    ];
  }

  #freeAction(health: BoxHealth): TemplateResult {
    const can = this.#canFree();
    const bytes = health.disk.reclaimable.bytes;
    const label =
      bytes >= LEAST_TO_FREE
        ? fill("box_status.free", { size: formatBytes(bytes, currentLocale()) })
        : t("box_status.free_nothing");
    return html`<span class="free">
      <wt-button
        data-test="free"
        variant=${can || this.freeing ? "primary" : "secondary"}
        ?disabled=${!can || this.freeing}
        ?loading=${this.freeing}
        @click=${() => void this.#free()}
        >${label}</wt-button
      ><wt-help-tooltip
        mode="help-mode"
        aria-label=${t("box_status.free_help_label")}
        guide-href=${guideHref("box-status.free-space")}
        guide-label=${t("box_status.free_help_guide")}
        >${t("box_status.free_help")}</wt-help-tooltip
      >
    </span>`;
  }

  #canRetry(health: BoxHealth): boolean {
    const outbox = health.outbox;
    return (
      !this.awaitingRetryRead &&
      outbox !== null &&
      outbox.waiting > 0 &&
      !outbox.awaitingCertificate &&
      health.notices.some((notice) => notice.code === "fiscal.records_unsent")
    );
  }

  async #retry(): Promise<void> {
    const health = this.health;
    if (this.retrying || health === null || !this.#canRetry(health)) return;
    this.retrying = true;
    this.retryError = null;
    this.retryAnswer = null;
    try {
      const answer = await this.api.retryFiscalSubmissions();
      this.retryAnswer = answer.waiting > 0 && this.#nothingLeftToRetry ? null : answer;
      this.awaitingRetryRead = true;
      this.api.liveData.refresh();
    } catch (error) {
      this.retryError = codeOf(error);
    } finally {
      this.retrying = false;
    }
  }

  /** Whether a read leaves nothing for a "will be tried again" answer to speak of. */
  #nothingToRetry(health: BoxHealth): boolean {
    return (
      health.outbox?.waiting === 0 ||
      // A read that could not check the notices has not shown the unsent notice gone.
      (health.noticesUnavailable.length === 0 &&
        !health.notices.some((notice) => notice.code === "fiscal.records_unsent"))
    );
  }

  #retriedWords(waiting: number): string {
    if (waiting === 0) return t("box_status.retried_none");
    if (waiting === 1) return t("box_status.retried_one");
    return fill("box_status.retried", { count: String(waiting) });
  }

  #retryAction(health: BoxHealth): TemplateResult {
    const can = this.#canRetry(health);
    return html`<span class="retry">
      <wt-button
        data-test="retry"
        variant=${can || this.retrying ? "primary" : "secondary"}
        ?disabled=${!can || this.retrying}
        ?loading=${this.retrying}
        @click=${() => void this.#retry()}
        >${t("box_status.retry")}</wt-button
      ><wt-help-tooltip
        mode="help-mode"
        aria-label=${t("box_status.retry_help_label")}
        guide-href=${guideHref("box-status.retry-now")}
        guide-label=${t("box_status.retry_help_guide")}
        >${t("box_status.retry_help")}</wt-help-tooltip
      >
    </span>`;
  }

  #renderRow(row: PartRow, health: BoxHealth): TemplateResult {
    const sentences = [
      ...new Set(
        row.alerts.map((alert) => alertMessage(alert.code, alert.params, currentLocale())),
      ),
    ].filter((sentence) => sentence !== row.line);
    const disk = row.id === "disk";
    const outbox = row.id === "tax" ? health.outbox : null;
    return html`<li data-test="row-${row.id}" data-state=${row.state}>
      <span class="dot ${row.state}"
        ><span class="state-words">${t(`box_status.state.${row.state}` as StringKey)}</span></span
      >
      <div class="name">${t(`box_status.part.${row.id}` as StringKey)}</div>
      <div class="words">
        <p class="line">${wholeTimes(row.line)}</p>
        ${
          row.details.length === 0
            ? nothing
            : html`<p class="detail">${wholeTimes(row.details.join(" · "))}</p>`
        }
        ${sentences.map((sentence) => html`<p class="alert" data-test="row-alert">${wholeTimes(sentence)}</p>`)}
        ${
          disk && health.disk.reclaimable.backupRunning
            ? html`<p class="aside" data-test="backup-running">
                ${t("box_status.free_backup_running")}
              </p>`
            : nothing
        }
        ${
          disk && !health.canFree
            ? html`<p class="aside" data-test="read-only">${t("box_status.free_read_only")}</p>`
            : nothing
        }
        ${
          outbox?.awaitingCertificate === true &&
          !row.alerts.some((alert) => alert.code === "fiscal.awaiting_certificate")
            ? html`<p class="aside" data-test="awaiting-certificate">
                ${t("box_status.retry_awaiting_certificate")}
              </p>`
            : nothing
        }
        ${
          outbox !== null && this.retryAnswer !== null
            ? html`<p class="aside" role="status" data-test="retried">
                ${this.#retriedWords(this.retryAnswer.waiting)}
              </p>`
            : nothing
        }
        ${
          outbox !== null && this.retryError !== null
            ? html`<p class="refusal" role="alert" data-test="retry-refused">
                ${codeMessage(this.retryError)}
              </p>`
            : nothing
        }
      </div>
      <div class="actions">
        ${outbox === null ? nothing : this.#retryAction(health)}
        ${this.#screensOf(row).map((screen) => this.#goToButton(screen))}
        ${disk ? this.#freeAction(health) : nothing}
        ${row.id === "clock" && this.#offersClockCheck(health) ? this.#clockCheckButton() : nothing}
      </div>
    </li>`;
  }

  #misdatedColumns(): DataTableColumn<MisdatedRecordView>[] {
    return [
      {
        key: "invoice",
        label: t("box_status.misdated.col_invoice"),
        cell: (record) =>
          record.number === null ? record.series : `${record.series}/${record.number}`,
      },
      {
        key: "at",
        label: t("box_status.misdated.col_at"),
        cell: (record) => wholeTimes(wallMinute(record.at, record.offsetMinutes)),
      },
    ];
  }

  #misdatedSentence(open: MisdatedOpenView): string | null {
    if (open.unconfirmed) return alertMessage(MISDATED, { ...open }, currentLocale());
    const partial = ALERT_MESSAGES[MISDATED]?.variants?.partial;
    return open.partial && partial !== undefined ? pickLocale(partial, currentLocale()) : null;
  }

  #renderMisdatedEntry(open: MisdatedOpenView, severalTables: boolean): TemplateResult | null {
    const sentence = this.#misdatedSentence(open);
    const records = open.unconfirmed ? undefined : this.misdatedLists?.get(open.confirmationId);
    // The answer leaves out a list it cannot give; a failed read is said once, under the section.
    if (
      sentence === null &&
      records === undefined &&
      (this.misdatedLists !== null || this.misdatedFailed)
    )
      return null;
    return html`<div class="misdated-entry" data-test="misdated-entry">
      ${this.#misdatedBody(open, sentence, records, severalTables, this.#noteButton("handle", open))}
    </div>`;
  }

  #handledLine(episode: HandledEpisode): string {
    const time = formatIsoMinute(episode.handledAt);
    if (episode.handledBy.kind === "box")
      return fill("box_status.misdated.handled_by_box", { time });
    const name = episode.handledBy.name;
    return name === null
      ? fill("box_status.misdated.handled_by_unknown", { time })
      : fill("box_status.misdated.handled_by_person", { name, time });
  }

  #renderHandledEntry(episode: HandledEpisode, severalTables: boolean): TemplateResult {
    return html`<div
      class="misdated-entry"
      data-test="misdated-handled-entry"
      data-incident=${episode.incidentId}
    >
      <p class="detail" data-test="misdated-handled-by">
        ${wholeTimes(this.#handledLine(episode))}
      </p>
      ${
        episode.note === null
          ? nothing
          : html`<p class="detail" data-test="misdated-note">
              ${fill("box_status.misdated.note", { note: episode.note })}
            </p>`
      }
      ${this.#misdatedBody(
        episode,
        this.#misdatedSentence(episode),
        episode.records ?? undefined,
        severalTables,
        episode.note === null ? this.#noteButton("note", episode) : nothing,
      )}
    </div>`;
  }

  #misdatedBody(
    open: MisdatedOpenView,
    sentence: string | null,
    records: MisdatedRecordView[] | undefined,
    severalTables: boolean,
    noteButton: TemplateResult | typeof nothing,
  ): TemplateResult {
    return html`${
        sentence === null
          ? nothing
          : html`<p class="detail" data-test="misdated-sentence">${wholeTimes(sentence)}</p>`
      }
      ${
        records === undefined
          ? nothing
          : html`<wt-data-table
              data-test="misdated-table"
              aria-label=${
                severalTables && open.to !== undefined
                  ? fill("box_status.misdated.table_range", {
                      from: wallMinute(open.from, open.fromOffsetMinutes),
                      to: wallMinute(open.to, open.toOffsetMinutes!),
                    })
                  : t("box_status.misdated.title")
              }
              .rows=${records}
              .columns=${this.#misdatedColumns()}
              .rowKey=${(record: MisdatedRecordView) => record.recordId}
            ></wt-data-table>`
      }
      <div class="misdated-actions">
        ${records === undefined || open.unconfirmed ? nothing : this.#downloadButton(open)}
        ${noteButton}
      </div>
      ${this.#downloadRefusal(open)}`;
  }

  #noteButton(mode: "handle" | "note", entry: MisdatedOpenView): TemplateResult {
    return html`<wt-button
      size="sm"
      variant="secondary"
      data-test=${mode === "handle" ? "misdated-mark-handled" : "misdated-add-note"}
      @click=${() => {
        this.noteTarget = { mode, entry };
        this.noteOpen = true;
      }}
      >${t(mode === "handle" ? "alerts.mark_handled" : "box_status.misdated.add_note")}</wt-button
    >`;
  }

  #noteSummary(entry: MisdatedOpenView): string {
    if (entry.unconfirmed) return alertMessage(MISDATED, { ...entry }, currentLocale());
    const from = wallMinute(entry.from, entry.fromOffsetMinutes);
    if (entry.count === 1) return fill("box_status.misdated.summary_one", { from });
    return fill("box_status.misdated.summary", {
      count: String(entry.count),
      from,
      to: wallMinute(entry.to ?? entry.from, entry.toOffsetMinutes ?? entry.fromOffsetMinutes),
    });
  }

  #renderNoteDialog(): TemplateResult {
    const target = this.noteTarget;
    return html`<dashboard-misdated-note-dialog
      .api=${this.api}
      .open=${this.noteOpen}
      .mode=${target?.mode ?? "handle"}
      .incidentId=${target?.entry.incidentId ?? ""}
      .summary=${target === null ? "" : this.#noteSummary(target.entry)}
      @saved=${() => this.api.liveData.refresh()}
      @note-close=${() => (this.noteOpen = false)}
    ></dashboard-misdated-note-dialog>`;
  }

  #downloadButton(open: MisdatedOpenView): TemplateResult {
    return html`<wt-button
      size="sm"
      variant="secondary"
      data-test="misdated-download"
      ?loading=${this.downloading.has(open.incidentId)}
      @click=${() => void this.#download(open)}
      >${t("box_status.misdated.download")}</wt-button
    >`;
  }

  #downloadRefusal(open: MisdatedOpenView): TemplateResult | typeof nothing {
    const refusal = this.downloadRefusals.get(open.incidentId);
    return refusal === undefined
      ? nothing
      : html`<p class="error" role="alert" data-test="misdated-download-error">
          ${codeMessage(refusal)}
        </p>`;
  }

  async #download(open: MisdatedOpenView): Promise<void> {
    const id = open.incidentId;
    if (this.downloading.has(id)) return;
    this.downloading = new Set([...this.downloading, id]);
    const refusals = new Map(this.downloadRefusals);
    refusals.delete(id);
    this.downloadRefusals = refusals;
    try {
      const file = await this.api.downloadMisdatedSales(id);
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      // The server's own name for the file: the first sale's date as the box's clock read it.
      link.download = `misdated-sales-${wallClock(open.from, open.fromOffsetMinutes).date}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      this.downloadRefusals = new Map([...this.downloadRefusals, [id, codeOf(error)]]);
    } finally {
      const asked = new Set(this.downloading);
      asked.delete(id);
      this.downloading = asked;
    }
  }

  #renderHandled(health: BoxHealth, severalTables: boolean): TemplateResult | typeof nothing {
    if (health.misdatedHandledCount === 0) return nothing;
    return html`<wt-disclosure
      data-test="misdated-handled"
      heading=${fill("box_status.misdated.handled_heading", {
        count: String(
          this.handledOpen && this.handledEpisodes !== null
            ? this.handledEpisodes.length
            : health.misdatedHandledCount,
        ),
      })}
      ?open=${this.handledOpen}
      @wt-toggle=${(event: CustomEvent<{ open: boolean }>) => this.#toggleHandled(event.detail.open)}
      >${
        this.handledOpen
          ? html`${(this.handledEpisodes ?? []).map((episode) =>
              this.#renderHandledEntry(episode, severalTables),
            )}${
              this.handledFailed
                ? html`<p class="note" data-test="misdated-handled-unavailable">
                    ${t("box_status.misdated.handled_read_error")}
                  </p>`
                : nothing
            }`
          : nothing
      }</wt-disclosure
    >`;
  }

  #renderMisdated(health: BoxHealth): TemplateResult | typeof nothing {
    const handledTables = this.handledOpen
      ? (this.handledEpisodes ?? []).filter((episode) => episode.records !== null).length
      : 0;
    const tables =
      health.misdatedOpen.filter(
        (open) => !open.unconfirmed && this.misdatedLists?.has(open.confirmationId) === true,
      ).length + handledTables;
    const entries = health.misdatedOpen
      .map((open) => this.#renderMisdatedEntry(open, tables > 1))
      .filter((entry) => entry !== null);
    if (entries.length === 0 && !this.misdatedFailed && health.misdatedHandledCount === 0)
      return nothing;
    return html`<section class="misdated" data-test="misdated">
      <h2>${t("box_status.misdated.title")}</h2>
      <p class="note" data-test="misdated-line">${t("box_status.misdated.line")}</p>
      ${entries}
      ${
        this.misdatedFailed
          ? html`<p class="note" data-test="misdated-unavailable">
              ${t("box_status.misdated.read_error")}
            </p>`
          : nothing
      }
      ${this.#renderHandled(health, tables > 1)}
    </section>`;
  }

  #renderBody(): TemplateResult | typeof nothing {
    const health = this.health;
    const alertsFailed = this.failingReads.has("listAlerts");
    // A pending alert read ends in an answer or a failure (it has a time limit); until then the
    // rows wait rather than look clear. A failed one must not hide the box's own read: on a full
    // disk the alert read is refused while this one answers.
    if (health === null || (this.alerts === null && !alertsFailed)) return nothing;
    const alerts = this.alerts;
    const { rows, other, checksUnavailable } = boxStatusRows(health, alerts ?? []);
    return html`
      <p class="legend" data-test="legend">
        ${fill("box_status.legend", { time: formatIsoMinute(health.at) })}
      </p>
      ${
        this.freedBytes === null
          ? nothing
          : html`<p role="status">
              ${fill("box_status.freed", { size: formatBytes(this.freedBytes, currentLocale()) })}
            </p>`
      }
      <ul class="rows">
        ${rows.map((row) => this.#renderRow(row, health))}
      </ul>
      ${this.#renderMisdated(health)}
      ${
        checksUnavailable
          ? html`<p class="note" data-test="checks-unavailable">
              ${t("box_status.checks_unavailable")}
            </p>`
          : nothing
      }
      ${
        alertsFailed
          ? html`<p class="note" data-test="alerts-unavailable">
              ${t("box_status.alerts_unavailable")}
            </p>`
          : nothing
      }
      ${
        alerts === null || other === 0
          ? nothing
          : html`<p class="other" data-test="other">
              ${
                other === 1
                  ? t("box_status.other_alerts_one")
                  : fill("box_status.other_alerts", { count: String(other) })
              }
              <wt-button
                size="sm"
                variant="secondary"
                data-test="see-all"
                @click=${(event: MouseEvent) => this.#goTo(event, "alerts")}
                >${t("alerts.see_all")}</wt-button
              >
            </p>`
      }
      <p class="note" data-test="fillers">${t("box_status.fillers")}</p>
    `;
  }

  #renderError(): TemplateResult | typeof nothing {
    // A read's failure never replaces the press's refusal.
    if (this.actionError !== null)
      return html`<p class="error" role="alert">
        ${
          this.actionError === "node.read_only"
            ? t("box_status.free_read_only")
            : codeMessage(this.actionError)
        }
      </p>`;
    if (this.failingReads.has("getBoxHealth"))
      return html`<p class="error" role="alert">${t("box_status.read_error")}</p>`;
    return nothing;
  }

  override render(): TemplateResult {
    return html`
      <h1 class="title">${t("box_status.title")}</h1>
      ${this.#renderError()} ${this.#renderBody()} ${this.#renderClockCheckDialog()}
      ${this.#renderNoteDialog()}
    `;
  }
}

/** A sale's minute on the wall clock at the offset stored beside it, not the browser's zone. */
function wallMinute(instant: string, offsetMinutes: number): string {
  const { date, time } = wallClock(instant, offsetMinutes);
  return `${date} ${time}`;
}

/** A time to the second, written so `wholeTimes` keeps its date and minute on one line. */
function atSeconds(ms: number): string {
  const at = new Date(ms);
  return `${formatIsoMinute(at.toISOString())}:${String(at.getSeconds()).padStart(2, "0")}`;
}

function refusalReason(error: unknown): string | null {
  if (codeOf(error) !== "clock.confirm_refused") return null;
  const reason = (error as { params?: { reason?: unknown } } | null)?.params?.reason;
  return typeof reason === "string" ? reason : null;
}

function clockRefusal(error: unknown): string {
  const reason = refusalReason(error);
  return reason !== null && Object.hasOwn(CONFIRM_REFUSALS, reason)
    ? t(CONFIRM_REFUSALS[reason as keyof typeof CONFIRM_REFUSALS])
    : codeMessage(codeOf(error));
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-box-status-screen": BoxStatusScreen;
  }
}
