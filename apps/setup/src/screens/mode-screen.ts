import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-switch.js";
import { helpLinkStyles, actionsStyles } from "../form-styles.js";
import { dispatchSetupGoto, dispatchSetupPatch } from "../events.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";

/**
 * A provisioned live venue is never turned into a demo, so Live goes through a warning and an
 * "I understand" confirm rather than advancing on one click.
 */
@customElement("setup-mode-screen")
export class SetupModeScreen extends LitElement {
  static override styles = [
    helpLinkStyles,
    baseStyles,
    actionsStyles,
    css`
      :host {
        display: block;
      }

      .intro {
        margin: var(--wt-space-3) 0;
        color: var(--wt-color-text-muted);
      }

      .cert-note {
        margin: var(--wt-space-3) 0 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .env {
        margin: var(--wt-space-3) 0 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .production-warning {
        margin: var(--wt-space-3) 0 0;
        color: var(--wt-color-danger);
        font-weight: var(--wt-font-weight-bold);
      }

      .choices {
        display: grid;
        gap: var(--wt-space-4);
        margin-top: var(--wt-space-4);
      }

      h2 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-lg);
      }

      .choice-copy {
        margin: 0 0 var(--wt-space-3);
        color: var(--wt-color-text-muted);
      }

      .warning {
        color: var(--wt-color-danger);
        font-weight: var(--wt-font-weight-bold);
      }

      .confirm {
        margin-top: var(--wt-space-4);
      }

      .understand {
        display: block;
        margin: var(--wt-space-3) 0;
      }
    `,
  ];

  @property({ type: Boolean }) certificateNote = false;

  @property() environment?: "production" | "preproduction";

  @state() private confirming = false;

  @state() private understood = false;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  #advance(mode: "demo" | "prepare" | "live"): void {
    dispatchSetupPatch(this, { mode });
    dispatchSetupGoto(this, "admin");
  }

  #chooseDemo(): void {
    this.#advance("demo");
  }

  #choosePrepare(): void {
    this.#advance("prepare");
  }

  /** Joining or recovering is not a fresh primary, so it writes no mode. */
  #chooseExisting(): void {
    dispatchSetupGoto(this, "role");
  }

  #chooseLive(): void {
    this.confirming = true;
  }

  #onUnderstood(event: CustomEvent<{ checked: boolean }>): void {
    event.stopPropagation();
    this.understood = event.detail.checked;
  }

  #confirmLive(): void {
    if (!this.understood) return;
    dispatchSetupPatch(this, { mode: "live" });
    dispatchSetupGoto(this, "live-source");
  }

  #cancelLive(): void {
    this.confirming = false;
    this.understood = false;
  }

  override render(): TemplateResult {
    const environment = this.environment && t(`mode.environment.${this.environment}`);
    return html`
      <h1>${t("mode.heading")}</h1>
      <p class="intro">${t("mode.intro")}</p>
      ${
        this.certificateNote
          ? html`<p class="cert-note" data-test="cert-note">
              ${t("mode.cert_note")}
              <a href="/setup/trust" target="_blank" rel="noopener" data-test="trust-help"
                >${t("mode.cert_note_link")}</a
              >.
            </p>`
          : nothing
      }
      ${
        this.environment ? html`<p class="env" data-test="environment">${environment}</p>` : nothing
      }
      ${
        this.environment === "production"
          ? html`<p class="production-warning" role="alert" data-test="production-warning">
              ${t("mode.production_warning")}
            </p>`
          : nothing
      }
      ${this.confirming ? this.#renderConfirm() : this.#renderChoices()}
    `;
  }

  #renderChoices(): TemplateResult {
    return html`
      <div class="choices">
        <wt-card raised>
          <h2>${t("mode.demo.heading")}</h2>
          <p class="choice-copy">${t("mode.demo.copy")}</p>
          <wt-button variant="primary" data-test="choose-demo" @click=${() => this.#chooseDemo()}
            >${t("mode.demo.button")}</wt-button
          >
        </wt-card>
        <wt-card raised>
          <h2>${t("mode.prepare.heading")}</h2>
          <p class="choice-copy">${t("mode.prepare.copy")}</p>
          <wt-button
            variant="secondary"
            data-test="choose-prepare"
            @click=${() => this.#choosePrepare()}
            >${t("mode.prepare.button")}</wt-button
          >
        </wt-card>
        <wt-card raised>
          <h2>${t("mode.live.heading")}</h2>
          <p class="choice-copy">${t("mode.live.copy")}</p>
          <wt-button variant="secondary" data-test="choose-live" @click=${() => this.#chooseLive()}
            >${t("mode.live.button")}</wt-button
          >
        </wt-card>
        <wt-card raised>
          <h2>${t("mode.existing.heading")}</h2>
          <p class="choice-copy">${t("mode.existing.copy")}</p>
          <wt-button
            variant="secondary"
            data-test="choose-existing"
            @click=${() => this.#chooseExisting()}
            >${t("mode.existing.button")}</wt-button
          >
        </wt-card>
      </div>
    `;
  }

  #renderConfirm(): TemplateResult {
    return html`
      <wt-card raised class="confirm">
        <h2>${t("mode.confirm.heading")}</h2>
        <p class="warning" role="alert" data-test="live-warning">${t("mode.confirm.warning")}</p>
        <wt-switch
          class="understand"
          data-test="understand"
          label=${t("mode.confirm.understand")}
          .checked=${this.understood}
          @wt-change=${(e: CustomEvent<{ checked: boolean }>) => this.#onUnderstood(e)}
        ></wt-switch>
        <div class="actions">
          <wt-button variant="ghost" data-test="live-cancel" @click=${() => this.#cancelLive()}
            >${t("mode.confirm.back")}</wt-button
          >
          <wt-button
            variant="danger"
            data-test="confirm-live"
            ?disabled=${!this.understood}
            @click=${() => this.#confirmLive()}
            >${t("mode.confirm.button")}</wt-button
          >
        </div>
      </wt-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-mode-screen": SetupModeScreen;
  }
}
