import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, focusFirstInvalid, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { actionsStyles, errorStyles, fieldStyles } from "../form-styles.js";
import {
  type RestoreRequestDetail,
  dispatchRestoreRequested,
  dispatchSetupGoto,
} from "../events.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { oldBoxQuestion } from "./old-box-question.js";

export type RestoreField = "artifact" | "recoveryKey" | "environment";

/**
 * The warning asks about any server still RUNNING, never "a primary or a mirror": an adopted mirror
 * does not finish joining (`PendingAdoption`, `apps/server/src/finish-adoption.ts`), so naming one as
 * a place newer data might live would send the operator looking in the wrong place.
 */
@customElement("setup-restore-screen")
export class SetupRestoreScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
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
  /** The field `errorMessage` is about; the message then shows under it, not above Restore. */
  @property() invalidField?: RestoreField;
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
  @state() private attempted = false;
  /** The owner pressed Restore after `errorMessage` arrived, so it no longer applies. */
  @state() private refusalDismissed = false;
  @state() private fieldRefusalDismissed = false;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("errorMessage")) this.refusalDismissed = false;
    if (changed.has("invalidField")) this.fieldRefusalDismissed = false;
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
    if (changed.has("invalidField") && this.#refusalUnder() !== undefined) {
      void focusFirstInvalid(this.shadowRoot!);
    }
  }

  /** The field showing the server's refusal, if any. */
  #refusalUnder(): RestoreField | undefined {
    return this.errorMessage === undefined || this.refusalDismissed || this.fieldRefusalDismissed
      ? undefined
      : this.invalidField;
  }

  #edited(field: RestoreField): void {
    if (field === this.invalidField) this.fieldRefusalDismissed = true;
  }

  /** The message under `field`: the client's own when it is missing, else a refusal about it. */
  #fieldError(field: RestoreField, missing: string | undefined): string | undefined {
    if (missing !== undefined) return missing;
    return this.#refusalUnder() === field ? this.errorMessage : undefined;
  }

  /** The owner chose another file than the one the shell's old-server refusal was about. */
  get #artifactReplaced(): boolean {
    return this.request !== undefined && this.artifact !== this.request.artifact;
  }

  get #askingOldBox(): boolean {
    return !this.#artifactReplaced && (this.liveSince !== undefined || this.liveUnknown);
  }

  get #oldBoxUnanswered(): boolean {
    return this.#askingOldBox && !this.oldBoxGone;
  }

  get #incomplete(): boolean {
    return (
      this.artifact === undefined ||
      this.recoveryKey === "" ||
      !this.acknowledged ||
      this.#oldBoxUnanswered
    );
  }

  #restore(): void {
    this.attempted = true;
    this.refusalDismissed = true;
    const artifact = this.artifact;
    if (artifact === undefined || this.#incomplete) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    dispatchRestoreRequested(this, {
      artifact,
      recoveryKey: this.recoveryKey,
      environment: this.environment,
      oldBoxGone: this.#askingOldBox && this.oldBoxGone,
    });
  }

  override render(): TemplateResult {
    const fieldsInvalid = this.attempted && this.#incomplete;
    const refused = this.#refusalUnder();
    const artifactError = this.#fieldError(
      "artifact",
      this.attempted && this.artifact === undefined ? t("restore.backup_file_missing") : undefined,
    );
    const keyError = this.#fieldError(
      "recoveryKey",
      this.attempted && this.recoveryKey === "" ? t("restore.recovery_key_missing") : undefined,
    );
    const environmentError = this.#fieldError("environment", undefined);
    const bottom = [
      ...(this.errorMessage !== undefined &&
      !this.refusalDismissed &&
      this.invalidField === undefined
        ? [this.errorMessage]
        : []),
      ...(fieldsInvalid || refused !== undefined ? [t("restore.fix_fields")] : []),
    ].join(" ");
    return html`
      <h1>${t("restore.heading")}</h1>
      <p>
        <wt-button
          variant="ghost"
          data-test="cloud-restore"
          @click=${() => dispatchSetupGoto(this, "cloud-restore")}
          >${t("restore.cloud_restore")}</wt-button
        >
      </p>
      <p>${t("restore.intro")}</p>
      <label class="field">
        ${t("restore.backup_file")} <span aria-hidden="true">*</span>
        <wt-help-tooltip aria-label=${t("restore.backup_file_help_label")}
          >${t("restore.backup_file_help")}</wt-help-tooltip
        >
        <input
          name="backup"
          type="file"
          required
          aria-invalid=${artifactError === undefined ? "false" : "true"}
          aria-describedby="artifact-error"
          data-test="artifact"
          @change=${(event: Event) => {
            this.artifact = (event.currentTarget as HTMLInputElement).files?.[0];
            this.#edited("artifact");
          }}
        />
      </label>
      ${artifactError === undefined ? nothing : html`<p class="error" id="artifact-error">${artifactError}</p>`}
      <label class="field">
        ${t("restore.recovery_key")} <span aria-hidden="true">*</span>
        <wt-help-tooltip aria-label=${t("restore.recovery_key_help_label")}
          >${t("restore.recovery_key_help")}</wt-help-tooltip
        >
        <input
          name="recovery-key"
          type="password"
          autocomplete="off"
          required
          aria-invalid=${keyError === undefined ? "false" : "true"}
          aria-describedby="recovery-key-error"
          data-test="recovery-key"
          .value=${this.recoveryKey}
          @input=${(event: Event) => {
            this.recoveryKey = (event.currentTarget as HTMLInputElement).value;
            this.#edited("recoveryKey");
          }}
        />
      </label>
      ${keyError === undefined ? nothing : html`<p class="error" id="recovery-key-error">${keyError}</p>`}
      <label class="field">
        ${t("restore.environment")} <span aria-hidden="true">*</span>
        <wt-help-tooltip aria-label=${t("restore.environment_help_label")}
          >${t("restore.environment_help")}</wt-help-tooltip
        >
        <select
          name="environment"
          required
          data-test="environment"
          aria-invalid=${environmentError === undefined ? "false" : "true"}
          aria-describedby=${environmentError === undefined ? nothing : "environment-error"}
          .value=${this.environment}
          @change=${(event: Event) => {
            this.environment = (event.currentTarget as HTMLSelectElement).value as
              "production" | "preproduction";
            this.#edited("environment");
          }}
        >
          <option value="production" .selected=${this.environment === "production"}>
            ${t("restore.environment_live")}
          </option>
          <option value="preproduction" .selected=${this.environment === "preproduction"}>
            ${t("restore.environment_preproduction")}
          </option>
        </select>
      </label>
      ${environmentError === undefined ? nothing : html`<p class="error" id="environment-error">${environmentError}</p>`}
      <label class="field">
        <input
          name="no-running-server"
          type="checkbox"
          required
          aria-invalid=${this.attempted && !this.acknowledged ? "true" : "false"}
          aria-describedby="acknowledge-error"
          data-test="acknowledge"
          .checked=${this.acknowledged}
          @change=${(event: Event) => {
            this.acknowledged = (event.currentTarget as HTMLInputElement).checked;
          }}
        />
        ${t("restore.acknowledge")}
        <wt-help-tooltip aria-label=${t("restore.acknowledge_help_label")}
          >${t("restore.acknowledge_help")}</wt-help-tooltip
        >
      </label>
      ${this.attempted && !this.acknowledged ? html`<p class="error" id="acknowledge-error">${t("restore.acknowledge_missing")}</p>` : nothing}
      ${oldBoxQuestion({
        liveSince: this.#askingOldBox ? this.liveSince : undefined,
        liveUnknown: this.#askingOldBox && this.liveUnknown,
        checked: this.oldBoxGone,
        invalid: this.attempted && this.#oldBoxUnanswered,
        onChange: (checked) => {
          this.oldBoxGone = checked;
        },
      })}
      <wt-form-actions .error=${bottom}>
        <wt-button
          variant="ghost"
          slot="cancel"
          data-test="back"
          @click=${() => dispatchSetupGoto(this, "role")}
          >${t("restore.back")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test="restore"
          ?disabled=${fieldsInvalid}
          @click=${() => this.#restore()}
          >${t("restore.submit")}</wt-button
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
