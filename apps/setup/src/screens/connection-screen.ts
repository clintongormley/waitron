import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import { helpLinkStyles, actionsStyles, errorStyles } from "../form-styles.js";

/**
 * The wizard's first step: it asks the operator to read their own address bar.
 *
 * A page cannot tell whether the browser reached it over a trusted certificate or over an
 * interstitial the operator clicked through — after a bypass the page still reads
 * `isSecureContext: true` and its fetches return 200 (Chrome 153 probe, recorded in
 * `docs/superpowers/specs/2026-09-12-box-trust-onboarding-design.md`). So this screen carries no
 * detection code, and Continue is only a communication check: it re-reads status and never proves
 * that the certificate is installed. Nothing here reports a verdict on the connection, which is why
 * the screen needs no disclaimer saying it cannot.
 */
@customElement("setup-connection-screen")
export class SetupConnectionScreen extends LitElement {
  static override styles = [
    helpLinkStyles,
    baseStyles,
    actionsStyles,
    errorStyles,
    css`
      :host {
        display: block;
      }
      /* "Otherwise:" and the button are one sentence, so they share a row and wrap together. */
      .actions {
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
      }
      .otherwise {
        margin: 0;
      }
      /* The browser's own warning, shown the way the browser shows it. The literal words carry the
         meaning; the colour is emphasis, so nothing is lost to a reader who cannot see it. */
      .warning-words {
        color: var(--wt-color-danger);
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];
  @property() errorMessage?: string;
  @property({ type: Boolean }) checking = false;

  override render(): TemplateResult {
    return html`<wt-card>
      <h1>Is your connection to this page secure?</h1>
      <p>
        Check your browser's address bar to see whether this page is secure or not. If it says
        <span class="warning-words" data-test="warning-words">“not secure”</span>, then you need to
        <a href="/setup/trust" target="_blank" rel="noopener" data-test="trust-help"
          >install this server's certificate</a
        >.
      </p>
      ${this.errorMessage ? html`<p class="error" role="alert">${this.errorMessage}</p>` : nothing}
      <div class="actions">
        <p class="otherwise" data-test="otherwise">Otherwise:</p>
        <wt-button
          variant="primary"
          data-test="continue"
          ?disabled=${this.checking}
          @click=${() => this.dispatchEvent(new CustomEvent("connection-continue"))}
        >
          ${this.checking ? "Checking connection…" : "Continue to setup"}
        </wt-button>
      </div>
    </wt-card>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-connection-screen": SetupConnectionScreen;
  }
}
