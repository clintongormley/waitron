import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-input.js";
import { selectStyles } from "../select-styles.js";
import { actionsStyles, errorStyles, fieldStyles } from "../form-styles.js";
import type { DeepPartial } from "../setup-app.js";
import type { LocationDraft, ProvisionBody } from "../api/client.js";

/**
 * The wizard's field-heavy step: the tenant (country, tax id, legal name), its location (name, fiscal
 * territory, invoice languages, address, time zone, day cutover…) and the two invoice series codes —
 * one logical "your shop" form. Every field name matches the server's `parseVenue` / `VenueRequest`
 * exactly (`apps/server/src/setup-api.ts`, `packages/provisioning/src/venue-plan.ts`), so the emitted
 * patch slots straight into `venue` / `venue.location`.
 *
 * On `Next` it client-validates (every field except `addressLine2` non-empty; `seriesCode` differs
 * from `rectificativeSeriesCode`; one or two invoice languages) — a failure shows a `role="alert"`
 * banner and marks the offending fields `invalid`, and nothing is emitted. On success it emits the
 * `venue` slice as a `setup-patch`, then computes its OWN next target: a live ES-common venue still
 * needs the AEAT certificate (`cert`), everything else goes straight to `review`. `Back` returns to
 * `admin`. Both nav events are the composed/bubbling pair the shell listens for.
 *
 * The form seeds its local state from the shell's `draft` ONCE on mount, so stepping Back then forward
 * is non-destructive on all fifteen fields. Following `apps/setup/src/screens/admin-screen.ts` for the
 * field/`wt-change`/banner idiom, and `apps/dashboard`'s native-`<select>` (`select-styles.ts`) idiom
 * for the two dropdowns (there is no `wt-select` primitive).
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

/** The invoice-language options offered as a checkbox group; one or two may be picked. */
const INVOICE_LOCALES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "es-ES", label: "Spanish (España)" },
  { value: "ca-ES", label: "Catalan (Català)" },
  { value: "gl-ES", label: "Galician (Galego)" },
  { value: "eu-ES", label: "Basque (Euskara)" },
  { value: "en-GB", label: "English" },
];

/** The IANA time zones a Spanish venue picks between (mainland vs the Canary Islands). */
const TIME_ZONES: readonly string[] = ["Europe/Madrid", "Atlantic/Canary"];

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

  /** A server-side venue-validation error the shell routed back here (a `planVenue` refusal, e.g.
   * `provisioning.territory_country_mismatch`), shown as a banner so the operator can correct the
   * offending detail and re-submit. `undefined` normally. */
  @property() errorMessage?: string;

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

  @state() private fiscalTerritory: LocationDraft["fiscalTerritory"] = "ES-common";
  @state() private timeZone = "Europe/Madrid";
  @state() private invoiceLocales: string[] = ["es-ES"];

  /** The fields a `Next` rejected — drives each field's `invalid` reflection. */
  @state() private invalid = new Set<TextField | "invoiceLocales">();

  /** True once a `Next` was rejected — drives the `role="alert"` banner. */
  @state() private showError = false;

  /** Guards {@link SetupVenueScreen.#seedFromDraft} to run only on the first update. */
  #seeded = false;

  override willUpdate(): void {
    if (this.#seeded) return;
    this.#seeded = true;
    this.#seedFromDraft();
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
    this.fiscalTerritory = loc.fiscalTerritory ?? this.fiscalTerritory;
    this.timeZone = loc.timeZone ?? this.timeZone;
    this.invoiceLocales = loc.invoiceLocales ?? this.invoiceLocales;
  }

  #onField(key: TextField, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.values = { ...this.values, [key]: event.detail.value };
  }

  #onFiscalTerritory(event: Event): void {
    event.stopPropagation();
    this.fiscalTerritory = (event.target as HTMLSelectElement)
      .value as LocationDraft["fiscalTerritory"];
  }

  #onTimeZone(event: Event): void {
    event.stopPropagation();
    this.timeZone = (event.target as HTMLSelectElement).value;
  }

  /** A locale checkbox toggled: add it to (or drop it from) the selected set, preserving the order. */
  #onLocaleToggle(locale: string, event: Event): void {
    event.stopPropagation();
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
    // ES-common is the only fiscal territory today, and the server requires its country to be ES —
    // `planVenue` refuses a mismatch with `provisioning.territory_country_mismatch`, case-insensitive
    // on the prefix (`packages/provisioning/src/venue-plan.ts`). `country` is free text here, so this
    // is the one such refusal an operator can actually reach; block it client-side (the shell also
    // routes the server code back here as a safety net).
    if (this.fiscalTerritory === "ES-common" && this.values.country.trim().toUpperCase() !== "ES") {
      invalid.add("country");
    }
    if (this.invoiceLocales.length < 1 || this.invoiceLocales.length > 2) {
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

    const addressLine2 = this.values.addressLine2.trim() === "" ? null : this.values.addressLine2;
    const patch: DeepPartial<ProvisionBody> = {
      venue: {
        // Trimmed to match what the client validation checked: the server's territory-prefix match is
        // space-sensitive (`packages/provisioning/src/venue-plan.ts`), so a padded "ES " that passed
        // the trimmed check here must reach the server trimmed too, or it would be rejected there.
        country: this.values.country.trim(),
        taxId: this.values.taxId,
        legalName: this.values.legalName,
        location: {
          name: this.values.name,
          fiscalTerritory: this.fiscalTerritory,
          invoiceLocales: this.invoiceLocales,
          operationDescription: this.values.operationDescription,
          addressLine1: this.values.addressLine1,
          addressLine2,
          postalCode: this.values.postalCode,
          city: this.values.city,
          province: this.values.province,
          timeZone: this.timeZone,
          dayCutover: this.values.dayCutover,
        },
        tillName: this.values.tillName,
        seriesCode: this.values.seriesCode,
        rectificativeSeriesCode: this.values.rectificativeSeriesCode,
      },
    };
    this.dispatchEvent(
      new CustomEvent("setup-patch", { detail: { patch }, bubbles: true, composed: true }),
    );

    // Compute this screen's own next target: a live ES-common venue still needs the AEAT certificate.
    const screen =
      this.draft.mode === "live" && this.fiscalTerritory === "ES-common" ? "cert" : "review";
    this.dispatchEvent(
      new CustomEvent("setup-goto", { detail: { screen }, bubbles: true, composed: true }),
    );
  }

  #back(): void {
    this.dispatchEvent(
      new CustomEvent("setup-goto", { detail: { screen: "admin" }, bubbles: true, composed: true }),
    );
  }

  /** Renders one text field as a `wt-input`, bound to `this.values[key]` and its `invalid` state. */
  #field(label: string, key: TextField, type = "text"): TemplateResult {
    return html`<wt-input
      class="field"
      label=${label}
      data-test=${key}
      type=${type}
      ?invalid=${this.invalid.has(key)}
      .value=${this.values[key]}
      @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(key, e)}
    ></wt-input>`;
  }

  override render(): TemplateResult {
    return html`
      <wt-card>
        <h1>Your shop</h1>
        <p>The business, its location and its invoice series. You can change these later.</p>

        <h2>Business</h2>
        ${this.#field("Country", "country")} ${this.#field("Tax ID (NIF)", "taxId")}
        ${this.#field("Legal name", "legalName")}

        <h2>Location</h2>
        ${this.#field("Location name", "name")}
        <label class="field select">
          <span>Fiscal territory</span>
          <select data-test="fiscalTerritory" @change=${(e: Event) => this.#onFiscalTerritory(e)}>
            <option value="ES-common" .selected=${this.fiscalTerritory === "ES-common"}>
              Spain — common territory
            </option>
          </select>
        </label>
        <fieldset class="locales" ?invalid=${this.invalid.has("invoiceLocales")}>
          <legend>Invoice languages (pick one or two)</legend>
          ${INVOICE_LOCALES.map(
            (locale) =>
              html`<label class="locale-option">
                <input
                  type="checkbox"
                  data-test=${`locale-${locale.value}`}
                  .checked=${this.invoiceLocales.includes(locale.value)}
                  @change=${(e: Event) => this.#onLocaleToggle(locale.value, e)}
                />
                ${locale.label}
              </label>`,
          )}
        </fieldset>
        ${this.#field("What this location does", "operationDescription")}
        ${this.#field("Address line 1", "addressLine1")}
        ${this.#field("Address line 2 (optional)", "addressLine2")}
        ${this.#field("Postal code", "postalCode")} ${this.#field("City", "city")}
        ${this.#field("Province", "province")}
        <label class="field select">
          <span>Time zone</span>
          <select data-test="timeZone" @change=${(e: Event) => this.#onTimeZone(e)}>
            ${TIME_ZONES.map(
              (tz) => html`<option value=${tz} .selected=${tz === this.timeZone}>${tz}</option>`,
            )}
          </select>
        </label>
        ${this.#field("Business day cutover", "dayCutover", "time")}

        <h2>Invoicing</h2>
        ${this.#field("Till name", "tillName")} ${this.#field("Invoice series code", "seriesCode")}
        ${this.#field("Rectificative series code", "rectificativeSeriesCode")}
        ${
          this.errorMessage === undefined
            ? nothing
            : html`<p class="error" role="alert" data-test="server-error">${this.errorMessage}</p>`
        }
        ${
          this.showError
            ? html`<p class="error" role="alert" data-test="error">
                Check the highlighted fields: fill every required field, use ES as the country for
                the Spanish common territory, pick one or two invoice languages, and use a different
                code for the rectificative series.
              </p>`
            : nothing
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
