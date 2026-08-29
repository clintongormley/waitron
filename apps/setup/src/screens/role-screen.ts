import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import { dispatchSetupRole } from "../events.js";

/**
 * The wizard's very first step: what IS this box?
 *
 * A **primary** runs the till and files fiscal records — the existing demo/live flow (`mode` →
 * `admin` → `venue` → …). A **mirror** is a read-only copy of another box's data (the cloud
 * dashboard): it connects to a primary, inherits that primary's environment, seeds no operator, and
 * files nothing. So the two roles fork the entire rest of the wizard, which is why the choice comes
 * before everything else.
 *
 * The screen carries no confirm gate — neither choice is irreversible here (a mirror provisions
 * nothing until the connect step, and a primary still has its own demo/live permanence gate on the
 * `mode` screen). It talks to the shell through the one composed/bubbling `setup-role` event; the
 * shell owns the visible screen and resolves role→`mode`/`connect`, matching the altitude fix that
 * lifted the venue→`cert`/`review` conditional out of a screen (backlog #149 (m)).
 */
@customElement("setup-role-screen")
export class SetupRoleScreen extends LitElement {
  static override styles = [
    baseStyles,
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

  /** Emit the chosen role up to the shell as a `setup-role`; the shell flips to `mode` or `connect`. */
  #choose(role: "primary" | "mirror"): void {
    dispatchSetupRole(this, role);
  }

  override render(): TemplateResult {
    return html`
      <wt-card>
        <h1>What is this box?</h1>
        <p class="intro">
          A primary box runs the till and files fiscal records. A mirror is a read-only copy of
          another box's data — it connects to a primary and never sells or files anything.
        </p>
      </wt-card>

      <div class="choices">
        <wt-card raised>
          <h2>Primary</h2>
          <p class="choice-copy">
            The box that trades. It runs the till, takes payments, and files every sale to AEAT.
          </p>
          <wt-button
            variant="primary"
            data-test="choose-primary"
            @click=${() => this.#choose("primary")}
            >Set up a primary box</wt-button
          >
        </wt-card>
        <wt-card raised>
          <h2>Mirror</h2>
          <p class="choice-copy">
            A read-only view of another box. It connects to a primary and shows its data — it never
            trades or files anything.
          </p>
          <wt-button
            variant="secondary"
            data-test="choose-mirror"
            @click=${() => this.#choose("mirror")}
            >Set up a mirror</wt-button
          >
        </wt-card>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-role-screen": SetupRoleScreen;
  }
}
