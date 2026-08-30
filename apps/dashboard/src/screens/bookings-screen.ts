import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { bookingStatusName } from "../i18n/domain.js";
import { today } from "../date-utils.js";
// Value import (not `import type`): pull in the widget module for its `@customElement` side effect, so
// `<dashboard-booking-form>` is registered before this screen renders it (the purchases-screen pattern).
import "../widgets/booking-form.js";
import type { UpdateBookingDetail } from "../widgets/booking-form.js";
import type { Booking, BookingInput, DashboardApi, DashboardTable } from "../api/client.js";

/**
 * The management dashboard's BOOKINGS SCREEN (Bookings-1 §6): a per-day list of staff-entered table
 * reservations with create/edit and the lifecycle actions (seat / no-show / cancel). Modelled on
 * `purchases-screen` — it is the single owner of the loaded bookings, the selected day, the loaded
 * tables (for the form's picker + the seat prompt), the form's open/edit state and the error banner,
 * wiring the injected `DashboardApi` to the `<dashboard-booking-form>` dialog.
 *
 * ON CONNECT it loads the active tables (`listTables`, once) and the day's bookings
 * (`listBookings(today())`). A `<wt-input type="date">` seeded to `today()` drives the day: changing it
 * reloads. The list renders each booking as time · party · name · status, ORDERED BY TIME (defensively
 * re-sorted client-side though the server already orders), with the time shown as `HH:MM` (sliced from
 * the server's `HH:MM:SS` — the anti-#52 §2b presentation-edge normalisation) and the status localised
 * through the i18n layer (`bookingStatusName`, English source of truth), never a hardcoded literal.
 *
 * SEAT prompts for a table only when the booking has none assigned: an inline table picker arms in that
 * row and its confirm calls `seatBooking(id, { tableId })`; a booking that already has a table seats
 * straight away (`seatBooking(id)`, the server reusing its table). ERROR HANDLING mirrors
 * `purchases-screen`: every async path is `try/catch`ed, a rejection becomes an `errorKey` rendered in a
 * `role="alert"` banner (localised by `codeMessage`), and a single-flight `busy` gate drops a
 * double-fired mutation.
 */
@customElement("dashboard-bookings-screen")
export class BookingsScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
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
      .picker {
        display: block;
        margin-bottom: var(--wt-space-4);
        max-width: 16rem;
      }
      .list {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }
      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        flex-wrap: wrap;
      }
      .details {
        display: flex;
        align-items: baseline;
        gap: var(--wt-space-3);
        min-width: 0;
        flex-wrap: wrap;
      }
      .time {
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text);
      }
      .name {
        color: var(--wt-color-text);
      }
      .party,
      .status {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .controls {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        flex-wrap: wrap;
      }
      .seat-prompt {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        margin-top: var(--wt-space-2);
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

  @state() private bookings: Booking[] = [];
  @state() private tables: DashboardTable[] = [];
  @state() private date = today();
  @state() private formOpen = false;
  /** The booking the form is open for (null for a create). */
  @state() private editingBooking: Booking | null = null;
  /** The booking whose inline seat-table picker is armed (it has no table yet), or null. */
  @state() private seatingId: string | null = null;
  /** The table chosen in the armed seat picker. */
  @state() private seatTableId = "";
  @state() private errorKey: string | null = null;
  // Single-flight for the mutations, so a double-fired event files at most one call.
  @state() private busy = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#init();
  }

  /** Load the tables once (for the form picker + seat prompt), then the day's bookings. */
  async #init(): Promise<void> {
    this.errorKey = null;
    try {
      this.tables = await this.api.listTables();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
    await this.#load();
  }

  /** (Re)load the selected day's bookings. A rejection becomes the `errorKey` banner. */
  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      this.bookings = await this.api.listBookings(this.date);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Reload after a mutation. Throws to its caller's catch (so a reload failure surfaces the banner). */
  async #reload(): Promise<void> {
    this.bookings = await this.api.listBookings(this.date);
  }

  #onDateChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.date = event.detail.value;
    void this.#load();
  }

  /** Open the create form. Clears any prior error and the edit target. */
  #openForm(): void {
    this.errorKey = null;
    this.editingBooking = null;
    this.formOpen = true;
  }

  /** Edit `id` — resolve it against the list we hold (it is OURS; an unknown id is a stale event) and
   * open the form pre-filled. */
  #onEdit(id: string): void {
    const found = this.bookings.find((b) => b.id === id);
    if (found === undefined) return;
    this.errorKey = null;
    this.editingBooking = found;
    this.formOpen = true;
  }

  /** Create a booking from the form's detail, then close and reload. Single-flight. */
  async #onCreate(event: CustomEvent<BookingInput>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return;
    this.busy = true;
    this.errorKey = null;
    try {
      await this.api.createBooking(event.detail);
      this.formOpen = false;
      await this.#reload();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  /** Update a booking from the form's edit detail, then close and reload. Single-flight. */
  async #onUpdate(event: CustomEvent<UpdateBookingDetail>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return;
    this.busy = true;
    this.errorKey = null;
    try {
      await this.api.updateBooking(event.detail.id, event.detail.patch);
      this.formOpen = false;
      await this.#reload();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  /** The Seat row action: a booking with a table seats straight away; one without arms the inline
   * table picker (design §6 — "prompts for a table if none is assigned"). */
  #onSeatClick(b: Booking): void {
    if (b.tableId !== null) {
      void this.#seat(b.id);
      return;
    }
    this.errorKey = null;
    this.seatingId = b.id;
    this.seatTableId = this.tables[0]?.id ?? "";
  }

  /** Confirm the armed seat picker: seat with the chosen table. */
  #onSeatConfirm(id: string): void {
    void this.#seat(id, this.seatTableId === "" ? undefined : this.seatTableId);
  }

  /** Seat a booking — open a tab (optionally naming the table) and reload. Single-flight. */
  async #seat(id: string, tableId?: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.errorKey = null;
    try {
      await (tableId === undefined
        ? this.api.seatBooking(id)
        : this.api.seatBooking(id, { tableId }));
      this.seatingId = null;
      await this.#reload();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  /** A lifecycle move with no body (no-show / cancel), then reload. Single-flight. */
  async #lifecycle(op: (id: string) => Promise<void>, id: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.errorKey = null;
    try {
      await op(id);
      await this.#reload();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  /** The day's bookings ordered by time (defensive re-sort though the server already orders; ties keep
   * their relative order). */
  #ordered(): Booking[] {
    return [...this.bookings].sort((a, b) => a.bookingTime.localeCompare(b.bookingTime));
  }

  #renderRow(b: Booking): TemplateResult {
    const arming = this.seatingId === b.id;
    return html`<wt-card data-test="row">
      <div class="row">
        <div class="details">
          <span class="time" data-test="row-time">${b.bookingTime.slice(0, 5)}</span>
          <span class="name" data-test="row-name">${b.contactName}</span>
          <span class="party" data-test="row-party">${b.partySize}</span>
          <span class="status" data-test="row-status">${bookingStatusName(b.status)}</span>
        </div>
        <div class="controls">
          <wt-button
            size="sm"
            variant="primary"
            data-test=${`seat-${b.id}`}
            @click=${() => this.#onSeatClick(b)}
            >${t("booking.seat")}</wt-button
          >
          <wt-button
            size="sm"
            variant="secondary"
            data-test=${`no-show-${b.id}`}
            @click=${() => void this.#lifecycle((id) => this.api.markNoShow(id), b.id)}
            >${t("booking.no_show")}</wt-button
          >
          <wt-button
            size="sm"
            variant="danger"
            data-test=${`cancel-${b.id}`}
            @click=${() => void this.#lifecycle((id) => this.api.cancelBooking(id), b.id)}
            >${t("booking.cancel")}</wt-button
          >
          <wt-button
            size="sm"
            variant="ghost"
            data-test=${`edit-${b.id}`}
            @click=${() => this.#onEdit(b.id)}
            >${t("action.edit")}</wt-button
          >
        </div>
      </div>
      ${
        arming
          ? html`<div class="seat-prompt">
              <label class="prompt">
                ${t("booking.table")}
                <select
                  data-test=${`seat-table-${b.id}`}
                  @change=${(e: Event) =>
                    (this.seatTableId = (e.target as HTMLSelectElement).value)}
                >
                  ${this.tables.map(
                    (table) =>
                      html`<option value=${table.id} .selected=${table.id === this.seatTableId}>
                        ${table.label}
                      </option>`,
                  )}
                </select>
              </label>
              <wt-button
                size="sm"
                variant="primary"
                data-test=${`confirm-seat-${b.id}`}
                @click=${() => this.#onSeatConfirm(b.id)}
                >${t("booking.confirm_seat")}</wt-button
              >
            </div>`
          : nothing
      }
    </wt-card>`;
  }

  override render(): TemplateResult {
    const ordered = this.#ordered();
    return html`
      <div class="header">
        <h1 class="title">${t("booking.title")}</h1>
        <wt-button variant="primary" data-test="add-booking" @click=${() => this.#openForm()}
          >${t("booking.add")}</wt-button
        >
      </div>

      <wt-input
        class="picker"
        type="date"
        data-test="booking-date-picker"
        label=${t("booking.date")}
        .value=${this.date}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onDateChange(e)}
      ></wt-input>

      ${
        ordered.length > 0
          ? html`<div class="list">${ordered.map((b) => this.#renderRow(b))}</div>`
          : html`<p class="prompt" data-test="no-bookings">${t("booking.empty")}</p>`
      }
      ${this.errorKey ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>` : nothing}

      <dashboard-booking-form
        .open=${this.formOpen}
        .booking=${this.editingBooking}
        .tables=${this.tables}
        .defaultDate=${this.date}
        .busy=${this.busy}
        @create-booking=${(e: CustomEvent<BookingInput>) => void this.#onCreate(e)}
        @update-booking=${(e: CustomEvent<UpdateBookingDetail>) => void this.#onUpdate(e)}
        @wt-close=${() => (this.formOpen = false)}
      ></dashboard-booking-form>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-bookings-screen": BookingsScreen;
  }
}
