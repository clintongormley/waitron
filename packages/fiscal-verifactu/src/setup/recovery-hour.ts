import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, draftScopeFor, focusFirstInvalid, type DraftScope } from "@waitron/ui";
import type {
  ModuleRecoveryCredentials,
  SetupContribution,
} from "@waitron/module/src/setup-contract.js";
import type { HourClockDecision } from "../hour-clock.js";
import "./recovery-key.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { createWaitCountdown, formatRemaining } from "./wait-countdown.js";

type Context = Parameters<NonNullable<SetupContribution["createRecovery"]>>[0];
interface Draft {
  oldBoxGone: boolean;
  soleRecovery: boolean;
}
const empty = (): Draft => ({ oldBoxGone: false, soleRecovery: false });
interface Comparison {
  id: string;
  clock: HourClockDecision;
}
type Result =
  | { status: "selected"; identity: string; input: unknown }
  | { status: "waiting"; targetMs: number; remainingMs: number | null };
type Problem =
  { kind: "second-clock" } | { kind: "disagreement" } | { kind: "later"; allowedFromMs?: number };
const SECOND_CLOCK_POLL_MS = 15_000;
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
  @state() private problem?: Problem;
  @state() private attempted = false;
  @state() private refusalDismissed = false;
  #secret?: string;
  #generation = 0;
  #scope?: DraftScope<Draft>;
  #countdown = createWaitCountdown(this, () => void this.#select(true));
  #poll?: ReturnType<typeof setInterval>;
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
    this.result = undefined;
    this.error = false;
    this.keyError = false;
    this.#show(undefined);
  }
  #stopWait(): void {
    this.#countdown.stop();
    if (this.#poll !== undefined) clearInterval(this.#poll);
    this.#poll = undefined;
  }
  /** Replaces what the page explains: a problem, a server answer, or neither. */
  #show(problem: Problem | undefined, result?: Result): void {
    this.#stopWait();
    this.problem = problem;
    this.result = result;
    if (result?.status === "waiting" && result.remainingMs !== null)
      this.#countdown.start(result.remainingMs);
  }
  #waitForSecondClock(): void {
    this.#show({ kind: "second-clock" });
    this.#poll = setInterval(() => {
      if (!this.busy) void this.#select(true);
    }, SECOND_CLOCK_POLL_MS);
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
    this.dispatchEvent(
      new CustomEvent("recovery-invalid", {
        detail: { invalid: this.attempted && !this.#credentials() },
        bubbles: true,
        composed: true,
      }),
    );
  }
  #credentials(): ModuleRecoveryCredentials | null {
    if (
      this.busy ||
      !this.#secret ||
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
    return Boolean(this.#secret && this.draft.oldBoxGone && this.draft.soleRecovery);
  }
  get #canSelect(): boolean {
    const clock = this.comparison?.clock;
    return this.#canCompare && clock !== undefined && !clock.releaseBlocked && !clock.rangeBlocked;
  }
  #request(context: Context) {
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
  async #readClocks(call: (proposal: unknown) => Promise<unknown>): Promise<Comparison> {
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
    return compared as unknown as Comparison;
  }
  #validWait(result: Record<string, unknown>): boolean {
    return (
      Number.isSafeInteger(result.targetMs) &&
      (result.remainingMs === null ||
        (typeof result.remainingMs === "number" &&
          Number.isFinite(result.remainingMs) &&
          result.remainingMs >= 0))
    );
  }
  #begin(): { call: (proposal: unknown) => Promise<unknown>; current: () => boolean } {
    const generation = ++this.#generation;
    const context = this.context;
    const request = this.#request(context);
    const current = () =>
      this.isConnected && this.context === context && this.#generation === generation;
    const call = async (proposal: unknown) => {
      const result = await context.prepare({ ...request, proposal });
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
    this.keyError =
      record(cause) &&
      (cause.code === "promotion.break_glass_invalid" ||
        (record(cause.params) && cause.params.field === "nodeRecoverySecret"));
  }
  async #compare(): Promise<void> {
    if (this.busy || !this.#canCompare) return;
    const { call, current } = this.#begin();
    this.comparison = undefined;
    this.#show(undefined);
    this.#notify();
    try {
      this.comparison = await this.#readClocks(call);
      const preview = await call({ action: "preview" });
      if (
        record(preview) &&
        preview.status === "waiting" &&
        this.#validWait(preview) &&
        typeof preview.remainingMs === "number" &&
        preview.remainingMs > 0
      )
        this.#show(undefined, preview as unknown as Result);
    } catch (cause) {
      if (current()) this.#failed(cause);
    } finally {
      if (current()) {
        this.busy = false;
        this.#notify();
      }
    }
  }
  async #select(automatic = false): Promise<void> {
    if (this.busy || this.result?.status === "selected") return;
    if (!(automatic ? this.#canCompare : this.#canSelect)) return;
    const { call, current } = this.#begin();
    const context = this.context;
    // An automatic re-check leaves the current explanation up until its answer replaces it.
    if (!automatic) this.#show(undefined);
    this.#notify();
    try {
      const comparison = await this.#readClocks(call);
      this.comparison = comparison;
      if (!comparison.clock.secondClock) return this.#waitForSecondClock();
      if (comparison.clock.disagreement) return this.#show({ kind: "disagreement" });
      const selected = await call({ action: "select", comparisonId: comparison.id });
      if (!record(selected)) throw new Error("invalid selection");
      if (selected.status === "selected") {
        const selectedBinding = selected.binding;
        if (
          !record(selectedBinding) ||
          Object.entries(context.binding).some(([key, value]) => selectedBinding[key] !== value) ||
          typeof selected.identity !== "string" ||
          !/^[0-9A-HJKMNP-TV-Z]{5}$/.test(selected.identity) ||
          selected.input === undefined
        )
          throw new Error("invalid selection");
      } else if (selected.status !== "waiting" || !this.#validWait(selected))
        throw new Error("invalid wait");
      this.#show(undefined, selected as unknown as Result);
    } catch (cause) {
      if (!current()) return;
      const polling = this.#poll !== undefined;
      const { code, params } = (cause ?? {}) as { code?: unknown; params?: unknown };
      const reason =
        code === "sif.allocation_invalid" && record(params) ? params.reason : undefined;
      if (reason === "second_clock_missing") this.#waitForSecondClock();
      else if (reason === "clock_disagreement") this.#show({ kind: "disagreement" });
      else if (reason === "minute_not_later" && record(params))
        this.#show({
          kind: "later",
          ...(Number.isSafeInteger(params.allowedFromMs)
            ? { allowedFromMs: params.allowedFromMs as number }
            : {}),
        });
      // A request lost on the way (no refusal code) is retried by the next poll; a refusal is not.
      else if (!(automatic && polling && code === undefined)) {
        this.#show(undefined);
        this.#failed(cause);
      }
    } finally {
      if (current()) {
        this.busy = false;
        this.#notify();
      }
    }
  }
  #explain(
    t: {
      whySecondClock: string;
      onBox: string;
      secondClockDo: string;
      secondClockEnds: string;
      whyRefused: string;
      differ: string;
      differDo: string;
      later: string;
      laterFrom: (time: string) => string;
    },
    clock: HourClockDecision | undefined,
  ) {
    const problem = this.problem;
    if (problem?.kind === "second-clock")
      return html`<section data-test="clock-wait">
        <p role="status">${t.whySecondClock}</p>
        ${
          clock?.unavailable.some((r) => r.source === "browser" && r.reason === "same_machine")
            ? html`<p>${t.onBox}</p>`
            : nothing
        }
        <p>${t.secondClockDo}</p>
        <p>${t.secondClockEnds}</p>
      </section>`;
    if (problem?.kind === "disagreement")
      return html`<section data-test="clock-refused">
        <p role="status">${t.whyRefused}</p>
        <p>${t.differ}</p>
        <p>${t.differDo}</p>
      </section>`;
    if (problem?.kind === "later") {
      const time =
        problem.allowedFromMs === undefined
          ? undefined
          : new Intl.DateTimeFormat(this.locale === "en" ? "en-GB" : "es-ES", {
              hour: "2-digit",
              minute: "2-digit",
              hourCycle: "h23",
              timeZone: this.context.selection.timeZone,
            }).format(problem.allowedFromMs);
      return html`<p role="status" data-test="minute-not-later">
        ${t.later}${time === undefined ? nothing : html` ${t.laterFrom(time)}`}
      </p>`;
    }
    return nothing;
  }
  override render() {
    const en = this.locale === "en";
    const words = en
      ? {
          heading: "Recover this box",
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
          whyWait: "Waiting to confirm the time, so no invoice series is ever repeated.",
          nothingToDo: "Nothing to do; keep this page open.",
          continuesIn: "Continues in",
          whySecondClock:
            "So no invoice series is ever repeated, the box's time is compared with another device's or the internet's.",
          onBox: "This screen is on the box itself, so it does not count.",
          secondClockDo:
            "Connect the box to the internet, or open this page on a phone or laptop on the venue's network that has the backup.",
          secondClockEnds:
            "It carries on by itself once the box reaches the internet, or on the other device if you carry on there.",
          whyRefused: "No series is made without a confirmed time, so none is ever repeated.",
          differ: "This box's time and this device's differ by more than 30 seconds.",
          differDo:
            "Try from another phone or laptop that has the backup. If they still differ, the box's time may be wrong: ask for help.",
          later: "The series cannot be made yet: a later minute is already in use.",
          laterFrom: (time: string) => `You can carry on from ${time}.`,
          clear: "Clear",
        }
      : {
          heading: "Recuperar esta caja",
          stopped: "La caja anterior está apagada y seguirá desconectada.",
          sole: "Soy la única persona recuperando este contribuyente, en todos sus locales.",
          compare: "Comparar relojes",
          select: "Crear las series",
          again: "Comprobar otra vez",
          readings: "Comparación de relojes",
          box: "Caja",
          browser: "Navegador",
          internet: "Internet",
          unavailable: "No disponible",
          failed: "Revisa los campos y vuelve a comparar los relojes.",
          missing: "Completa la recuperación antes de continuar.",
          key: "Revisa la clave de esta copia.",
          chosen: "Nombre de las series",
          blocked: "La hora de la caja es anterior a esta versión de Waitron.",
          rangeBlocked: "Esta fecha está fuera del rango de nombres de serie.",
          whyWait: "Esperamos a confirmar la hora para que ninguna serie de facturas se repita.",
          nothingToDo: "No hace falta hacer nada; deja esta página abierta.",
          continuesIn: "Sigue en",
          whySecondClock:
            "Para que ninguna serie de facturas se repita, la hora del equipo se compara con la de otro aparato o con internet.",
          onBox: "Esta pantalla está en el propio equipo y no cuenta.",
          secondClockDo:
            "Conecta el equipo a internet, o abre esta página desde un móvil o un portátil del local que tenga la copia.",
          secondClockEnds:
            "Sigue sola cuando el equipo tenga internet, o en el otro aparato si sigues allí.",
          whyRefused: "Sin una hora confirmada no se crean series, para que ninguna se repita.",
          differ:
            "La hora de este equipo y la de este dispositivo no coinciden (más de 30 segundos).",
          differDo:
            "Prueba desde otro móvil o portátil que tenga la copia. Si siguen sin coincidir, puede que la hora del equipo esté mal: pide ayuda.",
          later:
            "Todavía no se pueden crear las series: ya se usó un minuto posterior a la hora de este equipo.",
          laterFrom: (time: string) => `Podrás seguir a partir de las ${time}.`,
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
    const waits = this.result?.status === "waiting" || this.problem?.kind === "second-clock";
    const canSelect = this.#canSelect && !this.busy && !waits && this.result?.status !== "selected";
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
            </section>`
          : nothing
      }
      ${this.#explain(words, clock)}
      ${
        this.result?.status === "waiting"
          ? html`<section data-test="hour-wait">
              <p role="status">${words.whyWait}</p>
              <p>${words.nothingToDo}</p>
              ${
                this.#countdown.remainingMs === undefined
                  ? nothing
                  : html`<p>
                      ${words.continuesIn}
                      <span role="timer" data-test="remaining"
                        >${formatRemaining(this.#countdown.remainingMs)}</span
                      >
                    </p>`
              }
            </section>`
          : this.result?.status === "selected"
            ? html`<p role="status" data-test="selected-hour">
                ${words.chosen}: <strong>${this.result.identity}</strong>
              </p>`
            : nothing
      }
      <wt-form-actions
        .error=${this.error ? words.failed : !this.refusalDismissed && this.errorMessage ? (this.refusedField === "nodeRecoverySecret" ? words.failed : this.errorMessage) : this.attempted && !this.#credentials() ? words.missing : ""}
      >
        <wt-button
          data-test="compare"
          variant=${this.#canCompare ? "primary" : "secondary"}
          ?disabled=${this.busy || !this.#canCompare}
          @click=${() => void this.#compare()}
          >${this.comparison || this.result ? words.again : words.compare}</wt-button
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
