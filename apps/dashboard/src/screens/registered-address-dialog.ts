import { css, html, type TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import "@waitron/ui/src/components/wt-combobox.js";
import { findAdministrativeArea, findAdministrativeAreaByPostalCode } from "@waitron/country";
import {
  getCountryPack,
  joinRegisteredAddress,
  registeredAddressErrors,
  registeredAddressParts,
  type RegisteredAddressError,
  type RegisteredAddressParts,
} from "@waitron/country-packs";
import { t } from "../i18n/t.js";
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
  label: "venue_details.taxpayer_domicile",
  addressSearch: true,
  note: "venue_details.taxpayer_domicile_note",
  changedElsewhere: "venue_details.taxpayer_domicile_changed",
  notSaved: "venue_details.taxpayer_domicile_not_saved",
  refusals: {
    unchanged: "venue_details.taxpayer_domicile_unchanged",
    incomplete: "venue_details.taxpayer_domicile_incomplete",
    postal_code: "venue_details.taxpayer_domicile_postal_code",
  },
  send: (api, taxpayerDomicile, expected) =>
    api.changeTaxpayerDomicile({ taxpayerDomicile, expected }),
};

type Part = keyof RegisteredAddressParts;

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

/** Changes the registered address that full invoices issued from now on print. It is asked for in
 *  parts and stored as the one line they join into. */
@customElement("dashboard-registered-address-dialog")
export class RegisteredAddressDialog extends TaxpayerFieldDialog<RegisteredAddressParts> {
  protected readonly settings = SETTINGS;

  static override styles = [
    ...TaxpayerFieldDialog.styles,
    css`
      .fields {
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
    `,
  ];

  #pack() {
    return getCountryPack(this.countryCode);
  }

  protected override draftFor(stored: string): RegisteredAddressParts {
    const pack = this.#pack();
    const line = stored.trim();
    return pack === undefined
      ? { street: line, line2: "", postalCode: "", city: "", province: "" }
      : registeredAddressParts(line, pack);
  }

  /** Joined with the pack's own postcode spelling and province name, as the server's split
   *  recognises only those. */
  protected override valueFor(parts: RegisteredAddressParts): string {
    const pack = this.#pack();
    const postal = pack?.postalCode?.validate(parts.postalCode.trim());
    const province = parts.province.trim();
    return joinRegisteredAddress({
      ...parts,
      postalCode: postal?.valid === true ? postal.normalized : parts.postalCode,
      province: (pack && findAdministrativeArea(pack, province)?.name) ?? province,
    });
  }

  protected override fieldErrors(parts: RegisteredAddressParts): Record<string, string> {
    const pack = this.#pack();
    const found =
      pack === undefined
        ? Object.fromEntries(
            [...REQUIRED]
              .filter((part) => parts[part].trim() === "")
              .map((part) => [part, "required" as const]),
          )
        : registeredAddressErrors(parts, pack);
    const errors: Record<string, string> = {};
    for (const part of PARTS) {
      const error = found[part];
      if (error !== undefined)
        errors[NAMES[part]] = t(MESSAGES[error][part] ?? "venue_details.required");
    }
    // Last, so a part already marked is not marked again: the server splits the line it is sent
    // and checks the split, and parts that pass can join into a line that splits otherwise, as
    // when the city holds a comma.
    if (Object.keys(errors).length === 0 && pack?.postalCode !== undefined) {
      const readBack = registeredAddressErrors(
        registeredAddressParts(this.valueFor(parts), pack),
        pack,
      );
      if (Object.keys(readBack).length > 0)
        errors[NAMES.city] = t("venue_details.registered_city_comma");
    }
    return errors;
  }

  /** Only a line whose parts pass is sent, so a refusal other than the postcode's cannot say
   *  which part is wrong and is shown under Street. */
  protected override refusedFields(reason: string): string[] {
    return [reason === "postal_code" ? NAMES.postalCode : NAMES.street];
  }

  #changePart(view: TaxpayerFieldsView<RegisteredAddressParts>, part: Part, value: string): void {
    const next = { ...view.draft, [part]: value };
    if (part === "postalCode") {
      const pack = this.#pack();
      const postal = pack?.postalCode?.validate(value);
      const area =
        pack !== undefined && postal?.valid === true
          ? findAdministrativeAreaByPostalCode(pack, postal.normalized)
          : undefined;
      if (area !== undefined) next.province = area.name;
    }
    view.change(next);
  }

  #field(view: TaxpayerFieldsView<RegisteredAddressParts>, part: Part): TemplateResult {
    const name = NAMES[part];
    const change = (event: CustomEvent<{ value: string }>) => {
      event.stopPropagation();
      this.#changePart(view, part, event.detail.value);
    };
    const pack = this.#pack();
    if (part === "province" && pack !== undefined && pack.administrativeAreas.length > 0) {
      const province = view.draft.province.trim();
      return html`<wt-combobox
        name=${name}
        label=${t(LABELS[part])}
        search="auto"
        .value=${findAdministrativeArea(pack, province)?.name ?? province}
        .options=${pack.administrativeAreas.map((area) => ({ value: area.name, label: area.name }))}
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
    view: TaxpayerFieldsView<RegisteredAddressParts>,
  ): TemplateResult {
    return html`<div class="fields">
      ${this.#field(view, "street")} ${this.#field(view, "line2")}
      <div class="pair">${this.#field(view, "postalCode")} ${this.#field(view, "city")}</div>
      ${this.#field(view, "province")}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-registered-address-dialog": RegisteredAddressDialog;
  }
}
