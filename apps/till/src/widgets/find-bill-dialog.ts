import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { formatMoney, stringToCents } from "@waitron/shared";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-price-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { BillLookupRow, InvoiceLookupRow, Tender, TillApi } from "../api/client.js";
import { currentLocale, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { trackDialog } from "./track-dialog.js";

export interface FindBillPayDetail {
  workingOrderId: string;
  tender: Tender;
  invoiced: boolean;
}

@customElement("till-find-bill-dialog")
export class TillFindBillDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .body {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
        width: min(
          var(--wt-form-max-width),
          calc(var(--wt-dialog-max-width) - 2 * var(--wt-space-5))
        );
      }
      .results {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }
      .bill {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        text-align: start;
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        cursor: pointer;
      }
      .summary {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }
      .methods {
        display: flex;
        gap: var(--wt-space-2);
      }
      p {
        margin: 0;
      }
    `,
  ];

  @property({ attribute: false }) api!: TillApi;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) error?: StringKey;
  @state() private kind: "bills" | "invoices" = "bills";
  @state() private invoiceResults: InvoiceLookupRow[] | null = null;
  @state() private query = "";
  @state() private queryError = false;
  @state() private searchFailed = false;
  @state() private searching = false;
  @state() private results: BillLookupRow[] | null = null;
  @state() private selected: BillLookupRow | null = null;
  @state() private method: "cash" | "card" = "cash";
  @state() private cash = "";
  @state() private cashError = false;
  @state() private externalRef = "";
  #generation = 0;

  #emit(type: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  async #search(): Promise<void> {
    const q = this.query.trim();
    const generation = ++this.#generation;
    this.results = null;
    this.invoiceResults = null;
    this.searchFailed = false;
    this.queryError = q === "";
    if (this.queryError) {
      this.searching = false;
      return;
    }
    this.searching = true;
    try {
      if (this.kind === "invoices") {
        const { invoices } = await this.api.lookUpInvoices(q);
        if (generation === this.#generation) this.invoiceResults = invoices;
      } else {
        const { bills } = await this.api.lookUpBills(q);
        if (generation === this.#generation) this.results = bills;
      }
    } catch {
      if (generation === this.#generation) this.searchFailed = true;
    } finally {
      if (generation === this.#generation) this.searching = false;
    }
  }

  #select(row: BillLookupRow): void {
    this.selected = row;
    this.cash = row.stillOwed;
    this.cashError = false;
    this.method = "cash";
  }

  #collect(): void {
    const bill = this.selected;
    if (bill === null || this.busy) return;
    if (this.method === "cash") {
      let enough = false;
      try {
        enough = stringToCents(this.cash) >= stringToCents(bill.stillOwed);
      } catch {
        /* invalid amount */
      }
      this.cashError = !enough;
      if (!enough) return;
    }
    this.#emit("find-bill-pay", {
      workingOrderId: bill.workingOrderId,
      tender:
        this.method === "cash"
          ? { method: "cash", amount: this.cash }
          : {
              method: "card",
              amount: bill.stillOwed,
              ...(this.externalRef.trim() ? { externalRef: this.externalRef.trim() } : {}),
            },
      invoiced: bill.invoiceNumber !== null,
    } satisfies FindBillPayDetail);
  }

  #when(iso: string): string {
    return new Intl.DateTimeFormat(currentLocale(), { dateStyle: "medium" }).format(new Date(iso));
  }

  override render() {
    const bill = this.selected;
    const amount = bill ? formatMoney(bill.stillOwed, currentLocale()) : "";
    return html`<wt-dialog
      ${trackDialog()}
      .open=${true}
      .heading=${t("find_bill.title")}
      .dismissible=${!this.busy}
      @wt-close=${() => this.#emit("find-bill-close")}
    >
      <div class="body">
        ${
          bill === null
            ? html`
                <wt-combobox
                  name="search-kind"
                  search="never"
                  .label=${t("find_bill.kind")}
                  .value=${this.kind}
                  .disabled=${this.busy}
                  .options=${[
                    { value: "bills", label: t("find_bill.unpaid") },
                    { value: "invoices", label: t("find_bill.invoices") },
                  ]}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => {
                    event.stopPropagation();
                    if (this.busy) return;
                    this.kind = event.detail.value === "invoices" ? "invoices" : "bills";
                    this.#generation++;
                    this.searching = false;
                    this.results = null;
                    this.invoiceResults = null;
                    this.queryError = false;
                    this.searchFailed = false;
                  }}
                ></wt-combobox>
                <form
                  @keydown=${(event: KeyboardEvent) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    void this.#search();
                  }}
                  @submit=${(event: Event) => {
                    event.preventDefault();
                    void this.#search();
                  }}
                >
                  <wt-input
                    name="bill-search"
                    .label=${t(this.kind === "invoices" ? "find_bill.invoice_search" : "find_bill.search")}
                    .value=${this.query}
                    .required=${true}
                    .error=${this.queryError ? t(this.kind === "invoices" ? "find_bill.invoice_query_required" : "find_bill.query_required") : ""}
                    @wt-change=${(event: CustomEvent<{ value: string }>) => {
                      event.stopPropagation();
                      this.query = event.detail.value;
                      this.queryError = false;
                    }}
                  ></wt-input>
                  <wt-button
                    data-search
                    variant="secondary"
                    .loading=${this.searching}
                    .disabled=${this.busy || this.queryError}
                    @click=${() => void this.#search()}
                    >${t("find_bill.search_action")}</wt-button
                  >
                </form>
                ${this.searchFailed ? html`<p role="alert">${t("find_bill.search_failed")}</p>` : nothing}
                ${this.results?.length === 0 ? html`<p>${t("find_bill.none")}</p>` : nothing}
                ${this.invoiceResults?.length === 0 ? html`<p>${t("find_bill.invoice_none")}</p>` : nothing}
                <div class="results">
                  ${this.invoiceResults?.map(
                    (row) =>
                      html`<button
                        class="bill"
                        data-invoice
                        type="button"
                        ?disabled=${this.busy}
                        @click=${() => {
                          if (!this.busy)
                            this.#emit("find-invoice-open", { workingOrderId: row.workingOrderId });
                        }}
                      >
                        <span>${row.invoiceNumber}</span><span>${row.customerName}</span>
                        <span
                          >${this.#when(row.issuedAt)} ·
                          ${formatMoney(row.total, currentLocale())}</span
                        >
                      </button>`,
                  )}
                  ${this.results?.map(
                    (row) =>
                      html` <button
                        class="bill"
                        data-bill
                        type="button"
                        @click=${() => this.#select(row)}
                      >
                        <span
                          >${row.invoiceNumber ?? row.orderNumber ?? ""} ${row.label ?? ""}</span
                        >
                        <span>${row.tables.join(", ")} ${row.partyName ?? ""}</span>
                        ${row.departedAt ? html`<span>${t("find_bill.left_on").replace("{date}", this.#when(row.departedAt))}</span>` : nothing}
                        <span
                          >${t("find_bill.owes").replace("{amount}", amount || formatMoney(row.stillOwed, currentLocale()))}</span
                        >
                      </button>`,
                  )}
                </div>
              `
            : html`
                <div class="summary">
                  <span>${bill.invoiceNumber ?? bill.orderNumber} ${bill.label ?? ""}</span
                  ><span>${bill.tables.join(", ")} ${bill.partyName ?? ""}</span
                  ><strong>${t("find_bill.owes").replace("{amount}", amount)}</strong>
                </div>
                <div class="methods">
                  <wt-button
                    variant=${this.method === "cash" ? "primary" : "secondary"}
                    @click=${() => {
                      this.method = "cash";
                    }}
                    >${t("find_bill.cash")}</wt-button
                  >
                  <wt-button
                    data-card
                    variant=${this.method === "card" ? "primary" : "secondary"}
                    @click=${() => {
                      this.method = "card";
                    }}
                    >${t("find_bill.card")}</wt-button
                  >
                </div>
                ${
                  this.method === "cash"
                    ? html`<wt-price-input
                        name="cash-received"
                        .label=${t("find_bill.cash_received")}
                        unit="€"
                        .fixedUnit=${true}
                        .value=${this.cash}
                        .error=${this.cashError ? t("find_bill.cash_short").replace("{amount}", amount) : ""}
                        @wt-change=${(event: CustomEvent<{ value: string }>) => {
                          event.stopPropagation();
                          this.cash = event.detail.value;
                          this.cashError = false;
                        }}
                      ></wt-price-input>`
                    : html`<wt-input
                        name="terminal-reference"
                        .label=${t("find_bill.card_reference")}
                        .value=${this.externalRef}
                        @wt-change=${(event: CustomEvent<{ value: string }>) => {
                          event.stopPropagation();
                          this.externalRef = event.detail.value;
                        }}
                      ></wt-input>`
                }
              `
        }
        <wt-form-actions
          .error=${this.error ? t(this.error) : this.queryError || this.cashError ? t("form.fix_fields") : ""}
        >
          <wt-button
            slot="cancel"
            variant="secondary"
            .disabled=${this.busy}
            @click=${() => (bill === null ? this.#emit("find-bill-close") : (this.selected = null))}
          >
            ${bill === null ? t("find_bill.close") : t("find_bill.back")}</wt-button
          >
          ${
            bill === null
              ? nothing
              : html`<wt-button
                  data-collect
                  variant="primary"
                  .loading=${this.busy}
                  .disabled=${this.busy || this.cashError}
                  @click=${() => this.#collect()}
                >
                  ${t("find_bill.confirm").replace("{amount}", amount)}</wt-button
                >`
          }
        </wt-form-actions>
      </div>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-find-bill-dialog": TillFindBillDialog;
  }
}
