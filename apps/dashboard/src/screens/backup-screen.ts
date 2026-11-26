import { guideHref } from "../help-guide.js";
import {
  BUCKET_FIELDS,
  missingBucketField,
  renderBucketField,
  revealIcon,
  type BucketFieldRow,
} from "./backup-bucket-fields.js";
import { dashboardQuery } from "../api/live-queries.js";
import { QueryController, hasCodeMessage } from "@waitron/dashboard-kit";
import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { isPlainWebAddress } from "@waitron/shared";
import {
  baseStyles,
  bottomMessage,
  pageTitleStyles,
  draftScopeFor,
  FormFeedback,
  leaveCoordinatorFor,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
} from "@waitron/ui";
import { sameValue } from "../widgets/product-editor-model.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-number-stepper.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { alertMessage } from "../i18n/alerts.js";
import "./stream-settings-panel.js";
import "./recovery-pack-card.js";
import "../widgets/backup-settings-evidence.js";
import type { DashboardApi } from "../api/client.js";
import type {
  BackupApplyBody,
  BackupDestinationStatus,
  BackupDestinationView,
  BackupSchedule,
  BackupStatusView,
  BackupWriteAnswer,
} from "../api/backup-api.js";
import {
  EMPTY_CUSTOM,
  destinationsBody,
  hasUnusableFolder,
  heldBucket,
  keepsHeldSecret,
  openingDestinations,
  streamLocation,
  type BucketChoice,
  type CustomBucket,
} from "./backup-destination-model.js";

/** Mirrors the configuration export route's floor (`apps/server/src/configuration-export-api.ts`);
 * the server stays the authority. */
const MIN_PASSPHRASE_LENGTH = 12;

interface ArchiveDraft {
  mode: "configure" | "settings";
  cloudOn: boolean;
  folderOn: boolean;
  bucket: BucketChoice;
  folder: string;
  custom: CustomBucket;
  daysMode: "daily" | "weekdays";
  weekdays: number[];
  timeMode: "auto" | "fixed";
  atTime: string;
  retainCount: string;
  retainDays: string;
}
type FormFields = Omit<ArchiveDraft, "mode">;
interface ExportDraft {
  passphrase: string;
  confirm: string;
}

function archivePayload(value: ArchiveDraft): unknown {
  return {
    cloud: value.cloudOn,
    destinations: destinationsBody(value.folderOn, value.folder, value.bucket, value.custom),
    days: value.daysMode === "daily" ? "daily" : [...value.weekdays].sort((a, b) => a - b),
    at: value.timeMode === "auto" ? "auto" : value.atTime,
    count: parseRetention(value.retainCount) ?? value.retainCount,
    daysRetained: parseRetention(value.retainDays) ?? value.retainDays,
  };
}

/** A box's text as the number `Number()` reads from it, when that is a safe integer above 0
 * (so `7.0` is 7 and `1e2` is 100); `null` for a blank box and for anything else. */
function parseRetention(text: string): number | null {
  const n = Number(text);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Refusals that name nothing the form shows a field for: they go in the form's bottom message. */
const FORM_REFUSALS = new Set([
  "backup.stream_not_configured",
  "backup.archive_namespace_overlap",
  "backup.archive_test_failed",
  "backup.stream_settings_unreadable",
]);

type CustomField = keyof CustomBucket;

const isCustomField = (value: unknown): value is CustomField =>
  BUCKET_FIELDS.some((f) => f.field === value);

/** Only a probe reason with a sentence of its own is shown, never the param's own text. */
const TEST_REASON_KEYS: Readonly<Record<string, Parameters<typeof t>[0]>> = {
  timed_out: "backup.archive_test.timed_out",
  read_mismatch: "backup.archive_test.read_mismatch",
  not_listed: "backup.archive_test.not_listed",
};

const decreaseLabel = (label: string) => fill("action.decrease", { label });
const increaseLabel = (label: string) => fill("action.increase", { label });

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
    pageTitleStyles,
    css`
      :host {
        display: block;
      }
      .secret-toggle svg {
        display: block;
        width: var(--wt-font-size-lg);
        height: var(--wt-font-size-lg);
        fill: none;
        stroke: currentColor;
      }
      .title {
        margin: 0 0 var(--wt-space-4);
        color: var(--wt-color-text);
      }
      h2 {
        margin: var(--wt-space-6) 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text);
      }
      .card,
      .form {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }
      .card {
        max-width: var(--wt-form-max-width);
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
        color: var(--wt-color-primary-text);
        font-weight: var(--wt-font-weight-bold);
      }
      .off,
      .stale {
        color: var(--wt-color-danger);
      }
      .status > div {
        display: contents;
      }
      .line {
        display: block;
      }
      .evidence-open {
        display: inline-block;
        margin-top: var(--wt-space-2);
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
      .location {
        display: block;
        color: var(--wt-color-text);
        overflow-wrap: anywhere;
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
      .turn-off-actions {
        display: flex;
        gap: var(--wt-space-2);
        align-items: center;
        flex-wrap: wrap;
      }
      .guide {
        color: var(--wt-color-primary-text);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property({ type: Boolean }) canManage = false;
  /** The server serves the configuration export only on a box in preparation or live. */
  @property({ attribute: false }) onboardingIntent?: "demo" | "prepare" | "live";
  readonly #queries = new QueryController(
    this,
    () => this.api.liveData,
    (error) => {
      this.refreshErrorKey = codeOf(error);
    },
  );
  /** Counts write answers taken, so a status read that began before one cannot replace it. */
  #writeAnswers = 0;

  @state() private status?: BackupStatusView;
  @state() private errorKey: string | null = null;
  /** Kept apart from `errorKey` so a later good read clears its own failure and never an action's. */
  @state() private refreshErrorKey: string | null = null;

  // The configure and settings forms share this draft: only ONE of them renders at a time.
  @state() private cloudOn = false;
  @state() private cloudRefused: "cloud" | "schedule" | null = null;
  @state() private folderOn = true;
  @state() private bucket: BucketChoice = "none";
  @state() private folder = "";
  /** The server refused the folder, and it has not changed since. */
  @state() private folderRefused = false;
  @state() private folderRefusalReason = "";
  @state() private folderScratchRoot = "";
  /** Another bucket's fields. The secret lives in memory only, and is cleared once saved. */
  @state() private custom: CustomBucket = { ...EMPTY_CUSTOM };
  /** The bucket field the server refused, until that field changes. */
  @state() private customRefused: CustomField | null = null;
  @state() private secretSentRefused = false;
  /** The server refused to keep the saved secret for this place. */
  @state() private secretDemanded = false;
  @state() private secretVisible = false;
  /** A refusal naming no field the form shows, for the bottom message until the next submission;
   * `sentence` replaces the code's own message. */
  @state() private formRefusal: {
    code: string;
    reason: string | null;
    sentence?: Parameters<typeof t>[0];
  } | null = null;
  /** A write stood but the box could not load it; kept until the next write. */
  @state() private reloadErrorCode: string | null = null;
  @state() private evidenceOpen = false;

  @state() private daysMode: "daily" | "weekdays" = "daily";
  @state() private weekdays: number[] = [1, 2, 3, 4, 5];
  @state() private timeMode: "auto" | "fixed" = "auto";
  @state() private atTime = "03:00";
  @state() private retainCount = "7";
  @state() private retainDays = "30";
  readonly #feedback = new FormFeedback(this);
  /** The server refused the retention the boxes hold, and neither box has changed since. */
  @state() private retentionRefused = false;

  @state() private submitting = false;
  @state() private configurationPassphrase = "";
  @state() private configurationConfirm = "";
  @state() private configurationPassphraseVisible = false;
  @state() private configurationConfirmVisible = false;
  readonly #configurationFeedback = new FormFeedback(this);
  @state() private configurationRequestFailed = false;
  @state() private exportingConfiguration = false;

  @state() private streamPermissionRefused = false;
  @state() private turnOffArmed = false;

  @state() private editSettings = false;
  /** A Turn off takes the next number, so an editor opening begun before it never opens. */
  #editOpenings = 0;
  @state() private configureAfterApply = false;
  /** The stored policy is one the form cannot write, so the editor shows defaults in its place and
   * saving it as shown changes the box. */
  #policyReplaced = false;
  readonly #fileStamp = new Date().toISOString().replace(/[:.]/g, "-");
  #leave?: LeaveCoordinator;
  #archiveScope?: DraftScope<ArchiveDraft>;
  #archiveMode?: ArchiveDraft["mode"];
  #exportScope?: DraftScope<ExportDraft>;
  readonly #exportOwner = {};
  #generation = 0;

  #archiveValue(): ArchiveDraft {
    return { mode: this.editSettings ? "settings" : "configure", ...this.#fields() };
  }

  /** Backups that are on and not being edited show no form, so there is no draft to keep. */
  get #formShown(): boolean {
    return this.editSettings || this.configureAfterApply || !this.status?.enabled;
  }

  #fields(): FormFields {
    return {
      cloudOn: this.cloudOn && (this.#cloudAvailable || this.status?.cloud === true),
      folderOn: this.folderOn,
      bucket: this.bucket,
      folder: this.folder,
      custom: { ...this.custom },
      daysMode: this.daysMode,
      weekdays: [...this.weekdays],
      timeMode: this.timeMode,
      atTime: this.atTime,
      retainCount: this.retainCount,
      retainDays: this.retainDays,
    };
  }

  #exportValue(): ExportDraft {
    return { passphrase: this.configurationPassphrase, confirm: this.configurationConfirm };
  }

  #trackArchive(): void {
    if (!this.isConnected) return;
    const mode = this.#archiveValue().mode;
    if (!this.status?.isPrimary || !this.#formShown) {
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
      // A secret is never a baseline: a saved one is held by the box, and Discard never restores one.
      snapshot: (value) => ({
        ...value,
        custom: { ...value.custom, secretAccessKey: "" },
        weekdays: [...value.weekdays],
      }),
      equal: (a, b) => sameValue(archivePayload(a), archivePayload(b)),
      restore: (value) => {
        this.cloudOn = value.cloudOn;
        this.folderOn = value.folderOn;
        this.bucket = value.bucket;
        this.folder = value.folder;
        this.custom = { ...value.custom };
        this.daysMode = value.daysMode;
        this.weekdays = [...value.weekdays];
        this.timeMode = value.timeMode;
        this.atTime = value.atTime;
        this.retainCount = value.retainCount;
        this.retainDays = value.retainDays;
      },
    }).scope;
  }

  protected override updated(changed: PropertyValues): void {
    this.#trackArchive();
    if (
      [
        "cloudOn",
        "folderOn",
        "bucket",
        "folder",
        "custom",
        "daysMode",
        "weekdays",
        "timeMode",
        "atTime",
        "retainCount",
        "retainDays",
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
    this.custom = { ...this.custom, secretAccessKey: "" };
    this.secretVisible = false;
    this.editSettings = false;
    this.submitting = false;
    this.exportingConfiguration = false;
    this.configureAfterApply = false;
    this.streamPermissionRefused = false;
    super.disconnectedCallback();
  }

  async #load(): Promise<void> {
    this.refreshErrorKey = null;
    this.errorKey = null;
    const query = dashboardQuery(this.api, "getBackupStatus", []);
    try {
      await this.#queries.watch(
        "getBackupStatus",
        {
          ...query,
          key: `${query.key}:write-stamped`,
          read: async () => {
            const writeAnswers = this.#writeAnswers;
            return { writeAnswers, value: await query.read() };
          },
        },
        async ({ writeAnswers, value }) => {
          this.refreshErrorKey = null;
          if (writeAnswers !== this.#writeAnswers) return;
          if (this.#archiveMode === "configure" && this.#archiveScope?.isDirty() && value.enabled)
            this.configureAfterApply = true;
          this.status = value;
          if (!value.enabled) this.turnOffArmed = false;
          await this.#openStoredOff(false);
        },
      );
    } catch (error) {
      this.refreshErrorKey = codeOf(error);
    }
  }

  get #retentionInvalid(): boolean {
    return parseRetention(this.retainCount) === null || parseRetention(this.retainDays) === null;
  }

  get #timeMissing(): boolean {
    return this.timeMode === "fixed" && !/^\d{2}:\d{2}/.test(this.atTime);
  }

  get #policyHeld(): boolean {
    return this.#feedback.attempted && (this.#retentionInvalid || this.#timeMissing);
  }

  get #folderMissing(): boolean {
    return this.folderOn && this.folder.trim() === "";
  }

  get #secretRequired(): boolean {
    return this.secretDemanded || !keepsHeldSecret(this.custom, heldBucket(this.status));
  }

  #customRequired(f: BucketFieldRow): boolean {
    return f.field === "secretAccessKey" ? this.#secretRequired : f.requiredKey !== undefined;
  }

  #customMissing(f: BucketFieldRow): boolean {
    return this.bucket === "custom-s3" && missingBucketField(this.custom, f, this.#secretRequired);
  }

  get #endpointInvalid(): boolean {
    const endpoint = this.custom.endpoint.trim();
    return this.bucket === "custom-s3" && endpoint !== "" && !isPlainWebAddress(endpoint);
  }

  get #cloudAvailable(): boolean {
    return this.status?.cloudBackups === "available";
  }

  get #nothingChosen(): boolean {
    return !(this.#cloudAvailable && this.cloudOn) && !this.folderOn && this.bucket === "none";
  }

  get #destinationInvalid(): boolean {
    return (
      this.#nothingChosen ||
      this.#folderMissing ||
      this.#endpointInvalid ||
      BUCKET_FIELDS.some((f) => this.#customMissing(f))
    );
  }

  get #destinationHeld(): boolean {
    return this.#feedback.attempted && this.#destinationInvalid;
  }

  get #saveDisabled(): boolean {
    return this.submitting || this.#destinationHeld || this.#policyHeld;
  }

  /** Marks the form as submitted; `false` when a field fails the form's own check. */
  #checkForm(): boolean {
    this.#feedback.press();
    this.retentionRefused = false;
    this.folderRefused = false;
    this.cloudRefused = null;
    this.customRefused = null;
    this.formRefusal = null;
    if (!this.#retentionInvalid && !this.#timeMissing && !this.#destinationInvalid) return true;
    this.#focusFirstInvalidBox();
    return false;
  }

  #focusFirstInvalidBox(): void {
    void this.updateComplete.then(() => {
      const form = this.shadowRoot!.querySelector<HTMLElement>("#backup-body");
      if (form) void this.#feedback.focus(form);
    });
  }

  #retention(): { count: number; days: number } {
    return { count: parseRetention(this.retainCount)!, days: parseRetention(this.retainDays)! };
  }

  #onApplyRefused(error: unknown, sent: BackupApplyBody["destinations"]): void {
    const code = codeOf(error);
    const custom = sent.find((d) => d.kind === "custom-s3");
    const field = (error as { params?: { field?: unknown } } | null)?.params?.field;
    if (code === "backup.cloud_needs_daily" && field === "schedule") {
      this.cloudRefused = "schedule";
      this.#focusFirstInvalidBox();
    } else if (code === "backup.cloud_unavailable" && field === "cloud" && this.#cloudAvailable) {
      this.cloudRefused = "cloud";
      void this.updateComplete.then(() =>
        this.renderRoot.querySelector<HTMLElement>("[data-test=archive-cloud]")?.focus(),
      );
    } else if (code === "backup.request_invalid") {
      // A refusal naming the folder or a custom-bucket field not shown when it answers goes to
      // the bottom message.
      if (field === "retention") {
        this.retentionRefused = true;
        this.#focusFirstInvalidBox();
      } else if (custom !== undefined && this.bucket === "custom-s3" && isCustomField(field)) {
        this.customRefused = field;
        if (field === "secretAccessKey") {
          this.secretSentRefused = custom.secretAccessKey !== undefined;
          if (!this.secretSentRefused) this.secretDemanded = true;
        }
        this.#focusFirstInvalidBox();
      } else if (field === "dir" && this.folderOn) {
        this.folderRefused = true;
        const params = (error as { params?: { reason?: unknown; scratchRoot?: unknown } }).params;
        this.folderRefusalReason = typeof params?.reason === "string" ? params.reason : "";
        this.folderScratchRoot = typeof params?.scratchRoot === "string" ? params.scratchRoot : "";
        this.#focusFirstInvalidBox();
      } else this.formRefusal = { code, reason: null };
    } else if (FORM_REFUSALS.has(code)) {
      const reason = (error as { params?: { reason?: unknown } }).params?.reason;
      this.formRefusal = { code, reason: typeof reason === "string" ? reason : null };
    } else this.formRefusal = { code, reason: null };
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

  #applyBody(): BackupApplyBody {
    return {
      destinations: destinationsBody(this.folderOn, this.folder, this.bucket, this.custom),
      ...((this.#cloudAvailable || !this.cloudOn) && this.cloudOn !== (this.status?.cloud ?? false)
        ? { cloud: this.cloudOn }
        : {}),
      schedule: this.#buildSchedule(),
      retention: this.#retention(),
    };
  }

  #afterApply(status: BackupWriteAnswer): void {
    this.custom = { ...this.custom, secretAccessKey: "" };
    this.secretVisible = false;
    this.secretDemanded = false;
    this.reloadErrorCode = status.reloadErrorCode ?? null;
  }

  async #apply(): Promise<void> {
    if (this.#applyAction().unchanged) return;
    if (this.#saveDisabled) return;
    if (!this.#checkForm()) return;
    this.errorKey = null;
    this.refreshErrorKey = null;
    this.submitting = true;
    const body = this.#applyBody();
    const submitted = this.#archiveValue();
    const generation = this.#generation;
    const scope = this.#archiveScope;
    try {
      const status = await this.api.applyBackup(body);
      if (generation !== this.#generation) return;
      this.#afterApply(status);
      scope?.commit(submitted);
      this.configureAfterApply = scope?.isDirty() ?? false;
      this.#takeWriteAnswer(status);
      if (!this.configureAfterApply) this.#feedback.reset();
    } catch (error) {
      if (generation === this.#generation) this.#onApplyRefused(error, body.destinations);
    } finally {
      if (generation === this.#generation) this.submitting = false;
    }
  }

  async #runNow(): Promise<void> {
    const status = this.status;
    if (
      !this.canManage ||
      !status?.enabled ||
      !status.isPrimary ||
      status.activeRun ||
      this.submitting
    )
      return;
    this.#disarmTurnOff();
    this.errorKey = null;
    this.refreshErrorKey = null;
    this.submitting = true;
    const generation = this.#generation;
    try {
      await this.api.runBackupNow();
    } catch (error) {
      if (generation === this.#generation) this.errorKey = codeOf(error);
    } finally {
      if (generation === this.#generation) {
        this.submitting = false;
        this.api.liveData.invalidate([{ type: "backup_status" }]);
      }
    }
  }

  async #turnOff(): Promise<void> {
    if (this.submitting) return;
    if (!this.turnOffArmed) {
      this.turnOffArmed = true;
      return;
    }
    this.errorKey = null;
    this.refreshErrorKey = null;
    this.submitting = true;
    this.#editOpenings++;
    const generation = this.#generation;
    try {
      const status = await this.api.disableBackup();
      if (generation !== this.#generation) return;
      this.reloadErrorCode = status.reloadErrorCode ?? null;
      this.#takeWriteAnswer(status);
      this.api.liveData.invalidate([{ type: "backup_status" }]);
      this.turnOffArmed = false;
      this.editSettings = false;
      this.secretVisible = false;
      await this.#openStoredOff(true);
    } catch (error) {
      if (generation !== this.#generation) return;
      this.errorKey = codeOf(error);
      this.turnOffArmed = false;
    } finally {
      if (generation === this.#generation) this.submitting = false;
    }
  }

  /** Fills the turn-on form from the switched-off stored settings, unless the form holds a change. */
  async #openStoredOff(afterTurnOff: boolean): Promise<void> {
    const generation = this.#generation;
    const s = this.status;
    if (generation !== this.#generation || s === undefined) return;
    if (!s.storedDisabled || s.enabled || !s.isPrimary) return;
    // A scope tracked for another form, or none yet, says nothing about a Turn on draft: another
    // form's baseline can read as changed though nothing was typed.
    const freshForm = afterTurnOff || this.#archiveMode !== this.#archiveValue().mode;
    if (!freshForm) {
      if (this.#archiveScope?.isDirty()) return;
      const current = this.#archiveValue();
      if (
        sameValue(archivePayload({ ...current, ...this.#fieldsFrom(s) }), archivePayload(current))
      )
        return;
    }
    this.#prefillAndCommit(s, !freshForm);
  }

  /** A refill of the Turn on form already showing keeps a switched-off folder's text when the
   * refilled folder is off too: that text never makes the draft differ, so the unchanged-draft
   * check before a refill cannot protect it. */
  #prefillAndCommit(s: BackupStatusView, keepHiddenFolder: boolean): void {
    const hidden = this.folderOn ? null : this.folder;
    this.#prefillFromStatus(s);
    this.#archiveScope?.commit(this.#archiveValue());
    if (keepHiddenFolder && hidden !== null && !this.folderOn) this.folder = hidden;
  }

  /** A write's answer is the box's state after it; a status read begun before it is taken may be
   * older, so it is dropped. */
  #takeWriteAnswer(status: BackupStatusView): void {
    this.#writeAnswers++;
    this.#packSettingsChanged();
    this.status = status;
  }

  /** A write here can put the recovery pack out of date, so its card reads its status again. */
  #packSettingsChanged(): void {
    this.renderRoot.querySelector("dashboard-recovery-pack-card")?.reload();
  }

  /** Takes back an armed turn-off, except while the turn-off's own request is out. */
  #disarmTurnOff(): void {
    if (!this.submitting) this.turnOffArmed = false;
  }

  async #startEdit(): Promise<void> {
    if (this.submitting) return;
    this.#disarmTurnOff();
    const generation = this.#generation;
    const openings = this.#editOpenings;
    if (
      this.#leave &&
      (await this.#leave.request({ scopes: [this], reason: "navigation", proceed() {} })) !==
        "proceeded"
    )
      return;
    if (generation === this.#generation && openings === this.#editOpenings) this.#openSettings();
  }

  #openSettings(): void {
    this.errorKey = null;
    this.#feedback.reset();
    this.retentionRefused = false;
    this.folderRefused = false;
    this.cloudRefused = null;
    this.customRefused = null;
    this.formRefusal = null;
    this.secretVisible = false;
    if (this.status) this.#prefillFromStatus(this.status);
    this.editSettings = true;
  }

  async #saveSettings(): Promise<void> {
    if (this.#settingsAction().unchanged) return;
    if (this.#saveDisabled) return;
    if (!this.#checkForm()) return;
    this.errorKey = null;
    this.refreshErrorKey = null;
    this.submitting = true;
    const body = this.#applyBody();
    const submitted = this.#archiveValue();
    const generation = this.#generation;
    const scope = this.#archiveScope;
    try {
      const status = await this.api.applyBackup(body);
      if (generation !== this.#generation) return;
      this.#afterApply(status);
      this.#takeWriteAnswer(status);
      scope?.commit(submitted);
      this.#policyReplaced = false;
      if (!scope?.isDirty()) {
        this.editSettings = false;
      }
    } catch (error) {
      if (generation === this.#generation) this.#onApplyRefused(error, body.destinations);
    } finally {
      if (generation === this.#generation) this.submitting = false;
    }
  }

  async #leaveSettings(reason: "cancel" | "navigation"): Promise<void> {
    const proceed = () => {
      this.editSettings = false;
      this.secretVisible = false;
      this.errorKey = null;
      this.formRefusal = null;
    };
    if (this.#leave) await this.#leave.request({ scopes: [this], reason, proceed });
    else proceed();
  }

  #prefillFromStatus(s: BackupStatusView): void {
    this.#policyReplaced = s.schedule?.kind !== "wall-clock" || !s.retention;
    this.secretDemanded = false;
    const f = this.#fieldsFrom(s);
    this.cloudOn = f.cloudOn;
    this.folderOn = f.folderOn;
    this.bucket = f.bucket;
    this.folder = f.folder;
    this.custom = f.custom;
    this.daysMode = f.daysMode;
    this.weekdays = f.weekdays;
    this.timeMode = f.timeMode;
    this.atTime = f.atTime;
    this.retainCount = f.retainCount;
    this.retainDays = f.retainDays;
  }

  /** What the form holds once filled from `s`. A non-`wall-clock` running schedule (the box-image
   * `interval` form the UI cannot author) leaves the schedule controls as they are. */
  #fieldsFrom(s: BackupStatusView): FormFields {
    const opened = openingDestinations(s);
    const fields: FormFields = {
      ...this.#fields(),
      cloudOn: s.cloud ?? false,
      folderOn: opened.folderOn,
      bucket: opened.bucket,
      folder: opened.folder,
      custom: opened.custom,
    };
    if (s.schedule?.kind === "wall-clock") {
      fields.daysMode = s.schedule.days === "daily" ? "daily" : "weekdays";
      if (Array.isArray(s.schedule.days)) fields.weekdays = [...s.schedule.days];
      if (s.schedule.at === "auto") {
        fields.timeMode = "auto";
      } else {
        fields.timeMode = "fixed";
        const pad = (n: number) => String(n).padStart(2, "0");
        fields.atTime = `${pad(s.schedule.at.hour)}:${pad(s.schedule.at.minute)}`;
      }
    }
    if (s.retention) {
      fields.retainCount = String(s.retention.count);
      fields.retainDays = String(s.retention.days);
    }
    return fields;
  }

  #submitOnEnter(event: KeyboardEvent): void {
    submitOnEnter(
      event,
      this.shadowRoot!.querySelector<HTMLElement>("[data-test=save-settings], [data-test=apply]"),
    );
  }

  #onDestination(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.folder = event.detail.value;
    this.folderRefused = false;
  }

  #configurationFieldError(): string | null {
    if (this.configurationPassphrase.length < MIN_PASSPHRASE_LENGTH)
      return t("backup.configuration.passphrase_error");
    if (this.configurationPassphrase !== this.configurationConfirm)
      return t("backup.configuration.match_error");
    return null;
  }

  async #exportConfiguration(): Promise<void> {
    if (this.exportingConfiguration) return;
    this.#disarmTurnOff();
    this.configurationRequestFailed = false;
    this.#configurationFeedback.press();
    if (this.#configurationFieldError() !== null) {
      void this.#configurationFeedback.focus(this.shadowRoot!);
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
      this.#configurationFeedback.reset();
    } catch {
      if (generation === this.#generation) this.configurationRequestFailed = true;
    } finally {
      if (generation === this.#generation) this.exportingConfiguration = false;
    }
  }

  #setDaysMode(mode: "daily" | "weekdays"): void {
    this.daysMode = mode;
    if (this.cloudRefused === "schedule") this.cloudRefused = null;
  }

  #toggleWeekday(n: number): void {
    if (this.cloudRefused === "schedule") this.cloudRefused = null;
    this.weekdays = this.weekdays.includes(n)
      ? this.weekdays.filter((d) => d !== n)
      : [...this.weekdays, n];
  }

  override render(): TemplateResult {
    const s = this.status;
    const alertKey = this.errorKey ?? this.refreshErrorKey;
    return html`
      <h1 class="title">${t("backup.title")}</h1>
      <p><a class="guide" href=${guideHref("backups.overview")}>${t("backup.guide")}</a></p>
      ${this.canManage ? html`<div class="card"><dashboard-recovery-pack-card .openRequested=${new URL(location.href).searchParams.get("recovery-pack") === "make"} .api=${this.api} .canManage=${this.canManage} @recovery-pack-make=${() => this.#disarmTurnOff()}></dashboard-recovery-pack-card></div>` : nothing}
      ${this.onboardingIntent === "prepare" || this.onboardingIntent === "live" ? this.#renderConfigurationExport() : nothing}
      ${s === undefined ? nothing : this.#renderBody(s)}
      ${alertKey ? html`<p class="error" role="alert">${codeMessage(alertKey)}</p>` : nothing}
      ${alertKey === "authorization.not_permitted" && !this.streamPermissionRefused && !this.#formNeedsAdmin ? this.#adminAction() : nothing}
      <dashboard-backup-settings-evidence
        .api=${this.api}
        .open=${this.evidenceOpen}
        @evidence-close=${() => (this.evidenceOpen = false)}
      ></dashboard-backup-settings-evidence>
      <div class="card">
        ${
          this.onboardingIntent === "demo"
            ? html`<section aria-labelledby="stream-demo-title">
                <h2 id="stream-demo-title">${t("stream.title")}</h2>
                <p class="hint" data-test="stream-demo">${t("stream.demo")}</p>
              </section>`
            : html`<dashboard-stream-settings
                  .api=${this.api}
                  @stream-permission-refused=${(event: CustomEvent<{ refused: boolean }>) => (this.streamPermissionRefused = event.detail.refused)}
                ></dashboard-stream-settings>
                ${this.streamPermissionRefused && !this.#formNeedsAdmin ? this.#adminAction() : nothing}`
        }
      </div>
    `;
  }

  get #formNeedsAdmin(): boolean {
    return this.formRefusal?.code === "authorization.not_permitted";
  }

  #adminAction(): TemplateResult {
    return html`<wt-button
      variant="secondary"
      slot="secondary"
      data-test="backup-admin-sign-in"
      @click=${() => this.dispatchEvent(new CustomEvent("admin-sign-in", { bubbles: true, composed: true }))}
      >${t("staff.sign_in_as_admin")}</wt-button
    >`;
  }

  #renderConfigurationExport(): TemplateResult {
    const fieldMessage = this.#configurationFeedback.attempted
      ? this.#configurationFieldError()
      : null;
    const bottom = bottomMessage(
      this.configurationRequestFailed ? t("backup.configuration.request_error") : null,
      fieldMessage === null ? null : t("form.fix_fields"),
    );
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
            class="secret-toggle"
            data-test="toggle-configuration-passphrase"
            aria-label=${this.configurationPassphraseVisible ? t("login.hide_password") : t("login.show_password")}
            @click=${() =>
              (this.configurationPassphraseVisible = !this.configurationPassphraseVisible)}
            >${revealIcon(this.configurationPassphraseVisible)}</wt-button
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
            class="secret-toggle"
            data-test="toggle-configuration-confirm"
            aria-label=${this.configurationConfirmVisible ? t("login.hide_password") : t("login.show_password")}
            @click=${() => (this.configurationConfirmVisible = !this.configurationConfirmVisible)}
            >${revealIcon(this.configurationConfirmVisible)}</wt-button
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
    const writable = s.isPrimary;
    return html`
      <div class="card" id="backup-body">
        ${this.#renderStatus(s)}
        ${
          this.reloadErrorCode === null
            ? nothing
            : html`<p class="error" role="status" data-test="reload-failed">
                ${t("backup.reload_failed_after_save")}
                ${this.#reloadFailedDetail(s, this.reloadErrorCode)}
              </p>`
        }
        ${
          !s.isPrimary
            ? html`<p class="hint" data-test="not-primary">${t("backup.status.not_primary")}</p>`
            : nothing
        }
        ${writable && (!s.enabled || this.configureAfterApply) ? this.#renderConfigure() : nothing}
        ${writable && s.enabled && this.editSettings ? this.#renderEditSettings() : nothing}
        ${
          writable && s.enabled && !this.editSettings && !this.configureAfterApply
            ? html` ${
                  this.canManage
                    ? html`<wt-button
                        variant="secondary"
                        data-test="run-now"
                        ?disabled=${this.submitting || s.activeRun !== undefined}
                        @click=${() => void this.#runNow()}
                        >${t("backup.run_now")}</wt-button
                      >`
                    : nothing
                }
                <wt-button
                  variant="secondary"
                  data-test="edit-settings"
                  ?disabled=${this.submitting}
                  @click=${() => void this.#startEdit()}
                  >${t("backup.edit.button")}</wt-button
                >
                ${this.#renderTurnOff()}`
            : nothing
        }
      </div>
    `;
  }

  // The apply route answers a load failure as its reload code too (backup-api.ts), so the status line already says it.
  #reloadFailedDetail(s: BackupStatusView, code: string): string {
    if (code === s.loadErrorCode) return "";
    if (hasCodeMessage(code)) return codeMessage(code);
    return t("backup.reload_failed_retry");
  }

  #renderStatus(s: BackupStatusView): TemplateResult {
    const cloud = s.backupStatus.configured
      ? s.backupStatus.destinations.find((d) => d.id === "cloud")
      : undefined;
    return html`
      <dl class="status" data-test="status">
        <div>
          <dt>${t("backup.status.state")}</dt>
          <dd>
            ${
              s.enabled
                ? html`<span class="on">${t("backup.status.on")}</span>`
                : html`<span class="off"
                    >${s.storedDisabled ? t("backup.status.stored_off") : t("backup.status.off")}</span
                  >`
            }
            <span role="status" data-test="backup-run-status">
              ${
                s.activeRun
                  ? html`<span class="line"
                      >${fill(
                        s.activeRun.kind === "manual"
                          ? "backup.status.manual_running"
                          : "backup.status.scheduled_running",
                        { time: new Date(s.activeRun.startedAt).toLocaleString(currentLocale()) },
                      )}</span
                    >`
                  : s.runStoppedCode
                    ? html`<span class="line stale"
                        >${
                          s.runStoppedCode === "backup.staging_space_low"
                            ? t("backup.status.stopped_space_low")
                            : s.runStoppedCode === "backup.settings_changed"
                              ? t("backup.status.stopped_settings_changed")
                              : alertMessage("backup.run_stopped", { errorCode: s.runStoppedCode })
                        }</span
                      >`
                    : nothing
              }
            </span>
            ${
              s.loadErrorCode
                ? html`<span class="line stale" data-test="load-failed"
                      >${
                        hasCodeMessage(s.loadErrorCode)
                          ? `${t("backup.status.load_failed")} ${codeMessage(s.loadErrorCode)}`
                          : codeMessage("backup.archive_settings_unusable")
                      }</span
                    ><wt-button
                      class="evidence-open"
                      data-test="evidence-open"
                      variant="secondary"
                      @click=${() => (this.evidenceOpen = true)}
                      >${t("backup_evidence.heading")}</wt-button
                    >`
                : nothing
            }
          </dd>
        </div>
        ${
          s.destinations.length === 0 && cloud === undefined
            ? html`<div>
                <dt>${t("backup.status.last")}</dt>
                <dd>${t("backup.status.never")}</dd>
              </div>`
            : s.destinations.map((d) => this.#renderDestinationRow(s, d))
        }
        ${
          cloud
            ? html`<div data-test="destination-row" data-destination="cloud" data-place="off-box">
                <dt>${t("backup.destination.choice_cloud")}</dt>
                <dd>${this.#renderOutcome(cloud)}</dd>
              </div>`
            : nothing
        }
        ${
          s.keyFingerprint
            ? html`<div>
                <dt>${t("backup.status.fingerprint")}</dt>
                <dd>${s.keyFingerprint}</dd>
              </div>`
            : nothing
        }
        ${
          s.keyRotatedAt
            ? html`<div>
                <dt>${t("backup.status.rotated")}</dt>
                <dd data-test="key-rotated">
                  ${new Date(s.keyRotatedAt).toLocaleString(currentLocale())}
                </dd>
              </div>`
            : nothing
        }
        ${
          s.enabled
            ? html`<div>
                <dt>${t("backup.status.archive_current")}</dt>
                <dd data-test="archive-current">
                  ${
                    s.archiveUnderCurrentKey
                      ? t("backup.status.archive_yes")
                      : t("backup.status.archive_no")
                  }
                </dd>
              </div>`
            : nothing
        }
      </dl>
    `;
  }

  #renderDestinationRow(s: BackupStatusView, d: BackupDestinationView): TemplateResult {
    const local = d.kind === "local-fs";
    const outcome = s.backupStatus.configured
      ? s.backupStatus.destinations.find((r) => r.id === d.id)
      : undefined;
    return html`
      <div
        class="destination"
        data-test="destination-row"
        data-destination=${d.id}
        data-place=${local ? "local" : "off-box"}
      >
        <dt>${local ? t("backup.destination.local") : t("backup.destination.off_box")}</dt>
        <dd>
          <span class="line">${local ? d.dir : `${d.bucket}/${d.namespace}`}</span>
          ${s.backupStatus.configured ? this.#renderOutcome(outcome) : nothing}
        </dd>
      </div>
    `;
  }

  /** One destination's own result: another destination's success is never shown as this one's. */
  #renderOutcome(r: BackupDestinationStatus | undefined): TemplateResult {
    if (r?.readErrorCode)
      return html`<span class="line stale"
        >${t("backup.destination.unreadable")} ${codeMessage(r.readErrorCode)}</span
      >`;
    const result = r?.uploadErrorCode
      ? html`<span class="line stale"
          >${t("backup.destination.failed")} ${codeMessage(r.uploadErrorCode)}</span
        >`
      : r?.storedUnderCurrentKey
        ? html`<span class="line">${t("backup.destination.stored")}</span>`
        : nothing;
    const prune = r?.pruneErrorCode
      ? html`<span class="line stale"
          >${t("backup.destination.prune_failed")} ${codeMessage(r.pruneErrorCode)}</span
        >`
      : nothing;
    return html`${result}<span class="line"
        >${t("backup.status.last")}: ${this.#renderFreshness(r)}</span
      >${prune}`;
  }

  #renderFreshness(r: BackupDestinationStatus | undefined): TemplateResult {
    if (r === undefined || r.lastBackupAt === null) return html`${t("backup.status.never")}`;
    const when = new Date(r.lastBackupAt).toLocaleString(currentLocale());
    if (r.uploadErrorCode) return html`${when}`;
    return r.stale
      ? html`${when} — <span class="stale">${t("backup.status.stale")}</span>`
      : html`${when} — ${t("backup.status.fresh")}`;
  }

  #renderDestinationField(): TemplateResult {
    const cloudMessage =
      this.cloudRefused === "cloud" ? codeMessage("backup.cloud_unavailable") : "";
    const folderMessage = this.folderRefused
      ? this.folderRefusalReason === "scratch"
        ? fill("backup.destination.folder_scratch_refused", { folder: this.folderScratchRoot })
        : this.folderRefusalReason === "unreadable"
          ? t("backup.destination.folder_unreadable")
          : this.folderRefusalReason === "relative"
            ? t("backup.destination.folder_relative")
            : t("backup.destination.folder_refused")
      : this.#feedback.attempted && this.#folderMissing
        ? t("backup.destination.folder_required")
        : "";
    return html`
      <h2>${t("backup.destination.title")}</h2>
      <wt-switch
        data-test="archive-folder-on"
        name="archive-folder"
        label=${t("backup.destination.choice_local")}
        .checked=${this.folderOn}
        @wt-change=${(e: CustomEvent<{ checked: boolean }>) => {
          e.stopPropagation();
          this.folderOn = e.detail.checked;
          this.folderRefused = false;
        }}
      ></wt-switch>
      ${
        this.folderOn
          ? html`<wt-input
                data-test="destination"
                name="backup-folder"
                autocapitalize="none"
                autocorrect="off"
                spellcheck="false"
                required
                label=${t("backup.destination.label")}
                hint="/var/lib/waitron/backups"
                error=${folderMessage}
                .value=${this.folder}
                @keydown=${(e: KeyboardEvent) => this.#submitOnEnter(e)}
                @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onDestination(e)}
              ></wt-input>
              <p class="hint">${t("backup.destination.folder_help")}</p>`
          : nothing
      }
      <wt-combobox
        data-test="archive-destination"
        name="archive-destination"
        search="never"
        label=${t("backup.destination.bucket")}
        .options=${[
          { value: "none", fixed: true, label: t("backup.destination.bucket_none") },
          { value: "custom-s3", label: t("backup.destination.choice_custom") },
        ]}
        .value=${this.bucket}
        .error=${this.#feedback.attempted && this.#nothingChosen ? t("backup.destination.nothing_chosen") : ""}
        @wt-change=${(e: CustomEvent<{ value: string }>) => {
          e.stopPropagation();
          this.bucket = e.detail.value as BucketChoice;
          this.customRefused = null;
        }}
      ></wt-combobox>
      ${this.bucket === "custom-s3" ? this.#renderCustomChoice() : nothing}
      ${
        this.#cloudAvailable
          ? html`<div>
              <wt-switch
                data-test="archive-cloud"
                name="backup-cloud"
                label=${t("backup.destination.choice_cloud")}
                .checked=${this.cloudOn}
                .description=${cloudMessage}
                @wt-change=${(e: CustomEvent<{ checked: boolean }>) => {
                  e.stopPropagation();
                  this.cloudOn = e.detail.checked;
                  this.cloudRefused = null;
                }}
              ></wt-switch>
              <p class="hint">${t("backup.destination.cloud_help")}</p>
              ${cloudMessage ? html`<div class="error">${cloudMessage}</div>` : nothing}
            </div>`
          : this.status?.cloud && this.cloudOn
            ? html`<wt-button
                data-test="remove-cloud"
                variant="secondary"
                @click=${() => {
                  this.cloudOn = false;
                  this.cloudRefused = null;
                  this.renderRoot
                    .querySelector<HTMLElement>("[data-test=archive-destination]")
                    ?.focus();
                }}
                >${t("backup.destination.remove_cloud")}</wt-button
              >`
            : nothing
      }
    `;
  }

  #refusalMessage(field: CustomField): string {
    switch (field) {
      case "endpoint":
        return t("stream.form.endpoint_invalid");
      case "bucket":
        return t("stream.field.bucket_characters");
      case "accessKeyId":
        return t("stream.field.key_characters");
      case "prefix":
        return t(
          hasUnusableFolder(this.custom.prefix.trim())
            ? "stream.field.prefix_folders"
            : "stream.field.check",
        );
      case "secretAccessKey":
        return t(
          this.secretSentRefused
            ? "backup.destination.secret_characters"
            : "stream.form.secret_access_key_required",
        );
      default:
        return t("stream.field.check");
    }
  }

  #customMessage(f: BucketFieldRow): string {
    if (this.customRefused === f.field) return this.#refusalMessage(f.field);
    if (this.#feedback.attempted && f.field === "endpoint" && this.#endpointInvalid)
      return t("stream.form.endpoint_invalid");
    if (!this.#feedback.attempted || !this.#customMissing(f)) return "";
    if (f.field === "secretAccessKey")
      return heldBucket(this.status) === null || this.secretDemanded
        ? t("stream.form.secret_access_key_required")
        : t("backup.destination.secret_needed");
    return f.requiredKey === undefined ? "" : t(f.requiredKey);
  }

  #renderCustomField(f: BucketFieldRow): TemplateResult {
    const required = this.#customRequired(f);
    return renderBucketField(f, {
      namePrefix: "archive-bucket-",
      testPrefix: "archive-bucket-",
      toggleTest: "toggle-archive-secret",
      value: this.custom[f.field],
      error: this.#customMessage(f),
      required,
      visible: this.secretVisible,
      hint:
        f.field === "secretAccessKey" && !required && this.customRefused !== "secretAccessKey"
          ? t("backup.destination.secret_keep")
          : f.field === "prefix"
            ? t("backup.destination.prefix_hint")
            : "",
      change: (value) => {
        this.custom = { ...this.custom, [f.field]: value };
        if (this.customRefused === f.field) this.customRefused = null;
        if (f.field !== "secretAccessKey" && this.secretDemanded) {
          this.secretDemanded = false;
          if (this.customRefused === "secretAccessKey") this.customRefused = null;
        }
      },
      toggle: () => (this.secretVisible = !this.secretVisible),
      keydown: (event) => this.#submitOnEnter(event),
    });
  }

  #renderCustomChoice(): TemplateResult {
    const bucket = this.custom.bucket.trim();
    return html`
      <p class="hint">${t("backup.destination.bucket_help")}</p>
      ${BUCKET_FIELDS.map((f) => this.#renderCustomField(f))}
      ${
        bucket === "" || this.status === undefined
          ? nothing
          : html`<p data-test="custom-location">
              <span class="field-label">${t("backup.destination.stream_location")}</span>
              <span class="location"
                >${streamLocation({ bucket, prefix: this.custom.prefix.trim() })}</span
              >
            </p>`
      }
    `;
  }

  /** Stored settings that are switched off can be turned back on as they are. */
  #applyAction() {
    const s = this.status;
    return saveActionState(this.#archiveScope, {
      savableAtOpen: s?.storedDisabled === true && !s.enabled,
    });
  }

  #renderConfigure(): TemplateResult {
    const s = this.#applyAction();
    return html`<div class="form">
      ${this.#renderDestinationField()}

      <h2>${t("backup.schedule.title")}</h2>
      ${this.#renderPolicy()}
      <wt-form-actions data-test="apply-actions" .error=${this.#policyBottom()}>
        ${this.#formNeedsAdmin ? this.#adminAction() : nothing}
        <wt-button
          variant=${s.variant}
          data-test="apply"
          ?disabled=${s.unchanged || this.#saveDisabled}
          @click=${() => void this.#apply()}
          >${t("backup.apply")}</wt-button
        >
      </wt-form-actions>
    </div>`;
  }

  #settingsAction() {
    return saveActionState(this.#archiveScope, { savableAtOpen: this.#policyReplaced });
  }

  #renderEditSettings(): TemplateResult {
    const s = this.#settingsAction();
    return html`<div class="form">
      <h2 data-test="edit-title">${t("backup.edit.title")}</h2>
      ${this.#renderDestinationField()}

      <h2>${t("backup.schedule.title")}</h2>
      ${this.#renderPolicy()}
      <wt-form-actions data-test="settings-actions" .error=${this.#policyBottom()}>
        ${this.#formNeedsAdmin ? this.#adminAction() : nothing}
        <wt-button
          slot="cancel"
          variant="ghost"
          data-test="cancel-edit"
          @click=${() => this.#leaveSettings("cancel")}
          >${t("backup.edit.cancel")}</wt-button
        >
        <wt-button
          variant=${s.variant}
          data-test="save-settings"
          ?disabled=${s.unchanged || this.#saveDisabled}
          @click=${() => void this.#saveSettings()}
          >${t("backup.edit.save")}</wt-button
        >
      </wt-form-actions>
    </div>`;
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
        .error=${this.cloudRefused === "schedule" ? codeMessage("backup.cloud_needs_daily") : ""}
        @wt-change=${(e: CustomEvent<{ value: "daily" | "weekdays" }>) =>
          this.#setDaysMode(e.detail.value)}
      ></wt-combobox>
      ${
        this.cloudRefused === "schedule"
          ? html`<wt-button
              data-test="cloud-daily"
              variant="secondary"
              @click=${() => {
                this.#setDaysMode("daily");
                this.renderRoot.querySelector<HTMLElement>("[data-test=days-mode]")?.focus();
              }}
              >${t("backup.schedule.use_daily")}</wt-button
            >`
          : nothing
      }
      ${
        this.daysMode === "weekdays"
          ? html`<div class="weekdays">
              ${WEEKDAYS.map(
                (d) =>
                  html`<label class="checkbox">
                    <input
                      type="checkbox"
                      data-test="weekday-${d.n}"
                      name="backup-weekday-${d.n}"
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
              required
              error=${this.#feedback.attempted && this.#timeMissing ? t("backup.schedule.at_required") : ""}
              .value=${this.atTime}
              @keydown=${(event: KeyboardEvent) => this.#submitOnEnter(event)}
              @wt-change=${(e: CustomEvent<{ value: string }>) => (this.atTime = e.detail.value)}
            ></wt-input>`
          : nothing
      }
      ${this.#renderRetentionBox("count")} ${this.#renderRetentionBox("days")}
    `;
  }

  #retentionMessage(text: string): string | null {
    const invalid = this.#feedback.attempted && parseRetention(text) === null;
    return invalid || this.retentionRefused ? t("backup.retention_invalid") : null;
  }

  #policyBottom(): string {
    const cloudChoiceRefused = this.cloudRefused === "cloud";
    const marked =
      this.cloudRefused === "schedule" ||
      (cloudChoiceRefused && this.#cloudAvailable) ||
      this.#policyHeld ||
      this.retentionRefused ||
      this.#destinationHeld ||
      this.folderRefused ||
      this.customRefused !== null;
    const refusal = this.formRefusal;
    const reasonKey = refusal?.reason == null ? undefined : TEST_REASON_KEYS[refusal.reason];
    return [
      ...(refusal === null
        ? []
        : [refusal.sentence === undefined ? codeMessage(refusal.code) : t(refusal.sentence)]),
      ...(reasonKey === undefined ? [] : [t(reasonKey)]),
      ...(cloudChoiceRefused && !this.#cloudAvailable
        ? [codeMessage("backup.cloud_unavailable")]
        : []),
      ...(marked ? [t("form.fix_fields")] : []),
    ].join(" ");
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
        @keydown=${(event: KeyboardEvent) => this.#submitOnEnter(event)}
        @wt-change=${(e: CustomEvent<{ value: string }>) => {
          if (box === "count") this.retainCount = e.detail.value;
          else this.retainDays = e.detail.value;
          this.retentionRefused = false;
        }}
      ></wt-number-stepper>
    `;
  }

  #renderTurnOff(): TemplateResult {
    const armed = this.turnOffArmed;
    return html`
      ${
        armed
          ? html`<p class="hint" role="note" data-test="turn-off-explain">
              ${t("backup.turn_off.explain")}
            </p>`
          : nothing
      }
      <div class="turn-off-actions">
        <wt-button
          variant=${armed ? "danger" : "ghost"}
          data-armed=${armed ? "true" : nothing}
          data-test="turn-off"
          ?disabled=${this.submitting}
          @click=${() => void this.#turnOff()}
          >${t(armed ? "backup.turn_off.confirm" : "backup.turn_off.button")}</wt-button
        >
        ${
          armed
            ? html`<wt-button
                variant="ghost"
                data-test="turn-off-cancel"
                ?disabled=${this.submitting}
                @click=${() => (this.turnOffArmed = false)}
                >${t("backup.turn_off.cancel")}</wt-button
              >`
            : nothing
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-backup-screen": BackupScreen;
  }
}
