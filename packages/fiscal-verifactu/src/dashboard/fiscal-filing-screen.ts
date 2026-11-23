import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  pageTitleStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  type DataTableColumn,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-disclosure.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-textarea.js";
import type { WtModal } from "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-notice.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import {
  codeMessage,
  codeOf,
  currentLocale,
  formatIsoMinute,
  subscribeLocale,
  t as tableText,
  type DashboardPermissionContinuation,
} from "@waitron/dashboard-kit";
import { formatMoney, localCalendarDate } from "@waitron/shared";
import type { EnvioState } from "../filing-states.js";
import type {
  ActiveConflictView,
  FilingCaseView,
  FilingOverviewAnswer,
  FilingWarnings,
  IdentityChangeView,
  MissingHistory,
  NotIssuedHereView,
  RecordWarningView,
  ReplyMismatchView,
  WarnedRecordView,
} from "../filing-overview-types.js";
import {
  descriptionProblem,
  FULL_INVOICE_REPLACEMENT_ON,
  putRightFor,
  type PutRight,
} from "../put-right.js";
import type { FiscalFilingClient } from "./fiscal-filing-client.js";
import { calendarDay } from "./dates.js";
import { REFUSAL_WORDS, refusalKey } from "./put-right-words.js";
import { t } from "./strings.js";

const RECOVERY_PATH = "/recovery/fiscal-conflict";
const PAGE_SIZE = 50;
const CASE_CHANGED: ReadonlySet<string> = new Set(
  Object.keys(REFUSAL_WORDS).filter((code) => refusalKey(code) === "fiscal_filing.refused.changed"),
);
const DAY_REFUSED = "fiscal.operation_date_invalid";
const NEEDS_ADMIN: ReadonlySet<string> = new Set([
  "authorization.not_permitted",
  "person.suspended",
]);

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

function field(label: string, value: string | TemplateResult | null, test?: string) {
  return value === null || value === ""
    ? nothing
    : html`<div data-test=${test ?? nothing}>
        <dt>${label}</dt>
        <dd>${value}</dd>
      </div>`;
}

/** AEAT's own words, quoted and left in Spanish whatever the page's language. */
function aeatWords(words: string | null): TemplateResult | null {
  return words === null || words === "" ? null : html`<q lang="es">${words}</q>`;
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

/** Both are null on a cancellation, which carries no amounts, and set on every other record. */
function total({ importeTotal, cuotaTotal }: FilingCaseView["record"]): string | null {
  if (importeTotal === null || cuotaTotal === null) return null;
  const locale = currentLocale();
  return t("fiscal_filing.detail.total_value", {
    total: formatMoney(importeTotal, locale),
    tax: formatMoney(cuotaTotal, locale),
  });
}

function recordKind(
  record: Pick<FilingCaseView["record"], "tipoRegistro" | "tipoFactura">,
): string {
  if (record.tipoRegistro === "anulacion") return t("fiscal_filing.kind.anulacion");
  const type = record.tipoFactura ?? "";
  if (type === "F1" || type === "F2" || type === "F3") return t(`fiscal_filing.kind.${type}`);
  if (/^R[1-5]$/.test(type)) return t("fiscal_filing.kind.corrective");
  return t("fiscal_filing.kind.other");
}

function recordState(submission: { estado: string } | null): string | null {
  const state = STATES.find((known) => known === submission?.estado);
  return state === undefined ? null : t(`fiscal_filing.record_state.${state}`);
}

/** A case only the check against AEAT opened (`retainLookupConflict`) leaves the record's sending
 * unchanged; reply evidence means AEAT's reply refused it. A case's conflict stops issuing only when
 * `readActiveConflicts` lists it, which leaves out a retired identity's conflicts and those on a
 * record of a box this box took over from. */
function whatHappensNow(found: FilingCaseView, active: readonly ActiveConflictView[]): string {
  const lookupOnly =
    found.cause === "fiscal.huella_divergente" &&
    found.conflicts.length === 0 &&
    found.lookups.length > 0;
  const record = t(lookupOnly ? "fiscal_filing.now.lookup" : `fiscal_filing.now.${found.cause}`);
  const stops = active.some(
    (conflict) =>
      conflict.source === "record" &&
      conflict.invoiceNumber === found.record.numSerieFactura &&
      conflict.installationName === found.record.numeroInstalacion,
  );
  return stops ? `${record} ${t("fiscal_filing.now.stopped")}` : record;
}

function technicalDetails(found: FilingCaseView): TemplateResult {
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
  return html`<wt-disclosure data-test="technical" heading=${t("fiscal_filing.technical")}>
    <dl>
      ${field(t("fiscal_filing.detail.issuer"), record.idEmisorFactura)}
      ${field(t("fiscal_filing.detail.record_code"), record.tipoRegistro)}
      ${field(t("fiscal_filing.detail.invoice_code"), record.tipoFactura)}
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
      ${field(t("fiscal_filing.detail.then_code"), evidence.codigo?.toString() ?? null)}
      ${field(t("fiscal_filing.detail.latest_code"), submission?.codigoError ?? null)}
      ${field(
        t("fiscal_filing.detail.observations"),
        observations.length === 0
          ? null
          : html`<ul>
              ${observations}
            </ul>`,
      )}
    </dl>
  </wt-disclosure>`;
}

function caseDetails(found: FilingCaseView, active: readonly ActiveConflictView[]): TemplateResult {
  const { record, submission, evidence } = found;
  const latest = aeatWords(submission?.mensajeError ?? null);
  const sentAt = submission?.enviadoEn ?? null;
  return html`<dl>
      ${field(
        t("fiscal_filing.detail.invoice"),
        `${record.numSerieFactura} · ${record.fechaExpedicionFactura}`,
        "invoice",
      )}
      ${field(t("fiscal_filing.detail.kind"), recordKind(record), "kind")}
      ${field(t("fiscal_filing.detail.state"), recordState(submission), "state")}
      ${field(t("fiscal_filing.detail.total"), total(record), "total")}
      ${field(t("fiscal_filing.detail.recorded"), formatIsoMinute(record.fechaHoraHusoGenRegistro))}
      ${field(t("fiscal_filing.detail.then"), aeatWords(evidence.mensaje), "reply-then")}
      ${field(
        t("fiscal_filing.detail.latest"),
        latest === null || sentAt === null
          ? latest
          : html`${latest} · ${t("fiscal_filing.detail.sent", { time: formatIsoMinute(sentAt) })}`,
      )}
      ${field(t("fiscal_filing.detail.now"), whatHappensNow(found, active), "now")}
    </dl>
    ${technicalDetails(found)}`;
}

const LOOKUP_STATES = ["Correcto", "AceptadoConErrores", "Anulado"] as const;

function conflictLine(conflict: ActiveConflictView): TemplateResult {
  const number = conflict.invoiceNumber;
  const evidence = conflict.evidence;
  let said: string;
  let theirs: string | null = null;
  let status: string | null = null;
  let reply: string | null = null;
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
    said = t(`fiscal_filing.conflict.reply.${conflict.cause}`, { number });
    reply = [line.EstadoRegistro, line.CodigoErrorRegistro, line.DescripcionErrorRegistro]
      .filter((part) => part !== null && part !== "")
      .join(" ");
    theirs = evidence.comparison.storedFingerprint;
  } else {
    const known = LOOKUP_STATES.find((state) => state === evidence.state);
    said =
      known === undefined
        ? t("fiscal_filing.conflict.lookup_unknown", { number })
        : t("fiscal_filing.conflict.lookup", {
            number,
            state: t(`fiscal_filing.conflict.state.${known}`),
          });
    status = evidence.state;
    theirs = evidence.fingerprint;
  }
  return html`<li>
    <span data-test="said">${said}</span>
    <span class="muted" data-test="seen"
      >${t("fiscal_filing.conflict.seen", { time: formatIsoMinute(conflict.observedAt) })}</span
    >
    <wt-disclosure data-test="technical" heading=${t("fiscal_filing.technical")}>
      <dl>
        ${field(t("fiscal_filing.conflict.status"), aeatWords(status))}
        ${field(t("fiscal_filing.conflict.reply_words"), aeatWords(reply))}
        ${field(
          t("fiscal_filing.conflict.fingerprint"),
          theirs === null ? null : html`<span class="fingerprint">${theirs}</span>`,
        )}
        ${field(t("fiscal_filing.detail.installation"), conflict.installationName)}
      </dl>
    </wt-disclosure>
  </li>`;
}

/** AEAT writes an invoice's date `DD-MM-YYYY`; the screen shows dates as the box stores them. */
function storedDate(aeatDate: string): string {
  const [day, month, year] = aeatDate.split("-");
  return `${year}-${month}-${day}`;
}

function notIssuedLine(found: NotIssuedHereView): TemplateResult {
  const system = found.system;
  return html`<li>
    <span
      >${t("fiscal_filing.history.not_issued.line", {
        number: found.invoice.NumSerieFactura,
        date: storedDate(found.invoice.FechaExpedicionFactura),
      })}</span
    >
    <span class="muted"
      >${t("fiscal_filing.history.not_issued.series", { series: found.seriesCode })} ·
      ${t("fiscal_filing.conflict.seen", { time: formatIsoMinute(found.recordedAt) })}</span
    >
    <wt-disclosure data-test="technical" heading=${t("fiscal_filing.technical")}>
      <dl>
        ${field(t("fiscal_filing.conflict.status"), aeatWords(found.state))}
        ${field(
          t("fiscal_filing.conflict.fingerprint"),
          found.fingerprint === null
            ? null
            : html`<span class="fingerprint">${found.fingerprint}</span>`,
        )}
        ${field(
          t("fiscal_filing.history.not_issued.system"),
          system === null
            ? null
            : `${system.taxId} · ${system.softwareId} · ${system.installation}`,
        )}
      </dl>
    </wt-disclosure>
  </li>`;
}

function identityChangeLine(change: IdentityChangeView): TemplateResult {
  const names = { earlier: change.earlierInstallationName, new: change.installationName };
  const held = change.lastHeldInvoice;
  return html`<li>
    <span
      >${
        held === null
          ? t("fiscal_filing.history.identity.line_none_held", names)
          : t("fiscal_filing.history.identity.line", {
              ...names,
              number: t("fiscal_filing.history.identity.invoice", {
                number: held.numSerieFactura,
                date: held.fechaExpedicionFactura,
              }),
            })
      }</span
    >
    <span class="muted"
      >${t("fiscal_filing.history.identity.changed", {
        time: formatIsoMinute(change.activatedAt),
      })}</span
    >
  </li>`;
}

function historyList<T>(
  heading: string,
  test: string,
  rows: readonly T[],
  line: (row: T) => TemplateResult,
  none: string,
): TemplateResult {
  return html`<div class="history" data-test=${test}>
    <h3>${heading}</h3>
    ${
      rows.length === 0
        ? html`<p class="muted" data-test="empty">${none}</p>`
        : html`<ul>
            ${rows.map(line)}
          </ul>`
    }
  </div>`;
}

function missingHistory({ notIssuedHere, identityChanges }: MissingHistory): TemplateResult {
  return html`<section aria-labelledby="fiscal-filing-history" data-test="missing-history">
    <h2 id="fiscal-filing-history">${t("fiscal_filing.history")}</h2>
    ${historyList(
      t("fiscal_filing.history.not_issued"),
      "not-issued-here",
      notIssuedHere,
      notIssuedLine,
      t("fiscal_filing.history.not_issued.none"),
    )}
    ${historyList(
      t("fiscal_filing.history.identity"),
      "identity-changes",
      identityChanges,
      identityChangeLine,
      t("fiscal_filing.history.identity.none"),
    )}
  </section>`;
}

function sentRecord(record: WarnedRecordView): TemplateResult {
  const state = record.estado === null ? null : recordState({ estado: record.estado });
  const kind = recordKind({ tipoRegistro: record.tipoRegistro, tipoFactura: null });
  return html`<li>
    ${[record.numSerieFactura, record.fechaExpedicionFactura, state, kind]
      .filter((part) => part !== null)
      .join(" · ")}
  </li>`;
}

function replyLine(line: ReplyMismatchView["lines"][number]): TemplateResult {
  const said = [line.tipoOperacion, line.estado, line.codigo?.toString() ?? null]
    .filter((part) => part !== null && part !== "")
    .join(" ");
  const message = aeatWords(line.mensaje);
  return html`<li>
    ${line.numSerieFactura} ·
    ${storedDate(line.fechaExpedicionFactura)}${
      said === "" ? nothing : html` · ${aeatWords(said)}`
    }${message === null ? nothing : html` · ${message}`}
  </li>`;
}

function replyMismatchLine(mismatch: ReplyMismatchView): TemplateResult {
  return html`<li>
    <span
      >${t("fiscal_filing.warnings.reply.line", {
        sent: count(mismatch.sent.length),
        lines: count(mismatch.lines.length),
      })}</span
    >
    <span class="muted"
      >${t("fiscal_filing.warnings.reply.seen", { time: formatIsoMinute(mismatch.detectedAt) })}</span
    >
    <dl>${field(t("fiscal_filing.detail.now"), t("fiscal_filing.warnings.reply.now"))}</dl>
    <wt-disclosure data-test="technical" heading=${t("fiscal_filing.technical")}>
      <dl>
        ${field(t("fiscal_filing.warnings.reply.csv"), mismatch.csv)}
        ${field(
          t("fiscal_filing.warnings.reply.sent"),
          html`<ul>
            ${mismatch.sent.map(sentRecord)}
          </ul>`,
        )}
        ${field(
          t("fiscal_filing.warnings.reply.lines"),
          html`<ul>
              ${mismatch.lines.map(replyLine)}
            </ul>
            <p class="muted">${t("fiscal_filing.warnings.reply.first")}</p>`,
        )}
      </dl>
    </wt-disclosure>
  </li>`;
}

function recordWarningLine(warning: RecordWarningView): TemplateResult {
  const record = warning.record;
  const said =
    record === null
      ? t(`fiscal_filing.warnings.record.${warning.kind}_unknown`, {
          time: formatIsoMinute(warning.detectedAt),
        })
      : t(`fiscal_filing.warnings.record.${warning.kind}`, {
          number: record.numSerieFactura,
          date: record.fechaExpedicionFactura,
        });
  const state =
    record === null || record.estado === null ? null : recordState({ estado: record.estado });
  return html`<li>
    <span>${said}</span>
    ${state === null ? nothing : html`<span class="muted">${state}</span>`}
    <wt-disclosure data-test="technical" heading=${t("fiscal_filing.technical")}>
      <dl>
        ${field(
          t("fiscal_filing.warnings.record.fields"),
          html`<ul>
            ${warning.fields.map(
              (name, index) => html`<li>${name} · ${warning.codes[index] ?? ""}</li>`,
            )}
          </ul>`,
        )}
      </dl>
    </wt-disclosure>
  </li>`;
}

function warnings({ replyMismatches, recordWarnings, total }: FilingWarnings): TemplateResult {
  const shown = replyMismatches.length + recordWarnings.length;
  return html`<section aria-labelledby="fiscal-filing-warnings" data-test="warnings">
    <h2 id="fiscal-filing-warnings">${t("fiscal_filing.warnings")}</h2>
    ${
      total === 0
        ? html`<p class="muted">${t("fiscal_filing.warnings.none")}</p>`
        : html`${
            total > shown
              ? html`<p class="muted" data-test="bounded">
                  ${t("fiscal_filing.warnings.bounded", {
                    shown: count(shown),
                    total: count(total),
                  })}
                </p>`
              : nothing
          }
          ${
            replyMismatches.length === 0
              ? nothing
              : historyList(
                  t("fiscal_filing.warnings.reply"),
                  "reply-mismatches",
                  replyMismatches,
                  replyMismatchLine,
                  "",
                )
          }
          ${
            recordWarnings.length === 0
              ? nothing
              : historyList(
                  t("fiscal_filing.warnings.record"),
                  "record-warnings",
                  recordWarnings,
                  recordWarningLine,
                  "",
                )
          }`
    }
  </section>`;
}

/** Reads how this box's invoice records are being sent to AEAT, and sends the fix `putRightFor`
 * offers for a case. */
@customElement("vf-fiscal-filing-screen")
export class FiscalFilingScreen extends LitElement {
  static override styles = [
    baseStyles,
    pageTitleStyles,
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
      .error,
      .changed {
        margin-top: var(--wt-space-2);
      }
      .error {
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
      h3 {
        margin: var(--wt-space-4) 0 var(--wt-space-2);
        font-size: var(--wt-font-size-sm);
      }
      .history > ul {
        display: grid;
        gap: var(--wt-space-3);
        margin: 0;
        padding-inline-start: var(--wt-space-5);
      }
      .history li span {
        display: block;
        overflow-wrap: anywhere;
      }
      .footer {
        display: flex;
        justify-content: end;
      }
      .put-right {
        display: grid;
        gap: var(--wt-space-3);
        margin-top: var(--wt-space-4);
      }
      .put-right h3 {
        margin: 0;
      }
      .confirmation {
        display: grid;
        gap: var(--wt-space-2);
      }
      .put-right-none {
        margin-top: var(--wt-space-4);
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
  @property({ attribute: false }) permissionContinuation?: DashboardPermissionContinuation;
  fullInvoiceReplacement = FULL_INVOICE_REPLACEMENT_ON;

  @state() private overview: FilingOverviewAnswer | null = null;
  @state() private loading = true;
  @state() private readError = "";
  @state() private exportError = "";
  @state() private exporting = false;
  @state() private page = 0;
  @state() private viewing: FilingCaseView | null = null;
  @state() private description = "";
  @state() private operationDate = "";
  @state() private attempted = false;
  @state() private sending = false;
  @state() private refusal = "";
  @state() private caseChanged = false;
  @state() private replacementIssued = false;

  #generation = 0;
  #unsubscribeLocale?: () => void;
  #unsubscribeAccount?: () => void;
  #actionKey = "";
  /** What the open case's dialog offers, decided when it opened. */
  #fix: PutRight | null = null;
  #scope?: DraftScope<string>;
  #leave?: LeaveCoordinator;
  #login?: AbortController;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#unsubscribeLocale = subscribeLocale(() => this.requestUpdate());
    // Unlike the certificate dialog's secrets, the description and its action key stay across a
    // change of person, so an administrator who signs in here can send what was already typed.
    this.#unsubscribeAccount = this.permissionContinuation?.subscribe(() => this.requestUpdate());
    void this.#read();
  }

  override disconnectedCallback(): void {
    this.#generation += 1;
    this.#unsubscribeLocale?.();
    this.#unsubscribeAccount?.();
    this.#forget();
    super.disconnectedCallback();
  }

  #open(row: FilingCaseView): void {
    this.#forget();
    this.caseChanged = false;
    this.replacementIssued = false;
    this.viewing = row;
    const { kind } = (this.#fix = putRightFor(row, {
      fullInvoiceReplacement: this.fullInvoiceReplacement,
    }));
    if (kind === "none") return;
    const describes = kind === "record-correction";
    // The day is never prefilled: a refused future date is wrong by definition, and a prefill
    // could put the sale in the wrong VAT period with one click.
    if (describes) this.description = row.record.descripcionOperacion ?? "";
    else this.operationDate = "";
    this.#actionKey = crypto.randomUUID();
    const { scope, coordinator } = draftScopeFor(this, {
      id: {},
      current: () => (describes ? this.description : this.operationDate),
      snapshot: (value) => value,
      equal: (a, b) => a === b,
      restore: (value) => {
        if (describes) this.description = value;
        else this.operationDate = value;
      },
    });
    this.#scope = scope;
    this.#leave = coordinator;
    scope.commit(describes ? this.description : this.operationDate);
  }

  #forget(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.#login?.abort();
    this.attempted = false;
    this.sending = false;
    this.refusal = "";
  }

  #close(): void {
    this.#forget();
    this.viewing = null;
    this.#fix = null;
  }

  #replaces(): boolean {
    return this.#fix?.kind === "replacement-invoice";
  }

  #dialog(): WtModal {
    return this.shadowRoot!.querySelector<WtModal>("wt-modal[data-test=case-details]")!;
  }

  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    if (!this.#scope || !this.#leave) return true;
    const outcome = await this.#leave.request({ scopes: [this.#scope.id], reason, proceed() {} });
    return this.isConnected && outcome === "proceeded";
  };

  #descriptionError(): string {
    if (!this.attempted) return "";
    if (this.description.trim() === "") return t("fiscal_filing.put_right.description_required");
    const problem = descriptionProblem(this.description);
    if (problem === "too_long") return t("fiscal_filing.put_right.description_too_long");
    return problem === "control_character" ? t("fiscal_filing.put_right.description_control") : "";
  }

  /** The box's own day, as the server dates a replacement; null when it could not say. */
  #serverDay(): string | null {
    return this.overview?.today?.day ?? null;
  }

  /** The venue's day by this device's clock; null when the box could not say the venue's offset. */
  #deviceDay(): string | null {
    const today = this.overview?.today;
    return today ? localCalendarDate(new Date(), today.offsetMinutes) : null;
  }

  #daysDiffer(): boolean {
    const today = this.#serverDay();
    return today !== null && today !== this.#deviceDay();
  }

  /** What is wrong with the chosen day by the server's upper bounds; empty while none is chosen. */
  #dayProblem(found: FilingCaseView): string {
    const day = this.operationDate;
    if (day === "") return "";
    const today = this.#serverDay();
    if (today !== null && day > today) return t("fiscal_filing.put_right.replace.day_after_today");
    const stamped = found.record.fechaExpedicionFactura;
    return day > stamped
      ? t("fiscal_filing.put_right.replace.day_after_invoice", { date: calendarDay(stamped) })
      : "";
  }

  #dayError(problem: string): string {
    if (this.attempted && problem !== "") return problem;
    return this.refusal === DAY_REFUSED ? t(REFUSAL_WORDS[DAY_REFUSED]) : "";
  }

  /** The box not saying its day, or the venue's day by this device's clock differing from it:
   * states that rule Send out before any press, so it is drawn quiet (A427). */
  #replacementRuledOut(): boolean {
    return this.#serverDay() === null || this.#daysDiffer();
  }

  /** What holds Send: the day's own check once Send was chosen, or a state that rules it out. */
  #replacementBlocked(problem: string): boolean {
    return (this.attempted && problem !== "") || this.#replacementRuledOut();
  }

  #bottom(problem: string): string {
    // A refused day is said under its field.
    const unsaid = this.refusal === "" || this.refusal === DAY_REFUSED;
    const key = unsaid ? undefined : refusalKey(this.refusal);
    const said = unsaid ? "" : key ? t(key) : codeMessage(this.refusal);
    const replaces = this.#replaces();
    const marked = replaces ? this.#dayError(problem) : this.#descriptionError();
    const fix = marked === "" ? "" : t("fiscal_filing.put_right.fix_fields");
    const today = this.#serverDay();
    const device = this.#deviceDay();
    const undated = replaces && today === null ? t("fiscal_filing.put_right.replace.undated") : "";
    const differs =
      replaces && today !== null && device !== null && today !== device
        ? t("fiscal_filing.put_right.replace.day_differs", {
            server: calendarDay(today),
            device: calendarDay(device),
          })
        : "";
    return [said, fix, undated, differs].filter((part) => part !== "").join(" ");
  }

  #needsAdmin(): boolean {
    const access = this.permissionContinuation?.snapshot();
    return (
      access !== undefined &&
      (!access.permissions.includes("fiscal.remedy") || NEEDS_ADMIN.has(this.refusal))
    );
  }

  async #signIn(): Promise<void> {
    if (!this.permissionContinuation || this.#login) return;
    const login = (this.#login = new AbortController());
    this.requestUpdate();
    try {
      const outcome = await this.permissionContinuation.signIn({
        permission: "fiscal.remedy",
        signal: login.signal,
      });
      if (outcome === "signed-in" && !login.signal.aborted) this.refusal = "";
    } catch {
      // Stopped or failed: the button stays for another try.
    } finally {
      if (this.#login === login) this.#login = undefined;
      this.requestUpdate();
    }
  }

  async #send(found: FilingCaseView): Promise<void> {
    if (this.sending || saveActionState(this.#scope).unchanged) return;
    const replaces = this.#replaces();
    this.attempted = true;
    const invalid = replaces
      ? this.#replacementBlocked(this.#dayProblem(found))
      : this.#descriptionError() !== "";
    if (invalid) {
      // Drawn again even when already attempted: this device's day may have moved on since.
      this.requestUpdate();
      void this.updateComplete.then(() => focusFirstInvalid(this.#dialog()));
      return;
    }
    this.sending = true;
    this.refusal = "";
    // Reopening a case shows the same case object, so its opening's action key tells them apart.
    const actionKey = this.#actionKey;
    const sameOpening = () => this.viewing === found && this.#actionKey === actionKey;
    const sent = replaces ? this.operationDate : this.description;
    try {
      await this.client.putRight(
        replaces
          ? {
              kind: "replacement-invoice",
              registroId: found.registroId,
              actionKey,
              reason: `AEAT refused the invoice with code ${found.evidence.codigo}; a replacement corrective invoice replaces it.`,
              operationDate: sent,
            }
          : {
              kind: "record-correction",
              registroId: found.registroId,
              actionKey,
              reason: `AEAT refused the record with code ${found.evidence.codigo}; its operation description is corrected.`,
              facts: { description: sent },
            },
      );
    } catch (error) {
      const code = codeOf(error);
      // An earlier send whose answer was lost may be what changed the case, so every retry would
      // be refused again: the dialog closes rather than offering Send.
      if (CASE_CHANGED.has(code)) {
        void this.#read();
        if (!sameOpening()) return;
        this.#close();
        this.caseChanged = true;
        return;
      }
      if (!sameOpening()) return;
      this.sending = false;
      this.refusal = code;
      return;
    }
    void this.#read();
    if (!sameOpening()) return;
    this.#scope?.commit(sent);
    this.#close();
    this.replacementIssued = replaces;
  }

  #replacement(found: FilingCaseView, problem: string): TemplateResult {
    const { record } = found;
    const error = this.#dayError(problem);
    const today = this.#serverDay();
    const invoice = {
      number: record.numSerieFactura,
      date: calendarDay(record.fechaExpedicionFactura),
      total: formatMoney(record.importeTotal ?? "0", currentLocale()),
    };
    return html`<section class="put-right" aria-labelledby="fiscal-filing-put-right">
      <h3 id="fiscal-filing-put-right" data-test="put-right-heading">
        ${t("fiscal_filing.put_right.replace.heading")}
      </h3>
      <p data-test="put-right-intro">
        ${t(
          record.tipoFactura === "F1"
            ? "fiscal_filing.put_right.replace.intro_full"
            : "fiscal_filing.put_right.replace.intro",
        )}
      </p>
      <wt-input
        name="operationDate"
        type="date"
        label=${t("fiscal_filing.put_right.replace.day")}
        required
        .value=${this.operationDate}
        .error=${error}
        ?invalid=${error !== ""}
        ?disabled=${this.sending}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.operationDate = event.detail.value;
          if (this.refusal === DAY_REFUSED) this.refusal = "";
          this.#scope?.changed();
        }}
      ></wt-input>
      ${
        today === null
          ? nothing
          : html`<div class="confirmation" data-test="replacement-confirmation">
              <p>
                ${t("fiscal_filing.put_right.replace.confirm", {
                  ...invoice,
                  today: calendarDay(today),
                })}
              </p>
              <p>${t("fiscal_filing.put_right.replace.order")}</p>
            </div>`
      }
    </section>`;
  }

  #putRight(found: FilingCaseView, problem: string): TemplateResult {
    // Set whenever a case is being viewed.
    const fix = this.#fix!;
    if (fix.kind === "none")
      return html`<p class="put-right-none" data-test="put-right-none">
        ${t(`fiscal_filing.put_right.none.${fix.why}`)}
      </p>`;
    if (fix.kind === "replacement-invoice") return this.#replacement(found, problem);
    const said = aeatWords(found.submission?.mensajeError ?? found.evidence.mensaje);
    const error = this.#descriptionError();
    return html`<section class="put-right" aria-labelledby="fiscal-filing-put-right">
      <h3 id="fiscal-filing-put-right" data-test="put-right-heading">
        ${t("fiscal_filing.put_right.heading")}
      </h3>
      <p>${t("fiscal_filing.put_right.intro")}</p>
      ${
        said === null
          ? nothing
          : html`<p data-test="aeat-message">
              <span class="muted">${t("fiscal_filing.put_right.aeat")}:</span> ${said}
            </p>`
      }
      <wt-textarea
        name="operationDescription"
        label=${t("fiscal_filing.put_right.description")}
        required
        .value=${this.description}
        .error=${error}
        ?invalid=${error !== ""}
        ?disabled=${this.sending}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.description = event.detail.value;
          this.#scope?.changed();
        }}
      ></wt-textarea>
    </section>`;
  }

  #putRightActions(found: FilingCaseView, problem: string): TemplateResult {
    const action = saveActionState(this.#scope);
    const stop = () => void this.#dialog().requestClose("cancel");
    const replaces = this.#replaces();
    const blocked = replaces ? this.#replacementBlocked(problem) : this.#descriptionError() !== "";
    const variant = replaces && this.#replacementRuledOut() ? "secondary" : action.variant;
    return html`<wt-form-actions slot="footer" .error=${this.#bottom(problem)}>
      <wt-button
        slot="cancel"
        variant="secondary"
        data-test="stop"
        ?disabled=${this.sending}
        @click=${stop}
        >${t("fiscal_filing.put_right.stop")}</wt-button
      >
      ${
        this.#needsAdmin()
          ? html`<wt-button
              data-test="put-right"
              variant="primary"
              ?loading=${this.#login !== undefined}
              @click=${() => void this.#signIn()}
              >${t("fiscal_filing.put_right.sign_in")}</wt-button
            >`
          : html`<wt-button
              data-test="put-right"
              variant=${variant}
              ?disabled=${action.unchanged || this.sending || blocked}
              @click=${() => void this.#send(found)}
              >${t(
                this.sending
                  ? "fiscal_filing.put_right.sending"
                  : replaces
                    ? "fiscal_filing.put_right.replace.send"
                    : "fiscal_filing.put_right.send",
              )}</wt-button
            >`
      }
    </wt-form-actions>`;
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
        choosable: "shown",
        label: t("fiscal_filing.column.invoice"),
        cell: (row) => `${row.record.numSerieFactura} · ${row.record.fechaExpedicionFactura}`,
      },
      {
        key: "reason",
        choosable: "shown",
        label: t("fiscal_filing.column.reason"),
        cell: (row) => t(`fiscal_filing.cause.${row.cause}`),
      },
      {
        key: "code",
        choosable: "shown",
        label: t("fiscal_filing.column.code"),
        cell: (row) => (row.evidence.codigo === null ? "—" : String(row.evidence.codigo)),
      },
      {
        key: "held",
        choosable: "shown",
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
              icon="menu-open"
              data-test=${`view-${row.registroId}`}
              @click=${() => this.#open(row)}
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
      ${
        cases.length > 0
          ? html`<p class="muted" data-test="open-to-put-right">
                ${t("fiscal_filing.cases.open_to_put_right")}
              </p>
              <p class="muted" data-test="future-date-fix">
                ${t("fiscal_filing.cases.future_date")}
              </p>`
          : nothing
      }
      <wt-data-table
        data-test="case-table"
        aria-label=${t("fiscal_filing.cases")}
        viewKey="waitron.fiscal-filing.cases.table"
        customiseColumnsLabel=${tableText("table.customise_columns")}
        customiseLabel=${tableText("table.customise")}
        restoreColumnsLabel=${tableText("table.restore_columns")}
        doneLabel=${tableText("table.done")}
        moveColumnLabel=${tableText("table.move_column")}
        showColumnLabel=${tableText("table.show_column")}
        hideColumnLabel=${tableText("table.hide_column")}
        alwaysShownColumnLabel=${tableText("table.column_always_shown")}
        lastShownColumnLabel=${tableText("table.column_last_shown")}
        columnPositionLabel=${tableText("table.column_position")}
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
    const close = () => this.#close();
    const problem = found !== null && this.#replaces() ? this.#dayProblem(found) : "";
    return html`<wt-modal
      size="compact"
      data-test="case-details"
      .open=${found !== null}
      heading=${found === null ? "" : t(`fiscal_filing.cause.${found.cause}`)}
      .beforeClose=${this.#scope ? this.#beforeClose : undefined}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        close();
      }}
    >
      ${
        found === null
          ? nothing
          : html`${caseDetails(found, this.overview?.activeConflicts ?? [])}${this.#putRight(found, problem)}`
      }
      ${
        found !== null && this.#scope
          ? this.#putRightActions(found, problem)
          : html`<div slot="footer" class="footer">
              <wt-button variant="secondary" data-test="close" @click=${close}
                >${t("fiscal_filing.close")}</wt-button
              >
            </div>`
      }
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
      ${
        this.caseChanged
          ? html`<p class="changed" role="status" data-test="case-changed">
              ${t("fiscal_filing.refused.changed")}
            </p>`
          : nothing
      }
      ${
        this.replacementIssued
          ? html`<p class="changed" role="status" data-test="replacement-issued">
              ${t("fiscal_filing.put_right.replace.issued")}
            </p>`
          : nothing
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
      }
      ${warnings(overview.warnings)} ${missingHistory(overview.missingHistory)}`;
  }
}
