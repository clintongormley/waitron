import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { RosterBreach } from "@waitron/workforce/roster-validation";
import type { RotaWeek } from "../staffing-types.js";
import { RotaByArea, dayHead, focusIn } from "./rota-by-area.js";
import { peopleInOrder, type Target } from "./rota-model.js";
import { dateLabel } from "./format.js";
import { hours } from "./rota-format.js";
import { personDayShifts, personShiftCard, warnings } from "./rota-cards.js";
import { t, tf } from "./strings.js";
@customElement("rota-by-person")
export class RotaByPerson extends LitElement {
  static override styles = RotaByArea.styles;
  @property({ attribute: false }) week!: RotaWeek;
  @property({ attribute: false }) breaches: RosterBreach[] = [];
  @property({ type: Boolean }) editable = false;
  /** False when the venue has no active area, since a shift needs one. */
  @property({ attribute: false }) canAdd = true;
  focusTarget(target: Target): boolean {
    return focusIn(this.renderRoot as ShadowRoot, target, false);
  }
  private emit(name: string, detail: unknown) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  override render() {
    if (!this.week) return nothing;
    return html`<div
      class="scroll"
      data-test="grid-scroll"
      tabindex="0"
      role="region"
      aria-label=${t("staffing.rota.everyone")}
    >
      <table>
        <thead>
          <tr>
            <th scope="col">${t("staffing.shift.personId")}</th>
            ${this.week.days.map((d) => dayHead(this.week, { kind: "everyone" }, d.businessDay))}
          </tr>
        </thead>
        <tbody>
          ${peopleInOrder(this.week).map(
            (p) =>
              html`<tr data-person=${p.personId}>
                <th
                  scope="row"
                  ?data-over-contract=${p.contractedMinutes !== null && p.plannedMinutes > p.contractedMinutes}
                >
                  ${p.name}<small
                    >${p.staffRoleIds.map((id) => this.week.staffRoles.find((r) => r.id === id)?.name).join(", ")}</small
                  ><small class="hours">${hours(p)}</small
                  >${warnings(this.breaches.filter((b) => b.personId === p.personId && !("shiftId" in b) && b.kind !== "exceeds_daily_max"))}
                </th>
                ${this.week.days.map((day) => {
                  const shifts = personDayShifts(this.week, p.personId, day);
                  return html`<td data-day=${day.businessDay}>
                    <div class="cell">
                      ${shifts.map((s) => personShiftCard(this, s))}
                      ${warnings(this.breaches.filter((b) => b.personId === p.personId && b.kind === "exceeds_daily_max" && b.workDate === day.businessDay))}
                      ${
                        this.editable && this.canAdd
                          ? html`<button
                              class="add"
                              data-test="day-add"
                              aria-label=${tf("staffing.rota.add_label_person", { name: p.name, day: dateLabel(day.businessDay) })}
                              @click=${(e: Event) =>
                                this.emit("open-day", {
                                  personId: p.personId,
                                  businessDay: day.businessDay,
                                  anchor: e.currentTarget,
                                })}
                            >
                              ${t("staffing.rota.add_here")}
                            </button>`
                          : nothing
                      }
                    </div>
                  </td>`;
                })}
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
  }
}
