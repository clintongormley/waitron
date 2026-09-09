import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import { actionsStyles } from "../form-styles.js";
import { dispatchSetupGoto } from "../events.js";

/**
 * The Join or recover subchooser. A mirror adopts a running primary's identity and data. Restore is
 * cold recovery when no usable peer survives. Each choice navigates directly to its own form.
 */
@customElement("setup-role-screen")
export class SetupRoleScreen extends LitElement {
  static override styles = [
    baseStyles,
    actionsStyles,
    css`
      :host {
        display: block;
      }

      .intro {
        margin: var(--wt-space-3) 0;
        color: var(--wt-color-text-muted);
      }

      .choices {
        display: grid;
        gap: var(--wt-space-4);
        margin-top: var(--wt-space-4);
      }

      h2 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-lg);
      }

      .choice-copy {
        margin: 0 0 var(--wt-space-3);
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  override render(): TemplateResult {
    return html`
      <wt-card>
        <h1>Join or recover an existing restaurant</h1>
        <p class="intro">
          Add this box as a mirror while another primary is available, or restore a backup after a
          disaster when no usable peer survives.
        </p>
      </wt-card>

      <div class="choices">
        <wt-card raised>
          <h2>Add a mirror node</h2>
          <p class="choice-copy">
            Connect to the restaurant's primary. This box copies its data and remains read-only.
          </p>
          <wt-button
            variant="primary"
            data-test="choose-mirror"
            @click=${() => dispatchSetupGoto(this, "connect")}
            >Add a mirror</wt-button
          >
        </wt-card>
        <wt-card raised>
          <h2>Restore from backup</h2>
          <p class="choice-copy">
            Recover onto this fresh box from an encrypted Waitron backup when no primary or mirror
            with newer data is available.
          </p>
          <wt-button
            variant="secondary"
            data-test="choose-restore"
            @click=${() => dispatchSetupGoto(this, "restore")}
            >Restore a backup</wt-button
          >
        </wt-card>
      </div>
      <div class="actions">
        <wt-button variant="ghost" data-test="back" @click=${() => dispatchSetupGoto(this, "mode")}
          >Back</wt-button
        >
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-role-screen": SetupRoleScreen;
  }
}
