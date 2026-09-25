import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { actionsStyles, errorStyles, fieldStyles } from "../form-styles.js";
import {
  type RestoreRequestDetail,
  dispatchRestoreRequested,
  dispatchSetupGoto,
} from "../events.js";
import { OLD_BOX_PROBLEM, oldBoxQuestion } from "./old-box-question.js";

/**
 * The warning asks about any server still RUNNING, never "a primary or a mirror": an adopted mirror
 * does not finish joining (`PendingAdoption`, `apps/server/src/finish-adoption.ts`), so naming one as
 * a place newer data might live would send the operator looking in the wrong place.
 */
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
  /** Set by the shell from `restore.stream_source_live`: when the old server last wrote to its bucket. */
  @property() liveSince?: string;
  /** Set by the shell from `restore.stream_source_unchecked`. */
  @property({ type: Boolean }) liveUnknown = false;
  /** The request the shell last sent, returned with a refusal so the owner's entries are kept. */
  @property({ attribute: false }) request?: RestoreRequestDetail;
  @state() private artifact?: File;
  @state() private recoveryKey = "";
  @state() private environment: "production" | "preproduction" = "production";
  @state() private acknowledged = false;
  @state() private oldBoxGone = false;
  @state() private showError = false;

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("request") && this.request !== undefined) {
      this.artifact = this.request.artifact;
      this.recoveryKey = this.request.recoveryKey;
      this.environment = this.request.environment;
      // A request is only sent once the owner has ticked this.
      this.acknowledged = true;
      this.oldBoxGone = this.request.oldBoxGone;
    }
  }

  override updated(changed: PropertyValues<this>): void {
    // A file input cannot be bound; without this it would read "No file chosen" beside a kept file.
    if (changed.has("request") && this.request !== undefined) {
      const files = new DataTransfer();
      files.items.add(this.request.artifact);
      this.shadowRoot!.querySelector<HTMLInputElement>("[data-test=artifact]")!.files = files.files;
    }
  }

  get #askingOldBox(): boolean {
    return this.liveSince !== undefined || this.liveUnknown;
  }

  get #oldBoxUnanswered(): boolean {
    return this.#askingOldBox && !this.oldBoxGone;
  }

  #restore(): void {
    if (
      this.artifact === undefined ||
      this.recoveryKey === "" ||
      !this.acknowledged ||
      this.#oldBoxUnanswered
    ) {
      this.showError = true;
      return;
    }
    this.showError = false;
    dispatchRestoreRequested(this, {
      artifact: this.artifact,
      recoveryKey: this.recoveryKey,
      environment: this.environment,
      oldBoxGone: this.#askingOldBox && this.oldBoxGone,
    });
  }

  override render(): TemplateResult {
    return html`
      <h1>Restore from backup</h1>
      <p>
        <wt-button
          variant="ghost"
          data-test="cloud-restore"
          @click=${() => dispatchSetupGoto(this, "cloud-restore")}
          >Restore from Waitron Cloud</wt-button
        >
      </p>
      <p>
        Use cold recovery only when no other server is still running with newer restaurant data.
      </p>
      <label class="field">
        Backup file <span aria-hidden="true">*</span>
        <wt-help-tooltip aria-label="Help with backup file"
          >Choose the encrypted backup from the server you are recovering.</wt-help-tooltip
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
          <option value="production" .selected=${this.environment === "production"}>Live</option>
          <option value="preproduction" .selected=${this.environment === "preproduction"}>
            Preparation or demo
          </option>
        </select>
      </label>
      <label class="field">
        <input
          name="no-running-server"
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
        I confirm no other running server has newer restaurant data.
        <wt-help-tooltip aria-label="Help with recovery confirmation"
          >Check every other server this restaurant still has before restoring. A backup may be
          older than a server that is still running.</wt-help-tooltip
        >
      </label>
      ${this.showError && !this.acknowledged ? html`<p class="error" id="acknowledge-error">Confirm that no other running server has newer data.</p>` : nothing}
      ${oldBoxQuestion({
        liveSince: this.liveSince,
        liveUnknown: this.liveUnknown,
        checked: this.oldBoxGone,
        invalid: this.showError && this.#oldBoxUnanswered,
        onChange: (checked) => {
          this.oldBoxGone = checked;
        },
      })}
      ${
        this.showError
          ? html`<wt-form-error-summary
              data-test="error"
              heading="There is a problem with this form"
              .errors=${[this.artifact === undefined ? "Choose a backup file." : "", this.recoveryKey === "" ? "Enter the recovery key." : "", !this.acknowledged ? "Confirm that no other running server has newer data." : "", this.#oldBoxUnanswered ? OLD_BOX_PROBLEM : ""].filter(Boolean)}
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
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-restore-screen": SetupRestoreScreen;
  }
}
