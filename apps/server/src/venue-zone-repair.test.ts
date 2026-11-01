import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  locations,
  incidents,
  locationBusinessDaySettings,
  locationDayCutoverChanges,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons, startManagementSession } from "@waitron/identity";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { VENUE_SERVICE_MIGRATIONS } from "@waitron/venue-service";
import { locationId } from "@waitron/shared";
import {
  ZONE_REPAIR_ALERT_CLAIM,
  confirmVenueZone,
  readVenueZoneRepair,
} from "./venue-zone-repair.js";
import { createAlertRegistry, readHandledAlerts, readOpenAlerts } from "./alerts.js";
import { TradingAdmission } from "./trading-admission.js";

const suite = useVenueDb({
  migrations: [
    CORE_MIGRATIONS,
    IDENTITY_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    VENUE_SERVICE_MIGRATIONS,
  ],
});
const AT = new Date("2026-10-14T23:30:00.000Z");
const RAW = "Invalid/Zone?token=private-invalid-value";
let scope: { nodeId: string; locationId: string };
let token: string;
let actor: string;
const body = { timeZone: "Europe/Madrid", expectedClockRevision: 0, confirmed: true };
beforeEach(async () => {
  await seedTenant(suite.db);
  const [row] = await suite.db
    .insert(locations)
    .values({
      name: "Counter",
      province: "Madrid",
      timeZone: RAW,
      dayCutover: "06:00:00",
      invoiceLocales: ["en-GB"],
      operationDescription: "Restaurant service",
    })
    .returning();
  scope = { locationId: row!.id, nodeId: await seedNode(suite.db, locationId(row!.id)) };
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Manager", role: "manager" })
    .returning();
  actor = person!.id;
  token = (await withTransaction(suite.db, (tx) => startManagementSession(tx, { personId: actor })))
    .token;
});
const confirm = (input: unknown = body) =>
  withTransaction(suite.db, (tx) => confirmVenueZone(tx, scope, token, input, AT));
const read = (candidate?: string) =>
  withTransaction(suite.db, (tx) =>
    readVenueZoneRepair(tx, scope, token, new TradingAdmission().snapshot(), AT, candidate),
  );
const snapshot = () => ({
  locations: suite.db.all<Record<string, unknown>>(sql`select * from locations`),
  settings: suite.db.all<Record<string, unknown>>(
    sql`select * from location_business_day_settings`,
  ),
  cutovers: suite.db.all<Record<string, unknown>>(sql`select * from location_day_cutover_changes`),
  incidents: suite.db.all<Record<string, unknown>>(sql`select * from incidents`),
  orders: suite.db.all<Record<string, unknown>>(sql`select * from working_orders`),
});

describe("atomic unusable-zone confirmation", () => {
  it.each([" Europe/Madrid", "Europe/Madrid "])(
    "repairs unreadable saved %j using an explicitly normalized choice",
    async (timeZone) => {
      await suite.db.update(locations).set({ timeZone }).where(eq(locations.id, scope.locationId));
      expect(await read()).toMatchObject({ category: "invalid", eligible: true });
      const before = snapshot();
      expect(await confirm({ ...body, timeZone: " Europe/Madrid " })).toEqual({
        repaired: true,
        clockRevision: 1,
        admission: "restart_required",
      });
      const after = snapshot();
      expect(after.locations).toEqual(
        before.locations.map((row) => ({ ...row, time_zone: "Europe/Madrid" })),
      );
      expect(after.cutovers).toEqual(before.cutovers);
      expect(after.orders).toEqual(before.orders);
      expect(after.incidents).toHaveLength(1);
    },
  );
  it("commits only the canonical zone, revision one and one immediately handled warning", async () => {
    await suite.db.insert(locationDayCutoverChanges).values([
      { locationId: scope.locationId, effectiveBusinessDay: "2026-09-01", dayCutover: "05:00:00" },
      { locationId: scope.locationId, effectiveBusinessDay: "2026-11-01", dayCutover: "07:00:00" },
    ]);
    await suite.db
      .insert(workingOrders)
      .values({ source: "operator_script", locationId: scope.locationId, orderNumber: 1 });
    const before = snapshot();
    const result = await confirm();
    expect(result).toEqual({ repaired: true, clockRevision: 1, admission: "restart_required" });
    const after = snapshot();
    expect(after.locations).toEqual(
      before.locations.map((row) => ({ ...row, time_zone: "Europe/Madrid" })),
    );
    expect(after.cutovers).toEqual(before.cutovers);
    expect(after.orders).toEqual(before.orders);
    expect(await suite.db.select().from(locationBusinessDaySettings)).toEqual([
      { locationId: scope.locationId, revision: 1 },
    ]);
    expect(await suite.db.select().from(incidents)).toEqual([
      {
        id: expect.any(String),
        source: "dashboard",
        deviceId: null,
        saleId: null,
        code: "venue.time_zone_repaired",
        severity: "warning",
        detectedAt: AT.toISOString(),
        acknowledgedAt: AT.toISOString(),
        acknowledgedBy: actor,
        acknowledgedNote: null,
        params: {
          ...scope,
          timeZone: "Europe/Madrid",
          previousRevision: 0,
          clockRevision: 1,
          oldCategory: "invalid",
          oldFingerprint: createHash("sha256").update(RAW).digest("hex"),
        },
      },
    ]);
    expect(JSON.stringify(after.incidents)).not.toContain(RAW);
  });
  it.each(["", "   "])("repairs missing %j without inventing an old zone", async (timeZone) => {
    await suite.db.update(locations).set({ timeZone }).where(eq(locations.id, scope.locationId));
    await confirm();
    expect((await suite.db.select().from(incidents))[0]!.params).toMatchObject({
      oldCategory: "missing",
      oldFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect((await suite.db.select().from(locations))[0]!.timeZone).toBe("Europe/Madrid");
  });
  it("canonicalizes a country-allowed alias", async () => {
    await suite.db.execute(sql`update tenants set country = 'GB'`);
    await confirm({ ...body, timeZone: "GB" });
    expect((await suite.db.select().from(locations))[0]!.timeZone).toBe("Europe/London");
  });
  it.each(["Europe/Madrid", "US/Eastern", "Europe/London"])(
    "refuses valid saved %s even with order history",
    async (timeZone) => {
      await suite.db.update(locations).set({ timeZone }).where(eq(locations.id, scope.locationId));
      await suite.db
        .insert(workingOrders)
        .values({ source: "operator_script", locationId: scope.locationId, orderNumber: 1 });
      const before = snapshot();
      await expect(confirm()).rejects.toMatchObject({
        code: "venue.time_zone_repair_not_needed",
        params: {},
      });
      expect(snapshot()).toEqual(before);
    },
  );
  it.each(["Europe/London", "Invalid/Zone", "+02:00", ""])(
    "refuses country-excluded or unusable candidate %j",
    async (timeZone) => {
      const before = snapshot();
      await expect(confirm({ ...body, timeZone })).rejects.toMatchObject({
        code: "venue.time_zone_invalid",
      });
      expect(snapshot()).toEqual(before);
    },
  );
  it("compares the revision again while the saved zone is still invalid", async () => {
    await suite.db
      .insert(locationBusinessDaySettings)
      .values({ locationId: scope.locationId, revision: 3 });
    const before = snapshot();
    await expect(confirm()).rejects.toMatchObject({
      code: "venue.business_day_changed",
      params: {},
    });
    expect(snapshot()).toEqual(before);
    expect(await confirm({ ...body, expectedClockRevision: 3 })).toMatchObject({
      clockRevision: 4,
    });
  });
  it("serializes competing confirmations and refuses a lost-response retry without another event", async () => {
    const results = await Promise.allSettled([confirm(), confirm()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toEqual([
      {
        status: "rejected",
        reason: expect.objectContaining({ code: "venue.time_zone_repair_not_needed" }),
      },
    ]);
    await expect(confirm()).rejects.toMatchObject({ code: "venue.time_zone_repair_not_needed" });
    expect(await suite.db.select().from(incidents)).toHaveLength(1);
    expect((await suite.db.select().from(locationBusinessDaySettings))[0]!.revision).toBe(1);
  });
  it("refuses a stale confirmation after a later corruption rather than recording a second success", async () => {
    await confirm();
    await suite.db
      .update(locations)
      .set({ timeZone: "Invalid/Again" })
      .where(eq(locations.id, scope.locationId));
    const before = snapshot();
    await expect(confirm()).rejects.toMatchObject({ code: "venue.business_day_changed" });
    expect(snapshot()).toEqual(before);
    expect(await suite.db.select().from(incidents)).toHaveLength(1);
  });
  it("records a distinct handled event for a later independent corruption", async () => {
    await confirm();
    await suite.db
      .update(locations)
      .set({ timeZone: "Invalid/Again" })
      .where(eq(locations.id, scope.locationId));
    await confirm({ ...body, expectedClockRevision: 1 });
    const rows = await suite.db.select().from(incidents);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.params.clockRevision).sort()).toEqual([1, 2]);
    expect(
      rows.every((row) => row.acknowledgedAt === AT.toISOString() && row.acknowledgedBy === actor),
    ).toBe(true);
  });
  it("rolls back the zone and revision when audit insertion is refused", async () => {
    await suite.db.execute(
      sql`create trigger refuse_zone_audit before insert on incidents begin select raise(abort, 'audit refused'); end`,
    );
    try {
      const before = snapshot();
      await expect(confirm()).rejects.toThrow("audit refused");
      expect(snapshot()).toEqual(before);
    } finally {
      await suite.db.execute(sql`drop trigger refuse_zone_audit`);
    }
  });
  it("keeps malformed retained cutovers as an independent refusal", async () => {
    await suite.db
      .update(locations)
      .set({ dayCutover: "bad" })
      .where(eq(locations.id, scope.locationId));
    const before = snapshot();
    await expect(confirm()).rejects.toMatchObject({
      code: "business_day.clock_invalid",
      params: { reason: "invalid_cutover" },
    });
    expect(snapshot()).toEqual(before);
  });
  it.each(["staff", "supervisor"] as const)(
    "reauthorizes a direct %s caller for both reads and writes",
    async (role) => {
      await suite.db.update(persons).set({ role }).where(eq(persons.id, actor));
      const before = snapshot();
      await expect(read()).rejects.toMatchObject({ code: "authorization.not_permitted" });
      await expect(confirm()).rejects.toMatchObject({ code: "authorization.not_permitted" });
      expect(snapshot()).toEqual(before);
    },
  );
  it("reads a bounded raw context and an independently computed Madrid preview", async () => {
    const before = snapshot();
    expect(await read("Europe/Madrid")).toEqual({
      ...scope,
      legalName: "Test SL",
      country: "ES",
      province: "Madrid",
      category: "invalid",
      eligible: true,
      clockRevision: 0,
      choices: ["Europe/Madrid", "Atlantic/Canary"],
      suggestion: "Europe/Madrid",
      admission: { state: "unchecked" },
      clock: { dayCutover: "06:00", cutoverChanges: [] },
      preview: {
        at: AT.toISOString(),
        timeZone: "Europe/Madrid",
        civilDate: "2026-10-15",
        timeOfDay: "01:30:00",
        offsetMinutes: 120,
        businessDay: "2026-10-14",
        dayCutover: "06:00",
      },
    });
    expect(snapshot()).toEqual(before);
  });
  it("exposes the handled incident only through the venue configuration claim", async () => {
    await confirm();
    const deps = {
      registry: createAlertRegistry({ claims: [ZONE_REPAIR_ALERT_CLAIM], sources: [] }),
      now: AT,
      log: () => {},
    };
    const visible = await withTransaction(suite.db, (tx) =>
      readHandledAlerts(tx, deps, new Set(["venue.configure"])),
    );
    expect(visible).toEqual([
      expect.objectContaining({
        code: "venue.time_zone_repaired",
        area: "venue",
        handledBy: "Manager",
        handledAt: AT.toISOString(),
        params: expect.objectContaining({ timeZone: "Europe/Madrid" }),
      }),
    ]);
    expect(
      await withTransaction(suite.db, (tx) =>
        readHandledAlerts(tx, deps, new Set(["venue.view", "diagnostics.view"])),
      ),
    ).toEqual([]);
    expect(
      await withTransaction(suite.db, (tx) =>
        readOpenAlerts(tx, deps, new Set(["venue.configure"])),
      ),
    ).toEqual([]);
  });
  it("uses the country area's normalized code for the suggestion only", async () => {
    await suite.db
      .update(locations)
      .set({ province: " 35 " })
      .where(eq(locations.id, scope.locationId));
    expect(await read()).toMatchObject({ suggestion: "Atlantic/Canary", eligible: true });
    expect((await suite.db.select().from(locations))[0]!.timeZone).toBe(RAW);
  });
  it("does not invent choices or a suggestion for an unknown stored country", async () => {
    await suite.db.execute(sql`update tenants set country = 'ZZ'`);
    const before = snapshot();
    expect(await read()).toMatchObject({
      country: "ZZ",
      category: "invalid",
      eligible: true,
      choices: [],
      suggestion: null,
    });
    await expect(confirm()).rejects.toMatchObject({
      code: "venue.time_zone_invalid",
      params: { reason: "country" },
    });
    expect(snapshot()).toEqual(before);
  });
  it("offers the pack's default when no province was saved without silently saving it", async () => {
    await suite.db.execute(sql`update tenants set country = 'GB'`);
    await suite.db
      .update(locations)
      .set({ province: null })
      .where(eq(locations.id, scope.locationId));
    const before = snapshot();
    expect(await read()).toMatchObject({
      province: null,
      choices: ["Europe/London"],
      suggestion: "Europe/London",
      eligible: true,
    });
    expect(snapshot()).toEqual(before);
  });
  it("shows a valid alias as ineligible without exposing raw invalid text", async () => {
    expect(JSON.stringify(await read())).not.toContain(RAW);
    await suite.db
      .update(locations)
      .set({ timeZone: "US/Eastern" })
      .where(eq(locations.id, scope.locationId));
    expect(await read()).toMatchObject({
      category: "valid",
      eligible: false,
      timeZone: "America/New_York",
    });
  });
});
