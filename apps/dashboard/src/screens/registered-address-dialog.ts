import { css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AddressChosenDetail, AddressLookupProvider, WtAddressLookup } from "@waitron/ui";
import "@waitron/ui/src/components/wt-address-lookup.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import {
  areaOfChosenAddress,
  canonicalRegisteredParts,
  getCountryPack,
  joinRegisteredAddress,
  provinceOfPostalCode,
  registeredAddressErrors,
  registeredAddressParts,
  registeredLineErrors,
  type RegisteredAddressError,
  type RegisteredAddressParts,
} from "@waitron/country-packs";
import type { VenueDetailValues } from "../api/client.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import {
  TaxpayerFieldDialog,
  type TaxpayerFieldSettings,
  type TaxpayerFieldsView,
} from "./taxpayer-field-dialog.js";

const SETTINGS: TaxpayerFieldSettings = {
  field: "taxpayerDomicile",
  dataTest: "taxpayer-domicile",
  heading: "venue_details.change_taxpayer_domicile",
  note: "venue_details.taxpayer_domicile_note",
  changedElsewhere: "venue_details.taxpayer_domicile_changed",
  notSaved: "venue_details.taxpayer_domicile_not_saved",
  refusals: {
    unchanged: "venue_details.taxpayer_domicile_unchanged",
    incomplete: "venue_details.taxpayer_domicile_incomplete",
    postcode: "venue_details.taxpayer_domicile_postcode",
  },
  send: (api, taxpayerDomicile, expected) =>
    api.changeTaxpayerDomicile({ taxpayerDomicile, expected }),
};

type Part = keyof RegisteredAddressParts;

/** The parts, and whether the venue's own address is used instead of them. */
export type RegisteredAddressDraft = RegisteredAddressParts & { sameAsVenue: boolean };

const SAME_AS_VENUE = "registeredSameAsVenue";

/** Each part's field name, in the order they are drawn. */
const NAMES = {
  street: "registeredStreet",
  line2: "registeredLine2",
  postalCode: "registeredPostalCode",
  city: "registeredCity",
  province: "registeredProvince",
} as const satisfies Record<Part, string>;
const PARTS = Object.keys(NAMES) as Part[];

const LABELS: Record<Part, StringKey> = {
  street: "venue_details.addressLine1",
  line2: "venue_details.addressLine2",
  postalCode: "venue_details.postalCode",
  city: "venue_details.city",
  province: "venue_details.registered_province",
};

const AUTOCOMPLETE: Record<Part, string> = {
  street: "section-registered address-line1",
  line2: "section-registered address-line2",
  postalCode: "section-registered postal-code",
  city: "section-registered address-level2",
  province: "section-registered address-level1",
};

const REQUIRED: ReadonlySet<Part> = new Set(["street", "postalCode", "city"]);

const MESSAGES: Record<RegisteredAddressError, Partial<Record<Part, StringKey>>> = {
  required: {},
  invalid: { postalCode: "venue_details.registered_postal_code" },
  mismatch: { province: "venue_details.registered_province_mismatch" },
};

function requiredErrors(
  parts: RegisteredAddressParts,
): Partial<Record<Part, RegisteredAddressError>> {
  return Object.fromEntries(
    [...REQUIRED].filter((part) => parts[part].trim() === "").map((part) => [part, "required"]),
  );
}

/** Changes the registered address that full invoices issued from now on print. It is asked for in
 *  parts, or taken from the venue's own address, and stored as the one line they join into. */
@customElement("dashboard-registered-address-dialog")
export class RegisteredAddressDialog extends TaxpayerFieldDialog<RegisteredAddressDraft> {
  protected readonly settings = SETTINGS;
  protected override readonly unplacedErrors: ReadonlySet<string> = new Set([SAME_AS_VENUE]);

  @property({ attribute: false }) addressProvider?: AddressLookupProvider;
  /** The business's country: the search looks there, and an address elsewhere fills nothing. */
  @property({ attribute: false }) countryCode = "";
  /** The venue's own address. While the switch is on it is what Save sends, as it is then. */
  @property({ attribute: false }) venueAddress?: VenueDetailValues;

  @state() private foreignAddress = false;

  #provinces?: { countryCode: string; options: { value: string; label: string }[] };

  static override styles = [
    ...TaxpayerFieldDialog.styles,
    css`
      /* A steady width, so the window does not narrow when the switch hides the parts. */
      .fields {
        width: min(
          var(--wt-form-max-width),
          calc(var(--wt-dialog-max-width) - 2 * var(--wt-space-5))
        );
        max-width: 100%;
        display: grid;
        gap: var(--wt-space-3);
      }
      .pair {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
        gap: var(--wt-space-3);
      }
      .pair > * {
        min-width: 0;
      }
      @media (max-width: 48rem) {
        .pair {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      wt-address-lookup {
        margin-block-end: var(--wt-space-3);
      }
      .switch-hint {
        margin: calc(-1 * var(--wt-space-2)) 0 var(--wt-space-1);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];

  #pack() {
    return getCountryPack(this.countryCode);
  }

  #venueParts(): RegisteredAddressParts {
    const venue = this.venueAddress;
    return {
      street: venue?.addressLine1 ?? "",
      line2: venue?.addressLine2 ?? "",
      postalCode: venue?.postalCode ?? "",
      city: venue?.city ?? "",
      province: venue?.province ?? "",
    };
  }

  /** The switch opens on only when the saved line, split and joined again, is the venue's
   *  address joined the same way. */
  protected override draftFor(stored: string): RegisteredAddressDraft {
    const pack = this.#pack();
    const line = stored.trim();
    const parts =
      pack === undefined
        ? { street: line, line2: "", postalCode: "", city: "", province: "" }
        : registeredAddressParts(line, pack);
    return {
      ...parts,
      sameAsVenue:
        joinRegisteredAddress(parts, pack) === joinRegisteredAddress(this.#venueParts(), pack),
    };
  }

  protected override valueFor(draft: RegisteredAddressDraft): string {
    return joinRegisteredAddress(draft.sameAsVenue ? this.#venueParts() : draft, this.#pack());
  }

  /** The browser's check of the parts. The server splits the line it is sent and checks the
   *  split, and parts that pass can join into a line that splits otherwise, as when the city holds
   *  a comma; that is `unreadable`, checked only once the parts pass. */
  #partErrors(
    parts: RegisteredAddressParts,
    line: string,
  ): Partial<Record<Part, RegisteredAddressError>> | "unreadable" {
    const pack = this.#pack();
    const found = pack === undefined ? requiredErrors(parts) : registeredAddressErrors(parts, pack);
    if (Object.keys(found).length > 0) return found;
    return Object.keys(registeredLineErrors(line, pack)).length > 0 ? "unreadable" : {};
  }

  /** With the switch on no part is shown, so whatever is wrong with the venue's address is said
   *  once, at the bottom. */
  protected override fieldErrors(draft: RegisteredAddressDraft): Record<string, string> {
    if (draft.sameAsVenue) {
      const found = this.#partErrors(this.#venueParts(), this.valueFor(draft));
      return found === "unreadable" || Object.keys(found).length > 0
        ? { [SAME_AS_VENUE]: t("venue_details.registered_same_unusable") }
        : {};
    }
    const found = this.#partErrors(draft, this.valueFor(draft));
    if (found === "unreadable") return { [NAMES.city]: t("venue_details.registered_city_comma") };
    const errors: Record<string, string> = {};
    for (const part of PARTS) {
      const error = found[part];
      if (error !== undefined)
        errors[NAMES[part]] = t(MESSAGES[error][part] ?? "venue_details.required");
    }
    return errors;
  }

  /** Only a line whose parts pass is sent, so a refusal other than the postcode's cannot say
   *  which part is wrong and is shown under Street. */
  protected override refusalFor(
    reason: string,
    draft: RegisteredAddressDraft,
    message: string,
  ): Record<string, string> {
    if (draft.sameAsVenue)
      return {
        [SAME_AS_VENUE]:
          reason === "unchanged" ? message : t("venue_details.registered_same_unusable"),
      };
    return { [reason === "postcode" ? NAMES.postalCode : NAMES.street]: message };
  }

  protected override reset(): void {
    this.foreignAddress = false;
    this.#cancelAddressSearch();
  }

  protected override typed(): void {
    this.#cancelAddressSearch();
  }

  /** So an address still on its way cannot overwrite what the person typed or restored. */
  #cancelAddressSearch(): void {
    this.renderRoot.querySelector<WtAddressLookup>("wt-address-lookup")?.cancelSearch();
  }

  #addressChosen(event: CustomEvent<AddressChosenDetail>): void {
    event.stopPropagation();
    if (!this.editable) return;
    const address = event.detail.address;
    const pack = this.#pack();
    this.foreignAddress = pack === undefined || address.countryCode !== pack.countryCode;
    if (pack === undefined || this.foreignAddress) return;
    const area = areaOfChosenAddress(pack, address);
    const [street = "", ...later] = address.lines;
    const rest = later.filter((line) => line.trim() !== "");
    this.replaceDraft((draft) => ({
      ...draft,
      sameAsVenue: false,
      street,
      // A Line 2 typed (a floor, a unit) stays unless the address brings one.
      ...(rest.length > 0 ? { line2: rest.join(", ") } : {}),
      postalCode: address.postalCode,
      city: address.locality,
      ...(area === undefined ? {} : { province: area.name }),
    }));
  }

  #addressSearch(busy: boolean): TemplateResult {
    return html`<wt-address-lookup
      name="domicile-search"
      .provider=${this.addressProvider}
      country-code=${this.countryCode}
      label=${t("venue_details.address_lookup.label")}
      placeholder=${t("venue_details.address_lookup.placeholder")}
      no-results-label=${t("venue_details.address_lookup.no_results")}
      unavailable-label=${t("venue_details.address_lookup.unavailable")}
      .message=${
        this.foreignAddress
          ? fill("venue_details.address_lookup.other_country", {
              country: new Intl.DisplayNames([currentLocale()], { type: "region" }).of(
                this.countryCode,
              )!,
            })
          : ""
      }
      ?disabled=${busy}
      @wt-address-chosen=${(event: CustomEvent<AddressChosenDetail>) => this.#addressChosen(event)}
    ></wt-address-lookup>`;
  }

  #provinceOptions(): { value: string; label: string }[] {
    if (this.#provinces?.countryCode !== this.countryCode)
      this.#provinces = {
        countryCode: this.countryCode,
        options: (this.#pack()?.administrativeAreas ?? []).map((area) => ({
          value: area.name,
          label: area.name,
        })),
      };
    return this.#provinces.options;
  }

  #changePart(view: TaxpayerFieldsView<RegisteredAddressDraft>, part: Part, value: string): void {
    const next = { ...view.draft, [part]: value };
    if (part === "postalCode") {
      const area = provinceOfPostalCode(this.#pack(), value);
      if (area !== undefined) next.province = area.name;
    }
    view.change(next);
  }

  #field(view: TaxpayerFieldsView<RegisteredAddressDraft>, part: Part): TemplateResult {
    const name = NAMES[part];
    const change = (event: CustomEvent<{ value: string }>) => {
      event.stopPropagation();
      this.#changePart(view, part, event.detail.value);
    };
    const pack = this.#pack();
    if (part === "province" && pack !== undefined && pack.administrativeAreas.length > 0) {
      return html`<wt-combobox
        name=${name}
        label=${t(LABELS[part])}
        search="auto"
        .value=${canonicalRegisteredParts(view.draft, pack).province.trim()}
        .options=${this.#provinceOptions()}
        .error=${view.errors[name] ?? ""}
        ?disabled=${view.busy}
        @wt-change=${change}
      ></wt-combobox>`;
    }
    return html`<wt-input
      name=${name}
      autocomplete=${AUTOCOMPLETE[part]}
      label=${t(LABELS[part])}
      ?required=${REQUIRED.has(part)}
      .value=${view.draft[part]}
      .error=${view.errors[name] ?? ""}
      ?disabled=${view.busy}
      @keydown=${view.submitOnEnter}
      @wt-change=${change}
    ></wt-input>`;
  }

  protected override renderFields(
    view: TaxpayerFieldsView<RegisteredAddressDraft>,
  ): TemplateResult {
    const hint = t("venue_details.registered_same_hint");
    return html`${this.#addressSearch(view.busy)}
      <div class="fields">
        <wt-switch
          name=${SAME_AS_VENUE}
          label=${t("venue_details.registered_same")}
          description=${hint}
          .checked=${view.draft.sameAsVenue}
          ?disabled=${view.busy}
          @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
            event.stopPropagation();
            view.change({ ...view.draft, sameAsVenue: event.detail.checked });
          }}
        ></wt-switch>
        <p class="switch-hint" aria-hidden="true" data-test="registered-same-hint">${hint}</p>
        ${
          view.draft.sameAsVenue
            ? nothing
            : html`${this.#field(view, "street")} ${this.#field(view, "line2")}
                <div class="pair">
                  ${this.#field(view, "postalCode")} ${this.#field(view, "city")}
                </div>
                ${this.#field(view, "province")}`
        }
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-registered-address-dialog": RegisteredAddressDialog;
  }
}
