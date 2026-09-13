import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import { helpLinkStyles, actionsStyles, errorStyles, statusStyles } from "../form-styles.js";

/**
 * The wizard's first step: it asks the operator to read their own address bar.
 *
 * A page cannot tell whether the browser reached it over a trusted certificate or over an
 * interstitial the operator clicked through — after a bypass the page still reads
 * `isSecureContext: true` and its fetches return 200 (Chrome 153 probe, recorded in
 * `docs/superpowers/specs/2026-09-12-box-trust-onboarding-design.md`). So this screen carries no
 * detection code, and Continue is only a communication check: it re-reads status and never proves
 * that the certificate is installed.
 */
@customElement("setup-connection-screen")
export class SetupConnectionScreen extends LitElement {
  static override styles = [
    helpLinkStyles,
    baseStyles,
    actionsStyles,
    errorStyles,
    statusStyles,
    css`
      :host {
        display: block;
      }
      .actions {
        justify-content: flex-end;
      }
    `,
  ];
  @property() errorMessage?: string;
  @property({ type: Boolean }) checking = false;

  override render(): TemplateResult {
    return html`<wt-card>
      <h1>Is your connection to this page secure?</h1>
      <p>
        Look at your browser's address bar. A padlock with no certificate warning means this
        server's certificate is already installed on this device.
      </p>
      <p>
        <a href="/setup/trust" target="_blank" rel="noopener" data-test="trust-help"
          >Saw a warning, or not sure? Install this server's certificate</a
        >
      </p>
      ${this.errorMessage ? html`<p class="error" role="alert">${this.errorMessage}</p>` : nothing}
      <div class="actions">
        <wt-button
          variant="primary"
          data-test="continue"
          ?disabled=${this.checking}
          @click=${() => this.dispatchEvent(new CustomEvent("connection-continue"))}
        >
          ${this.checking ? "Checking connection…" : "Continue to setup"}
        </wt-button>
      </div>
      <p class="status" data-test="continue-caveat">
        Continue only checks that the server answers. It cannot see your device's certificate
        settings.
      </p>
    </wt-card>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-connection-screen": SetupConnectionScreen;
  }
}
