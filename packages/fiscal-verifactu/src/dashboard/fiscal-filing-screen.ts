import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-notice.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import {
  codeMessage,
  codeOf,
  currentLocale,
  formatIsoMinute,
  subscribeLocale,
} from "@waitron/dashboard-kit";
import type { EnvioState } from "../handover-summary.js";
import type {
  ActiveConflictView,
  FilingCaseView,
  FilingOverviewAnswer,
} from "../filing-overview-types.js";
import type { FiscalFilingClient } from "./fiscal-filing-client.js";
import { t } from "./strings.js";

const RECOVERY_PATH = "/manage/recovery/fiscal-conflict";
const PAGE_SIZE = 50;

/** The sending states in the order the screen lists them. */
const STATES: readonly EnvioState[] = [
  "pendiente",
  "enviando",
  "aceptado",
  "aceptado_con_errores",
  "rechazado",
  "detenido",
  "retenido",
];

const count = (value: number): string => value.toLocaleString(currentLocale());
const when = (iso: string | null): string =>
  iso === null ? t("fiscal_filing.none") : formatIsoMinute(iso);

function aeatSaid(state: string | null, code: string | number | null, description: string | null) {
  return [state, code, description].filter((part) => part !== null && part !== "").join(" ");
}

function field(label: string, value: string | TemplateResult | null) {
  return value === null || value === ""
    ? nothing
    : html`<div>
        <dt>${label}</dt>
        <dd>${value}</dd>
      </div>`;
}

function fingerprints(theirs: string | null, ours: string): TemplateResult {
  return html`${
      theirs === null
        ? nothing
        : html`<span class="fingerprint"
            >${t("fiscal_filing.detail.theirs", { fingerprint: theirs })}</span
          >`
    } <span class="fingerprint">${t("fiscal_filing.detail.ours", { fingerprint: ours })}</span>`;
}

function caseDetails(found: FilingCaseView): TemplateResult {
  const { record, submission, evidence } = found;
  const observations = [
    ...found.conflicts.map(
      (seen) =>
        html`<li>
          <span
            >${t("fiscal_filing.detail.observation", {
              attempt: seen.attempt,
              time: formatIsoMinute(seen.recordedAt),
              state: seen.line.EstadoRegistro ?? "",
              code: seen.line.CodigoErrorRegistro ?? "",
              description: seen.line.DescripcionErrorRegistro ?? "",
            }).trim()}</span
          >
          ${fingerprints(seen.comparison.storedFingerprint, record.huella)}
        </li>`,
    ),
    ...found.lookups.map(
      (seen) =>
        html`<li>
          <span
            >${t("fiscal_filing.detail.lookup", {
              time: formatIsoMinute(seen.recordedAt),
              state: seen.state,
            })}</span
          >
          ${fingerprints(seen.fingerprint, record.huella)}
        </li>`,
    ),
  ];
  return html`<dl>
    ${field(
      t("fiscal_filing.detail.invoice"),
      `${record.numSerieFactura} · ${record.fechaExpedicionFactura}`,
    )}
    ${field(t("fiscal_filing.detail.issuer"), record.idEmisorFactura)}
    ${field(
      t("fiscal_filing.detail.type"),
      [record.tipoRegistro, record.tipoFactura].filter((part) => part !== null).join(" · "),
    )}
    ${field(
      t("fiscal_filing.detail.total"),
      [record.importeTotal, record.cuotaTotal].filter((part) => part !== null).join(" · "),
    )}
    ${field(t("fiscal_filing.detail.generated"), record.fechaHoraHusoGenRegistro)}
    ${field(t("fiscal_filing.detail.installation"), record.numeroInstalacion)}
    ${field(
      t("fiscal_filing.detail.fingerprint"),
      html`<span class="fingerprint">${record.huella}</span>`,
    )}
    ${field(
      t("fiscal_filing.detail.previous"),
      record.anteriorHuella === null
        ? null
        : html`<span class="fingerprint">${record.anteriorHuella}</span>`,
    )}
    ${field(t("fiscal_filing.detail.then"), aeatSaid(null, evidence.codigo, evidence.mensaje))}
    ${field(
      t("fiscal_filing.detail.latest"),
      submission === null
        ? null
        : [
            aeatSaid(submission.estado, submission.codigoError, submission.mensajeError),
            submission.enviadoEn === null
              ? ""
              : t("fiscal_filing.detail.sent", { time: formatIsoMinute(submission.enviadoEn) }),
          ]
            .filter((part) => part !== "")
            .join(" · "),
    )}
    ${field(
      t("fiscal_filing.detail.observations"),
      observations.length === 0
        ? null
        : html`<ul>
            ${observations}
          </ul>`,
    )}
    ${field(t("fiscal_filing.detail.now"), t(`fiscal_filing.now.${found.cause}`))}
  </dl>`;
}

function conflictLine(conflict: ActiveConflictView): TemplateResult {
  const number = conflict.invoiceNumber;
  const evidence = conflict.evidence;
  let said: string;
  let theirs: string | null = null;
  if (conflict.source === "series") {
    said = t("fiscal_filing.conflict.series", { number });
    theirs = evidence !== null && "fingerprint" in evidence ? evidence.fingerprint : null;
  } else if (evidence === null) {
    said =
      conflict.cause === "fiscal.duplicado_anulado"
        ? t("fiscal_filing.conflict.cancelled", { number })
        : t("fiscal_filing.conflict.no_evidence", { number });
  } else if ("line" in evidence) {
    const line = evidence.line;
    said = t("fiscal_filing.conflict.reply", {
      number,
      state: line.EstadoRegistro ?? "",
      code: line.CodigoErrorRegistro ?? "",
      description: line.DescripcionErrorRegistro ?? "",
    }).trim();
    theirs = evidence.comparison.storedFingerprint;
  } else {
    said = t("fiscal_filing.conflict.lookup", { number, state: evidence.state });
    theirs = evidence.fingerprint;
  }
  return html`<li>
    <span>${said}</span>
    ${
      theirs === null
        ? nothing
        : html`<span class="fingerprint"
            >${t("fiscal_filing.conflict.theirs", { fingerprint: theirs })}</span
          >`
    }
    <span class="muted"
      >${t("fiscal_filing.conflict.seen", {
        installation: conflict.installationName,
        time: formatIsoMinute(conflict.observedAt),
      })}</span
    >
  </li>`;
}

/** Reads how this box's invoice records are being sent to AEAT. It changes nothing. */
@customElement("vf-fiscal-filing-screen")
export class FiscalFilingScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      h1 {
        margin-top: 0;
      }
      h2 {
        margin: var(--wt-space-6) 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
      }
      p {
        margin: 0;
      }
      .intro,
      .muted {
        color: var(--wt-color-text-muted);
      }
      .intro {
        margin-bottom: var(--wt-space-4);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2) var(--wt-space-3);
      }
      .error {
        margin-top: var(--wt-space-2);
        color: var(--wt-color-danger);
      }
      .box {
        display: grid;
        gap: var(--wt-space-2);
        margin-top: var(--wt-space-4);
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-warning);
        border-radius: var(--wt-radius-md);
      }
      .box.danger {
        border-color: var(--wt-color-danger);
      }
      .box ul {
        display: grid;
        gap: var(--wt-space-2);
        margin: 0;
        padding-inline-start: var(--wt-space-5);
      }
      .box li span {
        display: block;
      }
      .fingerprint {
        font-family: var(--wt-font-family-mono);
        font-size: var(--wt-font-size-sm);
        overflow-wrap: anywhere;
      }
      a {
        color: var(--wt-color-primary-text);
      }
      dl:not(.counts) {
        display: grid;
        gap: var(--wt-space-3);
        margin: 0;
      }
      dl:not(.counts) dt {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      dl:not(.counts) dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
      dd ul {
        display: grid;
        gap: var(--wt-space-2);
        margin: 0;
        padding-inline-start: var(--wt-space-5);
      }
      dd li span {
        display: block;
      }
      .held {
        margin-top: var(--wt-space-3);
      }
      .footer {
        display: flex;
        justify-content: end;
      }
      .counts {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3) var(--wt-space-6);
        margin: 0 0 var(--wt-space-3);
      }
      .counts dt {
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      .counts dd {
        margin: 0;
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
        font-variant-numeric: tabular-nums;
      }
    `,
  ];

  @property({ attribute: false }) client!: FiscalFilingClient;

  @state() private overview: FilingOverviewAnswer | null = null;
  @state() private loading = true;
  @state() private readError = "";
  @state() private exportError = "";
  @state() private exporting = false;
  @state() private page = 0;
  @state() private viewing: FilingCaseView | null = null;

  #generation = 0;
  #unsubscribeLocale?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#unsubscribeLocale = subscribeLocale(() => this.requestUpdate());
    void this.#read();
  }

  override disconnectedCallback(): void {
    this.#generation += 1;
    this.#unsubscribeLocale?.();
    super.disconnectedCallback();
  }

  async #read(): Promise<void> {
    const generation = ++this.#generation;
    this.loading = true;
    try {
      const overview = await this.client.read({ all: false });
      if (generation !== this.#generation) return;
      this.overview = overview;
      this.readError = "";
    } catch (error) {
      if (generation === this.#generation) this.readError = codeMessage(codeOf(error));
    } finally {
      if (generation === this.#generation) this.loading = false;
    }
  }

  async #export(): Promise<void> {
    if (this.exporting) return;
    this.exporting = true;
    this.exportError = "";
    try {
      const answer = await this.client.read({ all: true });
      const blob = new Blob([JSON.stringify(answer, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `fiscal-filing-${formatIsoMinute(answer.readAt).slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      this.exportError = codeMessage(codeOf(error));
    } finally {
      this.exporting = false;
    }
  }

  #columns(): DataTableColumn<FilingCaseView>[] {
    return [
      {
        key: "opened",
        label: t("fiscal_filing.column.opened"),
        cell: (row) => formatIsoMinute(row.openedAt),
      },
      {
        key: "invoice",
        label: t("fiscal_filing.column.invoice"),
        cell: (row) => `${row.record.numSerieFactura} · ${row.record.fechaExpedicionFactura}`,
      },
      {
        key: "reason",
        label: t("fiscal_filing.column.reason"),
        cell: (row) => t(`fiscal_filing.cause.${row.cause}`),
      },
      {
        key: "code",
        label: t("fiscal_filing.column.code"),
        cell: (row) => (row.evidence.codigo === null ? "—" : String(row.evidence.codigo)),
      },
      {
        key: "held",
        label: t("fiscal_filing.column.held"),
        align: "end",
        cell: (row) => count(row.heldBehind),
      },
      {
        key: "actions",
        label: t("fiscal_filing.column.actions"),
        pinned: "end",
        cell: (row) =>
          html`<wt-row-actions
            align="end"
            label=${`${t("fiscal_filing.column.actions")}: ${row.record.numSerieFactura}`}
            ><wt-button
              align="start"
              variant="secondary"
              data-test=${`view-${row.registroId}`}
              @click=${() => (this.viewing = row)}
              >${t("fiscal_filing.view")}</wt-button
            ></wt-row-actions
          >`,
      },
    ];
  }

  #cases(overview: FilingOverviewAnswer): TemplateResult {
    const cases = overview.cases;
    const lastPage = Math.max(0, Math.ceil(cases.length / PAGE_SIZE) - 1);
    const page = Math.min(this.page, lastPage);
    return html`${
        overview.totalCases > cases.length
          ? html`<p class="muted" data-test="bounded">
              ${t("fiscal_filing.cases.bounded", {
                shown: count(cases.length),
                total: count(overview.totalCases),
              })}
            </p>`
          : nothing
      }
      <wt-data-table
        data-test="case-table"
        aria-label=${t("fiscal_filing.cases")}
        emptyMessage=${t("fiscal_filing.cases.none")}
        .columns=${this.#columns()}
        .rows=${cases.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)}
        .rowKey=${(row: FilingCaseView) => row.registroId}
        .serverPaging=${
          cases.length > PAGE_SIZE ? { page, pageSize: PAGE_SIZE, total: cases.length } : undefined
        }
        .pageRangeLabel=${(from: number, to: number, total: number) =>
          t("fiscal_filing.cases.range", { from: count(from), to: count(to), total: count(total) })}
        previousPageLabel=${t("fiscal_filing.cases.previous")}
        nextPageLabel=${t("fiscal_filing.cases.next")}
        @wt-page-change=${(event: CustomEvent<{ page: number }>) => {
          this.page = event.detail.page;
        }}
      ></wt-data-table>`;
  }

  #details(): TemplateResult {
    const found = this.viewing;
    const close = () => (this.viewing = null);
    return html`<wt-modal
      size="compact"
      data-test="case-details"
      .open=${found !== null}
      heading=${found === null ? "" : t(`fiscal_filing.cause.${found.cause}`)}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        close();
      }}
    >
      ${found === null ? nothing : caseDetails(found)}
      <div slot="footer" class="footer">
        <wt-button variant="secondary" data-test="close" @click=${close}
          >${t("fiscal_filing.close")}</wt-button
        >
      </div>
    </wt-modal>`;
  }

  override render(): TemplateResult {
    const overview = this.overview;
    const state = overview === null ? (this.loading ? "loading" : "failed") : "read";
    return html`<h1>${t("fiscal_filing.title")}</h1>
      <p class="intro">${t("fiscal_filing.intro")}</p>
      <div class="actions" data-state=${state}>
        ${
          overview === null
            ? nothing
            : html`<span class="muted" data-test="read-at"
                >${t("fiscal_filing.read_at", { time: formatIsoMinute(overview.readAt) })}</span
              >`
        }
        <wt-button
          variant="secondary"
          data-test="refresh"
          ?loading=${this.loading}
          @click=${() => void this.#read()}
          >${t("fiscal_filing.refresh")}</wt-button
        >
        <wt-button
          variant="secondary"
          data-test="export"
          ?disabled=${overview === null}
          ?loading=${this.exporting}
          @click=${() => void this.#export()}
          >${t("fiscal_filing.export")}</wt-button
        >
      </div>
      ${
        this.readError === ""
          ? nothing
          : html`<p class="error" role="alert" data-test="read-error">${this.readError}</p>`
      }
      ${
        this.exportError === ""
          ? nothing
          : html`<p class="error" role="alert" data-test="export-error">${this.exportError}</p>`
      }
      ${overview === null ? nothing : this.#parts(overview)} ${this.#details()}`;
  }

  #parts(overview: FilingOverviewAnswer): TemplateResult {
    const { progress } = overview;
    const sendingOff = !overview.filing
      ? t("fiscal_filing.not_filing")
      : overview.awaitingCertificate
        ? t("fiscal_filing.awaiting_certificate")
        : null;
    return html`${
        overview.activeConflicts.length === 0
          ? nothing
          : html`<wt-notice duration="0">
              <div class="box danger" data-test="conflict">
                <p>
                  ${t("fiscal_filing.conflict.stopped")}
                  <a href=${RECOVERY_PATH}>${t("fiscal_filing.conflict.open")}</a>
                </p>
                <ul>
                  ${overview.activeConflicts.map(conflictLine)}
                </ul>
              </div>
            </wt-notice>`
      }
      ${
        sendingOff === null
          ? nothing
          : html`<wt-notice duration="0"
              ><p class="box" data-test="filing-off">${sendingOff}</p></wt-notice
            >`
      }
      <section aria-labelledby="fiscal-filing-progress" data-test="progress">
        <h2 id="fiscal-filing-progress">${t("fiscal_filing.progress")}</h2>
        <dl class="counts">
          ${STATES.map(
            (key) =>
              html`<div>
                <dt>${t(`fiscal_filing.state.${key}`)}</dt>
                <dd data-count=${key}>${count(progress.counts[key])}</dd>
              </div>`,
          )}
        </dl>
        <p data-test="oldest-waiting">
          <span class="muted">${t("fiscal_filing.oldest_waiting")}:</span>
          ${when(progress.oldestWaitingGeneratedAt)}
        </p>
        <p data-test="last-accepted">
          <span class="muted">${t("fiscal_filing.last_accepted")}:</span>
          ${when(progress.lastConfirmedAt)}
        </p>
      </section>
      <section data-test="cases">
        <h2>${t("fiscal_filing.cases")}</h2>
        ${this.#cases(overview)}
      </section>
      ${
        overview.heldWithoutCase === 0
          ? nothing
          : html`<p class="held" data-test="held-without-case">
              ${t("fiscal_filing.held_without_case", { count: count(overview.heldWithoutCase) })}
            </p>`
      }`;
  }
}
