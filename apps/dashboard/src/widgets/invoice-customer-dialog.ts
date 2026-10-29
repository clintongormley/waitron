import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import {
  countryNameFor,
  recipientIdentifierResult,
  RECIPIENT_IDENTIFIER_POLICY,
  type RecipientIdentifierType,
} from "@waitron/country-packs";
import { formatMoney } from "@waitron/shared";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  submitOnEnter,
  type DataTableColumn,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  type WtDialog,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-combobox.js";
import type { DashboardApi, InvoiceCustomerSearchDto } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { currentLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { countOf } from "./count-text.js";
import { invoiceTaxIdProblem, normaliseInvoiceTaxId } from "./invoice-tax-id.js";

type FoundInvoice = InvoiceCustomerSearchDto["invoices"][number];
type Draft = {
  taxId: string;
  identifierType: RecipientIdentifierType;
  identifierCountryCode: string;
};
type Refusal = { code: string; action: "find" | "download" };

@customElement("dashboard-invoice-customer-dialog")
export class InvoiceCustomerDialog extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this, () => this.requestUpdate());
  }
  static override styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
      .fields {
        display: grid;
        gap: var(--wt-space-3);
        width: var(--wt-form-max-width);
        max-width: 100%;
      }
      p {
        margin: 0;
        overflow-wrap: anywhere;
      }
      .refusal {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) api!: DashboardApi;
  @state() private taxId = "";
  @state() private identifierType: RecipientIdentifierType = "tax-number";
  @state() private identifierCountryCode = "";
  @state() private refusedField = "taxId";
  @state() private searching = false;
  @state() private found: InvoiceCustomerSearchDto | null = null;
  @state() private downloading = false;
  @state() private fieldRefusal = "";
  @state() private refusal: Refusal | null = null;
  /** The form says nothing about the field until Find is first pressed. */
  @state() private attempted = false;
  #generation = 0;
  #download = 0;
  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;

  #clearOutcome(): void {
    this.#generation++;
    this.#download++;
    this.searching = false;
    this.downloading = false;
    this.found = null;
    this.fieldRefusal = "";
    this.refusal = null;
  }

  #reset(): void {
    this.#clearOutcome();
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.taxId = "";
    this.identifierType = "tax-number";
    this.identifierCountryCode = "";
    this.attempted = false;
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("open") && !this.open) this.#reset();
    if (this.open && this.isConnected && this.#scope === undefined) this.#track();
  }

  #value(): Draft {
    return {
      taxId: this.taxId,
      identifierType: this.identifierType,
      identifierCountryCode: this.identifierCountryCode,
    };
  }

  #identity(draft = this.#value()) {
    return draft.identifierType === "tax-number"
      ? undefined
      : {
          identifierType: draft.identifierType,
          identifierCountryCode: draft.identifierCountryCode,
        };
  }

  #track(): void {
    const { coordinator, scope } = draftScopeFor<Draft>(this, {
      id: this,
      current: () => this.#value(),
      snapshot: (value) => ({ ...value }),
      equal: (a, b) =>
        a.identifierType === b.identifierType &&
        (a.identifierType === "tax-number" ||
          a.identifierCountryCode === b.identifierCountryCode) &&
        (a.identifierType === "tax-number"
          ? normaliseInvoiceTaxId(a.taxId) === normaliseInvoiceTaxId(b.taxId)
          : a.taxId === b.taxId),
      restore: (value) => {
        this.#clearOutcome();
        Object.assign(this, value);
      },
    });
    this.#scope = scope;
    this.#leave = coordinator;
    scope.commit(this.#value());
  }

  override disconnectedCallback(): void {
    this.#reset();
    this.open = false;
    super.disconnectedCallback();
  }

  #edit(event: CustomEvent<{ value: string }>, field: keyof Draft = "taxId"): void {
    event.stopPropagation();
    this.#clearOutcome();
    if (field === "identifierType")
      this.identifierType = event.detail.value as RecipientIdentifierType;
    else this[field] = event.detail.value;
    this.#scope?.changed();
  }

  #awaitingInput(): boolean {
    return (
      (this.identifierType === "tax-number"
        ? normaliseInvoiceTaxId(this.taxId)
        : this.taxId.trim()) === ""
    );
  }

  #ownErrors(): Partial<Record<keyof Draft, string>> {
    if (this.identifierType === "tax-number") {
      const problem = invoiceTaxIdProblem(this.taxId);
      return problem === null ? {} : { taxId: t(problem) };
    }
    const result = recipientIdentifierResult({ ...this.#value() });
    if (result.valid) return {};
    const key =
      result.field === "identifierType"
        ? "invoice_customer.document_type_invalid"
        : result.field === "identifierCountryCode"
          ? "invoice_customer.document_country_required"
          : "invoice_customer.document_number_invalid";
    return { [result.field]: t(key) };
  }

  #ownProblem(): string {
    return Object.values(this.#ownErrors()).join(" ");
  }

  async #find(): Promise<void> {
    if (this.searching || this.downloading || this.#awaitingInput()) return;
    this.attempted = true;
    if (this.#ownProblem() !== "") {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    const generation = ++this.#generation;
    this.searching = true;
    this.found = null;
    this.fieldRefusal = "";
    this.refusal = null;
    const sent = this.#value();
    try {
      const identity = this.#identity(sent);
      const found = await (identity === undefined
        ? this.api.findInvoiceCustomer(sent.taxId)
        : this.api.findInvoiceCustomer(sent.taxId, identity));
      if (generation !== this.#generation) return;
      this.found = found;
      this.#scope?.commit(sent);
    } catch (error) {
      if (generation !== this.#generation) return;
      const field = (error as { params?: { field?: string } } | null)?.params?.field;
      if (
        codeOf(error) === "management.request_invalid" &&
        (field === "taxId" || field === "identifierType" || field === "identifierCountryCode")
      ) {
        this.refusedField = field;
        this.fieldRefusal = t(
          field === "taxId"
            ? this.identifierType === "tax-number"
              ? "invoice_customer.tax_id_invalid"
              : "invoice_customer.document_number_invalid"
            : field === "identifierType"
              ? "invoice_customer.document_type_invalid"
              : "invoice_customer.document_country_required",
        );
      } else this.refusal = { code: codeOf(error), action: "find" };
    } finally {
      if (generation === this.#generation) this.searching = false;
    }
  }

  async #downloadData(): Promise<void> {
    if (this.downloading || this.found === null) return;
    const download = ++this.#download;
    const sent = this.#value();
    this.downloading = true;
    this.refusal = null;
    try {
      const identity = this.#identity(sent);
      const file = await (identity === undefined
        ? this.api.downloadInvoiceCustomerData(sent.taxId)
        : this.api.downloadInvoiceCustomerData(sent.taxId, identity));
      if (download !== this.#download) return;
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.fileName ?? "invoice-customer-data.zip";
      link.click();
      URL.revokeObjectURL(url);
      this.#scope?.commit(sent);
    } catch (error) {
      if (download !== this.#download) return;
      this.refusal = { code: codeOf(error), action: "download" };
    } finally {
      if (download === this.#download) this.downloading = false;
    }
  }

  #refusalText(refusal: Refusal): string {
    if (refusal.code === "authorization.not_permitted") return t("invoice_customer.not_permitted");
    if (refusal.code === "node.read_only") return t("invoice_customer.read_only");
    if (refusal.code === "invoice_customer.not_found" && refusal.action === "download")
      return t("invoice_customer.vanished");
    return codeMessage(refusal.code);
  }

  #renderSignIn(refusal: Refusal) {
    return refusal.code === "authorization.not_permitted"
      ? html`<wt-button
          data-test="admin-sign-in"
          @click=${(event: Event) =>
            event.currentTarget!.dispatchEvent(
              new CustomEvent("admin-sign-in", { bubbles: true, composed: true }),
            )}
          >${t("staff.sign_in_as_admin")}</wt-button
        >`
      : nothing;
  }

  /** Find's refusal names no field the form shows, so its sentence is the bottom message and only
   * the sign-in it offers stays here. Download acts on the results, so its refusal sits under them. */
  #renderRefusal() {
    const refusal = this.refusal;
    if (refusal === null) return nothing;
    if (refusal.action === "find")
      return refusal.code === "authorization.not_permitted"
        ? html`<div class="refusal">${this.#renderSignIn(refusal)}</div>`
        : nothing;
    return html`<div class="refusal" role="alert" data-test="refusal">
      <p data-test="refusal-text">${this.#refusalText(refusal)}</p>
      ${this.#renderSignIn(refusal)}
    </div>`;
  }

  #columns(): DataTableColumn<FoundInvoice>[] {
    const day = new Intl.DateTimeFormat(currentLocale(), { dateStyle: "medium" });
    return [
      { key: "invoice", label: t("invoice_customer.col.invoice"), cell: (row) => row.invoice },
      {
        key: "issued",
        label: t("invoice_customer.col.issued"),
        cell: (row) => day.format(new Date(row.issuedAt)),
      },
      { key: "name", label: t("invoice_customer.col.name"), cell: (row) => row.name },
      {
        key: "total",
        label: t("invoice_customer.col.total"),
        cell: (row) => formatMoney(row.total, currentLocale()),
      },
    ];
  }

  #renderFound() {
    const found = this.found;
    if (found === null) return nothing;
    if (found.invoices.length === 0)
      return html`<p role="status" data-test="none">
        ${t(this.identifierType === "tax-number" ? "invoice_customer.none" : "invoice_customer.none_document")}
      </p>`;
    return html`<p role="status" data-test="count">
        ${countOf("invoice_customer.count", found.invoices.length)}
      </p>
      <wt-data-table
        aria-label=${t("invoice_customer.heading")}
        noMatchesMessage=${tableNoMatches()}
        .rows=${found.invoices}
        .columns=${this.#columns()}
        .rowKey=${(row: FoundInvoice) => row.invoice}
      ></wt-data-table>
      <div>
        <wt-button
          variant="primary"
          data-test="download"
          ?disabled=${this.downloading}
          @click=${() => void this.#downloadData()}
          >${t("person.download_data")}</wt-button
        >
      </div>
      ${
        this.downloading
          ? html`<p role="status" data-test="preparing">${t("invoice_customer.preparing")}</p>`
          : nothing
      }`;
  }

  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.#leave ||
    (await this.#leave.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  #close(): void {
    this.#reset();
    this.open = false;
    this.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  }

  override render() {
    const ownProblem = this.attempted && !this.#awaitingInput() ? this.#ownProblem() : "";
    const problem = ownProblem || this.fieldRefusal;
    const errors = this.attempted ? this.#ownErrors() : {};
    const fieldError = (field: keyof Draft) =>
      errors[field] || (this.refusedField === field ? this.fieldRefusal : "");
    const ready = !this.#awaitingInput() && ownProblem === "" && !this.downloading;
    const findRefusal = this.refusal?.action === "find" ? this.#refusalText(this.refusal) : "";
    const bottom = [findRefusal, problem ? t("form.fix_fields") : ""].filter(Boolean).join(" ");
    const dialog = () => this.shadowRoot!.querySelector<WtDialog>("wt-dialog");
    return html`<wt-dialog
      .open=${this.open}
      heading=${t("invoice_customer.heading")}
      .beforeClose=${this.#beforeClose}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#close();
      }}
    >
      ${
        this.open
          ? html`<div
              class="fields"
              @keydown=${(event: KeyboardEvent) =>
                submitOnEnter(
                  event,
                  this.shadowRoot!.querySelector<HTMLElement>("[data-test=find]"),
                )}
            >
              <wt-combobox
                name="identifierType"
                search="never"
                required
                .label=${t("invoice_customer.identifier_type")}
                .value=${this.identifierType}
                .options=${(["tax-number", "vat-number", "passport", "residence-country-id", "residence-certificate", "other-document"] as const).map((value) => ({ value, label: t(`invoice_customer.identifier.${value}`) }))}
                .error=${fieldError("identifierType")}
                @wt-change=${(event: CustomEvent<{ value: string }>) => this.#edit(event, "identifierType")}
              ></wt-combobox>
              ${
                this.identifierType === "tax-number"
                  ? nothing
                  : html`<wt-combobox
                      name="identifierCountryCode"
                      required
                      .label=${t("invoice_customer.identifier_country")}
                      .value=${this.identifierCountryCode}
                      .options=${RECIPIENT_IDENTIFIER_POLICY.documentCountryCodes.map((value) => ({ value, label: countryNameFor(value, currentLocale()) }))}
                      .error=${fieldError("identifierCountryCode")}
                      @wt-change=${(event: CustomEvent<{ value: string }>) => this.#edit(event, "identifierCountryCode")}
                    ></wt-combobox>`
              }
              <wt-input
                name="taxId"
                required
                autocomplete="off"
                label=${t(this.identifierType === "tax-number" ? "invoice_customer.tax_id" : "invoice_customer.document_number")}
                hint=${this.identifierType === "tax-number" ? t("invoice_customer.tax_id_hint") : ""}
                .value=${this.taxId}
                .error=${fieldError("taxId")}
                @wt-change=${(event: CustomEvent<{ value: string }>) => this.#edit(event)}
              ></wt-input>
              ${this.#renderFound()} ${this.#renderRefusal()}
            </div>`
          : nothing
      }
      <wt-form-actions slot="footer" .error=${bottom}>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="close"
          @click=${() => void dialog()?.requestClose("cancel")}
          >${t("action.close")}</wt-button
        >
        <wt-button
          data-test="find"
          variant=${ready || this.searching ? "primary" : "secondary"}
          ?loading=${this.searching}
          ?disabled=${!ready}
          @click=${() => void this.#find()}
          >${t("invoice_customer.find")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-invoice-customer-dialog": InvoiceCustomerDialog;
  }
}
