import type { WorkTimeRuleset } from "@waitron/workforce/roster-validation";
import { candidateWarnings, breachText } from "./rota-warnings.js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { areaKey, type Slot } from "../slots.js";
import type { RotaWeek } from "../staffing-types.js";
import { hours, shiftTime } from "./rota-format.js";
import { dateLabel } from "./format.js";
import { t, tf } from "./strings.js";
import "@waitron/ui/src/components/wt-button.js";

/** "Fri 4 Dec · Sous chef · 09:00–17:00" */
export function slotHeading(week: RotaWeek, slot: Slot): string {
  const role = week.staffRoles.find((r) => r.id === slot.staffRoleId)!;
  return `${dateLabel(slot.businessDay)} · ${role.name} · ${slot.startsAt}–${slot.endsAt}`;
}

@customElement("slot-picker")
export class SlotPicker extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
        max-width: calc(var(--wt-tap-min) * 8);
      }
      .title {
        margin: 0;
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
      }
      .sub {
        margin: 0 0 var(--wt-space-2);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      button {
        display: block;
        width: 100%;
        text-align: start;
        font: inherit;
        color: var(--wt-color-text);
        background: var(--wt-color-surface);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        padding: var(--wt-space-2);
        margin-block-end: var(--wt-space-2);
        cursor: pointer;
        overflow-wrap: anywhere;
      }
      button[data-busy] {
        background: var(--wt-color-bg);
        color: var(--wt-color-text-muted);
      }
      button:hover {
        border-color: var(--wt-color-primary);
      }
      button:focus-visible {
        outline: var(--wt-field-line-width-active) solid var(--wt-color-focus);
        outline-offset: var(--wt-focus-offset);
      }
      button:disabled {
        cursor: wait;
      }
      small {
        display: block;
        color: var(--wt-color-text-muted);
      }
      p {
        margin: var(--wt-space-2) 0;
      }
      .error,
      small.over {
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ attribute: false }) week!: RotaWeek;
  @property({ attribute: false }) pickedSlot!: Slot;
  @property({ attribute: false }) ruleset: WorkTimeRuleset | null = null;
  @property({ type: Boolean }) busy = false;
  @property() error = "";
  /** On a phone the picker is a sheet, which ends with Cancel; beside a slot a click outside
   *  closes it. */
  @property({ type: Boolean }) sheet = false;
  @state() private everyone = false;
  /** Free, on leave, or working at that time ("working 18:00–00:00"). */
  #status(personId: string): { busy: boolean; words: string } {
    if (
      this.week.absences.some(
        (a) =>
          a.personId === personId &&
          a.startsOn <= this.pickedSlot.businessDay &&
          a.endsOn >= this.pickedSlot.businessDay,
      )
    )
      return { busy: true, words: t("staffing.rota.leave") };
    const cutover = this.week.days.find(
      (d) => d.businessDay === this.pickedSlot.businessDay,
    )!.cutover;
    const start =
      Date.parse(`${this.pickedSlot.businessDay}T${cutover}:00Z`) + this.pickedSlot.start * 60000;
    const end =
      Date.parse(`${this.pickedSlot.businessDay}T${cutover}:00Z`) + this.pickedSlot.end * 60000;
    const overlapping = this.week.shifts.filter(
      (s) =>
        s.personId === personId &&
        Date.parse(s.startsAt) + s.startsOffsetMinutes * 60000 < end &&
        Date.parse(s.endsAt) + s.endsOffsetMinutes * 60000 > start,
    );
    return overlapping.length
      ? {
          busy: true,
          words: tf("staffing.rota.working", { times: overlapping.map(shiftTime).join(", ") }),
        }
      : { busy: false, words: t("staffing.rota.free") };
  }
  override render() {
    if (!this.week || !this.pickedSlot) return nothing;
    const holders = this.week.people.filter((p) =>
      p.staffRoleIds.includes(this.pickedSlot.staffRoleId),
    );
    const people = this.everyone
      ? [
          ...holders,
          ...this.week.people.filter((p) => !p.staffRoleIds.includes(this.pickedSlot.staffRoleId)),
        ]
      : holders;
    const area = this.week.areas.find((a) => areaKey(a.area) === areaKey(this.pickedSlot.area))!;
    const length = this.pickedSlot.end - this.pickedSlot.start;
    // The popup it sits in carries this text as its heading, which is what a screen reader hears.
    return html`<div>
      <p class="title" data-test="picker-title" aria-hidden="true">
        ${slotHeading(this.week, this.pickedSlot)}
      </p>
      <p class="sub" data-test="picker-sub">
        ${tf("staffing.rota.picker_sub", { area: area.name })}
      </p>
      ${!holders.length ? html`<p>${t("staffing.rota.no_holders")}</p>` : nothing}
      ${people.map((p) => {
        const status = this.#status(p.personId);
        return html`<button
          data-person=${p.personId}
          ?data-busy=${status.busy}
          ?disabled=${this.busy}
          @click=${() => {
            if (!this.busy)
              this.dispatchEvent(
                new CustomEvent("choose", {
                  detail: { personId: p.personId },
                  bubbles: true,
                  composed: true,
                }),
              );
          }}
        >
          <strong>${p.name}</strong> ·
          ${p.staffRoleIds.map((id) => this.week.staffRoles.find((r) => r.id === id)?.name).join(", ")}<small
            >${status.words} · ${hours(p)}</small
          >${
            p.contractedMinutes !== null && p.plannedMinutes + length > p.contractedMinutes
              ? html`<small class="over" data-test="would-go-over"
                  >${tf("staffing.rota.would_go_over", { contract: String(p.contractedMinutes / 60) })}</small
                >`
              : nothing
          }
          ${candidateWarnings(this.week, this.pickedSlot, p.personId, this.ruleset).map((b) => html`<small>${breachText(b)}</small>`)}
        </button>`;
      })}
      ${
        this.everyone
          ? nothing
          : html`<wt-button
              variant="ghost"
              data-test="show-everyone"
              ?disabled=${this.busy}
              @click=${() => {
                this.everyone = true;
              }}
              >${t("staffing.rota.show_everyone")}</wt-button
            >`
      }
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
      ${
        this.sheet
          ? html`<wt-button
              variant="secondary"
              data-test="cancel"
              ?disabled=${this.busy}
              @click=${() => this.dispatchEvent(new CustomEvent("close-picker", { bubbles: true, composed: true }))}
              >${t("staffing.role.cancel")}</wt-button
            >`
          : nothing
      }
    </div>`;
  }
}
