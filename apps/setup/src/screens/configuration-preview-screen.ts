import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import type { ConfigurationPreview } from "../api/client.js";
import { actionsStyles } from "../form-styles.js";
import { dispatchSetupGoto } from "../events.js";

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

  override render(): TemplateResult {
    if (this.preview === undefined)
      return html`<wt-card><h1>Review prepared configuration</h1></wt-card>`;
    return html`<wt-card raised>
      <h1>Review prepared configuration</h1>
      <p>
        This will create a fresh production restaurant for
        <strong>${this.preview.venue.legalName}</strong>. Practice sales and fiscal records are not
        included.
      </p>
      <h2>Configuration to copy</h2>
      <dl>
        ${Object.entries(this.preview.counts).map(
          ([name, count]) =>
            html`<dt>${name}</dt>
              <dd>${count}</dd>`,
        )}
      </dl>
      <h2>Reconnect after setup</h2>
      <p>
        ${
          this.preview.reconnect.length === 0
            ? "No hardware reconnection is listed."
            : this.preview.reconnect.join(", ")
        }
      </p>
      <div class="actions">
        <wt-button variant="ghost" @click=${() => dispatchSetupGoto(this, "live-source")}
          >Back</wt-button
        >
        <wt-button
          variant="primary"
          data-test="continue"
          @click=${() => dispatchSetupGoto(this, "admin")}
          >Continue</wt-button
        >
      </div>
    </wt-card>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-configuration-preview-screen": SetupConfigurationPreviewScreen;
  }
}
