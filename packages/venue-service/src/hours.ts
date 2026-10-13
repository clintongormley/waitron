import { and, eq } from "drizzle-orm";
import { type Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { rangeDates } from "./hours-rules.js";
import { type CalendarDay, type HolidayFact, type LocalDate } from "./hours-types.js";
import { type VenueScope } from "./operations.js";
import { departments } from "./schema/service.js";
import { readDayPlan, resolveDepartmentsDays } from "./day-resolver.js";
import { isReadableZone } from "./hours-clock.js";
import "./errors.js";

/** Each date's special day, public holidays and tone. A date is closed when its special day closes
 *  it all day or no active department has hours on it; a public holiday's tone wins over a special
 *  day's, and an official local holiday's does not. */
async function calendarDays(
  tx: Transaction,
  cfg: VenueScope,
  dates: readonly LocalDate[],
  holidays: readonly HolidayFact[],
): Promise<CalendarDay[]> {
  const stored = await readLocationClock(tx, cfg.locationId);
  // A business day's cutover never reads the zone (`cutoverAt`, @waitron/shared
  // business-day-clock.ts), so a venue whose zone cannot be read still has its days drawn.
  const clock = isReadableZone(stored.timeZone) ? stored : { ...stored, timeZone: "UTC" };
  const plan = await readDayPlan(tx, cfg, dates);
  const active = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.locationId, cfg.locationId), eq(departments.active, true)));
  const open = new Set<LocalDate>();
  const resolved = await resolveDepartmentsDays(
    tx,
    cfg,
    active.map(({ id }) => id),
    dates,
    clock,
    plan,
  );
  for (const days of resolved.values())
    for (const [date, day] of days) if (day.ranges.length > 0) open.add(date);
  const factsOn = new Map<LocalDate, HolidayFact[]>();
  for (const fact of holidays) factsOn.set(fact.date, [...(factsOn.get(fact.date) ?? []), fact]);
  return dates.map((date) => {
    const special = plan.special.get(date) ?? null;
    const dayHolidays = factsOn.get(date) ?? [];
    const closed = !open.has(date);
    return {
      date,
      specialDay: special === null ? null : { id: special.specialDayId, name: special.name },
      holidays: dayHolidays,
      tone: dayHolidays.some(({ scope }) => scope !== "local")
        ? "public_holiday"
        : special !== null
          ? "special_day"
          : closed
            ? "closed"
            : "standard",
      closed,
    };
  });
}

/**
 * Public holiday facts for a range of dates. A reader must read on the caller's transaction and
 * must make no network call while it is open.
 */
export type HolidayReader = (
  tx: Transaction,
  cfg: VenueScope,
  from: LocalDate,
  to: LocalDate,
) => Promise<readonly HolidayFact[]>;

async function readHolidays(
  tx: Transaction,
  cfg: VenueScope,
  dates: readonly LocalDate[],
  holidays: HolidayReader | undefined,
): Promise<readonly HolidayFact[]> {
  return holidays === undefined ? [] : holidays(tx, cfg, dates[0]!, dates[dates.length - 1]!);
}

/** The calendar from `from` to `to`, both included, with any holiday facts `holidays` supplies. */
export async function readCalendarDays(
  tx: Transaction,
  cfg: VenueScope,
  from: LocalDate,
  to: LocalDate,
  holidays?: HolidayReader,
): Promise<CalendarDay[]> {
  const dates = rangeDates(from, to);
  return calendarDays(tx, cfg, dates, await readHolidays(tx, cfg, dates, holidays));
}
