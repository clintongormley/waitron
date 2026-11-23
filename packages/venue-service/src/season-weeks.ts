import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  readVenueClock,
  seasons,
  openingHours,
  insertInChunks,
  type Transaction,
} from "@waitron/db";
import { AppError } from "@waitron/shared";
import { writeHours, sameScheduleRanges } from "./business-day-schedule.js";
import { readDepartmentWeekReads, stageMenuWeek } from "./menu-timetable.js";
import type { MenuWeekDay } from "./menu-timetable-types.js";
import { storedTime, wireTime } from "./operations.js";
import type { Season } from "./season-rules.js";
import { ensureDefaultSeasons } from "./seasons.js";
import { rangeSpan, type ClosedRange, type ServiceRange } from "./service-day.js";
import { inForceClock } from "./service-day-context.js";
import { readServiceZones, stageZoneClosedWeek } from "./zone-closed-times.js";
import "./errors.js";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** Touching ranges of the same period become one; input sorted from the changeover. */
export function joinTouching<T extends { startsAt: string; endsAt: string }>(
  ranges: readonly T[],
  same: (a: T, b: T) => boolean,
): T[] {
  const joined: T[] = [];
  for (const range of ranges) {
    const last = joined.at(-1);
    if (
      last !== undefined &&
      wireTime(last.endsAt) === wireTime(range.startsAt) &&
      same(last, range)
    )
      joined[joined.length - 1] = { ...last, endsAt: range.endsAt };
    else joined.push({ ...range });
  }
  return joined;
}

/** The seasons a week write lands in: every season, after giving a venue without any its four,
 *  or the one named, which must exist. */
export async function targetSeasons(
  tx: Transaction,
  seasonId: string | undefined,
): Promise<Season[]> {
  if (seasonId === undefined) return ensureDefaultSeasons(tx);
  return [(await seasonsNaming(tx, seasonId)).own];
}

/** The venue's seasons, after giving a venue without any its four, and the one `id` names, which
 *  must exist. */
export async function seasonsNaming(
  tx: Transaction,
  id: string,
): Promise<{ all: Season[]; own: Season }> {
  const all = await ensureDefaultSeasons(tx);
  const own = all.find((season) => season.id === id);
  if (own === undefined) throw new AppError("season.not_found", { seasonId: id });
  return { all, own };
}

function assertWeek(week: readonly unknown[]): void {
  if (week.length !== 7) throw new Error("a season week has seven days");
}

/** Season weeks already holding `week`, so a rewrite changes no answer. */
export function seasonsHolding<T extends { startsAt: string; endsAt: string; periodId?: string }>(
  stored: ReadonlyMap<string, readonly (readonly T[])[]> | undefined,
  seasonIds: readonly string[],
  week: readonly (readonly T[])[],
): Set<string> {
  return new Set(
    seasonIds.filter((seasonId) => {
      const held = stored?.get(seasonId);
      return (
        held !== undefined &&
        week.every((ranges, weekday) => sameScheduleRanges(held[weekday] ?? [], ranges))
      );
    }),
  );
}

export async function writeDepartmentSeasonWeeks(
  tx: Transaction,
  departmentId: string,
  seasonIds: readonly string[],
  week: readonly (readonly ServiceRange[])[],
): Promise<void> {
  assertWeek(week);
  if (week.some((day) => day.some((range) => typeof range.periodId !== "string")))
    throw new Error("a season week takes periods only");
  if (seasonIds.length === 0) return;
  await tx
    .delete(openingHours)
    .where(
      and(
        eq(openingHours.departmentId, departmentId),
        inArray(openingHours.seasonId, [...seasonIds]),
      ),
    );
  const ranges = seasonIds.flatMap((seasonId) =>
    WEEKDAYS.flatMap((weekday) =>
      week[weekday]!.map((range) => ({
        departmentId,
        seasonId,
        weekday,
        kind: "period" as const,
        periodId: range.periodId,
        startsAt: storedTime(range.startsAt),
        endsAt: storedTime(range.endsAt),
      })),
    ),
  );
  if (ranges.length > 0) await insertInChunks(tx, openingHours, ranges);
}

export async function writeZoneSeasonWeeks(
  tx: Transaction,
  zoneId: string,
  seasonIds: readonly string[],
  week: readonly (readonly ClosedRange[])[],
): Promise<void> {
  assertWeek(week);
  if (seasonIds.length === 0) return;
  await tx
    .delete(openingHours)
    .where(and(eq(openingHours.zoneId, zoneId), inArray(openingHours.seasonId, [...seasonIds])));
  const ranges = seasonIds.flatMap((seasonId) =>
    WEEKDAYS.flatMap((weekday) =>
      week[weekday]!.map((range) => ({
        zoneId,
        seasonId,
        weekday,
        kind: "closed" as const,
        startsAt: storedTime(range.startsAt),
        endsAt: storedTime(range.endsAt),
      })),
    ),
  );
  if (ranges.length > 0) await tx.insert(openingHours).values(ranges);
}

/** Each (owner, season) pair with a written week, its ranges sorted from the changeover. */
function groupWeeks<T extends { startsAt: string; endsAt: string }>(
  rows: readonly { ownerId: string; seasonId: string; weekday: number; range: T | null }[],
  cutover: string,
): Map<string, Map<string, T[][]>> {
  const weeks = new Map<string, Map<string, T[][]>>();
  for (const row of rows) {
    const owner = weeks.get(row.ownerId) ?? new Map<string, T[][]>();
    weeks.set(row.ownerId, owner);
    const week = owner.get(row.seasonId) ?? WEEKDAYS.map((): T[] => []);
    owner.set(row.seasonId, week);
    if (row.range !== null) week[row.weekday]!.push(row.range);
  }
  for (const owner of weeks.values())
    for (const week of owner.values())
      for (const day of week)
        day.sort((a, b) => rangeSpan(a, cutover).start - rangeSpan(b, cutover).start);
  return weeks;
}

/** Every season's week in `seasons` order, an unwritten season empty. */
export function seasonWeekList<T>(
  seasons: readonly Season[],
  stored: ReadonlyMap<string, T[][]> | undefined,
): { seasonId: string; week: T[][] }[] {
  return seasons.map((season) => ({
    seasonId: season.id,
    week: stored?.get(season.id) ?? WEEKDAYS.map((): T[] => []),
  }));
}

export interface SeasonDays {
  seasonIds: readonly string[];
  weekdays: readonly number[];
}

const emptyFilter = (only: SeasonDays | undefined) =>
  only !== undefined && (only.seasonIds.length === 0 || only.weekdays.length === 0);

/** With `only`, each read week holds just those weekdays' ranges, the rest left empty. */
export async function readDepartmentSeasonWeeks(
  tx: Transaction,
  departmentIds?: readonly string[],
  cutover?: string,
  only?: SeasonDays,
): Promise<Map<string, Map<string, ServiceRange[][]>>> {
  if (departmentIds?.length === 0 || emptyFilter(only)) return new Map();
  const dayCutover = cutover ?? (await readVenueClock(tx)).dayCutover;
  const rows = await tx
    .select({
      departmentId: openingHours.departmentId,
      seasonId: openingHours.seasonId,
      weekday: openingHours.weekday,
      periodId: openingHours.periodId,
      startsAt: openingHours.startsAt,
      endsAt: openingHours.endsAt,
    })
    .from(openingHours)
    .innerJoin(seasons, eq(seasons.id, openingHours.seasonId))
    .where(
      and(
        isNotNull(openingHours.departmentId),
        departmentIds === undefined
          ? undefined
          : inArray(openingHours.departmentId, [...departmentIds]),
        only === undefined ? undefined : inArray(openingHours.seasonId, [...only.seasonIds]),
        only === undefined ? undefined : inArray(openingHours.weekday, [...only.weekdays]),
      ),
    );
  return groupWeeks(
    rows.map((row) => ({
      ownerId: row.departmentId!,
      seasonId: row.seasonId!,
      weekday: row.weekday!,
      range: {
        periodId: row.periodId!,
        startsAt: wireTime(row.startsAt),
        endsAt: wireTime(row.endsAt),
      },
    })),
    dayCutover,
  );
}

/** With `only`, each read week holds just those weekdays' ranges, the rest left empty. */
export async function readZoneSeasonWeeks(
  tx: Transaction,
  zoneIds?: readonly string[],
  cutover?: string,
  only?: SeasonDays,
): Promise<Map<string, Map<string, ClosedRange[][]>>> {
  if (zoneIds?.length === 0 || emptyFilter(only)) return new Map();
  const dayCutover = cutover ?? (await readVenueClock(tx)).dayCutover;
  const rows = await tx
    .select({
      zoneId: openingHours.zoneId,
      seasonId: openingHours.seasonId,
      weekday: openingHours.weekday,
      startsAt: openingHours.startsAt,
      endsAt: openingHours.endsAt,
    })
    .from(openingHours)
    .innerJoin(seasons, eq(seasons.id, openingHours.seasonId))
    .where(
      and(
        isNotNull(openingHours.zoneId),
        zoneIds === undefined ? undefined : inArray(openingHours.zoneId, [...zoneIds]),
        only === undefined ? undefined : inArray(openingHours.seasonId, [...only.seasonIds]),
        only === undefined ? undefined : inArray(openingHours.weekday, [...only.weekdays]),
      ),
    );
  return groupWeeks(
    rows.map((row) => ({
      ownerId: row.zoneId!,
      seasonId: row.seasonId!,
      weekday: row.weekday!,
      range:
        row.startsAt === null
          ? null
          : { startsAt: wireTime(row.startsAt), endsAt: wireTime(row.endsAt!) },
    })),
    dayCutover,
  );
}

/** Runs `fn`, naming a refused field by where it sits in the request: `prefix` goes before it. */
async function within<T>(prefix: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    const field = (error.params as { field?: unknown }).field;
    if (typeof field !== "string") throw error;
    throw new AppError(
      error.code,
      { ...error.params, field: `${prefix}${field}` },
      { reason: error.reason },
    );
  }
}

function completeWeek<T extends { weekday: number }>(
  days: readonly T[],
  stored: readonly T[],
  code: "menu_timetable.invalid" | "zone_closed_time.invalid",
): T[] {
  if (!Array.isArray(days) || days.length > 7) throw new AppError(code, { field: "days" });
  const sent = new Set<number>();
  for (const [index, day] of days.entries()) {
    if (typeof day !== "object" || day === null)
      throw new AppError(code, { field: `days.${index}` });
    if (
      !Number.isInteger(day.weekday) ||
      day.weekday < 0 ||
      day.weekday > 6 ||
      sent.has(day.weekday)
    )
      throw new AppError(code, { field: `days.${index}.weekday` });
    sent.add(day.weekday);
  }
  // Submitted days lead so the stagers' error positions still name the request's rows.
  return [...days, ...stored.filter((day) => !sent.has(day.weekday))];
}

/** Every listed department week and zone week of one season, under one revision check. */
export async function saveSeasonWeeks(
  tx: Transaction,
  seasonId: string,
  input: {
    departments?: readonly { departmentId: string; days: readonly MenuWeekDay[] }[];
    zones?: readonly {
      zoneId: string;
      days: readonly { weekday: number; ranges: readonly ClosedRange[] }[];
    }[];
  },
  at: Date,
  expectedClockRevision: number,
): Promise<void> {
  const season = (await seasonsNaming(tx, seasonId)).own;
  const clock = await readVenueClock(tx);
  const inForce = inForceClock(clock, at);
  const departmentEntries = input.departments ?? [];
  const departmentReads = await readDepartmentWeekReads(
    tx,
    departmentEntries.map((entry) => entry.departmentId),
    clock,
  );
  const departmentWeeks = [];
  for (const [index, entry] of departmentEntries.entries()) {
    departmentWeeks.push(
      await within(`departments.${index}.`, () =>
        stageMenuWeek(
          tx,
          entry.departmentId,
          completeWeek(
            entry.days,
            WEEKDAYS.map((weekday) => ({
              weekday,
              slots: (
                departmentReads.seasonWeeks.get(entry.departmentId)?.get(seasonId)?.[weekday] ?? []
              ).map(({ periodId, startsAt, endsAt }) => ({
                periodId: periodId!,
                startsAt,
                endsAt,
              })),
            })),
            "menu_timetable.invalid",
          ),
          inForce,
          season,
          departmentReads,
        ),
      ),
    );
  }
  const zoneEntries = input.zones ?? [];
  const serving = new Map(
    zoneEntries.length === 0
      ? []
      : (await readServiceZones(tx)).map((zone) => [zone.id, zone.departmentId] as const),
  );
  const zoneSeasonWeeks = await readZoneSeasonWeeks(
    tx,
    zoneEntries.map((entry) => entry.zoneId),
    clock.dayCutover,
  );
  const zoneWeeks = [];
  for (const [index, entry] of zoneEntries.entries()) {
    if (!serving.has(entry.zoneId))
      throw new AppError("service_zone.not_found", { zoneId: entry.zoneId });
    zoneWeeks.push(
      await within(`zones.${index}.`, () =>
        stageZoneClosedWeek(
          tx,
          entry.zoneId,
          completeWeek(
            entry.days,
            WEEKDAYS.map((weekday) => ({
              weekday,
              ranges: zoneSeasonWeeks.get(entry.zoneId)?.get(seasonId)?.[weekday] ?? [],
            })),
            "zone_closed_time.invalid",
          ),
          inForce,
          season,
          zoneSeasonWeeks,
        ),
      ),
    );
  }
  const weeks = [...departmentWeeks, ...zoneWeeks];
  const changed = weeks.some((week) => week.changed);
  await writeHours(
    tx,
    { at, clock, changeKind: changed ? "time" : "metadata", expectedClockRevision },
    async () => {
      for (const week of weeks) await week.write();
    },
  );
}
