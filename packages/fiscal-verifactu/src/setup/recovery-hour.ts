import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, draftScopeFor, focusFirstInvalid, type DraftScope } from "@waitron/ui";
import { readInvoiceEvidenceReport } from "@waitron/fiscal/src/invoice-evidence.js";
import { classifySavedTimeZone } from "@waitron/shared";
import type {
  ModuleRecoveryCredentials,
  ModulePromotionEntry,
  SetupContribution,
} from "@waitron/module/src/setup-contract.js";
import { isMinuteIdentity } from "../hour-identity.js";
import "./recovery-key.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import {
  ClockWait,
  clockWaitStrings,
  readClocks,
  record,
  validWait,
  type ClockComparison,
} from "./clock-wait.js";
import {
  checkVenueStrings,
  checkVenueStyles,
  detailRow,
  focusNewScreen,
  regionName,
} from "./check-venue.js";
import { fiscalSetupStrings, seriesPurposes } from "./strings.js";

type RecoveryContext = Parameters<NonNullable<SetupContribution["createRecovery"]>>[0];
type PromotionContext = Parameters<NonNullable<SetupContribution["createPromotion"]>>[0] & {
  mode: "promote";
};
type Context = RecoveryContext | PromotionContext;
const isPromotion = (context: Context): context is PromotionContext => "mode" in context;
/** A planned hand-over's main box still answers, so no till there offers the switch. */
export const promotionWords = {
  emergency: {
    en: {
      secondClockDo:
        "Switch from a till or phone on the venue's network, or let the box keep its time over the internet.",
      secondClockEnds:
        "It carries on by itself once the box keeps its time over the internet, while this page stays open.",
    },
    es: {
      secondClockDo:
        "Cambia desde una caja o un móvil del local, o deja que el servidor se ponga en hora por internet.",
      secondClockEnds:
        "Sigue sola cuando el servidor se ponga en hora por internet, mientras esta página siga abierta.",
    },
  },
  controlled: {
    en: {
      secondClockDo:
        "Let the box keep its time over the internet, or open this handover page on another phone or laptop.",
      secondClockEnds: "Keep this page open, or continue on the other device.",
    },
    es: {
      secondClockDo:
        "Deja que el servidor se ponga en hora por internet o abre esta página de traspaso en otro móvil o portátil.",
      secondClockEnds: "Mantén esta página abierta o continúa en el otro dispositivo.",
    },
  },
} as const;
interface Draft {
  oldBoxGone: boolean;
  soleRecovery: boolean;
  detailsCorrect: boolean;
}
const empty = (): Draft => ({ oldBoxGone: false, soleRecovery: false, detailsCorrect: false });
interface Selected {
  status: "selected";
  identity: string;
  input: { allocation: { series: { code: string; purpose: (typeof seriesPurposes)[number] }[] } };
}
export const recoveryHourStrings = {
  en: {
    ...clockWaitStrings.en,
    ...checkVenueStrings.en,
    inUse: `${clockWaitStrings.en.inUse} Reload this page and start the restore again: a new restore creates new invoice series.`,
    heading: "Recover this box",
    promotionHeading: "Start the venue on this box",
    promotionFailed:
      "Check your password and code, then try again. Use a fresh authenticator code.",
    promotionConnection:
      "This operation needs an encrypted connection from this box's own page. Open the box's HTTPS address, then try again.",
    promotionThrottled: "Wait before trying your password again.",
    promotionPermission: "Use an administrator account allowed to hand over the venue.",
    promotionClock: "The clock check is too old. Check the clocks again before starting the venue.",
    deviceInvoices: "Invoices seen on this device",
    deviceInvoicesHint:
      "These are the last invoices this browser kept for this taxpayer and environment. The list may be incomplete.",
    stopped: "The old box is stopped and will stay offline.",
    sole: "I am the only person recovering this taxpayer, across all venues.",
    seriesLine: "Waitron will start new invoice series for this box.",
    continue: "Continue",
    missing: "Complete recovery before continuing.",
    key: "Check the key for this backup.",
    secondClockLead:
      "It is very important that the box's time is correct, and it can't check its time over the Internet right now. Either:",
    secondClockFix: "fix the Internet connection, and this page carries on by itself, or",
    secondClockOpen: (address?: string) =>
      `open this page${address ? ` on ${address}` : ""} on a phone or till on the venue's network, and carry on there`,
    clear: "Clear",
  },
  es: {
    ...clockWaitStrings.es,
    ...checkVenueStrings.es,
    inUse: `${clockWaitStrings.es.inUse} Recarga esta página y vuelve a empezar la restauración: una restauración nueva crea series de facturas nuevas.`,
    heading: "Recuperar este servidor",
    promotionHeading: "Iniciar el local en este servidor",
    promotionFailed:
      "Revisa la contraseña y usa un código nuevo del autenticador. Después, vuelve a intentarlo.",
    promotionConnection:
      "Esta operación necesita una conexión cifrada desde la página del propio servidor. Abre la dirección HTTPS del servidor y vuelve a intentarlo.",
    promotionThrottled: "Espera antes de volver a probar la contraseña.",
    promotionPermission: "Usa una cuenta de administrador con permiso para traspasar el local.",
    promotionClock:
      "La comprobación del reloj ha caducado. Vuelve a comprobar los relojes antes de iniciar el local.",
    deviceInvoices: "Facturas vistas en este dispositivo",
    deviceInvoicesHint:
      "Son las últimas facturas que este navegador guardó para este contribuyente y entorno. La lista puede estar incompleta.",
    stopped: "El servidor anterior está apagado y seguirá desconectado.",
    sole: "Soy la única persona recuperando este contribuyente, en todos sus locales.",
    seriesLine: "Waitron creará series de facturas nuevas para este servidor.",
    continue: "Continuar",
    missing: "Completa la recuperación antes de continuar.",
    key: "Revisa la clave de esta copia.",
    secondClockLead:
      "Es muy importante que la hora del servidor sea correcta, y ahora mismo no puede comprobar su hora por internet. Puedes:",
    secondClockFix: "arreglar la conexión a internet, y esta página seguirá sola, o",
    secondClockOpen: (address?: string) =>
      `abrir esta página${address ? ` en ${address}` : ""} desde un móvil o una caja de la red del local, y seguir allí`,
    clear: "Borrar",
  },
};
@customElement("vf-recovery-hour")
export class RecoveryHourEntry extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        overflow-wrap: anywhere;
      }
      label {
        display: flex;
        align-items: baseline;
        gap: var(--wt-space-2);
        padding-block: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        box-sizing: border-box;
      }
      input {
        accent-color: var(--wt-color-primary);
        flex-shrink: 0;
      }
      .error {
        color: var(--wt-color-danger);
      }
      dl:not(.details) {
        display: grid;
        gap: var(--wt-space-2);
        margin-block: var(--wt-space-3);
      }
      dl:not(.details) dd {
        margin: 0;
      }
      dl:not(.details) dt {
        color: var(--wt-color-text-muted);
      }
    `,
    checkVenueStyles,
  ];
  @property({ attribute: false }) context!: Context;
  @property() locale: "en" | "es" = "en";
  @property() errorMessage?: string;
  @property() refusedField?: string;
  /** Continue stays on screen, busy, while the page starts the venue it asked for. */
  @property({ attribute: false }) starting = false;
  @state() private draft = empty();
  @state() private busy = false;
  /** The button whose own request is being sent, which stays on screen while it is. */
  @state() private sending?: "proceed" | "compareAgain" | "tryAgain";
  @state() private comparison?: ClockComparison;
  @state() private error = false;
  #failure: unknown;
  @state() private keyError = false;
  @state() private attempted = false;
  @state() private refusalDismissed = false;
  #secret?: string;
  #generation = 0;
  #scope?: DraftScope<Draft>;
  #wait = new ClockWait<Selected>(this, () => void this.#run(true));
  #seriesShown = false;
  /** Proceed was pressed and no field has changed since: the page carries on to the series. */
  #confirmed = false;
  /** A handover's Continue was pressed under the series now shown. */
  @state() private continued = false;
  override connectedCallback(): void {
    super.connectedCallback();
    this.#register();
  }
  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("errorMessage") || changed.has("refusedField")) this.refusalDismissed = false;
    if (changed.has("context")) this.clear();
    this.#register();
  }
  override updated(): void {
    const shown = this.#wait.result?.status === "selected";
    if (shown && !this.#seriesShown)
      focusNewScreen(
        this.shadowRoot!,
        this.shadowRoot!.querySelector<HTMLElement>("[data-test=selected-hour] h4"),
      );
    this.#seriesShown = shown;
  }
  #register(): void {
    if (this.isConnected && !this.#scope) {
      this.#scope = draftScopeFor(this, {
        id: this,
        current: () => this.draft,
        snapshot: (value) => ({ ...value }),
        equal: (a, b) =>
          a.oldBoxGone === b.oldBoxGone &&
          a.soleRecovery === b.soleRecovery &&
          a.detailsCorrect === b.detailsCorrect,
        restore: () => this.clear(),
      }).scope;
      this.#scope.commit(empty());
    }
  }
  override disconnectedCallback(): void {
    this.clear();
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }
  clear(): void {
    this.#invalidate();
    this.#secret = undefined;
    this.draft = empty();
    this.attempted = false;
    this.shadowRoot?.querySelector("vf-recovery-key")?.clear();
    this.#scope?.commit(empty());
    this.#notify();
  }
  #invalidate(): void {
    ++this.#generation;
    this.#confirmed = false;
    this.continued = false;
    this.busy = false;
    this.sending = undefined;
    this.comparison = undefined;
    this.error = false;
    this.keyError = false;
    this.#wait.show();
  }
  #edit(change: Partial<Draft>): void {
    this.#edited("recoveryOperation");
    // A statement edit leaves the key as the box refused it.
    const keyError = this.keyError;
    this.#invalidate();
    this.keyError = keyError;
    this.draft = { ...this.draft, ...change };
    this.#scope?.changed();
    this.#notify();
  }
  #edited(field: string): void {
    if (this.refusedField !== field || this.refusalDismissed) return;
    this.refusalDismissed = true;
    this.dispatchEvent(
      new CustomEvent("recovery-field-edited", {
        detail: { field },
        bubbles: true,
        composed: true,
      }),
    );
  }
  #notify(): void {
    if (isPromotion(this.context)) {
      this.dispatchEvent(
        new CustomEvent("promotion-change", {
          detail: { ready: this.readOperation() !== null },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }
    this.dispatchEvent(
      new CustomEvent("recovery-invalid", {
        detail: { invalid: this.attempted && !this.#credentials() },
        bubbles: true,
        composed: true,
      }),
    );
  }
  #credentials(): ModuleRecoveryCredentials | null {
    if (isPromotion(this.context)) return null;
    if (
      this.busy ||
      !this.#secret ||
      !this.draft.oldBoxGone ||
      !this.draft.soleRecovery ||
      !this.draft.detailsCorrect ||
      this.#wait.result?.status !== "selected"
    )
      return null;
    return {
      recoveryOperation: {
        binding: { ...this.context.binding },
        input: structuredClone(this.#wait.result.input),
      },
      nodeRecoverySecret: this.#secret,
      recoveryContext: {
        selectedSourceId: this.context.selection.sourceId,
        oldBoxGone: true,
        soleRecovery: true,
      },
    };
  }
  refusalMessage(cause: unknown): string {
    const words = recoveryHourStrings[this.locale];
    if (record(cause)) {
      if (cause.explained === true) return "";
      if (cause.code === "node.operation_page_required") return words.promotionConnection;
      if (cause.code === "password.throttled") return words.promotionThrottled;
      if (cause.code === "authorization.not_permitted") return words.promotionPermission;
      if (
        cause.code === "sif.allocation_invalid" &&
        record(cause.params) &&
        cause.params.reason === "clock_stale"
      )
        return words.promotionClock;
    }
    return words.promotionFailed;
  }
  readOperation(): ReturnType<ModulePromotionEntry["readOperation"]> {
    if (
      !isPromotion(this.context) ||
      !this.continued ||
      this.busy ||
      !this.draft.detailsCorrect ||
      this.#wait.result?.status !== "selected"
    )
      return null;
    return {
      binding: { ...this.context.binding },
      input: structuredClone(this.#wait.result.input),
    };
  }
  readCredentials(): ModuleRecoveryCredentials | null {
    this.attempted = true;
    this.#notify();
    const credentials = this.#credentials();
    if (!credentials) void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
    return credentials;
  }
  get #canCompare(): boolean {
    if (isPromotion(this.context)) return this.draft.detailsCorrect;
    return Boolean(
      this.#secret && this.draft.oldBoxGone && this.draft.soleRecovery && this.draft.detailsCorrect,
    );
  }
  #request(context: RecoveryContext) {
    return {
      binding: { ...context.binding },
      context: {
        selectedSourceId: context.selection.sourceId,
        oldBoxGone: this.draft.oldBoxGone,
        soleRecovery: this.draft.soleRecovery,
      },
      nodeRecoverySecret: this.#secret!,
    };
  }
  #begin(): { call: (proposal: unknown) => Promise<unknown>; current: () => boolean } {
    const generation = ++this.#generation;
    const context = this.context;
    const request = isPromotion(context) ? undefined : this.#request(context);
    const current = () =>
      this.isConnected && this.context === context && this.#generation === generation;
    const call = async (proposal: unknown) => {
      const result = isPromotion(context)
        ? await context.prepare(proposal)
        : await context.prepare({ ...request!, proposal });
      if (!current()) throw new Error("stale recovery");
      return result;
    };
    this.busy = true;
    this.error = false;
    this.keyError = false;
    return { call, current };
  }
  #failed(cause: unknown): void {
    this.error = true;
    this.#failure = cause;
    this.keyError =
      record(cause) &&
      (cause.code === "promotion.break_glass_invalid" ||
        (record(cause.params) && cause.params.field === "nodeRecoverySecret"));
  }
  /** `press`: Confirm the time, whose step stays up until the answer replaces it. */
  async #run(automatic = false, press = false): Promise<void> {
    if (!this.#confirmed || this.busy || this.#wait.result?.status === "selected") return;
    const { call, current } = this.#begin();
    const context = this.context;
    // An automatic re-check leaves the current explanation up until its answer replaces it.
    if (!automatic && !press) this.#wait.show();
    this.#notify();
    try {
      const comparison = press ? await this.#wait.confirm(call) : await readClocks(call);
      this.comparison = comparison;
      const { clock } = comparison;
      if (clock.releaseBlocked || clock.rangeBlocked) return this.#wait.show();
      if (!clock.secondClock) return this.#wait.waitForSecondClock();
      const select = this.#wait.toSelect(comparison);
      if (!select) return;
      const selected = await call({ action: "select", ...select });
      if (!record(selected)) throw new Error("invalid selection");
      if (selected.status === "selected") {
        const selectedBinding = selected.binding;
        if (
          !record(selectedBinding) ||
          Object.entries(context.binding).some(([key, value]) => selectedBinding[key] !== value) ||
          !isMinuteIdentity(selected.identity) ||
          !record(selected.input) ||
          !record(selected.input.allocation) ||
          selected.input.allocation.installationIdentity !== selected.identity ||
          !Array.isArray(selected.input.allocation.series) ||
          !selected.input.allocation.series.every(
            (series) =>
              record(series) &&
              typeof series.code === "string" &&
              series.code !== "" &&
              seriesPurposes.some((purpose) => purpose === series.purpose),
          )
        )
          throw new Error("invalid selection");
      } else if (selected.status !== "waiting" || !validWait(selected))
        throw new Error("invalid wait");
      this.#wait.show(undefined, selected as unknown as Selected);
    } catch (cause) {
      if (current()) this.#wait.settle(cause, automatic, (error) => this.#failed(error));
    } finally {
      if (current()) {
        this.busy = false;
        this.sending = undefined;
        this.#notify();
      }
    }
  }
  /** Sets the box's clock from this device, then compares the clocks again by itself. */
  async #setClock(): Promise<void> {
    if (!this.#confirmed || this.busy) return;
    const { call, current } = this.#begin();
    let again = false;
    try {
      again = await this.#wait.setFromDevice(call);
    } catch (cause) {
      if (current()) this.#wait.settle(cause, false, (error) => this.#failed(error));
    } finally {
      if (current()) this.busy = false;
    }
    if (again && current()) await this.#run(true);
  }
  override render() {
    const en = this.locale === "en";
    const context = this.context;
    const promote = isPromotion(context);
    const baseWords = en ? recoveryHourStrings.en : recoveryHourStrings.es;
    const words = promote
      ? {
          ...baseWords,
          ...promotionWords[context.scenario][this.locale],
          inUse: en ? clockWaitStrings.en.inUse : clockWaitStrings.es.inUse,
        }
      : {
          ...baseWords,
          whySecondClock: baseWords.secondClockLead,
          secondClockChoices: [
            baseWords.secondClockFix,
            baseWords.secondClockOpen(context.boxAddress),
          ] as const,
        };
    const observations = promote
      ? []
      : readInvoiceEvidenceReport({
          taxpayerId: context.selection.taxId,
          environment: context.selection.environment,
        });
    const zone = classifySavedTimeZone(promote ? context.timeZone : context.selection.timeZone);
    const displayZone = zone.kind === "valid" ? zone.timeZone : "UTC";
    const clock = this.comparison?.clock;
    const result = this.#wait.result;
    const problem = this.#wait.problem?.kind;
    const sending = this.busy ? this.sending : undefined;
    const action =
      sending ??
      (this.busy || result?.status === "selected" || problem === "in-use"
        ? undefined
        : this.keyError
          ? "proceed"
          : this.error
            ? "tryAgain"
            : clock?.releaseBlocked ||
                clock?.rangeBlocked ||
                problem === "disagreement" ||
                problem === "later"
              ? "compareAgain"
              : problem === "confirm" || (this.#confirmed && this.#wait.waiting)
                ? undefined
                : "proceed");
    const enabled = !sending && (action !== "proceed" || this.#canCompare);
    const selectedHour = result?.status === "selected" ? result : undefined;
    const editable = !selectedHour && !this.#confirmed && !sending;
    return html`<h3>${promote ? words.promotionHeading : words.heading}</h3>
      <div data-test="check-venue" ?hidden=${selectedHour !== undefined}>
        ${
          observations.length === 0
            ? nothing
            : html`<section data-test="device-invoices" aria-label=${words.deviceInvoices}>
                <h4>${words.deviceInvoices}</h4>
                <p>${words.deviceInvoicesHint}</p>
                <dl>
                  ${observations.map(
                    (observation) =>
                      html`<dt>${observation.invoiceNumber}</dt>
                        <dd>${observation.issuedDate}<br />${observation.recordEvidence}</dd>`,
                  )}
                </dl>
              </section>`
        }
        ${
          promote
            ? nothing
            : html`<vf-recovery-key
                  .selection=${context.selection}
                  .locale=${this.locale}
                  .errorMessage=${this.keyError || (this.attempted && !this.#secret) ? words.key : !this.refusalDismissed && this.refusedField === "nodeRecoverySecret" ? this.errorMessage : undefined}
                  @recovery-key-change=${(event: CustomEvent<{ secret?: string }>) => {
                    event.stopPropagation();
                    this.#secret = event.detail.secret;
                    this.#edited("nodeRecoverySecret");
                    this.#invalidate();
                    this.#notify();
                  }}
                ></vf-recovery-key>
                <label
                  ><input
                    type="checkbox"
                    name="recovery-old-box-stopped"
                    required
                    aria-invalid=${this.attempted && !this.draft.oldBoxGone ? "true" : "false"}
                    aria-describedby="stopped-error"
                    .checked=${this.draft.oldBoxGone}
                    @change=${(event: Event) => this.#edit({ oldBoxGone: (event.currentTarget as HTMLInputElement).checked })}
                  />${words.stopped} *</label
                >
                <p id="stopped-error" class="error">
                  ${this.attempted && !this.draft.oldBoxGone ? words.stopped : ""}
                </p>
                <label
                  ><input
                    type="checkbox"
                    name="recovery-sole-operation"
                    required
                    aria-invalid=${this.attempted && !this.draft.soleRecovery ? "true" : "false"}
                    aria-describedby="sole-error"
                    .checked=${this.draft.soleRecovery}
                    @change=${(event: Event) => this.#edit({ soleRecovery: (event.currentTarget as HTMLInputElement).checked })}
                  />${words.sole} *</label
                >
                <p id="sole-error" class="error">
                  ${this.attempted && !this.draft.soleRecovery ? words.sole : ""}
                </p>`
        }
        <h4>${words.checkHeading}</h4>
        <dl class="details" data-test="venue-review" data-clock=${clock ? "read" : "reading"}>
          ${
            promote
              ? nothing
              : html`${detailRow(words.environment, words[context.selection.environment])}
                ${detailRow(words.country, regionName(this.locale, context.selection.country))}
                ${detailRow(words.taxId, context.selection.taxId)}`
          }
          ${detailRow(words.zone, displayZone)}
        </dl>
        ${
          clock
            ? html`${clock.releaseBlocked || clock.rangeBlocked ? html`<p role="status">${clock.rangeBlocked ? words.rangeBlocked : words.blocked}</p>` : nothing}`
            : nothing
        }
        <label
          ><input
            type="checkbox"
            name="recovery-details-confirmed"
            required
            aria-invalid=${this.attempted && !this.draft.detailsCorrect ? "true" : "false"}
            aria-describedby="details-error"
            .checked=${this.draft.detailsCorrect}
            @change=${(event: Event) => this.#edit({ detailsCorrect: (event.currentTarget as HTMLInputElement).checked })}
          />${words.detailsCorrect} *</label
        >
        <p id="details-error" class="error">
          ${this.attempted && !this.draft.detailsCorrect ? words.detailsCorrect : ""}
        </p>
        ${this.#wait.renderProblem(
          words,
          clock,
          this.locale,
          displayZone,
          () => void this.#setClock(),
          { press: () => void this.#run(false, true), busy: this.busy },
        )}
        ${this.#wait.counting ? this.#wait.renderWait(words) : nothing}
        ${action === "proceed" && !sending ? html`<p data-test="series-line">${words.seriesLine}</p>` : nothing}
      </div>
      ${
        selectedHour
          ? html`<section data-test="selected-hour" role="status">
              <h4 tabindex="-1">${words.chosen}</h4>
              <ul>
                ${selectedHour.input.allocation.series.map(
                  (s) => html`<li>${s.code} — ${fiscalSetupStrings[this.locale][s.purpose]}</li>`,
                )}
              </ul>
            </section>`
          : nothing
      }
      <wt-form-actions
        .error=${this.error ? (promote ? this.refusalMessage(this.#failure) : words.failed) : !this.refusalDismissed && this.errorMessage ? (this.refusedField === "nodeRecoverySecret" ? words.failed : this.errorMessage) : !promote && this.attempted && !this.#credentials() ? words.missing : ""}
      >
        ${
          action
            ? html`<wt-button
                data-test="compare"
                variant=${enabled || sending ? "primary" : "secondary"}
                ?disabled=${!enabled}
                ?loading=${Boolean(sending)}
                @click=${() => {
                  if (this.busy) return;
                  if (action === "proceed") this.#confirmed = true;
                  void this.#run();
                  this.sending = this.busy ? action : undefined;
                }}
                >${words[action]}</wt-button
              >`
            : nothing
        }
        ${
          promote && selectedHour && (!this.continued || this.starting)
            ? html`<wt-button
                data-test="continue"
                variant="primary"
                ?loading=${this.continued}
                @click=${() => {
                  this.continued = true;
                  this.#notify();
                }}
                >${words.continue}</wt-button
              >`
            : nothing
        }
        ${
          editable
            ? html`<wt-button
                slot="secondary"
                data-test="edit-details"
                variant="secondary"
                @click=${() =>
                  this.dispatchEvent(
                    new CustomEvent("recovery-edit-details", { bubbles: true, composed: true }),
                  )}
                >${words.editDetails}</wt-button
              >`
            : nothing
        }
        ${
          selectedHour
            ? nothing
            : html`<wt-button data-test="clear" variant="secondary" @click=${() => this.clear()}
                >${words.clear}</wt-button
              >`
        }
      </wt-form-actions>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "vf-recovery-hour": RecoveryHourEntry;
  }
}
