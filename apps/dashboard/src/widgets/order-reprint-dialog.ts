import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-spinner.js";
import { DashboardQueries } from "../api/query-controller.js";
import type { DashboardApi, OfferedPrinter, OrderDetailDto, OrderRowDto } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { fill, t } from "../i18n/t.js";

@customElement("dashboard-order-reprint-dialog")
export class OrderReprintDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      p {
        margin-block: var(--wt-space-3);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) row: OrderRowDto | null = null;
  /** `invoice` prints a full invoice on any printer the bill's status offers; `receipt` reprints the
   * receipt on a receipt printer. */
  @property({ attribute: false }) mode: "receipt" | "invoice" = "receipt";
  @state() private printers: { id: string; name: string; kind?: OfferedPrinter["kind"] }[] | null =
    null;
  /** In invoice mode, which copy the server last offered to print. */
  @state() private designation: "original" | "duplicate" = "original";
  /** In invoice mode, the server offers no print because a delivery is on its way. */
  @state() private deliveryBusy = false;
  @state() private printersFailed = false;
  @state() private printerId = "";
  @state() private printing = false;
  @state() private sentTo: string | null = null;
  #sentKey: "orders.reprint.sent" | "orders.print_invoice.sent" = "orders.reprint.sent";
  @state() private printerError: string | null = null;
  @state() private error: string | null = null;
  /** Whether `error` is a read's failure, the only message the reads' recovery may clear. */
  #readErrorShown = false;
  /** The printer list (in invoice mode, the bill) is this dialog's only query, so every failure and recovery reported here is its own. */
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.printersFailed = true;
      this.#showReadError(error);
    },
    () => {
      if (this.#readErrorShown) this.#showError(null);
    },
  );

  #showError(message: string | null, fromRead = false): void {
    this.error = message;
    this.#readErrorShown = fromRead;
  }

  /** A read's failure never replaces an action's message. */
  #showReadError(error: unknown): void {
    if (this.error === null || this.#readErrorShown)
      this.#showError(codeMessage(codeOf(error)), true);
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("row") && !changed.has("mode")) return;
    this.sentTo = null;
    this.printerError = null;
    this.#showError(null);
    // Another bill's offer, or the other mode's list, is never a printer this one may use.
    if (changed.has("mode") || this.mode === "invoice") {
      this.printers = null;
      this.deliveryBusy = false;
    }
    if (this.row === null || this.mode === "invoice") this.#queries.release("getOrderPrinters");
    if (this.row === null || this.mode === "receipt") this.#queries.release("getOrder");
    if (this.row !== null) this.#watchPrinters();
  }

  /** An empty list is dropped so a fresh read says it is loading rather than that there is no
   * printer; a non-empty one stays usable until the read answers. */
  #watchPrinters(): void {
    if (this.printers?.length === 0) this.printers = null;
    this.printersFailed = false;
    if (this.#readErrorShown) this.#showError(null);
    if (this.mode === "invoice") {
      this.#watchInvoice(this.row!.id);
      return;
    }
    void this.#queries
      .watch("getOrderPrinters", [], (printers) => {
        this.printers = printers;
        this.printersFailed = false;
        if (!printers.some((printer) => printer.id === this.printerId))
          this.printerId = printers[0]?.id ?? "";
      })
      .catch(() => undefined);
  }

  /** The first answer chooses the printer the original went to when it is listed; a later one keeps
   * the person's choice while it is still listed. */
  #watchInvoice(id: string): void {
    let first = true;
    void this.#queries
      .watch("getOrder", [id], (detail: OrderDetailDto) => {
        const status = detail.deliveries;
        const print = status?.actions.print ?? null;
        this.printersFailed = false;
        this.deliveryBusy = print === null;
        if (print === null) {
          this.printers ??= [];
          return;
        }
        this.designation = print.designation;
        this.printers = print.printers;
        const listed = (printerId: string | null | undefined) =>
          print.printers.some((printer) => printer.id === printerId);
        if (first || !listed(this.printerId))
          this.printerId = listed(status?.originalPrinterId)
            ? status!.originalPrinterId!
            : (print.printers[0]?.id ?? "");
        first = false;
      })
      .catch(() => undefined);
  }

  /** After a failed read, a list an earlier read delivered stays usable: a printer gone since then
   * is refused by the print itself, under the chooser. */
  #renderPrinters() {
    const printers = this.printers;
    if (this.mode === "invoice" && this.deliveryBusy)
      return this.sentTo !== null
        ? nothing
        : html`<p role="status" data-test="print-busy">
            ${codeMessage("invoice_delivery.active")}
          </p>`;
    if (printers === null || printers.length === 0) {
      if (this.printersFailed) return nothing;
      if (printers === null)
        return html`<p role="status" data-test="printers-loading">
          <wt-spinner decorative size="sm"></wt-spinner> ${t("orders.reprint.loading")}
        </p>`;
      return html`<p>${t("orders.reprint.no_printers")}</p>`;
    }
    return html`<wt-combobox
      name="printerId"
      search="auto"
      label=${t("orders.reprint.printer")}
      .options=${printers.map((printer) => ({
        value: printer.id,
        label:
          printer.kind === "a4"
            ? fill("orders.reprint.a4_choice", { name: printer.name })
            : printer.name,
      }))}
      .value=${this.printerId}
      .error=${this.printerError ?? ""}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        this.printerId = event.detail.value;
        this.printerError = null;
      }}
    ></wt-combobox>`;
  }

  async #print(): Promise<void> {
    if (this.row === null || this.printerId === "" || this.printing) return;
    this.printing = true;
    this.printerError = null;
    this.#showError(null);
    const invoice = this.mode === "invoice";
    try {
      if (invoice) {
        await this.api.requestOrderPrintDelivery(this.row.id, this.printerId, crypto.randomUUID());
        this.api.liveData.invalidate([{ type: "invoice_deliveries" }]);
      } else await this.api.reprintOrder(this.row.id, this.printerId);
      this.#sentKey =
        invoice && this.designation === "original"
          ? "orders.print_invoice.sent"
          : "orders.reprint.sent";
      this.sentTo = this.printers?.find((printer) => printer.id === this.printerId)?.name ?? "";
    } catch (error) {
      const code = codeOf(error);
      const message = codeMessage(code);
      if (code === "printer.not_found" || code === "invoice_delivery.printer_invalid")
        this.printerError = message;
      else this.#showError(message);
    } finally {
      this.printing = false;
    }
  }

  #heading(): string {
    if (this.mode === "receipt") return t("orders.reprint.title");
    return t(
      this.designation === "original"
        ? "orders.print_invoice.title"
        : "orders.print_invoice.copy_title",
    );
  }

  override render() {
    const invoice = this.mode === "invoice";
    const printers = invoice && this.deliveryBusy ? [] : (this.printers ?? []);
    const bill =
      this.row?.orderNumber === null
        ? (this.row.label ?? "")
        : t("orders.order_number").replace("{number}", String(this.row?.orderNumber ?? ""));
    return html`<wt-dialog .open=${this.row !== null} heading=${this.#heading()}>
      ${
        this.row
          ? html`<p>
              ${fill("orders.reprint.bill", { bill, invoice: this.row.invoiceNumber ?? "" })}
            </p>`
          : nothing
      }
      ${this.#renderPrinters()}
      ${this.sentTo === null ? nothing : html`<p role="status">${fill(this.#sentKey, { printer: this.sentTo })}</p>`}
      ${this.error === null ? nothing : html`<p role="alert">${this.error}</p>`}
      ${
        this.printersFailed
          ? html`<wt-button
              variant="secondary"
              data-test="printers-retry"
              @click=${() => this.#watchPrinters()}
              >${t("content_languages.retry")}</wt-button
            >`
          : nothing
      }
      <wt-button
        slot="footer"
        variant="secondary"
        @click=${() => this.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }))}
        >${t("action.cancel")}</wt-button
      >
      <wt-button
        slot="footer"
        variant=${this.printing || printers.length > 0 ? "primary" : "secondary"}
        data-test="print"
        ?disabled=${printers.length === 0}
        ?loading=${this.printing}
        @click=${() => void this.#print()}
        >${t(invoice && this.designation === "original" ? "orders.print_invoice.print" : "orders.reprint.print")}</wt-button
      >
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-order-reprint-dialog": OrderReprintDialog;
  }
}
