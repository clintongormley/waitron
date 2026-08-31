import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { DashboardApi, DiagnosticsLine, Verbosity } from "../api/client.js";

/** How often the viewer re-polls the node's recent-log ring + verbosity while it is showing and not
 * paused. A live tail, not a firehose — 1.5s keeps the screen current without hammering the node. */
const POLL_MS = 1500;
/** The temporary-raise window (minutes) the "turn on detailed logging" control asks for. The node
 * auto-reverts to its standing level after this, so a manager can never leave debug logging on for
 * good by accident — the raise always expires. */
const WINDOW_MINUTES = 15;

/**
 * The management dashboard's LIVE DIAGNOSTICS screen (logging-diagnostics-foundation, Task 15): a
 * manager-only live tail of the node's structured log ring, plus the control to raise log verbosity to
 * `debug` for a bounded window when chasing a fault.
 *
 * It POLLS rather than streams — `getRecentLogs(200)` + `getVerbosity()` on a {@link POLL_MS} interval
 * started in `connectedCallback` and CLEARED in `disconnectedCallback` (a leaked `setInterval` would
 * keep fetching against a torn-down screen). The interval is skipped while `paused`, so an operator can
 * freeze the tail to read a line without it scrolling away; `resume` starts it flowing again and
 * `clear` empties the rendered rows (a local view reset — the node's ring is untouched, so the next
 * poll refills it). "Turn on detailed logging" calls `setVerbosity("debug", 15)` then refreshes, and
 * while a raise is live the header shows when it reverts.
 *
 * ERROR HANDLING mirrors the sibling screens: `#refresh`/`#raise` are each fully `try/catch`ed (invoked
 * via `void`), so a rejection becomes `errorKey` (the raw `{ code }`, falling back to `server.internal`)
 * rendered in a `role="alert"` banner, never an unhandled promise rejection. `codeMessage` maps the raw
 * code to localised copy at the render edge, so the banner shows a sentence and never the raw wire code.
 */
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
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
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

  /** The HTTP face of the dashboard. The app shell injects a real client; a test injects a stub. */
  @property({ attribute: false }) api!: DashboardApi;

  // The most recent log lines, refreshed on every unpaused poll. Cleared locally by the Clear control.
  @state() private lines: DiagnosticsLine[] = [];
  // The node's current verbosity (level + pending auto-revert). Undefined until the first poll settles.
  @state() private verbosity?: Verbosity;
  // Whether the live tail is frozen. While true the interval fires but skips the refresh.
  @state() private paused = false;
  @state() private errorKey: string | null = null;
  #timer?: ReturnType<typeof setInterval>;

  /** Single-flight guard for the poll (fix round 1, Important-1): true while a `#refresh()` is still in
   * flight. `#refresh` is driven by BOTH the ~1500ms interval and `#raise()`, and it awaits two round
   * trips, so without this a tick (or a raise) can fire before the previous request has resolved —
   * requests pile up and a slower OLDER response can land after a newer one and overwrite `lines`/
   * `verbosity` with stale data (a flicker/rollback in the live tail). A call that finds this true
   * returns early; the next tick tries again once the in-flight request has cleared it. `#refresh`
   * itself owns the guard, so every caller (interval + raise) goes through it. Mirrors
   * `dashboard-overview-screen.ts`'s `#overdueInFlight`. */
  #inFlight = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#refresh();
    this.#timer = setInterval(() => {
      if (!this.paused) void this.#refresh();
    }, POLL_MS);
  }

  override disconnectedCallback(): void {
    // Stop the poll: a leaked interval would keep fetching against a detached screen (and in a browser
    // test would hang the run). Cleared here, so the timer never outlives the element.
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
    super.disconnectedCallback();
  }

  /** Pull the recent log ring + current verbosity in one round trip pair. A rejection becomes the
   * `errorKey` banner rather than an unhandled rejection (called via `void`). */
  async #refresh(): Promise<void> {
    // Single-flight (see #inFlight): skip if a refresh is already running so an older, slower response
    // can never land after a newer one and overwrite the tail with stale data.
    if (this.#inFlight) return;
    this.#inFlight = true;
    try {
      const [recent, verbosity] = await Promise.all([
        this.api.getRecentLogs(200),
        this.api.getVerbosity(),
      ]);
      this.lines = recent.lines;
      this.verbosity = verbosity;
      this.errorKey = null;
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.#inFlight = false;
    }
  }

  /** Raise verbosity to `debug` for the bounded {@link WINDOW_MINUTES} window, then refresh so the
   * header immediately reflects the new level + revert time. A rejection becomes the `errorKey` banner;
   * never an unhandled rejection (called via `void`). */
  async #raise(): Promise<void> {
    try {
      await this.api.setVerbosity("debug", WINDOW_MINUTES);
      await this.#refresh();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** The auto-revert window copy with its `{time}` placeholder filled — `t()` does NO substitution, so
   * rendering the raw string would show a literal `{time}`. Substitutes the local clock time the raise
   * reverts at, so the rendered output never contains a `{`. */
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
