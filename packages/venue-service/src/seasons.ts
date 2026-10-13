import { and, asc, eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { AppError, type ErrorParams } from "@waitron/shared";
import { assertBusinessDayScheduleWrite } from "./business-day-schedule.js";
import { scheduleEndOffsetClash } from "./menu-timetable.js";
import type { VenueScope } from "./operations.js";
import { DEFAULT_SEASONS, parseSeasonStart, seasonOn, type Season } from "./season-rules.js";
import {
  readDepartmentSeasonWeeks,
  readZoneSeasonWeeks,
  targetSeasons,
  writeDepartmentSeasonWeeks,
  writeZoneSeasonWeeks,
} from "./season-weeks.js";
import { departmentDayRanges, departmentDays, seasons } from "./schema/seasons.js";
import { departments } from "./schema/service.js";
import "./errors.js";

export async function readSeasons(tx: Transaction, cfg: VenueScope): Promise<Season[]> {
  return tx
    .select({ id: seasons.id, name: seasons.name, startsOn: seasons.startsOn })
    .from(seasons)
    .where(eq(seasons.locationId, cfg.locationId))
    .orderBy(asc(seasons.startsOn));
}

export async function ensureDefaultSeasons(tx: Transaction, cfg: VenueScope): Promise<Season[]> {
  const existing = await readSeasons(tx, cfg);
  if (existing.length > 0) return existing;
  const inserted = await tx
    .insert(seasons)
    .values(DEFAULT_SEASONS.map((season) => ({ ...season, locationId: cfg.locationId })))
    .returning({ id: seasons.id, name: seasons.name, startsOn: seasons.startsOn });
  // "The rows emitted by the RETURNING clause appear in an arbitrary order" (sqlite.org/lang_returning.html).
  return inserted.sort((a, b) => (a.startsOn < b.startsOn ? -1 : Number(a.startsOn > b.startsOn)));
}

const invalid = (params: ErrorParams["season.invalid"]): never => {
  throw new AppError("season.invalid", params);
};

/** The trimmed name and the start, refused by code before the unique indexes would throw. */
function parseSeasonInput(
  all: readonly Season[],
  input: { name: string; startsOn: string },
  ownId: string | null,
): { name: string; startsOn: string } {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name === "") invalid({ field: "name" });
  const startsOn = parseSeasonStart(input.startsOn) ?? invalid({ field: "startsOn" });
  const others = all.filter((season) => season.id !== ownId);
  if (others.some((season) => season.name === name)) invalid({ field: "name", reason: "taken" });
  if (others.some((season) => season.startsOn === startsOn))
    invalid({ field: "startsOn", reason: "taken" });
  return { name, startsOn };
}

/** Every department, since a season change moves days under all of them. */
async function checkScheduleAfterSeasonWrite(
  tx: Transaction,
  cfg: VenueScope,
  field: "startsOn" | "seasonId",
): Promise<void> {
  const clash = await scheduleEndOffsetClash(tx, cfg);
  if (clash === null) return;
  const { periodId, departmentId, seasonId, weekday, date, specialDayId } = clash;
  invalid({
    field,
    reason: "end_offset",
    periodId,
    departmentId,
    ...(seasonId === undefined ? {} : { seasonId }),
    ...(weekday === undefined ? {} : { weekday }),
    ...(date === undefined ? {} : { date }),
    ...(specialDayId === undefined ? {} : { specialDayId }),
  });
}

/** Renames or moves a season. A rename alone changes no times, so it skips the clock check. */
export async function saveSeason(
  tx: Transaction,
  cfg: VenueScope,
  id: string,
  input: { name: string; startsOn: string },
  at: Date,
  expectedClockRevision: number,
): Promise<Season> {
  const [own] = await targetSeasons(tx, cfg, id);
  const all = await readSeasons(tx, cfg);
  const parsed = parseSeasonInput(all, input, id);
  const moved = parsed.startsOn !== own!.startsOn;
  await assertBusinessDayScheduleWrite(
    tx,
    cfg,
    moved ? "time" : "metadata",
    at,
    expectedClockRevision,
  );
  await tx.update(seasons).set(parsed).where(eq(seasons.id, id));
  if (moved) await checkScheduleAfterSeasonWrite(tx, cfg, "startsOn");
  return { id, ...parsed };
}

/** Adds a season holding a copy of the department and zone weeks of the season it splits, so
 *  its two new boundaries each pair copies of one week. */
export async function addSeason(
  tx: Transaction,
  cfg: VenueScope,
  input: { name: string; startsOn: string },
  at: Date,
  expectedClockRevision: number,
): Promise<Season> {
  await assertBusinessDayScheduleWrite(tx, cfg, "time", at, expectedClockRevision);
  const all = await ensureDefaultSeasons(tx, cfg);
  const parsed = parseSeasonInput(all, input, null);
  const split = seasonOn(all, `2001-${parsed.startsOn}`)!;
  const [added] = await tx
    .insert(seasons)
    .values({ ...parsed, locationId: cfg.locationId })
    .returning({ id: seasons.id, name: seasons.name, startsOn: seasons.startsOn });
  const { dayCutover } = await readLocationClock(tx, cfg.locationId);
  const only = { seasonIds: [split.id], weekdays: [0, 1, 2, 3, 4, 5, 6] };
  const departmentWeeks = await readDepartmentSeasonWeeks(tx, cfg, undefined, dayCutover, only);
  for (const [departmentId, weeks] of departmentWeeks)
    await writeDepartmentSeasonWeeks(tx, departmentId, [added!.id], weeks.get(split.id)!);
  const zoneWeeks = await readZoneSeasonWeeks(tx, cfg, undefined, dayCutover, only);
  for (const [zoneId, weeks] of zoneWeeks)
    await writeZoneSeasonWeeks(tx, zoneId, [added!.id], weeks.get(split.id)!);
  await checkScheduleAfterSeasonWrite(tx, cfg, "startsOn");
  return added!;
}

/** Deletes a season; its days go to the season before it, and its weeks go with it
 *  (`ON DELETE CASCADE`). */
export async function deleteSeason(
  tx: Transaction,
  cfg: VenueScope,
  id: string,
  at: Date,
  expectedClockRevision: number,
): Promise<void> {
  await assertBusinessDayScheduleWrite(tx, cfg, "time", at, expectedClockRevision);
  await targetSeasons(tx, cfg, id);
  if ((await readSeasons(tx, cfg)).length === 1) invalid({ field: "seasonId", reason: "last" });
  await tx.delete(seasons).where(eq(seasons.id, id));
  await checkScheduleAfterSeasonWrite(tx, cfg, "seasonId");
}

/** The departments whose painted ranges deleting the season would lose; a department holding
 *  only empty days there loses nothing. */
export async function seasonDeleteImpact(
  tx: Transaction,
  cfg: VenueScope,
  id: string,
): Promise<{ departments: { id: string; name: string }[] }> {
  await targetSeasons(tx, cfg, id);
  const painted = await tx
    .selectDistinct({ id: departments.id, name: departments.name })
    .from(departmentDayRanges)
    .innerJoin(departmentDays, eq(departmentDays.id, departmentDayRanges.dayId))
    .innerJoin(departments, eq(departments.id, departmentDays.departmentId))
    .where(and(eq(departmentDays.seasonId, id), eq(departments.locationId, cfg.locationId)))
    .orderBy(asc(departments.name), asc(departments.id));
  return { departments: painted };
}
