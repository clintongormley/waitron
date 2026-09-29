import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { actionsStyles, errorStyles } from "../form-styles.js";
import { dispatchFiscalTestRequested, dispatchSetupGoto } from "../events.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";

@customElement("setup-fiscal-test-screen")
export class SetupFiscalTestScreen extends LitElement {
  static override styles = [
    baseStyles,
    actionsStyles,
    errorStyles,
    css`
      :host {
        display: block;
      }
      .success {
        color: var(--wt-color-success);
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];

  @property() status?: "accepted" | "rejected" | "uncertain";
  @property({ type: Boolean }) running = false;
  @property() errorMessage?: string;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override render(): TemplateResult {
    return html`
      <h1>${t("fiscal_test.heading")}</h1>
      <p>${t("fiscal_test.intro")}</p>
      ${
        this.status === "accepted"
          ? html`<p class="success" role="status">${t("fiscal_test.accepted")}</p>`
          : this.status === "rejected"
            ? html`<p class="error" role="alert">${t("fiscal_test.rejected")}</p>`
            : this.status === "uncertain"
              ? html`<p class="error" role="alert">${t("fiscal_test.uncertain")}</p>`
              : this.errorMessage
                ? html`<p class="error" role="alert">${this.errorMessage}</p>`
                : nothing
      }
      <div class="actions">
        <wt-button variant="ghost" @click=${() => dispatchSetupGoto(this, "cert")}
          >${t("fiscal_test.back")}</wt-button
        >
        ${
          this.status === "accepted"
            ? html`<wt-button
                variant="primary"
                data-test="continue"
                @click=${() => dispatchSetupGoto(this, "review")}
                >${t("fiscal_test.continue")}</wt-button
              >`
            : html`<wt-button
                variant="primary"
                data-test="run"
                ?disabled=${this.running}
                @click=${() => dispatchFiscalTestRequested(this)}
                >${t(this.running ? "fiscal_test.running" : "fiscal_test.run")}</wt-button
              >`
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-fiscal-test-screen": SetupFiscalTestScreen;
  }
}
