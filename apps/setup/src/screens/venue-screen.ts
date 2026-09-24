import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { submitOnEnter, baseStyles, selectStyles } from "@waitron/ui";
import {
  findAdministrativeArea,
  findAdministrativeAreaByPostalCode,
  resolveFiscalJurisdiction,
  type AdministrativeArea,
  type CountryPack,
  type FiscalJurisdiction,
} from "@waitron/country";
import { VENUE_SETUP_COUNTRY_PACKS, getVenueSetupCountryPack } from "@waitron/country-packs";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { actionsStyles, errorStyles, fieldStyles } from "../form-styles.js";
import { dispatchSetupAdvance, dispatchSetupGoto, dispatchSetupPatch } from "../events.js";
import type { DeepPartial } from "../setup-app.js";
import type { VenueDefaults, ProvisionBody } from "../api/client.js";
import { SERVER_FIELDS } from "../server-fields.js";

type TextField =
  | "country"
  | "taxId"
  | "legalName"
  | "name"
  | "operationDescription"
  | "addressLine1"
  | "addressLine2"
  | "postalCode"
  | "city"
  | "province"
  | "dayCutover"
  | "tillName"
  | "seriesCode"
  | "rectificativeSeriesCode";

/**
 * Every value is `"off"` on purpose: these fields describe the VENUE, while a browser's stored values
 * describe the PERSON filling the form in — their home address, the company they work for.
 */
const FIELD_AUTOCOMPLETE: Record<TextField, string> = {
  country: "off",
  taxId: "off",
  legalName: "off",
  name: "off",
  operationDescription: "off",
  addressLine1: "off",
  addressLine2: "off",
  postalCode: "off",
  city: "off",
  province: "off",
  dayCutover: "off",
  tillName: "off",
  seriesCode: "off",
  rectificativeSeriesCode: "off",
};

const REQUIRED_TEXT_FIELDS: readonly TextField[] = [
  "country",
  "taxId",
  "legalName",
  "name",
  "operationDescription",
  "addressLine1",
  "postalCode",
  "city",
  "province",
  "dayCutover",
  "tillName",
  "seriesCode",
  "rectificativeSeriesCode",
];

const FIELD_HELP: Record<TextField, string> = {
  country:
    "Choose the country where your business is registered. It determines the available address and tax settings.",
  taxId: "Enter the tax identifier of the business that issues the invoices.",
  legalName: "Use the business's registered legal name, as it appears on its tax documents.",
  name: "Choose the name you use for this location in Waitron.",
  operationDescription:
    "This text describes the sale on every record sent to the tax agency. Keep the suggested wording for ordinary shop sales. Invoice languages do not translate this text. You can change it in the dashboard for future records.",
  addressLine1: "Enter the location's street and building number.",
  addressLine2: "Add a floor, unit or other address detail if needed.",
  postalCode: "Enter the location's postal code. Waitron uses it to suggest the province.",
  city: "Enter the town or city where this location is based.",
  province:
    "The province must match the postal code. It determines the fiscal territory and time zone.",
  dayCutover:
    "Sales before this time belong to the previous business day. Keep 04:00 if you finish trading after midnight.",
  tillName:
    "Name the first register. Caja 1 is a useful starting point; this name is not your tax-filing identity.",
  seriesCode:
    "This prefix identifies ordinary invoices, for example FS/1. Use letters, numbers, / _ . or -, up to 38 characters. Keep FS unless you need another series.",
  rectificativeSeriesCode:
    "This prefix identifies correction invoices, for example FR/1. Use a different prefix from ordinary invoices. Keep FR unless you need another series.",
};
const FIELD_LABELS: Record<TextField, string> = {
  country: "country",
  taxId: "tax ID",
  legalName: "legal name",
  name: "location name",
  operationDescription: "invoice operation description",
  addressLine1: "street address",
  addressLine2: "address detail",
  postalCode: "postal code",
  city: "city",
  province: "province",
  dayCutover: "business day cutover",
  tillName: "till name",
  seriesCode: "invoice series code",
  rectificativeSeriesCode: "correction series code",
};

const LOCALE_LABELS: Readonly<Record<string, string>> = {
  "es-ES": "Spanish (España)",
  "ca-ES": "Catalan (Català)",
  "gl-ES": "Galician (Galego)",
  "eu-ES": "Basque (Euskara)",
  "en-GB": "English",
};

/**
 * A province with a language of its own gets that language AND the country's, country first. Never
 * more than two, which `#next` and `planVenue` (`packages/provisioning/src/venue-plan.ts`) both
 * refuse.
 */
function defaultInvoiceLocales(
  pack: CountryPack | undefined,
  area: AdministrativeArea | undefined,
): string[] {
  if (pack === undefined) return [];
  const regional = area?.defaultLocale;
  return regional === undefined || regional === pack.defaultLocale
    ? [pack.defaultLocale]
    : [pack.defaultLocale, regional];
}

@customElement("setup-venue-screen")
export class SetupVenueScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    fieldStyles,
    errorStyles,
    actionsStyles,
    css`
      :host {
        display: block;
      }

      h2 {
        margin: var(--wt-space-4) 0 var(--wt-space-2);
        font-size: var(--wt-font-size-lg);
      }

      .field.select > span {
        display: block;
        margin-bottom: var(--wt-space-1);
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }

      fieldset.locales {
        margin: 0 0 var(--wt-space-4);
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }

      fieldset.locales[invalid] {
        border-color: var(--wt-color-danger);
      }

      fieldset.locales legend {
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
        padding: 0 var(--wt-space-2);
      }

      .locale-option {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        margin-bottom: var(--wt-space-2);
        color: var(--wt-color-text);
      }
    `,
  ];

  @property({ attribute: false }) draft: DeepPartial<ProvisionBody> = {};
  @property({ attribute: false }) defaults: VenueDefaults = {};
  #descriptionEdited = false;

  get #demo(): boolean {
    return this.draft.mode === "demo";
  }

  #descriptionDefault(): string {
    const filing =
      this.#jurisdiction()?.modules?.filing ??
      this.#pack()?.fiscalJurisdictions.find(({ supported }) => supported)?.modules?.filing;
    return filing === undefined ? "" : (this.defaults[filing]?.operationDescription ?? "");
  }

  /** A server-side venue error the shell routed back here, shown as a banner. */
  @property() errorMessage?: string;

  /** A field path the server refused (`setup.request_invalid`'s `params.field`), routed back by the
   * shell. */
  @property() invalidField?: string;

  @state() private values: Record<TextField, string> = {
    country: "ES",
    taxId: "",
    legalName: "",
    name: "",
    operationDescription: "",
    addressLine1: "",
    addressLine2: "",
    postalCode: "",
    city: "",
    province: "",
    dayCutover: "04:00",
    tillName: "Caja 1",
    seriesCode: "FS",
    rectificativeSeriesCode: "FR",
  };

  @state() private invoiceLocales: string[] = ["es-ES"];

  @state() private invalid = new Set<TextField | "invoiceLocales">();

  @state() private showError = false;

  // Keep server refusals separate: local validation rebuilds its own set on every submission.
  @state() private serverInvalid?: { readonly key: TextField; readonly message: string };

  #seeded = false;
  #invoiceLocalesFollowAreaDefault = true;

  override willUpdate(changed: PropertyValues<this>): void {
    if (!this.#seeded) {
      this.#seeded = true;
      this.#seedFromDraft();
      if (this.#demo && this.values.taxId === "") {
        this.values = { ...this.values, taxId: this.#pack()?.demo?.createCompanyTaxId() ?? "" };
      }
    }
    if (
      !this.#descriptionEdited &&
      this.draft.venue?.location?.operationDescription === undefined
    ) {
      this.values = { ...this.values, operationDescription: this.#descriptionDefault() };
    }
    // Only when the shell hands down a NEW value: re-deriving on every update would put back a mark
    // the operator has already cleared by editing the field.
    if (changed.has("invalidField")) {
      this.serverInvalid =
        this.invalidField === undefined ? undefined : SERVER_FIELDS[this.invalidField];
      if (this.#demo && this.serverInvalid?.key === "legalName")
        this.serverInvalid = { ...this.serverInvalid, key: "name" };
    }
  }

  /**
   * Focus the refused field when the shell hands it down: the screen renders no banner for it, and
   * the field may be off-screen, so moving focus is what tells the operator where they landed.
   */
  override updated(changed: PropertyValues<this>): void {
    if (!changed.has("invalidField") || this.serverInvalid === undefined) return;
    // By its `name`, not its `data-test` hook, which is for tests.
    const field = this.shadowRoot!.querySelector<
      HTMLElement & { updateComplete?: Promise<unknown> }
    >(`wt-input[name=${this.serverInvalid.key}]`);
    if (field === null) return;
    // Wait for the `wt-input`'s own render: until then the native input its focus is delegated to
    // does not exist, and focusing the host does nothing. The screen may be gone by then.
    void Promise.resolve(field.updateComplete).then(() => {
      if (this.isConnected) field.focus();
    });
  }

  /** So Back-then-forward restores every value the operator entered. */
  #seedFromDraft(): void {
    const venue = this.draft.venue ?? {};
    const loc = venue.location ?? {};
    this.values = {
      country: venue.country ?? this.values.country,
      taxId: venue.taxId ?? this.values.taxId,
      legalName: venue.legalName ?? this.values.legalName,
      name: loc.name ?? this.values.name,
      operationDescription: loc.operationDescription ?? this.values.operationDescription,
      addressLine1: loc.addressLine1 ?? this.values.addressLine1,
      addressLine2: loc.addressLine2 ?? this.values.addressLine2,
      postalCode: loc.postalCode ?? this.values.postalCode,
      city: loc.city ?? this.values.city,
      province: loc.province ?? this.values.province,
      dayCutover: loc.dayCutover ?? this.values.dayCutover,
      tillName: venue.tillName ?? this.values.tillName,
      seriesCode: venue.seriesCode ?? this.values.seriesCode,
      rectificativeSeriesCode: venue.rectificativeSeriesCode ?? this.values.rectificativeSeriesCode,
    };
    const pack = this.#pack();
    const area = this.#area(pack);
    const defaults = defaultInvoiceLocales(pack, area);
    this.invoiceLocales = loc.invoiceLocales ?? (defaults.length > 0 ? defaults : ["es-ES"]);
    if (loc.invoiceLocales !== undefined) {
      // Compared in order on purpose, unlike CLAUDE.md §3's compare-by-value rule: `planVenue`
      // treats `locales[0]` apart from the rest, so a reordered list is a different choice and must
      // stop the province from overwriting it.
      this.#invoiceLocalesFollowAreaDefault =
        pack !== undefined && JSON.stringify(loc.invoiceLocales) === JSON.stringify(defaults);
    }
  }

  #onField(key: TextField, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    // Editing the field the server refused retires that mark: the new value has not been refused.
    if (this.serverInvalid?.key === key) this.serverInvalid = undefined;
    const value = event.detail.value;
    if (key === "operationDescription") this.#descriptionEdited = true;
    if (key === "postalCode") {
      const pack = this.#pack();
      const validation = pack?.postalCode?.validate(value);
      const area =
        pack !== undefined && validation?.valid === true
          ? findAdministrativeAreaByPostalCode(pack, validation.normalized)
          : undefined;
      this.values = {
        ...this.values,
        postalCode: value,
        ...(area === undefined ? {} : { province: area.name }),
      };
      if (pack !== undefined && area !== undefined && this.#invoiceLocalesFollowAreaDefault) {
        this.invoiceLocales = defaultInvoiceLocales(pack, area);
      }
      return;
    }
    this.values = { ...this.values, [key]: value };
  }

  #onCountry(event: Event): void {
    event.stopPropagation();
    const country = (event.target as HTMLSelectElement).value;
    const pack = getVenueSetupCountryPack(country);
    this.values = { ...this.values, country, postalCode: "", province: "" };
    if (pack !== undefined) {
      this.invoiceLocales = defaultInvoiceLocales(pack, undefined);
      this.#invoiceLocalesFollowAreaDefault = true;
    }
  }

  #onProvince(event: Event): void {
    event.stopPropagation();
    const pack = this.#pack();
    if (pack === undefined) return;
    const area = findAdministrativeArea(pack, (event.target as HTMLSelectElement).value);
    this.values = { ...this.values, province: area?.name ?? "" };
    if (area === undefined) return;
    if (this.#invoiceLocalesFollowAreaDefault) {
      this.invoiceLocales = defaultInvoiceLocales(pack, area);
    }
  }

  #pack(): CountryPack | undefined {
    return getVenueSetupCountryPack(this.values.country);
  }

  #area(pack = this.#pack()): AdministrativeArea | undefined {
    return pack === undefined ? undefined : findAdministrativeArea(pack, this.values.province);
  }

  #jurisdiction(pack = this.#pack(), area = this.#area(pack)): FiscalJurisdiction | undefined {
    return pack === undefined ? undefined : resolveFiscalJurisdiction(pack, area?.code);
  }

  #onLocaleToggle(locale: string, event: Event): void {
    event.stopPropagation();
    this.#invoiceLocalesFollowAreaDefault = false;
    const checked = (event.target as HTMLInputElement).checked;
    this.invoiceLocales = checked
      ? [...this.invoiceLocales, locale]
      : this.invoiceLocales.filter((l) => l !== locale);
  }

  #next(): void {
    if (this.#demo && this.values.operationDescription === "") {
      this.shadowRoot?.querySelector<HTMLElement>("[data-test=defaults-error]")?.focus();
      return;
    }
    if (this.#demo) this.values = { ...this.values, legalName: this.values.name };
    const invalid = new Set<TextField | "invoiceLocales">();
    for (const key of REQUIRED_TEXT_FIELDS) {
      if (this.values[key].trim() === "") invalid.add(key);
    }
    const pack = this.#pack();
    const area = this.#area(pack);
    const postalValidation = pack?.postalCode?.validate(this.values.postalCode);
    const postalArea =
      pack !== undefined && postalValidation?.valid === true
        ? findAdministrativeAreaByPostalCode(pack, postalValidation.normalized)
        : undefined;
    const taxValidation = pack?.taxIdentifier?.validate(this.values.taxId);
    const jurisdiction = this.#jurisdiction(pack, area);

    if (pack === undefined) {
      invalid.add("country");
    }
    if (taxValidation?.valid === false) invalid.add("taxId");
    if (postalValidation?.valid === false) invalid.add("postalCode");
    if (pack !== undefined && pack.administrativeAreas.length > 0) {
      if (area === undefined) invalid.add("province");
      if (postalArea === undefined || area?.code !== postalArea.code) {
        invalid.add("postalCode");
        invalid.add("province");
      }
    }
    if (
      jurisdiction === undefined ||
      !jurisdiction.supported ||
      jurisdiction.modules === undefined
    ) {
      invalid.add("province");
    }
    if (
      this.invoiceLocales.length < 1 ||
      this.invoiceLocales.length > 2 ||
      this.invoiceLocales.some((locale) => !pack?.invoiceLocales.includes(locale))
    ) {
      invalid.add("invoiceLocales");
    }
    if (
      this.values.seriesCode.trim() !== "" &&
      this.values.seriesCode === this.values.rectificativeSeriesCode
    ) {
      invalid.add("seriesCode");
      invalid.add("rectificativeSeriesCode");
    }
    this.invalid = invalid;
    if (invalid.size > 0) {
      this.showError = true;
      void this.updateComplete.then(() =>
        this.shadowRoot?.querySelector<HTMLElement>("[invalid]")?.focus(),
      );
      return;
    }
    this.showError = false;

    // Every path that leaves these undefined added an invalid field and returned above.
    const selectedPack = pack!;
    const selectedJurisdiction = jurisdiction!;
    const normalizedTaxId =
      taxValidation?.valid === true ? taxValidation.normalized : this.values.taxId;
    const normalizedPostalCode =
      postalValidation?.valid === true ? postalValidation.normalized : this.values.postalCode;
    const addressLine2 = this.values.addressLine2.trim() === "" ? null : this.values.addressLine2;
    const patch: DeepPartial<ProvisionBody> = {
      venue: {
        country: selectedPack.countryCode,
        taxId: normalizedTaxId,
        legalName: this.values.legalName,
        location: {
          name: this.values.name,
          fiscalTerritory: selectedJurisdiction.id,
          invoiceLocales: this.invoiceLocales,
          operationDescription: this.values.operationDescription,
          addressLine1: this.values.addressLine1,
          addressLine2,
          postalCode: normalizedPostalCode,
          city: this.values.city,
          province: area?.name ?? this.values.province,
          timeZone: area?.timeZone ?? selectedPack.defaultTimeZone,
          dayCutover: this.values.dayCutover,
        },
        tillName: this.values.tillName,
        seriesCode: this.values.seriesCode,
        rectificativeSeriesCode: this.values.rectificativeSeriesCode,
      },
    };
    dispatchSetupPatch(this, patch);

    // The shell decides the next screen: it holds the merged draft.
    dispatchSetupAdvance(this);
  }

  #back(): void {
    dispatchSetupGoto(this, "admin");
  }

  #fieldError(key: TextField | "invoiceLocales"): string {
    if (!this.invalid.has(key)) return "";
    if (key === "invoiceLocales") return "Choose one or two invoice languages.";
    if (this.values[key].trim() === "") return `Enter the ${FIELD_LABELS[key]}.`;
    if (key === "taxId") return "Enter a valid tax ID for the selected country.";
    if (key === "postalCode") return "Enter a valid postal code that matches the province.";
    if (key === "province")
      return this.#jurisdiction()?.supported === false
        ? "Setup is not available for this fiscal territory yet."
        : "Choose the province that matches the postal code.";
    if (key === "seriesCode" || key === "rectificativeSeriesCode")
      return "Use different codes for ordinary and correction invoices.";
    return `Check the ${FIELD_LABELS[key]}.`;
  }

  #help(key: TextField): TemplateResult {
    return html`<wt-help-tooltip slot="help" aria-label=${`Help with ${FIELD_LABELS[key]}`}
      >${FIELD_HELP[key]}</wt-help-tooltip
    >`;
  }

  #field(label: string, key: TextField, type = "text"): TemplateResult {
    const refused = this.serverInvalid?.key === key ? this.serverInvalid : undefined;
    return html`<wt-input
      @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=next]"))}
      class="field"
      label=${label}
      name=${key}
      autocomplete=${FIELD_AUTOCOMPLETE[key]}
      data-test=${key}
      type=${type}
      ?invalid=${this.invalid.has(key) || refused !== undefined}
      ?required=${key !== "addressLine2"}
      error=${refused?.message ?? this.#fieldError(key)}
      .value=${this.values[key]}
      @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(key, e)}
      >${this.#help(key)}</wt-input
    >`;
  }

  override render(): TemplateResult {
    const pack = this.#pack();
    const area = this.#area(pack);
    const jurisdiction = this.#jurisdiction(pack, area);
    return html`
      <h1>Your shop</h1>
      <p>
        ${this.#demo ? "Name your demo location and enter its address. Waitron supplies a made-up business identity and invoice settings; you can review them before setup." : "Enter the business that issues your invoices and the address of this location."}
      </p>

      ${
        this.#demo && this.values.operationDescription === ""
          ? html`<p role="alert" tabindex="-1" data-test="defaults-error">
                Demo invoice settings have not loaded yet.
              </p>
              <wt-button
                data-test="retry-defaults"
                @click=${() => this.dispatchEvent(new CustomEvent("setup-defaults-requested", { bubbles: true, composed: true }))}
                >Try loading settings again</wt-button
              >`
          : nothing
      }
      <h2>${this.#demo ? "Location" : "Business"}</h2>
      <label class="field select">
        <span>Country * ${this.#help("country")}</span>
        <select
          name="country"
          required
          data-test="country"
          ?invalid=${this.invalid.has("country")}
          aria-invalid=${this.invalid.has("country") ? "true" : "false"}
          aria-describedby="country-error"
          @change=${(event: Event) => this.#onCountry(event)}
        >
          ${VENUE_SETUP_COUNTRY_PACKS.map(
            (country) =>
              html`<option
                value=${country.countryCode}
                .selected=${country.countryCode === pack?.countryCode}
              >
                ${country.name}
              </option>`,
          )}
        </select>
        <span class="error" id="country-error">${this.#fieldError("country")}</span>
      </label>
      ${this.#demo ? nothing : html`${this.#field(pack?.taxIdentifier?.label ?? "Tax ID", "taxId")}${this.#field("Legal name", "legalName")}`}
      ${this.#demo ? nothing : html`<h2>Location</h2>`} ${this.#field("Location name", "name")}
      ${
        this.#demo
          ? nothing
          : html`<fieldset
                class="locales"
                tabindex="-1"
                ?invalid=${this.invalid.has("invoiceLocales")}
                aria-invalid=${this.invalid.has("invoiceLocales") ? "true" : "false"}
                aria-describedby=${this.invalid.has("invoiceLocales") ? "invoice-locales-error" : nothing}
              >
                <legend>
                  Invoice languages (pick one or two) *
                  <wt-help-tooltip aria-label="Help with invoice languages"
                    >Choose the languages printed on invoices. The country's language is ticked
                    first, and a province with a language of its own adds it second; the operation
                    description is kept separately.</wt-help-tooltip
                  >
                </legend>
                ${(pack?.invoiceLocales ?? []).map(
                  (locale) =>
                    html`<label class="locale-option">
                      <input
                        type="checkbox"
                        name="invoiceLocales"
                        value=${locale}
                        data-test=${`locale-${locale}`}
                        .checked=${this.invoiceLocales.includes(locale)}
                        @change=${(e: Event) => this.#onLocaleToggle(locale, e)}
                      />
                      ${LOCALE_LABELS[locale] ?? locale}
                    </label>`,
                )}
                ${this.invalid.has("invoiceLocales") ? html`<p class="error" id="invoice-locales-error">${this.#fieldError("invoiceLocales")}</p>` : nothing}
              </fieldset>
              ${this.#field("Invoice operation description", "operationDescription")}`
      }
      ${this.#field("Address line 1", "addressLine1")}
      ${this.#field("Address line 2 (optional)", "addressLine2")}
      ${this.#field("Postal code", "postalCode")} ${this.#field("City", "city")}
      ${
        pack !== undefined && pack.administrativeAreas.length > 0
          ? html`<label class="field select">
              <span>Province * ${this.#help("province")}</span>
              <select
                name="province"
                required
                aria-describedby="province-error"
                data-test="province"
                ?invalid=${this.invalid.has("province")}
                aria-invalid=${this.invalid.has("province") ? "true" : "false"}
                @change=${(event: Event) => this.#onProvince(event)}
              >
                <option value="" .selected=${area === undefined}>Select province</option>
                ${pack.administrativeAreas.map(
                  (candidate) =>
                    html`<option value=${candidate.code} .selected=${candidate.code === area?.code}>
                      ${candidate.name}
                    </option>`,
                )}
              </select>
              <span class="error" id="province-error">${this.#fieldError("province")}</span>
            </label>`
          : this.#field("Province / region", "province")
      }
      <p data-test="fiscalTerritory">Fiscal territory: ${jurisdiction?.id ?? "Select province"}</p>
      <p data-test="timeZone">Time zone: ${area?.timeZone ?? pack?.defaultTimeZone ?? "—"}</p>
      ${
        this.#demo
          ? nothing
          : html`${this.#field("Business day cutover", "dayCutover", "time")}

              <h2>Invoicing</h2>
              ${this.#field("Till name", "tillName")}
              ${this.#field("Invoice series code", "seriesCode")}
              ${this.#field("Rectificative series code", "rectificativeSeriesCode")}`
      }
      ${
        this.showError
          ? html`<wt-form-error-summary
              data-test="error"
              heading="There is a problem with this form"
              .errors=${[...this.invalid].map((key) => this.#fieldError(key))}
            ></wt-form-error-summary>`
          : this.errorMessage === undefined
            ? nothing
            : html`<p class="error" role="alert" data-test="server-error">${this.errorMessage}</p>`
      }
      <wt-form-actions>
        <wt-button variant="ghost" slot="cancel" data-test="back" @click=${() => this.#back()}
          >Back</wt-button
        >
        <wt-button variant="primary" data-test="next" @click=${() => this.#next()}>Next</wt-button>
      </wt-form-actions>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-venue-screen": SetupVenueScreen;
  }
}
