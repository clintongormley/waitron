import { LitElement, type TemplateResult, css, html, nothing, svg } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, submitOnEnter } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
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
import { t } from "../i18n/t.js";

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
 * still need the old kit.
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
  @state() private errors: Partial<Record<Field, string>> = {};
  @state() private submitting = false;
  @state() private testPassed = false;
  /** A refusal of something the owner did; it stays until the owner acts again. */
  @state() private failure: Failure | null = null;
  /** A failed read of the settings; the next successful read takes it away. */
  @state() private readFailure: Failure | null = null;
  @state() private kit: string | null = null;
  @state() private kitFingerprint: string | null = null;
  @state() private kitReissued = false;
  @state() private secretVisible = false;
  @state() private turnOffArmed = false;
  @state() private busy = false;

  /** Applied in `updated`, so the message beside the field is on screen when focus lands. */
  #focusField: Field | null = null;
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

  protected override updated(): void {
    const focus = this.#focusField;
    if (focus !== null) {
      this.#focusField = null;
      const name = FIELDS.find((f) => f.field === focus)!.name;
      this.shadowRoot!.querySelector<HTMLElement>(`wt-input[name=${name}]`)?.focus();
    }
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
    const before = this.settings?.keyFingerprint;
    this.settings = value;
    this.readFailure = null;
    const after = value.keyFingerprint;
    if (
      value.configured &&
      before !== undefined &&
      before !== null &&
      after !== null &&
      after !== before
    ) {
      this.kitReissued = true;
      void this.#loadKit(this.api.background ?? this.api);
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
      this.errors = { [named]: t(key ?? "stream.field.check") };
      this.#focusField = named;
      return;
    }
    this.failure = failureOf(error);
  }

  #clearMessages(): void {
    this.failure = null;
    this.testPassed = false;
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

  /** False when the draft has a problem, which it marks, or a request is already running. */
  #ready(): boolean {
    this.#clearMessages();
    this.errors = this.#validate();
    const first = FIELDS.find((f) => this.errors[f.field] !== undefined);
    if (first === undefined) return !this.submitting;
    this.#focusField = first.field;
    return false;
  }

  async #test(): Promise<void> {
    if (!this.#ready()) return;
    this.submitting = true;
    try {
      await this.api.testStreamBucket(this.#body());
      this.testPassed = true;
    } catch (error) {
      this.#fail(error);
    } finally {
      this.submitting = false;
    }
  }

  async #save(): Promise<void> {
    if (!this.#ready()) return;
    this.submitting = true;
    try {
      this.settings = await this.api.saveStreamSettings(this.#body());
      // Save can give the box its first recovery key; the Backups screen must stop offering its own.
      this.api.liveData.invalidate([{ type: "backup_status" }]);
      this.editing = false;
      this.draft = { ...EMPTY };
      await this.#loadKit(this.api);
    } catch (error) {
      this.#fail(error);
    } finally {
      this.submitting = false;
    }
  }

  /** Turning off deletes the stored bucket settings, secret included, so it takes a second,
   * confirming tap. */
  async #turnOff(): Promise<void> {
    if (this.busy) return;
    if (!this.turnOffArmed) {
      this.turnOffArmed = true;
      return;
    }
    this.turnOffArmed = false;
    this.#clearMessages();
    this.busy = true;
    try {
      this.settings = await this.api.turnOffStream();
      this.kit = null;
      this.kitReissued = false;
    } catch (error) {
      this.#fail(error);
    } finally {
      this.busy = false;
    }
  }

  async #showKit(): Promise<void> {
    if (this.busy) return;
    this.#clearMessages();
    this.busy = true;
    try {
      await this.#loadKit(this.api);
    } finally {
      this.busy = false;
    }
  }

  async #loadKit(client: DashboardApi): Promise<void> {
    try {
      const { kit, keyFingerprint } = await client.getRecoveryKit();
      this.kit = kit;
      this.kitFingerprint = keyFingerprint;
    } catch (error) {
      this.#fail(error);
    }
  }

  #startEdit(): void {
    const b = this.settings!.bucket;
    this.draft = {
      endpoint: b?.endpoint ?? "",
      region: b?.region ?? "",
      bucket: b?.bucket ?? "",
      prefix: b?.prefix ?? "",
      accessKeyId: b?.accessKeyId ?? "",
      secretAccessKey: "",
    };
    this.errors = {};
    this.#clearMessages();
    this.turnOffArmed = false;
    this.editing = true;
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
    const panelKey = PANEL_CODE_KEYS[failure.code];
    if (panelKey !== undefined) return t(panelKey);
    const reasonKey = failure.reason === null ? undefined : PROBE_REASON_KEYS[failure.reason];
    const message = codeMessage(failure.code);
    return reasonKey === undefined ? message : `${message} ${t(reasonKey)}`;
  }

  override render(): TemplateResult {
    const s = this.settings;
    const failure = this.failure ?? this.readFailure;
    return html`
      <section aria-labelledby="stream-title">
        <h2 id="stream-title">${t("stream.title")}</h2>
        <p class="hint">${t("stream.explanation")}</p>
        ${s === undefined ? nothing : this.#renderBody(s)}
        ${
          failure === null
            ? nothing
            : html`<p class="error" role="alert">${this.#failureText(failure)}</p>`
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
        !s.configured || this.editing
          ? this.#renderForm(s.configured)
          : html`<div class="actions">
              ${
                this.kit === null
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
        ${last === null ? t("stream.status.never") : new Date(last).toLocaleString()}
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
    return html`
      <div class="form" @keydown=${(event: KeyboardEvent) => submitOnEnter(event, save())}>
        <wt-form-error-summary
          heading=${t("form.error_heading")}
          .errors=${FIELDS.flatMap((f) => this.errors[f.field] ?? [])}
        ></wt-form-error-summary>
        ${FIELDS.map((f) => this.#renderField(f))}
        ${
          this.testPassed
            ? html`<p class="passed" data-test="test-passed" role="status">
                ${t("stream.form.test_passed")}
              </p>`
            : nothing
        }
        <wt-form-actions>
          ${
            canCancel
              ? html`<wt-button
                  slot="cancel"
                  variant="ghost"
                  data-test="cancel"
                  @click=${() => {
                    this.editing = false;
                    this.errors = {};
                    this.#clearMessages();
                  }}
                  >${t("stream.form.cancel")}</wt-button
                >`
              : nothing
          }
          <wt-button
            slot="secondary"
            variant="secondary"
            data-test="test"
            ?disabled=${this.submitting}
            @click=${() => void this.#test()}
            >${t("stream.form.test")}</wt-button
          >
          <wt-button
            variant="primary"
            data-test="save"
            ?disabled=${this.submitting}
            @click=${() => void this.#save()}
            >${t("stream.form.save")}</wt-button
          >
        </wt-form-actions>
      </div>
    `;
  }

  #renderField(f: (typeof FIELDS)[number]): TemplateResult {
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
      .error=${this.errors[f.field] ?? ""}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.draft = { ...this.draft, [f.field]: event.detail.value };
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
