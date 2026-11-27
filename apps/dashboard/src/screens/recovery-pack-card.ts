import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import type { DashboardApi } from "../api/client.js";
import type { RecoveryPackReason, RecoveryPackStatus } from "../api/backup-api.js";
import { DashboardQueries } from "../api/query-controller.js";
import { fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import type { RecoveryPackDialog, RecoveryPackMade } from "../widgets/recovery-pack-dialog.js";
import "../widgets/recovery-pack-dialog.js";
import type { BackupKeyDialog } from "../widgets/backup-key-dialog.js";
import "../widgets/backup-key-dialog.js";
import { keepDate, packDate, withStrong } from "../widgets/recovery-pack-words.js";

type Status = RecoveryPackStatus;
/** The Cloud reason is worded into the out-of-date sentence itself. */
type CloudReason = Extract<RecoveryPackReason, { part: "emergency" }>;
type Listed = Exclude<RecoveryPackReason, CloudReason>;
type Worded = Exclude<Listed, { kind: "key_changed" }>;

const isCloud = (reason: RecoveryPackReason): reason is CloudReason => reason.part === "emergency";

const REASON_WORDS: {
  [K in Worded["kind"]]: Record<Extract<Worded, { kind: K }>["part"], StringKey>;
} = {
  settings_changed: {
    bucket: "recovery_pack.reason.bucket_settings",
  },
  set_up_after: {
    bucket: "recovery_pack.reason.bucket_set_up",
  },
  removed: {
    bucket: "recovery_pack.reason.bucket_removed",
  },
};

function reasonWords(reason: Worded): StringKey {
  switch (reason.kind) {
    case "settings_changed":
      return REASON_WORDS.settings_changed[reason.part];
    case "set_up_after":
      return REASON_WORDS.set_up_after[reason.part];
    case "removed":
      return REASON_WORDS.removed[reason.part];
  }
}

function reasonSentences(reasons: Listed[], date: (iso: string) => string): string[] {
  return reasons.map((reason) =>
    reason.kind === "key_changed"
      ? fill("recovery_pack.reason.key_changed", { date: date(reason.at) })
      : t(reasonWords(reason)),
  );
}

/**
 * The Backups screen's Recovery pack card: what the box knows of the last pack, and the button that
 * makes a new one.
 */
@customElement("dashboard-recovery-pack-card")
export class RecoveryPackCard extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      h2 {
        font-size: var(--wt-font-size-lg);
        margin-block: 0 var(--wt-space-3);
      }
      p {
        margin-block: 0 var(--wt-space-3);
      }
      .line {
        margin-block: 0 var(--wt-space-4);
        padding: var(--wt-space-3) var(--wt-space-4);
        border-inline-start: 3px solid var(--wt-color-primary);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
      }
      .line.warn {
        border-inline-start-color: var(--wt-color-warning);
      }
      .line p {
        margin: 0;
      }
      .line p + p {
        margin-block-start: var(--wt-space-2);
      }
      .error {
        color: var(--wt-color-danger);
      }
      dl {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: var(--wt-space-2) var(--wt-space-5);
        margin: 0 0 var(--wt-space-4);
      }
      dl > div {
        display: contents;
      }
      dt {
        color: var(--wt-color-text-muted);
      }
      dd {
        margin: 0;
        color: var(--wt-color-text);
        overflow-wrap: break-word;
        min-width: 0;
      }
      @media (max-width: 600px) {
        dl {
          grid-template-columns: 1fr;
          row-gap: var(--wt-space-1);
        }
        dd {
          margin-block-end: var(--wt-space-2);
        }
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-4);
        align-items: center;
        justify-content: flex-end;
      }
      .made {
        margin-block-start: var(--wt-space-4);
      }
      a {
        color: var(--wt-color-primary-text);
        display: inline-flex;
        align-items: center;
        min-height: var(--wt-tap-min);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property({ type: Boolean }) canManage = false;

  @property({ type: Boolean }) openRequested = false;
  @state() private status: Status | null = null;
  @state() private failed = false;
  @state() private made: {
    url: string;
    number: number;
    madeAt: string;
  } | null = null;
  @query("dashboard-recovery-pack-dialog") private dialog!: RecoveryPackDialog | null;
  @query("dashboard-backup-key-dialog") private keyDialog!: BackupKeyDialog | null;

  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.failed = true;
    },
  );
  /** How many statuses the dialog has handed over; a read started before the latest is dropped. */
  #taken = 0;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated && this.canManage) this.#watch();
  }

  override willUpdate(changes: PropertyValues): void {
    if (changes.has("canManage") || changes.has("api")) {
      this.#forget();
      if (this.canManage && this.api && this.isConnected) this.#watch();
    }
    if (this.openRequested && this.canManage && this.api && (this.status !== null || this.failed)) {
      this.openRequested = false;
      const url = new URL(location.href);
      if (url.searchParams.get("recovery-pack") === "make") {
        url.searchParams.delete("recovery-pack");
        history.replaceState(history.state, "", url);
      }
      this.#make();
    }
  }

  override disconnectedCallback(): void {
    this.#forget();
    super.disconnectedCallback();
  }

  #forget(): void {
    this.#release();
    this.#dropMade();
    this.status = null;
    this.failed = false;
  }

  #dropMade(): void {
    if (this.made) URL.revokeObjectURL(this.made.url);
    this.made = null;
  }

  /** Reads the status again, after any read in flight; the Backups screen calls it after its writes. */
  reload(): void {
    this.api.liveData.invalidate([{ type: "recovery_packs" }]);
  }

  #watch(): void {
    if (!this.canManage) return;
    this.#queries
      .watchSent(
        "getRecoveryPackStatus",
        [],
        async (read) => {
          const taken = this.#taken;
          try {
            return { taken, status: await read() };
          } catch (error) {
            if (taken === this.#taken) throw error;
            return { taken, status: null };
          }
        },
        ({ taken, status }) => {
          if (taken !== this.#taken || status === null) return;
          this.status = status;
          this.failed = false;
        },
        { passive: true },
      )
      .catch(() => {});
  }

  #release(): void {
    this.#queries.release("getRecoveryPackStatus");
  }

  #take(status: Status): void {
    this.#taken++;
    this.status = status;
    this.failed = false;
  }

  /**
   * The PDF can hold secrets, so no link to it outlives the card or its permission. A pack older than
   * the one on offer, whose receipt was confirmed late, never replaces it; its receipt changes the
   * status either way.
   */
  #madeOne(made: RecoveryPackMade): void {
    if (!this.isConnected || !this.canManage) return;
    if (this.made !== null && made.number < this.made.number) {
      this.reload();
      return;
    }
    this.#dropMade();
    this.made = {
      url: URL.createObjectURL(made.pdf),
      number: made.number,
      madeAt: made.madeAt,
    };
    if (!this.dialog?.isOpen) this.reload();
  }

  #make(): void {
    if (this.#noMasterKey) {
      this.#makeMasterKey();
      return;
    }
    this.dispatchEvent(new CustomEvent("recovery-pack-make", { bubbles: true, composed: true }));
    this.dialog?.show(this.failed ? null : this.status, "pack");
  }

  /** Known only once a status has loaded: with no master key there is nothing to print a copy with. */
  get #noMasterKey(): boolean {
    return this.status !== null && !this.failed && this.status.masterKey === null;
  }

  /** Offered only once a status has loaded: the dialog's keep date comes from that status. */
  #makeMasterKey(): void {
    if (this.status === null || this.failed) return;
    this.dispatchEvent(new CustomEvent("recovery-pack-make", { bubbles: true, composed: true }));
    this.dialog?.show(this.status, "master-key");
  }

  #changeBackupKey(): void {
    if (this.status === null || this.failed) return;
    this.dispatchEvent(new CustomEvent("recovery-pack-make", { bubbles: true, composed: true }));
    this.keyDialog?.show(this.status);
  }

  #date(iso: string): string {
    return packDate(iso, this.status?.timeZone);
  }

  override render(): TemplateResult | typeof nothing {
    if (!this.canManage) return nothing;
    return html`<section aria-labelledby="recovery-pack-title">
      <h2 id="recovery-pack-title">${t("recovery_pack.title")}</h2>
      <p>${t("recovery_pack.intro")}</p>
      ${
        this.failed
          ? html`<div class="line warn">
              <p class="error" role="alert" data-test="pack-load-failed">
                ${t("recovery_pack.load_failed")}
              </p>
            </div>`
          : nothing
      }
      ${this.status && !this.failed ? this.#line(this.status) : nothing}
      ${this.status && !this.failed ? this.#rows(this.status) : nothing}
      <div class="actions">
        ${
          this.failed
            ? html`<wt-button
                data-test="pack-retry"
                variant="secondary"
                @click=${() => this.reload()}
                >${t("recovery_pack.retry")}</wt-button
              >`
            : nothing
        }
        ${
          this.#noMasterKey
            ? html`<wt-button
                data-test="make-master-key"
                variant="primary"
                @click=${() => this.#makeMasterKey()}
                >${t("recovery_pack.make_master_key")}</wt-button
              >`
            : nothing
        }
        ${
          this.status !== null && !this.failed && !this.#noMasterKey
            ? html`<wt-button
                  data-test="change-backup-key"
                  variant="secondary"
                  @click=${() => this.#changeBackupKey()}
                  >${t("recovery_pack.change_backup_key")}</wt-button
                ><wt-button
                  data-test="make-master-key"
                  variant="ghost"
                  @click=${() => this.#makeMasterKey()}
                  >${t("recovery_pack.make_master_key")}</wt-button
                >`
            : nothing
        }
        ${
          this.#noMasterKey
            ? nothing
            : html`<wt-button
                data-test="make-recovery-pack"
                variant="primary"
                @click=${() => this.#make()}
                >${t("recovery_pack.make")}</wt-button
              >`
        }
      </div>
      ${this.#made()}
      <dashboard-recovery-pack-dialog
        .api=${this.api}
        @recovery-pack-made=${(event: CustomEvent<RecoveryPackMade>) => this.#madeOne(event.detail)}
        @recovery-pack-status=${(event: CustomEvent<Status>) => this.#take(event.detail)}
        @recovery-pack-closed=${() => this.reload()}
      ></dashboard-recovery-pack-dialog>
      <dashboard-backup-key-dialog
        .api=${this.api}
        @backup-key-changed=${() => this.reload()}
      ></dashboard-backup-key-dialog>
    </section>`;
  }

  #line(status: Status): TemplateResult {
    const date = (iso: string) => this.#date(iso);
    const latest = status.latest;
    const holder = status.unreceived?.holdsCurrentMasterKey ? status.unreceived : null;
    const offered = holder?.offeredAtSetup ? holder : null;
    const lines: (string | TemplateResult)[] = [];
    let warn = true;
    const noMasterKey = status.masterKey === null;
    if (latest === null) {
      lines.push(t("recovery_pack.none"));
    } else if (holder === null && !latest.received) {
      lines.push(
        fill(
          noMasterKey ? "recovery_pack.not_received_no_master_key" : "recovery_pack.not_received",
          { number: String(latest.number), date: date(latest.madeAt) },
        ),
      );
    } else if (latest.received || offered?.number === latest.number) {
      const pack = { number: String(latest.number), date: date(latest.madeAt) };
      const listed = status.reasons.filter((reason): reason is Listed => !isCloud(reason));
      const cloud = listed.length < status.reasons.length;
      const reasons = reasonSentences(listed, date);
      if (status.incomplete) {
        const fixed = noMasterKey
          ? "recovery_pack.make_new_master_key_once_fixed"
          : "recovery_pack.make_new_once_fixed";
        lines.push(
          html`<strong>${fill("recovery_pack.incomplete", pack)}</strong> ${[
              ...reasons,
              ...(cloud ? [t("recovery_pack.reason.cloud_missing")] : []),
              t(fixed),
            ].join(" ")}`,
        );
      } else if ((latest.received && !status.upToDate) || reasons.length > 0 || cloud) {
        lines.push(
          html`<strong
              >${fill(cloud ? "recovery_pack.out_of_date_cloud" : "recovery_pack.out_of_date", pack)}</strong
            >
            ${[
              ...reasons,
              t(noMasterKey ? "recovery_pack.make_new_master_key" : "recovery_pack.make_new"),
            ].join(" ")}`,
        );
      } else if (holder === null) {
        warn = false;
        lines.push(
          latest.madeByName === null
            ? fill("recovery_pack.up_to_date_unnamed", pack)
            : fill("recovery_pack.up_to_date", { ...pack, name: latest.madeByName }),
        );
      }
    }
    if (holder !== null && offered === null)
      lines.push(
        withStrong(
          "recovery_pack.master_key_not_received",
          { number: String(holder.number), date: date(holder.madeAt) },
          "option",
          t("recovery_pack.make_master_key"),
        ),
      );
    if (offered !== null && lines.length === 0) warn = false;
    const keep = this.#keep(status, warn);
    if (keep.length > 0) lines.push(keep.join(" "));
    if (status.backupsUseOlderKey) lines.push(t("recovery_pack.older_key"));
    if (status.masterKey !== null && status.backupKey?.fromCurrentMasterKey === false) {
      warn = true;
      lines.push(t("recovery_pack.backup_key_old_master_key"));
    }
    return html`
      ${
        offered === null
          ? nothing
          : html`<div class="line" data-test="setup-pack-offered">
              <p>${fill("recovery_pack.offered_at_setup", { date: date(offered.madeAt) })}</p>
            </div>`
      }
      ${
        lines.length === 0
          ? nothing
          : html`<div class="line ${warn ? "warn" : ""}" data-test="pack-status">
              ${lines.map((words) => html`<p>${words}</p>`)}
            </div>`
      }
    `;
  }

  /** The keep-until sentences, from the server's list; never one naming an unreceived pack. */
  #keep(status: Status, warn: boolean): string[] {
    const unreceived = status.unreceived?.number;
    return status.keep
      .filter((pack) => pack.number !== unreceived)
      .filter((pack) => warn || pack.number !== status.latest?.number)
      .map((pack) =>
        fill("recovery_pack.keep_backup_key", {
          number: String(pack.number),
          date: this.#date(pack.madeAt),
          until: this.#date(pack.until),
        }),
      );
  }

  #rows(status: Status): TemplateResult {
    const latest = status.latest;
    const row = (name: string, label: StringKey, value: string) =>
      html`<div data-test="row-${name}">
        <dt>${t(label)}</dt>
        <dd>${value}</dd>
      </div>`;
    return html`<dl>
      ${row("last", "recovery_pack.row.last", this.#last(latest))}
      ${row("master-key", "recovery_pack.row.master_key", this.#masterKey(status))}
      ${row("backup-key", "recovery_pack.row.backup_key", this.#backupKey(status))}
    </dl>`;
  }

  #last(latest: Status["latest"]): string {
    if (latest === null) return t("recovery_pack.last_none");
    const pack = { number: String(latest.number), date: this.#date(latest.madeAt) };
    return latest.madeByName === null
      ? fill("recovery_pack.last_value_unnamed", pack)
      : fill("recovery_pack.last_value", { ...pack, name: latest.madeByName });
  }

  #masterKey(status: Status): string {
    const key = status.masterKey;
    if (key === null) return t("recovery_pack.master_key_none");
    if (key.pack === null) return key.name;
    return fill("recovery_pack.master_key_in", { name: key.name, number: String(key.pack) });
  }

  #backupKey(status: Status): string {
    const key = status.backupKey;
    if (key === null) return t("recovery_pack.backup_key_none");
    const words = { number: String(key.number), fingerprint: key.fingerprint };
    return key.changedAt === null
      ? fill("recovery_pack.backup_key_unchanged", words)
      : fill("recovery_pack.backup_key_changed", {
          ...words,
          date: keepDate(key.changedAt, status.timeZone),
        });
  }

  #made(): TemplateResult | typeof nothing {
    const made = this.made;
    if (made === null) return nothing;
    return html`<div class="made">
      <p data-test="pack-ready">
        ${fill("recovery_pack.ready", {
          number: String(made.number),
          date: this.#date(made.madeAt),
        })}
      </p>
      <div class="actions">
        <a
          data-test="download-pack"
          href=${made.url}
          download="waitron-recovery-pack-${made.number}.pdf"
          >${t("recovery_pack.download")}</a
        >
        <a data-test="print-pack" href=${made.url} target="_blank" rel="noopener noreferrer"
          >${t("recovery_pack.print")}</a
        >
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-recovery-pack-card": RecoveryPackCard;
  }
}
