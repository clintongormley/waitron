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
import type { WtDialog, DraftScope, LeaveCoordinator, LeaveReason } from "@waitron/ui";
import { getCountryPack } from "@waitron/country-packs";
import { isValidEmail } from "@waitron/shared";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-combobox.js";
import { trackDialog } from "./track-dialog.js";
import { t } from "../i18n/t.js";
import type { InvoiceDeliveryChoice, InvoiceDeliveryOptions } from "../api/client.js";

export interface InvoiceRecipientDetail {
  invoiceType: "F1";
  recipient: { taxId: string; legalName: string; address: string; countryCode: "ES" };
  /** Absent when there is neither a choice to offer nor a saved one to send back. */
  delivery?: InvoiceDeliveryChoice;
}

/** `saved` sends {@link TillInvoiceRecipientDialog.savedDelivery} back as it is. */
type DeliveryMedium = "receipt" | "a4" | "email" | "saved";

interface RecipientDraft {
  taxId: string;
  legalName: string;
  streetAddress: string;
  postalCode: string;
  locality: string;
  province: string;
  medium: DeliveryMedium;
  email: string;
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
  @state() private attempted = false;
  @state() private taxId = "";
  @state() private legalName = "";
  @state() private streetAddress = "";
  @state() private postalCode = "";
  @state() private locality = "";
  @state() private province = "";
  @state() private medium: DeliveryMedium = "receipt";
  @state() private email = "";
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
          const canonical = (value: string) => {
            if (field !== "taxId") return value.trim();
            const result = getCountryPack("ES")!.taxIdentifier!.validate(value);
            return result.valid ? result.normalized : value.trim();
          };
          return canonical(a[field]) === canonical(b[field]);
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

  #taxIdResult() {
    return getCountryPack("ES")!.taxIdentifier!.validate(this.taxId);
  }

  #errors() {
    return {
      taxId: this.#taxIdResult().valid ? "" : t("invoice.tax_id_invalid"),
      legalName: this.legalName.trim() === "" ? t("invoice.name_required") : "",
      streetAddress: this.streetAddress.trim() === "" ? t("invoice.street_address_required") : "",
      postalCode: /^\d{5}$/.test(this.postalCode.trim()) ? "" : t("invoice.postal_code_invalid"),
      locality: this.locality.trim() === "" ? t("invoice.locality_required") : "",
      province: this.province.trim() === "" ? t("invoice.province_required") : "",
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
    const taxId = this.#taxIdResult();
    if (!taxId.valid) return;
    this.#submitted = this.#value();
    const delivery = this.#delivery();
    this.dispatchEvent(
      new CustomEvent<InvoiceRecipientDetail>("invoice-recipient-confirm", {
        detail: {
          invoiceType: "F1",
          recipient: {
            taxId: taxId.normalized,
            legalName: this.legalName.trim(),
            address: `${this.streetAddress.trim()}, ${this.postalCode.trim()} ${this.locality.trim()}, ${this.province.trim()}, España`,
            countryCode: "ES",
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
    this[field] = event.detail.value;
    this.#scope?.changed();
    this.#edited(field === "streetAddress" ? "address" : field);
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
      this.refusal !== "" && ["taxId", "legalName", "address", "email"].includes(this.refusalField);
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
        <wt-input
          name="taxId"
          required
          autocomplete="off"
          .label=${t("invoice.tax_id")}
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
          required
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
          required
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
        <wt-input
          name="countryCode"
          disabled
          .label=${t("invoice.country")}
          .value=${t("invoice.country_spain")}
        ></wt-input>
        ${this.#renderDelivery()}
        <wt-form-actions .error=${bottomMessages.join(" ")}>
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
      </div>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-invoice-recipient-dialog": TillInvoiceRecipientDialog;
  }
}
