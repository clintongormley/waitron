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
  clockProblem,
  clockWaitStrings,
  dateTimeFormat,
  readClocks,
  record,
  renderClockProblem,
  validWait,
  type ClockComparison,
} from "./clock-wait.js";

type RecoveryContext = Parameters<NonNullable<SetupContribution["createRecovery"]>>[0];
type PromotionContext = Parameters<NonNullable<SetupContribution["createPromotion"]>>[0] & {
  mode: "promote";
};
type Context = RecoveryContext | PromotionContext;
const isPromotion = (context: Context): context is PromotionContext => "mode" in context;
interface Draft {
  oldBoxGone: boolean;
  soleRecovery: boolean;
}
const empty = (): Draft => ({ oldBoxGone: false, soleRecovery: false });
interface Selected {
  status: "selected";
  identity: string;
  input: unknown;
}
const strings = {
  en: {
    ...clockWaitStrings.en,
    inUse: `${clockWaitStrings.en.inUse} Reload this page and start the restore again: a new restore chooses a new series name.`,
    heading: "Recover this box",
    promotionHeading: "Start the venue on this box",
    promotionFailed:
      "Check your password and code, then compare clocks again. Use a fresh authenticator code.",
    promotionThrottled: "Wait before trying your password again, then compare clocks again.",
    promotionPermission:
      "Use an administrator account allowed to hand over the venue and open this box at its own HTTPS address, then compare clocks again.",
    promotionClock: "The clock check is too old. Compare clocks again before starting the venue.",
    deviceInvoices: "Invoices seen on this device",
    deviceInvoicesHint:
      "These are the last invoices this browser kept for this taxpayer and environment. The list may be incomplete. Recovery still uses new series.",
    stopped: "The old box is stopped and will stay offline.",
    sole: "I am the only person recovering this taxpayer, across all venues.",
    compare: "Compare clocks",
    select: "Make the series",
    again: "Check again",
    readings: "Clock comparison",
    box: "Box",
    browser: "Browser",
    internet: "Internet",
    unavailable: "Unavailable",
    failed: "Check the fields and compare clocks again.",
    missing: "Complete recovery before continuing.",
    key: "Check the key for this backup.",
    chosen: "Series name",
    blocked: "Box time precedes this Waitron release.",
    rangeBlocked: "This date is outside the range of series names.",
    secondClockDo:
      "Connect the box to the internet, or open this page on a phone or laptop on the venue's network that has the backup.",
    secondClockEnds:
      "It carries on by itself once the box reaches the internet, or on the other device if you carry on there.",
    differDo:
      "Try from another phone or laptop that has the backup. If they still differ, the box's time may be wrong: ask for help.",
    clear: "Clear",
  },
  es: {
    ...clockWaitStrings.es,
    inUse: `${clockWaitStrings.es.inUse} Recarga esta página y vuelve a empezar la restauración: una restauración nueva elige otro nombre de serie.`,
    heading: "Recuperar esta caja",
    promotionHeading: "Iniciar el local en este equipo",
    promotionFailed:
      "Revisa la contraseña y usa un código nuevo del autenticador. Después, vuelve a comparar los relojes.",
    promotionThrottled:
      "Espera antes de volver a probar la contraseña y compara los relojes de nuevo.",
    promotionPermission:
      "Usa una cuenta de administrador con permiso para traspasar el local y abre la dirección HTTPS de este equipo. Después, vuelve a comparar los relojes.",
    promotionClock:
      "La comprobación del reloj ha caducado. Vuelve a comparar los relojes antes de iniciar el local.",
    deviceInvoices: "Facturas vistas en este dispositivo",
    deviceInvoicesHint:
      "Son las últimas facturas que este navegador guardó para este contribuyente y entorno. La lista puede estar incompleta. La recuperación sigue usando series nuevas.",
    stopped: "La caja anterior está apagada y seguirá desconectada.",
    sole: "Soy la única persona recuperando este contribuyente, en todos sus locales.",
    compare: "Comparar relojes",
    select: "Crear las series",
    again: "Comprobar otra vez",
    readings: "Comparación de relojes",
    box: "Servidor",
    browser: "Navegador",
    internet: "Internet",
    unavailable: "No disponible",
    failed: "Revisa los campos y vuelve a comparar los relojes.",
    missing: "Completa la recuperación antes de continuar.",
    key: "Revisa la clave de esta copia.",
    chosen: "Nombre de las series",
    blocked: "La hora de la caja es anterior a esta versión de Waitron.",
    rangeBlocked: "Esta fecha está fuera del rango de nombres de serie.",
    secondClockDo:
      "Conecta el equipo a internet, o abre esta página desde un móvil o un portátil del local que tenga la copia.",
    secondClockEnds:
      "Sigue sola cuando el equipo tenga internet, o en el otro aparato si sigues allí.",
    differDo:
      "Prueba desde otro móvil o portátil que tenga la copia. Si siguen sin coincidir, puede que la hora del equipo esté mal: pide ayuda.",
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
      dl {
        display: grid;
        gap: var(--wt-space-2);
      }
      dd {
        margin: 0;
      }
      dt {
        color: var(--wt-color-text-muted);
      }
    `,
  ];
  @property({ attribute: false }) context!: Context;
  @property() locale: "en" | "es" = "en";
  @property() errorMessage?: string;
  @property() refusedField?: string;
  @state() private draft = empty();
  @state() private busy = false;
  @state() private comparison?: ClockComparison;
  @state() private error = false;
  #failure: unknown;
  @state() private keyError = false;
  @state() private attempted = false;
  @state() private refusalDismissed = false;
  #secret?: string;
  #generation = 0;
  #scope?: DraftScope<Draft>;
  #wait = new ClockWait<Selected>(this, () => void this.#select(true));
  override connectedCallback(): void {
    super.connectedCallback();
    this.#register();
  }
  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("errorMessage") || changed.has("refusedField")) this.refusalDismissed = false;
    if (changed.has("context")) this.clear();
    this.#register();
  }
  #register(): void {
    if (this.isConnected && !this.#scope) {
      this.#scope = draftScopeFor(this, {
        id: this,
        current: () => this.draft,
        snapshot: (value) => ({ ...value }),
        equal: (a, b) => a.oldBoxGone === b.oldBoxGone && a.soleRecovery === b.soleRecovery,
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
    this.busy = false;
    this.comparison = undefined;
    this.error = false;
    this.keyError = false;
    this.#wait.show();
  }
  #edit(change: Partial<Draft>): void {
    this.#edited("recoveryOperation");
    this.#invalidate();
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
    if (!isPromotion(this.context) || this.busy || this.#wait.result?.status !== "selected")
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
    return (
      isPromotion(this.context) ||
      Boolean(this.#secret && this.draft.oldBoxGone && this.draft.soleRecovery)
    );
  }
  get #canSelect(): boolean {
    const clock = this.comparison?.clock;
    return this.#canCompare && clock !== undefined && !clock.releaseBlocked && !clock.rangeBlocked;
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
  async #compare(): Promise<void> {
    if (this.busy || !this.#canCompare) return;
    const { call, current } = this.#begin();
    this.comparison = undefined;
    this.#wait.show();
    this.#notify();
    try {
      this.comparison = await readClocks(call);
      if (this.comparison.clock.releaseBlocked) return;
      this.#wait.showPreview(await call({ action: "preview" }));
    } catch (cause) {
      // A taken minute is counted down only after Make the series, whose select the box answers.
      if (current() && clockProblem(cause)?.kind !== "next-minute")
        this.#wait.settle(cause, false, (error) => this.#failed(error));
    } finally {
      if (current()) {
        this.busy = false;
        this.#notify();
      }
    }
  }
  async #select(automatic = false): Promise<void> {
    if (this.busy || this.#wait.result?.status === "selected") return;
    if (!(automatic ? this.#canCompare : this.#canSelect)) return;
    const { call, current } = this.#begin();
    const context = this.context;
    // An automatic re-check leaves the current explanation up until its answer replaces it.
    if (!automatic) this.#wait.show();
    this.#notify();
    try {
      const comparison = await readClocks(call);
      this.comparison = comparison;
      if (!comparison.clock.secondClock) return this.#wait.waitForSecondClock();
      if (comparison.clock.disagreement) return this.#wait.show({ kind: "disagreement" });
      const selected = await call({ action: "select", comparisonId: comparison.id });
      if (!record(selected)) throw new Error("invalid selection");
      if (selected.status === "selected") {
        const selectedBinding = selected.binding;
        if (
          !record(selectedBinding) ||
          Object.entries(context.binding).some(([key, value]) => selectedBinding[key] !== value) ||
          !isMinuteIdentity(selected.identity) ||
          selected.input === undefined
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
            : "Conecta el equipo a internet o abre esta página de traspaso en otro móvil o portátil.",
          secondClockEnds: en
            ? "Keep this page open, or continue on the other device."
            : "Mantén esta página abierta o continúa en el otro dispositivo.",
          differDo: en
            ? "Open this handover page on another phone or laptop and compare the clocks again."
            : "Abre esta página de traspaso en otro móvil o portátil y vuelve a comparar los relojes.",
        }
      : baseWords;
    const observations = isPromotion(context)
      ? []
      : readInvoiceEvidenceReport({
          taxpayerId: context.selection.taxId,
          environment: context.selection.environment,
        });
    const zone = classifySavedTimeZone(
      isPromotion(context) ? context.timeZone : context.selection.timeZone,
    );
    const displayZone = zone.kind === "valid" ? zone.timeZone : "UTC";
    const format = (ms: number) =>
      dateTimeFormat(en ? "en" : "es", displayZone, {
        dateStyle: "medium",
        timeStyle: "long",
      }).format(ms);
    const utc = (ms: number) => new Date(ms).toISOString();
    const clock = this.comparison?.clock;
    const result = this.#wait.result;
    const canSelect =
      this.#canSelect && !this.busy && !this.#wait.waiting && result?.status !== "selected";
    return html`<h3>${promote ? words.promotionHeading : words.heading}</h3>
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
        isPromotion(context)
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
      ${
        clock
          ? html`<section aria-label=${words.readings} data-test="clock-readings">
              <h4>${words.readings}</h4>
              <p>${displayZone}</p>
              <dl>
                ${clock.usable.map(
                  (reading) =>
                    html`<dt>${words[reading.source]}</dt>
                      <dd>
                        ${format(reading.lowerMs)} – ${format(reading.upperMs)}<br />${utc(reading.lowerMs)}
                        – ${utc(reading.upperMs)}
                      </dd>`,
                )}
                ${clock.unavailable.map(
                  (reading) =>
                    html`<dt>${words[reading.source]}</dt>
                      <dd>${words.unavailable}</dd>`,
                )}
              </dl>
              ${clock.releaseBlocked || clock.rangeBlocked ? html`<p role="status">${clock.rangeBlocked ? words.rangeBlocked : words.blocked}</p>` : nothing}
            </section>`
          : nothing
      }
      ${renderClockProblem(this.#wait.problem, words, clock)}
      ${
        this.#wait.counting
          ? this.#wait.renderWait(words)
          : result?.status === "selected"
            ? html`<p role="status" data-test="selected-hour">
                ${words.chosen}: <strong>${result.identity}</strong>
              </p>`
            : nothing
      }
      <wt-form-actions
        .error=${this.error ? (promote ? this.refusalMessage(this.#failure) : words.failed) : !this.refusalDismissed && this.errorMessage ? (this.refusedField === "nodeRecoverySecret" ? words.failed : this.errorMessage) : !promote && this.attempted && !this.#credentials() ? words.missing : ""}
      >
        <wt-button
          data-test="compare"
          variant=${this.#canCompare ? "primary" : "secondary"}
          ?disabled=${this.busy || !this.#canCompare}
          @click=${() => void this.#compare()}
          >${this.comparison || result ? words.again : words.compare}</wt-button
        >
        <wt-button
          data-test="select"
          variant=${canSelect ? "primary" : "secondary"}
          ?disabled=${!canSelect}
          @click=${() => void this.#select()}
          >${words.select}</wt-button
        >
        <wt-button data-test="clear" variant="secondary" @click=${() => this.clear()}
          >${words.clear}</wt-button
        >
      </wt-form-actions>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "vf-recovery-hour": RecoveryHourEntry;
  }
}
