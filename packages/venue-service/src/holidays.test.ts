import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { createHolidayCalendar, type CountryPack } from "@waitron/country";
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
import {
  createHolidayStore,
  readHolidayFacts as packageReadHolidayFacts,
  readHolidays as packageReadHolidays,
} from "./holidays.js";
import { saveSpecialDate } from "./hours.js";
import * as packageIndex from "./index.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import type { VenueScope } from "./operations.js";
import { holidayGeographies } from "./schema/holidays.js";
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

async function seedRetainedGeographyWithWorkingDay(
  tx: Transaction,
  cfg: VenueScope,
  date: string,
  name: string,
) {
  await tx
    .insert(holidayGeographies)
    .values({
      locationId: cfg.locationId,
      country: "ZZ",
      provinceCode: "10",
      city: "Villa Real",
      cityKey: "villa real",
    })
    .returning();
  await tx
    .insert(specialDates)
    .values({ locationId: cfg.locationId, date, name, kind: "working_day" });
}

async function stored() {
  return run(async (tx) => ({
    geographies: await tx.select().from(holidayGeographies).orderBy(asc(holidayGeographies.id)),
    entries: await tx.select().from(specialDates).orderBy(asc(specialDates.id)),
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
    const model = await run((tx) => store.readHolidayAreaModel(tx, cfg));
    expect(model).toEqual({
      venue: { country: "ZZ", provinceCode: "10", city: "Villa Real" },
      readiness: "ready",
      localHolidaysPerYear: 1,
      areaOptions: [],
      areaRequired: false,
      chosen: null,
    });
  });

  it("keeps a working named day and retained geography out of holiday facts, coverage and sources", async () => {
    const cfg = await venue();
    await run((tx) => seedRetainedGeographyWithWorkingDay(tx, cfg, "2026-01-01", "Fiesta mayor"));
    const read = await run((tx) => store.readHolidays(tx, cfg, "2026-01-01", "2026-01-01"));
    expect(read.facts).toEqual([
      {
        id: "shipped:new-year",
        date: "2026-01-01",
        name: "New Year",
        scope: "national",
        sourceId: "ZZ-ANNEX",
      },
    ]);
    expect(read.coverage).toMatchObject([{ local: "none_entered", sourceIds: ["ZZ-ANNEX"] }]);
    expect(read.sources).toEqual([
      {
        id: "ZZ-ANNEX",
        kind: "official",
        title: "Invented annex",
        url: "https://example.test/annex",
        sha256: SHA,
      },
    ]);
  });

  it("gives each civil year its own coverage, counting entries in the whole year", async () => {
    const cfg = await venue();
    await run((tx) =>
      tx.insert(specialDates).values({
        locationId: cfg.locationId,
        date: "2026-03-19",
        name: "Our holiday",
        kind: "holiday",
      }),
    );
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
        sourceIds: ["ZZ-ANNEX", `owner:named-days:${cfg.locationId}`],
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
    expect(read.sources.map(({ id }) => id)).toEqual([
      "ZZ-ANNEX",
      `owner:named-days:${cfg.locationId}`,
    ]);
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
    const model = await run((tx) => store.readHolidayAreaModel(tx, cfg));
    expect(model.venue).toEqual({ country: "ZZ", provinceCode: "10", city: null });
    expect(model.localHolidaysPerYear).toBe(1);
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
    const model = await run((tx) => store.readHolidayAreaModel(tx, cfg));
    expect(model).toMatchObject({
      localHolidaysPerYear: 0,
      venue: { country: "QQ", provinceCode: null },
    });
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
    expect(await run((tx) => store.readHolidayAreaModel(tx, unknown))).toEqual({
      venue: { country: "ZZ", provinceCode: null, city: null },
      readiness: "unresolved_address",
      localHolidaysPerYear: 1,
      areaOptions: [],
      areaRequired: false,
      chosen: null,
    });
  });

  it("counts own named holidays for a known province whose region is unknown", async () => {
    const cfg = await venue({ province: "Lostshire" });
    await run((tx) =>
      tx.insert(specialDates).values({
        locationId: cfg.locationId,
        date: "2026-03-19",
        name: "Our holiday",
        kind: "holiday",
      }),
    );
    const read = await run((tx) => store.readHolidays(tx, cfg, ...year));
    expect(read.facts).toEqual([]);
    expect(read.coverage).toMatchObject([
      {
        provinceCode: "40",
        regionCode: null,
        nationalRegional: "unknown_region",
        local: "owner_entered",
        sourceIds: [`owner:named-days:${cfg.locationId}`],
      },
    ]);
  });

  it("returns no local facts for a matching geography once its country has no holiday capability", async () => {
    const cfg = await venue({ country: "ZY" });
    await run((tx) => seedRetainedGeographyWithWorkingDay(tx, cfg, "2026-03-19", "Retired"));
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
    const model = await run((tx) => store.readHolidayAreaModel(tx, cfg));
    expect(model.chosen).toBeNull();
  });
});

describe("territorial areas", () => {
  const year = ["2026-01-01", "2026-12-31"] as const;

  it("asks for an area only where the data needs one, and returns only certain facts until then", async () => {
    const cfg = await venue({ province: "Isleshire" });
    const model = await run((tx) => store.readHolidayAreaModel(tx, cfg));
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
    expect(await run((tx) => store.readHolidayAreaModel(tx, cfg))).toMatchObject({
      areaRequired: true,
      chosen: null,
    });
    await moveTo(cfg, { city: "Villa Real" });
    expect(await run((tx) => store.readHolidayAreaModel(tx, cfg))).toMatchObject({
      areaRequired: false,
    });

    const again = (await run((tx) => store.saveHolidayArea(tx, cfg, { areaKey: "isle-b" })))!;
    expect(again.id).toBe(geography.id);
    const cleared = await run((tx) => store.saveHolidayArea(tx, cfg, { areaKey: null }));
    expect(cleared).toMatchObject({ id: geography.id, areaKey: null });
    expect(await run((tx) => store.readHolidayAreaModel(tx, cfg))).toMatchObject({
      areaRequired: true,
    });
    expect(await run((tx) => tx.select().from(specialDates))).toEqual(specials);
  });

  it("offers the area choice from the province alone while the city is missing, but cannot save it", async () => {
    const cfg = await venue({ province: "Isleshire", city: null });
    expect(await run((tx) => store.readHolidayAreaModel(tx, cfg))).toMatchObject({
      venue: { provinceCode: "30", city: null },
      readiness: "missing_city",
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
    const options = (await run((tx) => packageIndex.readHolidayAreaModel(tx, lleida))).areaOptions;
    expect(options.map(({ key }) => key)).toEqual(["aran", "lleida-except-aran"]);
    await moveTo(lleida, { province: "Sevilla" });
    expect((await run((tx) => packageIndex.readHolidayAreaModel(tx, lleida))).areaOptions).toEqual(
      [],
    );
  });
});

describe("transactions and other callers", () => {
  it("reads its own area write before commit and a rollback keeps no geography", async () => {
    const cfg = await venue({ province: "Isleshire" });
    const rolledBack = new Error("roll back");
    await expect(
      run(async (tx) => {
        await store.saveHolidayArea(tx, cfg, { areaKey: "isle-a" });
        const read = await store.readHolidays(tx, cfg, "2026-03-19", "2026-07-01");
        expect(read.facts.map(({ id }) => id)).toEqual(["shipped:isle-a-day"]);
        const model = await store.readHolidayAreaModel(tx, cfg);
        expect(model).toMatchObject({
          areaRequired: false,
          chosen: "isle-a",
        });
        throw rolledBack;
      }),
    ).rejects.toBe(rolledBack);
    expect(await stored()).toEqual({ geographies: [], entries: [] });
  });

  it("gives a calendar reader the same facts, unaffected by special dates", async () => {
    const cfg = await venue();
    const read = await run((tx) => store.readHolidays(tx, cfg, "2026-01-01", "2026-12-31"));
    expect(await run((tx) => store.readHolidayFacts(tx, cfg, "2026-01-01", "2026-12-31"))).toEqual(
      read.facts,
    );
    await run((tx) =>
      saveSpecialDate(
        tx,
        cfg,
        null,
        { date: "2026-05-01", name: "Labour", closeWholeVenue: true, cells: [] },
        new Date("2026-04-01T10:00:00Z"),
      ),
    );
    const after = await run((tx) => store.readHolidays(tx, cfg, "2026-01-01", "2026-12-31"));
    expect(after).toEqual(read);
  });

  it("reads a data revision's facts, version and allowance, leaving every stored row as it was", async () => {
    const cfg = await venue();
    await run((tx) =>
      saveSpecialDate(
        tx,
        cfg,
        null,
        { date: "2026-01-01", name: "New Year", closeWholeVenue: true, cells: [] },
        new Date("2025-12-01T10:00:00Z"),
      ),
    );
    const rows = async () => ({
      stored: await stored(),
      specialDates: await run((tx) => tx.select().from(specialDates).orderBy(asc(specialDates.id))),
    });
    const before = await rows();

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
    ]);
    expect(read.coverage).toEqual([
      expect.objectContaining({
        dataVersion: "ZZ-2026.2",
        sourceIds: ["ZZ-ANNEX-2"],
      }),
    ]);
    const model = await run((tx) => revised.readHolidayAreaModel(tx, cfg));
    expect(model.localHolidaysPerYear).toBe(1);
    expect(await rows()).toEqual(before);
    expect(before.specialDates.map(({ name }) => name)).toEqual(["New Year"]);
  });

  it("is exported from the package index, bound to the installed country packs", () => {
    expect(packageIndex.readHolidays).toBe(packageReadHolidays);
    expect(packageIndex.readHolidayFacts).toBe(packageReadHolidayFacts);
    for (const name of ["readHolidayAreaModel", "saveHolidayArea"] as const)
      expect(packageIndex[name]).toBeTypeOf("function");
  });
});

describe("no network", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it("reads Spain's shipped facts with fetch unavailable", async () => {
    const fetch = vi.fn(() => {
      throw new Error("no network on a holiday read");
    });
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    const cfg = await venue({ country: "ES", province: "Sevilla", city: "Sevilla" });
    const read = await run((tx) => packageIndex.readHolidays(tx, cfg, "2026-01-01", "2026-12-31"));
    expect(read.coverage).toMatchObject([
      { country: "ES", provinceCode: "41", regionCode: "01", nationalRegional: "complete" },
    ]);
    expect(read.facts.some(({ id }) => id === "shipped:BOE-A-2025-21667:0101")).toBe(true);
    expect(read.sources.map(({ id }) => id)).toEqual(["BOE-A-2025-21667"]);
    await run((tx) => packageIndex.readHolidayAreaModel(tx, cfg));
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("own named holidays contribute yearly owner coverage", () => {
  it("counts repeats for the whole year without a geography and leaves facts unchanged", async () => {
    const cfg = await venue();
    await run((tx) =>
      tx.insert(specialDates).values({
        locationId: cfg.locationId,
        date: "2026-12-25",
        name: "Town holiday",
        kind: "holiday",
        repeatOn: "12-25",
      }),
    );
    const read = await run((tx) => store.readHolidays(tx, cfg, "2027-01-01", "2027-01-01"));
    expect(read.coverage[0]!.local).toBe("owner_entered");
    expect(read.facts.map(({ name }) => name)).toEqual(["New Year"]);
    expect(
      read.coverage[0]!.sourceIds.every((id) => read.sources.some((source) => source.id === id)),
    ).toBe(true);
    expect(read.sources.filter(({ kind }) => kind === "owner")).toHaveLength(1);
    expect(
      (await run((tx) => store.readHolidays(tx, cfg, "2025-01-01", "2025-01-01"))).coverage[0]!
        .local,
    ).toBe("none_entered");
    expect(
      await run((tx) =>
        tx
          .select()
          .from(holidayGeographies)
          .where(eq(holidayGeographies.locationId, cfg.locationId)),
      ),
    ).toEqual([]);
  });
  it("ignores another venue's own holidays and named working days", async () => {
    const cfg = await venue();
    const other = await venue();
    await run((tx) =>
      tx.insert(specialDates).values([
        {
          locationId: cfg.locationId,
          date: "2026-12-25",
          name: "Party",
          kind: "working_day",
        },
        {
          locationId: other.locationId,
          date: "2026-12-25",
          name: "Foreign holiday",
          kind: "holiday",
        },
      ]),
    );
    expect(
      (await run((tx) => store.readHolidays(tx, cfg, "2026-01-01", "2026-01-01"))).coverage[0]!
        .local,
    ).toBe("none_entered");
  });
});

it("counts own holidays even when the public-holiday address cannot resolve", async () => {
  const cfg = await venue({ country: "XY", province: null, city: null });
  await run((tx) =>
    tx.insert(specialDates).values({
      locationId: cfg.locationId,
      date: "2026-12-25",
      name: "Our holiday",
      kind: "holiday",
    }),
  );
  const read = await run((tx) => store.readHolidays(tx, cfg, "2026-01-01", "2026-01-01"));
  expect(read.coverage[0]).toMatchObject({
    nationalRegional: "unsupported_country",
    local: "owner_entered",
  });
  expect(read.facts).toEqual([]);
});

it("lets a Spanish venue add more own holidays than the informational local number", async () => {
  const cfg = await venue({ country: "ES", province: "Sevilla", city: "Sevilla" });
  for (const date of ["2026-03-19", "2026-06-04", "2026-09-08"])
    await run((tx) =>
      saveSpecialDate(
        tx,
        cfg,
        null,
        {
          date,
          name: `Own ${date}`,
          kind: "holiday",
          ownHours: false,
          repeats: false,
          closeWholeVenue: false,
          cells: [],
        },
        new Date("2026-01-01T12:00:00Z"),
      ),
    );
  expect(
    (
      await run((tx) =>
        tx.select().from(specialDates).where(eq(specialDates.locationId, cfg.locationId)),
      )
    )
      .map(({ date }) => date)
      .sort(),
  ).toEqual(["2026-03-19", "2026-06-04", "2026-09-08"]);
  expect((await run((tx) => store.readHolidayAreaModel(tx, cfg))).localHolidaysPerYear).toBe(0);
  expect((await run((tx) => packageIndex.readHolidayAreaModel(tx, cfg))).localHolidaysPerYear).toBe(
    2,
  );
  expect(
    (await run((tx) => packageIndex.readHolidays(tx, cfg, "2026-12-01", "2026-12-01"))).coverage[0]!
      .local,
  ).toBe("owner_entered");
});

it("reuses a holiday area's geography for an equivalent city spelling", async () => {
  const cfg = await venue({ province: "Isleshire", city: "  Villa   Real  " });
  const saved = (await run((tx) => store.saveHolidayArea(tx, cfg, { areaKey: "isle-a" })))!;
  expect(saved.city).toBe("Villa   Real");
  await moveTo(cfg, { city: "VILLA REAL" });
  expect((await run((tx) => store.readHolidayAreaModel(tx, cfg))).chosen).toBe("isle-a");
  const again = (await run((tx) => store.saveHolidayArea(tx, cfg, { areaKey: "isle-b" })))!;
  expect(again.id).toBe(saved.id);
  expect(
    (await stored()).geographies.filter(({ locationId }) => locationId === cfg.locationId),
  ).toHaveLength(1);
});

it("the retained area writer stores a city trimmed at the address's full length", async () => {
  for (const city of ["  Villa Real  ", "x".repeat(5000)]) {
    const cfg = await venue({ province: "Isleshire", city });
    const saved = (await run((tx) => store.saveHolidayArea(tx, cfg, { areaKey: "isle-a" })))!;
    expect(saved.city).toBe(city.trim());
  }
});

it("the area choice keeps cities with different accents and punctuation apart", async () => {
  const cfg = await venue({ province: "Isleshire", city: "Puerto Ísla" });
  await run((tx) => store.saveHolidayArea(tx, cfg, { areaKey: "isle-a" }));
  for (const city of ["Puerto Isla", "Puerto-Ísla"]) {
    await moveTo(cfg, { city });
    expect((await run((tx) => store.readHolidayAreaModel(tx, cfg))).chosen).toBeNull();
  }
  await moveTo(cfg, { city: "PUERTO I\u0301SLA" });
  expect((await run((tx) => store.readHolidayAreaModel(tx, cfg))).chosen).toBe("isle-a");
});

it("the retained geography city constraint refuses a corrupt city key", async () => {
  const cfg = await venue({ province: "Isleshire" });
  const geography = await run((tx) => store.saveHolidayArea(tx, cfg, { areaKey: "isle-a" }));
  const before = await stored();
  await expect(
    (async () =>
      db.execute(sql`update holiday_geographies set city_key = '' where id = ${geography!.id}`))(),
  ).rejects.toThrow("CHECK constraint failed: holiday_geographies_city_ck");
  expect(await stored()).toEqual(before);
});
