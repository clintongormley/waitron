import { LitElement, css, html } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, focusFirstInvalid, submitOnEnter, leaveCoordinatorFor } from "@waitron/ui";
import type { WtDialog, DraftScope, LeaveCoordinator, LeaveReason } from "@waitron/ui";
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

interface RecipientDraft {
  taxId: string;
  legalName: string;
  streetAddress: string;
  postalCode: string;
  locality: string;
  province: string;
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
    };
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

  override willUpdate(): void {
    if (!this.active || this.#scope) return;
    this.#baseline ??= this.#value();
    this.#leave = leaveCoordinatorFor(this);
    this.#scope = this.#leave?.register<RecipientDraft>({
      id: this,
      current: () => this.#value(),
      snapshot: (value) => ({ ...value }),
      equal: (a, b) =>
        Object.keys(a).every((key) => {
          const field = key as keyof RecipientDraft;
          const canonical = (value: string) => {
            if (field !== "taxId") return value.trim();
            const result = getCountryPack("ES")!.taxIdentifier!.validate(value);
            return result.valid ? result.normalized : value.trim();
          };
          return canonical(a[field]) === canonical(b[field]);
        }),
      restore: (value) => Object.assign(this, value),
    });
    if (this.#baseline) this.#scope?.commit(this.#baseline);
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
    };
  }

  async #save(): Promise<void> {
    if (!this.isConnected || !this.active) return;
    this.attempted = true;
    const errors = this.#errors();
    if (Object.values(errors).some(Boolean)) {
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    const taxId = this.#taxIdResult();
    if (!taxId.valid) return;
    this.#submitted = this.#value();
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

  #change(field: keyof RecipientDraft, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (!this.isConnected || !this.active) return;
    this[field] = event.detail.value;
    this.#scope?.changed();
    this.#edited(field === "streetAddress" ? "address" : field);
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
      .open=${this.active}
      .beforeClose=${this.#scope ? this.#beforeClose : undefined}
      .heading=${t("invoice.full")}
      @wt-close=${(event: Event) => this.#closed(event)}
    >
      <div class="fields">
        <wt-input
          name="taxId"
          required
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
          autocomplete="name"
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
          autocomplete="street-address"
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
          autocomplete="postal-code"
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
          autocomplete="address-level2"
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
          autocomplete="address-level1"
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
