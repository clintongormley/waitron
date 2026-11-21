import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, pageTitleStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { DashboardApi, DiagnosticsLevel, DiagnosticsLog, Verbosity } from "../api/client.js";

const POLL_MS = 1500;
/** The node auto-reverts after this window, so a raise always expires. */
const WINDOW_MINUTES = 15;
const LEVELS = ["error", "warn", "info", "all"] as const;

@customElement("dashboard-diagnostics-screen")
export class DiagnosticsScreen extends LitElement {
  static override styles = [
    baseStyles,
    pageTitleStyles,
    css`
      :host {
        display: block;
      }
      .title {
        margin: 0 0 var(--wt-space-4);
        color: var(--wt-color-text);
      }
      .controls {
        display: flex;
        gap: var(--wt-space-2);
        align-items: center;
        flex-wrap: wrap;
        margin-bottom: var(--wt-space-4);
      }
      .verbosity {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        margin-bottom: var(--wt-space-2);
      }
      .filters wt-input {
        flex: 1 1 auto;
        min-width: 0;
      }
      .log {
        list-style: none;
        margin: 0;
        padding: var(--wt-space-2);
        max-height: 60vh;
        overflow: auto;
        background: var(--wt-color-surface);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        font-family: var(--wt-font-family-mono);
        font-size: var(--wt-font-size-sm);
      }
      .log li {
        padding-block: var(--wt-space-1);
        overflow-wrap: anywhere;
      }
      .log li + li {
        border-top: 1px solid var(--wt-color-border);
      }
      .log time,
      .log .level {
        white-space: nowrap;
      }
      .event {
        font-weight: var(--wt-font-weight-bold);
      }
      .lvl-error,
      .lvl-fatal {
        color: var(--wt-color-danger);
      }
      .lvl-warn {
        color: var(--wt-color-primary-text);
      }
      .lvl-info {
        color: var(--wt-color-text);
      }
      .lvl-debug,
      .lvl-trace {
        color: var(--wt-color-text-muted);
      }
      .empty {
        color: var(--wt-color-text-muted);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;

  @state() private recent?: DiagnosticsLog;
  @state() private level: DiagnosticsLevel = "warn";
  @state() private search = "";
  @state() private verbosity?: Verbosity;
  // While true the interval still fires but skips the refresh.
  @state() private paused = false;
  @state() private errorKey: string | null = null;
  /** Whether `errorKey` is a read's failure, the only message a later successful read may clear. */
  #readErrorShown = false;
  #timer?: ReturnType<typeof setInterval>;

  /** `#refresh` is driven by both the interval and `#raise()` and awaits two round trips; a call that
   * finds this true returns early, so a slower OLDER response can never overwrite a newer one. */
  #inFlight = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#refresh();
    this.#timer = setInterval(() => {
      if (!this.paused) void this.#refresh(true);
    }, POLL_MS);
  }

  override disconnectedCallback(): void {
    // A leaked interval would keep fetching against a detached screen.
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
    super.disconnectedCallback();
  }

  async #refresh(passive = false): Promise<void> {
    if (this.#inFlight) return;
    this.#inFlight = true;
    const level = this.level;
    try {
      const api = passive ? (this.api.background ?? this.api) : this.api;
      const [recent, verbosity] = await Promise.all([
        api.getRecentLogs(200, level),
        api.getVerbosity(),
      ]);
      if (level !== this.level) return;
      this.recent = recent;
      this.verbosity = verbosity;
      if (this.#readErrorShown) this.#showError(null);
    } catch (error) {
      if (level === this.level) this.#showReadError(error);
    } finally {
      this.#inFlight = false;
      if (this.isConnected && level !== this.level) void this.#refresh();
    }
  }

  /** If a refresh is already in flight the guard skips this one, so the header catches up on the next
   * poll tick. */
  async #raise(): Promise<void> {
    this.#showError(null);
    try {
      await this.api.setVerbosity("debug", WINDOW_MINUTES);
      await this.#refresh();
    } catch (error) {
      this.#showError(codeOf(error));
    }
  }

  #showError(code: string | null, fromRead = false): void {
    this.errorKey = code;
    this.#readErrorShown = fromRead;
  }

  /** A read's failure never replaces an action's message. */
  #showReadError(error: unknown): void {
    if (this.errorKey === null || this.#readErrorShown) this.#showError(codeOf(error), true);
  }

  #timeFormatter(seconds = false): Intl.DateTimeFormat {
    return new Intl.DateTimeFormat(currentLocale(), {
      timeZone: this.recent?.timeZone ?? "UTC",
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
      ...(seconds ? { second: "2-digit" } : {}),
    });
  }

  #renderLog(): TemplateResult {
    const time = this.#timeFormatter(true);
    const date = new Intl.DateTimeFormat(currentLocale(), {
      timeZone: this.recent?.timeZone ?? "UTC",
      dateStyle: "short",
    });
    const today = date.format(new Date());
    const formatAt = (at: string) => {
      const timestamp = new Date(at);
      const day = date.format(timestamp);
      const clock = time.format(timestamp);
      return day === today ? clock : `${day} ${clock}`;
    };
    const query = this.search.trim().toLowerCase();
    const rows =
      this.recent?.lines.flatMap(({ at, level, event, requestId, ...fields }) => {
        const localTime = formatAt(at);
        const request = requestId ? `${t("diagnostics.request_id")} ${requestId}` : "";
        const details = Object.entries(fields)
          .map(
            ([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`,
          )
          .join(" · ");
        if (![localTime, level, event, request, details].join(" ").toLowerCase().includes(query))
          return [];
        return html`<li class="lvl-${level}">
          <time datetime=${at}>${localTime}</time> <span class="level">${level}</span>
          <span class="event">${event}</span>${
            request ? html` · ${request}` : nothing
          }${details ? html` · ${details}` : nothing}
        </li>`;
      }) ?? [];
    const oldest = this.recent?.oldestScannedAt;
    const noMatches = query !== "" || Boolean(oldest);
    return html`
      ${
        rows.length
          ? html`<ol class="log" role="list" data-test="log">
              ${rows}
            </ol>`
          : html`<p class="empty" data-test=${noMatches ? "no-matches" : "empty"}>
              ${t(noMatches ? "diagnostics.no_matches" : "diagnostics.empty")}
            </p>`
      }
      ${
        oldest
          ? html`<p class="verbosity">
              ${fill("diagnostics.searched_since", { time: formatAt(oldest) })}
            </p>`
          : nothing
      }
    `;
  }

  #renderVerbosity(): TemplateResult | typeof nothing {
    if (this.verbosity?.level !== "debug") return nothing;
    return html`<span class="verbosity" data-test="verbosity-on">
      ${t("diagnostics.verbosity.on")}${
        this.verbosity.revertsAt
          ? html` ·
              <span data-test="verbosity-window"
                >${fill("diagnostics.verbosity.window", { time: this.#timeFormatter().format(new Date(this.verbosity.revertsAt)) })}</span
              >`
          : nothing
      }
    </span>`;
  }

  override render(): TemplateResult {
    return html`
      <h1 class="title">${t("diagnostics.title")}</h1>
      <div class="controls">
        <wt-button variant="primary" data-test="raise-verbosity" @click=${() => void this.#raise()}>
          ${t("diagnostics.verbosity.raise")}
        </wt-button>
        <wt-button
          variant="secondary"
          data-test="toggle-pause"
          @click=${() => (this.paused = !this.paused)}
        >
          ${t(this.paused ? "diagnostics.action.resume" : "diagnostics.action.pause")}
        </wt-button>
        <wt-button
          variant="ghost"
          data-test="clear"
          @click=${() => (this.recent = this.recent && { ...this.recent, lines: [], oldestScannedAt: null })}
        >
          ${t("diagnostics.action.clear")}
        </wt-button>
        ${this.#renderVerbosity()}
      </div>

      <div class="filters">
        <wt-combobox
          preserve-order
          search="never"
          name="log-level"
          label=${t("diagnostics.filter.level")}
          .options=${LEVELS.map((value) => ({ value, label: t(`diagnostics.filter.${value}`) }))}
          .value=${this.level}
          @wt-change=${(event: CustomEvent<{ value: DiagnosticsLevel }>) => {
            this.level = event.detail.value;
            if (this.recent) this.recent = { ...this.recent, lines: [], oldestScannedAt: null };
            void this.#refresh();
          }}
        ></wt-combobox>
        <wt-input
          name="log-search"
          type="search"
          autocomplete="off"
          label=${t("diagnostics.filter.search")}
          .value=${this.search}
          @wt-change=${(event: CustomEvent<{ value: string }>) => (this.search = event.detail.value)}
        ></wt-input>
      </div>

      ${this.#renderLog()}
      ${
        this.errorKey
          ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>`
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-diagnostics-screen": DiagnosticsScreen;
  }
}
