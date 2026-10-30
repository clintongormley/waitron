import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, draftScopeFor, type DraftScope } from "@waitron/ui";
import type {
  InitialSetupActions,
  InitialSetupRecoveryReference,
} from "@waitron/module/src/setup-contract.js";
import type { createRecoveryDelivery } from "../recovery-delivery.js";
import { WAITRON_ID_SISTEMA } from "../software.js";
import { isMinuteIdentity } from "../hour-identity.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-disclosure.js";
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

interface Draft {
  reviewed: boolean;
  recoveryRevision: number;
}
interface Context {
  status: string;
  environment: "production" | "preproduction";
  venue: {
    legalName: string;
    country: string;
    taxId: string;
    seriesCode: string;
    fullSeriesCode?: string;
    rectificativeSeriesCode: string;
    location: { name: string; city: string; fiscalTerritory: string; timeZone: string };
  };
}
interface Selected {
  status: "selected";
  identity: string;
  input: {
    allocation: { installationIdentity: string; series: { code: string; purpose: string }[] };
  };
}
const empty = (): Draft => ({ reviewed: false, recoveryRevision: 0 });
const regionNames = new Map<string, Intl.DisplayNames>();
function regionName(language: "en" | "es", region: string): string | undefined {
  let names = regionNames.get(language);
  if (!names) {
    names = new Intl.DisplayNames([language], { type: "region" });
    regionNames.set(language, names);
  }
  return names.of(region);
}
const strings = {
  en: {
    ...clockWaitStrings.en,
    heading: "Check this venue",
    environment: "Environment",
    production: "Production",
    preproduction: "Preproduction",
    country: "Country",
    place: "Place",
    zone: "Time zone",
    now: "Box time",
    taxId: "Taxpayer NIF",
    review: "The country, place, time zone and displayed time are correct.",
    compare: "Check again",
    select: "Make the series",
    readings: "Clock comparison",
    agreed: "Clocks agree.",
    box: "Box",
    browser: "Browser",
    internet: "Internet",
    unavailable: "Unavailable",
    blocked: "Box time precedes this Waitron release.",
    range: "This date is outside the range of series names.",
    secondClockDo:
      "Connect the box to the internet, or open this page on a phone or till on the venue's network and enter the setup password.",
    secondClockEnds:
      "It carries on by itself once the box reaches the internet, or on the phone if you carry on there.",
    differDo:
      "Try from another phone or till. If they still differ, the box's time may be wrong: ask for help.",
    chosen: "Series name",
    failed: "Could not complete this step. Check again.",
    next: "Keep your recovery PDF.",
    pdf: "Prepare recovery PDF",
    download: "Download PDF",
    print: "Open to print",
    kept: "I kept the recovery PDF.",
    confirmKept: "Continue",
    complete: "Recovery PDF confirmed.",
    replace: "Replace recovery key",
  },
  es: {
    ...clockWaitStrings.es,
    heading: "Comprueba este local",
    environment: "Entorno",
    production: "Producción",
    preproduction: "Preproducción",
    country: "País",
    place: "Lugar",
    zone: "Zona horaria",
    now: "Hora de la caja",
    taxId: "NIF del contribuyente",
    review: "El país, lugar, zona horaria y hora mostrada son correctos.",
    compare: "Comprobar otra vez",
    select: "Crear las series",
    readings: "Comparación de relojes",
    agreed: "Los relojes coinciden.",
    box: "Servidor",
    browser: "Navegador",
    internet: "Internet",
    unavailable: "No disponible",
    blocked: "La hora de la caja es anterior a esta versión de Waitron.",
    range: "Esta fecha está fuera del rango de nombres de serie.",
    secondClockDo:
      "Conecta el equipo a internet, o abre esta página desde un móvil o una caja del local y escribe la contraseña de la configuración.",
    secondClockEnds: "Sigue sola cuando el equipo tenga internet, o en el móvil si sigues allí.",
    differDo:
      "Prueba desde otro móvil o caja. Si siguen sin coincidir, puede que la hora del equipo esté mal: pide ayuda.",
    chosen: "Nombre de las series",
    failed: "No se pudo completar este paso. Comprueba de nuevo.",
    next: "Guarda el PDF de recuperación.",
    pdf: "Preparar PDF de recuperación",
    download: "Descargar PDF",
    print: "Abrir para imprimir",
    kept: "He guardado el PDF de recuperación.",
    confirmKept: "Continuar",
    complete: "PDF de recuperación confirmado.",
    replace: "Sustituir clave de recuperación",
  },
};
@customElement("vf-first-setup-hour")
export class FirstSetupHour extends LitElement {
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
      dl {
        display: grid;
        gap: var(--wt-space-2);
      }
      dd {
        margin: 0;
      }
      a {
        color: var(--wt-color-primary-text);
        min-height: var(--wt-tap-min);
        display: inline-flex;
        align-items: center;
      }
      dt {
        color: var(--wt-color-text-muted);
      }
    `,
  ];
  @property({ attribute: false }) context!: Context;
  @property({ attribute: false }) api!: InitialSetupActions;
  @property() locale: "en" | "es" = "en";
  @state() private draft = empty();
  @state() private comparison?: ClockComparison;
  @state() private busy = false;
  @state() private error = false;
  @state() private pdfUrl?: string;
  @state() private pdfKept = false;
  @state() private kept = false;
  #delivery?: ReturnType<typeof createRecoveryDelivery<void>>;
  #reference?: InitialSetupRecoveryReference;
  #wait = new ClockWait<Selected>(this, () => void this.#select(true));
  #generation = 0;
  #scope?: DraftScope<Draft>;
  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }
  override willUpdate(changed: PropertyValues<this>): void {
    if (this.isConnected && !this.#scope) {
      this.#scope = draftScopeFor(this, {
        id: this,
        parent:
          this.getRootNode() instanceof ShadowRoot
            ? (this.getRootNode() as ShadowRoot).host
            : undefined,
        current: () => this.draft,
        snapshot: (v) => ({ ...v }),
        equal: (a, b) => a.reviewed === b.reviewed && a.recoveryRevision === b.recoveryRevision,
        restore: () => this.#clear(),
      }).scope;
      this.#scope.commit(empty());
    }
    if (changed.has("context") || changed.has("api")) {
      this.#clear();
      void this.#compare();
    }
  }
  override disconnectedCallback(): void {
    ++this.#generation;
    this.#disposeDelivery();
    this.busy = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }
  #disposeDelivery(): void {
    this.#delivery?.dispose();
    this.#delivery = undefined;
    this.#reference = undefined;
    this.pdfUrl = undefined;
    this.pdfKept = false;
    this.kept = false;
  }
  #clear(): void {
    this.#disposeDelivery();
    ++this.#generation;
    this.busy = false;
    this.draft = empty();
    this.comparison = undefined;
    this.#wait.show();
    this.error = false;
    this.#changed();
  }
  #changed(): void {
    this.#scope?.changed();
    this.dispatchEvent(new CustomEvent("initial-setup-changed", { bubbles: true, composed: true }));
  }
  #edit(change: Partial<Draft>): void {
    ++this.#generation;
    this.busy = false;
    this.draft = { ...this.draft, ...change };
    this.#wait.show();
    this.error = false;
    this.#changed();
  }
  get #canSelect(): boolean {
    const clock = this.comparison?.clock;
    return Boolean(this.draft.reviewed && clock && !clock.releaseBlocked && !clock.rangeBlocked);
  }
  #begin() {
    const generation = ++this.#generation,
      api = this.api,
      context = this.context;
    const current = () =>
      this.isConnected &&
      generation === this.#generation &&
      api === this.api &&
      context === this.context;
    const send = async (proposal: unknown) => {
      const answer = await api.preparation!(proposal);
      if (!current()) throw new Error("stale setup");
      return answer;
    };
    return { api, context, current, send };
  }
  async #compare(): Promise<void> {
    if (!this.api?.preparation || this.busy) return;
    const { context, current, send } = this.#begin();
    this.busy = true;
    this.error = false;
    this.comparison = undefined;
    this.#wait.show();
    this.draft = { ...this.draft, reviewed: false };
    this.#changed();
    try {
      const comparison = await readClocks(send);
      this.comparison = comparison;
      if (context.status !== "claimed" || comparison.clock.releaseBlocked) return;
      this.#wait.showPreview(await send({ action: "selection" }));
    } catch (error) {
      if (current() && clockProblem(error) === undefined) this.error = true;
    } finally {
      if (current()) this.busy = false;
    }
  }
  async #select(automatic = false): Promise<void> {
    if (this.busy || this.#wait.result?.status === "selected") return;
    if (!automatic && !this.#canSelect) return;
    const { api, context, current, send } = this.#begin();
    this.busy = true;
    this.error = false;
    // An automatic re-check leaves the current explanation up until its answer replaces it.
    if (!automatic) this.#wait.show();
    try {
      let result: unknown;
      if (context.status === "claimed") {
        const comparison = await readClocks(send);
        this.comparison = comparison;
        if (!comparison.clock.secondClock) return this.#wait.waitForSecondClock();
        if (comparison.clock.disagreement) return this.#wait.show({ kind: "disagreement" });
        result = await api.candidates({ comparisonId: comparison.id });
      } else result = await api.request();
      if (!current()) return;
      if (!record(result)) throw new Error("invalid selection");
      if (result.status === "waiting") {
        if (!validWait(result)) throw new Error("invalid wait");
      } else if (result.status === "selected") {
        if (
          result.kind !== "waitron-hour-setup" ||
          !isMinuteIdentity(result.identity) ||
          !record(result.input) ||
          !record(result.input.allocation) ||
          result.input.allocation.installationIdentity !== result.identity ||
          !Array.isArray(result.input.allocation.series)
        )
          throw new Error("invalid selection");
        await api.importInput(result.input);
        if (!current()) return;
      } else throw new Error("invalid selection");
      this.#wait.show(undefined, result as unknown as Selected);
    } catch (error) {
      if (current())
        this.#wait.settle(error, automatic, () => {
          this.error = true;
        });
    } finally {
      if (current()) this.busy = false;
    }
  }
  async #preparePdf(replace = false): Promise<void> {
    const result = this.#wait.result;
    if (
      this.busy ||
      result?.status !== "selected" ||
      (!replace && this.pdfUrl) ||
      !(replace ? this.api.reissueNodeKey : this.api.stageNodeKey) ||
      !this.api.registerRecoveryDocument ||
      !this.api.confirmRecoveryDocument
    )
      return;
    const input = result.input;
    const { api, context, current } = this.#begin();
    this.busy = true;
    this.error = false;
    if (replace) {
      this.#disposeDelivery();
      this.draft = { ...this.draft, recoveryRevision: this.draft.recoveryRevision + 1 };
      this.#changed();
    }
    let delivery: ReturnType<typeof createRecoveryDelivery<void>> | undefined;
    try {
      const staged = replace ? await api.reissueNodeKey!() : await api.stageNodeKey!();
      if (!current()) return;
      const { createRecoveryDelivery } = await import("../recovery-delivery.js");
      if (!current()) return;
      delivery = createRecoveryDelivery(
        {
          kind: "waitron-recovery-document",
          version: 1,
          scope: {
            taxpayerNif: context.venue.taxId,
            environment: context.environment,
            softwareId: WAITRON_ID_SISTEMA,
          },
          taxpayerName: context.venue.legalName,
          venueName: context.venue.location.name,
          createdAt: new Date().toISOString(),
          nodeKey: staged.key,
        },
        this.locale,
        async () => {
          await api.confirmRecoveryDocument!(this.#reference!);
        },
        context.venue.location.timeZone,
      );
      const binding = await delivery.ready();
      if (!current()) return;
      const canonical = (v: unknown): string => {
        if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
        if (record(v))
          return `{${Object.keys(v)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
            .join(",")}}`;
        return JSON.stringify(v);
      };
      const inputDigest = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(input))),
        ),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      if (!current()) return;
      const reference = {
        stageId: staged.stage.stageId,
        inputDigest,
        bindingDigest: binding.bindingDigest,
        documentDigest: binding.documentDigest,
      };
      await api.registerRecoveryDocument!({ ...reference, statement: binding.statement });
      if (!current()) return;
      const url = await delivery.download();
      if (!current()) return;
      this.#reference = reference;
      this.#delivery = delivery;
      delivery = undefined;
      this.pdfUrl = url;
    } catch {
      if (current()) this.error = true;
    } finally {
      delivery?.dispose();
      if (current()) this.busy = false;
    }
  }
  async #keepPdf(): Promise<void> {
    if (this.busy || !this.pdfKept || !this.#delivery || this.kept) return;
    const generation = ++this.#generation,
      delivery = this.#delivery;
    this.busy = true;
    this.error = false;
    try {
      await delivery.kept();
      if (this.isConnected && generation === this.#generation) {
        this.kept = true;
        this.#scope?.commit({ ...this.draft });
      }
    } catch {
      if (this.isConnected && generation === this.#generation) this.error = true;
    } finally {
      if (this.isConnected && generation === this.#generation) this.busy = false;
    }
  }
  override render() {
    const en = this.locale === "en";
    const t = en ? strings.en : strings.es;
    const venue = this.context.venue,
      clock = this.comparison?.clock;
    const format = (ms: number) =>
      dateTimeFormat(en ? "en" : "es", venue.location.timeZone, {
        dateStyle: "full",
        timeStyle: "long",
      }).format(ms);
    const box = clock?.usable.find((r) => r.source === "box");
    const result = this.#wait.result;
    const locked = this.busy || result?.status === "selected";
    const waits = this.#wait.waiting;
    return html`<h2>${t.heading}</h2>
      <dl data-test="venue-review">
        <dt>${t.environment}</dt>
        <dd>${t[this.context.environment]}</dd>
        <dt>${t.country}</dt>
        <dd>${regionName(en ? "en" : "es", venue.country)}</dd>
        <dt>${t.place}</dt>
        <dd>${venue.location.name} · ${venue.location.city}</dd>
        <dt>${t.taxId}</dt>
        <dd>${venue.taxId}</dd>
        <dt>${t.zone}</dt>
        <dd>${venue.location.timeZone}</dd>
        <dt>${t.now}</dt>
        <dd>${box ? format(box.lowerMs) : t.unavailable}</dd>
      </dl>
      <label
        ><input
          name="setup-details-confirmed"
          type="checkbox"
          required
          .checked=${this.draft.reviewed}
          ?disabled=${locked || !clock}
          @change=${(e: Event) => this.#edit({ reviewed: (e.currentTarget as HTMLInputElement).checked })}
        />${t.review} *</label
      >
      ${
        clock
          ? html`<section data-test="clock-readings" aria-label=${t.readings}>
              ${clock.secondClock && !clock.disagreement ? html`<p>${t.agreed}</p>` : nothing}
              <wt-disclosure heading=${t.readings} .open=${clock.disagreement}>
                <dl>
                  ${clock.usable.map(
                    (r) =>
                      html`<dt>${t[r.source]}</dt>
                        <dd>
                          ${format(r.lowerMs)} – ${format(r.upperMs)}<br />${new Date(r.lowerMs).toISOString()}
                          – ${new Date(r.upperMs).toISOString()}
                        </dd>`,
                  )}${clock.unavailable.map(
                    (r) =>
                      html`<dt>${t[r.source]}</dt>
                        <dd>${t.unavailable}</dd>`,
                  )}
                </dl>
              </wt-disclosure>
              ${clock.releaseBlocked ? html`<p role="status">${t.blocked}</p>` : nothing}${clock.rangeBlocked ? html`<p role="status">${t.range}</p>` : nothing}
            </section>`
          : nothing
      }
      ${renderClockProblem(this.#wait.problem, t, clock)}
      ${
        result?.status === "waiting"
          ? this.#wait.renderWait(t)
          : result?.status === "selected"
            ? html`<section data-test="selected-hour">
                <p role="status">${t.chosen}: <strong>${result.identity}</strong></p>
                <ul>
                  ${result.input.allocation.series.map((s) => html`<li>${s.code}</li>`)}
                </ul>
              </section>`
            : nothing
      }
      ${
        result?.status === "selected"
          ? html`<section aria-label=${t.next}>
              <h3>${t.next}</h3>
              ${
                this.pdfUrl
                  ? html`<p>
                        <a
                          data-test="download-pdf"
                          href=${this.pdfUrl}
                          download="waitron-recovery.pdf"
                          >${t.download}</a
                        >
                      </p>
                      <p>
                        <a data-test="print-pdf" href=${this.pdfUrl} target="_blank" rel="noopener"
                          >${t.print}</a
                        >
                      </p>
                      <label
                        ><input
                          type="checkbox"
                          name="setup-pdf-kept"
                          required
                          .checked=${this.pdfKept}
                          ?disabled=${this.busy || this.kept}
                          @change=${(e: Event) => {
                            this.pdfKept = (e.currentTarget as HTMLInputElement).checked;
                          }}
                        />${t.kept} *</label
                      ><wt-form-actions
                        ><wt-button
                          data-test="kept"
                          variant=${this.pdfKept && !this.kept ? "primary" : "secondary"}
                          ?disabled=${this.busy || !this.pdfKept || this.kept}
                          @click=${() => void this.#keepPdf()}
                          >${t.confirmKept}</wt-button
                        ></wt-form-actions
                      >${this.kept ? html`<p role="status">${t.complete}</p>` : nothing}`
                  : html`<wt-button
                      data-test="prepare-pdf"
                      variant="primary"
                      ?disabled=${this.busy}
                      @click=${() => void this.#preparePdf()}
                      >${t.pdf}</wt-button
                    >`
              }
              ${
                this.api.reissueNodeKey
                  ? html`<wt-button
                      data-test="replace-key"
                      variant=${this.busy ? "secondary" : "primary"}
                      ?disabled=${this.busy}
                      @click=${() => void this.#preparePdf(true)}
                      >${t.replace}</wt-button
                    >`
                  : nothing
              }
            </section>`
          : nothing
      }
      <wt-form-actions data-failed=${String(this.error)} .error=${this.error ? t.failed : ""}
        >${
          result?.status === "selected"
            ? nothing
            : html`<wt-button
                  data-test="compare"
                  variant="primary"
                  ?disabled=${this.busy}
                  @click=${() => void this.#compare()}
                  >${t.compare}</wt-button
                ><wt-button
                  data-test="select"
                  variant=${this.#canSelect && !locked && !waits ? "primary" : "secondary"}
                  ?disabled=${locked || waits || !this.#canSelect}
                  @click=${() => void this.#select()}
                  >${t.select}</wt-button
                >`
        }
      </wt-form-actions>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "vf-first-setup-hour": FirstSetupHour;
  }
}
