import { css, html, nothing } from "lit";
import type { AttendanceLookups, FinishedAttendanceDay } from "@waitron/dashboard-modules";
import { currentLocale, fill, t } from "../i18n/t.js";
import { dateTimeFormat } from "@waitron/dashboard-kit";
import { wallClock } from "../date-utils.js";

export const attendanceFinishedDaysStyles = css`
  .finished-heading,
  .finished-facts {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--wt-space-2) var(--wt-space-3);
  }
  .finished-heading {
    justify-content: space-between;
  }
  .finished-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .finished-list > li {
    display: grid;
    gap: var(--wt-space-2);
    padding: var(--wt-space-3) 0;
    border-block-end: 1px solid var(--wt-color-border);
  }
  .finished-times {
    display: flex;
    flex-wrap: wrap;
    gap: var(--wt-space-2) var(--wt-space-3);
    color: var(--wt-color-text-muted);
  }
`;

export function renderAttendanceFinishedDays(
  days: FinishedAttendanceDay[],
  { viewer, people }: AttendanceLookups,
  disabled: boolean,
  approve: (days: FinishedAttendanceDay[]) => void,
) {
  const peopleById = new Map(people.map((person) => [person.personId, person.displayName]));
  const canApprove = (day: FinishedAttendanceDay) =>
    viewer.canSelfApprove || day.personId !== viewer.personId;
  const eligible = days.filter(canApprove);
  const labelDate = (date: string) =>
    dateTimeFormat(currentLocale(), { dateStyle: "medium", timeZone: "UTC" }).format(
      new Date(`${date}T00:00:00Z`),
    );
  return html`<section data-finished-days aria-labelledby="finished-heading">
    <header class="finished-heading">
      <h2 id="finished-heading">${t("attendance.finished_days")} · ${days.length}</h2>
      ${
        eligible.length
          ? html`<wt-button
              data-approve-all
              variant=${disabled ? "secondary" : "primary"}
              .disabled=${disabled}
              @click=${() => approve(eligible)}
              >${fill("attendance.approve_all_days", { count: String(eligible.length) })}</wt-button
            >`
          : nothing
      }
    </header>
    ${
      days.length
        ? html`<ul class="finished-list" role="list">
            ${days.map(
              (day) =>
                html`<li>
                  <p class="finished-facts">
                    <strong>${peopleById.get(day.personId) ?? day.personId}</strong>
                    <time datetime=${day.date}>${labelDate(day.date)}</time>
                  </p>
                  <p class="finished-times">
                    ${day.times.map(({ kind, at, offsetMinutes, automatic }) => {
                      const clock = wallClock(at, offsetMinutes);
                      return html`<span
                        >${t(`clock.${kind}`)}
                        <time datetime=${at}
                          >${clock.date === day.date ? "" : `${labelDate(clock.date)} `}${clock.time}</time
                        >
                        ${automatic ? ` · ${t("attendance.author_automatic")}` : nothing}
                      </span>`;
                    })}
                  </p>
                  ${canApprove(day) ? nothing : html`<p>${t("attendance.day_self_approval")}</p>`}
                </li>`,
            )}
          </ul>`
        : html`<p>${t("attendance.no_finished_days")}</p>`
    }
  </section>`;
}
