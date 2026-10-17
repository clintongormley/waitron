import type { RosterBreach } from "@waitron/workforce/roster-validation";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { periodColourStyles } from "@waitron/venue-service/painter";
import { areaKey, type AreaRef } from "../slots.js";
import type { RotaWeek, StaffRole } from "../staffing-types.js";
import { dateFormat, dateLabel, utc } from "./format.js";
import { notInSlotCard, overCard, slotCard } from "./rota-cards.js";
import { dayCounts, isClosed, rolesShown, type Show, type Target } from "./rota-model.js";
import { countWords, t, tf } from "./strings.js";

/** What a day's header says below the date: its attention in scope, in the warning colour, or
 *  Closed. */
export function dayNote(week: RotaWeek, show: Show, businessDay: string) {
  if (isClosed(week, show, businessDay)) return html`<small>${t("staffing.rota.closed")}</small>`;
  const counts = dayCounts(week, show, businessDay);
  const words = (["unfilled", "partly", "over"] as const)
    .filter((k) => counts[k] > 0)
    .map((k) => countWords(k, counts[k]))
    .join(" · ");
  return words ? html`<small class="counts">${words}</small>` : nothing;
}

/** A day's header: the date, then what needs attention in scope, or Closed. */
export function dayHead(week: RotaWeek, show: Show, businessDay: string) {
  return html`<th scope="col" data-day-head=${businessDay}>
    ${dateFormat({ weekday: "short", day: "numeric" }).format(utc(businessDay))}${dayNote(week, show, businessDay)}
  </th>`;
}

/** Focuses a target's slot, card or day header, letting focus land on one that is not a button.
 *  False when the grid does not draw it. */
export function focusIn(root: ShadowRoot, target: Target, bySlot: boolean): boolean {
  const selector = target.header
    ? `[data-day-head="${target.businessDay}"]`
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
      td {
        height: 1px;
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
        border: 1px dashed var(--wt-color-warning);
        background: var(--wt-color-surface);
        color: var(--wt-color-warning);
      }
      button.card {
        cursor: pointer;
      }
      .cell {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: var(--wt-tap-min);
      }
      .add {
        flex: 1;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2);
        border: 1px dashed var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        background: transparent;
        color: var(--wt-color-text-muted);
        font: inherit;
        text-align: start;
        cursor: pointer;
        opacity: 0;
      }
      .add:hover,
      .add:focus-visible {
        opacity: 1;
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
      small.counts {
        color: var(--wt-color-warning);
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
  #show(): Show & { kind: "area" } {
    return { kind: "area", area: this.area, key: areaKey(this.area), name: "" };
  }
  focusTarget(target: Target): boolean {
    return focusIn(this.renderRoot as ShadowRoot, target, true);
  }
  #add(day: string, role: StaffRole) {
    this.dispatchEvent(
      new CustomEvent("add-shift", {
        detail: { businessDay: day, area: this.area, staffRoleId: role.id },
        bubbles: true,
        composed: true,
      }),
    );
  }
  #cell(role: StaffRole, day: RotaWeek["days"][number]) {
    const match = day.areas.find((a) => areaKey(a.area) === areaKey(this.area))?.match;
    return html`<div class="cell">
      ${match?.slots.filter((s) => s.slot.staffRoleId === role.id).map((s) => slotCard(this, s.slot, s.status, day.cutover))}${match?.over
        .map((id) => this.week.shifts.find((s) => s.shiftId === id)!)
        .filter((s) => s.staffRoleId === role.id)
        .map((s) => overCard(this, s))}${
        this.editable
          ? html`<button
              class="add"
              data-test="cell-add"
              aria-label=${tf("staffing.rota.add_label_area", { role: role.name, day: dateLabel(day.businessDay) })}
              @click=${() => this.#add(day.businessDay, role)}
            >
              ${t("staffing.rota.add_here")}
            </button>`
          : nothing
      }
    </div>`;
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
          ${rolesShown(this.week, this.#show()).map(
            (role) =>
              html`<tr>
                <th scope="row">
                  <span class="swatch" data-colour=${role.colour}></span>${role.name}
                </th>
                ${this.week.days.map((day) => html`<td>${this.#cell(role, day)}</td>`)}
              </tr>`,
          )}
          ${
            this.week.days.some((d) => d.notInSlot.length > 0)
              ? html`<tr>
                  <th scope="row">${t("staffing.rota.not_in_slot")}</th>
                  ${this.week.days.map(
                    (day) => html`<td>${day.notInSlot.map((n) => notInSlotCard(this, n))}</td>`,
                  )}
                </tr>`
              : nothing
          }
        </tbody>
      </table>
    </div>`;
  }
}
