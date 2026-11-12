import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  activityLog,
  floorZones,
  kitchenStations,
  persons,
  withTransaction,
} from "@waitron/db";
import { seedDevice, seedVenue, seedZone } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createCatalogue } from "@waitron/catalogue";
import { replaceMenuWeek, saveMenuPeriod } from "./menu-timetable.js";
import { closedZoneIdsAt, replaceZoneClosedWeek } from "./zone-closed-times.js";
import { keepZoneOpen } from "./keep-open.js";
import { setStationToday } from "./station-times.js";
import { routingModel } from "./routing-store.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const at = new Date("2026-11-12T22:00:00Z");
async function fixture() {
  return withTransaction(suite.db, async (tx) => {
    await seedVenue(tx, { timeZone: "Europe/Madrid", dayCutover: "06:00:00" });
    await tx.insert(persons).values([
      { id: "staff", displayName: "Staff" },
      { id: "manager", displayName: "Manager" },
    ]);
    const { deviceId } = await seedDevice(tx);
    const actor = { personId: "staff", deviceId, authorizedBy: "manager" };
    const zone = await seedZone(tx, { name: "Terrace" });
    const menu = await createCatalogue(tx, { name: "Dinner" });
    const period = await saveMenuPeriod(tx, zone.departmentId, {
      name: "Dinner",
      menuId: menu.id,
      staffMenuIds: [],
    });
    await replaceMenuWeek(
      tx,
      zone.departmentId,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: [{ periodId: period.id, startsAt: "21:00", endsAt: "03:00" }],
      })),
      at,
      1,
    );
    await replaceZoneClosedWeek(
      tx,
      zone.id,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        ranges: [{ startsAt: "23:00", endsAt: "06:00" }],
      })),
      1,
    );
    await tx.insert(kitchenStations).values([
      { id: "grill", name: "Grill" },
      { id: "bar", name: "Bar", isDefault: true },
    ]);
    return { zoneId: zone.id, actor };
  });
}
const history = () =>
  suite.db
    .select()
    .from(activityLog)
    .where(eq(activityLog.personId, "staff"))
    .orderBy(activityLog.at, sql`${activityLog}.rowid`);

describe("today's choices history", () => {
  it("records keep-open, its ended times and the authorising manager", async () => {
    const f = await fixture();
    await withTransaction(suite.db, (tx) =>
      keepZoneOpen(tx, f.zoneId, { until: "01:30" }, at, f.actor),
    );
    const [zone] = await suite.db.select().from(floorZones).where(eq(floorZones.id, f.zoneId));
    expect(zone).toMatchObject({
      keptOpenDay: "2026-11-12",
      keptOpenFrom: "23:00:00",
      keptOpenUntil: "01:30:00",
    });
    expect(await history()).toEqual([
      expect.objectContaining({
        kind: "zone.kept_open",
        subjectKind: "zone",
        subjectId: f.zoneId,
        personId: "staff",
        deviceId: f.actor.deviceId,
        at,
        data: {
          businessDay: "2026-11-12",
          from: "23:00:00",
          until: "01:30:00",
          authorizedBy: "manager",
        },
      }),
    ]);
    await withTransaction(suite.db, (tx) =>
      keepZoneOpen(tx, f.zoneId, { until: null }, at, f.actor),
    );
    expect(
      (await suite.db.select().from(floorZones).where(eq(floorZones.id, f.zoneId)))[0],
    ).toMatchObject({ keptOpenDay: null, keptOpenFrom: null, keptOpenUntil: null });
    expect(await history()).toEqual([
      expect.objectContaining({ kind: "zone.kept_open" }),
      expect.objectContaining({
        kind: "zone.keep_open_ended",
        data: {
          businessDay: "2026-11-12",
          from: "23:00:00",
          until: "01:30:00",
          authorizedBy: "manager",
        },
      }),
    ]);
  });
  it("records closure and reopening with the former destination", async () => {
    const f = await fixture();
    await withTransaction(suite.db, (tx) =>
      setStationToday(tx, "grill", "closed", at, f.actor, "bar"),
    );
    expect(
      (await suite.db.select().from(kitchenStations).where(eq(kitchenStations.id, "grill")))[0],
    ).toMatchObject({ closedOnDay: "2026-11-12", closedSendsToStationId: "bar" });
    await suite.db.insert(kitchenStations).values({ id: "fry", name: "Fry" });
    await withTransaction(suite.db, (tx) =>
      setStationToday(tx, "grill", "closed", at, f.actor, "fry"),
    );
    await withTransaction(suite.db, (tx) => setStationToday(tx, "grill", null, at, f.actor));
    expect(
      (await suite.db.select().from(kitchenStations).where(eq(kitchenStations.id, "grill")))[0],
    ).toMatchObject({ closedOnDay: null, closedSendsToStationId: null });
    expect(await history()).toEqual([
      expect.objectContaining({
        kind: "station.closed_for_day",
        subjectKind: "station",
        subjectId: "grill",
        personId: "staff",
        deviceId: f.actor.deviceId,
        at,
        data: { businessDay: "2026-11-12", sendsTo: "bar", authorizedBy: "manager" },
      }),
      expect.objectContaining({
        kind: "station.closed_for_day",
        data: { businessDay: "2026-11-12", sendsTo: "fry", authorizedBy: "manager" },
      }),
      expect.objectContaining({
        kind: "station.reopened",
        data: { businessDay: "2026-11-12", sendsTo: "fry", authorizedBy: "manager" },
      }),
    ]);
  });
  it("adds no history when the current choice does not change", async () => {
    const f = await fixture();
    await withTransaction(suite.db, async (tx) => {
      await tx
        .update(floorZones)
        .set({ keptOpenDay: "2026-11-11", keptOpenFrom: "23:00:00", keptOpenUntil: "01:30:00" })
        .where(eq(floorZones.id, f.zoneId));
      await tx
        .update(kitchenStations)
        .set({ closedOnDay: "2026-11-11", closedSendsToStationId: "bar" })
        .where(eq(kitchenStations.id, "grill"));
      await keepZoneOpen(tx, f.zoneId, { until: null }, at, f.actor);
      await setStationToday(tx, "grill", null, at, f.actor);
    });
    expect(await history()).toEqual([]);
    await withTransaction(suite.db, async (tx) => {
      await keepZoneOpen(tx, f.zoneId, { until: "01:30" }, at, f.actor);
      await keepZoneOpen(tx, f.zoneId, { until: "01:30" }, at, f.actor);
      await setStationToday(tx, "grill", "closed", at, f.actor, "bar");
      await setStationToday(tx, "grill", "closed", at, f.actor, "bar");
    });
    expect((await history()).map((row) => row.kind)).toEqual([
      "zone.kept_open",
      "station.closed_for_day",
    ]);
  });
  it.each([
    ["2026-11-11", true],
    ["2026-11-12", false],
  ])("reads choices stamped %s only on their business day", async (day, open) => {
    const f = await fixture();
    await withTransaction(suite.db, async (tx) => {
      await tx
        .update(floorZones)
        .set({ keptOpenDay: day, keptOpenFrom: "23:00:00", keptOpenUntil: "01:30:00" })
        .where(eq(floorZones.id, f.zoneId));
      await tx
        .update(kitchenStations)
        .set({ closedOnDay: day, closedSendsToStationId: "bar" })
        .where(eq(kitchenStations.id, "grill"));
      expect([...(await closedZoneIdsAt(tx, at, [f.zoneId]))]).toEqual(open ? [f.zoneId] : []);
      expect(
        (await routingModel(tx, at)).stationTimes.find((row) => row.stationId === "grill")?.status,
      ).toMatchObject({ open });
    });
  });
});
