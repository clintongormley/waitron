import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import { formatMoney } from "@waitron/shared";
import { baseStyles, submitOnEnter, type DataTableColumn, type WtDialog } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import type { DashboardApi, InvoiceCustomerSearchDto } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { currentLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { countOf } from "./count-text.js";
import { invoiceTaxIdProblem } from "./invoice-tax-id.js";

type FoundInvoice = InvoiceCustomerSearchDto["invoices"][number];

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
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) api!: DashboardApi;
  @state() private taxId = "";
  @state() private searching = false;
  @state() private found: InvoiceCustomerSearchDto | null = null;
  @state() private fieldRefusal = "";
  @state() private actionError = "";
  /** Bumped by every edit and close, so an answer to an earlier number is dropped. */
  #generation = 0;

  #reset(): void {
    this.#generation++;
    this.taxId = "";
    this.searching = false;
    this.found = null;
    this.fieldRefusal = "";
    this.actionError = "";
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("open") && !this.open) this.#reset();
  }

  override disconnectedCallback(): void {
    this.#reset();
    super.disconnectedCallback();
  }

  #edit(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.#generation++;
    this.taxId = event.detail.value;
    this.searching = false;
    this.found = null;
    this.fieldRefusal = "";
    this.actionError = "";
  }

  #ownProblem(): string {
    if (this.taxId === "") return "";
    const problem = invoiceTaxIdProblem(this.taxId);
    return problem === null ? "" : t(problem);
  }

  async #find(): Promise<void> {
    if (this.searching || this.taxId === "" || this.#ownProblem() !== "") return;
    const generation = ++this.#generation;
    this.searching = true;
    this.found = null;
    this.fieldRefusal = "";
    this.actionError = "";
    try {
      const found = await this.api.findInvoiceCustomer(this.taxId);
      if (generation !== this.#generation) return;
      this.found = found;
    } catch (error) {
      if (generation !== this.#generation) return;
      const field = (error as { params?: { field?: string } } | null)?.params?.field;
      if (codeOf(error) === "management.request_invalid" && field === "taxId")
        this.fieldRefusal = t("invoice_customer.tax_id_invalid");
      else this.actionError = codeMessage(codeOf(error));
    } finally {
      if (generation === this.#generation) this.searching = false;
    }
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
      return html`<p role="status" data-test="none">${t("invoice_customer.none")}</p>`;
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
        <wt-button variant="primary" data-test="download">${t("person.download_data")}</wt-button>
      </div>`;
  }

  #close(): void {
    this.#reset();
    this.open = false;
    this.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  }

  override render() {
    const problem = this.#ownProblem() || this.fieldRefusal;
    const ready = this.taxId !== "" && this.#ownProblem() === "";
    const bottom = problem ? t("form.fix_fields") : "";
    const dialog = () => this.shadowRoot!.querySelector<WtDialog>("wt-dialog");
    return html`<wt-dialog
      .open=${this.open}
      heading=${t("invoice_customer.heading")}
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
              <wt-input
                name="taxId"
                required
                autocomplete="off"
                label=${t("invoice_customer.tax_id")}
                hint=${t("invoice_customer.tax_id_hint")}
                .value=${this.taxId}
                .error=${problem}
                @wt-change=${(event: CustomEvent<{ value: string }>) => this.#edit(event)}
              ></wt-input>
              ${this.#renderFound()}
              ${this.actionError ? html`<p role="alert">${this.actionError}</p>` : nothing}
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
