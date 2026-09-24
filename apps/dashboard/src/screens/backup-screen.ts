import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type {
  BackupApplyBody,
  BackupSchedule,
  BackupStatusView,
  DashboardApi,
} from "../api/client.js";

/** Mirrors the server's `MIN_PASSPHRASE_LENGTH` (`apps/server/src/recovery-bundle.ts`) for fast
 * feedback on a PASTED key; the server stays the authority. */
const MIN_KEY_LENGTH = 12;

/** Monday-first display order; `n` is the `Date.getDay()` value the server's schedule expects. */
const WEEKDAYS: { n: number; labelKey: Parameters<typeof t>[0] }[] = [
  { n: 1, labelKey: "backup.weekday.mon" },
  { n: 2, labelKey: "backup.weekday.tue" },
  { n: 3, labelKey: "backup.weekday.wed" },
  { n: 4, labelKey: "backup.weekday.thu" },
  { n: 5, labelKey: "backup.weekday.fri" },
  { n: 6, labelKey: "backup.weekday.sat" },
  { n: 0, labelKey: "backup.weekday.sun" },
];

@customElement("dashboard-backup-screen")
export class BackupScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .title {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      h2 {
        margin: var(--wt-space-6) 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text);
      }
      .card {
        max-width: 34rem;
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }
      .status {
        padding: var(--wt-space-3);
        background: var(--wt-color-surface);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        display: grid;
        gap: var(--wt-space-1);
      }
      .status dt {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .status dd {
        margin: 0 0 var(--wt-space-2);
        color: var(--wt-color-text);
      }
      .on {
        color: var(--wt-color-primary);
        font-weight: var(--wt-font-weight-bold);
      }
      .off,
      .stale {
        color: var(--wt-color-danger);
      }
      .field {
        display: block;
      }
      .field-label {
        display: block;
        margin-bottom: var(--wt-space-1);
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      .hint {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      select,
      input[type="number"],
      input[type="time"] {
        width: 100%;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        box-sizing: border-box;
      }
      .weekdays {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
      }
      .checkbox {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        color: var(--wt-color-text);
      }
      /* The one-time key reveal: a monospace block so every character of the key is legible. */
      .key {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: var(--wt-font-size-sm);
        word-break: break-all;
        padding: var(--wt-space-2) var(--wt-space-3);
        background: var(--wt-color-surface);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        color: var(--wt-color-text);
      }
      .key-actions {
        display: flex;
        gap: var(--wt-space-2);
        align-items: center;
        flex-wrap: wrap;
      }
      /* An underlined, text-coloured link: the text token is the one guaranteed to meet contrast on
         the surface, unlike the primary accent, which fails AA at this small size (a11y finding). */
      a.download {
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-sm);
        text-decoration: underline;
      }
      /* The rotate warning: loud, because a rotate leaves older archives needing the OLD key. */
      .warning {
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-danger);
        border-radius: var(--wt-radius-md);
        color: var(--wt-color-danger);
        background: var(--wt-color-surface);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.errorKey = codeOf(error);
    },
  );

  @state() private status?: BackupStatusView;
  @state() private errorKey: string | null = null;

  // The configure and rotate forms share this draft: only ONE of them renders at a time.
  @state() private destinationDir = "";
  @state() private mintedKey: string | null = null;
  @state() private advancedPaste = false;
  @state() private pastedKey = "";
  @state() private savedIt = false;

  @state() private daysMode: "daily" | "weekdays" = "daily";
  @state() private weekdays: number[] = [1, 2, 3, 4, 5];
  @state() private timeMode: "auto" | "fixed" = "auto";
  @state() private atTime = "03:00";
  @state() private retainCount = 7;
  @state() private retainDays = 30;

  @state() private submitting = false;
  @state() private configurationPassphrase = "";
  @state() private configurationConfirm = "";
  @state() private configurationPassphraseVisible = false;
  @state() private configurationConfirmVisible = false;
  @state() private configurationError: "required" | "mismatch" | "request" | null = null;
  @state() private exportingConfiguration = false;

  @state() private oldKey: string | null = null;

  @state() private editSettings = false;
  /** Fetched on entering edit mode so a settings change re-applies under the SAME key. Held off the
   * reactive state so it is never rendered. */
  #reuseKey: string | null = null;

  /** Stable per instance, so re-renders do not shift the downloaded key file's name. */
  readonly #stamp = new Date().toISOString();
  readonly #fileStamp = this.#stamp.replace(/[:.]/g, "-");

  /** Keyed by the key text so a re-render reuses the URL rather than leaking a fresh one. */
  #blobUrls = new Map<string, string>();

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  override disconnectedCallback(): void {
    for (const url of this.#blobUrls.values()) URL.revokeObjectURL(url);
    this.#blobUrls.clear();
    super.disconnectedCallback();
  }

  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      await this.#queries.watch("getBackupStatus", [], (value) => {
        this.status = value;
      });
      if (this.status!.isPrimary && !this.status!.managedByEnvironment) await this.#mint();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  async #mint(): Promise<void> {
    try {
      const { key } = await this.api.mintBackupKey();
      this.mintedKey = key;
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  get #effectiveKey(): string {
    return this.advancedPaste ? this.pastedKey : (this.mintedKey ?? "");
  }

  get #applyDisabled(): boolean {
    return (
      this.submitting ||
      !this.savedIt ||
      this.destinationDir.trim() === "" ||
      this.#effectiveKey === ""
    );
  }

  get #rotateDisabled(): boolean {
    // The OLD key must be re-shown first: rotating overwrites it, so the operator has to have had the
    // chance to record it.
    return this.submitting || !this.savedIt || this.#effectiveKey === "" || this.oldKey === null;
  }

  get #saveSettingsDisabled(): boolean {
    return this.submitting || this.destinationDir.trim() === "" || this.#reuseKey === null;
  }

  #buildSchedule(): BackupSchedule {
    const days: "daily" | number[] = this.daysMode === "daily" ? "daily" : [...this.weekdays];
    let at: { hour: number; minute: number } | "auto";
    if (this.timeMode === "auto") {
      at = "auto";
    } else {
      const [h, m] = this.atTime.split(":");
      at = { hour: Number(h), minute: Number(m) };
    }
    return { kind: "wall-clock", days, at };
  }

  #pastedKeyTooShort(): boolean {
    if (this.advancedPaste && this.#effectiveKey.length < MIN_KEY_LENGTH) {
      this.errorKey = "backup.recovery_key_too_short";
      return true;
    }
    return false;
  }

  async #apply(): Promise<void> {
    if (this.#applyDisabled || this.#pastedKeyTooShort()) return;
    this.errorKey = null;
    this.submitting = true;
    const body: BackupApplyBody = {
      destinationDir: this.destinationDir.trim(),
      recoveryKey: this.#effectiveKey,
      schedule: this.#buildSchedule(),
      retention: { count: this.retainCount, days: this.retainDays },
    };
    try {
      this.status = await this.api.applyBackup(body);
      this.savedIt = false;
      this.advancedPaste = false;
      this.pastedKey = "";
      await this.#mint();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.submitting = false;
    }
  }

  async #rotate(): Promise<void> {
    if (this.#rotateDisabled || this.#pastedKeyTooShort()) return;
    this.errorKey = null;
    this.submitting = true;
    try {
      this.status = await this.api.rotateBackupKey({ recoveryKey: this.#effectiveKey });
      this.savedIt = false;
      this.advancedPaste = false;
      this.pastedKey = "";
      this.oldKey = null;
      await this.#mint();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.submitting = false;
    }
  }

  async #showOldKey(): Promise<void> {
    this.errorKey = null;
    try {
      const { key } = await this.api.getBackupRecoveryKey();
      this.oldKey = key;
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  async #startEdit(): Promise<void> {
    this.errorKey = null;
    try {
      const { key } = await this.api.getBackupRecoveryKey();
      if (key === null) {
        // An enabled box always has a key; a null here means nothing to re-apply against.
        this.errorKey = "backup.recovery_key_missing";
        return;
      }
      this.#reuseKey = key;
      if (this.status) this.#prefillFromStatus(this.status);
      this.editSettings = true;
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  async #saveSettings(): Promise<void> {
    if (this.#saveSettingsDisabled || this.#reuseKey === null) return;
    this.errorKey = null;
    this.submitting = true;
    const body: BackupApplyBody = {
      destinationDir: this.destinationDir.trim(),
      recoveryKey: this.#reuseKey,
      schedule: this.#buildSchedule(),
      retention: { count: this.retainCount, days: this.retainDays },
    };
    try {
      this.status = await this.api.applyBackup(body);
      this.editSettings = false;
      this.#reuseKey = null;
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.submitting = false;
    }
  }

  #cancelEdit(): void {
    this.editSettings = false;
    this.#reuseKey = null;
    this.errorKey = null;
  }

  /** A non-`wall-clock` running schedule (the box-image `interval` form the UI cannot author) leaves
   * the schedule controls at their defaults. */
  #prefillFromStatus(s: BackupStatusView): void {
    this.destinationDir = s.destinations[0]?.dir ?? "";
    if (s.schedule?.kind === "wall-clock") {
      this.daysMode = s.schedule.days === "daily" ? "daily" : "weekdays";
      if (Array.isArray(s.schedule.days)) this.weekdays = [...s.schedule.days];
      if (s.schedule.at === "auto") {
        this.timeMode = "auto";
      } else {
        this.timeMode = "fixed";
        const pad = (n: number) => String(n).padStart(2, "0");
        this.atTime = `${pad(s.schedule.at.hour)}:${pad(s.schedule.at.minute)}`;
      }
    }
    if (s.retention) {
      this.retainCount = s.retention.count;
      this.retainDays = s.retention.days;
    }
  }

  /** Of the key BEING downloaded, not the running key's server fingerprint: on a rotate the new key's
   * file must not carry the old key's fingerprint. */
  #fingerprint(key: string): string {
    if (key === "") return "box";
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  #keyFileName(key: string): string {
    return `waitron-recovery-key-${this.#fingerprint(key)}-${this.#fileStamp}.txt`;
  }

  #keyFileBody(key: string): string {
    return (
      `${t("backup.key.file_heading")}\n` +
      `${t("backup.status.fingerprint")}: ${this.#fingerprint(key)}\n` +
      `${this.#stamp}\n\n` +
      `${t("backup.key.file_note")}\n\n` +
      `${key}\n`
    );
  }

  #downloadHref(key: string): string {
    let url = this.#blobUrls.get(key);
    if (url === undefined) {
      const blob = new Blob([this.#keyFileBody(key)], { type: "text/plain" });
      url = URL.createObjectURL(blob);
      this.#blobUrls.set(key, url);
    }
    return url;
  }

  /** Guarded so a denied or absent clipboard never becomes an unhandled rejection. */
  #copy(key: string): void {
    void navigator.clipboard?.writeText(key).catch(() => {
      /* clipboard denied — the download + on-screen key are the fallback */
    });
  }

  #onDestination(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.destinationDir = event.detail.value;
  }

  #onPaste(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.pastedKey = event.detail.value;
  }

  async #exportConfiguration(): Promise<void> {
    this.configurationError = null;
    if (this.configurationPassphrase.length < MIN_KEY_LENGTH) {
      this.configurationError = "required";
      return;
    }
    if (this.configurationPassphrase !== this.configurationConfirm) {
      this.configurationError = "mismatch";
      return;
    }
    this.exportingConfiguration = true;
    try {
      const artifact = await this.api.exportConfiguration(this.configurationPassphrase);
      const url = URL.createObjectURL(artifact);
      const download = document.createElement("a");
      download.href = url;
      download.download = `waitron-configuration-${this.#fileStamp}.enc`;
      download.click();
      URL.revokeObjectURL(url);
      this.configurationPassphrase = "";
      this.configurationConfirm = "";
    } catch {
      this.configurationError = "request";
    } finally {
      this.exportingConfiguration = false;
    }
  }

  #toggleWeekday(n: number): void {
    this.weekdays = this.weekdays.includes(n)
      ? this.weekdays.filter((d) => d !== n)
      : [...this.weekdays, n];
  }

  override render(): TemplateResult {
    const s = this.status;
    return html`
      <h1 class="title">${t("backup.title")}</h1>
      ${this.#renderConfigurationExport()} ${s === undefined ? nothing : this.#renderBody(s)}
      ${
        this.errorKey
          ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>`
          : nothing
      }
    `;
  }

  #renderConfigurationExport(): TemplateResult {
    const fieldMessage =
      this.configurationError === "required"
        ? t("backup.configuration.passphrase_error")
        : this.configurationError === "mismatch"
          ? t("backup.configuration.match_error")
          : null;
    return html`
      <section class="card" aria-labelledby="configuration-export-title">
        <h2 id="configuration-export-title">${t("backup.configuration.title")}</h2>
        <p class="hint">${t("backup.configuration.explanation")}</p>
        ${
          this.configurationError
            ? html`<p class="error" role="alert" data-test="configuration-error">
                ${
                  this.configurationError === "request"
                    ? t("backup.configuration.request_error")
                    : t("backup.configuration.form_error")
                }
              </p>`
            : nothing
        }
        <wt-input
          data-test="configuration-passphrase"
          name="configuration-passphrase"
          type=${this.configurationPassphraseVisible ? "text" : "password"}
          autocomplete="new-password"
          required
          ?invalid=${fieldMessage !== null}
          label=${t("backup.configuration.passphrase")}
          .value=${this.configurationPassphrase}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.configurationPassphrase = event.detail.value;
          }}
        >
          <wt-button
            slot="end"
            variant="ghost"
            data-test="toggle-configuration-passphrase"
            aria-label=${this.configurationPassphraseVisible ? t("login.hide_password") : t("login.show_password")}
            @click=${() =>
              (this.configurationPassphraseVisible = !this.configurationPassphraseVisible)}
            >${this.configurationPassphraseVisible ? t("login.hide_password") : t("login.show_password")}</wt-button
          >
        </wt-input>
        ${
          fieldMessage
            ? html`<p class="error" data-test="configuration-field-error">${fieldMessage}</p>`
            : nothing
        }
        <wt-input
          data-test="configuration-confirm"
          name="configuration-passphrase-confirmation"
          type=${this.configurationConfirmVisible ? "text" : "password"}
          autocomplete="new-password"
          required
          ?invalid=${fieldMessage !== null}
          label=${t("backup.configuration.confirm")}
          .value=${this.configurationConfirm}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.configurationConfirm = event.detail.value;
          }}
        >
          <wt-button
            slot="end"
            variant="ghost"
            data-test="toggle-configuration-confirm"
            aria-label=${this.configurationConfirmVisible ? t("login.hide_password") : t("login.show_password")}
            @click=${() => (this.configurationConfirmVisible = !this.configurationConfirmVisible)}
            >${this.configurationConfirmVisible ? t("login.hide_password") : t("login.show_password")}</wt-button
          >
        </wt-input>
        ${
          fieldMessage
            ? html`<p class="error" data-test="configuration-field-error">${fieldMessage}</p>`
            : nothing
        }
        <wt-button
          variant="primary"
          data-test="configuration-export"
          ?disabled=${this.exportingConfiguration}
          @click=${() => void this.#exportConfiguration()}
          >${t("backup.configuration.download")}</wt-button
        >
      </section>
    `;
  }

  #renderBody(s: BackupStatusView): TemplateResult {
    const writable = s.isPrimary && !s.managedByEnvironment;
    return html`
      <div class="card">
        ${this.#renderStatus(s)}
        ${
          s.managedByEnvironment
            ? html`<p class="hint" data-test="managed">${t("backup.status.managed")}</p>`
            : !s.isPrimary
              ? html`<p class="hint" data-test="not-primary">${t("backup.status.not_primary")}</p>`
              : nothing
        }
        ${writable && !s.enabled ? this.#renderConfigure() : nothing}
        ${writable && s.enabled && this.editSettings ? this.#renderEditSettings() : nothing}
        ${
          writable && s.enabled && !this.editSettings
            ? html`<wt-button
                  variant="secondary"
                  data-test="edit-settings"
                  @click=${() => void this.#startEdit()}
                  >${t("backup.edit.button")}</wt-button
                >
                ${this.#renderRotate()}`
            : nothing
        }
      </div>
    `;
  }

  #renderStatus(s: BackupStatusView): TemplateResult {
    return html`
      <dl class="status" data-test="status">
        <dt>${t("backup.status.state")}</dt>
        <dd>
          ${
            s.enabled
              ? html`<span class="on">${t("backup.status.on")}</span>`
              : html`<span class="off">${t("backup.status.off")}</span>`
          }
        </dd>
        ${
          s.destinations.length > 0
            ? html`<dt>${t("backup.status.where")}</dt>
                <dd>${s.destinations.map((d) => d.dir).join(", ")}</dd>`
            : nothing
        }
        <dt>${t("backup.status.last")}</dt>
        <dd>${this.#renderFreshness(s)}</dd>
        ${
          s.keyFingerprint
            ? html`<dt>${t("backup.status.fingerprint")}</dt>
                <dd>${s.keyFingerprint}</dd>`
            : nothing
        }
        ${
          s.keyRotatedAt
            ? html`<dt>${t("backup.status.rotated")}</dt>
                <dd data-test="key-rotated">${new Date(s.keyRotatedAt).toLocaleString()}</dd>`
            : nothing
        }
        ${
          s.enabled
            ? html`<dt>${t("backup.status.archive_current")}</dt>
                <dd data-test="archive-current">
                  ${
                    s.archiveUnderCurrentKey
                      ? t("backup.status.archive_yes")
                      : t("backup.status.archive_no")
                  }
                </dd>`
            : nothing
        }
      </dl>
    `;
  }

  #renderFreshness(s: BackupStatusView): TemplateResult {
    if (!s.backupStatus.configured) return html`${t("backup.status.never")}`;
    const first = s.backupStatus.destinations[0];
    if (first === undefined || first.lastBackupAt === null)
      return html`${t("backup.status.never")}`;
    const when = new Date(first.lastBackupAt).toLocaleString();
    return first.stale
      ? html`${when} — <span class="stale">${t("backup.status.stale")}</span>`
      : html`${when} — ${t("backup.status.fresh")}`;
  }

  #renderDestinationField(): TemplateResult {
    return html`
      <h2>${t("backup.destination.title")}</h2>
      <wt-input
        data-test="destination"
        label=${t("backup.destination.label")}
        .value=${this.destinationDir}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onDestination(e)}
      ></wt-input>
      <p class="hint">${t("backup.destination.hint")}</p>
    `;
  }

  #renderConfigure(): TemplateResult {
    return html`
      ${this.#renderDestinationField()}

      <h2>${t("backup.key.title")}</h2>
      ${this.#renderKeyStep()}

      <h2>${t("backup.schedule.title")}</h2>
      ${this.#renderPolicy()}

      <wt-button
        variant="primary"
        data-test="apply"
        ?disabled=${this.#applyDisabled}
        @click=${() => void this.#apply()}
        >${t("backup.apply")}</wt-button
      >
    `;
  }

  #renderEditSettings(): TemplateResult {
    return html`
      <h2 data-test="edit-title">${t("backup.edit.title")}</h2>
      ${this.#renderDestinationField()}

      <h2>${t("backup.schedule.title")}</h2>
      ${this.#renderPolicy()}

      <div class="key-actions">
        <wt-button
          variant="primary"
          data-test="save-settings"
          ?disabled=${this.#saveSettingsDisabled}
          @click=${() => void this.#saveSettings()}
          >${t("backup.edit.save")}</wt-button
        >
        <wt-button variant="ghost" data-test="cancel-edit" @click=${() => this.#cancelEdit()}
          >${t("backup.edit.cancel")}</wt-button
        >
      </div>
    `;
  }

  #renderKeyStep(): TemplateResult {
    return html`
      ${
        this.advancedPaste
          ? html`<label class="field">
                <span class="field-label">${t("backup.key.paste_label")}</span>
                <wt-input
                  data-test="paste-key"
                  .value=${this.pastedKey}
                  @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onPaste(e)}
                ></wt-input>
              </label>
              <p class="hint">${t("backup.key.paste_hint")}</p>`
          : this.mintedKey
            ? html`<p class="hint">${t("backup.key.minted_note")}</p>
                <p class="key" data-test="minted-key">${this.mintedKey}</p>
                <div class="key-actions">
                  <wt-button
                    variant="secondary"
                    data-test="copy-key"
                    @click=${() => this.#copy(this.mintedKey ?? "")}
                    >${t("backup.key.copy")}</wt-button
                  >
                  <a
                    class="download"
                    data-test="download-key"
                    download=${this.#keyFileName(this.mintedKey)}
                    href=${this.#downloadHref(this.mintedKey)}
                    >${t("backup.key.download")}</a
                  >
                </div>`
            : nothing
      }
      <wt-button
        variant="ghost"
        data-test="advanced-toggle"
        @click=${() => {
          this.advancedPaste = !this.advancedPaste;
          this.savedIt = false;
        }}
        >${t(this.advancedPaste ? "backup.key.use_minted" : "backup.key.advanced")}</wt-button
      >
      <label class="checkbox">
        <input
          type="checkbox"
          data-test="saved-it"
          .checked=${this.savedIt}
          @change=${(e: Event) => (this.savedIt = (e.target as HTMLInputElement).checked)}
        />
        ${t("backup.saved_it")}
      </label>
    `;
  }

  #renderPolicy(): TemplateResult {
    return html`
      <label class="field">
        <span class="field-label">${t("backup.schedule.days")}</span>
        <select
          data-test="days-mode"
          @change=${(e: Event) =>
            (this.daysMode = (e.target as HTMLSelectElement).value as "daily" | "weekdays")}
        >
          <option value="daily" ?selected=${this.daysMode === "daily"}>
            ${t("backup.schedule.days_daily")}
          </option>
          <option value="weekdays" ?selected=${this.daysMode === "weekdays"}>
            ${t("backup.schedule.days_pick")}
          </option>
        </select>
      </label>
      ${
        this.daysMode === "weekdays"
          ? html`<div class="weekdays">
              ${WEEKDAYS.map(
                (d) =>
                  html`<label class="checkbox">
                    <input
                      type="checkbox"
                      data-test="weekday-${d.n}"
                      .checked=${this.weekdays.includes(d.n)}
                      @change=${() => this.#toggleWeekday(d.n)}
                    />
                    ${t(d.labelKey)}
                  </label>`,
              )}
            </div>`
          : nothing
      }

      <label class="field">
        <span class="field-label">${t("backup.schedule.time")}</span>
        <select
          data-test="time-mode"
          @change=${(e: Event) =>
            (this.timeMode = (e.target as HTMLSelectElement).value as "auto" | "fixed")}
        >
          <option value="auto" ?selected=${this.timeMode === "auto"}>
            ${t("backup.schedule.time_auto")}
          </option>
          <option value="fixed" ?selected=${this.timeMode === "fixed"}>
            ${t("backup.schedule.time_fixed")}
          </option>
        </select>
      </label>
      ${
        this.timeMode === "fixed"
          ? html`<label class="field">
              <span class="field-label">${t("backup.schedule.at")}</span>
              <input
                type="time"
                data-test="at-time"
                .value=${this.atTime}
                @input=${(e: Event) => (this.atTime = (e.target as HTMLInputElement).value)}
              />
            </label>`
          : nothing
      }

      <label class="field">
        <span class="field-label">${t("backup.retention.count")}</span>
        <input
          type="number"
          min="1"
          data-test="retain-count"
          .value=${String(this.retainCount)}
          @input=${(e: Event) => (this.retainCount = Number((e.target as HTMLInputElement).value))}
        />
      </label>
      <label class="field">
        <span class="field-label">${t("backup.retention.days")}</span>
        <input
          type="number"
          min="1"
          data-test="retain-days"
          .value=${String(this.retainDays)}
          @input=${(e: Event) => (this.retainDays = Number((e.target as HTMLInputElement).value))}
        />
      </label>
    `;
  }

  #renderRotate(): TemplateResult {
    return html`
      <h2 data-test="rotate">${t("backup.rotate.title")}</h2>
      <p class="warning" data-test="rotate-warning" role="note">${t("backup.rotate.warning")}</p>
      <div class="key-actions">
        <wt-button
          variant="secondary"
          data-test="show-old-key"
          @click=${() => void this.#showOldKey()}
          >${t("backup.rotate.show_old")}</wt-button
        >
      </div>
      ${
        this.oldKey !== null
          ? html`<p class="field-label">${t("backup.rotate.old_label")}</p>
              <p class="key" data-test="old-key">${this.oldKey}</p>
              <div class="key-actions">
                <wt-button
                  variant="secondary"
                  data-test="copy-old-key"
                  @click=${() => this.#copy(this.oldKey ?? "")}
                  >${t("backup.key.copy")}</wt-button
                >
                <a
                  class="download"
                  data-test="download-old-key"
                  download=${this.#keyFileName(this.oldKey)}
                  href=${this.#downloadHref(this.oldKey)}
                  >${t("backup.key.download")}</a
                >
              </div>`
          : nothing
      }

      <h2>${t("backup.rotate.new_title")}</h2>
      ${this.#renderKeyStep()}

      <wt-button
        variant="primary"
        data-test="rotate-confirm"
        ?disabled=${this.#rotateDisabled}
        @click=${() => void this.#rotate()}
        >${t("backup.rotate.confirm")}</wt-button
      >
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-backup-screen": BackupScreen;
  }
}
