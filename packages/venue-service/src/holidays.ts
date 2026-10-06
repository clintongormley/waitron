import { and, asc, eq, gte, lte, ne, type SQL } from "drizzle-orm";
import {
  findAdministrativeArea,
  type CountryHolidayCalendar,
  type CountryPack,
  type ShippedHolidayCoverage,
} from "@waitron/country";
import { getCountryPack } from "@waitron/country-packs";
import { locations, readTenant, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { compareHolidayFacts, holidayDateName } from "./holiday-naming.js";
import { localHolidayName } from "./holiday-rules.js";
import {
  type HolidayCoverage,
  type HolidayGeography,
  type HolidayRead,
  type HolidaySource,
  type LocalHoliday,
  type LocalHolidayInput,
  type LocalHolidayModel,
} from "./holiday-types.js";
import { isLocalDate, rangeDates } from "./hours-rules.js";
import type { HolidayFact, LocalDate, SpecialDate } from "./hours-types.js";
import {
  duplicateSpecialDate,
  renameSpecialDate,
  type HolidayReader,
  type SpecialDateParticipant,
} from "./hours.js";
import type { VenueScope } from "./operations.js";
import { holidayGeographies, localHolidays } from "./schema/holidays.js";
import "./errors.js";

export type PackLookup = (country: string) => CountryPack | undefined;

type GeographyRow = typeof holidayGeographies.$inferSelect;

/** What the venue's stored address resolves to. `key` is set only when every part resolved. */
interface Address {
  country: string;
  pack: CountryPack | undefined;
  calendar: CountryHolidayCalendar | undefined;
  provinceCode: string | null;
  city: string | null;
  key: { country: string; provinceCode: string; cityKey: string } | null;
}

/** Cities compare after NFC, trimmed with inner whitespace collapsed, and lowercased. */
export function holidayCityKey(city: string): string {
  return city.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function invalid(field: string): never {
  throw new AppError("holiday.invalid", { field });
}

const yearOf = (date: LocalDate) => Number(date.slice(0, 4));
const yearStart = (year: number) => `${String(year).padStart(4, "0")}-01-01`;
const yearEnd = (year: number) => `${String(year).padStart(4, "0")}-12-31`;

function parseLocalHoliday(value: unknown): LocalHolidayInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("input");
  const { date, name } = value as Record<string, unknown>;
  if (!isLocalDate(date)) invalid("date");
  const trimmed = localHolidayName(name);
  if (trimmed === null) invalid("name");
  return { date, name: trimmed };
}

function parseAreaKey(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("areaKey");
  if (!("areaKey" in value)) invalid("areaKey");
  const { areaKey } = value as { areaKey: unknown };
  if (areaKey !== null && typeof areaKey !== "string") invalid("areaKey");
  return areaKey;
}

const ownerSourceId = (geographyId: string) => `owner:${geographyId}`;

function geographyOf(row: GeographyRow, address: Address): HolidayGeography {
  return {
    id: row.id,
    country: row.country,
    provinceCode: row.provinceCode,
    city: row.city,
    areaKey: row.areaKey,
    matchesVenue: matches(row, address),
  };
}

function matches(row: GeographyRow, address: Address): boolean {
  return (
    address.key !== null &&
    row.country === address.key.country &&
    row.provinceCode === address.key.provinceCode &&
    row.cityKey === address.key.cityKey
  );
}

/**
 * The holiday readers and writers, each reading and writing only on the caller's transaction and
 * resolving the venue's country through `findPack`.
 */
export function createHolidayStore(findPack: PackLookup = getCountryPack) {
  async function readAddress(tx: Transaction, cfg: VenueScope): Promise<Address> {
    const tenant = await readTenant(tx);
    const [location] = await tx
      .select({ city: locations.city, province: locations.province })
      .from(locations)
      .where(eq(locations.id, cfg.locationId));
    const pack = tenant === null ? undefined : findPack(tenant.country);
    const country = pack?.countryCode ?? tenant?.country.trim().toUpperCase() ?? "";
    const province = location?.province ?? null;
    const provinceCode =
      pack === undefined || province === null
        ? null
        : (findAdministrativeArea(pack, province)?.code ?? null);
    const rawCity = location?.city ?? null;
    const city = rawCity === null || rawCity.trim() === "" ? null : rawCity;
    return {
      country,
      pack,
      calendar: pack?.holidayCalendar,
      provinceCode,
      city,
      key:
        pack === undefined || provinceCode === null || city === null
          ? null
          : { country: pack.countryCode, provinceCode, cityKey: holidayCityKey(city) },
    };
  }

  async function geographiesOf(tx: Transaction, cfg: VenueScope): Promise<GeographyRow[]> {
    return tx
      .select()
      .from(holidayGeographies)
      .where(eq(holidayGeographies.locationId, cfg.locationId))
      .orderBy(asc(holidayGeographies.cityKey), asc(holidayGeographies.id));
  }

  async function entriesOf(tx: Transaction, geographyId: string, ...filters: (SQL | undefined)[]) {
    return tx
      .select()
      .from(localHolidays)
      .where(and(eq(localHolidays.geographyId, geographyId), ...filters))
      .orderBy(asc(localHolidays.date), asc(localHolidays.id));
  }

  async function createGeography(
    tx: Transaction,
    cfg: VenueScope,
    address: Address,
  ): Promise<GeographyRow> {
    const [row] = await tx
      .insert(holidayGeographies)
      .values({
        locationId: cfg.locationId,
        country: address.key!.country,
        provinceCode: address.key!.provinceCode,
        city: address.city!.trim(),
        cityKey: address.key!.cityKey,
      })
      .returning();
    return row!;
  }

  async function readHolidays(
    tx: Transaction,
    cfg: VenueScope,
    from: LocalDate,
    to: LocalDate,
  ): Promise<HolidayRead> {
    rangeDates(from, to);
    const address = await readAddress(tx, cfg);
    const { calendar, provinceCode } = address;
    const current = (await geographiesOf(tx, cfg)).find((row) => matches(row, address));
    const firstYear = yearOf(from);
    const lastYear = yearOf(to);

    const facts: HolidayFact[] = [];
    const shipped = new Map<number, ShippedHolidayCoverage>();
    if (calendar !== undefined && provinceCode !== null) {
      const read = calendar.read({ provinceCode, areaKey: current?.areaKey ?? null, from, to });
      facts.push(...read.facts);
      for (const coverage of read.coverage) shipped.set(coverage.year, coverage);
    }
    const entries =
      calendar !== undefined && current !== undefined
        ? await entriesOf(
            tx,
            current.id,
            gte(localHolidays.date, yearStart(firstYear)),
            lte(localHolidays.date, yearEnd(lastYear)),
          )
        : [];
    for (const entry of entries)
      if (entry.date >= from && entry.date <= to)
        facts.push({
          id: `local:${entry.id}`,
          date: entry.date,
          name: entry.name,
          scope: "local",
          sourceId: ownerSourceId(entry.geographyId),
        });

    const coverage: HolidayCoverage[] = [];
    for (let year = firstYear; year <= lastYear; year++) {
      const ofYear = shipped.get(year);
      const entered = entries.some(({ date }) => yearOf(date) === year);
      coverage.push({
        year,
        country: address.country,
        provinceCode,
        regionCode: ofYear?.regionCode ?? null,
        nationalRegional:
          calendar === undefined ? "unsupported_country" : (ofYear?.state ?? "unknown_region"),
        local:
          address.key === null
            ? "address_unresolved"
            : calendar === undefined
              ? "unsupported_country"
              : entered
                ? "owner_entered"
                : "none_entered",
        dataVersion: ofYear?.dataVersion ?? null,
        sourceIds: [...(ofYear?.sourceIds ?? []), ...(entered ? [ownerSourceId(current!.id)] : [])],
      });
    }

    const unique = [...new Map(facts.map((fact) => [fact.id, fact])).values()].sort(
      compareHolidayFacts,
    );
    const referenced = new Set([
      ...unique.map(({ sourceId }) => sourceId),
      ...coverage.flatMap(({ sourceIds }) => sourceIds),
    ]);
    const sources: HolidaySource[] = (calendar?.sources ?? [])
      .filter(({ id }) => referenced.has(id))
      .map(({ id, title, url, sha256 }) => ({ id, kind: "official", title, url, sha256 }));
    if (current !== undefined && referenced.has(ownerSourceId(current.id)))
      sources.push({
        id: ownerSourceId(current.id),
        kind: "owner",
        title: current.city,
        url: null,
        sha256: null,
      });
    return { facts: unique, coverage, sources };
  }

  const readHolidayFacts: HolidayReader = async (tx, cfg, from, to) =>
    (await readHolidays(tx, cfg, from, to)).facts;

  async function readLocalHolidayModel(
    tx: Transaction,
    cfg: VenueScope,
  ): Promise<LocalHolidayModel> {
    const address = await readAddress(tx, cfg);
    const rows = await geographiesOf(tx, cfg);
    const current = rows.find((row) => matches(row, address));
    const areaOptions =
      address.calendar !== undefined && address.provinceCode !== null
        ? address.calendar.areasForProvince(address.provinceCode).map(({ key, name }) => ({
            key,
            name,
          }))
        : [];
    const entries = current === undefined ? [] : await entriesOf(tx, current.id);
    return {
      venue: { country: address.country, provinceCode: address.provinceCode, city: address.city },
      localEntryLimit: address.calendar?.localEntryLimit ?? 0,
      areaOptions,
      areaRequired: areaOptions.length > 0 && (current?.areaKey ?? null) === null,
      geographies: rows.map((row) => geographyOf(row, address)),
      entries: entries.map(({ id, geographyId, date, name }) => ({ id, geographyId, date, name })),
    };
  }

  /** `null` when a choice was cleared at an address that has no geography row, so nothing was written. */
  async function saveHolidayArea(
    tx: Transaction,
    cfg: VenueScope,
    input: { areaKey: string | null },
  ): Promise<HolidayGeography | null> {
    const areaKey = parseAreaKey(input);
    const address = await readAddress(tx, cfg);
    if (address.key === null) invalid("geography");
    const options = address.calendar?.areasForProvince(address.key.provinceCode) ?? [];
    if (options.length === 0) invalid("areaKey");
    if (areaKey !== null && !options.some(({ key }) => key === areaKey)) invalid("areaKey");
    const found = (await geographiesOf(tx, cfg)).find((candidate) => matches(candidate, address));
    if (found === undefined && areaKey === null) return null;
    const row = found ?? (await createGeography(tx, cfg, address));
    const [updated] = await tx
      .update(holidayGeographies)
      .set({ areaKey })
      .where(eq(holidayGeographies.id, row.id))
      .returning();
    return geographyOf(updated!, address);
  }

  /** The entry `id` within the venue, with its geography, or `holiday.not_found`. */
  async function requireEntry(tx: Transaction, cfg: VenueScope, id: string) {
    const [found] = await tx
      .select({ id: localHolidays.id, geographyId: localHolidays.geographyId })
      .from(localHolidays)
      .innerJoin(holidayGeographies, eq(holidayGeographies.id, localHolidays.geographyId))
      .where(and(eq(localHolidays.id, id), eq(holidayGeographies.locationId, cfg.locationId)));
    if (found === undefined) throw new AppError("holiday.not_found", { id });
    return found;
  }

  async function saveLocalHoliday(
    tx: Transaction,
    cfg: VenueScope,
    id: string | null,
    input: LocalHolidayInput,
  ): Promise<LocalHoliday> {
    const existing = id === null ? null : await requireEntry(tx, cfg, id);
    const address = await readAddress(tx, cfg);
    if (address.key === null) invalid("geography");
    const current = (await geographiesOf(tx, cfg)).find((row) => matches(row, address));
    if (existing !== null && existing.geographyId !== current?.id) invalid("id");
    const { calendar } = address;
    if (calendar === undefined) {
      const date = (input as { date?: unknown } | null)?.date;
      throw new AppError(
        "holiday.local_limit",
        isLocalDate(date) ? { limit: 0, year: yearOf(date) } : { limit: 0 },
      );
    }
    const { date, name } = parseLocalHoliday(input);
    const year = yearOf(date);
    const others = existing === null ? undefined : ne(localHolidays.id, existing.id);
    if (current !== undefined) {
      if ((await entriesOf(tx, current.id, eq(localHolidays.date, date), others)).length > 0)
        throw new AppError("holiday.date_taken", { date });
    }
    const counted =
      current === undefined
        ? 0
        : (
            await entriesOf(
              tx,
              current.id,
              gte(localHolidays.date, yearStart(year)),
              lte(localHolidays.date, yearEnd(year)),
              others,
            )
          ).length;
    if (counted >= calendar.localEntryLimit)
      throw new AppError("holiday.local_limit", { limit: calendar.localEntryLimit, year });

    if (existing !== null) {
      await tx.update(localHolidays).set({ date, name }).where(eq(localHolidays.id, existing.id));
      return { id: existing.id, geographyId: existing.geographyId, date, name };
    }
    const geography = current ?? (await createGeography(tx, cfg, address));
    const [row] = await tx
      .insert(localHolidays)
      .values({ geographyId: geography.id, date, name })
      .returning();
    return { id: row!.id, geographyId: row!.geographyId, date, name };
  }

  async function deleteLocalHoliday(tx: Transaction, cfg: VenueScope, id: string): Promise<void> {
    const entry = await requireEntry(tx, cfg, id);
    await tx.delete(localHolidays).where(eq(localHolidays.id, entry.id));
  }

  async function deleteRetainedHolidayGeography(
    tx: Transaction,
    cfg: VenueScope,
    id: string,
  ): Promise<void> {
    const [row] = await tx
      .select()
      .from(holidayGeographies)
      .where(and(eq(holidayGeographies.id, id), eq(holidayGeographies.locationId, cfg.locationId)));
    if (row === undefined) throw new AppError("holiday.not_found", { id });
    if (matches(row, await readAddress(tx, cfg)))
      throw new AppError("holiday.geography_current", { geographyId: row.id });
    await tx.delete(localHolidays).where(eq(localHolidays.geographyId, row.id));
    await tx.delete(holidayGeographies).where(eq(holidayGeographies.id, row.id));
  }

  /**
   * Hours' duplicate, after which each copy on a holiday takes that date's holiday name; a copy on
   * any other date keeps the source's name. Targets may be years apart, so facts are read one civil
   * year at a time.
   */
  async function duplicateHolidayNamedSpecialDates(
    tx: Transaction,
    cfg: VenueScope,
    sourceId: string,
    dates: readonly LocalDate[],
    at: Date,
    participants: readonly SpecialDateParticipant[] = [],
  ): Promise<SpecialDate[]> {
    const copies = await duplicateSpecialDate(tx, cfg, sourceId, dates, at, participants);
    const byYear = new Map<number, LocalDate[]>();
    for (const { date } of copies)
      byYear.set(yearOf(date), [...(byYear.get(yearOf(date)) ?? []), date]);
    const facts: HolidayFact[] = [];
    for (const targets of byYear.values()) {
      targets.sort();
      facts.push(...(await readHolidays(tx, cfg, targets[0]!, targets[targets.length - 1]!)).facts);
    }
    const named: SpecialDate[] = [];
    for (const copy of copies) {
      const name = holidayDateName(facts, copy.date, copy.name);
      named.push(name === copy.name ? copy : await renameSpecialDate(tx, cfg, copy.id, name));
    }
    return named;
  }

  return {
    readHolidays,
    readHolidayFacts,
    duplicateHolidayNamedSpecialDates,
    readLocalHolidayModel,
    saveHolidayArea,
    saveLocalHoliday,
    deleteLocalHoliday,
    deleteRetainedHolidayGeography,
  };
}

const INSTALLED = createHolidayStore();

export const {
  readHolidays,
  readLocalHolidayModel,
  saveHolidayArea,
  saveLocalHoliday,
  deleteLocalHoliday,
  deleteRetainedHolidayGeography,
  duplicateHolidayNamedSpecialDates,
} = INSTALLED;
export const readHolidayFacts: HolidayReader = INSTALLED.readHolidayFacts;
