import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import type { Shift, ShiftPatch } from "../api/client.js";

/**
 * The `add-shift` event detail — the composed shift, MINUS `locationId`: the SCREEN owns the selected
 * location and fills it in when it calls `api.addShift` (a dialog cell knows the person + day, not the
 * roster's location). Offset 0 throughout (slice-1 simplification, Resolved Q6): the entered wall time
 * IS the UTC instant.
 */
export interface AddShiftDetail {
  personId: string;
  startsAt: string;
  startsOffsetMinutes: number;
  endsAt: string;
  endsOffsetMinutes: number;
  role: string | null;
}

/** The `update-shift` event detail: the shift id + a `ShiftPatch` of its edited fields. */
export interface UpdateShiftDetail {
  shiftId: string;
  patch: ShiftPatch;
}

/**
 * The management dashboard's SHIFT DIALOG — a `wt-dialog` for adding, editing or removing one planned
 * shift on a person × day grid cell (design §3d). The roster screen drives it by setting `.open`,
 * `.day`, `.personId` and (for an edit) `.shift`, and hears one of three composed events: `add-shift`
 * (create), `update-shift { shiftId, patch }` (edit), `remove-shift { shiftId }` (delete). Like
 * `product-form`, the dialog does NOT call the API and does NOT close itself on confirm — the screen
 * closes it on a successful write, so a rejected write leaves the entered values in place.
 *
 * Offset 0 (Resolved Q6): the entered `HH:MM` wall time is composed with the cell `day` into
 * `${day}T${HH:MM}:00Z`, i.e. the wall time stored AS the UTC instant, with `starts/ends_offset = 0`.
 * A real per-venue timezone offset is a later slice.
 */
@customElement("dashboard-shift-dialog")
export class ShiftDialog extends LitElement {
  static override styles = [baseStyles, css`
    :host { display: block; }
    .field { display: block; margin-bottom: var(--wt-space-4); }
  `];

  @property({ type: Boolean, reflect: true }) open = false;
  /** The local date (YYYY-MM-DD) of the grid cell this dialog authors. */
  @property() day = "";
  /** The person whose row was clicked — fixed for the shift (edit keeps the same person). */
  @property() personId = "";
  /** The shift being edited, or null for an add. `willUpdate` reseeds the fields on open/change. */
  @property({ attribute: false }) shift: Shift | null = null;
  /** Single-flight: the screen sets it true while an add/update/remove round-trips. */
  @property({ type: Boolean }) busy = false;

  @state() private start = "";
  @state() private end = "";
  // NOT named `role`: HTMLElement already declares an ARIA-reflection `role: string | null`, which a
  // `@state() private role: string` would illegally narrow (TS2415/TS4114). `shiftRole` sidesteps it.
  @state() private shiftRole = "";

  override willUpdate(changed: PropertyValues): void {
    if (!changed.has("shift") && !(changed.has("open") && this.open)) return;
    // Offset 0 (slice-1 simplification): startsAt is `${day}T${HH:MM}:00Z`, so slice(11,16) is the time.
    this.start = this.shift ? this.shift.startsAt.slice(11, 16) : "";
    this.end = this.shift ? this.shift.endsAt.slice(11, 16) : "";
    this.shiftRole = this.shift?.role ?? "";
  }

  #confirm(event: Event): void {
    event.stopPropagation();
    if (this.busy || this.start === "" || this.end === "") return;
    const startsAt = `${this.day}T${this.start}:00Z`;
    const endsAt = `${this.day}T${this.end}:00Z`;
    const role = this.shiftRole.trim() === "" ? null : this.shiftRole.trim();
    if (this.shift) {
      this.dispatchEvent(new CustomEvent<UpdateShiftDetail>("update-shift", {
        detail: { shiftId: this.shift.id, patch: { startsAt, startsOffsetMinutes: 0, endsAt, endsOffsetMinutes: 0, role } },
        bubbles: true, composed: true,
      }));
      return;
    }
    this.dispatchEvent(new CustomEvent<AddShiftDetail>("add-shift", {
      detail: { personId: this.personId, startsAt, startsOffsetMinutes: 0, endsAt, endsOffsetMinutes: 0, role },
      bubbles: true, composed: true,
    }));
  }

  #remove(event: Event): void {
    event.stopPropagation();
    if (this.busy || !this.shift) return;
    this.dispatchEvent(new CustomEvent("remove-shift", { detail: { shiftId: this.shift.id }, bubbles: true, composed: true }));
  }

  override render() {
    return html`
      <wt-dialog heading=${this.shift ? t("roster.edit_shift") : t("roster.new_shift")} .open=${this.open} @wt-close=${() => (this.open = false)}>
        <wt-input class="field" data-test="shift-start" type="time" label=${t("roster.shift_start")}
          .value=${this.start} @wt-change=${(e: CustomEvent<{ value: string }>) => (this.start = e.detail.value)}></wt-input>
        <wt-input class="field" data-test="shift-end" type="time" label=${t("roster.shift_end")}
          .value=${this.end} @wt-change=${(e: CustomEvent<{ value: string }>) => (this.end = e.detail.value)}></wt-input>
        <wt-input class="field" data-test="shift-role" label=${t("roster.shift_role")}
          .value=${this.shiftRole} @wt-change=${(e: CustomEvent<{ value: string }>) => (this.shiftRole = e.detail.value)}></wt-input>
        ${this.shift ? html`<wt-button slot="footer" variant="secondary" data-test="remove" ?disabled=${this.busy} @click=${(e: Event) => this.#remove(e)}>${t("action.remove")}</wt-button>` : nothing}
        <wt-button slot="footer" variant="primary" data-test="confirm" ?disabled=${this.busy} @click=${(e: Event) => this.#confirm(e)}>
          ${this.shift ? t("action.save") : t("action.create")}
        </wt-button>
      </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap { "dashboard-shift-dialog": ShiftDialog; }
}
