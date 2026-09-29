import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import type { ConfigurationPreview } from "../api/client.js";
import { actionsStyles } from "../form-styles.js";
import { dispatchSetupGoto } from "../events.js";
import { t } from "../i18n/t.js";
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
      <p>
        ${t("config_preview.creates_for")}
        <strong>${this.preview.venue.legalName}</strong>${t("config_preview.not_included")}
      </p>
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
      <div class="actions">
        <wt-button variant="ghost" @click=${() => dispatchSetupGoto(this, "live-source")}
          >${t("config_preview.back")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test="continue"
          @click=${() => dispatchSetupGoto(this, "admin")}
          >${t("config_preview.continue")}</wt-button
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
