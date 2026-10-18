import { and, eq, inArray } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { AppError, type BusinessDayClock } from "@waitron/shared";
import { assertBusinessDayScheduleWrite, sameScheduleRanges } from "./business-day-schedule.js";
import { assertWeekEndOffsets, readDepartmentWeekReads, stageMenuWeek } from "./menu-timetable.js";
import type { MenuWeekDay } from "./menu-timetable-types.js";
import { storedTime, wireTime, type VenueScope } from "./operations.js";
import {
  departmentDayRanges,
  departmentDays,
  seasons,
  zoneDayRanges,
  zoneDays,
} from "./schema/seasons.js";
import type { Season } from "./season-rules.js";
import { ensureDefaultSeasons } from "./seasons.js";
import { rangeSpan, type ClosedRange, type ServiceRange } from "./service-day.js";
import { readServiceZones, stageZoneClosedWeek } from "./zone-closed-times.js";
import "./errors.js";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** The clock and each serving zone's department, as a week save read them in its transaction. */
export interface ServingRead {
  clock: BusinessDayClock;
  departmentOf: ReadonlyMap<string, string>;
}

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
 *  or the one named, which must be this venue's. */
export async function targetSeasons(
  tx: Transaction,
  cfg: VenueScope,
  seasonId: string | undefined,
): Promise<Season[]> {
  if (seasonId === undefined) return ensureDefaultSeasons(tx, cfg);
  return [(await seasonsNaming(tx, cfg, seasonId)).own];
}

/** The venue's seasons, after giving a venue without any its four, and the one `id` names, which
 *  must be this venue's. */
export async function seasonsNaming(
  tx: Transaction,
  cfg: VenueScope,
  id: string,
): Promise<{ all: Season[]; own: Season }> {
  const all = await ensureDefaultSeasons(tx, cfg);
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
  // A null period is Closed, which only a special-day date may hold (schema/seasons.ts).
  if (week.some((day) => day.some((range) => typeof range.periodId !== "string")))
    throw new Error("a season week takes periods only");
  if (seasonIds.length === 0) return;
  await tx
    .delete(departmentDays)
    .where(
      and(
        eq(departmentDays.departmentId, departmentId),
        inArray(departmentDays.seasonId, [...seasonIds]),
      ),
    );
  const days = await tx
    .insert(departmentDays)
    .values(
      seasonIds.flatMap((seasonId) =>
        WEEKDAYS.map((weekday) => ({ departmentId, seasonId, weekday })),
      ),
    )
    .returning({ id: departmentDays.id, weekday: departmentDays.weekday });
  const ranges = days.flatMap((day) =>
    week[day.weekday!]!.map((range) => ({
      dayId: day.id,
      departmentId,
      periodId: range.periodId,
      startsAt: storedTime(range.startsAt),
      endsAt: storedTime(range.endsAt),
    })),
  );
  if (ranges.length > 0) await tx.insert(departmentDayRanges).values(ranges);
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
    .delete(zoneDays)
    .where(and(eq(zoneDays.zoneId, zoneId), inArray(zoneDays.seasonId, [...seasonIds])));
  const days = await tx
    .insert(zoneDays)
    .values(
      seasonIds.flatMap((seasonId) => WEEKDAYS.map((weekday) => ({ zoneId, seasonId, weekday }))),
    )
    .returning({ id: zoneDays.id, weekday: zoneDays.weekday });
  // Always "closed": an "open" range belongs on a special-day date only (schema/seasons.ts).
  const ranges = days.flatMap((day) =>
    week[day.weekday!]!.map((range) => ({
      dayId: day.id,
      kind: "closed" as const,
      startsAt: storedTime(range.startsAt),
      endsAt: storedTime(range.endsAt),
    })),
  );
  if (ranges.length > 0) await tx.insert(zoneDayRanges).values(ranges);
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
  cfg: VenueScope,
  departmentIds?: readonly string[],
  cutover?: string,
  only?: SeasonDays,
): Promise<Map<string, Map<string, ServiceRange[][]>>> {
  if (departmentIds?.length === 0 || emptyFilter(only)) return new Map();
  const dayCutover = cutover ?? (await readLocationClock(tx, cfg.locationId)).dayCutover;
  const rows = await tx
    .select({
      departmentId: departmentDays.departmentId,
      seasonId: departmentDays.seasonId,
      weekday: departmentDays.weekday,
      periodId: departmentDayRanges.periodId,
      startsAt: departmentDayRanges.startsAt,
      endsAt: departmentDayRanges.endsAt,
    })
    .from(departmentDays)
    .innerJoin(seasons, eq(seasons.id, departmentDays.seasonId))
    .leftJoin(departmentDayRanges, eq(departmentDayRanges.dayId, departmentDays.id))
    .where(
      and(
        eq(seasons.locationId, cfg.locationId),
        departmentIds === undefined
          ? undefined
          : inArray(departmentDays.departmentId, [...departmentIds]),
        only === undefined ? undefined : inArray(departmentDays.seasonId, [...only.seasonIds]),
        only === undefined ? undefined : inArray(departmentDays.weekday, [...only.weekdays]),
      ),
    );
  return groupWeeks(
    rows.map((row) => ({
      ownerId: row.departmentId,
      seasonId: row.seasonId!,
      weekday: row.weekday!,
      range:
        row.startsAt === null
          ? null
          : {
              periodId: row.periodId!,
              startsAt: wireTime(row.startsAt),
              endsAt: wireTime(row.endsAt!),
            },
    })),
    dayCutover,
  );
}

/** With `only`, each read week holds just those weekdays' ranges, the rest left empty. */
export async function readZoneSeasonWeeks(
  tx: Transaction,
  cfg: VenueScope,
  zoneIds?: readonly string[],
  cutover?: string,
  only?: SeasonDays,
): Promise<Map<string, Map<string, ClosedRange[][]>>> {
  if (zoneIds?.length === 0 || emptyFilter(only)) return new Map();
  const dayCutover = cutover ?? (await readLocationClock(tx, cfg.locationId)).dayCutover;
  const rows = await tx
    .select({
      zoneId: zoneDays.zoneId,
      seasonId: zoneDays.seasonId,
      weekday: zoneDays.weekday,
      startsAt: zoneDayRanges.startsAt,
      endsAt: zoneDayRanges.endsAt,
    })
    .from(zoneDays)
    .innerJoin(seasons, eq(seasons.id, zoneDays.seasonId))
    .leftJoin(zoneDayRanges, eq(zoneDayRanges.dayId, zoneDays.id))
    .where(
      and(
        eq(seasons.locationId, cfg.locationId),
        zoneIds === undefined ? undefined : inArray(zoneDays.zoneId, [...zoneIds]),
        only === undefined ? undefined : inArray(zoneDays.seasonId, [...only.seasonIds]),
        only === undefined ? undefined : inArray(zoneDays.weekday, [...only.weekdays]),
      ),
    );
  return groupWeeks(
    rows.map((row) => ({
      ownerId: row.zoneId,
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

/** Every listed department week and zone week of one season, under one revision check; each
 *  department's end offsets are checked once every week is written, then `afterWrite` runs with
 *  the clock and zones this save read. */
export async function saveSeasonWeeks(
  tx: Transaction,
  cfg: VenueScope,
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
  afterWrite?: (read: ServingRead) => Promise<void>,
): Promise<void> {
  const season = (await seasonsNaming(tx, cfg, seasonId)).own;
  const clock = await readLocationClock(tx, cfg.locationId);
  const departmentEntries = input.departments ?? [];
  const departmentReads = await readDepartmentWeekReads(
    tx,
    cfg,
    departmentEntries.map((entry) => entry.departmentId),
    clock,
  );
  const departmentWeeks = [];
  for (const [index, entry] of departmentEntries.entries()) {
    const prefix = `departments.${index}.`;
    const staged = await within(prefix, () =>
      stageMenuWeek(tx, cfg, entry.departmentId, entry.days, clock, season, departmentReads),
    );
    departmentWeeks.push({
      ...staged,
      departmentId: entry.departmentId,
      clashField: (clash: Parameters<typeof staged.clashField>[0]) =>
        `${prefix}${staged.clashField(clash)}`,
    });
  }
  const zoneEntries = input.zones ?? [];
  const serving = new Map(
    zoneEntries.length === 0
      ? []
      : (await readServiceZones(tx, cfg)).map((zone) => [zone.id, zone.departmentId] as const),
  );
  const zoneSeasonWeeks = await readZoneSeasonWeeks(
    tx,
    cfg,
    zoneEntries.map((entry) => entry.zoneId),
    clock.dayCutover,
  );
  const zoneWeeks = [];
  for (const [index, entry] of zoneEntries.entries()) {
    if (!serving.has(entry.zoneId))
      throw new AppError("service_zone.not_found", { zoneId: entry.zoneId });
    zoneWeeks.push(
      await within(`zones.${index}.`, () =>
        stageZoneClosedWeek(tx, cfg, entry.zoneId, entry.days, clock, season, zoneSeasonWeeks),
      ),
    );
  }
  await assertBusinessDayScheduleWrite(
    tx,
    cfg,
    [...departmentWeeks, ...zoneWeeks].some((week) => week.changed) ? "time" : "metadata",
    at,
    expectedClockRevision,
    clock,
  );
  for (const week of [...departmentWeeks, ...zoneWeeks]) await week.write();
  await assertWeekEndOffsets(tx, cfg, clock, departmentWeeks);
  await afterWrite?.({ clock, departmentOf: serving });
}
