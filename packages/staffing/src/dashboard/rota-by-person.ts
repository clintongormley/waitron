import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { RosterBreach } from "@waitron/workforce/roster-validation";
import { areaKey } from "../slots.js";
import type { RotaWeek } from "../staffing-types.js";
import { RotaByArea, dayHead, focusIn } from "./rota-by-area.js";
import { peopleInOrder, type Target } from "./rota-model.js";
import { dateLabel } from "./format.js";
import { hours, minuteTime, shiftTime } from "./rota-format.js";
import { breachText, shiftBreaches } from "./rota-warnings.js";
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
  private warnings(breaches: RosterBreach[]) {
    return breaches.map((b) => html`<small>${breachText(b)}</small>`);
  }
  private shift(shift: RotaWeek["shifts"][number]) {
    const area = this.week.areas.find((a) => shift.area && areaKey(a.area) === areaKey(shift.area));
    const staffRole = this.week.staffRoles.find((r) => r.id === shift.staffRoleId);
    const overflow =
      shift.businessDay < this.week.week || shift.businessDay > this.week.days[6]!.businessDay;
    const over = this.week.days.some((d) =>
      d.areas.some((a) => a.match.over.includes(shift.shiftId)),
    );
    const uncovered = this.week.days.flatMap((d) =>
      d.areas.flatMap((a) =>
        a.match.slots.flatMap(({ status }) =>
          status.kind === "partly_uncovered" && status.shiftId === shift.shiftId
            ? status.uncovered.map(
                (u) => `${minuteTime(u.start, d.cutover)}–${minuteTime(u.end, d.cutover)}`,
              )
            : [],
        ),
      ),
    );
    const content = html`<span
        >${staffRole ? html`<span class="swatch" data-colour=${staffRole.colour}></span>` : nothing}${shiftTime(shift)}</span
      ><small
        >${area?.name ?? t("staffing.rota.not_in_slot")}${staffRole ? ` · ${staffRole.name}` : ""}</small
      >
      ${overflow ? html`<small>${t(shift.businessDay < this.week.week ? "staffing.rota.previous_week" : "staffing.rota.next_week")}</small>` : nothing}
      ${over ? html`<small>${t("staffing.rota.over")}</small>` : nothing}
      ${uncovered.length > 0 ? html`<small>${tf("staffing.rota.uncovered", { times: uncovered.join(", ") })}</small>` : nothing}
      ${staffRole && !this.week.people.find((p) => p.personId === shift.personId)?.staffRoleIds.includes(staffRole.id) ? html`<small>${t("staffing.rota.outside_role")}</small>` : nothing}
      ${this.week.openSwaps.some((s) => s.fromShiftId === shift.shiftId || s.toShiftId === shift.shiftId) ? html`<small>${t("staffing.shift.swap_heading")}</small>` : nothing}
      ${this.warnings(shiftBreaches(this.breaches, shift.shiftId))}`;
    return this.editable
      ? html`<button
          class="card"
          data-shift=${shift.shiftId}
          @click=${() => this.emit("edit-shift", { shiftId: shift.shiftId })}
        >
          ${content}
        </button>`
      : html`<div class="card" data-shift=${shift.shiftId}>${content}</div>`;
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
                  >${this.warnings(this.breaches.filter((b) => b.personId === p.personId && !("shiftId" in b) && b.kind !== "exceeds_daily_max"))}
                </th>
                ${this.week.days.map((day) => {
                  const shifts = this.week.shifts.filter(
                    (s) =>
                      s.personId === p.personId &&
                      (s.businessDay === day.businessDay ||
                        day.notInSlot.some((n) => n.shiftId === s.shiftId)),
                  );
                  return html`<td data-day=${day.businessDay}>
                    <div class="cell">
                      ${shifts.map((s) => this.shift(s))}
                      ${this.warnings(this.breaches.filter((b) => b.personId === p.personId && b.kind === "exceeds_daily_max" && b.workDate === day.businessDay))}
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
