import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import { actionsStyles, statusStyles } from "../form-styles.js";
import type { SetupApi } from "../api/client.js";

/**
 * The wizard's final screen. A successful provision returns `{ restarting: true }` and the box then
 * SIGTERMs and comes back in TRADING mode, where the origin root serves the till and the
 * `/setup-api/*` routes no longer exist (`apps/server/src/setup-api.ts`). So this screen cannot get a
 * further success response — it announces the restart and RECONNECTS by polling `GET /setup-api/status`
 * until the setup route stops answering, then offers a reload into the till.
 *
 * The restart window produces EXPECTED fetch failures that must never be surfaced as errors, and the
 * distinction is the whole job of {@link SetupDoneScreen.#pollOnce}:
 *
 * - A `getStatus()` that RESOLVES means the setup API still answered — the box has not restarted yet.
 *   Keep waiting.
 * - A rejection that is a network/connection failure (`fetch` throws a `TypeError` while the box is
 *   down mid-restart) is the EXPECTED restart-window failure. Keep waiting; never show it.
 * - Any OTHER rejection — a non-2xx from the client's `#request` (a plain `{ code }`, e.g. the `404`
 *   once `/setup-api/*` is gone) or a body that no longer parses as the status JSON — means trading
 *   mode is up and the setup route no longer answers. Stop, and offer the reload.
 */
@customElement("setup-done-screen")
export class SetupDoneScreen extends LitElement {
  static override styles = [
    baseStyles,
    statusStyles,
    actionsStyles,
    css`
      :host {
        display: block;
      }
    `,
  ];

  /** The HTTP face of the box, injected by the shell. Used only to poll `getStatus` for the reconnect. */
  @property({ attribute: false }) api!: SetupApi;

  /** How to reload into the till once trading mode is up. Injectable so a test can assert it without
   * navigating the runner; the default is the real page reload (a bound native, not authored code). */
  @property({ attribute: false }) reload: () => void = location.reload.bind(location);

  /** Milliseconds before the first status poll — a short pause so the box has begun its restart. */
  @property({ type: Number }) startDelayMs = 800;

  /** Milliseconds between status polls during the restart window. */
  @property({ type: Number }) pollIntervalMs = 1500;

  /** True once the setup route has stopped answering — the box is trading and the reload is offered. */
  @state() private ready = false;

  #timer?: ReturnType<typeof setTimeout>;

  override firstUpdated(): void {
    this.#timer = setTimeout(() => void this.#tick(), this.startDelayMs);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.#timer !== undefined) clearTimeout(this.#timer);
  }

  /** One poll, then reschedule the next unless the box is already trading or this element is gone. */
  async #tick(): Promise<void> {
    if (!this.isConnected || this.ready) return;
    await this.#pollOnce();
    if (!this.isConnected || this.ready) return;
    this.#timer = setTimeout(() => void this.#tick(), this.pollIntervalMs);
  }

  /**
   * Probe the setup API once. The `TypeError` branch is the expected restart-window connection
   * failure (swallowed, never rendered); any other rejection means the box is back up in trading mode.
   */
  async #pollOnce(): Promise<void> {
    try {
      await this.api.getStatus();
      // The setup API answered — the box has not yet restarted into trading mode. Keep waiting.
    } catch (error) {
      if (error instanceof TypeError) {
        // A connection failure: the box is mid-restart and briefly unreachable. Expected — keep waiting.
        return;
      }
      if (!this.isConnected) return;
      this.ready = true;
    }
  }

  override render(): TemplateResult {
    return html`
      <wt-card>
        <h1>Setup complete</h1>
        <p>The box is restarting into trading mode.</p>
        ${
          this.ready
            ? html`<div class="actions">
                <wt-button variant="primary" data-test="reload" @click=${() => this.reload()}
                  >Reload to open the till</wt-button
                >
              </div>`
            : html`<p class="status" data-test="status">
                Waiting for the box to come back online…
              </p>`
        }
      </wt-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-done-screen": SetupDoneScreen;
  }
}
