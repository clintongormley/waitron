import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { submitOnEnter, baseStyles, leaveCoordinatorFor } from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason } from "@waitron/ui";
import { keyed } from "lit/directives/keyed.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "./strings.js";
import { codeMessage } from "@waitron/dashboard-kit";
import type { Booking, BookingInput, BookingPatch, DashboardTable } from "./client.js";

export interface UpdateBookingDetail {
  id: string;
  patch: BookingPatch;
}

const POSITIVE_INT = /^\d+$/;

interface BookingDraft {
  date: string;
  time: string;
  partySize: string;
  contactName: string;
  contactPhone: string;
  notes: string;
  tableId: string;
}

function comparable(value: BookingDraft): string {
  return JSON.stringify({
    ...value,
    partySize: POSITIVE_INT.test(value.partySize)
      ? Number(value.partySize)
      : { invalid: value.partySize },
    contactPhone: value.contactPhone.trim() === "" ? null : value.contactPhone,
    notes: value.notes.trim() === "" ? null : value.notes,
    tableId: value.tableId === "" ? null : value.tableId,
  });
}

/** Date and time stay venue-local values, never instants (design §2b). */
@customElement("dashboard-booking-form")
export class BookingForm extends LitElement {
  static override styles = [
    baseStyles,
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

  @property({ attribute: false }) booking: Booking | null = null;

  @property({ attribute: false }) tables: DashboardTable[] = [];

  /** The day the screen is showing; a create starts on it. */
  @property() defaultDate = "";

  @property({ type: Boolean }) busy = false;

  @state() private date = "";
  @state() private time = "";
  @state() private partySize = "";
  @state() private contactName = "";
  @state() private contactPhone = "";
  @state() private notes = "";
  @state() private tableId = "";
  @state() private validationError: string | null = null;

  #identity: string | null | undefined;
  #opening = {};
  #submitted?: BookingDraft;
  #scope?: DraftScope<BookingDraft>;
  #leave?: LeaveCoordinator;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    if (this.busy) return false;
    const opening = this.#opening;
    const outcome = await this.#leave!.request({ scopes: [this], reason, proceed() {} });
    return opening === this.#opening && outcome === "proceeded";
  };

  #value(): BookingDraft {
    return {
      date: this.date,
      time: this.time,
      partySize: this.partySize,
      contactName: this.contactName,
      contactPhone: this.contactPhone,
      notes: this.notes,
      tableId: this.tableId,
    };
  }

  #restore(value: BookingDraft): void {
    this.date = value.date;
    this.time = value.time;
    this.partySize = value.partySize;
    this.contactName = value.contactName;
    this.contactPhone = value.contactPhone;
    this.notes = value.notes;
    this.tableId = value.tableId;
  }

  #disposeDraft(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
  }

  override disconnectedCallback(): void {
    this.#disposeDraft();
    this.#identity = undefined;
    this.#opening = {};
    super.disconnectedCallback();
  }

  writeCompletion(): { isCurrent(): boolean; succeeded(): boolean } {
    const opening = this.#opening;
    const scope = this.#scope;
    const submitted = this.#submitted;
    const isCurrent = () => this.isConnected && this.open && opening === this.#opening;
    return {
      isCurrent,
      succeeded: () => {
        if (!isCurrent()) return false;
        if (submitted) {
          scope?.commit(submitted);
          if (scope?.isDirty()) return false;
        }
        this.#disposeDraft();
        this.shadowRoot!.querySelector("wt-dialog")!.closeAfter("saved");
        this.open = false;
        return true;
      },
    };
  }

  override willUpdate(changed: PropertyValues): void {
    const identity = this.booking?.id ?? null;
    if (identity !== this.#identity || (changed.has("open") && this.open)) {
      this.#disposeDraft();
      this.#identity = identity;
      this.#opening = {};
      this.#submitted = undefined;
      const b = this.booking;
      this.#restore({
        date: b?.bookingDate ?? this.defaultDate,
        time: b ? b.bookingTime.slice(0, 5) : "",
        partySize: b ? String(b.partySize) : "",
        contactName: b?.contactName ?? "",
        contactPhone: b?.contactPhone ?? "",
        notes: b?.notes ?? "",
        tableId: b?.tableId ?? "",
      });
      this.validationError = null;
    }
    if (!this.open) this.#disposeDraft();
    else if (!this.#scope) {
      this.#leave = leaveCoordinatorFor(this);
      this.#scope = this.#leave?.register<BookingDraft>({
        id: this,
        current: () => this.#value(),
        snapshot: (value) => ({ ...value }),
        equal: (a, b) => comparable(a) === comparable(b),
        restore: (value) => this.#restore(value),
      });
    }
  }

  #onFieldChange(
    event: CustomEvent<{ value: string }>,
    field: "date" | "time" | "partySize" | "contactName" | "contactPhone" | "notes",
    opening: object,
  ): void {
    event.stopPropagation();
    if (!this.isConnected || !this.open || opening !== this.#opening) return;
    this[field] = event.detail.value;
    this.#scope?.changed();
    if (this.validationError) this.validationError = null;
  }

  #onTableChange(event: CustomEvent<{ value: string }>, opening: object): void {
    event.stopPropagation();
    if (!this.isConnected || !this.open || opening !== this.#opening) return;
    this.tableId = event.detail.value;
    this.#scope?.changed();
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

  #confirm(event: Event, opening: object): void {
    event.stopPropagation();
    if (this.busy || !this.isConnected || !this.open || opening !== this.#opening) return;
    const error = this.#validate();
    if (error !== null) {
      this.validationError = error;
      return;
    }
    this.validationError = null;
    this.#submitted = this.#value();

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

  #onClose(event: Event, opening: object): void {
    event.stopPropagation();
    if (!this.isConnected || !this.open || opening !== this.#opening) return;
    this.#disposeDraft();
    this.open = false;
    this.dispatchEvent(new CustomEvent("wt-close", { detail: {}, bubbles: true, composed: true }));
  }

  override render() {
    const opening = this.#opening;
    return html`${keyed(
      opening,
      html`
        <wt-dialog
          @keydown=${(e: KeyboardEvent) => {
            if (opening === this.#opening && this.isConnected && this.open)
              submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]"));
          }}
          heading=${this.booking ? t("booking.edit") : t("booking.new")}
          .open=${this.open}
          .dismissible=${!this.busy}
          .beforeClose=${this.#scope ? this.#beforeClose : undefined}
          @wt-close=${(e: Event) => this.#onClose(e, opening)}
        >
          <wt-input
            class="field"
            type="date"
            data-test="booking-date"
            label=${t("booking.date")}
            .value=${this.date}
            name="booking-date"
            @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onFieldChange(e, "date", opening)}
          ></wt-input>
          <wt-input
            class="field"
            type="time"
            data-test="booking-time"
            label=${t("booking.time")}
            .value=${this.time}
            name="booking-time"
            @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onFieldChange(e, "time", opening)}
          ></wt-input>
          <wt-input
            class="field"
            type="number"
            data-test="party-size"
            label=${t("booking.party_size")}
            .value=${this.partySize}
            name="party-size"
            @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onFieldChange(e, "partySize", opening)}
          ></wt-input>
          <wt-input
            class="field"
            data-test="contact-name"
            label=${t("booking.contact_name")}
            .value=${this.contactName}
            name="contact-name"
            @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onFieldChange(e, "contactName", opening)}
          ></wt-input>
          <wt-input
            class="field"
            data-test="contact-phone"
            label=${t("booking.contact_phone")}
            .value=${this.contactPhone}
            name="contact-phone"
            @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onFieldChange(e, "contactPhone", opening)}
          ></wt-input>
          <wt-input
            class="field"
            data-test="notes"
            label=${t("booking.notes")}
            .value=${this.notes}
            name="notes"
            @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onFieldChange(e, "notes", opening)}
          ></wt-input>
          <wt-combobox
            class="field"
            name="table"
            data-test="booking-table"
            label=${t("booking.table")}
            placeholder=${t("booking.table_none")}
            search="auto"
            searchPlaceholder=${t("booking.combobox_search")}
            noResultsLabel=${t("booking.combobox_no_results")}
            .options=${[
              { value: "", label: t("booking.table_none") },
              ...this.tables.map((table) => ({ value: table.id, label: table.label })),
            ]}
            .value=${this.tableId}
            @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onTableChange(e, opening)}
          ></wt-combobox>

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
            @click=${(e: Event) => this.#confirm(e, opening)}
            >${this.booking ? t("action.save") : t("action.create")}</wt-button
          >
        </wt-dialog>
      `,
    )}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-booking-form": BookingForm;
  }
}
