import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import { actionsStyles } from "../form-styles.js";
import { dispatchSetupGoto } from "../events.js";

/** Why the mirror card promises so little: `PendingAdoption` in `apps/server/src/finish-adoption.ts`. */
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
      <h1>Join or recover an existing restaurant</h1>
      <p class="intro">
        Restore a backup onto this server when no other server is still running with newer
        restaurant data. Adding this server as a mirror does not work in this version — the card
        below says what happens if you try.
      </p>

      <div class="choices">
        <wt-card raised>
          <h2>Add a mirror node</h2>
          <p class="choice-copy">
            This does not work in this version. The server signs in to the restaurant's primary and
            restarts, then stops part-way through joining, and it will not get any further however
            many times you restart it. It ends up holding none of the restaurant's information, with
            no dashboard and no till, and it cannot sell or file anything. This setup wizard does
            not open on this server again afterwards.
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
            Recover onto this fresh server from an encrypted Waitron backup when no other server is
            still running with newer restaurant data.
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
