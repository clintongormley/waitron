import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import { DashboardQueries } from "../api/query-controller.js";
import type { DashboardApi, OrderRowDto } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";

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
  @state() private printers: { id: string; name: string }[] | null = null;
  @state() private printerId = "";
  @state() private printing = false;
  @state() private sentTo: string | null = null;
  @state() private printerError: string | null = null;
  @state() private error: string | null = null;
  /** Whether `error` is a read's failure, the only message the reads' recovery may clear. */
  #readErrorShown = false;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => this.#showReadError(error),
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
    if (!changed.has("row")) return;
    this.sentTo = null;
    this.printerError = null;
    this.#showError(null);
    if (this.row === null) this.#queries.release("getOrderPrinters");
    else
      void this.#queries
        .watch("getOrderPrinters", [], (printers) => {
          this.printers = printers;
          if (!printers.some((printer) => printer.id === this.printerId))
            this.printerId = printers[0]?.id ?? "";
        })
        .catch(() => undefined);
  }

  async #print(): Promise<void> {
    if (this.row === null || this.printerId === "" || this.printing) return;
    this.printing = true;
    this.printerError = null;
    this.#showError(null);
    try {
      await this.api.reprintOrder(this.row.id, this.printerId);
      this.sentTo = this.printers?.find((printer) => printer.id === this.printerId)?.name ?? "";
    } catch (error) {
      const message = codeMessage(codeOf(error));
      if (codeOf(error) === "printer.not_found") this.printerError = message;
      else this.#showError(message);
    } finally {
      this.printing = false;
    }
  }

  override render() {
    const printers = this.printers ?? [];
    const bill =
      this.row?.orderNumber === null
        ? (this.row.label ?? "")
        : t("orders.order_number").replace("{number}", String(this.row?.orderNumber ?? ""));
    return html`<wt-dialog .open=${this.row !== null} heading=${t("orders.reprint.title")}>
      ${
        this.row
          ? html`<p>
              ${t("orders.reprint.bill")
                .replace("{bill}", bill)
                .replace("{invoice}", this.row.invoiceNumber ?? "")}
            </p>`
          : nothing
      }
      ${
        printers.length
          ? html`<wt-combobox
              name="printerId"
              search="auto"
              label=${t("orders.reprint.printer")}
              .options=${printers.map((printer) => ({ value: printer.id, label: printer.name }))}
              .value=${this.printerId}
              .error=${this.printerError ?? ""}
              @wt-change=${(event: CustomEvent<{ value: string }>) => {
                this.printerId = event.detail.value;
                this.printerError = null;
              }}
            ></wt-combobox>`
          : html`<p>${t("orders.reprint.no_printers")}</p>`
      }
      ${this.sentTo === null ? nothing : html`<p role="status">${t("orders.reprint.sent").replace("{printer}", this.sentTo)}</p>`}
      ${this.error === null ? nothing : html`<p role="alert">${this.error}</p>`}
      <wt-button
        slot="footer"
        variant="secondary"
        @click=${() => this.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }))}
        >${t("action.cancel")}</wt-button
      >
      <wt-button
        slot="footer"
        variant="primary"
        data-test="print"
        ?disabled=${printers.length === 0}
        ?loading=${this.printing}
        @click=${() => void this.#print()}
        >${t("orders.reprint.print")}</wt-button
      >
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-order-reprint-dialog": OrderReprintDialog;
  }
}
