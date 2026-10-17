import { and, asc, eq, inArray } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { AppError, CALENDAR_COLOURS, type CalendarColour, type ErrorParams } from "@waitron/shared";
import { assertBusinessDayScheduleWrite } from "./business-day-schedule.js";
import { scheduleEndOffsetClash } from "./menu-timetable.js";
import type { VenueScope } from "./operations.js";
import {
  byStart,
  DEFAULT_SEASONS,
  parseSeasonStart,
  seasonOn,
  type Season,
  type SeasonChange,
} from "./season-rules.js";
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

const SEASON_COLUMNS = {
  id: seasons.id,
  name: seasons.name,
  startsOn: seasons.startsOn,
  colour: seasons.colour,
};

export async function readSeasons(tx: Transaction, cfg: VenueScope): Promise<Season[]> {
  return tx
    .select(SEASON_COLUMNS)
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
    .returning(SEASON_COLUMNS);
  // "The rows emitted by the RETURNING clause appear in an arbitrary order" (sqlite.org/lang_returning.html).
  return byStart(inserted);
}

const invalid = (params: ErrorParams["season.invalid"]): never => {
  throw new AppError("season.invalid", params);
};

/** MM-DD values the starts CHECK accepts and no real start can equal. */
const TEMPORARY_STARTS = Array.from({ length: 20 * 40 }, (_, i) => {
  const mm = String(Math.floor(i / 40)).padStart(2, "0");
  const dd = String(i % 40).padStart(2, "0");
  return `${mm}-${dd}`;
}).filter((value) => value !== "02-29" && parseSeasonStart(value) === null);

export function temporaryStart(index: number): string {
  const value = TEMPORARY_STARTS[index];
  if (value === undefined) throw new Error(`no temporary season start ${index}`);
  return value;
}

/** Every department, since a season change moves days under all of them. */
async function checkScheduleAfterSeasonWrite(tx: Transaction, cfg: VenueScope): Promise<void> {
  const clash = await scheduleEndOffsetClash(tx, cfg);
  if (clash !== null) invalid({ field: "seasons", reason: "end_offset", ...clash });
}

/** Applies a change to the venue's seasons and answers them by start. A changed season keeps its
 *  id, so its weeks stay with it; a new one copies the weeks of the season holding its start
 *  before the change; a deleted one's days join the season before it. */
export async function saveSeasons(
  tx: Transaction,
  cfg: VenueScope,
  change: SeasonChange,
  at: Date,
  expectedClockRevision: number,
): Promise<Season[]> {
  const all = await ensureDefaultSeasons(tx, cfg);
  const stored = new Map(all.map((season) => [season.id, season]));
  const sentStrings = change.save.flatMap((entry) =>
    typeof entry.id === "string" ? [entry.id] : [],
  );
  for (const id of [...change.delete, ...sentStrings])
    if (!stored.has(id)) throw new AppError("season.not_found", { seasonId: id });
  const deleted = new Set(change.delete);
  const sentIds = new Set<string>();
  const parsed = change.save.map((entry, i) => {
    if (entry.id !== undefined) {
      if (typeof entry.id !== "string" || sentIds.has(entry.id) || deleted.has(entry.id))
        invalid({ field: `save.${i}.id` });
      sentIds.add(entry.id);
    }
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (name === "") invalid({ field: `save.${i}.name` });
    const startsOn = parseSeasonStart(entry.startsOn) ?? invalid({ field: `save.${i}.startsOn` });
    if (!(CALENDAR_COLOURS as readonly unknown[]).includes(entry.colour))
      invalid({ field: `save.${i}.colour` });
    return { id: entry.id, name, startsOn, colour: entry.colour as CalendarColour };
  });
  const kept = all.filter((season) => !deleted.has(season.id) && !sentIds.has(season.id));
  // A sent season keeping its own name or start holds it first, so a clash names the entry
  // whose value changed.
  const own = (entry: (typeof parsed)[number]) =>
    entry.id === undefined ? undefined : stored.get(entry.id);
  const names = new Set(kept.map((season) => season.name));
  const starts = new Set(kept.map((season) => season.startsOn));
  for (const entry of parsed) {
    if (own(entry)?.name === entry.name) names.add(entry.name);
    if (own(entry)?.startsOn === entry.startsOn) starts.add(entry.startsOn);
  }
  parsed.forEach((entry, i) => {
    if (own(entry)?.name !== entry.name) {
      if (names.has(entry.name)) invalid({ field: `save.${i}.name`, reason: "taken" });
      names.add(entry.name);
    }
    if (own(entry)?.startsOn !== entry.startsOn) {
      if (starts.has(entry.startsOn)) invalid({ field: `save.${i}.startsOn`, reason: "taken" });
      starts.add(entry.startsOn);
    }
  });
  if (names.size === 0) invalid({ field: "delete", reason: "last" });

  const changed = parsed.filter((entry) => entry.id !== undefined);
  const added = parsed
    .filter((entry) => entry.id === undefined)
    .map((entry) => ({ ...entry, split: seasonOn(all, `2001-${entry.startsOn}`)!.id }));
  const timed =
    deleted.size > 0 ||
    added.length > 0 ||
    changed.some((entry) => entry.startsOn !== stored.get(entry.id!)!.startsOn);
  await assertBusinessDayScheduleWrite(
    tx,
    cfg,
    timed ? "time" : "metadata",
    at,
    expectedClockRevision,
  );

  const { dayCutover } = await readLocationClock(tx, cfg.locationId);
  const only = {
    seasonIds: [...new Set(added.map((entry) => entry.split))],
    weekdays: [0, 1, 2, 3, 4, 5, 6],
  };
  const departmentWeeks = await readDepartmentSeasonWeeks(tx, cfg, undefined, dayCutover, only);
  const zoneWeeks = await readZoneSeasonWeeks(tx, cfg, undefined, dayCutover, only);

  if (deleted.size > 0)
    await tx
      .delete(seasons)
      .where(and(eq(seasons.locationId, cfg.locationId), inArray(seasons.id, [...deleted])));
  // Two passes, so a swap of two names or two starts never meets a unique index mid-way. A stored
  // season holds a trimmed name and a start `parseSeasonStart` accepts (enforced here and by the
  // import's `validateSeasonWeeks`), and no temporary name or start is either.
  const moving = changed.filter((entry) => {
    const own = stored.get(entry.id!)!;
    return own.name !== entry.name || own.startsOn !== entry.startsOn;
  });
  for (const [k, entry] of moving.entries())
    await tx
      .update(seasons)
      .set({ name: ` ${entry.id!}`, startsOn: temporaryStart(k) })
      .where(eq(seasons.id, entry.id!));
  for (const { id, name, startsOn, colour } of changed)
    await tx.update(seasons).set({ name, startsOn, colour }).where(eq(seasons.id, id!));
  for (const { name, startsOn, colour, split } of added) {
    const [row] = await tx
      .insert(seasons)
      .values({ name, startsOn, colour, locationId: cfg.locationId })
      .returning({ id: seasons.id });
    for (const [departmentId, weeks] of departmentWeeks) {
      const week = weeks.get(split);
      if (week !== undefined) await writeDepartmentSeasonWeeks(tx, departmentId, [row!.id], week);
    }
    for (const [zoneId, weeks] of zoneWeeks) {
      const week = weeks.get(split);
      if (week !== undefined) await writeZoneSeasonWeeks(tx, zoneId, [row!.id], week);
    }
  }
  if (timed) await checkScheduleAfterSeasonWrite(tx, cfg);
  return readSeasons(tx, cfg);
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
