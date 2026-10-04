import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { trackDialog } from "./track-dialog.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { DevicePrintersChange, PrinterChoice } from "../api/client.js";

export interface PrinterSlot {
  current: string | null;
  choices: PrinterChoice[];
}

type Field = "receiptPrinterId" | "paymentSlipPrinterId";

/**
 * Shows the device's current receipt and payment slip printers, with a list to switch with where
 * the profile offers a printer the device could move to; the dialog only reports the switch, and the
 * app owns the request.
 */
@customElement("till-printers-dialog")
export class TillPrintersDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .fields {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
      }

      .row {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }

      .label {
        font-weight: var(--wt-font-weight-bold);
      }

      .shown {
        overflow-wrap: anywhere;
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) receipt: PrinterSlot = { current: null, choices: [] };
  @property({ attribute: false }) paymentSlip: PrinterSlot = { current: null, choices: [] };
  /** A refused switch; `field` names the printer it refused. */
  @property({ attribute: false }) error: { code: string; field?: string } | null = null;

  #emit<T>(type: string, detail?: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }));
  }

  /** A list whenever there is a printer to move to: more than one, or one the device is not on. */
  #pickable(slot: PrinterSlot): boolean {
    return (
      slot.choices.length > 1 ||
      (slot.choices.length > 0 && !slot.choices.some((choice) => choice.id === slot.current))
    );
  }

  /** The field a refusal is shown under, when this dialog shows it as a list. */
  #refusedField(): Field | null {
    const field = this.error?.field;
    if (field === "receiptPrinterId" && this.#pickable(this.receipt)) return field;
    if (field === "paymentSlipPrinterId" && this.#pickable(this.paymentSlip)) return field;
    return null;
  }

  #bottomMessage(): string {
    if (this.error === null) return "";
    return this.#refusedField() === null ? codeMessage(this.error.code) : t("form.fix_fields");
  }

  #row(key: "receipt" | "paymentSlip", field: Field, label: string): TemplateResult {
    const slot = this[key];
    // A current printer the profile no longer offers (switched off, or off the list) is not shown
    // as chosen: it is not one the device can be put back on.
    const current = slot.choices.find((choice) => choice.id === slot.current);
    if (this.#pickable(slot)) {
      return html`<div class="row" data-printer-row=${key}>
        <wt-combobox
          name=${field}
          search="auto"
          label=${label}
          placeholder=${t("printers.none")}
          searchPlaceholder=${t("form.combobox_search")}
          noResultsLabel=${t("form.combobox_no_results")}
          .options=${slot.choices.map((choice) => ({ value: choice.id, label: choice.name }))}
          .value=${live(current?.id ?? "")}
          .error=${this.#refusedField() === field ? codeMessage(this.error!.code) : ""}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.#emit<DevicePrintersChange>("printers-change", { [field]: event.detail.value });
          }}
        ></wt-combobox>
      </div>`;
    }
    return html`<div class="row" data-printer-row=${key}>
      <span class="label">${label}</span>
      <span class="shown" data-printer-shown>${current?.name ?? t("printers.none")}</span>
    </div>`;
  }

  override render() {
    if (!this.open) return nothing;
    return html`<wt-dialog
      ${trackDialog()}
      .open=${true}
      .heading=${t("printers.title")}
      @wt-close=${() => this.#emit("close")}
    >
      <div class="fields">
        ${this.#row("receipt", "receiptPrinterId", t("printers.receipt"))}
        ${this.#row("paymentSlip", "paymentSlipPrinterId", t("printers.payment_slip"))}
      </div>
      <wt-form-actions slot="footer" .error=${this.#bottomMessage()}>
        <wt-button data-printers-close variant="secondary" @click=${() => this.#emit("close")}>
          ${t("printers.close")}
        </wt-button>
      </wt-form-actions>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-printers-dialog": TillPrintersDialog;
  }
}
