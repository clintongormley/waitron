import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { actionsStyles, statusStyles } from "../form-styles.js";
import type { SetupApi } from "../api/client.js";

export const BACKUP_SETUP_URL = "/manage/backup";

/**
 * The wizard's final screen. The box restarts after provision, restore or adopt, and this screen
 * polls `GET /setup-api/status` until the setup route stops answering — see
 * {@link SetupDoneScreen.#pollOnce} for which failures mean "still restarting".
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
        font-family: var(--wt-font-family-mono);
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

  @property({ attribute: false }) api!: SetupApi;

  /** The server keeps only a verifier of this secret (`mintBreakGlassSecret`), so this screen is the
   * operator's only chance to record it. */
  @property({ attribute: false }) breakGlassSecret?: string;

  /**
   * True after a successful adopt, where the box does not come back trading (why:
   * `PendingAdoption` in `apps/server/src/finish-adoption.ts`). A separate flag rather than a
   * `breakGlassSecret` test: the secret is a value to display, not a statement of which path ran.
   */
  @property({ type: Boolean }) mirrorJoin = false;

  @property() onboardingIntent?: "demo" | "prepare" | "live";

  /** True after a rebuild from the owner's bucket, whose devices may need pointing at this server. */
  @property({ type: Boolean }) rebuilt = false;

  @property({ attribute: false }) reload: () => void = location.reload.bind(location);

  @property() hostname: string = location.hostname;

  /** A pause before the first poll so the box has begun its restart. */
  @property({ type: Number }) startDelayMs = 800;

  @property({ type: Number }) pollIntervalMs = 1500;

  @state() private ready = false;

  #timer?: ReturnType<typeof setTimeout>;

  override firstUpdated(): void {
    this.#timer = setTimeout(() => void this.#tick(), this.startDelayMs);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.#timer !== undefined) clearTimeout(this.#timer);
  }

  async #tick(): Promise<void> {
    if (!this.isConnected || this.ready) return;
    await this.#pollOnce();
    if (!this.isConnected || this.ready) return;
    this.#timer = setTimeout(() => void this.#tick(), this.pollIntervalMs);
  }

  /**
   * A resolved `getStatus` means the box has not restarted yet. A `TypeError` is `fetch` failing while
   * the box is down mid-restart: expected, never shown. Any other rejection (a non-2xx, or a body that
   * is not JSON) is taken to mean the setup route is gone and the box is trading.
   */
  async #pollOnce(): Promise<void> {
    try {
      await this.api.getStatus();
    } catch (error) {
      if (error instanceof TypeError) {
        return;
      }
      if (!this.isConnected) return;
      this.ready = true;
    }
  }

  override render(): TemplateResult {
    return this.mirrorJoin ? this.#renderJoinStalled() : this.#renderTrading();
  }

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

  #renderTrading(): TemplateResult {
    return html`
      <h1>${this.rebuilt ? "Rebuilt from your bucket" : "Setup complete"}</h1>
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
      ${this.rebuilt ? this.#deviceSteps() : nothing} ${this.#breakGlass()}
      ${
        this.onboardingIntent === "demo" || this.rebuilt
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

  #deviceSteps(): TemplateResult {
    return html`<div class="links" data-test="device-steps">
      <p>Devices depend on how each was set up:</p>
      <ul>
        <li>
          Tills, handhelds and kitchen screens that were opened at https://waitron.local reconnect
          by themselves.
        </li>
        <li>
          Any that were opened at an IP address (for example by scanning a QR code) must be opened
          again: go to /setup/trust on this server, scan its QR code, and set the device up again.
        </li>
        <li>
          A print agent on this server reconnects by itself. One on another computer that was given
          an IP address needs its Server address changed on its own page, at port 9110 on that
          computer.
        </li>
      </ul>
    </div>`;
  }

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
