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
import "@waitron/ui/src/components/wt-form-actions.js";
import {
  ClockWait,
  clockProblem,
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
    name: string;
    city: string;
    fiscalTerritory: string;
    timeZone: string;
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
const strings = {
  en: {
    ...clockWaitStrings.en,
    ...checkVenueStrings.en,
    place: "Place",
    seriesLine:
      "When you press Proceed, Waitron creates this box's invoice series. The invoice series is the code at the start of every invoice number: for example, in A-0CSQW/1 the series is A-0CSQW.",
    secondClockDo:
      "Connect the box to the internet, or open this page on a phone or till on the venue's network and enter the setup password.",
    secondClockEnds:
      "It carries on by itself once the box reaches the internet, or on the phone if you carry on there.",
    next: "Keep your recovery pack.",
    packWhy:
      "The recovery pack is a PDF holding this box's server key. If this box ever fails, restoring this venue's backups onto a new box asks for that key, so keep the pack somewhere safe, away from the box.",
    download: "Download recovery pack",
    print: "Open to print",
    kept: "I kept the recovery pack.",
    confirmKept: "Continue",
    complete: "Recovery pack confirmed.",
    replace: "Make the pack again with a new server key",
  },
  es: {
    ...clockWaitStrings.es,
    ...checkVenueStrings.es,
    place: "Lugar",
    seriesLine:
      "Cuando pulses Continuar, Waitron creará las series de facturas de este servidor. La serie de facturas es el código al principio de cada número de factura: por ejemplo, en A-0CSQW/1 la serie es A-0CSQW.",
    secondClockDo:
      "Conecta el servidor a internet, o abre esta página desde un móvil o una caja del local y escribe la contraseña de la configuración.",
    secondClockEnds: "Sigue sola cuando el servidor tenga internet, o en el móvil si sigues allí.",
    next: "Guarda el paquete de recuperación.",
    packWhy:
      "El paquete de recuperación es un PDF con la clave de este servidor. Si este servidor falla, restaurar las copias de este local en un servidor nuevo pide esa clave, así que guarda el paquete en un lugar seguro, lejos del servidor.",
    download: "Descargar el paquete de recuperación",
    print: "Abrir para imprimir",
    kept: "He guardado el paquete de recuperación.",
    confirmKept: "Continuar",
    complete: "Paquete de recuperación confirmado.",
    replace: "Hacer el paquete otra vez con una nueva clave del servidor",
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
      a {
        color: var(--wt-color-primary-text);
        min-height: var(--wt-tap-min);
        display: inline-flex;
        align-items: center;
      }
    `,
    checkVenueStyles,
  ];
  @property({ attribute: false }) context!: Context;
  @property({ attribute: false }) api!: InitialSetupActions;
  @property() locale: "en" | "es" = "en";
  @state() private draft = empty();
  @state() private comparison?: ClockComparison;
  @state() private busy = false;
  /** The button whose own request is being sent, which stays on screen while it is. */
  @state() private sending?: "proceed" | "compareAgain" | "tryAgain";
  @state() private error = false;
  @state() private pdfUrl?: string;
  @state() private pdfKept = false;
  @state() private kept = false;
  #delivery?: ReturnType<typeof createRecoveryDelivery<void>>;
  #reference?: InitialSetupRecoveryReference;
  #wait = new ClockWait<Selected>(this, () => void this.#run(true));
  /** Proceed was pressed and no field has changed since: the page carries on to the series. */
  #confirmed = false;
  /**
   * The box had recorded a wait before this page asked it for one or any field changed, so while the
   * page carries on by itself its own re-checks go on to the series without the tick or Proceed.
   */
  #recordedWait = false;
  /**
   * Since it loaded, the page asked the box for the series, a field changed, or it was taken off the
   * screen.
   */
  #askedOrEdited = false;
  #generation = 0;
  #scope?: DraftScope<Draft>;
  #seriesShown = false;
  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }
  override updated(): void {
    const shown = this.#wait.result?.status === "selected";
    if (shown && !this.#seriesShown)
      focusNewScreen(
        this.shadowRoot!,
        this.shadowRoot!.querySelector<HTMLElement>("[data-test=selected-hour] h2"),
      );
    this.#seriesShown = shown;
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
      void this.#run();
    }
  }
  override disconnectedCallback(): void {
    ++this.#generation;
    this.#disposeDelivery();
    this.busy = false;
    this.sending = undefined;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#confirmed = false;
    this.#recordedWait = false;
    this.#askedOrEdited = true;
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
    this.sending = undefined;
    this.draft = empty();
    this.comparison = undefined;
    this.#confirmed = false;
    this.#recordedWait = false;
    this.#askedOrEdited = false;
    this.#wait.show();
    this.error = false;
    this.#changed();
  }
  #changed(): void {
    this.#scope?.changed();
    this.dispatchEvent(new CustomEvent("initial-setup-changed", { bubbles: true, composed: true }));
  }
  /**
   * Stops a page that was carrying on to the series. Before that, what the clocks showed stays up,
   * and a wait for a second clock keeps checking.
   */
  #edit(change: Partial<Draft>): void {
    const carrying = this.#confirmed || this.#recordedWait;
    ++this.#generation;
    this.busy = false;
    this.sending = undefined;
    this.draft = { ...this.draft, ...change };
    this.#confirmed = false;
    this.#recordedWait = false;
    this.#askedOrEdited = true;
    if (carrying) this.#wait.show();
    this.error = false;
    this.#changed();
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
  async #run(automatic = false): Promise<void> {
    if (!this.api?.preparation || this.busy || this.#wait.result?.status === "selected") return;
    const { api, context, current, send } = this.#begin();
    const recorded = this.#recordedWait;
    this.busy = true;
    this.error = false;
    // An automatic re-check leaves the current explanation up until its answer replaces it.
    if (!automatic) this.#wait.show();
    try {
      const comparison = await readClocks(send);
      this.comparison = comparison;
      const { clock } = comparison;
      if (clock.releaseBlocked || clock.rangeBlocked) return this.#wait.show();
      const claimed = context.status === "claimed";
      if (claimed && !clock.secondClock) return this.#wait.waitForSecondClock();
      if (!this.#confirmed && !recorded) {
        this.#wait.show();
        if (!claimed || clock.disagreement) return;
        this.#wait.showPreview(await send({ action: "selection" }));
        this.#recordedWait = !this.#askedOrEdited && this.#wait.counting;
        return;
      }
      if (claimed && clock.disagreement) return this.#wait.show({ kind: "disagreement" });
      let result: unknown;
      this.#askedOrEdited = true;
      if (claimed) result = await api.candidates({ comparisonId: comparison.id });
      else result = await api.request();
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
          !Array.isArray(result.input.allocation.series) ||
          !result.input.allocation.series.every(
            (series) => record(series) && typeof series.code === "string" && series.code !== "",
          )
        )
          throw new Error("invalid selection");
        await api.importInput(result.input);
        if (!current()) return;
      } else throw new Error("invalid selection");
      this.#wait.show(undefined, result as unknown as Selected);
    } catch (error) {
      // Before Proceed the clock step stays hidden; Proceed asks the box again.
      if (
        current() &&
        !this.#confirmed &&
        !recorded &&
        clockProblem(error)?.kind === "disagreement"
      )
        this.#wait.show();
      else if (current())
        this.#wait.settle(error, automatic, () => {
          this.error = true;
        });
    } finally {
      if (current()) {
        this.busy = false;
        this.sending = undefined;
        if (!this.#wait.waiting) this.#recordedWait = false;
      }
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
          venueName: context.venue.name,
          createdAt: new Date().toISOString(),
          nodeKey: staged.key,
        },
        this.locale,
        async () => {
          await api.confirmRecoveryDocument!(this.#reference!);
        },
        context.venue.timeZone,
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
      await this.updateComplete;
      if (current())
        this.shadowRoot?.querySelector<HTMLAnchorElement>("a[data-test=download-pdf]")?.click();
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
    const result = this.#wait.result;
    const locked = this.busy || result?.status === "selected";
    const carrying = this.#confirmed || this.#recordedWait;
    const problem = this.#wait.problem?.kind;
    const sending = this.busy ? this.sending : undefined;
    const action =
      sending ??
      (locked || problem === "in-use"
        ? undefined
        : this.error
          ? "tryAgain"
          : clock?.releaseBlocked ||
              clock?.rangeBlocked ||
              problem === "disagreement" ||
              problem === "later"
            ? "compareAgain"
            : carrying && this.#wait.waiting
              ? undefined
              : "proceed");
    const enabled = !sending && (action !== "proceed" || this.draft.reviewed);
    const failure = html`<wt-form-actions
      data-failed=${String(this.error)}
      .error=${this.error ? t.failed : ""}
      >${
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
              >${t[action]}</wt-button
            >`
          : nothing
      }${
        result?.status === "selected" || carrying || sending
          ? nothing
          : html`<wt-button
              slot="secondary"
              data-test="change-details"
              variant="secondary"
              @click=${() =>
                this.dispatchEvent(
                  new CustomEvent("initial-change-details", { bubbles: true, composed: true }),
                )}
              >${t.changeDetails}</wt-button
            >`
      }
    </wt-form-actions>`;
    if (result?.status === "selected")
      return html`<section data-test="selected-hour" role="status">
          <h2 tabindex="-1">${t.chosen}</h2>
          <ul>
            ${result.input.allocation.series.map((s) => html`<li>${s.code}</li>`)}
          </ul>
        </section>
        <section aria-label=${t.next}>
          <h3>${t.next}</h3>
          <p data-test="pack-why">${t.packWhy}</p>
          ${
            this.pdfUrl
              ? html`<p>
                    <a
                      data-test="download-pdf"
                      href=${this.pdfUrl}
                      download="waitron-recovery-pack-1.pdf"
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
                  >${t.download}</wt-button
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
        </section>
        ${failure}`;
    return html`<h2>${t.checkHeading}</h2>
      <dl class="details" data-test="venue-review" data-clock=${clock ? "read" : "reading"}>
        ${detailRow(t.environment, t[this.context.environment])}
        ${detailRow(t.country, regionName(this.locale, venue.country))}
        ${detailRow(t.place, `${venue.name} · ${venue.city}`)} ${detailRow(t.taxId, venue.taxId)}
        ${detailRow(t.zone, venue.timeZone)}
      </dl>
      ${
        clock
          ? html`${clock.releaseBlocked ? html`<p role="status">${t.blocked}</p>` : nothing}${clock.rangeBlocked ? html`<p role="status">${t.rangeBlocked}</p>` : nothing}`
          : nothing
      }
      <label
        ><input
          name="setup-details-confirmed"
          type="checkbox"
          required
          .checked=${this.draft.reviewed}
          ?disabled=${locked || !clock}
          @change=${(e: Event) => this.#edit({ reviewed: (e.currentTarget as HTMLInputElement).checked })}
        />${t.detailsCorrect} *</label
      >
      ${action === "proceed" && !sending ? html`<p data-test="series-line">${t.seriesLine}</p>` : nothing}
      ${this.#wait.renderProblem(
        carrying ? t : { ...t, secondClockEnds: "" },
        clock,
        this.locale,
        venue.timeZone,
      )}
      ${this.#wait.counting ? this.#wait.renderWait(t) : nothing} ${failure}`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "vf-first-setup-hour": FirstSetupHour;
  }
}
