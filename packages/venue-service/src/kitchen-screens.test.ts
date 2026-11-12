import { eq, inArray, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  deviceKitchenScreenRemovals,
  deviceKitchenScreens,
  deviceKitchenScreenStations,
  deviceKitchenScreenZones,
  deviceProfileKitchenScreens,
  deviceProfileKitchenScreenStations,
  deviceProfileKitchenScreenZones,
  deviceProfiles,
  devices,
  floorZones,
  kitchenStations,
  withTransaction,
  venueLocationId,
} from "@waitron/db";
import { randomUUID } from "node:crypto";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice as seedSharedDevice, seedVenue } from "@waitron/db/testing/seed.js";
import { AppError } from "@waitron/shared";
import type { DeviceKitchenScreen, ProfileKitchenScreens } from "@waitron/module";
import { createDepartment, createServiceZone } from "./operations.js";
import {
  addProfileKitchenScreen,
  copyProfileKitchenScreens,
  assertDeviceKitchenScreens,
  assertKitchenDisplayHasScreen,
  assertPassScreenZone,
  narrowDeviceKitchenScreens,
  readDeviceKitchenScreens,
  readDevicesKitchenScreens,
  readProfileKitchenScreens,
  readStationScreens,
  setDeviceKitchenScreenDisplay,
  setDeviceKitchenScreens,
  setProfileKitchenScreens,
} from "./kitchen-screens.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  timeoutMs: 60_000,
});

let db: Database;

beforeAll(() => {
  db = suite.db;
});

function scoped<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, fn);
}

async function outcome(promise: Promise<unknown>): Promise<unknown> {
  try {
    return { resolved: await promise };
  } catch (error) {
    if (error instanceof AppError) return { code: error.code, params: { ...error.params } };
    throw error;
  }
}

const refused = (field: string, reason: string) => ({
  code: "device_profile.access_invalid",
  params: { field, reason },
});

async function seedLocation(): Promise<string> {
  await seedVenue(db, {
    name: `Venue ${randomUUID()}`,
    invoiceLocales: ["en-GB"],
    operationDescription: "Hospitality",
  });
  const venueId = await venueLocationId(db);
  return venueId;
}

async function seedProfile(formFactor: "till" | "phone-portrait" | "kds"): Promise<string> {
  const [row] = await db
    .insert(deviceProfiles)
    .values({ name: `Profile ${randomUUID()}`, formFactor })
    .returning({ id: deviceProfiles.id });
  return row!.id;
}

async function seedStation(name: string) {
  const [row] = await db
    .insert(kitchenStations)
    .values({ name })
    .returning({ id: kitchenStations.id });
  return row!.id;
}

/**
 * Stations Grill, Cold and Pastry, shown Cold, Grill, Pastry; zones Terrace, Dining room and
 * Counter, shown Terrace, Dining room, Counter; a kitchen display profile and a till profile.
 */
async function seedVenueWithStations() {
  const locationId = await seedLocation();
  const cfg = { locationId };
  const grill = await seedStation("Grill");
  const cold = await seedStation("Cold");
  const pastry = await seedStation("Pastry");
  const zones = await scoped(async (tx) => {
    const restaurant = await createDepartment(tx, {
      name: "Restaurant",
      orderStart: "table",
    });
    const dining = await createServiceZone(tx, {
      name: "Dining room",
      departmentId: restaurant.id,
    });
    const terrace = await createServiceZone(tx, {
      name: "Terrace",
      departmentId: restaurant.id,
    });
    const counter = await createServiceZone(tx, {
      name: "Counter",
      departmentId: restaurant.id,
    });
    await tx.update(floorZones).set({ displayOrder: 2 }).where(eq(floorZones.id, dining.id));
    await tx.update(floorZones).set({ displayOrder: 1 }).where(eq(floorZones.id, terrace.id));
    await tx.update(floorZones).set({ displayOrder: 3 }).where(eq(floorZones.id, counter.id));
    return { dining: dining.id, terrace: terrace.id, counter: counter.id };
  });
  return {
    cfg,
    grill,
    cold,
    pastry,
    ...zones,
    kds: await seedProfile("kds"),
    till: await seedProfile("till"),
  };
}

type Venue = Awaited<ReturnType<typeof seedVenueWithStations>>;

const set = (profileId: string, screens: ProfileKitchenScreens) =>
  scoped((tx) => setProfileKitchenScreens(tx, profileId, screens));

async function screensOf(profileId: string) {
  const all = await scoped((tx) => readProfileKitchenScreens(tx));
  return all.find((entry) => entry.profileId === profileId)?.screens;
}

describe("a profile's kitchen screens", () => {
  it("stores each kind a kitchen display offers, stations by name and zones in display order", async () => {
    const venue = await seedVenueWithStations();
    await expect(
      set(venue.kds, {
        station: { stationIds: [venue.grill, venue.cold, venue.grill], zoneIds: null },
        pass: { stationIds: null, zoneIds: [venue.counter, venue.terrace] },
        pass_monitor: { stationIds: [venue.pastry, venue.cold], zoneIds: null },
      }),
    ).resolves.toEqual([]);
    await expect(screensOf(venue.kds)).resolves.toEqual({
      station: { stationIds: [venue.cold, venue.grill], zoneIds: null },
      pass: {
        stationIds: null,
        zoneIds: [venue.terrace, venue.counter],
        showNonPassStations: true,
      },
      pass_monitor: {
        stationIds: [venue.cold, venue.pastry],
        zoneIds: null,
        showNonPassStations: true,
      },
    });
    expect(
      await db
        .select()
        .from(deviceProfileKitchenScreenStations)
        .where(eq(deviceProfileKitchenScreenStations.deviceProfileId, venue.kds)),
    ).toHaveLength(4);
  });

  it("lets a till bound a station screen and a pass screen", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.till, {
      station: { stationIds: null, zoneIds: null },
      pass: { stationIds: [venue.grill], zoneIds: [venue.dining] },
    });
    await expect(screensOf(venue.till)).resolves.toEqual({
      station: { stationIds: null, zoneIds: null },
      pass: { stationIds: [venue.grill], zoneIds: [venue.dining], showNonPassStations: true },
    });
  });

  it("reads every live profile, one with nothing stored as no screens, and no retired one", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { station: { stationIds: [venue.grill], zoneIds: null } });
    await db
      .update(deviceProfiles)
      .set({ retiredAt: new Date().toISOString() })
      .where(eq(deviceProfiles.id, venue.kds));
    const all = await scoped((tx) => readProfileKitchenScreens(tx));
    expect(all.find((entry) => entry.profileId === venue.kds)).toBeUndefined();
    expect(all.find((entry) => entry.profileId === venue.till)).toEqual({
      profileId: venue.till,
      screens: {},
    });
  });

  it("omits deleted stations and zones", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, {
      pass: { stationIds: [venue.grill, venue.cold], zoneIds: [venue.dining, venue.terrace] },
    });
    await db
      .update(kitchenStations)
      .set({ active: false })
      .where(eq(kitchenStations.id, venue.cold));
    await db.update(floorZones).set({ active: false }).where(eq(floorZones.id, venue.terrace));
    await expect(screensOf(venue.kds)).resolves.toEqual({
      pass: { stationIds: [venue.grill], zoneIds: [venue.dining], showNonPassStations: true },
    });
  });

  it("replaces every kind on each save, dropping a kind it does not name", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, {
      station: { stationIds: [venue.grill], zoneIds: null },
      pass: { stationIds: null, zoneIds: null },
    });
    await set(venue.kds, { station: { stationIds: [venue.cold], zoneIds: null } });
    await expect(screensOf(venue.kds)).resolves.toEqual({
      station: { stationIds: [venue.cold], zoneIds: null },
    });
    await set(venue.kds, {});
    await expect(screensOf(venue.kds)).resolves.toEqual({});
  });

  it("lets a till profile and a handheld profile each store a pass monitor", async () => {
    const venue = await seedVenueWithStations();
    const handheld = await seedProfile("phone-portrait");
    for (const profileId of [venue.till, handheld]) {
      await expect(
        set(profileId, {
          pass_monitor: { stationIds: [venue.pastry, venue.grill], zoneIds: [venue.counter] },
        }),
      ).resolves.toEqual([]);
      await expect(screensOf(profileId)).resolves.toEqual({
        pass_monitor: {
          stationIds: [venue.grill, venue.pastry],
          zoneIds: [venue.counter],
          showNonPassStations: true,
        },
      });
    }
  });

  it("refuses zones on a station screen", async () => {
    const venue = await seedVenueWithStations();
    await expect(
      outcome(set(venue.kds, { station: { stationIds: null, zoneIds: [venue.dining] } })),
    ).resolves.toEqual(refused("kitchenScreens", "not_for_screen"));
  });

  it("refuses an explicit empty list, naming its field", async () => {
    const venue = await seedVenueWithStations();
    const every = { stationIds: null, zoneIds: null };
    for (const [screens, field] of [
      [{ station: { stationIds: [], zoneIds: null } }, "stationScreenStations"],
      [{ pass: { ...every, stationIds: [] } }, "passScreenStations"],
      [{ pass: { ...every, zoneIds: [] } }, "passScreenZones"],
      [{ pass_monitor: { ...every, stationIds: [] } }, "passMonitorStations"],
      [{ pass_monitor: { ...every, zoneIds: [] } }, "passMonitorZones"],
    ] as const) {
      await expect(outcome(set(venue.kds, screens))).resolves.toEqual(refused(field, "empty"));
    }
    await expect(screensOf(venue.kds)).resolves.toEqual({});
  });

  it("refuses an unknown station or zone, or one switched off", async () => {
    const venue = await seedVenueWithStations();
    const offStation = await seedStation("Old grill");
    await db
      .update(kitchenStations)
      .set({ active: false })
      .where(eq(kitchenStations.id, offStation));
    await db.update(floorZones).set({ active: false }).where(eq(floorZones.id, venue.counter));
    const every = { stationIds: null, zoneIds: null };
    for (const [screens, field] of [
      [{ station: { stationIds: [randomUUID()], zoneIds: null } }, "stationScreenStations"],
      [{ station: { stationIds: [offStation], zoneIds: null } }, "stationScreenStations"],
      [{ pass: { ...every, stationIds: [venue.grill, offStation] } }, "passScreenStations"],
      [{ pass: { ...every, zoneIds: [venue.dining, venue.counter] } }, "passScreenZones"],
      [{ pass_monitor: { ...every, stationIds: [offStation] } }, "passMonitorStations"],
      [{ pass_monitor: { ...every, zoneIds: [randomUUID()] } }, "passMonitorZones"],
    ] as const) {
      await expect(outcome(set(venue.kds, screens))).resolves.toEqual(refused(field, "not_found"));
    }
    await expect(screensOf(venue.kds)).resolves.toEqual({});
  });

  it("refuses deleted stations and previously stored deleted zones", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, {
      pass: { stationIds: [venue.grill, venue.cold], zoneIds: [venue.dining] },
    });
    await db
      .update(kitchenStations)
      .set({ active: false })
      .where(inArray(kitchenStations.id, [venue.grill, venue.pastry]));
    await db
      .update(floorZones)
      .set({ active: false })
      .where(inArray(floorZones.id, [venue.dining, venue.counter]));
    await expect(
      outcome(
        set(venue.kds, {
          pass: { stationIds: [venue.grill, venue.cold], zoneIds: [venue.dining] },
        }),
      ),
    ).resolves.toEqual(refused("passScreenStations", "not_found"));
    await expect(
      outcome(set(venue.kds, { pass: { stationIds: [venue.cold], zoneIds: [venue.dining] } })),
    ).resolves.toEqual(refused("passScreenZones", "not_found"));
    await expect(screensOf(venue.kds)).resolves.toEqual({
      pass: { stationIds: [venue.cold], zoneIds: [], showNonPassStations: true },
    });
    await expect(
      outcome(
        set(venue.kds, {
          pass: { stationIds: [venue.grill, venue.pastry], zoneIds: [venue.dining] },
        }),
      ),
    ).resolves.toEqual(refused("passScreenStations", "not_found"));
    await expect(
      outcome(
        set(venue.kds, {
          pass: { stationIds: [venue.cold], zoneIds: [venue.dining, venue.counter] },
        }),
      ),
    ).resolves.toEqual(refused("passScreenZones", "not_found"));
    // Stored for the pass screen is not stored for the station screen.
    await expect(
      outcome(
        set(venue.kds, {
          station: { stationIds: [venue.grill], zoneIds: null },
          pass: { stationIds: [venue.cold], zoneIds: [] },
        }),
      ),
    ).resolves.toEqual(refused("stationScreenStations", "not_found"));
  });

  it("refuses the screens of a profile that is unknown or retired", async () => {
    const venue = await seedVenueWithStations();
    await db
      .update(deviceProfiles)
      .set({ retiredAt: new Date().toISOString() })
      .where(eq(deviceProfiles.id, venue.kds));
    await expect(outcome(set(venue.kds, {}))).resolves.toEqual(refused("profileId", "not_found"));
    await expect(outcome(set(randomUUID(), {}))).resolves.toEqual(
      refused("profileId", "not_found"),
    );
  });
});

describe("a profile whose form factor changes", () => {
  it("keeps a kitchen display's pass monitor once the profile is a till, and saves it again", async () => {
    const venue = await seedVenueWithStations();
    const screens = {
      station: { stationIds: null, zoneIds: null },
      pass_monitor: { stationIds: [venue.grill], zoneIds: [venue.dining] },
    };
    await set(venue.kds, screens);
    await db
      .update(deviceProfiles)
      .set({ formFactor: "till" })
      .where(eq(deviceProfiles.id, venue.kds));
    const read = {
      ...screens,
      pass_monitor: { ...screens.pass_monitor, showNonPassStations: true },
    };
    await expect(screensOf(venue.kds)).resolves.toEqual(read);
    await expect(outcome(set(venue.kds, screens))).resolves.toEqual({ resolved: [] });
    await expect(screensOf(venue.kds)).resolves.toEqual(read);
  });
});

describe("a kitchen screen added to a profile", () => {
  const add = (profileId: string, screen: Parameters<typeof addProfileKitchenScreen>[2]) =>
    scoped((tx) => addProfileKitchenScreen(tx, profileId, screen));

  it("creates the profile's row with the lists it is given", async () => {
    const venue = await seedVenueWithStations();
    await add(venue.kds, { kind: "station", stationIds: [venue.grill], zoneIds: null });
    await add(venue.kds, {
      kind: "pass",
      stationIds: null,
      zoneIds: [venue.dining],
    });
    await expect(screensOf(venue.kds)).resolves.toEqual({
      station: { stationIds: [venue.grill], zoneIds: null },
      pass: { stationIds: null, zoneIds: [venue.dining], showNonPassStations: true },
    });
  });

  it("adds the stations and zones an explicit list lacks, removing none", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, {
      pass: { stationIds: [venue.grill], zoneIds: [venue.dining] },
    });
    await add(venue.kds, {
      kind: "pass",
      stationIds: [venue.cold, venue.grill],
      zoneIds: [venue.terrace],
    });
    await expect(screensOf(venue.kds)).resolves.toEqual({
      pass: {
        stationIds: [venue.cold, venue.grill],
        zoneIds: [venue.terrace, venue.dining],
        showNonPassStations: true,
      },
    });
  });

  it("turns an explicit list into every one when given every one", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, {
      pass: { stationIds: [venue.grill], zoneIds: [venue.dining] },
    });
    await add(venue.kds, { kind: "pass", stationIds: null, zoneIds: null });
    await expect(screensOf(venue.kds)).resolves.toEqual({
      pass: { stationIds: null, zoneIds: null, showNonPassStations: true },
    });
  });

  it("changes nothing on an every list, and leaves the other kinds alone", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, {
      station: { stationIds: null, zoneIds: null },
      pass_monitor: { stationIds: [venue.grill], zoneIds: null },
    });
    await add(venue.kds, { kind: "station", stationIds: [venue.cold], zoneIds: null });
    await expect(screensOf(venue.kds)).resolves.toEqual({
      station: { stationIds: null, zoneIds: null },
      pass_monitor: { stationIds: [venue.grill], zoneIds: null, showNonPassStations: true },
    });
    expect(
      await db
        .select()
        .from(deviceProfileKitchenScreens)
        .where(eq(deviceProfileKitchenScreens.deviceProfileId, venue.kds)),
    ).toHaveLength(2);
  });
});

async function seedDevice(profileId: string, label: string): Promise<string> {
  return (await seedSharedDevice(db, { profileId, label })).deviceId;
}

const choose = (deviceId: string, profileId: string, screens: readonly DeviceKitchenScreen[]) =>
  scoped((tx) => setDeviceKitchenScreens(tx, { deviceId, profileId, screens }));

const shown = (deviceId: string) => scoped((tx) => readDeviceKitchenScreens(tx, deviceId));

async function recordRemoval(
  deviceId: string,
  screen: DeviceKitchenScreen["kind"],
  target: { stationId?: string; zoneId?: string } = {},
) {
  await db.insert(deviceKitchenScreenRemovals).values({ deviceId, screen, ...target });
}

const removalsOf = (deviceId: string) =>
  db
    .select()
    .from(deviceKitchenScreenRemovals)
    .where(eq(deviceKitchenScreenRemovals.deviceId, deviceId));

const storedKindsOf = async (deviceId: string) =>
  (
    await db
      .select({ screen: deviceKitchenScreens.screen })
      .from(deviceKitchenScreens)
      .where(eq(deviceKitchenScreens.deviceId, deviceId))
  ).map((row) => row.screen);

const invalid = (field: string, reason: string, screen?: DeviceKitchenScreen["kind"]) => ({
  code: "kitchen_screen.invalid",
  params: { field, reason, ...(screen === undefined ? {} : { screen }) },
});

const every = { stationIds: null, zoneIds: null };

describe("the kitchen screens a device chooses", () => {
  async function kitchen() {
    const venue = await seedVenueWithStations();
    await set(venue.kds, {
      station: { stationIds: [venue.grill, venue.cold], zoneIds: null },
      pass: { stationIds: null, zoneIds: [venue.dining, venue.terrace] },
      pass_monitor: every,
    });
    const screen = await seedDevice(venue.kds, "Pass screen");
    const till = await seedDevice(venue.till, "Till");
    return { venue, screen, till };
  }

  it("asks a kitchen display for exactly one, and refuses a kind named twice anywhere", async () => {
    const { venue, screen, till } = await kitchen();
    await expect(outcome(choose(screen, venue.kds, []))).resolves.toEqual({
      code: "kitchen_screen.required",
      params: {},
    });
    await expect(
      outcome(
        choose(screen, venue.kds, [
          { kind: "station", ...every },
          { kind: "pass", ...every },
        ]),
      ),
    ).resolves.toEqual(invalid("screens", "one_only"));
    await expect(
      outcome(
        choose(till, venue.till, [
          { kind: "station", ...every },
          { kind: "station", stationIds: [venue.grill], zoneIds: null },
        ]),
      ),
    ).resolves.toEqual(invalid("screens", "one_only"));
    expect(await storedKindsOf(screen)).toEqual([]);
    expect(await storedKindsOf(till)).toEqual([]);
  });

  it("refuses a kind the profile does not offer, and a pass monitor on a profile with no pass monitor row", async () => {
    const { venue, screen, till } = await kitchen();
    await set(venue.kds, { station: every });
    await expect(outcome(choose(screen, venue.kds, [{ kind: "pass", ...every }]))).resolves.toEqual(
      { code: "kitchen_screen.not_allowed", params: { screen: "pass" } },
    );
    await expect(
      outcome(choose(till, venue.till, [{ kind: "pass_monitor", ...every }])),
    ).resolves.toEqual({ code: "kitchen_screen.not_allowed", params: { screen: "pass_monitor" } });
  });

  it("lets a till and a handheld choose a pass monitor within their profile's row, and read it back", async () => {
    const venue = await seedVenueWithStations();
    const handheldProfile = await seedProfile("phone-portrait");
    const row = { stationIds: [venue.grill, venue.cold], zoneIds: [venue.dining, venue.terrace] };
    for (const profileId of [venue.till, handheldProfile]) {
      await set(profileId, { pass_monitor: row });
      const device = await seedDevice(profileId, `Device ${profileId}`);
      await expect(
        outcome(
          choose(device, profileId, [
            { kind: "pass_monitor", stationIds: [venue.grill], zoneIds: [venue.terrace] },
          ]),
        ),
      ).resolves.toEqual({ resolved: undefined });
      await expect(shown(device)).resolves.toEqual([
        {
          kind: "pass_monitor",
          available: true,
          everyStation: false,
          everyZone: false,
          profileEveryStation: false,
          showNonPassStations: true,
          nonPassStationsOverride: null,
          stations: [{ id: venue.grill, name: "Grill", available: true, switchedOff: false }],
          zones: [{ id: venue.terrace, name: "Terrace", available: true, switchedOff: false }],
        },
      ]);
    }
  });

  it("refuses a till's pass monitor station or zone outside its profile's row", async () => {
    const { venue, till } = await kitchen();
    await set(venue.till, {
      pass_monitor: { stationIds: [venue.grill], zoneIds: [venue.dining] },
    });
    await expect(
      outcome(
        choose(till, venue.till, [
          { kind: "pass_monitor", stationIds: [venue.pastry], zoneIds: null },
        ]),
      ),
    ).resolves.toEqual({
      code: "station.not_allowed",
      params: { stationId: venue.pastry, screen: "pass_monitor" },
    });
    await expect(
      outcome(
        choose(till, venue.till, [
          { kind: "pass_monitor", stationIds: [venue.grill], zoneIds: [venue.counter] },
        ]),
      ),
    ).resolves.toEqual({
      code: "kitchen_screen.zone_not_allowed",
      params: { zoneId: venue.counter },
    });
    expect(await storedKindsOf(till)).toEqual([]);
  });

  it("refuses a till choosing both a pass screen and a pass monitor", async () => {
    const { venue, till } = await kitchen();
    await set(venue.till, { pass: every, pass_monitor: every });
    await expect(
      outcome(
        choose(till, venue.till, [
          { kind: "pass", ...every },
          { kind: "pass_monitor", ...every },
        ]),
      ),
    ).resolves.toEqual(invalid("screens", "one_only"));
    expect(await storedKindsOf(till)).toEqual([]);
    await expect(
      outcome(
        choose(till, venue.till, [
          { kind: "station", ...every },
          { kind: "pass_monitor", ...every },
        ]),
      ),
    ).resolves.toEqual({ resolved: undefined });
  });

  it("refuses a station or zone outside the profile's explicit list", async () => {
    const { venue, screen } = await kitchen();
    await expect(
      outcome(
        choose(screen, venue.kds, [
          { kind: "station", stationIds: [venue.grill, venue.pastry], zoneIds: null },
        ]),
      ),
    ).resolves.toEqual({
      code: "station.not_allowed",
      params: { stationId: venue.pastry, screen: "station" },
    });
    await expect(
      outcome(
        choose(screen, venue.kds, [
          { kind: "pass", stationIds: [venue.pastry], zoneIds: [venue.terrace, venue.counter] },
        ]),
      ),
    ).resolves.toEqual({
      code: "kitchen_screen.zone_not_allowed",
      params: { zoneId: venue.counter },
    });
  });

  it("refuses zones on a station screen, and an explicit empty list", async () => {
    const { venue, screen, till } = await kitchen();
    await expect(
      outcome(
        choose(screen, venue.kds, [{ kind: "station", stationIds: null, zoneIds: [venue.dining] }]),
      ),
    ).resolves.toEqual(invalid("zoneIds", "not_for_screen", "station"));
    await expect(
      outcome(choose(till, venue.till, [{ kind: "station", stationIds: [], zoneIds: null }])),
    ).resolves.toEqual(invalid("stationIds", "empty", "station"));
    await expect(
      outcome(choose(screen, venue.kds, [{ kind: "pass", stationIds: null, zoneIds: [] }])),
    ).resolves.toEqual(invalid("zoneIds", "empty", "pass"));
  });

  it("refuses an unknown station or zone, or one switched off", async () => {
    const { venue, till } = await kitchen();
    await db
      .update(kitchenStations)
      .set({ active: false })
      .where(eq(kitchenStations.id, venue.cold));
    await db.update(floorZones).set({ active: false }).where(eq(floorZones.id, venue.terrace));
    for (const [screen, field] of [
      [{ kind: "station", stationIds: [randomUUID()], zoneIds: null }, "stationIds"],
      [{ kind: "pass", stationIds: [venue.grill, venue.cold], zoneIds: null }, "stationIds"],
      [{ kind: "pass", stationIds: null, zoneIds: [venue.dining, venue.terrace] }, "zoneIds"],
    ] as const) {
      await expect(outcome(choose(till, venue.till, [screen]))).resolves.toEqual(
        invalid(field, "not_found", screen.kind),
      );
    }
    expect(await storedKindsOf(till)).toEqual([]);
  });

  it("refuses deleted stations and a stored deleted zone on device save", async () => {
    const { venue, till } = await kitchen();
    const pass = { kind: "pass", stationIds: [venue.cold], zoneIds: [venue.terrace] } as const;
    await choose(till, venue.till, [pass]);
    await db
      .update(kitchenStations)
      .set({ active: false })
      .where(eq(kitchenStations.id, venue.cold));
    await db.update(floorZones).set({ active: false }).where(eq(floorZones.id, venue.terrace));
    await expect(outcome(choose(till, venue.till, [pass]))).resolves.toEqual(
      invalid("stationIds", "not_found", "pass"),
    );
    await expect(
      outcome(choose(till, venue.till, [{ ...pass, stationIds: [venue.grill] }])),
    ).resolves.toEqual(invalid("zoneIds", "not_found", "pass"));
    await expect(
      outcome(
        choose(till, venue.till, [
          { ...pass, stationIds: [venue.grill], zoneIds: [venue.dining] },
          { kind: "station", stationIds: [venue.cold], zoneIds: null },
        ]),
      ),
    ).resolves.toEqual(invalid("stationIds", "not_found", "station"));
  });

  it("accepts every station and zone under any profile list, and a till with no screens", async () => {
    const { venue, screen, till } = await kitchen();
    await expect(outcome(choose(screen, venue.kds, [{ kind: "pass", ...every }]))).resolves.toEqual(
      { resolved: undefined },
    );
    await expect(outcome(choose(till, venue.till, []))).resolves.toEqual({
      resolved: undefined,
    });
    expect(await storedKindsOf(till)).toEqual([]);
  });

  it("lets a till's profile with no row for a kind bound nothing", async () => {
    const { venue, till } = await kitchen();
    await set(venue.till, { pass: { stationIds: [venue.grill], zoneIds: null } });
    await expect(
      outcome(
        choose(till, venue.till, [
          { kind: "station", stationIds: [venue.pastry], zoneIds: null },
          { kind: "pass", stationIds: [venue.grill], zoneIds: [venue.counter] },
        ]),
      ),
    ).resolves.toEqual({ resolved: undefined });
    await expect(
      outcome(
        choose(till, venue.till, [{ kind: "pass", stationIds: [venue.pastry], zoneIds: null }]),
      ),
    ).resolves.toEqual({
      code: "station.not_allowed",
      params: { stationId: venue.pastry, screen: "pass" },
    });
  });

  it("replaces the device's choice and clears its recorded removals, and no other device's", async () => {
    const { venue, screen, till } = await kitchen();
    await choose(till, venue.till, [
      { kind: "station", ...every },
      { kind: "pass", stationIds: [venue.grill], zoneIds: [venue.dining] },
    ]);
    await recordRemoval(till, "station", { stationId: venue.pastry });
    await recordRemoval(screen, "pass");
    await choose(till, venue.till, [{ kind: "pass", stationIds: [venue.cold], zoneIds: null }]);
    expect(await storedKindsOf(till)).toEqual(["pass"]);
    expect(await removalsOf(till)).toEqual([]);
    expect(await removalsOf(screen)).toHaveLength(1);
    await expect(shown(till)).resolves.toEqual([
      {
        kind: "pass",
        available: true,
        everyStation: false,
        everyZone: true,
        profileEveryStation: true,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations: [{ id: venue.cold, name: "Cold", available: true, switchedOff: false }],
        zones: null,
      },
    ]);
  });

  it("checks a choice without writing it", async () => {
    const { venue, screen } = await kitchen();
    const assert = (screens: readonly DeviceKitchenScreen[]) =>
      outcome(scoped((tx) => assertDeviceKitchenScreens(tx, venue.kds, screens)));
    await expect(assert([])).resolves.toMatchObject({ code: "kitchen_screen.required" });
    await expect(assert([{ kind: "station", ...every }])).resolves.toEqual({
      resolved: undefined,
    });
    expect(await storedKindsOf(screen)).toEqual([]);
  });

  it("refuses deleted stations even for the device that stored them", async () => {
    const { venue, screen } = await kitchen();
    const other = await seedDevice(venue.kds, "Other");
    const cold = { kind: "station", stationIds: [venue.cold], zoneIds: null } as const;
    await choose(screen, venue.kds, [cold]);
    await db
      .update(kitchenStations)
      .set({ active: false })
      .where(eq(kitchenStations.id, venue.cold));
    const assert = (deviceId?: string) =>
      outcome(scoped((tx) => assertDeviceKitchenScreens(tx, venue.kds, [cold], deviceId)));
    await expect(assert(screen)).resolves.toEqual(invalid("stationIds", "not_found", "station"));
    await expect(outcome(choose(screen, venue.kds, [cold]))).resolves.toEqual(
      invalid("stationIds", "not_found", "station"),
    );
    await expect(assert()).resolves.toEqual(invalid("stationIds", "not_found", "station"));
    await expect(assert(other)).resolves.toEqual(invalid("stationIds", "not_found", "station"));
  });

  it("names the screen in a refusal about a till's station list, which may hold two", async () => {
    const { venue, till } = await kitchen();
    await set(venue.till, {
      station: { stationIds: [venue.grill, venue.pastry], zoneIds: null },
      pass: { stationIds: [venue.grill], zoneIds: null },
    });
    const kitchenList = { kind: "station", stationIds: [venue.pastry], zoneIds: null } as const;
    await expect(
      outcome(
        choose(till, venue.till, [
          kitchenList,
          { kind: "pass", stationIds: [venue.pastry], zoneIds: null },
        ]),
      ),
    ).resolves.toEqual({
      code: "station.not_allowed",
      params: { stationId: venue.pastry, screen: "pass" },
    });
    await expect(
      outcome(
        choose(till, venue.till, [kitchenList, { kind: "pass", stationIds: [], zoneIds: null }]),
      ),
    ).resolves.toEqual(invalid("stationIds", "empty", "pass"));
    await expect(
      outcome(
        choose(till, venue.till, [
          { kind: "station", stationIds: [randomUUID()], zoneIds: null },
          { kind: "pass", stationIds: [venue.grill], zoneIds: null },
        ]),
      ),
    ).resolves.toEqual(invalid("stationIds", "not_found", "station"));
  });
});

describe("what a device's kitchen screens show", () => {
  const slot = (id: string, name: string, available = true, switchedOff = false) => ({
    id,
    name,
    available,
    switchedOff,
  });

  it("shows an every device the profile's stations by name, its removals in their places", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, {
      station: { stationIds: [venue.pastry, venue.grill, venue.cold], zoneIds: null },
    });
    const screen = await seedDevice(venue.kds, "Line");
    await choose(screen, venue.kds, [{ kind: "station", ...every }]);
    await recordRemoval(screen, "station", { stationId: venue.grill });
    await expect(shown(screen)).resolves.toEqual([
      {
        kind: "station",
        available: true,
        everyStation: true,
        everyZone: true,
        profileEveryStation: false,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations: [
          slot(venue.cold, "Cold"),
          slot(venue.grill, "Grill", false),
          slot(venue.pastry, "Pastry"),
        ],
        zones: null,
      },
    ]);
  });

  it("shows an explicit device its stored stations and its removals by name", async () => {
    const venue = await seedVenueWithStations();
    const till = await seedDevice(venue.till, "Till");
    await choose(till, venue.till, [
      { kind: "pass", stationIds: [venue.pastry, venue.cold], zoneIds: [venue.counter] },
    ]);
    await recordRemoval(till, "pass", { stationId: venue.grill });
    await recordRemoval(till, "pass", { zoneId: venue.terrace });
    await expect(shown(till)).resolves.toEqual([
      {
        kind: "pass",
        available: true,
        everyStation: false,
        everyZone: false,
        profileEveryStation: true,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations: [
          slot(venue.cold, "Cold"),
          slot(venue.grill, "Grill", false),
          slot(venue.pastry, "Pastry"),
        ],
        zones: [slot(venue.terrace, "Terrace", false), slot(venue.counter, "Counter")],
      },
    ]);
  });

  it("omits deleted stations and zones and reads restored fixtures", async () => {
    const venue = await seedVenueWithStations();
    const till = await seedDevice(venue.till, "Till");
    await choose(till, venue.till, [
      { kind: "pass", stationIds: [venue.grill, venue.cold], zoneIds: [venue.dining] },
    ]);
    const off = async (active: boolean) => {
      await db.update(kitchenStations).set({ active }).where(eq(kitchenStations.id, venue.cold));
      await db.update(floorZones).set({ active }).where(eq(floorZones.id, venue.dining));
    };
    await off(false);
    await expect(shown(till)).resolves.toEqual([
      {
        kind: "pass",
        available: true,
        everyStation: false,
        everyZone: false,
        profileEveryStation: true,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations: [slot(venue.grill, "Grill")],
        zones: [],
      },
    ]);
    await off(true);
    await expect(shown(till)).resolves.toEqual([
      {
        kind: "pass",
        available: true,
        everyStation: false,
        everyZone: false,
        profileEveryStation: true,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations: [slot(venue.cold, "Cold"), slot(venue.grill, "Grill")],
        zones: [slot(venue.dining, "Dining room")],
      },
    ]);
  });

  it("omits deleted stations and zones while retaining live narrowed slots", async () => {
    const venue = await seedVenueWithStations();
    const till = await seedDevice(venue.till, "Till");
    await choose(till, venue.till, [
      {
        kind: "pass",
        stationIds: [venue.cold, venue.pastry],
        zoneIds: [venue.dining, venue.counter],
      },
    ]);
    await recordRemoval(till, "pass", { stationId: venue.grill });
    await recordRemoval(till, "pass", { stationId: venue.pastry });
    await recordRemoval(till, "pass", { zoneId: venue.terrace });
    await recordRemoval(till, "pass", { zoneId: venue.counter });
    await db
      .update(kitchenStations)
      .set({ active: false })
      .where(inArray(kitchenStations.id, [venue.cold, venue.pastry]));
    await db
      .update(floorZones)
      .set({ active: false })
      .where(inArray(floorZones.id, [venue.dining, venue.counter]));
    await expect(shown(till)).resolves.toEqual([
      {
        kind: "pass",
        available: true,
        everyStation: false,
        everyZone: false,
        profileEveryStation: true,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations: [slot(venue.grill, "Grill", false)],
        zones: [slot(venue.terrace, "Terrace", false)],
      },
    ]);
  });

  it("shows every switched-on station and no zone filter when neither profile nor device lists any", async () => {
    const venue = await seedVenueWithStations();
    await db
      .update(kitchenStations)
      .set({ active: false })
      .where(eq(kitchenStations.id, venue.pastry));
    const till = await seedDevice(venue.till, "Till");
    await choose(till, venue.till, [
      { kind: "station", ...every },
      { kind: "pass", ...every },
    ]);
    const stations = [slot(venue.cold, "Cold"), slot(venue.grill, "Grill")];
    await expect(shown(till)).resolves.toEqual([
      {
        kind: "station",
        available: true,
        everyStation: true,
        everyZone: true,
        profileEveryStation: true,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations,
        zones: null,
      },
      {
        kind: "pass",
        available: true,
        everyStation: true,
        everyZone: true,
        profileEveryStation: true,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations,
        zones: null,
      },
    ]);
  });

  it("narrows every zone to the profile's list, less the device's recorded zone removals", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, {
      pass: { stationIds: [venue.grill], zoneIds: [venue.counter, venue.dining] },
    });
    const screen = await seedDevice(venue.kds, "Pass");
    await choose(screen, venue.kds, [{ kind: "pass", ...every }]);
    await recordRemoval(screen, "pass", { zoneId: venue.counter });
    await expect(shown(screen)).resolves.toEqual([
      {
        kind: "pass",
        available: true,
        everyStation: true,
        everyZone: true,
        profileEveryStation: false,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations: [slot(venue.grill, "Grill")],
        zones: [slot(venue.dining, "Dining room"), slot(venue.counter, "Counter", false)],
      },
    ]);
  });

  it("shows a kind recorded as removed after the stored ones, and one that lost its whole list", async () => {
    const venue = await seedVenueWithStations();
    const till = await seedDevice(venue.till, "Till");
    await choose(till, venue.till, [{ kind: "pass", stationIds: [venue.grill], zoneIds: null }]);
    await recordRemoval(till, "station");
    await recordRemoval(till, "station", { stationId: venue.cold });
    const screen = await seedDevice(venue.kds, "Line");
    await recordRemoval(screen, "station", { stationId: venue.grill });
    await expect(shown(till)).resolves.toEqual([
      {
        kind: "pass",
        available: true,
        everyStation: false,
        everyZone: true,
        profileEveryStation: true,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations: [slot(venue.grill, "Grill")],
        zones: null,
      },
      {
        kind: "station",
        available: false,
        everyStation: false,
        everyZone: false,
        profileEveryStation: false,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations: [slot(venue.cold, "Cold", false)],
        zones: null,
      },
    ]);
    await expect(shown(screen)).resolves.toEqual([
      {
        kind: "station",
        available: true,
        everyStation: false,
        everyZone: false,
        profileEveryStation: false,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations: [slot(venue.grill, "Grill", false)],
        zones: null,
      },
    ]);
  });

  it("shows a pass screen that lost its whole zone list with that zone as no longer available", async () => {
    const venue = await seedVenueWithStations();
    const screen = await seedDevice(venue.kds, "Pass");
    await recordRemoval(screen, "pass", { zoneId: venue.counter });
    await expect(shown(screen)).resolves.toEqual([
      {
        kind: "pass",
        available: true,
        everyStation: false,
        everyZone: false,
        profileEveryStation: false,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations: [],
        zones: [slot(venue.counter, "Counter", false)],
      },
    ]);
  });

  it("shows nothing for a device that chose nothing, or one unknown here", async () => {
    const venue = await seedVenueWithStations();
    const till = await seedDevice(venue.till, "Till");
    await expect(shown(till)).resolves.toEqual([]);
    await expect(shown(randomUUID())).resolves.toEqual([]);
  });

  it("reads several devices at once, each as it reads alone, and none for an unknown one or an empty list", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { station: every, pass: every });
    const line = await seedDevice(venue.kds, "Line");
    await choose(line, venue.kds, [{ kind: "station", ...every }]);
    await recordRemoval(line, "station", { stationId: venue.grill });
    const pass = await seedDevice(venue.kds, "Pass");
    await choose(pass, venue.kds, [
      { kind: "pass", stationIds: [venue.cold], zoneIds: [venue.dining] },
    ]);
    await recordRemoval(pass, "pass", { zoneId: venue.terrace });
    const till = await seedDevice(venue.till, "Till");
    await recordRemoval(till, "station");
    const bare = await seedDevice(venue.till, "Bare");
    const unknown = randomUUID();
    const ids = [line, pass, till, bare, unknown];

    const read = await scoped((tx) => readDevicesKitchenScreens(tx, ids));

    const alone = new Map<string, unknown>();
    for (const id of ids) alone.set(id, await shown(id));
    expect(read).toEqual(alone);
    expect(read.get(line)).not.toEqual(read.get(pass));
    expect(read.get(till)).toMatchObject([{ kind: "station", available: false }]);
    expect(read.get(unknown)).toEqual([]);
    await expect(scoped((tx) => readDevicesKitchenScreens(tx, []))).resolves.toEqual(new Map());
  });
});

describe("a kitchen display keeping a kitchen screen", () => {
  const check = (deviceId: string, profileId: string) =>
    outcome(scoped((tx) => assertKitchenDisplayHasScreen(tx, deviceId, profileId)));

  it("refuses a kitchen display's profile for a device storing no screen, even one a narrowing took", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { pass_monitor: every });
    const till = await seedDevice(venue.till, "Till");
    const taken = await seedDevice(venue.kds, "Taken");
    await recordRemoval(taken, "pass_monitor");
    const required = { code: "kitchen_screen.required", params: {} };
    await expect(check(till, venue.kds)).resolves.toEqual(required);
    await expect(check(taken, venue.kds)).resolves.toEqual(required);
  });

  it("passes a device storing a screen, and any device on a profile that is not a kitchen display", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { pass_monitor: every });
    const monitor = await seedDevice(venue.kds, "Monitor");
    await choose(monitor, venue.kds, [{ kind: "pass_monitor", ...every }]);
    const till = await seedDevice(venue.till, "Till");
    await expect(check(monitor, venue.kds)).resolves.toEqual({ resolved: undefined });
    await expect(check(till, venue.till)).resolves.toEqual({ resolved: undefined });
  });
});

describe("an order's zone checked against a device's pass screen", () => {
  const check = (deviceId: string, zoneId: string | null) =>
    outcome(scoped((tx) => assertPassScreenZone(tx, deviceId, zoneId)));

  it("refuses a device without a pass screen", async () => {
    const venue = await seedVenueWithStations();
    const till = await seedDevice(venue.till, "Till");
    await choose(till, venue.till, [{ kind: "station", ...every }]);
    await expect(check(till, venue.dining)).resolves.toEqual({
      code: "kitchen_screen.not_allowed",
      params: { screen: "pass" },
    });
  });

  it("refuses a zone outside an explicit list, and an order in no zone", async () => {
    const venue = await seedVenueWithStations();
    const till = await seedDevice(venue.till, "Till");
    await choose(till, venue.till, [
      { kind: "pass", stationIds: null, zoneIds: [venue.dining, venue.terrace] },
    ]);
    await recordRemoval(till, "pass", { zoneId: venue.counter });
    await db.update(floorZones).set({ active: false }).where(eq(floorZones.id, venue.terrace));
    await expect(check(till, venue.dining)).resolves.toEqual({ resolved: undefined });
    for (const zoneId of [venue.terrace, venue.counter, null]) {
      await expect(check(till, zoneId)).resolves.toEqual({
        code: "kitchen_screen.zone_not_allowed",
        params: { zoneId },
      });
    }
  });

  it("passes any zone, or none, on an every-zone pass", async () => {
    const venue = await seedVenueWithStations();
    const till = await seedDevice(venue.till, "Till");
    await choose(till, venue.till, [{ kind: "pass", ...every }]);
    await expect(check(till, venue.counter)).resolves.toEqual({ resolved: undefined });
    await expect(check(till, null)).resolves.toEqual({ resolved: undefined });
  });

  it("refuses a kitchen display whose pass screen a narrowing emptied, for any zone or none", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { pass: { stationIds: [venue.grill, venue.cold], zoneIds: null } });
    const screen = await seedDevice(venue.kds, "Pass");
    await choose(screen, venue.kds, [{ kind: "pass", stationIds: [venue.cold], zoneIds: null }]);
    await set(venue.kds, { pass: { stationIds: [venue.grill], zoneIds: null } });
    expect(await storedKindsOf(screen)).toEqual(["pass"]);
    for (const zoneId of [venue.dining, null]) {
      await expect(check(screen, zoneId)).resolves.toEqual({
        code: "kitchen_screen.not_allowed",
        params: { screen: "pass" },
      });
    }
  });

  it("refuses an order in no zone on an every-zone pass that lost a zone, as on an explicit list", async () => {
    const venue = await seedVenueWithStations();
    const till = await seedDevice(venue.till, "Till");
    await choose(till, venue.till, [{ kind: "pass", ...every }]);
    await recordRemoval(till, "pass", { zoneId: venue.counter });
    await expect(check(till, venue.dining)).resolves.toEqual({ resolved: undefined });
    for (const zoneId of [venue.counter, null]) {
      await expect(check(till, zoneId)).resolves.toEqual({
        code: "kitchen_screen.zone_not_allowed",
        params: { zoneId },
      });
    }
  });
});

describe("what the read says is every", () => {
  it("says whether the device's own lists are every, and whether its profile's station list is", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { station: every, pass: every });
    await set(venue.till, {
      station: { stationIds: [venue.grill, venue.cold], zoneIds: null },
      pass: { stationIds: null, zoneIds: [venue.dining, venue.terrace] },
    });
    const open = await seedDevice(venue.kds, "Open");
    const listed = await seedDevice(venue.kds, "Listed");
    const bounded = await seedDevice(venue.till, "Till");
    const matching = await seedDevice(venue.till, "Till listing all it may");
    await choose(open, venue.kds, [{ kind: "station", ...every }]);
    await choose(listed, venue.kds, [
      { kind: "pass", stationIds: [venue.grill], zoneIds: [venue.terrace] },
    ]);
    await choose(bounded, venue.till, [
      { kind: "station", ...every },
      { kind: "pass", ...every },
    ]);
    await choose(matching, venue.till, [
      { kind: "station", stationIds: [venue.grill, venue.cold], zoneIds: null },
      { kind: "pass", stationIds: null, zoneIds: [venue.dining, venue.terrace] },
    ]);
    const flags = async (deviceId: string) =>
      (await shown(deviceId)).map(({ kind, everyStation, everyZone, profileEveryStation }) => ({
        kind,
        everyStation,
        everyZone,
        profileEveryStation,
      }));
    expect(await flags(open)).toEqual([
      { kind: "station", everyStation: true, everyZone: true, profileEveryStation: true },
    ]);
    expect(await flags(listed)).toEqual([
      { kind: "pass", everyStation: false, everyZone: false, profileEveryStation: true },
    ]);
    expect(await flags(bounded)).toEqual([
      { kind: "station", everyStation: true, everyZone: true, profileEveryStation: false },
      { kind: "pass", everyStation: true, everyZone: true, profileEveryStation: true },
    ]);
    expect(await flags(matching)).toEqual([
      { kind: "station", everyStation: false, everyZone: true, profileEveryStation: false },
      { kind: "pass", everyStation: true, everyZone: false, profileEveryStation: true },
    ]);
  });

  it("says no list is every on a kind a narrowing took", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { station: every, pass: every });
    const open = await seedDevice(venue.kds, "Open");
    await choose(open, venue.kds, [{ kind: "station", ...every }]);
    await set(venue.kds, { pass: every });
    expect(await shown(open)).toEqual([
      {
        kind: "station",
        available: false,
        everyStation: false,
        everyZone: false,
        profileEveryStation: false,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations: [],
        zones: null,
      },
    ]);
  });
});

describe("the station screens kitchen displays run", () => {
  it("lists each active kitchen display's shown stations, never a till's", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { station: every, pass: every });
    const line = await seedDevice(venue.kds, "Line");
    const pass = await seedDevice(venue.kds, "Pass");
    const off = await seedDevice(venue.kds, "Old line");
    const till = await seedDevice(venue.till, "Till");
    await choose(line, venue.kds, [
      { kind: "station", stationIds: [venue.pastry, venue.grill], zoneIds: null },
    ]);
    await recordRemoval(line, "station", { stationId: venue.cold });
    await choose(pass, venue.kds, [{ kind: "pass", ...every }]);
    await choose(off, venue.kds, [{ kind: "station", ...every }]);
    await db.update(devices).set({ active: false }).where(eq(devices.id, off));
    await choose(till, venue.till, [{ kind: "station", ...every }]);
    await db
      .update(kitchenStations)
      .set({ active: false })
      .where(eq(kitchenStations.id, venue.pastry));
    await expect(scoped((tx) => readStationScreens(tx))).resolves.toEqual([
      { deviceId: line, stationIds: [venue.grill] },
    ]);
  });
});

describe("the station screens of several kitchen displays", () => {
  it("lists nothing when no kitchen display runs a station screen", async () => {
    await seedVenueWithStations();
    await expect(scoped((tx) => readStationScreens(tx))).resolves.toEqual([]);
  });

  it("lists each display under its own profile's bound, choice and removals", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, {
      station: { stationIds: [venue.grill, venue.cold], zoneIds: null },
    });
    const wide = await seedProfile("kds");
    await set(wide, { station: every });
    const bounded = await seedDevice(venue.kds, "Bounded");
    const explicit = await seedDevice(wide, "Explicit");
    const open = await seedDevice(wide, "Open");
    await choose(bounded, venue.kds, [{ kind: "station", ...every }]);
    await choose(explicit, wide, [
      { kind: "station", stationIds: [venue.pastry, venue.cold], zoneIds: null },
    ]);
    await choose(open, wide, [{ kind: "station", ...every }]);
    await recordRemoval(open, "station", { stationId: venue.grill });
    const screens = await scoped((tx) => readStationScreens(tx));
    expect(screens).toEqual(
      [
        { deviceId: bounded, stationIds: [venue.cold, venue.grill] },
        { deviceId: explicit, stationIds: [venue.cold, venue.pastry] },
        { deviceId: open, stationIds: [venue.cold, venue.pastry] },
      ].sort((a, b) => (a.deviceId < b.deviceId ? -1 : 1)),
    );
  });
  it("omits a deleted station even from an explicit display list", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { station: every });
    const listed = await seedDevice(venue.kds, "Listed");
    const open = await seedDevice(venue.kds, "Open");
    await choose(listed, venue.kds, [
      { kind: "station", stationIds: [venue.grill, venue.cold, venue.pastry], zoneIds: null },
    ]);
    await choose(open, venue.kds, [{ kind: "station", ...every }]);
    await set(venue.kds, {
      station: { stationIds: [venue.grill, venue.cold], zoneIds: null },
    });
    await db
      .update(kitchenStations)
      .set({ active: false })
      .where(inArray(kitchenStations.id, [venue.cold, venue.pastry]));
    const read = async (withSwitchedOff: boolean) =>
      new Map(
        (await scoped((tx) => readStationScreens(tx, { withSwitchedOff }))).map((s) => [
          s.deviceId,
          s.stationIds,
        ]),
      );
    expect(await read(false)).toEqual(
      new Map([
        [listed, [venue.grill]],
        [open, [venue.grill]],
      ]),
    );
    expect(await read(true)).toEqual(
      new Map([
        [listed, [venue.grill]],
        [open, [venue.grill]],
      ]),
    );
  });
});

describe("a profile save narrowing its devices", () => {
  const slot = (id: string, name: string, available = true, switchedOff = false) => ({
    id,
    name,
    available,
    switchedOff,
  });
  const named = (id: string, name: string) => ({ id, name });
  const lost = (
    deviceId: string,
    deviceName: string,
    what: { screens?: string[]; stations?: object[]; zones?: object[] },
  ) => ({
    deviceId,
    deviceName,
    lost: { screens: what.screens ?? [], stations: what.stations ?? [], zones: what.zones ?? [] },
  });
  const station = (stationIds: string[] | null) =>
    ({ kind: "station", stationIds, zoneIds: null }) as const;

  /** A kitchen display profile offering Grill, Cold and Pastry, with an explicit and an every device. */
  async function narrowing() {
    const venue = await seedVenueWithStations();
    await set(venue.kds, {
      station: { stationIds: [venue.grill, venue.cold, venue.pastry], zoneIds: null },
    });
    const line = await seedDevice(venue.kds, "Line");
    const all = await seedDevice(venue.kds, "All");
    await choose(line, venue.kds, [station([venue.grill, venue.pastry])]);
    await choose(all, venue.kds, [station(null)]);
    return { venue, line, all };
  }

  it("narrows active devices on the profile, retaining hidden devices and other profiles", async () => {
    const { venue, line, all } = await narrowing();
    const old = await seedDevice(venue.kds, "Old line");
    await choose(old, venue.kds, [station([venue.pastry, venue.cold])]);
    await db.update(devices).set({ active: false }).where(eq(devices.id, old));
    const other = await seedProfile("kds");
    await set(other, { station: every });
    const elsewhere = await seedDevice(other, "Elsewhere");
    await choose(elsewhere, other, [station([venue.pastry])]);

    await expect(
      set(venue.kds, { station: { stationIds: [venue.grill, venue.cold], zoneIds: null } }),
    ).resolves.toEqual([
      lost(all, "All", { stations: [named(venue.pastry, "Pastry")] }),
      lost(line, "Line", { stations: [named(venue.pastry, "Pastry")] }),
    ]);
    await expect(shown(line)).resolves.toEqual([
      {
        kind: "station",
        available: true,
        everyStation: false,
        everyZone: true,
        profileEveryStation: false,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations: [slot(venue.grill, "Grill"), slot(venue.pastry, "Pastry", false)],
        zones: null,
      },
    ]);
    await expect(shown(all)).resolves.toEqual([
      {
        kind: "station",
        available: true,
        everyStation: true,
        everyZone: true,
        profileEveryStation: false,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations: [
          slot(venue.cold, "Cold"),
          slot(venue.grill, "Grill"),
          slot(venue.pastry, "Pastry", false),
        ],
        zones: null,
      },
    ]);
    expect((await shown(old))[0]!.stations).toEqual([
      slot(venue.cold, "Cold"),
      slot(venue.pastry, "Pastry"),
    ]);
    for (const device of [line, all]) {
      expect(
        (await removalsOf(device)).map(({ screen, stationId, zoneId }) => ({
          screen,
          stationId,
          zoneId,
        })),
      ).toEqual([{ screen: "station", stationId: venue.pastry, zoneId: null }]);
    }
    expect(await removalsOf(old)).toEqual([]);
    expect(await removalsOf(elsewhere)).toEqual([]);
    expect((await shown(elsewhere))[0]!.stations).toEqual([slot(venue.pastry, "Pastry")]);
  });

  it("narrows every device on the profile in one save", async () => {
    const { venue, line, all } = await narrowing();

    await expect(
      set(venue.kds, { station: { stationIds: [venue.grill, venue.cold], zoneIds: null } }),
    ).resolves.toEqual([
      lost(all, "All", { stations: [named(venue.pastry, "Pastry")] }),
      lost(line, "Line", { stations: [named(venue.pastry, "Pastry")] }),
    ]);
    for (const device of [line, all]) {
      expect((await removalsOf(device)).map(({ stationId }) => stationId)).toEqual([venue.pastry]);
    }
  });

  async function deleted(deviceId: string) {
    await db
      .update(devices)
      .set({ active: false, deletedAt: "2026-10-10T10:00:00.000Z" })
      .where(eq(devices.id, deviceId));
  }

  it("keeps a hidden device and reports nothing for a deleted one", async () => {
    const { venue, line, all } = await narrowing();
    await db.update(devices).set({ active: false }).where(eq(devices.id, line));
    await deleted(all);

    await expect(
      set(venue.kds, { station: { stationIds: [venue.grill, venue.cold], zoneIds: null } }),
    ).resolves.toEqual([]);
    expect(await removalsOf(line)).toEqual([]);
    expect(await removalsOf(all)).toEqual([]);
  });

  it("narrows an active device while leaving a tombstoned device's retained choice alone", async () => {
    const { venue, line, all } = await narrowing();
    await deleted(all);

    await expect(
      set(venue.kds, { station: { stationIds: [venue.grill, venue.cold], zoneIds: null } }),
    ).resolves.toEqual([lost(line, "Line", { stations: [named(venue.pastry, "Pastry")] })]);
    expect(await removalsOf(all)).toEqual([]);
  });

  it("empties a display's only station without refusing it, keeping the station as no longer available", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { station: every });
    const deli = await seedDevice(venue.kds, "Deli");
    await choose(deli, venue.kds, [station([venue.pastry])]);
    await expect(
      set(venue.kds, { station: { stationIds: [venue.grill], zoneIds: null } }),
    ).resolves.toEqual([lost(deli, "Deli", { stations: [named(venue.pastry, "Pastry")] })]);
    expect(await storedKindsOf(deli)).toEqual(["station"]);
    await expect(shown(deli)).resolves.toEqual([
      {
        kind: "station",
        available: true,
        everyStation: false,
        everyZone: false,
        profileEveryStation: false,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations: [slot(venue.pastry, "Pastry", false)],
        zones: null,
      },
    ]);
  });

  it("records every other switched-on station an every device showed, and nothing twice", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { station: every });
    const all = await seedDevice(venue.kds, "All");
    await choose(all, venue.kds, [station(null)]);
    await recordRemoval(all, "station", { stationId: venue.cold });
    const off = await seedStation("Bar");
    await db.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, off));
    await expect(
      set(venue.kds, { station: { stationIds: [venue.grill], zoneIds: null } }),
    ).resolves.toEqual([lost(all, "All", { stations: [named(venue.pastry, "Pastry")] })]);
    expect((await removalsOf(all)).map((row) => row.stationId).sort()).toEqual(
      [venue.cold, venue.pastry].sort(),
    );
  });

  it("narrows a till's zones once its profile first bounds them, and the device's explicit list", async () => {
    const venue = await seedVenueWithStations();
    const open = await seedDevice(venue.till, "Open till");
    const listed = await seedDevice(venue.till, "Listed till");
    await choose(open, venue.till, [{ kind: "pass", ...every }]);
    await choose(listed, venue.till, [
      { kind: "pass", stationIds: [venue.grill], zoneIds: [venue.dining, venue.terrace] },
      station([venue.cold]),
    ]);
    await expect(
      set(venue.till, { pass: { stationIds: null, zoneIds: [venue.dining] } }),
    ).resolves.toEqual([
      lost(listed, "Listed till", { zones: [named(venue.terrace, "Terrace")] }),
      lost(open, "Open till", {
        zones: [named(venue.terrace, "Terrace"), named(venue.counter, "Counter")],
      }),
    ]);
    await expect(shown(listed)).resolves.toEqual([
      {
        kind: "station",
        available: true,
        everyStation: false,
        everyZone: true,
        profileEveryStation: true,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations: [slot(venue.cold, "Cold")],
        zones: null,
      },
      {
        kind: "pass",
        available: true,
        everyStation: false,
        everyZone: false,
        profileEveryStation: true,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations: [slot(venue.grill, "Grill")],
        zones: [slot(venue.terrace, "Terrace", false), slot(venue.dining, "Dining room")],
      },
    ]);
    expect((await shown(open))[0]!.zones).toEqual([
      slot(venue.terrace, "Terrace", false),
      slot(venue.dining, "Dining room"),
      slot(venue.counter, "Counter", false),
    ]);
  });

  it("empties a pass screen's explicit zone list, keeping the zone as no longer available", async () => {
    const venue = await seedVenueWithStations();
    const till = await seedDevice(venue.till, "Till");
    await choose(till, venue.till, [{ kind: "pass", stationIds: null, zoneIds: [venue.counter] }]);
    await expect(
      set(venue.till, { pass: { stationIds: null, zoneIds: [venue.dining] } }),
    ).resolves.toEqual([lost(till, "Till", { zones: [named(venue.counter, "Counter")] })]);
    expect(await storedKindsOf(till)).toEqual(["pass"]);
    await expect(shown(till)).resolves.toEqual([
      {
        kind: "pass",
        available: true,
        everyStation: false,
        everyZone: false,
        profileEveryStation: false,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations: [],
        zones: [slot(venue.counter, "Counter", false)],
      },
    ]);
  });

  it("takes a kind the profile stops offering off its devices, recording the kind", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { station: every, pass_monitor: every });
    const wall = await seedDevice(venue.kds, "Wall");
    const line = await seedDevice(venue.kds, "Line");
    await choose(wall, venue.kds, [{ kind: "pass_monitor", ...every }]);
    await choose(line, venue.kds, [station(null)]);
    await expect(set(venue.kds, { station: every })).resolves.toEqual([
      lost(wall, "Wall", { screens: ["pass_monitor"] }),
    ]);
    expect(await storedKindsOf(wall)).toEqual(["pass_monitor"]);
    await expect(shown(wall)).resolves.toEqual([
      {
        kind: "pass_monitor",
        available: false,
        everyStation: false,
        everyZone: false,
        profileEveryStation: false,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations: [],
        zones: null,
      },
    ]);
    expect(await removalsOf(line)).toEqual([]);
  });

  it("gives a station added back to each device still showing it as lost, and not to one picked on since", async () => {
    const { venue, line, all } = await narrowing();
    const picked = await seedDevice(venue.kds, "Picked");
    await choose(picked, venue.kds, [station([venue.grill, venue.pastry])]);
    await set(venue.kds, {
      station: { stationIds: [venue.grill, venue.cold], zoneIds: null },
    });
    await choose(picked, venue.kds, [station([venue.grill])]);
    await expect(
      set(venue.kds, {
        station: { stationIds: [venue.grill, venue.cold, venue.pastry], zoneIds: null },
      }),
    ).resolves.toEqual([]);
    await expect(shown(line)).resolves.toEqual([
      {
        kind: "station",
        available: true,
        everyStation: false,
        everyZone: true,
        profileEveryStation: false,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations: [slot(venue.grill, "Grill"), slot(venue.pastry, "Pastry")],
        zones: null,
      },
    ]);
    expect((await shown(all))[0]!.stations).toEqual([
      slot(venue.cold, "Cold"),
      slot(venue.grill, "Grill"),
      slot(venue.pastry, "Pastry"),
    ]);
    expect((await shown(picked))[0]!.stations).toEqual([slot(venue.grill, "Grill")]);
    for (const device of [line, all, picked]) expect(await removalsOf(device)).toEqual([]);
    await expect(
      outcome(choose(picked, venue.kds, [station([venue.grill, venue.pastry])])),
    ).resolves.toEqual({ resolved: undefined });
  });

  it("gives a kind offered again back as the device chose it, with no line", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, {
      pass: { stationIds: [venue.grill, venue.cold], zoneIds: [venue.terrace, venue.dining] },
    });
    const pass = await seedDevice(venue.kds, "Pass");
    await choose(pass, venue.kds, [
      { kind: "pass", stationIds: [venue.grill], zoneIds: [venue.terrace] },
    ]);
    await expect(set(venue.kds, { station: every })).resolves.toEqual([
      lost(pass, "Pass", { screens: ["pass"] }),
    ]);
    await expect(set(venue.kds, { station: every, pass: every })).resolves.toEqual([]);
    await expect(shown(pass)).resolves.toEqual([
      {
        kind: "pass",
        available: true,
        everyStation: false,
        everyZone: false,
        profileEveryStation: true,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations: [slot(venue.grill, "Grill")],
        zones: [slot(venue.terrace, "Terrace")],
      },
    ]);
    expect(await removalsOf(pass)).toEqual([]);
  });

  it("gives an every device back the kind offered again as it was, losing no station it never showed", async () => {
    const venue = await seedVenueWithStations();
    const grillOnly = { station: { stationIds: [venue.grill], zoneIds: null } };
    await set(venue.kds, grillOnly);
    const all = await seedDevice(venue.kds, "All");
    await choose(all, venue.kds, [station(null)]);
    await expect(set(venue.kds, { pass: every })).resolves.toEqual([
      lost(all, "All", { screens: ["station"] }),
    ]);
    await expect(set(venue.kds, grillOnly)).resolves.toEqual([]);
    expect(await removalsOf(all)).toEqual([]);
    expect((await shown(all))[0]!.stations).toEqual([slot(venue.grill, "Grill")]);
  });

  it("restores a kind and narrows its stations in one save", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { pass: every });
    const pass = await seedDevice(venue.kds, "Pass");
    await choose(pass, venue.kds, [
      { kind: "pass", stationIds: [venue.grill, venue.cold], zoneIds: [venue.terrace] },
    ]);
    await set(venue.kds, { station: every });
    await expect(
      set(venue.kds, { pass: { stationIds: [venue.cold], zoneIds: null } }),
    ).resolves.toEqual([lost(pass, "Pass", { stations: [named(venue.grill, "Grill")] })]);
    await expect(shown(pass)).resolves.toEqual([
      {
        kind: "pass",
        available: true,
        everyStation: false,
        everyZone: false,
        profileEveryStation: false,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations: [slot(venue.cold, "Cold"), slot(venue.grill, "Grill", false)],
        zones: [slot(venue.terrace, "Terrace")],
      },
    ]);
    expect(
      (await removalsOf(pass)).map(({ screen, stationId, zoneId }) => ({
        screen,
        stationId,
        zoneId,
      })),
    ).toEqual([{ screen: "pass", stationId: venue.grill, zoneId: null }]);
  });

  it("gives a zone added back to a till still showing it as lost", async () => {
    const venue = await seedVenueWithStations();
    const till = await seedDevice(venue.till, "Till");
    await choose(till, venue.till, [
      { kind: "pass", stationIds: null, zoneIds: [venue.dining, venue.terrace] },
    ]);
    await set(venue.till, { pass: { stationIds: null, zoneIds: [venue.dining] } });
    await expect(set(venue.till, { pass: every })).resolves.toEqual([]);
    expect((await shown(till))[0]!.zones).toEqual([
      slot(venue.terrace, "Terrace"),
      slot(venue.dining, "Dining room"),
    ]);
    expect(await removalsOf(till)).toEqual([]);
  });

  it("keeps a display a narrowing emptied out of the station screens, refused as having no screen and not following every station", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { station: every, pass_monitor: every });
    const deli = await seedDevice(venue.kds, "Deli");
    const wall = await seedDevice(venue.kds, "Wall");
    const open = await seedDevice(venue.kds, "Open");
    await choose(deli, venue.kds, [station([venue.pastry])]);
    await choose(wall, venue.kds, [{ kind: "pass_monitor", ...every }]);
    await choose(open, venue.kds, [station(null)]);
    await set(venue.kds, { pass: every });
    await expect(
      scoped((tx) => readStationScreens(tx, { withSwitchedOff: true })),
    ).resolves.toEqual([]);
    expect(await shown(open)).toMatchObject([
      { kind: "station", available: false, everyStation: false, profileEveryStation: false },
    ]);
    for (const device of [deli, wall, open]) {
      await expect(
        outcome(scoped((tx) => assertKitchenDisplayHasScreen(tx, device, venue.kds))),
      ).resolves.toEqual({ code: "kitchen_screen.required", params: {} });
    }
    await set(venue.kds, { station: { stationIds: [venue.grill], zoneIds: null } });
    await expect(
      outcome(scoped((tx) => assertKitchenDisplayHasScreen(tx, deli, venue.kds))),
    ).resolves.toEqual({ code: "kitchen_screen.required", params: {} });
    await expect(
      outcome(scoped((tx) => assertKitchenDisplayHasScreen(tx, open, venue.kds))),
    ).resolves.toEqual({ resolved: undefined });
  });

  it("answers nothing and records nothing for a save that narrows nothing a device shows", async () => {
    const { venue, line, all } = await narrowing();
    const till = await seedDevice(venue.till, "Till");
    await set(venue.till, { pass: { stationIds: [venue.grill], zoneIds: null } });
    await choose(till, venue.till, [{ kind: "pass", stationIds: [venue.grill], zoneIds: null }]);
    await expect(set(venue.till, {})).resolves.toEqual([]);
    await expect(
      set(venue.kds, {
        station: { stationIds: [venue.grill, venue.cold, venue.pastry], zoneIds: null },
        pass: every,
      }),
    ).resolves.toEqual([]);
    for (const device of [line, all, till]) expect(await removalsOf(device)).toEqual([]);
  });

  it("records nothing a device already holds as removed", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { pass_monitor: every });
    const wall = await seedDevice(venue.kds, "Wall");
    await choose(wall, venue.kds, [{ kind: "pass_monitor", ...every }]);
    await recordRemoval(wall, "pass_monitor");
    const till = await seedDevice(venue.till, "Till");
    await choose(till, venue.till, [
      { kind: "pass", stationIds: null, zoneIds: [venue.dining, venue.terrace] },
    ]);
    await recordRemoval(till, "pass", { zoneId: venue.terrace });
    await expect(set(venue.kds, {})).resolves.toEqual([]);
    await expect(
      set(venue.till, { pass: { stationIds: null, zoneIds: [venue.dining] } }),
    ).resolves.toEqual([]);
    expect(await storedKindsOf(wall)).toEqual(["pass_monitor"]);
    expect(await removalsOf(wall)).toHaveLength(1);
    expect(await removalsOf(till)).toHaveLength(1);
    expect((await shown(till))[0]!.zones).toEqual([
      slot(venue.terrace, "Terrace", false),
      slot(venue.dining, "Dining room"),
    ]);
  });

  it("forgets what a narrowing took once the device is saved again", async () => {
    const { venue, line } = await narrowing();
    await set(venue.kds, { station: { stationIds: [venue.grill], zoneIds: null } });
    expect(await removalsOf(line)).toHaveLength(1);
    await choose(line, venue.kds, [station([venue.grill])]);
    expect(await removalsOf(line)).toEqual([]);
  });
});

describe("a device narrowed against another profile", () => {
  const narrow = (deviceId: string, profileId: string) =>
    scoped((tx) => narrowDeviceKitchenScreens(tx, deviceId, profileId));

  it("drops what the other profile does not offer, and answers null when it loses nothing", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { station: every, pass: every });
    const strict = await seedProfile("kds");
    await set(strict, { station: { stationIds: [venue.grill], zoneIds: null } });
    const line = await seedDevice(venue.kds, "Line");
    const pass = await seedDevice(venue.kds, "Pass");
    await choose(line, venue.kds, [
      { kind: "station", stationIds: [venue.grill, venue.cold], zoneIds: null },
    ]);
    await choose(pass, venue.kds, [{ kind: "pass", ...every }]);
    await expect(narrow(line, strict)).resolves.toEqual({
      deviceId: line,
      deviceName: "Line",
      lost: { screens: [], stations: [{ id: venue.cold, name: "Cold" }], zones: [] },
    });
    await expect(narrow(line, strict)).resolves.toBeNull();
    await expect(narrow(pass, strict)).resolves.toEqual({
      deviceId: pass,
      deviceName: "Pass",
      lost: { screens: ["pass"], stations: [], zones: [] },
    });
    expect(await storedKindsOf(pass)).toEqual(["pass"]);
    await expect(shown(pass)).resolves.toEqual([
      {
        kind: "pass",
        available: false,
        everyStation: false,
        everyZone: false,
        profileEveryStation: false,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations: [],
        zones: null,
      },
    ]);
    await expect(narrow(randomUUID(), strict)).resolves.toBeNull();
    const till = await seedDevice(venue.till, "Till");
    await choose(till, venue.till, [{ kind: "pass", ...every }]);
    await expect(narrow(till, await seedProfile("till"))).resolves.toBeNull();
  });

  it("gives back on a switch back what a switch took, unless the device was picked on since", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { station: every });
    const strict = await seedProfile("kds");
    await set(strict, { station: { stationIds: [venue.grill], zoneIds: null } });
    const line = await seedDevice(venue.kds, "Line");
    const picked = await seedDevice(venue.kds, "Picked");
    for (const device of [line, picked]) {
      await choose(device, venue.kds, [
        { kind: "station", stationIds: [venue.grill, venue.cold], zoneIds: null },
      ]);
      await narrow(device, strict);
      await db.update(devices).set({ deviceProfileId: strict }).where(eq(devices.id, device));
    }
    await choose(picked, strict, [{ kind: "station", stationIds: [venue.grill], zoneIds: null }]);
    for (const device of [line, picked]) {
      await expect(narrow(device, venue.kds)).resolves.toBeNull();
      expect(await removalsOf(device)).toEqual([]);
    }
    expect((await shown(line))[0]!.stations).toEqual([
      { id: venue.cold, name: "Cold", available: true, switchedOff: false },
      { id: venue.grill, name: "Grill", available: true, switchedOff: false },
    ]);
    expect((await shown(picked))[0]!.stations).toEqual([
      { id: venue.grill, name: "Grill", available: true, switchedOff: false },
    ]);
  });

  it("gives a kind back on a switch losing no station the device never showed, and a till what its profile never bounded", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { station: every });
    const strict = await seedProfile("kds");
    await set(strict, { station: { stationIds: [venue.grill], zoneIds: null } });
    const all = await seedDevice(venue.kds, "All");
    await choose(all, venue.kds, [{ kind: "station", ...every }]);
    await set(venue.kds, { pass: every });
    await expect(narrow(all, strict)).resolves.toBeNull();
    expect(await removalsOf(all)).toEqual([]);

    const till = await seedDevice(venue.till, "Till");
    await choose(till, venue.till, [{ kind: "station", ...every }]);
    const strictTill = await seedProfile("till");
    await set(strictTill, { station: { stationIds: [venue.grill], zoneIds: null } });
    await expect(narrow(till, strictTill)).resolves.toEqual({
      deviceId: till,
      deviceName: "Till",
      lost: {
        screens: [],
        stations: [
          { id: venue.cold, name: "Cold" },
          { id: venue.pastry, name: "Pastry" },
        ],
        zones: [],
      },
    });
  });
});

describe("the statements a device's kitchen screens are read in", () => {
  const sessionOf = (tx: Transaction) =>
    (tx as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }).session;
  const statementsOf = (fn: (tx: Transaction) => Promise<unknown>) =>
    scoped(async (tx) => {
      const prepared = vi.spyOn(sessionOf(tx), "prepareQuery");
      try {
        await fn(tx);
        return prepared.mock.calls.map(([query]) => query as unknown as { sql: string });
      } finally {
        prepared.mockRestore();
      }
    });
  const from = (table: string) => (query: { sql: string }) => query.sql.includes(`from "${table}"`);

  it("reads each device's removals once, and only the profile rows of the devices it resolves", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { station: every, pass: every });
    await set(venue.till, { pass: { stationIds: [venue.grill], zoneIds: null } });
    const line = await seedDevice(venue.kds, "Line");
    await choose(line, venue.kds, [{ kind: "station", ...every }]);
    const till = await seedDevice(venue.till, "Till");
    await choose(till, venue.till, [{ kind: "pass", ...every }]);

    for (const read of [
      (tx: Transaction) => assertPassScreenZone(tx, till, venue.dining),
      (tx: Transaction) => readStationScreens(tx),
      (tx: Transaction) => readDeviceKitchenScreens(tx, till),
    ]) {
      const statements = await statementsOf(read);
      expect(statements.filter(from("device_kitchen_screen_removals"))).toHaveLength(1);
      expect(statements.filter(from("device_kitchen_screens"))).toHaveLength(1);
      const profileRows = statements.filter(from("device_profile_kitchen_screens"));
      expect(profileRows).toHaveLength(1);
      expect(profileRows[0]!.sql).toContain(
        '"device_profile_kitchen_screens"."device_profile_id" in',
      );
    }
  });

  it("saves a profile with no devices without reading any device's screens", async () => {
    const venue = await seedVenueWithStations();
    const statements = await statementsOf((tx) =>
      setProfileKitchenScreens(tx, venue.kds, { station: every }),
    );
    expect(statements.filter(from("device_kitchen_screen_removals"))).toEqual([]);
    expect(statements.filter(from("device_kitchen_screens"))).toEqual([]);
    const reads = statements.filter((query) => query.sql.startsWith("select"));
    expect(reads.filter(from("device_profile_kitchen_screens"))).toHaveLength(1);
  });
});

describe("deleted zone bounds", () => {
  it("retained empty zone bound survives unrelated profile save without widening", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { pass: { stationIds: [venue.grill], zoneIds: [venue.dining] } });
    await db
      .delete(deviceProfileKitchenScreenZones)
      .where(eq(deviceProfileKitchenScreenZones.deviceProfileId, venue.kds));
    await db.update(floorZones).set({ active: false }).where(eq(floorZones.id, venue.dining));
    await expect(
      set(venue.kds, { pass: { stationIds: [venue.grill], zoneIds: [] } }),
    ).resolves.toEqual([]);
    await expect(screensOf(venue.kds)).resolves.toEqual({
      pass: { stationIds: [venue.grill], zoneIds: [], showNonPassStations: true },
    });
    const [parent] = await db
      .select()
      .from(deviceProfileKitchenScreens)
      .where(eq(deviceProfileKitchenScreens.deviceProfileId, venue.kds));
    expect(parent).toMatchObject({ everyZone: false, everyStation: false });
    await expect(outcome(set(venue.kds, {}))).resolves.toEqual(refused("passScreenZones", "empty"));
  });

  it("retained empty zone bound survives unchanged device save without widening", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { pass: { stationIds: [venue.grill], zoneIds: [venue.dining] } });
    const deviceId = await seedDevice(venue.kds, "Empty pass");
    await choose(deviceId, venue.kds, [
      { kind: "pass", stationIds: [venue.grill], zoneIds: [venue.dining] },
    ]);
    await db
      .delete(deviceKitchenScreenZones)
      .where(eq(deviceKitchenScreenZones.deviceId, deviceId));
    await db
      .delete(deviceProfileKitchenScreenZones)
      .where(eq(deviceProfileKitchenScreenZones.deviceProfileId, venue.kds));
    await expect(
      choose(deviceId, venue.kds, [{ kind: "pass", stationIds: [venue.grill], zoneIds: [] }]),
    ).resolves.toBeUndefined();
    const [parent] = await db
      .select()
      .from(deviceKitchenScreens)
      .where(eq(deviceKitchenScreens.deviceId, deviceId));
    expect(parent).toMatchObject({ everyZone: false, everyStation: false });
    await expect(shown(deviceId)).resolves.toEqual([]);
    await expect(
      outcome(scoped((tx) => assertPassScreenZone(tx, deviceId, venue.terrace))),
    ).resolves.toEqual({ code: "kitchen_screen.not_allowed", params: { screen: "pass" } });
  });

  it("new empty device zone choice refuses while an empty profile bound restricts Every", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { pass: { stationIds: [venue.grill], zoneIds: [venue.dining] } });
    await db
      .delete(deviceProfileKitchenScreenZones)
      .where(eq(deviceProfileKitchenScreenZones.deviceProfileId, venue.kds));
    const deviceId = await seedDevice(venue.kds, "New restricted pass");
    await expect(
      outcome(choose(deviceId, venue.kds, [{ kind: "pass", stationIds: null, zoneIds: [] }])),
    ).resolves.toEqual(invalid("zoneIds", "empty", "pass"));
    await choose(deviceId, venue.kds, [{ kind: "pass", stationIds: null, zoneIds: null }]);
    await expect(shown(deviceId)).resolves.toEqual([
      {
        kind: "pass",
        available: true,
        everyStation: true,
        everyZone: true,
        profileEveryStation: false,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations: [{ id: venue.grill, name: "Grill", available: true, switchedOff: false }],
        zones: [],
      },
    ]);
    await expect(
      outcome(scoped((tx) => assertPassScreenZone(tx, deviceId, venue.terrace))),
    ).resolves.toEqual({
      code: "kitchen_screen.zone_not_allowed",
      params: { zoneId: venue.terrace },
    });
  });
});

it("A725 profile and device station choices use names and preserve removed slots", async () => {
  const v = await seedVenueWithStations();
  await db.update(kitchenStations).set({ name: "Ásador" }).where(eq(kitchenStations.id, v.cold));
  await set(v.kds, { station: { stationIds: [v.pastry, v.grill, v.cold], zoneIds: null } });
  expect((await screensOf(v.kds))!.station!.stationIds).toEqual([v.cold, v.grill, v.pastry]);
  const device = await seedDevice(v.kds, "Names");
  await choose(device, v.kds, [{ kind: "station", ...every }]);
  await recordRemoval(device, "station", { stationId: v.pastry });
  const rows = (await shown(device))[0]!.stations;
  expect(rows.map(({ id }) => id)).toEqual([v.cold, v.grill, v.pastry]);
  expect(rows.map(({ available }) => available)).toEqual([true, true, false]);
});

describe("A773 pass display policy", () => {
  const passes = (venue: Venue) => ({
    pass: { stationIds: [venue.grill, venue.cold], zoneIds: null },
    pass_monitor: every,
  });

  const deviceValues = async (deviceId: string) =>
    Object.fromEntries(
      (
        await db
          .select({
            screen: deviceKitchenScreens.screen,
            value: deviceKitchenScreens.showNonPassStations,
          })
          .from(deviceKitchenScreens)
          .where(eq(deviceKitchenScreens.deviceId, deviceId))
      ).map((row) => [row.screen, row.value]),
    );

  const storeDeviceValue = (deviceId: string, kind: DeviceKitchenScreen["kind"], value: boolean) =>
    db
      .update(deviceKitchenScreens)
      .set({ showNonPassStations: value })
      .where(
        sql`${deviceKitchenScreens.deviceId} = ${deviceId} and ${deviceKitchenScreens.screen} = ${kind}`,
      );

  it("reads a new profile's pass entry as showing other stations, and reads back a saved false", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { pass: every });
    expect((await screensOf(venue.kds))!.pass).toEqual({
      ...every,
      showNonPassStations: true,
    });
    await set(venue.kds, { pass: { ...every, showNonPassStations: false } });
    expect((await screensOf(venue.kds))!.pass).toEqual({
      ...every,
      showNonPassStations: false,
    });
  });

  it("keeps each kind's stored value when a save omits it, and starts an added kind true", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, {
      pass: { ...every, showNonPassStations: false },
      pass_monitor: { ...every, showNonPassStations: true },
    });
    await set(venue.kds, {
      pass: { stationIds: [venue.grill], zoneIds: null },
      pass_monitor: { stationIds: [venue.cold], zoneIds: null },
    });
    await expect(screensOf(venue.kds)).resolves.toEqual({
      pass: { stationIds: [venue.grill], zoneIds: null, showNonPassStations: false },
      pass_monitor: { stationIds: [venue.cold], zoneIds: null, showNonPassStations: true },
    });

    await set(venue.till, { pass: { ...every, showNonPassStations: false } });
    await set(venue.till, { pass: every, pass_monitor: every });
    await expect(screensOf(venue.till)).resolves.toEqual({
      pass: { ...every, showNonPassStations: false },
      pass_monitor: { ...every, showNonPassStations: true },
    });
  });

  it("copies each kind's value to the copy", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, {
      station: every,
      pass: { ...every, showNonPassStations: true },
      pass_monitor: { ...every, showNonPassStations: false },
    });
    const copy = await seedProfile("kds");
    await scoped((tx) => copyProfileKitchenScreens(tx, venue.kds, copy));
    await expect(screensOf(copy)).resolves.toEqual({
      station: every,
      pass: { ...every, showNonPassStations: true },
      pass_monitor: { ...every, showNonPassStations: false },
    });
  });

  it("keeps a device's stored value for each kind a new pick keeps, and starts a re-added kind null", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.till, { station: every, ...passes(venue) });
    const till = await seedDevice(venue.till, "Till");
    await choose(till, venue.till, [
      { kind: "station", ...every },
      { kind: "pass", ...every },
    ]);
    await storeDeviceValue(till, "station", true);
    await storeDeviceValue(till, "pass", false);
    const other = await seedDevice(venue.till, "Other till");
    await choose(other, venue.till, [
      { kind: "station", ...every },
      { kind: "pass", ...every },
    ]);
    await storeDeviceValue(other, "station", false);
    await storeDeviceValue(other, "pass", true);

    await choose(till, venue.till, [
      { kind: "station", stationIds: [venue.grill], zoneIds: null },
      { kind: "pass", stationIds: [venue.cold], zoneIds: null },
    ]);
    await expect(deviceValues(till)).resolves.toEqual({ station: true, pass: false });
    await choose(other, venue.till, [
      { kind: "station", stationIds: [venue.cold], zoneIds: null },
      { kind: "pass", stationIds: [venue.grill], zoneIds: null },
    ]);
    await expect(deviceValues(other)).resolves.toEqual({ station: false, pass: true });

    await choose(till, venue.till, [{ kind: "station", ...every }]);
    await choose(till, venue.till, [
      { kind: "station", ...every },
      { kind: "pass", ...every },
    ]);
    await expect(deviceValues(till)).resolves.toEqual({ station: true, pass: null });

    await storeDeviceValue(till, "pass", false);
    await set(venue.till, {
      station: every,
      pass: { ...passes(venue).pass, showNonPassStations: true },
      pass_monitor: { ...every, showNonPassStations: true },
    });
    await expect(deviceValues(till)).resolves.toEqual({ station: true, pass: false });
  });

  it("leaves a narrowed device's stored value alone and records no removal for it", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { pass: { stationIds: [venue.grill, venue.cold], zoneIds: null } });
    const pass = await seedDevice(venue.kds, "Pass");
    await choose(pass, venue.kds, [
      { kind: "pass", stationIds: [venue.grill, venue.cold], zoneIds: null },
    ]);
    await storeDeviceValue(pass, "pass", false);

    await expect(
      set(venue.kds, {
        pass: { stationIds: [venue.grill], zoneIds: null, showNonPassStations: true },
      }),
    ).resolves.toEqual([
      {
        deviceId: pass,
        deviceName: "Pass",
        lost: { screens: [], stations: [{ id: venue.cold, name: "Cold" }], zones: [] },
      },
    ]);
    await expect(deviceValues(pass)).resolves.toEqual({ pass: false });
    expect(
      (await removalsOf(pass)).map(({ screen, stationId, zoneId }) => ({
        screen,
        stationId,
        zoneId,
      })),
    ).toEqual([{ screen: "pass", stationId: venue.cold, zoneId: null }]);

    await expect(
      set(venue.kds, {
        pass: { stationIds: [venue.grill], zoneIds: null, showNonPassStations: false },
      }),
    ).resolves.toEqual([]);
    expect(await removalsOf(pass)).toHaveLength(1);
  });

  it("stores the profile's value in its column, and reads a row inserted without it as true", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { pass: { ...every, showNonPassStations: false } });
    const exported = await db.all<Record<string, unknown>>(
      sql`select * from device_profile_kitchen_screens where device_profile_id = ${venue.kds}`,
    );
    expect(exported).toEqual([expect.objectContaining({ show_non_pass_stations: 0 })]);

    await db.run(sql`
      insert into device_profile_kitchen_screens (device_profile_id, screen, every_station, every_zone)
      values (${venue.till}, 'pass', 1, 1)
    `);
    expect((await screensOf(venue.till))!.pass).toEqual({
      ...every,
      showNonPassStations: true,
    });
  });

  it("puts the key on a profile's pass and pass-monitor entries and never on its station entry", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { station: every, pass: every, pass_monitor: every });
    const screens = (await screensOf(venue.kds))!;
    expect(screens.station).not.toHaveProperty("showNonPassStations");
    expect(screens.pass).toHaveProperty("showNonPassStations", true);
    expect(screens.pass_monitor).toHaveProperty("showNonPassStations", true);
  });

  const displayOf = async (deviceId: string, kind: DeviceKitchenScreen["kind"]) => {
    const screen = (await scoped((tx) => readDeviceKitchenScreens(tx, deviceId))).find(
      (entry) => entry.kind === kind,
    )!;
    return {
      showNonPassStations: screen.showNonPassStations,
      nonPassStationsOverride: screen.nonPassStationsOverride,
    };
  };

  it("resolves a device's choice from its own stored value, else its profile's row", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { pass: { ...every, showNonPassStations: false } });
    const pass = await seedDevice(venue.kds, "Pass");
    await choose(pass, venue.kds, [{ kind: "pass", ...every }]);
    await expect(displayOf(pass, "pass")).resolves.toEqual({
      showNonPassStations: false,
      nonPassStationsOverride: null,
    });

    await storeDeviceValue(pass, "pass", true);
    await expect(displayOf(pass, "pass")).resolves.toEqual({
      showNonPassStations: true,
      nonPassStationsOverride: true,
    });

    await set(venue.kds, { pass: { ...every, showNonPassStations: true } });
    await storeDeviceValue(pass, "pass", false);
    await expect(displayOf(pass, "pass")).resolves.toEqual({
      showNonPassStations: false,
      nonPassStationsOverride: false,
    });
  });

  it("carries a later profile change to a device with no stored value only", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { pass_monitor: every });
    const following = await seedDevice(venue.kds, "Following");
    const own = await seedDevice(venue.kds, "Own");
    for (const device of [following, own]) {
      await choose(device, venue.kds, [{ kind: "pass_monitor", ...every }]);
    }
    await storeDeviceValue(own, "pass_monitor", true);

    await set(venue.kds, { pass_monitor: { ...every, showNonPassStations: false } });
    await expect(displayOf(following, "pass_monitor")).resolves.toEqual({
      showNonPassStations: false,
      nonPassStationsOverride: null,
    });
    await expect(displayOf(own, "pass_monitor")).resolves.toEqual({
      showNonPassStations: true,
      nonPassStationsOverride: true,
    });
  });

  it("reads true and null for a till's pass under a profile with no pass row", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.till, { station: every });
    const till = await seedDevice(venue.till, "Till");
    await choose(till, venue.till, [{ kind: "pass", ...every }]);
    await expect(displayOf(till, "pass")).resolves.toEqual({
      showNonPassStations: true,
      nonPassStationsOverride: null,
    });
  });

  it("reads the profile's value and null for a kind a narrowing took, whatever the device stored", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, {
      pass: { stationIds: [venue.grill, venue.cold], zoneIds: null, showNonPassStations: false },
    });
    const pass = await seedDevice(venue.kds, "Pass");
    await choose(pass, venue.kds, [{ kind: "pass", stationIds: [venue.cold], zoneIds: null }]);
    await storeDeviceValue(pass, "pass", true);
    await set(venue.kds, { pass: { stationIds: [venue.grill], zoneIds: null } });

    await expect(displayOf(pass, "pass")).resolves.toEqual({
      showNonPassStations: false,
      nonPassStationsOverride: null,
    });
  });

  it("keeps a device's own choice through a narrowing that takes only some of its stations", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, {
      pass: { stationIds: [venue.grill, venue.cold], zoneIds: null, showNonPassStations: true },
    });
    const pass = await seedDevice(venue.kds, "Pass");
    await choose(pass, venue.kds, [
      { kind: "pass", stationIds: [venue.grill, venue.cold], zoneIds: null },
    ]);
    await storeDeviceValue(pass, "pass", false);
    await set(venue.kds, { pass: { stationIds: [venue.grill], zoneIds: null } });

    expect(await removalsOf(pass)).toHaveLength(1);
    await expect(displayOf(pass, "pass")).resolves.toEqual({
      showNonPassStations: false,
      nonPassStationsOverride: false,
    });
  });

  it("sets and clears a device's own choice through the seat, touching no scope or removal", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, passes(venue));
    const pass = await seedDevice(venue.kds, "Pass");
    const monitor = await seedDevice(venue.kds, "Monitor");
    const other = await seedDevice(venue.kds, "Other pass");
    await choose(pass, venue.kds, [
      { kind: "pass", stationIds: [venue.grill, venue.cold], zoneIds: null },
    ]);
    await choose(monitor, venue.kds, [{ kind: "pass_monitor", ...every }]);
    await choose(other, venue.kds, [{ kind: "pass", stationIds: [venue.grill], zoneIds: null }]);
    await recordRemoval(pass, "pass", { stationId: venue.cold });
    const scopes = async () => ({
      screens: await db
        .select({
          deviceId: deviceKitchenScreens.deviceId,
          screen: deviceKitchenScreens.screen,
          everyStation: deviceKitchenScreens.everyStation,
          everyZone: deviceKitchenScreens.everyZone,
        })
        .from(deviceKitchenScreens),
      stations: await db.select().from(deviceKitchenScreenStations),
      zones: await db.select().from(deviceKitchenScreenZones),
      removals: await db.select().from(deviceKitchenScreenRemovals),
    });
    const before = await scopes();
    const display = (deviceId: string, kind: "pass" | "pass_monitor", value: boolean | null) =>
      scoped((tx) => setDeviceKitchenScreenDisplay(tx, deviceId, kind, value));

    await display(pass, "pass", false);
    await display(monitor, "pass_monitor", true);
    await expect(deviceValues(pass)).resolves.toEqual({ pass: false });
    await expect(deviceValues(monitor)).resolves.toEqual({ pass_monitor: true });
    await expect(deviceValues(other)).resolves.toEqual({ pass: null });
    await display(pass, "pass", null);
    await display(monitor, "pass_monitor", false);
    await expect(deviceValues(pass)).resolves.toEqual({ pass: null });
    await expect(deviceValues(monitor)).resolves.toEqual({ pass_monitor: false });
    await expect(scopes()).resolves.toEqual(before);

    await expect(outcome(display(pass, "pass_monitor", true))).resolves.toEqual({
      code: "device.unauthorized",
      params: {},
    });
    await expect(deviceValues(pass)).resolves.toEqual({ pass: null });
    await expect(deviceValues(monitor)).resolves.toEqual({ pass_monitor: false });
  });

  it("refuses through the seat a kind a narrowing took, whole or all its stations, keeping the stored value", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, passes(venue));
    const whole = await seedDevice(venue.kds, "Taken whole");
    const emptied = await seedDevice(venue.kds, "Emptied");
    const partial = await seedDevice(venue.kds, "Partly narrowed");
    for (const device of [whole, emptied, partial])
      await choose(device, venue.kds, [
        { kind: "pass", stationIds: [venue.grill, venue.cold], zoneIds: null },
      ]);
    for (const device of [whole, emptied, partial]) await storeDeviceValue(device, "pass", false);
    await recordRemoval(whole, "pass");
    await recordRemoval(emptied, "pass", { stationId: venue.grill });
    await recordRemoval(emptied, "pass", { stationId: venue.cold });
    await recordRemoval(partial, "pass", { stationId: venue.cold });
    const display = (deviceId: string, value: boolean | null) =>
      scoped((tx) => setDeviceKitchenScreenDisplay(tx, deviceId, "pass", value));

    for (const device of [whole, emptied]) {
      await expect(outcome(display(device, true))).resolves.toEqual({
        code: "device.unauthorized",
        params: {},
      });
      await expect(deviceValues(device)).resolves.toEqual({ pass: false });
    }
    await display(partial, true);
    await expect(deviceValues(partial)).resolves.toEqual({ pass: true });
  });

  it("refuses through the seat a station screen's value, writing nothing", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { station: every });
    const line = await seedDevice(venue.kds, "Line");
    await choose(line, venue.kds, [{ kind: "station", ...every }]);
    await expect(
      outcome(scoped((tx) => setDeviceKitchenScreenDisplay(tx, line, "station" as never, false))),
    ).resolves.toEqual({ code: "device.unauthorized", params: {} });
    await expect(deviceValues(line)).resolves.toEqual({ station: null });
  });

  it("writes only the kind it names on a device holding a station screen and a pass", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.till, { station: every, pass: every });
    const till = await seedDevice(venue.till, "Till");
    await choose(till, venue.till, [
      { kind: "station", ...every },
      { kind: "pass", ...every },
    ]);
    await scoped((tx) => setDeviceKitchenScreenDisplay(tx, till, "pass", false));
    await expect(deviceValues(till)).resolves.toEqual({ station: null, pass: false });
  });

  it("reads true and null for a station screen", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { station: every });
    const line = await seedDevice(venue.kds, "Line");
    await choose(line, venue.kds, [{ kind: "station", ...every }]);
    await storeDeviceValue(line, "station", false);
    await expect(displayOf(line, "station")).resolves.toEqual({
      showNonPassStations: true,
      nonPassStationsOverride: null,
    });
  });
});
