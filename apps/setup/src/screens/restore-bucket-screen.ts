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
import "@waitron/ui/src/components/wt-textarea.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-file-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { actionsStyles, errorStyles, fieldStyles } from "../form-styles.js";
import {
  type KeptBucketRestoreRequest,
  dispatchBucketRestoreRequested,
  dispatchSetupGoto,
} from "../events.js";
import { SetupApi, type ApiError, type RecoveryBackupPreview } from "../api/client.js";
import type { RecoveryEntryField } from "./recovery-allocation.js";
import { SetupRecoveryCopy } from "./recovery-copy.js";
import { bucketCodeFromFile, type PackFileRefusal } from "../pack-file-input.js";
import { currentLocale, t, format } from "../i18n/t.js";
import { fileInputCopy } from "../file-input-copy.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { oldBoxQuestion } from "./old-box-question.js";

export interface RestoredVenue {
  legalName: string;
  taxId: string;
  venueName: string;
}

interface BucketForm {
  kit: string;
  environment: "production" | "preproduction";
}

export type BucketField =
  "kit" | "environment" | "oldBoxGone" | "venueConfirmed" | RecoveryEntryField;

/**
 * Rebuild this server from the owner's bucket. It asks for the recovery pack or kit and
 * the environment, which the restore's compatibility check compares with the copy's own. The shell
 * sets `liveSince`/`liveUnknown` and `venue` from the server's refusals, and hands back the request
 * it last sent as `request`, so answering a refusal never means pasting the kit again.
 */
@customElement("setup-restore-bucket-screen")
export class SetupRestoreBucketScreen extends LitElement {
  static override styles = [
    baseStyles,
    fieldStyles,
    errorStyles,
    actionsStyles,
    css`
      :host {
        display: block;
      }
      .sensitive {
        font-weight: var(--wt-font-weight-bold);
      }
      wt-textarea::part(control) {
        font-family: var(--wt-font-family-mono);
      }
    `,
  ];

  @property({ attribute: false }) api: SetupApi = new SetupApi();
  @property({ attribute: false }) boxAddress?: string;
  @property() errorMessage?: string;
  /** The field `errorMessage` is about. */
  @property() invalidField?: BucketField;
  /** When the old server last wrote to its bucket (`restore.stream_source_live`). */
  @property() liveSince?: string;
  /** Whether the old server is still writing could not be checked (`restore.stream_source_unchecked`). */
  @property({ type: Boolean }) liveUnknown = false;
  @property({ attribute: false }) venue?: RestoredVenue;
  /** The request the shell last sent, returned with a refusal so the owner's entries are kept. */
  @property({ attribute: false }) request?: KeptBucketRestoreRequest;
  @state() private kit = "";
  @state() private environment: "production" | "preproduction" = "production";
  @state() private acknowledged = false;
  @state() private oldBoxGone = false;
  @state() private venueConfirmed = false;
  @state() private previewVenue?: RestoredVenue;
  /** As `setup-recovery-copy` last announced. */
  @state() private reviewNeeded = false;
  @state() private recoveryInvalid = false;

  @state() private previewField?: "kit" | "environment";
  @state() private previewOldKit = false;
  @state() private previewLiveSince?: string;
  @state() private previewLiveUnknown = false;
  @state() private packRefusal?: PackFileRefusal;
  @state() private kitFile?: File;
  private readonly feedback = new FormFeedback(this);
  #baseline?: BucketForm;
  #scope?: DraftScope<BucketForm>;
  #fileRead = 0;

  #form(): BucketForm {
    return { kit: this.kit, environment: this.environment };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#registerScope();
  }

  override disconnectedCallback(): void {
    ++this.#fileRead;
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
      equal: (a, b) => a.kit === b.kit && a.environment === b.environment,
      restore: (form) => {
        ++this.#fileRead;
        this.packRefusal = undefined;
        this.kit = form.kit;
        this.environment = form.environment;
        this.acknowledged = false;
        this.oldBoxGone = false;
        this.venueConfirmed = false;
        this.feedback.attempted = false;
        this.kitFile = undefined;
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
      this.kit = this.request.kit;
      this.environment = this.request.environment;
      // A request is only sent once the owner has ticked this.
      this.acknowledged = true;
      this.oldBoxGone = this.request.oldBoxGone;
      this.#scope?.changed();
    }
    if (changed.has("venue") || changed.has("request")) {
      this.venueConfirmed =
        this.venue !== undefined && this.request?.venueConfirmed === this.venue.taxId;
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
  #refusalUnder(refusal: string | undefined): BucketField | undefined {
    return refusal === undefined || !this.#shows(this.invalidField) ? undefined : this.invalidField;
  }

  /** Whether `field` is on the screen. */
  #shows(field: BucketField | undefined): boolean {
    if (field === "oldBoxGone") return this.#askingOldBox;
    if (field === "venueConfirmed") return this.#venue !== undefined;
    return field !== undefined;
  }

  #edited(field: BucketField): void {
    if (field === "kit" || field === "environment") {
      this.#scope?.changed();
      if (this.previewVenue !== undefined) {
        this.previewVenue = undefined;
        this.venueConfirmed = false;
      }
    }
    if (field === this.previewField) this.previewField = undefined;
    if (field === this.invalidField) this.feedback.dismiss("field");
  }

  /**
   * The owner has replaced the kit the shell's refusal was about. The server checked the old server
   * and named the copy for THAT kit, so neither its question nor an answer to it applies to this one.
   */
  get #kitReplaced(): boolean {
    return this.request !== undefined && this.kit !== this.request.kit;
  }

  get #askingOldBox(): boolean {
    return (
      !this.#kitReplaced &&
      (this.liveSince !== undefined ||
        this.liveUnknown ||
        this.previewLiveSince !== undefined ||
        this.previewLiveUnknown)
    );
  }

  get #venue(): RestoredVenue | undefined {
    return this.previewVenue ?? (this.#kitReplaced ? undefined : this.venue);
  }

  #setKit(kit: string): void {
    ++this.#fileRead;
    this.packRefusal = undefined;
    this.previewLiveSince = undefined;
    this.previewLiveUnknown = false;
    this.oldBoxGone = false;
    this.kit = kit;
    this.#edited("kit");
    if (this.#kitReplaced) {
      this.oldBoxGone = false;
      this.venueConfirmed = false;
      this.#edited("oldBoxGone");
      this.#edited("venueConfirmed");
    }
  }

  get #kitMissing(): boolean {
    return this.kit.trim() === "";
  }

  get #oldBoxUnanswered(): boolean {
    return this.#askingOldBox && !this.oldBoxGone;
  }

  get #venueUnconfirmed(): boolean {
    return this.#venue !== undefined && !this.venueConfirmed;
  }

  get #incomplete(): boolean {
    return (
      this.#kitMissing ||
      !this.acknowledged ||
      this.recoveryInvalid ||
      this.#oldBoxUnanswered ||
      this.#venueUnconfirmed
    );
  }

  #restore(): void {
    this.feedback.press("refusal");
    if (this.#incomplete) {
      void this.feedback.focus(this.shadowRoot!);
      return;
    }
    const credentials = this.shadowRoot!.querySelector<SetupRecoveryCopy>(
      "setup-recovery-copy",
    )?.readCredentials({
      bucketKit: this.kit,
      environment: this.environment,
      oldBoxGone: this.#askingOldBox && this.oldBoxGone,
    });
    if (!credentials) return;
    dispatchBucketRestoreRequested(this, {
      ...credentials,
      kit: this.kit,
      environment: this.environment,
      oldBoxGone: this.#askingOldBox && this.oldBoxGone,
      venueConfirmed: this.#venue !== undefined && this.venueConfirmed ? this.#venue.taxId : null,
    });
  }

  async #readFile(event: CustomEvent<{ files: File[] }>): Promise<void> {
    event.stopPropagation();
    const file = event.detail.files[0];
    this.kitFile = file;
    const read = ++this.#fileRead;
    if (file === undefined) return;
    const chosen = await bucketCodeFromFile(file);
    if (!this.isConnected || read !== this.#fileRead) return;
    if ("refused" in chosen) this.packRefusal = chosen.refused;
    else this.#setKit(chosen.text);
  }

  #renderVenue(refused: BucketField | undefined): TemplateResult | typeof nothing {
    const venue = this.#venue;
    if (venue === undefined) return nothing;
    const error =
      this.feedback.attempted && this.#venueUnconfirmed
        ? t("restore_bucket.venue_missing")
        : refused === "venueConfirmed"
          ? this.errorMessage
          : undefined;
    return html`<p data-test="venue">
        ${t("restore_bucket.venue_owner")} <strong>${venue.legalName}</strong>
        ${format("restore_bucket.venue_details", { taxId: venue.taxId, venue: venue.venueName })}
      </p>
      <label class="field">
        <input
          name="venue-confirmed"
          type="checkbox"
          required
          data-test="venue-confirmed"
          aria-invalid=${error === undefined ? "false" : "true"}
          aria-describedby=${error === undefined ? nothing : "venue-confirmed-error"}
          .checked=${this.venueConfirmed}
          @change=${(e: Event) => {
            this.venueConfirmed = (e.currentTarget as HTMLInputElement).checked;
            this.#edited("venueConfirmed");
          }}
        />
        ${t("restore_bucket.venue_confirm")}
      </label>
      ${error === undefined ? nothing : html`<p class="error" id="venue-confirmed-error">${error}</p>`}`;
  }

  override render(): TemplateResult {
    const shownRefusal = this.#shownRefusal;
    const refused = this.#refusalUnder(shownRefusal);
    const kitError =
      this.feedback.attempted && this.#kitMissing
        ? t("restore_bucket.kit_missing")
        : this.previewField === "kit"
          ? t(this.previewOldKit ? "shell.bucket.kit_old_version" : "restore.preview_kit_error")
          : refused === "kit"
            ? this.errorMessage
            : undefined;
    const packError =
      this.packRefusal === undefined ? undefined : t(`restore_bucket.pack_${this.packRefusal}`);
    const environmentError =
      this.previewField === "environment"
        ? t("restore.preview_environment_error")
        : refused === "environment"
          ? this.errorMessage
          : undefined;
    const acknowledgeInvalid = this.feedback.attempted && !this.acknowledged;
    const fieldsInvalid = this.feedback.attempted && this.#incomplete;
    const bottom = bottomMessage(
      this.#shows(this.invalidField) ? null : (shownRefusal ?? null),
      fieldsInvalid || refused !== undefined || this.previewField !== undefined
        ? t("restore_bucket.fix_fields")
        : null,
      this.reviewNeeded ? t("restore.review_first") : null,
    );
    return html`
      <h1>${t("restore_bucket.heading")}</h1>
      <p>${t("restore_bucket.intro")}</p>
      <p>${t("restore.replace_warning")}</p>
      <p class="sensitive" data-test="kit-sensitive">${t("restore_bucket.sensitive")}</p>
      <wt-file-input
        class="field"
        name="recovery-kit-file"
        label=${t("restore_bucket.kit_file")}
        data-test="kit-file"
        .files=${this.kitFile ? [this.kitFile] : []}
        .copy=${fileInputCopy()}
        .locale=${currentLocale()}
        .error=${packError ?? ""}
        ?invalid=${packError !== undefined}
        @wt-change=${(event: CustomEvent<{ files: File[] }>) => void this.#readFile(event)}
      ></wt-file-input>
      <wt-textarea
        class="field"
        label=${t("restore_bucket.kit")}
        name="recovery-kit"
        hint=${t("restore_bucket.kit_hint")}
        required
        rows="6"
        autocapitalize="none"
        autocorrect="off"
        autocomplete="off"
        .spellcheck=${false}
        data-test="kit"
        error=${kitError ?? ""}
        .value=${this.kit}
        @wt-change=${(e: CustomEvent<{ value: string }>) => {
          e.stopPropagation();
          this.#setKit(e.detail.value);
        }}
      >
      </wt-textarea>
      <wt-combobox
        class="field"
        label=${t("restore_bucket.environment")}
        name="environment"
        required
        search="auto"
        data-test="environment"
        error=${environmentError ?? ""}
        .options=${[
          { value: "production", label: t("restore_bucket.environment_live") },
          { value: "preproduction", label: t("restore_bucket.environment_preproduction") },
        ]}
        .value=${this.environment}
        @wt-change=${(e: CustomEvent<{ value: string }>) => {
          e.stopPropagation();
          this.environment = e.detail.value as "production" | "preproduction";
          this.#edited("environment");
        }}
      >
        <wt-help-tooltip slot="help" aria-label=${t("restore_bucket.environment_help_label")}
          >${t("restore_bucket.environment_help")}</wt-help-tooltip
        >
      </wt-combobox>
      <label class="field">
        <input
          name="no-running-server"
          type="checkbox"
          required
          data-test="acknowledge"
          aria-invalid=${acknowledgeInvalid ? "true" : "false"}
          aria-describedby=${acknowledgeInvalid ? "acknowledge-error" : nothing}
          .checked=${this.acknowledged}
          @change=${(e: Event) => {
            this.acknowledged = (e.currentTarget as HTMLInputElement).checked;
          }}
        />
        ${t("restore_bucket.acknowledge")}
      </label>
      ${acknowledgeInvalid ? html`<p class="error" id="acknowledge-error">${t("restore_bucket.acknowledge_missing")}</p>` : nothing}
      ${oldBoxQuestion({
        liveSince: this.#askingOldBox ? (this.liveSince ?? this.previewLiveSince) : undefined,
        liveUnknown: this.#askingOldBox && (this.liveUnknown || this.previewLiveUnknown),
        checked: this.oldBoxGone,
        invalid: this.feedback.attempted && this.#oldBoxUnanswered,
        refusal: refused === "oldBoxGone" ? this.errorMessage : undefined,
        onChange: (checked) => {
          this.oldBoxGone = checked;
          this.#edited("oldBoxGone");
        },
      })}
      <setup-recovery-copy
        @recovery-review-needed=${(event: CustomEvent<{ needed: boolean }>) => {
          event.stopPropagation();
          this.reviewNeeded = event.detail.needed;
        }}
        @recovery-preview=${(event: CustomEvent<{ preview?: RecoveryBackupPreview }>) => {
          event.stopPropagation();
          const preview = event.detail.preview;
          if (preview === undefined && this.previewVenue === undefined) return;
          this.previewVenue =
            preview === undefined
              ? undefined
              : {
                  legalName: preview.taxpayer.legalName,
                  taxId: preview.taxpayer.taxId,
                  venueName: preview.venueName,
                };
          this.venueConfirmed = false;
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
        .bucketKit=${this.kit}
        .environment=${this.environment}
        .oldBoxGone=${this.oldBoxGone}
        @preview-refusal=${(event: CustomEvent<{ cause?: ApiError; field?: string }>) => {
          event.stopPropagation();
          const error = event.detail.cause;
          this.previewOldKit =
            error?.code === "backup.stream_kit_invalid" && error.params?.reason === "version";
          this.previewField =
            event.detail.field === "kit" || event.detail.field === "environment"
              ? event.detail.field
              : undefined;
          if (error?.code === "restore.stream_source_live")
            this.previewLiveSince =
              typeof error.params?.lastChangeAt === "string"
                ? error.params.lastChangeAt
                : undefined;
          if (error?.code === "restore.stream_source_unchecked") this.previewLiveUnknown = true;
        }}
      ></setup-recovery-copy>
      ${this.#renderVenue(refused)}
      <wt-form-actions .error=${bottom}>
        <wt-button
          variant="ghost"
          slot="cancel"
          data-test="back"
          @click=${() => dispatchSetupGoto(this, "role")}
          >${t("restore_bucket.back")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test="restore"
          ?disabled=${fieldsInvalid || this.reviewNeeded}
          @click=${() => this.#restore()}
          >${t("restore_bucket.submit")}</wt-button
        >
      </wt-form-actions>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-restore-bucket-screen": SetupRestoreBucketScreen;
  }
}
