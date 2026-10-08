import { LitElement, type TemplateResult, css, html, nothing, svg } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { DashboardQueries } from "../api/query-controller.js";
import type {
  DashboardApi,
  StreamBucketBody,
  StreamSettingsView,
  StreamStatusView,
} from "../api/client.js";
import { alertMessage } from "../i18n/alerts.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import { currentLocale, t } from "../i18n/t.js";

type Field = keyof StreamBucketBody;

const EMPTY: StreamBucketBody = {
  endpoint: "",
  region: "",
  bucket: "",
  prefix: "",
  accessKeyId: "",
  secretAccessKey: "",
};

/** The server names a refused setting by its `BucketConfig` key, which is also this form's key. */
const FIELDS: { field: Field; name: string; labelKey: StringKey; requiredKey?: StringKey }[] = [
  { field: "endpoint", name: "bucket-endpoint", labelKey: "stream.form.endpoint" },
  {
    field: "region",
    name: "bucket-region",
    labelKey: "stream.form.region",
    requiredKey: "stream.form.region_required",
  },
  {
    field: "bucket",
    name: "bucket-name",
    labelKey: "stream.form.bucket",
    requiredKey: "stream.form.bucket_required",
  },
  { field: "prefix", name: "bucket-prefix", labelKey: "stream.form.prefix" },
  {
    field: "accessKeyId",
    name: "bucket-access-key-id",
    labelKey: "stream.form.access_key_id",
    requiredKey: "stream.form.access_key_id_required",
  },
  {
    field: "secretAccessKey",
    name: "bucket-secret-access-key",
    labelKey: "stream.form.secret_access_key",
    requiredKey: "stream.form.secret_access_key_required",
  },
];

/** `ProbeFailure` in `packages/stream/src/probe.ts`. */
const PROBE_REASON_KEYS: Readonly<Record<string, StringKey>> = {
  access_denied: "stream.probe.access_denied",
  conditional_write_unsupported: "stream.probe.conditional_write_unsupported",
  write_failed: "stream.probe.write_failed",
  read_mismatch: "stream.probe.read_mismatch",
  list_failed: "stream.probe.list_failed",
  create_only_ignored: "stream.probe.create_only_ignored",
  fresh_version_refused: "stream.probe.fresh_version_refused",
  if_match_ignored: "stream.probe.if_match_ignored",
  delete_failed: "stream.probe.delete_failed",
};

/** What `checkLitestreamSettings` (`packages/stream/src/litestream.ts`) refuses in each field. */
const UNSAFE_FIELD_KEYS: Partial<Record<Field, StringKey>> = {
  bucket: "stream.field.bucket_characters",
  prefix: "stream.field.prefix_folders",
  accessKeyId: "stream.field.key_characters",
  secretAccessKey: "stream.field.key_characters",
};

/** Refusals whose wording elsewhere does not fit what this panel was doing. */
const PANEL_CODE_KEYS: Readonly<Record<string, StringKey>> = {
  "backup.managed_by_environment": "stream.error.managed_by_environment",
  "backup.recovery_key_missing": "stream.error.recovery_key_missing",
  "backup.recovery_key_too_short": "stream.error.recovery_key_too_short",
};

function isField(value: unknown): value is Field {
  return typeof value === "string" && Object.hasOwn(EMPTY, value);
}

/** The bucket fields a settings read carries. The secret access key is not one of them, so a change
 * of the secret alone does not take the kit away. */
function bucketKey(bucket: StreamSettingsView["bucket"]): string {
  return bucket === null
    ? ""
    : JSON.stringify([
        bucket.endpoint,
        bucket.region,
        bucket.bucket,
        bucket.prefix,
        bucket.accessKeyId,
      ]);
}

function stateKey(status: StreamStatusView): StringKey {
  switch (status.state) {
    case "streaming":
      return "stream.state.streaming";
    case "opening":
      return "stream.state.opening";
    case "paused":
      return "stream.state.paused";
    case "refused":
      return status.reason === "pointer_changed" || status.reason === "pointer_newer_term"
        ? "stream.state.another_server"
        : "stream.state.unusable";
    default:
      return "stream.state.not_running";
  }
}

/** Of a refusal's params, only a probe reason with a sentence of its own is ever shown, and then as
 * that sentence, never as the param's own text. */
interface Failure {
  code: string;
  reason: string | null;
}

function failureOf(error: unknown): Failure {
  const reason = (error as { params?: Record<string, unknown> }).params?.reason;
  return { code: codeOf(error), reason: typeof reason === "string" ? reason : null };
}

/**
 * The bucket copy on the Backups screen: the bucket settings, Test, how current the copy is, and
 * the recovery kit. When a later read of the settings brings a different key fingerprint, the key
 * was changed, so the kit is fetched again with a banner, because copies made before the change
 * still need the old kit. A failed re-fetch is tried again on the next read. The kit describes the
 * bucket too, so a read bringing different bucket fields takes the kit away.
 */
@customElement("dashboard-stream-settings")
export class StreamSettingsPanel extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      section,
      .form {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }
      h2 {
        margin: var(--wt-space-6) 0 0;
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text);
      }
      h3 {
        margin: var(--wt-space-3) 0 0;
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text);
      }
      p {
        margin: 0;
      }
      .hint {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .status {
        margin: 0;
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
      .actions {
        display: flex;
        gap: var(--wt-space-2);
        align-items: center;
        flex-wrap: wrap;
      }
      /* Text-coloured: the primary accent fails contrast at this size, as on the Backups screen. */
      a.download {
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-sm);
        text-decoration: underline;
      }
      .warning {
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-danger);
        border-radius: var(--wt-radius-md);
        color: var(--wt-color-danger);
        background: var(--wt-color-surface);
      }
      .error {
        color: var(--wt-color-danger);
      }
      .passed {
        color: var(--wt-color-text);
      }
      .secret-toggle svg {
        display: block;
        width: var(--wt-font-size-lg);
        height: var(--wt-font-size-lg);
        fill: none;
        stroke: currentColor;
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  /** Whether the box's environment owns the backup settings: true, false, or undefined when not known. */
  @property({ attribute: false }) managedByEnvironment: boolean | undefined = undefined;

  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.readFailure = failureOf(error);
    },
  );

  @state() private settings?: StreamSettingsView;
  @state() private draft: StreamBucketBody = { ...EMPTY };
  @state() private editing = false;
  @state() private attempted = false;
  /** Fields the server refused, each shown until the owner changes it. */
  @state() private refused: Partial<Record<Field, string>> = {};
  @state() private submitting = false;
  @state() private testPassed = false;
  /** A refusal of something the owner did; `#clearMessages` takes it away. */
  @state() private failure: Failure | null = null;
  /** A failed read of the settings, or of the kit after a key change. The next successful read of
   * the settings takes it away, unless that read retries a failed kit fetch: then the fetch
   * succeeding takes it away, so the alert does not vanish and return on every retry. */
  @state() private readFailure: Failure | null = null;
  /** A failed kit fetch the owner caused (Save or Show recovery kit). Apart from `failure`, so a
   * fetch failing after a successful Save does not read as a refused save. */
  @state() private kitFailure: Failure | null = null;
  @state() private kit: string | null = null;
  @state() private kitFingerprint: string | null = null;
  @state() private kitReissued = false;
  @state() private secretVisible = false;
  @state() private turnOffArmed = false;
  @state() private busy = false;

  /** The key fingerprint the panel last accepted. While the copy is on, a read bringing a different
   * key is accepted only once the kit has been fetched again, so the next read retries a failed
   * fetch. */
  #knownFingerprint: string | null | undefined = undefined;
  /** The re-issue still running, if any. While it is the latest kit fetch, a read bringing the same
   * key starts no second one. */
  #reissue: { fingerprint: string; request: number } | null = null;
  /** Every kit fetch takes the next number; only the latest may put its answer on screen. */
  #kitRequest = 0;
  #reissueFailed = false;
  #blobUrls = new Map<string, string>();
  #scope?: DraftScope<StreamBucketBody>;
  #leave?: LeaveCoordinator;
  #generation = 0;

  #trackForm(): void {
    if (this.#scope) return;
    const { coordinator, scope } = draftScopeFor<StreamBucketBody>(this, {
      id: this,
      current: () => this.#body(),
      snapshot: (body) => ({ ...body }),
      equal: (a, b) => (Object.keys(EMPTY) as Field[]).every((field) => a[field] === b[field]),
      restore: (body) => {
        this.draft = { ...body };
      },
    });
    this.#leave = coordinator;
    this.#scope = scope;
  }

  /** Save reads the scope, so a form on screen without one could never be saved. */
  #trackShownForm(value: StreamSettingsView): void {
    if (value.isPrimary && (!value.configured || this.editing)) this.#trackForm();
  }

  #releaseForm(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
  }

  #cancel(): void {
    const proceed = () => {
      this.editing = false;
      this.draft = { ...EMPTY };
      this.#releaseForm();
      this.#resetForm();
      this.#clearMessages();
    };
    if (this.#leave) void this.#leave.request({ scopes: [this], reason: "cancel", proceed });
    else proceed();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  override disconnectedCallback(): void {
    this.#generation++;
    this.#kitRequest++;
    this.#releaseForm();
    this.settings = undefined;
    this.draft = { ...EMPTY };
    this.editing = false;
    this.submitting = false;
    this.busy = false;
    this.secretVisible = false;
    this.#knownFingerprint = undefined;
    this.#reissue = null;
    this.#reissueFailed = false;
    this.readFailure = null;
    this.kit = null;
    this.kitFingerprint = null;
    this.kitReissued = false;
    this.#resetForm();
    this.#clearMessages();
    for (const url of this.#blobUrls.values()) URL.revokeObjectURL(url);
    this.#blobUrls.clear();
    super.disconnectedCallback();
  }

  async #load(): Promise<void> {
    try {
      await this.#queries.watch("getStreamSettings", [], (value) => this.#arrived(value));
    } catch (error) {
      this.readFailure = failureOf(error);
    }
  }

  /** The first key the panel sees is no change; a later different one is. */
  #arrived(value: StreamSettingsView): void {
    const before = this.settings;
    this.settings = value;
    this.#trackShownForm(value);
    if (before !== undefined && bucketKey(before.bucket) !== bucketKey(value.bucket))
      this.#dropKit();
    if (!value.configured) this.turnOffArmed = false;
    const known = this.#knownFingerprint;
    const after = value.keyFingerprint;
    const reissue = value.bucket !== null && known != null && after !== null && after !== known;
    if (!reissue || !this.#reissueFailed) this.readFailure = null;
    if (reissue) {
      void this.#reissueKit(after);
    } else {
      this.#knownFingerprint = after;
      this.#reissueFailed = false;
    }
  }

  /** Through the background client, so an unattended screen stays passive. */
  async #reissueKit(fingerprint: string): Promise<void> {
    if (this.#reissue?.fingerprint === fingerprint && this.#reissue.request === this.#kitRequest)
      return;
    const request = ++this.#kitRequest;
    this.#reissue = { fingerprint, request };
    const current = () => this.#current(request) && this.settings?.keyFingerprint === fingerprint;
    try {
      const { kit, keyFingerprint } = await (this.api.background ?? this.api).getRecoveryKit();
      if (!current()) return;
      this.kit = kit;
      this.kitFingerprint = keyFingerprint;
      this.kitReissued = true;
      this.#knownFingerprint = fingerprint;
      this.#reissueFailed = false;
      this.readFailure = null;
      this.kitFailure = null;
    } catch (error) {
      if (!current()) return;
      this.readFailure = failureOf(error);
      this.kitReissued = false;
      this.#reissueFailed = true;
    } finally {
      if (this.#reissue?.request === request) this.#reissue = null;
    }
  }

  #fail(error: unknown): void {
    const code = codeOf(error);
    const named = (error as { params?: Record<string, unknown> }).params?.field;
    if (
      (code === "backup.stream_config_unsafe" || code === "backup.request_invalid") &&
      isField(named)
    ) {
      const key = code === "backup.stream_config_unsafe" ? UNSAFE_FIELD_KEYS[named] : undefined;
      this.refused = { [named]: t(key ?? "stream.field.check") };
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    this.failure = failureOf(error);
  }

  #current(request: number): boolean {
    return request === this.#kitRequest && this.settings?.bucket != null;
  }

  /** Also discards the answer of any kit fetch still running. */
  #dropKit(): void {
    this.#kitRequest++;
    this.kit = null;
    this.kitReissued = false;
    this.kitFailure = null;
  }

  #clearMessages(): void {
    this.failure = null;
    this.kitFailure = null;
    this.testPassed = false;
    this.turnOffArmed = false;
  }

  #validate(): Partial<Record<Field, string>> {
    const errors: Partial<Record<Field, string>> = {};
    for (const f of FIELDS) {
      if (f.requiredKey !== undefined && this.draft[f.field].trim() === "")
        errors[f.field] = t(f.requiredKey);
    }
    const endpoint = this.draft.endpoint.trim();
    if (endpoint !== "" && !/^https?:\/\/\S+$/.test(endpoint)) {
      errors.endpoint = t("stream.form.endpoint_invalid");
    }
    return errors;
  }

  #body(): StreamBucketBody {
    return {
      endpoint: this.draft.endpoint.trim(),
      region: this.draft.region.trim(),
      bucket: this.draft.bucket.trim(),
      prefix: this.draft.prefix.trim(),
      accessKeyId: this.draft.accessKeyId.trim(),
      secretAccessKey: this.draft.secretAccessKey,
    };
  }

  #resetForm(): void {
    this.attempted = false;
    this.refused = {};
  }

  /** False when the draft has a problem, which it marks, or a request is already running. */
  #ready(): boolean {
    this.#clearMessages();
    this.attempted = true;
    this.refused = {};
    if (Object.keys(this.#validate()).length === 0) return !this.submitting;
    void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
    return false;
  }

  async #test(): Promise<void> {
    if (!this.#ready()) return;
    this.submitting = true;
    const body = this.#body();
    const tested = JSON.stringify(body);
    const generation = this.#generation;
    const current = () => this.isConnected && generation === this.#generation;
    try {
      await this.api.testStreamBucket(body);
      if (current()) this.testPassed = JSON.stringify(this.#body()) === tested;
    } catch (error) {
      if (current()) this.#fail(error);
    } finally {
      if (current()) this.submitting = false;
    }
  }

  async #save(): Promise<void> {
    if (saveActionState(this.#scope).unchanged) return;
    if (!this.#ready()) return;
    this.submitting = true;
    const generation = this.#generation;
    const current = () => this.isConnected && generation === this.#generation;
    const submitted = this.#body();
    try {
      const settings = await this.api.saveStreamSettings(submitted);
      if (!current()) return;
      this.settings = settings;
      this.#scope?.commit(submitted);
      // Save can give the box its first recovery key; the Backups screen must stop offering its own.
      this.api.liveData.invalidate([{ type: "backup_status" }]);
      this.editing = (Object.keys(EMPTY) as Field[]).some(
        (field) => this.#body()[field] !== submitted[field],
      );
      if (!this.editing) {
        this.draft = { ...EMPTY };
        this.#releaseForm();
      }
      this.#resetForm();
      this.#dropKit();
      await this.#loadKit();
    } catch (error) {
      if (current()) this.#fail(error);
    } finally {
      if (current()) this.submitting = false;
    }
  }

  /** Turning off deletes the stored bucket settings, secret included, so it takes a second,
   * confirming tap. */
  async #turnOff(): Promise<void> {
    if (this.busy) return;
    const confirmed = this.turnOffArmed;
    this.#clearMessages();
    if (!confirmed) {
      this.turnOffArmed = true;
      return;
    }
    this.busy = true;
    const generation = this.#generation;
    const current = () => this.isConnected && generation === this.#generation;
    try {
      const settings = await this.api.turnOffStream();
      if (!current()) return;
      this.settings = settings;
      this.#trackShownForm(settings);
      this.#dropKit();
    } catch (error) {
      if (current()) this.#fail(error);
    } finally {
      if (current()) this.busy = false;
    }
  }

  async #showKit(): Promise<void> {
    if (this.busy) return;
    this.#clearMessages();
    this.busy = true;
    const generation = this.#generation;
    try {
      await this.#loadKit();
    } finally {
      if (this.isConnected && generation === this.#generation) this.busy = false;
    }
  }

  async #loadKit(): Promise<void> {
    const request = ++this.#kitRequest;
    try {
      const { kit, keyFingerprint } = await this.api.getRecoveryKit();
      if (!this.#current(request)) return;
      this.kit = kit;
      this.kitFingerprint = keyFingerprint;
    } catch (error) {
      if (!this.#current(request)) return;
      this.kitFailure = failureOf(error);
    }
  }

  #startEdit(): void {
    // A new-bucket form a read replaced keeps its scope, whose baseline is not the stored bucket.
    this.#releaseForm();
    const b = this.settings!.bucket;
    this.draft = {
      endpoint: b?.endpoint ?? "",
      region: b?.region ?? "",
      bucket: b?.bucket ?? "",
      prefix: b?.prefix ?? "",
      accessKeyId: b?.accessKeyId ?? "",
      secretAccessKey: "",
    };
    this.#resetForm();
    this.#clearMessages();
    this.editing = true;
    this.#trackForm();
  }

  #downloadHref(kit: string): string {
    let url = this.#blobUrls.get(kit);
    if (url === undefined) {
      const body = `${t("stream.kit.file_heading")}\n${t("stream.kit.file_note")}\n\n${kit}\n`;
      url = URL.createObjectURL(new Blob([body], { type: "text/plain" }));
      this.#blobUrls.set(kit, url);
    }
    return url;
  }

  #failureText(failure: Failure): string {
    if (failure.code === "backup.recovery_key_too_short") {
      if (this.managedByEnvironment === undefined) {
        return t("stream.error.recovery_key_too_short_unknown");
      }
      if (this.managedByEnvironment) return t("stream.error.recovery_key_too_short_managed");
    }
    const panelKey = PANEL_CODE_KEYS[failure.code];
    if (panelKey !== undefined) return t(panelKey);
    const reasonKey = failure.reason === null ? undefined : PROBE_REASON_KEYS[failure.reason];
    const message = codeMessage(failure.code);
    return reasonKey === undefined ? message : `${message} ${t(reasonKey)}`;
  }

  override render(): TemplateResult {
    const s = this.settings;
    return html`
      <section aria-labelledby="stream-title">
        <h2 id="stream-title">${t("stream.title")}</h2>
        <p class="hint">${t("stream.explanation")}</p>
        ${s === undefined ? nothing : this.#renderBody(s)}
        ${
          this.failure === null
            ? nothing
            : html`<p class="error" role="alert" data-test="refusal">
                ${this.#failureText(this.failure)}
              </p>`
        }
        ${
          this.kitFailure === null
            ? nothing
            : html`<p class="error" role="alert" data-test="kit-failure">
                ${this.#failureText(this.kitFailure)}
              </p>`
        }
        ${
          this.readFailure === null
            ? nothing
            : html`<p class="error" role="alert" data-test="read-failure">
                ${this.#failureText(this.readFailure)}
              </p>`
        }
      </section>
    `;
  }

  #renderBody(s: StreamSettingsView): TemplateResult {
    if (!s.isPrimary) {
      return html`<p class="hint" data-test="not-primary">${t("stream.not_primary")}</p>`;
    }
    return html`
      ${s.configured ? this.#renderStatus(s.status) : nothing}
      ${
        s.configured && s.bucket === null
          ? html`<p class="hint" data-test="settings-incomplete">
              ${t("stream.settings_incomplete")}
            </p>`
          : nothing
      }
      ${
        !s.configured || this.editing
          ? this.#renderForm(s.configured)
          : html`<div class="actions">
              ${
                this.kit === null && s.bucket !== null
                  ? html`<wt-button
                      variant="secondary"
                      data-test="show-kit"
                      ?disabled=${this.busy}
                      @click=${() => void this.#showKit()}
                      >${t("stream.show_kit")}</wt-button
                    >`
                  : nothing
              }
              <wt-button variant="secondary" data-test="change" @click=${() => this.#startEdit()}
                >${t("stream.change")}</wt-button
              >
              <wt-button
                variant="ghost"
                data-test="turn-off"
                ?disabled=${this.busy}
                @click=${() => void this.#turnOff()}
                >${t(this.turnOffArmed ? "stream.turn_off_confirm" : "stream.turn_off")}</wt-button
              >
            </div>`
      }
      ${this.kit === null ? nothing : this.#renderKit(this.kit)}
    `;
  }

  #renderStatus(status: StreamStatusView): TemplateResult {
    return html`
      <dl class="status" data-test="stream-status">
        <dt>${t("stream.status.state")}</dt>
        <dd data-test="stream-state">${t(stateKey(status))}</dd>
        ${"lagMs" in status ? this.#renderFreshness(status.lagMs, status.lastConfirmedUploadAt) : nothing}
        ${
          "bucketProblem" in status && status.bucketProblem !== null
            ? html`<dt>${t("stream.status.bucket_check")}</dt>
                <dd data-test="bucket-problem">
                  ${this.#bucketProblemText(status.bucketProblem.reason)}
                </dd>`
            : nothing
        }
      </dl>
    `;
  }

  #renderFreshness(lagMs: number, last: string | null): TemplateResult {
    const minutes = Math.floor(lagMs / 60_000);
    const lag =
      lagMs === 0
        ? t("stream.status.lag_none")
        : minutes === 0
          ? t("stream.status.lag_under_minute")
          : t("stream.status.lag_minutes").replace("{minutes}", String(minutes));
    return html`
      <dt>${t("stream.status.lag")}</dt>
      <dd data-test="stream-lag">${lag}</dd>
      <dt>${t("stream.status.last")}</dt>
      <dd data-test="stream-last">
        ${last === null ? t("stream.status.never") : new Date(last).toLocaleString(currentLocale())}
      </dd>
    `;
  }

  /** An unknown reason takes the sentence the server's alert for a failing bucket check shows. */
  #bucketProblemText(reason: string): string {
    const key = PROBE_REASON_KEYS[reason];
    return key === undefined ? alertMessage("backup.stream_bucket_unusable", {}) : t(key);
  }

  #renderForm(canCancel: boolean): TemplateResult {
    const save = () => this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]");
    const checked = this.attempted ? this.#validate() : {};
    const errors = { ...this.refused, ...checked };
    const marked = FIELDS.some((f) => errors[f.field] !== undefined);
    const invalid = Object.keys(checked).length > 0;
    const saveAction = saveActionState(this.#scope);
    return html`
      <div class="form" @keydown=${(event: KeyboardEvent) => submitOnEnter(event, save())}>
        ${FIELDS.map((f) => this.#renderField(f, errors[f.field] ?? ""))}
        ${
          this.testPassed
            ? html`<p class="passed" data-test="test-passed" role="status">
                ${t("stream.form.test_passed")}
              </p>`
            : nothing
        }
        <wt-form-actions .error=${marked ? t("form.fix_fields") : ""}>
          ${
            canCancel
              ? html`<wt-button
                  slot="cancel"
                  variant="ghost"
                  data-test="cancel"
                  @click=${() => this.#cancel()}
                  >${t("stream.form.cancel")}</wt-button
                >`
              : nothing
          }
          <wt-button
            slot="secondary"
            variant="secondary"
            data-test="test"
            ?disabled=${this.submitting || invalid}
            @click=${() => void this.#test()}
            >${t("stream.form.test")}</wt-button
          >
          <wt-button
            variant=${saveAction.variant}
            data-test="save"
            ?disabled=${saveAction.unchanged || this.submitting || invalid}
            @click=${() => void this.#save()}
            >${t("stream.form.save")}</wt-button
          >
        </wt-form-actions>
      </div>
    `;
  }

  #renderField(f: (typeof FIELDS)[number], error: string): TemplateResult {
    const secret = f.field === "secretAccessKey";
    const toggleLabel = t(
      this.secretVisible ? "stream.form.hide_secret" : "stream.form.show_secret",
    );
    return html`<wt-input
      name=${f.name}
      label=${t(f.labelKey)}
      .required=${f.requiredKey !== undefined}
      type=${secret && !this.secretVisible ? "password" : "text"}
      autocomplete=${secret ? "new-password" : "off"}
      .value=${this.draft[f.field]}
      .error=${error}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.draft = { ...this.draft, [f.field]: event.detail.value };
        this.#scope?.changed();
        const refused = { ...this.refused };
        delete refused[f.field];
        this.refused = refused;
        this.testPassed = false;
      }}
      >${
        secret
          ? html`<wt-button
              slot="end"
              variant="ghost"
              class="secret-toggle"
              data-test="toggle-secret"
              aria-label=${toggleLabel}
              @click=${() => (this.secretVisible = !this.secretVisible)}
              ><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path d="M1 8s2.5-4 7-4 7 4 7 4-2.5 4-7 4-7-4-7-4Z"></path>
                <circle cx="8" cy="8" r="2"></circle>
                ${this.secretVisible ? svg`<path d="m2 2 12 12"></path>` : nothing}
              </svg></wt-button
            >`
          : nothing
      }</wt-input
    >`;
  }

  #renderKit(kit: string): TemplateResult {
    return html`
      <h3>${t("stream.kit.title")}</h3>
      ${
        this.kitReissued
          ? html`<p class="warning" role="note" data-test="kit-reissued">
              ${t("stream.kit.reissued")}
            </p>`
          : nothing
      }
      <p class="warning" role="note" data-test="kit-warning">${t("stream.kit.warning")}</p>
      <p class="key" data-test="kit">${kit}</p>
      <div class="actions">
        <wt-button
          variant="secondary"
          data-test="copy-kit"
          @click=${() =>
            void navigator.clipboard?.writeText(kit).catch(() => {
              /* The kit on screen and the download stay available. */
            })}
          >${t("stream.kit.copy")}</wt-button
        >
        <a
          class="download"
          data-test="download-kit"
          download=${`waitron-recovery-kit-${this.kitFingerprint}.txt`}
          href=${this.#downloadHref(kit)}
          >${t("stream.kit.download")}</a
        >
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-stream-settings": StreamSettingsPanel;
  }
}
