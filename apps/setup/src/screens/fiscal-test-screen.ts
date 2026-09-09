import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import { actionsStyles, errorStyles } from "../form-styles.js";
import { dispatchFiscalTestRequested, dispatchSetupGoto } from "../events.js";

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

  override render(): TemplateResult {
    return html`<wt-card>
      <h1>Check fiscal readiness</h1>
      <p>
        Waitron will file one small sample with the AEAT test service using this restaurant's tax
        identity and certificate. It does not file to AEAT's production service.
      </p>
      ${
        this.status === "accepted"
          ? html`<p class="success" role="status">AEAT accepted the test submission.</p>`
          : this.status === "rejected"
            ? html`<p class="error" role="alert">
                AEAT rejected the test submission. Correct the certificate or restaurant details,
                then try again.
              </p>`
            : this.status === "uncertain"
              ? html`<p class="error" role="alert">
                  The result is uncertain. Wait a moment and retry; Waitron will keep the same test
                  record.
                </p>`
              : this.errorMessage
                ? html`<p class="error" role="alert">${this.errorMessage}</p>`
                : nothing
      }
      <div class="actions">
        <wt-button variant="ghost" @click=${() => dispatchSetupGoto(this, "cert")}>Back</wt-button>
        ${
          this.status === "accepted"
            ? html`<wt-button
                variant="primary"
                data-test="continue"
                @click=${() => dispatchSetupGoto(this, "review")}
                >Continue</wt-button
              >`
            : html`<wt-button
                variant="primary"
                data-test="run"
                ?disabled=${this.running}
                @click=${() => dispatchFiscalTestRequested(this)}
                >${this.running ? "Running test…" : "Run fiscal test"}</wt-button
              >`
        }
      </div>
    </wt-card>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-fiscal-test-screen": SetupFiscalTestScreen;
  }
}
