import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  FormFeedback,
  baseStyles,
  bottomMessage,
  focusFirstInvalid,
  leaveCoordinatorFor,
  type DraftScope,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-file-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { passwordIcon } from "../password-icon.js";
import { actionsStyles, errorStyles, fieldStyles } from "../form-styles.js";
import { type KeptRestoreRequest, dispatchRestoreRequested, dispatchSetupGoto } from "../events.js";
import { currentLocale, t } from "../i18n/t.js";
import { fileInputCopy } from "../file-input-copy.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { oldBoxQuestion } from "./old-box-question.js";
import { SetupApi } from "../api/client.js";
import type { RecoveryEntryField } from "./recovery-allocation.js";
import { SetupRecoveryCopy } from "./recovery-copy.js";

interface RestoreForm {
  artifact?: File;
  recoveryKey: string;
  environment: "production" | "preproduction";
}

export type RestoreField = "artifact" | "recoveryKey" | "environment" | RecoveryEntryField;

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
  @property({ attribute: false }) api: SetupApi = new SetupApi();
  @property({ attribute: false }) boxAddress?: string;
  /** The field `errorMessage` is about; the message then shows under it, not above Restore. */
  @property() invalidField?: RestoreField;
  /** Set by the shell from `restore.stream_source_live`: when the old server last wrote to its bucket. */
  @property() liveSince?: string;
  /** Set by the shell from `restore.stream_source_unchecked`. */
  @property({ type: Boolean }) liveUnknown = false;
  /** The request the shell last sent, returned with a refusal so the owner's entries are kept. */
  @property({ attribute: false }) request?: KeptRestoreRequest;
  @state() private artifact?: File;
  @state() private recoveryKey = "";
  @state() private recoveryKeyVisible = false;
  @state() private environment: "production" | "preproduction" = "production";
  @state() private acknowledged = false;
  @state() private oldBoxGone = false;
  /** As `setup-recovery-copy` last announced. */
  @state() private reviewNeeded = false;
  @state() private recoveryInvalid = false;
  @state() private previewRefusal?: RestoreField;

  private readonly feedback = new FormFeedback(this);
  #baseline?: RestoreForm;
  #scope?: DraftScope<RestoreForm>;

  #form(): RestoreForm {
    return {
      artifact: this.artifact,
      recoveryKey: this.recoveryKey,
      environment: this.environment,
    };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#registerScope();
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }

  #registerScope(): void {
    if (!this.isConnected || !this.#baseline || this.#scope) return;
    this.#scope = leaveCoordinatorFor(this)?.register({
      id: this,
      current: () => this.#form(),
      snapshot: (form) => ({ ...form }),
      equal: (a, b) =>
        a.artifact === b.artifact &&
        a.recoveryKey === b.recoveryKey &&
        a.environment === b.environment,
      restore: (form) => {
        this.artifact = form.artifact;
        this.recoveryKey = form.recoveryKey;
        this.environment = form.environment;
        this.acknowledged = false;
        this.oldBoxGone = false;
        this.feedback.attempted = false;
        this.requestUpdate();
      },
    });
    this.#scope?.commit(this.#baseline);
  }

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override willUpdate(changed: PropertyValues<this>): void {
    this.#baseline ??= this.#form();
    if (changed.has("errorMessage")) this.feedback.newRefusal("refusal");
    if (changed.has("invalidField")) this.feedback.newRefusal("field");
    if (changed.has("request") && this.request !== undefined) {
      this.artifact = this.request.artifact;
      this.recoveryKey = this.request.recoveryKey;
      this.environment = this.request.environment;
      // A request is only sent once the owner has ticked this.
      this.acknowledged = true;
      this.oldBoxGone = this.request.oldBoxGone;
      this.#scope?.changed();
    }
  }

  override updated(changed: PropertyValues<this>): void {
    this.#registerScope();
    if (changed.has("invalidField") && this.#refusalUnder(this.#shownRefusal) !== undefined) {
      void focusFirstInvalid(this.shadowRoot!);
    }
  }

  /** The server's refusal, unless the owner has dismissed it. */
  get #shownRefusal(): string | undefined {
    return this.feedback.shows("refusal") && this.feedback.shows("field")
      ? this.errorMessage
      : undefined;
  }

  /** The field showing `refusal`, if any. */
  #refusalUnder(refusal: string | undefined): RestoreField | undefined {
    return refusal === undefined ? undefined : this.invalidField;
  }

  #edited(field: RestoreField): void {
    this.#scope?.changed();
    if (field === this.invalidField) this.feedback.dismiss("field");
    this.previewRefusal = undefined;
  }

  /** The message under `field`: the client's own when it is missing, else a refusal about it. */
  #fieldError(
    field: "artifact" | "recoveryKey" | "environment",
    missing: string | undefined,
    refused: RestoreField | undefined,
  ): string | undefined {
    if (missing !== undefined) return missing;
    if (refused === field) return this.errorMessage;
    if (this.previewRefusal === field) {
      const messages = {
        artifact: "restore.preview_file_error",
        recoveryKey: "restore.preview_key_error",
        environment: "restore.preview_environment_error",
      } as const;
      return t(messages[field]);
    }
    return undefined;
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
      this.recoveryInvalid ||
      this.#oldBoxUnanswered
    );
  }

  #restore(): void {
    this.feedback.press("refusal");
    this.previewRefusal = undefined;
    const artifact = this.artifact;
    if (artifact === undefined || this.#incomplete) {
      void this.feedback.focus(this.shadowRoot!);
      return;
    }
    const credentials = this.shadowRoot!.querySelector<SetupRecoveryCopy>(
      "setup-recovery-copy",
    )?.readCredentials({
      artifact: this.artifact,
      recoveryKey: this.recoveryKey,
      environment: this.environment,
    });
    if (!credentials) return;
    dispatchRestoreRequested(this, {
      ...credentials,
      artifact,
      recoveryKey: this.recoveryKey,
      environment: this.environment,
      oldBoxGone: this.#askingOldBox && this.oldBoxGone,
    });
  }

  override render(): TemplateResult {
    const fieldsInvalid = this.feedback.attempted && this.#incomplete;
    const shownRefusal = this.#shownRefusal;
    const refused = this.#refusalUnder(shownRefusal);
    const artifactError = this.#fieldError(
      "artifact",
      this.feedback.attempted && this.artifact === undefined
        ? t("restore.backup_file_missing")
        : undefined,
      refused,
    );
    const keyError = this.#fieldError(
      "recoveryKey",
      this.feedback.attempted && this.recoveryKey === ""
        ? t("restore.recovery_key_missing")
        : undefined,
      refused,
    );
    const environmentError = this.#fieldError("environment", undefined, refused);
    const bottom = bottomMessage(
      this.feedback.shows("refusal") && this.invalidField === undefined
        ? (this.errorMessage ?? null)
        : null,
      fieldsInvalid || refused !== undefined || this.previewRefusal !== undefined
        ? t("restore.fix_fields")
        : null,
      this.reviewNeeded ? t("restore.review_first") : null,
    );
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
      <p>${t("restore.replace_warning")}</p>
      <wt-file-input
        class="field"
        name="backup"
        label=${t("restore.backup_file")}
        required
        data-test="artifact"
        .files=${this.artifact ? [this.artifact] : []}
        .copy=${fileInputCopy()}
        .locale=${currentLocale()}
        .error=${artifactError ?? ""}
        ?invalid=${artifactError !== undefined}
        @wt-change=${(event: CustomEvent<{ files: File[] }>) => {
          event.stopPropagation();
          this.artifact = event.detail.files[0];
          this.#edited("artifact");
        }}
      >
        <wt-help-tooltip slot="help" aria-label=${t("restore.backup_file_help_label")}
          >${t("restore.backup_file_help")}</wt-help-tooltip
        >
      </wt-file-input>
      <wt-input
        class="field"
        label=${t("restore.recovery_key")}
        name="recovery-key"
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"
        hint=${t("restore.recovery_key_hint")}
        type=${this.recoveryKeyVisible ? "text" : "password"}
        autocomplete="off"
        required
        data-test="recovery-key"
        error=${keyError ?? ""}
        .value=${this.recoveryKey}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.recoveryKey = event.detail.value;
          this.#edited("recoveryKey");
        }}
      >
        <wt-button
          slot="end"
          variant="ghost"
          data-test="toggle-recovery-key"
          aria-label=${
            this.recoveryKeyVisible
              ? t("restore.hide_recovery_key")
              : t("restore.show_recovery_key")
          }
          @click=${() => (this.recoveryKeyVisible = !this.recoveryKeyVisible)}
          >${passwordIcon(this.recoveryKeyVisible)}</wt-button
        >
      </wt-input>
      <wt-combobox
        class="field"
        label=${t("restore.environment")}
        name="environment"
        required
        search="auto"
        data-test="environment"
        error=${environmentError ?? ""}
        .options=${[
          { value: "production", label: t("restore.environment_live") },
          { value: "preproduction", label: t("restore.environment_preproduction") },
        ]}
        .value=${this.environment}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.environment = event.detail.value as "production" | "preproduction";
          this.#edited("environment");
        }}
      >
        <wt-help-tooltip slot="help" aria-label=${t("restore.environment_help_label")}
          >${t("restore.environment_help")}</wt-help-tooltip
        >
      </wt-combobox>
      <setup-recovery-copy
        @recovery-review-needed=${(event: CustomEvent<{ needed: boolean }>) => {
          event.stopPropagation();
          this.reviewNeeded = event.detail.needed;
        }}
        .errorMessage=${shownRefusal}
        .refusedField=${this.invalidField}
        @recovery-field-edited=${(event: CustomEvent<{ field: RecoveryEntryField }>) => {
          event.stopPropagation();
          if (event.detail.field === this.invalidField) this.feedback.dismiss("field");
        }}
        @recovery-invalid=${(event: CustomEvent<{ invalid: boolean }>) => {
          event.stopPropagation();
          this.recoveryInvalid = event.detail.invalid;
        }}
        .api=${this.api}
        .boxAddress=${this.boxAddress}
        .artifact=${this.artifact}
        .recoveryKey=${this.recoveryKey}
        .environment=${this.environment}
        @preview-refusal=${(event: CustomEvent<{ field?: RestoreField }>) => {
          event.stopPropagation();
          this.previewRefusal = event.detail.field;
        }}
      ></setup-recovery-copy>
      <label class="field">
        <input
          name="no-running-server"
          type="checkbox"
          required
          aria-invalid=${this.feedback.attempted && !this.acknowledged ? "true" : "false"}
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
      ${this.feedback.attempted && !this.acknowledged ? html`<p class="error" id="acknowledge-error">${t("restore.acknowledge_missing")}</p>` : nothing}
      ${oldBoxQuestion({
        liveSince: this.#askingOldBox ? this.liveSince : undefined,
        liveUnknown: this.#askingOldBox && this.liveUnknown,
        checked: this.oldBoxGone,
        invalid: this.feedback.attempted && this.#oldBoxUnanswered,
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
          ?disabled=${fieldsInvalid || this.reviewNeeded}
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
