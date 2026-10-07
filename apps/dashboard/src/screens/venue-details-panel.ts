import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  leaveCoordinatorFor,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import { DashboardQueries } from "../api/query-controller.js";
import type {
  DashboardApi,
  VenueDetailsModel,
  VenueDetailValues,
  VenueDetailField,
  VenueClockPreview,
  VenueClockView,
} from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import {
  VENUE_DETAIL_FIELDS,
  venueDetailPatch,
  venueDetailProblems,
} from "./venue-details-form.js";

const LABELS: Record<VenueDetailField, StringKey> = {
  name: "venue_details.name",
  addressLine1: "venue_details.addressLine1",
  addressLine2: "venue_details.addressLine2",
  postalCode: "venue_details.postalCode",
  city: "venue_details.city",
  province: "venue_details.province",
  timeZone: "venue_details.timeZone",
  dayCutover: "venue_details.dayCutover",
};
const HELP: Record<VenueDetailField, StringKey> = {
  name: "venue_details.name_warning",
  addressLine1: "venue_details.address_notice",
  addressLine2: "venue_details.address_notice",
  postalCode: "venue_details.postcode_warning",
  city: "venue_details.city_warning",
  province: "venue_details.geography_context",
  timeZone: "venue_details.clock_warning",
  dayCutover: "venue_details.clock_warning",
};
const PROBLEMS: Record<string, StringKey> = {
  required: "venue_details.required",
  length: "venue_details.length",
  cutover: "venue_details.cutover",
  time_zone: "venue_details.time_zone",
  country_unavailable: "venue_details.geography_context",
};
const REASONS: Record<string, StringKey> = {
  sales: "venue_details.sales",
  orders: "venue_details.orders",
  daily_close: "venue_details.daily_close",
  geography_context: "venue_details.geography_context",
};
const nameOf = (field: VenueDetailField) => (field === "name" ? "venueName" : field);

@customElement("dashboard-venue-details-panel")
export class VenueDetailsPanel extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      dl {
        display: grid;
        gap: var(--wt-space-2);
        margin: 0 0 var(--wt-space-4);
      }
      dt {
        font-weight: var(--wt-font-weight-medium);
      }
      dd {
        margin: 0 0 var(--wt-space-2);
        overflow-wrap: anywhere;
      }
      form {
        display: grid;
        gap: var(--wt-space-3);
      }
      .field {
        min-width: 0;
      }
      .reason {
        color: var(--wt-color-text-muted);
        max-width: var(--wt-field-max-width);
      }
      .warnings {
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        max-width: var(--wt-field-max-width);
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) readOnly = false;
  @state() private model?: VenueDetailsModel;
  @state() private draft?: VenueDetailValues;
  @state() private submitting = false;
  @state() private errors: Partial<Record<VenueDetailField, string>> = {};
  @state() private attempted = false;
  @state() private actionError = "";
  @state() private readError = "";
  @state() private acknowledged = "";
  @state() private clockPreview?: VenueClockPreview;
  @state() private clockError = "";
  #clockKey = "";
  #previewSequence = 0;
  #expected?: VenueDetailValues;
  #generation = 0;
  #scope?: DraftScope<VenueDetailValues>;
  #leave?: LeaveCoordinator;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.readError = codeMessage(codeOf(error));
    },
    () => {
      this.readError = "";
    },
  );

  override connectedCallback(): void {
    super.connectedCallback();
    this.#generation += 1;
    this.#registerDraft();
    void this.#load();
  }
  override disconnectedCallback(): void {
    this.#generation += 1;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.submitting = false;
    this.#previewSequence += 1;
    this.#clockKey = "";
    this.clockPreview = undefined;
    super.disconnectedCallback();
  }
  async #load(): Promise<void> {
    const generation = this.#generation;
    try {
      await this.#queries.watch("getVenueDetails", [], (model) => {
        if (generation !== this.#generation) return;
        this.model = model;
        this.readError = "";
        this.#refreshPreview();
      });
    } catch (error) {
      if (generation === this.#generation) this.readError = codeMessage(codeOf(error));
    }
  }
  #begin(): void {
    if (!this.model || this.readOnly) return;
    this.#expected = { ...this.model.details };
    this.draft = { ...this.model.details };
    this.errors = {};
    this.attempted = false;
    this.actionError = "";
    this.acknowledged = "";
    this.#registerDraft();
  }
  #registerDraft(): void {
    if (!this.isConnected || !this.draft || !this.#expected || this.#scope) return;
    this.#leave = leaveCoordinatorFor(this);
    if (!this.#leave) return;
    this.#scope = this.#leave.register({
      id: this,
      current: () => this.draft!,
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => Object.keys(venueDetailPatch(a, b)).length === 0,
      restore: (value) => {
        this.draft = value;
        this.errors = {};
        this.actionError = "";
        this.attempted = false;
        this.acknowledged = "";
        this.#refreshPreview();
      },
    });
    this.#scope.commit(this.#expected);
  }
  #requestCancel(): void {
    if (this.submitting || !this.isConnected) return;
    const scope = this.#scope;
    if (!scope || !this.#leave) {
      this.#cancel();
      return;
    }
    void this.#leave.request({
      scopes: [this],
      reason: "cancel",
      proceed: () => {
        if (this.isConnected && this.#scope === scope) this.#cancel();
      },
    });
  }
  #cancel(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.draft = undefined;
    this.#expected = undefined;
    this.errors = {};
    this.actionError = "";
    this.attempted = false;
    this.acknowledged = "";
    this.#previewSequence += 1;
    this.#clockKey = "";
    this.clockPreview = undefined;
    this.clockError = "";
  }
  #patch() {
    return this.#expected && this.draft ? venueDetailPatch(this.#expected, this.draft) : {};
  }
  #warnings(): StringKey[] {
    const patch = this.#patch();
    const warnings: StringKey[] = [];
    if (patch.name !== undefined) warnings.push("venue_details.name_warning");
    if (patch.postalCode !== undefined) warnings.push("venue_details.postcode_warning");
    if (patch.city !== undefined) warnings.push("venue_details.city_warning");
    if (patch.province !== undefined) warnings.push("venue_details.geography_context");
    if (patch.timeZone !== undefined || patch.dayCutover !== undefined)
      warnings.push("venue_details.clock_warning");
    return warnings;
  }
  #previewKey(): string {
    const patch = this.#patch();
    if (
      !this.model ||
      !this.draft ||
      (patch.timeZone === undefined && patch.dayCutover === undefined) ||
      Object.keys(venueDetailProblems(patch)).length > 0
    )
      return "";
    return JSON.stringify([
      this.model.details.timeZone,
      this.model.details.dayCutover,
      patch.timeZone ?? this.model.details.timeZone,
      patch.dayCutover ?? this.model.details.dayCutover.slice(0, 5),
    ]);
  }
  #previewReady(): boolean {
    return !this.#previewKey() || (!!this.clockPreview && this.#clockKey === this.#previewKey());
  }
  #refreshPreview(force = false): void {
    const key = this.#previewKey();
    if (!force && key === this.#clockKey) return;
    this.#clockKey = key;
    this.clockPreview = undefined;
    this.clockError = "";
    this.acknowledged = "";
    const sequence = ++this.#previewSequence;
    if (!key) return;
    const patch = this.#patch();
    void this.api
      .getVenueClockPreview({
        timeZone: patch.timeZone ?? this.model!.details.timeZone,
        dayCutover: patch.dayCutover ?? this.model!.details.dayCutover.slice(0, 5),
      })
      .then((preview) => {
        if (sequence !== this.#previewSequence) return;
        this.clockPreview = preview;
      })
      .catch((error: unknown) => {
        if (sequence === this.#previewSequence) this.clockError = codeMessage(codeOf(error));
      });
  }
  #clockView(clock: VenueClockView | null, proposed: boolean): TemplateResult {
    return html`<div data-test=${proposed ? "clock-proposed" : "clock-current"}>
      <strong
        >${t(proposed ? "venue_details.proposed_clock" : "venue_details.current_clock")}</strong
      >
      ${
        clock
          ? html`<dl>
                <dt>${t("venue_details.timeZone")}</dt>
                <dd>${clock.timeZone}</dd>
                <dt>${t("venue_details.dayCutover")}</dt>
                <dd>${clock.dayCutover}</dd>
                <dt>${t("venue_details.local_time")}</dt>
                <dd>${clock.civilDate} ${clock.timeOfDay}</dd>
                <dt>${t("venue_details.business_day")}</dt>
                <dd>${clock.businessDay}</dd>
              </dl>
              <p>${t("venue_details.transitions")}</p>
              ${
                clock.transitions.length
                  ? clock.transitions.map(
                      (change) =>
                        html`<dl>
                          <dt>${t("venue_details.clock_change")}</dt>
                          <dd>${change.at}</dd>
                          <dt>${t("venue_details.resolved_cutover")}</dt>
                          <dd>${change.civilDate} ${change.boundaryTime} (${change.boundaryAt})</dd>
                        </dl>`,
                    )
                  : html`<p>${t("venue_details.no_transitions")}</p>`
              }`
          : html`<p>${t("venue_details.clock_unavailable")}</p>`
      }
    </div>`;
  }
  #renderClockPreview(): TemplateResult | typeof nothing {
    if (!this.#previewKey()) return nothing;
    const preview = this.clockPreview;
    if (!preview)
      return html`<div>
        ${
          this.clockError
            ? html`<p role="alert" class="error" data-test="clock-error">${this.clockError}</p>
                <wt-button data-test="preview-retry" @click=${() => this.#refreshPreview(true)}
                  >${t("venue_details.retry_preview")}</wt-button
                >`
            : html`<p role="status">${t("venue_details.preview_loading")}</p>`
        }
      </div>`;
    return html`<div data-test="clock-preview">
      <p>${t("venue_details.preview_at")} ${preview.at}</p>
      ${this.#clockView(preview.current, false)}${this.#clockView(preview.proposed, true)}
      <p>${t("venue_details.cutover_mapping")}</p>
      <dl>
        <dt>${t("venue_details.archive_deadline")}</dt>
        <dd>${preview.backupDeadlines.archive ?? t("venue_details.no_deadline")}</dd>
        <dt>${t("venue_details.cloud_deadline")}</dt>
        <dd>${preview.backupDeadlines.cloud ?? t("venue_details.no_deadline")}</dd>
      </dl>
    </div>`;
  }
  #needsAcknowledgement(): boolean {
    return (
      Object.keys(venueDetailProblems(this.#patch())).length === 0 &&
      this.#warnings().length > 0 &&
      (!this.#previewReady() || this.acknowledged !== JSON.stringify(this.#patch()))
    );
  }
  #change(field: VenueDetailField, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (!this.draft || this.readOnly || this.submitting) return;
    const previousPatch = JSON.stringify(this.#patch());
    this.draft = { ...this.draft, [field]: event.detail.value };
    this.#scope?.changed();
    if (JSON.stringify(this.#patch()) !== previousPatch) this.acknowledged = "";
    const next = venueDetailProblems(this.#patch());
    const errors = { ...this.errors };
    delete errors[field];
    if (this.attempted) {
      for (const key of VENUE_DETAIL_FIELDS) {
        if (next[key]) errors[key] = t(PROBLEMS[next[key]]!);
      }
    }
    this.errors = errors;
    this.#refreshPreview();
    if (this.actionError === t("form.fix_fields") && Object.keys(errors).length === 0)
      this.actionError = "";
  }
  async #focus(field: VenueDetailField): Promise<void> {
    await this.updateComplete;
    this.shadowRoot!.querySelector<HTMLElement>(`[name="${nameOf(field)}"]`)?.focus();
  }
  async #save(): Promise<void> {
    if (this.submitting || this.readOnly || !this.draft || !this.#expected) return;
    const patch = this.#patch();
    const problems = venueDetailProblems(patch);
    this.attempted = true;
    if (Object.keys(problems).length > 0) {
      this.errors = Object.fromEntries(
        Object.entries(problems).map(([field, problem]) => [field, t(PROBLEMS[problem]!)]),
      );
      this.actionError = t("form.fix_fields");
      await this.#focus(VENUE_DETAIL_FIELDS.find((field) => problems[field] !== undefined)!);
      return;
    }
    if (this.#needsAcknowledgement()) return;
    if (Object.keys(patch).length === 0) {
      this.#cancel();
      return;
    }
    const generation = this.#generation;
    this.submitting = true;
    this.errors = {};
    this.actionError = "";
    try {
      const result = await this.api.patchVenueDetails({ changes: patch, expected: this.#expected });
      if (generation !== this.#generation) return;
      this.model = result.model;
      this.#cancel();
    } catch (error) {
      if (generation !== this.#generation) return;
      const code = codeOf(error);
      const params =
        typeof error === "object" && error !== null
          ? (error as { params?: Record<string, unknown> }).params
          : undefined;
      const field = params?.field;
      const message =
        code === "venue.detail_changed"
          ? t("venue_details.changed")
          : code === "venue.detail_locked"
            ? t(REASONS[String(params?.reason)] ?? "venue_details.read_only")
            : code === "venue.detail_invalid"
              ? t(PROBLEMS[String(params?.reason)] ?? "venue_details.invalid")
              : code === "venue.detail_read_only"
                ? t("venue_details.read_only")
                : codeMessage(code);
      if (
        typeof field === "string" &&
        VENUE_DETAIL_FIELDS.includes(field as VenueDetailField) &&
        this.shadowRoot!.querySelector(`[name="${nameOf(field as VenueDetailField)}"]`)
      ) {
        this.errors = { [field]: message };
        this.actionError = t("form.fix_fields");
        this.submitting = false;
        await this.#focus(field as VenueDetailField);
      } else this.actionError = message;
      return;
    } finally {
      if (generation === this.#generation) this.submitting = false;
    }
    await this.#load();
  }
  #reason(field: VenueDetailField): string {
    return (this.model?.policy[field].reasons ?? [])
      .map((reason) => (REASONS[reason] ? t(REASONS[reason]!) : ""))
      .filter(Boolean)
      .join(" ");
  }
  #field(field: VenueDetailField): TemplateResult {
    const expected = this.#expected;
    const generation = this.#generation;
    const change = (event: CustomEvent<{ value: string }>) => {
      if (this.isConnected && expected === this.#expected && generation === this.#generation)
        this.#change(field, event);
    };
    const value = this.draft![field] ?? "";
    const locked = this.model!.policy[field].decision === "refuse";
    if (locked && this.#patch()[field] === undefined)
      return html`<div data-test=${`locked-${field}`}>
        <strong>${t(LABELS[field])}</strong>
        <p>${value || t("venue_details.unset")}</p>
        <p class="reason">${this.#reason(field)}</p>
      </div>`;
    const required =
      field !== "addressLine2" &&
      (this.#expected![field] !== null || this.#patch()[field] !== undefined);
    return html`<div class="field">
      ${
        field === "province"
          ? html`<wt-combobox
              name="province"
              label=${t(LABELS[field])}
              .value=${value}
              .options=${this.model!.provinces.map((province) => ({ value: province.name, label: province.name }))}
              ?required=${required}
              ?disabled=${this.submitting}
              .error=${this.errors[field] ?? ""}
              @wt-change=${change}
            ></wt-combobox>`
          : html`<wt-input
              name=${nameOf(field)}
              label=${t(LABELS[field])}
              .value=${value}
              ?required=${required}
              ?disabled=${this.submitting}
              .error=${this.errors[field] ?? ""}
              @wt-change=${change}
            ></wt-input>`
      }
      ${locked ? html`<p class="reason" data-test=${`lock-${field}`}>${this.#reason(field)}</p>` : nothing}
      <wt-help-tooltip aria-label=${`${t(LABELS[field])}: ${t("venue_details.help")}`}
        >${this.#reason(field) || t(HELP[field])}</wt-help-tooltip
      >
    </div>`;
  }
  override render(): TemplateResult {
    const model = this.model;
    const expected = this.#expected;
    const generation = this.#generation;
    const current = () =>
      this.isConnected && expected === this.#expected && generation === this.#generation;
    return html`<h2>${t("venue_details.title")}</h2>
      ${this.readError && !this.actionError ? html`<p class="error" role="alert" data-test="read-error">${this.readError}</p>` : nothing}
      ${
        !model
          ? html`<p role="status">${t("venue_details.loading")}</p>`
          : html`
              <dl data-test="issuer">
                <dt>${t("venue_details.country")}</dt>
                <dd>${model.issuer.country}</dd>
                <dt>${t("venue_details.legal_name")}</dt>
                <dd>${model.issuer.legalName}</dd>
                <dt>${t("venue_details.tax_id")}</dt>
                <dd>${model.issuer.taxId}</dd>
              </dl>
              ${
                this.draft && !this.readOnly
                  ? html`<form
                      @submit=${(event: Event) => {
                        event.preventDefault();
                        if (current()) void this.#save();
                      }}
                      @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"))}
                    >
                      ${VENUE_DETAIL_FIELDS.map((field) => this.#field(field))}
                      ${
                        ["addressLine1", "addressLine2", "postalCode", "city", "province"].some(
                          (field) => this.#patch()[field as VenueDetailField] !== undefined,
                        )
                          ? html`<p class="reason" data-test="address-notice">
                              ${t("venue_details.address_notice")}
                            </p>`
                          : nothing
                      }
                      ${
                        this.#warnings().length > 0
                          ? html`<div class="warnings" data-test="warnings">
                              <strong>${t("venue_details.review")}</strong
                              >${this.#warnings().map((key) => html`<p>${t(key)}</p>`)}
                              ${this.#renderClockPreview()}
                              ${
                                this.acknowledged !== JSON.stringify(this.#patch())
                                  ? html`<wt-button
                                      data-test="acknowledge"
                                      ?disabled=${this.submitting || !this.#previewReady()}
                                      @click=${() => {
                                        if (!current() || !this.#previewReady()) return;
                                        this.acknowledged = JSON.stringify(this.#patch());
                                      }}
                                      >${t("venue_details.acknowledge")}</wt-button
                                    >`
                                  : nothing
                              }
                            </div>`
                          : nothing
                      }
                      <wt-form-actions .error=${this.actionError}>
                        <wt-button
                          slot="cancel"
                          data-test="cancel"
                          ?disabled=${this.submitting}
                          @click=${() => {
                            if (current()) this.#requestCancel();
                          }}
                          >${t("action.cancel")}</wt-button
                        >
                        <wt-button
                          data-test="save"
                          variant="primary"
                          ?disabled=${
                            this.submitting ||
                            this.#needsAcknowledgement() ||
                            (this.attempted &&
                              Object.keys(venueDetailProblems(this.#patch())).length > 0)
                          }
                          @click=${() => {
                            if (current()) void this.#save();
                          }}
                          >${t("action.save")}</wt-button
                        >
                      </wt-form-actions>
                    </form>`
                  : html`<dl>
                        ${VENUE_DETAIL_FIELDS.map(
                          (field) =>
                            html`<dt>${t(LABELS[field])}</dt>
                              <dd data-test=${`saved-${field}`}>
                                ${model.details[field] ?? t("venue_details.unset")}
                              </dd>`,
                        )}
                      </dl>
                      ${
                        this.readOnly
                          ? nothing
                          : html`<wt-button
                              data-test="edit"
                              @click=${() => {
                                if (current()) this.#begin();
                              }}
                              >${t("action.edit")}</wt-button
                            >`
                      }`
              }
            `
      }`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-venue-details-panel": VenueDetailsPanel;
  }
}
