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
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-input.js";
import { actionsStyles, errorStyles, fieldStyles } from "../form-styles.js";
import { dispatchSetupAdvance, dispatchSetupGoto, dispatchSetupPatch } from "../events.js";
import type { DeepPartial } from "../setup-app.js";
import type { ProvisionBody } from "../api/client.js";
import { SERVER_FIELDS, type ServerField } from "../server-fields.js";

/**
 * The wizard's field-heavy step: the tenant (country, tax id, legal name), its location (name,
 * invoice languages, address and day cutover…) and the two invoice series codes —
 * one logical "your shop" form. Every field name matches the server's `parseVenue` / `VenueRequest`
 * exactly (`apps/server/src/setup-api.ts`, `packages/provisioning/src/venue-plan.ts`), so the emitted
 * patch slots straight into `venue` / `venue.location`.
 *
 * On `Next` it validates required fields, the tax identifier and postcode, postcode/province
 * agreement, supported fiscal jurisdiction, distinct series codes, and one or two invoice languages.
 * A failure shows a SINGLE `role="alert"` banner and marks the offending fields `invalid`, and nothing
 * is emitted. On success it
 * emits the `venue` slice as a `setup-patch`, then a screen-agnostic `setup-advance` for the SHELL to
 * route: the venue→`cert`/`review` decision (live ES-common needs the AEAT cert; demo goes
 * straight to `review`) lives in `apps/setup/src/setup-app.ts`, which owns the merged draft — this
 * screen no longer reads `mode` for routing. `Back` returns to `admin` (a fixed `setup-goto`). All nav
 * events are composed/bubbling, the pair the shell listens for.
 *
 * The form seeds its local state from the shell's `draft` ONCE on mount, so stepping Back then forward
 * is non-destructive across all editable fields. Following `apps/setup/src/screens/admin-screen.ts`
 * for the field/`wt-change`/banner idiom, and `@waitron/ui`'s shared native-`<select>`
 * (`selectStyles`) idiom for the native dropdowns (there is no `wt-select` primitive).
 */

/** The text fields, each a `wt-input`. Everything here is required except `addressLine2`. */
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

/** Everything a complete venue must carry — `addressLine2` alone may be blank (it becomes `null`). */
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

const LOCALE_LABELS: Readonly<Record<string, string>> = {
  "es-ES": "Spanish (España)",
  "ca-ES": "Catalan (Català)",
  "gl-ES": "Galician (Galego)",
  "eu-ES": "Basque (Euskara)",
  "en-GB": "English",
};

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

  /** The accumulated draft, passed down from the shell. Read ONCE on mount to seed the local fields. */
  @property({ attribute: false }) draft: DeepPartial<ProvisionBody> = {};

  /** A server-side venue-validation error the shell routed back here, shown as a banner so the
   * operator can correct the offending detail and re-submit. `undefined` normally. */
  @property() errorMessage?: string;

  /**
   * One venue field the SERVER refused, named by `setup.request_invalid`'s `params.field` and routed
   * back here by the shell. Marked invalid on arrival, with a sentence beside it, so an operator
   * returning from a refused provision lands on the form with the offending field already flagged.
   */
  @property() invalidField?: string;

  /** The editable text fields. Defaults match the shell's seeded draft; seeding overlays what it holds. */
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
    dayCutover: "",
    tillName: "",
    seriesCode: "",
    rectificativeSeriesCode: "",
  };

  @state() private invoiceLocales: string[] = ["es-ES"];

  /** The fields a `Next` rejected — drives each field's `invalid` reflection. */
  @state() private invalid = new Set<TextField | "invoiceLocales">();

  /** True once a `Next` was rejected — drives the `role="alert"` banner. */
  @state() private showError = false;

  /**
   * {@link SetupVenueScreen.invalidField} resolved to this form's own field key, held SEPARATELY
   * from {@link SetupVenueScreen.invalid} and cleared the moment the operator edits that field
   * ({@link SetupVenueScreen.#onField}). It is separate because `#next` rebuilds `invalid` from
   * scratch on every press and returns early while that set is non-empty: a mark for a rule this
   * form cannot evaluate, folded into that set, would survive every rebuild and block Next forever.
   *
   * The intersection with `{ key: TextField }` is not decoration: assigning `SERVER_FIELDS[…]` to it
   * is what makes the compiler check that every key the shared map names is a real field on this
   * form. Proven by mutation — adding a key to `ServerFieldKey` that this screen has no field for
   * fails typecheck with "Type 'ServerFieldKey' is not assignable to type 'TextField'".
   */
  @state() private serverInvalid?: ServerField & { readonly key: TextField };

  /** Guards {@link SetupVenueScreen.#seedFromDraft} to run only on the first update. */
  #seeded = false;
  /** True until the operator changes the invoice-language selection themselves. */
  #invoiceLocalesFollowAreaDefault = true;

  override willUpdate(changed: PropertyValues<this>): void {
    if (!this.#seeded) {
      this.#seeded = true;
      this.#seedFromDraft();
    }
    // Only when the shell hands down a NEW value: re-deriving on every update would put back a mark
    // the operator has already cleared by editing the field.
    if (changed.has("invalidField")) {
      this.serverInvalid =
        this.invalidField === undefined ? undefined : SERVER_FIELDS[this.invalidField];
    }
  }

  /**
   * Move the keyboard focus to the field the server refused, once, when the shell hands it down. The
   * form is roughly sixteen controls long and both series codes sit at the bottom of it, so without
   * this the operator is dropped on a freshly-mounted form scrolled to the top with the marked field
   * off-screen and nothing said about it — and a screen reader announces nothing at all, because no
   * focus moves and this screen deliberately renders no banner for a marked field. `wt-input`
   * delegates focus, so this lands on the native input and the browser scrolls it into view.
   */
  override updated(changed: PropertyValues<this>): void {
    if (!changed.has("invalidField") || this.serverInvalid === undefined) return;
    const field = this.shadowRoot!.querySelector<
      HTMLElement & { updateComplete?: Promise<unknown> }
    >(`[data-test=${this.serverInvalid.key}]`);
    if (field === null) return;
    // Awaiting the `wt-input`'s OWN first render, not just this screen's: a Lit child renders in a
    // later microtask, so at this point the host exists but the native input focus is delegated to
    // does not, and focusing the host would do nothing at all (measured — the first version of this
    // left `shadowRoot.activeElement` null).
    void Promise.resolve(field.updateComplete).then(() => field.focus());
  }

  /**
   * Overlay whatever the shell's draft already holds onto the local field state, so Back-then-forward
   * restores every value the operator entered. `??` keeps the local default when a field is absent (or,
   * for `addressLine2`, `null`); an array/select value is taken whole.
   */
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
    this.invoiceLocales = loc.invoiceLocales ?? this.invoiceLocales;
    if (loc.invoiceLocales !== undefined) {
      const pack = getVenueSetupCountryPack(venue.country ?? this.values.country);
      const area =
        pack === undefined || loc.province === undefined
          ? undefined
          : findAdministrativeArea(pack, loc.province);
      this.#invoiceLocalesFollowAreaDefault =
        pack !== undefined &&
        loc.invoiceLocales.length === 1 &&
        loc.invoiceLocales[0] === (area?.defaultLocale ?? pack.defaultLocale);
    }
  }

  #onField(key: TextField, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    // Editing the field the server refused retires that mark: the new value has not been refused.
    if (this.serverInvalid?.key === key) this.serverInvalid = undefined;
    const value = event.detail.value;
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
        this.invoiceLocales = [area.defaultLocale ?? pack.defaultLocale];
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
      this.invoiceLocales = [pack.defaultLocale];
      this.#invoiceLocalesFollowAreaDefault = true;
    }
  }

  #onProvince(event: Event): void {
    event.stopPropagation();
    const pack = this.#pack();
    if (pack === undefined) return;
    const area = findAdministrativeArea(pack, (event.target as HTMLSelectElement).value);
    if (area === undefined) return;
    this.values = { ...this.values, province: area.name };
    if (this.#invoiceLocalesFollowAreaDefault) {
      this.invoiceLocales = [area.defaultLocale ?? pack.defaultLocale];
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

  /** A locale checkbox toggled: add it to (or drop it from) the selected set, preserving the order. */
  #onLocaleToggle(locale: string, event: Event): void {
    event.stopPropagation();
    this.#invoiceLocalesFollowAreaDefault = false;
    const checked = (event.target as HTMLInputElement).checked;
    this.invoiceLocales = checked
      ? [...this.invoiceLocales, locale]
      : this.invoiceLocales.filter((l) => l !== locale);
  }

  /**
   * Validate, then emit. A required blank, a duplicate series code, or a locale count outside 1–2
   * blocks the emit, shows the banner, and marks the offending fields. The series-equality guard is
   * proven by deletion: drop the equality block and the "same series code blocks Next" test flips red.
   */
  #next(): void {
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
      return;
    }
    this.showError = false;

    // All conditions which could leave these values absent added an invalid field and returned above.
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

    // A screen-agnostic advance: the shell owns the venue→cert/review decision (it holds the merged
    // draft, so it — not this screen — knows `mode` and the location's fiscal territory). Mirrors
    // `apps/dashboard/src/dashboard-app.ts`, where the shell owns conditional routing.
    dispatchSetupAdvance(this);
  }

  #back(): void {
    dispatchSetupGoto(this, "admin");
  }

  /**
   * Renders one text field as a `wt-input`, bound to `this.values[key]` and its `invalid` state. A
   * field the SERVER refused is marked too, and carries its explanation in `wt-input`'s own `error`
   * slot — which renders the sentence beside the field and wires `aria-describedby` to it, the
   * shared form contract (`docs/developers/design-system.md` → Forms).
   */
  #field(label: string, key: TextField, type = "text"): TemplateResult {
    const refused = this.serverInvalid?.key === key ? this.serverInvalid : undefined;
    return html`<wt-input
      @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=next]"))}
      class="field"
      label=${label}
      data-test=${key}
      type=${type}
      ?invalid=${this.invalid.has(key) || refused !== undefined}
      error=${refused === undefined ? "" : refused.message}
      .value=${this.values[key]}
      @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(key, e)}
    ></wt-input>`;
  }

  override render(): TemplateResult {
    const pack = this.#pack();
    const area = this.#area(pack);
    const jurisdiction = this.#jurisdiction(pack, area);
    return html`
      <wt-card>
        <h1>Your shop</h1>
        <p>The business, its location and its invoice series. You can change these later.</p>

        <h2>Business</h2>
        <label class="field select">
          <span>Country</span>
          <select
            data-test="country"
            ?invalid=${this.invalid.has("country")}
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
        </label>
        ${this.#field(pack?.taxIdentifier?.label ?? "Tax ID", "taxId")}
        ${this.#field("Legal name", "legalName")}

        <h2>Location</h2>
        ${this.#field("Location name", "name")}
        <p data-test="fiscalTerritory">
          Fiscal territory: ${jurisdiction?.id ?? "Select province"}
        </p>
        <fieldset class="locales" ?invalid=${this.invalid.has("invoiceLocales")}>
          <legend>Invoice languages (pick one or two)</legend>
          ${(pack?.invoiceLocales ?? []).map(
            (locale) =>
              html`<label class="locale-option">
                <input
                  type="checkbox"
                  data-test=${`locale-${locale}`}
                  .checked=${this.invoiceLocales.includes(locale)}
                  @change=${(e: Event) => this.#onLocaleToggle(locale, e)}
                />
                ${LOCALE_LABELS[locale] ?? locale}
              </label>`,
          )}
        </fieldset>
        ${this.#field("What this location does", "operationDescription")}
        ${this.#field("Address line 1", "addressLine1")}
        ${this.#field("Address line 2 (optional)", "addressLine2")}
        ${this.#field("Postal code", "postalCode")} ${this.#field("City", "city")}
        ${
          pack !== undefined && pack.administrativeAreas.length > 0
            ? html`<label class="field select">
                <span>Province</span>
                <select
                  data-test="province"
                  ?invalid=${this.invalid.has("province")}
                  @change=${(event: Event) => this.#onProvince(event)}
                >
                  <option value="" .selected=${area === undefined}>Select province</option>
                  ${pack.administrativeAreas.map(
                    (candidate) =>
                      html`<option
                        value=${candidate.code}
                        .selected=${candidate.code === area?.code}
                      >
                        ${candidate.name}
                      </option>`,
                  )}
                </select>
              </label>`
            : this.#field("Province / region", "province")
        }
        <p data-test="timeZone">Time zone: ${area?.timeZone ?? pack?.defaultTimeZone ?? "—"}</p>
        ${this.#field("Business day cutover", "dayCutover", "time")}

        <h2>Invoicing</h2>
        ${this.#field("Till name", "tillName")} ${this.#field("Invoice series code", "seriesCode")}
        ${this.#field("Rectificative series code", "rectificativeSeriesCode")}
        ${
          // A SINGLE live alert region — two simultaneous `role="alert"` nodes double-announce to a
          // screen reader (a11y fix). The client-validation banner takes precedence: it names a
          // problem in what the operator just typed, so a stale server-routed message must not sit
          // beside it. The routed-back server banner shows only when there is NO client error.
          this.showError
            ? html`<p class="error" role="alert" data-test="error">
                Check the highlighted fields: use a valid tax ID and postal code, make sure the
                province matches, pick one or two invoice languages, and use different invoice
                series.
              </p>`
            : this.errorMessage === undefined
              ? nothing
              : html`<p class="error" role="alert" data-test="server-error">
                  ${this.errorMessage}
                </p>`
        }
        <div class="actions">
          <wt-button variant="ghost" data-test="back" @click=${() => this.#back()}>Back</wt-button>
          <wt-button variant="primary" data-test="next" @click=${() => this.#next()}
            >Next</wt-button
          >
        </div>
      </wt-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-venue-screen": SetupVenueScreen;
  }
}
