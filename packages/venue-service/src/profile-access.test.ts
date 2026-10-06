import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  deviceProfiles,
  floorZones,
  kitchenStations,
  locations,
  watchers,
  withTransaction,
} from "@waitron/db";
import { randomUUID } from "node:crypto";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError, locationId as brandLocationId } from "@waitron/shared";
import type { LocationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import {
  configureZone,
  createDepartment,
  createServiceZone,
  deactivateDepartment,
  deactivateServiceZone,
} from "./operations.js";
import {
  readProfileServiceAccess,
  setProfileServiceAccess,
  type ProfileServiceAccessInput,
} from "./profile-access.js";
import {
  deviceProfileServiceAccess,
  deviceProfileStations,
  deviceProfileWatchers,
  deviceProfileZones,
} from "./schema/service.js";

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

/** The refusal's code and params, or the value it resolved with, so a test can compare it whole. */
async function outcome(promise: Promise<unknown>): Promise<unknown> {
  try {
    return { resolved: await promise };
  } catch (error) {
    if (error instanceof AppError) return { code: error.code, params: { ...error.params } };
    throw error;
  }
}

const NO_LISTS = { stationIds: [], watcherIds: [] } as const;

interface Venue {
  cfg: { locationId: LocationId };
  restaurant: string;
  deli: string;
  /** Restaurant zones; `terrace` sits before `dining` by position although it was created later. */
  dining: string;
  terrace: string;
  /** The Deli's only zone. */
  counter: string;
  profile: string;
}

async function seedLocation(name: string): Promise<LocationId> {
  const [row] = await db
    .insert(locations)
    .values({ name, invoiceLocales: ["en-GB"], operationDescription: "Hospitality" })
    .returning({ id: locations.id });
  return brandLocationId(row!.id);
}

async function seedProfile(): Promise<string> {
  const [row] = await db
    .insert(deviceProfiles)
    .values({ name: `Till ${randomUUID()}`, formFactor: "till" })
    .returning({ id: deviceProfiles.id });
  return row!.id;
}

/** Restaurant with two zones, Deli with one, and a till profile with nothing stored yet. */
async function seedVenue(): Promise<Venue> {
  const locationId = await seedLocation(`Venue ${randomUUID()}`);
  const cfg = { locationId };
  const ids = await scoped(async (tx) => {
    const restaurant = await createDepartment(tx, cfg, {
      name: "Restaurant",
      defaultServiceMode: "table_tab",
    });
    const deli = await createDepartment(tx, cfg, { name: "Deli", defaultServiceMode: "prepay" });
    const dining = await createServiceZone(tx, cfg, {
      name: "Dining room",
      departmentId: restaurant.id,
    });
    const terrace = await createServiceZone(tx, cfg, {
      name: "Terrace",
      departmentId: restaurant.id,
    });
    const counter = await createServiceZone(tx, cfg, { name: "Counter", departmentId: deli.id });
    await tx.update(floorZones).set({ displayOrder: 2 }).where(eq(floorZones.id, dining.id));
    await tx.update(floorZones).set({ displayOrder: 1 }).where(eq(floorZones.id, terrace.id));
    return {
      restaurant: restaurant.id,
      deli: deli.id,
      dining: dining.id,
      terrace: terrace.id,
      counter: counter.id,
    };
  });
  return { cfg, ...ids, profile: await seedProfile() };
}

function restaurantScope(
  venue: Venue,
  overrides: Partial<ProfileServiceAccessInput> = {},
): ProfileServiceAccessInput {
  return {
    departmentId: venue.restaurant,
    allowedZoneIds: null,
    startingZoneId: venue.dining,
    ...NO_LISTS,
    ...overrides,
  };
}

const save = (venue: Venue, input: ProfileServiceAccessInput) =>
  scoped((tx) => setProfileServiceAccess(tx, venue.cfg, venue.profile, input));
const read = (venue: Venue) =>
  scoped((tx) => readProfileServiceAccess(tx, venue.cfg, venue.profile));

describe("a profile's service access", () => {
  it("has no department restriction while nothing is stored for the profile", async () => {
    const venue = await seedVenue();
    await expect(read(venue)).resolves.toEqual({
      departmentId: null,
      allowedZoneIds: null,
      startingZoneId: null,
      stationIds: [],
      watcherIds: [],
    });
  });

  it("accepts a Restaurant profile starting in its own zone, and lists its zones by position", async () => {
    const venue = await seedVenue();
    await save(venue, restaurantScope(venue));
    await expect(read(venue)).resolves.toEqual({
      departmentId: venue.restaurant,
      allowedZoneIds: [venue.terrace, venue.dining],
      startingZoneId: venue.dining,
      stationIds: [],
      watcherIds: [],
    });
  });

  it("keeps an explicit subset of the department's zones", async () => {
    const venue = await seedVenue();
    await save(
      venue,
      restaurantScope(venue, { allowedZoneIds: [venue.dining], startingZoneId: venue.dining }),
    );
    await expect(read(venue)).resolves.toMatchObject({
      allowedZoneIds: [venue.dining],
      startingZoneId: venue.dining,
    });
  });

  it("refuses the Deli's zone as an allowed zone of a Restaurant profile", async () => {
    const venue = await seedVenue();
    await expect(
      outcome(
        save(venue, restaurantScope(venue, { allowedZoneIds: [venue.dining, venue.counter] })),
      ),
    ).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "allowedZoneIds", reason: "outside_department" },
    });
  });

  it("refuses the Deli's zone as a Restaurant profile's starting zone", async () => {
    const venue = await seedVenue();
    await expect(
      outcome(save(venue, restaurantScope(venue, { startingZoneId: venue.counter }))),
    ).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "startingZoneId", reason: "outside_department" },
    });
  });

  it("refuses a starting zone outside the explicit subset", async () => {
    const venue = await seedVenue();
    await expect(
      outcome(
        save(
          venue,
          restaurantScope(venue, { allowedZoneIds: [venue.dining], startingZoneId: venue.terrace }),
        ),
      ),
    ).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "startingZoneId", reason: "outside_allowed" },
    });
  });

  it("refuses an empty explicit subset", async () => {
    const venue = await seedVenue();
    await expect(
      outcome(save(venue, restaurantScope(venue, { allowedZoneIds: [] }))),
    ).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "allowedZoneIds", reason: "empty" },
    });
  });

  it("refuses a department at another location", async () => {
    const venue = await seedVenue();
    const elsewhere = await seedVenue();
    await expect(
      outcome(
        save(
          venue,
          restaurantScope(venue, {
            departmentId: elsewhere.restaurant,
            startingZoneId: elsewhere.dining,
          }),
        ),
      ),
    ).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "departmentId", reason: "not_found" },
    });
  });

  it("refuses a disabled department", async () => {
    const venue = await seedVenue();
    await scoped((tx) => deactivateDepartment(tx, venue.cfg, venue.deli));
    await expect(
      outcome(
        save(venue, restaurantScope(venue, { departmentId: venue.deli, startingZoneId: null })),
      ),
    ).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "departmentId", reason: "not_found" },
    });
  });

  it("refuses a deactivated zone as the starting zone", async () => {
    const venue = await seedVenue();
    await scoped((tx) => deactivateServiceZone(tx, venue.cfg, venue.dining));
    await expect(outcome(save(venue, restaurantScope(venue)))).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "startingZoneId", reason: "unavailable" },
    });
  });

  it("requires a starting zone once a department is set", async () => {
    const venue = await seedVenue();
    await expect(
      outcome(save(venue, restaurantScope(venue, { startingZoneId: null }))),
    ).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "startingZoneId", reason: "required" },
    });
  });

  it("refuses zones without a department", async () => {
    const venue = await seedVenue();
    await expect(
      outcome(
        save(venue, {
          departmentId: null,
          allowedZoneIds: null,
          startingZoneId: venue.dining,
          ...NO_LISTS,
        }),
      ),
    ).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "startingZoneId", reason: "department_required" },
    });
    await expect(
      outcome(
        save(venue, {
          departmentId: null,
          allowedZoneIds: [venue.dining],
          startingZoneId: null,
          ...NO_LISTS,
        }),
      ),
    ).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "allowedZoneIds", reason: "department_required" },
    });
  });

  it("refuses a profile that does not exist", async () => {
    const venue = await seedVenue();
    const missing = { ...venue, profile: randomUUID() };
    await expect(outcome(save(missing, restaurantScope(venue)))).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "profileId", reason: "not_found" },
    });
  });

  it("refuses to read a profile that does not exist", async () => {
    const venue = await seedVenue();
    await expect(outcome(read({ ...venue, profile: randomUUID() }))).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "profileId", reason: "not_found" },
    });
  });

  it("leaves the stored access as it was when a save is refused", async () => {
    const venue = await seedVenue();
    await save(venue, restaurantScope(venue, { allowedZoneIds: [venue.dining] }));
    await expect(
      outcome(save(venue, restaurantScope(venue, { startingZoneId: venue.counter }))),
    ).resolves.toMatchObject({ code: "device_profile.access_invalid" });
    await expect(read(venue)).resolves.toMatchObject({
      departmentId: venue.restaurant,
      allowedZoneIds: [venue.dining],
      startingZoneId: venue.dining,
    });
  });

  it("clears the department restriction when saved with no department", async () => {
    const venue = await seedVenue();
    await save(venue, restaurantScope(venue, { allowedZoneIds: [venue.dining] }));
    await save(venue, {
      departmentId: null,
      allowedZoneIds: null,
      startingZoneId: null,
      ...NO_LISTS,
    });
    await expect(read(venue)).resolves.toEqual({
      departmentId: null,
      allowedZoneIds: null,
      startingZoneId: null,
      stationIds: [],
      watcherIds: [],
    });
    expect(
      await db
        .select()
        .from(deviceProfileZones)
        .where(eq(deviceProfileZones.deviceProfileId, venue.profile)),
    ).toEqual([]);
  });

  it("expands every zone to the department's active zones when read", async () => {
    const venue = await seedVenue();
    await save(venue, restaurantScope(venue));
    const patio = await scoped(async (tx) => {
      const zone = await createServiceZone(tx, venue.cfg, {
        name: "Patio",
        departmentId: venue.restaurant,
      });
      await tx.update(floorZones).set({ displayOrder: 3 }).where(eq(floorZones.id, zone.id));
      await deactivateServiceZone(tx, venue.cfg, venue.terrace);
      return zone.id;
    });
    await expect(read(venue)).resolves.toMatchObject({
      allowedZoneIds: [venue.dining, patio],
      startingZoneId: venue.dining,
    });
  });

  it("stops offering an allowed zone once it is deactivated or moved to another department", async () => {
    const venue = await seedVenue();
    await save(
      venue,
      restaurantScope(venue, {
        allowedZoneIds: [venue.dining, venue.terrace],
        startingZoneId: venue.dining,
      }),
    );
    await scoped((tx) => deactivateServiceZone(tx, venue.cfg, venue.terrace));
    await expect(read(venue)).resolves.toMatchObject({ allowedZoneIds: [venue.dining] });

    const other = await seedVenue();
    await save(other, restaurantScope(other));
    await scoped((tx) =>
      configureZone(tx, other.cfg, { zoneId: other.terrace, departmentId: other.deli }),
    );
    await expect(read(other)).resolves.toMatchObject({ allowedZoneIds: [other.dining] });
  });

  it("starts in the first allowed zone by position once the starting zone is deactivated", async () => {
    const venue = await seedVenue();
    await scoped(async (tx) => {
      const zone = await createServiceZone(tx, venue.cfg, {
        name: "Patio",
        departmentId: venue.restaurant,
      });
      await tx.update(floorZones).set({ displayOrder: 0 }).where(eq(floorZones.id, zone.id));
    });
    // Patio sits first by position but is outside the subset, so it is never the fallback.
    await save(
      venue,
      restaurantScope(venue, {
        allowedZoneIds: [venue.dining, venue.terrace],
        startingZoneId: venue.dining,
      }),
    );
    await scoped((tx) => deactivateServiceZone(tx, venue.cfg, venue.dining));
    await expect(read(venue)).resolves.toMatchObject({
      allowedZoneIds: [venue.terrace],
      startingZoneId: venue.terrace,
    });
  });

  it("says the profile cannot order once no allowed zone is left", async () => {
    const venue = await seedVenue();
    await save(
      venue,
      restaurantScope(venue, { allowedZoneIds: [venue.dining], startingZoneId: venue.dining }),
    );
    await scoped((tx) => deactivateServiceZone(tx, venue.cfg, venue.dining));
    await expect(read(venue)).resolves.toEqual({
      departmentId: venue.restaurant,
      allowedZoneIds: [],
      startingZoneId: null,
      stationIds: [],
      watcherIds: [],
    });
  });

  it("allows no zone, rather than every zone, when an explicit subset loses its rows", async () => {
    const venue = await seedVenue();
    await save(venue, restaurantScope(venue, { allowedZoneIds: [venue.dining] }));
    await db
      .delete(deviceProfileZones)
      .where(eq(deviceProfileZones.deviceProfileId, venue.profile));
    await expect(read(venue)).resolves.toMatchObject({ allowedZoneIds: [], startingZoneId: null });
  });

  it("says the profile cannot order once its department is disabled", async () => {
    const venue = await seedVenue();
    await save(venue, restaurantScope(venue));
    await scoped((tx) => deactivateDepartment(tx, venue.cfg, venue.restaurant));
    await expect(read(venue)).resolves.toMatchObject({
      departmentId: venue.restaurant,
      allowedZoneIds: [],
      startingZoneId: null,
    });
  });

  it("is deleted with its profile", async () => {
    const venue = await seedVenue();
    const [station] = await db
      .insert(kitchenStations)
      .values({ locationId: venue.cfg.locationId, name: "Grill" })
      .returning({ id: kitchenStations.id });
    await save(
      venue,
      restaurantScope(venue, {
        allowedZoneIds: [venue.dining],
        stationIds: [station!.id],
      }),
    );
    await db.delete(deviceProfiles).where(eq(deviceProfiles.id, venue.profile));
    expect(await db.select().from(deviceProfileServiceAccess)).toEqual([]);
    expect(
      await db
        .select()
        .from(deviceProfileZones)
        .where(eq(deviceProfileZones.deviceProfileId, venue.profile)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(deviceProfileStations)
        .where(eq(deviceProfileStations.deviceProfileId, venue.profile)),
    ).toEqual([]);
  });
});

describe("a profile's station and watcher lists", () => {
  async function seedStation(locationId: LocationId, name: string, displayOrder: number) {
    const [row] = await db
      .insert(kitchenStations)
      .values({ locationId, name, displayOrder })
      .returning({ id: kitchenStations.id });
    return row!.id;
  }

  async function seedWatcher(locationId: LocationId, name: string, displayOrder: number) {
    const [row] = await db
      .insert(watchers)
      .values({ locationId, name, displayOrder })
      .returning({ id: watchers.id });
    return row!.id;
  }

  const display = (stationIds: string[], watcherIds: string[]): ProfileServiceAccessInput => ({
    departmentId: null,
    allowedZoneIds: null,
    startingZoneId: null,
    stationIds,
    watcherIds,
  });

  it("stores the lists for a shared display with no department, in display order", async () => {
    const venue = await seedVenue();
    const grill = await seedStation(venue.cfg.locationId, "Grill", 2);
    const cold = await seedStation(venue.cfg.locationId, "Cold", 1);
    const pass = await seedWatcher(venue.cfg.locationId, "Pass", 1);
    await save(venue, display([grill, cold, grill], [pass]));
    await expect(read(venue)).resolves.toEqual({
      departmentId: null,
      allowedZoneIds: null,
      startingZoneId: null,
      stationIds: [cold, grill],
      watcherIds: [pass],
    });
    expect(
      await db
        .select()
        .from(deviceProfileWatchers)
        .where(eq(deviceProfileWatchers.deviceProfileId, venue.profile)),
    ).toHaveLength(1);
  });

  it("refuses a station or watcher at another location, or one switched off", async () => {
    const venue = await seedVenue();
    const elsewhere = await seedLocation(`Elsewhere ${randomUUID()}`);
    const farStation = await seedStation(elsewhere, "Grill", 0);
    const farWatcher = await seedWatcher(elsewhere, "Pass", 0);
    const offStation = await seedStation(venue.cfg.locationId, "Old grill", 0);
    await db
      .update(kitchenStations)
      .set({ active: false })
      .where(eq(kitchenStations.id, offStation));
    const offWatcher = await seedWatcher(venue.cfg.locationId, "Old pass", 0);
    await db.update(watchers).set({ active: false }).where(eq(watchers.id, offWatcher));

    for (const [input, field] of [
      [display([farStation], []), "stationIds"],
      [display([offStation], []), "stationIds"],
      [display([], [farWatcher]), "watcherIds"],
      [display([], [offWatcher]), "watcherIds"],
    ] as const) {
      await expect(outcome(save(venue, input))).resolves.toEqual({
        code: "device_profile.access_invalid",
        params: { field, reason: "not_found" },
      });
    }
  });

  it("stops listing a station or watcher once it is switched off", async () => {
    const venue = await seedVenue();
    const grill = await seedStation(venue.cfg.locationId, "Grill", 0);
    const cold = await seedStation(venue.cfg.locationId, "Cold", 1);
    const pass = await seedWatcher(venue.cfg.locationId, "Pass", 0);
    await save(venue, display([grill, cold], [pass]));
    await db.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, grill));
    await db.update(watchers).set({ active: false }).where(eq(watchers.id, pass));
    await expect(read(venue)).resolves.toMatchObject({ stationIds: [cold], watcherIds: [] });
  });

  it("replaces the lists on every save", async () => {
    const venue = await seedVenue();
    const grill = await seedStation(venue.cfg.locationId, "Grill", 0);
    const cold = await seedStation(venue.cfg.locationId, "Cold", 1);
    await save(venue, display([grill], []));
    await save(venue, display([cold], []));
    await expect(read(venue)).resolves.toMatchObject({ stationIds: [cold] });
  });
});
