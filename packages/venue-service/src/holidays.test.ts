import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { createHolidayCalendar, type CountryPack } from "@waitron/country";
import { getCountryPack } from "@waitron/country-packs";
import {
  CORE_MIGRATIONS,
  locations,
  tenants,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { localHolidayName } from "./holiday-rules.js";
import {
  LOCAL_HOLIDAY_NAME_MAX,
  type LocalHoliday,
  type LocalHolidayInput,
} from "./holiday-types.js";
import {
  createHolidayStore,
  readHolidayFacts as packageReadHolidayFacts,
  readHolidays as packageReadHolidays,
} from "./holidays.js";
import { saveSpecialDate } from "./hours.js";
import * as packageIndex from "./index.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import type { VenueScope } from "./operations.js";
import { holidayGeographies, localHolidays } from "./schema/holidays.js";
import { specialDates } from "./schema/hours.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

const SHA = "a".repeat(64);

/** An invented country, so no expectation below depends on any real country's data. */
function syntheticPack(localEntryLimit: number): CountryPack {
  return {
    countryCode: "ZZ",
    defaultLocale: "en-GB",
    defaultTimeZone: "Europe/Madrid",
    invoiceLocales: ["en-GB"],
    moduleIds: [],
    availableForVenueSetup: false,
    fiscalJurisdictions: [],
    administrativeAreas: [
      { code: "10", name: "Northshire", aliases: ["North"], postalPrefixes: [] },
      { code: "20", name: "Southshire", postalPrefixes: [] },
      { code: "30", name: "Isleshire", postalPrefixes: [] },
      { code: "40", name: "Lostshire", postalPrefixes: [] },
    ],
    holidayCalendar: createHolidayCalendar({
      localEntryLimit,
      sources: [
        { id: "ZZ-ANNEX", title: "Invented annex", url: "https://example.test/annex", sha256: SHA },
        { id: "ZZ-MAP", title: "Invented map", url: "https://example.test/map", sha256: SHA },
      ],
      provinceRegions: { "10": "R1", "20": "R2", "30": "R3" },
      areas: [
        { key: "isle-a", name: "Isle A", provinces: ["30"] },
        { key: "isle-b", name: "Isle B", provinces: ["30"] },
      ],
      years: [
        {
          year: 2026,
          dataVersion: "ZZ-2026.1",
          sourceIds: ["ZZ-ANNEX"],
          rows: [
            {
              key: "new-year",
              date: "2026-01-01",
              name: "New Year",
              scope: "national",
              regions: ["R1", "R2", "R3"],
              sourceId: "ZZ-ANNEX",
            },
            {
              key: "north-fair",
              date: "2026-05-01",
              name: "North fair",
              scope: "regional",
              regions: ["R1"],
              sourceId: "ZZ-ANNEX",
            },
            {
              key: "north-day",
              date: "2026-05-01",
              name: "North day",
              scope: "regional",
              regions: ["R1"],
              sourceId: "ZZ-ANNEX",
            },
            {
              key: "isle-a-day",
              date: "2026-07-01",
              name: "Isle A day",
              scope: "regional",
              regions: ["R3"],
              onlyAreas: ["isle-a"],
              sourceId: "ZZ-ANNEX",
            },
          ],
        },
        {
          year: 2027,
          dataVersion: "ZZ-2027.1",
          sourceIds: ["ZZ-ANNEX"],
          rows: [
            {
              key: "new-year-2027",
              date: "2027-01-01",
              name: "New Year",
              scope: "national",
              regions: ["R1", "R2", "R3"],
              sourceId: "ZZ-ANNEX",
            },
          ],
        },
      ],
    }),
  };
}

const WITHOUT_CAPABILITY: CountryPack = { ...syntheticPack(0), countryCode: "ZY" };
delete (WITHOUT_CAPABILITY as { holidayCalendar?: unknown }).holidayCalendar;

function storeWith(localEntryLimit: number) {
  return createHolidayStore((country) =>
    country === "ZZ"
      ? syntheticPack(localEntryLimit)
      : country === "ZY"
        ? WITHOUT_CAPABILITY
        : undefined,
  );
}

const store = storeWith(1);

interface Address {
  country?: string;
  province?: string | null;
  city?: string | null;
}

async function setCountry(tx: Transaction, country: string) {
  await tx
    .insert(tenants)
    .values({ id: 1, country, taxId: "X0000000", legalName: "Invented SL" })
    .onConflictDoUpdate({ target: tenants.id, set: { country } });
}

/** A venue at `address`, with a second venue beside it so a foreign id has somewhere to live. */
async function venue(address: Address = {}): Promise<VenueScope> {
  return withTransaction(db, async (tx) => {
    await setCountry(tx, address.country ?? "ZZ");
    const [location] = await tx
      .insert(locations)
      .values({
        name: `Venue ${randomUUID()}`,
        invoiceLocales: ["en-GB"],
        operationDescription: "Hospitality",
        province: address.province === undefined ? "Northshire" : address.province,
        city: address.city === undefined ? "Villa Real" : address.city,
      })
      .returning();
    return { locationId: locationId(location!.id) };
  });
}

async function moveTo(cfg: VenueScope, address: Address) {
  await withTransaction(db, async (tx) => {
    if (address.country !== undefined) await setCountry(tx, address.country);
    const set: { province?: string | null; city?: string | null } = {};
    if (address.province !== undefined) set.province = address.province;
    if (address.city !== undefined) set.city = address.city;
    if (Object.keys(set).length > 0)
      await tx.update(locations).set(set).where(eq(locations.id, cfg.locationId));
  });
}

const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(db, fn);

const local = (date: string, name = `Fiesta ${date}`): LocalHolidayInput => ({ date, name });

async function stored() {
  return run(async (tx) => ({
    geographies: await tx.select().from(holidayGeographies).orderBy(asc(holidayGeographies.id)),
    entries: await tx.select().from(localHolidays).orderBy(asc(localHolidays.id)),
  }));
}

/** Runs `fn` and returns its refusal, caught outside the transaction it opened. */
async function refusal(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    return error as { code: string; params: Record<string, unknown> };
  }
  throw new Error("expected a refusal");
}

describe("reading a venue's holidays", () => {
  it("reads a fresh resolved address as none entered, with no geography row", async () => {
    const cfg = await venue();
    const read = await run((tx) => store.readHolidays(tx, cfg, "2026-01-01", "2026-12-31"));
    expect(read.facts).toEqual([
      {
        id: "shipped:new-year",
        date: "2026-01-01",
        name: "New Year",
        scope: "national",
        sourceId: "ZZ-ANNEX",
      },
      {
        id: "shipped:north-day",
        date: "2026-05-01",
        name: "North day",
        scope: "regional",
        sourceId: "ZZ-ANNEX",
      },
      {
        id: "shipped:north-fair",
        date: "2026-05-01",
        name: "North fair",
        scope: "regional",
        sourceId: "ZZ-ANNEX",
      },
    ]);
    expect(read.coverage).toEqual([
      {
        year: 2026,
        country: "ZZ",
        provinceCode: "10",
        regionCode: "R1",
        nationalRegional: "complete",
        local: "none_entered",
        dataVersion: "ZZ-2026.1",
        sourceIds: ["ZZ-ANNEX"],
      },
    ]);
    // The pack's map source is in its list but no returned fact or coverage names it.
    expect(read.sources).toEqual([
      {
        id: "ZZ-ANNEX",
        kind: "official",
        title: "Invented annex",
        url: "https://example.test/annex",
        sha256: SHA,
      },
    ]);
    expect(await stored()).toEqual({ geographies: [], entries: [] });
    const model = await run((tx) => store.readLocalHolidayModel(tx, cfg));
    expect(model).toEqual({
      venue: { country: "ZZ", provinceCode: "10", city: "Villa Real" },
      localEntryLimit: 1,
      areaOptions: [],
      areaRequired: false,
      geographies: [],
      entries: [],
    });
  });

  it("creates the geography on the first save, and an equivalent spelling reuses it", async () => {
    const cfg = await venue({ city: "Villa  Real" });
    const three = storeWith(3);
    const first = await run((tx) => three.saveLocalHoliday(tx, cfg, null, local("2026-03-19")));
    const { geographies } = await stored();
    expect(geographies).toEqual([
      {
        id: first.geographyId,
        locationId: cfg.locationId,
        country: "ZZ",
        provinceCode: "10",
        city: "Villa  Real",
        cityKey: "villa real",
        areaKey: null,
      },
    ]);
    await moveTo(cfg, { city: "  VILLA real ", province: "North" });
    const second = await run((tx) => three.saveLocalHoliday(tx, cfg, null, local("2026-09-08")));
    expect(second.geographyId).toBe(first.geographyId);
    const model = await run((tx) => three.readLocalHolidayModel(tx, cfg));
    expect(model.geographies).toEqual([
      {
        id: first.geographyId,
        country: "ZZ",
        provinceCode: "10",
        city: "Villa  Real",
        areaKey: null,
        matchesVenue: true,
      },
    ]);
    expect(model.entries.map(({ id }) => id)).toEqual([first.id, second.id]);
    expect(model.venue).toEqual({ country: "ZZ", provinceCode: "10", city: "  VILLA real " });
  });

  it("keeps accents and punctuation apart when comparing cities", async () => {
    const cfg = await venue({ city: "Ávila" });
    const saved = await run((tx) => store.saveLocalHoliday(tx, cfg, null, local("2026-03-19")));
    await moveTo(cfg, { city: "Avila" });
    const model = await run((tx) => store.readLocalHolidayModel(tx, cfg));
    expect(model.entries).toEqual([]);
    expect(model.geographies).toMatchObject([{ id: saved.geographyId, matchesVenue: false }]);
    await moveTo(cfg, { city: "Ávila" });
    const back = await run((tx) => store.readLocalHolidayModel(tx, cfg));
    expect(back.entries.map(({ id }) => id)).toEqual([saved.id]);
  });

  it("returns local facts beside shipped ones on the same date, ordered by scope", async () => {
    const cfg = await venue();
    const saved = await run((tx) =>
      store.saveLocalHoliday(tx, cfg, null, local("2026-01-01", "  Fiesta mayor ")),
    );
    const read = await run((tx) => store.readHolidays(tx, cfg, "2026-01-01", "2026-01-01"));
    expect(read.facts).toEqual([
      {
        id: "shipped:new-year",
        date: "2026-01-01",
        name: "New Year",
        scope: "national",
        sourceId: "ZZ-ANNEX",
      },
      {
        id: `local:${saved.id}`,
        date: "2026-01-01",
        name: "Fiesta mayor",
        scope: "local",
        sourceId: `owner:${saved.geographyId}`,
      },
    ]);
    expect(read.coverage).toMatchObject([
      { local: "owner_entered", sourceIds: ["ZZ-ANNEX", `owner:${saved.geographyId}`] },
    ]);
    expect(read.sources).toEqual([
      {
        id: "ZZ-ANNEX",
        kind: "official",
        title: "Invented annex",
        url: "https://example.test/annex",
        sha256: SHA,
      },
      {
        id: `owner:${saved.geographyId}`,
        kind: "owner",
        title: "Villa Real",
        url: null,
        sha256: null,
      },
    ]);
    // The collision used the one slot this pack allows.
    const full = await refusal(() =>
      run((tx) => store.saveLocalHoliday(tx, cfg, null, local("2026-08-15"))),
    );
    expect(full).toMatchObject({ code: "holiday.local_limit", params: { limit: 1, year: 2026 } });
  });

  it("gives each civil year its own coverage, counting entries in the whole year", async () => {
    const cfg = await venue();
    const saved = await run((tx) => store.saveLocalHoliday(tx, cfg, null, local("2026-03-19")));
    const read = await run((tx) => store.readHolidays(tx, cfg, "2026-12-01", "2027-01-31"));
    expect(read.facts.map(({ id }) => id)).toEqual(["shipped:new-year-2027"]);
    expect(read.coverage).toEqual([
      {
        year: 2026,
        country: "ZZ",
        provinceCode: "10",
        regionCode: "R1",
        nationalRegional: "complete",
        local: "owner_entered",
        dataVersion: "ZZ-2026.1",
        sourceIds: ["ZZ-ANNEX", `owner:${saved.geographyId}`],
      },
      {
        year: 2027,
        country: "ZZ",
        provinceCode: "10",
        regionCode: "R1",
        nationalRegional: "complete",
        local: "none_entered",
        dataVersion: "ZZ-2027.1",
        sourceIds: ["ZZ-ANNEX"],
      },
    ]);
    expect(read.sources.map(({ id }) => id)).toEqual(["ZZ-ANNEX", `owner:${saved.geographyId}`]);
  });

  it("reports a year the pack does not ship as missing", async () => {
    const cfg = await venue();
    const read = await run((tx) => store.readHolidays(tx, cfg, "2028-01-01", "2028-01-31"));
    expect(read).toEqual({
      facts: [],
      coverage: [
        {
          year: 2028,
          country: "ZZ",
          provinceCode: "10",
          regionCode: "R1",
          nationalRegional: "missing_year",
          local: "none_entered",
          dataVersion: null,
          sourceIds: [],
        },
      ],
      sources: [],
    });
  });

  it("refuses a range exactly as Hours does", async () => {
    const cfg = await venue();
    for (const [from, to, field] of [
      ["2026-02-30", "2026-03-01", "from"],
      ["2026-03-01", "2026-02-28", "to"],
      ["2026-01-01", "2027-01-02", "to"],
    ] as const)
      expect(await refusal(() => run((tx) => store.readHolidays(tx, cfg, from, to)))).toMatchObject(
        { code: "hours.invalid", params: { field } },
      );
  });
});

describe("an address that does not resolve", () => {
  const year = ["2026-01-01", "2026-12-31"] as const;

  it("keeps shipped coverage for a missing city and reads local as unresolved", async () => {
    const cfg = await venue({ city: "   " });
    const read = await run((tx) => store.readHolidays(tx, cfg, ...year));
    expect(read.facts.map(({ id }) => id)).toEqual([
      "shipped:new-year",
      "shipped:north-day",
      "shipped:north-fair",
    ]);
    expect(read.coverage).toMatchObject([
      { provinceCode: "10", nationalRegional: "complete", local: "address_unresolved" },
    ]);
    const model = await run((tx) => store.readLocalHolidayModel(tx, cfg));
    expect(model.venue).toEqual({ country: "ZZ", provinceCode: "10", city: null });
    expect(model.localEntryLimit).toBe(1);
    expect(
      await refusal(() => run((tx) => store.saveLocalHoliday(tx, cfg, null, local("2026-03-19")))),
    ).toMatchObject({ code: "holiday.invalid", params: { field: "geography" } });
    expect(await stored()).toEqual({ geographies: [], entries: [] });
  });

  for (const province of [null, "Atlantis"])
    it(`reads province ${String(province)} as an unknown region with no facts`, async () => {
      const cfg = await venue({ province });
      const read = await run((tx) => store.readHolidays(tx, cfg, ...year));
      expect(read).toEqual({
        facts: [],
        coverage: [
          {
            year: 2026,
            country: "ZZ",
            provinceCode: null,
            regionCode: null,
            nationalRegional: "unknown_region",
            local: "address_unresolved",
            dataVersion: null,
            sourceIds: [],
          },
        ],
        sources: [],
      });
      expect(
        await refusal(() =>
          run((tx) => store.saveLocalHoliday(tx, cfg, null, local("2026-03-19"))),
        ),
      ).toMatchObject({ code: "holiday.invalid", params: { field: "geography" } });
      expect(
        await refusal(() => run((tx) => store.saveHolidayArea(tx, cfg, { areaKey: null }))),
      ).toMatchObject({ code: "holiday.invalid", params: { field: "geography" } });
      expect(await stored()).toEqual({ geographies: [], entries: [] });
    });

  it("reads a country with no installed pack as unsupported, guessing nothing", async () => {
    const cfg = await venue({ country: "QQ" });
    const read = await run((tx) => store.readHolidays(tx, cfg, ...year));
    expect(read).toEqual({
      facts: [],
      coverage: [
        {
          year: 2026,
          country: "QQ",
          provinceCode: null,
          regionCode: null,
          nationalRegional: "unsupported_country",
          local: "address_unresolved",
          dataVersion: null,
          sourceIds: [],
        },
      ],
      sources: [],
    });
    const model = await run((tx) => store.readLocalHolidayModel(tx, cfg));
    expect(model).toMatchObject({
      localEntryLimit: 0,
      venue: { country: "QQ", provinceCode: null },
    });
    expect(
      await refusal(() => run((tx) => store.saveLocalHoliday(tx, cfg, null, local("2026-03-19")))),
    ).toMatchObject({ code: "holiday.invalid", params: { field: "geography" } });
  });

  it("guesses nothing when the database has no taxpayer row or no such venue", async () => {
    const cfg = await venue();
    await run((tx) => tx.delete(tenants));
    const unknown = { locationId: locationId(randomUUID()) };
    for (const scope of [cfg, unknown]) {
      const read = await run((tx) => store.readHolidays(tx, scope, ...year));
      expect(read).toEqual({
        facts: [],
        coverage: [
          {
            year: 2026,
            country: "",
            provinceCode: null,
            regionCode: null,
            nationalRegional: "unsupported_country",
            local: "address_unresolved",
            dataVersion: null,
            sourceIds: [],
          },
        ],
        sources: [],
      });
    }
    await run((tx) => setCountry(tx, "ZZ"));
    expect(await run((tx) => store.readLocalHolidayModel(tx, unknown))).toEqual({
      venue: { country: "ZZ", provinceCode: null, city: null },
      localEntryLimit: 1,
      areaOptions: [],
      areaRequired: false,
      geographies: [],
      entries: [],
    });
  });

  it("keeps local entries for a known province whose region is unknown", async () => {
    const cfg = await venue({ province: "Lostshire" });
    const saved = await run((tx) => store.saveLocalHoliday(tx, cfg, null, local("2026-03-19")));
    const read = await run((tx) => store.readHolidays(tx, cfg, ...year));
    expect(read.facts.map(({ id }) => id)).toEqual([`local:${saved.id}`]);
    expect(read.coverage).toMatchObject([
      {
        provinceCode: "40",
        regionCode: null,
        nationalRegional: "unknown_region",
        local: "owner_entered",
        sourceIds: [`owner:${saved.geographyId}`],
      },
    ]);
  });

  it("returns no local facts for a matching geography once its country has no holiday capability", async () => {
    const supported = { ...syntheticPack(3), countryCode: "ZY" };
    const before = createHolidayStore((country) => (country === "ZY" ? supported : undefined));
    const cfg = await venue({ country: "ZY" });
    const saved = await run((tx) => before.saveLocalHoliday(tx, cfg, null, local("2026-03-19")));
    const read = await run((tx) => store.readHolidays(tx, cfg, "2026-01-01", "2026-12-31"));
    expect(read).toEqual({
      facts: [],
      coverage: [
        {
          year: 2026,
          country: "ZY",
          provinceCode: "10",
          regionCode: null,
          nationalRegional: "unsupported_country",
          local: "unsupported_country",
          dataVersion: null,
          sourceIds: [],
        },
      ],
      sources: [],
    });
    const model = await run((tx) => store.readLocalHolidayModel(tx, cfg));
    expect(model.geographies).toMatchObject([{ id: saved.geographyId, matchesVenue: true }]);
  });

  it("refuses a pack without capability before looking at the values", async () => {
    const cfg = await venue({ country: "ZY" });
    const cases: [unknown, Record<string, unknown>][] = [
      [null, { limit: 0 }],
      [{ date: "2026-02-30", name: "Fiesta" }, { limit: 0 }],
      [
        { date: "2026-03-19", name: "   " },
        { limit: 0, year: 2026 },
      ],
      [
        { date: "2026-03-19", name: "x".repeat(201) },
        { limit: 0, year: 2026 },
      ],
    ];
    for (const [input, params] of cases) {
      const refused = await refusal(() =>
        run((tx) => store.saveLocalHoliday(tx, cfg, null, input as LocalHolidayInput)),
      );
      expect(refused).toMatchObject({ code: "holiday.local_limit" });
      expect(refused.params).toEqual(params);
    }
    expect(await stored()).toEqual({ geographies: [], entries: [] });
  });

  it("refuses every local save for a resolved address whose pack has no holiday capability", async () => {
    const cfg = await venue({ country: "ZY" });
    const read = await run((tx) => store.readHolidays(tx, cfg, ...year));
    expect(read).toEqual({
      facts: [],
      coverage: [
        {
          year: 2026,
          country: "ZY",
          provinceCode: "10",
          regionCode: null,
          nationalRegional: "unsupported_country",
          local: "unsupported_country",
          dataVersion: null,
          sourceIds: [],
        },
      ],
      sources: [],
    });
    const model = await run((tx) => store.readLocalHolidayModel(tx, cfg));
    expect(model).toMatchObject({ localEntryLimit: 0, areaOptions: [], areaRequired: false });
    expect(
      await refusal(() => run((tx) => store.saveLocalHoliday(tx, cfg, null, local("2026-03-19")))),
    ).toMatchObject({ code: "holiday.local_limit", params: { limit: 0, year: 2026 } });
    expect(
      await refusal(() => run((tx) => store.saveHolidayArea(tx, cfg, { areaKey: null }))),
    ).toMatchObject({ code: "holiday.invalid", params: { field: "areaKey" } });
    expect(await stored()).toEqual({ geographies: [], entries: [] });
  });
});

describe("the local allowance", () => {
  for (const limit of [1, 3])
    it(`allows exactly ${limit} per year from a pack that says ${limit}`, async () => {
      const limited = storeWith(limit);
      const cfg = await venue();
      const dates = ["2026-02-02", "2026-02-03", "2026-02-04"].slice(0, limit);
      for (const date of dates)
        await run((tx) => limited.saveLocalHoliday(tx, cfg, null, local(date)));
      const before = await stored();
      expect(
        await refusal(() =>
          run((tx) => limited.saveLocalHoliday(tx, cfg, null, local("2026-12-31"))),
        ),
      ).toMatchObject({ code: "holiday.local_limit", params: { limit, year: 2026 } });
      expect(await stored()).toEqual(before);

      const next: LocalHoliday[] = [];
      for (const date of ["2027-02-02", "2027-02-03", "2027-02-04"].slice(0, limit))
        next.push(await run((tx) => limited.saveLocalHoliday(tx, cfg, null, local(date))));
      const full = await stored();
      expect(
        await refusal(() =>
          run((tx) => limited.saveLocalHoliday(tx, cfg, next[0]!.id, local("2026-06-06"))),
        ),
      ).toMatchObject({ code: "holiday.local_limit", params: { limit, year: 2026 } });
      expect(await stored()).toEqual(full);
      // Moving within its own year never counts the entry against itself.
      const moved = await run((tx) =>
        limited.saveLocalHoliday(tx, cfg, next[0]!.id, local("2027-11-11", "Renamed")),
      );
      expect(moved).toEqual({
        id: next[0]!.id,
        geographyId: next[0]!.geographyId,
        date: "2027-11-11",
        name: "Renamed",
      });
    });

  it("lets a Spanish venue enter the two days Spain's capability allows, and no third", async () => {
    const spain = getCountryPack("ES")!.holidayCalendar!;
    expect(spain.localEntryLimit).toBe(2);
    const cfg = await venue({ country: "ES", province: "Sevilla", city: "Sevilla" });
    await run((tx) => packageIndex.saveLocalHoliday(tx, cfg, null, local("2026-05-30")));
    await run((tx) => packageIndex.saveLocalHoliday(tx, cfg, null, local("2026-06-04")));
    expect(
      await refusal(() =>
        run((tx) => packageIndex.saveLocalHoliday(tx, cfg, null, local("2026-09-08"))),
      ),
    ).toMatchObject({ code: "holiday.local_limit", params: { limit: 2, year: 2026 } });
    const model = await run((tx) => packageIndex.readLocalHolidayModel(tx, cfg));
    expect(model).toMatchObject({
      venue: { country: "ES", provinceCode: "41", city: "Sevilla" },
      localEntryLimit: 2,
    });
  });

  it("renames an entry on its own date without colliding with itself", async () => {
    const cfg = await venue();
    const saved = await run((tx) => store.saveLocalHoliday(tx, cfg, null, local("2026-03-19")));
    const renamed = await run((tx) =>
      store.saveLocalHoliday(tx, cfg, saved.id, local("2026-03-19", "San José")),
    );
    expect(renamed).toEqual({ ...saved, name: "San José" });
    expect((await stored()).entries).toMatchObject([{ id: saved.id, name: "San José" }]);
  });

  it("refuses a second entry on a taken date, whatever its name", async () => {
    const three = storeWith(3);
    const cfg = await venue();
    await run((tx) => three.saveLocalHoliday(tx, cfg, null, local("2026-03-19", "One")));
    const before = await stored();
    expect(
      await refusal(() =>
        run((tx) => three.saveLocalHoliday(tx, cfg, null, local("2026-03-19", "Two"))),
      ),
    ).toMatchObject({ code: "holiday.date_taken", params: { date: "2026-03-19" } });
    expect(await stored()).toEqual(before);
  });
});

describe("refused values", () => {
  it("names the refused field and writes nothing", async () => {
    const cfg = await venue();
    const cases: [unknown, string][] = [
      [null, "input"],
      [[], "input"],
      ["2026-03-19", "input"],
      [{ name: "Fiesta" }, "date"],
      [{ date: null, name: "Fiesta" }, "date"],
      [{ date: "2026-02-30", name: "Fiesta" }, "date"],
      [{ date: "2026-3-19", name: "Fiesta" }, "date"],
      [{ date: "2026-03-19" }, "name"],
      [{ date: "2026-03-19", name: null }, "name"],
      [{ date: "2026-03-19", name: ["Fiesta"] }, "name"],
      [{ date: "2026-03-19", name: "   " }, "name"],
      [{ date: "2026-03-19", name: "x".repeat(201) }, "name"],
    ];
    for (const [input, field] of cases)
      expect(
        await refusal(() =>
          run((tx) => store.saveLocalHoliday(tx, cfg, null, input as LocalHolidayInput)),
        ),
      ).toMatchObject({ code: "holiday.invalid", params: { field } });
    expect(await stored()).toEqual({ geographies: [], entries: [] });
    const longest = await run((tx) =>
      store.saveLocalHoliday(tx, cfg, null, local("2026-03-19", ` ${"x".repeat(200)} `)),
    );
    expect(longest.name).toBe("x".repeat(200));
  });

  it("answers not found for an unknown id and for another venue's id", async () => {
    const cfg = await venue();
    const other = await venue();
    const theirs = await run((tx) => store.saveLocalHoliday(tx, other, null, local("2026-03-19")));
    const before = await stored();
    for (const id of [randomUUID(), theirs.id, "not-an-id"]) {
      expect(
        await refusal(() => run((tx) => store.saveLocalHoliday(tx, cfg, id, local("2026-04-01")))),
      ).toMatchObject({ code: "holiday.not_found", params: { id } });
      expect(await refusal(() => run((tx) => store.deleteLocalHoliday(tx, cfg, id)))).toMatchObject(
        { code: "holiday.not_found", params: { id } },
      );
    }
    expect(
      await refusal(() =>
        run((tx) => store.deleteRetainedHolidayGeography(tx, cfg, theirs.geographyId)),
      ),
    ).toMatchObject({ code: "holiday.not_found", params: { id: theirs.geographyId } });
    expect(await stored()).toEqual(before);
  });
});

describe("a venue whose address changes", () => {
  it("hides the old geography's entries and restores the same ids on return, writing nothing on read", async () => {
    const three = storeWith(3);
    const cfg = await venue({ city: "Villa Real" });
    const entry = await run((tx) => three.saveLocalHoliday(tx, cfg, null, local("2026-03-19")));
    for (const change of [
      { city: "Puerto Nuevo" },
      { province: "Southshire" },
      { country: "ZY" },
    ] as Address[]) {
      await moveTo(cfg, change);
      const before = await stored();
      const model = await run((tx) => three.readLocalHolidayModel(tx, cfg));
      const read = await run((tx) => three.readHolidays(tx, cfg, "2026-01-01", "2026-12-31"));
      expect(model.entries).toEqual([]);
      expect(model.geographies).toEqual([
        {
          id: entry.geographyId,
          country: "ZZ",
          provinceCode: "10",
          city: "Villa Real",
          areaKey: null,
          matchesVenue: false,
        },
      ]);
      expect(read.facts.filter(({ scope }) => scope === "local")).toEqual([]);
      expect(read.sources.filter(({ kind }) => kind === "owner")).toEqual([]);
      expect(await stored()).toEqual(before);
      await moveTo(cfg, { country: "ZZ", province: "Northshire", city: "villa real" });
      const back = await run((tx) => three.readLocalHolidayModel(tx, cfg));
      expect(back.entries).toEqual([entry]);
      expect(back.geographies).toMatchObject([{ id: entry.geographyId, matchesVenue: true }]);
      expect(await stored()).toEqual(before);
      await moveTo(cfg, { city: "Villa Real" });
    }
  });

  it("refuses to move a retained entry to the new address, and an unresolved address before that", async () => {
    const cfg = await venue();
    const entry = await run((tx) => store.saveLocalHoliday(tx, cfg, null, local("2026-03-19")));
    await moveTo(cfg, { city: "Puerto Nuevo" });
    const before = await stored();
    expect(
      await refusal(() =>
        run((tx) => store.saveLocalHoliday(tx, cfg, entry.id, local("2026-03-20"))),
      ),
    ).toMatchObject({ code: "holiday.invalid", params: { field: "id" } });
    await moveTo(cfg, { city: "Villa Real", province: null });
    expect(
      await refusal(() =>
        run((tx) => store.saveLocalHoliday(tx, cfg, entry.id, local("2026-03-20"))),
      ),
    ).toMatchObject({ code: "holiday.invalid", params: { field: "geography" } });
    expect(await stored()).toEqual(before);
  });

  it("deletes a retained entry and a retained geography, but never the current one", async () => {
    const three = storeWith(3);
    const cfg = await venue({ city: "Villa Real" });
    const old = await run((tx) => three.saveLocalHoliday(tx, cfg, null, local("2026-03-19")));
    const older = await run((tx) => three.saveLocalHoliday(tx, cfg, null, local("2026-03-20")));
    await moveTo(cfg, { city: "Puerto Nuevo" });
    const current = await run((tx) => three.saveLocalHoliday(tx, cfg, null, local("2026-04-01")));
    const elsewhere = await venue();
    const theirs = await run((tx) =>
      three.saveLocalHoliday(tx, elsewhere, null, local("2026-03-19")),
    );

    await run((tx) => three.deleteLocalHoliday(tx, cfg, older.id));
    expect((await stored()).entries.map(({ id }) => id).sort()).toEqual(
      [old.id, current.id, theirs.id].sort(),
    );
    const before = await stored();
    expect(
      await refusal(() =>
        run((tx) => three.deleteRetainedHolidayGeography(tx, cfg, current.geographyId)),
      ),
    ).toMatchObject({
      code: "holiday.geography_current",
      params: { geographyId: current.geographyId },
    });
    expect(await stored()).toEqual(before);

    await run((tx) => three.deleteRetainedHolidayGeography(tx, cfg, old.geographyId));
    const after = await stored();
    expect(after.geographies.map(({ id }) => id).sort()).toEqual(
      [current.geographyId, theirs.geographyId].sort(),
    );
    expect(after.entries.map(({ id }) => id).sort()).toEqual([current.id, theirs.id].sort());
  });

  it("deletes a retained entry after the venue's country lost its capability", async () => {
    const cfg = await venue();
    const entry = await run((tx) => store.saveLocalHoliday(tx, cfg, null, local("2026-03-19")));
    await moveTo(cfg, { country: "ZY" });
    await run((tx) => store.deleteLocalHoliday(tx, cfg, entry.id));
    expect((await stored()).entries).toEqual([]);
  });
});

describe("territorial areas", () => {
  const year = ["2026-01-01", "2026-12-31"] as const;

  it("asks for an area only where the data needs one, and returns only certain facts until then", async () => {
    const cfg = await venue({ province: "Isleshire" });
    const model = await run((tx) => store.readLocalHolidayModel(tx, cfg));
    expect(model).toMatchObject({
      areaOptions: [
        { key: "isle-a", name: "Isle A" },
        { key: "isle-b", name: "Isle B" },
      ],
      areaRequired: true,
    });
    const read = await run((tx) => store.readHolidays(tx, cfg, ...year));
    expect(read.facts.map(({ id }) => id)).toEqual(["shipped:new-year"]);
    expect(read.coverage).toMatchObject([
      { provinceCode: "30", regionCode: "R3", nationalRegional: "area_required" },
    ]);
  });

  it("stores the choice on a geography with no entries, keeps it across a move away and back, and clears it with null", async () => {
    const cfg = await venue({ province: "Isleshire" });
    const specials = await run((tx) => tx.select().from(specialDates));
    const geography = (await run((tx) => store.saveHolidayArea(tx, cfg, { areaKey: "isle-a" })))!;
    expect(geography).toEqual({
      id: geography.id,
      country: "ZZ",
      provinceCode: "30",
      city: "Villa Real",
      areaKey: "isle-a",
      matchesVenue: true,
    });
    expect((await stored()).entries).toEqual([]);
    const chosen = await run((tx) => store.readHolidays(tx, cfg, ...year));
    expect(chosen.facts.map(({ id }) => id)).toEqual(["shipped:new-year", "shipped:isle-a-day"]);
    expect(chosen.coverage).toMatchObject([{ nationalRegional: "complete" }]);

    await moveTo(cfg, { city: "Puerto Nuevo" });
    expect(await run((tx) => store.readLocalHolidayModel(tx, cfg))).toMatchObject({
      areaRequired: true,
      geographies: [{ id: geography.id, areaKey: "isle-a", matchesVenue: false }],
    });
    await moveTo(cfg, { city: "Villa Real" });
    expect(await run((tx) => store.readLocalHolidayModel(tx, cfg))).toMatchObject({
      areaRequired: false,
    });

    const again = (await run((tx) => store.saveHolidayArea(tx, cfg, { areaKey: "isle-b" })))!;
    expect(again.id).toBe(geography.id);
    const cleared = await run((tx) => store.saveHolidayArea(tx, cfg, { areaKey: null }));
    expect(cleared).toMatchObject({ id: geography.id, areaKey: null });
    expect(await run((tx) => store.readLocalHolidayModel(tx, cfg))).toMatchObject({
      areaRequired: true,
    });
    expect(await run((tx) => tx.select().from(specialDates))).toEqual(specials);
  });

  it("offers the area choice from the province alone while the city is missing, but cannot save it", async () => {
    const cfg = await venue({ province: "Isleshire", city: null });
    expect(await run((tx) => store.readLocalHolidayModel(tx, cfg))).toMatchObject({
      venue: { provinceCode: "30", city: null },
      areaOptions: [
        { key: "isle-a", name: "Isle A" },
        { key: "isle-b", name: "Isle B" },
      ],
      areaRequired: true,
    });
    const read = await run((tx) => store.readHolidays(tx, cfg, ...year));
    expect(read.coverage).toMatchObject([
      { nationalRegional: "area_required", local: "address_unresolved" },
    ]);
    expect(
      await refusal(() => run((tx) => store.saveHolidayArea(tx, cfg, { areaKey: "isle-a" }))),
    ).toMatchObject({ code: "holiday.invalid", params: { field: "geography" } });
    expect(await stored()).toEqual({ geographies: [], entries: [] });
  });

  it("clears an area with no geography row by writing nothing", async () => {
    const cfg = await venue({ province: "Isleshire" });
    expect(await run((tx) => store.saveHolidayArea(tx, cfg, { areaKey: null }))).toBeNull();
    expect(await stored()).toEqual({ geographies: [], entries: [] });
  });

  it("refuses an area nobody sourced, an omitted key and a wrong type", async () => {
    const isles = await venue({ province: "Isleshire" });
    const north = await venue();
    const cases: [VenueScope, unknown][] = [
      [isles, { areaKey: "isle-c" }],
      [isles, { areaKey: 3 }],
      [isles, { areaKey: ["isle-a"] }],
      [isles, {}],
      [isles, null],
      [north, { areaKey: "isle-a" }],
      [north, { areaKey: null }],
    ];
    for (const [cfg, input] of cases)
      expect(
        await refusal(() =>
          run((tx) => store.saveHolidayArea(tx, cfg, input as { areaKey: string | null })),
        ),
      ).toMatchObject({ code: "holiday.invalid", params: { field: "areaKey" } });
    expect(await stored()).toEqual({ geographies: [], entries: [] });
  });

  it("offers the Arán choice for a Spanish venue in Lleida and none in Sevilla", async () => {
    const lleida = await venue({ country: "ES", province: "Lérida", city: "Vielha" });
    const options = (await run((tx) => packageIndex.readLocalHolidayModel(tx, lleida))).areaOptions;
    expect(options.map(({ key }) => key)).toEqual(["aran", "lleida-except-aran"]);
    await moveTo(lleida, { province: "Sevilla" });
    expect((await run((tx) => packageIndex.readLocalHolidayModel(tx, lleida))).areaOptions).toEqual(
      [],
    );
  });
});

describe("transactions and other callers", () => {
  it("reads its own write before commit, and a rollback keeps neither the entry nor the geography", async () => {
    const cfg = await venue({ province: "Isleshire" });
    const rolledBack = new Error("roll back");
    await expect(
      run(async (tx) => {
        const saved = await store.saveLocalHoliday(tx, cfg, null, local("2026-03-19"));
        await store.saveHolidayArea(tx, cfg, { areaKey: "isle-a" });
        const read = await store.readHolidays(tx, cfg, "2026-03-19", "2026-07-01");
        expect(read.facts.map(({ id }) => id)).toEqual([`local:${saved.id}`, "shipped:isle-a-day"]);
        const model = await store.readLocalHolidayModel(tx, cfg);
        expect(model).toMatchObject({
          areaRequired: false,
          geographies: [{ id: saved.geographyId, areaKey: "isle-a", matchesVenue: true }],
        });
        throw rolledBack;
      }),
    ).rejects.toBe(rolledBack);
    expect(await stored()).toEqual({ geographies: [], entries: [] });
  });

  it("gives a calendar reader the same facts, unaffected by special dates", async () => {
    const cfg = await venue();
    const saved = await run((tx) => store.saveLocalHoliday(tx, cfg, null, local("2026-05-01")));
    const read = await run((tx) => store.readHolidays(tx, cfg, "2026-01-01", "2026-12-31"));
    expect(await run((tx) => store.readHolidayFacts(tx, cfg, "2026-01-01", "2026-12-31"))).toEqual(
      read.facts,
    );
    await run((tx) =>
      saveSpecialDate(
        tx,
        cfg,
        null,
        { date: "2026-05-01", name: "Labour", colour: "red", closeWholeVenue: true, cells: [] },
        new Date("2026-04-01T10:00:00Z"),
      ),
    );
    const after = await run((tx) => store.readHolidays(tx, cfg, "2026-01-01", "2026-12-31"));
    expect(after).toEqual(read);
    expect(after.facts.map(({ id }) => id)).toContain(`local:${saved.id}`);
  });

  it("reads a data revision's facts, version and allowance, leaving every stored row as it was", async () => {
    const cfg = await venue();
    const two = storeWith(2);
    const entries = await run(async (tx) => [
      await two.saveLocalHoliday(tx, cfg, null, local("2026-03-19")),
      await two.saveLocalHoliday(tx, cfg, null, local("2026-09-08")),
    ]);
    await run((tx) =>
      saveSpecialDate(
        tx,
        cfg,
        null,
        { date: "2026-01-01", name: "New Year", colour: "red", closeWholeVenue: true, cells: [] },
        new Date("2025-12-01T10:00:00Z"),
      ),
    );
    const rows = async () => ({
      stored: await stored(),
      specialDates: await run((tx) => tx.select().from(specialDates).orderBy(asc(specialDates.id))),
    });
    const before = await rows();

    // The revision renames New Year, drops the North days and allows one local day a year.
    const revised = createHolidayStore((country) => {
      if (country !== "ZZ") return undefined;
      const all = ["R1", "R2", "R3"];
      return {
        ...syntheticPack(1),
        holidayCalendar: createHolidayCalendar({
          localEntryLimit: 1,
          sources: [
            {
              id: "ZZ-ANNEX-2",
              title: "Invented corrected annex",
              url: "https://example.test/annex-2",
              sha256: "b".repeat(64),
            },
          ],
          provinceRegions: { "10": "R1", "20": "R2", "30": "R3" },
          areas: [{ key: "isle-a", name: "Isle A", provinces: ["30"] }],
          years: [
            {
              year: 2026,
              dataVersion: "ZZ-2026.2",
              sourceIds: ["ZZ-ANNEX-2"],
              rows: [
                {
                  key: "new-year",
                  date: "2026-01-01",
                  name: "New Year's Day",
                  scope: "national",
                  regions: all,
                  sourceId: "ZZ-ANNEX-2",
                },
                {
                  key: "isle-a-day",
                  date: "2026-07-01",
                  name: "Isle A day",
                  scope: "regional",
                  regions: ["R3"],
                  onlyAreas: ["isle-a"],
                  sourceId: "ZZ-ANNEX-2",
                },
              ],
            },
          ],
        }),
      };
    });
    const read = await run((tx) => revised.readHolidays(tx, cfg, "2026-01-01", "2026-12-31"));
    expect(read.facts.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "shipped:new-year", name: "New Year's Day" },
      { id: `local:${entries[0]!.id}`, name: "Fiesta 2026-03-19" },
      { id: `local:${entries[1]!.id}`, name: "Fiesta 2026-09-08" },
    ]);
    expect(read.coverage).toEqual([
      expect.objectContaining({
        dataVersion: "ZZ-2026.2",
        sourceIds: ["ZZ-ANNEX-2", `owner:${entries[0]!.geographyId}`],
      }),
    ]);
    const model = await run((tx) => revised.readLocalHolidayModel(tx, cfg));
    expect(model.localEntryLimit).toBe(1);
    expect(model.entries).toEqual(entries);
    const refused = await refusal(() =>
      run((tx) => revised.saveLocalHoliday(tx, cfg, null, local("2026-10-12"))),
    );
    expect(refused).toMatchObject({
      code: "holiday.local_limit",
      params: { limit: 1, year: 2026 },
    });
    expect(await rows()).toEqual(before);
    expect(before.specialDates.map(({ name }) => name)).toEqual(["New Year"]);
  });

  it("is exported from the package index, bound to the installed country packs", () => {
    expect(packageIndex.readHolidays).toBe(packageReadHolidays);
    expect(packageIndex.readHolidayFacts).toBe(packageReadHolidayFacts);
    for (const name of [
      "readLocalHolidayModel",
      "saveHolidayArea",
      "saveLocalHoliday",
      "deleteLocalHoliday",
      "deleteRetainedHolidayGeography",
    ] as const)
      expect(packageIndex[name]).toBeTypeOf("function");
  });
});

describe("no network", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it("reads Spain's shipped facts and a venue's entries with fetch unavailable", async () => {
    const fetch = vi.fn(() => {
      throw new Error("no network on a holiday read");
    });
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    const cfg = await venue({ country: "ES", province: "Sevilla", city: "Sevilla" });
    const saved = await run((tx) =>
      packageIndex.saveLocalHoliday(tx, cfg, null, local("2026-06-04", "Corpus Christi")),
    );
    const read = await run((tx) => packageIndex.readHolidays(tx, cfg, "2026-01-01", "2026-12-31"));
    expect(read.coverage).toMatchObject([
      { country: "ES", provinceCode: "41", regionCode: "01", nationalRegional: "complete" },
    ]);
    expect(read.facts.some(({ id }) => id === "shipped:BOE-A-2025-21667:0101")).toBe(true);
    expect(read.facts.some(({ id }) => id === `local:${saved.id}`)).toBe(true);
    expect(read.sources.map(({ id }) => id)).toEqual([
      "BOE-A-2025-21667",
      `owner:${saved.geographyId}`,
    ]);
    await run((tx) => packageIndex.readLocalHolidayModel(tx, cfg));
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("the local holiday name rule", () => {
  it("trims, and counts code points up to the limit", () => {
    expect(localHolidayName("  Fiesta  ")).toBe("Fiesta");
    expect(localHolidayName("😀".repeat(LOCAL_HOLIDAY_NAME_MAX))).toBe(
      "😀".repeat(LOCAL_HOLIDAY_NAME_MAX),
    );
    for (const refused of [
      "😀".repeat(LOCAL_HOLIDAY_NAME_MAX + 1),
      "e\u0301".repeat(100) + "x",
      "   ",
      null,
      ["Fiesta"],
    ])
      expect(localHolidayName(refused)).toBeNull();
  });
});

describe("storage", () => {
  it("refuses a malformed date and a blank name in the database itself, and an impossible date in the writer", async () => {
    const cfg = await venue();
    const entry = await run((tx) => store.saveLocalHoliday(tx, cfg, null, local("2026-03-19")));
    // The CHECK reads only the date's shape, so an impossible date is the writer's to refuse.
    expect(
      await refusal(() =>
        run((tx) => store.saveLocalHoliday(tx, cfg, entry.id, local("2026-02-30"))),
      ),
    ).toMatchObject({ code: "holiday.invalid", params: { field: "date" } });
    for (const [statement, constraint] of [
      [sql`update local_holidays set date = '2026-3-19' where id = ${entry.id}`, "date"],
      [sql`update local_holidays set name = '  ' where id = ${entry.id}`, "name"],
      [sql`update holiday_geographies set city_key = '' where id = ${entry.geographyId}`, "city"],
    ] as const)
      await expect((async () => db.execute(statement))()).rejects.toThrow(
        new RegExp(
          `CHECK constraint failed: (local_holidays|holiday_geographies)_${constraint}_ck`,
        ),
      );
    expect((await stored()).entries).toMatchObject([{ date: "2026-03-19" }]);
  });
});
