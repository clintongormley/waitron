import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { submitOnEnter, baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { Booking, BookingInput, BookingPatch, DashboardTable } from "../api/client.js";

/** The `update-booking` event detail: the booking id + a patch of its edited fields. */
export interface UpdateBookingDetail {
  id: string;
  patch: BookingPatch;
}

/** A positive whole number (`1`, `12`) — the party-size check. Deliberately integer-only: a fractional
 * or empty party size is a data-entry slip, and the server enforces `> 0` besides. */
const POSITIVE_INT = /^\d+$/;

/**
 * The management dashboard's BOOKING FORM: a `wt-dialog` (create + edit) that captures a staff-entered
 * table reservation — the wall-clock date + time, the party size, the free-text contact (name, phone,
 * notes) and an OPTIONAL table assignment picked from TS-1's loaded tables. Modelled on
 * `purchase-form`/`shift-dialog`: the screen drives it by setting `.open`, `.tables`, `.defaultDate` and
 * (for an edit) `.booking`, and hears one of two composed events — `create-booking` (a `BookingInput`)
 * or `update-booking { id, patch }`. Like `purchase-form`, it does NOT call the API and does NOT close
 * itself on confirm — the screen closes it on a successful write, so a rejected write leaves the entered
 * values in place.
 *
 * ANTI-#52 (design §2b): the submitted body carries a PLAIN LOCAL `bookingDate` (`YYYY-MM-DD`) and
 * `bookingTime` (`HH:MM`), NEVER a `${day}T${time}Z` instant. A booking is a future wall-clock intention,
 * not a moment that has occurred, so storing it as an instant is the exact bug `shift-dialog.ts:85-86`
 * accepts as a slice-1 shortcut and this form must not copy. The time input works in `HH:MM`, and an
 * edit's `HH:MM:SS` server value is sliced to `HH:MM` for the input (the presentation edge normalises).
 *
 * SEEDING mirrors `purchase-form`: `willUpdate` reseeds every field from `booking` whenever it changes
 * or the dialog opens — a create (`booking` null) seeds the date to `defaultDate` (the day the screen is
 * showing) and leaves the rest blank; an edit fills every field.
 *
 * CLIENT VALIDATION mirrors the op's checks for UX (the server stays authoritative): the date, time and
 * name must be non-empty (`booking.fields_required`), and the party size must be a positive whole number
 * (`booking.party_invalid`). A failing check blocks confirm and shows a `role="alert"`. A single-flight
 * `busy` property (set by the screen while a write round-trips) makes confirm a no-op.
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

  /** Whether the dialog is showing. The screen sets this to open the form; it clears on close. */
  @property({ type: Boolean, reflect: true }) open = false;

  /** The booking being edited, or null for a create. Setting it pre-fills every field on the next open. */
  @property({ attribute: false }) booking: Booking | null = null;

  /** The active tables to offer in the optional table picker (from `DashboardApi.listTables`). */
  @property({ attribute: false }) tables: DashboardTable[] = [];

  /** The day the screen is showing (`YYYY-MM-DD`) — a create seeds its date here. */
  @property() defaultDate = "";

  /** Single-flight gate: the screen sets it true while a create/update is in flight; confirm is a no-op. */
  @property({ type: Boolean }) busy = false;

  @state() private date = "";
  @state() private time = "";
  @state() private partySize = "";
  @state() private contactName = "";
  @state() private contactPhone = "";
  @state() private notes = "";
  @state() private tableId = "";
  @state() private validationError: string | null = null;

  /**
   * Reseed every field from `booking` on an open or a booking change. A create (`booking` null) seeds the
   * date to `defaultDate` (the shown day) and leaves the rest blank; an edit fills from the loaded
   * booking, with the `HH:MM:SS` server time sliced to `HH:MM` for the time input (the anti-#52 §2b
   * presentation-edge normalisation).
   */
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

  // Native `change` is `composed: false`; `stopPropagation` is defensive consistency with the composed
  // handlers (the purchase-form pattern).
  #onTableChange(event: Event): void {
    event.stopPropagation();
    this.tableId = (event.target as HTMLSelectElement).value;
  }

  /** Validate the entered values against the op's checks; returns a code to show, or null when valid. */
  #validate(): string | null {
    if (this.date.trim() === "" || this.time.trim() === "" || this.contactName.trim() === "") {
      return "booking.fields_required";
    }
    if (!POSITIVE_INT.test(this.partySize) || Number(this.partySize) < 1) {
      return "booking.party_invalid";
    }
    return null;
  }

  /**
   * Assemble and emit the create/update event. `stopPropagation` keeps the confirm button's own composed
   * `click` inside this shadow boundary. Blocks (no event) on a `busy` gate and on a failed validation (a
   * `role="alert"` is shown instead). The body carries the PLAIN LOCAL date + time (§2b, anti-#52).
   */
  #confirm(event: Event): void {
    event.stopPropagation();
    if (this.busy) return; // single-flight: a second confirm while one is in flight is ignored
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

  /** The dialog closed. Drop `open`; like `purchase-form`, do NOT `stopPropagation` — the composed
   * `wt-close` must bubble on to the screen (the owner of the open state). */
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
