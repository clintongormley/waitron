import { assertBusinessDayScheduleWrite } from "./business-day-schedule.js";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { newId, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import {
  invalidHours,
  parseDuplicateDates,
  parseSpecialDateInput,
  rangeDates,
  specialDateName,
  weekdayOf,
} from "./hours-rules.js";
import {
  type CalendarDay,
  type HolidayFact,
  type LocalDate,
  type SpecialDate,
  type SpecialDateInput,
} from "./hours-types.js";
import { storedTime, type VenueScope } from "./operations.js";
import { seasonOn } from "./season-rules.js";
import { readDepartmentSeasonWeeks, readZoneSeasonWeeks } from "./season-weeks.js";
import { readSeasons } from "./seasons.js";
import { specialDates } from "./schema/hours.js";
import { specialDayDates, specialDays } from "./schema/seasons.js";
import { sharedSpecialDate } from "./special-days.js";
import { namedDaysOn } from "./named-days.js";
import { repeatKey } from "./named-day-rules.js";
import { readOpeningHoursModel } from "./menu-timetable.js";
import { menuDayTimetables, menuSlots } from "./schema/menus.js";
import { zoneClosedTimes } from "./schema/zone-closed-times.js";
import "./errors.js";

async function requireSpecialDate(tx: Transaction, cfg: VenueScope, id: string) {
  const [row] = await tx
    .select()
    .from(specialDates)
    .where(and(eq(specialDates.id, id), eq(specialDates.locationId, cfg.locationId)));
  if (row === undefined) throw new AppError("special_date.not_found", { specialDateId: id });
  return row;
}

export async function readSpecialDate(
  tx: Transaction,
  cfg: VenueScope,
  id: string,
): Promise<SpecialDate> {
  const row = await requireSpecialDate(tx, cfg, id);
  return {
    id: row.id,
    date: row.date,
    name: row.name,
    kind: row.kind,
    repeats: row.repeatOn !== null,
    ownHours: row.ownHours,
    closeWholeVenue: row.closeWholeVenue,
  };
}

async function assertNamedDayAvailable(
  tx: Transaction,
  cfg: VenueScope,
  date: LocalDate,
  repeats: boolean,
  exceptId: string | null,
): Promise<void> {
  const rows = await tx
    .select()
    .from(specialDates)
    .where(
      and(
        eq(specialDates.locationId, cfg.locationId),
        exceptId === null ? undefined : ne(specialDates.id, exceptId),
      ),
    )
    .orderBy(asc(specialDates.date));
  for (const row of rows) {
    const clash = sharedSpecialDate(
      { date, repeats },
      { date: row.date, repeats: row.repeatOn !== null },
    );
    if (clash !== null) throw new AppError("special_date.date_taken", { date: clash });
  }
  const specialDayRows = await tx
    .select({ date: specialDayDates.date, repeats: specialDays.repeatsYearly })
    .from(specialDayDates)
    .innerJoin(specialDays, eq(specialDays.id, specialDayDates.specialDayId))
    .where(
      and(
        eq(specialDayDates.locationId, cfg.locationId),
        eq(sql`substr(${specialDayDates.date}, 6)`, repeatKey(date)),
      ),
    )
    .orderBy(asc(specialDayDates.date));
  for (const row of specialDayRows) {
    const clash = sharedSpecialDate({ date, repeats }, row);
    if (clash !== null) throw new AppError("special_date.date_taken", { date: clash });
  }
}

async function switchNamedDayHours(
  tx: Transaction,
  cfg: VenueScope,
  specialDateId: string,
  date: LocalDate,
  ownHours: boolean,
): Promise<void> {
  await tx.delete(menuDayTimetables).where(eq(menuDayTimetables.specialDateId, specialDateId));
  await tx.delete(zoneClosedTimes).where(eq(zoneClosedTimes.specialDateId, specialDateId));
  if (!ownHours) return;
  const season = seasonOn(await readSeasons(tx, cfg), date);
  if (season === null) return;
  const weekday = weekdayOf(date);
  const only = { seasonIds: [season.id], weekdays: [weekday] };
  for (const [departmentId, weeks] of await readDepartmentSeasonWeeks(
    tx,
    cfg,
    undefined,
    undefined,
    only,
  )) {
    const slots = weeks.get(season.id)?.[weekday] ?? [];
    if (slots.length === 0) continue;
    const timetableId = newId();
    await tx.insert(menuDayTimetables).values({ id: timetableId, departmentId, specialDateId });
    await tx.insert(menuSlots).values(
      slots.map((slot) => ({
        id: newId(),
        timetableId,
        departmentId,
        periodId: slot.periodId,
        startsAt: storedTime(slot.startsAt),
        endsAt: storedTime(slot.endsAt),
      })),
    );
  }
  const closures = [...(await readZoneSeasonWeeks(tx, cfg, undefined, undefined, only))].flatMap(
    ([zoneId, weeks]) =>
      (weeks.get(season.id)?.[weekday] ?? []).map((range) => ({
        zoneId,
        specialDateId,
        startsAt: storedTime(range.startsAt),
        endsAt: storedTime(range.endsAt),
      })),
  );
  if (closures.length > 0) await tx.insert(zoneClosedTimes).values(closures);
}

export async function saveSpecialDate<Input extends SpecialDateInput>(
  tx: Transaction,
  cfg: VenueScope,
  id: string | null,
  input: Input,
  at: Date,
  participants: readonly SpecialDateParticipant[] = [],
  expectedClockRevision: number,
): Promise<SpecialDate> {
  const inputFields = parseSpecialDateInput(input);
  const current = id === null ? null : await requireSpecialDate(tx, cfg, id);
  const parsed = {
    ...inputFields,
    kind: inputFields.kind === undefined ? (current?.kind ?? "working_day") : inputFields.kind,
    repeats:
      inputFields.repeats === undefined
        ? current?.repeatOn !== undefined && current.repeatOn !== null
        : inputFields.repeats,
    ownHours:
      inputFields.ownHours === undefined ? (current?.ownHours ?? false) : inputFields.ownHours,
  };
  const timeChanged =
    current === null ||
    current.date !== parsed.date ||
    (current.repeatOn !== null) !== parsed.repeats ||
    current.ownHours !== parsed.ownHours ||
    current.closeWholeVenue !== parsed.closeWholeVenue;
  await assertBusinessDayScheduleWrite(
    tx,
    cfg,
    timeChanged ? "time" : "metadata",
    at,
    expectedClockRevision,
  );
  if (parsed.ownHours && parsed.closeWholeVenue) invalidHours("ownHours");
  await assertNamedDayAvailable(tx, cfg, parsed.date, parsed.repeats, id);

  if (current !== null && current.date !== parsed.date)
    for (const participant of participants)
      await participant.beforeMove?.(tx, cfg, current.id, parsed.date, at);

  const values = {
    date: parsed.date,
    name: parsed.name,
    kind: parsed.kind,
    repeatOn: parsed.repeats ? repeatKey(parsed.date) : null,
    ownHours: parsed.ownHours,
    closeWholeVenue: parsed.closeWholeVenue,
  };
  let specialDateId: string;
  if (id === null) {
    const [row] = await tx
      .insert(specialDates)
      .values({ ...values, locationId: cfg.locationId })
      .returning({ id: specialDates.id });
    specialDateId = row!.id;
  } else {
    await tx.update(specialDates).set(values).where(eq(specialDates.id, id));
    specialDateId = id;
  }
  if ((current?.ownHours ?? false) !== parsed.ownHours)
    await switchNamedDayHours(tx, cfg, specialDateId, parsed.date, parsed.ownHours);
  for (const participant of participants)
    await participant.afterChange?.(
      tx,
      cfg,
      current !== null &&
        current.date === parsed.date &&
        current.closeWholeVenue !== parsed.closeWholeVenue
        ? "closeWholeVenue"
        : "date",
      at,
    );
  return {
    id: specialDateId,
    date: values.date,
    name: values.name,
    kind: values.kind,
    repeats: parsed.repeats,
    ownHours: values.ownHours,
    closeWholeVenue: values.closeWholeVenue,
  };
}

/** Renames a special date and changes nothing else about it. */
export async function renameSpecialDate(
  tx: Transaction,
  cfg: VenueScope,
  id: string,
  name: string,
): Promise<SpecialDate> {
  const [row] = await tx
    .update(specialDates)
    .set({ name: specialDateName(name) })
    .where(and(eq(specialDates.id, id), eq(specialDates.locationId, cfg.locationId)))
    .returning();
  if (row === undefined) throw new AppError("special_date.not_found", { specialDateId: id });
  return {
    id: row.id,
    date: row.date,
    name: row.name,
    kind: row.kind,
    repeats: row.repeatOn !== null,
    ownHours: row.ownHours,
    closeWholeVenue: row.closeWholeVenue,
  };
}

/**
 * A module that keeps its own rows per special date, such as a menu timetable. It works inside the
 * caller's transaction and never opens its own, and `at` is the caller's "now". `copy` runs once per
 * target, after that target date is written; `afterCopies` runs once per duplicate,
 * after every target and every participant's copies exist, so a check can see all the targets at
 * once; `beforeMove` runs before a date's new date is written; `afterChange` validates the proposed
 * save or deletion inside the caller's transaction; `beforeDelete` may only refuse,
 * since the date's own foreign keys remove what hangs from it.
 */
export interface SpecialDateParticipant {
  copy(
    tx: Transaction,
    cfg: VenueScope,
    sourceId: string,
    targetId: string,
    at: Date,
  ): Promise<void>;
  afterCopies?(
    tx: Transaction,
    cfg: VenueScope,
    sourceId: string,
    targets: readonly { id: string; date: LocalDate }[],
    at: Date,
  ): Promise<void>;
  beforeMove?(
    tx: Transaction,
    cfg: VenueScope,
    id: string,
    toDate: LocalDate,
    at: Date,
  ): Promise<void>;
  afterChange?(
    tx: Transaction,
    cfg: VenueScope,
    field: "date" | "closeWholeVenue",
    at: Date,
  ): Promise<void>;
  beforeDelete(tx: Transaction, cfg: VenueScope, id: string, at: Date): Promise<void>;
}

export async function duplicateSpecialDate(
  tx: Transaction,
  cfg: VenueScope,
  sourceId: string,
  dates: readonly LocalDate[],
  at: Date,
  participants: readonly SpecialDateParticipant[] = [],
  expectedClockRevision: number,
): Promise<SpecialDate[]> {
  const targets = parseDuplicateDates(dates);
  const source = await requireSpecialDate(tx, cfg, sourceId);
  await assertBusinessDayScheduleWrite(tx, cfg, "time", at, expectedClockRevision);
  for (const date of targets) await assertNamedDayAvailable(tx, cfg, date, false, null);

  const values = {
    name: source.name,
    kind: source.kind,
    repeats: false,
    ownHours: source.ownHours,
    closeWholeVenue: source.closeWholeVenue,
  };
  const copies: SpecialDate[] = [];
  for (const date of targets) {
    const [row] = await tx
      .insert(specialDates)
      .values({
        name: values.name,
        kind: values.kind,
        ownHours: values.ownHours,
        closeWholeVenue: values.closeWholeVenue,
        date,
        locationId: cfg.locationId,
      })
      .returning({ id: specialDates.id });
    const targetId = row!.id;
    for (const participant of participants) await participant.copy(tx, cfg, sourceId, targetId, at);
    copies.push({ id: targetId, date, ...values });
  }
  for (const participant of participants)
    await participant.afterCopies?.(
      tx,
      cfg,
      sourceId,
      copies.map(({ id, date }) => ({ id, date })),
      at,
    );
  return copies;
}

export async function deleteSpecialDate(
  tx: Transaction,
  cfg: VenueScope,
  id: string,
  at: Date,
  participants: readonly SpecialDateParticipant[] = [],
  expectedClockRevision: number,
): Promise<void> {
  await requireSpecialDate(tx, cfg, id);
  await assertBusinessDayScheduleWrite(tx, cfg, "time", at, expectedClockRevision);
  for (const participant of participants) await participant.beforeDelete(tx, cfg, id, at);
  await tx.delete(specialDates).where(eq(specialDates.id, id));
  for (const participant of participants) await participant.afterChange?.(tx, cfg, "date", at);
}

function calendarDays(
  opening: Awaited<ReturnType<typeof readOpeningHoursModel>>,
  dates: readonly LocalDate[],
  named: Awaited<ReturnType<typeof namedDaysOn>>,
  holidays: readonly HolidayFact[],
): CalendarDay[] {
  const factsOn = new Map<LocalDate, HolidayFact[]>();
  for (const fact of holidays) {
    const facts = factsOn.get(fact.date);
    if (facts === undefined) factsOn.set(fact.date, [fact]);
    else facts.push(fact);
  }
  const active = opening.departments.filter((department) => department.active);
  return dates.map((date) => {
    const seasonId = seasonOn(opening.seasons, date)?.id;
    const occurrence = named.get(date);
    const special =
      occurrence === undefined
        ? null
        : {
            id: occurrence.id,
            date,
            name: occurrence.name,
            kind: occurrence.kind,
            repeats: occurrence.repeats,
            ownHours: occurrence.ownHours,
            closeWholeVenue: occurrence.closeWholeVenue,
          };
    const open =
      !special?.closeWholeVenue &&
      active.some((department) => {
        const own = !occurrence?.ownHours
          ? undefined
          : department.dates.find((day) => day.specialDateId === occurrence.id);
        const slots =
          own?.slots ??
          department.seasonWeeks
            .find((entry) => entry.seasonId === seasonId)
            ?.week.find((day) => day.weekday === weekdayOf(date))!.slots ??
          [];
        return slots.length > 0;
      });
    return {
      date,
      specialDate: special,
      holidays: factsOn.get(date) ?? [],
      tone: open
        ? special === null
          ? "standard"
          : special.kind === "holiday"
            ? "purple"
            : "blue"
        : "closed",
    };
  });
}

/**
 * Public holiday facts for a range of dates. A reader must read on the caller's transaction, must
 * make no network call while it is open, and must not derive its facts from special dates.
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
  const named = await namedDaysOn(tx, cfg, dates);
  return calendarDays(
    await readOpeningHoursModel(tx, cfg, new Date()),
    dates,
    named,
    await readHolidays(tx, cfg, dates, holidays),
  );
}
