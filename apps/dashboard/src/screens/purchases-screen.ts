import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
// Value imports (not `import type`): pull in the widget modules for their `@customElement` side
// effects, so `<dashboard-purchase-list>` and `<dashboard-purchase-form>` are registered before this
// screen renders them (the catalogue-screen widget-registration pattern).
import "../widgets/purchase-list.js";
import "../widgets/purchase-form.js";
import type { UpdatePurchaseDetail } from "../widgets/purchase-form.js";
import type { DashboardApi, PurchaseInvoice, PurchaseInvoiceInput } from "../api/client.js";

/**
 * The management dashboard's PURCHASES SCREEN: the composition point (sibling of
 * `dashboard-catalogue-screen`) that wires the pure-display `<dashboard-purchase-list>` and the
 * `<dashboard-purchase-form>` create/edit dialog to the injected `DashboardApi`. It is the single owner
 * of the loaded invoices, the form's open state and the invoice being edited — the capture surface for
 * received supplier invoices (facturas recibidas) that feeds the headless modelo 303 IVA-deducible
 * reporting (#91).
 *
 * ON CONNECT it loads every invoice (`listPurchaseInvoices`). The list emits `edit-purchase { id }` and
 * `delete-purchase { id }`; the form emits `create-purchase` (a `PurchaseInvoiceInput`) and
 * `update-purchase { id, patch }`. Each is turned into an API call here, followed by a reload.
 *
 * ERROR HANDLING, every async path, mirrors `catalogue-screen.ts`: `#load`, `#onCreate`, `#onUpdate`
 * and `#onDelete` are each fully `try/catch`ed (invoked via `void`) — a rejection becomes `errorKey`
 * (the thrown `{ code }`, falling back to `server.internal`) rendered in a `role="alert"` banner,
 * localised at the render edge by `codeMessage`, never an unhandled promise rejection. A single-flight
 * `busy` gate on create/update/delete (passed DOWN to the form to disable its confirm) drops a
 * double-fired mutation, since none is server-idempotent. `stopPropagation` on every child event keeps
 * the composed events inside this screen (the house pattern).
 */
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

  /** The HTTP face of the dashboard. The app shell injects a real client; a test injects a stub. */
  @property({ attribute: false }) api!: DashboardApi;

  @state() private invoices: PurchaseInvoice[] = [];
  @state() private formOpen = false;
  /** The invoice the form is open for (null for a create). */
  @state() private editingInvoice: PurchaseInvoice | null = null;
  @state() private errorKey: string | null = null;
  // Single-flight for create/update/delete, passed DOWN to the form as `.busy` so its confirm disables
  // while a mutation round-trips. Reactive because the form renders off it; set synchronously at handler
  // entry so a double-fired event files at most one mutation.
  @state() private busy = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /** (Re)load every invoice. Called on connect and after a create/update/delete. A rejection becomes
   * the `errorKey` banner. */
  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      this.invoices = await this.api.listPurchaseInvoices();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Reload after a mutation. Throws to its caller's catch (so a reload failure surfaces the banner). */
  async #reload(): Promise<void> {
    this.invoices = await this.api.listPurchaseInvoices();
  }

  /** Open the create form. Clears any prior error and the edit target. */
  #openForm(): void {
    this.errorKey = null;
    this.editingInvoice = null;
    this.formOpen = true;
  }

  /** The list asked to edit `id`. Resolve it against the list we hold (it is OURS — an unknown id can
   * only be a stale event; drop it) and open the form pre-filled. */
  #onEdit(event: CustomEvent<{ id: string }>): void {
    event.stopPropagation();
    const invoice = this.invoices.find((i) => i.id === event.detail.id);
    if (invoice === undefined) return;
    this.errorKey = null;
    this.editingInvoice = invoice;
    this.formOpen = true;
  }

  /** Create an invoice from the form's detail, then close and reload. On rejection the form stays open
   * with its values intact for a retry. Single-flight. */
  async #onCreate(event: CustomEvent<PurchaseInvoiceInput>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return; // single-flight: drop a double-click's second create
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

  /** Update an invoice from the form's edit detail, then close and reload. Single-flight. */
  async #onUpdate(event: CustomEvent<UpdatePurchaseDetail>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return; // single-flight
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

  /** Delete an invoice the list asked to remove, then reload. Single-flight. */
  async #onDelete(event: CustomEvent<{ id: string }>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return; // single-flight
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
