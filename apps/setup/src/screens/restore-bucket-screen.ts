import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  FormFeedback,
  baseStyles,
  pageTitleStyles,
  bottomMessage,
  focusFirstInvalid,
  leaveCoordinatorFor,
  type DraftScope,
  type MasterKeyChangeDetail,
  type WtMasterKeyInput,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-master-key-input.js";
import { MAX_PACK_PDF } from "@waitron/recovery-pack/src/pack-file.js";
import { loadRecoveryPackReader } from "@waitron/recovery-pack/src/load-pack-reader.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { actionsStyles, errorStyles, fieldStyles, statusStyles } from "../form-styles.js";
import {
  type KeptBucketRestoreRequest,
  dispatchBucketRestoreRequested,
  dispatchSetupGoto,
} from "../events.js";
import {
  SetupApi,
  type ApiError,
  type BucketRestoreSource,
  type RecoveryBackupPreview,
  type RecoveryBucket,
} from "../api/client.js";
import type { RecoveryEntryField } from "./recovery-allocation.js";
import { SetupRecoveryCopy, copyEnvironmentFrom } from "./recovery-copy.js";
import { t, format } from "../i18n/t.js";
import { masterKeyFieldWords, refusedKeyName } from "../i18n/master-key-words.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { oldBoxQuestion } from "./old-box-question.js";

export interface RestoredVenue {
  legalName: string;
  taxId: string;
  venueName: string;
}

const initialBucket = {
  endpoint: "",
  bucket: "",
  region: "",
  prefix: "",
  accessKeyId: "",
  secretAccessKey: "",
};
const bucketFields = [
  "endpoint",
  "bucket",
  "region",
  "prefix",
  "accessKeyId",
  "secretAccessKey",
] as const;
function sameBucket(a: RecoveryBucket, b: RecoveryBucket): boolean {
  return bucketFields.every((field) => (a[field] ?? "") === (b[field] ?? ""));
}

const requiredBucketFields = ["bucket", "region", "accessKeyId", "secretAccessKey"] as const;
export type BucketLocationField = (typeof bucketFields)[number];
export type BucketField =
  | BucketLocationField
  | "masterKey"
  | "environment"
  | "oldBoxGone"
  | "venueConfirmed"
  | RecoveryEntryField;

@customElement("setup-restore-bucket-screen")
export class SetupRestoreBucketScreen extends LitElement {
  static override styles = [
    baseStyles,
    pageTitleStyles,
    fieldStyles,
    errorStyles,
    actionsStyles,
    statusStyles,
    css`
      :host {
        display: block;
      }
      .status {
        margin-bottom: var(--wt-space-4);
      }
    `,
  ];

  @property({ attribute: false }) api: SetupApi = new SetupApi();
  @property({ attribute: false }) boxAddress?: string;
  @property() errorMessage?: string;
  /** A new value means a new refusal: it shows `errorMessage` again after the person pressed it away. A language change rewords `errorMessage` without changing this. */
  @property({ attribute: false }) refusal?: unknown;
  /** The field `errorMessage` is about. */
  @property() invalidField?: BucketField;
  /** When the old server last wrote to its bucket (`restore.stream_source_live`). */
  @property() liveSince?: string;
  /** Whether the old server is still writing could not be checked (`restore.stream_source_unchecked`). */
  @property({ type: Boolean }) liveUnknown = false;
  @property({ attribute: false }) venue?: RestoredVenue;
  /** The request the shell last sent, returned with a refusal so the owner's entries are kept. */
  @property({ attribute: false }) request?: KeptBucketRestoreRequest;
  @state() private bucket: RecoveryBucket = initialBucket;
  @state() private masterKey = "";
  @state() private environment: "production" | "preproduction" = "production";
  @state() private acknowledged = false;
  @state() private oldBoxGone = false;
  @state() private venueConfirmed = false;
  @state() private preview?: RecoveryBackupPreview;
  /** As `setup-recovery-copy` last announced. */
  @state() private reviewNeeded = false;
  @state() private recoveryInvalid = false;

  @state() private previewField?: BucketLocationField | "masterKey" | "environment";
  @state() private previewKeyName?: string;
  @state() private folders?: string[];
  @state() private previewLiveSince?: string;
  @state() private previewLiveUnknown = false;
  /** The environment Review switched the field to, until the person changes the source or the field. */
  @state() private followedEnvironment?: "production" | "preproduction";
  private readonly feedback = new FormFeedback(this);
  #baseline?: BucketRestoreSource;
  #scope?: DraftScope<BucketRestoreSource>;
  /** Set once Review has switched the environment to the copy's, so it never switches back and forth. */
  #followedCopy = false;

  #form(): BucketRestoreSource {
    return { bucket: this.bucket, masterKey: this.masterKey, environment: this.environment };
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
        sameBucket(a.bucket, b.bucket) &&
        a.masterKey === b.masterKey &&
        a.environment === b.environment,
      restore: (form) => {
        this.bucket = form.bucket;
        this.masterKey = form.masterKey;
        this.#fillMasterKey();
        this.environment = form.environment;
        this.followedEnvironment = undefined;
        this.acknowledged = false;
        this.oldBoxGone = false;
        this.venueConfirmed = false;
        this.feedback.attempted = false;
        this.folders = undefined;
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
    if (changed.has("refusal")) this.feedback.newRefusal("refusal");
    if (changed.has("invalidField")) this.feedback.newRefusal("field");
    if (changed.has("request") && this.request !== undefined) {
      this.bucket = this.request.bucket;
      this.masterKey = this.request.masterKey;
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
    if (changed.has("request") && this.request !== undefined) this.#fillMasterKey();
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

  #fillMasterKey(): void {
    this.shadowRoot?.querySelector<WtMasterKeyInput>("wt-master-key-input")?.fill(this.masterKey);
  }

  #edited(field: BucketField): void {
    this.#followedCopy = false;
    if (
      field === "masterKey" ||
      field === "environment" ||
      bucketFields.some((name) => name === field)
    ) {
      this.followedEnvironment = undefined;
      this.#scope?.changed();
      this.preview = undefined;
      this.venueConfirmed = false;
      this.folders = undefined;
      if (field !== "environment") {
        this.previewLiveSince = undefined;
        this.previewLiveUnknown = false;
        this.oldBoxGone = false;
        if (
          this.#sourceChanged &&
          (this.invalidField === "oldBoxGone" || this.invalidField === "venueConfirmed")
        )
          this.feedback.dismiss("field");
      }
    }
    if (field === this.previewField) this.previewField = undefined;
    if (field === "masterKey") this.previewKeyName = undefined;
    if (field === this.invalidField) this.feedback.dismiss("field");
  }

  #bucketChanged(field: BucketLocationField, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.bucket = { ...this.bucket, [field]: event.detail.value };
    this.#edited(field);
  }

  async #followCopyEnvironment(environment: "production" | "preproduction"): Promise<void> {
    this.environment = environment;
    this.#edited("environment");
    this.#followedCopy = true;
    this.followedEnvironment = environment;
    await this.updateComplete;
    const copy = this.shadowRoot!.querySelector<SetupRecoveryCopy>("setup-recovery-copy");
    await copy?.updateComplete;
    await copy?.review();
  }

  get #sourceChanged(): boolean {
    return (
      this.request !== undefined &&
      (!sameBucket(this.bucket, this.request.bucket) || this.masterKey !== this.request.masterKey)
    );
  }

  get #askingOldBox(): boolean {
    return (
      (!this.#sourceChanged && (this.liveSince !== undefined || this.liveUnknown)) ||
      this.previewLiveSince !== undefined ||
      this.previewLiveUnknown
    );
  }

  get #venue(): RestoredVenue | undefined {
    if (this.preview !== undefined)
      return { ...this.preview.taxpayer, venueName: this.preview.venueName };
    return this.#sourceChanged ? undefined : this.venue;
  }

  #missing(field: BucketLocationField): boolean {
    return (
      requiredBucketFields.some((name) => name === field) &&
      (this.bucket[field] ?? "").trim() === ""
    );
  }

  get #oldBoxUnanswered(): boolean {
    return this.#askingOldBox && !this.oldBoxGone;
  }

  get #venueUnconfirmed(): boolean {
    return this.#venue !== undefined && !this.venueConfirmed;
  }

  get #incomplete(): boolean {
    return (
      requiredBucketFields.some((field) => this.#missing(field)) ||
      this.masterKey === "" ||
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
      bucket: this.bucket,
      masterKey: this.masterKey,
      environment: this.environment,
      oldBoxGone: this.#askingOldBox && this.oldBoxGone,
    });
    if (!credentials || this.preview === undefined) return;
    dispatchBucketRestoreRequested(this, {
      ...credentials,
      ...this.#form(),
      selectedSourceId: this.preview.sourceId,
      oldBoxGone: this.#askingOldBox && this.oldBoxGone,
      venueConfirmed: this.#venue !== undefined && this.venueConfirmed ? this.#venue.taxId : null,
    });
  }

  #renderBucketField(field: BucketLocationField, refused: BucketField | undefined) {
    const error =
      field === "prefix" && this.folders !== undefined
        ? t(
            this.folders.length === 0
              ? "restore_bucket.folder_required"
              : "restore_bucket.choose_folder",
          )
        : refused === field
          ? this.errorMessage
          : this.previewField === field || (this.feedback.attempted && this.#missing(field))
            ? t("restore_bucket.check.bucket")
            : undefined;
    if (field === "prefix" && this.folders?.length) {
      return html`<wt-combobox
        class="field"
        name="bucket-folder"
        data-test="folder-choice"
        required
        label=${t("restore_bucket.field.prefix")}
        error=${error ?? ""}
        .options=${this.folders.map((value) => ({ value, label: value }))}
        @wt-change=${(event: CustomEvent<{ value: string }>) => this.#bucketChanged(field, event)}
      ></wt-combobox>`;
    }
    return html`<wt-input
      class="field"
      name=${field}
      data-test=${field}
      label=${t(`restore_bucket.field.${field}`)}
      type=${field === "secretAccessKey" ? "password" : "text"}
      ?required=${requiredBucketFields.some((name) => name === field)}
      autocomplete="off"
      autocapitalize="none"
      .spellcheck=${false}
      hint=${field === "endpoint" ? t("restore_bucket.endpoint_hint") : ""}
      error=${error ?? ""}
      .value=${this.bucket[field] ?? ""}
      @wt-change=${(event: CustomEvent<{ value: string }>) => this.#bucketChanged(field, event)}
    ></wt-input>`;
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
    const keyError =
      refused === "masterKey"
        ? this.errorMessage
        : this.previewKeyName !== undefined
          ? masterKeyFieldWords().wrongKey(this.previewKeyName)
          : this.previewField === "masterKey"
            ? t("restore.check.master_key")
            : undefined;
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
      fieldsInvalid ||
        refused !== undefined ||
        this.previewField !== undefined ||
        this.folders !== undefined
        ? t("restore_bucket.fix_fields")
        : null,
      this.reviewNeeded ? t("restore.review_first") : null,
    );
    return html`
      <h1>${t("restore_bucket.heading")}</h1>
      <p>${t("restore_bucket.intro")}</p>
      <p>${t("restore.replace_warning")}</p>
      ${bucketFields.map((field) => this.#renderBucketField(field, refused))}
      <wt-master-key-input
        class="field"
        data-test="master-key"
        required
        .draftParent=${this}
        .copy=${masterKeyFieldWords()}
        .readPack=${loadRecoveryPackReader}
        .maxPdfBytes=${MAX_PACK_PDF}
        .attempted=${this.feedback.attempted}
        .error=${keyError ?? ""}
        @wt-change=${(event: CustomEvent<MasterKeyChangeDetail>) => {
          event.stopPropagation();
          this.masterKey = event.detail.masterKey ?? "";
          this.#edited("masterKey");
        }}
      ></wt-master-key-input>
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
      ${
        this.followedEnvironment !== undefined && environmentError === undefined
          ? html`<p class="status" role="status" data-test="environment-followed">
              ${format("restore_bucket.environment_followed", {
                environment: t(
                  this.followedEnvironment === "production"
                    ? "restore_bucket.environment_live"
                    : "restore_bucket.environment_preproduction",
                ),
              })}
            </p>`
          : nothing
      }
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
        liveSince: this.previewLiveSince ?? (this.#sourceChanged ? undefined : this.liveSince),
        liveUnknown: this.previewLiveUnknown || (!this.#sourceChanged && this.liveUnknown),
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
          if (event.detail.preview === this.preview) return;
          this.preview = event.detail.preview;
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
        .bucket=${this.bucket}
        .masterKey=${this.masterKey}
        .environment=${this.environment}
        .oldBoxGone=${this.oldBoxGone}
        .reviewDisabled=${Boolean(this.folders?.length)}
        @preview-refusal=${(event: CustomEvent<{ cause?: ApiError; field?: string }>) => {
          event.stopPropagation();
          const error = event.detail.cause;
          const copied = copyEnvironmentFrom(error, this.environment);
          if (copied !== undefined && !this.#followedCopy) {
            void this.#followCopyEnvironment(copied);
            return;
          }
          const field = event.detail.field;
          this.previewKeyName = field === "masterKey" ? refusedKeyName(error) : undefined;
          this.previewField =
            field === "masterKey" || field === "environment"
              ? field
              : bucketFields.find((name) => name === field);
          if (
            error?.code === "restore.stream_folder_required" &&
            Array.isArray(error.params?.folders)
          ) {
            this.folders = error.params.folders.filter(
              (folder): folder is string => typeof folder === "string",
            );
          }
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
