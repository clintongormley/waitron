import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import { helpLinkStyles, actionsStyles, errorStyles } from "../form-styles.js";

@customElement("setup-connection-screen")
export class SetupConnectionScreen extends LitElement {
  static override styles = [
    helpLinkStyles,
    baseStyles,
    actionsStyles,
    errorStyles,
    css`
      :host {
        display: block;
      }
      .actions {
        justify-content: flex-end;
      }
    `,
  ];
  @property() errorMessage?: string;
  @property({ type: Boolean }) checking = false;

  override render(): TemplateResult {
    return html`<wt-card>
      <h1>Connect securely to this box</h1>
      <p>
        Before you enter passwords or business details, install this box's certificate on your
        device. If you have already installed it and this box has not been re-imaged, continue to
        setup.
      </p>
      <p>
        <a href="/setup/trust" target="_blank" rel="noopener" data-test="trust-help"
          >Open certificate setup and recovery instructions</a
        >
        for macOS, Windows, Linux, Android, iPhone and iPad, including Chrome, Edge, Firefox and
        Safari.
      </p>
      <p>
        The instructions open in a new tab. They also explain how to replace an old certificate
        after a re-image.
      </p>
      <p>
        Continue checks that the box answers. It cannot check your device's certificate settings.
        Return here after installing the certificate and reopening your browser without a warning.
      </p>
      ${this.errorMessage ? html`<p class="error" role="alert">${this.errorMessage}</p>` : nothing}
      <div class="actions">
        <wt-button
          variant="primary"
          data-test="continue"
          ?disabled=${this.checking}
          @click=${() => this.dispatchEvent(new CustomEvent("connection-continue"))}
        >
          ${this.checking ? "Checking connection…" : "Continue to setup"}
        </wt-button>
      </div>
    </wt-card>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-connection-screen": SetupConnectionScreen;
  }
}
