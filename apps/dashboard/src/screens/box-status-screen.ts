import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { formatBytes, pickLocale } from "@waitron/dashboard-kit";
import { baseStyles, visuallyHiddenStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import { DashboardQueries } from "../api/query-controller.js";
import type {
  AlertView,
  BoxHealth,
  ClockMisdatedView,
  DashboardApi,
  FiscalRetryView,
  MisdatedOpenView,
} from "../api/client.js";
import { formatIsoMinute } from "../date-utils.js";
import { ALERT_MESSAGES } from "../i18n/alert-messages.js";
import { alertMessage } from "../i18n/alerts.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { goToLabel, wholeTimes, wholeTimesStyles } from "../widgets/alert-format.js";
import { guideHref } from "../help-guide.js";
import { boxStatusRows, type PartRow } from "./box-status-rows.js";

/** The least `formatBytes` writes as "1 MB" rather than "0 MB". */
const LEAST_TO_FREE = 500_000;

const MISDATED = "clock.records_misdated";

type MisdatedRecordView = ClockMisdatedView["lists"][number]["records"][number];

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
      .retry {
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
      .misdated-entry {
        display: grid;
        gap: var(--wt-space-2);
        margin: 0 0 var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) canOpen: (screen: string) => boolean = () => false;

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
  #healthAnswered = false;

  // One controller per read: a controller's error callback does not say which query failed.
  readonly #healthQueries = new DashboardQueries(
    this,
    () => this.api,
    () => this.#readFailed("getBoxHealth"),
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
        cell: (record) => wholeTimes(formatIsoMinute(record.at)),
      },
    ];
  }

  #misdatedSentence(open: MisdatedOpenView): string | null {
    if (open.unconfirmed) return alertMessage(MISDATED, { ...open }, currentLocale());
    const partial = ALERT_MESSAGES[MISDATED]?.variants?.partial;
    return open.partial && partial !== undefined ? pickLocale(partial, currentLocale()) : null;
  }

  #renderMisdatedEntry(open: MisdatedOpenView): TemplateResult | typeof nothing {
    const sentence = this.#misdatedSentence(open);
    const records = open.unconfirmed ? undefined : this.misdatedLists?.get(open.confirmationId);
    // A loaded answer without this entry's list means the alert was handled since the health read;
    // a failed read is said once, under the section.
    if (
      sentence === null &&
      records === undefined &&
      (this.misdatedLists !== null || this.misdatedFailed)
    )
      return nothing;
    return html`<div class="misdated-entry" data-test="misdated-entry">
      ${
        sentence === null
          ? nothing
          : html`<p class="detail" data-test="misdated-sentence">${wholeTimes(sentence)}</p>`
      }
      ${
        records === undefined
          ? nothing
          : html`<wt-data-table
              data-test="misdated-table"
              aria-label=${t("box_status.misdated.title")}
              .rows=${records}
              .columns=${this.#misdatedColumns()}
              .rowKey=${(record: MisdatedRecordView) => record.recordId}
            ></wt-data-table>`
      }
    </div>`;
  }

  #renderMisdated(health: BoxHealth): TemplateResult | typeof nothing {
    if (health.misdatedOpen.length === 0) return nothing;
    return html`<section class="misdated" data-test="misdated">
      <h2>${t("box_status.misdated.title")}</h2>
      <p class="note" data-test="misdated-line">${t("box_status.misdated.line")}</p>
      ${health.misdatedOpen.map((open) => this.#renderMisdatedEntry(open))}
      ${
        this.misdatedFailed
          ? html`<p class="note" data-test="misdated-unavailable">
              ${t("box_status.misdated.read_error")}
            </p>`
          : nothing
      }
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
      ${this.#renderError()} ${this.#renderBody()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-box-status-screen": BoxStatusScreen;
  }
}
