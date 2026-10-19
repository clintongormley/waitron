import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { compareDecimal, decimal, formatMoney } from "@waitron/shared";
import { baseStyles, focusFirstInvalid, submitOnEnter } from "@waitron/ui";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "./pay-equipment.js";
import type { PayEquipmentRole } from "./pay-equipment.js";
import { guestsStepper, guestsStepperStyles, guestsText, parseGuestCount } from "./guest-count.js";
import { trackDialog } from "./track-dialog.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { DeviceEquipment } from "../api/client.js";
import { typedAmount } from "../state/bill-payment.js";
import {
  heldForEquipment,
  payRowWantsOpen,
  readyPayReader,
  type FixedReader,
} from "../state/pay-equipment.js";

type Method = "card" | "cash" | "manual";
type Field = "tendered" | "externalRef" | "guests";

/** `presented-pay`'s detail; `guests` is absent unless the venue asks for it, null for none. */
export type PresentedPayDetail =
  | { method: "card"; readerId: string; guests?: number | null }
  | { method: "cash"; tendered: string; guests?: number | null }
  | { method: "manual"; externalRef?: string; guests?: number | null };

export interface PresentedPayRefusal {
  code: string;
  field?: string;
}

/**
 * A presented bill's pay sheet on a handheld: the whole amount, in one payment, by card on the
 * reader the row names, in cash, or on another card machine. It only asks: `presented-pay` carries
 * what to take, and the app answers with {@link busy} and {@link refusal}.
 */
@customElement("till-presented-pay-dialog")
export class TillPresentedPayDialog extends LitElement {
  static override styles = [
    baseStyles,
    guestsStepperStyles,
    css`
      .body {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
      }

      p {
        margin: 0;
      }

      .balance {
        display: flex;
        flex-direction: column;
        margin: 0;
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }

      .balance dt {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .balance dd {
        margin: 0;
        font-weight: var(--wt-font-weight-bold);
      }

      .whole {
        overflow-wrap: anywhere;
      }

      .choice {
        margin: 0;
        padding: 0;
        border: none;
        min-width: 0;
      }

      .choice legend {
        padding: 0;
        margin-bottom: var(--wt-space-2);
        font-weight: var(--wt-font-weight-bold);
      }

      .options {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-1) var(--wt-space-4);
      }

      .option {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        cursor: pointer;
        overflow-wrap: anywhere;
      }

      .option input {
        flex: none;
        accent-color: var(--wt-color-primary);
      }

      .muted {
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  /** The bill's whole amount. */
  @property() amount = "";
  @property() tableName = "";
  @property({ type: Boolean }) takesCash = false;
  @property({ type: Boolean }) takesManualCard = false;
  /** The profile takes a card on a reader the till drives. */
  @property({ type: Boolean }) takesReaderCard = false;
  @property({ type: Boolean }) asksGuests = false;
  /** The count the guests field starts on; null starts it empty. */
  @property({ attribute: false }) receiptGuests: number | null = null;
  @property({ attribute: false }) equipment: DeviceEquipment | null = null;
  @property({ attribute: false }) equipmentSaving: { role: PayEquipmentRole; id: string } | null =
    null;
  @property({ attribute: false }) equipmentErrors: Partial<Record<PayEquipmentRole, string>> = {};
  @property({ attribute: false }) readerReason: string | null = null;
  @property({ type: Boolean }) canScan = false;
  @property({ type: Boolean }) askNfc = false;
  /** An equipment change is out: nothing is taken until it is answered. */
  @property({ type: Boolean }) equipmentBusy = false;
  @property({ attribute: false }) fixedReader: FixedReader | null = null;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) refusal: PresentedPayRefusal | null = null;

  @state() private method: Method = "card";
  @state() private tendered = "";
  @state() private externalRef = "";
  @state() private attempted = false;
  /** The waiter's own guests value; undefined follows {@link receiptGuests}. */
  @state() private guestsEntry?: string;
  /** The refusal still shown: it goes when the field it names changes, or at the next request. */
  @state() private shownRefusal: PresentedPayRefusal | null = null;
  @state() private rowOpen = false;
  #rowWanted = false;

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("open") && this.open) {
      this.method = this.#methods()[0] ?? "card";
      this.tendered = "";
      this.externalRef = "";
      this.attempted = false;
      this.guestsEntry = undefined;
      this.rowOpen = false;
      this.#rowWanted = false;
    }
    const offered = this.#methods();
    if (offered.length > 0 && !offered.includes(this.method)) this.method = offered[0]!;
    if (changed.has("refusal")) this.shownRefusal = this.refusal;
    const wanted = this.open && payRowWantsOpen(this.equipment, this.fixedReader);
    if (wanted && !this.#rowWanted) this.rowOpen = true;
    this.#rowWanted = wanted;
  }

  #methods(): Method[] {
    return [
      ...(this.takesReaderCard ? (["card"] as const) : []),
      ...(this.takesCash ? (["cash"] as const) : []),
      ...(this.takesManualCard ? (["manual"] as const) : []),
    ];
  }

  #offered(): boolean {
    return this.#methods().length > 0;
  }

  #held(): boolean {
    return heldForEquipment(this.method === "card", this);
  }

  #money(amount: string): string {
    return formatMoney(amount, currentLocale());
  }

  #guestsText(): string {
    return guestsText(this.guestsEntry, this.receiptGuests);
  }

  #ownErrors(): Map<Field, string> {
    const errors = new Map<Field, string>();
    if (this.method === "cash") {
      const tendered = typedAmount(this.tendered);
      if (tendered === null || compareDecimal(decimal(tendered), decimal("0")) <= 0)
        errors.set("tendered", t("bill_pay.tendered_invalid"));
      else if (compareDecimal(decimal(tendered), decimal(this.amount)) < 0)
        errors.set("tendered", t("bill_pay.tendered_short"));
    }
    if (this.asksGuests && parseGuestCount(this.#guestsText()) === undefined)
      errors.set("guests", t("seat.guest_count_invalid"));
    return errors;
  }

  /** The shown field a refusal names, or null when it names none shown. */
  #refusalField(): Field | null {
    const named = this.shownRefusal?.field;
    if (named === "tendered" && this.method === "cash") return "tendered";
    if (named === "externalRef" && this.method === "manual") return "externalRef";
    if (named === "guests" && this.asksGuests) return "guests";
    return null;
  }

  #fieldErrors(own: ReadonlyMap<Field, string>): Map<Field, string> {
    const errors = new Map(own);
    const field = this.#refusalField();
    if (field !== null) errors.set(field, codeMessage(this.shownRefusal!.code));
    return errors;
  }

  #bottomMessage(fieldErrors: ReadonlyMap<Field, string>): string {
    const parts: string[] = [];
    if (fieldErrors.size > 0) parts.push(t("form.fix_fields"));
    if (this.shownRefusal !== null && this.#refusalField() === null)
      parts.push(codeMessage(this.shownRefusal.code));
    return parts.join(" ");
  }

  #changed(field: Field): void {
    if (this.#refusalField() === field) this.shownRefusal = null;
  }

  #emit(type: string, detail: unknown = {}): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #close(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || this.busy) return;
    this.#emit("presented-pay-close");
  }

  #requestClose(): void {
    if (this.busy) return;
    void this.shadowRoot!.querySelector<HTMLElement & { requestClose(reason: "cancel"): unknown }>(
      "wt-dialog",
    )!.requestClose("cancel");
  }

  async #take(): Promise<void> {
    if (!this.open || this.busy || !this.#offered() || this.#held()) return;
    this.attempted = true;
    this.shownRefusal = null;
    if (this.#ownErrors().size > 0) {
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    const guests = this.asksGuests
      ? { guests: parseGuestCount(this.#guestsText())?.guestCount ?? null }
      : {};
    const ref = this.externalRef.trim();
    const detail: PresentedPayDetail =
      this.method === "card"
        ? {
            method: "card",
            readerId: readyPayReader(this.equipment, this.fixedReader)!.id,
            ...guests,
          }
        : this.method === "cash"
          ? { method: "cash", tendered: typedAmount(this.tendered)!, ...guests }
          : { method: "manual", ...(ref === "" ? {} : { externalRef: ref }), ...guests };
    this.#emit("presented-pay", detail);
  }

  override render() {
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.open}
      .heading=${
        this.tableName === ""
          ? t("bill_pay.title")
          : t("bill_pay.title_table").replace("{table}", () => this.tableName)
      }
      .dismissible=${!this.busy}
      @wt-close=${(event: Event) => this.#close(event)}
    >
      <div class="body">${this.#form()}</div>
    </wt-dialog>`;
  }

  #form(): TemplateResult {
    const own = this.attempted ? this.#ownErrors() : new Map<Field, string>();
    const errors = this.#fieldErrors(own);
    const reader = this.method === "card" ? readyPayReader(this.equipment, this.fixedReader) : null;
    return html`<dl class="balance" data-presented-pay-balance>
        <dt>${t("presented_pay.balance")}</dt>
        <dd>${this.#money(this.amount)}</dd>
      </dl>
      <p class="whole" data-presented-pay-whole>${t("presented_pay.whole_only")}</p>
      ${this.#methodFields(errors)}
      ${this.asksGuests ? this.#guests(errors.get("guests")) : nothing}
      <wt-form-actions .error=${this.#bottomMessage(errors)}>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-presented-pay-close
          .disabled=${this.busy}
          @click=${() => this.#requestClose()}
        >
          ${t("bill_pay.close")}
        </wt-button>
        <wt-button
          variant="primary"
          data-presented-pay-take
          .loading=${this.busy}
          .disabled=${this.busy || own.size > 0 || !this.#offered() || this.#held()}
          @click=${() => void this.#take()}
        >
          ${
            reader === null
              ? t("bill_pay.take")
              : t("bill_pay.take_on_reader")
                  .replace("{amount}", () => this.#money(this.amount))
                  .replace("{reader}", () => reader.name)
          }
        </wt-button>
      </wt-form-actions>`;
  }

  #methodRadio(method: Method): TemplateResult {
    const label = {
      card: "tender.card",
      cash: "tender.cash",
      manual: "bill_pay.method_other_terminal",
    } as const;
    return html`<label class="option">
      <input
        type="radio"
        name="method"
        .value=${method}
        .checked=${this.method === method}
        @change=${(event: Event) => {
          event.stopPropagation();
          this.method = method;
        }}
      />
      <span>${t(label[method])}</span>
    </label>`;
  }

  #methodFields(errors: ReadonlyMap<Field, string>): TemplateResult {
    const methods = this.#methods();
    return html`<fieldset class="choice" data-pay-method ?disabled=${this.busy}>
        <legend>${t("bill_pay.method")}</legend>
        ${
          methods.length === 0
            ? html`<p class="muted" data-pay-no-method>${t("bill_pay.no_method")}</p>`
            : html`<div class="options">${methods.map((method) => this.#methodRadio(method))}</div>`
        }
      </fieldset>
      ${
        methods.length === 0
          ? nothing
          : html`${
              this.method === "cash"
                ? this.#input("tendered", t("bill_pay.tendered"), this.tendered, {
                    required: true,
                    error: errors.get("tendered"),
                  })
                : this.method === "manual"
                  ? this.#input("externalRef", t("tender.card_ref"), this.externalRef, {
                      error: errors.get("externalRef"),
                    })
                  : nothing
            }
            ${this.#equipmentRow()}`
      }`;
  }

  #input(
    name: "tendered" | "externalRef",
    label: string,
    value: string,
    opts: { required?: boolean; error?: string },
  ): TemplateResult {
    return html`<wt-input
      name=${name}
      decimal-locale=${name === "tendered" ? currentLocale() : nothing}
      autocomplete="off"
      .disabled=${this.busy}
      .label=${label}
      .value=${value}
      .required=${opts.required === true}
      .error=${opts.error ?? ""}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        if (name === "tendered") this.tendered = event.detail.value;
        else this.externalRef = event.detail.value;
        this.#changed(name);
      }}
      @keydown=${(event: KeyboardEvent) =>
        submitOnEnter(
          event,
          this.shadowRoot!.querySelector<HTMLElement>("[data-presented-pay-take]"),
        )}
    ></wt-input>`;
  }

  /** The reader and printer row; its events bubble out to the app unchanged. */
  #equipmentRow(): TemplateResult {
    return html`<till-pay-equipment
      .equipment=${this.equipment}
      .cardRequired=${this.method === "card"}
      .open=${this.rowOpen}
      .saving=${this.equipmentSaving}
      .fieldErrors=${this.equipmentErrors}
      .readerReason=${this.readerReason}
      .canScan=${this.canScan}
      .askNfc=${this.askNfc}
      .disabled=${this.busy}
      .fixedReader=${this.fixedReader}
      @pay-equipment-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        (this.rowOpen = event.detail.open)}
    ></till-pay-equipment>`;
  }

  #guests(error: string | undefined): TemplateResult {
    return guestsStepper({
      text: this.#guestsText(),
      disabled: this.busy,
      error: error ?? "",
      onChange: (event) => {
        event.stopPropagation();
        this.guestsEntry = (event as CustomEvent<{ value: string }>).detail.value;
        this.#changed("guests");
      },
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-presented-pay-dialog": TillPresentedPayDialog;
  }
}
