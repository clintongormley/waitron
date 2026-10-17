import type { RosterBreach } from "@waitron/workforce/roster-validation";
import { breachText, shiftBreaches } from "./rota-warnings.js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { periodColourStyles } from "@waitron/venue-service/painter";
import { areaKey, type AreaRef, type Slot, type SlotStatus } from "../slots.js";
import type { RotaWeek, StaffRole } from "../staffing-types.js";
import { dateFormat, utc } from "./format.js";
import { minuteTime, shiftTime } from "./rota-format.js";
import { dayCounts, isClosed, type Show, type Target } from "./rota-model.js";
import { countWords, t, tf } from "./strings.js";

/** A day's header: the date, then what needs attention in scope, or Closed. */
export function dayHead(week: RotaWeek, show: Show, businessDay: string) {
  const counts = dayCounts(week, show, businessDay);
  const words = isClosed(week, show, businessDay)
    ? t("staffing.rota.closed")
    : (["unfilled", "partly", "over"] as const)
        .filter((k) => counts[k] > 0)
        .map((k) => countWords(k, counts[k]))
        .join(" · ");
  return html`<th scope="col" data-day-head=${businessDay}>
    ${dateFormat({ weekday: "short", day: "numeric" }).format(utc(businessDay))}${words ? html`<small>${words}</small>` : nothing}
  </th>`;
}

/** Focuses a target's slot, card or day header, letting focus land on one that is not a button.
 *  False when the grid does not draw it. */
export function focusIn(root: ShadowRoot, target: Target, bySlot: boolean): boolean {
  const selector = target.header
    ? `th[data-day-head="${target.businessDay}"]`
    : bySlot && target.slotKey
      ? `[data-slot="${target.slotKey}"]`
      : target.shiftId
        ? `[data-shift="${target.shiftId}"]`
        : undefined;
  const found = selector ? root.querySelector<HTMLElement>(selector) : null;
  if (!found) return false;
  if (!(found instanceof HTMLButtonElement)) found.tabIndex = -1;
  found.focus();
  found.scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}

@customElement("rota-by-area")
export class RotaByArea extends LitElement {
  static override styles = [
    baseStyles,
    periodColourStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .scroll {
        overflow: auto;
        max-width: 100%;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }
      table {
        width: 100%;
        min-width: calc(var(--wt-tap-min) * 20);
        border-collapse: separate;
        border-spacing: 0;
        table-layout: fixed;
        font-size: var(--wt-font-size-sm);
      }
      th,
      td {
        padding: var(--wt-space-2);
        border-inline-end: 1px solid var(--wt-color-border);
        border-block-end: 1px solid var(--wt-color-border);
        vertical-align: top;
        text-align: start;
        overflow-wrap: anywhere;
      }
      th {
        background: var(--wt-color-surface);
        font-weight: var(--wt-font-weight-bold);
      }
      th[scope="row"],
      thead th:first-child {
        position: sticky;
        inset-inline-start: 0;
        width: calc(var(--wt-tap-min) * 3);
        z-index: 1;
      }
      .card {
        display: block;
        width: 100%;
        padding: var(--wt-space-2);
        margin-block-end: var(--wt-space-1);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        font: inherit;
        text-align: start;
        overflow-wrap: anywhere;
      }
      .card[data-kind="filled"] {
        border-inline-start: var(--wt-space-1) solid var(--wt-color-success);
      }
      .card[data-kind="partly_uncovered"],
      .card[data-kind="over"] {
        border-inline-start: var(--wt-space-1) solid var(--wt-color-warning);
      }
      .card[data-kind="unfilled"] {
        border: 1px dashed var(--wt-color-text-muted);
        background: var(--wt-color-surface);
      }
      button.card {
        cursor: pointer;
      }
      button:focus-visible,
      [tabindex="-1"]:focus-visible {
        outline: var(--wt-field-line-width-active) solid var(--wt-color-focus);
        outline-offset: var(--wt-focus-offset);
      }
      small {
        display: block;
        color: var(--wt-color-text-muted);
      }
      .note {
        font-size: var(--wt-font-size-sm);
      }
      th[data-over-contract] .hours {
        color: var(--wt-color-warning);
        font-weight: var(--wt-font-weight-bold);
      }
      .swatch {
        display: inline-block;
        width: var(--wt-space-2);
        height: var(--wt-space-2);
        margin-inline-end: var(--wt-space-1);
        border-radius: var(--wt-radius-sm);
        background: var(--period-fill);
      }
    `,
  ];
  @property({ attribute: false }) week!: RotaWeek;
  @property({ attribute: false }) breaches: RosterBreach[] = [];
  @property({ attribute: false }) area!: AreaRef;
  @property({ type: Boolean }) editable = false;
  #show(): Show {
    return { kind: "area", area: this.area, key: areaKey(this.area), name: "" };
  }
  focusTarget(target: Target): boolean {
    return focusIn(this.renderRoot as ShadowRoot, target, true);
  }
  #person(shiftId: string) {
    const s = this.week.shifts.find((s) => s.shiftId === shiftId)!;
    return this.week.people.find((p) => p.personId === s.personId)?.name ?? "";
  }
  #pick(slot: Slot, anchor: HTMLElement) {
    this.dispatchEvent(
      new CustomEvent("pick-slot", { detail: { slot, anchor }, bubbles: true, composed: true }),
    );
  }
  #edit(shiftId: string) {
    this.dispatchEvent(
      new CustomEvent("edit-shift", { detail: { shiftId }, bubbles: true, composed: true }),
    );
  }
  #notes(shiftId: string) {
    const shift = this.week.shifts.find((s) => s.shiftId === shiftId)!;
    const daily = this.breaches.filter(
      (b) =>
        b.kind === "exceeds_daily_max" &&
        b.personId === shift.personId &&
        b.workDate === shift.businessDay,
    );
    return html`${this.week.openSwaps.some((s) => s.fromShiftId === shiftId || s.toShiftId === shiftId) ? html`<small>${t("staffing.shift.swap_heading")}</small>` : nothing}${[...shiftBreaches(this.breaches, shiftId), ...daily].map((b) => html`<small>${breachText(b)}</small>`)}`;
  }
  #card(shiftId: string, content: unknown, kind?: string) {
    return this.editable
      ? html`<button
          class="card"
          data-shift=${shiftId}
          data-kind=${kind ?? nothing}
          @click=${() => this.#edit(shiftId)}
        >
          ${content}${this.#notes(shiftId)}
        </button>`
      : html`<div class="card" data-shift=${shiftId} data-kind=${kind ?? nothing}>
          ${content}${this.#notes(shiftId)}
        </div>`;
  }
  #slot(slot: Slot, status: SlotStatus, cutover: string) {
    const assigned =
      status.kind === "unfilled"
        ? nothing
        : html` <strong>${this.#person(status.shiftId)}</strong>
            ${status.kind === "partly_uncovered" ? html`<small>${tf("staffing.rota.uncovered", { times: status.uncovered.map((u) => `${minuteTime(u.start, cutover)}–${minuteTime(u.end, cutover)}`).join(", ") })}</small>` : nothing}
            ${status.outsideRole ? html`<small>${t("staffing.rota.outside_role")}</small>` : nothing}
            ${this.#notes(status.shiftId)}`;
    const content = html`<span>${slot.startsAt}–${slot.endsAt}</span>
      ${status.kind === "unfilled" ? html`<strong>${t("staffing.rota.unfilled")}</strong>` : assigned}`;
    return this.editable
      ? html`<button
          class="card"
          data-kind=${status.kind}
          data-slot=${slot.key}
          @click=${(e: Event) =>
            status.kind === "unfilled"
              ? this.#pick(slot, e.currentTarget as HTMLElement)
              : this.#edit(status.shiftId)}
        >
          ${content}
        </button>`
      : html`<div class="card" data-kind=${status.kind} data-slot=${slot.key}>${content}</div>`;
  }
  #cell(role: StaffRole, day: RotaWeek["days"][number]) {
    const match = day.areas.find((a) => areaKey(a.area) === areaKey(this.area))?.match;
    return html`${match?.slots.filter((s) => s.slot.staffRoleId === role.id).map((s) => this.#slot(s.slot, s.status, day.cutover))}${match?.over
      .map((id) => this.week.shifts.find((s) => s.shiftId === id)!)
      .filter((s) => s.staffRoleId === role.id)
      .map((s) =>
        this.#card(
          s.shiftId,
          html`${shiftTime(s)} <strong>${this.#person(s.shiftId)}</strong
            ><small>${t("staffing.rota.over")}</small>`,
          "over",
        ),
      )}`;
  }
  override render() {
    if (!this.week || !this.area) return nothing;
    return html`<div
      class="scroll"
      data-test="grid-scroll"
      tabindex="0"
      role="region"
      aria-label=${t("staffing.rota.tab")}
    >
      <table>
        <thead>
          <tr>
            <th scope="col">${t("staffing.rota.staff_role")}</th>
            ${this.week.days.map((d) => dayHead(this.week, this.#show(), d.businessDay))}
          </tr>
        </thead>
        <tbody>
          ${[...this.week.staffRoles]
            .sort((a, b) => a.position - b.position)
            .map(
              (role) =>
                html`<tr>
                  <th scope="row">
                    <span class="swatch" data-colour=${role.colour}></span>${role.name}
                  </th>
                  ${this.week.days.map((day) => html`<td>${this.#cell(role, day)}</td>`)}
                </tr>`,
            )}
          <tr>
            <th scope="row">${t("staffing.rota.not_in_slot")}</th>
            ${this.week.days.map(
              (day) =>
                html`<td>
                  ${day.notInSlot.map((n) => {
                    const s = this.week.shifts.find((s) => s.shiftId === n.shiftId)!;
                    return this.#card(
                      n.shiftId,
                      html`${shiftTime(s)}
                        <strong>${this.#person(n.shiftId)}</strong
                        >${n.outsideWeek ? html`<small class="note">${t(s.businessDay < this.week.week ? "staffing.rota.previous_week" : "staffing.rota.next_week")}</small>` : nothing}`,
                    );
                  })}
                </td>`,
            )}
          </tr>
        </tbody>
      </table>
    </div>`;
  }
}
