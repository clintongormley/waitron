import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import {
  SetupApi,
  type ApiError,
  type RecoveryBackupPreview,
  type RecoveryRestoreCredentials,
} from "../api/client.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { SetupRecoveryAllocation } from "./recovery-allocation.js";
import { t } from "../i18n/t.js";

@customElement("setup-recovery-copy")
export class SetupRecoveryCopy extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        margin-block: var(--wt-space-4);
      }
      section {
        border: var(--wt-field-line-width) solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        padding: var(--wt-space-4);
      }
      dl {
        display: grid;
        gap: var(--wt-space-2);
      }
      dt {
        color: var(--wt-color-text-muted);
      }
      dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
      p {
        overflow-wrap: anywhere;
      }
    `,
  ];
  @property() errorMessage?: string;
  @property() refusedField?: string;
  @property({ attribute: false }) api: SetupApi = new SetupApi();
  @property({ attribute: false }) artifact?: File;
  @property({ attribute: false }) recoveryKey = "";
  @property() environment: "production" | "preproduction" = "production";
  @property({ attribute: false }) bucketKit?: string;
  @property({ attribute: false }) cloudPointId?: string;
  @property({ attribute: false }) selectionId?: string;
  @property({ type: Boolean }) oldBoxGone = false;
  @state() private preview?: RecoveryBackupPreview;
  @state() private busy = false;
  @state() private error?: "key" | "environment" | "file" | "kit" | "failed";
  #attempt = 0;
  #previewCurrent?: () => boolean;
  #prepare: NonNullable<SetupRecoveryAllocation["prepare"]> = async (request) => {
    const current = this.#previewCurrent;
    if (!current?.()) throw new Error("Selected recovery copy changed");
    const source =
      this.bucketKit !== undefined
        ? { kind: "bucket" as const, kit: this.bucketKit, environment: this.environment }
        : this.cloudPointId !== undefined
          ? { kind: "cloud" as const, pointId: this.cloudPointId }
          : {
              kind: "archive" as const,
              artifact: this.artifact!,
              recoveryKey: this.recoveryKey,
              environment: this.environment,
            };
    const result = await this.api.prepareRecovery(source, request);
    if (!current()) throw new Error("Selected recovery copy changed");
    return result;
  };

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (
      (
        [
          "api",
          "artifact",
          "recoveryKey",
          "environment",
          "bucketKit",
          "cloudPointId",
          "selectionId",
          "oldBoxGone",
        ] as const
      ).some((key) => changed.has(key))
    )
      this.#invalidate();
  }
  override disconnectedCallback(): void {
    this.#invalidate();
    super.disconnectedCallback();
  }
  #invalidate(): void {
    this.#attempt += 1;
    this.preview = undefined;
    this.#previewCurrent = undefined;
    this.#notifyPreview();
    this.error = undefined;
    this.busy = false;
    this.#notifyRefusal();
    this.dispatchEvent(
      new CustomEvent("recovery-invalid", {
        detail: { invalid: false },
        bubbles: true,
        composed: true,
      }),
    );
  }
  #notifyRefusal(cause?: ApiError): void {
    const field =
      this.error === "key"
        ? "recoveryKey"
        : this.error === "environment"
          ? "environment"
          : this.error === "file"
            ? "artifact"
            : this.error === "kit"
              ? "kit"
              : undefined;
    this.dispatchEvent(
      new CustomEvent("preview-refusal", {
        detail: { field, cause },
        bubbles: true,
        composed: true,
      }),
    );
  }
  #notifyPreview(): void {
    this.dispatchEvent(
      new CustomEvent("recovery-preview", {
        detail: { preview: this.preview },
        bubbles: true,
        composed: true,
      }),
    );
  }
  get #canReview(): boolean {
    return this.bucketKit !== undefined
      ? this.bucketKit.trim() !== ""
      : this.cloudPointId !== undefined
        ? this.cloudPointId !== ""
        : this.artifact !== undefined && this.recoveryKey !== "";
  }

  async #review(): Promise<void> {
    if (!this.#canReview || this.busy) return;
    const artifact = this.artifact;
    const bucketKit = this.bucketKit;
    const cloudPointId = this.cloudPointId;
    const selectionId = this.selectionId;
    const oldBoxGone = this.oldBoxGone;
    const api = this.api;
    const recoveryKey = this.recoveryKey;
    const environment = this.environment;
    const attempt = ++this.#attempt;
    const current = () =>
      this.isConnected &&
      attempt === this.#attempt &&
      this.api === api &&
      this.bucketKit === bucketKit &&
      this.cloudPointId === cloudPointId &&
      this.selectionId === selectionId &&
      this.oldBoxGone === oldBoxGone &&
      this.artifact === artifact &&
      this.recoveryKey === recoveryKey &&
      this.environment === environment;
    this.busy = true;
    this.error = undefined;
    this.preview = undefined;
    this.#notifyPreview();
    this.#notifyRefusal();
    try {
      const preview =
        bucketKit !== undefined
          ? await api.previewBucketRestore(bucketKit, environment, oldBoxGone)
          : cloudPointId !== undefined
            ? await api.previewCloudRestore(cloudPointId)
            : await api.previewRestore(artifact!, recoveryKey, environment);
      if (current()) {
        this.preview = preview;
        this.#previewCurrent = current;
        this.#notifyPreview();
      }
    } catch (cause) {
      if (current()) {
        const error = cause as ApiError | undefined;
        const field = error?.params?.field;
        this.error =
          error?.code === "recovery.passphrase_invalid" || field === "recoveryKey"
            ? "key"
            : error?.code === "restore.environment_mismatch" || field === "environment"
              ? "environment"
              : error?.code === "backup.artifact_invalid" ||
                  error?.code === "backup.archive_invalid" ||
                  field === "artifact"
                ? "file"
                : error?.code === "backup.stream_kit_invalid" || field === "kit"
                  ? "kit"
                  : "failed";
        this.#notifyRefusal(error);
      }
    } finally {
      if (current()) this.busy = false;
    }
  }

  readCredentials(
    selection: Partial<
      Pick<
        SetupRecoveryCopy,
        | "artifact"
        | "recoveryKey"
        | "environment"
        | "bucketKit"
        | "cloudPointId"
        | "selectionId"
        | "oldBoxGone"
      >
    > = {},
  ): RecoveryRestoreCredentials | undefined | null {
    const credentials = this.shadowRoot
      ?.querySelector<SetupRecoveryAllocation>("setup-recovery-allocation")
      ?.readCredentials();
    if (credentials === undefined) return;
    if (
      !this.#previewCurrent?.() ||
      Object.entries(selection).some(
        ([key, value]) => this[key as keyof typeof selection] !== value,
      )
    )
      return null;
    return credentials;
  }

  override render() {
    const preview = this.preview;
    const errors = {
      key: "restore.preview_key_error",
      environment: "restore.preview_environment_error",
      file: "restore.preview_file_error",
      kit: "restore.preview_kit_error",
      failed: "restore.preview_failed",
    } as const;
    return html` ${
        preview === undefined
          ? nothing
          : html` <section aria-label=${t("restore.preview_heading")} data-test="selected-copy">
              <h2>${t("restore.preview_heading")}</h2>
              <dl>
                <dt>${t("restore.preview_source")}</dt>
                <dd>${preview.sourceId}</dd>
                <dt>${t("restore.preview_business")}</dt>
                <dd>${preview.taxpayer.legalName} (${preview.taxpayer.taxId})</dd>
                <dt>${t("restore.preview_location")}</dt>
                <dd>${preview.locationName}</dd>
                <dt>${t("restore.preview_date")}</dt>
                <dd><time datetime=${preview.createdAt}>${preview.createdAt}</time></dd>
                <dt>${t("restore.preview_node_key")}</dt>
                <dd>${preview.nodeRecoveryKeyName ?? t("restore.preview_unnamed")}</dd>
              </dl>
              <p>${t("restore.preview_older_key")}</p>
              <p>${t("restore.preview_keep_keys")}</p>
              <p>${t("restore.preview_key_separate")}</p>
              <setup-recovery-allocation
                .preview=${preview}
                .prepare=${this.#prepare}
                .errorMessage=${this.errorMessage}
                .refusedField=${this.refusedField}
              ></setup-recovery-allocation>
            </section>`
      }
      <wt-form-actions .error=${this.error === undefined ? "" : t(errors[this.error])}>
        <wt-button
          data-test="preview"
          variant=${this.#canReview ? "primary" : "secondary"}
          ?disabled=${!this.#canReview || this.busy}
          ?loading=${this.busy}
          @click=${() => void this.#review()}
          >${t("restore.preview_action")}</wt-button
        >
      </wt-form-actions>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-recovery-copy": SetupRecoveryCopy;
  }
}
