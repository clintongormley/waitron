import { eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  deviceProfiles,
  devices,
  floorZones,
  kitchenStations,
  locations,
  withTransaction,
} from "@waitron/db";
import { randomUUID } from "node:crypto";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError, locationId as brandLocationId } from "@waitron/shared";
import type { LocationId } from "@waitron/shared";
import type { DeviceKitchenScreen, ProfileKitchenScreens } from "@waitron/module";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { createDepartment, createServiceZone } from "./operations.js";
import {
  addProfileKitchenScreen,
  assertDeviceKitchenScreens,
  assertKitchenDisplayHasScreen,
  assertPassScreenZone,
  narrowDeviceKitchenScreens,
  readDeviceKitchenScreens,
  readDevicesKitchenScreens,
  readProfileKitchenScreens,
  readStationScreens,
  setDeviceKitchenScreens,
  setProfileKitchenScreens,
} from "./kitchen-screens.js";
import {
  deviceKitchenScreenRemovals,
  deviceKitchenScreens,
  deviceProfileKitchenScreens,
  deviceProfileKitchenScreenStations,
} from "./schema/kitchen-screens.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
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

async function seedLocation(): Promise<LocationId> {
  const [row] = await db
    .insert(locations)
    .values({
      name: `Venue ${randomUUID()}`,
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
    })
    .returning({ id: locations.id });
  return brandLocationId(row!.id);
}

async function seedProfile(formFactor: "till" | "phone-portrait" | "kds"): Promise<string> {
  const [row] = await db
    .insert(deviceProfiles)
    .values({ name: `Profile ${randomUUID()}`, formFactor })
    .returning({ id: deviceProfiles.id });
  return row!.id;
}

async function seedStation(locationId: LocationId, name: string, displayOrder: number) {
  const [row] = await db
    .insert(kitchenStations)
    .values({ locationId, name, displayOrder })
    .returning({ id: kitchenStations.id });
  return row!.id;
}

/**
 * Stations Grill, Cold and Pastry, shown Cold, Grill, Pastry; zones Terrace, Dining room and
 * Counter, shown Terrace, Dining room, Counter; a kitchen display profile and a till profile.
 */
async function seedVenue() {
  const locationId = await seedLocation();
  const cfg = { locationId };
  const grill = await seedStation(locationId, "Grill", 2);
  const cold = await seedStation(locationId, "Cold", 1);
  const pastry = await seedStation(locationId, "Pastry", 3);
  const zones = await scoped(async (tx) => {
    const restaurant = await createDepartment(tx, cfg, {
      name: "Restaurant",
      defaultServiceMode: "table_tab",
    });
    const dining = await createServiceZone(tx, cfg, {
      name: "Dining room",
      departmentId: restaurant.id,
    });
    const terrace = await createServiceZone(tx, cfg, {
      name: "Terrace",
      departmentId: restaurant.id,
    });
    const counter = await createServiceZone(tx, cfg, {
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

type Venue = Awaited<ReturnType<typeof seedVenue>>;

const set = (venue: Venue, profileId: string, screens: ProfileKitchenScreens) =>
  scoped((tx) => setProfileKitchenScreens(tx, venue.cfg, profileId, screens));

async function screensOf(venue: Venue, profileId: string) {
  const all = await scoped((tx) => readProfileKitchenScreens(tx, venue.cfg));
  return all.find((entry) => entry.profileId === profileId)?.screens;
}

describe("a profile's kitchen screens", () => {
  it("stores each kind a kitchen display offers, stations and zones in display order", async () => {
    const venue = await seedVenue();
    await expect(
      set(venue, venue.kds, {
        station: { stationIds: [venue.grill, venue.cold, venue.grill], zoneIds: null },
        pass: { stationIds: null, zoneIds: [venue.counter, venue.terrace] },
        pass_monitor: { stationIds: [venue.pastry, venue.cold], zoneIds: null },
      }),
    ).resolves.toEqual([]);
    await expect(screensOf(venue, venue.kds)).resolves.toEqual({
      station: { stationIds: [venue.cold, venue.grill], zoneIds: null },
      pass: { stationIds: null, zoneIds: [venue.terrace, venue.counter] },
      pass_monitor: { stationIds: [venue.cold, venue.pastry], zoneIds: null },
    });
    expect(
      await db
        .select()
        .from(deviceProfileKitchenScreenStations)
        .where(eq(deviceProfileKitchenScreenStations.deviceProfileId, venue.kds)),
    ).toHaveLength(4);
  });

  it("lets a till bound a station screen and a pass screen", async () => {
    const venue = await seedVenue();
    await set(venue, venue.till, {
      station: { stationIds: null, zoneIds: null },
      pass: { stationIds: [venue.grill], zoneIds: [venue.dining] },
    });
    await expect(screensOf(venue, venue.till)).resolves.toEqual({
      station: { stationIds: null, zoneIds: null },
      pass: { stationIds: [venue.grill], zoneIds: [venue.dining] },
    });
  });

  it("reads every live profile, one with nothing stored as no screens, and no retired one", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, { station: { stationIds: [venue.grill], zoneIds: null } });
    await db
      .update(deviceProfiles)
      .set({ retiredAt: new Date().toISOString() })
      .where(eq(deviceProfiles.id, venue.kds));
    const all = await scoped((tx) => readProfileKitchenScreens(tx, venue.cfg));
    expect(all.find((entry) => entry.profileId === venue.kds)).toBeUndefined();
    expect(all.find((entry) => entry.profileId === venue.till)).toEqual({
      profileId: venue.till,
      screens: {},
    });
  });

  it("reads a station or zone switched off since, in its place", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, {
      pass: { stationIds: [venue.grill, venue.cold], zoneIds: [venue.dining, venue.terrace] },
    });
    await db
      .update(kitchenStations)
      .set({ active: false })
      .where(eq(kitchenStations.id, venue.cold));
    await db.update(floorZones).set({ active: false }).where(eq(floorZones.id, venue.terrace));
    await expect(screensOf(venue, venue.kds)).resolves.toEqual({
      pass: { stationIds: [venue.cold, venue.grill], zoneIds: [venue.terrace, venue.dining] },
    });
  });

  it("replaces every kind on each save, dropping a kind it does not name", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, {
      station: { stationIds: [venue.grill], zoneIds: null },
      pass: { stationIds: null, zoneIds: null },
    });
    await set(venue, venue.kds, { station: { stationIds: [venue.cold], zoneIds: null } });
    await expect(screensOf(venue, venue.kds)).resolves.toEqual({
      station: { stationIds: [venue.cold], zoneIds: null },
    });
    await set(venue, venue.kds, {});
    await expect(screensOf(venue, venue.kds)).resolves.toEqual({});
  });

  it("lets a till profile and a handheld profile each store a pass monitor", async () => {
    const venue = await seedVenue();
    const handheld = await seedProfile("phone-portrait");
    for (const profileId of [venue.till, handheld]) {
      await expect(
        set(venue, profileId, {
          pass_monitor: { stationIds: [venue.pastry, venue.grill], zoneIds: [venue.counter] },
        }),
      ).resolves.toEqual([]);
      await expect(screensOf(venue, profileId)).resolves.toEqual({
        pass_monitor: { stationIds: [venue.grill, venue.pastry], zoneIds: [venue.counter] },
      });
    }
  });

  it("refuses zones on a station screen", async () => {
    const venue = await seedVenue();
    await expect(
      outcome(set(venue, venue.kds, { station: { stationIds: null, zoneIds: [venue.dining] } })),
    ).resolves.toEqual(refused("kitchenScreens", "not_for_screen"));
  });

  it("refuses an explicit empty list, naming its field", async () => {
    const venue = await seedVenue();
    const every = { stationIds: null, zoneIds: null };
    for (const [screens, field] of [
      [{ station: { stationIds: [], zoneIds: null } }, "stationScreenStations"],
      [{ pass: { ...every, stationIds: [] } }, "passScreenStations"],
      [{ pass: { ...every, zoneIds: [] } }, "passScreenZones"],
      [{ pass_monitor: { ...every, stationIds: [] } }, "passMonitorStations"],
      [{ pass_monitor: { ...every, zoneIds: [] } }, "passMonitorZones"],
    ] as const) {
      await expect(outcome(set(venue, venue.kds, screens))).resolves.toEqual(
        refused(field, "empty"),
      );
    }
    await expect(screensOf(venue, venue.kds)).resolves.toEqual({});
  });

  it("refuses an unknown station or zone, one at another location, or one switched off", async () => {
    const venue = await seedVenue();
    const elsewhere = await seedVenue();
    const offStation = await seedStation(venue.cfg.locationId, "Old grill", 0);
    await db
      .update(kitchenStations)
      .set({ active: false })
      .where(eq(kitchenStations.id, offStation));
    await db.update(floorZones).set({ active: false }).where(eq(floorZones.id, venue.counter));
    const every = { stationIds: null, zoneIds: null };
    for (const [screens, field] of [
      [{ station: { stationIds: [randomUUID()], zoneIds: null } }, "stationScreenStations"],
      [{ station: { stationIds: [elsewhere.grill], zoneIds: null } }, "stationScreenStations"],
      [{ station: { stationIds: [offStation], zoneIds: null } }, "stationScreenStations"],
      [{ pass: { ...every, stationIds: [venue.grill, offStation] } }, "passScreenStations"],
      [{ pass: { ...every, zoneIds: [elsewhere.dining] } }, "passScreenZones"],
      [{ pass: { ...every, zoneIds: [venue.dining, venue.counter] } }, "passScreenZones"],
      [{ pass_monitor: { ...every, stationIds: [offStation] } }, "passMonitorStations"],
      [{ pass_monitor: { ...every, zoneIds: [randomUUID()] } }, "passMonitorZones"],
    ] as const) {
      await expect(outcome(set(venue, venue.kds, screens))).resolves.toEqual(
        refused(field, "not_found"),
      );
    }
    await expect(screensOf(venue, venue.kds)).resolves.toEqual({});
  });

  it("keeps a station or zone switched off since it was stored, and still refuses adding one", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, {
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
    await set(venue, venue.kds, {
      pass: { stationIds: [venue.grill, venue.cold], zoneIds: [venue.dining] },
    });
    await expect(screensOf(venue, venue.kds)).resolves.toEqual({
      pass: { stationIds: [venue.cold, venue.grill], zoneIds: [venue.dining] },
    });
    await expect(
      outcome(
        set(venue, venue.kds, {
          pass: { stationIds: [venue.grill, venue.pastry], zoneIds: [venue.dining] },
        }),
      ),
    ).resolves.toEqual(refused("passScreenStations", "not_found"));
    await expect(
      outcome(
        set(venue, venue.kds, {
          pass: { stationIds: [venue.grill], zoneIds: [venue.dining, venue.counter] },
        }),
      ),
    ).resolves.toEqual(refused("passScreenZones", "not_found"));
    // Stored for the pass screen is not stored for the station screen.
    await expect(
      outcome(set(venue, venue.kds, { station: { stationIds: [venue.grill], zoneIds: null } })),
    ).resolves.toEqual(refused("stationScreenStations", "not_found"));
  });

  it("refuses the screens of a profile that is unknown or retired", async () => {
    const venue = await seedVenue();
    await db
      .update(deviceProfiles)
      .set({ retiredAt: new Date().toISOString() })
      .where(eq(deviceProfiles.id, venue.kds));
    await expect(outcome(set(venue, venue.kds, {}))).resolves.toEqual(
      refused("profileId", "not_found"),
    );
    await expect(outcome(set(venue, randomUUID(), {}))).resolves.toEqual(
      refused("profileId", "not_found"),
    );
  });
});

describe("a profile whose form factor changes", () => {
  it("keeps a kitchen display's pass monitor once the profile is a till, and saves it again", async () => {
    const venue = await seedVenue();
    const screens = {
      station: { stationIds: null, zoneIds: null },
      pass_monitor: { stationIds: [venue.grill], zoneIds: [venue.dining] },
    };
    await set(venue, venue.kds, screens);
    await db
      .update(deviceProfiles)
      .set({ formFactor: "till" })
      .where(eq(deviceProfiles.id, venue.kds));
    await expect(screensOf(venue, venue.kds)).resolves.toEqual(screens);
    await expect(outcome(set(venue, venue.kds, screens))).resolves.toEqual({ resolved: [] });
    await expect(screensOf(venue, venue.kds)).resolves.toEqual(screens);
  });
});

describe("a kitchen screen added to a profile", () => {
  const add = (
    venue: Venue,
    profileId: string,
    screen: Parameters<typeof addProfileKitchenScreen>[3],
  ) => scoped((tx) => addProfileKitchenScreen(tx, venue.cfg, profileId, screen));

  it("creates the profile's row with the lists it is given", async () => {
    const venue = await seedVenue();
    await add(venue, venue.kds, { kind: "station", stationIds: [venue.grill], zoneIds: null });
    await add(venue, venue.kds, {
      kind: "pass",
      stationIds: null,
      zoneIds: [venue.dining],
    });
    await expect(screensOf(venue, venue.kds)).resolves.toEqual({
      station: { stationIds: [venue.grill], zoneIds: null },
      pass: { stationIds: null, zoneIds: [venue.dining] },
    });
  });

  it("adds the stations and zones an explicit list lacks, removing none", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, {
      pass: { stationIds: [venue.grill], zoneIds: [venue.dining] },
    });
    await add(venue, venue.kds, {
      kind: "pass",
      stationIds: [venue.cold, venue.grill],
      zoneIds: [venue.terrace],
    });
    await expect(screensOf(venue, venue.kds)).resolves.toEqual({
      pass: { stationIds: [venue.cold, venue.grill], zoneIds: [venue.terrace, venue.dining] },
    });
  });

  it("turns an explicit list into every one when given every one", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, {
      pass: { stationIds: [venue.grill], zoneIds: [venue.dining] },
    });
    await add(venue, venue.kds, { kind: "pass", stationIds: null, zoneIds: null });
    await expect(screensOf(venue, venue.kds)).resolves.toEqual({
      pass: { stationIds: null, zoneIds: null },
    });
  });

  it("changes nothing on an every list, and leaves the other kinds alone", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, {
      station: { stationIds: null, zoneIds: null },
      pass_monitor: { stationIds: [venue.grill], zoneIds: null },
    });
    await add(venue, venue.kds, { kind: "station", stationIds: [venue.cold], zoneIds: null });
    await expect(screensOf(venue, venue.kds)).resolves.toEqual({
      station: { stationIds: null, zoneIds: null },
      pass_monitor: { stationIds: [venue.grill], zoneIds: null },
    });
    expect(
      await db
        .select()
        .from(deviceProfileKitchenScreens)
        .where(eq(deviceProfileKitchenScreens.deviceProfileId, venue.kds)),
    ).toHaveLength(2);
  });
});

async function seedDevice(venue: Venue, profileId: string, label: string): Promise<string> {
  const [row] = await db
    .insert(devices)
    .values({
      locationId: venue.cfg.locationId,
      deviceProfileId: profileId,
      label,
      tokenHash: "hash",
    })
    .returning({ id: devices.id });
  return row!.id;
}

const choose = (
  venue: Venue,
  deviceId: string,
  profileId: string,
  screens: readonly DeviceKitchenScreen[],
) => scoped((tx) => setDeviceKitchenScreens(tx, venue.cfg, { deviceId, profileId, screens }));

const shown = (venue: Venue, deviceId: string) =>
  scoped((tx) => readDeviceKitchenScreens(tx, venue.cfg, deviceId));

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
    const venue = await seedVenue();
    await set(venue, venue.kds, {
      station: { stationIds: [venue.grill, venue.cold], zoneIds: null },
      pass: { stationIds: null, zoneIds: [venue.dining, venue.terrace] },
      pass_monitor: every,
    });
    const screen = await seedDevice(venue, venue.kds, "Pass screen");
    const till = await seedDevice(venue, venue.till, "Till");
    return { venue, screen, till };
  }

  it("asks a kitchen display for exactly one, and refuses a kind named twice anywhere", async () => {
    const { venue, screen, till } = await kitchen();
    await expect(outcome(choose(venue, screen, venue.kds, []))).resolves.toEqual({
      code: "kitchen_screen.required",
      params: {},
    });
    await expect(
      outcome(
        choose(venue, screen, venue.kds, [
          { kind: "station", ...every },
          { kind: "pass", ...every },
        ]),
      ),
    ).resolves.toEqual(invalid("screens", "one_only"));
    await expect(
      outcome(
        choose(venue, till, venue.till, [
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
    await set(venue, venue.kds, { station: every });
    await expect(
      outcome(choose(venue, screen, venue.kds, [{ kind: "pass", ...every }])),
    ).resolves.toEqual({ code: "kitchen_screen.not_allowed", params: { screen: "pass" } });
    await expect(
      outcome(choose(venue, till, venue.till, [{ kind: "pass_monitor", ...every }])),
    ).resolves.toEqual({ code: "kitchen_screen.not_allowed", params: { screen: "pass_monitor" } });
  });

  it("lets a till and a handheld choose a pass monitor within their profile's row, and read it back", async () => {
    const venue = await seedVenue();
    const handheldProfile = await seedProfile("phone-portrait");
    const row = { stationIds: [venue.grill, venue.cold], zoneIds: [venue.dining, venue.terrace] };
    for (const profileId of [venue.till, handheldProfile]) {
      await set(venue, profileId, { pass_monitor: row });
      const device = await seedDevice(venue, profileId, `Device ${profileId}`);
      await expect(
        outcome(
          choose(venue, device, profileId, [
            { kind: "pass_monitor", stationIds: [venue.grill], zoneIds: [venue.terrace] },
          ]),
        ),
      ).resolves.toEqual({ resolved: undefined });
      await expect(shown(venue, device)).resolves.toEqual([
        {
          kind: "pass_monitor",
          available: true,
          everyStation: false,
          everyZone: false,
          profileEveryStation: false,
          stations: [{ id: venue.grill, name: "Grill", available: true, switchedOff: false }],
          zones: [{ id: venue.terrace, name: "Terrace", available: true, switchedOff: false }],
        },
      ]);
    }
  });

  it("refuses a till's pass monitor station or zone outside its profile's row", async () => {
    const { venue, till } = await kitchen();
    await set(venue, venue.till, {
      pass_monitor: { stationIds: [venue.grill], zoneIds: [venue.dining] },
    });
    await expect(
      outcome(
        choose(venue, till, venue.till, [
          { kind: "pass_monitor", stationIds: [venue.pastry], zoneIds: null },
        ]),
      ),
    ).resolves.toEqual({
      code: "station.not_allowed",
      params: { stationId: venue.pastry, screen: "pass_monitor" },
    });
    await expect(
      outcome(
        choose(venue, till, venue.till, [
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
    await set(venue, venue.till, { pass: every, pass_monitor: every });
    await expect(
      outcome(
        choose(venue, till, venue.till, [
          { kind: "pass", ...every },
          { kind: "pass_monitor", ...every },
        ]),
      ),
    ).resolves.toEqual(invalid("screens", "one_only"));
    expect(await storedKindsOf(till)).toEqual([]);
    await expect(
      outcome(
        choose(venue, till, venue.till, [
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
        choose(venue, screen, venue.kds, [
          { kind: "station", stationIds: [venue.grill, venue.pastry], zoneIds: null },
        ]),
      ),
    ).resolves.toEqual({
      code: "station.not_allowed",
      params: { stationId: venue.pastry, screen: "station" },
    });
    await expect(
      outcome(
        choose(venue, screen, venue.kds, [
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
        choose(venue, screen, venue.kds, [
          { kind: "station", stationIds: null, zoneIds: [venue.dining] },
        ]),
      ),
    ).resolves.toEqual(invalid("zoneIds", "not_for_screen", "station"));
    await expect(
      outcome(
        choose(venue, till, venue.till, [{ kind: "station", stationIds: [], zoneIds: null }]),
      ),
    ).resolves.toEqual(invalid("stationIds", "empty", "station"));
    await expect(
      outcome(choose(venue, screen, venue.kds, [{ kind: "pass", stationIds: null, zoneIds: [] }])),
    ).resolves.toEqual(invalid("zoneIds", "empty", "pass"));
  });

  it("refuses an unknown station or zone, one at another location, or one switched off", async () => {
    const { venue, till } = await kitchen();
    const elsewhere = await seedVenue();
    await db
      .update(kitchenStations)
      .set({ active: false })
      .where(eq(kitchenStations.id, venue.cold));
    await db.update(floorZones).set({ active: false }).where(eq(floorZones.id, venue.terrace));
    for (const [screen, field] of [
      [{ kind: "station", stationIds: [randomUUID()], zoneIds: null }, "stationIds"],
      [{ kind: "station", stationIds: [elsewhere.grill], zoneIds: null }, "stationIds"],
      [{ kind: "pass", stationIds: [venue.grill, venue.cold], zoneIds: null }, "stationIds"],
      [{ kind: "pass", stationIds: null, zoneIds: [elsewhere.dining] }, "zoneIds"],
      [{ kind: "pass", stationIds: null, zoneIds: [venue.dining, venue.terrace] }, "zoneIds"],
    ] as const) {
      await expect(outcome(choose(venue, till, venue.till, [screen]))).resolves.toEqual(
        invalid(field, "not_found", screen.kind),
      );
    }
    expect(await storedKindsOf(till)).toEqual([]);
  });

  it("keeps a station or zone switched off since the device stored it for the same screen", async () => {
    const { venue, till } = await kitchen();
    const pass = { kind: "pass", stationIds: [venue.cold], zoneIds: [venue.terrace] } as const;
    await choose(venue, till, venue.till, [pass]);
    await db
      .update(kitchenStations)
      .set({ active: false })
      .where(eq(kitchenStations.id, venue.cold));
    await db.update(floorZones).set({ active: false }).where(eq(floorZones.id, venue.terrace));
    await expect(outcome(choose(venue, till, venue.till, [pass]))).resolves.toEqual({
      resolved: undefined,
    });
    await expect(
      outcome(
        choose(venue, till, venue.till, [
          pass,
          { kind: "station", stationIds: [venue.cold], zoneIds: null },
        ]),
      ),
    ).resolves.toEqual(invalid("stationIds", "not_found", "station"));
  });

  it("accepts every station and zone under any profile list, and a till with no screens", async () => {
    const { venue, screen, till } = await kitchen();
    await expect(
      outcome(choose(venue, screen, venue.kds, [{ kind: "pass", ...every }])),
    ).resolves.toEqual({ resolved: undefined });
    await expect(outcome(choose(venue, till, venue.till, []))).resolves.toEqual({
      resolved: undefined,
    });
    expect(await storedKindsOf(till)).toEqual([]);
  });

  it("lets a till's profile with no row for a kind bound nothing", async () => {
    const { venue, till } = await kitchen();
    await set(venue, venue.till, { pass: { stationIds: [venue.grill], zoneIds: null } });
    await expect(
      outcome(
        choose(venue, till, venue.till, [
          { kind: "station", stationIds: [venue.pastry], zoneIds: null },
          { kind: "pass", stationIds: [venue.grill], zoneIds: [venue.counter] },
        ]),
      ),
    ).resolves.toEqual({ resolved: undefined });
    await expect(
      outcome(
        choose(venue, till, venue.till, [
          { kind: "pass", stationIds: [venue.pastry], zoneIds: null },
        ]),
      ),
    ).resolves.toEqual({
      code: "station.not_allowed",
      params: { stationId: venue.pastry, screen: "pass" },
    });
  });

  it("replaces the device's choice and clears its recorded removals, and no other device's", async () => {
    const { venue, screen, till } = await kitchen();
    await choose(venue, till, venue.till, [
      { kind: "station", ...every },
      { kind: "pass", stationIds: [venue.grill], zoneIds: [venue.dining] },
    ]);
    await recordRemoval(till, "station", { stationId: venue.pastry });
    await recordRemoval(screen, "pass");
    await choose(venue, till, venue.till, [
      { kind: "pass", stationIds: [venue.cold], zoneIds: null },
    ]);
    expect(await storedKindsOf(till)).toEqual(["pass"]);
    expect(await removalsOf(till)).toEqual([]);
    expect(await removalsOf(screen)).toHaveLength(1);
    await expect(shown(venue, till)).resolves.toEqual([
      {
        kind: "pass",
        available: true,
        everyStation: false,
        everyZone: true,
        profileEveryStation: true,
        stations: [{ id: venue.cold, name: "Cold", available: true, switchedOff: false }],
        zones: null,
      },
    ]);
  });

  it("checks a choice without writing it", async () => {
    const { venue, screen } = await kitchen();
    const assert = (screens: readonly DeviceKitchenScreen[]) =>
      outcome(scoped((tx) => assertDeviceKitchenScreens(tx, venue.cfg, venue.kds, screens)));
    await expect(assert([])).resolves.toMatchObject({ code: "kitchen_screen.required" });
    await expect(assert([{ kind: "station", ...every }])).resolves.toEqual({
      resolved: undefined,
    });
    expect(await storedKindsOf(screen)).toEqual([]);
  });

  it("checks a choice keeping a switched-off station only for the device that stores it", async () => {
    const { venue, screen } = await kitchen();
    const other = await seedDevice(venue, venue.kds, "Other");
    const cold = { kind: "station", stationIds: [venue.cold], zoneIds: null } as const;
    await choose(venue, screen, venue.kds, [cold]);
    await db
      .update(kitchenStations)
      .set({ active: false })
      .where(eq(kitchenStations.id, venue.cold));
    const assert = (deviceId?: string) =>
      outcome(
        scoped((tx) => assertDeviceKitchenScreens(tx, venue.cfg, venue.kds, [cold], deviceId)),
      );
    await expect(assert(screen)).resolves.toEqual({ resolved: undefined });
    await expect(outcome(choose(venue, screen, venue.kds, [cold]))).resolves.toEqual({
      resolved: undefined,
    });
    await expect(assert()).resolves.toEqual(invalid("stationIds", "not_found", "station"));
    await expect(assert(other)).resolves.toEqual(invalid("stationIds", "not_found", "station"));
  });

  it("names the screen in a refusal about a till's station list, which may hold two", async () => {
    const { venue, till } = await kitchen();
    await set(venue, venue.till, {
      station: { stationIds: [venue.grill, venue.pastry], zoneIds: null },
      pass: { stationIds: [venue.grill], zoneIds: null },
    });
    const kitchenList = { kind: "station", stationIds: [venue.pastry], zoneIds: null } as const;
    await expect(
      outcome(
        choose(venue, till, venue.till, [
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
        choose(venue, till, venue.till, [
          kitchenList,
          { kind: "pass", stationIds: [], zoneIds: null },
        ]),
      ),
    ).resolves.toEqual(invalid("stationIds", "empty", "pass"));
    await expect(
      outcome(
        choose(venue, till, venue.till, [
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

  it("shows an every device the profile's stations in display order, its removals in their places", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, {
      station: { stationIds: [venue.pastry, venue.grill, venue.cold], zoneIds: null },
    });
    const screen = await seedDevice(venue, venue.kds, "Line");
    await choose(venue, screen, venue.kds, [{ kind: "station", ...every }]);
    await recordRemoval(screen, "station", { stationId: venue.grill });
    await expect(shown(venue, screen)).resolves.toEqual([
      {
        kind: "station",
        available: true,
        everyStation: true,
        everyZone: true,
        profileEveryStation: false,
        stations: [
          slot(venue.cold, "Cold"),
          slot(venue.grill, "Grill", false),
          slot(venue.pastry, "Pastry"),
        ],
        zones: null,
      },
    ]);
  });

  it("shows an explicit device its stored stations and its removals in display order", async () => {
    const venue = await seedVenue();
    const till = await seedDevice(venue, venue.till, "Till");
    await choose(venue, till, venue.till, [
      { kind: "pass", stationIds: [venue.pastry, venue.cold], zoneIds: [venue.counter] },
    ]);
    await recordRemoval(till, "pass", { stationId: venue.grill });
    await recordRemoval(till, "pass", { zoneId: venue.terrace });
    await expect(shown(venue, till)).resolves.toEqual([
      {
        kind: "pass",
        available: true,
        everyStation: false,
        everyZone: false,
        profileEveryStation: true,
        stations: [
          slot(venue.cold, "Cold"),
          slot(venue.grill, "Grill", false),
          slot(venue.pastry, "Pastry"),
        ],
        zones: [slot(venue.terrace, "Terrace", false), slot(venue.counter, "Counter")],
      },
    ]);
  });

  it("shows a station or zone switched off since as no longer available, and again once back on", async () => {
    const venue = await seedVenue();
    const till = await seedDevice(venue, venue.till, "Till");
    await choose(venue, till, venue.till, [
      { kind: "pass", stationIds: [venue.grill, venue.cold], zoneIds: [venue.dining] },
    ]);
    const off = async (active: boolean) => {
      await db.update(kitchenStations).set({ active }).where(eq(kitchenStations.id, venue.cold));
      await db.update(floorZones).set({ active }).where(eq(floorZones.id, venue.dining));
    };
    await off(false);
    await expect(shown(venue, till)).resolves.toEqual([
      {
        kind: "pass",
        available: true,
        everyStation: false,
        everyZone: false,
        profileEveryStation: true,
        stations: [slot(venue.cold, "Cold", false, true), slot(venue.grill, "Grill")],
        zones: [slot(venue.dining, "Dining room", false, true)],
      },
    ]);
    await off(true);
    await expect(shown(venue, till)).resolves.toEqual([
      {
        kind: "pass",
        available: true,
        everyStation: false,
        everyZone: false,
        profileEveryStation: true,
        stations: [slot(venue.cold, "Cold"), slot(venue.grill, "Grill")],
        zones: [slot(venue.dining, "Dining room")],
      },
    ]);
  });

  it("tells a station or zone switched off on its own page from one a narrowing took", async () => {
    const venue = await seedVenue();
    const till = await seedDevice(venue, venue.till, "Till");
    await choose(venue, till, venue.till, [
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
    await expect(shown(venue, till)).resolves.toEqual([
      {
        kind: "pass",
        available: true,
        everyStation: false,
        everyZone: false,
        profileEveryStation: true,
        stations: [
          slot(venue.cold, "Cold", false, true),
          slot(venue.grill, "Grill", false),
          slot(venue.pastry, "Pastry", false),
        ],
        zones: [
          slot(venue.terrace, "Terrace", false),
          slot(venue.dining, "Dining room", false, true),
          slot(venue.counter, "Counter", false),
        ],
      },
    ]);
  });

  it("shows every switched-on station and no zone filter when neither profile nor device lists any", async () => {
    const venue = await seedVenue();
    await db
      .update(kitchenStations)
      .set({ active: false })
      .where(eq(kitchenStations.id, venue.pastry));
    const till = await seedDevice(venue, venue.till, "Till");
    await choose(venue, till, venue.till, [
      { kind: "station", ...every },
      { kind: "pass", ...every },
    ]);
    const stations = [slot(venue.cold, "Cold"), slot(venue.grill, "Grill")];
    await expect(shown(venue, till)).resolves.toEqual([
      {
        kind: "station",
        available: true,
        everyStation: true,
        everyZone: true,
        profileEveryStation: true,
        stations,
        zones: null,
      },
      {
        kind: "pass",
        available: true,
        everyStation: true,
        everyZone: true,
        profileEveryStation: true,
        stations,
        zones: null,
      },
    ]);
  });

  it("narrows every zone to the profile's list, less the device's recorded zone removals", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, {
      pass: { stationIds: [venue.grill], zoneIds: [venue.counter, venue.dining] },
    });
    const screen = await seedDevice(venue, venue.kds, "Pass");
    await choose(venue, screen, venue.kds, [{ kind: "pass", ...every }]);
    await recordRemoval(screen, "pass", { zoneId: venue.counter });
    await expect(shown(venue, screen)).resolves.toEqual([
      {
        kind: "pass",
        available: true,
        everyStation: true,
        everyZone: true,
        profileEveryStation: false,
        stations: [slot(venue.grill, "Grill")],
        zones: [slot(venue.dining, "Dining room"), slot(venue.counter, "Counter", false)],
      },
    ]);
  });

  it("shows a kind recorded as removed after the stored ones, and one that lost its whole list", async () => {
    const venue = await seedVenue();
    const till = await seedDevice(venue, venue.till, "Till");
    await choose(venue, till, venue.till, [
      { kind: "pass", stationIds: [venue.grill], zoneIds: null },
    ]);
    await recordRemoval(till, "station");
    await recordRemoval(till, "station", { stationId: venue.cold });
    const screen = await seedDevice(venue, venue.kds, "Line");
    await recordRemoval(screen, "station", { stationId: venue.grill });
    await expect(shown(venue, till)).resolves.toEqual([
      {
        kind: "pass",
        available: true,
        everyStation: false,
        everyZone: true,
        profileEveryStation: true,
        stations: [slot(venue.grill, "Grill")],
        zones: null,
      },
      {
        kind: "station",
        available: false,
        everyStation: false,
        everyZone: false,
        profileEveryStation: false,
        stations: [slot(venue.cold, "Cold", false)],
        zones: null,
      },
    ]);
    await expect(shown(venue, screen)).resolves.toEqual([
      {
        kind: "station",
        available: true,
        everyStation: false,
        everyZone: false,
        profileEveryStation: false,
        stations: [slot(venue.grill, "Grill", false)],
        zones: null,
      },
    ]);
  });

  it("shows a pass screen that lost its whole zone list with that zone as no longer available", async () => {
    const venue = await seedVenue();
    const screen = await seedDevice(venue, venue.kds, "Pass");
    await recordRemoval(screen, "pass", { zoneId: venue.counter });
    await expect(shown(venue, screen)).resolves.toEqual([
      {
        kind: "pass",
        available: true,
        everyStation: false,
        everyZone: false,
        profileEveryStation: false,
        stations: [],
        zones: [slot(venue.counter, "Counter", false)],
      },
    ]);
  });

  it("shows nothing for a device that chose nothing, or one unknown here", async () => {
    const venue = await seedVenue();
    const till = await seedDevice(venue, venue.till, "Till");
    await expect(shown(venue, till)).resolves.toEqual([]);
    await expect(shown(venue, randomUUID())).resolves.toEqual([]);
  });

  it("reads several devices at once, each as it reads alone, and none for an unknown one or an empty list", async () => {
    const venue = await seedVenue();
    const elsewhere = await seedVenue();
    await set(venue, venue.kds, { station: every, pass: every });
    const line = await seedDevice(venue, venue.kds, "Line");
    await choose(venue, line, venue.kds, [{ kind: "station", ...every }]);
    await recordRemoval(line, "station", { stationId: venue.grill });
    const pass = await seedDevice(venue, venue.kds, "Pass");
    await choose(venue, pass, venue.kds, [
      { kind: "pass", stationIds: [venue.cold], zoneIds: [venue.dining] },
    ]);
    await recordRemoval(pass, "pass", { zoneId: venue.terrace });
    const till = await seedDevice(venue, venue.till, "Till");
    await recordRemoval(till, "station");
    const bare = await seedDevice(venue, venue.till, "Bare");
    const away = await seedDevice(elsewhere, elsewhere.till, "Away");
    await choose(elsewhere, away, elsewhere.till, [{ kind: "pass", ...every }]);
    const unknown = randomUUID();
    const ids = [line, pass, till, bare, away, unknown];

    const read = await scoped((tx) => readDevicesKitchenScreens(tx, venue.cfg, ids));

    const alone = new Map<string, unknown>();
    for (const id of ids) alone.set(id, await shown(venue, id));
    expect(read).toEqual(alone);
    expect(read.get(line)).not.toEqual(read.get(pass));
    expect(read.get(till)).toMatchObject([{ kind: "station", available: false }]);
    expect(read.get(away)).toEqual([]);
    expect(read.get(unknown)).toEqual([]);
    await expect(scoped((tx) => readDevicesKitchenScreens(tx, venue.cfg, []))).resolves.toEqual(
      new Map(),
    );
  });
});

describe("a kitchen display keeping a kitchen screen", () => {
  const check = (venue: Venue, deviceId: string, profileId: string) =>
    outcome(scoped((tx) => assertKitchenDisplayHasScreen(tx, venue.cfg, deviceId, profileId)));

  it("refuses a kitchen display's profile for a device storing no screen, even one a narrowing took", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, { pass_monitor: every });
    const till = await seedDevice(venue, venue.till, "Till");
    const taken = await seedDevice(venue, venue.kds, "Taken");
    await recordRemoval(taken, "pass_monitor");
    const required = { code: "kitchen_screen.required", params: {} };
    await expect(check(venue, till, venue.kds)).resolves.toEqual(required);
    await expect(check(venue, taken, venue.kds)).resolves.toEqual(required);
  });

  it("passes a device storing a screen, and any device on a profile that is not a kitchen display", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, { pass_monitor: every });
    const monitor = await seedDevice(venue, venue.kds, "Monitor");
    await choose(venue, monitor, venue.kds, [{ kind: "pass_monitor", ...every }]);
    const till = await seedDevice(venue, venue.till, "Till");
    await expect(check(venue, monitor, venue.kds)).resolves.toEqual({ resolved: undefined });
    await expect(check(venue, till, venue.till)).resolves.toEqual({ resolved: undefined });
  });
});

describe("an order's zone checked against a device's pass screen", () => {
  const check = (venue: Venue, deviceId: string, zoneId: string | null) =>
    outcome(scoped((tx) => assertPassScreenZone(tx, venue.cfg, deviceId, zoneId)));

  it("refuses a device without a pass screen", async () => {
    const venue = await seedVenue();
    const till = await seedDevice(venue, venue.till, "Till");
    await choose(venue, till, venue.till, [{ kind: "station", ...every }]);
    await expect(check(venue, till, venue.dining)).resolves.toEqual({
      code: "kitchen_screen.not_allowed",
      params: { screen: "pass" },
    });
    const elsewhere = await seedVenue();
    const away = await seedDevice(elsewhere, elsewhere.till, "Away");
    await choose(elsewhere, away, elsewhere.till, [{ kind: "pass", ...every }]);
    await expect(check(venue, away, null)).resolves.toEqual({
      code: "kitchen_screen.not_allowed",
      params: { screen: "pass" },
    });
  });

  it("refuses a zone outside an explicit list, and an order in no zone", async () => {
    const venue = await seedVenue();
    const till = await seedDevice(venue, venue.till, "Till");
    await choose(venue, till, venue.till, [
      { kind: "pass", stationIds: null, zoneIds: [venue.dining, venue.terrace] },
    ]);
    await recordRemoval(till, "pass", { zoneId: venue.counter });
    await db.update(floorZones).set({ active: false }).where(eq(floorZones.id, venue.terrace));
    await expect(check(venue, till, venue.dining)).resolves.toEqual({ resolved: undefined });
    for (const zoneId of [venue.terrace, venue.counter, null]) {
      await expect(check(venue, till, zoneId)).resolves.toEqual({
        code: "kitchen_screen.zone_not_allowed",
        params: { zoneId },
      });
    }
  });

  it("passes any zone, or none, on an every-zone pass", async () => {
    const venue = await seedVenue();
    const till = await seedDevice(venue, venue.till, "Till");
    await choose(venue, till, venue.till, [{ kind: "pass", ...every }]);
    await expect(check(venue, till, venue.counter)).resolves.toEqual({ resolved: undefined });
    await expect(check(venue, till, null)).resolves.toEqual({ resolved: undefined });
  });

  it("refuses a kitchen display whose pass screen a narrowing emptied, for any zone or none", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, { pass: { stationIds: [venue.grill, venue.cold], zoneIds: null } });
    const screen = await seedDevice(venue, venue.kds, "Pass");
    await choose(venue, screen, venue.kds, [
      { kind: "pass", stationIds: [venue.cold], zoneIds: null },
    ]);
    await set(venue, venue.kds, { pass: { stationIds: [venue.grill], zoneIds: null } });
    expect(await storedKindsOf(screen)).toEqual(["pass"]);
    for (const zoneId of [venue.dining, null]) {
      await expect(check(venue, screen, zoneId)).resolves.toEqual({
        code: "kitchen_screen.not_allowed",
        params: { screen: "pass" },
      });
    }
  });

  it("refuses an order in no zone on an every-zone pass that lost a zone, as on an explicit list", async () => {
    const venue = await seedVenue();
    const till = await seedDevice(venue, venue.till, "Till");
    await choose(venue, till, venue.till, [{ kind: "pass", ...every }]);
    await recordRemoval(till, "pass", { zoneId: venue.counter });
    await expect(check(venue, till, venue.dining)).resolves.toEqual({ resolved: undefined });
    for (const zoneId of [venue.counter, null]) {
      await expect(check(venue, till, zoneId)).resolves.toEqual({
        code: "kitchen_screen.zone_not_allowed",
        params: { zoneId },
      });
    }
  });
});

describe("what the read says is every", () => {
  it("says whether the device's own lists are every, and whether its profile's station list is", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, { station: every, pass: every });
    await set(venue, venue.till, {
      station: { stationIds: [venue.grill, venue.cold], zoneIds: null },
      pass: { stationIds: null, zoneIds: [venue.dining, venue.terrace] },
    });
    const open = await seedDevice(venue, venue.kds, "Open");
    const listed = await seedDevice(venue, venue.kds, "Listed");
    const bounded = await seedDevice(venue, venue.till, "Till");
    const matching = await seedDevice(venue, venue.till, "Till listing all it may");
    await choose(venue, open, venue.kds, [{ kind: "station", ...every }]);
    await choose(venue, listed, venue.kds, [
      { kind: "pass", stationIds: [venue.grill], zoneIds: [venue.terrace] },
    ]);
    await choose(venue, bounded, venue.till, [
      { kind: "station", ...every },
      { kind: "pass", ...every },
    ]);
    await choose(venue, matching, venue.till, [
      { kind: "station", stationIds: [venue.grill, venue.cold], zoneIds: null },
      { kind: "pass", stationIds: null, zoneIds: [venue.dining, venue.terrace] },
    ]);
    const flags = async (deviceId: string) =>
      (await shown(venue, deviceId)).map(
        ({ kind, everyStation, everyZone, profileEveryStation }) => ({
          kind,
          everyStation,
          everyZone,
          profileEveryStation,
        }),
      );
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
    const venue = await seedVenue();
    await set(venue, venue.kds, { station: every, pass: every });
    const open = await seedDevice(venue, venue.kds, "Open");
    await choose(venue, open, venue.kds, [{ kind: "station", ...every }]);
    await set(venue, venue.kds, { pass: every });
    expect(await shown(venue, open)).toEqual([
      {
        kind: "station",
        available: false,
        everyStation: false,
        everyZone: false,
        profileEveryStation: false,
        stations: [],
        zones: null,
      },
    ]);
  });
});

describe("the station screens kitchen displays run", () => {
  it("lists each active kitchen display's shown stations, never a till's", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, { station: every, pass: every });
    const line = await seedDevice(venue, venue.kds, "Line");
    const pass = await seedDevice(venue, venue.kds, "Pass");
    const off = await seedDevice(venue, venue.kds, "Old line");
    const till = await seedDevice(venue, venue.till, "Till");
    await choose(venue, line, venue.kds, [
      { kind: "station", stationIds: [venue.pastry, venue.grill], zoneIds: null },
    ]);
    await recordRemoval(line, "station", { stationId: venue.cold });
    await choose(venue, pass, venue.kds, [{ kind: "pass", ...every }]);
    await choose(venue, off, venue.kds, [{ kind: "station", ...every }]);
    await db.update(devices).set({ active: false }).where(eq(devices.id, off));
    await choose(venue, till, venue.till, [{ kind: "station", ...every }]);
    await db
      .update(kitchenStations)
      .set({ active: false })
      .where(eq(kitchenStations.id, venue.pastry));
    const elsewhere = await seedVenue();
    await set(elsewhere, elsewhere.kds, { station: every });
    const away = await seedDevice(elsewhere, elsewhere.kds, "Line");
    await choose(elsewhere, away, elsewhere.kds, [{ kind: "station", ...every }]);
    await expect(scoped((tx) => readStationScreens(tx, venue.cfg))).resolves.toEqual([
      { deviceId: line, stationIds: [venue.grill] },
    ]);
  });
});

describe("the station screens of several kitchen displays", () => {
  it("lists nothing when no kitchen display runs a station screen", async () => {
    const venue = await seedVenue();
    await expect(scoped((tx) => readStationScreens(tx, venue.cfg))).resolves.toEqual([]);
  });

  it("lists each display under its own profile's bound, choice and removals", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, {
      station: { stationIds: [venue.grill, venue.cold], zoneIds: null },
    });
    const wide = await seedProfile("kds");
    await set(venue, wide, { station: every });
    const bounded = await seedDevice(venue, venue.kds, "Bounded");
    const explicit = await seedDevice(venue, wide, "Explicit");
    const open = await seedDevice(venue, wide, "Open");
    await choose(venue, bounded, venue.kds, [{ kind: "station", ...every }]);
    await choose(venue, explicit, wide, [
      { kind: "station", stationIds: [venue.pastry, venue.cold], zoneIds: null },
    ]);
    await choose(venue, open, wide, [{ kind: "station", ...every }]);
    await recordRemoval(open, "station", { stationId: venue.grill });
    const screens = await scoped((tx) => readStationScreens(tx, venue.cfg));
    expect(screens).toEqual(
      [
        { deviceId: bounded, stationIds: [venue.cold, venue.grill] },
        { deviceId: explicit, stationIds: [venue.cold, venue.pastry] },
        { deviceId: open, stationIds: [venue.cold, venue.pastry] },
      ].sort((a, b) => (a.deviceId < b.deviceId ? -1 : 1)),
    );
  });
  it('keeps a switched-off station a display\'s list names, but not one a narrowing took or one only "every" covers', async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, { station: every });
    const listed = await seedDevice(venue, venue.kds, "Listed");
    const open = await seedDevice(venue, venue.kds, "Open");
    await choose(venue, listed, venue.kds, [
      { kind: "station", stationIds: [venue.grill, venue.cold, venue.pastry], zoneIds: null },
    ]);
    await choose(venue, open, venue.kds, [{ kind: "station", ...every }]);
    await set(venue, venue.kds, {
      station: { stationIds: [venue.grill, venue.cold], zoneIds: null },
    });
    await db
      .update(kitchenStations)
      .set({ active: false })
      .where(inArray(kitchenStations.id, [venue.cold, venue.pastry]));
    const read = async (withSwitchedOff: boolean) =>
      new Map(
        (await scoped((tx) => readStationScreens(tx, venue.cfg, { withSwitchedOff }))).map((s) => [
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
        [listed, [venue.cold, venue.grill]],
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
    const venue = await seedVenue();
    await set(venue, venue.kds, {
      station: { stationIds: [venue.grill, venue.cold, venue.pastry], zoneIds: null },
    });
    const line = await seedDevice(venue, venue.kds, "Line");
    const all = await seedDevice(venue, venue.kds, "All");
    await choose(venue, line, venue.kds, [station([venue.grill, venue.pastry])]);
    await choose(venue, all, venue.kds, [station(null)]);
    return { venue, line, all };
  }

  it("takes a station off each device on the profile, switched off or not, and no other", async () => {
    const { venue, line, all } = await narrowing();
    const old = await seedDevice(venue, venue.kds, "Old line");
    await choose(venue, old, venue.kds, [station([venue.pastry, venue.cold])]);
    await db.update(devices).set({ active: false }).where(eq(devices.id, old));
    const other = await seedProfile("kds");
    await set(venue, other, { station: every });
    const elsewhere = await seedDevice(venue, other, "Elsewhere");
    await choose(venue, elsewhere, other, [station([venue.pastry])]);

    await expect(
      set(venue, venue.kds, { station: { stationIds: [venue.grill, venue.cold], zoneIds: null } }),
    ).resolves.toEqual([
      lost(all, "All", { stations: [named(venue.pastry, "Pastry")] }),
      lost(line, "Line", { stations: [named(venue.pastry, "Pastry")] }),
      lost(old, "Old line", { stations: [named(venue.pastry, "Pastry")] }),
    ]);
    await expect(shown(venue, line)).resolves.toEqual([
      {
        kind: "station",
        available: true,
        everyStation: false,
        everyZone: true,
        profileEveryStation: false,
        stations: [slot(venue.grill, "Grill"), slot(venue.pastry, "Pastry", false)],
        zones: null,
      },
    ]);
    await expect(shown(venue, all)).resolves.toEqual([
      {
        kind: "station",
        available: true,
        everyStation: true,
        everyZone: true,
        profileEveryStation: false,
        stations: [
          slot(venue.cold, "Cold"),
          slot(venue.grill, "Grill"),
          slot(venue.pastry, "Pastry", false),
        ],
        zones: null,
      },
    ]);
    expect((await shown(venue, old))[0]!.stations).toEqual([
      slot(venue.cold, "Cold"),
      slot(venue.pastry, "Pastry", false),
    ]);
    for (const device of [line, all, old]) {
      expect(
        (await removalsOf(device)).map(({ screen, stationId, zoneId }) => ({
          screen,
          stationId,
          zoneId,
        })),
      ).toEqual([{ screen: "station", stationId: venue.pastry, zoneId: null }]);
    }
    expect(await removalsOf(elsewhere)).toEqual([]);
    expect((await shown(venue, elsewhere))[0]!.stations).toEqual([slot(venue.pastry, "Pastry")]);
  });

  it("empties a display's only station without refusing it, keeping the station as no longer available", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, { station: every });
    const deli = await seedDevice(venue, venue.kds, "Deli");
    await choose(venue, deli, venue.kds, [station([venue.pastry])]);
    await expect(
      set(venue, venue.kds, { station: { stationIds: [venue.grill], zoneIds: null } }),
    ).resolves.toEqual([lost(deli, "Deli", { stations: [named(venue.pastry, "Pastry")] })]);
    expect(await storedKindsOf(deli)).toEqual(["station"]);
    await expect(shown(venue, deli)).resolves.toEqual([
      {
        kind: "station",
        available: true,
        everyStation: false,
        everyZone: false,
        profileEveryStation: false,
        stations: [slot(venue.pastry, "Pastry", false)],
        zones: null,
      },
    ]);
  });

  it("narrows the profile's devices at every location, each against its own stations", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, { station: every, pass: every });
    const line = await seedDevice(venue, venue.kds, "Line");
    await choose(venue, line, venue.kds, [station([venue.grill])]);
    const elsewhere = await seedVenue();
    const away = await seedDevice(elsewhere, venue.kds, "Away");
    const awayPass = await seedDevice(elsewhere, venue.kds, "Away pass");
    await choose(elsewhere, away, venue.kds, [station([elsewhere.grill, elsewhere.cold])]);
    await choose(elsewhere, awayPass, venue.kds, [{ kind: "pass", ...every }]);
    await expect(
      set(venue, venue.kds, { station: { stationIds: [venue.grill], zoneIds: null } }),
    ).resolves.toEqual([
      lost(away, "Away", {
        stations: [named(elsewhere.cold, "Cold"), named(elsewhere.grill, "Grill")],
      }),
      lost(awayPass, "Away pass", { screens: ["pass"] }),
    ]);
    expect(await storedKindsOf(line)).toEqual(["station"]);
    expect(await storedKindsOf(away)).toEqual(["station"]);
    expect(await storedKindsOf(awayPass)).toEqual(["pass"]);
    await expect(shown(elsewhere, awayPass)).resolves.toEqual([
      {
        kind: "pass",
        available: false,
        everyStation: false,
        everyZone: false,
        profileEveryStation: false,
        stations: [],
        zones: null,
      },
    ]);
    await expect(shown(elsewhere, away)).resolves.toEqual([
      {
        kind: "station",
        available: true,
        everyStation: false,
        everyZone: false,
        profileEveryStation: false,
        stations: [slot(elsewhere.cold, "Cold", false), slot(elsewhere.grill, "Grill", false)],
        zones: null,
      },
    ]);
  });

  it("records every other switched-on station an every device showed, and nothing twice", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, { station: every });
    const all = await seedDevice(venue, venue.kds, "All");
    await choose(venue, all, venue.kds, [station(null)]);
    await recordRemoval(all, "station", { stationId: venue.cold });
    const off = await seedStation(venue.cfg.locationId, "Bar", 4);
    await db.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, off));
    await expect(
      set(venue, venue.kds, { station: { stationIds: [venue.grill], zoneIds: null } }),
    ).resolves.toEqual([lost(all, "All", { stations: [named(venue.pastry, "Pastry")] })]);
    expect((await removalsOf(all)).map((row) => row.stationId).sort()).toEqual(
      [venue.cold, venue.pastry].sort(),
    );
  });

  it("narrows a till's zones once its profile first bounds them, and the device's explicit list", async () => {
    const venue = await seedVenue();
    const open = await seedDevice(venue, venue.till, "Open till");
    const listed = await seedDevice(venue, venue.till, "Listed till");
    await choose(venue, open, venue.till, [{ kind: "pass", ...every }]);
    await choose(venue, listed, venue.till, [
      { kind: "pass", stationIds: [venue.grill], zoneIds: [venue.dining, venue.terrace] },
      station([venue.cold]),
    ]);
    await expect(
      set(venue, venue.till, { pass: { stationIds: null, zoneIds: [venue.dining] } }),
    ).resolves.toEqual([
      lost(listed, "Listed till", { zones: [named(venue.terrace, "Terrace")] }),
      lost(open, "Open till", {
        zones: [named(venue.terrace, "Terrace"), named(venue.counter, "Counter")],
      }),
    ]);
    await expect(shown(venue, listed)).resolves.toEqual([
      {
        kind: "station",
        available: true,
        everyStation: false,
        everyZone: true,
        profileEveryStation: true,
        stations: [slot(venue.cold, "Cold")],
        zones: null,
      },
      {
        kind: "pass",
        available: true,
        everyStation: false,
        everyZone: false,
        profileEveryStation: true,
        stations: [slot(venue.grill, "Grill")],
        zones: [slot(venue.terrace, "Terrace", false), slot(venue.dining, "Dining room")],
      },
    ]);
    expect((await shown(venue, open))[0]!.zones).toEqual([
      slot(venue.terrace, "Terrace", false),
      slot(venue.dining, "Dining room"),
      slot(venue.counter, "Counter", false),
    ]);
  });

  it("empties a pass screen's explicit zone list, keeping the zone as no longer available", async () => {
    const venue = await seedVenue();
    const till = await seedDevice(venue, venue.till, "Till");
    await choose(venue, till, venue.till, [
      { kind: "pass", stationIds: null, zoneIds: [venue.counter] },
    ]);
    await expect(
      set(venue, venue.till, { pass: { stationIds: null, zoneIds: [venue.dining] } }),
    ).resolves.toEqual([lost(till, "Till", { zones: [named(venue.counter, "Counter")] })]);
    expect(await storedKindsOf(till)).toEqual(["pass"]);
    await expect(shown(venue, till)).resolves.toEqual([
      {
        kind: "pass",
        available: true,
        everyStation: false,
        everyZone: false,
        profileEveryStation: false,
        stations: [],
        zones: [slot(venue.counter, "Counter", false)],
      },
    ]);
  });

  it("takes a kind the profile stops offering off its devices, recording the kind", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, { station: every, pass_monitor: every });
    const wall = await seedDevice(venue, venue.kds, "Wall");
    const line = await seedDevice(venue, venue.kds, "Line");
    await choose(venue, wall, venue.kds, [{ kind: "pass_monitor", ...every }]);
    await choose(venue, line, venue.kds, [station(null)]);
    await expect(set(venue, venue.kds, { station: every })).resolves.toEqual([
      lost(wall, "Wall", { screens: ["pass_monitor"] }),
    ]);
    expect(await storedKindsOf(wall)).toEqual(["pass_monitor"]);
    await expect(shown(venue, wall)).resolves.toEqual([
      {
        kind: "pass_monitor",
        available: false,
        everyStation: false,
        everyZone: false,
        profileEveryStation: false,
        stations: [],
        zones: null,
      },
    ]);
    expect(await removalsOf(line)).toEqual([]);
  });

  it("gives a station added back to each device still showing it as lost, and not to one picked on since", async () => {
    const { venue, line, all } = await narrowing();
    const picked = await seedDevice(venue, venue.kds, "Picked");
    await choose(venue, picked, venue.kds, [station([venue.grill, venue.pastry])]);
    await set(venue, venue.kds, {
      station: { stationIds: [venue.grill, venue.cold], zoneIds: null },
    });
    await choose(venue, picked, venue.kds, [station([venue.grill])]);
    await expect(
      set(venue, venue.kds, {
        station: { stationIds: [venue.grill, venue.cold, venue.pastry], zoneIds: null },
      }),
    ).resolves.toEqual([]);
    await expect(shown(venue, line)).resolves.toEqual([
      {
        kind: "station",
        available: true,
        everyStation: false,
        everyZone: true,
        profileEveryStation: false,
        stations: [slot(venue.grill, "Grill"), slot(venue.pastry, "Pastry")],
        zones: null,
      },
    ]);
    expect((await shown(venue, all))[0]!.stations).toEqual([
      slot(venue.cold, "Cold"),
      slot(venue.grill, "Grill"),
      slot(venue.pastry, "Pastry"),
    ]);
    expect((await shown(venue, picked))[0]!.stations).toEqual([slot(venue.grill, "Grill")]);
    for (const device of [line, all, picked]) expect(await removalsOf(device)).toEqual([]);
    await expect(
      outcome(choose(venue, picked, venue.kds, [station([venue.grill, venue.pastry])])),
    ).resolves.toEqual({ resolved: undefined });
  });

  it("gives a kind offered again back as the device chose it, with no line", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, {
      pass: { stationIds: [venue.grill, venue.cold], zoneIds: [venue.terrace, venue.dining] },
    });
    const pass = await seedDevice(venue, venue.kds, "Pass");
    await choose(venue, pass, venue.kds, [
      { kind: "pass", stationIds: [venue.grill], zoneIds: [venue.terrace] },
    ]);
    await expect(set(venue, venue.kds, { station: every })).resolves.toEqual([
      lost(pass, "Pass", { screens: ["pass"] }),
    ]);
    await expect(set(venue, venue.kds, { station: every, pass: every })).resolves.toEqual([]);
    await expect(shown(venue, pass)).resolves.toEqual([
      {
        kind: "pass",
        available: true,
        everyStation: false,
        everyZone: false,
        profileEveryStation: true,
        stations: [slot(venue.grill, "Grill")],
        zones: [slot(venue.terrace, "Terrace")],
      },
    ]);
    expect(await removalsOf(pass)).toEqual([]);
  });

  it("gives an every device back the kind offered again as it was, losing no station it never showed", async () => {
    const venue = await seedVenue();
    const grillOnly = { station: { stationIds: [venue.grill], zoneIds: null } };
    await set(venue, venue.kds, grillOnly);
    const all = await seedDevice(venue, venue.kds, "All");
    await choose(venue, all, venue.kds, [station(null)]);
    await expect(set(venue, venue.kds, { pass: every })).resolves.toEqual([
      lost(all, "All", { screens: ["station"] }),
    ]);
    await expect(set(venue, venue.kds, grillOnly)).resolves.toEqual([]);
    expect(await removalsOf(all)).toEqual([]);
    expect((await shown(venue, all))[0]!.stations).toEqual([slot(venue.grill, "Grill")]);
  });

  it("restores a kind and narrows its stations in one save", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, { pass: every });
    const pass = await seedDevice(venue, venue.kds, "Pass");
    await choose(venue, pass, venue.kds, [
      { kind: "pass", stationIds: [venue.grill, venue.cold], zoneIds: [venue.terrace] },
    ]);
    await set(venue, venue.kds, { station: every });
    await expect(
      set(venue, venue.kds, { pass: { stationIds: [venue.cold], zoneIds: null } }),
    ).resolves.toEqual([lost(pass, "Pass", { stations: [named(venue.grill, "Grill")] })]);
    await expect(shown(venue, pass)).resolves.toEqual([
      {
        kind: "pass",
        available: true,
        everyStation: false,
        everyZone: false,
        profileEveryStation: false,
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
    const venue = await seedVenue();
    const till = await seedDevice(venue, venue.till, "Till");
    await choose(venue, till, venue.till, [
      { kind: "pass", stationIds: null, zoneIds: [venue.dining, venue.terrace] },
    ]);
    await set(venue, venue.till, { pass: { stationIds: null, zoneIds: [venue.dining] } });
    await expect(set(venue, venue.till, { pass: every })).resolves.toEqual([]);
    expect((await shown(venue, till))[0]!.zones).toEqual([
      slot(venue.terrace, "Terrace"),
      slot(venue.dining, "Dining room"),
    ]);
    expect(await removalsOf(till)).toEqual([]);
  });

  it("keeps a display a narrowing emptied out of the station screens, refused as having no screen and not following every station", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, { station: every, pass_monitor: every });
    const deli = await seedDevice(venue, venue.kds, "Deli");
    const wall = await seedDevice(venue, venue.kds, "Wall");
    const open = await seedDevice(venue, venue.kds, "Open");
    await choose(venue, deli, venue.kds, [station([venue.pastry])]);
    await choose(venue, wall, venue.kds, [{ kind: "pass_monitor", ...every }]);
    await choose(venue, open, venue.kds, [station(null)]);
    await set(venue, venue.kds, { pass: every });
    await expect(
      scoped((tx) => readStationScreens(tx, venue.cfg, { withSwitchedOff: true })),
    ).resolves.toEqual([]);
    expect(await shown(venue, open)).toMatchObject([
      { kind: "station", available: false, everyStation: false, profileEveryStation: false },
    ]);
    for (const device of [deli, wall, open]) {
      await expect(
        outcome(scoped((tx) => assertKitchenDisplayHasScreen(tx, venue.cfg, device, venue.kds))),
      ).resolves.toEqual({ code: "kitchen_screen.required", params: {} });
    }
    await set(venue, venue.kds, { station: { stationIds: [venue.grill], zoneIds: null } });
    await expect(
      outcome(scoped((tx) => assertKitchenDisplayHasScreen(tx, venue.cfg, deli, venue.kds))),
    ).resolves.toEqual({ code: "kitchen_screen.required", params: {} });
    await expect(
      outcome(scoped((tx) => assertKitchenDisplayHasScreen(tx, venue.cfg, open, venue.kds))),
    ).resolves.toEqual({ resolved: undefined });
  });

  it("answers nothing and records nothing for a save that narrows nothing a device shows", async () => {
    const { venue, line, all } = await narrowing();
    const till = await seedDevice(venue, venue.till, "Till");
    await set(venue, venue.till, { pass: { stationIds: [venue.grill], zoneIds: null } });
    await choose(venue, till, venue.till, [
      { kind: "pass", stationIds: [venue.grill], zoneIds: null },
    ]);
    await expect(set(venue, venue.till, {})).resolves.toEqual([]);
    await expect(
      set(venue, venue.kds, {
        station: { stationIds: [venue.grill, venue.cold, venue.pastry], zoneIds: null },
        pass: every,
      }),
    ).resolves.toEqual([]);
    for (const device of [line, all, till]) expect(await removalsOf(device)).toEqual([]);
  });

  it("records nothing a device already holds as removed", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, { pass_monitor: every });
    const wall = await seedDevice(venue, venue.kds, "Wall");
    await choose(venue, wall, venue.kds, [{ kind: "pass_monitor", ...every }]);
    await recordRemoval(wall, "pass_monitor");
    const till = await seedDevice(venue, venue.till, "Till");
    await choose(venue, till, venue.till, [
      { kind: "pass", stationIds: null, zoneIds: [venue.dining, venue.terrace] },
    ]);
    await recordRemoval(till, "pass", { zoneId: venue.terrace });
    await expect(set(venue, venue.kds, {})).resolves.toEqual([]);
    await expect(
      set(venue, venue.till, { pass: { stationIds: null, zoneIds: [venue.dining] } }),
    ).resolves.toEqual([]);
    expect(await storedKindsOf(wall)).toEqual(["pass_monitor"]);
    expect(await removalsOf(wall)).toHaveLength(1);
    expect(await removalsOf(till)).toHaveLength(1);
    expect((await shown(venue, till))[0]!.zones).toEqual([
      slot(venue.terrace, "Terrace", false),
      slot(venue.dining, "Dining room"),
    ]);
  });

  it("forgets what a narrowing took once the device is saved again", async () => {
    const { venue, line } = await narrowing();
    await set(venue, venue.kds, { station: { stationIds: [venue.grill], zoneIds: null } });
    expect(await removalsOf(line)).toHaveLength(1);
    await choose(venue, line, venue.kds, [station([venue.grill])]);
    expect(await removalsOf(line)).toEqual([]);
  });
});

describe("a device narrowed against another profile", () => {
  const narrow = (venue: Venue, deviceId: string, profileId: string) =>
    scoped((tx) => narrowDeviceKitchenScreens(tx, venue.cfg, deviceId, profileId));

  it("drops what the other profile does not offer, and answers null when it loses nothing", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, { station: every, pass: every });
    const strict = await seedProfile("kds");
    await set(venue, strict, { station: { stationIds: [venue.grill], zoneIds: null } });
    const line = await seedDevice(venue, venue.kds, "Line");
    const pass = await seedDevice(venue, venue.kds, "Pass");
    await choose(venue, line, venue.kds, [
      { kind: "station", stationIds: [venue.grill, venue.cold], zoneIds: null },
    ]);
    await choose(venue, pass, venue.kds, [{ kind: "pass", ...every }]);
    await expect(narrow(venue, line, strict)).resolves.toEqual({
      deviceId: line,
      deviceName: "Line",
      lost: { screens: [], stations: [{ id: venue.cold, name: "Cold" }], zones: [] },
    });
    await expect(narrow(venue, line, strict)).resolves.toBeNull();
    await expect(narrow(venue, pass, strict)).resolves.toEqual({
      deviceId: pass,
      deviceName: "Pass",
      lost: { screens: ["pass"], stations: [], zones: [] },
    });
    expect(await storedKindsOf(pass)).toEqual(["pass"]);
    await expect(shown(venue, pass)).resolves.toEqual([
      {
        kind: "pass",
        available: false,
        everyStation: false,
        everyZone: false,
        profileEveryStation: false,
        stations: [],
        zones: null,
      },
    ]);
    await expect(narrow(venue, randomUUID(), strict)).resolves.toBeNull();
    const till = await seedDevice(venue, venue.till, "Till");
    await choose(venue, till, venue.till, [{ kind: "pass", ...every }]);
    await expect(narrow(venue, till, await seedProfile("till"))).resolves.toBeNull();
  });

  it("gives back on a switch back what a switch took, unless the device was picked on since", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, { station: every });
    const strict = await seedProfile("kds");
    await set(venue, strict, { station: { stationIds: [venue.grill], zoneIds: null } });
    const line = await seedDevice(venue, venue.kds, "Line");
    const picked = await seedDevice(venue, venue.kds, "Picked");
    for (const device of [line, picked]) {
      await choose(venue, device, venue.kds, [
        { kind: "station", stationIds: [venue.grill, venue.cold], zoneIds: null },
      ]);
      await narrow(venue, device, strict);
      await db.update(devices).set({ deviceProfileId: strict }).where(eq(devices.id, device));
    }
    await choose(venue, picked, strict, [
      { kind: "station", stationIds: [venue.grill], zoneIds: null },
    ]);
    for (const device of [line, picked]) {
      await expect(narrow(venue, device, venue.kds)).resolves.toBeNull();
      expect(await removalsOf(device)).toEqual([]);
    }
    expect((await shown(venue, line))[0]!.stations).toEqual([
      { id: venue.cold, name: "Cold", available: true, switchedOff: false },
      { id: venue.grill, name: "Grill", available: true, switchedOff: false },
    ]);
    expect((await shown(venue, picked))[0]!.stations).toEqual([
      { id: venue.grill, name: "Grill", available: true, switchedOff: false },
    ]);
  });

  it("gives a kind back on a switch losing no station the device never showed, and a till what its profile never bounded", async () => {
    const venue = await seedVenue();
    await set(venue, venue.kds, { station: every });
    const strict = await seedProfile("kds");
    await set(venue, strict, { station: { stationIds: [venue.grill], zoneIds: null } });
    const all = await seedDevice(venue, venue.kds, "All");
    await choose(venue, all, venue.kds, [{ kind: "station", ...every }]);
    await set(venue, venue.kds, { pass: every });
    await expect(narrow(venue, all, strict)).resolves.toBeNull();
    expect(await removalsOf(all)).toEqual([]);

    const till = await seedDevice(venue, venue.till, "Till");
    await choose(venue, till, venue.till, [{ kind: "station", ...every }]);
    const strictTill = await seedProfile("till");
    await set(venue, strictTill, { station: { stationIds: [venue.grill], zoneIds: null } });
    await expect(narrow(venue, till, strictTill)).resolves.toEqual({
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

  it("narrows a device at another location against that location's stations", async () => {
    const venue = await seedVenue();
    const elsewhere = await seedVenue();
    await set(elsewhere, elsewhere.kds, { station: every });
    const strict = await seedProfile("kds");
    await set(elsewhere, strict, { station: { stationIds: [elsewhere.grill], zoneIds: null } });
    const away = await seedDevice(elsewhere, elsewhere.kds, "Away");
    await choose(elsewhere, away, elsewhere.kds, [
      { kind: "station", stationIds: [elsewhere.grill, elsewhere.cold], zoneIds: null },
    ]);
    await expect(narrow(venue, away, strict)).resolves.toEqual({
      deviceId: away,
      deviceName: "Away",
      lost: { screens: [], stations: [{ id: elsewhere.cold, name: "Cold" }], zones: [] },
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
    const venue = await seedVenue();
    await set(venue, venue.kds, { station: every, pass: every });
    await set(venue, venue.till, { pass: { stationIds: [venue.grill], zoneIds: null } });
    const line = await seedDevice(venue, venue.kds, "Line");
    await choose(venue, line, venue.kds, [{ kind: "station", ...every }]);
    const till = await seedDevice(venue, venue.till, "Till");
    await choose(venue, till, venue.till, [{ kind: "pass", ...every }]);

    for (const read of [
      (tx: Transaction) => assertPassScreenZone(tx, venue.cfg, till, venue.dining),
      (tx: Transaction) => readStationScreens(tx, venue.cfg),
      (tx: Transaction) => readDeviceKitchenScreens(tx, venue.cfg, till),
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
});
