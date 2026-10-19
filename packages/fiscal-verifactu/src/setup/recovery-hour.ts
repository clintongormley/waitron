import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, draftScopeFor, focusFirstInvalid, type DraftScope } from "@waitron/ui";
import type {
  ModuleRecoveryCredentials,
  SetupContribution,
} from "@waitron/module/src/setup-contract.js";
import type { HourClockDecision } from "../hour-clock.js";
import { reportedHourCodes } from "../reported-hour-codes.js";
import "./recovery-key.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";

type Context = Parameters<NonNullable<SetupContribution["createRecovery"]>>[0];
type Answer = "no" | "yes" | "unknown";
interface Draft {
  installationCodes: string;
  answer?: Answer;
  oldBoxGone: boolean;
  soleRecovery: boolean;
  confirmed: boolean;
}
const empty = (): Draft => ({
  installationCodes: "",
  oldBoxGone: false,
  soleRecovery: false,
  confirmed: false,
});
interface Comparison {
  id: string;
  clock: HourClockDecision;
}
type Result =
  | { status: "selected"; identity: string; input: unknown }
  | {
      status: "waiting";
      targetMs: number;
      remainingMs: number | null;
      requiresClockConfirmation: boolean;
    };
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
@customElement("vf-recovery-hour")
export class RecoveryHourEntry extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        overflow-wrap: anywhere;
      }
      fieldset {
        border: var(--wt-field-line-width) solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        padding: var(--wt-space-3);
        margin: var(--wt-space-4) 0;
        min-width: 0;
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
  @state() private comparison?: Comparison;
  @state() private result?: Result;
  @state() private error = false;
  @state() private keyError = false;
  @state() private hourUsed = false;
  @state() private attempted = false;
  @state() private refusalDismissed = false;
  #secret?: string;
  #generation = 0;
  #scope?: DraftScope<Draft>;
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
        equal: (a, b) =>
          a.installationCodes === b.installationCodes &&
          a.answer === b.answer &&
          a.oldBoxGone === b.oldBoxGone &&
          a.soleRecovery === b.soleRecovery &&
          a.confirmed === b.confirmed,
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
    this.result = undefined;
    this.error = false;
    this.keyError = false;
    this.hourUsed = false;
  }
  #edit(change: Partial<Draft>): void {
    this.#edited("recoveryOperation");
    this.#invalidate();
    this.draft = { ...this.draft, confirmed: false, ...change };
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
    this.dispatchEvent(
      new CustomEvent("recovery-invalid", {
        detail: { invalid: this.attempted && !this.#credentials() },
        bubbles: true,
        composed: true,
      }),
    );
  }
  #codes(): string[] | undefined {
    try {
      return reportedHourCodes([this.draft.installationCodes]);
    } catch {
      return undefined;
    }
  }
  #credentials(): ModuleRecoveryCredentials | null {
    if (
      this.busy ||
      !this.#secret ||
      !this.#codes() ||
      !this.draft.oldBoxGone ||
      !this.draft.soleRecovery ||
      this.result?.status !== "selected"
    )
      return null;
    return {
      recoveryOperation: {
        binding: { ...this.context.binding },
        input: structuredClone(this.result.input),
      },
      nodeRecoverySecret: this.#secret,
      recoveryContext: {
        selectedSourceId: this.context.selection.sourceId,
        oldBoxGone: true,
        soleRecovery: true,
      },
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
    return Boolean(
      this.#secret && this.#codes() && this.draft.oldBoxGone && this.draft.soleRecovery,
    );
  }
  get #canSelect(): boolean {
    const clock = this.comparison?.clock;
    const box = clock?.usable.find((reading) => reading.source === "box");
    const acceptedBoundary =
      clock?.disagreement === true &&
      this.draft.confirmed &&
      box !== undefined &&
      Math.floor(box.lowerMs / 3_600_000) === Math.floor(box.upperMs / 3_600_000);
    return (
      this.#canCompare &&
      this.draft.answer !== undefined &&
      clock !== undefined &&
      !clock.releaseBlocked &&
      !clock.rangeBlocked &&
      (!clock.boundaryWait || acceptedBoundary) &&
      (!clock.requiresConfirmation || this.draft.confirmed)
    );
  }
  async #run(kind: "compare" | "select"): Promise<void> {
    if (this.busy || !(kind === "compare" ? this.#canCompare : this.#canSelect)) return;
    const generation = ++this.#generation;
    const context = this.context;
    const current = () =>
      this.isConnected && this.context === context && this.#generation === generation;
    const request = {
      binding: { ...context.binding },
      context: {
        selectedSourceId: context.selection.sourceId,
        oldBoxGone: this.draft.oldBoxGone,
        soleRecovery: this.draft.soleRecovery,
      },
      nodeRecoverySecret: this.#secret!,
    };
    const call = async (proposal: unknown) => {
      const result = await context.prepare({ ...request, proposal });
      if (!current()) throw new Error("stale recovery");
      return result;
    };
    this.busy = true;
    this.error = false;
    this.keyError = false;
    this.hourUsed = false;
    this.result = undefined;
    this.#notify();
    try {
      if (kind === "compare") {
        this.comparison = undefined;
        this.draft = { ...this.draft, confirmed: false };
        const challenge = await call({ action: "clock-challenge" });
        if (!record(challenge) || typeof challenge.id !== "string")
          throw new Error("invalid challenge");
        const compared = await call({
          action: "compare-clocks",
          browser: { challengeId: challenge.id, instantMs: Date.now() },
        });
        if (
          !record(compared) ||
          typeof compared.id !== "string" ||
          !record(compared.clock) ||
          !Array.isArray(compared.clock.usable) ||
          !Array.isArray(compared.clock.unavailable)
        )
          throw new Error("invalid comparison");
        this.comparison = compared as unknown as Comparison;
      } else {
        if (this.comparison!.clock.requiresConfirmation)
          await call({ action: "confirm-clock", comparisonId: this.comparison!.id });
        const selected = await call({
          action: "select",
          answer: this.draft.answer,
          installationCodes: this.#codes(),
        });
        if (!record(selected)) throw new Error("invalid selection");
        if (selected.status === "selected") {
          const selectedBinding = selected.binding;
          if (
            !record(selectedBinding) ||
            Object.entries(context.binding).some(
              ([key, value]) => selectedBinding[key] !== value,
            ) ||
            typeof selected.identity !== "string" ||
            !/^[0-9A-HJKMNP-TV-Z]{4}$/.test(selected.identity) ||
            selected.input === undefined
          )
            throw new Error("invalid selection");
        } else if (selected.status !== "waiting" || !Number.isSafeInteger(selected.targetMs))
          throw new Error("invalid wait");
        this.result = selected as unknown as Result;
      }
    } catch (cause) {
      if (current()) {
        this.error = true;
        this.hourUsed =
          record(cause) &&
          cause.code === "sif.allocation_invalid" &&
          record(cause.params) &&
          cause.params.reason === "hour_not_later";
        this.keyError =
          record(cause) &&
          (cause.code === "promotion.break_glass_invalid" ||
            (record(cause.params) && cause.params.field === "nodeRecoverySecret"));
      }
    } finally {
      if (current()) {
        this.busy = false;
        this.#notify();
      }
    }
  }
  override render() {
    const en = this.locale === "en";
    const words = en
      ? {
          heading: "Recover this box",
          codes: "Installation code",
          codesHint: "Code on your recovery sheet",
          codesInvalid: "Enter the four-character code from your recovery sheet.",
          stopped: "The old box is stopped and will stay offline.",
          sole: "I am the only person recovering this taxpayer, across all venues.",
          question: "Has this taxpayer started setup or recovery during this UTC hour? *",
          wider: "Include other venues and interrupted attempts.",
          no: "No",
          yes: "Yes",
          unknown: "I don’t know",
          compare: "Compare clocks",
          select: "Select hour",
          again: "Check again",
          confirm: "The box’s displayed time is correct.",
          readings: "Clock comparison",
          box: "Box",
          browser: "Browser",
          internet: "Internet",
          unavailable: "Unavailable",
          warning:
            "The clocks disagree, or no independent comparison is available. A wrong time can reuse names or date invoices incorrectly.",
          failed: "Check the fields and compare clocks again.",
          used: "Wait for a UTC hour later than the known installation codes.",
          missing: "Complete recovery before continuing.",
          key: "Check the key for this backup.",
          chosen: "Selected hour code",
          waiting: "Wait until",
          blocked: "Box time precedes this Waitron release.",
          rangeBlocked: "This date is outside the supported hour range.",
          boundary: "The readings cross a UTC hour. Compare again after the changeover.",
          clear: "Clear",
        }
      : {
          heading: "Recuperar esta caja",
          codes: "Código de instalación",
          codesHint: "Código de tu hoja de recuperación",
          codesInvalid: "Introduce el código de cuatro caracteres de tu hoja de recuperación.",
          stopped: "La caja anterior está apagada y seguirá desconectada.",
          sole: "Soy la única persona recuperando este contribuyente, en todos sus locales.",
          question:
            "¿Este contribuyente ha iniciado una configuración o recuperación durante esta hora UTC? *",
          wider: "Incluye otros locales e intentos interrumpidos.",
          no: "No",
          yes: "Sí",
          unknown: "No lo sé",
          compare: "Comparar relojes",
          select: "Seleccionar hora",
          again: "Comprobar de nuevo",
          confirm: "La hora mostrada por la caja es correcta.",
          readings: "Comparación de relojes",
          box: "Caja",
          browser: "Navegador",
          internet: "Internet",
          unavailable: "No disponible",
          warning:
            "Los relojes no coinciden o no hay una comparación independiente. Una hora incorrecta puede repetir nombres o fechar mal las facturas.",
          failed: "Revisa los campos y vuelve a comparar los relojes.",
          used: "Espera a una hora UTC posterior a los códigos de instalación conocidos.",
          missing: "Completa la recuperación antes de continuar.",
          key: "Revisa la clave de esta copia.",
          chosen: "Código de hora seleccionado",
          waiting: "Espera hasta",
          blocked: "La hora de la caja es anterior a esta versión de Waitron.",
          rangeBlocked: "Esta fecha está fuera del rango de horas admitido.",
          boundary: "Las lecturas abarcan dos horas UTC. Compara de nuevo tras el cambio de hora.",
          clear: "Borrar",
        };
    const format = (ms: number) =>
      new Intl.DateTimeFormat(en ? "en-GB" : "es-ES", {
        dateStyle: "medium",
        timeStyle: "long",
        timeZone: this.context.selection.timeZone,
      }).format(ms);
    const utc = (ms: number) => new Date(ms).toISOString();
    const clock = this.comparison?.clock;
    return html`<h3>${words.heading}</h3>
      <vf-recovery-key
        .selection=${this.context.selection}
        .locale=${this.locale}
        .errorMessage=${this.keyError || (this.attempted && !this.#secret) ? words.key : !this.refusalDismissed && this.refusedField === "nodeRecoverySecret" ? this.errorMessage : undefined}
        @recovery-key-change=${(event: CustomEvent<{ secret?: string }>) => {
          event.stopPropagation();
          this.#secret = event.detail.secret;
          this.#edited("nodeRecoverySecret");
          this.#invalidate();
          this.draft = { ...this.draft, confirmed: false };
          this.#notify();
        }}
      ></vf-recovery-key>
      <wt-input
        name="recovery-installation-codes"
        required
        label=${words.codes}
        placeholder=${words.codesHint}
        .value=${this.draft.installationCodes}
        .error=${this.attempted && !this.#codes() ? words.codesInvalid : ""}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.#edit({ installationCodes: event.detail.value });
        }}
      ></wt-input>
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
      </p>
      <fieldset
        aria-invalid=${this.attempted && this.draft.answer === undefined ? "true" : "false"}
        aria-describedby="answer-error"
      >
        <legend>${words.question}</legend>
        <p>${words.wider}</p>
        ${(["no", "yes", "unknown"] as const).map((answer) => html`<label><input type="radio" name="taxpayer-hour" value=${answer} required .checked=${this.draft.answer === answer} @change=${() => this.#edit({ answer })} />${words[answer]}</label>`)}
      </fieldset>
      <p id="answer-error" class="error">
        ${this.attempted && this.draft.answer === undefined ? words.question : ""}
      </p>
      ${
        clock
          ? html`<section aria-label=${words.readings} data-test="clock-readings">
              <h4>${words.readings}</h4>
              <p>${this.context.selection.timeZone}</p>
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
              ${clock.boundaryWait ? html`<p role="status">${words.boundary}</p>` : nothing}
              ${
                clock.requiresConfirmation
                  ? html`<p role="status">${words.warning}</p>
                      <label
                        ><input
                          type="checkbox"
                          name="recovery-clock-confirmed"
                          required
                          .checked=${this.draft.confirmed}
                          @change=${(event: Event) => {
                            ++this.#generation;
                            this.busy = false;
                            this.result = undefined;
                            this.draft = {
                              ...this.draft,
                              confirmed: (event.currentTarget as HTMLInputElement).checked,
                            };
                            this.#scope?.changed();
                            this.#notify();
                          }}
                        />${words.confirm} *</label
                      >`
                  : nothing
              }
            </section>`
          : nothing
      }
      ${this.result?.status === "selected" ? html`<p role="status">${words.chosen}: <strong>${this.result.identity}</strong></p>` : this.result?.status === "waiting" ? html`<p role="status">${words.waiting} ${format(this.result.targetMs)} (${utc(this.result.targetMs)})</p>` : nothing}
      <wt-form-actions
        .error=${this.error ? (this.hourUsed ? words.used : words.failed) : !this.refusalDismissed && this.errorMessage ? (this.refusedField === "nodeRecoverySecret" ? words.failed : this.errorMessage) : this.attempted && !this.#credentials() ? words.missing : ""}
      >
        <wt-button
          data-test="compare"
          variant=${this.#canCompare ? "primary" : "secondary"}
          ?disabled=${this.busy || !this.#canCompare}
          @click=${() => void this.#run("compare")}
          >${this.comparison || this.result ? words.again : words.compare}</wt-button
        >
        <wt-button
          data-test="select"
          variant=${this.#canSelect ? "primary" : "secondary"}
          ?disabled=${this.busy || !this.#canSelect}
          @click=${() => void this.#run("select")}
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
