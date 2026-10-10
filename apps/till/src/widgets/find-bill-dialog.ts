import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { formatMoney, stringToCents } from "@waitron/shared";
import {
  baseStyles,
  leaveCoordinatorFor,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  type WtDialog,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-price-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { BillLookupRow, InvoiceLookupRow, Tender, TillApi } from "../api/client.js";
import { typedAmount } from "../state/bill-payment.js";
import { currentLocale, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { trackDialog } from "./track-dialog.js";

export interface FindBillPayDetail {
  workingOrderId: string;
  tender: Tender;
  invoiced: boolean;
}

type CollectionDraft = { method: "cash" | "card"; cash: string; externalRef: string };

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
  @state() private active = true;
  #generation = 0;
  #scope?: DraftScope<CollectionDraft>;
  #leave?: LeaveCoordinator;
  #baseline?: CollectionDraft;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.busy &&
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.#generation++;
    super.disconnectedCallback();
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("busy") && this.busy && this.#baseline) this.#scope?.commit(this.#baseline);
    if (!this.isConnected || !this.active || this.selected === null || this.#scope) return;
    this.#baseline ??= this.#draft();
    this.#leave = leaveCoordinatorFor(this);
    this.#scope = this.#leave?.register<CollectionDraft>({
      id: this,
      current: () => this.#draft(),
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => this.#comparable(a) === this.#comparable(b),
      restore: (value) => {
        this.method = value.method;
        this.cash = value.cash;
        this.externalRef = value.externalRef;
        this.cashError = false;
      },
    });
    this.#scope?.commit(this.#baseline);
  }

  #draft(): CollectionDraft {
    return { method: this.method, cash: this.cash, externalRef: this.externalRef };
  }

  #comparable(value: CollectionDraft): string {
    if (value.method === "card")
      return JSON.stringify({ method: "card", externalRef: value.externalRef.trim() });
    let amount: string | { invalid: string };
    try {
      amount = stringToCents(value.cash).toString();
    } catch {
      amount = { invalid: value.cash };
    }
    return JSON.stringify({ method: "cash", amount });
  }

  #closed(event?: Event): void {
    event?.stopPropagation();
    if (event && event.target !== event.currentTarget) return;
    if (!this.isConnected || !this.active || this.busy) return;
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#emit("find-bill-close");
  }

  closeSaved(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.active = false;
    this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.closeAfter("saved");
  }

  #back(): void {
    if (!this.isConnected || !this.active || this.busy) return;
    if (this.selected === null) {
      void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel");
      return;
    }
    const proceed = () => {
      this.#scope?.dispose();
      this.#scope = undefined;
      this.#baseline = undefined;
      this.selected = null;
    };
    if (this.#scope) void this.#leave!.request({ scopes: [this], reason: "cancel", proceed });
    else proceed();
  }

  #emit(type: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  async #search(): Promise<void> {
    if (!this.isConnected || !this.active || this.busy) return;
    const q = this.query;
    const generation = ++this.#generation;
    this.results = null;
    this.invoiceResults = null;
    this.searchFailed = false;
    this.queryError = q.trim() === "";
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
    if (!this.isConnected || !this.active || this.busy) return;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#baseline = undefined;
    this.selected = row;
    this.cash = row.stillOwed;
    this.cashError = false;
    this.method = "cash";
  }

  #collect(): void {
    const bill = this.selected;
    if (!this.isConnected || !this.active || bill === null || this.busy) return;
    if (this.method === "cash") {
      let enough = false;
      try {
        const amount = typedAmount(this.cash);
        enough = amount !== null && stringToCents(amount) >= stringToCents(bill.stillOwed);
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
      .open=${this.active}
      .heading=${t("find_bill.title")}
      .dismissible=${!this.busy}
      .beforeClose=${this.#scope ? this.#beforeClose : undefined}
      @wt-close=${this.#closed}
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
                    .disabled=${this.busy}
                    @click=${() => {
                      if (!this.isConnected || !this.active || this.busy) return;
                      this.method = "cash";
                      this.#scope?.changed();
                    }}
                    >${t("find_bill.cash")}</wt-button
                  >
                  <wt-button
                    data-card
                    variant=${this.method === "card" ? "primary" : "secondary"}
                    .disabled=${this.busy}
                    @click=${() => {
                      if (!this.isConnected || !this.active || this.busy) return;
                      this.method = "card";
                      this.#scope?.changed();
                    }}
                    >${t("find_bill.card")}</wt-button
                  >
                </div>
                ${
                  this.method === "cash"
                    ? html`<wt-price-input
                        name="cash-received"
                        decimal-locale=${currentLocale()}
                        .label=${t("find_bill.cash_received")}
                        unit="€"
                        .fixedUnit=${true}
                        .value=${live(this.cash)}
                        .disabled=${this.busy}
                        .error=${this.cashError ? t("find_bill.cash_short").replace("{amount}", amount) : ""}
                        @wt-change=${(event: CustomEvent<{ value: string }>) => {
                          event.stopPropagation();
                          if (!this.isConnected || !this.active || this.busy) return;
                          this.cash = event.detail.value;
                          this.cashError = false;
                          this.#scope?.changed();
                        }}
                      ></wt-price-input>`
                    : html`<wt-input
                        name="terminal-reference"
                        .label=${t("find_bill.card_reference")}
                        .value=${live(this.externalRef)}
                        .disabled=${this.busy}
                        @wt-change=${(event: CustomEvent<{ value: string }>) => {
                          event.stopPropagation();
                          if (!this.isConnected || !this.active || this.busy) return;
                          this.externalRef = event.detail.value;
                          this.#scope?.changed();
                        }}
                      ></wt-input>`
                }
              `
        }
        <wt-form-actions
          .error=${this.error ? t(this.error) : this.queryError || this.cashError ? t("form.fix_fields") : ""}
        >
          <wt-button slot="cancel" variant="secondary" .disabled=${this.busy} @click=${this.#back}>
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
