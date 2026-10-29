import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  focusFirstInvalid,
  submitOnEnter,
  draftScopeFor,
  saveActionState,
} from "@waitron/ui";
import type {
  AddressChosenDetail,
  AddressLookupProvider,
  WtAddressLookup,
  WtDialog,
  DraftScope,
  LeaveCoordinator,
  LeaveReason,
} from "@waitron/ui";
import {
  findAdministrativeArea,
  findAdministrativeAreaByPostalCode,
  type AdministrativeArea,
} from "@waitron/country";
import {
  countryNameFor,
  getCountryPack,
  RECIPIENT_COUNTRY_CODES,
  RECIPIENT_IDENTIFIER_POLICY,
  recipientIdentifierResult,
  recipientAddressErrors,
  composeRecipientAddress,
  type RecipientIdentifier,
  type RecipientIdentifierType,
} from "@waitron/country-packs";
import { isValidEmail } from "@waitron/shared";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-address-lookup.js";
import { trackDialog } from "./track-dialog.js";
import { currentLocale, t } from "../i18n/t.js";
import type { InvoiceDeliveryChoice, InvoiceDeliveryOptions } from "../api/client.js";

export interface InvoiceRecipientDetail {
  invoiceType: "F1";
  recipient: RecipientIdentifier & { legalName: string; address: string; countryCode: string };
  /** Absent when there is neither a choice to offer nor a saved one to send back. */
  delivery?: InvoiceDeliveryChoice;
}

/** `saved` sends {@link TillInvoiceRecipientDialog.savedDelivery} back as it is. */
type DeliveryMedium = "receipt" | "a4" | "email" | "saved";

interface RecipientDraft {
  countryCode: string;
  identifierType: RecipientIdentifierType;
  identifierCountryCode: string;
  taxId: string;
  legalName: string;
  streetAddress: string;
  postalCode: string;
  locality: string;
  province: string;
  medium: DeliveryMedium;
  email: string;
}

/** The fields a chosen address fills. */
const SEARCH_FILLS: ReadonlySet<string> = new Set([
  "streetAddress",
  "postalCode",
  "locality",
  "province",
]);

/** The server splits a Spanish address on commas (`completeSpanishPostalAddress`), so a name such
 * as "Balears, Illes" is written by its first comma-free name. */
function provinceName(area: AdministrativeArea): string {
  return [area.name, ...(area.aliases ?? [])].find((name) => !name.includes(",")) ?? area.name;
}

@customElement("till-invoice-recipient-dialog")
export class TillInvoiceRecipientDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .fields {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
      }
    `,
  ];

  @property({ attribute: false }) refusal = "";
  @property({ attribute: false }) refusalField = "";
  /** Null when the options could not be read, so whether a saved A4's printer is still the
   * invoice printer is unknown. */
  @property({ attribute: false }) deliveryOptions: InvoiceDeliveryOptions | null = {
    invoicePrinter: null,
    emailAvailable: false,
  };
  /** The delivery already staged for the order; kept unless the delivery field is changed. */
  @property({ attribute: false }) savedDelivery?: InvoiceDeliveryChoice;
  /** Address suggestions; without one the address search stays hidden. */
  @property({ attribute: false }) addressProvider?: AddressLookupProvider;
  @state() private attempted = false;
  @state() private countryCode = "ES";
  @state() private identifierType: RecipientIdentifierType = "tax-number";
  @state() private identifierCountryCode = "";
  @state() private taxId = "";
  @state() private legalName = "";
  @state() private streetAddress = "";
  @state() private postalCode = "";
  @state() private locality = "";
  @state() private province = "";
  @state() private medium: DeliveryMedium = "receipt";
  @state() private email = "";
  /** The chosen country a found address was not in, until another choice or country. */
  @state() private foreignAddressCountry?: string;
  #choiceShown = false;

  @state() private active = true;
  #scope?: DraftScope<RecipientDraft>;
  #leave?: LeaveCoordinator;
  #baseline?: RecipientDraft;
  #submitted?: RecipientDraft;
  #opening = {};
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  #value(): RecipientDraft {
    return {
      countryCode: this.countryCode,
      identifierType: this.identifierType,
      identifierCountryCode: this.identifierCountryCode,
      taxId: this.taxId,
      legalName: this.legalName,
      streetAddress: this.streetAddress,
      postalCode: this.postalCode,
      locality: this.locality,
      province: this.province,
      medium: this.medium,
      email: this.email,
    };
  }

  #printer() {
    return this.deliveryOptions?.invoicePrinter ?? null;
  }

  #emailAvailable() {
    return this.deliveryOptions?.emailAvailable === true;
  }

  /** A saved delivery listed as itself: an email while email is not offered, or an A4 while the
   * options are unknown. */
  #savedUnoffered(): InvoiceDeliveryChoice | undefined {
    const saved = this.savedDelivery;
    if (saved?.medium === "email" && !this.#emailAvailable()) return saved;
    if (saved?.medium === "a4" && this.deliveryOptions === null) return saved;
    return undefined;
  }

  /** The medium standing for the saved delivery in the draft's baseline. A saved A4 for a printer
   * the read says is no longer the invoice printer is `saved`, which nothing shown equals, so opening
   * on its replacement counts as a change. */
  #savedMedium(): DeliveryMedium {
    const saved = this.savedDelivery;
    if (saved === undefined || saved.medium === "receipt") return "receipt";
    if (saved.medium === "a4" && saved.pagePrinterId === this.#printer()?.id) return "a4";
    if (saved.medium === "email" && this.#emailAvailable()) return "email";
    return "saved";
  }

  #openingMedium(): DeliveryMedium {
    const medium = this.#savedMedium();
    if (medium === "saved" && this.#savedUnoffered() === undefined)
      return this.#printer() === null ? "receipt" : "a4";
    return medium;
  }

  #offered(): { value: DeliveryMedium; label: string }[] {
    const printer = this.#printer();
    const kept = this.#savedUnoffered();
    const savedOther = this.savedDelivery !== undefined && this.savedDelivery.medium !== "receipt";
    if (printer === null && !this.#emailAvailable() && !savedOther && !this.#choiceShown) return [];
    const offered: { value: DeliveryMedium; label: string }[] = [
      { value: "receipt", label: t("invoice.delivery_receipt") },
    ];
    if (printer !== null)
      offered.push({
        value: "a4",
        label: t("invoice.delivery_a4_on").replace("{printer}", () => printer.name),
      });
    if (this.#emailAvailable())
      offered.push({ value: "email", label: t("invoice.delivery_email") });
    if (kept !== undefined)
      offered.push({
        value: "saved",
        label: t(
          kept.medium === "a4" ? "invoice.delivery_saved_a4" : "invoice.delivery_saved_email",
        ),
      });
    return offered;
  }

  #delivery(): InvoiceDeliveryChoice | undefined {
    const printer = this.#printer();
    if (this.#offered().length === 0) return this.savedDelivery;
    if (this.medium === "saved") return this.#savedUnoffered();
    if (this.medium === "a4" && printer !== null)
      return { medium: "a4", pagePrinterId: printer.id };
    if (this.medium === "email") return { medium: "email", recipient: this.email };
    return { medium: "receipt" };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  writeCompletion(): () => boolean {
    const opening = this.#opening;
    const submitted = this.#submitted;
    const scope = this.#scope;
    return () => {
      if (!this.isConnected || !this.active || this.#opening !== opening) return false;
      if (submitted) {
        this.#baseline = { ...submitted };
        scope?.commit(submitted);
        if (scope?.isDirty()) return false;
      }
      this.active = false;
      scope?.dispose();
      this.#scope = undefined;
      this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.closeAfter("saved");
      return true;
    };
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (
      changed.has("deliveryOptions") &&
      this.#baseline !== undefined &&
      !this.#offered().some((option) => option.value === this.medium)
    ) {
      this.medium = this.#openingMedium();
      this.#scope?.changed();
    }
    if (!this.isConnected || !this.active || this.#scope) return;
    if (this.#baseline === undefined) {
      this.medium = this.#openingMedium();
      if (this.savedDelivery?.medium === "email") this.email = this.savedDelivery.recipient;
      this.#baseline = { ...this.#value(), medium: this.#savedMedium() };
    }
    const { coordinator, scope } = draftScopeFor<RecipientDraft>(this, {
      id: this,
      current: () => this.#value(),
      snapshot: (value) => ({ ...value }),
      equal: (a, b) =>
        Object.keys(a).every((key) => {
          const field = key as keyof RecipientDraft;
          if (field === "email" && a.medium !== "email" && b.medium !== "email") return true;
          if (
            field === "identifierCountryCode" &&
            a.identifierType === "tax-number" &&
            b.identifierType === "tax-number"
          )
            return true;
          const canonical = (draft: RecipientDraft) => {
            const value = draft[field];
            if (field !== "taxId") return value.trim();
            if (draft.identifierType !== "tax-number") return value;
            const result = recipientIdentifierResult({ taxId: value });
            return result.valid ? result.value.taxId : value.trim();
          };
          return canonical(a) === canonical(b);
        }),
      restore: (value) => Object.assign(this, value),
    });
    this.#leave = coordinator;
    this.#scope = scope;
    scope.commit(this.#baseline);
  }

  override disconnectedCallback(): void {
    this.#opening = {};
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  override async firstUpdated(): Promise<void> {
    await this.renderRoot.querySelector<WtDialog>("wt-dialog")!.updateComplete;
    this.renderRoot.querySelector<HTMLElement>("wt-input[name=taxId]")!.focus();
  }

  #identifierResult() {
    return recipientIdentifierResult({
      taxId: this.taxId,
      ...(this.identifierType === "tax-number"
        ? {}
        : {
            identifierType: this.identifierType,
            identifierCountryCode: this.identifierCountryCode,
          }),
    });
  }

  #errors() {
    const identity = this.#identifierResult();
    const address = recipientAddressErrors(this.#value());
    return {
      taxId:
        !identity.valid && identity.field === "taxId"
          ? t(
              this.taxId.trim() === ""
                ? "invoice.identifier_required"
                : this.identifierType === "tax-number"
                  ? "invoice.tax_id_invalid"
                  : "invoice.document_number_invalid",
            )
          : "",
      identifierType:
        !identity.valid && identity.field === "identifierType"
          ? t("invoice.document_type_invalid")
          : "",
      identifierCountryCode:
        !identity.valid && identity.field === "identifierCountryCode"
          ? t("invoice.document_country_required")
          : "",
      countryCode: address.countryCode ? t("invoice.country_required") : "",
      legalName: this.legalName.trim() === "" ? t("invoice.name_required") : "",
      streetAddress: address.streetAddress ? t("invoice.street_address_required") : "",
      postalCode: address.postalCode ? t("invoice.postal_code_invalid") : "",
      locality: address.locality ? t("invoice.locality_required") : "",
      province: address.province ? t("invoice.province_required") : "",
      email: this.medium !== "email" || isValidEmail(this.email) ? "" : t("invoice.email_invalid"),
    };
  }

  async #save(): Promise<void> {
    if (!this.isConnected || !this.active) return;
    if (saveActionState(this.#scope).unchanged) return;
    this.attempted = true;
    const errors = this.#errors();
    if (Object.values(errors).some(Boolean)) {
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    const taxId = this.#identifierResult();
    if (!taxId.valid) return;
    this.#submitted = this.#value();
    this.#cancelAddressSearch();
    const delivery = this.#delivery();
    this.dispatchEvent(
      new CustomEvent<InvoiceRecipientDetail>("invoice-recipient-confirm", {
        detail: {
          invoiceType: "F1",
          recipient: {
            ...taxId.value,
            legalName: this.legalName.trim(),
            address: composeRecipientAddress(this.#value()),
            countryCode: this.countryCode,
          },
          ...(delivery === undefined ? {} : { delivery }),
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #cancel(): void {
    if (!this.isConnected || !this.active) return;
    void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel");
  }

  #closed(event: Event): void {
    event.stopPropagation();
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.dispatchEvent(
      new CustomEvent("invoice-recipient-cancel", { bubbles: true, composed: true }),
    );
  }

  #change(
    field: Exclude<keyof RecipientDraft, "medium">,
    event: CustomEvent<{ value: string }>,
  ): void {
    event.stopPropagation();
    if (!this.isConnected || !this.active) return;
    if (field === "identifierType")
      this.identifierType = event.detail.value as RecipientIdentifierType;
    else this[field] = event.detail.value;
    if (SEARCH_FILLS.has(field)) this.#cancelAddressSearch();
    if (field === "countryCode") this.foreignAddressCountry = undefined;
    this.#scope?.changed();
    this.#edited(field === "streetAddress" ? "address" : field);
    if (field === "identifierType" && this.identifierType === "tax-number")
      this.#edited("identifierCountryCode");
  }

  /** So an address still on its way cannot overwrite what the person typed or saved. */
  #cancelAddressSearch(): void {
    this.shadowRoot!.querySelector<WtAddressLookup>("wt-address-lookup")?.cancelSearch();
  }

  #onAddressChosen(event: CustomEvent<AddressChosenDetail>): void {
    event.stopPropagation();
    if (!this.isConnected || !this.active) return;
    const address = event.detail.address;
    if (address.countryCode !== this.countryCode) {
      this.foreignAddressCountry = this.countryCode;
      return;
    }
    this.foreignAddressCountry = undefined;
    const pack = getCountryPack(this.countryCode);
    const postal = pack?.postalCode?.validate(address.postalCode);
    const area =
      pack === undefined
        ? undefined
        : ((address.administrativeAreaCode === undefined
            ? undefined
            : findAdministrativeArea(pack, address.administrativeAreaCode)) ??
          (postal?.valid === true
            ? findAdministrativeAreaByPostalCode(pack, postal.normalized)
            : undefined));
    this.streetAddress = address.lines.join(", ");
    this.postalCode = address.postalCode;
    this.locality = address.locality;
    this.province = area === undefined ? "" : provinceName(area);
    this.#scope?.changed();
    this.#edited("address");
  }

  #chooseDelivery(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (!this.isConnected || !this.active) return;
    this.medium = event.detail.value as DeliveryMedium;
    this.#scope?.changed();
  }

  #renderDelivery() {
    const offered = this.#offered();
    if (offered.length === 0) return nothing;
    this.#choiceShown = true;
    return html`<wt-combobox
        name="delivery"
        search="never"
        .label=${t("invoice.delivery")}
        .options=${offered}
        .value=${this.medium}
        @wt-change=${(event: CustomEvent<{ value: string }>) => this.#chooseDelivery(event)}
      ></wt-combobox>
      ${
        this.medium === "email"
          ? html`<wt-input
              name="email"
              type="email"
              required
              autocomplete="off"
              .label=${t("invoice.email")}
              .value=${live(this.email)}
              .error=${this.#fieldError("email", this.#errors().email)}
              @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change("email", event)}
              @keydown=${(event: KeyboardEvent) =>
                submitOnEnter(
                  event,
                  this.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]"),
                )}
            ></wt-input>`
          : nothing
      }`;
  }

  #edited(field: string): void {
    if (field === this.refusalField) {
      this.dispatchEvent(
        new CustomEvent("invoice-recipient-edit", {
          detail: { field },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  #fieldError(field: string, localError: string): string {
    return (this.attempted && localError) || (this.refusalField === field ? this.refusal : "");
  }

  override render() {
    const errors = this.#errors();
    const invalid = Object.values(errors).some(Boolean);
    const saveAction = saveActionState(this.#scope);
    const fieldRefused =
      this.refusal !== "" &&
      [
        "taxId",
        "identifierType",
        "identifierCountryCode",
        "countryCode",
        "legalName",
        "address",
        "email",
      ].includes(this.refusalField);
    const bottomMessages: string[] = [];
    if ((this.attempted && invalid) || fieldRefused) bottomMessages.push(t("form.fix_fields"));
    if (this.refusal !== "" && !fieldRefused) bottomMessages.push(this.refusal);
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.active}
      .beforeClose=${this.#leave ? this.#beforeClose : undefined}
      .heading=${t("invoice.full")}
      @wt-close=${(event: Event) => this.#closed(event)}
    >
      <div class="fields">
        <wt-combobox
          name="identifierType"
          search="never"
          required
          .label=${t("invoice.identifier_type")}
          .value=${this.identifierType}
          .options=${(["tax-number", "vat-number", "passport", "residence-country-id", "residence-certificate", "other-document"] as const).map((value) => ({ value, label: t(`invoice.identifier.${value}`) }))}
          .error=${this.#fieldError("identifierType", errors.identifierType)}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change("identifierType", event)}
        ></wt-combobox>
        ${
          this.identifierType === "tax-number"
            ? nothing
            : html`<wt-combobox
                name="identifierCountryCode"
                required
                .label=${t("invoice.identifier_country")}
                .value=${this.identifierCountryCode}
                .options=${RECIPIENT_IDENTIFIER_POLICY.documentCountryCodes.map((value) => ({ value, label: countryNameFor(value, currentLocale()) }))}
                .error=${this.#fieldError("identifierCountryCode", errors.identifierCountryCode)}
                @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change("identifierCountryCode", event)}
              ></wt-combobox>`
        }
        <wt-input
          name="taxId"
          required
          autocomplete="off"
          .label=${t(this.identifierType === "tax-number" ? "invoice.tax_id" : "invoice.document_number")}
          .value=${live(this.taxId)}
          .error=${this.#fieldError("taxId", errors.taxId)}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change("taxId", event)}
          @keydown=${(event: KeyboardEvent) =>
            submitOnEnter(
              event,
              this.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]"),
            )}
        ></wt-input>
        <wt-input
          name="legalName"
          required
          autocomplete="off"
          .label=${t("invoice.legal_name")}
          .value=${live(this.legalName)}
          .error=${this.#fieldError("legalName", errors.legalName)}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change("legalName", event)}
          @keydown=${(event: KeyboardEvent) =>
            submitOnEnter(
              event,
              this.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]"),
            )}
        ></wt-input>
        <wt-address-lookup
          name="address-search"
          .provider=${this.countryCode === "" ? undefined : this.addressProvider}
          country-code=${this.countryCode}
          label=${t("invoice.address_lookup.label").replace("{country}", () =>
            countryNameFor(this.countryCode, currentLocale()),
          )}
          placeholder=${t("invoice.address_lookup.placeholder")}
          no-results-label=${t("invoice.address_lookup.no_results")}
          unavailable-label=${t("invoice.address_lookup.unavailable")}
          .message=${
            this.foreignAddressCountry === undefined
              ? ""
              : t("invoice.address_lookup.other_country").replace("{country}", () =>
                  countryNameFor(this.foreignAddressCountry!, currentLocale()),
                )
          }
          @wt-address-chosen=${(event: CustomEvent<AddressChosenDetail>) => this.#onAddressChosen(event)}
        ></wt-address-lookup>
        <wt-input
          name="address"
          required
          autocomplete="off"
          .label=${t("invoice.street_address")}
          .value=${live(this.streetAddress)}
          .error=${this.#fieldError("address", errors.streetAddress)}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change("streetAddress", event)}
          @keydown=${(event: KeyboardEvent) =>
            submitOnEnter(
              event,
              this.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]"),
            )}
        ></wt-input>
        <wt-input
          name="postalCode"
          ?required=${this.countryCode === "ES"}
          autocomplete="off"
          .label=${t("invoice.postal_code")}
          .value=${live(this.postalCode)}
          .error=${this.attempted ? errors.postalCode : ""}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change("postalCode", event)}
          @keydown=${(event: KeyboardEvent) =>
            submitOnEnter(
              event,
              this.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]"),
            )}
        ></wt-input>
        <wt-input
          name="locality"
          required
          autocomplete="off"
          .label=${t("invoice.locality")}
          .value=${live(this.locality)}
          .error=${this.attempted ? errors.locality : ""}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change("locality", event)}
          @keydown=${(event: KeyboardEvent) =>
            submitOnEnter(
              event,
              this.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]"),
            )}
        ></wt-input>
        <wt-input
          name="province"
          ?required=${this.countryCode === "ES"}
          autocomplete="off"
          .label=${t("invoice.province")}
          .value=${live(this.province)}
          .error=${this.attempted ? errors.province : ""}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change("province", event)}
          @keydown=${(event: KeyboardEvent) =>
            submitOnEnter(
              event,
              this.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]"),
            )}
        ></wt-input>
        <wt-combobox
          name="countryCode"
          required
          .label=${t("invoice.country")}
          .value=${this.countryCode}
          .options=${RECIPIENT_COUNTRY_CODES.map((value) => ({ value, label: countryNameFor(value, currentLocale()) }))}
          .error=${this.#fieldError("countryCode", errors.countryCode)}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change("countryCode", event)}
        ></wt-combobox>
        ${this.#renderDelivery()}
      </div>
      <wt-form-actions slot="footer" .error=${bottomMessages.join(" ")}>
        <wt-button slot="cancel" variant="secondary" @click=${() => this.#cancel()}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-invoice-save
          variant=${saveAction.variant}
          ?disabled=${saveAction.unchanged || (this.attempted && invalid)}
          @click=${() => void this.#save()}
          >${t("invoice.save_choice")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-invoice-recipient-dialog": TillInvoiceRecipientDialog;
  }
}
