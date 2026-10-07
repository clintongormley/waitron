import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-choice-row.js";
import { helpLinkStyles, introStyles, statusStyles } from "../form-styles.js";
import { modePill, modePillStyles } from "../mode-pill.js";
import type { SetupApi } from "../api/client.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { t } from "../i18n/t.js";

export const BACKUP_SETUP_URL = "/manage/backup";

@customElement("setup-done-screen")
export class SetupDoneScreen extends LitElement {
  static override styles = [
    helpLinkStyles,
    baseStyles,
    statusStyles,
    introStyles,
    modePillStyles,
    css`
      :host {
        display: block;
      }
      .mode {
        margin: 0 0 var(--wt-space-3);
      }
      .intro {
        margin: 0 0 var(--wt-space-4);
      }
      .choices,
      wt-card,
      .break-glass {
        margin: var(--wt-space-4) 0;
      }
      wt-card p {
        margin: 0 0 var(--wt-space-2);
      }
      wt-card ul {
        margin: 0;
      }
      .break-glass {
        padding: var(--wt-space-4);
        border: 1px solid var(--wt-color-warning);
        border-inline-start: var(--wt-space-1) solid var(--wt-color-warning);
        border-radius: var(--wt-radius-lg);
        background: var(--wt-color-surface);
      }
      .break-glass h2 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-lg);
      }
      .break-glass-warning {
        margin: 0;
        font-weight: var(--wt-font-weight-bold);
      }
      .break-glass-secret {
        display: block;
        margin: var(--wt-space-2) 0 0;
        padding: var(--wt-space-2) var(--wt-space-3);
        font-family: var(--wt-font-family-mono);
        font-size: var(--wt-font-size-lg);
        word-break: break-all;
        user-select: all;
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
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
          : html`<div class="mode">${modePill(this.onboardingIntent, "mode-indicator")}</div>`
      }
      <p class="intro" data-test="status" role="status">
        ${t(this.ready ? "done.ready" : "done.restarting")}
      </p>
      <div class="choices" data-test="links">
        <wt-choice-row data-test="link-dashboard" heading=${t("done.link.dashboard")} href="/manage"
          >${t("done.description.dashboard")}</wt-choice-row
        >
        <wt-choice-row data-test="link-till" heading=${t("done.link.till")} href="/"
          >${t("done.description.till")}</wt-choice-row
        >
        <wt-choice-row data-test="link-email" heading=${t("done.link.email")} href="/manage/email"
          >${t("done.description.email")}</wt-choice-row
        >
      </div>
      ${this.rebuilt ? this.#deviceSteps() : nothing} ${this.#breakGlass()}
      ${
        this.onboardingIntent === "demo" || this.rebuilt
          ? nothing
          : html`<wt-card data-test="backup-nudge">
              <p>${t("done.backup_nudge")}</p>
              <a href=${BACKUP_SETUP_URL}>${t("done.backup_link")}</a>
            </wt-card>`
      }
    `;
  }

  #deviceSteps(): TemplateResult {
    return html`<wt-card data-test="device-steps">
      <p>${t("done.devices.intro")}</p>
      <ul>
        <li>${t("done.devices.local")}</li>
        <li>${t("done.devices.ip")}</li>
        <li>${t("done.devices.print_agent")}</li>
      </ul>
    </wt-card>`;
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
