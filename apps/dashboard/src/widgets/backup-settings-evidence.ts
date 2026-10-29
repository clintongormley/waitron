import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, type WtDialog } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type {
  BackupEvidenceDestination,
  BackupLoadFailure,
  BackupLoadFailureDetail,
  BackupSettingsEvidence,
  DashboardApi,
} from "../api/client.js";
import { codeOf } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";

const PARTS: Readonly<Record<string, StringKey>> = {
  not_json: "backup_evidence.part.not_json",
  fields: "backup_evidence.part.fields",
  revision: "backup_evidence.part.revision",
  enabled: "backup_evidence.part.enabled",
  destinations: "backup_evidence.part.destinations",
  destination: "backup_evidence.part.destination",
  bucket: "backup_evidence.part.bucket",
  duplicate_id: "backup_evidence.part.duplicate_id",
  duplicate_dir: "backup_evidence.part.duplicate_dir",
  buckets: "backup_evidence.part.buckets",
  retention: "backup_evidence.part.retention",
  destinationTimeoutMs: "backup_evidence.part.destinationTimeoutMs",
  schedule: "backup_evidence.part.schedule",
};

const LOOKS: Readonly<Record<string, StringKey>> = {
  folder: "backup_evidence.look.folder",
  missing: "backup_evidence.look.missing",
  not_a_folder: "backup_evidence.look.not_a_folder",
  unknown: "backup_evidence.look.unknown",
};

const SHOWS_WRITTEN_TIME = new Set([
  "credentials.decrypt_failed",
  "credentials.malformed_payload",
  "server.credential_unusable",
]);
const NAMED_CAUSES = new Set([
  "credentials.key_version_unknown",
  "backup.archive_settings_invalid",
  "backup.recovery_key_missing",
  "backup.recovery_key_too_short",
  "server.config_invalid",
  ...SHOWS_WRITTEN_TIME,
]);

// The box's own environment, read on every load: saving again, replacing the key or restarting
// fails the same way until the variable itself is changed.
const EVERY_LOAD = new Set(["server.config_invalid"]);

const when = (iso: string) => new Date(iso).toLocaleString(currentLocale());

function cause(
  code: string,
  detail: BackupLoadFailureDetail | null,
  keys: BackupSettingsEvidence["boxKeyNumbers"],
  recordKeyVersion: number | null,
): string {
  const keyVersion = detail && "keyVersion" in detail ? String(detail.keyVersion) : null;
  switch (code) {
    case "credentials.key_version_unknown":
      if (keyVersion === null) break;
      return keys.previous === undefined
        ? fill("backup_evidence.cause.key_version_unknown", {
            n: keyVersion,
            m: String(keys.current),
          })
        : fill("backup_evidence.cause.key_version_unknown_two", {
            n: keyVersion,
            m: String(keys.current),
            p: String(keys.previous),
          });
    case "credentials.decrypt_failed":
      return recordKeyVersion === null
        ? t("backup_evidence.cause.decrypt_failed_plain")
        : fill("backup_evidence.cause.decrypt_failed", { n: String(recordKeyVersion) });
    case "credentials.malformed_payload":
    case "server.credential_unusable":
      return t("backup_evidence.cause.malformed");
    case "backup.archive_settings_invalid": {
      const reason = detail && "reason" in detail ? PARTS[detail.reason] : undefined;
      return fill("backup_evidence.cause.settings_invalid", {
        part: t(reason ?? "backup_evidence.part.contents"),
      });
    }
    case "backup.recovery_key_missing":
      return t("backup_evidence.cause.recovery_key_missing");
    case "backup.recovery_key_too_short":
      if (!detail || !("min" in detail)) break;
      return fill("backup_evidence.cause.recovery_key_too_short", { min: String(detail.min) });
    case "server.config_invalid":
      if (!detail || !("variable" in detail)) break;
      return fill("backup_evidence.cause.config_invalid", { variable: detail.variable });
  }
  return fill("backup_evidence.cause.unknown", { code });
}

/** Read-only panel: what the box recorded about failing to load its saved backup settings. */
@customElement("dashboard-backup-settings-evidence")
export class BackupSettingsEvidenceDialog extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this, () => this.requestUpdate());
  }
  static override styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
      .body {
        display: grid;
        gap: var(--wt-space-3);
        width: var(--wt-form-max-width);
        max-width: 100%;
      }
      h3 {
        margin: 0;
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
      }
      p,
      dl,
      ol,
      ul {
        margin: 0;
        overflow-wrap: anywhere;
      }
      ol,
      ul {
        display: grid;
        gap: var(--wt-space-2);
        padding-inline-start: var(--wt-space-4);
      }
      .facts {
        display: grid;
        gap: var(--wt-space-2);
      }
      time,
      .note {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      dl {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: var(--wt-space-1) var(--wt-space-3);
      }
      dt {
        color: var(--wt-color-text-muted);
      }
      dd {
        margin: 0;
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) api!: Pick<DashboardApi, "getBackupSettingsEvidence">;
  @state() private evidence: BackupSettingsEvidence | null = null;
  @state() private reading = false;
  @state() private failure: "refused" | "failed" | null = null;
  #opened = false;
  #generation = 0;

  #release() {
    this.#generation++;
    this.#opened = false;
    this.evidence = null;
    this.reading = false;
    this.failure = null;
  }
  override disconnectedCallback(): void {
    this.#release();
    this.open = false;
    super.disconnectedCallback();
  }
  override willUpdate(): void {
    if (!this.isConnected) return;
    if (!this.open) {
      if (this.#opened) this.#release();
      return;
    }
    if (!this.#opened) {
      this.#opened = true;
      void this.#read();
    }
  }
  async #read() {
    const generation = ++this.#generation,
      api = this.api;
    const current = () =>
      this.isConnected && this.open && generation === this.#generation && api === this.api;
    this.reading = true;
    this.failure = null;
    try {
      const evidence = await api.getBackupSettingsEvidence();
      if (!current()) return;
      this.evidence = evidence;
    } catch (error) {
      if (!current()) return;
      this.evidence = null;
      this.failure = codeOf(error) === "authorization.not_permitted" ? "refused" : "failed";
    } finally {
      if (generation === this.#generation) this.reading = false;
    }
  }
  #stop() {
    this.#generation++;
    this.reading = false;
    void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")?.requestClose("cancel");
  }
  #close() {
    this.#release();
    this.open = false;
    this.dispatchEvent(new CustomEvent("evidence-close", { bubbles: true, composed: true }));
  }
  #signIn() {
    this.dispatchEvent(new CustomEvent("admin-sign-in", { bubbles: true, composed: true }));
    this.#stop();
  }

  #failure(
    item: BackupLoadFailure,
    older: BackupLoadFailure | undefined,
    e: BackupSettingsEvidence,
  ) {
    const rewritten = older !== undefined && older.recordDigest !== item.recordDigest;
    const written =
      item.recordWrittenAt !== null &&
      (SHOWS_WRITTEN_TIME.has(item.code) || !NAMED_CAUSES.has(item.code));
    return html`<li data-test="failure">
      <time datetime=${item.at}>${when(item.at)}</time>
      <p data-test="failure-cause">
        ${cause(
          item.code,
          item.detail,
          e.boxKeyNumbers,
          e.record && item.recordDigest === e.record.digest ? e.record.keyVersion : null,
        )}
      </p>
      ${
        written
          ? html`<p class="note" data-test="failure-written">
              ${fill("backup_evidence.written_then", { time: when(item.recordWrittenAt!) })}
            </p>`
          : nothing
      }
      ${
        rewritten
          ? html`<p class="note" data-test="failure-again">
              ${
                item.recordWrittenAt
                  ? fill("backup_evidence.again_rewritten", { time: when(item.recordWrittenAt) })
                  : t("backup_evidence.again_changed")
              }
            </p>`
          : nothing
      }
    </li>`;
  }
  #destination(destination: BackupEvidenceDestination) {
    if (destination.kind === "folder")
      return html`<li data-test="destination">
        <dl>
          <dt>${t("backup_evidence.folder")}</dt>
          <dd>${destination.dir}</dd>
        </dl>
        <p>${t(LOOKS[destination.look] ?? "backup_evidence.look.unknown")}</p>
      </li>`;
    const rows: [StringKey, string | null][] = [
      ["backup_evidence.address", destination.endpoint],
      ["backup_evidence.region", destination.region],
      ["backup_evidence.bucket", destination.bucket],
      ["backup_evidence.access_key_id", destination.accessKeyId],
      ["backup_evidence.archive_folder", destination.archiveFolder],
    ];
    return html`<li data-test="destination">
      <dl>
        ${rows.map(([label, value]) =>
          value === null
            ? nothing
            : html`<dt>${t(label)}</dt>
                <dd>${value}</dd>`,
        )}
      </dl>
    </li>`;
  }
  #recordNow(e: BackupSettingsEvidence) {
    const keys = e.boxKeyNumbers;
    const usableKey = e.recoveryKey.held && !e.recoveryKey.tooShort;
    return html`<div class="facts" data-test="record-now">
      ${
        e.rewrittenSinceLastFailure
          ? html`<p data-test="record-changed">
              ${t(e.record ? "backup_evidence.rewritten" : "backup_evidence.removed")}
            </p>`
          : nothing
      }
      ${
        e.record
          ? html`<p>
              ${fill("backup_evidence.written", {
                time: when(e.record.writtenAt),
                n: String(e.record.keyVersion),
              })}
            </p>`
          : e.now.state === "absent"
            ? html`<p>${t("backup_evidence.absent")}</p>`
            : nothing
      }
      <p>
        ${
          keys.previous === undefined
            ? fill("backup_evidence.box_keys", { m: String(keys.current) })
            : fill("backup_evidence.box_keys_two", {
                m: String(keys.current),
                p: String(keys.previous),
              })
        }
      </p>
      ${
        e.managedByEnvironment
          ? html`<p>${t("backup_evidence.managed")}</p>`
          : e.now.state === "readable"
            ? html`<ul>
                ${e.now.destinations.map((destination) => this.#destination(destination))}
              </ul>`
            : e.now.state === "unreadable"
              ? html`<p data-test="now-cause">
                    ${cause(e.now.code, e.now.detail, keys, e.record?.keyVersion ?? null)}
                  </p>
                  <p>${t("backup_evidence.cannot_tell")}</p>`
              : nothing
      }
      <h3>${t("backup_evidence.key_heading")}</h3>
      <p>
        ${
          !e.recoveryKey.held
            ? t("backup_evidence.key.missing")
            : e.recoveryKey.tooShort
              ? t("backup_evidence.key.too_short")
              : e.recoveryKey.fingerprint
                ? fill("backup_evidence.key.usable", { fingerprint: e.recoveryKey.fingerprint })
                : t("backup_evidence.key.usable_plain")
        }
      </p>
      ${
        e.now.state === "readable" &&
        usableKey &&
        !e.managedByEnvironment &&
        e.latestLoadFailed &&
        e.failures[0] !== undefined &&
        !EVERY_LOAD.has(e.failures[0].code)
          ? html`<p data-test="reads-now">${t("backup_evidence.reads_now")}</p>`
          : nothing
      }
    </div>`;
  }
  #facts(e: BackupSettingsEvidence) {
    return html`<h3>${t("backup_evidence.happened")}</h3>
      ${
        e.failures.length
          ? html`<ol>
              ${e.failures.map((item, index) => this.#failure(item, e.failures[index + 1], e))}
            </ol>`
          : html`<p>${t("backup_evidence.no_failures")}</p>`
      }
      <h3>${t("backup_evidence.now_heading")}</h3>
      ${this.#recordNow(e)}
      <p data-test="evidence-choices">
        ${fill(
          e.now.state === "absent" ? "backup_evidence.turn_on_new" : "backup_evidence.turn_on",
          { apply: t("backup.apply") },
        )}
        ${fill("backup_evidence.choices", {
          read_again: t("backup_evidence.read_again"),
          stop: t("backup_evidence.stop"),
        })}
      </p>`;
  }
  #body() {
    if (this.failure === "refused")
      return html`<p class="error" role="alert" data-test="evidence-refused">
        ${t("backup_evidence.not_permitted")}
      </p>`;
    return html`${
      this.failure === "failed"
        ? html`<p class="error" role="alert" data-test="evidence-failed">
            ${fill("backup_evidence.failed", { read_again: t("backup_evidence.read_again") })}
          </p>`
        : nothing
    }
    ${
      !this.evidence && this.reading
        ? html`<p role="status">${t("backup_evidence.reading")}</p>`
        : nothing
    }
    ${this.evidence ? this.#facts(this.evidence) : nothing}`;
  }
  override render() {
    return html`<wt-dialog
      .open=${this.open}
      heading=${t("backup_evidence.heading")}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#close();
      }}
    >
      ${this.open ? html`<div class="body">${this.#body()}</div>` : nothing}
      <wt-form-actions slot="footer">
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="evidence-stop"
          @click=${() => this.#stop()}
          >${t("backup_evidence.stop")}</wt-button
        >
        ${
          this.failure === "refused"
            ? html`<wt-button
                variant="primary"
                data-test="admin-sign-in"
                @click=${() => this.#signIn()}
                >${t("staff.sign_in_as_admin")}</wt-button
              >`
            : html`<wt-button
                variant="primary"
                data-test="evidence-read-again"
                ?loading=${this.reading}
                @click=${() => void this.#read()}
                >${t("backup_evidence.read_again")}</wt-button
              >`
        }
      </wt-form-actions>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-backup-settings-evidence": BackupSettingsEvidenceDialog;
  }
}
