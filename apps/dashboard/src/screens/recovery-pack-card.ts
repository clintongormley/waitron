import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import type { DashboardApi, RecoveryPackReason, RecoveryPackStatus } from "../api/client.js";
import { fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import type { RecoveryPackDialog, RecoveryPackMade } from "../widgets/recovery-pack-dialog.js";
import "../widgets/recovery-pack-dialog.js";
import { keyHolder, packDate, unreceivedWords } from "../widgets/recovery-pack-words.js";

type Status = RecoveryPackStatus;
type Worded = Exclude<RecoveryPackReason, { kind: "key_changed" }>;

const REASON_WORDS: {
  [K in Worded["kind"]]: Record<Extract<Worded, { kind: K }>["part"], StringKey>;
} = {
  settings_changed: {
    bucket: "recovery_pack.reason.bucket_settings",
    archives: "recovery_pack.reason.archives_settings",
  },
  set_up_after: {
    bucket: "recovery_pack.reason.bucket_set_up",
    archives: "recovery_pack.reason.archives_set_up",
    "server-key": "recovery_pack.reason.server_key_set_up",
  },
  removed: {
    bucket: "recovery_pack.reason.bucket_removed",
    archives: "recovery_pack.reason.archives_removed",
    "server-key": "recovery_pack.reason.server_key_removed",
  },
  key_replaced: { "server-key": "recovery_pack.reason.server_key_replaced" },
};

function reasonWords(reason: Worded): StringKey {
  switch (reason.kind) {
    case "settings_changed":
      return REASON_WORDS.settings_changed[reason.part];
    case "set_up_after":
      return REASON_WORDS.set_up_after[reason.part];
    case "removed":
      return REASON_WORDS.removed[reason.part];
    case "key_replaced":
      return REASON_WORDS.key_replaced[reason.part];
  }
}

/** Each reason's sentence once: the bucket copy and the archives share one backup key. */
function reasonSentences(reasons: Status["reasons"], date: (iso: string) => string): string[] {
  const sentences = reasons.map((reason) =>
    reason.kind === "key_changed"
      ? fill("recovery_pack.reason.key_changed", { date: date(reason.at) })
      : t(reasonWords(reason)),
  );
  return [...new Set(sentences)];
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

  @property({ attribute: false }) api!: Pick<
    DashboardApi,
    | "getProfile"
    | "recoveryPackPasskeyOptions"
    | "makeRecoveryPack"
    | "markRecoveryPackReceived"
    | "getRecoveryPackStatus"
  >;
  @property({ type: Boolean }) canManage = false;

  @state() private status: Status | null = null;
  @state() private failed = false;
  /** `arrivedAt` is the browser's time, used only until a status names the pack's own time. */
  @state() private made: {
    url: string;
    number: number;
    key: RecoveryPackMade["key"];
    arrivedAt: string;
  } | null = null;
  @query("dashboard-recovery-pack-dialog") private dialog!: RecoveryPackDialog | null;

  #generation = 0;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated && this.canManage) this.reload();
  }

  override willUpdate(changes: PropertyValues): void {
    if (changes.has("canManage") || changes.has("api")) {
      this.#forget();
      if (this.canManage && this.api && this.isConnected) this.reload();
    }
  }

  override disconnectedCallback(): void {
    this.#forget();
    super.disconnectedCallback();
  }

  #forget(): void {
    this.#generation++;
    this.#dropMade();
    this.status = null;
    this.failed = false;
  }

  #dropMade(): void {
    if (this.made) URL.revokeObjectURL(this.made.url);
    this.made = null;
  }

  /** Reads the status again; an answer to an earlier read is dropped. */
  reload(): void {
    void this.#read();
  }

  async #read(): Promise<void> {
    if (!this.canManage) return;
    const generation = ++this.#generation;
    const api = this.api;
    try {
      const status = await api.getRecoveryPackStatus();
      if (generation !== this.#generation) return;
      this.status = status;
      this.failed = false;
    } catch {
      if (generation === this.#generation) this.failed = true;
    }
  }

  #take(status: Status): void {
    this.#generation++;
    this.status = status;
    this.failed = false;
  }

  /**
   * The PDF may hold the server's secret key, so no link to it outlives the card or its permission.
   * A pack older than the one on offer, whose receipt was confirmed late, replaces it only when it
   * alone holds a new server key; its receipt changes the status either way.
   */
  #madeOne(made: RecoveryPackMade): void {
    if (!this.isConnected || !this.canManage) return;
    const older = this.made !== null && made.number < this.made.number;
    if (older && !(made.key === "replaced" && this.made?.key !== "replaced")) {
      this.reload();
      return;
    }
    this.#dropMade();
    this.made = {
      url: URL.createObjectURL(made.pdf),
      number: made.number,
      key: made.key,
      arrivedAt: new Date().toISOString(),
    };
    if (!this.dialog?.isOpen) this.reload();
  }

  #make(): void {
    this.dispatchEvent(new CustomEvent("recovery-pack-make", { bubbles: true, composed: true }));
    this.dialog?.show(this.failed ? null : this.status);
  }

  /** The box's own time for pack `number`, as the status names it. */
  #madeAt(number: number): string | undefined {
    const status = this.status;
    return [status?.latest, status?.unreceived, ...(status?.keep ?? [])].find(
      (pack) => pack?.number === number,
    )?.madeAt;
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
        <wt-button data-test="make-recovery-pack" variant="primary" @click=${() => this.#make()}
          >${t("recovery_pack.make")}</wt-button
        >
      </div>
      ${this.#made()}
      <dashboard-recovery-pack-dialog
        .api=${this.api}
        @recovery-pack-made=${(event: CustomEvent<RecoveryPackMade>) => this.#madeOne(event.detail)}
        @recovery-pack-status=${(event: CustomEvent<Status>) => this.#take(event.detail)}
        @recovery-pack-closed=${() => this.reload()}
      ></dashboard-recovery-pack-dialog>
    </section>`;
  }

  #line(status: Status): TemplateResult {
    const date = (iso: string) => this.#date(iso);
    const latest = status.latest;
    const keyOn = keyHolder(status);
    const holder = keyOn !== null && !keyOn.received ? keyOn : null;
    const lines: (string | TemplateResult)[] = [];
    let warn = true;
    if (latest === null) {
      lines.push(t("recovery_pack.none"));
    } else if (holder === null && !latest.received) {
      lines.push(
        fill("recovery_pack.not_received", {
          number: String(latest.number),
          date: date(latest.madeAt),
        }),
      );
    } else if (latest.received) {
      const pack = { number: String(latest.number), date: date(latest.madeAt) };
      const reasons = reasonSentences(status.reasons, date);
      if (status.incomplete) {
        lines.push(
          html`<strong>${fill("recovery_pack.incomplete", pack)}</strong> ${reasons.join(" ")}`,
        );
      } else if (!status.upToDate || reasons.length > 0) {
        lines.push(
          html`<strong>${fill("recovery_pack.out_of_date", pack)}</strong> ${[
              ...reasons,
              t("recovery_pack.make_new"),
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
    if (holder !== null) lines.push(unreceivedWords(holder, status.timeZone));
    const keep = this.#keep(status, warn);
    if (keep.length > 0) lines.push(keep.join(" "));
    if (status.backupsUseOlderKey) lines.push(t("recovery_pack.older_key"));
    return html`<div class="line ${warn ? "warn" : ""}" data-test="pack-status">
      ${lines.map((words) => html`<p>${words}</p>`)}
    </div>`;
  }

  /** The keep-until sentences, from the server's list; never one naming an unreceived pack. */
  #keep(status: Status, warn: boolean): string[] {
    const unreceived = status.unreceived?.number;
    return status.keep
      .filter((pack) => pack.number !== unreceived)
      .filter((pack) => warn || pack.number !== status.latest?.number)
      .flatMap((pack) => {
        const values = { number: String(pack.number), date: this.#date(pack.madeAt) };
        if (pack.why === "server_key") return [fill("recovery_pack.keep_server_key", values)];
        if (pack.until === null) return [];
        return [
          fill(
            pack.why === "backup_key"
              ? "recovery_pack.keep_backup_key"
              : "recovery_pack.keep_old_server_key",
            { ...values, until: this.#date(pack.until) },
          ),
        ];
      });
  }

  #rows(status: Status): TemplateResult {
    const latest = status.latest;
    const row = (name: string, label: StringKey, value: string) =>
      html`<div data-test="row-${name}">
        <dt>${t(label)}</dt>
        <dd>${value}</dd>
      </div>`;
    if (latest === null)
      return html`<dl>${row("last", "recovery_pack.row.last", t("recovery_pack.last_none"))}</dl>`;
    const pack = { number: String(latest.number), date: this.#date(latest.madeAt) };
    return html`<dl>
      ${row(
        "last",
        "recovery_pack.row.last",
        latest.madeByName === null
          ? fill("recovery_pack.last_value_unnamed", pack)
          : fill("recovery_pack.last_value", { ...pack, name: latest.madeByName }),
      )}
      ${row("backup-key", "recovery_pack.row.backup_key", this.#backupKey(status, pack))}
      ${row("server-key", "recovery_pack.row.server_key", this.#serverKey(status))}
    </dl>`;
  }

  #backupKey(status: Status, pack: { number: string; date: string }): string {
    const changed = status.reasons.find((reason) => reason.kind === "key_changed");
    if (changed?.at)
      return fill("recovery_pack.backup_key_changed", {
        date: this.#date(changed.at),
        number: pack.number,
        packDate: pack.date,
      });
    const holds = status.latest!.parts.some(
      (part) => part.part !== "server-key" && part.state === "included",
    );
    return fill(holds ? "recovery_pack.backup_key_same" : "recovery_pack.backup_key_absent", pack);
  }

  #serverKey(status: Status): string {
    const holder = keyHolder(status);
    if (holder !== null)
      return fill(
        holder.received ? "recovery_pack.server_key_on" : "recovery_pack.server_key_on_unreceived",
        { number: String(holder.number), date: this.#date(holder.madeAt) },
      );
    const part = status.latest?.parts.find((p) => p.part === "server-key");
    return t(
      part?.state === "absent"
        ? "recovery_pack.server_key_none"
        : "recovery_pack.server_key_elsewhere",
    );
  }

  #made(): TemplateResult | typeof nothing {
    const made = this.made;
    if (made === null) return nothing;
    return html`<div class="made">
      <p data-test="pack-ready">
        ${fill("recovery_pack.ready", {
          number: String(made.number),
          date: this.#date(this.#madeAt(made.number) ?? made.arrivedAt),
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
