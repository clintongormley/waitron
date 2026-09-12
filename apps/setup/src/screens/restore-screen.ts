import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { actionsStyles, errorStyles, fieldStyles } from "../form-styles.js";
import { dispatchRestoreRequested, dispatchSetupGoto } from "../events.js";

/** Collects the encrypted backup and recovery key for a cold restore on a fresh box. */
@customElement("setup-restore-screen")
export class SetupRestoreScreen extends LitElement {
  static override styles = [
    baseStyles,
    fieldStyles,
    errorStyles,
    actionsStyles,
    css`
      :host {
        display: block;
      }
    `,
  ];

  @property() errorMessage?: string;
  @state() private artifact?: File;
  @state() private recoveryKey = "";
  @state() private environment: "production" | "preproduction" = "production";
  @state() private acknowledged = false;
  @state() private showError = false;

  #restore(): void {
    if (this.artifact === undefined || this.recoveryKey === "" || !this.acknowledged) {
      this.showError = true;
      return;
    }
    this.showError = false;
    dispatchRestoreRequested(this, {
      artifact: this.artifact,
      recoveryKey: this.recoveryKey,
      environment: this.environment,
    });
  }

  override render(): TemplateResult {
    return html`<wt-card>
      <h1>Restore from backup</h1>
      <p>
        Use cold recovery only when no primary or mirror with newer restaurant data is available.
      </p>
      <label class="field">
        Backup file <span aria-hidden="true">*</span>
        <wt-help-tooltip aria-label="Help with backup file"
          >Choose the encrypted backup from the box you are recovering.</wt-help-tooltip
        >
        <input
          name="backup"
          type="file"
          required
          aria-invalid=${this.showError && this.artifact === undefined ? "true" : "false"}
          aria-describedby="artifact-error"
          data-test="artifact"
          @change=${(event: Event) => {
            this.artifact = (event.currentTarget as HTMLInputElement).files?.[0];
          }}
        />
      </label>
      ${this.showError && this.artifact === undefined ? html`<p class="error" id="artifact-error">Choose a backup file.</p>` : nothing}
      <label class="field">
        Recovery key <span aria-hidden="true">*</span>
        <wt-help-tooltip aria-label="Help with recovery key"
          >Enter the recovery key saved for this backup. It unlocks the encrypted
          backup.</wt-help-tooltip
        >
        <input
          name="recovery-key"
          type="password"
          autocomplete="off"
          required
          aria-invalid=${this.showError && this.recoveryKey === "" ? "true" : "false"}
          aria-describedby="recovery-key-error"
          data-test="recovery-key"
          .value=${this.recoveryKey}
          @input=${(event: Event) => {
            this.recoveryKey = (event.currentTarget as HTMLInputElement).value;
          }}
        />
      </label>
      ${this.showError && this.recoveryKey === "" ? html`<p class="error" id="recovery-key-error">Enter the recovery key.</p>` : nothing}
      <label class="field">
        Backup environment <span aria-hidden="true">*</span>
        <wt-help-tooltip aria-label="Help with backup environment"
          >Choose the environment the backup came from. A preparation or demo backup cannot become a
          Live database.</wt-help-tooltip
        >
        <select
          name="environment"
          required
          data-test="environment"
          .value=${this.environment}
          @change=${(event: Event) => {
            this.environment = (event.currentTarget as HTMLSelectElement).value as
              "production" | "preproduction";
          }}
        >
          <option value="production">Live</option>
          <option value="preproduction">Preparation or demo</option>
        </select>
      </label>
      <label class="field">
        <input
          name="no-surviving-peer"
          type="checkbox"
          required
          aria-invalid=${this.showError && !this.acknowledged ? "true" : "false"}
          aria-describedby="acknowledge-error"
          data-test="acknowledge"
          .checked=${this.acknowledged}
          @change=${(event: Event) => {
            this.acknowledged = (event.currentTarget as HTMLInputElement).checked;
          }}
        />
        I confirm no usable primary or mirror has newer restaurant data.
        <wt-help-tooltip aria-label="Help with recovery confirmation"
          >Check all existing boxes before restoring. A backup may be older than a surviving primary
          or mirror.</wt-help-tooltip
        >
      </label>
      ${this.showError && !this.acknowledged ? html`<p class="error" id="acknowledge-error">Confirm that no usable primary or mirror has newer data.</p>` : nothing}
      ${
        this.showError
          ? html`<wt-form-error-summary
              data-test="error"
              heading="There is a problem with this form"
              .errors=${[this.artifact === undefined ? "Choose a backup file." : "", this.recoveryKey === "" ? "Enter the recovery key." : "", !this.acknowledged ? "Confirm that no usable primary or mirror has newer data." : ""].filter(Boolean)}
            ></wt-form-error-summary>`
          : this.errorMessage === undefined
            ? html``
            : html`<p class="error" role="alert" data-test="server-error">${this.errorMessage}</p>`
      }
      <wt-form-actions>
        <wt-button
          variant="ghost"
          slot="cancel"
          data-test="back"
          @click=${() => dispatchSetupGoto(this, "role")}
          >Back</wt-button
        >
        <wt-button variant="primary" data-test="restore" @click=${() => this.#restore()}
          >Restore backup</wt-button
        >
      </wt-form-actions>
    </wt-card>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-restore-screen": SetupRestoreScreen;
  }
}
