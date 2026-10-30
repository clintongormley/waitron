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
  "backup.recovery_key_too_short": "stream.error.recovery_key_too_short",
};

function isField(value: unknown): value is Field {
  return typeof value === "string" && Object.hasOwn(EMPTY, value);
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

/** The bucket copy on the Backups screen: the bucket settings, Test, and how current the copy is. */
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
      .actions {
        display: flex;
        gap: var(--wt-space-2);
        align-items: center;
        flex-wrap: wrap;
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
  /** Whether scheduled backups are on, which decides what replaces a too-short key. */
  @property({ attribute: false }) archivesEnabled: boolean | undefined = undefined;

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
  /** A failed read of the settings; the next successful read takes it away. */
  @state() private readFailure: Failure | null = null;
  @state() private secretVisible = false;
  @state() private turnOffArmed = false;
  @state() private busy = false;

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
    this.#releaseForm();
    this.settings = undefined;
    this.draft = { ...EMPTY };
    this.editing = false;
    this.submitting = false;
    this.busy = false;
    this.secretVisible = false;
    this.readFailure = null;
    this.#resetForm();
    this.#clearMessages();
    super.disconnectedCallback();
  }

  async #load(): Promise<void> {
    try {
      await this.#queries.watch("getStreamSettings", [], (value) => this.#arrived(value));
    } catch (error) {
      this.readFailure = failureOf(error);
    }
  }

  #arrived(value: StreamSettingsView): void {
    this.settings = value;
    this.#trackShownForm(value);
    if (!value.configured) this.turnOffArmed = false;
    this.readFailure = null;
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

  #clearMessages(): void {
    this.failure = null;
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
      this.#written();
      this.editing = (Object.keys(EMPTY) as Field[]).some(
        (field) => this.#body()[field] !== submitted[field],
      );
      if (!this.editing) {
        this.draft = { ...EMPTY };
        this.#releaseForm();
      }
      this.#resetForm();
    } catch (error) {
      if (current()) this.#fail(error);
    } finally {
      if (current()) this.submitting = false;
    }
  }

  /** Tells the Backups screen the box's bucket settings changed, so its recovery pack card reads again. */
  #written(): void {
    this.dispatchEvent(
      new CustomEvent("stream-settings-written", { bubbles: true, composed: true }),
    );
  }

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
      // The Backups screen offers this bucket as a destination, so it must see it go now.
      this.api.liveData.invalidate([{ type: "backup_status" }]);
      this.#written();
    } catch (error) {
      if (current()) this.#fail(error);
    } finally {
      if (current()) this.busy = false;
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

  #failureText(failure: Failure): string {
    if (failure.code === "backup.recovery_key_too_short") {
      if (this.managedByEnvironment === undefined) {
        return t("stream.error.recovery_key_too_short_unknown");
      }
      if (this.managedByEnvironment) return t("stream.error.recovery_key_too_short_managed");
      if (this.archivesEnabled) return t("stream.error.recovery_key_too_short_archives_on");
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
              <wt-button variant="secondary" data-test="change" @click=${() => this.#startEdit()}
                >${t("stream.change")}</wt-button
              >
              <wt-button
                variant=${this.turnOffArmed ? "danger" : "ghost"}
                data-armed=${this.turnOffArmed ? "true" : nothing}
                data-test="turn-off"
                ?disabled=${this.busy}
                @click=${() => void this.#turnOff()}
                >${t(this.turnOffArmed ? "stream.turn_off_confirm" : "stream.turn_off")}</wt-button
              >
            </div>`
      }
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
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-stream-settings": StreamSettingsPanel;
  }
}
