import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
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
        <input
          name="backup"
          type="file"
          required
          data-test="artifact"
          @change=${(event: Event) => {
            this.artifact = (event.currentTarget as HTMLInputElement).files?.[0];
          }}
        />
      </label>
      <label class="field">
        Recovery key <span aria-hidden="true">*</span>
        <input
          name="recovery-key"
          type="password"
          autocomplete="off"
          required
          data-test="recovery-key"
          .value=${this.recoveryKey}
          @input=${(event: Event) => {
            this.recoveryKey = (event.currentTarget as HTMLInputElement).value;
          }}
        />
      </label>
      <label class="field">
        Backup environment <span aria-hidden="true">*</span>
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
          data-test="acknowledge"
          .checked=${this.acknowledged}
          @change=${(event: Event) => {
            this.acknowledged = (event.currentTarget as HTMLInputElement).checked;
          }}
        />
        I confirm no usable primary or mirror has newer restaurant data.
      </label>
      ${
        this.showError
          ? html`<p class="error" role="alert" data-test="error">
              Choose a backup, enter its recovery key, and confirm the recovery warning.
            </p>`
          : this.errorMessage === undefined
            ? html``
            : html`<p class="error" role="alert" data-test="server-error">${this.errorMessage}</p>`
      }
      <div class="actions">
        <wt-button variant="ghost" data-test="back" @click=${() => dispatchSetupGoto(this, "role")}
          >Back</wt-button
        >
        <wt-button variant="primary" data-test="restore" @click=${() => this.#restore()}
          >Restore backup</wt-button
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
