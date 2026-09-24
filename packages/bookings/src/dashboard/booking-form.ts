import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { submitOnEnter, baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "./strings.js";
import { codeMessage } from "@waitron/dashboard-kit";
import type { Booking, BookingInput, BookingPatch, DashboardTable } from "./client.js";

export interface UpdateBookingDetail {
  id: string;
  patch: BookingPatch;
}

const POSITIVE_INT = /^\d+$/;

/**
 * Does not call the API or close itself on confirm: the screen closes it after a successful write, so
 * a refused write leaves the entered values in place. The date and time go out as plain local values
 * (design §2b), never an instant.
 */
@customElement("dashboard-booking-form")
export class BookingForm extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }
      .field {
        display: block;
        margin-bottom: var(--wt-space-4);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) open = false;

  /** Null for a create. */
  @property({ attribute: false }) booking: Booking | null = null;

  @property({ attribute: false }) tables: DashboardTable[] = [];

  /** The day the screen is showing; a create starts on it. */
  @property() defaultDate = "";

  /** Set by the screen while a write is in flight; confirm is then a no-op. */
  @property({ type: Boolean }) busy = false;

  @state() private date = "";
  @state() private time = "";
  @state() private partySize = "";
  @state() private contactName = "";
  @state() private contactPhone = "";
  @state() private notes = "";
  @state() private tableId = "";
  @state() private validationError: string | null = null;

  override willUpdate(changed: PropertyValues): void {
    if (!changed.has("booking") && !(changed.has("open") && this.open)) return;
    const b = this.booking;
    this.date = b?.bookingDate ?? this.defaultDate;
    this.time = b ? b.bookingTime.slice(0, 5) : "";
    this.partySize = b ? String(b.partySize) : "";
    this.contactName = b?.contactName ?? "";
    this.contactPhone = b?.contactPhone ?? "";
    this.notes = b?.notes ?? "";
    this.tableId = b?.tableId ?? "";
    this.validationError = null;
  }

  #onFieldChange(
    event: CustomEvent<{ value: string }>,
    field: "date" | "time" | "partySize" | "contactName" | "contactPhone" | "notes",
  ): void {
    event.stopPropagation();
    this[field] = event.detail.value;
    if (this.validationError) this.validationError = null;
  }

  #onTableChange(event: Event): void {
    event.stopPropagation();
    this.tableId = (event.target as HTMLSelectElement).value;
  }

  #validate(): string | null {
    if (this.date.trim() === "" || this.time.trim() === "" || this.contactName.trim() === "") {
      return "booking.fields_required";
    }
    if (!POSITIVE_INT.test(this.partySize) || Number(this.partySize) < 1) {
      return "booking.party_invalid";
    }
    return null;
  }

  #confirm(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    const error = this.#validate();
    if (error !== null) {
      this.validationError = error;
      return;
    }
    this.validationError = null;

    const body: BookingInput = {
      bookingDate: this.date,
      bookingTime: this.time,
      partySize: Number(this.partySize),
      contactName: this.contactName,
      contactPhone: this.contactPhone.trim() === "" ? null : this.contactPhone,
      notes: this.notes.trim() === "" ? null : this.notes,
      tableId: this.tableId === "" ? null : this.tableId,
    };

    if (this.booking) {
      this.dispatchEvent(
        new CustomEvent<UpdateBookingDetail>("update-booking", {
          detail: { id: this.booking.id, patch: body },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }
    this.dispatchEvent(
      new CustomEvent<BookingInput>("create-booking", {
        detail: body,
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** No `stopPropagation`: `wt-close` must reach the screen, which owns the open state. */
  #onClose(): void {
    this.open = false;
  }

  override render() {
    return html`
      <wt-dialog
        @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]"))}
        heading=${this.booking ? t("booking.edit") : t("booking.new")}
        .open=${this.open}
        @wt-close=${() => this.#onClose()}
      >
        <wt-input
          class="field"
          type="date"
          data-test="booking-date"
          label=${t("booking.date")}
          .value=${this.date}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onFieldChange(e, "date")}
        ></wt-input>
        <wt-input
          class="field"
          type="time"
          data-test="booking-time"
          label=${t("booking.time")}
          .value=${this.time}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onFieldChange(e, "time")}
        ></wt-input>
        <wt-input
          class="field"
          type="number"
          data-test="party-size"
          label=${t("booking.party_size")}
          .value=${this.partySize}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onFieldChange(e, "partySize")}
        ></wt-input>
        <wt-input
          class="field"
          data-test="contact-name"
          label=${t("booking.contact_name")}
          .value=${this.contactName}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onFieldChange(e, "contactName")}
        ></wt-input>
        <wt-input
          class="field"
          data-test="contact-phone"
          label=${t("booking.contact_phone")}
          .value=${this.contactPhone}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onFieldChange(e, "contactPhone")}
        ></wt-input>
        <wt-input
          class="field"
          data-test="notes"
          label=${t("booking.notes")}
          .value=${this.notes}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onFieldChange(e, "notes")}
        ></wt-input>
        <label class="field"
          >${t("booking.table")}
          <select data-test="booking-table" @change=${(e: Event) => this.#onTableChange(e)}>
            <option value="" .selected=${this.tableId === ""}>${t("booking.table_none")}</option>
            ${this.tables.map(
              (table) =>
                html`<option value=${table.id} .selected=${table.id === this.tableId}>
                  ${table.label}
                </option>`,
            )}
          </select>
        </label>

        ${
          this.validationError
            ? html`<p class="error" role="alert" data-test="error">
                ${codeMessage(this.validationError)}
              </p>`
            : nothing
        }
        <wt-button
          slot="footer"
          variant="primary"
          data-test="confirm"
          ?disabled=${this.busy}
          @click=${(e: Event) => this.#confirm(e)}
          >${this.booking ? t("action.save") : t("action.create")}</wt-button
        >
      </wt-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-booking-form": BookingForm;
  }
}
