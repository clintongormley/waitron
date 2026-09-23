import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { actionsStyles, statusStyles } from "../form-styles.js";
import type { SetupApi } from "../api/client.js";

/** The dashboard's backup screen (`apps/dashboard/src/dashboard-app.ts`'s `backup` face), reached at
 * its path-based route (`UrlStateController` + `dashboardPath`, `apps/dashboard/src/navigation.ts`:
 * `basePath: "/manage"`, `primary: "dashboard"`). Same origin as the box's trading server, which is
 * what this screen is waiting to come back up as. */
export const BACKUP_SETUP_URL = "/manage/backup";

/**
 * The wizard's final screen, shared by three outcomes that are NOT the same. A successful provision or
 * restore returns `{ restarting: true }` and the box then SIGTERMs and comes back in TRADING mode,
 * where the origin root serves the till and the `/setup-api/*` routes no longer exist
 * (`apps/server/src/setup-api.ts`). So this screen cannot get a further success response — it
 * announces the restart and RECONNECTS by polling `GET /setup-api/status` until the setup route stops
 * answering, then offers a reload into the till.
 *
 * A successful ADOPT restarts the same way and comes back somewhere else entirely, so it gets its own
 * copy rather than a reworded version of the trading one — see {@link SetupDoneScreen.mirrorJoin}.
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
      .break-glass {
        margin: 1rem 0;
        padding: 1rem;
        border: 2px solid var(--wt-color-warning, #b45309);
        border-radius: 0.5rem;
      }
      .break-glass h2 {
        margin-top: 0;
        font-size: 1rem;
      }
      .break-glass-warning {
        font-weight: 600;
      }
      .break-glass-secret {
        display: block;
        margin-top: 0.5rem;
        padding: 0.5rem 0.75rem;
        font-family: ui-monospace, "SF Mono", Menlo, monospace;
        font-size: 1.1rem;
        word-break: break-all;
        user-select: all;
        /* --wt-color-surface-sunken is not a token this design system defines (see
           packages/ui-core/src/tokens/colors.css), so the hardcoded light fallback that stood here
           painted in BOTH themes: axe measured the code against the dark theme's text at a contrast
           of 1.06, i.e. the operator's one-and-only break-glass code was unreadable. */
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        border: 1px solid var(--wt-color-border);
        border-radius: 0.375rem;
      }
      .backup-nudge {
        margin: 1rem 0;
        padding: 1rem;
        border: 1px solid var(--wt-color-border, #cbd5e1);
        border-radius: 0.5rem;
      }
      .mode-indicator {
        display: inline-block;
        margin: 0 0 1rem;
        padding: 0.25rem 0.75rem;
        border-radius: 999px;
        border: 1px solid var(--wt-color-border);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font-weight: 700;
      }
      .nudge-link {
        display: inline-block;
        margin-top: 0.5rem;
        color: var(--wt-color-primary, #1f6feb);
        text-decoration: underline;
      }
      .links a {
        color: var(--wt-color-primary, #1f6feb);
      }
    `,
  ];

  /** The HTTP face of the box, injected by the shell. Used only to poll `getStatus` for the reconnect. */
  @property({ attribute: false }) api!: SetupApi;

  /**
   * The break-glass secret the adopt path minted (mirror path only), passed by the shell from the
   * adopt 200. Shown ONCE here — the adopt response carries it a single time and the server never logs
   * or re-issues it (spec §4.2), so this screen is the operator's only chance to record it.
   * `undefined` on the primary provision path, which mints no secret and shows no panel.
   */
  @property({ attribute: false }) breakGlassSecret?: string;

  /**
   * True when this screen was reached by the MIRROR path (a successful `POST /setup-api/adopt`), set
   * by the shell. Everything the trading copy below promises is false on that path: the box restarts
   * and fails to establish its own node identity, on that boot and on every boot after it, so it never
   * reaches the branch of `apps/server/src/boot.ts` that mounts the till and dashboard front-ends, the
   * promote route the break-glass secret is for, or this wizard.
   * `apps/server/src/finish-adoption.ts`'s `PendingAdoption` header is the one place that says why.
   *
   * A separate flag rather than a `breakGlassSecret !== undefined` test: the secret is mirror-only too
   * today, but it is a value to display, not a statement about which path ran, and a mirror path that
   * stopped minting one would silently flip this screen back to promising a till.
   */
  @property({ type: Boolean }) mirrorJoin = false;

  /** The selected setup journey. Its label stays visible here, and Demo suppresses the backup nudge. */
  @property() onboardingIntent?: "demo" | "prepare" | "live";

  /** How to reload into the till once trading mode is up. Injectable so a test can assert it without
   * navigating the runner; the default is the real page reload (a bound native, not authored code). */
  @property({ attribute: false }) reload: () => void = location.reload.bind(location);

  /** The box's own hostname, used only for the print-agent link (a different port, so an absolute
   * URL). Injectable so a test does not depend on the runner's location. */
  @property() hostname: string = location.hostname;

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
    return this.mirrorJoin ? this.#renderJoinStalled() : this.#renderTrading();
  }

  /**
   * The break-glass panel, rendered on whichever path supplied a secret. Its own copy is path-aware
   * because what the secret is FOR differs: on a box that trades it is the offline promote fallback;
   * on an adopted box the promote route is never mounted, so there is nothing to use it on.
   */
  #breakGlass(): TemplateResult | null {
    if (this.breakGlassSecret === undefined) return null;
    return html`<div class="break-glass" data-test="break-glass">
      <h2>Save your break-glass code now</h2>
      <p class="break-glass-warning" data-test="break-glass-warning">
        Write this down and store it offline. It is shown once and will not be shown again.
        ${
          this.mirrorJoin
            ? html`It was meant to let this server take over if the primary server could not be
              reached. It cannot do that in this version, because this server does not finish
              joining — so keep the code, but do not count on it.`
            : html`You need it to promote this server if the primary is unreachable.`
        }
      </p>
      <code class="break-glass-secret" data-test="break-glass-secret"
        >${this.breakGlassSecret}</code
      >
    </div>`;
  }

  /** The provision and restore outcome: the box really does come back trading. */
  #renderTrading(): TemplateResult {
    return html`
      <h1>Setup complete</h1>
      ${
        this.onboardingIntent === undefined
          ? nothing
          : html`<p class="mode-indicator" data-test="mode-indicator">
              ${{ demo: "Demo", prepare: "Preparation", live: "Live" }[this.onboardingIntent]}
            </p>`
      }
      <p>The server is restarting into trading mode.</p>
      <div class="links" data-test="links">
        <p>Once the server is trading, reach it here:</p>
        <ul>
          <li><a href="/">Till</a></li>
          <li><a href="/manage">Dashboard</a></li>
          <li><a href="/manage/email">Email inbox</a></li>
          <li><a href=${`http://${this.hostname}:9110`}>Print agent</a></li>
        </ul>
      </div>
      ${this.#breakGlass()}
      ${
        this.onboardingIntent === "demo"
          ? nothing
          : html`<div class="backup-nudge" data-test="backup-nudge">
              <p>
                Your server is trading — but it has no backups yet, so there is no way back from a
                disk failure.
              </p>
              <a class="nudge-link" href=${BACKUP_SETUP_URL}>Set up backups now</a>
            </div>`
      }
      ${
        this.ready
          ? html`<div class="actions">
              <wt-button variant="primary" data-test="reload" @click=${() => this.reload()}
                >Reload to open the till</wt-button
              >
            </div>`
          : html`<p class="status" data-test="status">
              Waiting for the server to come back online…
            </p>`
      }
    `;
  }

  /**
   * The mirror outcome. No links, no backup nudge and no reload: the box this wizard is talking to
   * comes back serving none of those, so every one of them would send the operator somewhere that is
   * not there. The poll still runs — it is how this screen knows the restart has happened — it just
   * reports it instead of offering a way in.
   */
  #renderJoinStalled(): TemplateResult {
    return html`
      <h1>This server did not join</h1>
      <p>
        The sign-in to the restaurant's primary worked and this server is restarting. It will not
        come back able to do anything: it stops part-way through joining, and it will not get any
        further however many times you restart it. It holds none of the restaurant's information, it
        has no till and no dashboard, and it cannot sell or file anything.
      </p>
      ${this.#breakGlass()}
      ${
        this.ready
          ? html`<p class="status" data-test="status">
              The server has restarted, and this setup wizard is gone from it — reloading this page
              will not bring anything up, and there is nothing else on the server to open. Nothing
              on this page can fix that: tell whoever installed this server.
            </p>`
          : html`<p class="status" data-test="status">Waiting for the server to restart…</p>`
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-done-screen": SetupDoneScreen;
  }
}
