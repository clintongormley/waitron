import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  deviceProfiles,
  devices,
  floorZones,
  locations,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { createDepartment, createServiceZone } from "./operations.js";
import { readProfileServiceScopes, setProfileServiceAccess } from "./profile-access.js";
import { deviceZoneSelections, deviceZoneSelectionZones } from "./schema/device-zone-selection.js";
import { VENUE_SERVICE } from "./service.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);

async function fixture() {
  return run(async (tx) => {
    const [venue] = await tx
      .insert(locations)
      .values({
        name: randomUUID(),
        invoiceLocales: ["en-GB"],
        operationDescription: "Hospitality",
      })
      .returning();
    const cfg = { locationId: locationId(venue!.id) };
    const restaurant = await createDepartment(tx, cfg, { name: "Restaurant", orderStart: "table" });
    const deli = await createDepartment(tx, cfg, { name: "Deli", orderStart: "counter" });
    const dining = await createServiceZone(tx, cfg, {
      name: "Dining",
      departmentId: restaurant.id,
    });
    const terrace = await createServiceZone(tx, cfg, {
      name: "Terrace",
      departmentId: restaurant.id,
    });
    const counter = await createServiceZone(tx, cfg, { name: "Counter", departmentId: deli.id });
    const profiles = await tx
      .insert(deviceProfiles)
      .values([0, 1, 2].map((n) => ({ name: `${randomUUID()} ${n}`, formFactor: "till" as const })))
      .returning();
    const profileId = profiles[0]!.id;
    await setProfileServiceAccess(tx, cfg, profileId, {
      departmentId: restaurant.id,
      allowedZoneIds: null,
      startingZoneId: dining.id,
    });
    await setProfileServiceAccess(tx, cfg, profiles[1]!.id, {
      departmentId: deli.id,
      allowedZoneIds: null,
      startingZoneId: counter.id,
    });
    const enrolled = await tx
      .insert(devices)
      .values(
        [0, 1].map((n) => ({
          ...cfg,
          deviceProfileId: profileId,
          label: `Till ${n}`,
          tokenHash: randomUUID(),
        })),
      )
      .returning();
    return {
      cfg,
      restaurant: restaurant.id,
      dining: dining.id,
      terrace: terrace.id,
      counter: counter.id,
      profileId,
      secondProfileId: profiles[1]!.id,
      unrestrictedProfileId: profiles[2]!.id,
      deviceId: enrolled[0]!.id,
      otherDeviceId: enrolled[1]!.id,
    };
  });
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const read = (f: Fixture, deviceId = f.deviceId) =>
  run((tx) => VENUE_SERVICE.readDeviceZoneSelection(tx, f.cfg, deviceId));
async function save(f: Fixture, selectedZoneIds: string[], startingZoneId: string) {
  const current = await read(f);
  return run((tx) =>
    VENUE_SERVICE.setDeviceZoneSelection(tx, f.cfg, f.deviceId, {
      profileId: current.profileId,
      snapshot: current.snapshot,
      selectedZoneIds,
      startingZoneId,
    }),
  );
}

describe("device zone selection", () => {
  it("defaults to current profile zones and isolates devices and switched profiles", async () => {
    const f = await fixture();
    const profileBefore = await run((tx) => readProfileServiceScopes(tx, [f.profileId]));
    expect(await read(f)).toEqual({
      profileId: f.profileId,
      snapshot: expect.any(String),
      zones: [
        {
          id: f.dining,
          name: "Dining",
          serviceMode: "table_tab",
          departmentId: f.restaurant,
          departmentName: "Restaurant",
        },
        {
          id: f.terrace,
          name: "Terrace",
          serviceMode: "table_tab",
          departmentId: f.restaurant,
          departmentName: "Restaurant",
        },
      ],
      selectedZoneIds: [f.dining, f.terrace],
      startingZoneId: f.dining,
      adjusted: false,
    });
    expect(await save(f, [f.terrace], f.terrace)).toMatchObject({
      selectedZoneIds: [f.terrace],
      startingZoneId: f.terrace,
      adjusted: false,
    });
    expect(await read(f, f.otherDeviceId)).toMatchObject({
      selectedZoneIds: [f.dining, f.terrace],
      startingZoneId: f.dining,
    });
    await run((tx) =>
      tx
        .update(devices)
        .set({ deviceProfileId: f.secondProfileId })
        .where(eq(devices.id, f.deviceId)),
    );
    expect(await read(f)).toMatchObject({
      profileId: f.secondProfileId,
      selectedZoneIds: [f.counter],
      startingZoneId: f.counter,
    });
    await save(f, [f.counter], f.counter);
    expect(await run((tx) => VENUE_SERVICE.countDeviceZoneSelections(tx, f.deviceId))).toBe(2);
    await run((tx) =>
      tx.update(devices).set({ deviceProfileId: f.profileId }).where(eq(devices.id, f.deviceId)),
    );
    expect(await read(f)).toMatchObject({
      selectedZoneIds: [f.terrace],
      startingZoneId: f.terrace,
    });
    expect(await run((tx) => readProfileServiceScopes(tx, [f.profileId]))).toEqual(profileBefore);
  });

  it("temporarily falls back within current access and restores retained choices", async () => {
    const f = await fixture();
    const saved = await save(f, [f.terrace], f.terrace);
    await run((tx) =>
      setProfileServiceAccess(tx, f.cfg, f.profileId, {
        departmentId: f.restaurant,
        allowedZoneIds: [f.dining],
        startingZoneId: f.dining,
      }),
    );
    expect(await read(f)).toMatchObject({
      selectedZoneIds: [f.dining],
      startingZoneId: f.dining,
      adjusted: true,
    });
    await run((tx) =>
      setProfileServiceAccess(tx, f.cfg, f.profileId, {
        departmentId: f.restaurant,
        allowedZoneIds: null,
        startingZoneId: f.dining,
      }),
    );
    expect(await read(f)).toEqual(saved);
    await run((tx) =>
      tx.update(floorZones).set({ active: false }).where(eq(floorZones.id, f.terrace)),
    );
    expect(await read(f)).toMatchObject({ selectedZoneIds: [f.dining], adjusted: true });
    await run((tx) =>
      tx.update(floorZones).set({ active: false }).where(eq(floorZones.id, f.dining)),
    );
    expect(await read(f)).toMatchObject({
      zones: [],
      selectedZoneIds: [],
      startingZoneId: null,
      adjusted: true,
    });
    await run((tx) =>
      tx.update(floorZones).set({ active: true }).where(eq(floorZones.id, f.terrace)),
    );
    expect(await read(f)).toMatchObject({
      selectedZoneIds: [f.terrace],
      startingZoneId: f.terrace,
      adjusted: false,
    });
  });

  it("resolves a profile with no department against active venue service zones", async () => {
    const f = await fixture();
    await run((tx) =>
      tx
        .update(devices)
        .set({ deviceProfileId: f.unrestrictedProfileId })
        .where(eq(devices.id, f.deviceId)),
    );
    const current = await read(f);
    expect(current.selectedZoneIds).toEqual([f.counter, f.dining, f.terrace]);
    expect(current.zones.map((z) => z.serviceMode)).toEqual(["prepay", "table_tab", "table_tab"]);
    expect(await save(f, [f.counter, f.terrace], f.terrace)).toMatchObject({
      selectedZoneIds: [f.counter, f.terrace],
      startingZoneId: f.terrace,
    });
  });

  it.each(["profileId", "snapshot", "selectedZoneIds", "startingZoneId"] as const)(
    "refuses malformed %s without writing",
    async (field) => {
      const f = await fixture();
      const current = await read(f);
      for (const value of [null, 42, {}, []]) {
        const input = {
          profileId: current.profileId,
          snapshot: current.snapshot,
          selectedZoneIds: [f.dining],
          startingZoneId: f.dining,
          [field]: value,
        };
        await expect(
          run((tx) => VENUE_SERVICE.setDeviceZoneSelection(tx, f.cfg, f.deviceId, input as never)),
        ).rejects.toMatchObject({ code: "device_zones.invalid", params: { field } });
      }
      expect(await read(f)).toEqual(current);
      expect(await run((tx) => VENUE_SERVICE.countDeviceZoneSelections(tx, f.deviceId))).toBe(0);
    },
  );

  it("refuses forged choices, empty selections and a start outside the subset", async () => {
    const f = await fixture();
    for (const ids of [[], [f.counter], [randomUUID()], [f.dining, null], [f.dining, f.dining]]) {
      await expect(save(f, ids as string[], f.dining)).rejects.toMatchObject({
        code: "device_zones.invalid",
        params: { field: "selectedZoneIds" },
      });
    }
    await expect(save(f, [f.dining], f.terrace)).rejects.toMatchObject({
      code: "device_zones.invalid",
      params: { field: "startingZoneId" },
    });
    expect(await run((tx) => VENUE_SERVICE.countDeviceZoneSelections(tx, f.deviceId))).toBe(0);
  });

  it("rejects a superseded snapshot and profile while allowing a fresh save", async () => {
    const f = await fixture();
    const current = await read(f);
    const input = {
      profileId: current.profileId,
      snapshot: current.snapshot,
      selectedZoneIds: [f.dining],
      startingZoneId: f.dining,
    };
    await save(f, [f.terrace], f.terrace);
    await expect(
      run((tx) => VENUE_SERVICE.setDeviceZoneSelection(tx, f.cfg, f.deviceId, input)),
    ).rejects.toMatchObject({ code: "device_zones.changed" });
    await run((tx) =>
      tx
        .update(devices)
        .set({ deviceProfileId: f.secondProfileId })
        .where(eq(devices.id, f.deviceId)),
    );
    await expect(
      run((tx) => VENUE_SERVICE.setDeviceZoneSelection(tx, f.cfg, f.deviceId, input)),
    ).rejects.toMatchObject({ code: "device_zones.changed" });
    expect(await save(f, [f.counter], f.counter)).toMatchObject({
      selectedZoneIds: [f.counter],
      startingZoneId: f.counter,
    });
  });

  it("refuses a foreign, deleted or unknown device", async () => {
    const f = await fixture();
    const other = await fixture();
    await expect(read(f, other.deviceId)).rejects.toMatchObject({ code: "device.not_found" });
    await expect(read(f, randomUUID())).rejects.toMatchObject({ code: "device.not_found" });
    await run((tx) =>
      tx
        .update(devices)
        .set({ deletedAt: new Date().toISOString() })
        .where(eq(devices.id, f.deviceId)),
    );
    await expect(read(f)).rejects.toMatchObject({ code: "device.not_found" });
  });

  it("retains disabled device preferences and removes every saved profile for only the named device", async () => {
    const f = await fixture();
    await save(f, [f.terrace], f.terrace);
    await run(async (tx) => {
      const current = await VENUE_SERVICE.readDeviceZoneSelection(tx, f.cfg, f.otherDeviceId);
      await VENUE_SERVICE.setDeviceZoneSelection(tx, f.cfg, f.otherDeviceId, {
        ...current,
        startingZoneId: f.dining,
      });
      await tx.update(devices).set({ active: false }).where(eq(devices.id, f.deviceId));
    });
    expect(await read(f)).toMatchObject({ selectedZoneIds: [f.terrace] });
    await run((tx) => VENUE_SERVICE.removeDeviceZoneSelections(tx, f.deviceId));
    expect(await run((tx) => VENUE_SERVICE.countDeviceZoneSelections(tx, f.deviceId))).toBe(0);
    expect(await run((tx) => VENUE_SERVICE.countDeviceZoneSelections(tx, f.otherDeviceId))).toBe(1);
    expect(await read(f)).toMatchObject({ selectedZoneIds: [f.dining, f.terrace] });
  });
});

it("keeps a saved selection when its write transaction rolls back", async () => {
  const f = await fixture();
  const before = await save(f, [f.terrace], f.terrace);
  await expect(
    run(async (tx) => {
      await VENUE_SERVICE.setDeviceZoneSelection(tx, f.cfg, f.deviceId, {
        ...before,
        selectedZoneIds: [f.dining],
        startingZoneId: f.dining,
      });
      throw new Error("rollback selection");
    }),
  ).rejects.toThrow("rollback selection");
  expect(await read(f)).toEqual(before);
});

it("canonicalises UUID spelling and set order without changing the snapshot", async () => {
  const f = await fixture();
  const before = await save(f, [f.terrace, f.dining], f.dining);
  const after = await run((tx) =>
    VENUE_SERVICE.setDeviceZoneSelection(tx, f.cfg, f.deviceId, {
      profileId: f.profileId.toUpperCase(),
      snapshot: before.snapshot,
      selectedZoneIds: [f.dining.toUpperCase(), f.terrace.toUpperCase()],
      startingZoneId: f.dining.toUpperCase(),
    }),
  );
  expect(after).toEqual(before);
});

it("invalidates a snapshot after profile capability, zone wording or department changes", async () => {
  const f = await fixture();
  const current = await read(f);
  const input = { ...current, selectedZoneIds: [f.dining], startingZoneId: f.dining };
  await run((tx) =>
    tx
      .update(deviceProfiles)
      .set({ capabilities: ["act-as-till"] })
      .where(eq(deviceProfiles.id, f.profileId)),
  );
  expect((await read(f)).snapshot).not.toBe(current.snapshot);
  await expect(
    run((tx) => VENUE_SERVICE.setDeviceZoneSelection(tx, f.cfg, f.deviceId, input)),
  ).rejects.toMatchObject({ code: "device_zones.changed" });
  const capability = await read(f);
  await run((tx) =>
    tx.update(floorZones).set({ name: "Dining upstairs" }).where(eq(floorZones.id, f.dining)),
  );
  expect((await read(f)).snapshot).not.toBe(capability.snapshot);
  await run((tx) =>
    setProfileServiceAccess(tx, f.cfg, f.profileId, {
      departmentId: null,
      allowedZoneIds: null,
      startingZoneId: null,
    }),
  );
  expect((await read(f)).snapshot).not.toBe(capability.snapshot);
});

it("enforces parent and child foreign keys and both composite primary keys on actual writes", async () => {
  const f = await fixture();
  const parent = { deviceId: f.deviceId, deviceProfileId: f.profileId, startingZoneId: f.dining };
  for (const values of [
    { ...parent, deviceId: randomUUID() },
    { ...parent, deviceProfileId: randomUUID() },
    { ...parent, startingZoneId: randomUUID() },
  ]) {
    await expect(run((tx) => tx.insert(deviceZoneSelections).values(values))).rejects.toThrow(
      /FOREIGN KEY constraint failed/,
    );
  }
  await expect(
    run((tx) =>
      tx
        .insert(deviceZoneSelectionZones)
        .values({ deviceId: f.deviceId, deviceProfileId: f.profileId, zoneId: f.dining }),
    ),
  ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  await save(f, [f.dining], f.dining);
  await expect(run((tx) => tx.insert(deviceZoneSelections).values(parent))).rejects.toThrow(
    /UNIQUE constraint failed/,
  );
  await expect(
    run((tx) =>
      tx
        .insert(deviceZoneSelectionZones)
        .values({ deviceId: f.deviceId, deviceProfileId: f.profileId, zoneId: f.dining }),
    ),
  ).rejects.toThrow(/UNIQUE constraint failed/);
  await expect(
    run((tx) =>
      tx
        .insert(deviceZoneSelectionZones)
        .values({ deviceId: f.deviceId, deviceProfileId: f.profileId, zoneId: randomUUID() }),
    ),
  ).rejects.toThrow(/FOREIGN KEY constraint failed/);
});

it("retains every permitted zone's department metadata when the display subset hides one", async () => {
  const f = await fixture();
  await save(f, [f.terrace], f.terrace);
  const answer = await read(f);
  expect(answer.selectedZoneIds).toEqual([f.terrace]);
  expect(answer.zones).toEqual([
    {
      id: f.dining,
      name: "Dining",
      serviceMode: "table_tab",
      departmentId: f.restaurant,
      departmentName: "Restaurant",
    },
    {
      id: f.terrace,
      name: "Terrace",
      serviceMode: "table_tab",
      departmentId: f.restaurant,
      departmentName: "Restaurant",
    },
  ]);
});
