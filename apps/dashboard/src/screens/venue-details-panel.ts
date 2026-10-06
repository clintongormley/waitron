import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, submitOnEnter } from "@waitron/ui";
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
  #expected?: VenueDetailValues;
  #generation = 0;
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
    void this.#load();
  }
  override disconnectedCallback(): void {
    this.#generation += 1;
    this.submitting = false;
    super.disconnectedCallback();
  }
  async #load(): Promise<void> {
    const generation = this.#generation;
    try {
      await this.#queries.watch("getVenueDetails", [], (model) => {
        if (generation !== this.#generation) return;
        this.model = model;
        this.readError = "";
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
  }
  #cancel(): void {
    this.draft = undefined;
    this.#expected = undefined;
    this.errors = {};
    this.actionError = "";
    this.attempted = false;
    this.acknowledged = "";
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
  #needsAcknowledgement(): boolean {
    return (
      Object.keys(venueDetailProblems(this.#patch())).length === 0 &&
      this.#warnings().length > 0 &&
      this.acknowledged !== JSON.stringify(this.#patch())
    );
  }
  #change(field: VenueDetailField, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (!this.draft || this.readOnly || this.submitting) return;
    const previousPatch = JSON.stringify(this.#patch());
    this.draft = { ...this.draft, [field]: event.detail.value };
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
              @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change(field, event)}
            ></wt-combobox>`
          : html`<wt-input
              name=${nameOf(field)}
              label=${t(LABELS[field])}
              .value=${value}
              ?required=${required}
              ?disabled=${this.submitting}
              .error=${this.errors[field] ?? ""}
              @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change(field, event)}
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
                        void this.#save();
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
                              ${
                                this.acknowledged !== JSON.stringify(this.#patch())
                                  ? html`<wt-button
                                      data-test="acknowledge"
                                      ?disabled=${this.submitting}
                                      @click=${() => {
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
                          @click=${() => this.#cancel()}
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
                            void this.#save();
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
                      ${this.readOnly ? nothing : html`<wt-button data-test="edit" @click=${() => this.#begin()}>${t("action.edit")}</wt-button>`}`
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
