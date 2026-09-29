import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { helpLinkStyles, actionsStyles, errorStyles } from "../form-styles.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";

/**
 * `isSecureContext` and a successful fetch cannot tell a trusted certificate from a warning the
 * operator clicked past (measured for #330 on Chrome 153: past the warning, `isSecureContext` was
 * true and a fetch answered 200), so this screen asks the operator to read the address bar and never
 * reports a verdict. Continue only checks that the server answers.
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

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override render(): TemplateResult {
    return html`
      <h1>${t("connection.heading")}</h1>
      <p>
        ${t("connection.check_address_bar")}
        <span class="warning-words" data-test="warning-words">${t("connection.warning_words")}</span
        >${t("connection.then_you_need_to")}
        <a href="/setup/trust" target="_blank" rel="noopener" data-test="trust-help"
          >${t("connection.install_certificate")}</a
        >.
      </p>
      ${this.errorMessage ? html`<p class="error" role="alert">${this.errorMessage}</p>` : nothing}
      ${
        this.setupUnavailable
          ? nothing
          : html`<div class="actions">
              <p class="otherwise" data-test="otherwise">${t("connection.otherwise")}</p>
              <wt-button
                variant="primary"
                data-test="continue"
                ?disabled=${this.checking}
                @click=${() => this.dispatchEvent(new CustomEvent("connection-continue"))}
              >
                ${this.checking ? t("connection.checking") : t("connection.continue")}
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
