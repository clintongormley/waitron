import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, pageTitleStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { dispatchSetupGoto } from "../events.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { t } from "../i18n/t.js";

@customElement("setup-cloud-sign-in-screen")
export class SetupCloudSignInScreen extends LitElement {
  static override styles = [baseStyles, pageTitleStyles];

  @property({ attribute: false }) start!: (isCurrent: () => boolean) => Promise<void>;
  @property({ type: Boolean }) returnFailed = false;
  @state() private busy = false;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  async #signIn(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.returnFailed = false;
    try {
      await this.start(() => this.isConnected);
    } catch {
      this.returnFailed = true;
      this.busy = false;
    }
  }

  override render() {
    return html`
      <h1>${t("cloud_sign_in.heading")}</h1>
      <p>${t("cloud_sign_in.copy")}</p>
      ${this.returnFailed ? html`<p role="alert">${t("cloud_sign_in.error")}</p>` : nothing}
      <wt-form-actions>
        <wt-button
          data-test="skip"
          variant="ghost"
          @click=${() => dispatchSetupGoto(this, "venue")}
        >
          ${t("cloud_sign_in.skip")}
        </wt-button>
        <wt-button
          data-test="sign-in"
          variant="primary"
          .disabled=${this.busy}
          @click=${() => void this.#signIn()}
        >
          ${t("cloud_sign_in.sign_in")}
        </wt-button>
      </wt-form-actions>
    `;
  }
}
