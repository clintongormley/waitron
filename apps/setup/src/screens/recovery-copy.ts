import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { SetupApi, type ApiError, type RecoveryBackupPreview } from "../api/client.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
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
  @property({ attribute: false }) api: SetupApi = new SetupApi();
  @property({ attribute: false }) artifact?: File;
  @property({ attribute: false }) recoveryKey = "";
  @property() environment: "production" | "preproduction" = "production";
  @state() private preview?: RecoveryBackupPreview;
  @state() private busy = false;
  @state() private error?: "key" | "environment" | "file" | "failed";
  #attempt = 0;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (
      (["api", "artifact", "recoveryKey", "environment"] as const).some((key) => changed.has(key))
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
    this.error = undefined;
    this.busy = false;
    this.#notifyRefusal();
  }
  #notifyRefusal(): void {
    const field =
      this.error === "key"
        ? "recoveryKey"
        : this.error === "environment"
          ? "environment"
          : this.error === "file"
            ? "artifact"
            : undefined;
    this.dispatchEvent(
      new CustomEvent("preview-refusal", { detail: { field }, bubbles: true, composed: true }),
    );
  }
  get #canReview(): boolean {
    return this.artifact !== undefined && this.recoveryKey !== "";
  }

  async #review(): Promise<void> {
    if (!this.#canReview || this.busy) return;
    const artifact = this.artifact!;
    const recoveryKey = this.recoveryKey;
    const environment = this.environment;
    const attempt = ++this.#attempt;
    const current = () =>
      this.isConnected &&
      attempt === this.#attempt &&
      this.artifact === artifact &&
      this.recoveryKey === recoveryKey &&
      this.environment === environment;
    this.busy = true;
    this.error = undefined;
    this.preview = undefined;
    this.#notifyRefusal();
    try {
      const preview = await this.api.previewRestore(artifact, recoveryKey, environment);
      if (current()) this.preview = preview;
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
                : "failed";
        this.#notifyRefusal();
      }
    } finally {
      if (current()) this.busy = false;
    }
  }

  override render() {
    const preview = this.preview;
    const errors = {
      key: "restore.preview_key_error",
      environment: "restore.preview_environment_error",
      file: "restore.preview_file_error",
      failed: "restore.preview_failed",
    } as const;
    return html` ${
        preview === undefined
          ? nothing
          : html` <section aria-label=${t("restore.preview_heading")} data-test="selected-copy">
              <h2>${t("restore.preview_heading")}</h2>
              <dl>
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
