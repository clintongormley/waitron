import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
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
  type DashboardPermissionContinuation,
} from "@waitron/dashboard-kit";
import { formatMoney } from "@waitron/shared";
import type { EnvioState } from "../filing-states.js";
import type {
  ActiveConflictView,
  FilingCaseView,
  FilingOverviewAnswer,
  IdentityChangeView,
  MissingHistory,
  NotIssuedHereView,
} from "../filing-overview-types.js";
import { descriptionProblem, putRightFor } from "../put-right.js";
import type { FiscalFilingClient } from "./fiscal-filing-client.js";
import { REFUSAL_WORDS, refusalKey } from "./put-right-words.js";
import { t } from "./strings.js";

const RECOVERY_PATH = "/manage/recovery/fiscal-conflict";
const PAGE_SIZE = 50;
const CASE_CHANGED: ReadonlySet<string> = new Set(
  Object.keys(REFUSAL_WORDS).filter((code) => refusalKey(code) === "fiscal_filing.refused.changed"),
);
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

function recordKind(record: FilingCaseView["record"]): string {
  if (record.tipoRegistro === "anulacion") return t("fiscal_filing.kind.anulacion");
  const type = record.tipoFactura ?? "";
  if (type === "F1" || type === "F2" || type === "F3") return t(`fiscal_filing.kind.${type}`);
  if (/^R[1-5]$/.test(type)) return t("fiscal_filing.kind.corrective");
  return t("fiscal_filing.kind.other");
}

function recordState(submission: FilingCaseView["submission"]): string | null {
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

/** Reads how this box's invoice records are being sent to AEAT, and sends a correction record for a
 * case `putRightFor` offers one. */
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
      .history ul {
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

  @state() private overview: FilingOverviewAnswer | null = null;
  @state() private loading = true;
  @state() private readError = "";
  @state() private exportError = "";
  @state() private exporting = false;
  @state() private page = 0;
  @state() private viewing: FilingCaseView | null = null;
  @state() private description = "";
  @state() private attempted = false;
  @state() private sending = false;
  @state() private refusal = "";
  @state() private caseChanged = false;

  #generation = 0;
  #unsubscribeLocale?: () => void;
  #unsubscribeAccount?: () => void;
  #actionKey = "";
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
    this.viewing = row;
    if (putRightFor(row).kind !== "record-correction") return;
    this.description = row.record.descripcionOperacion ?? "";
    this.#actionKey = crypto.randomUUID();
    const { scope, coordinator } = draftScopeFor(this, {
      id: {},
      current: () => this.description,
      snapshot: (value) => value,
      equal: (a, b) => a === b,
      restore: (value) => {
        this.description = value;
      },
    });
    this.#scope = scope;
    this.#leave = coordinator;
    scope.commit(this.description);
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

  #bottom(): string {
    const key = this.refusal === "" ? undefined : refusalKey(this.refusal);
    const said = this.refusal === "" ? "" : key ? t(key) : codeMessage(this.refusal);
    const fix = this.#descriptionError() === "" ? "" : t("fiscal_filing.put_right.fix_fields");
    return [said, fix].filter((part) => part !== "").join(" ");
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
    this.attempted = true;
    if (this.#descriptionError() !== "") {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    this.sending = true;
    this.refusal = "";
    // Reopening a case shows the same case object, so its opening's action key tells them apart.
    const actionKey = this.#actionKey;
    const sameOpening = () => this.viewing === found && this.#actionKey === actionKey;
    try {
      await this.client.putRight({
        kind: "record-correction",
        registroId: found.registroId,
        actionKey,
        reason: `AEAT refused the record with code ${found.evidence.codigo}; its operation description is corrected.`,
        facts: { description: this.description },
      });
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
    this.#scope?.commit(this.description);
    this.#close();
  }

  #putRight(found: FilingCaseView): TemplateResult {
    const fix = putRightFor(found);
    if (fix.kind === "none")
      return html`<p class="put-right-none" data-test="put-right-none">
        ${t(`fiscal_filing.put_right.none.${fix.why}`)}
      </p>`;
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

  #putRightActions(found: FilingCaseView): TemplateResult {
    const action = saveActionState(this.#scope);
    const stop = () =>
      void this.shadowRoot!.querySelector<WtModal>(
        "wt-modal[data-test=case-details]",
      )!.requestClose("cancel");
    return html`<wt-form-actions slot="footer" .error=${this.#bottom()}>
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
              variant=${action.variant}
              ?disabled=${
                action.unchanged ||
                this.sending ||
                (this.attempted && this.#descriptionError() !== "")
              }
              @click=${() => void this.#send(found)}
              >${t(
                this.sending ? "fiscal_filing.put_right.sending" : "fiscal_filing.put_right.send",
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
    const close = () => this.#close();
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
          : html`${caseDetails(found, this.overview?.activeConflicts ?? [])}${this.#putRight(found)}`
      }
      ${
        found !== null && this.#scope
          ? this.#putRightActions(found)
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
      ${missingHistory(overview.missingHistory)}`;
  }
}
