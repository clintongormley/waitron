import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import type {
  AttendanceInbox,
  AttendancePrompt,
  HoursSelection,
  PersonHours,
} from "../api/client.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import {
  attendanceHistory,
  attendanceStatus,
  storedAttendanceTime,
} from "../widgets/attendance-history.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";

function duration(minutes: number): string {
  return `${minutes < 0 ? "−" : ""}${Math.floor(Math.abs(minutes) / 60)} h ${String(Math.abs(minutes) % 60).padStart(2, "0")} min`;
}
function dateAfter(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
@customElement("till-hours-screen")
export class TillHoursScreen extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        padding: var(--wt-space-4);
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
  @property({ type: Boolean }) reading = false;
  @property({ type: Boolean }) blocked = false;
  @property({ type: Boolean }) canRetry = false;
  @property() error = "";
  @property({ attribute: false }) locations: AttendanceInbox["locations"] = [];
  @state() private selectedLocation = "";
  @state() private selection: HoursSelection = { kind: "week" };
  override willUpdate(changed: PropertyValues): void {
    if (changed.has("view") && this.view) {
      this.selectedLocation = this.view.locationId;
      this.selection = { ...this.view.selection };
    }
  }
  #emit(event: Event, type: string, detail: unknown = null): void {
    event.stopPropagation();
    if (
      !this.isConnected ||
      ((this.reading || this.blocked) && (type === "hours-day" || type === "hours-prompt"))
    )
      return;
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
  #choose(event: CustomEvent<{ value: string }>, field: "location" | "kind" | "date"): void {
    event.stopPropagation();
    const value = event.detail.value;
    const locationId =
      field === "location" ? value : this.selectedLocation || this.locations[0]?.id;
    if (!locationId || !this.locations.some((l) => l.id === locationId)) return;
    if (field === "kind" && value !== "week" && value !== "month") return;
    if (
      field === "date" &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)
    )
      return;
    const selection: HoursSelection =
      field === "kind"
        ? { ...this.selection, kind: value as "week" | "month" }
        : field === "date"
          ? { ...this.selection, date: value }
          : { ...this.selection };
    this.selection = selection;
    this.selectedLocation = locationId;
    this.#emit(event, "hours-select", { locationId, selection });
  }
  #move(event: Event, direction: number): void {
    const date = this.selection.date ?? this.view?.businessDay;
    if (!date) return;
    let next: string;
    if (this.selection.kind === "week") next = dateAfter(date, direction * 7);
    else {
      const value = new Date(`${date}T00:00:00Z`);
      value.setUTCDate(1);
      value.setUTCMonth(value.getUTCMonth() + direction);
      next = value.toISOString().slice(0, 10);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return;
    this.selection = { ...this.selection, date: next };
    this.#emit(event, "hours-select", {
      locationId: this.selectedLocation,
      selection: this.selection,
    });
  }
  #prompt(prompt: AttendancePrompt) {
    const item = this.view?.pending.items.find((i) => i.id === prompt.itemId);
    const action = (kind: "confirm" | "edit" | "accept" | "disagree", label: string) =>
      html`<wt-button
        data-prompt-action=${kind}
        variant="secondary"
        .disabled=${this.reading || this.blocked || (kind === "accept" && item?.readyToApply !== true)}
        @click=${(event: Event) => this.#emit(event, "hours-prompt", { promptId: prompt.id, action: kind })}
        >${label}</wt-button
      >`;
    return html`<article data-prompt=${prompt.id}>
      <h3>${prompt.locationName}${prompt.businessDay ? ` · ${prompt.businessDay}` : ""}</h3>
      <p>
        ${t(prompt.kind === "automatic-out" ? "attendance.automatic_counted" : prompt.kind === "missing-times" ? "attendance.supply" : "attendance.proposal")}
      </p>
      <ul>
        ${prompt.history.map(attendanceHistory)}
      </ul>
      <div class="actions">
        ${prompt.kind === "automatic-out" ? action("confirm", t("attendance.confirm")) : nothing}
        ${prompt.kind === "proposal" ? html`${action("accept", t("attendance.accept"))}${action("disagree", t("attendance.disagree"))}` : action("edit", t("attendance.fix_hours"))}
      </div>
    </article>`;
  }
  override render() {
    const view = this.view;
    return html`<div class="content">
      <div class="actions">
        <wt-button
          data-back
          variant="secondary"
          @click=${(event: Event) => this.#emit(event, "back")}
          >${t("hours.back")}</wt-button
        >
        <h1>${t("hours.mine")}</h1>
        <wt-button
          data-refresh
          variant="secondary"
          .disabled=${this.reading}
          @click=${(event: Event) => this.#emit(event, "hours-refresh")}
          >${t("hours.refresh")}</wt-button
        >
      </div>
      <div class="selectors">
        <wt-combobox
          name="hoursLocation"
          label=${t("attendance.location")}
          .value=${this.selectedLocation || this.locations[0]?.id || ""}
          .options=${this.locations.map((l) => ({ value: l.id, label: l.name }))}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#choose(event, "location")}
        ></wt-combobox>
        <wt-combobox
          name="hoursWindow"
          label=${t("hours.window")}
          .value=${this.selection.kind}
          .options=${[
            { value: "week", label: t("hours.week") },
            { value: "month", label: t("hours.month") },
          ]}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#choose(event, "kind")}
        ></wt-combobox>
        <wt-input
          name="hoursDate"
          type="date"
          label=${t("attendance.date")}
          .value=${this.selection.date ?? view?.businessDay ?? ""}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#choose(event, "date")}
        ></wt-input>
      </div>
      <div class="actions">
        <wt-button
          data-previous
          variant="secondary"
          .disabled=${!view && !this.selection.date}
          @click=${(event: Event) => this.#move(event, -1)}
          >${t("hours.previous")}</wt-button
        ><wt-button
          data-next
          variant="secondary"
          .disabled=${!view && !this.selection.date}
          @click=${(event: Event) => this.#move(event, 1)}
          >${t("hours.next")}</wt-button
        >
      </div>
      ${this.error ? html`<p role="status" class="error">${this.error}</p>` : this.reading ? html`<p role="status">${t("attendance.reading")}</p>` : nothing}
      ${this.canRetry ? html`<wt-button data-retry-response variant="primary" .disabled=${this.reading} @click=${(event: Event) => this.#emit(event, "hours-retry-response")}>${t("attendance.retry_response")}</wt-button>` : nothing}
      ${
        view
          ? html`<p>${view.period.start} · ${dateAfter(view.period.end, -1)}</p>
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
                    }<wt-button
                      data-fix=${day.date}
                      variant="secondary"
                      .disabled=${this.reading || this.blocked}
                      @click=${(event: Event) => this.#emit(event, "hours-day", { date: day.date, locationId: view.locationId })}
                      >${t("attendance.fix_hours")}</wt-button
                    >
                  </article>`,
              )}
              ${
                view.pending.prompts.length ||
                view.pending.items.length ||
                view.pending.automaticEntryIds.length
                  ? html`<section>
                      <h2>${t("hours.pending")}</h2>
                      ${view.pending.automaticEntryIds.map(() => html`<p>${t("attendance.automatic_counted")} ${t("hours.awaiting_acknowledgement")}</p>`)}${view.pending.prompts.map((prompt) => this.#prompt(prompt))}${view.pending.items.map(
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
                      ${duration(impact.beforeWorkedMinutes)} ·
                      ${duration(impact.afterWorkedMinutes)} ·
                      ${impact.deltaWorkedMinutes >= 0 ? "+" : ""}${duration(impact.deltaWorkedMinutes)}
                    </p>
                  </section>`,
              )} `
          : nothing
      }
    </div>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "till-hours-screen": TillHoursScreen;
  }
}
