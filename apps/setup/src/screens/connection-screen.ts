import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { helpLinkStyles, actionsStyles, errorStyles } from "../form-styles.js";

/**
 * A page cannot tell whether it was reached over a trusted certificate or through a warning the
 * operator clicked past (`docs/superpowers/specs/2026-09-12-box-trust-onboarding-design.md`), so this
 * screen asks the operator to read the address bar and never reports a verdict. Continue only checks
 * that the server answers.
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
  /** Set when retrying cannot help, so Continue is withheld. The install link stays: the certificate
   * still needs trusting to use this server. */
  @property({ type: Boolean }) setupUnavailable = false;

  override render(): TemplateResult {
    return html`
      <h1>Is your connection to this page secure?</h1>
      <p>
        Check your browser's address bar to see whether this page is secure or not. If it says
        <span class="warning-words" data-test="warning-words">“not secure”</span>, then you need to
        <a href="/setup/trust" target="_blank" rel="noopener" data-test="trust-help"
          >install this server's certificate</a
        >.
      </p>
      ${this.errorMessage ? html`<p class="error" role="alert">${this.errorMessage}</p>` : nothing}
      ${
        this.setupUnavailable
          ? nothing
          : html`<div class="actions">
              <p class="otherwise" data-test="otherwise">Otherwise:</p>
              <wt-button
                variant="primary"
                data-test="continue"
                ?disabled=${this.checking}
                @click=${() => this.dispatchEvent(new CustomEvent("connection-continue"))}
              >
                ${this.checking ? "Checking connection…" : "Continue to setup"}
              </wt-button>
            </div>`
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-connection-screen": SetupConnectionScreen;
  }
}
