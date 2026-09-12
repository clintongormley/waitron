import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import { passwordIcon } from "../password-icon.js";
import { actionsStyles, errorStyles, fieldStyles } from "../form-styles.js";
import {
  dispatchConfigurationRequested,
  dispatchSetupGoto,
  dispatchSetupPatch,
} from "../events.js";

@customElement("setup-live-source-screen")
export class SetupLiveSourceScreen extends LitElement {
  static override styles = [
    baseStyles,
    fieldStyles,
    errorStyles,
    actionsStyles,
    css`
      :host {
        display: block;
      }
      .choices {
        display: grid;
        gap: var(--wt-space-4);
      }
    `,
  ];

  @property() errorMessage?: string;
  @state() private artifact?: File;
  @state() private passphrase = "";
  @state() private importing = false;
  @state() private showError = false;
  @state() private passphraseVisible = false;
  @state() private invalid = new Set<"artifact" | "passphrase">();

  #empty(): void {
    dispatchSetupPatch(this, { configurationImport: false });
    dispatchSetupGoto(this, "admin");
  }

  #import(): void {
    const artifact = this.artifact;
    const invalid = new Set<"artifact" | "passphrase">();
    if (artifact === undefined) invalid.add("artifact");
    if (this.passphrase.length < 12) invalid.add("passphrase");
    this.invalid = invalid;
    if (invalid.size > 0 || artifact === undefined) {
      this.showError = true;
      return;
    }
    this.showError = false;
    this.importing = true;
    dispatchConfigurationRequested(this, {
      artifact,
      passphrase: this.passphrase,
    });
  }

  override render(): TemplateResult {
    return html`<div class="choices">
      <wt-card raised>
        <h1>Bring your prepared restaurant live</h1>
        <p>Copy menus, layouts, staff profiles and settings from a preparation export.</p>
        <label class="field">
          Configuration export <span aria-hidden="true">*</span>
          <wt-help-tooltip aria-label="Help with configuration export"
            >Choose the encrypted configuration exported from your prepared restaurant. This copies
            its settings into a new Live setup.</wt-help-tooltip
          >
          <input
            name="configuration-export"
            type="file"
            required
            aria-invalid=${this.invalid.has("artifact") ? "true" : "false"}
            aria-describedby=${this.invalid.has("artifact") ? "configuration-export-error" : nothing}
            @change=${(event: Event) => {
              this.artifact = (event.currentTarget as HTMLInputElement).files?.[0];
              this.invalid = new Set([...this.invalid].filter((field) => field !== "artifact"));
            }}
          />
        </label>
        ${
          this.invalid.has("artifact")
            ? html`<p id="configuration-export-error" class="error" data-test="field-error">
                Choose a configuration export.
              </p>`
            : nothing
        }
        <wt-input
          class="field"
          name="export-passphrase"
          label="Export passphrase"
          type=${this.passphraseVisible ? "text" : "password"}
          autocomplete="off"
          required
          error=${this.invalid.has("passphrase") ? "Enter a passphrase of at least 12 characters." : ""}
          ?invalid=${this.invalid.has("passphrase")}
          .value=${this.passphrase}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.passphrase = event.detail.value;
            this.invalid = new Set([...this.invalid].filter((field) => field !== "passphrase"));
          }}
        >
          <wt-help-tooltip slot="help" aria-label="Help with export passphrase"
            >Enter the passphrase used to encrypt the configuration export.</wt-help-tooltip
          >
          <wt-button
            slot="end"
            variant="ghost"
            data-test="toggle-passphrase"
            aria-label=${this.passphraseVisible ? "Hide export passphrase" : "Show export passphrase"}
            @click=${() => (this.passphraseVisible = !this.passphraseVisible)}
            >${passwordIcon(this.passphraseVisible)}</wt-button
          >
        </wt-input>
        ${
          this.invalid.has("passphrase")
            ? html`<p class="error" data-test="field-error">
                Enter a passphrase of at least 12 characters.
              </p>`
            : nothing
        }
        ${
          this.showError
            ? html`<wt-form-error-summary
                heading="There is a problem with this form"
                .errors=${[...this.invalid].map((field) => (field === "artifact" ? "Choose a configuration export." : "Enter a passphrase of at least 12 characters."))}
              ></wt-form-error-summary>`
            : this.errorMessage
              ? html`<p class="error" role="alert">${this.errorMessage}</p>`
              : nothing
        }
        <wt-button
          variant="primary"
          data-test="import"
          ?disabled=${this.importing}
          @click=${() => this.#import()}
          >Review prepared configuration</wt-button
        >
      </wt-card>
      <wt-card raised>
        <h2>Start empty</h2>
        <p>Create a fresh live restaurant and enter its configuration yourself.</p>
        <wt-button variant="secondary" data-test="empty" @click=${() => this.#empty()}
          >Start empty</wt-button
        >
      </wt-card>
      <div class="actions">
        <wt-button variant="ghost" @click=${() => dispatchSetupGoto(this, "mode")}>Back</wt-button>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-live-source-screen": SetupLiveSourceScreen;
  }
}
