import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { baseStyles } from "@waitron/ui";
import type { ComboboxOption } from "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import { optionLabel } from "./equipment-labels.js";
import { carriedText, t } from "../i18n/t.js";
import type { DeviceEquipment, EquipmentItem } from "../api/client.js";
import {
  payPrinterOf,
  payReaderOf,
  printerChoices,
  readerChoices,
} from "../state/pay-equipment.js";

export type PayEquipmentRole = "card_terminal" | "receipt";

export interface PayEquipmentPick {
  role: PayEquipmentRole;
  id: string;
  takeOver: boolean;
}

/**
 * The pay sheet's folded "reader and printer" row: closed, a line naming both with Cambiar; opened,
 * the two drop-downs. It only shows and asks; the parent owns `open` and sends every change.
 */
@customElement("till-pay-equipment")
export class TillPayEquipment extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .row {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
      }

      .line {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
      }

      .text {
        flex: 1;
        min-width: 0;
        overflow-wrap: anywhere;
      }

      .heading {
        display: block;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      :host([open]) .heading {
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
      }

      .buttons {
        display: flex;
        flex: none;
        gap: var(--wt-space-2);
      }

      .note {
        margin: var(--wt-space-1) 0 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .reason {
        margin: 0 0 var(--wt-space-3);
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-warning);
        border-radius: var(--wt-radius-md);
        overflow-wrap: anywhere;
      }

      .question {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        padding-top: var(--wt-space-3);
        border-top: 1px solid var(--wt-color-border);
      }

      .question-title {
        font-weight: var(--wt-font-weight-bold);
      }

      .question p {
        margin: 0;
        overflow-wrap: anywhere;
      }

      .question-buttons {
        display: flex;
        gap: var(--wt-space-2);
        justify-content: flex-end;
      }
    `,
  ];

  /** As the server last said; `null` before it has been read. */
  @property({ attribute: false }) equipment: DeviceEquipment | null = null;
  /** A card is the payment method, so the reader is required. */
  @property({ type: Boolean }) cardRequired = false;
  @property({ type: Boolean, reflect: true }) open = false;
  @property({ attribute: false }) saving: { role: PayEquipmentRole; id: string } | null = null;
  @property({ attribute: false }) fieldErrors: Partial<Record<PayEquipmentRole, string>> = {};
  /** Why the phone no longer has the reader it had, shown above the row. */
  @property({ attribute: false }) readerReason: string | null = null;
  @property({ type: Boolean }) canScan = false;
  @property({ type: Boolean }) askNfc = false;
  @property({ type: Boolean }) disabled = false;
  /** A practice venue's demo reader: shown, never chosen. */
  @property({ attribute: false }) fixedReader: { id: string; name: string } | null = null;
  @state() private asking: { role: PayEquipmentRole; item: EquipmentItem } | null = null;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("open") && !this.open) this.asking = null;
  }

  #emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }));
  }

  #summary(): TemplateResult {
    if (this.equipment === null) return html`${t("pay_equipment.reading")}`;
    const reader = payReaderOf(this.equipment);
    const readerName = this.fixedReader?.name ?? (reader.kind === "ready" ? reader.name : null);
    const printer = payPrinterOf(this.equipment);
    let ticket: TemplateResult;
    if (printer.kind === "ready") {
      const [before, after = ""] = t(
        printer.fromDefault ? "pay_equipment.ticket_at_default" : "pay_equipment.ticket_at",
      ).split("{printer}");
      ticket = html`${before}<b>${printer.name}</b>${after}`;
    } else {
      ticket = html`${t("pay_equipment.no_ticket")}`;
    }
    return html`${readerName === null ? t("pay_equipment.no_reader") : html`<b>${readerName}</b>`} ·
    ${ticket}`;
  }

  #buttons(): TemplateResult {
    return html`<div class="buttons">
      ${
        this.askNfc
          ? html`<wt-button
              data-pay-nfc
              variant="secondary"
              size="sm"
              aria-label=${t("equipment.nfc_allow")}
              ?disabled=${this.disabled}
              @click=${() => this.#emit("pay-equipment-nfc", {})}
              >NFC</wt-button
            >`
          : nothing
      }
      ${
        this.canScan
          ? html`<wt-button
              data-pay-qr
              variant="secondary"
              size="sm"
              aria-label=${t("equipment.scan_qr")}
              ?disabled=${this.disabled}
              @click=${() => this.#emit("pay-equipment-qr", {})}
              >${t("pay_equipment.qr")}</wt-button
            >`
          : nothing
      }
      ${
        this.open
          ? nothing
          : html`<wt-button
              data-pay-equipment-change
              variant="secondary"
              size="sm"
              ?disabled=${this.disabled}
              @click=${() => this.#emit("pay-equipment-toggle", { open: true })}
              >${t("pay_equipment.change")}</wt-button
            >`
      }
    </div>`;
  }

  #onPick(role: PayEquipmentRole, current: string, choices: EquipmentItem[], value: string): void {
    if (value === "" || value === current) return;
    const picked = choices.find((choice) => choice.id === value);
    if (picked?.heldBy && !picked.busy) {
      this.asking = { role, item: picked };
      return;
    }
    this.#emit<PayEquipmentPick>("pay-equipment-pick", { role, id: value, takeOver: false });
  }

  #field(
    role: PayEquipmentRole,
    ready: { id: string; name: string; fromDefault: boolean } | null,
    choices: EquipmentItem[],
  ): TemplateResult {
    const reader = role === "card_terminal";
    const saving = this.saving?.role === role ? this.saving : null;
    const current = ready?.id ?? "";
    const value = saving?.id ?? current;
    const options: ComboboxOption[] = choices.map((choice) => ({
      value: choice.id,
      label: optionLabel(choice),
      ...(choice.busy ? { disabled: true } : {}),
    }));
    if (ready !== null && !choices.some((choice) => choice.id === ready.id))
      options.unshift({ value: ready.id, label: ready.name });
    const hint =
      saving !== null
        ? t("pay_equipment.saving")
        : ready?.fromDefault
          ? t("equipment.from_default")
          : "";
    const error = this.fieldErrors[role] ?? "";
    // wt-combobox draws its hint for screen readers only; the note under the field is what is seen.
    return html`<div class="field">
      <wt-combobox
        name=${reader ? "cardReaderId" : "receiptPrinterId"}
        search="never"
        label=${t(reader ? "equipment.card_terminal" : "equipment.receipt")}
        placeholder=${t(reader ? "pay_equipment.reader_placeholder" : "pay_equipment.printer_placeholder")}
        ?required=${reader && this.cardRequired}
        ?disabled=${this.disabled}
        .options=${options}
        .value=${live(value)}
        .hint=${hint}
        .error=${error}
        .invalid=${error !== ""}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.#onPick(role, current, choices, event.detail.value);
          this.requestUpdate();
        }}
      ></wt-combobox
      >${
        hint === ""
          ? nothing
          : html`<p class="note" aria-hidden="true" data-pay-note=${role}>${hint}</p>`
      }
    </div>`;
  }

  #readerField(equipment: DeviceEquipment): TemplateResult {
    const fixed = this.fixedReader;
    if (fixed !== null)
      return html`<wt-combobox
        name="cardReaderId"
        search="never"
        label=${t("equipment.card_terminal")}
        disabled
        .options=${[{ value: fixed.id, label: fixed.name }]}
        .value=${fixed.id}
      ></wt-combobox>`;
    const reader = payReaderOf(equipment);
    return this.#field(
      "card_terminal",
      reader.kind === "ready" ? reader : null,
      readerChoices(equipment),
    );
  }

  #question(): TemplateResult | typeof nothing {
    const asking = this.asking;
    if (asking === null) return nothing;
    return html`<div class="question" role="group" aria-labelledby="take-title">
      <p id="take-title" class="question-title" data-pay-take-title>${t("equipment.take_title")}</p>
      <p data-pay-take-question>
        ${carriedText(
          asking.item.name,
          asking.item.heldBy!,
          "equipment.take_question",
          "equipment.take_question_person",
        )}
      </p>
      <div class="question-buttons">
        <wt-button
          data-pay-take-back
          variant="secondary"
          ?disabled=${this.disabled}
          @click=${() => (this.asking = null)}
          >${t("pay_equipment.take_back")}</wt-button
        >
        <wt-button
          data-pay-take
          variant="primary"
          ?disabled=${this.disabled}
          @click=${() => {
            this.asking = null;
            this.#emit<PayEquipmentPick>("pay-equipment-pick", {
              role: asking.role,
              id: asking.item.id,
              takeOver: true,
            });
          }}
          >${t("equipment.take")}</wt-button
        >
      </div>
    </div>`;
  }

  override render() {
    return html`${
      this.readerReason === null
        ? nothing
        : html`<p class="reason" role="status" data-pay-reader-reason>${this.readerReason}</p>`
    }${this.#row()}`;
  }

  #row(): TemplateResult {
    const equipment = this.equipment;
    const heading = html`<span class="heading" data-pay-equipment-heading
      >${t("pay_equipment.heading")}</span
    >`;
    if (!this.open)
      return html`<div class="row" data-pay-equipment>
        <div class="line">
          <div class="text">
            ${heading}
            <span data-pay-equipment-summary>${this.#summary()}</span>
          </div>
          ${this.#buttons()}
        </div>
      </div>`;
    const printer = equipment === null ? null : payPrinterOf(equipment);
    return html`<div class="row" data-pay-equipment>
      <div class="line">
        <div class="text">${heading}</div>
        ${this.#buttons()}
      </div>
      ${
        equipment === null
          ? html`<span data-pay-equipment-summary>${t("pay_equipment.reading")}</span>`
          : html`${this.#readerField(equipment)}
            ${this.#field(
              "receipt",
              printer?.kind === "ready" ? printer : null,
              printerChoices(equipment),
            )}`
      }
      ${this.#question()}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-pay-equipment": TillPayEquipment;
  }
}
