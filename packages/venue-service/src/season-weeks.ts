import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { AppError } from "@waitron/shared";
import { storedTime, type VenueScope } from "./operations.js";
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
import "./errors.js";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const wire = (time: string) => time.slice(0, 5);

/** Touching ranges of the same period become one; input sorted from the changeover. */
export function joinTouching<T extends { startsAt: string; endsAt: string }>(
  ranges: readonly T[],
  same: (a: T, b: T) => boolean,
): T[] {
  const joined: T[] = [];
  for (const range of ranges) {
    const last = joined.at(-1);
    if (last !== undefined && wire(last.endsAt) === wire(range.startsAt) && same(last, range))
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
  const all = await ensureDefaultSeasons(tx, cfg);
  if (seasonId === undefined) return all;
  const named = all.find((season) => season.id === seasonId);
  if (named === undefined) throw new AppError("season.not_found", { seasonId });
  return [named];
}

function assertWeek(week: readonly unknown[]): void {
  if (week.length !== 7) throw new Error("a season week has seven days");
}

export async function writeDepartmentSeasonWeek(
  tx: Transaction,
  departmentId: string,
  seasonId: string,
  week: readonly (readonly ServiceRange[])[],
): Promise<void> {
  assertWeek(week);
  // A null period is Closed, which only a special-day date may hold (schema/seasons.ts).
  if (week.some((day) => day.some((range) => typeof range.periodId !== "string")))
    throw new Error("a season week takes periods only");
  await tx
    .delete(departmentDays)
    .where(
      and(eq(departmentDays.departmentId, departmentId), eq(departmentDays.seasonId, seasonId)),
    );
  const days = await tx
    .insert(departmentDays)
    .values(WEEKDAYS.map((weekday) => ({ departmentId, seasonId, weekday })))
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

export async function writeZoneSeasonWeek(
  tx: Transaction,
  zoneId: string,
  seasonId: string,
  week: readonly (readonly ClosedRange[])[],
): Promise<void> {
  assertWeek(week);
  await tx
    .delete(zoneDays)
    .where(and(eq(zoneDays.zoneId, zoneId), eq(zoneDays.seasonId, seasonId)));
  const days = await tx
    .insert(zoneDays)
    .values(WEEKDAYS.map((weekday) => ({ zoneId, seasonId, weekday })))
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

export async function readDepartmentSeasonWeeks(
  tx: Transaction,
  cfg: VenueScope,
  departmentIds?: readonly string[],
  cutover?: string,
): Promise<Map<string, Map<string, ServiceRange[][]>>> {
  if (departmentIds?.length === 0) return new Map();
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
        isNotNull(departmentDays.seasonId),
        departmentIds === undefined
          ? undefined
          : inArray(departmentDays.departmentId, [...departmentIds]),
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
          : { periodId: row.periodId!, startsAt: wire(row.startsAt), endsAt: wire(row.endsAt!) },
    })),
    dayCutover,
  );
}

export async function readZoneSeasonWeeks(
  tx: Transaction,
  cfg: VenueScope,
  zoneIds?: readonly string[],
  cutover?: string,
): Promise<Map<string, Map<string, ClosedRange[][]>>> {
  if (zoneIds?.length === 0) return new Map();
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
        isNotNull(zoneDays.seasonId),
        zoneIds === undefined ? undefined : inArray(zoneDays.zoneId, [...zoneIds]),
      ),
    );
  return groupWeeks(
    rows.map((row) => ({
      ownerId: row.zoneId,
      seasonId: row.seasonId!,
      weekday: row.weekday!,
      range:
        row.startsAt === null ? null : { startsAt: wire(row.startsAt), endsAt: wire(row.endsAt!) },
    })),
    dayCutover,
  );
}
