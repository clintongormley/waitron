import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { randomUUID } from "node:crypto";
import { asc } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHolidayCalendar, type CountryPack } from "@waitron/country";
import {
  CORE_MIGRATIONS,
  persons,
  settings,
  readVenueSettings,
  readSettings,
  VENUE_SETTINGS,
  saveVenueFields,
  specialDayDates,
  specialDays,
  tenants,
  withTransaction,
  type Database,
  type Transaction,
  venueLocationId,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue, seedVenueSettings } from "@waitron/db/testing/seed.js";
import {
  createHolidayStore,
  readHolidayDates as packageReadHolidayDates,
  readHolidayFacts as packageReadHolidayFacts,
  readHolidays as packageReadHolidays,
} from "./holidays.js";
import { saveSpecialDay } from "./special-days.js";
import * as packageIndex from "./index.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
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
    timeZones: ["Europe/Madrid"],
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

async function venue(address: Address = {}): Promise<{ locationId: string }> {
  return withTransaction(db, async (tx) => {
    await setCountry(tx, address.country ?? "ZZ");
    await seedVenue(tx, {
      name: `Venue ${randomUUID()}`,
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
      province: address.province === undefined ? "Northshire" : address.province,
      city: address.city === undefined ? "Villa Real" : address.city,
    });
    const venueId = await venueLocationId(tx);
    return { locationId: venueId };
  });
}

async function moveTo(_cfg: { locationId: string }, address: Address) {
  await withTransaction(db, async (tx) => {
    if (address.country !== undefined) await setCountry(tx, address.country);
    const set: { province?: string | null; city?: string | null } = {};
    if (address.province !== undefined) set.province = address.province;
    if (address.city !== undefined) set.city = address.city;
    if (Object.keys(set).length > 0) await seedVenueSettings(tx, set);
  });
}

const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(db, fn);

/** A special day closed all day on `date`, written straight to its tables. */
async function specialDay(
  _cfg: { locationId: string },
  date: string,
  name: string,
  repeatsYearly = false,
) {
  await run(async (tx) => {
    const [day] = await tx
      .insert(specialDays)
      .values({ name, repeatsYearly })
      .returning({ id: specialDays.id });
    await tx.insert(specialDayDates).values({ specialDayId: day!.id, date, closedAllDay: true });
  });
}

async function seedRetainedGeographyWithSpecialDay(
  tx: Transaction,
  _cfg: { locationId: string },
  date: string,
  name: string,
) {
  await saveVenueFields(
    tx,
    { holidayArea: { country: "ZZ", provinceCode: "10", cityKey: "villa real", areaKey: null } },
    null,
  );
  const [day] = await tx
    .insert(specialDays)
    .values({ name, repeatsYearly: false })
    .returning({ id: specialDays.id });
  await tx.insert(specialDayDates).values({ specialDayId: day!.id, date, closedAllDay: false });
}

async function stored() {
  return run(async (tx) => ({
    holidayArea: (await readSettings(tx, VENUE_SETTINGS)).doc.holidayArea,
    entries: await tx.select().from(specialDays).orderBy(asc(specialDays.id)),
    dates: await tx.select().from(specialDayDates).orderBy(asc(specialDayDates.id)),
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
    await venue();
    const read = await run((tx) => store.readHolidays(tx, "2026-01-01", "2026-12-31"));
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
    expect(await stored()).toEqual({ holidayArea: null, entries: [], dates: [] });
    const model = await run((tx) => store.readHolidayAreaModel(tx));
    expect(model).toEqual({
      venue: { country: "ZZ", provinceCode: "10", city: "Villa Real" },
      readiness: "ready",
      localHolidaysPerYear: 1,
      areaOptions: [],
      areaRequired: false,
      chosen: null,
    });
  });

  it("does not count a special day as a local holiday, whatever its name", async () => {
    const cfg = await venue();
    await specialDay(cfg, "2026-12-19", "Fiesta mayor", true);
    const read = await run((tx) => store.readHolidays(tx, "2026-12-01", "2027-11-30"));
    expect(read.coverage.map(({ local, sourceIds }) => ({ local, sourceIds }))).toEqual([
      { local: "none_entered", sourceIds: ["ZZ-ANNEX"] },
      { local: "none_entered", sourceIds: ["ZZ-ANNEX"] },
    ]);
    expect(read.sources.map(({ kind }) => kind)).toEqual(["official"]);
    expect(read.facts.map(({ date }) => date)).toEqual(["2027-01-01"]);
  });

  it("keeps a special day and retained geography out of holiday facts, coverage and sources", async () => {
    const cfg = await venue();
    await run((tx) => seedRetainedGeographyWithSpecialDay(tx, cfg, "2026-01-01", "Fiesta mayor"));
    const read = await run((tx) => store.readHolidays(tx, "2026-01-01", "2026-01-01"));
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

  it("gives each civil year its own coverage, with a special day in neither", async () => {
    const cfg = await venue();
    await specialDay(cfg, "2026-03-19", "Our holiday");
    const read = await run((tx) => store.readHolidays(tx, "2026-12-01", "2027-01-31"));
    expect(read.facts.map(({ id }) => id)).toEqual(["shipped:new-year-2027"]);
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
    expect(read.sources.map(({ id }) => id)).toEqual(["ZZ-ANNEX"]);
  });

  it("reports a year the pack does not ship as missing", async () => {
    await venue();
    const read = await run((tx) => store.readHolidays(tx, "2028-01-01", "2028-01-31"));
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
    await venue();
    for (const [from, to, field] of [
      ["2026-02-30", "2026-03-01", "from"],
      ["2026-03-01", "2026-02-28", "to"],
      ["2026-01-01", "2027-01-02", "to"],
    ] as const)
      expect(await refusal(() => run((tx) => store.readHolidays(tx, from, to)))).toMatchObject({
        code: "hours.invalid",
        params: { field },
      });
  });
});

describe("an address that does not resolve", () => {
  const year = ["2026-01-01", "2026-12-31"] as const;

  it("keeps shipped coverage for a missing city and reads local as unresolved", async () => {
    await venue({ city: "   " });
    const read = await run((tx) => store.readHolidays(tx, ...year));
    expect(read.facts.map(({ id }) => id)).toEqual([
      "shipped:new-year",
      "shipped:north-day",
      "shipped:north-fair",
    ]);
    expect(read.coverage).toMatchObject([
      { provinceCode: "10", nationalRegional: "complete", local: "address_unresolved" },
    ]);
    const model = await run((tx) => store.readHolidayAreaModel(tx));
    expect(model.venue).toEqual({ country: "ZZ", provinceCode: "10", city: null });
    expect(model.localHolidaysPerYear).toBe(1);
    expect(await stored()).toEqual({ holidayArea: null, entries: [], dates: [] });
  });

  for (const province of [null, "Atlantis"])
    it(`reads province ${String(province)} as an unknown region with no facts`, async () => {
      await venue({ province });
      const read = await run((tx) => store.readHolidays(tx, ...year));
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
        await refusal(() => run((tx) => store.saveHolidayArea(tx, { areaKey: null }))),
      ).toMatchObject({ code: "holiday.invalid", params: { field: "geography" } });
      expect(await stored()).toEqual({ holidayArea: null, entries: [], dates: [] });
    });

  it("reads a country with no installed pack as unsupported, guessing nothing", async () => {
    await venue({ country: "QQ" });
    const read = await run((tx) => store.readHolidays(tx, ...year));
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
    const model = await run((tx) => store.readHolidayAreaModel(tx));
    expect(model).toMatchObject({
      localHolidaysPerYear: 0,
      venue: { country: "QQ", provinceCode: null },
    });
  });

  it("guesses nothing when the database has no taxpayer row", async () => {
    const cfg = await venue();
    await run((tx) => tx.delete(tenants));
    const read = await run((tx) => store.readHolidays(tx, ...year));
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
    await moveTo(cfg, { country: "ZZ", province: null, city: null });
    expect(await run((tx) => store.readHolidayAreaModel(tx))).toEqual({
      venue: { country: "ZZ", provinceCode: null, city: null },
      readiness: "unresolved_address",
      localHolidaysPerYear: 1,
      areaOptions: [],
      areaRequired: false,
      chosen: null,
    });
  });

  it("reports no local holidays for a known province whose region is unknown, a special day included", async () => {
    const cfg = await venue({ province: "Lostshire" });
    await specialDay(cfg, "2026-03-19", "Our holiday");
    const read = await run((tx) => store.readHolidays(tx, ...year));
    expect(read.facts).toEqual([]);
    expect(read.coverage).toMatchObject([
      {
        provinceCode: "40",
        regionCode: null,
        nationalRegional: "unknown_region",
        local: "none_entered",
        sourceIds: [],
      },
    ]);
  });

  it("returns no local facts for a matching geography once its country has no holiday capability", async () => {
    const cfg = await venue({ country: "ZY" });
    await run((tx) => seedRetainedGeographyWithSpecialDay(tx, cfg, "2026-03-19", "Retired"));
    const read = await run((tx) => store.readHolidays(tx, "2026-01-01", "2026-12-31"));
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
    const model = await run((tx) => store.readHolidayAreaModel(tx));
    expect(model.chosen).toBeNull();
  });
});

describe("territorial areas", () => {
  const year = ["2026-01-01", "2026-12-31"] as const;

  it("asks for an area only where the data needs one, and returns only certain facts until then", async () => {
    await venue({ province: "Isleshire" });
    const model = await run((tx) => store.readHolidayAreaModel(tx));
    expect(model).toMatchObject({
      areaOptions: [
        { key: "isle-a", name: "Isle A" },
        { key: "isle-b", name: "Isle B" },
      ],
      areaRequired: true,
    });
    const read = await run((tx) => store.readHolidays(tx, ...year));
    expect(read.facts.map(({ id }) => id)).toEqual(["shipped:new-year"]);
    expect(read.coverage).toMatchObject([
      { provinceCode: "30", regionCode: "R3", nationalRegional: "area_required" },
    ]);
  });

  it("stores the choice on a geography with no entries, keeps it across a move away and back, and clears it with null", async () => {
    const cfg = await venue({ province: "Isleshire" });
    const specials = await run((tx) => tx.select().from(specialDays));
    const geography = (await run((tx) => store.saveHolidayArea(tx, { areaKey: "isle-a" })))!;
    expect(geography).toEqual({
      country: "ZZ",
      provinceCode: "30",
      city: "Villa Real",
      areaKey: "isle-a",
      matchesVenue: true,
    });
    expect((await stored()).entries).toEqual([]);
    const chosen = await run((tx) => store.readHolidays(tx, ...year));
    expect(chosen.facts.map(({ id }) => id)).toEqual(["shipped:new-year", "shipped:isle-a-day"]);
    expect(chosen.coverage).toMatchObject([{ nationalRegional: "complete" }]);

    await moveTo(cfg, { city: "Puerto Nuevo" });
    expect(await run((tx) => store.readHolidayAreaModel(tx))).toMatchObject({
      areaRequired: true,
      chosen: null,
    });
    await moveTo(cfg, { city: "Villa Real" });
    expect(await run((tx) => store.readHolidayAreaModel(tx))).toMatchObject({
      areaRequired: false,
    });

    const again = (await run((tx) => store.saveHolidayArea(tx, { areaKey: "isle-b" })))!;
    expect(again).toMatchObject({ ...geography, areaKey: "isle-b" });
    const cleared = await run((tx) => store.saveHolidayArea(tx, { areaKey: null }));
    expect(cleared).toMatchObject({ country: "ZZ", provinceCode: "30", areaKey: null });
    expect(await run((tx) => store.readHolidayAreaModel(tx))).toMatchObject({
      areaRequired: true,
    });
    expect(await run((tx) => tx.select().from(specialDays))).toEqual(specials);
  });

  it("offers the area choice from the province alone while the city is missing, but cannot save it", async () => {
    await venue({ province: "Isleshire", city: null });
    expect(await run((tx) => store.readHolidayAreaModel(tx))).toMatchObject({
      venue: { provinceCode: "30", city: null },
      readiness: "missing_city",
      areaOptions: [
        { key: "isle-a", name: "Isle A" },
        { key: "isle-b", name: "Isle B" },
      ],
      areaRequired: true,
    });
    const read = await run((tx) => store.readHolidays(tx, ...year));
    expect(read.coverage).toMatchObject([
      { nationalRegional: "area_required", local: "address_unresolved" },
    ]);
    expect(
      await refusal(() => run((tx) => store.saveHolidayArea(tx, { areaKey: "isle-a" }))),
    ).toMatchObject({ code: "holiday.invalid", params: { field: "geography" } });
    expect(await stored()).toEqual({ holidayArea: null, entries: [], dates: [] });
  });

  it("clears an area with no geography row by writing nothing", async () => {
    await venue({ province: "Isleshire" });
    expect(await run((tx) => store.saveHolidayArea(tx, { areaKey: null }))).toBeNull();
    expect(await stored()).toEqual({ holidayArea: null, entries: [], dates: [] });
  });

  it("refuses an area nobody sourced, an omitted key and a wrong type", async () => {
    const cfg = await venue();
    const isles: Address = { province: "Isleshire" };
    const north: Address = { province: "Northshire" };
    const cases: [Address, unknown][] = [
      [isles, { areaKey: "isle-c" }],
      [isles, { areaKey: 3 }],
      [isles, { areaKey: ["isle-a"] }],
      [isles, {}],
      [isles, null],
      [north, { areaKey: "isle-a" }],
      [north, { areaKey: null }],
    ];
    for (const [address, input] of cases) {
      await moveTo(cfg, address);
      expect(
        await refusal(() =>
          run((tx) => store.saveHolidayArea(tx, input as { areaKey: string | null })),
        ),
      ).toMatchObject({ code: "holiday.invalid", params: { field: "areaKey" } });
    }
    expect(await stored()).toEqual({ holidayArea: null, entries: [], dates: [] });
  });

  it("offers the Arán choice for a Spanish venue in Lleida and none in Sevilla", async () => {
    const lleida = await venue({ country: "ES", province: "Lérida", city: "Vielha" });
    const options = (await run((tx) => packageIndex.readHolidayAreaModel(tx))).areaOptions;
    expect(options.map(({ key }) => key)).toEqual(["aran", "lleida-except-aran"]);
    await moveTo(lleida, { province: "Sevilla" });
    expect((await run((tx) => packageIndex.readHolidayAreaModel(tx))).areaOptions).toEqual([]);
  });
});

describe("transactions and other callers", () => {
  it("reads its own area write before commit and a rollback keeps no geography", async () => {
    await venue({ province: "Isleshire" });
    const rolledBack = new Error("roll back");
    await expect(
      run(async (tx) => {
        await store.saveHolidayArea(tx, { areaKey: "isle-a" });
        const read = await store.readHolidays(tx, "2026-03-19", "2026-07-01");
        expect(read.facts.map(({ id }) => id)).toEqual(["shipped:isle-a-day"]);
        const model = await store.readHolidayAreaModel(tx);
        expect(model).toMatchObject({
          areaRequired: false,
          chosen: "isle-a",
        });
        throw rolledBack;
      }),
    ).rejects.toBe(rolledBack);
    expect(await stored()).toEqual({ holidayArea: null, entries: [], dates: [] });
  });

  it("gives a calendar reader the same facts, unaffected by special dates", async () => {
    await venue();
    const read = await run((tx) => store.readHolidays(tx, "2026-01-01", "2026-12-31"));
    expect(await run((tx) => store.readHolidayFacts(tx, "2026-01-01", "2026-12-31"))).toEqual(
      read.facts,
    );
    await run((tx) =>
      saveSpecialDay(
        tx,
        null,
        {
          name: "Labour",
          repeatsYearly: false,
          dates: [{ date: "2026-05-01", closedAllDay: true }],
          paint: [],
        },
        new Date("2026-04-01T10:00:00Z"),
        1,
      ),
    );
    const after = await run((tx) => store.readHolidays(tx, "2026-01-01", "2026-12-31"));
    expect(after).toEqual(read);
  });

  it("reads a data revision's facts, version and allowance, leaving every stored row as it was", async () => {
    await venue();
    await run((tx) =>
      saveSpecialDay(
        tx,
        null,
        {
          name: "New Year",
          repeatsYearly: false,
          dates: [{ date: "2026-01-01", closedAllDay: true }],
          paint: [],
        },
        new Date("2025-12-01T10:00:00Z"),
        1,
      ),
    );
    const rows = async () => ({
      stored: await stored(),
      specialDays: await run((tx) => tx.select().from(specialDays).orderBy(asc(specialDays.id))),
      specialDayDates: await run((tx) =>
        tx.select().from(specialDayDates).orderBy(asc(specialDayDates.id)),
      ),
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
    const read = await run((tx) => revised.readHolidays(tx, "2026-01-01", "2026-12-31"));
    expect(read.facts.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "shipped:new-year", name: "New Year's Day" },
    ]);
    expect(read.coverage).toEqual([
      expect.objectContaining({
        dataVersion: "ZZ-2026.2",
        sourceIds: ["ZZ-ANNEX-2"],
      }),
    ]);
    const model = await run((tx) => revised.readHolidayAreaModel(tx));
    expect(model.localHolidaysPerYear).toBe(1);
    expect(await rows()).toEqual(before);
    expect(before.specialDays.map(({ name }) => name)).toEqual(["New Year"]);
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
    await venue({ country: "ES", province: "Sevilla", city: "Sevilla" });
    const read = await run((tx) => packageIndex.readHolidays(tx, "2026-01-01", "2026-12-31"));
    expect(read.coverage).toMatchObject([
      { country: "ES", provinceCode: "41", regionCode: "01", nationalRegional: "complete" },
    ]);
    expect(read.facts.some(({ id }) => id === "shipped:BOE-A-2025-21667:0101")).toBe(true);
    expect(read.sources.map(({ id }) => id)).toEqual(["BOE-A-2025-21667"]);
    await run((tx) => packageIndex.readHolidayAreaModel(tx));
    expect(fetch).not.toHaveBeenCalled();
  });
});

it("reports an unresolved address when the public-holiday address cannot resolve, a special day included", async () => {
  const cfg = await venue({ country: "XY", province: null, city: null });
  await specialDay(cfg, "2026-12-25", "Our holiday");
  const read = await run((tx) => store.readHolidays(tx, "2026-01-01", "2026-01-01"));
  expect(read.coverage[0]).toMatchObject({
    nationalRegional: "unsupported_country",
    local: "address_unresolved",
    sourceIds: [],
  });
  expect(read.facts).toEqual([]);
});

it("lets a Spanish venue add more special days than the informational local number", async () => {
  const cfg = await venue({ country: "ES", province: "Sevilla", city: "Sevilla" });
  for (const date of ["2026-03-19", "2026-06-04", "2026-09-08"])
    await specialDay(cfg, date, `Own ${date}`);
  expect(
    (await run((tx) => tx.select().from(specialDayDates))).map(({ date }) => date).sort(),
  ).toEqual(["2026-03-19", "2026-06-04", "2026-09-08"]);
  expect((await run((tx) => store.readHolidayAreaModel(tx))).localHolidaysPerYear).toBe(0);
  expect((await run((tx) => packageIndex.readHolidayAreaModel(tx))).localHolidaysPerYear).toBe(2);
  expect(
    (await run((tx) => packageIndex.readHolidays(tx, "2026-12-01", "2026-12-01"))).coverage[0]!
      .local,
  ).toBe("none_entered");
});

it("reuses a holiday area's geography for an equivalent city spelling", async () => {
  const cfg = await venue({ province: "Isleshire", city: "  Villa   Real  " });
  const saved = (await run((tx) => store.saveHolidayArea(tx, { areaKey: "isle-a" })))!;
  expect(saved.city).toBe("Villa   Real");
  await moveTo(cfg, { city: "VILLA REAL" });
  expect((await run((tx) => store.readHolidayAreaModel(tx))).chosen).toBe("isle-a");
  const again = (await run((tx) => store.saveHolidayArea(tx, { areaKey: "isle-b" })))!;
  expect(again.areaKey).toBe("isle-b");
  expect((await stored()).holidayArea).toEqual({
    country: "ZZ",
    provinceCode: "30",
    cityKey: "villa real",
    areaKey: "isle-b",
  });
});

it("the retained area writer stores a city trimmed at the address's full length", async () => {
  const cfg = await venue({ province: "Isleshire" });
  for (const city of ["  Villa Real  ", "x".repeat(5000)]) {
    await moveTo(cfg, { city });
    const saved = (await run((tx) => store.saveHolidayArea(tx, { areaKey: "isle-a" })))!;
    expect(saved.city).toBe(city.trim());
  }
});

it("the area choice keeps cities with different accents and punctuation apart", async () => {
  const cfg = await venue({ province: "Isleshire", city: "Puerto Ísla" });
  await run((tx) => store.saveHolidayArea(tx, { areaKey: "isle-a" }));
  for (const city of ["Puerto Isla", "Puerto-Ísla"]) {
    await moveTo(cfg, { city });
    expect((await run((tx) => store.readHolidayAreaModel(tx))).chosen).toBeNull();
  }
  await moveTo(cfg, { city: "PUERTO I\u0301SLA" });
  expect((await run((tx) => store.readHolidayAreaModel(tx))).chosen).toBe("isle-a");
});

it("the venue document refuses a corrupt holiday city key", async () => {
  await venue({ province: "Isleshire" });
  await run((tx) => store.saveHolidayArea(tx, { areaKey: "isle-a" }));
  const before = await stored();
  await expect(
    run((tx) =>
      saveVenueFields(tx, { holidayArea: { ...before.holidayArea!, cityKey: "" } }, null),
    ),
  ).rejects.toMatchObject({ code: "settings.invalid", params: { field: "holidayArea" } });
  expect(await stored()).toEqual(before);
});

it("reads an address whose province does not resolve, but whose city is entered, as an unresolved province", async () => {
  await venue({ province: "Atlantis" });
  expect(await run((tx) => store.readHolidayAreaModel(tx))).toMatchObject({
    venue: { country: "ZZ", provinceCode: null, city: "Villa Real" },
    readiness: "unresolved_province",
    areaOptions: [],
  });
});

it("refuses an area choice in a country whose pack has no holiday calendar, writing nothing", async () => {
  await venue({ country: "ZY", province: "Isleshire" });
  expect(
    await refusal(() => run((tx) => store.saveHolidayArea(tx, { areaKey: "isle-a" }))),
  ).toMatchObject({ code: "holiday.invalid", params: { field: "areaKey" } });
  expect(await stored()).toEqual({ holidayArea: null, entries: [], dates: [] });
});

it("takes the holiday area from the venue's city and province", async () => {
  await venue({ province: "Isleshire", city: "Puerto Isla" });
  await run((tx) => store.saveHolidayArea(tx, { areaKey: "isle-a" }));
  const read = await run((tx) => store.readHolidays(tx, "2026-07-01", "2026-07-01"));
  expect(read.facts.map(({ name }) => name)).toEqual(["Isle A day"]);
});

it("gives the holiday dates by year and name, adding an area's holiday once the venue chooses that area", async () => {
  await venue({ province: "Isleshire" });
  const dates = () => run((tx) => store.readHolidayDates(tx, 2026, 2027));
  expect(await dates()).toEqual(
    new Map([
      [2026, new Map([["New Year", "2026-01-01"]])],
      [2027, new Map([["New Year", "2027-01-01"]])],
    ]),
  );
  await run((tx) => store.saveHolidayArea(tx, { areaKey: "isle-a" }));
  expect((await dates()).get(2026)).toEqual(
    new Map([
      ["New Year", "2026-01-01"],
      ["Isle A day", "2026-07-01"],
    ]),
  );
});

describe("country-pack English display names", () => {
  it("keeps English area names in the venue projection", async () => {
    await venue({ country: "ES", province: "25", city: "Vielha" });
    const model = await run((tx) => packageIndex.readHolidayAreaModel(tx));
    expect(model.areaOptions).toContainEqual(
      expect.objectContaining({ key: "lleida-except-aran", englishName: "Lleida, outside Aran" }),
    );
  });
});

it("keeps English display names separate from annual holiday matching", async () => {
  await venue({ country: "ES", province: "28", city: "Madrid" });
  const read = await run((tx) => packageIndex.readHolidays(tx, "2026-12-25", "2026-12-25"));
  expect(read.facts).toHaveLength(1);
  expect(read.facts[0]!.englishName).toBe("Christmas Day");
  const dates = await run((tx) => packageReadHolidayDates(tx, 2026, 2026));
  expect(dates.get(2026)!.get(read.facts[0]!.name)).toBe("2026-12-25");
  expect(dates.get(2026)!.has("Christmas Day")).toBe(false);
});

it("keeps absent country translations absent, including a country without a calendar", async () => {
  await venue({ country: "ZY" });
  expect(await run((tx) => store.readHolidayEnglishNames(tx, ["Historic local holiday"]))).toEqual(
    new Map(),
  );
  expect(await run((tx) => store.readHolidayEnglishNames(tx, []))).toEqual(new Map());
});

it("saves the holiday choice in the venue document and names its saver", async () => {
  await venue({ province: "Isleshire" });
  const [person] = await seedPersons(db, { displayName: "Owner" });
  await run((tx) => store.saveHolidayArea(tx, { areaKey: "isle-a" }, person!.id));
  expect((await readVenueSettings(db)).doc).toMatchObject({
    invoiceLocales: ["en-GB"],
    holidayArea: { country: "ZZ", provinceCode: "30", cityKey: "villa real", areaKey: "isle-a" },
  });
  expect((await db.select().from(settings))[0]!.updatedBy).toBe(person!.id);
});
