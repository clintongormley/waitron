import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { formatBytes } from "@waitron/dashboard-kit";
import { baseStyles, pageTitleStyles, visuallyHiddenStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import { DashboardQueries } from "../api/query-controller.js";
import type {
  AlertView,
  BoxHealth,
  BoxNetwork,
  DashboardApi,
  FiscalRetryView,
} from "../api/client.js";
import { formatIsoMinute } from "../date-utils.js";
import { alertMessage } from "../i18n/alerts.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { goToLabel, wholeTimes, wholeTimesStyles } from "../widgets/alert-format.js";
import { guideHref } from "../help-guide.js";
import { boxStatusRows, type PartRow } from "./box-status-rows.js";

/** The least `formatBytes` writes as "1 MB" rather than "0 MB". */
const LEAST_TO_FREE = 500_000;

/** After a restart, a read this long after it was accepted counts as the box being back, even
 * when no read caught the box away: the whole outage can fall between two health reads. */
const RESTART_AWAY_MS = 30_000;

/** The server's margin for an administrator's device agreeing with the box. */
const AGREE_WITHIN_MS = 60_000;

/** The reasons a refused set names that have their own sentence. */
const SET_REFUSALS = {
  same_machine: "box_status.clock.admin.set.refused.same_machine",
  not_stopped: "box_status.clock.admin.set.refused.not_stopped",
  synchronised: "box_status.clock.admin.set.refused.synchronised",
  stopped: "box_status.clock.admin.set.refused.stopped",
  stale: "box_status.clock.admin.set.refused.stale",
  host_unavailable: "box_status.clock.admin.set.refused.host_unavailable",
  target_invalid: "box_status.clock.admin.set.refused.target_invalid",
  pending_step: "box_status.clock.admin.set.refused.pending_step",
} as const satisfies Record<string, StringKey>;

const SET_FAILURES = {
  refused: "box_status.clock.admin.set.failed.refused",
  unverified: "box_status.clock.admin.set.failed.unverified",
} as const satisfies Record<string, StringKey>;

/** Refused sets a second press could only meet again, so the question goes. */
const SET_ENDS_THE_QUESTION: ReadonlySet<string> = new Set([
  "same_machine",
  "not_stopped",
  "stale",
]);

/** LOCAL copy of `IDLE_TIMEOUT_MS` (`packages/identity/src/management-session.ts:11`): a step
 * past it either way ends the dashboard session that asked for it. */
const SESSION_IDLE_MS = 30 * 60_000;

interface ClockReading {
  boxAt: number;
  deviceAt: number;
  agrees: boolean;
}

type ReadName = "getBoxHealth" | "listAlerts";

@customElement("dashboard-box-status-screen")
export class BoxStatusScreen extends LitElement {
  static override styles = [
    baseStyles,
    pageTitleStyles,
    wholeTimesStyles,
    css`
      :host {
        display: block;
        container-type: inline-size;
        color: var(--wt-color-text);
      }
      .title {
        margin: 0 0 var(--wt-space-2);
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
      .restart-action,
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
      .box-network,
      .box-restart {
        margin: 0 0 var(--wt-space-4);
      }
      .box-restart > p {
        margin: 0 0 var(--wt-space-2);
      }
      .box-network {
        padding: var(--wt-space-3);
        background: var(--wt-color-surface);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }
      .box-network dl {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: var(--wt-space-2) var(--wt-space-3);
      }
      .box-network dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
      .box-network dt {
        font-weight: var(--wt-font-weight-bold);
      }
      .box-network a {
        color: var(--wt-color-primary-text);
      }
      .box-network h2,
      .box-restart h2 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
      }
      .clock-check p {
        margin: 0 0 var(--wt-space-2);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) canOpen: (screen: string) => boolean = () => false;
  @property({ attribute: false }) canCheckClock = false;
  @property({ attribute: false }) canRestart = false;

  @state() private network: BoxNetwork | null = null;
  @state() private networkState: "loading" | "ready" | "failed" | "unavailable" = "loading";
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
  @state() private clockCheckOpen = false;
  /** The times the open check compares; null while it is asked for, or when it was refused. */
  @state() private clockReading: ClockReading | null = null;
  @state() private settingClock = false;
  /** Set once the box has set its clock from this device's; null otherwise. */
  @state() private clockSetDone: { signInAgain: boolean } | null = null;
  /** Set once the open check has confirmed a waiting start's time. */
  @state() private clockConfirmedHere = false;
  /** The check's refusal, shown above the dialog's buttons. */
  @state() private clockCheckError = "";
  @state() private confirmingClock = false;
  /** The Clock row's confirmation refusal; the next press clears it. */
  @state() private clockConfirmError = "";
  @state() private restartOpen = false;
  @state() private restarting = false;
  @state() private restartAsked = false;
  @state() private restartError = "";
  /** When the box accepted the restart, and whether a health read has failed since. */
  #restartAccepted: { at: number; outageSeen: boolean } | null = null;
  /** Bumped at every opening, so an answer for a closed check is dropped. */
  #clockCheckRun = 0;

  // One controller per read: a controller's error callback does not say which query failed.
  readonly #healthQueries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      if (this.#restartAccepted !== null) this.#restartAccepted.outageSeen = true;
      this.#readFailed("getBoxHealth");
    },
  );
  readonly #networkQueries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.network = null;
      this.networkState = codeOf(error) === "box_host.unavailable" ? "unavailable" : "failed";
      if (this.networkState === "unavailable") this.#networkQueries.release("getBoxNetwork");
    },
  );
  readonly #alertQueries = new DashboardQueries(
    this,
    () => this.api,
    () => this.#readFailed("listAlerts"),
  );
  override connectedCallback(): void {
    super.connectedCallback();
    void this.#networkQueries
      .watch("getBoxNetwork", [], (network) => {
        this.network = network;
        this.networkState = "ready";
      })
      .catch(() => undefined);
    void this.#healthQueries
      .watch("getBoxHealth", [], (health) => {
        this.health = health;
        this.awaitingFigure = false;
        this.awaitingRetryRead = false;
        this.#nothingLeftToRetry = this.#nothingToRetry(health);
        this.#restartAnswered();
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

  #clockCheckNeeded(health: BoxHealth): boolean {
    return clockUnusable(health) || health.clock.waiting !== undefined;
  }

  /** A waiting start's clock can be set only through its host, so a silent one is not checked. */
  #deviceCheckOffered(health: BoxHealth): boolean {
    return clockUnusable(health) || health.clock.waiting?.hostAnswers === true;
  }

  /** From the last read; the box judges it again when asked. */
  #canSetClock(health: BoxHealth | null): boolean {
    return (
      health !== null &&
      this.canCheckClock &&
      health.clock.sync.source === "timedatectl" &&
      !health.clock.sync.synced &&
      this.#deviceCheckOffered(health)
    );
  }

  /** Asks the box for its time, with the round trip's half as the reading's uncertainty. */
  async #readBoxTime(): Promise<{ challengeId: string; reading: ClockReading }> {
    const sentAt = Date.now();
    const { challengeId, boxAt } = await this.api.clockChallenge();
    const halfMs = (Date.now() - sentAt) / 2;
    const deviceAt = sentAt + halfMs;
    const box = Date.parse(boxAt);
    // The box refuses a set within the same margin (`agrees`); a confirmation trusts this one.
    const agrees = Math.abs(deviceAt - box) + halfMs <= AGREE_WITHIN_MS;
    return { challengeId, reading: { boxAt: box, deviceAt, agrees } };
  }

  #clockRefused(error: unknown): void {
    this.clockCheckError = setRefusal(error);
    this.api.liveData.refresh();
  }

  async #openClockCheck(): Promise<void> {
    const run = ++this.#clockCheckRun;
    this.clockReading = null;
    this.clockCheckError = "";
    this.clockSetDone = null;
    this.clockConfirmedHere = false;
    this.clockCheckOpen = true;
    try {
      const { challengeId, reading } = await this.#readBoxTime();
      if (run !== this.#clockCheckRun) return;
      if (reading.agrees && this.health?.clock.waiting !== undefined) {
        await this.api.clockConfirm({ challengeId, asShown: true });
        if (run !== this.#clockCheckRun) return;
        this.clockConfirmedHere = true;
        this.api.liveData.refresh();
      }
      this.clockReading = reading;
    } catch (error) {
      if (run === this.#clockCheckRun) this.#clockRefused(error);
    }
  }

  async #setClock(): Promise<void> {
    if (this.settingClock) return;
    this.settingClock = true;
    this.clockCheckError = "";
    let fresh: ClockReading | null = null;
    try {
      const { challengeId, reading } = await this.#readBoxTime();
      fresh = reading;
      const { stepMs } = await this.api.clockSet({ challengeId, deviceAt: Date.now() });
      this.clockSetDone = { signInAgain: Math.abs(stepMs) > SESSION_IDLE_MS };
    } catch (error) {
      const reason = setRefusalReason(error);
      if (fresh !== null && reason === "agrees") {
        this.clockReading = { ...fresh, agrees: true };
      } else {
        if (
          codeOf(error) === "clock.set_failed" ||
          (reason !== null && SET_ENDS_THE_QUESTION.has(reason))
        )
          this.clockReading = null;
        this.clockCheckError = setRefusal(error);
      }
    } finally {
      this.api.liveData.refresh();
      this.settingClock = false;
    }
  }

  async #confirmClock(): Promise<void> {
    if (this.confirmingClock) return;
    this.confirmingClock = true;
    this.clockConfirmError = "";
    try {
      const { challengeId } = await this.api.clockChallenge();
      await this.api.clockConfirm({ challengeId, asShown: true });
    } catch (error) {
      this.clockConfirmError = setRefusal(error);
    } finally {
      this.api.liveData.refresh();
      this.confirmingClock = false;
    }
  }

  #clockActions(health: BoxHealth): TemplateResult | typeof nothing {
    if (!this.#clockCheckNeeded(health)) return nothing;
    if (!this.canCheckClock) return this.#clockAdminSignIn();
    return html`${
      offersConfirm(health)
        ? html`<wt-button
            variant="secondary"
            data-test="clock-confirm"
            ?disabled=${this.confirmingClock}
            ?loading=${this.confirmingClock}
            @click=${() => void this.#confirmClock()}
            >${t("box_status.clock.confirm")}</wt-button
          >`
        : nothing
    }${this.#deviceCheckOffered(health) ? this.#clockCheckButton() : nothing}`;
  }

  #closeClockCheck(): void {
    this.#clockCheckRun += 1;
    this.clockCheckOpen = false;
  }

  #clockAdminSignIn(): TemplateResult {
    return html`<wt-button
      variant="secondary"
      data-test="clock-admin-sign-in"
      @click=${() =>
        this.dispatchEvent(new CustomEvent("admin-sign-in", { bubbles: true, composed: true }))}
      >${t("staff.sign_in_as_admin")}</wt-button
    >`;
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
        guide-href=${guideHref("box-status.clock-own-device")}
        guide-label=${t("box_status.clock_check_help_guide")}
        >${t("box_status.clock_check_help")}</wt-help-tooltip
      >
    </span>`;
  }

  #renderClockCheckDialog(): TemplateResult | typeof nothing {
    if (!this.canCheckClock) return nothing;
    const reading = this.clockReading;
    const done = this.clockSetDone;
    const offeringSet =
      done === null && reading !== null && !reading.agrees && this.#canSetClock(this.health);
    const cancel = html`<wt-button
      slot="cancel"
      variant="secondary"
      data-test="clock-check-cancel"
      ?disabled=${this.settingClock}
      @click=${() => this.#closeClockCheck()}
      >${t("action.cancel")}</wt-button
    >`;
    return html`<wt-dialog
      class="clock-check"
      data-test="clock-check-dialog"
      .open=${this.clockCheckOpen}
      .dismissible=${!this.settingClock}
      heading=${t("box_status.clock.admin.open")}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#closeClockCheck();
      }}
    >
      ${
        done !== null
          ? html`<p data-test="clock-set-done">
              ${t("box_status.clock.admin.set.done")}${
                done.signInAgain ? ` ${t("box_status.clock.admin.set.sign_in_again")}` : nothing
              }
            </p>`
          : this.clockConfirmedHere
            ? html`<p data-test="clock-confirmed">${t("box_status.clock.admin.confirmed")}</p>`
            : reading === null
              ? nothing
              : offeringSet
                ? html`<p data-test="clock-set-question">
                    ${wholeTimes(
                      fill("box_status.clock.admin.set.question", {
                        box: atSeconds(reading.boxAt),
                        device: atSeconds(reading.deviceAt),
                      }),
                    )}
                  </p>`
                : html`<p data-test="clock-check-times">
                      ${wholeTimes(
                        fill("box_status.clock.admin.times", {
                          box: atSeconds(reading.boxAt),
                          device: atSeconds(reading.deviceAt),
                        }),
                      )}
                    </p>
                    ${
                      reading.agrees
                        ? nothing
                        : html`<p data-test="clock-check-verdict">
                            ${t("box_status.clock.admin.differ")}
                          </p>`
                    }`
      }
      <wt-form-actions slot="footer" .error=${this.clockCheckError}>
        ${
          offeringSet
            ? html`${cancel}
                <wt-button
                  variant="primary"
                  data-test="clock-set-confirm"
                  ?disabled=${this.settingClock}
                  ?loading=${this.settingClock}
                  @click=${() => void this.#setClock()}
                  >${t("box_status.clock.admin.set.confirm")}</wt-button
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
          row.id === "clock" && !this.canCheckClock && this.#clockCheckNeeded(health)
            ? html`<p class="aside" data-test="clock-admin-hint">
                ${t("box_status.clock.admin.sign_in_hint")}
              </p>`
            : nothing
        }
        ${
          row.id === "clock" && this.canCheckClock && offersConfirm(health)
            ? html`<p class="aside" data-test="clock-confirm-help">
                  ${t("box_status.clock.confirm_help")}
                </p>
                ${
                  this.clockConfirmError === ""
                    ? nothing
                    : html`<p class="refusal" role="alert" data-test="clock-confirm-refused">
                        ${this.clockConfirmError}
                      </p>`
                }`
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
        ${row.id === "clock" ? this.#clockActions(health) : nothing}
      </div>
    </li>`;
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
        ${wholeTimes(fill("box_status.legend", { time: formatIsoMinute(health.at) }))}
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

  /** Ends the restarting note at a successful read after one that failed since the box accepted
   * the restart, or at one `RESTART_AWAY_MS` after it. */
  #restartAnswered(): void {
    const accepted = this.#restartAccepted;
    if (accepted === null) return;
    // Shutdown is bounded by the server's SHUTDOWN_DEADLINE_MS (8 s), well inside this wait.
    if (!accepted.outageSeen && Date.now() - accepted.at < RESTART_AWAY_MS) return;
    this.#restartAccepted = null;
    this.restartAsked = false;
  }

  async #restart(): Promise<void> {
    if (this.restarting) return;
    this.restarting = true;
    this.restartError = "";
    try {
      await this.api.restartBox();
      this.restartOpen = false;
      this.restartAsked = true;
      this.#restartAccepted = { at: Date.now(), outageSeen: false };
    } catch (error) {
      const code = codeOf(error);
      this.restartError =
        code === "node.read_only" ? t("box_status.restart.read_only") : codeMessage(code);
    } finally {
      this.restarting = false;
    }
  }

  #renderRestart(): TemplateResult | typeof nothing {
    if (!this.canRestart) return nothing;
    const action = html`<span class="restart-action">
      <wt-button
        variant="secondary"
        data-test="box-restart"
        @click=${() => {
          this.restartError = "";
          this.restartOpen = true;
        }}
        >${t("box_status.restart.title")}</wt-button
      ><wt-help-tooltip
        mode="help-mode"
        aria-label=${t("box_status.restart_help_label")}
        guide-href=${guideHref("box-status.restart")}
        guide-label=${t("box_status.restart_help_guide")}
        >${t("box_status.restart_help")}</wt-help-tooltip
      >
    </span>`;
    return html`<section class="box-restart" data-test="box-restart-section">
      <h2>${t("box_status.restart.title")}</h2>
      ${
        this.restartAsked
          ? html`<p role="status" data-test="box-restart-done">${t("box_status.restart.done")}</p>`
          : nothing
      }
      ${action}
    </section>`;
  }

  #renderRestartDialog(): TemplateResult | typeof nothing {
    if (!this.canRestart) return nothing;
    return html`<wt-dialog
      data-test="box-restart-dialog"
      .open=${this.restartOpen}
      .dismissible=${!this.restarting}
      heading=${t("box_status.restart.question")}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.restartOpen = false;
      }}
    >
      <p data-test="box-restart-what">${t("box_status.restart.what")}</p>
      <wt-form-actions slot="footer" .error=${this.restartError}>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="box-restart-stop"
          ?disabled=${this.restarting}
          @click=${() => (this.restartOpen = false)}
          >${t("box_status.restart.stop")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test="box-restart-confirm"
          ?disabled=${this.restarting}
          ?loading=${this.restarting}
          @click=${() => void this.#restart()}
          >${t("box_status.restart.confirm")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }

  #renderNetwork(): TemplateResult | typeof nothing {
    if (this.networkState === "unavailable") return nothing;
    const network = this.network;
    return html`<section
      class="box-network"
      data-test="box-network"
      aria-labelledby="network-title"
    >
      <h2 id="network-title">${t("box_status.network.title")}</h2>
      ${
        network === null
          ? html`<p role="status">
              ${t(this.networkState === "failed" ? "box_status.network.failed" : "box_status.network.loading")}
            </p>`
          : html`<dl>
              <dt>${t("box_status.network.wired")}</dt>
              <dd>
                ${!network.wired.connected ? t("box_status.network.disconnected") : (network.wired.address ?? t("box_status.network.no_address"))}
              </dd>
              <dt>${t("box_status.network.wifi")}</dt>
              <dd>
                ${network.wifi.connectedSsidHex === null ? t("box_status.network.disconnected") : ssidName(network.wifi.connectedSsidHex)}
              </dd>
              <dt>${t("box_status.network.saved")}</dt>
              <dd>
                ${network.wifi.savedSsidHex === null ? t("box_status.network.not_reported") : ssidName(network.wifi.savedSsidHex)}
              </dd>
            </dl>`
      }
      <a href=${guideHref("box-status.network")} target="_blank" rel="noopener"
        >${t("box_status.network.guide")}</a
      >
    </section>`;
  }

  override render(): TemplateResult {
    return html`
      <h1 class="title">${t("box_status.title")}</h1>
      ${this.#renderError()} ${this.#renderBody()} ${this.#renderNetwork()} ${this.#renderRestart()}
      ${this.#renderClockCheckDialog()} ${this.#renderRestartDialog()}
    `;
  }
}

/** A time to the second, written so `wholeTimes` keeps its date and minute on one line. */
function atSeconds(ms: number): string {
  const at = new Date(ms);
  return `${formatIsoMinute(at.toISOString())}:${String(at.getSeconds()).padStart(2, "0")}`;
}

/** A waiting start's time as it stands, which the box refuses before 28-10-2024. */
function offersConfirm(health: BoxHealth): boolean {
  return health.clock.waiting !== undefined && !clockUnusable(health);
}

/** A clock before 28-10-2024. */
function clockUnusable(health: BoxHealth): boolean {
  return health.notices.some((notice) => notice.code === "clock.unusable");
}

function reasonOf(error: unknown, code: string): string | null {
  if (codeOf(error) !== code) return null;
  const reason = (error as { params?: { reason?: unknown } } | null)?.params?.reason;
  return typeof reason === "string" ? reason : null;
}

function setRefusalReason(error: unknown): string | null {
  return reasonOf(error, "clock.set_refused");
}

function setRefusal(error: unknown): string {
  const code = codeOf(error);
  if (code === "clock.set_failed") {
    const failure = reasonOf(error, code);
    return failure !== null && Object.hasOwn(SET_FAILURES, failure)
      ? t(SET_FAILURES[failure as keyof typeof SET_FAILURES])
      : codeMessage(code);
  }
  if (code !== "clock.set_refused") return codeMessage(code);
  const reason = setRefusalReason(error);
  return reason !== null && Object.hasOwn(SET_REFUSALS, reason)
    ? t(SET_REFUSALS[reason as keyof typeof SET_REFUSALS])
    : codeMessage(code);
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-box-status-screen": BoxStatusScreen;
  }
}

function ssidName(hex: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16)),
  );
}
