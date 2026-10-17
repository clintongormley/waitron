import type { RosterBreach } from "@waitron/workforce/roster-validation";
import { html, nothing, type TemplateResult } from "lit";
import { areaKey, type Slot, type SlotStatus } from "../slots.js";
import type { RotaWeek } from "../staffing-types.js";
import { minuteTime, shiftTime } from "./rota-format.js";
import { breachText, shiftBreaches } from "./rota-warnings.js";
import { t, tf } from "./strings.js";

/** The element a card is drawn in and sends its events from. */
export type CardHost = HTMLElement & {
  week: RotaWeek;
  breaches: RosterBreach[];
  editable: boolean;
};
type Shift = RotaWeek["shifts"][number];

/** A read's shifts and people by id, the shifts beyond their area's slots, and each partly
 *  uncovered shift's uncovered times in reading order. */
type CardIndex = {
  shifts: Map<string, Shift>;
  people: Map<string, RotaWeek["people"][number]>;
  over: Set<string>;
  uncovered: Map<string, string[]>;
};
const indexes = new WeakMap<RotaWeek, CardIndex>();

/** Kept for as long as the read is: a read is never changed once drawn. */
function indexOf(week: RotaWeek): CardIndex {
  let index = indexes.get(week);
  if (!index) {
    index = {
      shifts: new Map(week.shifts.map((s) => [s.shiftId, s])),
      people: new Map(week.people.map((p) => [p.personId, p])),
      over: new Set(),
      uncovered: new Map(),
    };
    for (const d of week.days)
      for (const a of d.areas) {
        for (const id of a.match.over) index.over.add(id);
        for (const { status } of a.match.slots)
          if (status.kind === "partly_uncovered")
            index.uncovered.set(status.shiftId, [
              ...(index.uncovered.get(status.shiftId) ?? []),
              ...status.uncovered.map(
                (u) => `${minuteTime(u.start, d.cutover)}–${minuteTime(u.end, d.cutover)}`,
              ),
            ]);
      }
    indexes.set(week, index);
  }
  return index;
}

/** The read's shift with this id. */
export function shiftOf(week: RotaWeek, shiftId: string): Shift {
  return indexOf(week).shifts.get(shiftId)!;
}

function emit(host: CardHost, name: string, detail: unknown) {
  host.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}
function personName(week: RotaWeek, shiftId: string) {
  return indexOf(week).people.get(shiftOf(week, shiftId).personId)?.name ?? "";
}
function swapNote(week: RotaWeek, shiftId: string) {
  return week.openSwaps.some((s) => s.fromShiftId === shiftId || s.toShiftId === shiftId)
    ? html`<small>${t("staffing.shift.swap_heading")}</small>`
    : nothing;
}
export function warnings(breaches: RosterBreach[]) {
  return breaches.map((b) => html`<small class="danger">${breachText(b)}</small>`);
}
/** A person's warnings about one business day. */
export function dailyBreaches(breaches: RosterBreach[], personId: string, businessDay: string) {
  return breaches.filter(
    (b) => b.kind === "exceeds_daily_max" && b.personId === personId && b.workDate === businessDay,
  );
}
/** A person's warnings about their week: those about neither a shift nor a day. */
export function weekBreaches(breaches: RosterBreach[], personId: string) {
  return breaches.filter(
    (b) => b.personId === personId && !("shiftId" in b) && b.kind !== "exceeds_daily_max",
  );
}
function areaNotes(host: CardHost, shiftId: string) {
  const shift = shiftOf(host.week, shiftId);
  const daily = dailyBreaches(host.breaches, shift.personId, shift.businessDay);
  return html`${swapNote(host.week, shiftId)}${warnings([...shiftBreaches(host.breaches, shiftId), ...daily])}`;
}

/** An area's shift card: the given content, then its swap note and warnings. */
export function areaCard(host: CardHost, shiftId: string, content: unknown, kind?: string) {
  return host.editable
    ? html`<button
        class="card"
        data-shift=${shiftId}
        data-kind=${kind ?? nothing}
        @click=${() => emit(host, "edit-shift", { shiftId })}
      >
        ${content}${areaNotes(host, shiftId)}
      </button>`
    : html`<div class="card" data-shift=${shiftId} data-kind=${kind ?? nothing}>
        ${content}${areaNotes(host, shiftId)}
      </div>`;
}

/** A slot in an area: dashed with "Fill" while unfilled, else its time and person. */
export function slotCard(host: CardHost, slot: Slot, status: SlotStatus, cutover: string) {
  const assigned =
    status.kind === "unfilled"
      ? nothing
      : html` <strong>${personName(host.week, status.shiftId)}</strong>
          ${status.kind === "partly_uncovered" ? html`<small class="danger">${tf("staffing.rota.uncovered", { times: status.uncovered.map((u) => `${minuteTime(u.start, cutover)}–${minuteTime(u.end, cutover)}`).join(", ") })}</small>` : nothing}
          ${status.outsideRole ? html`<small class="warning">${t("staffing.rota.outside_role")}</small>` : nothing}
          ${areaNotes(host, status.shiftId)}`;
  const content = html`<span>${slot.startsAt}–${slot.endsAt}</span>
    ${status.kind === "unfilled" ? html`· <strong>${t("staffing.rota.fill")}</strong>` : assigned}`;
  return host.editable
    ? html`<button
        class="card"
        data-kind=${status.kind}
        data-slot=${slot.key}
        @click=${(e: Event) =>
          status.kind === "unfilled"
            ? emit(host, "pick-slot", { slot, anchor: e.currentTarget as HTMLElement })
            : emit(host, "edit-shift", { shiftId: status.shiftId })}
      >
        ${content}
      </button>`
    : html`<div class="card" data-kind=${status.kind} data-slot=${slot.key}>${content}</div>`;
}

/** A shift beyond its area's slots for its staff role. */
export function overCard(host: CardHost, s: Shift) {
  return areaCard(
    host,
    s.shiftId,
    html`${shiftTime(s)} <strong>${personName(host.week, s.shiftId)}</strong
      ><small>${t("staffing.rota.over")}</small>`,
    "over",
  );
}

/** A shift in no slot, saying when it belongs to the week before or after. */
export function notInSlotCard(host: CardHost, n: { shiftId: string; outsideWeek: boolean }) {
  const s = shiftOf(host.week, n.shiftId);
  return areaCard(
    host,
    n.shiftId,
    html`${shiftTime(s)}
      <strong>${personName(host.week, n.shiftId)}</strong
      >${n.outsideWeek ? html`<small class="note">${t(s.businessDay < host.week.week ? "staffing.rota.previous_week" : "staffing.rota.next_week")}</small>` : nothing}`,
  );
}

/** A person's shift card in Everyone: the staff role's colour, time, "Area · Role" and warnings. */
export function personShiftCard(host: CardHost, shift: Shift): TemplateResult {
  const week = host.week;
  const area = week.areas.find((a) => shift.area && areaKey(a.area) === areaKey(shift.area));
  const staffRole = week.staffRoles.find((r) => r.id === shift.staffRoleId);
  const overflow = shift.businessDay < week.week || shift.businessDay > week.days[6]!.businessDay;
  const index = indexOf(week);
  const over = index.over.has(shift.shiftId);
  const uncovered = index.uncovered.get(shift.shiftId) ?? [];
  const content = html`<span
      >${staffRole ? html`<span class="swatch" data-colour=${staffRole.colour}></span>` : nothing}${shiftTime(shift)}</span
    ><small
      >${area?.name ?? t("staffing.rota.not_in_slot")}${staffRole ? ` · ${staffRole.name}` : ""}</small
    >
    ${overflow ? html`<small>${t(shift.businessDay < week.week ? "staffing.rota.previous_week" : "staffing.rota.next_week")}</small>` : nothing}
    ${over ? html`<small>${t("staffing.rota.over")}</small>` : nothing}
    ${uncovered.length > 0 ? html`<small class="danger">${tf("staffing.rota.uncovered", { times: uncovered.join(", ") })}</small>` : nothing}
    ${staffRole && !index.people.get(shift.personId)?.staffRoleIds.includes(staffRole.id) ? html`<small class="warning">${t("staffing.rota.outside_role")}</small>` : nothing}
    ${swapNote(week, shift.shiftId)} ${warnings(shiftBreaches(host.breaches, shift.shiftId))}`;
  const kind = over ? "over" : uncovered.length > 0 ? "partly_uncovered" : nothing;
  return host.editable
    ? html`<button
        class="card"
        data-shift=${shift.shiftId}
        data-kind=${kind}
        @click=${() => emit(host, "edit-shift", { shiftId: shift.shiftId })}
      >
        ${content}
      </button>`
    : html`<div class="card" data-shift=${shift.shiftId} data-kind=${kind}>${content}</div>`;
}

/** A person's shifts drawn on a day: those of that business day, and those in no slot there. */
export function personDayShifts(week: RotaWeek, personId: string, day: RotaWeek["days"][number]) {
  return week.shifts.filter(
    (s) =>
      s.personId === personId &&
      (s.businessDay === day.businessDay || day.notInSlot.some((n) => n.shiftId === s.shiftId)),
  );
}
