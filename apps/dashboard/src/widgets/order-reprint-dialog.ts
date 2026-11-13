import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-spinner.js";
import { readDocumentPrinter, rememberDocumentPrinter } from "../document-printer-preference.js";
import { DashboardQueries } from "../api/query-controller.js";
import type { DashboardApi, OfferedPrinter, OrderDetailDto, OrderRowDto } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { a4PrinterName } from "../i18n/domain.js";
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
  @property({ attribute: false }) mode: "choose" | "receipt" | "invoice" = "receipt";
  @state() private printers: { id: string; name: string; kind?: OfferedPrinter["kind"] }[] | null =
    null;
  @state() private designation: "original" | "duplicate" = "original";
  @state() private deliveryBusy = false;
  #firstOffer = true;
  @state() private unavailablePrinter = false;
  @state() private printersFailed = false;
  @state() private printerId = "";
  @state() private printing = false;
  #sending: { printer: string; original: boolean } | null = null;
  @state() private sentTo: string | null = null;
  #sentKey: "orders.reprint.sent" | "orders.print_invoice.sent" = "orders.reprint.sent";
  @state() private printerError: string | null = null;
  /** Counts openings, so a print sent from an earlier one never updates this one. */
  #opening = 0;
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

  #setPrinters(printers: { id: string; name: string; kind?: OfferedPrinter["kind"] }[]): void {
    this.printers = printers;
    const offered = (id: string) => printers.some((printer) => printer.id === id);
    if (this.#firstOffer) {
      const remembered = readDocumentPrinter(this.mode === "invoice" ? "invoice" : "receipt");
      this.printerId =
        remembered && offered(remembered)
          ? remembered
          : printers.length === 1
            ? printers[0]!.id
            : "";
      this.unavailablePrinter = remembered !== null && !offered(remembered);
      this.#firstOffer = false;
    } else if (this.printerId !== "" && !offered(this.printerId)) {
      this.printerId = "";
      this.unavailablePrinter = true;
    }
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("row") && !changed.has("mode")) return;
    if (changed.has("row") && this.row?.invoiceType === "F1" && !changed.has("mode"))
      this.mode = "choose";
    this.#opening += 1;
    this.#firstOffer = true;
    this.printerId = "";
    this.unavailablePrinter = false;
    this.printing = false;
    this.#sending = null;
    this.sentTo = null;
    this.printerError = null;
    this.#showError(null);
    // Another bill's offer, or the other mode's list, is never a printer this one may use.
    if (changed.has("mode") || this.mode === "invoice") {
      this.printers = null;
      this.deliveryBusy = false;
    }
    if (this.row === null || this.mode === "choose" || this.row.invoiceType === "F1")
      this.#queries.release("getOrderPrinters");
    if (this.row === null || this.mode === "choose" || this.row.invoiceType !== "F1")
      this.#queries.release("getOrder");
    if (this.row !== null && this.mode !== "choose") this.#watchPrinters();
  }

  /** An empty list is dropped so a fresh read says it is loading rather than that there is no
   * printer; a non-empty one stays usable until the read answers. */
  #watchPrinters(): void {
    if (this.printers?.length === 0) this.printers = null;
    this.printersFailed = false;
    if (this.#readErrorShown) this.#showError(null);
    if (this.row?.invoiceType === "F1") {
      this.#watchInvoice(this.row!.id);
      return;
    }
    void this.#queries
      .watch("getOrderPrinters", [], (printers) => {
        this.#setPrinters(printers);
        this.printersFailed = false;
      })
      .catch(() => undefined);
  }

  #watchInvoice(id: string): void {
    void this.#queries
      .watch("getOrder", [id], (detail: OrderDetailDto) => {
        const status = detail.deliveries;
        const print = status?.actions.print ?? null;
        this.printersFailed = false;
        // No print is offered either while a delivery is on its way or when no printer is active.
        this.deliveryBusy =
          print === null &&
          (status?.history ?? []).some(
            (attempt) => attempt.status === "queued" || attempt.status === "sending",
          );
        if (print === null) {
          this.#setPrinters([]);
          return;
        }
        this.designation = print.designation;
        this.#setPrinters(
          this.mode === "receipt"
            ? print.printers.filter((printer) => printer.kind === "receipt")
            : print.printers,
        );
      })
      .catch(() => undefined);
  }

  /** After a failed read, a list an earlier read delivered stays usable: a printer gone since then
   * is refused by the print itself, under the chooser. */
  #renderPrinters() {
    const printers = this.printers;
    if (this.row?.invoiceType === "F1" && this.deliveryBusy)
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
      required
      search="auto"
      label=${t("orders.reprint.printer")}
      .options=${printers.map((printer) => ({
        value: printer.id,
        label: printer.kind === "a4" ? a4PrinterName(printer.name) : printer.name,
      }))}
      .value=${this.printerId}
      .error=${this.printerError ?? ""}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        this.printerId = event.detail.value;
        this.unavailablePrinter = false;
        this.printerError = null;
      }}
    ></wt-combobox>`;
  }

  async #print(): Promise<void> {
    if (this.row === null || this.mode === "choose" || this.printerId === "" || this.printing)
      return;
    const document = this.mode;
    const opening = this.#opening;
    const billId = this.row.id;
    const printerId = this.printerId;
    const printerName = this.printers?.find((printer) => printer.id === printerId)?.name ?? "";
    this.#sending = {
      printer: printerName,
      original: this.row.invoiceType === "F1" && this.designation === "original",
    };
    this.printing = true;
    this.printerError = null;
    this.#showError(null);
    try {
      let sentKey: "orders.reprint.sent" | "orders.print_invoice.sent" = "orders.reprint.sent";
      if (this.row.invoiceType === "F1") {
        const attempt = await this.api.requestOrderPrintDelivery(
          billId,
          printerId,
          crypto.randomUUID(),
        );
        this.api.liveData.invalidate([{ type: "invoice_deliveries" }]);
        if (attempt.designation === "original") sentKey = "orders.print_invoice.sent";
      } else await this.api.reprintOrder(billId, printerId);
      rememberDocumentPrinter(document, printerId);
      if (opening !== this.#opening) return;
      this.#sentKey = sentKey;
      this.sentTo = printerName;
    } catch (error) {
      if (opening !== this.#opening) return;
      const code = codeOf(error);
      const message = codeMessage(code);
      if (code === "printer.not_found" || code === "invoice_delivery.printer_invalid")
        this.printerError = message;
      else this.#showError(message);
    } finally {
      if (opening === this.#opening) {
        this.printing = false;
        this.#sending = null;
      }
    }
  }

  #heading(): string {
    if (this.mode === "choose") return t("orders.print_document.title");
    if (this.mode === "receipt") return t("orders.reprint.title");
    return t(
      this.designation === "original"
        ? "orders.print_invoice.title"
        : "orders.print_invoice.copy_title",
    );
  }

  override render() {
    const invoice = this.row?.invoiceType === "F1";
    const printers = invoice && this.deliveryBusy ? [] : (this.printers ?? []);
    const selected = printers.find((printer) => printer.id === this.printerId);
    const sending = this.printing ? this.#sending : null;
    const printerName = sending?.printer ?? selected?.name;
    const original = sending?.original ?? (invoice && this.designation === "original");
    const action =
      printerName === undefined
        ? t(original ? "orders.print_invoice.print" : "orders.reprint.print")
        : fill(original ? "orders.print_document.print_on" : "orders.print_document.copy_on", {
            printer: printerName,
          });
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
      ${
        this.mode === "choose"
          ? html`<wt-combobox
              name="document"
              required
              label=${t("orders.print_document.document")}
              .value=${""}
              .options=${[
                { value: "receipt", label: t("orders.print_document.receipt") },
                { value: "invoice", label: t("orders.print_document.invoice") },
              ]}
              @wt-change=${(event: CustomEvent<{ value: "receipt" | "invoice" }>) => {
                this.mode = event.detail.value;
              }}
            ></wt-combobox>`
          : this.#renderPrinters()
      }
      ${this.unavailablePrinter ? html`<p role="status">${t("orders.print_document.unavailable")}</p>` : nothing}
      ${this.sentTo === null ? nothing : html`<p role="status">${fill(this.#sentKey, { printer: this.sentTo })}</p>`}
      ${
        this.printersFailed ||
        (this.mode !== "choose" && this.printers?.length === 0 && !this.deliveryBusy)
          ? html`<wt-button
              variant="secondary"
              data-test="printers-retry"
              @click=${() => {
                this.api.liveData.invalidate([{ type: "printers" }]);
                this.#watchPrinters();
              }}
              >${t(this.printersFailed ? "content_languages.retry" : "orders.reprint.refresh")}</wt-button
            >`
          : nothing
      }
      <wt-form-actions
        slot="footer"
        .error=${this.printerError ? t("form.fix_fields") : (this.error ?? "")}
      >
        ${
          invoice && this.mode !== "choose"
            ? html`<wt-button
                slot="cancel"
                variant="secondary"
                data-test="document-back"
                @click=${() => {
                  this.mode = "choose";
                }}
                >${t("hours.back")}</wt-button
              >`
            : nothing
        }
        <wt-button
          slot="cancel"
          variant="secondary"
          @click=${() => this.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }))}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          variant=${this.printing || printers.some((printer) => printer.id === this.printerId) ? "primary" : "secondary"}
          data-test="print"
          ?disabled=${!printers.some((printer) => printer.id === this.printerId)}
          ?loading=${this.printing}
          @click=${() => void this.#print()}
          >${action}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-order-reprint-dialog": OrderReprintDialog;
  }
}
