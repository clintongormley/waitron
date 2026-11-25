import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { dateTimeFormat } from "@waitron/dashboard-kit";
import type { PersonHours } from "@waitron/dashboard-modules";
import { currentLocale, fill, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { attendanceHistory, attendanceStatus } from "./attendance-history.js";
import { wallClock } from "../date-utils.js";
import { hoursDate, hoursTime, hoursZone, periodLabel, wholeMonth } from "../hours-format.js";
import "@waitron/ui/src/components/wt-button.js";
function duration(minutes: number): string {
  return `${minutes < 0 ? "−" : ""}${Math.floor(Math.abs(minutes) / 60)} h ${String(Math.abs(minutes) % 60).padStart(2, "0")} min`;
}
@customElement("dashboard-hours-record")
export class HoursRecord extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        padding: 0;
        color: var(--wt-color-text);
      }
      .content,
      section,
      article {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--wt-space-3);
      }
      h1,
      h2,
      h3,
      p,
      ul {
        margin: 0;
        overflow-wrap: anywhere;
      }
      h1 {
        font-size: var(--wt-font-size-xl);
      }
      h2 {
        font-size: var(--wt-font-size-lg);
      }
      h3 {
        font-size: var(--wt-font-size-md);
      }
      article,
      section {
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }
      .selectors,
      .actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
      }
      .selectors > * {
        flex: 1;
        min-width: min(100%, var(--wt-form-max-width));
      }
      ul {
        padding-inline-start: var(--wt-space-4);
      }
      li {
        overflow-wrap: anywhere;
      }
      time {
        font-variant-numeric: tabular-nums;
      }
      .error {
        color: var(--wt-color-danger);
      }
      dl {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: var(--wt-space-2) var(--wt-space-3);
        margin: 0;
        overflow-wrap: anywhere;
      }
      dd {
        margin: 0;
      }
      [data-total] {
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];

  @property({ attribute: false }) view: PersonHours | null = null;
  @property({ type: Boolean }) manager = false;
  @property() dayActionLabel = "";
  @property({ type: Boolean }) blocked = false;
  #day(event: Event, date: string): void {
    event.stopPropagation();
    if (this.blocked || !this.dayActionLabel || !this.view || !this.isConnected) return;
    this.dispatchEvent(
      new CustomEvent("hours-day", {
        detail: { date },
        bubbles: true,
        composed: true,
      }),
    );
  }
  override render() {
    const view = this.view;
    if (!view) return nothing;
    const grouped = this.manager && wholeMonth(view.period);
    const items = new Set(view.pending.items.map((item) => item.id));
    const byQuestion = new Map(view.pending.prompts.map((prompt) => [prompt.id, prompt]));
    const prompts = grouped
      ? view.pending.prompts.filter(
          (prompt) =>
            !items.has(prompt.itemId ?? "") &&
            !view.openShifts.some((shift) => shift.questionId === prompt.id),
        )
      : view.pending.prompts;
    const automatic = (id: string) =>
      view.pending.automaticEntryIds.includes(id)
        ? html`<p>
            ${t("attendance.automatic_counted")}
            ${t(this.manager ? "hours.awaiting_worker_acknowledgement" : "hours.awaiting_acknowledgement")}
          </p>`
        : nothing;
    const standaloneAutomatic = view.pending.automaticEntryIds.filter(
      (id) => !grouped || !prompts.some((prompt) => prompt.automaticEntryId === id),
    );
    const time = (at: string, offset: number, zone: string, sameDay?: string) =>
      hoursTime(at, offset, zone, sameDay, view.period.start);
    const history = (entry: PersonHours["record"]["entries"][number]["entry"]) =>
      attendanceHistory(
        entry,
        time(
          entry.eventAt,
          entry.offsetMinutes,
          hoursZone(view, wallClock(entry.eventAt, entry.offsetMinutes).date),
        ),
      );
    return html`<div class="content">
      ${this.manager ? nothing : html`<p>${periodLabel(view.period)}</p>`}
      <p data-total>${t("hours.total")}: ${duration(view.workedMinutes)}</p>
      <p data-paid-break-note>${t("hours.paidBreakNote")}</p>
      ${view.openShifts.map((open) => {
        const prompt = grouped && open.questionId ? byQuestion.get(open.questionId) : undefined;
        const zone = hoursZone(view, wallClock(open.start.eventAt, open.start.offsetMinutes).date);
        return html`<article data-open-shift>
          <h2>${t(open.breakStart ? "clock.on_break" : "hours.open_shift")}</h2>
          <p>${time(open.start.eventAt, open.start.offsetMinutes, zone)}</p>
          ${open.breakStart ? html`<p>${time(open.breakStart.eventAt, open.breakStart.offsetMinutes, zone)}</p>` : nothing}
          ${
            prompt
              ? html`<p>${t("hours.pending")}</p>
                  <ul>
                    ${prompt.history.map(history)}
                  </ul>`
              : nothing
          }
        </article>`;
      })}
      ${view.days.map(
        (day) =>
          html`<article data-day=${day.date}>
            <h2>${hoursDate(day.date, view.period.start)}</h2>
            <p>${duration(day.workedMinutes)}</p>
            ${
              day.sessions.length
                ? day.sessions.map((session) => {
                    const zone = hoursZone(view, session.workDate);
                    return html`<p>
                        <time datetime=${session.startedAt}
                          >${time(session.startedAt, session.startOffsetMinutes, zone)}</time
                        >–<time datetime=${session.endedAt}
                          >${time(session.endedAt, session.endOffsetMinutes, zone, session.workDate)}</time
                        >
                      </p>
                      <p>${t("hours.breaks")}: ${duration(session.breakMinutes)}</p>`;
                  })
                : html`<p>${t("attendance.no_times")}</p>`
            }${this.dayActionLabel ? html`<wt-button data-fix=${day.date} variant="secondary" .disabled=${this.blocked} @click=${(event: Event) => this.#day(event, day.date)}>${this.dayActionLabel}</wt-button>` : nothing}
          </article>`,
      )}
      ${
        prompts.length || view.pending.items.length || standaloneAutomatic.length
          ? html`<section>
              <h2>${t("hours.pending")}</h2>
              ${standaloneAutomatic.map(automatic)}${prompts.map((prompt) => {
                const date = prompt.workDate ?? prompt.businessDay;
                return html`<article>
                  ${date ? html`<h3>${hoursDate(date, view.period.start)}</h3>` : nothing}
                  ${grouped && prompt.automaticEntryId ? automatic(prompt.automaticEntryId) : nothing}
                  <ul>
                    ${prompt.history.map(history)}
                  </ul>
                </article>`;
              })}${view.pending.items.map(
                (item) =>
                  html`<article>
                    <h3>${attendanceStatus(item.status)}</h3>
                    <p>${item.reason}</p>
                    <ul>
                      ${item.history.map(history)}
                    </ul>
                  </article>`,
              )}
            </section>`
          : nothing
      }
      ${
        view.record.entries.length
          ? html`<section>
              <h2>${t("hours.history")}</h2>
              ${view.record.entries.map(
                (row) =>
                  html`<ul>
                    ${history(row.entry)}
                    <li>
                      ${t(row.effective ? "hours.effective" : "hours.history")}${row.author.kind === "automatic" && row.effective ? html` · ${t("attendance.automatic_counted")}` : nothing}${row.confirmedByWorker ? html` · ${t("attendance.confirmed_by_worker")}` : nothing}${row.selfApproved ? html` · ${t("attendance.self_approved")}` : nothing}${row.corrected ? html` · ${t("attendance.corrected")}` : nothing}${row.disputed ? html` · ${t("attendance.disputed")}` : nothing}
                    </li>
                  </ul>`,
              )}
            </section>`
          : nothing
      }
      ${view.closures.map((closure) => {
        const monthly = wholeMonth(closure.period);
        const label = periodLabel(closure.period);
        return html`<section data-closure=${closure.closureId}>
          <h2>${monthly ? fill("hours.closed_month", { month: label }) : t("hours.frozen")}</h2>
          ${monthly ? nothing : html`<p>${label}</p>`}
          <dl>
            <dt>${t("hours.closed_total")}</dt>
            <dd>${duration(closure.frozenWorkedMinutes)}</dd>
            <dt>${t("hours.closed_on")}</dt>
            <dd>
              <time datetime=${closure.closedAt}
                >${dateTimeFormat(currentLocale(), {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: closure.clock.timeZone,
                }).format(new Date(closure.closedAt))}</time
              >
            </dd>
          </dl>
        </section>`;
      })}
      ${view.record.closedPeriodImpacts.map(
        (impact) =>
          html`<section data-impact=${impact.closureId}>
            <h2>${t("hours.late_change")}</h2>
            <dl>
              <dt>${t("hours.closed_total")}</dt>
              <dd>${duration(impact.beforeWorkedMinutes)}</dd>
              <dt>${t("hours.current_total")}</dt>
              <dd>${duration(impact.afterWorkedMinutes)}</dd>
              <dt>${t("hours.total_difference")}</dt>
              <dd>
                ${impact.deltaWorkedMinutes >= 0 ? "+" : ""}${duration(impact.deltaWorkedMinutes)}
              </dd>
            </dl>
          </section>`,
      )}
    </div>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-hours-record": HoursRecord;
  }
}
