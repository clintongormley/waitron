import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-button.js";
import { decimal, formatMoney } from "@waitron/shared";
import type { BackupAuditView, DashboardApi } from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";

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
        color: var(--wt-color-danger-text);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @state() private audit?: BackupAuditView;
  @state() private day?: string;
  @state() private error = "";
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
  override render() {
    const audit = this.audit;
    const charge = (row: { amount: string; settledAt: string; references: string[] }) =>
      html` <p>
          ${formatMoney(decimal(row.amount), currentLocale())} ·
          ${new Date(row.settledAt).toLocaleString(currentLocale(), { timeZone: audit!.timeZone })}
        </p>
        <p>${row.references.join(", ")}</p>`;
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
              ${audit.complete ? nothing : html`<p role="status">${t("payments.backup.incomplete")}</p>`}
              <h3>${t("payments.backup.matched")}</h3>
              <ul>
                ${audit.backupMatches.map(
                  (row) =>
                    html`<li>
                      ${charge(row)}
                      <p>
                        ${t("payments.backup.recorded")}: ${row.paymentRef} ·
                        ${t("payments.backup.order")}: ${row.workingOrderId}
                      </p>
                      ${row.externalMachine ? html`<p>${t("payments.backup.machine")}: ${row.externalMachine}</p>` : nothing}
                      ${row.externalRef ? html`<p>${t("payments.backup.operation")}: ${row.externalRef}</p>` : nothing}
                    </li>`,
                )}
              </ul>
              <h3>${t("payments.backup.exceptions")}</h3>
              <ul>
                ${audit.backupUnmatched.map(
                  (row) =>
                    html`<li>
                      ${charge(row)}
                      <p>${t(`payments.backup.${row.reason}`)}</p>
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
