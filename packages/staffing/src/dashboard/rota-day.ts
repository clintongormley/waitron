import type { RosterBreach } from "@waitron/workforce/roster-validation";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { areaKey } from "../slots.js";
import type { RotaWeek } from "../staffing-types.js";
import { RotaByArea, dayNote, focusIn } from "./rota-by-area.js";
import {
  dailyBreaches,
  notInSlotCard,
  overCard,
  personDayShifts,
  personShiftCard,
  slotCard,
  warnings,
  weekBreaches,
} from "./rota-cards.js";
import { dateFormat, utc } from "./format.js";
import { hours } from "./rota-format.js";
import { peopleInOrder, type Show, type Target } from "./rota-model.js";
import { t } from "./strings.js";

type Day = RotaWeek["days"][number];

/** The phone's one day of the rota: an area's staff role groups, or a block per person. */
@customElement("rota-day")
export class RotaDay extends LitElement {
  static override styles = [
    ...RotaByArea.styles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
        min-width: 0;
        overflow-wrap: anywhere;
      }
      h3,
      h4 {
        margin: 0;
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
      }
      section {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      h4 {
        margin-block-end: var(--wt-space-2);
      }
      .person {
        display: block;
        width: 100%;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) 0;
        margin-block-end: var(--wt-space-1);
        border: 0;
        background: transparent;
        color: var(--wt-color-text);
        font: inherit;
        font-weight: var(--wt-font-weight-bold);
        text-align: start;
      }
      button.person {
        cursor: pointer;
      }
      .person small {
        font-weight: var(--wt-font-weight-normal);
      }
    `,
  ];
  @property({ attribute: false }) week!: RotaWeek;
  @property({ attribute: false }) show!: Show;
  @property() businessDay = "";
  @property({ attribute: false }) breaches: RosterBreach[] = [];
  @property({ type: Boolean }) editable = false;
  /** False when the venue has no active area, since a shift needs one. */
  @property({ attribute: false }) canAdd = true;

  focusTarget(target: Target): boolean {
    return focusIn(this.renderRoot as ShadowRoot, target, this.show.kind === "area");
  }
  #area(day: Day, show: Show & { kind: "area" }) {
    const match = day.areas.find((a) => areaKey(a.area) === show.key)?.match;
    const shifts = (match?.over ?? []).map((id) => this.week.shifts.find((s) => s.shiftId === id)!);
    const groups = this.week.staffRoles
      .filter(
        (r) =>
          match?.slots.some((s) => s.slot.staffRoleId === r.id) ||
          shifts.some((s) => s.staffRoleId === r.id),
      )
      .sort((a, b) => a.position - b.position);
    return html`${groups.map(
      (role) =>
        html`<section data-role=${role.id}>
          <h4><span class="swatch" data-colour=${role.colour}></span>${role.name}</h4>
          ${match!.slots
            .filter((s) => s.slot.staffRoleId === role.id)
            .map((s) => slotCard(this, s.slot, s.status, day.cutover))}
          ${shifts.filter((s) => s.staffRoleId === role.id).map((s) => overCard(this, s))}
        </section>`,
    )}${
      day.notInSlot.length > 0
        ? html`<section data-role="not-in-slot">
            <h4>${t("staffing.rota.not_in_slot")}</h4>
            ${day.notInSlot.map((n) => notInSlotCard(this, n))}
          </section>`
        : nothing
    }`;
  }
  #everyone(day: Day) {
    return peopleInOrder(this.week).map((p) => {
      const label = html`${p.name}<small
          >${p.staffRoleIds.map((id) => this.week.staffRoles.find((r) => r.id === id)?.name).join(", ")}</small
        ><small class="hours">${hours(p)}</small>`;
      return html`<section data-person=${p.personId}>
        ${
          this.editable && this.canAdd
            ? html`<button
                class="person"
                data-test="person"
                @click=${(e: Event) =>
                  this.dispatchEvent(
                    new CustomEvent("open-day", {
                      detail: {
                        personId: p.personId,
                        businessDay: day.businessDay,
                        anchor: e.currentTarget,
                      },
                      bubbles: true,
                      composed: true,
                    }),
                  )}
              >
                ${label}
              </button>`
            : html`<div class="person" data-test="person-name">${label}</div>`
        }
        ${warnings(weekBreaches(this.breaches, p.personId))}
        ${personDayShifts(this.week, p.personId, day).map((s) => personShiftCard(this, s))}
        ${warnings(dailyBreaches(this.breaches, p.personId, day.businessDay))}
      </section>`;
    });
  }
  override render() {
    const day = this.week?.days.find((d) => d.businessDay === this.businessDay);
    if (!day || !this.show) return nothing;
    return html`<h3 data-day-head=${day.businessDay}>
        ${dateFormat({ weekday: "short", day: "numeric" }).format(utc(day.businessDay))}${dayNote(this.week, this.show, day.businessDay)}
      </h3>
      ${this.show.kind === "area" ? this.#area(day, this.show) : this.#everyone(day)}`;
  }
}
