import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { helpLinkStyles, actionsStyles, errorStyles, statusStyles } from "../form-styles.js";
import { dispatchProvisionRequested, dispatchSetupGoto } from "../events.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { t } from "../i18n/t.js";

/** Renders the provision state the shell maps onto its props; the shell does the POST
 * (`apps/setup/src/setup-app.ts`). */
@customElement("setup-provisioning-screen")
export class SetupProvisioningScreen extends LitElement {
  static override styles = [
    helpLinkStyles,
    baseStyles,
    statusStyles,
    errorStyles,
    actionsStyles,
    css`
      :host {
        display: block;
      }
    `,
  ];

  /** `undefined` while the POST is in flight. */
  @property() message?: string;

  @property({ type: Boolean }) canRetry = false;

  /** Offered only for a join that stopped partway, which the reset screen can clear. */
  @property({ type: Boolean }) canReset = false;

  @property() reloadLabel?: string;

  @property({ attribute: false }) reload: () => void = location.reload.bind(location);

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  #retry(): void {
    dispatchProvisionRequested(this);
  }

  override render(): TemplateResult {
    if (this.message !== undefined) {
      return html`
        <h1>${t("provisioning.failed_heading")}</h1>
        <p class="error" role="alert" data-test="error">${this.message}</p>
        <p>
          ${t("provisioning.trust_help_before")}
          <a href="/setup/trust" target="_blank" rel="noopener" data-test="trust-help"
            >${t("provisioning.trust_help_link")}</a
          >
          ${t("provisioning.trust_help_after")}
        </p>
        ${
          this.canReset
            ? html`<div class="actions">
                <wt-button
                  variant="primary"
                  data-test="reset"
                  @click=${() => dispatchSetupGoto(this, "reset")}
                  >${t("provisioning.reset")}</wt-button
                >
              </div>`
            : this.canRetry
              ? html`<div class="actions">
                  <wt-button variant="primary" data-test="retry" @click=${() => this.#retry()}
                    >${t("provisioning.retry")}</wt-button
                  >
                </div>`
              : this.reloadLabel === undefined
                ? nothing
                : html`<div class="actions">
                    <wt-button variant="primary" data-test="reload" @click=${() => this.reload()}
                      >${this.reloadLabel}</wt-button
                    >
                  </div>`
        }
      `;
    }
    return html`
      <h1>${t("provisioning.heading")}</h1>
      <p class="status" data-test="status">${t("provisioning.status")}</p>
      <wt-button variant="primary" data-test="provision" ?disabled=${true}
        >${t("provisioning.busy")}</wt-button
      >
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-provisioning-screen": SetupProvisioningScreen;
  }
}
