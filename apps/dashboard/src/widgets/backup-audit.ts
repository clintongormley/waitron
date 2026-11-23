import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-data-table.js";
import { decimal, formatMoney } from "@waitron/shared";
import type { BackupAuditView, DashboardApi } from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";

type PairedRow = BackupAuditView["pairedAudit"]["rows"][number];
const statusFilters = ["problem", "matched", "resolved", "all"] as const;

@customElement("dashboard-backup-audit")
export class BackupAudit extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        margin-block: var(--wt-space-4);
      }
      ul {
        padding-inline-start: var(--wt-space-5);
      }
      li {
        margin-block: var(--wt-space-4);
        overflow-wrap: anywhere;
      }
      p {
        margin-block: var(--wt-space-2);
      }
      .error {
        color: var(--wt-color-danger);
      }
      wt-combobox {
        margin-block: var(--wt-space-2);
        width: max-content;
      }
      wt-data-table {
        --wt-table-cell-padding-inline: var(--wt-space-2);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @state() private audit?: BackupAuditView;
  @state() private day?: string;
  @state() private error = "";
  @state() private statusFilter: string = "problem";
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.error = codeOf(error);
    },
  );

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }
  async #load(): Promise<void> {
    await this.#queries
      .watch(
        "getBackupAudit",
        [this.day],
        (audit) => {
          this.audit = audit;
          this.error = "";
        },
        { passive: true },
      )
      .catch(() => undefined);
  }
  #paired(audit: BackupAuditView) {
    const paired = audit.pairedAudit;
    const locale = currentLocale();
    const time = new Intl.DateTimeFormat(locale, {
      timeZone: audit.timeZone,
      hour: "2-digit",
      minute: "2-digit",
    });
    const columns: DataTableColumn<PairedRow>[] = [
      {
        key: "time",
        label: t("payments.paired.time"),
        cell: (row) => time.format(new Date(row.settledAt)),
      },
      {
        key: "bill",
        label: t("orders.col.bill"),
        choosable: "shown",
        cell: ({ tableName, billNumber, orderNumber }) => {
          const label = fill(
            billNumber === null ? "payments.stuck.order" : "payments.paired.bill_number",
            {
              number: String(billNumber ?? orderNumber),
            },
          );
          return tableName ? `${tableName} · ${label}` : label;
        },
      },
      {
        key: "reader",
        label: t("payments.paired.reader"),
        choosable: "shown",
        cell: (row) => row.readerName,
      },
      {
        key: "amount",
        label: t("payments.stuck.amount"),
        align: "end",
        cell: (row) => formatMoney(decimal(row.amount), locale),
      },
      {
        key: "status",
        label: t("payments.reader_col_status"),
        cell: (row) => row.statuses.map((status) => t(`payments.paired.${status}`)).join(" · "),
      },
    ];
    const rows = paired.rows.filter(({ statuses }) => {
      const group = statuses.includes("resolved")
        ? "resolved"
        : statuses.includes("matched") || statuses.includes("refunded_before_check")
          ? "matched"
          : "problem";
      return this.statusFilter === "all" || this.statusFilter === group;
    });
    return html`
      <h3>${t("payments.paired.title")}</h3>
      <p>
        ${fill("payments.paired.totals", { matched: String(paired.matched), toCheck: String(paired.toCheck) })}
      </p>
      ${paired.complete ? nothing : html`<p role="status">${t("payments.paired.incomplete")}</p>`}
      <wt-combobox
        name="paired-status"
        label=${t("payments.reader_col_status")}
        preserve-order
        .value=${this.statusFilter}
        .options=${statusFilters.map((value) => ({ value, label: t(`payments.paired.${value}`) }))}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          this.statusFilter = event.detail.value;
        }}
      ></wt-combobox>
      <wt-data-table
        wrap-to-fit
        aria-label=${t("payments.paired.title")}
        viewKey="waitron.payments.paired-audit.table"
        customiseColumnsLabel=${t("table.customise_columns")}
        customiseLabel=${t("table.customise")}
        restoreColumnsLabel=${t("table.restore_columns")}
        doneLabel=${t("table.done")}
        moveColumnLabel=${t("table.move_column")}
        showColumnLabel=${t("table.show_column")}
        hideColumnLabel=${t("table.hide_column")}
        alwaysShownColumnLabel=${t("table.column_always_shown")}
        lastShownColumnLabel=${t("table.column_last_shown")}
        columnPositionLabel=${t("table.column_position")}
        .rows=${rows}
        .columns=${columns}
        .emptyMessage=${t("payments.paired.empty")}
      ></wt-data-table>
    `;
  }
  override render() {
    const audit = this.audit;
    const refunds = audit?.refundAudit;
    const charge = (row: { amount: string; settledAt: string; references: string[] }) =>
      html` <p>
          ${formatMoney(decimal(row.amount), currentLocale())} ·
          ${new Date(row.settledAt).toLocaleString(currentLocale(), { timeZone: audit!.timeZone })}
        </p>
        ${row.references.length ? html`<p>${row.references.join(", ")}</p>` : nothing}`;
    const details = (row: BackupAuditView["backupMatches"][number]) =>
      html` <p>
          ${t("payments.backup.recorded")}: ${row.paymentRef} · ${t("payments.backup.order")}:
          ${row.workingOrderId}
        </p>
        ${row.externalMachine ? html`<p>${t("payments.backup.machine")}: ${row.externalMachine}</p>` : nothing}
        ${row.externalRef ? html`<p>${t("payments.backup.operation")}: ${row.externalRef}</p>` : nothing}`;
    return html`<section aria-label=${t("payments.backup.title")}>
      <h2>${t("payments.backup.title")}</h2>
      <p>${t("payments.backup.note")}</p>
      <wt-input
        type="date"
        name="backup-day"
        label=${t("payments.backup.day")}
        .value=${this.day ?? audit?.day ?? ""}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(event.detail.value)) return;
          this.day = event.detail.value;
          this.audit = undefined;
          void this.#load();
        }}
      ></wt-input>
      <wt-button variant="secondary" @click=${() => void this.#load()}
        >${t("payments.backup.retry")}</wt-button
      >
      ${this.error ? html`<p class="error" role="alert">${codeMessage(this.error)}</p>` : nothing}
      ${
        audit
          ? html`
              <p>${audit.day} · ${audit.timeZone}</p>
              ${this.#paired(audit)}
              ${audit.complete ? nothing : html`<p role="status">${t("payments.backup.incomplete")}</p>`}
              ${
                refunds
                  ? html`
                      <h3>${t("payments.refunds.title")}</h3>
                      ${refunds.complete ? nothing : html`<p role="status">${t("payments.refunds.incomplete")}</p>`}
                      ${refunds.checkedAt.map((at) => html`<p>${t("payments.refunds.checked")}: ${new Date(at).toLocaleString(currentLocale(), { timeZone: audit.timeZone })}</p>`)}
                      ${(["matches", "agreements", "exceptions", "outside"] as const).map(
                        (group) => html`
                          <h4>${t(`payments.refunds.${group}`)}</h4>
                          <ul>
                            ${refunds[group].map(
                              (row) =>
                                html`<li>
                                  <p>${t(`payments.refunds.${row.reason}`)}</p>
                                  ${row.providerAt === null && row.localAt === null ? html`<p>${t("payments.refunds.unknown_date")}</p>` : nothing}
                                  ${row.charge ? html`<p>${t("payments.refunds.charge")} · ${formatMoney(decimal(row.charge.amount), currentLocale())} · ${new Date(row.charge.settledAt).toLocaleString(currentLocale(), { timeZone: audit.timeZone })}</p>` : nothing}
                                  <p>
                                    ${[row.processorRef, row.providerRefundRef, row.paymentRef, row.workingOrderId, row.externalMachine, row.externalRef].filter(Boolean).join(" · ")}
                                  </p>
                                  ${(["provider", "local"] as const).map((side) => {
                                    const amount =
                                      side === "provider" ? row.providerAmount : row.localAmount;
                                    const at = side === "provider" ? row.providerAt : row.localAt;
                                    return amount === null
                                      ? nothing
                                      : html`<p>
                                          ${t(`payments.refunds.${side}`)}:
                                          ${formatMoney(decimal(amount), currentLocale())}
                                          ${at ? new Date(at).toLocaleString(currentLocale(), { timeZone: audit.timeZone }) : nothing}
                                        </p>`;
                                  })}
                                </li>`,
                            )}
                          </ul>
                        `,
                      )}
                    `
                  : nothing
              }
              <h3>${t("payments.backup.matched")}</h3>
              <ul>
                ${audit.backupMatches.map((row) => html`<li>${charge(row)} ${details(row)}</li>`)}
              </ul>
              <h3>${t("payments.backup.exceptions")}</h3>
              <ul>
                ${audit.backupUnmatched.map(
                  (row) =>
                    html`<li>
                      ${charge(row)} ${row.kind === "recorded" ? details(row) : nothing}
                      <p>
                        ${t(`payments.backup.${row.kind === "recorded" && row.reason === "unmatched" ? "recorded_unmatched" : row.reason}`)}
                      </p>
                    </li>`,
                )}
              </ul>
              ${audit.backupMatches.length + audit.backupUnmatched.length === 0 ? html`<p>${t("payments.backup.empty")}</p>` : nothing}
            `
          : nothing
      }
    </section>`;
  }
}
