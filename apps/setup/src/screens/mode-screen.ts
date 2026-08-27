import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-switch.js";

/**
 * The wizard's first step: welcome the operator, warn that the browser's certificate warning is
 * expected (the box serves the wizard over its own self-signed HTTPS; the full per-device trust UI is
 * slice 3), and let them pick DEMO or LIVE.
 *
 * The choice is irreversible one way — a live box files real invoices to AEAT and can never become a
 * demo (fiscal §5) — so LIVE does NOT provision on a single click. Clicking it reveals a loud
 * permanence warning and an "I understand" switch that gates an explicit confirm button; only that
 * confirm emits `mode:"live"`. DEMO, being reversible in practice, advances immediately.
 *
 * It talks to the shell through the two composed/bubbling events the whole wizard shares: a
 * `setup-patch` carrying the chosen `mode`, then a `setup-goto` to the `admin` step. `environment`
 * (read by the shell from `GET /setup-api/status`) is shown so a box stamped `production` is called
 * out before anything is filed.
 */
@customElement("setup-mode-screen")
export class SetupModeScreen extends LitElement {
  static override styles = [
    baseStyles,
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

      .actions {
        display: flex;
        gap: var(--wt-space-3);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  /** The box's stamped environment, passed down from the shell. `production` is surfaced loudly. */
  @property() environment?: "production" | "preproduction";

  /** True once LIVE has been chosen: the permanence warning + confirm gate replaces the two choices. */
  @state() private confirming = false;

  /** The "I understand" switch — gates the LIVE confirm button (and the emit) while off. */
  @state() private understood = false;

  /**
   * Emit the chosen mode up to the shell as a `setup-patch`, then navigate to the `admin` step. Both
   * events are composed + bubbling so they cross this screen's shadow boundary; the shell merges the
   * patch into its draft and flips the visible screen.
   */
  #advance(mode: "demo" | "live"): void {
    this.dispatchEvent(
      new CustomEvent("setup-patch", {
        detail: { patch: { mode } },
        bubbles: true,
        composed: true,
      }),
    );
    this.dispatchEvent(
      new CustomEvent("setup-goto", { detail: { screen: "admin" }, bubbles: true, composed: true }),
    );
  }

  /** DEMO is reversible in practice, so it advances immediately with no confirmation. */
  #chooseDemo(): void {
    this.#advance("demo");
  }

  /**
   * LIVE does NOT advance here — it reveals the permanence warning + confirm gate. This is the guard:
   * prove-by-deletion by wiring the LIVE button straight to `#advance("live")` instead, and the
   * "one click on Live does not provision live" test flips red (one click would then emit `mode:live`).
   */
  #chooseLive(): void {
    this.confirming = true;
  }

  #onUnderstood(event: CustomEvent<{ checked: boolean }>): void {
    event.stopPropagation();
    this.understood = event.detail.checked;
  }

  /** The explicit confirm. Emits `mode:"live"` only once the operator has switched "I understand" on. */
  #confirmLive(): void {
    if (!this.understood) return;
    this.#advance("live");
  }

  #cancelLive(): void {
    this.confirming = false;
    this.understood = false;
  }

  override render(): TemplateResult {
    return html`
      <wt-card>
        <h1>Set up this Waitron box</h1>
        <p class="intro">
          This box runs the till and files fiscal records. Set it up once here, then it restarts
          into everyday trading mode.
        </p>
        <p class="cert-note">
          The browser security warning is expected — this box uses its own certificate.
        </p>
        ${
          this.environment
            ? html`<p class="env" data-test="environment">${this.environment}</p>`
            : nothing
        }
        ${
          this.environment === "production"
            ? html`<p class="production-warning" role="alert" data-test="production-warning">
                This box is stamped for production — provisioning files real records to AEAT.
              </p>`
            : nothing
        }
      </wt-card>

      ${this.confirming ? this.#renderConfirm() : this.#renderChoices()}
    `;
  }

  #renderChoices(): TemplateResult {
    return html`
      <div class="choices">
        <wt-card raised>
          <h2>Demo</h2>
          <p class="choice-copy">
            A practice box. Nothing is filed to AEAT — safe to explore and throw away.
          </p>
          <wt-button variant="primary" data-test="choose-demo" @click=${() => this.#chooseDemo()}
            >Set up a demo box</wt-button
          >
        </wt-card>
        <wt-card raised>
          <h2>Live</h2>
          <p class="choice-copy">
            The real thing. Every sale is filed to AEAT. This choice is permanent.
          </p>
          <wt-button variant="secondary" data-test="choose-live" @click=${() => this.#chooseLive()}
            >Set up a live box</wt-button
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
          A live box files real invoices to AEAT and can NEVER become a demo — this is permanent.
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
            >Set up this live box</wt-button
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
