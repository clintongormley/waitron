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
 * The rotate route refuses with a 4xx only before it writes the key; a 5xx can follow the write, and
 * a lost answer (no status) may too.
 */
const refusedBeforeWriting = (error: unknown): boolean => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" && status < 500;
};

/** What the dialog says once the key may have been written. */
type Done = {
  /** "confirmed": backups use the key; "not_loaded": the box still uses the old one; "unconfirmed": unknown. */
  outcome: "confirmed" | "not_loaded" | "unconfirmed";
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
  @state() private key = "";
  @state() private busy = false;
  /** The wrong-key sentence, shown on the field until the key changes. */
  @state() private keyRefusal = "";
  /** Any other refusal's sentence, on the form's own line, kept until the next press. */
  @state() private refusal = "";
  @state() private done: Done | null = null;

  #generation = 0;
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
    this.key = "";
    this.busy = false;
    this.keyRefusal = "";
    this.refusal = "";
    this.done = null;
    const { coordinator, scope } = draftScopeFor<{ key: string }>(this, {
      id: this,
      current: () => ({ key: this.done === null ? this.key : "" }),
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => a.key === b.key,
      restore: () => {
        this.key = "";
        this.keyRefusal = "";
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
    this.keyRefusal = "";
    let outcome: Done["outcome"] = "confirmed";
    const warnings: string[] = [];
    const reloadFailed = (code: unknown) => {
      if (typeof code !== "string") return;
      outcome = "not_loaded";
      warnings.push(hasCodeMessage(code) ? codeMessage(code) : t("backup.reload_failed_retry"));
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
        if (code === "master_key.wrong") {
          this.keyRefusal = codeMessage(code, currentLocale(), paramsOf(error));
          return;
        }
        this.refusal = codeMessage(code);
        if (refusedBeforeWriting(error)) return;
        this.#changed(api);
        const held = await this.#heldNumber(api);
        if (generation !== this.#generation) return;
        if (held !== null) this.next = held + 1;
        return;
      }
    }
    this.#changed(api);
    const number = (await this.#heldNumber(api)) ?? this.next;
    if (generation !== this.#generation) return;
    this.busy = false;
    this.done = { outcome, number, warnings };
    this.#scope?.commit({ key: "" });
  }

  /** The number of the key the box holds now; null when the read fails or names none. */
  async #heldNumber(api: this["api"]): Promise<number | null> {
    try {
      return (await api.getRecoveryPackStatus()).backupKey?.number ?? null;
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
                : t("recovery_pack.older_key")
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
        .disabled=${this.busy}
        .error=${this.keyRefusal}
        @wt-change=${(event: CustomEvent<MasterKeyChangeDetail>) => {
          // The field empties itself as it leaves, after a change or on closing.
          if (this.done !== null || !this.opened) return;
          this.key = event.detail.masterKey ?? "";
          this.keyRefusal = "";
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
        variant="primary"
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
