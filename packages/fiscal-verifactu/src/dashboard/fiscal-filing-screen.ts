import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-notice.js";
import {
  codeMessage,
  codeOf,
  currentLocale,
  formatIsoMinute,
  subscribeLocale,
} from "@waitron/dashboard-kit";
import type { EnvioState } from "../handover-summary.js";
import type { ActiveConflictView, FilingOverviewAnswer } from "../filing-overview-types.js";
import type { FiscalFilingClient } from "./fiscal-filing-client.js";
import { t } from "./strings.js";

const RECOVERY_PATH = "/manage/recovery/fiscal-conflict";

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

function conflictLine(conflict: ActiveConflictView): TemplateResult {
  const number = conflict.invoiceNumber;
  const evidence = conflict.evidence;
  let said: string;
  let theirs: string | null = null;
  if (evidence === null) {
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

  // Part 2 completes the export: read with every case, then save the answer as one file.
  #export(): void {}

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
          @click=${() => this.#export()}
          >${t("fiscal_filing.export")}</wt-button
        >
      </div>
      ${
        this.readError === ""
          ? nothing
          : html`<p class="error" role="alert" data-test="read-error">${this.readError}</p>`
      }
      ${overview === null ? nothing : this.#parts(overview)}`;
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
      <section aria-labelledby="fiscal-filing-cases" data-test="cases">
        <h2 id="fiscal-filing-cases">${t("fiscal_filing.cases")}</h2>
        <!-- Part 2: the Filing cases table and its View panel go here. -->
      </section>
      ${
        overview.heldWithoutCase === 0
          ? nothing
          : html`<p data-test="held-without-case">
              ${t("fiscal_filing.held_without_case", { count: count(overview.heldWithoutCase) })}
            </p>`
      }`;
  }
}
