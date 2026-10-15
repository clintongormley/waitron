import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import type { PersonHours } from "@waitron/dashboard-modules";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { attendanceHistory, attendanceStatus, storedAttendanceTime } from "./attendance-history.js";
import "@waitron/ui/src/components/wt-button.js";
function duration(minutes: number): string {
  return `${minutes < 0 ? "−" : ""}${Math.floor(Math.abs(minutes) / 60)} h ${String(Math.abs(minutes) % 60).padStart(2, "0")} min`;
}
function dateAfter(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
      [data-total] {
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];

  @property({ attribute: false }) view: PersonHours | null = null;
  @property() dayActionLabel = "";
  @property({ type: Boolean }) blocked = false;
  #day(event: Event, date: string): void {
    event.stopPropagation();
    if (this.blocked || !this.dayActionLabel || !this.view || !this.isConnected) return;
    this.dispatchEvent(
      new CustomEvent("hours-day", {
        detail: { date, locationId: this.view.locationId },
        bubbles: true,
        composed: true,
      }),
    );
  }
  override render() {
    const view = this.view;
    if (!view) return nothing;
    return html`<div class="content">
      <p>${view.period.start} · ${dateAfter(view.period.end, -1)}</p>
      <p data-total>${t("hours.total")}: ${duration(view.workedMinutes)}</p>
      ${view.openShifts.map(
        (open) =>
          html`<article data-open-shift>
            <h2>${t(open.breakStart ? "clock.on_break" : "hours.open_shift")}</h2>
            <p>${storedAttendanceTime(open.start.eventAt, open.start.offsetMinutes)}</p>
            ${open.breakStart ? html`<p>${storedAttendanceTime(open.breakStart.eventAt, open.breakStart.offsetMinutes)}</p>` : nothing}
          </article>`,
      )}
      ${view.days.map(
        (day) =>
          html`<article data-day=${day.date}>
            <h2>${day.date}</h2>
            <p>${duration(day.workedMinutes)}</p>
            ${
              day.sessions.length
                ? day.sessions.map(
                    (session) =>
                      html`<p>
                          <time datetime=${session.startedAt}
                            >${storedAttendanceTime(session.startedAt, session.startOffsetMinutes)}</time
                          >
                          ·
                          <time datetime=${session.endedAt}
                            >${storedAttendanceTime(session.endedAt, session.endOffsetMinutes)}</time
                          >
                        </p>
                        <p>${t("hours.breaks")}: ${duration(session.breakMinutes)}</p>`,
                  )
                : html`<p>${t("attendance.no_times")}</p>`
            }${this.dayActionLabel ? html`<wt-button data-fix=${day.date} variant="secondary" .disabled=${this.blocked} @click=${(event: Event) => this.#day(event, day.date)}>${this.dayActionLabel}</wt-button>` : nothing}
          </article>`,
      )}
      ${
        view.pending.prompts.length ||
        view.pending.items.length ||
        view.pending.automaticEntryIds.length
          ? html`<section>
              <h2>${t("hours.pending")}</h2>
              ${view.pending.automaticEntryIds.map(() => html`<p>${t("attendance.automatic_counted")} ${t("hours.awaiting_acknowledgement")}</p>`)}${view.pending.prompts.map(
                (prompt) =>
                  html`<article>
                    <h3>${prompt.locationName} · ${prompt.businessDay ?? ""}</h3>
                    <ul>
                      ${prompt.history.map(attendanceHistory)}
                    </ul>
                  </article>`,
              )}${view.pending.items.map(
                (item) =>
                  html`<article>
                    <h3>${attendanceStatus(item.status)}</h3>
                    <p>${item.reason}</p>
                    <ul>
                      ${item.history.map(attendanceHistory)}
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
                    ${attendanceHistory(row.entry)}
                    <li>
                      ${t(row.effective ? "hours.effective" : "hours.history")}${row.author.kind === "automatic" && row.effective ? html` · ${t("attendance.automatic_counted")}` : nothing}${row.confirmedByWorker ? html` · ${t("attendance.confirmed_by_worker")}` : nothing}${row.selfApproved ? html` · ${t("attendance.self_approved")}` : nothing}${row.corrected ? html` · ${t("attendance.corrected")}` : nothing}${row.disputed ? html` · ${t("attendance.disputed")}` : nothing}
                    </li>
                  </ul>`,
              )}
            </section>`
          : nothing
      }
      ${view.closures.map(
        (closure) =>
          html`<section data-closure=${closure.closureId}>
            <h2>${t("hours.frozen")}</h2>
            <p>${closure.period.start} · ${dateAfter(closure.period.end, -1)}</p>
            <p>${duration(closure.frozenWorkedMinutes)}</p>
            <p>${closure.clock.timeZone} · ${closure.clock.dayCutover}</p>
            <time datetime=${closure.closedAt}>${closure.closedAt}</time>
          </section>`,
      )}
      ${view.record.closedPeriodImpacts.map(
        (impact) =>
          html`<section data-impact=${impact.closureId}>
            <h2>${t("hours.late_change")}</h2>
            <p>
              ${duration(impact.beforeWorkedMinutes)} · ${duration(impact.afterWorkedMinutes)} ·
              ${impact.deltaWorkedMinutes >= 0 ? "+" : ""}${duration(impact.deltaWorkedMinutes)}
            </p>
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
