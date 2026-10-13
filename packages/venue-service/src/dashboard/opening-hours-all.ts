import type { BusinessDayClock } from "@waitron/shared";
import { serviceDayContext } from "../service-day-context.js";
import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { t } from "./strings.js";
import { dateFacts, dateInWeek, realDayLabel, seasonIdOf } from "./real-week.js";
import { paintedSlots } from "./special-date.js";
import type { SpecialDaysModel } from "../holiday-types.js";
import type { SpecialDayDetail } from "../special-days.js";
import { seasonWeek } from "./season-choice.js";
import "./service-grid.js";

@customElement("opening-hours-all")
export class OpeningHoursAll extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      a {
        display: block;
        color: var(--wt-color-primary-text);
        min-height: var(--wt-tap-min);
      }
    `,
  ];
  @property({ attribute: false }) departments: OpeningHoursModel["departments"] = [];
  @property({ attribute: false }) businessDayClock?: BusinessDayClock;
  @property() dayCutover = "06:00";
  @property() weekStart = "";
  @property() seasonId = "";
  @property({ attribute: false }) seasons: OpeningHoursModel["seasons"] = [];
  @property({ attribute: false }) calendar?: SpecialDaysModel;
  @property({ attribute: false }) specials: ReadonlyMap<string, SpecialDayDetail> = new Map();
  override render() {
    const departments = this.departments.filter((department) => department.active);
    const weekdays = [1, 2, 3, 4, 5, 6, 0];
    const columns = weekdays.flatMap((weekday) =>
      departments.map((department) => {
        const facts = this.weekStart
          ? dateFacts(this.calendar, this.specials, dateInWeek(this.weekStart, weekday))
          : undefined;
        const clock =
          this.weekStart && this.businessDayClock
            ? serviceDayContext(this.businessDayClock, dateInWeek(this.weekStart, weekday))
            : undefined;
        const week = seasonWeek(
          department.seasonWeeks,
          seasonIdOf(this.seasons, this.seasonId, this.weekStart, weekday),
        );
        return {
          key: `${weekday}:${department.id}`,
          clock,
          label: this.weekStart
            ? realDayLabel(this.weekStart, weekday, facts)
            : t(`hours.day.${weekday}` as Parameters<typeof t>[0]),
          slots: facts?.closed
            ? []
            : paintedSlots(
                week.find((day) => day.weekday === weekday)?.slots ?? [],
                facts?.special,
                department.id,
                clock?.dayCutover ?? this.dayCutover,
              ),
          periods: department.periods,
          editable: false,
          narrow: true,
        };
      }),
    );
    return html`<service-grid .columns=${columns} .dayCutover=${this.dayCutover} .readOnly=${true}>
      ${weekdays.flatMap((weekday) =>
        departments.map(
          (department) =>
            html`<a
              slot=${`header-${weekday}:${department.id}`}
              data-department=${department.id}
              href=${`/manage/opening-hours/view/week/department/${encodeURIComponent(department.id)}${this.weekStart ? `?week=${this.weekStart}` : ""}`}
              @click=${(event: MouseEvent) => {
                if (
                  event.button !== 0 ||
                  event.ctrlKey ||
                  event.metaKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                event.stopPropagation();
                if (this.isConnected)
                  this.dispatchEvent(
                    new CustomEvent("department-open", {
                      detail: { departmentId: department.id },
                      bubbles: true,
                      composed: true,
                    }),
                  );
              }}
              >${department.name}</a
            >`,
        ),
      )}
    </service-grid>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "opening-hours-all": OpeningHoursAll;
  }
}
