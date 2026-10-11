import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  submitOnEnter,
  baseStyles,
  draftScopeFor,
  saveActionState,
  formMessage,
  formMessageStyles,
} from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason } from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import { MS_PER_DAY, wallClock } from "../date-utils.js";
import type { Shift, ShiftPatch } from "../api/client.js";
import { localTimeOccurrences, offsetMinutes } from "@waitron/venue-service/hours-occurrences";
import { codeMessage } from "../i18n/codes.js";
import { sameValue } from "./product-editor-model.js";

interface ShiftDraft {
  start: string;
  end: string;
  shiftRole: string;
}

/**
 * MINUS `locationId`: the SCREEN owns the selected location and fills it in when it calls
 * `api.addShift`.
 */
export interface AddShiftDetail {
  personId: string;
  startsAt: string;
  startsOffsetMinutes: number;
  endsAt: string;
  endsOffsetMinutes: number;
  role: string | null;
}

export interface UpdateShiftDetail {
  shiftId: string;
  patch: ShiftPatch;
}

@customElement("dashboard-shift-dialog")
export class ShiftDialog extends LitElement {
  static override styles = [
    baseStyles,
    formMessageStyles,
    css`
      :host {
        display: block;
      }
      .field {
        display: block;
        margin-bottom: var(--wt-space-4);
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) open = false;
  /** YYYY-MM-DD */
  @property() day = "";
  @property() timeZone = "UTC";
  @property() personId = "";
  @property({ attribute: false }) shift: Shift | null = null;
  @property({ type: Boolean }) busy = false;

  @state() private start = "";
  @state() private end = "";
  // NOT named `role`: HTMLElement already declares an ARIA-reflection `role: string | null`, which a
  // `@state() private role: string` would illegally narrow (TS2415/TS4114). `shiftRole` sidesteps it.
  @state() private shiftRole = "";
  #identity = "";
  #opening = {};
  #scope?: DraftScope<ShiftDraft>;
  #baseline?: ShiftDraft;
  #leave?: LeaveCoordinator;
  #submitted?: ShiftDraft;
  @state() private attempted = false;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.busy &&
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.#disposeDraft();
    this.#opening = {};
    super.disconnectedCallback();
  }

  #disposeDraft(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
  }

  #value(): ShiftDraft {
    return { start: this.start, end: this.end, shiftRole: this.shiftRole };
  }

  #change(field: keyof ShiftDraft, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (this.busy) return;
    this[field] = event.detail.value;
    this.#scope?.changed();
  }

  writeCompletion(): () => boolean {
    const opening = this.#opening;
    const scope = this.#scope;
    const submitted = this.#submitted;
    return () => {
      if (!this.isConnected || !this.open || opening !== this.#opening) return false;
      if (submitted) {
        this.#baseline = { ...submitted };
        scope?.commit(submitted);
        if (scope?.isDirty()) return false;
      }
      this.#disposeDraft();
      this.shadowRoot!.querySelector("wt-dialog")!.closeAfter("saved");
      this.open = false;
      return true;
    };
  }

  override willUpdate(changed: PropertyValues): void {
    const identity = JSON.stringify([this.shift?.id ?? null, this.personId, this.day]);
    if (identity !== this.#identity || (changed.has("open") && this.open)) {
      this.#disposeDraft();
      this.#submitted = undefined;
      this.#identity = identity;
      this.#opening = {};
      this.#baseline = undefined;
      this.attempted = false;
      this.start = this.shift
        ? wallClock(this.shift.startsAt, this.shift.startsOffsetMinutes).time
        : "";
      this.end = this.shift ? wallClock(this.shift.endsAt, this.shift.endsOffsetMinutes).time : "";
      this.shiftRole = this.shift?.role ?? "";
    }
    if (!this.open) this.#disposeDraft();
    else if (this.isConnected && !this.#scope) {
      this.#baseline ??= this.#value();
      const { coordinator, scope } = draftScopeFor<ShiftDraft>(this, {
        id: this,
        current: () => this.#value(),
        snapshot: (value) => ({ ...value }),
        equal: (a, b) =>
          sameValue(
            { ...a, shiftRole: a.shiftRole.trim() },
            { ...b, shiftRole: b.shiftRole.trim() },
          ),
        restore: (value) => {
          this.start = value.start;
          this.end = value.end;
          this.shiftRole = value.shiftRole;
        },
      });
      this.#leave = coordinator;
      this.#scope = scope;
      scope.commit(this.#baseline);
    }
  }

  #incomplete(): boolean {
    return this.start === "" || this.end === "";
  }

  #moments(): { start?: Date; end?: Date } {
    if (!this.timeZone) return {};
    const endDay =
      this.end > this.start
        ? this.day
        : new Date(Date.parse(`${this.day}T00:00:00Z`) + MS_PER_DAY).toISOString().slice(0, 10);
    const pick = (day: string, time: string, stored?: string) => {
      if (!time) return undefined;
      const occurrences = localTimeOccurrences(day, time, this.timeZone);
      // A role-only edit must retain the chosen occurrence of a repeated clock minute.
      return occurrences.find((at) => at.getTime() === Date.parse(stored ?? "")) ?? occurrences[0];
    };
    return {
      start: pick(this.day, this.start, this.shift?.startsAt),
      end: pick(endDay, this.end, this.shift?.endsAt),
    };
  }

  #times() {
    const { start, end } = this.#moments();
    if (!start || !end) return null;
    return {
      startsAt: `${start.toISOString().slice(0, 19)}Z`,
      startsOffsetMinutes: offsetMinutes(start.getTime(), this.timeZone),
      endsAt: `${end.toISOString().slice(0, 19)}Z`,
      endsOffsetMinutes: offsetMinutes(end.getTime(), this.timeZone),
    };
  }

  #confirm(event: Event): void {
    event.stopPropagation();
    if (this.busy || !this.timeZone || this.#incomplete() || saveActionState(this.#scope).unchanged)
      return;
    const times = this.#times();
    if (!times) {
      this.attempted = true;
      return;
    }
    const { startsAt, startsOffsetMinutes, endsAt, endsOffsetMinutes } = times;
    const role = this.shiftRole.trim() === "" ? null : this.shiftRole.trim();
    this.#submitted = this.#value();
    if (this.shift) {
      this.dispatchEvent(
        new CustomEvent<UpdateShiftDetail>("update-shift", {
          detail: {
            shiftId: this.shift.id,
            patch: { startsAt, startsOffsetMinutes, endsAt, endsOffsetMinutes, role },
          },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }
    this.dispatchEvent(
      new CustomEvent<AddShiftDetail>("add-shift", {
        detail: {
          personId: this.personId,
          startsAt,
          startsOffsetMinutes,
          endsAt,
          endsOffsetMinutes,
          role,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #remove(event: Event): void {
    event.stopPropagation();
    if (this.busy || !this.shift) return;
    this.#submitted = undefined;
    this.dispatchEvent(
      new CustomEvent("remove-shift", {
        detail: { shiftId: this.shift.id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    const s = saveActionState(this.#scope);
    const clockMissing = !this.timeZone;
    const moments = this.attempted && !clockMissing ? this.#moments() : null;
    const invalid = moments !== null && (!moments.start || !moments.end);
    return html` <wt-dialog
      @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]"))}
      heading=${this.shift ? t("roster.edit_shift") : t("roster.new_shift")}
      .open=${this.open}
      .dismissible=${!this.busy}
      .beforeClose=${this.#leave ? this.#beforeClose : undefined}
      @wt-close=${() => (this.open = false)}
    >
      <wt-input
        class="field"
        data-test="shift-start"
        name="startsAt"
        type="time"
        required
        label=${t("roster.shift_start")}
        .value=${this.start}
        .error=${moments && !moments.start ? t(this.start ? "roster.time_skipped" : "roster.time_required") : ""}
        ?disabled=${this.busy}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#change("start", e)}
      ></wt-input>
      <wt-input
        class="field"
        data-test="shift-end"
        name="endsAt"
        type="time"
        required
        label=${t("roster.shift_end")}
        .value=${this.end}
        .error=${moments && !moments.end ? t(this.end ? "roster.time_skipped" : "roster.time_required") : ""}
        ?disabled=${this.busy}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#change("end", e)}
      ></wt-input>
      <wt-input
        class="field"
        data-test="shift-role"
        name="role"
        label=${t("roster.shift_role")}
        .value=${this.shiftRole}
        ?disabled=${this.busy}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#change("shiftRole", e)}
      ></wt-input>
      ${this.shift ? html`<wt-button slot="footer" variant="secondary" data-test="remove" ?disabled=${this.busy} @click=${(e: Event) => this.#remove(e)}>${t("action.remove")}</wt-button>` : nothing}
      ${formMessage(clockMissing ? t("roster.clock_unavailable") : invalid ? codeMessage("shift.invalid") : "")}
      <wt-button
        slot="footer"
        variant=${s.variant}
        data-test="confirm"
        ?disabled=${s.unchanged || this.busy || this.#incomplete() || invalid || clockMissing}
        @click=${(e: Event) => this.#confirm(e)}
      >
        ${this.shift ? t("action.save") : t("action.create")}
      </wt-button>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-shift-dialog": ShiftDialog;
  }
}
