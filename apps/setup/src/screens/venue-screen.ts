import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { focusFirstInvalid, submitOnEnter, baseStyles, selectStyles } from "@waitron/ui";
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
import "@waitron/ui/src/components/wt-form-actions.js";
import { countryName } from "../country-name.js";
import { currentLocale, format, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { actionsStyles, errorStyles, fieldStyles } from "../form-styles.js";
import { dispatchSetupAdvance, dispatchSetupGoto, dispatchSetupPatch } from "../events.js";
import type { DeepPartial } from "../setup-app.js";
import type { VenueDefaults, ProvisionBody } from "../api/client.js";
import { SERVER_FIELDS, type ServerField } from "../server-fields.js";

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

type FieldKey = TextField | "invoiceLocales";

/** Demo fills these itself, so its form does not show them. */
const DEMO_HIDDEN: ReadonlySet<FieldKey> = new Set<FieldKey>([
  "taxId",
  "legalName",
  "operationDescription",
  "invoiceLocales",
  "dayCutover",
  "tillName",
  "seriesCode",
  "rectificativeSeriesCode",
]);

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

const FIELD_HELP: Record<TextField, StringKey> = {
  country: "venue.help.country",
  taxId: "venue.help.tax_id",
  legalName: "venue.help.legal_name",
  name: "venue.help.name",
  operationDescription: "venue.help.operation_description",
  addressLine1: "venue.help.address_line1",
  addressLine2: "venue.help.address_line2",
  postalCode: "venue.help.postal_code",
  city: "venue.help.city",
  province: "venue.help.province",
  dayCutover: "venue.help.day_cutover",
  tillName: "venue.help.till_name",
  seriesCode: "venue.help.series_code",
  rectificativeSeriesCode: "venue.help.rectificative_series_code",
};
const FIELD_NOUNS: Record<TextField, StringKey> = {
  country: "venue.field.country",
  taxId: "venue.field.tax_id",
  legalName: "venue.field.legal_name",
  name: "venue.field.name",
  operationDescription: "venue.field.operation_description",
  addressLine1: "venue.field.address_line1",
  addressLine2: "venue.field.address_line2",
  postalCode: "venue.field.postal_code",
  city: "venue.field.city",
  province: "venue.field.province",
  dayCutover: "venue.field.day_cutover",
  tillName: "venue.field.till_name",
  seriesCode: "venue.field.series_code",
  rectificativeSeriesCode: "venue.field.rectificative_series_code",
};

const LOCALE_LABELS: Readonly<Record<string, StringKey>> = {
  "es-ES": "venue.locale.es_es",
  "ca-ES": "venue.locale.ca_es",
  "gl-ES": "venue.locale.gl_es",
  "eu-ES": "venue.locale.eu_es",
  "en-GB": "venue.locale.en_gb",
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

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  get #demo(): boolean {
    return this.draft.mode === "demo";
  }

  #descriptionDefault(): string {
    const filing =
      this.#jurisdiction()?.modules?.filing ??
      this.#pack()?.fiscalJurisdictions.find(({ supported }) => supported)?.modules?.filing;
    return filing === undefined ? "" : (this.defaults[filing]?.operationDescription ?? "");
  }

  /** A server-side venue error that names no field, routed back by the shell and shown beside
   * Next until the operator presses it again. */
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

  @state() private attempted = false;

  @state() private refusalDismissed = false;

  // `refusal` is kept whole, not copied: its `message` is translated on each read.
  @state() private serverInvalid?: { readonly key: TextField; readonly refusal: ServerField };

  #seeded = false;
  #invoiceLocalesFollowAreaDefault = true;
  #errors = new Map<FieldKey, string>();

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
      const refusal =
        this.invalidField === undefined ? undefined : SERVER_FIELDS[this.invalidField];
      this.serverInvalid =
        refusal === undefined
          ? undefined
          : { key: this.#demo && refusal.key === "legalName" ? "name" : refusal.key, refusal };
    }
    if (changed.has("errorMessage")) this.refusalDismissed = false;
    this.#errors = this.#collectErrors();
  }

  /**
   * Focus the refused field when the shell hands it down: the field may be off-screen, so moving
   * focus is what tells the operator where they landed.
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

  #shows(key: FieldKey): boolean {
    return !(this.#demo && DEMO_HIDDEN.has(key));
  }

  #invalidFields(): Set<FieldKey> {
    const invalid = new Set<FieldKey>();
    for (const key of REQUIRED_TEXT_FIELDS) {
      // Demo copies the location name into the legal name on Next.
      if (this.#demo && key === "legalName") continue;
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
    return invalid;
  }

  #collectErrors(): Map<FieldKey, string> {
    const errors = new Map<FieldKey, string>();
    if (this.attempted) {
      for (const key of this.#invalidFields()) errors.set(key, this.#fieldMessage(key));
    }
    if (this.serverInvalid !== undefined) {
      errors.set(this.serverInvalid.key, this.serverInvalid.refusal.message);
    }
    return errors;
  }

  #next(): void {
    if (this.#demo && this.values.operationDescription === "") {
      this.shadowRoot?.querySelector<HTMLElement>("[data-test=defaults-error]")?.focus();
      return;
    }
    this.attempted = true;
    this.refusalDismissed = true;
    this.serverInvalid = undefined;
    if (this.#invalidFields().size > 0) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    if (this.#demo) this.values = { ...this.values, legalName: this.values.name };
    const pack = this.#pack();
    const area = this.#area(pack);
    const postalValidation = pack?.postalCode?.validate(this.values.postalCode);
    const taxValidation = pack?.taxIdentifier?.validate(this.values.taxId);
    const jurisdiction = this.#jurisdiction(pack, area);

    // Every path that leaves these undefined made a field invalid and returned above.
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

  #fieldMessage(key: FieldKey): string {
    if (key === "invoiceLocales") return t("venue.error.invoice_locales");
    if (this.values[key].trim() === "")
      return format("venue.enter_field", { field: t(FIELD_NOUNS[key]) });
    if (key === "taxId") return t("venue.error.tax_id");
    if (key === "postalCode") return t("venue.error.postal_code");
    if (key === "province")
      return this.#jurisdiction()?.supported === false
        ? t("venue.error.territory_unsupported")
        : t("venue.error.province");
    if (key === "seriesCode" || key === "rectificativeSeriesCode")
      return t("venue.error.series_codes");
    return format("venue.check_field", { field: t(FIELD_NOUNS[key]) });
  }

  #help(key: TextField): TemplateResult {
    return html`<wt-help-tooltip
      slot="help"
      aria-label=${format("venue.help_with_field", { field: t(FIELD_NOUNS[key]) })}
      >${t(FIELD_HELP[key])}</wt-help-tooltip
    >`;
  }

  #field(label: string, key: TextField, type = "text"): TemplateResult {
    const error = this.#errors.get(key) ?? "";
    return html`<wt-input
      @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=next]"))}
      class="field"
      label=${label}
      name=${key}
      autocomplete=${FIELD_AUTOCOMPLETE[key]}
      data-test=${key}
      type=${type}
      ?invalid=${error !== ""}
      ?required=${key !== "addressLine2"}
      error=${error}
      .value=${this.values[key]}
      @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(key, e)}
      >${this.#help(key)}</wt-input
    >`;
  }

  override render(): TemplateResult {
    const pack = this.#pack();
    const area = this.#area(pack);
    const jurisdiction = this.#jurisdiction(pack, area);
    const selectProvince = t("venue.select_province");
    const fiscalTerritory = format("venue.fiscal_territory", {
      territory: jurisdiction?.id ?? selectProvince,
    });
    const timeZone = format("venue.time_zone", {
      zone: area?.timeZone ?? pack?.defaultTimeZone ?? "—",
    });
    const errors = this.#errors;
    const fieldErrors = [...errors.keys()].filter((key) => this.#shows(key));
    const invalid = this.attempted && [...this.#invalidFields()].some((key) => this.#shows(key));
    const bottom = [
      ...(this.errorMessage === undefined || this.refusalDismissed ? [] : [this.errorMessage]),
      ...[...errors].filter(([key]) => !this.#shows(key)).map(([, message]) => message),
      ...(fieldErrors.length > 0 ? [t("venue.fix_fields")] : []),
    ].join(" ");
    return html`
      <h1>${t("venue.heading")}</h1>
      <p>${this.#demo ? t("venue.intro_demo") : t("venue.intro")}</p>

      ${
        this.#demo && this.values.operationDescription === ""
          ? html`<p role="alert" tabindex="-1" data-test="defaults-error">
                ${t("venue.defaults_not_loaded")}
              </p>
              <wt-button
                data-test="retry-defaults"
                @click=${() => this.dispatchEvent(new CustomEvent("setup-defaults-requested", { bubbles: true, composed: true }))}
                >${t("venue.retry_defaults")}</wt-button
              >`
          : nothing
      }
      <h2>${this.#demo ? t("venue.section.location") : t("venue.section.business")}</h2>
      <label class="field select">
        <span>${t("venue.label.country")} * ${this.#help("country")}</span>
        <select
          name="country"
          required
          data-test="country"
          ?invalid=${errors.has("country")}
          aria-invalid=${errors.has("country") ? "true" : "false"}
          aria-describedby="country-error"
          @change=${(event: Event) => this.#onCountry(event)}
        >
          ${VENUE_SETUP_COUNTRY_PACKS.map(
            (country) =>
              html`<option
                value=${country.countryCode}
                .selected=${country.countryCode === pack?.countryCode}
              >
                ${countryName(country.countryCode, currentLocale())}
              </option>`,
          )}
        </select>
        <span class="error" id="country-error">${errors.get("country") ?? ""}</span>
      </label>
      ${this.#demo ? nothing : html`${this.#field(pack?.taxIdentifier?.label ?? t("venue.label.tax_id"), "taxId")}${this.#field(t("venue.label.legal_name"), "legalName")}`}
      ${this.#demo ? nothing : html`<h2>${t("venue.section.location")}</h2>`}
      ${this.#field(t("venue.label.location_name"), "name")}
      ${
        this.#demo
          ? nothing
          : html`<fieldset
                class="locales"
                tabindex="-1"
                ?invalid=${errors.has("invoiceLocales")}
                aria-invalid=${errors.has("invoiceLocales") ? "true" : "false"}
                aria-describedby=${errors.has("invoiceLocales") ? "invoice-locales-error" : nothing}
              >
                <legend>
                  ${t("venue.label.invoice_locales")} *
                  <wt-help-tooltip aria-label=${t("venue.invoice_locales_help_label")}
                    >${t("venue.invoice_locales_help")}</wt-help-tooltip
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
                      ${LOCALE_LABELS[locale] === undefined ? locale : t(LOCALE_LABELS[locale])}
                    </label>`,
                )}
                ${errors.has("invoiceLocales") ? html`<p class="error" id="invoice-locales-error">${errors.get("invoiceLocales")}</p>` : nothing}
              </fieldset>
              ${this.#field(t("venue.label.operation_description"), "operationDescription")}`
      }
      ${this.#field(t("venue.label.address_line1"), "addressLine1")}
      ${this.#field(t("venue.label.address_line2"), "addressLine2")}
      ${this.#field(t("venue.label.postal_code"), "postalCode")}
      ${this.#field(t("venue.label.city"), "city")}
      ${
        pack !== undefined && pack.administrativeAreas.length > 0
          ? html`<label class="field select">
              <span>${t("venue.label.province")} * ${this.#help("province")}</span>
              <select
                name="province"
                required
                aria-describedby="province-error"
                data-test="province"
                ?invalid=${errors.has("province")}
                aria-invalid=${errors.has("province") ? "true" : "false"}
                @change=${(event: Event) => this.#onProvince(event)}
              >
                <option value="" .selected=${area === undefined}>${selectProvince}</option>
                ${pack.administrativeAreas.map(
                  (candidate) =>
                    html`<option value=${candidate.code} .selected=${candidate.code === area?.code}>
                      ${candidate.name}
                    </option>`,
                )}
              </select>
              <span class="error" id="province-error">${errors.get("province") ?? ""}</span>
            </label>`
          : this.#field(t("venue.label.province_region"), "province")
      }
      <p data-test="fiscalTerritory">${fiscalTerritory}</p>
      <p data-test="timeZone">${timeZone}</p>
      ${
        this.#demo
          ? nothing
          : html`${this.#field(t("venue.label.day_cutover"), "dayCutover", "time")}

              <h2>${t("venue.section.invoicing")}</h2>
              ${this.#field(t("venue.label.till_name"), "tillName")}
              ${this.#field(t("venue.label.series_code"), "seriesCode")}
              ${this.#field(t("venue.label.rectificative_series_code"), "rectificativeSeriesCode")}`
      }
      <wt-form-actions .error=${bottom}>
        <wt-button variant="ghost" slot="cancel" data-test="back" @click=${() => this.#back()}
          >${t("venue.back")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test="next"
          ?disabled=${invalid}
          @click=${() => this.#next()}
          >${t("venue.next")}</wt-button
        >
      </wt-form-actions>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-venue-screen": SetupVenueScreen;
  }
}
