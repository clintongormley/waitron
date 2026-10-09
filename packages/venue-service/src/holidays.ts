import { and, asc, eq, lte } from "drizzle-orm";
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
import { holidayCityKey } from "./holiday-rules.js";
import {
  type HolidayCoverage,
  type HolidayGeography,
  type HolidayRead,
  type HolidaySource,
  type HolidayAreaModel,
} from "./holiday-types.js";
import { rangeDates } from "./hours-rules.js";
import type { HolidayFact, LocalDate, SpecialDate } from "./hours-types.js";
import {
  duplicateSpecialDate,
  renameSpecialDate,
  type HolidayReader,
  type SpecialDateParticipant,
} from "./hours.js";
import { occursOn } from "./named-day-rules.js";
import { specialDates } from "./schema/hours.js";
import type { VenueScope } from "./operations.js";
import { holidayGeographies } from "./schema/holidays.js";
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

function invalid(field: string): never {
  throw new AppError("holiday.invalid", { field });
}

const yearOf = (date: LocalDate) => Number(date.slice(0, 4));
const yearEnd = (year: number) => `${String(year).padStart(4, "0")}-12-31`;

function parseAreaKey(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("areaKey");
  if (!("areaKey" in value)) invalid("areaKey");
  const { areaKey } = value as { areaKey: unknown };
  if (areaKey !== null && typeof areaKey !== "string") invalid("areaKey");
  return areaKey;
}

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
    const ownHolidays = await tx
      .select({ date: specialDates.date, repeatOn: specialDates.repeatOn })
      .from(specialDates)
      .where(
        and(
          eq(specialDates.locationId, cfg.locationId),
          eq(specialDates.kind, "holiday"),
          lte(specialDates.date, yearEnd(lastYear)),
        ),
      );
    const namedSourceId = `owner:named-days:${cfg.locationId}`;
    const coverage: HolidayCoverage[] = [];
    for (let year = firstYear; year <= lastYear; year++) {
      const ofYear = shipped.get(year);
      const ownEntered = ownHolidays.some(({ date, repeatOn }) =>
        occursOn(
          { date, repeats: repeatOn !== null },
          `${String(year).padStart(4, "0")}-${date.slice(5)}`,
        ),
      );
      coverage.push({
        year,
        country: address.country,
        provinceCode,
        regionCode: ofYear?.regionCode ?? null,
        nationalRegional:
          calendar === undefined ? "unsupported_country" : (ofYear?.state ?? "unknown_region"),
        local: ownEntered
          ? "owner_entered"
          : address.key === null
            ? "address_unresolved"
            : calendar === undefined
              ? "unsupported_country"
              : "none_entered",
        dataVersion: ofYear?.dataVersion ?? null,
        sourceIds: [...(ofYear?.sourceIds ?? []), ...(ownEntered ? [namedSourceId] : [])],
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
    if (referenced.has(namedSourceId))
      sources.push({
        id: namedSourceId,
        kind: "owner",
        title: "Venue's own holidays",
        url: null,
        sha256: null,
      });
    return { facts: unique, coverage, sources };
  }

  const readHolidayFacts: HolidayReader = async (tx, cfg, from, to) =>
    (await readHolidays(tx, cfg, from, to)).facts;

  async function readHolidayAreaModel(tx: Transaction, cfg: VenueScope): Promise<HolidayAreaModel> {
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
    return {
      venue: { country: address.country, provinceCode: address.provinceCode, city: address.city },
      localHolidaysPerYear: address.calendar?.localEntryLimit ?? 0,
      areaOptions,
      areaRequired: areaOptions.length > 0 && (current?.areaKey ?? null) === null,
      chosen: current?.areaKey ?? null,
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
    readHolidayAreaModel,
    saveHolidayArea,
  };
}

const INSTALLED = createHolidayStore();

export const {
  readHolidays,
  readHolidayAreaModel,
  saveHolidayArea,
  duplicateHolidayNamedSpecialDates,
} = INSTALLED;
export const readHolidayFacts: HolidayReader = INSTALLED.readHolidayFacts;
