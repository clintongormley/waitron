import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-switch.js";
import { helpLinkStyles, actionsStyles } from "../form-styles.js";
import { dispatchSetupGoto, dispatchSetupPatch } from "../events.js";

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

  @property() environment?: "production" | "preproduction";

  @state() private confirming = false;

  @state() private understood = false;

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
    return html`
      <h1>Set up this Waitron server</h1>
      <p class="intro">
        This server runs the till and files fiscal records. Set it up once here, then it restarts
        into everyday trading mode.
      </p>
      <p class="cert-note">
        A certificate warning needs attention before you continue.
        <a href="/setup/trust" target="_blank" rel="noopener">Open certificate help</a>.
      </p>
      ${
        this.environment
          ? html`<p class="env" data-test="environment">${this.environment}</p>`
          : nothing
      }
      ${
        this.environment === "production"
          ? html`<p class="production-warning" role="alert" data-test="production-warning">
              This server is stamped for production — provisioning files real records to AEAT.
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
          <h2>Demo</h2>
          <p class="choice-copy">
            A practice server. Nothing is filed to AEAT — safe to explore and throw away.
          </p>
          <wt-button variant="primary" data-test="choose-demo" @click=${() => this.#chooseDemo()}
            >Set up a demo server</wt-button
          >
        </wt-card>
        <wt-card raised>
          <h2>Prepare your restaurant</h2>
          <p class="choice-copy">
            Enter your real menus, staff and layouts, then practise with test payments. Nothing is
            filed to AEAT.
          </p>
          <wt-button
            variant="secondary"
            data-test="choose-prepare"
            @click=${() => this.#choosePrepare()}
            >Prepare your restaurant</wt-button
          >
        </wt-card>
        <wt-card raised>
          <h2>Live</h2>
          <p class="choice-copy">
            The real thing. Every sale is filed to AEAT. This choice is permanent.
          </p>
          <wt-button variant="secondary" data-test="choose-live" @click=${() => this.#chooseLive()}
            >Go live</wt-button
          >
        </wt-card>
        <wt-card raised>
          <h2>Join or recover an existing restaurant</h2>
          <p class="choice-copy">
            Add this server as a mirror of a running restaurant, or recover a restaurant from a
            backup.
          </p>
          <wt-button
            variant="secondary"
            data-test="choose-existing"
            @click=${() => this.#chooseExisting()}
            >Join or recover</wt-button
          >
        </wt-card>
      </div>
    `;
  }

  #renderConfirm(): TemplateResult {
    return html`
      <wt-card raised class="confirm">
        <h2>This is permanent</h2>
        <p class="warning" role="alert" data-test="live-warning">
          A live server files real invoices to AEAT and can NEVER become a demo — this is permanent.
        </p>
        <wt-switch
          class="understand"
          data-test="understand"
          label="I understand this cannot be undone"
          .checked=${this.understood}
          @wt-change=${(e: CustomEvent<{ checked: boolean }>) => this.#onUnderstood(e)}
        ></wt-switch>
        <div class="actions">
          <wt-button variant="ghost" data-test="live-cancel" @click=${() => this.#cancelLive()}
            >Back</wt-button
          >
          <wt-button
            variant="danger"
            data-test="confirm-live"
            ?disabled=${!this.understood}
            @click=${() => this.#confirmLive()}
            >Set up this live server</wt-button
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
