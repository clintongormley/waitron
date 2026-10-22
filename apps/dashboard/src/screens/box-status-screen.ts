import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { formatBytes } from "@waitron/dashboard-kit";
import { baseStyles, visuallyHiddenStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import { DashboardQueries } from "../api/query-controller.js";
import type { AlertView, BoxHealth, DashboardApi } from "../api/client.js";
import { formatIsoMinute } from "../date-utils.js";
import { alertMessage } from "../i18n/alerts.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { goToLabel } from "../widgets/alert-format.js";
import { guideHref } from "../help-guide.js";
import { boxStatusRows, type PartRow } from "./box-status-rows.js";

/** The least `formatBytes` writes as "1 MB" rather than "0 MB". */
const LEAST_TO_FREE = 500_000;

type ReadName = "getBoxHealth" | "listAlerts";

@customElement("dashboard-box-status-screen")
export class BoxStatusScreen extends LitElement {
  static override styles = [
    baseStyles,
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
      .free {
        display: flex;
        gap: var(--wt-space-1);
        align-items: center;
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
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) canOpen: (screen: string) => boolean = () => false;

  @state() private health: BoxHealth | null = null;
  /** The bell's own list, as last read; null until it has been read once. */
  @state() private alerts: AlertView[] | null = null;
  @state() private failingReads: ReadonlySet<ReadName> = new Set();
  /** The free-space press's refusal; no read clears it. */
  @state() private actionError: string | null = null;
  @state() private freeing = false;
  @state() private freedBytes: number | null = null;
  /** After a press the figure on the button is stale until the box is read again. */
  @state() private awaitingFigure = false;

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

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#healthQueries
      .watch("getBoxHealth", [], (health) => {
        this.health = health;
        this.awaitingFigure = false;
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

  #renderRow(row: PartRow, health: BoxHealth): TemplateResult {
    const sentences = [
      ...new Set(
        row.alerts.map((alert) => alertMessage(alert.code, alert.params, currentLocale())),
      ),
    ].filter((sentence) => sentence !== row.line);
    const disk = row.id === "disk";
    return html`<li data-test="row-${row.id}" data-state=${row.state}>
      <span class="dot ${row.state}"
        ><span class="state-words">${t(`box_status.state.${row.state}` as StringKey)}</span></span
      >
      <div class="name">${t(`box_status.part.${row.id}` as StringKey)}</div>
      <div class="words">
        <p class="line">${row.line}</p>
        ${
          row.details.length === 0
            ? nothing
            : html`<p class="detail">${row.details.join(" · ")}</p>`
        }
        ${sentences.map((sentence) => html`<p class="alert" data-test="row-alert">${sentence}</p>`)}
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
      </div>
      <div class="actions">
        ${this.#screensOf(row).map((screen) => this.#goToButton(screen))}
        ${disk ? this.#freeAction(health) : nothing}
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
