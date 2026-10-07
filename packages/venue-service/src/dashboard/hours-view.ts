// How the Hours page reads its model: shared by the week, the special-dates list and the calendar.
import { currentLocale } from "@waitron/dashboard-kit";
import { html } from "lit";
import type {
  DateHoursCell,
  HourPeriod,
  HoursModel,
  HoursModelSubject,
  HoursSubject,
  LocalDate,
  SpecialDate,
  WeekCell,
} from "../hours-types.js";
import { weekdayOf } from "../hours-rules.js";
import { t } from "./strings.js";

export function format(key: Parameters<typeof t>[0], values: Record<string, string> = {}): string {
  return t(key).replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(values, name) ? values[name]! : whole,
  );
}

const PERIOD_JOINER = ", ";

/** How a Closed, all-day or periods cell reads. */
export function cellText(cell: { mode: string; periods: readonly HourPeriod[] }): string {
  if (cell.mode === "closed") return t("hours.closed");
  if (cell.mode === "all_day") return t("hours.all_day");
  return cell.periods.map((period) => `${period.opensAt}–${period.closesAt}`).join(PERIOD_JOINER);
}

/**
 * A cell's text as one `range` span per period, so it wraps between periods, never inside one
 * ("12:00–" / "23:00"). The comma stays inside its span, so no line starts with it.
 */
export function unbrokenRanges(text: string) {
  const parts = text.split(PERIOD_JOINER);
  return parts.map((part, index) =>
    index < parts.length - 1
      ? html`<span class="range">${part},</span> `
      : html`<span class="range">${part}</span>`,
  );
}

export const keyOf = (subject: HoursSubject) => `${subject.kind}:${subject.id}`;
export const isDefaultStation = (subject: HoursModelSubject) =>
  subject.kind === "station" && subject.isDefault;

function dateFormat(options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(currentLocale().startsWith("es") ? "es-ES" : "en-GB", {
    ...options,
    timeZone: "UTC",
  });
}
const asUtc = (date: LocalDate) => new Date(`${date}T00:00:00Z`);

/** A date as the dashboard reads it, "Mon 12 Oct 2026", in the dashboard's language. */
export function formatDate(date: LocalDate): string {
  return dateFormat({ weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(
    asUtc(date),
  );
}

/** A date written out in full, "Monday, 12 October 2026", for a name read aloud. */
export function formatLongDate(date: LocalDate): string {
  return dateFormat({ weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(
    asUtc(date),
  );
}

/** The browser's own date, which stands in for the venue's until the venue's date is read. */
export function browserToday(): LocalDate {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function weekCellOf(model: HoursModel, subject: HoursSubject, weekday: number): WeekCell {
  const days = model.week.find((entry) => keyOf(entry.subject) === keyOf(subject))?.days;
  return days?.find((day) => day.weekday === weekday)?.cell ?? { mode: "not_set", periods: [] };
}

/** How a subject's standard hours read on a weekday. */
export function standardText(
  model: HoursModel,
  subject: HoursModelSubject,
  weekday: number,
): string {
  if (isDefaultStation(subject)) return t("hours.always_open_cell");
  const cell = weekCellOf(model, subject, weekday);
  if (cell.mode === "not_set")
    return t(subject.kind === "department" ? "hours.not_set_department" : "hours.not_set_station");
  return cellText(cell);
}

/** A special date's stored cells; a subject with none inherits its standard week. */
export function storedCells(model: HoursModel, specialDateId: string): DateHoursCell[] {
  return model.specialCells.find((entry) => entry.specialDateId === specialDateId)?.cells ?? [];
}

/**
 * How one subject's hours read on a date: its special date's own cell, Closed under a whole-venue
 * closure, Always open for the default station, or else its standard week, marked inherited.
 */
export function dateValue(
  model: HoursModel,
  subject: HoursModelSubject,
  date: LocalDate,
  special: SpecialDate | null,
  cells: readonly DateHoursCell[],
): { text: string; inherited: boolean } {
  if (isDefaultStation(subject)) return { text: t("hours.always_open_cell"), inherited: false };
  if (special?.closeWholeVenue) return { text: t("hours.closed"), inherited: false };
  const own = cells.find((entry) => keyOf(entry.subject) === keyOf(subject));
  if (own !== undefined) return { text: cellText(own.cell), inherited: false };
  return { text: standardText(model, subject, weekdayOf(date)), inherited: true };
}
