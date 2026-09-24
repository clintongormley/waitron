import { QUERY_DEPENDENCIES } from "./live-queries.js";
import { QueryController } from "@waitron/dashboard-kit";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-input.js";
import { t, bookingStatusName } from "./strings.js";
import { codeMessage, codeOf } from "@waitron/dashboard-kit";
import { today } from "./date-utils.js";
import "./booking-form.js";
import type { UpdateBookingDetail } from "./booking-form.js";
import type { Booking, BookingInput, BookingApi, DashboardTable } from "./client.js";

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

  @property({ attribute: false }) api!: BookingApi;
  readonly #queries = new QueryController(
    this,
    () => this.api.liveData,
    (error) => {
      this.errorKey = codeOf(error);
    },
  );

  @state() private bookings: Booking[] = [];
  @state() private tables: DashboardTable[] = [];
  @state() private date = today();
  @state() private formOpen = false;
  /** Null for a create. */
  @state() private editingBooking: Booking | null = null;
  @state() private seatingId: string | null = null;
  @state() private seatTableId = "";
  @state() private errorKey: string | null = null;
  // Single-flight, so a double-fired event makes at most one call.
  @state() private busy = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#init();
  }

  /** Bookings load first because `#load()` clears `errorKey`, which would hide a table-load failure. */
  async #init(): Promise<void> {
    await this.#load();
    try {
      let initial = true;
      await this.#queries.watch(
        "tables",
        {
          key: "bookings:tables",
          dependencies: QUERY_DEPENDENCIES.tables.map((type) => ({ type })),
          refreshMs: 60_000,
          read: () => {
            const api = initial ? this.api : (this.api.background ?? this.api);
            initial = false;
            return api.listTables();
          },
        },
        (value) => {
          this.tables = value;
        },
      );
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      await this.#observeBookings();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Throws, so the mutation's own catch shows a reload failure. */
  async #reload(): Promise<void> {
    await this.#observeBookings();
  }

  async #observeBookings(): Promise<void> {
    const date = this.date;
    let initial = true;
    await this.#queries.watch(
      "bookings",
      {
        key: `bookings:${date}`,
        dependencies: QUERY_DEPENDENCIES.bookings.map((type) => ({ type })),
        refreshMs: 60_000,
        read: () => {
          const api = initial ? this.api : (this.api.background ?? this.api);
          initial = false;
          return api.listBookings(date);
        },
      },
      (value) => {
        this.bookings = value;
      },
    );
  }

  #onDateChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.date = event.detail.value;
    void this.#load();
  }

  #openForm(): void {
    this.errorKey = null;
    this.editingBooking = null;
    this.formOpen = true;
  }

  #onEdit(id: string): void {
    const found = this.bookings.find((b) => b.id === id);
    if (found === undefined) return;
    this.errorKey = null;
    this.editingBooking = found;
    this.formOpen = true;
  }

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

  /** With no table assigned and none to offer, seating could only fail with
   * `booking.table_required`, so that is shown at once rather than after a round trip. */
  #onSeatClick(b: Booking): void {
    if (b.tableId !== null) {
      void this.#seat(b.id);
      return;
    }
    if (this.tables.length === 0) {
      this.seatingId = null;
      this.errorKey = "booking.table_required";
      return;
    }
    this.errorKey = null;
    this.seatingId = b.id;
    this.seatTableId = this.tables[0]?.id ?? "";
  }

  #onSeatConfirm(id: string): void {
    void this.#seat(id, this.seatTableId === "" ? undefined : this.seatTableId);
  }

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

  #ordered(): Booking[] {
    return [...this.bookings].sort((a, b) => a.bookingTime.localeCompare(b.bookingTime));
  }

  /** Offers only the moves the server accepts from `b.status`. */
  #renderControls(b: Booking): TemplateResult | typeof nothing {
    if (b.status === "booked") {
      return html`<div class="controls">
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
      </div>`;
    }
    if (b.status === "seated") {
      return html`<div class="controls">
        <wt-button
          size="sm"
          variant="primary"
          data-test=${`complete-${b.id}`}
          @click=${() => void this.#lifecycle((id) => this.api.completeBooking(id), b.id)}
          >${t("booking.complete")}</wt-button
        >
      </div>`;
    }
    return nothing;
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
        ${this.#renderControls(b)}
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
