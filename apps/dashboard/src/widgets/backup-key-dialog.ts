import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  type MasterKeyChangeDetail,
  type WtDialog,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-master-key-input.js";
import { MASTER_KEY_FIELD_WORDS } from "@waitron/recovery-pack/src/i18n/master-key-field.js";
import { MAX_PACK_PDF } from "@waitron/recovery-pack/src/pack-file.js";
import { loadRecoveryPackReader } from "@waitron/recovery-pack/src/load-pack-reader.js";
import type { DashboardApi } from "../api/client.js";
import type { BackupWriteAnswer, RecoveryPackStatus } from "../api/backup-api.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { hasCodeMessage } from "@waitron/dashboard-kit";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { LocaleChangeController } from "../state/locale-controller.js";

type Params = { keyName?: unknown; reloadErrorCode?: unknown };

const paramsOf = (error: unknown): Params =>
  ((error as { params?: Params } | null)?.params ?? {}) as Params;

/**
 * The rotate route's 4xx refusals come before it writes the key, except a too-short key set in the
 * box's own process environment; a 5xx can follow the write, and a lost answer (no status) may too.
 */
const refusedBeforeWriting = (error: unknown): boolean => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" && status < 500;
};

/** What the dialog says once the key may have been written. */
type Done = {
  /**
   * "confirmed": backups use the key; "older": the box says backups still use the old one;
   * "not_loaded": the settings did not load; "unconfirmed": the box could not tell.
   */
  outcome: "confirmed" | "older" | "not_loaded" | "unconfirmed";
  number: number;
  warnings: string[];
};

/**
 * Moves backups to the next backup key of the venue's master key, which the person types. Fires
 * `backup-key-changed` whenever the key may have changed, so the card reads its status again.
 */
@customElement("dashboard-backup-key-dialog")
export class BackupKeyDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
      p {
        margin: 0 0 var(--wt-space-3);
      }
      .warning {
        margin: var(--wt-space-3) 0 0;
        padding: var(--wt-space-3) var(--wt-space-4);
        border-inline-start: var(--wt-space-1) solid var(--wt-color-warning);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface);
      }
    `,
  ];

  @property({ attribute: false }) api!: Pick<
    DashboardApi,
    "rotateBackupKey" | "getRecoveryPackStatus" | "liveData"
  >;

  @state() private opened = false;
  /** The number the next key will have, from the card's status when the dialog opened. */
  @state() private next = 1;
  /** The current master key's name, from the card's status, so the field refuses another pack's. */
  @state() private keyName: string | undefined;
  @state() private key = "";
  @state() private busy = false;
  /** The box's wrong-key refusal, shown on the field until the key changes; null names no key. */
  @state() private keyRefusal: { keyName: string | null } | null = null;
  /** Any other refusal's sentence, on the form's own line, kept until the next press. */
  @state() private refusal = "";
  @state() private done: Done | null = null;

  #generation = 0;
  /** Set while the field empties itself for a new key name, so its emptying keeps the refusal. */
  #renaming = false;
  #scope?: DraftScope<{ key: string }>;
  #leave?: LeaveCoordinator;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  show(status: RecoveryPackStatus): void {
    if (this.opened) return;
    this.#generation++;
    this.next = (status.backupKey?.number ?? 0) + 1;
    this.keyName = status.masterKey?.name;
    this.key = "";
    this.busy = false;
    this.keyRefusal = null;
    this.refusal = "";
    this.done = null;
    const { coordinator, scope } = draftScopeFor<{ key: string }>(this, {
      id: this,
      current: () => ({ key: this.done === null ? this.key : "" }),
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => a.key === b.key,
      restore: () => {
        this.key = "";
        this.keyRefusal = null;
        this.refusal = "";
      },
    });
    this.#leave = coordinator;
    this.#scope = scope;
    scope.commit({ key: "" });
    this.opened = true;
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** Handed another api, it closes without a word: a change still out belongs to the old one. */
  override willUpdate(changes: PropertyValues<this>): void {
    if (changes.has("api") && changes.get("api") !== undefined && this.opened) this.#close();
  }

  override disconnectedCallback(): void {
    this.#close();
    super.disconnectedCallback();
  }

  #close(): void {
    this.#generation++;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.opened = false;
    this.busy = false;
    this.key = "";
    this.done = null;
  }

  #dialog(): WtDialog | null {
    return this.renderRoot.querySelector<WtDialog>("wt-dialog");
  }

  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.#leave ||
    !this.#scope ||
    (await this.#leave.request({ scopes: [this.#scope.id], reason, proceed() {} })) === "proceeded";

  /** Backups' status and the card both read again: either may now name another key. */
  #changed(api: this["api"]): void {
    api.liveData.invalidate([{ type: "backup_status" }]);
    this.dispatchEvent(new CustomEvent("backup-key-changed", { bubbles: true, composed: true }));
  }

  async #change(): Promise<void> {
    if (!this.opened || this.busy || this.key === "") return;
    const generation = this.#generation;
    const api = this.api;
    this.busy = true;
    this.refusal = "";
    this.keyRefusal = null;
    // Widened: `reloadFailed` changes it from inside a closure, which narrowing does not see.
    let outcome = "confirmed" as Done["outcome"];
    const warnings: string[] = [];
    const reloadFailed = (code: unknown) => {
      if (typeof code !== "string") return;
      outcome = "not_loaded";
      // reload_in_progress's own words say "try again", which here would write another key.
      warnings.push(
        hasCodeMessage(code) && code !== "backup.reload_in_progress"
          ? codeMessage(code)
          : t("backup.reload_failed_retry"),
      );
    };
    try {
      const answer: BackupWriteAnswer = await api.rotateBackupKey({ masterKey: this.key });
      reloadFailed(answer.reloadErrorCode);
    } catch (error) {
      if (generation !== this.#generation) return;
      const code = codeOf(error, "server.internal");
      if (code === "backup.rotation_metadata_failed") {
        warnings.push(codeMessage(code));
        reloadFailed(paramsOf(error).reloadErrorCode);
      } else if (code === "backup.effective_mismatch") {
        outcome = "unconfirmed";
      } else {
        this.busy = false;
        if (code === "promotion.break_glass_invalid") {
          const { keyName } = paramsOf(error);
          const named = typeof keyName === "string" ? keyName : null;
          this.keyRefusal = { keyName: named };
          if (named !== null && named !== this.keyName) {
            // A master key made while the dialog was open: the field checks packs against it now.
            this.keyName = named;
            this.#renaming = true;
            await this.updateComplete;
            await this.renderRoot.querySelector("wt-master-key-input")?.updateComplete;
            this.#renaming = false;
          }
          return;
        }
        this.refusal = codeMessage(code);
        if (refusedBeforeWriting(error)) return;
        this.#changed(api);
        const held = (await this.#status(api))?.backupKey?.number;
        if (generation !== this.#generation) return;
        if (held !== undefined) this.next = held + 1;
        return;
      }
    }
    this.#changed(api);
    const status = await this.#status(api);
    if (generation !== this.#generation) return;
    if (outcome === "not_loaded" && status?.backupsUseOlderKey) outcome = "older";
    this.busy = false;
    this.done = { outcome, number: status?.backupKey?.number ?? this.next, warnings };
    this.#scope?.commit({ key: "" });
  }

  /** The box's pack status now; null when the read fails. */
  async #status(api: this["api"]): Promise<RecoveryPackStatus | null> {
    try {
      return await api.getRecoveryPackStatus();
    } catch {
      return null;
    }
  }

  override render(): TemplateResult {
    return html`<wt-dialog
      data-test="backup-key-dialog"
      heading=${t("recovery_pack.change_backup_key")}
      .open=${this.opened}
      .dismissible=${!this.busy}
      .beforeClose=${this.#beforeClose}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) this.#close();
      }}
    >
      ${this.opened ? this.#body() : nothing} ${this.opened ? this.#footer() : nothing}
    </wt-dialog>`;
  }

  #body(): TemplateResult {
    const done = this.done;
    if (done !== null)
      return html`<p
          data-test="done"
          class=${done.outcome === "confirmed" ? "" : "warning"}
          role=${done.outcome === "confirmed" ? "status" : "alert"}
        >
          ${
            done.outcome === "confirmed"
              ? fill("backup_key_dialog.done", { number: String(done.number) })
              : done.outcome === "unconfirmed"
                ? fill("backup_key_dialog.unconfirmed", { number: String(done.number) })
                : done.outcome === "older"
                  ? t("recovery_pack.older_key")
                  : t("backup_key_dialog.saved_not_loaded")
          }
        </p>
        ${
          done.warnings.length === 0
            ? nothing
            : html`<p class="warning" data-test="done-warning" role="alert">
                ${done.warnings.join(" ")}
              </p>`
        }`;
    const words = MASTER_KEY_FIELD_WORDS[currentLocale().startsWith("es") ? "es" : "en"];
    return html`<p data-test="intro">
        ${fill("backup_key_dialog.text", { number: String(this.next) })}
      </p>
      <wt-master-key-input
        required
        .draftParent=${this}
        .copy=${words}
        .readPack=${loadRecoveryPackReader}
        .maxPdfBytes=${MAX_PACK_PDF}
        .keyName=${this.keyName}
        .disabled=${this.busy}
        .error=${
          this.keyRefusal === null
            ? ""
            : this.keyRefusal.keyName === null
              ? t("master_key_refusal.no_master_key")
              : words.wrongKey(this.keyRefusal.keyName)
        }
        @wt-change=${(event: CustomEvent<MasterKeyChangeDetail>) => {
          // The field empties itself as it leaves, after a change or on closing.
          if (this.done !== null || !this.opened) return;
          this.key = event.detail.masterKey ?? "";
          if (!this.#renaming) this.keyRefusal = null;
          this.#scope?.changed();
        }}
      ></wt-master-key-input>`;
  }

  #footer(): TemplateResult {
    if (this.done !== null)
      return html`<wt-form-actions slot="footer">
        <wt-button
          data-test="close-backup-key"
          variant="primary"
          @click=${() => {
            this.#dialog()?.closeAfter("saved");
            this.#close();
          }}
          >${t("action.close")}</wt-button
        >
      </wt-form-actions>`;
    return html`<wt-form-actions slot="footer" .error=${this.refusal}>
      <wt-button
        slot="cancel"
        data-test="cancel-backup-key"
        variant="secondary"
        ?disabled=${this.busy}
        @click=${() => void this.#dialog()?.requestClose("cancel")}
        >${t("action.cancel")}</wt-button
      >
      <wt-button
        data-test="change-backup-key"
        .variant=${this.busy || this.key !== "" ? "primary" : "secondary"}
        ?disabled=${this.busy || this.key === ""}
        @click=${() => void this.#change()}
        >${t("recovery_pack.change_backup_key")}</wt-button
      >
    </wt-form-actions>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-backup-key-dialog": BackupKeyDialog;
  }
}
