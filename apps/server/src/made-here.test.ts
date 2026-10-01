import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deviceProfiles, devices, kitchenStations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setupVenue } from "./testing/venue-fixtures.js";
import { createStation } from "./kitchen.js";
import { readMadeHereStations, listMadeHereStations, setMadeHereStations } from "./made-here.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

describe("device made-here stations", () => {
  it("replaces and deduplicates a device's list, ordered by station id", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({ name: "Till", formFactor: "till", capabilities: [] })
        .returning();
      const [device] = await tx
        .insert(devices)
        .values({
          id: randomUUID(),
          locationId: venue.cfg.locationId,
          tillId: venue.cfg.tillId,
          deviceProfileId: profile!.id,
          label: "Counter",
          tokenHash: "test",
          active: true,
        })
        .returning();
      const bar = await createStation(tx, venue.cfg, { name: "Bar" });
      await setMadeHereStations(tx, venue.cfg, device!.id, [
        bar.id,
        venue.defaultStationId,
        bar.id,
      ]);
      expect(await readMadeHereStations(tx, device!.id)).toEqual(
        new Set([bar.id, venue.defaultStationId]),
      );
      expect((await listMadeHereStations(tx)).get(device!.id)).toEqual(
        [bar.id, venue.defaultStationId].sort(),
      );
      await setMadeHereStations(tx, venue.cfg, device!.id, [bar.id]);
      expect(await readMadeHereStations(tx, device!.id)).toEqual(new Set([bar.id]));
      expect(await readMadeHereStations(tx, undefined)).toEqual(new Set());
    });
  });

  it("refuses switched-off and foreign-location stations with station.not_found", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({ name: "Till", formFactor: "till", capabilities: [] })
        .returning();
      const [device] = await tx
        .insert(devices)
        .values({
          id: randomUUID(),
          locationId: venue.cfg.locationId,
          tillId: venue.cfg.tillId,
          deviceProfileId: profile!.id,
          label: "Counter",
          tokenHash: "test",
          active: true,
        })
        .returning();
      const off = await createStation(tx, venue.cfg, { name: "Off" });
      await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, off.id));
      await expect(setMadeHereStations(tx, venue.cfg, device!.id, [off.id])).rejects.toMatchObject({
        code: "station.not_found",
      });
      await expect(
        setMadeHereStations(
          tx,
          { ...venue.cfg, locationId: randomUUID() as typeof venue.cfg.locationId },
          device!.id,
          [venue.defaultStationId],
        ),
      ).rejects.toMatchObject({ code: "station.not_found" });
      expect(await readMadeHereStations(tx, device!.id)).toEqual(new Set());
    });
  });

  it("keeps two devices on the same profile independent", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({ name: "Shared", formFactor: "till", capabilities: [] })
        .returning();
      const [a, b] = await tx
        .insert(devices)
        .values(
          ["A", "B"].map((label) => ({
            id: randomUUID(),
            locationId: venue.cfg.locationId,
            tillId: venue.cfg.tillId,
            deviceProfileId: profile!.id,
            label,
            tokenHash: "test",
            active: true,
          })),
        )
        .returning();
      await setMadeHereStations(tx, venue.cfg, a!.id, [venue.defaultStationId]);
      expect(await readMadeHereStations(tx, a!.id)).toEqual(new Set([venue.defaultStationId]));
      expect(await readMadeHereStations(tx, b!.id)).toEqual(new Set());
    });
  });
});
