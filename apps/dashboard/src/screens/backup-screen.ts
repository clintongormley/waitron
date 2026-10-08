import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  leaveCoordinatorFor,
  saveActionState,
  type DraftScope,
  type LeaveCoordinator,
} from "@waitron/ui";
import { sameValue } from "../widgets/product-editor-model.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-number-stepper.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import "./stream-settings-panel.js";
import type {
  BackupApplyBody,
  BackupSchedule,
  BackupStatusView,
  DashboardApi,
} from "../api/client.js";

/** Mirrors the server's `MIN_PASSPHRASE_LENGTH` (`apps/server/src/recovery-bundle.ts`) for fast
 * feedback on a PASTED key; the server stays the authority. */
const MIN_KEY_LENGTH = 12;

interface ArchiveDraft {
  mode: "configure" | "settings" | "rotate";
  destinationDir: string;
  daysMode: "daily" | "weekdays";
  weekdays: number[];
  timeMode: "auto" | "fixed";
  atTime: string;
  retainCount: string;
  retainDays: string;
  pastedKey: string;
  advancedPaste: boolean;
}
interface ExportDraft {
  passphrase: string;
  confirm: string;
}

function archivePayload(value: ArchiveDraft): unknown {
  const pastedKey = value.advancedPaste ? value.pastedKey : "";
  if (value.mode === "rotate") return { pastedKey };
  return {
    destinationDir: value.destinationDir.trim(),
    days: value.daysMode === "daily" ? "daily" : [...value.weekdays].sort((a, b) => a - b),
    at: value.timeMode === "auto" ? "auto" : value.atTime,
    count: parseRetention(value.retainCount) ?? value.retainCount,
    daysRetained: parseRetention(value.retainDays) ?? value.retainDays,
    ...(value.mode === "configure" ? { pastedKey } : {}),
  };
}

/** A box's text as the number `Number()` reads from it, when that is a safe integer above 0
 * (so `7.0` is 7 and `1e2` is 100); `null` for a blank box and for anything else. */
function parseRetention(text: string): number | null {
  const n = Number(text);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const decreaseLabel = (label: string) => t("action.decrease").replace("{label}", label);
const increaseLabel = (label: string) => t("action.increase").replace("{label}", label);

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
        font-family: var(--wt-font-family-mono);
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
      this.refreshErrorKey = codeOf(error);
    },
  );

  @state() private status?: BackupStatusView;
  @state() private errorKey: string | null = null;
  /** Kept apart from `errorKey` so a later good read clears its own failure and never an action's. */
  @state() private refreshErrorKey: string | null = null;

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
  @state() private retainCount = "7";
  @state() private retainDays = "30";
  @state() private policyAttempted = false;
  /** The server refused the retention the boxes hold, and neither box has changed since. */
  @state() private retentionRefused = false;

  @state() private submitting = false;
  @state() private configurationPassphrase = "";
  @state() private configurationConfirm = "";
  @state() private configurationPassphraseVisible = false;
  @state() private configurationConfirmVisible = false;
  @state() private configurationAttempted = false;
  @state() private configurationRequestFailed = false;
  @state() private exportingConfiguration = false;

  @state() private oldKey: string | null = null;

  @state() private editSettings = false;
  @state() private configureAfterApply = false;
  #configureUsesHeldKey = false;
  /** Fetched on entering edit mode so a settings change re-applies under the SAME key. Held off the
   * reactive state so it is never rendered. */
  #reuseKey: string | null = null;
  /** The stored policy is one the form cannot write, so the editor shows defaults in its place and
   * saving it as shown changes the box. */
  #policyReplaced = false;
  /** The status watcher asks for a key at most once, so a failing mint is not retried on every
   * refresh: the mint is a POST, and a POST is never passive session activity. */
  #watcherAsked = false;
  /** Every key request goes through `#mint`, and a second asker waits for the one in flight, so two
   * answers never race to set the shown key. */
  #minting: Promise<void> | null = null;

  /** Stable per instance, so re-renders do not shift the downloaded key file's name. */
  readonly #stamp = new Date().toISOString();
  readonly #fileStamp = this.#stamp.replace(/[:.]/g, "-");

  /** Keyed by the key text so a re-render reuses the URL rather than leaking a fresh one. */
  #blobUrls = new Map<string, string>();
  #leave?: LeaveCoordinator;
  #archiveScope?: DraftScope<ArchiveDraft>;
  #archiveMode?: ArchiveDraft["mode"];
  #exportScope?: DraftScope<ExportDraft>;
  readonly #exportOwner = {};
  #generation = 0;

  #archiveValue(): ArchiveDraft {
    return {
      mode: this.editSettings
        ? "settings"
        : this.configureAfterApply || !this.status?.enabled
          ? "configure"
          : "rotate",
      destinationDir: this.destinationDir,
      daysMode: this.daysMode,
      weekdays: [...this.weekdays],
      timeMode: this.timeMode,
      atTime: this.atTime,
      retainCount: this.retainCount,
      retainDays: this.retainDays,
      pastedKey: this.pastedKey,
      advancedPaste: this.advancedPaste,
    };
  }

  #exportValue(): ExportDraft {
    return { passphrase: this.configurationPassphrase, confirm: this.configurationConfirm };
  }

  #trackArchive(): void {
    if (!this.isConnected) return;
    const mode = this.#archiveValue().mode;
    if (!this.status?.isPrimary || this.status.managedByEnvironment) {
      this.#archiveScope?.dispose();
      this.#archiveScope = undefined;
      this.#archiveMode = undefined;
      return;
    }
    if (this.#archiveMode === mode) return;
    this.#archiveScope?.dispose();
    this.#archiveMode = mode;
    this.#archiveScope = draftScopeFor<ArchiveDraft>(this, {
      id: this,
      current: () => this.#archiveValue(),
      snapshot: (value) => ({ ...value, weekdays: [...value.weekdays] }),
      equal: (a, b) => sameValue(archivePayload(a), archivePayload(b)),
      restore: (value) => {
        this.destinationDir = value.destinationDir;
        this.daysMode = value.daysMode;
        this.weekdays = [...value.weekdays];
        this.timeMode = value.timeMode;
        this.atTime = value.atTime;
        this.retainCount = value.retainCount;
        this.retainDays = value.retainDays;
        this.pastedKey = value.pastedKey;
        this.advancedPaste = value.advancedPaste;
      },
    }).scope;
  }

  protected override updated(changed: PropertyValues): void {
    this.#trackArchive();
    if (
      [
        "destinationDir",
        "daysMode",
        "weekdays",
        "timeMode",
        "atTime",
        "retainCount",
        "retainDays",
        "pastedKey",
        "advancedPaste",
      ].some((name) => changed.has(name))
    )
      this.#archiveScope?.changed();
    if (changed.has("configurationPassphrase") || changed.has("configurationConfirm"))
      this.#exportScope?.changed();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#leave = leaveCoordinatorFor(this);
    this.#exportScope = this.#leave?.register<ExportDraft>({
      id: this.#exportOwner,
      current: () => this.#exportValue(),
      snapshot: (value) => ({ ...value }),
      equal: sameValue,
      restore: (value) => {
        this.configurationPassphrase = value.passphrase;
        this.configurationConfirm = value.confirm;
      },
    });
    this.#trackArchive();
    void this.#load();
  }

  override disconnectedCallback(): void {
    this.#generation++;
    this.#archiveScope?.dispose();
    this.#archiveScope = undefined;
    this.#archiveMode = undefined;
    this.#exportScope?.dispose();
    this.#exportScope = undefined;
    this.#leave = undefined;
    this.configurationPassphrase = "";
    this.configurationConfirm = "";
    this.pastedKey = "";
    this.advancedPaste = false;
    this.savedIt = false;
    this.#reuseKey = null;
    this.editSettings = false;
    this.submitting = false;
    this.exportingConfiguration = false;
    this.configureAfterApply = false;
    this.#configureUsesHeldKey = false;
    this.mintedKey = null;
    this.oldKey = null;
    this.#watcherAsked = false;
    this.#minting = null;
    for (const url of this.#blobUrls.values()) URL.revokeObjectURL(url);
    this.#blobUrls.clear();
    super.disconnectedCallback();
  }

  async #load(): Promise<void> {
    this.refreshErrorKey = null;
    this.errorKey = null;
    try {
      await this.#queries.watch("getBackupStatus", [], async (value) => {
        if (this.#archiveMode === "configure" && this.#archiveScope?.isDirty() && value.enabled) {
          this.#configureUsesHeldKey = this.#reusesHeldKey;
          this.configureAfterApply = true;
        }
        this.status = value;
        this.refreshErrorKey = null;
        await this.#mintIfNone();
      });
    } catch (error) {
      this.refreshErrorKey = codeOf(error);
    }
  }

  /** A status read may give the screen its first key, but never replaces a key: the operator may be
   * copying the shown one, and the box would then store a key nobody saved. */
  async #mintIfNone(): Promise<void> {
    const s = this.status!;
    if (this.mintedKey !== null || this.#watcherAsked) return;
    if (!s.isPrimary || s.managedByEnvironment || this.#reusesHeldKey) return;
    this.#watcherAsked = true;
    await this.#mint();
  }

  #mint(): Promise<void> {
    const generation = this.#generation;
    this.#minting ??= this.#requestKey().finally(() => {
      if (generation === this.#generation) this.#minting = null;
    });
    return this.#minting;
  }

  async #requestKey(): Promise<void> {
    const generation = this.#generation;
    try {
      const { key } = await this.api.mintBackupKey();
      if (generation === this.#generation) this.mintedKey = key;
    } catch (error) {
      if (generation === this.#generation) this.errorKey = codeOf(error);
    }
  }

  get #effectiveKey(): string {
    return this.advancedPaste ? this.pastedKey : (this.mintedKey ?? "");
  }

  /** Archives are off but the box already holds a usable key (the bucket copy may have set it):
   * turning archives on uses that key, so the recovery kit stays valid, and the form neither makes
   * nor sends one. */
  get #reusesHeldKey(): boolean {
    return (
      (this.status?.enabled === false || this.#configureUsesHeldKey) &&
      this.status !== undefined &&
      this.status.recoveryKeySet &&
      !this.status.recoveryKeyTooShort
    );
  }

  get #retentionInvalid(): boolean {
    return parseRetention(this.retainCount) === null || parseRetention(this.retainDays) === null;
  }

  get #policyHeld(): boolean {
    return this.policyAttempted && this.#retentionInvalid;
  }

  get #applyDisabled(): boolean {
    if (this.#reusesHeldKey)
      return this.submitting || this.destinationDir.trim() === "" || this.#policyHeld;
    return (
      this.submitting ||
      this.#policyHeld ||
      !this.savedIt ||
      this.destinationDir.trim() === "" ||
      this.#effectiveKey === ""
    );
  }

  get #rotateWaiting(): boolean {
    // The OLD key must be re-shown first: rotating overwrites it, so the operator has to have had the
    // chance to record it.
    return !this.savedIt || this.#effectiveKey === "" || this.oldKey === null;
  }

  get #rotateDisabled(): boolean {
    return this.submitting || this.#rotateWaiting;
  }

  get #saveSettingsDisabled(): boolean {
    return (
      this.submitting ||
      this.destinationDir.trim() === "" ||
      this.#reuseKey === null ||
      this.#policyHeld
    );
  }

  /** Marks the policy as submitted; `false` when a retention box fails the form's own check. */
  #checkPolicy(): boolean {
    this.policyAttempted = true;
    this.retentionRefused = false;
    if (!this.#retentionInvalid) return true;
    this.#focusFirstInvalidBox();
    return false;
  }

  #focusFirstInvalidBox(): void {
    void this.updateComplete.then(() => {
      const form = this.shadowRoot!.querySelector<HTMLElement>("#backup-body");
      if (form) void focusFirstInvalid(form);
    });
  }

  #retention(): { count: number; days: number } {
    return { count: parseRetention(this.retainCount)!, days: parseRetention(this.retainDays)! };
  }

  #onApplyRefused(error: unknown): void {
    const code = codeOf(error);
    const field = (error as { params?: { field?: unknown } } | null)?.params?.field;
    if (code === "backup.request_invalid" && field === "retention") {
      this.retentionRefused = true;
      this.#focusFirstInvalidBox();
    } else this.errorKey = code;
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
    const sendsKey = !this.#reusesHeldKey;
    if (saveActionState(this.#archiveScope).unchanged) return;
    if (this.#applyDisabled || (sendsKey && this.#pastedKeyTooShort())) return;
    if (!this.#checkPolicy()) return;
    this.errorKey = null;
    this.refreshErrorKey = null;
    this.submitting = true;
    const body: BackupApplyBody = {
      destinationDir: this.destinationDir.trim(),
      ...(sendsKey ? { recoveryKey: this.#effectiveKey } : {}),
      schedule: this.#buildSchedule(),
      retention: this.#retention(),
    };
    const submitted = this.#archiveValue();
    const generation = this.#generation;
    const scope = this.#archiveScope;
    try {
      const status = await this.api.applyBackup(body);
      if (generation !== this.#generation) return;
      scope?.commit(submitted);
      this.configureAfterApply = scope?.isDirty() ?? false;
      this.#configureUsesHeldKey = this.configureAfterApply && !sendsKey;
      this.status = status;
      // The bucket copy's panel reads the same key.
      if (sendsKey) this.api.liveData.invalidate([{ type: "backup_status" }]);
      this.savedIt = false;
      if (!this.configureAfterApply) {
        this.advancedPaste = false;
        this.pastedKey = "";
        await this.#mint();
      }
    } catch (error) {
      if (generation === this.#generation) this.#onApplyRefused(error);
    } finally {
      if (generation === this.#generation) this.submitting = false;
    }
  }

  async #rotate(): Promise<void> {
    if (this.#rotateDisabled || this.#pastedKeyTooShort()) return;
    this.errorKey = null;
    this.refreshErrorKey = null;
    this.submitting = true;
    const submitted = this.#archiveValue();
    const generation = this.#generation;
    const scope = this.#archiveScope;
    try {
      const status = await this.api.rotateBackupKey({ recoveryKey: this.#effectiveKey });
      if (generation !== this.#generation) return;
      this.status = status;
      scope?.commit(submitted);
      // The bucket copy's kit carries the key, so its panel has to read the new one now.
      this.api.liveData.invalidate([{ type: "backup_status" }]);
      this.savedIt = false;
      if (!scope?.isDirty()) {
        this.advancedPaste = false;
        this.pastedKey = "";
        scope?.commit(this.#archiveValue());
      }
      this.oldKey = null;
      await this.#mint();
    } catch (error) {
      if (generation === this.#generation) this.errorKey = codeOf(error);
    } finally {
      if (generation === this.#generation) this.submitting = false;
    }
  }

  async #showOldKey(): Promise<void> {
    const generation = this.#generation;
    this.errorKey = null;
    try {
      const { key } = await this.api.getBackupRecoveryKey();
      if (generation === this.#generation) this.oldKey = key;
    } catch (error) {
      if (generation === this.#generation) this.errorKey = codeOf(error);
    }
  }

  async #startEdit(): Promise<void> {
    const generation = this.#generation;
    if (
      this.#leave &&
      (await this.#leave.request({ scopes: [this], reason: "navigation", proceed() {} })) !==
        "proceeded"
    )
      return;
    if (generation === this.#generation) await this.#openSettings();
  }

  async #openSettings(): Promise<void> {
    const generation = this.#generation;
    const opening = archivePayload(this.#archiveValue());
    this.errorKey = null;
    try {
      const { key } = await this.api.getBackupRecoveryKey();
      if (
        generation !== this.#generation ||
        !sameValue(opening, archivePayload(this.#archiveValue()))
      )
        return;
      if (key === null) {
        this.errorKey = "backup.recovery_key_missing";
        return;
      }
      this.#reuseKey = key;
      this.policyAttempted = false;
      this.retentionRefused = false;
      if (this.status) this.#prefillFromStatus(this.status);
      this.editSettings = true;
    } catch (error) {
      if (generation === this.#generation) this.errorKey = codeOf(error);
    }
  }

  async #saveSettings(): Promise<void> {
    if (this.#settingsAction().unchanged) return;
    if (this.#saveSettingsDisabled || this.#reuseKey === null) return;
    if (!this.#checkPolicy()) return;
    this.errorKey = null;
    this.refreshErrorKey = null;
    this.submitting = true;
    const body: BackupApplyBody = {
      destinationDir: this.destinationDir.trim(),
      recoveryKey: this.#reuseKey,
      schedule: this.#buildSchedule(),
      retention: this.#retention(),
    };
    const submitted = this.#archiveValue();
    const generation = this.#generation;
    const scope = this.#archiveScope;
    try {
      const status = await this.api.applyBackup(body);
      if (generation !== this.#generation) return;
      this.status = status;
      scope?.commit(submitted);
      this.#policyReplaced = false;
      if (!scope?.isDirty()) {
        this.editSettings = false;
        this.#reuseKey = null;
      }
    } catch (error) {
      if (generation === this.#generation) this.#onApplyRefused(error);
    } finally {
      if (generation === this.#generation) this.submitting = false;
    }
  }

  #cancelEdit(): void {
    const proceed = () => {
      this.editSettings = false;
      this.#reuseKey = null;
      this.errorKey = null;
    };
    if (this.#leave) void this.#leave.request({ scopes: [this], reason: "cancel", proceed });
    else proceed();
  }

  /** A non-`wall-clock` running schedule (the box-image `interval` form the UI cannot author) leaves
   * the schedule controls at their defaults. */
  #prefillFromStatus(s: BackupStatusView): void {
    this.#policyReplaced = s.schedule?.kind !== "wall-clock" || !s.retention;
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
      this.retainCount = String(s.retention.count);
      this.retainDays = String(s.retention.days);
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

  #configurationFieldError(): string | null {
    if (this.configurationPassphrase.length < MIN_KEY_LENGTH)
      return t("backup.configuration.passphrase_error");
    if (this.configurationPassphrase !== this.configurationConfirm)
      return t("backup.configuration.match_error");
    return null;
  }

  async #exportConfiguration(): Promise<void> {
    if (this.exportingConfiguration) return;
    this.configurationRequestFailed = false;
    this.configurationAttempted = true;
    if (this.#configurationFieldError() !== null) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    this.exportingConfiguration = true;
    const submitted = this.#exportValue();
    const generation = this.#generation;
    const scope = this.#exportScope;
    try {
      const artifact = await this.api.exportConfiguration(submitted.passphrase);
      if (generation !== this.#generation) return;
      const url = URL.createObjectURL(artifact);
      const download = document.createElement("a");
      download.href = url;
      download.download = `waitron-configuration-${this.#fileStamp}.enc`;
      download.click();
      URL.revokeObjectURL(url);
      if (this.configurationPassphrase === submitted.passphrase) this.configurationPassphrase = "";
      if (this.configurationConfirm === submitted.confirm) this.configurationConfirm = "";
      scope?.commit({ passphrase: "", confirm: "" });
      this.configurationAttempted = false;
    } catch {
      if (generation === this.#generation) this.configurationRequestFailed = true;
    } finally {
      if (generation === this.#generation) this.exportingConfiguration = false;
    }
  }

  #toggleWeekday(n: number): void {
    this.weekdays = this.weekdays.includes(n)
      ? this.weekdays.filter((d) => d !== n)
      : [...this.weekdays, n];
  }

  override render(): TemplateResult {
    const s = this.status;
    const alertKey = this.errorKey ?? this.refreshErrorKey;
    return html`
      <h1 class="title">${t("backup.title")}</h1>
      ${this.#renderConfigurationExport()} ${s === undefined ? nothing : this.#renderBody(s)}
      ${alertKey ? html`<p class="error" role="alert">${codeMessage(alertKey)}</p>` : nothing}
      <div class="card">
        <dashboard-stream-settings
          .api=${this.api}
          .managedByEnvironment=${s?.managedByEnvironment}
        ></dashboard-stream-settings>
      </div>
    `;
  }

  #renderConfigurationExport(): TemplateResult {
    const fieldMessage = this.configurationAttempted ? this.#configurationFieldError() : null;
    const bottom = [
      ...(this.configurationRequestFailed ? [t("backup.configuration.request_error")] : []),
      ...(fieldMessage === null ? [] : [t("form.fix_fields")]),
    ].join(" ");
    return html`
      <section class="card" aria-labelledby="configuration-export-title">
        <h2 id="configuration-export-title">${t("backup.configuration.title")}</h2>
        <p class="hint">${t("backup.configuration.explanation")}</p>
        <wt-input
          data-test="configuration-passphrase"
          name="configuration-passphrase"
          type=${this.configurationPassphraseVisible ? "text" : "password"}
          autocomplete="new-password"
          required
          error=${fieldMessage ?? ""}
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
        <wt-input
          data-test="configuration-confirm"
          name="configuration-passphrase-confirmation"
          type=${this.configurationConfirmVisible ? "text" : "password"}
          autocomplete="new-password"
          required
          error=${fieldMessage ?? ""}
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
        <wt-form-actions data-test="configuration-actions" .error=${bottom}>
          <wt-button
            variant="primary"
            data-test="configuration-export"
            ?disabled=${this.exportingConfiguration || fieldMessage !== null}
            @click=${() => void this.#exportConfiguration()}
            >${t("backup.configuration.download")}</wt-button
          >
        </wt-form-actions>
      </section>
    `;
  }

  #renderBody(s: BackupStatusView): TemplateResult {
    const writable = s.isPrimary && !s.managedByEnvironment;
    return html`
      <div class="card" id="backup-body">
        ${this.#renderStatus(s)}
        ${
          s.managedByEnvironment
            ? html`<p class="hint" data-test="managed">${t("backup.status.managed")}</p>`
            : !s.isPrimary
              ? html`<p class="hint" data-test="not-primary">${t("backup.status.not_primary")}</p>`
              : nothing
        }
        ${writable && (!s.enabled || this.configureAfterApply) ? this.#renderConfigure() : nothing}
        ${writable && s.enabled && this.editSettings ? this.#renderEditSettings() : nothing}
        ${
          writable && s.enabled && !this.editSettings && !this.configureAfterApply
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
                <dd data-test="key-rotated">
                  ${new Date(s.keyRotatedAt).toLocaleString(currentLocale())}
                </dd>`
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
    const when = new Date(first.lastBackupAt).toLocaleString(currentLocale());
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
    const s = saveActionState(this.#archiveScope);
    return html`
      ${this.#renderDestinationField()}

      <h2>${t("backup.key.title")}</h2>
      ${
        this.status?.recoveryKeyTooShort
          ? html`<p class="hint" data-test="short-key">${t("backup.key.too_short")}</p>`
          : nothing
      }
      ${
        this.#reusesHeldKey
          ? html`<p class="hint" data-test="existing-key">${t("backup.key.existing")}</p>`
          : this.#renderKeyStep()
      }

      <h2>${t("backup.schedule.title")}</h2>
      ${this.#renderPolicy()}

      <wt-form-actions data-test="apply-actions" .error=${this.#policyBottom()}>
        <wt-button
          variant=${s.variant}
          data-test="apply"
          ?disabled=${s.unchanged || this.#applyDisabled}
          @click=${() => void this.#apply()}
          >${t("backup.apply")}</wt-button
        >
      </wt-form-actions>
    `;
  }

  #settingsAction() {
    return saveActionState(this.#archiveScope, { savableAtOpen: this.#policyReplaced });
  }

  #renderEditSettings(): TemplateResult {
    const s = this.#settingsAction();
    return html`
      <h2 data-test="edit-title">${t("backup.edit.title")}</h2>
      ${this.#renderDestinationField()}

      <h2>${t("backup.schedule.title")}</h2>
      ${this.#renderPolicy()}

      <wt-form-actions data-test="settings-actions" .error=${this.#policyBottom()}>
        <wt-button
          slot="cancel"
          variant="ghost"
          data-test="cancel-edit"
          @click=${() => this.#cancelEdit()}
          >${t("backup.edit.cancel")}</wt-button
        >
        <wt-button
          variant=${s.variant}
          data-test="save-settings"
          ?disabled=${s.unchanged || this.#saveSettingsDisabled}
          @click=${() => void this.#saveSettings()}
          >${t("backup.edit.save")}</wt-button
        >
      </wt-form-actions>
    `;
  }

  #renderKeyStep(): TemplateResult {
    return html`
      ${
        this.advancedPaste
          ? html`<wt-input
                data-test="paste-key"
                name="recovery-key"
                label=${t("backup.key.paste_label")}
                .value=${this.pastedKey}
                @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onPaste(e)}
              ></wt-input>
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
      <wt-combobox
        data-test="days-mode"
        name="days-mode"
        search="auto"
        label=${t("backup.schedule.days")}
        .options=${[
          { value: "daily", label: t("backup.schedule.days_daily") },
          { value: "weekdays", label: t("backup.schedule.days_pick") },
        ]}
        .value=${this.daysMode}
        @wt-change=${(e: CustomEvent<{ value: string }>) =>
          (this.daysMode = e.detail.value as "daily" | "weekdays")}
      ></wt-combobox>
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

      <wt-combobox
        data-test="time-mode"
        name="time-mode"
        search="auto"
        label=${t("backup.schedule.time")}
        .options=${[
          { value: "auto", label: t("backup.schedule.time_auto") },
          { value: "fixed", label: t("backup.schedule.time_fixed") },
        ]}
        .value=${this.timeMode}
        @wt-change=${(e: CustomEvent<{ value: string }>) =>
          (this.timeMode = e.detail.value as "auto" | "fixed")}
      ></wt-combobox>
      ${
        this.timeMode === "fixed"
          ? html`<wt-input
              type="time"
              data-test="at-time"
              name="at-time"
              label=${t("backup.schedule.at")}
              .value=${this.atTime}
              @wt-change=${(e: CustomEvent<{ value: string }>) => (this.atTime = e.detail.value)}
            ></wt-input>`
          : nothing
      }
      ${this.#renderRetentionBox("count")} ${this.#renderRetentionBox("days")}
    `;
  }

  #retentionMessage(text: string): string | null {
    const invalid = this.policyAttempted && parseRetention(text) === null;
    return invalid || this.retentionRefused ? t("backup.retention_invalid") : null;
  }

  #policyBottom(): string {
    return this.#policyHeld || this.retentionRefused ? t("form.fix_fields") : "";
  }

  #renderRetentionBox(box: "count" | "days"): TemplateResult {
    const text = box === "count" ? this.retainCount : this.retainDays;
    const message = this.#retentionMessage(text);
    return html`
      <wt-number-stepper
        name="retention-${box}"
        data-test="retain-${box}"
        label=${t(`backup.retention.${box}`)}
        required
        .min=${1}
        .decreaseLabel=${decreaseLabel}
        .increaseLabel=${increaseLabel}
        .value=${text}
        .error=${message ?? ""}
        @wt-change=${(e: CustomEvent<{ value: string }>) => {
          if (box === "count") this.retainCount = e.detail.value;
          else this.retainDays = e.detail.value;
          this.retentionRefused = false;
        }}
      ></wt-number-stepper>
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
        variant=${this.submitting || !this.#rotateWaiting ? "primary" : "secondary"}
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
