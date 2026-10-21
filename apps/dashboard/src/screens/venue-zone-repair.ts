import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, draftScopeFor, saveActionState, type DraftScope } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { DashboardApi, TradingAdmissionView, ZoneRepairView } from "../api/client.js";
import { t, fill } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { guideHref } from "../help-guide.js";
import { LocaleChangeController } from "../state/locale-controller.js";

type Draft = { timeZone: string; confirmed: boolean };

@customElement("dashboard-venue-zone-repair")
export class VenueZoneRepair extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
        max-width: var(--wt-form-max-width);
      }
      form,
      .preview,
      dl {
        display: grid;
        gap: var(--wt-space-3);
      }
      h1 {
        font-size: var(--wt-font-size-xl);
      }
      .preview {
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }
      dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
      dt {
        color: var(--wt-color-text-muted);
      }
      .error {
        color: var(--wt-color-danger);
      }
      a {
        color: var(--wt-color-primary-text);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @property({ type: Boolean }) canConfigure = false;
  @property({ attribute: false }) admission: TradingAdmissionView = { state: "unchecked" };
  @property() sessionKey = "";
  @property({ attribute: false }) reload: () => void = () => location.reload();
  @state() private view?: ZoneRepairView;
  @state() private draft: Draft = { timeZone: "", confirmed: false };
  @state() private preview?: ZoneRepairView["preview"];
  @state() private busy = false;
  @state() private loading = false;
  @state() private previewLoading = false;
  @state() private attempted = false;
  @state() private complete = false;
  @state() private ready = false;
  @state() private uncertain = false;
  @state() private loadError = "";
  @state() private actionError = "";
  @state() private previewError = "";
  @state() private fieldError = "";
  #scope?: DraftScope<Draft>;
  #generation = 0;
  #read = 0;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override willUpdate(changed: PropertyValues): void {
    if (
      changed.has("api") ||
      changed.has("canConfigure") ||
      changed.has("sessionKey") ||
      (changed.has("admission") &&
        (changed.get("admission") as TradingAdmissionView | undefined)?.state !==
          this.admission.state)
    ) {
      this.#generation++;
      this.#read++;
      this.#scope?.dispose();
      this.#scope = undefined;
      this.view = undefined;
      this.preview = undefined;
      this.draft = { timeZone: "", confirmed: false };
      this.attempted = false;
      this.busy = false;
      this.uncertain = false;
      this.actionError = "";
      this.loadError = "";
      this.fieldError = "";
      this.previewError = "";
      this.ready = false;
      this.complete = this.admission.state === "restart_required";
      if (this.canConfigure && !this.complete && this.admission.state !== "unchecked")
        void this.#loadStatus();
    }
  }
  override connectedCallback(): void {
    super.connectedCallback();
    if (this.view && this.canConfigure && !this.complete) {
      this.#register();
      this.busy = false;
      this.uncertain = true;
      void this.#loadStatus();
    }
  }
  override disconnectedCallback(): void {
    this.#generation++;
    this.#read++;
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }
  #active(generation: number): boolean {
    return this.isConnected && generation === this.#generation && this.canConfigure;
  }
  #register(): void {
    if (this.#scope || this.complete) return;
    this.#scope = draftScopeFor<Draft>(this, {
      id: this,
      current: () => this.draft,
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => a.timeZone === b.timeZone && a.confirmed === b.confirmed,
      restore: (value) => {
        this.draft = value;
        this.attempted = false;
        this.fieldError = "";
        this.actionError = "";
        void this.#previewChoice();
      },
    }).scope;
    this.#scope.commit({ timeZone: "", confirmed: false });
  }
  #acceptSaved(ready = false): void {
    this.ready ||= ready;
    this.complete = true;
    this.uncertain = false;
    this.preview = undefined;
    this.#scope?.commit(this.draft);
    this.#scope?.dispose();
    this.#scope = undefined;
  }
  async #loadStatus(): Promise<void> {
    const generation = this.#generation,
      read = ++this.#read;
    this.loading = true;
    this.previewLoading = false;
    this.loadError = "";
    try {
      let view: ZoneRepairView;
      try {
        view = await this.api.getVenueZoneRepair();
      } catch (error) {
        if ((error as { status?: number } | null)?.status === 404) {
          const session = await this.api.getMe();
          if (!this.#active(generation) || read !== this.#read) return;
          const state = session.tradingAdmission?.state;
          if (state === "ready" || state === "restart_required") {
            this.#acceptSaved(state === "ready");
            return;
          }
        }
        throw error;
      }
      if (!this.#active(generation) || read !== this.#read) return;
      const changed = this.view !== undefined && view.clockRevision !== this.view.clockRevision;
      this.view = view;
      this.uncertain = false;
      this.loading = false;
      if (
        !view.eligible ||
        view.category === "valid" ||
        view.admission.state === "restart_required"
      )
        this.#acceptSaved(view.admission.state === "ready");
      else if (!this.complete) {
        this.#register();
        if (changed) {
          this.draft = { ...this.draft, confirmed: false };
          this.preview = undefined;
          this.#scope?.changed();
        }
        if (this.draft.timeZone && (changed || !this.preview)) void this.#previewChoice();
      }
    } catch (error) {
      if (this.#active(generation) && read === this.#read)
        this.loadError = codeMessage(codeOf(error));
    } finally {
      if (this.#active(generation) && read === this.#read) this.loading = false;
    }
  }
  #problems(): { zone: boolean; confirmation: boolean } {
    return {
      zone: !this.view?.choices.includes(this.draft.timeZone),
      confirmation: !this.draft.confirmed,
    };
  }
  #change(field: keyof Draft, event: CustomEvent<{ value?: string; checked?: boolean }>): void {
    event.stopPropagation();
    if (this.busy || this.complete || this.uncertain || !this.canConfigure) return;
    this.draft =
      field === "timeZone"
        ? { timeZone: event.detail.value ?? "", confirmed: false }
        : { ...this.draft, confirmed: event.detail.checked === true };
    this.#scope?.changed();
    if (field === "timeZone") this.fieldError = "";
    if (field === "timeZone") void this.#previewChoice();
  }
  async #previewChoice(): Promise<void> {
    const generation = this.#generation,
      read = ++this.#read;
    this.preview = undefined;
    this.previewError = "";
    this.previewLoading = false;
    if (!this.draft.timeZone || !this.view?.choices.includes(this.draft.timeZone)) return;
    this.previewLoading = true;
    try {
      const view = await this.api.getVenueZoneRepair(this.draft.timeZone);
      if (!this.#active(generation) || read !== this.#read || this.complete) return;
      if (
        !view.eligible ||
        view.category === "valid" ||
        view.admission.state === "restart_required"
      ) {
        this.view = view;
        this.#acceptSaved();
      } else if (view.clockRevision !== this.view.clockRevision) {
        this.view = view;
        this.draft = { ...this.draft, confirmed: false };
        this.#scope?.changed();
        this.preview = view.preview;
      } else this.preview = view.preview;
    } catch (error) {
      if (this.#active(generation) && read === this.#read)
        this.previewError = codeMessage(codeOf(error));
    } finally {
      if (this.#active(generation) && read === this.#read) this.previewLoading = false;
    }
  }
  async #save(): Promise<void> {
    if (
      !this.isConnected ||
      !this.canConfigure ||
      this.busy ||
      this.complete ||
      this.uncertain ||
      !this.view ||
      this.loading ||
      saveActionState(this.#scope).unchanged
    )
      return;
    this.attempted = true;
    const problems = this.#problems();
    if (problems.zone || problems.confirmation) {
      await this.updateComplete;
      this.renderRoot
        .querySelector<HTMLElement>(problems.zone ? "[name=timeZone]" : "[name=confirmed]")
        ?.focus();
      return;
    }
    if (
      saveActionState(this.#scope).unchanged ||
      !this.preview ||
      this.previewLoading ||
      this.previewError
    )
      return;
    const generation = this.#generation;
    this.busy = true;
    this.actionError = "";
    this.fieldError = "";
    try {
      await this.api.confirmVenueZone({
        timeZone: this.draft.timeZone,
        expectedClockRevision: this.view.clockRevision,
        confirmed: true,
      });
      if (!this.#active(generation)) return;
      this.#read++;
      this.#acceptSaved();
      await this.#loadStatus();
    } catch (error) {
      if (!this.#active(generation)) return;
      const code = codeOf(error);
      this.actionError = codeMessage(code);
      const params = (error as { params?: { field?: string } } | null)?.params;
      if (params?.field === "timeZone" || code === "venue.time_zone_invalid") {
        this.fieldError = this.actionError;
        this.actionError = "";
      }
      if (
        code === "connection.failed" ||
        code === "connection.timed_out" ||
        code === "server.internal" ||
        code === "venue.time_zone_repair_not_needed" ||
        code === "venue.business_day_changed"
      ) {
        this.uncertain = true;
        await this.#loadStatus();
      }
    } finally {
      if (this.#active(generation)) this.busy = false;
    }
  }
  override render() {
    const problems = this.#problems();
    const zoneError = this.attempted && problems.zone ? t("zone_repair.choose") : this.fieldError;
    const confirmationError =
      this.attempted && problems.confirmation ? t("zone_repair.confirm_required") : "";
    const action = saveActionState(this.#scope);
    const blocked =
      this.busy ||
      this.loading ||
      this.uncertain ||
      this.previewLoading ||
      !!this.previewError ||
      (this.attempted && (problems.zone || problems.confirmation));
    const preview = this.preview;
    return html`<h1>${t("zone_repair.heading")}</h1>
      ${!this.complete && this.admission.state !== "unchecked" ? html`<p>${t("zone_repair.explanation")}</p>` : nothing}
      ${
        this.complete
          ? html`<p role="status" data-test="restart">
                ${t(this.ready ? "zone_repair.ready" : "venue.time_zone_restart")}
              </p>
              <wt-button variant="secondary" data-test="reload" @click=${() => this.reload()}
                >${t("zone_repair.reload")}</wt-button
              >`
          : nothing
      }
      ${this.admission.state === "unchecked" ? html`<p role="status">${t("venue.time_zone_wait")}</p>` : nothing}
      ${this.loadError ? html`<p class="error" role="alert" data-test="load-error">${t("zone_repair.load_failed")} ${this.loadError}</p>` : nothing}
      ${(this.loadError || this.uncertain) && this.canConfigure ? html`<wt-button data-test="retry-status" variant="secondary" ?disabled=${this.loading} @click=${() => void this.#loadStatus()}>${t("zone_repair.check_status")}</wt-button>` : nothing}
      ${this.loading && !this.view ? html`<p role="status">${t("zone_repair.loading")}</p>` : nothing}
      ${
        this.canConfigure && this.view?.eligible && !this.complete
          ? html`<form
              @submit=${(event: Event) => {
                event.preventDefault();
                void this.#save();
              }}
            >
              <p data-test="suggestion">
                ${fill("zone_repair.suggestion", { zone: this.view.suggestion ?? t("zone_repair.choose"), country: this.view.country, province: this.view.province ?? "" })}
              </p>
              <wt-combobox
                name="timeZone"
                required
                label=${t("zone_repair.zone")}
                placeholder=${t("zone_repair.choose")}
                .options=${this.view.choices.map((value) => ({ value, label: value }))}
                .value=${this.draft.timeZone}
                .error=${zoneError}
                ?disabled=${this.busy || this.uncertain}
                @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change("timeZone", event)}
              ></wt-combobox>
              <p>${t("zone_repair.cutover")} ${this.view.clock.dayCutover}</p>
              ${
                preview
                  ? html`<dl class="preview" data-test="preview">
                      <div>
                        <dt>${t("zone_repair.local_time")}</dt>
                        <dd>${preview.civilDate} ${preview.timeOfDay}</dd>
                      </div>
                      <div>
                        <dt>${t("zone_repair.offset")}</dt>
                        <dd>${preview.offsetMinutes >= 0 ? "+" : ""}${preview.offsetMinutes}</dd>
                      </div>
                      <div>
                        <dt>${t("zone_repair.business_date")}</dt>
                        <dd>${preview.businessDay}</dd>
                      </div>
                      <div>
                        <dt>${t("zone_repair.cutover")}</dt>
                        <dd>${preview.dayCutover}</dd>
                      </div>
                    </dl>`
                  : nothing
              }
              ${this.previewLoading ? html`<p role="status">${t("zone_repair.loading")}</p>` : nothing}
              ${
                this.previewError
                  ? html`<p class="error" role="alert">${this.previewError}</p>
                      <wt-button
                        variant="secondary"
                        data-test="retry-preview"
                        @click=${() => void this.#previewChoice()}
                        >${t("zone_repair.retry_preview")}</wt-button
                      >`
                  : nothing
              }
              <wt-switch
                name="confirmed"
                label=${`${t("zone_repair.confirm")} *`}
                .checked=${this.draft.confirmed}
                description=${confirmationError}
                ?disabled=${this.busy || this.uncertain}
                @wt-change=${(event: CustomEvent<{ checked: boolean }>) => this.#change("confirmed", event)}
              ></wt-switch>
              ${confirmationError ? html`<p class="error" role="alert" data-test="confirmation-error">${confirmationError}</p>` : nothing}
              <wt-form-actions
                error=${[zoneError || confirmationError ? t("form.fix_fields") : "", this.actionError].filter(Boolean).join(" ")}
              >
                <wt-button
                  data-test="save"
                  variant=${action.variant}
                  ?disabled=${action.unchanged || blocked}
                  @click=${() => void this.#save()}
                  >${t("action.save")}</wt-button
                >
              </wt-form-actions>
            </form>`
          : nothing
      }
      ${this.canConfigure ? html`<p><a href=${guideHref("venue.time-zone")}>${t("zone_repair.guide")}</a></p>` : nothing}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-venue-zone-repair": VenueZoneRepair;
  }
}
