import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { t } from "./strings.js";
import { namedOn, realDayLabel } from "./real-week.js";
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
  @property() dayCutover = "06:00";
  @property() weekStart = "";
  @property({ attribute: false }) namedDays: OpeningHoursModel["namedDays"] = [];
  override render() {
    const departments = this.departments.filter((department) => department.active);
    const weekdays = [1, 2, 3, 4, 5, 6, 0];
    const columns = weekdays.flatMap((weekday) =>
      departments.map((department) => {
        const named = this.weekStart ? namedOn(this.namedDays, this.weekStart, weekday) : undefined;
        return {
          key: `${weekday}:${department.id}`,
          label: this.weekStart
            ? realDayLabel(this.weekStart, weekday, named)
            : t(`hours.day.${weekday}` as Parameters<typeof t>[0]),
          slots: named?.closeWholeVenue
            ? []
            : named?.ownHours
              ? (department.dates.find((day) => day.specialDateId === named.id)?.slots ??
                department.week.find((day) => day.weekday === weekday)?.slots ??
                [])
              : (department.week.find((day) => day.weekday === weekday)?.slots ?? []),
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
