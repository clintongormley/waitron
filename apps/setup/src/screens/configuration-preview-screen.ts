import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-choice-row.js";
import type { ConfigurationPreview } from "../api/client.js";
import { actionsStyles } from "../form-styles.js";
import { dispatchSetupGoto, dispatchTaxpayerChosen } from "../events.js";
import { format, t } from "../i18n/t.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";

@customElement("setup-configuration-preview-screen")
export class SetupConfigurationPreviewScreen extends LitElement {
  static override styles = [
    baseStyles,
    actionsStyles,
    css`
      :host {
        display: block;
      }
      dl {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: var(--wt-space-2) var(--wt-space-4);
      }
      dd {
        margin: 0;
      }
      .choices {
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) preview?: ConfigurationPreview;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override render(): TemplateResult {
    if (this.preview === undefined) return html`<h1>${t("config_preview.heading")}</h1>`;
    return html`
      <h1>${t("config_preview.heading")}</h1>
      <h2>${t("config_preview.copy_heading")}</h2>
      <dl>
        ${Object.entries(this.preview.counts).map(
          ([name, count]) =>
            html`<dt>${name}</dt>
              <dd>${count}</dd>`,
        )}
      </dl>
      <h2>${t("config_preview.reconnect_heading")}</h2>
      <p>
        ${
          this.preview.reconnect.length === 0
            ? t("config_preview.no_reconnect")
            : this.preview.reconnect.join(", ")
        }
      </p>
      <h2 data-test="choice-heading">${t("config_preview.choice_heading")}</h2>
      <p>${t("config_preview.not_copied")}</p>
      <div class="choices">
        <wt-choice-row
          data-test="same-tax-id"
          heading=${t("config_preview.same.heading")}
          @click=${() => dispatchTaxpayerChosen(this, false)}
          >${format("config_preview.same.copy", {
            legalName: this.preview.venue.legalName,
            taxId: this.preview.venue.taxId,
          })}</wt-choice-row
        >
        <wt-choice-row
          data-test="new-tax-id"
          heading=${t("config_preview.new.heading")}
          @click=${() => dispatchTaxpayerChosen(this, true)}
          >${t("config_preview.new.copy")}</wt-choice-row
        >
      </div>
      <div class="actions">
        <wt-button variant="ghost" @click=${() => dispatchSetupGoto(this, "live-source")}
          >${t("config_preview.back")}</wt-button
        >
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-configuration-preview-screen": SetupConfigurationPreviewScreen;
  }
}
