import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, draftScopeFor, type DraftScope } from "@waitron/ui";
import type {
  InitialSetupActions,
  InitialSetupRecoveryReference,
} from "@waitron/module/src/setup-contract.js";
import type { createRecoveryDelivery } from "../recovery-delivery.js";
import { WAITRON_ID_SISTEMA } from "../software.js";
import type { HourClockDecision } from "../hour-clock.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-disclosure.js";
import "@waitron/ui/src/components/wt-form-actions.js";

type Answer = "no" | "yes" | "unknown";
interface Draft {
  reviewed: boolean;
  confirmed: boolean;
  recoveryRevision: number;
  answer?: Answer;
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
interface Comparison {
  id: string;
  clock: HourClockDecision;
}
type Result =
  | { status: "waiting"; targetMs: number; remainingMs: number | null }
  | {
      status: "selected";
      identity: string;
      input: {
        allocation: { installationIdentity: string; series: { code: string; purpose: string }[] };
      };
    };
const empty = (): Draft => ({ reviewed: false, confirmed: false, recoveryRevision: 0 });
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
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
  @state() private comparison?: Comparison;
  @state() private result?: Result;
  @state() private busy = false;
  @state() private error = false;
  @state() private pdfUrl?: string;
  @state() private pdfKept = false;
  @state() private kept = false;
  #delivery?: ReturnType<typeof createRecoveryDelivery<void>>;
  #reference?: InitialSetupRecoveryReference;
  @state() private remainingMs?: number;
  #waitStarted = 0;
  #waitTimer?: ReturnType<typeof setInterval>;
  #stopWait(): void {
    if (this.#waitTimer) clearInterval(this.#waitTimer);
    this.#waitTimer = undefined;
    this.remainingMs = undefined;
  }
  #startWait(): void {
    this.#stopWait();
    if (this.result?.status !== "waiting" || this.result.remainingMs === null) return;
    const duration = this.result.remainingMs;
    this.#waitStarted = performance.now();
    this.remainingMs = duration;
    this.#waitTimer = setInterval(() => {
      this.remainingMs = Math.max(0, duration - Math.max(0, performance.now() - this.#waitStarted));
      if (this.remainingMs === 0 && this.#waitTimer) {
        clearInterval(this.#waitTimer);
        this.#waitTimer = undefined;
      }
    }, 250);
  }
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
        equal: (a, b) =>
          a.reviewed === b.reviewed &&
          a.confirmed === b.confirmed &&
          a.answer === b.answer &&
          a.recoveryRevision === b.recoveryRevision,
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
    this.#stopWait();
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
    this.result = undefined;
    this.#stopWait();
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
    this.result = undefined;
    this.#stopWait();
    this.error = false;
    this.#changed();
  }
  get #canSelect(): boolean {
    const clock = this.comparison?.clock;
    const box = clock?.usable.find((r) => r.source === "box");
    const accepted =
      clock?.disagreement &&
      this.draft.confirmed &&
      box !== undefined &&
      Math.floor(box.lowerMs / 3600000) === Math.floor(box.upperMs / 3600000);
    return Boolean(
      this.draft.reviewed &&
      (this.context.status === "consumption-intent" ||
        (this.context.status === "claimed" && this.draft.answer)) &&
      clock &&
      !clock.releaseBlocked &&
      !clock.rangeBlocked &&
      (!clock.boundaryWait || accepted) &&
      (!clock.requiresConfirmation || this.draft.confirmed),
    );
  }
  async #compare(): Promise<void> {
    if (!this.api?.preparation || this.busy) return;
    const generation = ++this.#generation,
      api = this.api,
      context = this.context;
    const current = () =>
      this.isConnected &&
      generation === this.#generation &&
      api === this.api &&
      context === this.context;
    this.busy = true;
    this.error = false;
    this.comparison = undefined;
    this.result = undefined;
    this.#stopWait();
    this.draft = { ...this.draft, reviewed: false, confirmed: false };
    this.#changed();
    try {
      const challenge = await api.preparation!({ action: "clock-challenge" });
      if (!current()) return;
      if (!record(challenge) || typeof challenge.id !== "string")
        throw new Error("invalid challenge");
      const compared = await api.preparation!({
        action: "compare-clocks",
        browser: { challengeId: challenge.id, instantMs: Date.now() },
      });
      if (!current()) return;
      if (
        !record(compared) ||
        typeof compared.id !== "string" ||
        !record(compared.clock) ||
        !Array.isArray(compared.clock.usable) ||
        !Array.isArray(compared.clock.unavailable)
      )
        throw new Error("invalid comparison");
      this.comparison = compared as unknown as Comparison;
    } catch {
      if (current()) this.error = true;
    } finally {
      if (current()) this.busy = false;
    }
  }
  async #select(): Promise<void> {
    if (this.busy || !this.#canSelect || this.result?.status === "selected") return;
    const generation = ++this.#generation,
      api = this.api,
      context = this.context;
    const current = () =>
      this.isConnected &&
      generation === this.#generation &&
      api === this.api &&
      context === this.context;
    this.busy = true;
    this.error = false;
    try {
      if (this.comparison!.clock.requiresConfirmation) {
        await api.preparation!({ action: "confirm-clock", comparisonId: this.comparison!.id });
        if (!current()) return;
      }
      const result =
        this.context.status === "claimed"
          ? await api.candidates({ answer: this.draft.answer })
          : await api.request();
      if (!current()) return;
      if (!record(result)) throw new Error("invalid selection");
      if (result.status === "waiting") {
        if (
          !Number.isSafeInteger(result.targetMs) ||
          !(
            result.remainingMs === null ||
            (typeof result.remainingMs === "number" &&
              Number.isFinite(result.remainingMs) &&
              result.remainingMs >= 0)
          )
        )
          throw new Error("invalid wait");
      } else if (result.status === "selected") {
        if (
          result.kind !== "waitron-hour-setup" ||
          typeof result.identity !== "string" ||
          !/^[0-9A-HJKMNP-TV-Z]{4}$/.test(result.identity) ||
          !record(result.input) ||
          !record(result.input.allocation) ||
          result.input.allocation.installationIdentity !== result.identity ||
          !Array.isArray(result.input.allocation.series)
        )
          throw new Error("invalid selection");
        await api.importInput(result.input);
        if (!current()) return;
      } else throw new Error("invalid selection");
      this.result = result as unknown as Result;
      this.#startWait();
    } catch {
      if (current()) this.error = true;
    } finally {
      if (current()) this.busy = false;
    }
  }
  async #preparePdf(replace = false): Promise<void> {
    if (
      this.busy ||
      this.result?.status !== "selected" ||
      (!replace && this.pdfUrl) ||
      !(replace ? this.api.reissueNodeKey : this.api.stageNodeKey) ||
      !this.api.registerRecoveryDocument ||
      !this.api.confirmRecoveryDocument
    )
      return;
    const generation = ++this.#generation,
      api = this.api,
      context = this.context,
      input = this.result.input;
    const current = () =>
      this.isConnected &&
      generation === this.#generation &&
      api === this.api &&
      context === this.context;
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
          installationCodes: [this.result.identity],
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
    const t = en
      ? {
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
          question: "Has anyone set up a Waitron box for this business in the last hour?",
          wider:
            "Include every venue using this taxpayer’s NIF, interrupted setups and recoveries. Arrange them one at a time.",
          no: "No",
          yes: "Yes",
          unknown: "I don’t know",
          compare: "Check clocks again",
          select: "Select hour",
          readings: "Clock comparison",
          agreed: "Clocks agree.",
          box: "Box",
          browser: "Browser",
          internet: "Internet",
          unavailable: "Unavailable",
          confirm: "The box’s displayed date and time are correct.",
          warning:
            "The clocks disagree, or no independent comparison is available. A wrong time can reuse names or date invoices incorrectly.",
          blocked: "Box time precedes this Waitron release.",
          range: "This date is outside the supported hour range.",
          boundary: "The readings cross a UTC hour. Check again after the changeover.",
          waiting: "Wait until",
          remaining: "Remaining",
          chosen: "Selected hour code",
          failed: "Could not complete this step. Check again.",
          next: "Keep your recovery PDF.",
          pdf: "Prepare recovery PDF",
          download: "Download PDF",
          print: "Open to print",
          kept: "I kept the recovery PDF.",
          confirmKept: "Continue",
          complete: "Recovery PDF confirmed.",
          replace: "Replace recovery key",
        }
      : {
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
          question: "¿Alguien ha configurado una caja Waitron para este negocio en la última hora?",
          wider:
            "Incluye todos los locales con este NIF, configuraciones interrumpidas y recuperaciones. Hazlas de una en una.",
          no: "No",
          yes: "Sí",
          unknown: "No lo sé",
          compare: "Volver a comprobar relojes",
          select: "Seleccionar hora",
          readings: "Comparación de relojes",
          agreed: "Los relojes coinciden.",
          box: "Caja",
          browser: "Navegador",
          internet: "Internet",
          unavailable: "No disponible",
          confirm: "La fecha y hora mostradas por la caja son correctas.",
          warning:
            "Los relojes no coinciden o no hay una comparación independiente. Una hora incorrecta puede repetir nombres o fechar mal las facturas.",
          blocked: "La hora de la caja es anterior a esta versión de Waitron.",
          range: "Esta fecha está fuera del rango de horas admitido.",
          boundary: "Las lecturas abarcan dos horas UTC. Comprueba de nuevo tras el cambio.",
          waiting: "Espera hasta",
          remaining: "Queda",
          chosen: "Código de hora seleccionado",
          failed: "No se pudo completar este paso. Comprueba de nuevo.",
          next: "Guarda el PDF de recuperación.",
          pdf: "Preparar PDF de recuperación",
          download: "Descargar PDF",
          print: "Abrir para imprimir",
          kept: "He guardado el PDF de recuperación.",
          confirmKept: "Continuar",
          complete: "PDF de recuperación confirmado.",
          replace: "Sustituir clave de recuperación",
        };
    const venue = this.context.venue,
      clock = this.comparison?.clock;
    const format = (ms: number) =>
      new Intl.DateTimeFormat(en ? "en-GB" : "es-ES", {
        dateStyle: "full",
        timeStyle: "long",
        timeZone: venue.location.timeZone,
      }).format(ms);
    const box = clock?.usable.find((r) => r.source === "box");
    const locked = this.busy || this.result?.status === "selected";
    return html`<h2>${t.heading}</h2>
      <dl data-test="venue-review">
        <dt>${t.environment}</dt>
        <dd>${t[this.context.environment]}</dd>
        <dt>${t.country}</dt>
        <dd>${new Intl.DisplayNames([en ? "en" : "es"], { type: "region" }).of(venue.country)}</dd>
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
      <fieldset ?disabled=${locked}>
        <legend>${t.question} *</legend>
        <p>${t.wider}</p>
        ${(["no", "yes", "unknown"] as const).map((answer) => html`<label><input name="taxpayer-hour" type="radio" value=${answer} required .checked=${this.draft.answer === answer} @change=${() => this.#edit({ answer })} />${t[answer]}</label>`)}
      </fieldset>
      ${
        clock
          ? html`<section data-test="clock-readings" aria-label=${t.readings}>
              ${!clock.requiresConfirmation ? html`<p>${t.agreed}</p>` : nothing}
              <wt-disclosure heading=${t.readings} .open=${clock.requiresConfirmation}>
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
              ${clock.releaseBlocked ? html`<p role="status">${t.blocked}</p>` : nothing}${clock.rangeBlocked ? html`<p role="status">${t.range}</p>` : nothing}${clock.boundaryWait ? html`<p role="status">${t.boundary}</p>` : nothing}
              ${
                clock.requiresConfirmation
                  ? html`<p role="status">${t.warning}</p>
                      <label
                        ><input
                          name="setup-clock-confirmed"
                          type="checkbox"
                          required
                          .checked=${this.draft.confirmed}
                          ?disabled=${locked}
                          @change=${(e: Event) => this.#edit({ confirmed: (e.currentTarget as HTMLInputElement).checked })}
                        />${t.confirm} *</label
                      >`
                  : nothing
              }
            </section>`
          : nothing
      }
      ${
        this.result?.status === "waiting"
          ? html`<p role="status" data-test="hour-wait">
              ${t.waiting} ${format(this.result.targetMs)}
              (${new Date(this.result.targetMs).toISOString()})${this.remainingMs === undefined ? nothing : html`<br />${t.remaining}: <span data-test="remaining">${Math.floor(Math.ceil(this.remainingMs / 1000) / 60)}:${String(Math.ceil(this.remainingMs / 1000) % 60).padStart(2, "0")}</span>`}
            </p>`
          : this.result?.status === "selected"
            ? html`<section data-test="selected-hour">
                <p role="status">${t.chosen}: <strong>${this.result.identity}</strong></p>
                <ul>
                  ${this.result.input.allocation.series.map((s) => html`<li>${s.code}</li>`)}
                </ul>
              </section>`
            : nothing
      }
      ${
        this.result?.status === "selected"
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
          this.result?.status === "selected"
            ? nothing
            : html`<wt-button
                  data-test="compare"
                  variant="primary"
                  ?disabled=${this.busy}
                  @click=${() => void this.#compare()}
                  >${t.compare}</wt-button
                ><wt-button
                  data-test="select"
                  variant=${this.#canSelect && !locked ? "primary" : "secondary"}
                  ?disabled=${locked || !this.#canSelect}
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
