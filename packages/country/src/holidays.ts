export type ShippedHolidayScope = "national" | "regional";

export interface ShippedHolidayFact {
  readonly id: string;
  readonly date: string;
  readonly name: string;
  readonly scope: ShippedHolidayScope;
  readonly sourceId: string;
}

export type ShippedHolidayCoverageState =
  "complete" | "missing_year" | "unknown_region" | "area_required";

export interface ShippedHolidayCoverage {
  readonly year: number;
  readonly state: ShippedHolidayCoverageState;
  readonly regionCode: string | null;
  readonly dataVersion: string | null;
  readonly sourceIds: readonly string[];
}

export interface ShippedHolidayRead {
  readonly facts: readonly ShippedHolidayFact[];
  readonly coverage: readonly ShippedHolidayCoverage[];
}

export interface HolidaySourceReference {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly sha256: string;
}

export interface HolidayAreaOption {
  readonly key: string;
  readonly name: string;
}

export interface CountryHolidayCalendar {
  /** A nonnegative integer: local holidays per geography per civil year. */
  readonly localEntryLimit: number;
  readonly sources: readonly HolidaySourceReference[];
  regionForProvince(provinceCode: string): string | undefined;
  areasForProvince(provinceCode: string): readonly HolidayAreaOption[];
  read(input: {
    readonly provinceCode: string;
    readonly areaKey: string | null;
    readonly from: string;
    readonly to: string;
  }): ShippedHolidayRead;
}

export interface HolidayAreaDefinition extends HolidayAreaOption {
  readonly provinces: readonly string[];
}

/** One published holiday. A row naming `onlyAreas` applies only in those areas of its regions; one
 * naming `exceptAreas` applies everywhere in its regions but there. */
export interface HolidayDatasetRow {
  readonly key: string;
  readonly date: string;
  readonly name: string;
  readonly scope: ShippedHolidayScope;
  readonly regions: readonly string[];
  readonly onlyAreas?: readonly string[];
  readonly exceptAreas?: readonly string[];
  readonly sourceId: string;
}

export interface HolidayDatasetYear {
  readonly year: number;
  readonly dataVersion: string;
  readonly sourceIds: readonly string[];
  readonly rows: readonly HolidayDatasetRow[];
}

export interface HolidayDataset {
  readonly localEntryLimit: number;
  readonly sources: readonly HolidaySourceReference[];
  readonly provinceRegions: Readonly<Record<string, string>>;
  readonly areas: readonly HolidayAreaDefinition[];
  readonly years: readonly HolidayDatasetYear[];
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDate(value: string): boolean {
  const match = DATE.exec(value);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function refuse(reason: string): never {
  throw new Error(`holiday dataset: ${reason}`);
}

function checkDataset(dataset: HolidayDataset): void {
  if (!Number.isInteger(dataset.localEntryLimit) || dataset.localEntryLimit < 0)
    refuse("localEntryLimit must be a nonnegative integer");
  const sourceIds = new Set<string>();
  for (const source of dataset.sources) {
    if (!/^[0-9a-f]{64}$/.test(source.sha256)) refuse(`source ${source.id} has no SHA-256`);
    sourceIds.add(source.id);
  }
  const provinces = new Set(Object.keys(dataset.provinceRegions));
  const regions = new Set(Object.values(dataset.provinceRegions));
  const areaKeys = new Set<string>();
  for (const area of dataset.areas) {
    if (areaKeys.has(area.key)) refuse(`area ${area.key} is declared twice`);
    areaKeys.add(area.key);
    for (const province of area.provinces)
      if (!provinces.has(province)) refuse(`area ${area.key} names unknown province ${province}`);
  }
  const named = new Set<string>();
  const years = new Set<number>();
  const keys = new Set<string>();
  for (const year of dataset.years) {
    if (years.has(year.year)) refuse(`year ${year.year} is declared twice`);
    years.add(year.year);
    for (const id of year.sourceIds)
      if (!sourceIds.has(id)) refuse(`year ${year.year} names unknown source ${id}`);
    for (const row of year.rows) {
      if (keys.has(row.key)) refuse(`fact key ${row.key} is used twice`);
      keys.add(row.key);
      if (!isRealDate(row.date) || Number(row.date.slice(0, 4)) !== year.year)
        refuse(`fact ${row.key} has a date outside ${year.year}`);
      if (row.regions.length === 0) refuse(`fact ${row.key} names no region`);
      for (const region of row.regions)
        if (!regions.has(region)) refuse(`fact ${row.key} names unknown region ${region}`);
      for (const area of [...(row.onlyAreas ?? []), ...(row.exceptAreas ?? [])]) {
        if (!areaKeys.has(area)) refuse(`fact ${row.key} names unknown area ${area}`);
        named.add(area);
      }
      if (!sourceIds.has(row.sourceId))
        refuse(`fact ${row.key} names unknown source ${row.sourceId}`);
    }
  }
  const decided = new Set(
    dataset.areas.filter(({ key }) => named.has(key)).flatMap(({ provinces }) => provinces),
  );
  for (const area of dataset.areas)
    if (!area.provinces.some((province) => decided.has(province)))
      refuse(`no fact depends on the choice area ${area.key} belongs to`);
}

type Applies = "yes" | "no" | "unknown";

function applies(
  row: HolidayDatasetRow,
  provinceAreas: ReadonlySet<string>,
  areaKey: string | null,
): Applies {
  const restriction = row.onlyAreas ?? row.exceptAreas;
  if (restriction === undefined) return "yes";
  const listed = row.onlyAreas !== undefined;
  if (!restriction.some((area) => provinceAreas.has(area))) return listed ? "no" : "yes";
  if (areaKey === null) return "unknown";
  return restriction.includes(areaKey) === listed ? "yes" : "no";
}

const SCOPE_ORDER: Readonly<Record<ShippedHolidayScope, number>> = { national: 0, regional: 1 };

function compareFacts(a: ShippedHolidayFact, b: ShippedHolidayFact): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.scope !== b.scope) return SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope];
  return a.id < b.id ? -1 : 1;
}

/** A row's fact id is `shipped:` plus its key, so it never depends on the row's position or name. */
export function createHolidayCalendar(dataset: HolidayDataset): CountryHolidayCalendar {
  checkDataset(dataset);
  const regionByProvince = new Map(Object.entries(dataset.provinceRegions));
  const yearByNumber = new Map(dataset.years.map((year) => [year.year, year]));
  const areasOf = (provinceCode: string) =>
    dataset.areas.filter(({ provinces }) => provinces.includes(provinceCode));

  return {
    localEntryLimit: dataset.localEntryLimit,
    sources: dataset.sources,
    regionForProvince: (provinceCode) => regionByProvince.get(provinceCode),
    areasForProvince: (provinceCode) =>
      areasOf(provinceCode).map(({ key, name }) => ({ key, name })),
    read({ provinceCode, areaKey, from, to }) {
      if (!isRealDate(from) || !isRealDate(to) || from > to)
        throw new RangeError(`holiday range ${from}..${to} is not two real dates in order`);
      const region = regionByProvince.get(provinceCode);
      const provinceAreas = new Set(areasOf(provinceCode).map(({ key }) => key));
      const area = areaKey !== null && provinceAreas.has(areaKey) ? areaKey : null;
      const facts: ShippedHolidayFact[] = [];
      const coverage: ShippedHolidayCoverage[] = [];
      for (let number = Number(from.slice(0, 4)); number <= Number(to.slice(0, 4)); number++) {
        const year = yearByNumber.get(number);
        if (region === undefined || year === undefined) {
          coverage.push({
            year: number,
            state: region === undefined ? "unknown_region" : "missing_year",
            regionCode: region ?? null,
            dataVersion: null,
            sourceIds: [],
          });
          continue;
        }
        let unknown = false;
        for (const row of year.rows) {
          if (!row.regions.includes(region)) continue;
          const answer = applies(row, provinceAreas, area);
          if (answer === "unknown") unknown = true;
          if (answer === "yes" && row.date >= from && row.date <= to)
            facts.push({
              id: `shipped:${row.key}`,
              date: row.date,
              name: row.name,
              scope: row.scope,
              sourceId: row.sourceId,
            });
        }
        coverage.push({
          year: number,
          state: unknown ? "area_required" : "complete",
          regionCode: region,
          dataVersion: year.dataVersion,
          sourceIds: year.sourceIds,
        });
      }
      return { facts: facts.sort(compareFacts), coverage };
    },
  };
}
