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

type RecoveryContext = Parameters<NonNullable<SetupContribution["createRecovery"]>>[0];
type PromotionContext = Parameters<NonNullable<SetupContribution["createPromotion"]>>[0] & {
  mode: "promote";
};
type Context = RecoveryContext | PromotionContext;
const isPromotion = (context: Context): context is PromotionContext => "mode" in context;
interface Draft {
  oldBoxGone: boolean;
  soleRecovery: boolean;
  detailsCorrect: boolean;
}
const empty = (): Draft => ({ oldBoxGone: false, soleRecovery: false, detailsCorrect: false });
interface Selected {
  status: "selected";
  identity: string;
  input: { allocation: { series: { code: string }[] } };
}
const strings = {
  en: {
    ...clockWaitStrings.en,
    ...checkVenueStrings.en,
    inUse: `${clockWaitStrings.en.inUse} Reload this page and start the restore again: a new restore creates new invoice series.`,
    heading: "Recover this box",
    promotionHeading: "Start the venue on this box",
    promotionFailed:
      "Check your password and code, then try again. Use a fresh authenticator code.",
    promotionThrottled: "Wait before trying your password again.",
    promotionPermission:
      "Use an administrator account allowed to hand over the venue. Open this box at its own HTTPS address, then try again.",
    promotionClock: "The clock check is too old. Check the clocks again before starting the venue.",
    deviceInvoices: "Invoices seen on this device",
    deviceInvoicesHint:
      "These are the last invoices this browser kept for this taxpayer and environment. The list may be incomplete.",
    stopped: "The old box is stopped and will stay offline.",
    sole: "I am the only person recovering this taxpayer, across all venues.",
    seriesLine:
      "When you press Proceed, Waitron creates new invoice series for this box, so its invoice numbers never repeat the old box's. The invoice series is the code at the start of every invoice number: for example, in A-0CSQW/1 the series is A-0CSQW.",
    missing: "Complete recovery before continuing.",
    key: "Check the key for this backup.",
    secondClockDo:
      "Connect the box to the internet, or open this page on a phone or laptop on the venue's network that has the backup.",
    secondClockEnds:
      "It carries on by itself once the box reaches the internet, or on the other device if you carry on there.",
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
    promotionThrottled: "Espera antes de volver a probar la contraseña.",
    promotionPermission:
      "Usa una cuenta de administrador con permiso para traspasar el local y abre la dirección HTTPS de este servidor. Después, vuelve a intentarlo.",
    promotionClock:
      "La comprobación del reloj ha caducado. Vuelve a comprobar los relojes antes de iniciar el local.",
    deviceInvoices: "Facturas vistas en este dispositivo",
    deviceInvoicesHint:
      "Son las últimas facturas que este navegador guardó para este contribuyente y entorno. La lista puede estar incompleta.",
    stopped: "El servidor anterior está apagado y seguirá desconectado.",
    sole: "Soy la única persona recuperando este contribuyente, en todos sus locales.",
    seriesLine:
      "Cuando pulses Continuar, Waitron creará series de facturas nuevas para este servidor, para que sus números de factura nunca repitan los del servidor anterior. La serie de facturas es el código al principio de cada número de factura: por ejemplo, en A-0CSQW/1 la serie es A-0CSQW.",
    missing: "Completa la recuperación antes de continuar.",
    key: "Revisa la clave de esta copia.",
    secondClockDo:
      "Conecta el servidor a internet, o abre esta página desde un móvil o un portátil del local que tenga la copia.",
    secondClockEnds:
      "Sigue sola cuando el servidor tenga internet, o en el otro aparato si sigues allí.",
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
    const words = strings[this.locale];
    if (record(cause)) {
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
  async #run(automatic = false): Promise<void> {
    if (!this.#confirmed || this.busy || this.#wait.result?.status === "selected") return;
    const { call, current } = this.#begin();
    const context = this.context;
    // An automatic re-check leaves the current explanation up until its answer replaces it.
    if (!automatic) this.#wait.show();
    this.#notify();
    try {
      const comparison = await readClocks(call);
      this.comparison = comparison;
      const { clock } = comparison;
      if (clock.releaseBlocked || clock.rangeBlocked) return this.#wait.show();
      if (!clock.secondClock) return this.#wait.waitForSecondClock();
      if (clock.disagreement) return this.#wait.show({ kind: "disagreement" });
      const selected = await call({ action: "select", comparisonId: comparison.id });
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
            (series) => record(series) && typeof series.code === "string" && series.code !== "",
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
  override render() {
    const en = this.locale === "en";
    const context = this.context;
    const promote = isPromotion(context);
    const baseWords = en ? strings.en : strings.es;
    const words = promote
      ? {
          ...baseWords,
          secondClockDo: en
            ? "Connect the box to the internet, or open this handover page on another phone or laptop."
            : "Conecta el servidor a internet o abre esta página de traspaso en otro móvil o portátil.",
          secondClockEnds: en
            ? "Keep this page open, or continue on the other device."
            : "Mantén esta página abierta o continúa en el otro dispositivo.",
          inUse: en ? clockWaitStrings.en.inUse : clockWaitStrings.es.inUse,
        }
      : baseWords;
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
              : this.#confirmed && this.#wait.waiting
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
        ${this.#wait.renderProblem(words, clock, this.locale, displayZone)}
        ${this.#wait.counting ? this.#wait.renderWait(words) : nothing}
        ${action === "proceed" && !sending ? html`<p data-test="series-line">${words.seriesLine}</p>` : nothing}
      </div>
      ${
        selectedHour
          ? html`<section data-test="selected-hour" role="status">
              <h4 tabindex="-1">${words.chosen}</h4>
              <ul>
                ${selectedHour.input.allocation.series.map((s) => html`<li>${s.code}</li>`)}
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
          editable
            ? html`<wt-button
                slot="secondary"
                data-test="change-details"
                variant="secondary"
                @click=${() =>
                  this.dispatchEvent(
                    new CustomEvent("recovery-change-details", { bubbles: true, composed: true }),
                  )}
                >${words.changeDetails}</wt-button
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
