import { LitElement, css, html } from "lit";
import { customElement } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
// Side-effect import registers the <wt-card> element this shell names as a tag below.
import "@waitron/ui/src/components/wt-card.js";

/**
 * The setup wizard's app-root element. Task 1 ships only a minimal shell — a single card with a
 * heading — to birth the package. The screen state machine, the injected SetupApi, and the wizard
 * steps arrive in later tasks of onboarding slice 2c, mirroring apps/dashboard's dashboard-app.ts.
 */
@customElement("setup-app")
export class SetupApp extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
    `,
  ];

  override render() {
    return html`
      <wt-card>
        <h1>Set up this Waitron box</h1>
      </wt-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-app": SetupApp;
  }
}
