import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  locations,
  locationBusinessDaySettings,
  locationDayCutoverChanges,
  nodes,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId, type BusinessDayClock } from "@waitron/shared";
import { CATALOGUE_MIGRATIONS, createCatalogue } from "@waitron/catalogue";
import {
  VENUE_SERVICE_MIGRATIONS,
  createDepartment,
  saveMenuPeriod,
  replaceMenuWeek,
} from "@waitron/venue-service";
import * as details from "./venue-details.js";
import * as businessDay from "./business-day-start.js";
import {
  readZoneContext,
  validateRetainedZoneClock,
  validateZoneClock,
} from "./venue-zone-context.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
const AT = new Date("2026-10-14T23:30:00.000Z");
let scope: { nodeId: string; locationId: string };
beforeEach(async () => {
  await seedTenant(suite.db);
  const [row] = await suite.db
    .insert(locations)
    .values({
      name: "Test venue",
      invoiceLocales: ["en-GB"],
      operationDescription: "Restaurant service",
      province: "Madrid",
      timeZone: "Invalid/Zone",
      dayCutover: "06:00:00",
    })
    .returning();
  scope = { nodeId: await seedNode(suite.db, locationId(row!.id)), locationId: row!.id };
});
afterEach(() => vi.restoreAllMocks());
const read = () => withTransaction(suite.db, (tx) => readZoneContext(tx, scope));
const preview = (zone = "Europe/Madrid", at = AT) =>
  withTransaction(suite.db, (tx) => validateRetainedZoneClock(tx, scope, zone, at));
const retained = () => ({
  locations: suite.db.all(sql`select * from locations`),
  changes: suite.db.all(
    sql`select * from location_day_cutover_changes order by effective_business_day`,
  ),
  settings: suite.db.all(sql`select * from location_business_day_settings`),
  periods: suite.db.all(sql`select * from menu_periods`),
  days: suite.db.all(sql`select * from department_days`),
  ranges: suite.db.all(sql`select * from department_day_ranges`),
});

describe("raw saved zone context", () => {
  it.each([" Europe/Madrid", "Europe/Madrid "])(
    "keeps unreadable saved %j eligible for repair without changing it",
    async (timeZone) => {
      await suite.db.update(locations).set({ timeZone }).where(eq(locations.id, scope.locationId));
      const before = retained();
      const context = await read();
      expect(context.savedZone).toEqual({ kind: "invalid" });
      expect(context.clock.timeZone).toBe(timeZone);
      expect(retained()).toEqual(before);
    },
  );
  it("reads an invalid zone and absent revision without ordinary detail or reporting reads", async () => {
    const ordinary = vi
      .spyOn(details, "readVenueDetails")
      .mockRejectedValue(new Error("ordinary details reached"));
    const clock = vi
      .spyOn(businessDay, "readBusinessDayClockModel")
      .mockRejectedValue(new Error("ordinary clock reached"));
    expect(await read()).toEqual({
      ...scope,
      country: "ES",
      legalName: "Test SL",
      province: "Madrid",
      savedZone: { kind: "invalid" },
      clock: { timeZone: "Invalid/Zone", dayCutover: "06:00", cutoverChanges: [] },
      clockRevision: 0,
    });
    expect(ordinary).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
  });
  it.each(["", "   "])(
    "classifies missing saved text %j without inventing a zone",
    async (timeZone) => {
      await suite.db.update(locations).set({ timeZone }).where(eq(locations.id, scope.locationId));
      expect((await read()).savedZone).toEqual({ kind: "missing" });
      expect((await read()).clock.timeZone).toBe(timeZone);
    },
  );
  it.each([
    ["US/Eastern", "America/New_York"],
    ["Europe/London", "Europe/London"],
  ])("keeps supported saved %s valid outside the country list", async (timeZone, canonical) => {
    await suite.db.update(locations).set({ timeZone }).where(eq(locations.id, scope.locationId));
    expect((await read()).savedZone).toEqual({ kind: "valid", timeZone: canonical });
  });
  it("resolves the location from the writing node when no configured location is supplied", async () => {
    expect(
      await withTransaction(suite.db, (tx) => readZoneContext(tx, { nodeId: scope.nodeId })),
    ).toEqual(await read());
  });
  it("refuses an unknown writing node", async () => {
    await expect(
      withTransaction(suite.db, (tx) => readZoneContext(tx, { ...scope, nodeId: randomUUID() })),
    ).rejects.toMatchObject({
      code: "venue.time_zone_target_invalid",
      params: { reason: "node" },
    });
  });
  it("refuses a configured location that differs from the writing node", async () => {
    await expect(
      withTransaction(suite.db, (tx) =>
        readZoneContext(tx, { ...scope, locationId: randomUUID() }),
      ),
    ).rejects.toMatchObject({
      code: "venue.time_zone_target_invalid",
      params: { reason: "mismatch" },
    });
  });
  it("refuses a node whose saved location no longer exists", async () => {
    await suite.db.execute(sql`pragma foreign_keys = off`);
    try {
      await suite.db
        .update(nodes)
        .set({ locationId: randomUUID() })
        .where(eq(nodes.id, scope.nodeId));
      await expect(
        withTransaction(suite.db, (tx) => readZoneContext(tx, { nodeId: scope.nodeId })),
      ).rejects.toMatchObject({
        code: "venue.time_zone_target_invalid",
        params: { reason: "location" },
      });
    } finally {
      await suite.db
        .update(nodes)
        .set({ locationId: scope.locationId })
        .where(eq(nodes.id, scope.nodeId));
      await suite.db.execute(sql`pragma foreign_keys = on`);
    }
  });
  it("refuses a context with no taxpayer identity", async () => {
    await suite.db.execute(sql`delete from tenants`);
    await expect(read()).rejects.toMatchObject({
      code: "venue.time_zone_target_invalid",
      params: { reason: "location" },
    });
  });
  it("does not classify a formatter runtime failure as zone eligibility", async () => {
    const failure = new Error("formatter unavailable");
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function () {
      throw failure;
    });
    await expect(read()).rejects.toBe(failure);
  });
});

describe("retained clock candidate validation", () => {
  it.each([
    ["Invalid/Zone", "invalid"],
    ["", "missing"],
    ["+02:00", "invalid"],
  ])("refuses unusable candidate %j without replacing retained rows", async (zone, reason) => {
    const before = retained();
    await expect(preview(zone)).rejects.toMatchObject({
      code: "venue.time_zone_invalid",
      params: { reason },
    });
    expect(retained()).toEqual(before);
  });
  it("previews the candidate with all past and future cutovers and revision unchanged", async () => {
    await suite.db
      .insert(locationBusinessDaySettings)
      .values({ locationId: scope.locationId, revision: 7 });
    await suite.db.insert(locationDayCutoverChanges).values([
      { locationId: scope.locationId, effectiveBusinessDay: "2026-11-01", dayCutover: "07:00:00" },
      { locationId: scope.locationId, effectiveBusinessDay: "2026-09-01", dayCutover: "05:00:00" },
    ]);
    const before = retained();
    expect(await preview()).toEqual({
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
      cutoverChanges: [
        { effectiveBusinessDay: "2026-09-01", dayCutover: "05:00" },
        { effectiveBusinessDay: "2026-11-01", dayCutover: "07:00" },
      ],
    });
    expect((await read()).clockRevision).toBe(7);
    expect(retained()).toEqual(before);
  });
  it("rejects a malformed retained baseline without replacing it", async () => {
    await suite.db
      .update(locations)
      .set({ dayCutover: "06:00garbage" })
      .where(eq(locations.id, scope.locationId));
    const before = retained();
    await expect(preview()).rejects.toMatchObject({
      code: "business_day.clock_invalid",
      params: { reason: "invalid_cutover" },
    });
    expect(retained()).toEqual(before);
  });
  it("rejects an impossible retained date even though its stored shape passes", async () => {
    await suite.db.insert(locationDayCutoverChanges).values({
      locationId: scope.locationId,
      effectiveBusinessDay: "2026-02-30",
      dayCutover: "05:00:00",
    });
    const before = retained();
    await expect(preview()).rejects.toMatchObject({
      code: "business_day.clock_invalid",
      params: { reason: "invalid_date" },
    });
    expect(retained()).toEqual(before);
  });
  it("rejects a non-increasing historical boundary away from the preview instant", async () => {
    await suite.db.insert(locationDayCutoverChanges).values({
      locationId: scope.locationId,
      effectiveBusinessDay: "2011-12-30",
      dayCutover: "06:00:00",
    });
    await expect(preview("Pacific/Apia")).rejects.toMatchObject({
      code: "business_day.clock_invalid",
      params: { reason: "non_increasing_boundary" },
    });
  });
  it("refuses a bad conversion instant without rewriting the saved zone", async () => {
    await expect(preview("Europe/Madrid", new Date(NaN))).rejects.toMatchObject({
      code: "venue.time_zone_conversion_failed",
      params: { reason: "invalid_instant" },
    });
    expect((await read()).savedZone).toEqual({ kind: "invalid" });
  });
  it("keeps an unreadable conversion separate from an invalid saved name", async () => {
    const Formatter = Intl.DateTimeFormat;
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (locales, options) {
      const formatter = new Formatter(locales, options);
      if (options?.timeZoneName === "longOffset")
        vi.spyOn(formatter, "formatToParts").mockReturnValue([]);
      return formatter;
    });
    await expect(preview()).rejects.toMatchObject({
      code: "venue.time_zone_conversion_failed",
      params: { reason: "unreadable_offset" },
    });
    expect((await read()).savedZone).toEqual({ kind: "invalid" });
  });
  it("preserves real saved schedules while validating the candidate clock", async () => {
    await suite.db
      .update(locations)
      .set({ timeZone: "Europe/Madrid" })
      .where(eq(locations.id, scope.locationId));
    const cfg = { locationId: locationId(scope.locationId) };
    await withTransaction(suite.db, async (tx) => {
      const menu = await createCatalogue(tx, { name: "Test menu" });
      const department = await createDepartment(tx, cfg, { name: "Dining", orderStart: "counter" });
      const period = await saveMenuPeriod(tx, cfg, department.id, {
        name: "Lunch",
        menuId: menu.id,
        staffMenuIds: [],
      });
      await replaceMenuWeek(
        tx,
        cfg,
        department.id,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: [{ periodId: period.id, startsAt: "12:00", endsAt: "14:00" }],
        })),
        AT,
        0,
      );
      return period.id;
    });
    await suite.db
      .update(locations)
      .set({ timeZone: "Invalid/Zone" })
      .where(eq(locations.id, scope.locationId));
    const before = retained();
    const schedules = suite.db.all(sql`select * from department_day_ranges`);
    expect(await preview()).toEqual({
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
      cutoverChanges: [],
    });
    expect(suite.db.all(sql`select * from department_day_ranges`)).toEqual(schedules);
    expect(retained()).toEqual(before);
  });
});

describe("retained clock structure", () => {
  const clock: BusinessDayClock = {
    timeZone: "Europe/Madrid",
    dayCutover: "06:00",
    cutoverChanges: [],
  };
  it.each([
    [
      { effectiveBusinessDay: "2026-09-01", dayCutover: "05:00" },
      { effectiveBusinessDay: "2026-09-01", dayCutover: "07:00" },
    ],
    [
      { effectiveBusinessDay: "2026-11-01", dayCutover: "05:00" },
      { effectiveBusinessDay: "2026-09-01", dayCutover: "07:00" },
    ],
  ])("refuses duplicate or unordered changes %#", (...cutoverChanges) => {
    expect(() => validateZoneClock({ ...clock, cutoverChanges }, AT)).toThrow(
      expect.objectContaining({
        code: "business_day.clock_invalid",
        params: { reason: "changes_out_of_order" },
      }),
    );
  });
});
