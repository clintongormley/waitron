import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { focusFirstInvalid, submitOnEnter, baseStyles } from "@waitron/ui";
import {
  findAdministrativeArea,
  findAdministrativeAreaByPostalCode,
  receiptLanguageRules,
  resolveFiscalJurisdiction,
  type AdministrativeArea,
  type CountryPack,
  type FiscalJurisdiction,
  type ReceiptLanguageRules,
} from "@waitron/country";
import { VENUE_SETUP_COUNTRY_PACKS, getVenueSetupCountryPack } from "@waitron/country-packs";
import { resolveContentText } from "@waitron/shared";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { countryName } from "../country-name.js";
import { currentLocale, format, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { RECEIPT_LANGUAGES } from "../receipt-languages.js";
import {
  actionsStyles,
  errorStyles,
  fieldStyles,
  introStyles,
  pairStyles,
} from "../form-styles.js";
import { dispatchSetupAdvance, dispatchSetupGoto, dispatchSetupPatch } from "../events.js";
import type { DeepPartial } from "../setup-app.js";
import type { VenueDefaults, ProvisionBody } from "../api/client.js";
import { VENUE_SERVER_FIELDS, type ServerField } from "../server-fields.js";

type TextField =
  | "country"
  | "taxId"
  | "legalName"
  | "taxpayerDomicile"
  | "name"
  | "operationDescription"
  | "addressLine1"
  | "addressLine2"
  | "postalCode"
  | "city"
  | "province"
  | "dayCutover"
  | "seriesCode"
  | "fullSeriesCode"
  | "rectificativeSeriesCode";

/**
 * Every value is `"off"` on purpose: these fields describe the VENUE, while a browser's stored values
 * describe the PERSON filling the form in — their home address, the company they work for.
 */
const FIELD_AUTOCOMPLETE: Record<TextField, string> = {
  country: "off",
  taxId: "off",
  legalName: "off",
  taxpayerDomicile: "off",
  name: "off",
  operationDescription: "off",
  addressLine1: "off",
  addressLine2: "off",
  postalCode: "off",
  city: "off",
  province: "off",
  dayCutover: "off",
  seriesCode: "off",
  fullSeriesCode: "off",
  rectificativeSeriesCode: "off",
};

type FieldKey = TextField | "invoiceLocales";

/** Demo fills these itself, so its form does not show them. */
const DEMO_HIDDEN: ReadonlySet<FieldKey> = new Set<FieldKey>([
  "taxId",
  "legalName",
  "taxpayerDomicile",
  "operationDescription",
  "invoiceLocales",
  "dayCutover",
  "seriesCode",
  "fullSeriesCode",
  "rectificativeSeriesCode",
]);

const REQUIRED_TEXT_FIELDS: readonly TextField[] = [
  "country",
  "taxId",
  "legalName",
  "taxpayerDomicile",
  "name",
  "operationDescription",
  "addressLine1",
  "postalCode",
  "city",
  "province",
  "dayCutover",
  "seriesCode",
  "fullSeriesCode",
  "rectificativeSeriesCode",
];

type HintedField =
  | "taxId"
  | "legalName"
  | "taxpayerDomicile"
  | "name"
  | "addressLine1"
  | "addressLine2"
  | "postalCode"
  | "city";
/** Demo starts the location name filled in, so there it takes a "?" rather than its hint. */
type HelpedField = Exclude<TextField, HintedField> | "name";

/** A short explanation shown in the empty field. */
const FIELD_HINT: Record<HintedField, StringKey> = {
  taxId: "venue.hint.tax_id",
  legalName: "venue.hint.legal_name",
  taxpayerDomicile: "venue.hint.taxpayer_domicile",
  name: "venue.hint.name",
  addressLine1: "venue.hint.address_line1",
  addressLine2: "venue.hint.address_line2",
  postalCode: "venue.hint.postal_code",
  city: "venue.hint.city",
};

/** An explanation too long for a hint, or for a field that starts filled in, so a hint would never show. */
const FIELD_HELP: Record<HelpedField, StringKey> = {
  country: "venue.help.country",
  name: "venue.help.name",
  operationDescription: "venue.help.operation_description",
  province: "venue.help.province",
  dayCutover: "venue.help.day_cutover",
  seriesCode: "venue.help.series_code",
  fullSeriesCode: "venue.help.full_series_code",
  rectificativeSeriesCode: "venue.help.rectificative_series_code",
};

const hasHint = (key: TextField): key is HintedField => key in FIELD_HINT;
const FIELD_NOUNS: Record<TextField, StringKey> = {
  country: "venue.field.country",
  taxId: "venue.field.tax_id",
  legalName: "venue.field.legal_name",
  taxpayerDomicile: "venue.field.taxpayer_domicile",
  name: "venue.field.name",
  operationDescription: "venue.field.operation_description",
  addressLine1: "venue.field.address_line1",
  addressLine2: "venue.field.address_line2",
  postalCode: "venue.field.postal_code",
  city: "venue.field.city",
  province: "venue.field.province",
  dayCutover: "venue.field.day_cutover",
  seriesCode: "venue.field.series_code",
  fullSeriesCode: "venue.field.full_series_code",
  rectificativeSeriesCode: "venue.field.rectificative_series_code",
};

/** The one receipt language a venue starts with: its region's fixed one, else the country's. */
function defaultInvoiceLocales(
  pack: CountryPack | undefined,
  area: AdministrativeArea | undefined,
): string[] {
  return pack === undefined ? [] : [receiptLanguageRules(pack, area?.code).defaultLocale];
}

@customElement("setup-venue-screen")
export class SetupVenueScreen extends LitElement {
  static override styles = [
    baseStyles,
    fieldStyles,
    errorStyles,
    actionsStyles,
    introStyles,
    pairStyles,
    css`
      :host {
        display: block;
      }

      .facts {
        margin: 0 0 var(--wt-space-4);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      h2 {
        margin: var(--wt-space-4) 0 var(--wt-space-2);
        font-size: var(--wt-font-size-lg);
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

      fieldset.locales .reason {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
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

  /** A server-side venue error that names no field, routed back by the shell and shown above
   * Next until the operator presses it again. */
  @property() errorMessage?: string;

  /** A field path the server refused (`setup.request_invalid`'s `params.field`), routed back by the
   * shell. */
  @property() invalidField?: string;

  @state() private values: Record<TextField, string> = {
    country: "ES",
    taxId: "",
    legalName: "",
    taxpayerDomicile: "",
    name: "",
    operationDescription: "",
    addressLine1: "",
    addressLine2: "",
    postalCode: "",
    city: "",
    province: "",
    dayCutover: "04:00",
    seriesCode: "FS",
    fullSeriesCode: "FF",
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
      const demoLocation = this.#demo ? this.#pack()?.demo?.locationName : undefined;
      if (demoLocation !== undefined && this.values.name === "") {
        this.values = { ...this.values, name: demoLocation };
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
        this.invalidField === undefined ? undefined : VENUE_SERVER_FIELDS[this.invalidField];
      this.serverInvalid = refusal === undefined ? undefined : { key: refusal.key, refusal };
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
      taxpayerDomicile: venue.taxpayerDomicile ?? this.values.taxpayerDomicile,
      name: loc.name ?? this.values.name,
      operationDescription: loc.operationDescription ?? this.values.operationDescription,
      addressLine1: loc.addressLine1 ?? this.values.addressLine1,
      addressLine2: loc.addressLine2 ?? this.values.addressLine2,
      postalCode: loc.postalCode ?? this.values.postalCode,
      city: loc.city ?? this.values.city,
      province: loc.province ?? this.values.province,
      dayCutover: loc.dayCutover ?? this.values.dayCutover,
      seriesCode: venue.seriesCode ?? this.values.seriesCode,
      fullSeriesCode: venue.fullSeriesCode ?? this.values.fullSeriesCode,
      rectificativeSeriesCode: venue.rectificativeSeriesCode ?? this.values.rectificativeSeriesCode,
    };
    const pack = this.#pack();
    const area = this.#area(pack);
    const defaults = defaultInvoiceLocales(pack, area);
    this.invoiceLocales = loc.invoiceLocales ?? (defaults.length > 0 ? defaults : ["es-ES"]);
    if (loc.invoiceLocales !== undefined) {
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

  #onCountry(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const country = event.detail.value;
    const pack = getVenueSetupCountryPack(country);
    this.values = { ...this.values, country, postalCode: "", province: "" };
    if (pack !== undefined) {
      this.invoiceLocales = defaultInvoiceLocales(pack, undefined);
      this.#invoiceLocalesFollowAreaDefault = true;
    }
  }

  #onProvince(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const pack = this.#pack();
    if (pack === undefined) return;
    const area = findAdministrativeArea(pack, event.detail.value);
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

  #receiptRules(pack = this.#pack(), area = this.#area(pack)): ReceiptLanguageRules | undefined {
    return pack === undefined ? undefined : receiptLanguageRules(pack, area?.code);
  }

  /** What the venue will print in: the region's fixed language wherever it has one, else the
   * selection, which is kept so that leaving that region gives the operator's choice back. */
  #receiptLanguages(rules = this.#receiptRules()): string[] {
    return rules?.fixed === undefined ? this.invoiceLocales : [rules.fixed.locale];
  }

  #onLocaleToggle(locale: string, event: Event): void {
    event.stopPropagation();
    this.#invoiceLocalesFollowAreaDefault = false;
    this.invoiceLocales = (event.target as HTMLInputElement).checked ? [locale] : [];
  }

  #shows(key: FieldKey): boolean {
    return !(this.#demo && DEMO_HIDDEN.has(key));
  }

  #invalidFields(): Set<FieldKey> {
    const invalid = new Set<FieldKey>();
    for (const key of REQUIRED_TEXT_FIELDS) {
      if (this.#demo && key === "taxpayerDomicile") continue;
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
    const receipt = this.#receiptRules(pack, area);
    const languages = this.#receiptLanguages(receipt);
    if (languages.length !== 1 || !receipt?.choices.includes(languages[0]!)) {
      invalid.add("invoiceLocales");
    }
    for (const [first, second] of [
      ["seriesCode", "fullSeriesCode"],
      ["seriesCode", "rectificativeSeriesCode"],
      ["fullSeriesCode", "rectificativeSeriesCode"],
    ] as const) {
      if (this.values[first].trim() !== "" && this.values[first] === this.values[second]) {
        invalid.add(first);
        invalid.add(second);
      }
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
    // From the pack chosen NOW, so a country changed after the form was seeded cannot send another
    // country's demo identity.
    const identity = this.#demo ? this.#pack()?.demo : undefined;
    if (identity !== undefined) {
      this.values = { ...this.values, taxId: identity.taxId, legalName: identity.legalName };
    }
    this.attempted = true;
    this.refusalDismissed = true;
    this.serverInvalid = undefined;
    if (this.#invalidFields().size > 0) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
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
        taxpayerDomicile: this.#demo ? null : this.values.taxpayerDomicile,
        location: {
          name: this.values.name,
          fiscalTerritory: selectedJurisdiction.id,
          invoiceLocales: this.#receiptLanguages(this.#receiptRules(pack, area)),
          operationDescription: this.values.operationDescription,
          addressLine1: this.values.addressLine1,
          addressLine2,
          postalCode: normalizedPostalCode,
          city: this.values.city,
          province: area?.name ?? this.values.province,
          timeZone: area?.timeZone ?? selectedPack.defaultTimeZone,
          dayCutover: this.values.dayCutover,
        },
        seriesCode: this.values.seriesCode,
        fullSeriesCode: this.values.fullSeriesCode,
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
    if (key === "seriesCode" || key === "fullSeriesCode" || key === "rectificativeSeriesCode")
      return t("venue.error.series_codes");
    return format("venue.check_field", { field: t(FIELD_NOUNS[key]) });
  }

  #help(key: HelpedField): TemplateResult {
    return html`<wt-help-tooltip
      slot="help"
      aria-label=${format("venue.help_with_field", { field: t(FIELD_NOUNS[key]) })}
      >${t(FIELD_HELP[key])}</wt-help-tooltip
    >`;
  }

  #field(label: string, key: TextField, type = "text"): TemplateResult {
    const error = this.#errors.get(key) ?? "";
    const demoName = this.#demo && key === "name";
    const help = !hasHint(key) ? this.#help(key) : demoName ? this.#help("name") : nothing;
    return html`<wt-input
      @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=next]"))}
      class="field"
      label=${label}
      name=${key}
      autocomplete=${FIELD_AUTOCOMPLETE[key]}
      data-test=${key}
      type=${type}
      hint=${hasHint(key) && !demoName ? t(FIELD_HINT[key]) : ""}
      ?invalid=${error !== ""}
      ?required=${key !== "addressLine2"}
      error=${error}
      .value=${this.values[key]}
      @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(key, e)}
      >${help}</wt-input
    >`;
  }

  override render(): TemplateResult {
    const pack = this.#pack();
    const area = this.#area(pack);
    const jurisdiction = this.#jurisdiction(pack, area);
    const selectProvince = t("venue.select_province");
    const fiscalTerritory =
      jurisdiction === undefined
        ? undefined
        : format("venue.fiscal_territory", { territory: jurisdiction.id });
    const timeZone = format("venue.time_zone", {
      zone: area?.timeZone ?? pack?.defaultTimeZone ?? "—",
    });
    const receipt = this.#receiptRules(pack, area);
    const receiptLanguages = this.#receiptLanguages(receipt);
    const fixed = receipt?.fixed;
    const fixedReason =
      fixed === undefined ? "" : resolveContentText(fixed.reason, currentLocale(), "en");
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
      <p class="intro">${this.#demo ? t("venue.intro_demo") : t("venue.intro")}</p>

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
      ${this.#demo ? nothing : html`<h2>${t("venue.section.business")}</h2>`}
      <wt-combobox
        class="field"
        label=${t("venue.label.country")}
        name="country"
        required
        search="auto"
        searchPlaceholder=${t("venue.combobox_search")}
        noResultsLabel=${t("venue.combobox_no_results")}
        data-test="country"
        ?invalid=${errors.has("country")}
        error=${errors.get("country") ?? ""}
        .options=${VENUE_SETUP_COUNTRY_PACKS.map((country) => ({
          value: country.countryCode,
          label: countryName(country.countryCode, currentLocale()),
        }))}
        .value=${pack?.countryCode ?? ""}
        @wt-change=${(event: CustomEvent<{ value: string }>) => this.#onCountry(event)}
        >${this.#help("country")}</wt-combobox
      >
      ${this.#demo ? nothing : html`${this.#field(pack?.taxIdentifier?.label ?? t("venue.label.tax_id"), "taxId")}${this.#field(t("venue.label.legal_name"), "legalName")}${this.#field(t("venue.label.taxpayer_domicile"), "taxpayerDomicile")}`}
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
                aria-describedby=${
                  [
                    ...(fixedReason === "" ? [] : ["invoice-locales-fixed"]),
                    ...(errors.has("invoiceLocales") ? ["invoice-locales-error"] : []),
                  ].join(" ") || nothing
                }
              >
                <legend>
                  ${t("venue.label.invoice_locales")} *
                  <wt-help-tooltip aria-label=${t("venue.invoice_locales_help_label")}
                    >${t("venue.invoice_locales_help")}</wt-help-tooltip
                  >
                </legend>
                ${
                  fixedReason === ""
                    ? nothing
                    : html`<p
                        class="reason"
                        id="invoice-locales-fixed"
                        data-test="invoice-locales-fixed"
                      >
                        ${fixedReason}
                      </p>`
                }
                ${(receipt?.choices ?? []).map(
                  (locale) =>
                    html`<label class="locale-option">
                      <input
                        type="radio"
                        name="invoiceLocales"
                        value=${locale}
                        data-test=${`locale-${locale}`}
                        .checked=${receiptLanguages.includes(locale)}
                        ?disabled=${fixed !== undefined}
                        @change=${(e: Event) => this.#onLocaleToggle(locale, e)}
                      />
                      ${RECEIPT_LANGUAGES[locale] === undefined ? locale : t(RECEIPT_LANGUAGES[locale].selectionLabel)}
                    </label>`,
                )}
                ${errors.has("invoiceLocales") ? html`<p class="error" id="invoice-locales-error">${errors.get("invoiceLocales")}</p>` : nothing}
              </fieldset>
              ${this.#field(t("venue.label.operation_description"), "operationDescription")}`
      }
      ${this.#field(t("venue.label.address_line1"), "addressLine1")}
      ${this.#field(t("venue.label.address_line2"), "addressLine2")}
      <div class="pair">
        ${this.#field(t("venue.label.postal_code"), "postalCode")}
        ${this.#field(t("venue.label.city"), "city")}
      </div>
      ${
        pack !== undefined && pack.administrativeAreas.length > 0
          ? html`<wt-combobox
              class="field"
              label=${t("venue.label.province")}
              name="province"
              required
              search="auto"
              placeholder=${selectProvince}
              searchPlaceholder=${t("venue.combobox_search")}
              noResultsLabel=${t("venue.combobox_no_results")}
              data-test="province"
              ?invalid=${errors.has("province")}
              error=${errors.get("province") ?? ""}
              .options=${pack.administrativeAreas.map((candidate) => ({
                value: candidate.code,
                label: candidate.name,
              }))}
              .value=${area?.code ?? ""}
              @wt-change=${(event: CustomEvent<{ value: string }>) => this.#onProvince(event)}
              >${this.#help("province")}</wt-combobox
            >`
          : this.#field(t("venue.label.province_region"), "province")
      }
      <p class="facts" data-test="facts">
        ${
          fiscalTerritory === undefined
            ? nothing
            : html`<span data-test="fiscalTerritory">${fiscalTerritory}</span> · `
        }<span data-test="timeZone">${timeZone}</span>
      </p>
      ${
        this.#demo
          ? nothing
          : html`${this.#field(t("venue.label.day_cutover"), "dayCutover", "time")}

              <h2>${t("venue.section.invoicing")}</h2>
              ${this.#field(t("venue.label.series_code"), "seriesCode")}
              ${this.#field(t("venue.label.full_series_code"), "fullSeriesCode")}
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
