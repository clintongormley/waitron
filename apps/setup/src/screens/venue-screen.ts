import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  FormFeedback,
  submitOnEnter,
  baseStyles,
  pageTitleStyles,
  leaveCoordinatorFor,
  type AddressChosenDetail,
  type AddressLookupProvider,
  type DraftScope,
  type WtAddressLookup,
} from "@waitron/ui";
import {
  findAdministrativeArea,
  findAdministrativeAreaByPostalCode,
  receiptLanguageRules,
  resolveCountryDemoIdentity,
  resolveFiscalJurisdiction,
  type AdministrativeArea,
  type CountryPack,
  type FiscalJurisdiction,
  type ReceiptLanguageRules,
} from "@waitron/country";
import {
  areaOfChosenAddress,
  joinRegisteredAddress,
  registeredAddressErrors,
  registeredAddressParts,
  type RegisteredAddressError,
  type RegisteredAddressParts,
  VENUE_SETUP_COUNTRY_PACKS,
  getVenueSetupCountryPack,
  resolveInstalledStarterLanguages,
} from "@waitron/country-packs";
import { resolveContentText } from "@waitron/shared";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-address-lookup.js";
import "@waitron/ui/src/components/wt-switch.js";
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
import type { ProvisionBody } from "../api/client.js";
import { VENUE_SERVER_FIELDS, type ServerField } from "../server-fields.js";

/** The business's registered address, asked for in parts and sent as one line. */
const REGISTERED_PART = {
  registeredStreet: "street",
  registeredLine2: "line2",
  registeredPostalCode: "postalCode",
  registeredCity: "city",
  registeredProvince: "province",
} as const satisfies Record<string, keyof RegisteredAddressParts>;
type RegisteredField = keyof typeof REGISTERED_PART;
const REGISTERED_FIELDS = Object.keys(REGISTERED_PART) as RegisteredField[];

type TextField =
  | "country"
  | "taxId"
  | "legalName"
  | RegisteredField
  | "name"
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
 * Each postal address's tokens share a section of its own: without one, Chromium filled the street
 * from one choice and the postcode and city from another.
 */
const FIELD_AUTOCOMPLETE: Record<TextField, string> = {
  country: "off",
  taxId: "off",
  legalName: "off",
  registeredStreet: "section-registered address-line1",
  registeredLine2: "section-registered address-line2",
  registeredPostalCode: "section-registered postal-code",
  registeredCity: "section-registered address-level2",
  registeredProvince: "section-registered address-level1",
  name: "off",
  addressLine1: "section-venue address-line1",
  addressLine2: "section-venue address-line2",
  postalCode: "section-venue postal-code",
  city: "section-venue address-level2",
  province: "section-venue address-level1",
  dayCutover: "off",
  seriesCode: "off",
  fullSeriesCode: "off",
  rectificativeSeriesCode: "off",
};

const INPUT_NAME: Readonly<Partial<Record<TextField, string>>> = { name: "venueName" };

const CODE_FIELDS: ReadonlySet<TextField> = new Set([
  "taxId",
  "seriesCode",
  "fullSeriesCode",
  "rectificativeSeriesCode",
]);

type FormField = TextField | "invoiceLocales";
/** A value the server can refuse that this form does not hold as one field. `taxpayerDomicile`
 * is the registered address's joined line. */
type FieldKey = FormField | "staffLanguage" | "taxpayerDomicile";
type ComparableKey =
  TextField | "invoiceLocales" | "demoVenueNameSource" | "staffLanguage" | "taxpayerDomicile";

type AddressSearch = "address" | "domicile";

const SEARCH_FILLS: Readonly<Partial<Record<TextField, AddressSearch>>> = {
  addressLine1: "address",
  addressLine2: "address",
  postalCode: "address",
  city: "address",
  province: "address",
  registeredStreet: "domicile",
  registeredLine2: "domicile",
  registeredPostalCode: "domicile",
  registeredCity: "domicile",
  registeredProvince: "domicile",
};

interface VenueForm {
  staffLanguage?: "en" | "es";
  demoVenueNameSource: "automatic" | "custom";
  values: Record<TextField, string>;
  sameAsVenue: boolean;
  invoiceLocales: string[];
  invoiceLocalesFollowAreaDefault: boolean;
}

/** Demo fills these itself, so its form does not show them. */
const DEMO_HIDDEN: ReadonlySet<FieldKey> = new Set<FieldKey>([
  "taxId",
  "legalName",
  "taxpayerDomicile",
  ...REGISTERED_FIELDS,
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
  "name",
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
  | RegisteredField
  | "name"
  | "addressLine1"
  | "addressLine2"
  | "postalCode"
  | "city";
/** Demo starts the venue name filled in, so there it takes a "?" rather than its hint. */
type HelpedField = Exclude<TextField, HintedField> | "name";

/** A short explanation shown in the empty field. */
const FIELD_HINT: Record<HintedField, StringKey> = {
  taxId: "venue.hint.tax_id",
  legalName: "venue.hint.legal_name",
  registeredStreet: "venue.hint.address_line1",
  registeredLine2: "venue.hint.address_line2",
  registeredPostalCode: "venue.hint.postal_code",
  registeredCity: "venue.hint.city",
  registeredProvince: "venue.hint.registered_province",
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
  province: "venue.help.province",
  dayCutover: "venue.help.day_cutover",
  seriesCode: "venue.help.series_codes",
  fullSeriesCode: "venue.help.series_codes",
  rectificativeSeriesCode: "venue.help.series_codes",
};

const hasHint = (key: TextField): key is HintedField => key in FIELD_HINT;
const FIELD_NOUNS: Record<TextField, StringKey> = {
  country: "venue.field.country",
  taxId: "venue.field.tax_id",
  legalName: "venue.field.legal_name",
  registeredStreet: "venue.field.address_line1",
  registeredLine2: "venue.field.address_line2",
  registeredPostalCode: "venue.field.postal_code",
  registeredCity: "venue.field.city",
  registeredProvince: "venue.field.province",
  name: "venue.field.name",
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

function normalizedPostalCode(pack: CountryPack | undefined, value: string): string {
  const validation = pack?.postalCode?.validate(value);
  return validation?.valid === true ? validation.normalized : value;
}

/** The pack's own name for a province given in any spelling it accepts, as the server's split
 * recognises only that name. */
function provinceName(pack: CountryPack | undefined, value: string): string {
  return (pack && findAdministrativeArea(pack, value)?.name) ?? value;
}

function venueAddressParts(
  pack: CountryPack | undefined,
  values: Record<TextField, string>,
): RegisteredAddressParts {
  return {
    street: values.addressLine1,
    line2: values.addressLine2,
    postalCode: normalizedPostalCode(pack, values.postalCode),
    city: values.city,
    province: provinceName(pack, values.province),
  };
}

function registeredParts(
  pack: CountryPack | undefined,
  values: Record<TextField, string>,
): RegisteredAddressParts {
  return {
    street: values.registeredStreet.trim(),
    line2: values.registeredLine2.trim(),
    postalCode: normalizedPostalCode(pack, values.registeredPostalCode.trim()),
    city: values.registeredCity.trim(),
    province: provinceName(pack, values.registeredProvince.trim()),
  };
}

/** The one line sent as the registered address. */
function registeredLine(
  pack: CountryPack | undefined,
  values: Record<TextField, string>,
  sameAsVenue: boolean,
): string {
  return joinRegisteredAddress(
    sameAsVenue ? venueAddressParts(pack, values) : registeredParts(pack, values),
  );
}

function registeredValues(parts: RegisteredAddressParts): Record<RegisteredField, string> {
  return Object.fromEntries(
    REGISTERED_FIELDS.map((key) => [key, parts[REGISTERED_PART[key]]]),
  ) as Record<RegisteredField, string>;
}

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
    pageTitleStyles,
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

      fieldset.registered {
        margin: 0;
        padding: 0;
        border: 0;
        min-inline-size: 0;
      }

      fieldset.registered legend {
        padding: 0;
        margin-bottom: var(--wt-space-2);
        font-weight: var(--wt-font-weight-medium);
      }

      /* Its note says what the switch's on state means, so it sits right under it. */
      .field.with-hint {
        margin-bottom: 0;
      }

      .switch-hint {
        margin: var(--wt-space-1) 0 var(--wt-space-4);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
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
  /** Address suggestions; without one the address search fields stay hidden. */
  @property({ attribute: false }) addressProvider?: AddressLookupProvider;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  get #demo(): boolean {
    return this.draft.mode === "demo";
  }

  /** A server-side venue error that names no field, routed back by the shell and shown above
   * Next until the operator presses it again. */
  @property() errorMessage?: string;
  /** A new value means a new refusal: it shows `errorMessage` again after the person pressed it away. A language change rewords `errorMessage` without changing this. */
  @property({ attribute: false }) refusal?: unknown;

  /** A field path the server refused (the `params.field` of `setup.request_invalid` or
   * `venue.detail_invalid`), routed back by the shell. */
  @property() invalidField?: string;

  @state() private values: Record<TextField, string> = {
    country: "ES",
    taxId: "",
    legalName: "",
    registeredStreet: "",
    registeredLine2: "",
    registeredPostalCode: "",
    registeredCity: "",
    registeredProvince: "",
    name: "",
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

  /** While on, the registered address is the venue's own, and its parts are hidden. */
  @state() private sameAsVenue = true;

  @state() private staffLanguage?: "en" | "es";

  readonly #feedback = new FormFeedback(this);

  /** Which address search last returned an address in a country other than the form's. */
  @state() private foreignAddress?: { readonly which: AddressSearch; readonly country: string };

  // `refusal` is kept whole, not copied: its `message` is translated on each read.
  /** `line`, for `taxpayerDomicile`: the line refused, which the refusal is shown against. */
  @state() private serverInvalid?: {
    readonly key: FieldKey;
    readonly refusal: ServerField;
    readonly line?: string;
  };

  #demoVenueNameSource: "automatic" | "custom" = "automatic";
  #seeded = false;
  #invoiceLocalesFollowAreaDefault = true;
  #errors = new Map<FieldKey, string>();
  #baseline?: VenueForm;
  #scope?: DraftScope<VenueForm>;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#registerScope();
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }

  #current(): VenueForm {
    return {
      staffLanguage: this.staffLanguage,
      demoVenueNameSource: this.#demoVenueNameSource,
      values: this.values,
      sameAsVenue: this.sameAsVenue,
      invoiceLocales: this.invoiceLocales,
      invoiceLocalesFollowAreaDefault: this.#invoiceLocalesFollowAreaDefault,
    };
  }

  #snapshot(form: VenueForm): VenueForm {
    return { ...form, values: { ...form.values }, invoiceLocales: [...form.invoiceLocales] };
  }

  #comparable(form: VenueForm): Record<ComparableKey, string | null> {
    const pack = getVenueSetupCountryPack(form.values.country);
    const area = pack && findAdministrativeArea(pack, form.values.province);
    const tax = pack?.taxIdentifier?.validate(form.values.taxId);
    const postal = pack?.postalCode?.validate(form.values.postalCode);
    const rules = pack && receiptLanguageRules(pack, area?.code);
    const values: Record<ComparableKey, string | null> = {
      ...form.values,
      // The registered address counts as the line it sends, so the switch and the parts compare by it.
      ...Object.fromEntries(REGISTERED_FIELDS.map((key) => [key, null])),
      taxpayerDomicile: registeredLine(pack, form.values, form.sameAsVenue),
      staffLanguage: form.staffLanguage ?? null,
      demoVenueNameSource: this.#demo ? form.demoVenueNameSource : null,
      taxId: tax?.valid ? tax.normalized : form.values.taxId,
      postalCode: postal?.valid ? postal.normalized : form.values.postalCode,
      province: area?.name ?? form.values.province,
      addressLine2: form.values.addressLine2.trim() === "" ? null : form.values.addressLine2,
      invoiceLocales: JSON.stringify(
        rules?.fixed ? [rules.fixed.locale] : [...form.invoiceLocales].sort(),
      ),
    };
    if (this.#demo) {
      for (const key of DEMO_HIDDEN) values[key] = null;
    }
    return values;
  }

  #registerScope(): void {
    if (!this.isConnected || !this.#baseline || this.#scope) return;
    this.#scope = leaveCoordinatorFor(this)?.register({
      id: this,
      current: () => this.#current(),
      snapshot: (form) => this.#snapshot(form),
      equal: (a, b) => {
        const left = this.#comparable(a);
        const right = this.#comparable(b);
        return (Object.keys(left) as ComparableKey[]).every((key) => left[key] === right[key]);
      },
      restore: (form) => {
        this.staffLanguage = form.staffLanguage;
        this.#demoVenueNameSource = form.demoVenueNameSource;
        this.values = form.values;
        this.sameAsVenue = form.sameAsVenue;
        this.invoiceLocales = form.invoiceLocales;
        this.#invoiceLocalesFollowAreaDefault = form.invoiceLocalesFollowAreaDefault;
        this.#feedback.attempted = false;
      },
    });
    this.#scope?.commit(this.#baseline);
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (!this.#seeded) {
      this.#seeded = true;
      this.#seedFromDraft();
      this.#followDemoName(this.#pack(), this.#area(this.#pack()));
    }
    this.#baseline ??= this.#snapshot(this.#current());
    // Only when the shell hands down a NEW value: re-deriving on every update would put back a mark
    // the operator has already cleared by editing the field.
    if (changed.has("invalidField")) {
      const refusal =
        this.invalidField === undefined ? undefined : VENUE_SERVER_FIELDS[this.invalidField];
      this.serverInvalid =
        refusal === undefined
          ? undefined
          : {
              key: refusal.key,
              refusal,
              ...(refusal.key === "taxpayerDomicile"
                ? { line: registeredLine(this.#pack(), this.values, this.sameAsVenue) }
                : {}),
            };
    }
    if (changed.has("refusal")) this.#feedback.newRefusal("request");
    this.#errors = this.#collectErrors();
  }

  /**
   * Focus the refused field when the shell hands it down: the field may be off-screen, so moving
   * focus is what tells the operator where they landed.
   */
  override updated(changed: PropertyValues<this>): void {
    this.#registerScope();
    if (!changed.has("invalidField") || this.serverInvalid === undefined) return;
    // By its `name`, not its `data-test` hook, which is for tests.
    const field = this.shadowRoot!.querySelector<
      HTMLElement & { updateComplete?: Promise<unknown> }
    >(
      `:is(wt-input,wt-combobox)[name=${this.serverInvalid.key === "taxpayerDomicile" ? "registeredStreet" : this.serverInvalid.key}]`,
    );
    if (field === null) return;
    // Wait for the `wt-input`'s own render: until then the native input its focus is delegated to
    // does not exist, and focusing the host does nothing. The screen may be gone by then.
    void Promise.resolve(field.updateComplete).then(() => {
      if (this.isConnected) field.focus();
    });
  }

  #seedFromDraft(): void {
    const venue = this.draft.venue ?? {};
    this.staffLanguage = venue.staffLanguage;
    this.values = {
      ...this.values,
      country: venue.country ?? this.values.country,
      taxId: venue.taxId ?? this.values.taxId,
      legalName: venue.legalName ?? this.values.legalName,
      name: venue.name ?? this.values.name,
      addressLine1: venue.addressLine1 ?? this.values.addressLine1,
      addressLine2: venue.addressLine2 ?? this.values.addressLine2,
      postalCode: venue.postalCode ?? this.values.postalCode,
      city: venue.city ?? this.values.city,
      province: venue.province ?? this.values.province,
      dayCutover: venue.dayCutover ?? this.values.dayCutover,
      seriesCode: venue.seriesCode ?? this.values.seriesCode,
      fullSeriesCode: venue.fullSeriesCode ?? this.values.fullSeriesCode,
      rectificativeSeriesCode: venue.rectificativeSeriesCode ?? this.values.rectificativeSeriesCode,
    };
    this.#demoVenueNameSource =
      this.draft.demoVenueNameSource ?? (this.values.name === "" ? "automatic" : "custom");
    this.#seedRegisteredAddress(venue.taxpayerDomicile ?? "");
    const pack = this.#pack();
    const area = this.#area(pack);
    const defaults = defaultInvoiceLocales(pack, area);
    this.invoiceLocales = venue.invoiceLocales ?? (defaults.length > 0 ? defaults : ["es-ES"]);
    if (venue.invoiceLocales !== undefined) {
      this.#invoiceLocalesFollowAreaDefault =
        pack !== undefined && JSON.stringify(venue.invoiceLocales) === JSON.stringify(defaults);
    }
  }

  /** The draft's own parts while they still make the saved line (so Back keeps line 2); otherwise
   * the saved line split, with the switch on when that is empty or is the venue's address. */
  #seedRegisteredAddress(line: string): void {
    const pack = this.#pack();
    const saved = line.trim();
    const stored = this.draft.registeredAddress;
    if (stored !== undefined) {
      const parts: RegisteredAddressParts = {
        street: stored.street ?? "",
        line2: stored.line2 ?? "",
        postalCode: stored.postalCode ?? "",
        city: stored.city ?? "",
        province: stored.province ?? "",
      };
      const sameAsVenue = stored.sameAsVenue === true;
      const sent = sameAsVenue
        ? joinRegisteredAddress(venueAddressParts(pack, this.values))
        : joinRegisteredAddress(parts);
      if (sent === saved) {
        this.values = { ...this.values, ...registeredValues(parts) };
        this.sameAsVenue = sameAsVenue;
        return;
      }
    }
    const parts =
      pack === undefined
        ? { street: saved, line2: "", postalCode: "", city: "", province: "" }
        : registeredAddressParts(saved, pack);
    this.values = { ...this.values, ...registeredValues(parts) };
    this.sameAsVenue =
      saved === "" ||
      joinRegisteredAddress(parts) === joinRegisteredAddress(venueAddressParts(pack, this.values));
  }

  #followDemoName(pack: CountryPack | undefined, area: AdministrativeArea | undefined): void {
    if (!this.#demo || this.#demoVenueNameSource !== "automatic" || pack === undefined) return;
    const identity = resolveCountryDemoIdentity(pack, area?.code);
    if (identity !== undefined) this.values = { ...this.values, name: identity.venueName };
  }

  #workingLanguage(): "en" | "es" {
    return resolveInstalledStarterLanguages({
      country: this.values.country,
      area: this.values.province,
      receiptLocale: this.invoiceLocales[0],
      staffLanguage: this.staffLanguage,
    }).staffLanguage;
  }

  #onWorkingLanguage(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const value = event.detail.value;
    if (value !== "en" && value !== "es") return;
    if (this.serverInvalid?.key === "staffLanguage") this.serverInvalid = undefined;
    this.staffLanguage = value;
    this.#scope?.changed();
  }

  #onField(key: TextField, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    // Editing the field the server refused retires that mark: the new value has not been refused.
    if (this.serverInvalid?.key === key) this.serverInvalid = undefined;
    const value = event.detail.value;
    this.#cancelAddressSearch(SEARCH_FILLS[key]);
    if (key === "name") this.#demoVenueNameSource = "custom";
    if (key === "registeredPostalCode") {
      const pack = this.#pack();
      const validation = pack?.postalCode?.validate(value);
      const area =
        pack !== undefined && validation?.valid === true
          ? findAdministrativeAreaByPostalCode(pack, validation.normalized)
          : undefined;
      this.values = {
        ...this.values,
        registeredPostalCode: value,
        ...(area === undefined ? {} : { registeredProvince: area.name }),
      };
      this.#scope?.changed();
      return;
    }
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
      if (area !== undefined) this.#followDemoName(pack, area);
      if (pack !== undefined && area !== undefined && this.#invoiceLocalesFollowAreaDefault) {
        this.invoiceLocales = defaultInvoiceLocales(pack, area);
      }
      this.#scope?.changed();
      return;
    }
    this.values = { ...this.values, [key]: value };
    this.#scope?.changed();
  }

  /** So an address still on its way cannot overwrite what the person typed or switched. */
  #cancelAddressSearch(which: AddressSearch | undefined): void {
    if (which === undefined) return;
    this.shadowRoot!.querySelector<WtAddressLookup>(`[data-test=${which}-lookup]`)?.cancelSearch();
  }

  #onAddressChosen(which: AddressSearch, event: CustomEvent<AddressChosenDetail>): void {
    event.stopPropagation();
    const pack = this.#pack();
    const address = event.detail.address;
    if (pack === undefined || address.countryCode !== pack.countryCode) {
      this.foreignAddress = { which, country: this.values.country };
      return;
    }
    if (this.foreignAddress?.which === which) this.foreignAddress = undefined;
    const area = areaOfChosenAddress(pack, address);
    const [addressLine1 = "", ...later] = address.lines;
    const rest = later.filter((line) => line.trim() !== "");
    if (which === "domicile") {
      this.sameAsVenue = false;
      this.#fill({
        registeredStreet: addressLine1,
        ...(rest.length > 0 ? { registeredLine2: rest.join(", ") } : {}),
        registeredPostalCode: address.postalCode,
        registeredCity: address.locality,
        ...(area === undefined ? {} : { registeredProvince: area.name }),
      });
      return;
    }
    this.#fill({
      addressLine1,
      // The person's own line 2 (a floor, a unit) stays unless the address brings one.
      ...(rest.length > 0 ? { addressLine2: rest.join(", ") } : {}),
      postalCode: address.postalCode,
      city: address.locality,
      ...(area === undefined ? {} : { province: area.name }),
    });
    if (area === undefined) return;
    this.#followDemoName(pack, area);
    if (this.#invoiceLocalesFollowAreaDefault)
      this.invoiceLocales = defaultInvoiceLocales(pack, area);
  }

  #fill(filled: Partial<Record<TextField, string>>): void {
    if (this.serverInvalid !== undefined && this.serverInvalid.key in filled)
      this.serverInvalid = undefined;
    this.values = { ...this.values, ...filled };
    this.#scope?.changed();
  }

  #onSameAsVenue(event: CustomEvent<{ checked: boolean }>): void {
    event.stopPropagation();
    this.#cancelAddressSearch("domicile");
    this.sameAsVenue = event.detail.checked;
    this.#scope?.changed();
  }

  #onRegisteredProvince(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const pack = this.#pack();
    if (pack === undefined) return;
    this.#cancelAddressSearch("domicile");
    this.values = {
      ...this.values,
      registeredProvince: findAdministrativeArea(pack, event.detail.value)?.name ?? "",
    };
    this.#scope?.changed();
  }

  #onCountry(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const country = event.detail.value;
    const pack = getVenueSetupCountryPack(country);
    this.values = {
      ...this.values,
      country,
      postalCode: "",
      province: "",
      registeredPostalCode: "",
      registeredProvince: "",
    };
    this.foreignAddress = undefined;
    this.#followDemoName(pack, undefined);
    if (pack !== undefined) {
      this.invoiceLocales = defaultInvoiceLocales(pack, undefined);
      this.#invoiceLocalesFollowAreaDefault = true;
    }
    this.#scope?.changed();
  }

  #onProvince(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const pack = this.#pack();
    if (pack === undefined) return;
    this.#cancelAddressSearch("address");
    const area = findAdministrativeArea(pack, event.detail.value);
    this.values = { ...this.values, province: area?.name ?? "" };
    if (area !== undefined) this.#followDemoName(pack, area);
    this.#scope?.changed();
    if (area === undefined) return;
    if (this.#invoiceLocalesFollowAreaDefault) {
      this.invoiceLocales = defaultInvoiceLocales(pack, area);
      this.#scope?.changed();
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
    this.#scope?.changed();
  }

  /** Whether a field on screen carries the key's message; the rest go in the bottom message. */
  #showsAsField(key: FieldKey): boolean {
    return this.#shows(key) && !(key === "taxpayerDomicile" && this.sameAsVenue);
  }

  #shows(key: FieldKey): boolean {
    return key === "staffLanguage" || !(this.#demo && DEMO_HIDDEN.has(key));
  }

  #invalidFields(): Set<FormField> {
    const invalid = new Set<FormField>();
    for (const key of REQUIRED_TEXT_FIELDS) {
      if (this.values[key].trim() === "") invalid.add(key);
    }
    for (const key of this.#registeredErrors().keys()) invalid.add(key);
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
    // Last, so it sees every mark on the fields the line is joined from.
    const unreadable = this.#unreadableCity(invalid);
    if (unreadable !== undefined) invalid.add(unreadable);
    return invalid;
  }

  /** Checked only while the parts are shown. Without a pack the country is refused anyway. */
  #registeredErrors(): Map<RegisteredField, RegisteredAddressError> {
    const errors = new Map<RegisteredField, RegisteredAddressError>();
    if (this.#demo || this.sameAsVenue) return errors;
    const pack = this.#pack();
    const parts: RegisteredAddressParts = {
      street: this.values.registeredStreet,
      line2: this.values.registeredLine2,
      postalCode: this.values.registeredPostalCode,
      city: this.values.registeredCity,
      province: this.values.registeredProvince,
    };
    const found =
      pack === undefined
        ? {
            ...(parts.street.trim() === "" ? { street: "required" as const } : {}),
            ...(parts.postalCode.trim() === "" ? { postalCode: "required" as const } : {}),
            ...(parts.city.trim() === "" ? { city: "required" as const } : {}),
          }
        : registeredAddressErrors(parts, pack);
    for (const key of REGISTERED_FIELDS) {
      const error = found[REGISTERED_PART[key]];
      if (error !== undefined) errors.set(key, error);
    }
    return errors;
  }

  /** The server splits the line it is sent and checks the split, where the pack has a postcode
   * rule. Parts that pass on their own can still join into a line that splits otherwise, as when
   * the city holds a comma; that marks the City the line was joined from. Checked once the fields
   * it joins pass, so a field is not marked twice. */
  #unreadableCity(invalid: ReadonlySet<FormField>): "city" | "registeredCity" | undefined {
    const pack = this.#pack();
    if (this.#demo || pack?.postalCode === undefined) return undefined;
    const joined: readonly TextField[] = this.sameAsVenue
      ? ["addressLine1", "addressLine2", "postalCode", "city", "province"]
      : REGISTERED_FIELDS;
    if (joined.some((key) => invalid.has(key))) return undefined;
    const line = registeredLine(pack, this.values, this.sameAsVenue);
    const readBack = registeredAddressErrors(registeredAddressParts(line, pack), pack);
    if (Object.keys(readBack).length === 0) return undefined;
    return this.sameAsVenue ? "city" : "registeredCity";
  }

  #collectErrors(): Map<FieldKey, string> {
    const errors = new Map<FieldKey, string>();
    if (this.#feedback.attempted) {
      for (const key of this.#invalidFields()) errors.set(key, this.#fieldMessage(key));
    }
    if (
      this.serverInvalid !== undefined &&
      (this.serverInvalid.line === undefined ||
        this.serverInvalid.line === registeredLine(this.#pack(), this.values, this.sameAsVenue))
    ) {
      errors.set(
        this.serverInvalid.key,
        this.serverInvalid.key === "taxpayerDomicile" && this.sameAsVenue
          ? t("venue.error.registered_same_refused")
          : this.serverInvalid.refusal.message,
      );
    }
    return errors;
  }

  #next(): void {
    const demoPack = this.#pack();
    const identity =
      this.#demo && demoPack !== undefined
        ? resolveCountryDemoIdentity(demoPack, this.#area(demoPack)?.code)
        : undefined;
    if (identity !== undefined) {
      this.values = { ...this.values, taxId: identity.taxId, legalName: identity.legalName };
    }
    this.#feedback.press("request");
    this.serverInvalid = undefined;
    if (this.#invalidFields().size > 0) {
      void this.#feedback.focus(this.shadowRoot!);
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
      ...(this.#demo
        ? { demoVenueNameSource: this.#demoVenueNameSource }
        : {
            registeredAddress: {
              sameAsVenue: this.sameAsVenue,
              ...registeredParts(pack, this.values),
            },
          }),
      venue: {
        country: selectedPack.countryCode,
        taxId: normalizedTaxId,
        legalName: this.values.legalName,
        taxpayerDomicile: this.#demo ? null : registeredLine(pack, this.values, this.sameAsVenue),
        name: this.values.name,
        fiscalTerritory: selectedJurisdiction.id,
        invoiceLocales: this.#receiptLanguages(this.#receiptRules(pack, area)),
        staffLanguage: this.#workingLanguage(),
        addressLine1: this.values.addressLine1,
        addressLine2,
        postalCode: normalizedPostalCode,
        city: this.values.city,
        province: area?.name ?? this.values.province,
        timeZone: area?.timeZone ?? selectedPack.defaultTimeZone,
        dayCutover: this.values.dayCutover,
        seriesCode: this.values.seriesCode,
        fullSeriesCode: this.values.fullSeriesCode,
        rectificativeSeriesCode: this.values.rectificativeSeriesCode,
      },
    };
    dispatchSetupPatch(this, patch);
    this.#baseline = this.#snapshot(this.#current());
    this.#scope?.commit(this.#baseline);

    // The shell decides the next screen: it holds the merged draft.
    dispatchSetupAdvance(this);
  }

  #back(): void {
    dispatchSetupGoto(this, "admin");
  }

  #fieldMessage(key: FormField): string {
    if (key === "invoiceLocales") return t("venue.error.invoice_locales");
    if (this.values[key].trim() === "")
      return format("venue.enter_field", { field: t(FIELD_NOUNS[key]) });
    if (key === "city" || key === "registeredCity") return t("venue.error.city_comma");
    if (key === "taxId") return t("venue.error.tax_id");
    if (key === "registeredPostalCode") return t("venue.error.registered_postal_code");
    if (key === "registeredProvince") return t("venue.error.province");
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

  #addressSearch(which: AddressSearch, pack: CountryPack | undefined): TemplateResult {
    const foreign = this.foreignAddress?.which === which ? this.foreignAddress : undefined;
    return html`<wt-address-lookup
      class="field"
      data-test=${`${which}-lookup`}
      name=${`${which}-search`}
      .provider=${this.addressProvider}
      country-code=${pack?.countryCode ?? ""}
      label=${t(which === "address" ? "venue.address_lookup.label" : "venue.address_lookup.domicile_label")}
      placeholder=${t("venue.address_lookup.placeholder")}
      no-results-label=${t("venue.address_lookup.no_results")}
      unavailable-label=${t("venue.address_lookup.unavailable")}
      .message=${
        foreign === undefined
          ? ""
          : format("venue.address_lookup.other_country", {
              country: countryName(foreign.country, currentLocale()),
            })
      }
      @wt-address-chosen=${(event: CustomEvent<AddressChosenDetail>) => this.#onAddressChosen(which, event)}
    ></wt-address-lookup>`;
  }

  #field(label: string, key: TextField, type = "text"): TemplateResult {
    const error =
      this.#errors.get(key) ??
      (key === "registeredStreet" ? this.#errors.get("taxpayerDomicile") : undefined) ??
      "";
    const demoName = this.#demo && key === "name";
    const help = !hasHint(key) ? this.#help(key) : demoName ? this.#help("name") : nothing;
    const code = CODE_FIELDS.has(key);
    return html`<wt-input
      @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=next]"))}
      class="field"
      label=${label}
      name=${INPUT_NAME[key] ?? key}
      autocomplete=${FIELD_AUTOCOMPLETE[key]}
      autocapitalize=${code ? "none" : nothing}
      autocorrect=${code ? "off" : nothing}
      spellcheck=${code ? "false" : nothing}
      data-test=${key}
      type=${type}
      hint=${hasHint(key) && !demoName ? t(FIELD_HINT[key]) : ""}
      ?invalid=${error !== ""}
      ?required=${key !== "addressLine2" && key !== "registeredLine2" && key !== "registeredProvince"}
      error=${error}
      .value=${this.values[key]}
      @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(key, e)}
      >${help}</wt-input
    >`;
  }

  #registeredAddress(pack: CountryPack | undefined): TemplateResult {
    const errors = this.#errors;
    const hint = this.sameAsVenue ? t("venue.hint.registered_same") : "";
    const province =
      pack === undefined ? undefined : findAdministrativeArea(pack, this.values.registeredProvince);
    return html`<fieldset class="registered" data-test="registered-address">
      <legend>${t("venue.label.taxpayer_domicile")}</legend>
      ${this.#addressSearch("domicile", pack)}
      <wt-switch
        class=${this.sameAsVenue ? "field with-hint" : "field"}
        data-test="registeredSameAsVenue"
        name="registeredSameAsVenue"
        label=${t("venue.label.registered_same")}
        description=${hint}
        .checked=${this.sameAsVenue}
        @wt-change=${(event: CustomEvent<{ checked: boolean }>) => this.#onSameAsVenue(event)}
      ></wt-switch>
      ${
        this.sameAsVenue
          ? html`<p class="switch-hint" aria-hidden="true" data-test="registered-same-hint">
              ${hint}
            </p>`
          : nothing
      }
      ${
        this.sameAsVenue
          ? nothing
          : html`${this.#field(t("venue.label.address_line1"), "registeredStreet")}
              ${this.#field(t("venue.label.address_line2"), "registeredLine2")}
              <div class="pair">
                ${this.#field(t("venue.label.postal_code"), "registeredPostalCode")}
                ${this.#field(t("venue.label.city"), "registeredCity")}
              </div>
              ${
                pack !== undefined && pack.administrativeAreas.length > 0
                  ? html`<wt-combobox
                      class="field"
                      label=${t("venue.label.registered_province")}
                      name="registeredProvince"
                      search="auto"
                      placeholder=${t("venue.select_province")}
                      searchPlaceholder=${t("venue.combobox_search")}
                      noResultsLabel=${t("venue.combobox_no_results")}
                      data-test="registeredProvince"
                      ?invalid=${errors.has("registeredProvince")}
                      error=${errors.get("registeredProvince") ?? ""}
                      .options=${pack.administrativeAreas.map((candidate) => ({
                        value: candidate.code,
                        label: candidate.name,
                      }))}
                      .value=${province?.code ?? ""}
                      @wt-change=${(event: CustomEvent<{ value: string }>) => this.#onRegisteredProvince(event)}
                    ></wt-combobox>`
                  : this.#field(t("venue.label.registered_province"), "registeredProvince")
              }`
      }
    </fieldset>`;
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
    const fieldErrors = new Set([...errors.keys()].filter((key) => this.#showsAsField(key)));
    const invalid =
      this.#feedback.attempted && [...this.#invalidFields()].some((key) => this.#shows(key));
    const bottom = this.#feedback.message(
      {
        request: this.#feedback.shows("request") ? this.errorMessage : undefined,
        ...Object.fromEntries(errors),
      },
      fieldErrors,
      t("venue.fix_fields"),
    );
    return html`
      <h1>${t("venue.heading")}</h1>
      <p class="intro">${this.#demo ? t("venue.intro_demo") : t("venue.intro")}</p>

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
      ${this.#demo ? nothing : html`${this.#field(pack?.taxIdentifier?.label ?? t("venue.label.tax_id"), "taxId")}${this.#field(t("venue.label.legal_name"), "legalName")}${this.#registeredAddress(pack)}`}
      ${this.#demo ? nothing : html`<h2>${t("venue.section.venue")}</h2>`}
      ${this.#field(t("venue.label.venue_name"), "name")}
      <wt-combobox
        class="field"
        label=${t("venue.label.staff_language")}
        name="staffLanguage"
        required
        data-test="staffLanguage"
        .value=${this.#workingLanguage()}
        ?invalid=${errors.has("staffLanguage")}
        error=${errors.get("staffLanguage") ?? ""}
        .options=${[
          { value: "en", label: t("venue.staff_language.en") },
          { value: "es", label: t("venue.staff_language.es") },
        ].sort((a, b) => a.label.localeCompare(b.label, currentLocale()))}
        @wt-change=${this.#onWorkingLanguage}
        ><wt-help-tooltip
          slot="help"
          aria-label=${format("venue.help_with_field", { field: t("venue.field.staff_language") })}
          >${t("venue.staff_language.help")}</wt-help-tooltip
        ></wt-combobox
      >
      ${this.#addressSearch("address", pack)}
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
            </fieldset> `
      }
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
