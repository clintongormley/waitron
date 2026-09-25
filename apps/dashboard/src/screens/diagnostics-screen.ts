import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { DashboardApi, DiagnosticsLine, Verbosity } from "../api/client.js";

const POLL_MS = 1500;
/** The node auto-reverts after this window, so a raise always expires. */
const WINDOW_MINUTES = 15;

@customElement("dashboard-diagnostics-screen")
export class DiagnosticsScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .title {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-lg);
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
      /* The log tail: a monospace column of fixed-order rows, scrolling within its own box so a long
         tail never grows the page. */
      .log {
        list-style: none;
        margin: 0;
        padding: var(--wt-space-2);
        display: grid;
        gap: 2px;
        max-height: 60vh;
        overflow-y: auto;
        background: var(--wt-color-surface);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        font-family: var(--wt-font-family-mono);
        font-size: var(--wt-font-size-sm);
      }
      .log li {
        white-space: pre-wrap;
        word-break: break-word;
      }
      .log code {
        font-family: inherit;
      }
      /* Level colouring — only real tokens (there is no dedicated warning token, so warn borrows the
         primary accent). Unknown levels fall through to the inherited text colour. */
      .lvl-error,
      .lvl-fatal {
        color: var(--wt-color-danger);
      }
      .lvl-warn {
        color: var(--wt-color-primary);
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

  @state() private lines: DiagnosticsLine[] = [];
  @state() private verbosity?: Verbosity;
  // While true the interval still fires but skips the refresh.
  @state() private paused = false;
  @state() private errorKey: string | null = null;
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
    try {
      const api = passive ? (this.api.background ?? this.api) : this.api;
      const [recent, verbosity] = await Promise.all([api.getRecentLogs(200), api.getVerbosity()]);
      this.lines = recent.lines;
      this.verbosity = verbosity;
      this.errorKey = null;
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.#inFlight = false;
    }
  }

  /** If a refresh is already in flight the guard skips this one, so the header catches up on the next
   * poll tick. */
  async #raise(): Promise<void> {
    try {
      await this.api.setVerbosity("debug", WINDOW_MINUTES);
      await this.#refresh();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** `t()` does NO substitution, so the `{time}` placeholder is filled here. */
  #revertWindow(revertsAt: string): string {
    const at = new Date(revertsAt);
    const clock = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
    return t("diagnostics.verbosity.window").replace("{time}", clock);
  }

  #renderVerbosity(): TemplateResult | typeof nothing {
    if (this.verbosity?.level !== "debug") return nothing;
    return html`<span class="verbosity" data-test="verbosity-on">
      ${t("diagnostics.verbosity.on")}${
        this.verbosity.revertsAt
          ? html` ·
              <span data-test="verbosity-window"
                >${this.#revertWindow(this.verbosity.revertsAt)}</span
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
        <wt-button variant="ghost" data-test="clear" @click=${() => (this.lines = [])}>
          ${t("diagnostics.action.clear")}
        </wt-button>
        ${this.#renderVerbosity()}
      </div>

      ${
        this.lines.length === 0
          ? html`<p class="empty" data-test="empty">${t("diagnostics.empty")}</p>`
          : html`<ol class="log" data-test="log">
              ${this.lines.map(
                (line) =>
                  html`<li class="lvl-${line.level}">
                    <code>${line.at} ${line.level} ${line.event}</code>
                  </li>`,
              )}
            </ol>`
      }
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
