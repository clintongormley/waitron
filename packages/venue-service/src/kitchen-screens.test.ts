import { eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  deviceProfiles,
  devices,
  floorZones,
  kitchenStations,
  withTransaction,
} from "@waitron/db";
import { randomUUID } from "node:crypto";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  seedDevice as seedSharedDevice,
  seedDeviceProfiles,
  seedVenue,
} from "@waitron/db/testing/seed.js";
import { AppError } from "@waitron/shared";
import type { ProfileKitchenScreens } from "@waitron/module";
import { createDepartment, createServiceZone } from "./operations.js";
import {
  addProfileKitchenScreen,
  copyProfileKitchenScreens,
  assertPassScreenZone,
  readDeviceKitchenScreens,
  readDevicesKitchenScreens,
  readProfileKitchenScreens,
  readStationScreens,
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

async function updateStored(id: string, kitchenViews: ProfileKitchenScreens) {
  await db.update(deviceProfiles).set({ kitchenViews }).where(eq(deviceProfiles.id, id));
}

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

async function seedFixtureVenue(): Promise<void> {
  await seedVenue(db, {
    name: `Venue ${randomUUID()}`,
    invoiceLocales: ["en-GB"],
  });
}

async function seedProfile(formFactor: "till" | "phone-portrait" | "kds"): Promise<string> {
  const [row] = await seedDeviceProfiles(db, { name: `Profile ${randomUUID()}`, formFactor });
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
  await seedFixtureVenue();
  const cfg = {};
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

const set = (profileId: string, screens: ProfileKitchenScreens) =>
  scoped((tx) => setProfileKitchenScreens(tx, profileId, screens));

async function screensOf(profileId: string) {
  const all = await scoped((tx) => readProfileKitchenScreens(tx));
  return all.find((entry) => entry.profileId === profileId)?.screens;
}

describe("a profile's kitchen screens", () => {
  it.each(["kds", "till", "phone-portrait"] as const)(
    "refuses multiple screen kinds on a %s profile without replacing its saved screen",
    async (formFactor) => {
      const venue = await seedVenueWithStations();
      const profileId = await seedProfile(formFactor);
      const station = { stationIds: [venue.grill], zoneIds: null };
      await set(profileId, { station });
      await expect(
        outcome(set(profileId, { station, pass: { stationIds: null, zoneIds: null } })),
      ).resolves.toEqual(refused("kitchenScreens", "one_only"));
      await expect(screensOf(profileId)).resolves.toEqual({ station });
    },
  );

  it("stores each screen kind, stations by name and zones in display order", async () => {
    const venue = await seedVenueWithStations();
    for (const [kind, input, expected] of [
      [
        "station",
        { stationIds: [venue.grill, venue.cold, venue.grill], zoneIds: null },
        { stationIds: [venue.cold, venue.grill], zoneIds: null },
      ],
      [
        "pass",
        { stationIds: null, zoneIds: [venue.counter, venue.terrace] },
        { stationIds: null, zoneIds: [venue.terrace, venue.counter], showNonPassStations: true },
      ],
      [
        "pass_monitor",
        { stationIds: [venue.pastry, venue.cold], zoneIds: null },
        { stationIds: [venue.cold, venue.pastry], zoneIds: null, showNonPassStations: true },
      ],
    ] as const) {
      await set(venue.kds, { [kind]: input });
      expect(await screensOf(venue.kds)).toEqual({ [kind]: expected });
    }
    const [profile] = await db
      .select({ views: deviceProfiles.kitchenViews })
      .from(deviceProfiles)
      .where(eq(deviceProfiles.id, venue.kds));
    expect(profile!.views.pass_monitor!.stationIds).toEqual([venue.pastry, venue.cold]);
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
      ).resolves.toBeUndefined();
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
    const stationProfile = await seedProfile("kds");
    await expect(
      outcome(
        set(stationProfile, {
          station: { stationIds: [venue.grill], zoneIds: null },
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
    await expect(outcome(set(venue.kds, screens))).resolves.toEqual({ resolved: undefined });
    await expect(screensOf(venue.kds)).resolves.toEqual(read);
  });
});

describe("a kitchen screen added to a profile", () => {
  const add = (profileId: string, screen: Parameters<typeof addProfileKitchenScreen>[2]) =>
    scoped((tx) => addProfileKitchenScreen(tx, profileId, screen));

  it("creates the profile's row with the lists it is given", async () => {
    const venue = await seedVenueWithStations();
    await add(venue.kds, { kind: "station", stationIds: [venue.grill], zoneIds: null });
    expect(await screensOf(venue.kds)).toEqual({
      station: { stationIds: [venue.grill], zoneIds: null },
    });
  });

  it("refuses another kind so test setup cannot create a profile the editor cannot save", async () => {
    const venue = await seedVenueWithStations();
    await add(venue.kds, { kind: "station", stationIds: [venue.grill], zoneIds: null });
    await expect(
      outcome(add(venue.kds, { kind: "pass", stationIds: null, zoneIds: null })),
    ).resolves.toEqual(refused("kitchenScreens", "one_only"));
    expect(await screensOf(venue.kds)).toEqual({
      station: { stationIds: [venue.grill], zoneIds: null },
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

  it("changes nothing on an every list", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, {
      station: { stationIds: null, zoneIds: null },
    });
    await add(venue.kds, { kind: "station", stationIds: [venue.cold], zoneIds: null });
    await expect(screensOf(venue.kds)).resolves.toEqual({
      station: { stationIds: null, zoneIds: null },
    });
    const [profile] = await db
      .select({ views: deviceProfiles.kitchenViews })
      .from(deviceProfiles)
      .where(eq(deviceProfiles.id, venue.kds));
    expect(Object.keys(profile!.views)).toHaveLength(1);
  });
});

async function seedDevice(profileId: string, label: string): Promise<string> {
  return (await seedSharedDevice(db, { profileId, label })).deviceId;
}

const shown = (deviceId: string) => scoped((tx) => readDeviceKitchenScreens(tx, deviceId));
const every = { stationIds: null, zoneIds: null };

describe("devices inherit their profile's one screen", () => {
  it.each(["kds", "till", "phone-portrait"] as const)(
    "%s devices inherit the screen and later profile changes without choosing again",
    async (formFactor) => {
      const venue = await seedVenueWithStations();
      const profileId = await seedProfile(formFactor);
      await set(profileId, {
        pass: { stationIds: [venue.grill], zoneIds: [venue.dining], showNonPassStations: false },
      });
      const deviceId = await seedDevice(profileId, "Inherited screen");
      expect(await shown(deviceId)).toEqual([
        expect.objectContaining({
          kind: "pass",
          stations: [{ id: venue.grill, name: "Grill", available: true, switchedOff: false }],
          zones: [{ id: venue.dining, name: "Dining room", available: true, switchedOff: false }],
          showNonPassStations: false,
        }),
      ]);
      await set(profileId, { station: { stationIds: [venue.cold], zoneIds: null } });
      expect(await shown(deviceId)).toEqual([
        expect.objectContaining({
          kind: "station",
          stations: [{ id: venue.cold, name: "Cold", available: true, switchedOff: false }],
          zones: null,
        }),
      ]);
      await set(profileId, {});
      expect(await shown(deviceId)).toEqual([]);
    },
  );

  it("admits Pass actions within the inherited zones and refuses other zones or an empty profile", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { pass: { stationIds: null, zoneIds: [venue.dining] } });
    const deviceId = await seedDevice(venue.kds, "Pass");
    await expect(
      scoped((tx) => assertPassScreenZone(tx, deviceId, venue.dining)),
    ).resolves.toBeUndefined();
    await expect(
      outcome(scoped((tx) => assertPassScreenZone(tx, deviceId, venue.terrace))),
    ).resolves.toEqual({
      code: "kitchen_screen.zone_not_allowed",
      params: { zoneId: venue.terrace },
    });
    await set(venue.kds, {});
    await expect(
      outcome(scoped((tx) => assertPassScreenZone(tx, deviceId, venue.dining))),
    ).resolves.toEqual({
      code: "kitchen_screen.not_allowed",
      params: { screen: "pass" },
    });
  });

  it("counts inherited Station coverage on active kitchen displays, excluding ordering devices", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { station: { stationIds: [venue.grill], zoneIds: null } });
    await set(venue.till, { station: every });
    const deviceId = await seedDevice(venue.kds, "Line");
    const off = await seedDevice(venue.kds, "Off");
    await db.update(devices).set({ active: false }).where(eq(devices.id, off));
    await seedDevice(venue.till, "Counter");
    expect(await scoped((tx) => readStationScreens(tx))).toEqual([
      { deviceId, stationIds: [venue.grill] },
    ]);
  });
});

describe("inherited scope reads", () => {
  it("refuses a device without a pass screen", async () => {
    const venue = await seedVenueWithStations();
    const till = await seedDevice(venue.till, "Till");
    await set(venue.till, { station: every });
    await expect(check(till, venue.dining)).resolves.toEqual({
      code: "kitchen_screen.not_allowed",
      params: { screen: "pass" },
    });
  });
  it("refuses a zone outside an explicit list, and an order in no zone", async () => {
    const venue = await seedVenueWithStations();
    const till = await seedDevice(venue.till, "Till");
    await set(venue.till, { pass: { stationIds: null, zoneIds: [venue.dining, venue.terrace] } });
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
    await set(venue.till, { pass: every });
    await expect(check(till, venue.counter)).resolves.toEqual({ resolved: undefined });
    await expect(check(till, null)).resolves.toEqual({ resolved: undefined });
  });
  it("shows nothing for a device that has an unconfigured profile, or one unknown here", async () => {
    const venue = await seedVenueWithStations();
    const till = await seedDevice(venue.till, "Till");
    await expect(shown(till)).resolves.toEqual([]);
    await expect(shown(randomUUID())).resolves.toEqual([]);
  });
  const check = (deviceId: string, zoneId: string | null) =>
    outcome(scoped((tx) => assertPassScreenZone(tx, deviceId, zoneId)));

  it("reads several devices with separate profiles, and none for an unknown device or empty list", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { station: every });
    await set(venue.till, { pass: { stationIds: [venue.cold], zoneIds: [venue.dining] } });
    const line = await seedDevice(venue.kds, "Line");
    const pass = await seedDevice(venue.till, "Pass");
    const unknown = randomUUID();
    const ids = [line, pass, unknown];
    const read = await scoped((tx) => readDevicesKitchenScreens(tx, ids));
    const alone = new Map<string, unknown>();
    for (const id of ids) alone.set(id, await shown(id));
    expect(read).toEqual(alone);
    expect(read.get(line)).not.toEqual(read.get(pass));
    expect(read.get(unknown)).toEqual([]);
    expect(await scoped((tx) => readDevicesKitchenScreens(tx, []))).toEqual(new Map());
  });
  it("lists nothing when no kitchen display runs a station screen", async () => {
    await seedVenueWithStations();
    await expect(scoped((tx) => readStationScreens(tx))).resolves.toEqual([]);
  });
});

describe("deleted zone bounds", () => {
  it.each([
    ["station", "pass"],
    ["station", null],
    ["pass", "station"],
    ["pass", null],
  ] as const)("allows replacing an emptied %s screen with %s", async (previous, next) => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, {
      [previous]: {
        stationIds: [venue.grill],
        zoneIds: previous === "station" ? null : [venue.dining],
      },
    });
    await updateStored(venue.kds, {
      [previous]: {
        stationIds: previous === "station" ? [] : [venue.grill],
        zoneIds: previous === "station" ? null : [],
      },
    });
    const replacement = next === null ? {} : { [next]: { stationIds: null, zoneIds: null } };
    await expect(set(venue.kds, replacement)).resolves.toBeUndefined();
    expect(await screensOf(venue.kds)).toEqual(
      next === null
        ? {}
        : {
            [next]: {
              stationIds: null,
              zoneIds: null,
              ...(next === "pass" ? { showNonPassStations: true } : {}),
            },
          },
    );
  });

  it("retained empty zone bound survives unrelated profile save without widening", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { pass: { stationIds: [venue.grill], zoneIds: [venue.dining] } });
    await updateStored(venue.kds, { pass: { stationIds: [venue.grill], zoneIds: [] } });
    await db.update(floorZones).set({ active: false }).where(eq(floorZones.id, venue.dining));
    await expect(
      set(venue.kds, { pass: { stationIds: [venue.grill], zoneIds: [] } }),
    ).resolves.toBeUndefined();
    await expect(screensOf(venue.kds)).resolves.toEqual({
      pass: { stationIds: [venue.grill], zoneIds: [], showNonPassStations: true },
    });
    const [parent] = await db
      .select({ views: deviceProfiles.kitchenViews })
      .from(deviceProfiles)
      .where(eq(deviceProfiles.id, venue.kds));
    expect(parent!.views.pass).toEqual({
      stationIds: [venue.grill],
      zoneIds: [],
      showNonPassStations: true,
    });
    await expect(set(venue.kds, {})).resolves.toBeUndefined();
    await expect(screensOf(venue.kds)).resolves.toEqual({});
  });
  it("an empty inherited zone bound stays empty and refuses every order zone", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { pass: { stationIds: [venue.grill], zoneIds: [venue.dining] } });
    await updateStored(venue.kds, { pass: { stationIds: [venue.grill], zoneIds: [] } });
    const deviceId = await seedDevice(venue.kds, "Restricted pass");
    expect((await shown(deviceId))[0]!.zones).toEqual([]);
    for (const zoneId of [venue.dining, null]) {
      expect(await outcome(scoped((tx) => assertPassScreenZone(tx, deviceId, zoneId)))).toEqual({
        code: "kitchen_screen.zone_not_allowed",
        params: { zoneId },
      });
    }
  });
});

it("A725 inherited station choices use station-name order", async () => {
  const v = await seedVenueWithStations();
  await db.update(kitchenStations).set({ name: "Ásador" }).where(eq(kitchenStations.id, v.cold));
  await set(v.kds, { station: { stationIds: [v.pastry, v.grill, v.cold], zoneIds: null } });
  expect((await screensOf(v.kds))!.station!.stationIds).toEqual([v.cold, v.grill, v.pastry]);
  const device = await seedDevice(v.kds, "Names");
  const rows = (await shown(device))[0]!.stations;
  expect(rows.map(({ id }) => id)).toEqual([v.cold, v.grill, v.pastry]);
  expect(rows.map(({ available }) => available)).toEqual([true, true, true]);
});

describe("A773 profile display policy", () => {
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
  it("stores the profile's value in its column, and reads a row inserted without it as true", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { pass: { ...every, showNonPassStations: false } });
    const [stored] = await db
      .select({ views: deviceProfiles.kitchenViews })
      .from(deviceProfiles)
      .where(eq(deviceProfiles.id, venue.kds));
    expect(stored!.views.pass!.showNonPassStations).toBe(false);

    await updateStored(venue.till, { pass: every });
    expect((await screensOf(venue.till))!.pass).toEqual({
      ...every,
      showNonPassStations: true,
    });
  });
  it.each(["pass", "pass_monitor"] as const)(
    "keeps an omitted %s display policy and copies it",
    async (kind) => {
      const venue = await seedVenueWithStations();
      await set(venue.kds, { [kind]: { ...every, showNonPassStations: false } });
      await set(venue.kds, { [kind]: { stationIds: [venue.grill], zoneIds: null } });
      expect(await screensOf(venue.kds)).toEqual({
        [kind]: { stationIds: [venue.grill], zoneIds: null, showNonPassStations: false },
      });
      const copy = await seedProfile("kds");
      await scoped((tx) => copyProfileKitchenScreens(tx, venue.kds, copy));
      expect(await screensOf(copy)).toEqual({
        [kind]: { stationIds: [venue.grill], zoneIds: null, showNonPassStations: false },
      });
      await set(venue.kds, { station: every });
      expect((await screensOf(venue.kds))!.station).not.toHaveProperty("showNonPassStations");
      await set(venue.kds, { [kind]: every });
      expect((await screensOf(venue.kds))![kind]).toHaveProperty("showNonPassStations", true);
    },
  );
});

describe("profile-scoped screen reads", () => {
  it("reads only the requested profiles once for device, coverage and action reads", async () => {
    const venue = await seedVenueWithStations();
    await set(venue.kds, { station: every });
    await set(venue.till, { pass: every });
    await seedDevice(venue.kds, "Line");
    const till = await seedDevice(venue.till, "Pass");
    for (const read of [
      (tx: Transaction) => assertPassScreenZone(tx, till, venue.dining),
      (tx: Transaction) => readStationScreens(tx),
      (tx: Transaction) => readDeviceKitchenScreens(tx, till),
    ])
      await scoped(async (tx) => {
        const session = (
          tx as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }
        ).session;
        const prepared = vi.spyOn(session, "prepareQuery");
        try {
          await read(tx);
          const queries = prepared.mock.calls.map(([query]) => query as unknown as { sql: string });
          const profiles = queries.filter((query) => query.sql.includes('from "device_profiles"'));
          expect(profiles).toHaveLength(1);
          expect(profiles[0]!.sql).toContain('"device_profiles"."id" in');
        } finally {
          prepared.mockRestore();
        }
      });
  });
});
