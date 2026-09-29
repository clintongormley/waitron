import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { actionsStyles, statusStyles } from "../form-styles.js";
import type { SetupApi } from "../api/client.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { t } from "../i18n/t.js";

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

  constructor() {
    super();
    new LocaleChangeController(this);
  }

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
      <h2>${t("done.break_glass.heading")}</h2>
      <p class="break-glass-warning" data-test="break-glass-warning">
        ${t("done.break_glass.warning")}
        ${t(this.mirrorJoin ? "done.break_glass.join_stalled" : "done.break_glass.promote")}
      </p>
      <code class="break-glass-secret" data-test="break-glass-secret"
        >${this.breakGlassSecret}</code
      >
    </div>`;
  }

  #renderTrading(): TemplateResult {
    return html`
      <h1>${t(this.rebuilt ? "done.heading_rebuilt" : "done.heading")}</h1>
      ${
        this.onboardingIntent === undefined
          ? nothing
          : html`<p class="mode-indicator" data-test="mode-indicator">
              ${t(`done.mode.${this.onboardingIntent}`)}
            </p>`
      }
      <p>${t("done.restarting")}</p>
      <div class="links" data-test="links">
        <p>${t("done.links_intro")}</p>
        <ul>
          <li><a href="/">${t("done.link.till")}</a></li>
          <li><a href="/manage">${t("done.link.dashboard")}</a></li>
          <li><a href="/manage/email">${t("done.link.email")}</a></li>
          <li><a href=${`http://${this.hostname}:9110`}>${t("done.link.print_agent")}</a></li>
        </ul>
      </div>
      ${this.rebuilt ? this.#deviceSteps() : nothing} ${this.#breakGlass()}
      ${
        this.onboardingIntent === "demo" || this.rebuilt
          ? nothing
          : html`<div class="backup-nudge" data-test="backup-nudge">
              <p>${t("done.backup_nudge")}</p>
              <a class="nudge-link" href=${BACKUP_SETUP_URL}>${t("done.backup_link")}</a>
            </div>`
      }
      ${
        this.ready
          ? html`<div class="actions">
              <wt-button variant="primary" data-test="reload" @click=${() => this.reload()}
                >${t("done.reload")}</wt-button
              >
            </div>`
          : html`<p class="status" data-test="status">${t("done.waiting_online")}</p>`
      }
    `;
  }

  #deviceSteps(): TemplateResult {
    return html`<div class="links" data-test="device-steps">
      <p>${t("done.devices.intro")}</p>
      <ul>
        <li>${t("done.devices.local")}</li>
        <li>${t("done.devices.ip")}</li>
        <li>${t("done.devices.print_agent")}</li>
      </ul>
    </div>`;
  }

  #renderJoinStalled(): TemplateResult {
    return html`
      <h1>${t("done.stalled.heading")}</h1>
      <p>${t("done.stalled.body")}</p>
      ${this.#breakGlass()}
      ${
        this.ready
          ? html`<p class="status" data-test="status">${t("done.stalled.restarted")}</p>`
          : html`<p class="status" data-test="status">${t("done.stalled.waiting")}</p>`
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-done-screen": SetupDoneScreen;
  }
}
