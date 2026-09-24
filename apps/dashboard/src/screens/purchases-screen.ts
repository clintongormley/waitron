import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import "../widgets/purchase-list.js";
import "../widgets/purchase-form.js";
import type { UpdatePurchaseDetail } from "../widgets/purchase-form.js";
import type { DashboardApi, PurchaseInvoice, PurchaseInvoiceInput } from "../api/client.js";

@customElement("dashboard-purchases-screen")
export class PurchasesScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        margin-bottom: var(--wt-space-4);
      }
      .title {
        margin: 0;
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      .prompt {
        color: var(--wt-color-text);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.errorKey = codeOf(error);
    },
  );

  @state() private invoices: PurchaseInvoice[] = [];
  @state() private formOpen = false;
  @state() private editingInvoice: PurchaseInvoice | null = null;
  @state() private errorKey: string | null = null;
  // Set synchronously on entry, so a double-fired event files at most one mutation.
  @state() private busy = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      await this.#queries.watch("listPurchaseInvoices", [], (value) => {
        this.invoices = value;
      });
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  async #reload(): Promise<void> {
    await this.#queries.watch("listPurchaseInvoices", [], (value) => {
      this.invoices = value;
    });
  }

  #openForm(): void {
    this.errorKey = null;
    this.editingInvoice = null;
    this.formOpen = true;
  }

  #onEdit(event: CustomEvent<{ id: string }>): void {
    event.stopPropagation();
    const invoice = this.invoices.find((i) => i.id === event.detail.id);
    if (invoice === undefined) return;
    this.errorKey = null;
    this.editingInvoice = invoice;
    this.formOpen = true;
  }

  async #onCreate(event: CustomEvent<PurchaseInvoiceInput>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return;
    this.busy = true;
    this.errorKey = null;
    try {
      await this.api.createPurchaseInvoice(event.detail);
      this.formOpen = false;
      await this.#reload();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  async #onUpdate(event: CustomEvent<UpdatePurchaseDetail>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return;
    this.busy = true;
    this.errorKey = null;
    try {
      await this.api.updatePurchaseInvoice(event.detail.id, event.detail.patch);
      this.formOpen = false;
      await this.#reload();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  async #onDelete(event: CustomEvent<{ id: string }>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return;
    this.busy = true;
    this.errorKey = null;
    try {
      await this.api.deletePurchaseInvoice(event.detail.id);
      await this.#reload();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  override render(): TemplateResult {
    const hasInvoices = this.invoices.length > 0;
    return html`
      <div class="header">
        <h1 class="title">${t("purchase.title")}</h1>
        <wt-button variant="primary" data-test="add-purchase" @click=${() => this.#openForm()}
          >${t("purchase.add")}</wt-button
        >
      </div>

      ${
        hasInvoices
          ? html`<dashboard-purchase-list
              .invoices=${this.invoices}
              @edit-purchase=${(e: CustomEvent<{ id: string }>) => this.#onEdit(e)}
              @delete-purchase=${(e: CustomEvent<{ id: string }>) => void this.#onDelete(e)}
            ></dashboard-purchase-list>`
          : html`<p class="prompt" data-test="no-invoices">${t("purchase.empty")}</p>`
      }
      ${this.errorKey ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>` : nothing}

      <dashboard-purchase-form
        .open=${this.formOpen}
        .invoice=${this.editingInvoice}
        .busy=${this.busy}
        @create-purchase=${(e: CustomEvent<PurchaseInvoiceInput>) => void this.#onCreate(e)}
        @update-purchase=${(e: CustomEvent<UpdatePurchaseDetail>) => void this.#onUpdate(e)}
        @wt-close=${() => (this.formOpen = false)}
      ></dashboard-purchase-form>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-purchases-screen": PurchasesScreen;
  }
}
