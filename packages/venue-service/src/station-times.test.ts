import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  kitchenStations,
  locations,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { routingModel } from "./routing-store.js";
import { stationDayStates } from "./schema/station-times.js";
import {
  replaceStationHours,
  setStationFallback,
  setStationToday,
  venueMoment,
} from "./station-times.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

async function fixture(tx: Transaction) {
  const [location] = await tx
    .insert(locations)
    .values({
      name: "Venue",
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00:00",
    })
    .returning();
  const cfg = { locationId: locationId(location!.id) };
  const [other] = await tx
    .insert(locations)
    .values({ name: "Other", invoiceLocales: ["en-GB"], operationDescription: "Hospitality" })
    .returning();
  const stations = await tx
    .insert(kitchenStations)
    .values([
      { ...cfg, name: "Upstairs bar" },
      { ...cfg, name: "Downstairs bar" },
      { ...cfg, name: "Kitchen", isDefault: true },
      { ...cfg, name: "Retired", active: false },
      { locationId: locationId(other!.id), name: "Other station" },
    ])
    .returning();
  return {
    cfg,
    upstairs: stations[0]!.id,
    downstairs: stations[1]!.id,
    kitchen: stations[2]!.id,
    retired: stations[3]!.id,
    otherStation: stations[4]!.id,
  };
}

describe("station times", () => {
  it("replaces a station's whole week and refuses another venue's station", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await replaceStationHours(tx, f.cfg, f.upstairs, [
        { weekday: 5, opensAt: "19:00", closesAt: "21:00" },
      ]);
      await replaceStationHours(tx, f.cfg, f.upstairs, [
        { weekday: 6, opensAt: "19:00", closesAt: "21:00" },
      ]);
      const model = await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"));
      expect(model.stationTimes.find((s) => s.stationId === f.upstairs)?.hours).toEqual([
        { weekday: 6, opensAt: "19:00", closesAt: "21:00" },
      ]);
      await expect(replaceStationHours(tx, f.cfg, f.otherStation, [])).rejects.toMatchObject({
        code: "station.not_found",
      });
    });
  });

  it("refuses a switched-off fallback and a fallback loop", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await expect(setStationFallback(tx, f.cfg, f.upstairs, f.retired)).rejects.toMatchObject({
        code: "route.station_inactive",
      });
      await expect(setStationFallback(tx, f.cfg, f.upstairs, f.upstairs)).rejects.toMatchObject({
        code: "station.fallback_loop",
      });
      await setStationFallback(tx, f.cfg, f.upstairs, f.downstairs);
      await expect(setStationFallback(tx, f.cfg, f.downstairs, f.upstairs)).rejects.toMatchObject({
        code: "station.fallback_loop",
      });
      await setStationFallback(tx, f.cfg, f.retired, f.downstairs);
      expect(
        (await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).stationTimes.find(
          (s) => s.stationId === f.retired,
        )?.fallbackStationId,
      ).toBe(f.downstairs);
    });
  });

  it("keeps a by-hand close until cutover and then follows the schedule", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await setStationToday(tx, f.cfg, f.upstairs, "closed", new Date("2026-10-02T21:00:00Z"));
      expect(
        (await routingModel(tx, f.cfg, new Date("2026-10-03T03:59:00Z"))).stationTimes.find(
          (s) => s.stationId === f.upstairs,
        )?.status,
      ).toEqual({ open: false, why: "closed_by_hand" });
      expect(
        (await routingModel(tx, f.cfg, new Date("2026-10-03T04:00:00Z"))).stationTimes.find(
          (s) => s.stationId === f.upstairs,
        )?.status,
      ).toEqual({ open: true, why: "no_hours" });
    });
  });

  it("clears earlier by-hand days and can return to the schedule", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await setStationToday(tx, f.cfg, f.upstairs, "closed", new Date("2026-10-02T21:00:00Z"));
      await setStationToday(tx, f.cfg, f.upstairs, "open", new Date("2026-10-03T10:00:00Z"));
      expect(await tx.select().from(stationDayStates)).toHaveLength(1);
      await setStationToday(tx, f.cfg, f.upstairs, null, new Date("2026-10-03T10:00:00Z"));
      expect(await tx.select().from(stationDayStates)).toHaveLength(0);
    });
  });

  it("refuses a by-hand change when the venue clock is unreadable", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await tx
        .update(locations)
        .set({ timeZone: "Mars/Base" })
        .where(eq(locations.id, f.cfg.locationId));
      await expect(
        setStationToday(tx, f.cfg, f.upstairs, "closed", new Date("2026-10-02T18:00:00Z")),
      ).rejects.toMatchObject({ code: "time_zone.unreadable" });
      expect(await venueMoment(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).toBeNull();
      expect((await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).clockReadable).toBe(
        false,
      );
    });
  });

  it("shows the closed destination and the end of today's change", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await setStationFallback(tx, f.cfg, f.upstairs, f.downstairs);
      const model = await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"));
      expect(model.stationTimes.find((s) => s.stationId === f.upstairs)?.closedSendsTo).toBe(
        f.downstairs,
      );
      expect(
        model.stationTimes.find((s) => s.stationId === f.downstairs)?.closedSendsTo,
      ).toBeNull();
      expect(model.todayEnds).toEqual({ timeOfDay: "06:00", tomorrow: true });
      expect((await routingModel(tx, f.cfg, new Date("2026-10-02T23:30:00Z"))).todayEnds).toEqual({
        timeOfDay: "06:00",
        tomorrow: false,
      });
      expect((await routingModel(tx, f.cfg, new Date("2026-10-03T04:00:00Z"))).todayEnds).toEqual({
        timeOfDay: "06:00",
        tomorrow: true,
      });
    });
  });
});
