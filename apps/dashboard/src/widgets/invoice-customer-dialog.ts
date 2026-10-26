import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
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
import type { DashboardApi, InvoiceCustomerSearchDto } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { currentLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { countOf } from "./count-text.js";
import { invoiceTaxIdProblem, normaliseInvoiceTaxId } from "./invoice-tax-id.js";

type FoundInvoice = InvoiceCustomerSearchDto["invoices"][number];
type Draft = { taxId: string };
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

  #reset(): void {
    this.#generation++;
    this.#download++;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.taxId = "";
    this.searching = false;
    this.downloading = false;
    this.found = null;
    this.fieldRefusal = "";
    this.refusal = null;
    this.attempted = false;
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("open") && !this.open) this.#reset();
    if (this.open && this.isConnected && this.#scope === undefined) this.#track();
  }

  #track(): void {
    const { coordinator, scope } = draftScopeFor<Draft>(this, {
      id: this,
      current: () => ({ taxId: this.taxId }),
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => a.taxId === b.taxId,
      restore: (value) => {
        this.#generation++;
        this.#download++;
        this.taxId = value.taxId;
        this.searching = false;
        this.downloading = false;
        this.found = null;
        this.fieldRefusal = "";
        this.refusal = null;
      },
    });
    this.#scope = scope;
    this.#leave = coordinator;
    scope.commit({ taxId: this.taxId });
  }

  override disconnectedCallback(): void {
    this.#reset();
    this.open = false;
    super.disconnectedCallback();
  }

  #edit(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.#generation++;
    this.#download++;
    this.taxId = event.detail.value;
    this.searching = false;
    this.downloading = false;
    this.found = null;
    this.fieldRefusal = "";
    this.refusal = null;
    this.#scope?.changed();
  }

  /** Nothing but ignored characters and a leading ES: the dialog is still waiting for a number. */
  #awaitingInput(): boolean {
    return normaliseInvoiceTaxId(this.taxId) === "";
  }

  #ownProblem(): string {
    const problem = invoiceTaxIdProblem(this.taxId);
    return problem === null ? "" : t(problem);
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
    const sent = this.taxId;
    try {
      const found = await this.api.findInvoiceCustomer(sent);
      if (generation !== this.#generation) return;
      this.found = found;
      this.#scope?.commit({ taxId: sent });
    } catch (error) {
      if (generation !== this.#generation) return;
      const field = (error as { params?: { field?: string } } | null)?.params?.field;
      if (codeOf(error) === "management.request_invalid" && field === "taxId")
        this.fieldRefusal = t("invoice_customer.tax_id_invalid");
      else this.refusal = { code: codeOf(error), action: "find" };
    } finally {
      if (generation === this.#generation) this.searching = false;
    }
  }

  async #downloadData(): Promise<void> {
    const found = this.found;
    if (this.downloading || found === null) return;
    const download = ++this.#download;
    const sent = this.taxId;
    this.downloading = true;
    this.refusal = null;
    try {
      const file = await this.api.downloadInvoiceCustomerData(found.taxId);
      if (download !== this.#download) return;
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.fileName ?? "invoice-customer-data.zip";
      link.click();
      URL.revokeObjectURL(url);
      this.#scope?.commit({ taxId: sent });
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
