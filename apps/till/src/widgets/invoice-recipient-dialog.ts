import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, focusFirstInvalid, submitOnEnter } from "@waitron/ui";
import type { WtDialog } from "@waitron/ui";
import { getCountryPack } from "@waitron/country-packs";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { trackDialog } from "./track-dialog.js";
import { t } from "../i18n/t.js";

export interface InvoiceRecipientDetail {
  invoiceType: "F1";
  recipient: { taxId: string; legalName: string; address: string; countryCode: "ES" };
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
  @state() private attempted = false;
  @state() private taxId = "";
  @state() private legalName = "";
  @state() private streetAddress = "";
  @state() private postalCode = "";
  @state() private locality = "";
  @state() private province = "";

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
    };
  }

  async #save(): Promise<void> {
    this.attempted = true;
    const errors = this.#errors();
    if (Object.values(errors).some(Boolean)) {
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    const taxId = this.#taxIdResult();
    if (!taxId.valid) return;
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
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #cancel(): void {
    this.dispatchEvent(
      new CustomEvent("invoice-recipient-cancel", { bubbles: true, composed: true }),
    );
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
    const fieldRefused =
      this.refusal !== "" && ["taxId", "legalName", "address"].includes(this.refusalField);
    const bottomMessages: string[] = [];
    if ((this.attempted && invalid) || fieldRefused) bottomMessages.push(t("form.fix_fields"));
    if (this.refusal !== "" && !fieldRefused) bottomMessages.push(this.refusal);
    return html`<wt-dialog
      ${trackDialog()}
      .open=${true}
      .heading=${t("invoice.full")}
      @wt-close=${() => this.#cancel()}
    >
      <div class="fields">
        <wt-input
          name="taxId"
          required
          .label=${t("invoice.tax_id")}
          .value=${this.taxId}
          .error=${this.#fieldError("taxId", errors.taxId)}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            this.taxId = event.detail.value;
            this.#edited("taxId");
          }}
          @keydown=${(event: KeyboardEvent) =>
            submitOnEnter(
              event,
              this.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]"),
            )}
        ></wt-input>
        <wt-input
          name="legalName"
          required
          autocomplete="name"
          .label=${t("invoice.legal_name")}
          .value=${this.legalName}
          .error=${this.#fieldError("legalName", errors.legalName)}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            this.legalName = event.detail.value;
            this.#edited("legalName");
          }}
          @keydown=${(event: KeyboardEvent) =>
            submitOnEnter(
              event,
              this.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]"),
            )}
        ></wt-input>
        <wt-input
          name="address"
          required
          autocomplete="street-address"
          .label=${t("invoice.street_address")}
          .value=${this.streetAddress}
          .error=${this.#fieldError("address", errors.streetAddress)}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            this.streetAddress = event.detail.value;
            this.#edited("address");
          }}
          @keydown=${(event: KeyboardEvent) =>
            submitOnEnter(
              event,
              this.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]"),
            )}
        ></wt-input>
        <wt-input
          name="postalCode"
          required
          autocomplete="postal-code"
          .label=${t("invoice.postal_code")}
          .value=${this.postalCode}
          .error=${this.attempted ? errors.postalCode : ""}
          @wt-change=${(event: CustomEvent<{ value: string }>) => (this.postalCode = event.detail.value)}
          @keydown=${(event: KeyboardEvent) =>
            submitOnEnter(
              event,
              this.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]"),
            )}
        ></wt-input>
        <wt-input
          name="locality"
          required
          autocomplete="address-level2"
          .label=${t("invoice.locality")}
          .value=${this.locality}
          .error=${this.attempted ? errors.locality : ""}
          @wt-change=${(event: CustomEvent<{ value: string }>) => (this.locality = event.detail.value)}
          @keydown=${(event: KeyboardEvent) =>
            submitOnEnter(
              event,
              this.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]"),
            )}
        ></wt-input>
        <wt-input
          name="province"
          required
          autocomplete="address-level1"
          .label=${t("invoice.province")}
          .value=${this.province}
          .error=${this.attempted ? errors.province : ""}
          @wt-change=${(event: CustomEvent<{ value: string }>) => (this.province = event.detail.value)}
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
        <wt-form-actions .error=${bottomMessages.join(" ")}>
          <wt-button slot="cancel" variant="secondary" @click=${() => this.#cancel()}
            >${t("action.cancel")}</wt-button
          >
          <wt-button
            data-invoice-save
            variant="primary"
            ?disabled=${this.attempted && invalid}
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
