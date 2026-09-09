import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import { actionsStyles } from "../form-styles.js";
import { dispatchSetupGoto } from "../events.js";

/** The cold-recovery route. Artifact selection and validation are added on this dedicated screen. */
@customElement("setup-restore-screen")
export class SetupRestoreScreen extends LitElement {
  static override styles = [
    baseStyles,
    actionsStyles,
    css`
      :host {
        display: block;
      }
    `,
  ];

  override render(): TemplateResult {
    return html`<wt-card>
      <h1>Restore from backup</h1>
      <p>
        Use cold recovery only when no primary or mirror with newer restaurant data is available.
      </p>
      <div class="actions">
        <wt-button variant="ghost" data-test="back" @click=${() => dispatchSetupGoto(this, "role")}
          >Back</wt-button
        >
      </div>
    </wt-card>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-restore-screen": SetupRestoreScreen;
  }
}
